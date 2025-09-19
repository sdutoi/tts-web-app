import { NextRequest } from "next/server";

export const runtime = "nodejs";

type Lang = "en" | "de" | "fr";
type Level = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

type StoryBody = {
  action?: "generate" | "refine";
  lang: Lang;
  level: Level;
  interests?: string;
  sentence?: string;
  style?: string;
  wordCount?: number; // target words, default ~120
  story?: string; // required for refine
};

function redact(s: string, key: string) {
  return s.replaceAll(key, "[REDACTED]").replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[REDACTED]");
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown = null;
  for (let i = 1; i <= attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const resp = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (resp.ok) return resp;
      if (resp.status === 429 || (resp.status >= 500 && resp.status <= 599)) {
        const t = await resp.text().catch(() => "");
        console.warn(`Story API retry ${i}/${attempts}`, resp.status, t.slice(0, 200));
      } else {
        return resp;
      }
    } catch (e) {
      lastErr = e;
      console.warn(`Story API network error ${i}/${attempts}`, e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
    const backoff = Math.min(1000 * 2 ** (i - 1), 4000) + Math.floor(Math.random() * 200);
    await new Promise((r) => setTimeout(r, backoff));
  }
  if (lastErr) throw lastErr;
  throw new Error("Story API failed after retries");
}

export async function POST(req: NextRequest) {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  const project = process.env.OPENAI_PROJECT_ID?.trim();
  const org = process.env.OPENAI_ORG_ID?.trim();

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: StoryBody;
  try {
    body = (await req.json()) as StoryBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { lang, level, interests = "", sentence = "", style = "", wordCount = 120, story = "", action = "generate" } = body;
  if (!lang || !level) {
    return new Response(JSON.stringify({ error: "Missing required fields: lang, level" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sys = `You are a helpful language teacher creating short mini-stories for learners. 
- Target CEFR level: ${level}.
- Target language: ${lang}.
- Length: around ${wordCount} words.
- Include a concise title in the target language.
- Keep grammar and vocabulary suitable for the level.
- If a user sample sentence is provided, incorporate its vocabulary or theme.
- After the story, provide a vocabulary list (5-10 items) with English meanings.
- Output strict JSON with keys: title (string), story (string), vocab (array of { word: string, meaning_en: string }).`;

  const userParts: string[] = [];
  if (action === "refine" && story) {
    userParts.push("Please revise the following story while keeping level and constraints:");
    userParts.push(story);
  } else {
    userParts.push("Generate a new mini-story.");
  }
  if (interests) userParts.push(`Interests/themes: ${interests}`);
  if (sentence) userParts.push(`Learner sentence: ${sentence}`);
  if (style) userParts.push(`Style/tone: ${style}`);

  const messages = [
    { role: "system", content: sys },
    { role: "user", content: userParts.join("\n\n") },
  ];

  const url = "https://api.openai.com/v1/chat/completions";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (project) headers["OpenAI-Project"] = project;
  if (org) headers["OpenAI-Organization"] = org;

  const payload = {
    model: "gpt-4o-mini",
    messages,
    temperature: 0.7,
    response_format: { type: "json_object" },
  } as const;

  const resp = await fetchWithRetry(url, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!resp.ok) {
    const text = await resp.text();
    console.error("Story API error", resp.status, redact(text, apiKey));
    return new Response(JSON.stringify({ error: "Story provider error", status: resp.status }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const data = await resp.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  if (!content) {
    return new Response(JSON.stringify({ error: "Empty response from model" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Try to parse JSON content
  try {
    const parsed = JSON.parse(content);
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    // If model returned plain text, wrap it
    return new Response(
      JSON.stringify({ title: "Mini Story", story: content, vocab: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}
