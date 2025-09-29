import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

interface TranslateBody {
  uiLang: 'en' | 'de';
  targetUiName?: string; // optional display name override (e.g., German)
  dialogue: {
    scenario: string;
    level: string;
    turns: { speaker: string; text: string }[];
  };
}

interface TranslatedTurn { speaker: string; original: string; translation: string; notes?: string }
interface TranslateResponse { lang: 'en'|'de'; turns: TranslatedTurn[] }

function redact(s: string, key: string) {
  return s.replaceAll(key, '[REDACTED]').replace(/sk-[a-zA-Z0-9_-]{10,}/g, '[REDACTED]');
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
        const t = await resp.text().catch(() => '');
        console.warn(`Translate API retry ${i}/${attempts}`, resp.status, t.slice(0, 200));
      } else {
        return resp;
      }
    } catch (e) {
      lastErr = e;
      console.warn(`Translate API network error ${i}/${attempts}`, e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
    const backoff = Math.min(1000 * 2 ** (i - 1), 4000) + Math.floor(Math.random() * 200);
    await new Promise(r => setTimeout(r, backoff));
  }
  if (lastErr) throw lastErr;
  throw new Error('Translate API failed after retries');
}

// Cache a small preferred model name like dialogue route
let CACHED_TEXT_MODEL: string | null = null;
const ALLOWED_TEXT_MODELS = ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'] as const;

async function resolveTextModel(headers: Record<string,string>): Promise<string> {
  if (CACHED_TEXT_MODEL) return CACHED_TEXT_MODEL;
  const envTextModel = process.env.OPENAI_TEXT_MODEL?.trim();
  if (envTextModel && (ALLOWED_TEXT_MODELS as readonly string[]).includes(envTextModel)) {
    CACHED_TEXT_MODEL = envTextModel;
    return envTextModel;
  }
  // prefer 4o/4.1 if available
  const url = 'https://api.openai.com/v1/chat/completions';
  for (const m of ['gpt-4o','gpt-4.1']) {
    try {
      const r = await fetchWithRetry(url, { method:'POST', headers, body: JSON.stringify({ model: m, messages: [{ role:'user', content:'ok'}], max_tokens: 1 }) }, 1);
      if (r.ok) { CACHED_TEXT_MODEL = m; return m; }
    } catch { /* try next */ }
  }
  CACHED_TEXT_MODEL = 'gpt-4.1-mini';
  return CACHED_TEXT_MODEL;
}

export async function POST(req: NextRequest) {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  const project = process.env.OPENAI_PROJECT_ID?.trim();
  const org = process.env.OPENAI_ORG_ID?.trim();
  if (!apiKey) return new Response(JSON.stringify({ error: 'Missing OPENAI_API_KEY' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let body: TranslateBody;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
  const { uiLang, targetUiName, dialogue } = body;
  if (!uiLang || !dialogue || !Array.isArray(dialogue.turns)) {
    return new Response(JSON.stringify({ error: 'Missing fields uiLang or dialogue.turns' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const langName = targetUiName || (uiLang === 'de' ? 'German' : 'English');
  const sys = `You are a careful translator for language learners.
Translate each turn of a dialogue into ${langName}.
Output ONLY JSON with this exact shape and nothing else:
interface Out { turns: { speaker: string; original: string; translation: string; notes?: string }[] }
Rules:
- Be faithful and natural; keep meaning, tone, and register.
- Keep the original line intact in 'original'.
- In 'notes', add very brief gloss if a phrase is idiomatic or tricky (<= 16 words). Skip notes when unnecessary.
- Do not add commentary outside JSON.
`;

  const user = {
    role: 'user',
    content: JSON.stringify({ turns: dialogue.turns.map(t => ({ speaker: t.speaker || '', original: t.text })) })
  } as const;

  const headers: Record<string,string> = { Authorization: `Bearer ${apiKey}`, 'Content-Type':'application/json' };
  if (project) headers['OpenAI-Project'] = project;
  if (org) headers['OpenAI-Organization'] = org;
  const model = await resolveTextModel(headers);
  const payload = { model, messages: [{ role:'system', content: sys }, user], response_format: { type: 'json_object' }, temperature: 0.2 } as const;

  try {
    const resp = await fetchWithRetry('https://api.openai.com/v1/chat/completions', { method:'POST', headers, body: JSON.stringify(payload) });
    if (!resp.ok) {
      const txt = await resp.text();
      console.error('Translate provider error', resp.status, redact(txt, apiKey));
      return new Response(JSON.stringify({ error: 'Translate provider error', status: resp.status }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(content);
    const result: TranslateResponse = { lang: uiLang, turns: parsed.turns };
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
