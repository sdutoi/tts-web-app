## Language TTS & Dialogue Builder (EN/DE/FR/IT/ES) – Next.js App

This app lets you practice multiple languages (English, French, German, Italian, Spanish) with a streamlined flow:
- Minimal landing page: click a language → you go straight to the dialogue builder (no sample sentence or feature marketing screen).
- TTS (gpt-4o-mini-tts) playback with voice fallback and caching.
- Dual-voice dialogue playback: pick two distinct voices (A / B) per language; client caches audio to avoid repeat API calls.
- Random scenario vocabulary sampling: each scenario shows 5 randomly sampled items (from up to 20 that match or are near the chosen CEFR level) to keep sessions varied.
- Custom words panel: add any words/phrases (any language) that you want encouraged in the generated dialogue.
- Disabled scenarios: "Doctor Visit & Health Admin" and "Climate & Sustainability Action" intentionally omitted from the selector to reduce clutter.
- Full dialogue audio export (WAV recommended) with configurable inter-turn silence.

## Prerequisites

- Node.js 18+ (Node 20 recommended)
- An OpenAI API key with access to TTS

### Model Configuration (Env Overrides)

You can switch to higher quality or alternate models without code changes using environment variables:

```
OPENAI_TEXT_MODEL=gpt-4.1-mini        # used by dialogue + story routes (default fallback if unset)
OPENAI_TTS_MODEL=gpt-4o-audio-preview # used by /api/tts (defaults to gpt-4o-mini-tts if unset or invalid)
```

Allowlisted text models: `gpt-4.1-mini`, `gpt-4.1`, `gpt-4o`, `gpt-4o-mini`.
Allowlisted TTS models: `gpt-4o-mini-tts`, `gpt-4o-audio-preview`, `gpt-4o-realtime-preview` (non-stream usage).

Responses include headers for observability:
- `X-Text-Model` on dialogue/story endpoints
- `X-TTS-Model` on TTS endpoint

If an env var is set to a non-allowlisted value the route silently falls back to the default safe model.

## Setup

1. Copy the env example and set your key:

  - cp .env.local.example .env.local
  - Edit .env.local and set OPENAI_API_KEY=...
  - If your key starts with `sk-proj-` (project-scoped), optionally set `OPENAI_PROJECT_ID` (and `OPENAI_ORG_ID` if applicable).

2. Install dependencies:

	- npm install

3. Run the dev server:

	- npm run dev

Open http://localhost:3000 to use the UI.

## How it works (Overview)

- Landing (`src/app/page.tsx`): Animated gradient + language grid (EN / DE / FR / IT / ES). Selecting a language navigates directly to `/dialogue?lang=xx`.
- Dialogue Builder (`src/app/dialogue/page.tsx`): Choose level, scenario, sample vocab (5 items, re-shuffle keeps selections), add custom words, generate / refine dialogue, preview & assign two voices, export full audio.
- TTS API: `src/app/api/tts/route.ts` handles per-turn synthesis with caching and voice fallback.

## Deploy

Vercel is recommended. Be sure to set the `OPENAI_API_KEY` environment variable in your Vercel project settings. The API route is configured to run on the Node.js runtime.

## Troubleshooting

- 401 invalid_api_key: Ensure your key is typed correctly and active. If you’re using a project-scoped key (`sk-proj-...`), try also setting `OPENAI_PROJECT_ID` and/or `OPENAI_ORG_ID`. Re-start `npm run dev` after changing env vars.
 - If a key works in an external script but not in the app: use `/api/diag` and `/api/ping` plus `node scripts/checkKey.mjs` to compare. Look for hidden CR characters or truncation (diag shows hex). Try a freshly generated standard key; if that succeeds while the project key fails with 401, regenerate the project key or omit extra headers.

### Voices
Supported voices (provider list): `alloy, echo, fable, onyx, nova, shimmer, coral, verse, ballad, ash, sage, marin, cedar`.

Language defaults:
- EN → alloy
- DE → verse (fallback alloy)
- FR → nova (fallback alloy)
- IT → ballad (fallback alloy)
- ES → ash (fallback alloy)

Any unsupported requested voice automatically falls back; response headers include `X-Voice-Selected` and `X-Voice-Fallback` when applied. Update `SUPPORTED_VOICES` in `src/app/api/tts/route.ts` if the provider list changes.

### Dialogue Builder (Random Sampling, Custom Words, Export)
- Per load, 5 vocab items are randomly chosen from a level-targeted pool (max 20). Refreshing or changing scenario re-samples.
- You can add your own free-form words; these are encouraged in generation but have no internal IDs.
- Removed scenarios: Doctor Visit & Health Admin, Climate & Sustainability Action (still in data file but filtered out).
- Export: choose WAV (adds silence reliably), MP3, or OGG. WAV path decodes + stitches segments with your selected gap (0–3s, default 0.50s).

#### Custom Words Adaptation / Translation
When you supply custom words or phrases (even if they are in another language), the system prompt now enforces that they are ADAPTED into the dialogue's target language. Examples:
- Target language = French; you enter German "Freund" → dialogue may include "ami" / "un ami proche" rather than leaving "Freund" untranslated.
- Target language = Spanish; you enter English "to book" → dialogue might use "reservar" or an appropriately conjugated form.

Rules:
1. Proper nouns (Berlin, Netflix) are kept as-is.
2. International loanwords may remain if natural.
3. Otherwise, foreign-language fragments are translated or morphologically adapted; no raw code-switching appears.
4. Style / tone descriptors and extra instructions are likewise interpreted in the target language.

