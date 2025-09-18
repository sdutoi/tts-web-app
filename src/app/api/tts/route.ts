import { NextRequest } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs"; // ensure Node.js runtime on Vercel

type Lang = "en" | "de" | "fr";
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

function voiceFor(lang: Lang): string {
  // Map to reasonable OpenAI voices; users can override with `voice`.
  switch (lang) {
    case "de":
      return "verse"; // example German-capable voice
    case "fr":
      return "aria"; // example French-capable voice
    default:
      return "alloy"; // English default
  }
}

function mimeFor(format: AudioFormat): string {
  return format === "ogg" ? "audio/ogg" : "audio/mpeg";
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
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

    const chosenVoice = voice ?? voiceFor(lang);
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

    // Call OpenAI TTS
    // Using fetch to avoid SDK dependency; adjust endpoint if OpenAI changes.
    const openaiUrl = "https://api.openai.com/v1/audio/speech";
    const payload = {
      model: "gpt-4o-mini-tts",
      input: text,
      voice: chosenVoice,
      format,
      // Some SDKs expose 'speed' directly; if not, we return normal speed and let client adjust playbackRate.
      // Include speed as a hint for future models; ignored by current API if unsupported.
      speed,
    } as Record<string, unknown>;

    const resp = await fetch(openaiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(
        JSON.stringify({ error: "OpenAI TTS failed", status: resp.status, body: errText }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
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
