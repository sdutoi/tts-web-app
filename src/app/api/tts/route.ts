import { NextRequest } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs"; // ensure Node.js runtime on Vercel

type Lang = "en" | "de" | "fr" | "it" | "es";
type AudioFormat = "mp3" | "ogg";

type TtsBody = {
  text: string;
  lang?: Lang; // 'en' | 'de' | 'fr'
  speed?: number; // 0.5 - 1.25
  format?: AudioFormat; // 'mp3' | 'ogg'
  voice?: string; // optional explicit voice override
};

// Simple in-memory cache per instance
const cache = new Map<string, ArrayBuffer>();

function stableHash(obj: unknown): string {
  const json = JSON.stringify(obj);
  return crypto.createHash("sha256").update(json).digest("hex");
}

// List of currently supported voices (from provider error message) in preferred order.
const SUPPORTED_VOICES = [
  "alloy","echo","fable","onyx","nova","shimmer","coral","verse","ballad","ash","sage","marin","cedar"
];

function defaultVoiceFor(lang: Lang): string {
  switch (lang) {
    case "de":
      return SUPPORTED_VOICES.includes("verse") ? "verse" : "alloy";
    case "fr":
      return SUPPORTED_VOICES.includes("nova") ? "nova" : "alloy";
    case "it":
      return SUPPORTED_VOICES.includes("ballad") ? "ballad" : "alloy";
    case "es":
      return SUPPORTED_VOICES.includes("ash") ? "ash" : "alloy";
    default:
      return "alloy";
  }
}

function sanitizeVoice(v: string | undefined, lang: Lang): { voice: string; fallback: boolean } {
  if (v && SUPPORTED_VOICES.includes(v)) return { voice: v, fallback: false };
  // Attempt language default
  const def = defaultVoiceFor(lang);
  if (SUPPORTED_VOICES.includes(def)) return { voice: def, fallback: true };
  // Ultimate fallback first in list
  return { voice: SUPPORTED_VOICES[0], fallback: true };
}

function mimeFor(format: AudioFormat): string {
  return format === "ogg" ? "audio/ogg" : "audio/mpeg";
}