If you observe untranslated fragments that are not proper nouns, regenerate— the strengthened prompt usually corrects this.

### Dialogue TTS Dual Voices: Post-Generation Demo & Selection
- Voice picker appears only AFTER a dialogue is generated (simpler initial UI).
- Preview up to 5 candidate voices for the language; each plays a localized sample sentence (e.g., "Veux-tu apprendre le français avec moi ?").
- Assign two distinct voices as Speaker A / B (swap logic prevents duplicates).
- Candidate list per language: `VOICE_CANDIDATES` in `src/app/dialogue/page.tsx`.
- Turn playback audio cached in-memory by `{ text, lang, speed, format, voice }`.
- WAV export inserts configurable silence (default 0.50s) between turns; MP3 concat is best-effort and may compress gaps.
- Keep candidate list small (~5) for responsiveness; consider pagination if expanding.

### Static Voice Demo Clips (Optional Optimization)

To avoid a TTS API call every time a user clicks a voice Demo button, you can pre-generate short demo clips for each (language, voice) pair and serve them statically from `public/demos`.

Script: `scripts/generate_voice_demos.py`

What it does:
- Iterates languages (EN / DE / FR / IT / ES plus provisional RU / JA / PT / NL) and their `VOICE_CANDIDATES` (mirrors `src/app/dialogue/page.tsx`—UI may not yet expose new languages; demos can still be prepared ahead of UI support).
- Generates a localized short sentence based on a unified pattern: "Hello, do you want to learn {LanguageName} with me? Let's go!" translated/adapted per language (e.g., DE: "Hallo, willst du Deutsch mit mir lernen? Los geht's!").
- Saves `public/demos/{lang}_{voice}.mp3`.
- Skips existing files unless you pass `--force`.

Run:

```
export OPENAI_API_KEY=sk-...   # plus OPENAI_PROJECT_ID / OPENAI_ORG_ID if needed
python scripts/generate_voice_demos.py
```

Options:
- `--only-lang de` – limit to a single language
- `--voices ash,echo` – restrict to a subset of voices after language filtering
- `--force` – overwrite existing clips
- `--strict` – abort on first failure (otherwise partial failures return exit code 4)
- `--sleep 1.0` – base delay between successful calls (default 0.75s)
- `--retries 4` – number of retries for retriable errors (total attempts = retries + 1)
- `--retry-backoff 1.8` – exponential backoff factor (sleep = factor^(attempt-1) + jitter)
- `--verify` – just check presence & size (>=2KB) of expected clips, no generation; returns code 3 if any are missing/too small
- `--model gpt-4o-audio-preview` – optional explicit model; auto-falls back to `gpt-4o-mini-tts` on model errors
- `--debug` – verbose HTTP error snippets for troubleshooting (helpful if all clips are failing quickly)

Typical partial-regeneration after a single failure (e.g., en-echo):
```
python scripts/generate_voice_demos.py --only-lang en --voices echo --force --retries 4 --retry-backoff 1.8
```

CI / automation suggestion:
1. `python scripts/generate_voice_demos.py --verify` (fast check) ➜ if exit code 3 then
2. `python scripts/generate_voice_demos.py --force` (or selective) ➜ build ➜ commit.

Frontend behavior:
1. When you click Demo for a voice, the client first issues a `HEAD` request to `/demos/{lang}_{voice}.mp3`.
2. If it exists, it plays that static asset.
3. If not, it falls back to the dynamic `/api/tts` call and caches the object URL in-memory.

Repository considerations:
- Keep sentences short to minimize file size (each clip should be only a few KB).
- If repository bloat becomes a concern, you can host them on object storage/CDN instead.
- Re-run the script whenever you change the sentence template or add voices.

If you add or remove voices, update both:
1. `VOICE_CANDIDATES` in `src/app/dialogue/page.tsx`
2. The dictionary in `scripts/generate_voice_demos.py`

Scenario data note: The "Coworking & Startup" scenario was removed from all vocab files to reduce scope. Run `node scripts/validateVocab.mjs` after any manual data edits to ensure schema integrity.

Failure Handling:
- The script logs any failed (lang, voice) pairs at the end. Non-strict mode continues.
- Use `--strict` in CI to enforce completeness.

## Proficiency (CEFR) Quick Selector Overlay

When a user lands on the dialogue builder without explicitly specifying a `level` query param, an overlay now appears prompting them to pick their comfort level (A1–C1). The user:

1. Reads 5 sample sentences (static per language for now) from easiest (A1) to harder (C1).
2. Clicks the highest level where they still feel comfortable.
3. Clicks "Confirm Level" (or skips, retaining the default A2).

After confirmation the selection updates the internal `level` state used for dialogue generation and the overlay disappears (it will not reappear unless the page is reloaded without a `level` query parameter AND no selection has been stored in state yet).

Implementation details:
- Component: `src/app/components/ProficiencySelector.tsx`
- Integrated in `src/app/dialogue/page.tsx` just inside the main wrapper.
- Omitted C2 from the initial comfort prompt to reduce decision friction; C2 remains selectable in the level dropdown afterwards if needed.
- Sentences are currently static; they can be replaced later by sampling examples from vocab data or an API.

To bypass the overlay (e.g., deep link): append `?lang=de&level=B1` to `/dialogue`.
