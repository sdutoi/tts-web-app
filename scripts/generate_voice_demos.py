"""Generate static TTS demo clips for each (language, voice) pair used in the UI.

This script calls the OpenAI TTS endpoint directly (same model as the runtime route)
and stores short demo MP3 files in public/demos so the frontend can load them
instantly without hitting the API every time.

Usage:
  1. Ensure you have OPENAI_API_KEY exported in your environment.
  2. (Optional) Set OPENAI_PROJECT_ID / OPENAI_ORG_ID if you use project/org scoping.
  3. Run: python scripts/generate_voice_demos.py
  4. Commit the generated files under public/demos (keep them small!).

Notes:
  * We intentionally keep the demo sentence very short to minimize repo bloat.
  * Existing files are skipped unless you pass --force.
  * Failures are logged but won't stop the whole batch unless --strict.
  * If a voice is not supported / returns error, it will be listed at the end.

Outputs:
  public/demos/{lang}_{voice}.mp3
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Tuple
import textwrap
import math
import urllib.request
import urllib.error
from contextlib import suppress

# Mirror VOICE_CANDIDATES in the frontend. Order matters but only for readability here.
VOICE_CANDIDATES: Dict[str, List[str]] = {
    # Maintain existing selections; add a conservative subset for new languages.
    "en": ["ash", "coral", "alloy", "echo", "verse"],
    "fr": ["nova", "shimmer", "alloy", "verse", "coral"],
    "de": ["verse", "onyx", "alloy", "echo", "shimmer"],
    "it": ["ballad", "alloy", "nova", "ash", "coral"],
    "es": ["ash", "alloy", "nova", "ballad", "coral"],
    # Provisional picks for new languages (can be tuned later once UI integrates them).
    "ru": ["alloy", "echo", "nova"],
    "ja": ["alloy", "nova", "ash"],
    "pt": ["alloy", "nova", "echo"],  # covers PT/BR generically
    "nl": ["alloy", "echo", "verse"],
    "default": ["alloy", "nova", "echo", "verse", "shimmer"],
}

LANGS = ["en", "fr", "de", "it", "es", "ru", "ja", "pt", "nl"]


def demo_sentence(lang: str) -> str:
    """Return the localized demo sentence.

    Required pattern: "Hello, do you want to learn {LanguageName} with me? Let's go!"
    For non-English languages we translate both greeting + rest naturally.
    (These are short; minor stylistic variation is acceptable.)
    """
    sentences = {
        "en": "Hello, do you want to learn English with me? Let's go!",
        "fr": "Bonjour, tu veux apprendre le français avec moi ? Allons-y !",
        "de": "Hallo, willst du Deutsch mit mir lernen? Los geht's!",
        "it": "Ciao, vuoi imparare l'italiano con me? Andiamo!",
        "es": "Hola, ¿quieres aprender español conmigo? ¡Vamos!",
        "ru": "Привет, хочешь выучить русский со мной? Поехали!",
        "ja": "こんにちは、一緒に日本語を学びませんか？さあ行こう！",
        "pt": "Olá, quer aprender português comigo? Vamos lá!",
        "nl": "Hallo, wil je samen Nederlands leren? Laten we gaan!",
    }
    return sentences.get(lang, sentences["en"])


OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech"

# Allowlisted TTS models (same philosophy as API route) – order sets fallback preference.
ALLOWLIST = [
    "gpt-4o-audio-preview",
    "gpt-4o-mini-tts",  # stable
]


def resolve_model(explicit: str | None, require_better: bool) -> str:
    if explicit and explicit in ALLOWLIST:
        if require_better and explicit != "gpt-4o-audio-preview":
            raise RuntimeError(
                "Strict better TTS required: set OPENAI_TTS_MODEL=gpt-4o-audio-preview or pass --model gpt-4o-audio-preview"
            )
        return explicit
    # default preference: preview model first
    chosen = ALLOWLIST[0]
    if require_better and chosen != "gpt-4o-audio-preview":
        raise RuntimeError("Strict better TTS required (gpt-4o-audio-preview)")
    return chosen


def call_tts(
    api_key: str,
    text: str,
    voice: str,
    model: str,
    speed: float = 0.95,
    fmt: str = "mp3",
    project: str | None = None,
    org: str | None = None,
    retries: int = 2,
    retry_backoff: float = 1.5,
    debug: bool = False,
) -> bytes:
    """Call OpenAI TTS with basic retry + exponential backoff.

    Retries on network errors and 5xx / 429 codes. Raises RuntimeError on final failure.
    """
    attempt = 0
    while True:
        attempt += 1
        payload = {
            "model": model,
            "input": text,
            "voice": voice,
            "format": fmt,
            "speed": speed,
        }
        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "audio/mpeg" if fmt == "mp3" else "audio/ogg",
        }
        if project:
            headers["OpenAI-Project"] = project
        if org:
            headers["OpenAI-Organization"] = org

        req = urllib.request.Request(
            OPENAI_TTS_URL, data=data, headers=headers, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            code = e.code
            body = e.read().decode("utf-8", errors="replace")
            if debug:
                print(
                    f"\n[DEBUG] HTTPError model={model} code={code} body={body[:300]}"
                )
            retriable = code in (429, 500, 502, 503, 504)
            if retriable and attempt <= retries + 1:
                sleep_for = (retry_backoff ** (attempt - 1)) + (0.1 * attempt)
                print(
                    f"  retry {attempt}/{retries+1} after HTTP {code} ({sleep_for:.2f}s)"
                )
                time.sleep(sleep_for)
                continue
            raise RuntimeError(f"HTTP {code} {e.reason}: {body[:300]}") from e
        except urllib.error.URLError as e:
            if attempt <= retries + 1:
                sleep_for = (retry_backoff ** (attempt - 1)) + (0.1 * attempt)
                print(f"  network retry {attempt}/{retries+1} ({sleep_for:.2f}s)")
                time.sleep(sleep_for)
                continue
            raise RuntimeError(f"Network error: {e}") from e


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate static TTS demo audio files."
    )
    parser.add_argument(
        "--force", action="store_true", help="Re-generate even if file already exists"
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Abort on first failure (default is continue)",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.75,
        help="Sleep seconds between API calls to avoid rate limits",
    )
    parser.add_argument("--only-lang", choices=LANGS, help="Limit to a single language")
    parser.add_argument(
        "--voices",
        help="Comma-separated subset of voices to process (applies after language filter).",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=2,
        help="Retries for retriable errors (total attempts = retries+1)",
    )
    parser.add_argument(
        "--retry-backoff",
        type=float,
        default=1.5,
        help="Exponential backoff factor base (sleep = factor^(attempt-1))",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Verify existing files (non-empty & >= 2KB) and report missing/too-small ones without regenerating.",
    )
    parser.add_argument("--out", default="public/demos", help="Output directory")
    parser.add_argument(
        "--model",
        help="Override TTS model (allowlisted only). Defaults to env OPENAI_TTS_MODEL or gpt-4o-audio-preview.",
    )
    parser.add_argument(
        "--require-better",
        action="store_true",
        help="Require better TTS model (gpt-4o-audio-preview) and disallow fallback.",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Verbose debug for failures (prints payload + partial body)",
    )
    args = parser.parse_args()

    # Optional dotenv load so running via `python` works without shell export
    if not os.environ.get("OPENAI_API_KEY"):
        for env_file in (".env.local", ".env"):
            if os.path.exists(env_file):
                try:
                    with open(env_file, "r", encoding="utf-8") as fh:
                        for raw in fh:
                            line = raw.strip()
                            if not line or line.startswith("#"):
                                continue
                            if "=" not in line:
                                continue
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip('"').strip("'")
                            os.environ.setdefault(k, v)
                except Exception:
                    pass

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        print("ERROR: OPENAI_API_KEY not set", file=sys.stderr)
        return 1
    project = os.environ.get("OPENAI_PROJECT_ID")
    org = os.environ.get("OPENAI_ORG_ID")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    require_better_flag = args.require_better or os.environ.get(
        "OPENAI_REQUIRE_BETTER_TTS", ""
    ).strip().lower() in ("1", "true")
    requested_model = args.model or os.environ.get("OPENAI_TTS_MODEL")
    try:
        primary_model = resolve_model(requested_model, require_better_flag)
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    fallback_model = "gpt-4o-mini-tts"
    # Ensure fallback is different & allowlisted
    if fallback_model not in ALLOWLIST:
        ALLOWLIST.append(fallback_model)

    failures: List[Tuple[str, str, str]] = []  # (lang, voice, error)
    total = 0
    done = 0

    langs = [args.only_lang] if args.only_lang else LANGS
    voice_filter: set[str] | None = None
    if args.voices:
        voice_filter = {v.strip() for v in args.voices.split(",") if v.strip()}
    # Compose worklist
    work: List[Tuple[str, str]] = []
    for lang in langs:
        voices = VOICE_CANDIDATES.get(lang) or VOICE_CANDIDATES["default"]
        for v in voices:
            if voice_filter and v not in voice_filter:
                continue
            work.append((lang, v))
    total = len(work)

    if args.verify:
        print(f"Verifying {total} expected demo clips in {out_dir} ...")
        missing: list[tuple[str, str]] = []
        too_small: list[tuple[str, str, int]] = []
        for lang, voice in work:
            filename = out_dir / f"{lang}_{voice}.mp3"
            if not filename.exists():
                missing.append((lang, voice))
                continue
            size = filename.stat().st_size
            if size < 2048:  # 2KB heuristic for truncated files
                too_small.append((lang, voice, size))
        if missing:
            print("Missing clips:")
            for lang, voice in missing:
                print(f"  - {lang}_{voice}.mp3")
        if too_small:
            print("Suspiciously small clips (<2KB):")
            for lang, voice, size in too_small:
                print(f"  - {lang}_{voice}.mp3 ({size} bytes)")
        if not missing and not too_small:
            print("All clips present and >= 2KB.")
        return 0 if not missing and not too_small else 3

    print(f"Generating {total} demo clips -> {out_dir}")
    for idx, (lang, voice) in enumerate(work, start=1):
        filename = out_dir / f"{lang}_{voice}.mp3"
        sentence = demo_sentence(lang)
        current_model = primary_model
        attempted_fallback = False
        while True:
            try:
                print(
                    f"[{idx}/{total}] {lang}-{voice} ({current_model}) ...",
                    end="",
                    flush=True,
                )
                audio = call_tts(
                    api_key,
                    sentence,
                    voice,
                    model=current_model,
                    speed=0.95,
                    fmt="mp3",
                    project=project,
                    org=org,
                    retries=args.retries,
                    retry_backoff=args.retry_backoff,
                    debug=args.debug,
                )
                filename.write_bytes(audio)
                size_kb = filename.stat().st_size / 1024
                print(f" ok ({size_kb:.1f} KB)")
                done += 1
                break
            except Exception as e:  # noqa: BLE001
                msg = str(e)
                # Attempt model fallback once if not already done and primary failed.
                model_error = any(
                    token in msg.lower()
                    for token in ["model", "not found", "unsupported", "unknown model"]
                )
                if require_better_flag:
                    failures.append((lang, voice, msg))
                    print(" FAIL (strict)")
                    if args.strict:
                        break
                    break
                if (
                    (not attempted_fallback)
                    and current_model != fallback_model
                    and model_error
                ):
                    print(" fallback->", fallback_model, end="", flush=True)
                    current_model = fallback_model
                    attempted_fallback = True
                    continue
                failures.append((lang, voice, msg))
                print(" FAIL")
                if args.strict:
                    break
                break
        time.sleep(args.sleep)

    print()
    print(f"Completed: {done}/{total} clips")
    if failures:
        print("Failures:")
        for lang, voice, msg in failures:
            short = textwrap.shorten(msg, width=140, placeholder="…")
            print(f"  - {lang}-{voice}: {short}")
        # Non-strict returns code 4 to indicate partial generation for CI/automation.
        return 2 if args.strict else 4
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