export async function POST(req: NextRequest) {
  try {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  const openaiProject = process.env.OPENAI_PROJECT_ID?.trim(); // optional, for sk-proj-* keys
  const openaiOrg = process.env.OPENAI_ORG_ID?.trim(); // optional
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Missing OPENAI_API_KEY" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const requestData = (await req.json()) as TtsBody;
    const {
      text,
      lang = "de",
      speed = 0.8,
      format = "mp3",
      voice,
    } = requestData;

    if (!text || typeof text !== "string") {
      return new Response(
        JSON.stringify({ error: "Body must include 'text' string" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

  const { voice: safeVoice, fallback: voiceFallback } = sanitizeVoice(voice, lang);
  const chosenVoice = safeVoice; // canonical variable name
  const key = stableHash({ text, lang, speed, format, voice: chosenVoice });

    const cached = cache.get(key);
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: {
          "Content-Type": mimeFor(format),
          "Content-Disposition": `inline; filename=tts.${format}`,
          "Cache-Control": "no-store",
          "X-Cache": "HIT",
        },
      });
    }

    // Resolve model (parameterized via env). Allowlist to avoid surprises.
    const ALLOWED_TTS_MODELS = [
      'gpt-4o-mini-tts',
      'gpt-4o-audio-preview',
      'gpt-4o-realtime-preview', // if used in future (non-stream mode)
    ];
    const envModel = process.env.OPENAI_TTS_MODEL?.trim();
    const requireBetterTts = /^(1|true)$/i.test((process.env.OPENAI_REQUIRE_BETTER_TTS || '').trim());
    let model = envModel && ALLOWED_TTS_MODELS.includes(envModel) ? envModel : '';
    if (model) {
      if (requireBetterTts && model !== 'gpt-4o-audio-preview') {
        return new Response(JSON.stringify({ error: 'Strict better TTS model required (gpt-4o-audio-preview) but OPENAI_TTS_MODEL is set otherwise.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    } else {
      // prefer the better audio preview model in strict/non-strict
      model = requireBetterTts ? 'gpt-4o-audio-preview' : 'gpt-4o-mini-tts';
    }

    // Call OpenAI TTS
    // Using fetch to avoid SDK dependency; adjust endpoint if OpenAI changes.
    const openaiUrl = "https://api.openai.com/v1/audio/speech";
    const payload = {
      model,
      input: text,
      voice: chosenVoice,
      format,
      speed,
    } as Record<string, unknown>;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: mimeFor(format),
    };
    if (openaiProject) headers["OpenAI-Project"] = openaiProject;
    if (openaiOrg) headers["OpenAI-Organization"] = openaiOrg;

    // Safe debug: log presence of headers without leaking secrets
    console.info("TTS headers", {
      hasKey: apiKey.startsWith("sk-"),
      project: Boolean(openaiProject),
      org: Boolean(openaiOrg),
    });

    async function callWithRetry(attempts = 3): Promise<Response> {
      let lastErr: unknown = null;
      for (let i = 1; i <= attempts; i++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000); // 30s timeout
        try {
          const resp = await fetch(openaiUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (resp.ok) return resp;
          // Retry on 429 and 5xx
          if (resp.status === 429 || (resp.status >= 500 && resp.status <= 599)) {
            const errText = await resp.text().catch(() => "");
            console.warn(`OpenAI TTS retryable status ${resp.status} (attempt ${i}/${attempts})`, errText.slice(0, 200));
          } else {
            return resp; // non-retryable status, return immediately
          }
        } catch (e) {
          lastErr = e;
          console.warn(`OpenAI TTS network error (attempt ${i}/${attempts})`, e instanceof Error ? e.message : String(e));
        } finally {
          clearTimeout(timer);
        }
        // backoff with jitter
        const backoffMs = Math.min(1000 * 2 ** (i - 1), 4000) + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
      if (lastErr) throw lastErr;
      // Fallback unreachable
      throw new Error("OpenAI TTS failed after retries");
    }

  const resp = await callWithRetry(3);

    if (!resp.ok) {
      const raw = await resp.text();
      const sanitize = (s: string) => s
        .replaceAll(apiKey, "[REDACTED]")
        .replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[REDACTED]");
  let upstream: unknown = null;
  try { upstream = JSON.parse(raw); } catch { upstream = { message: raw.slice(0, 400) }; }
      console.error("OpenAI TTS error", resp.status, sanitize(raw));

      const isAuth = resp.status === 401 || resp.status === 403;
      // If endpoint not available (404/invalid URL), try Responses API with audio modality as a fallback path
      const maybeInvalidUrl = resp.status === 404 || (typeof upstream === 'object' && upstream !== null && (() => {
        const err = (upstream as { error?: { message?: string } }).error;
        const msg = err?.message || '';
        return typeof msg === 'string' && msg.toLowerCase().includes('invalid url');
      })());
      if (maybeInvalidUrl) {
        try {
          const responsesHeaders: Record<string,string> = { ...headers };
          delete responsesHeaders['Accept'];
          const responsesPayload: { model: string; input: string; modalities: string[]; audio: { voice: string; format: string } } = {
            model: model,
            input: text,
            modalities: ['text','audio'],
            audio: { voice: chosenVoice, format },
          };
          const r2 = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: responsesHeaders, body: JSON.stringify(responsesPayload) });
          if (r2.ok) {
            const j: unknown = await r2.json();
            // Attempt to locate base64 audio in output structure
            let b64: string | null = null;
            const jObj = (j && typeof j === 'object') ? j as Record<string, unknown> : {};
            const outputs = (jObj['output'] ?? jObj['outputs'] ?? jObj['data']) as unknown;
            const arr = Array.isArray(outputs) ? outputs : [] as unknown[];
            outer: for (const item of arr) {
              const content = (item && typeof item === 'object') ? (item as Record<string, unknown>)['content'] : undefined;
              if (Array.isArray(content)) {
                for (const part of content) {
                  if (part && typeof part === 'object') {
                    const audioObj = (part as Record<string, unknown>)['audio'] ?? (part as Record<string, unknown>)['output_audio'];
                    const data = (audioObj && typeof audioObj === 'object') ? (audioObj as Record<string, unknown>)['data'] : undefined;
                    if (typeof data === 'string' && data.length > 0) { b64 = data; break outer; }
                  }
                }
              }
            }
            if (b64) {
              const buf = Buffer.from(b64, 'base64');
              const arrBuf: ArrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
              cache.set(key, arrBuf);
              return new Response(arrBuf, {
                status: 200,
                headers: {
                  "Content-Type": mimeFor(format),
                  "Content-Disposition": `inline; filename=tts.${format}`,
                  "Cache-Control": "no-store",
                  "X-Cache": "MISS",
                  "X-Voice-Selected": chosenVoice,
                  ...(voiceFallback ? { "X-Voice-Fallback": "1" } : {}),
                  "X-TTS-Model": model,
                  ...(requireBetterTts ? { 'X-Strict-Better-TTS': '1' } : {}),
                  "X-TTS-Path": "responses",
                },
              });
            }
          } else {
            const t2 = await r2.text().catch(()=>"");
            console.warn('Responses API TTS fallback failed', r2.status, t2.slice(0,200));
          }
        } catch (e) {
          console.warn('Responses API TTS fallback error', e instanceof Error ? e.message : String(e));
        }
      }
      let providerMessage: string | null = null;
      if (upstream && typeof upstream === "object") {
        const u = upstream as { error?: { message?: string }; message?: string };
        providerMessage = u.error?.message || u.message || null;
      }
      const clientPayload = {
        error: isAuth ? "Authentication/authorization failed" : "TTS provider error",
        providerStatus: resp.status,
        providerMessage,
      };
      return new Response(JSON.stringify(clientPayload), { status: isAuth ? 401 : 502, headers: { "Content-Type": "application/json" } });
    }

    const arrayBuf = await resp.arrayBuffer();
    cache.set(key, arrayBuf);
    return new Response(arrayBuf, {
      status: 200,
      headers: {
        "Content-Type": mimeFor(format),
        "Content-Disposition": `inline; filename=tts.${format}`,
        "Cache-Control": "no-store",
        "X-Cache": "MISS",
        "X-Voice-Selected": chosenVoice,
        ...(voiceFallback ? { "X-Voice-Fallback": "1" } : {}),
        "X-TTS-Model": model,
        ...(requireBetterTts ? { 'X-Strict-Better-TTS': '1' } : {}),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
