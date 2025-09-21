import { NextRequest } from "next/server";

export const runtime = "nodejs";

type Level = "A1"|"A2"|"B1"|"B2"|"C1"|"C2";

interface DialogueBody {
  lang: string;              // target language (e.g., en, fr)
  level: Level;              // CEFR target level
  scenarioId?: string;       // scenario / category id (optional, helps context)
  itemIds: string[];         // vocab item IDs to incorporate
  turns?: number;            // desired number of dialogue turns (speaker exchanges)
  style?: string;            // optional style (friendly, formal, tense, etc.)
  instructions?: string;     // extra user guidance
  action?: "generate" | "refine"; // refine allows sending previous dialogue
  previousDialogue?: DialogueResponse; // required if action=refine
}

interface DialogueTurn {
  speaker: string;          // e.g., A / B or names
  text: string;             // target language text
  vocabRefs: string[];      // subset of itemIds used in this turn
  translation_en?: string;  // optional English gloss (could be toggled in UI)
}

interface DialogueResponse {
  scenario: string;
  level: Level;
  turns: DialogueTurn[];
  usedItems: string[];      // all item IDs actually used
  notes?: string;           // pedagogy / strategy notes
}

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
        console.warn(`Dialogue API retry ${i}/${attempts}`, resp.status, t.slice(0, 200));
      } else {
        return resp;
      }
    } catch (e) {
      lastErr = e;
      console.warn(`Dialogue API network error ${i}/${attempts}`, e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
    const backoff = Math.min(1000 * 2 ** (i - 1), 4000) + Math.floor(Math.random() * 200);
    await new Promise(r => setTimeout(r, backoff));
  }
  if (lastErr) throw lastErr;
  throw new Error("Dialogue API failed after retries");
}

export async function POST(req: NextRequest) {
  const rawKey = process.env.OPENAI_API_KEY || "";
  const apiKey = rawKey.trim();
  const project = process.env.OPENAI_PROJECT_ID?.trim();
  const org = process.env.OPENAI_ORG_ID?.trim();
  const keyFingerprint = apiKey ? `${apiKey.slice(0,4)}...${apiKey.slice(-4)}` : 'NONE';
  console.log('[dialogue] env check', { keyPresent: !!apiKey, keyLength: apiKey.length, keyFingerprint, projectPresent: !!project, orgPresent: !!org });
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  let body: DialogueBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const { lang, level, scenarioId = "generic", itemIds, turns = 8, style = "", instructions = "", action = "generate", previousDialogue } = body;
  if (!lang || !level || !Array.isArray(itemIds) || itemIds.length === 0) {
    return new Response(JSON.stringify({ error: "Missing required fields: lang, level, itemIds[]" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (action === "refine" && !previousDialogue) {
    return new Response(JSON.stringify({ error: "previousDialogue required for refine" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // System prompt: define JSON output contract
  const sys = `You are a helpful language teaching assistant generating short pedagogically-focused dialogues.
Requirements:
- Target language: ${lang}
- CEFR level: ${level}
- Use ONLY the provided vocabulary item IDs when referencing them; do not invent new IDs.
- Output strict JSON matching this TypeScript interface:
  interface DialogueResponse { scenario: string; level: string; turns: { speaker: string; text: string; vocabRefs: string[]; translation_en?: string; }[]; usedItems: string[]; notes?: string; }
- Each turn must list the subset of item IDs used in that turn in vocabRefs (empty array if none).
- Keep dialogue natural, coherent, and level-appropriate.
- Sprinkle items across turns (avoid front-loading all items).
- Provide 6-${Math.max(6, Math.min(18, turns))} turns unless user asked otherwise.
- If style provided, reflect it subtly (not exaggerated).
- Provide concise notes highlighting teaching focus (max 160 chars).
- Do not include any explanation outside the JSON.`;

  const userParts: string[] = [];
  if (action === "refine" && previousDialogue) {
    userParts.push("Refine the following dialogue while keeping IDs and improving clarity if needed. Maintain same or fewer difficulty level.");
    userParts.push(JSON.stringify(previousDialogue));
  } else {
    userParts.push("Generate a new dialogue.");
  }
  userParts.push(`Scenario id: ${scenarioId}`);
  userParts.push(`Target number of turns: ${turns}`);
  if (style) userParts.push(`Desired style: ${style}`);
  if (instructions) userParts.push(`Extra instructions: ${instructions}`);
  userParts.push("Vocab item IDs (must distribute them naturally):\n" + itemIds.join(", "));

  const messages = [
    { role: "system", content: sys },
    { role: "user", content: userParts.join("\n\n") }
  ];

  const url = "https://api.openai.com/v1/chat/completions";
  const headers: Record<string,string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  if (project) headers["OpenAI-Project"] = project;
  if (org) headers["OpenAI-Organization"] = org;

  const payload = {
    model: "gpt-4o-mini",
    messages,
    temperature: 0.65,
    response_format: { type: "json_object" }
  } as const;

  let resp: Response;
  let altStatus: number | null = null;
  try {
    resp = await fetchWithRetry(url, { method: "POST", headers, body: JSON.stringify(payload) });
  } catch {
    return new Response(JSON.stringify({ error: "Upstream request failed" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
  if (!resp.ok && (resp.status === 401 || resp.status === 405) && project) {
    const headersNoProject = { ...headers };
    delete headersNoProject['OpenAI-Project'];
    const alt = await fetch(url, { method: 'POST', headers: headersNoProject, body: JSON.stringify(payload) });
    altStatus = alt.status;
    if (alt.ok) {
      resp = alt;
    }
  }
  // If still 401 invalid_api_key, attempt Responses API as a differential test
  if (!resp.ok && resp.status === 401) {
    try {
      const r2 = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers, body: JSON.stringify({ model: "gpt-4o-mini", input: "diag dialogue fallback" }) });
      const t2 = await r2.text();
      return new Response(JSON.stringify({ error: "Dialogue provider error", status: resp.status, responsesStatus: r2.status, responsesBody: t2.slice(0,200) }), { status: 502, headers: { "Content-Type": "application/json" } });
    } catch {
      // ignore and fall through
    }
  }
  if (!resp.ok) {
    const text = await resp.text();
    console.error("Dialogue API error", resp.status, redact(text, apiKey));
    return new Response(JSON.stringify({ error: "Dialogue provider error", status: resp.status, altStatus }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
  const data = await resp.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  if (!content) {
    return new Response(JSON.stringify({ error: "Empty response from model" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }

  try {
    const parsed = JSON.parse(content) as DialogueResponse;
    // Lightweight validation of required keys
    if (!parsed.turns || !Array.isArray(parsed.turns)) throw new Error("turns missing");
    return new Response(JSON.stringify(parsed), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch {
    // Fallback: wrap raw text (not ideal, but prevents total failure)
    return new Response(JSON.stringify({ scenario: scenarioId, level, turns: [], usedItems: [], notes: "Model returned non-JSON" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
}
