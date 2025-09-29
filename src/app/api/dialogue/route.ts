import { NextRequest } from "next/server";

export const runtime = "nodejs";

type Level = "A1"|"A2"|"B1"|"B2"|"C1"|"C2";

interface DialogueBody {
  lang: string;              // target language (e.g., en, fr)
  level: Level;              // CEFR target level
  scenarioId?: string;       // scenario / category id (optional, helps context)
  itemIds: string[];         // vocab item IDs to incorporate
  customWords?: string[];    // free-form user-supplied words/phrases (may not have IDs)
  turns?: number;            // desired number of dialogue turns (speaker exchanges)
  style?: string;            // optional style (friendly, formal, tense, etc.)
  instructions?: string;     // extra user guidance
  action?: "generate" | "refine"; // refine allows sending previous dialogue
  previousDialogue?: DialogueResponse; // required if action=refine
  temperature?: number;      // optional creativity control (0-1.5). If absent, server default applies.
  top_p?: number;            // optional nucleus sampling parameter (0-1). If absent, server default applies.
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

// Map language codes to display names for clearer prompts
const LANGUAGE_NAMES: Record<string,string> = {
  en: "English",
  fr: "French",
  de: "German",
  it: "Italian",
  es: "Spanish",
};

// Very lightweight bag-of-words heuristic language detector across supported set
function detectLangHeuristic(text: string): string | null {
  const samples = text.toLowerCase();
  const markers: Record<string,string[]> = {
    en: ["the ","and ","you ","with","have","are"],
    fr: [" le "," la "," les "," est "," avec "," pour "," je "," tu "],
    de: [" der "," die "," und "," ist "," mit "," ich "," nicht"],
    it: [" il "," lo "," la "," che "," per "," con "," sono "," vuoi "," grazie"],
    es: [" el "," la "," los "," las "," con "," para "," eres "," quiero"],
  };
  const scores: Record<string, number> = {};
  for (const [lang, words] of Object.entries(markers)) {
    scores[lang] = 0;
    for (const w of words) {
      const count = samples.split(w).length - 1;
      scores[lang] += count;
    }
  }
  // Pick highest non-zero score
  let best: string | null = null;
  let bestScore = 0;
  for (const [lang, sc] of Object.entries(scores)) {
    if (sc > bestScore) { best = lang; bestScore = sc; }
  }
  if (bestScore === 0) return null;
  return best;
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

// Cache the resolved text model for this process to avoid repeated probes
let CACHED_TEXT_MODEL: string | null = null;

const ALLOWED_TEXT_MODELS = [
  'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'
];

async function resolveTextModel(headers: Record<string,string>, opts?: { strict?: boolean }): Promise<string> {
  const strict = !!opts?.strict;
  // 1) Explicit env override if allowed
  const envTextModel = process.env.OPENAI_TEXT_MODEL?.trim();
  if (envTextModel && ALLOWED_TEXT_MODELS.includes(envTextModel)) {
    if (strict && !['gpt-4o','gpt-4.1'].includes(envTextModel)) {
      // Strict requires one of the better models only
      throw new Error("Strict better-model required (gpt-4o or gpt-4.1), but OPENAI_TEXT_MODEL is set to a different model.");
    }
    CACHED_TEXT_MODEL = envTextModel;
    return envTextModel;
  }
  // 2) Cached choice
  if (CACHED_TEXT_MODEL) return CACHED_TEXT_MODEL;
  const url = "https://api.openai.com/v1/chat/completions";
  // 3) Probe preferred order: 4o, then 4.1; (mini variants are safe default)
  const candidates = ['gpt-4o', 'gpt-4.1'] as const;
  for (const model of candidates) {
    try {
      const probePayload = { model, messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 } as const;
      const r = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(probePayload) }, 1);
      if (r.ok) {
        CACHED_TEXT_MODEL = model;
        return model;
      }
    } catch {/* ignore and try next */}
  }
  // 4) If strict, do not fallback
  if (strict) {
    throw new Error('Strict better-model required, but neither gpt-4o nor gpt-4.1 are available.');
  }
  // Otherwise fallback default
  CACHED_TEXT_MODEL = 'gpt-4.1-mini';
  return CACHED_TEXT_MODEL;
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

  const { lang, level, scenarioId = "generic", itemIds, customWords = [], turns = 8, style = "", instructions = "", action = "generate", previousDialogue } = body;
  if (!lang || !level || (!Array.isArray(itemIds))) {
    return new Response(JSON.stringify({ error: "Missing required fields: lang, level, itemIds[]" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (itemIds.length === 0 && customWords.length === 0) {
    return new Response(JSON.stringify({ error: "Provide at least one vocabulary item or a custom word." }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (action === "refine" && !previousDialogue) {
    return new Response(JSON.stringify({ error: "previousDialogue required for refine" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // System prompt: define JSON output contract
  const langName = LANGUAGE_NAMES[lang] || lang;
  const sys = `You are a helpful language teaching assistant generating short pedagogically-focused dialogues.
Requirements (STRICT):
- ABSOLUTE TARGET LANGUAGE FOR *ALL* dialogue text (except optional English gloss field): ${lang} (${langName})
- CEFR level: ${level}
- Use ONLY the provided vocabulary item IDs when referencing them; do not invent new IDs.
- Output strict JSON matching this TypeScript interface (and NOTHING else):
  interface DialogueResponse { scenario: string; level: string; turns: { speaker: string; text: string; vocabRefs: string[]; translation_en?: string; }[]; usedItems: string[]; notes?: string; }
- Each turn must list the subset of item IDs used in that turn in vocabRefs (empty array if none).
- Keep dialogue natural, coherent, and level-appropriate.
- Distribute vocab items across turns (avoid clustering all items early).
- Provide 6-${Math.max(6, Math.min(18, turns))} turns unless user asked otherwise.
- If style provided, reflect it subtly (not exaggerated).
- Provide concise notes highlighting teaching focus (max 160 chars).
- ADAPT / TRANSLATE learner-supplied free words, style descriptors, and extra instruction phrases into the target language so the dialogue contains NO unexplained foreign-language fragments. Accept only:
    * Proper nouns (e.g., Berlin, Netflix) or widely accepted international loanwords.
    * If a custom word is from another language, convert it to the most natural ${langName} equivalent (e.g., foreign word → appropriate ${langName} term).
- Do NOT leave raw untranslated foreign tokens (avoid code-switching) unless proper nouns.
- Before finalizing JSON, self-check that no turn text contains obvious markers of another language (e.g., for French: 'le ', 'avec'; for German: ' der ', ' und '; etc.) unless those are legitimate proper nouns inside ${langName} context.
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
  userParts.push("Vocab item IDs (must distribute them naturally):\n" + (itemIds.length? itemIds.join(", ") : "<none>"));
  if (customWords.length) {
    userParts.push("Learner-supplied free words/phrases (MUST be naturally incorporated AFTER adaptation into the target language; translate or morph them as needed; do NOT invent IDs):\n" + customWords.join(", "));
  }
  // Reinforce adaptation rule explicitly at end of user message.
  userParts.push("IMPORTANT: Ensure every learner-supplied word or phrase appears in fully adapted target-language form (unless proper noun). No mixed-language code-switching.");

  let messages = [
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

  const requireBetter = /^(1|true)$/i.test((process.env.OPENAI_REQUIRE_BETTER || '').trim());
  let resolvedTextModel: string;
  try {
    resolvedTextModel = await resolveTextModel(headers, { strict: requireBetter });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg, hint: 'Grant access to gpt-4o or gpt-4.1 or unset OPENAI_REQUIRE_BETTER' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }

  // Server-side creativity controls with sane defaults and env overrides
  function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
  const envTempRaw = (process.env.OPENAI_TEMPERATURE || "").trim();
  const envTopPRaw = (process.env.OPENAI_TOP_P || "").trim();
  const defaultTemp = envTempRaw ? clamp(parseFloat(envTempRaw), 0, 1.5) : 0.8; // increased default for more creativity
  const defaultTopP = envTopPRaw ? clamp(parseFloat(envTopPRaw), 0, 1) : undefined;
  const reqTemp = typeof body.temperature === 'number' ? clamp(body.temperature, 0, 1.5) : undefined;
  const reqTopP = typeof body.top_p === 'number' ? clamp(body.top_p, 0, 1) : undefined;
  const temperature = reqTemp ?? defaultTemp;
  const top_p = reqTopP ?? defaultTopP;

  const payload = {
    model: resolvedTextModel,
    messages,
    temperature,
    ...(typeof top_p === 'number' ? { top_p } : {}),
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
  let content: string = data?.choices?.[0]?.message?.content ?? "";
  if (!content) {
    return new Response(JSON.stringify({ error: "Empty response from model" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }

  try {
    let parsed = JSON.parse(content) as DialogueResponse;
    if (!parsed.turns || !Array.isArray(parsed.turns)) throw new Error("turns missing");
    // Heuristic language enforcement: if mismatch, attempt single corrective regeneration
    const combined = parsed.turns.map(t=>t.text).join("\n");
    const detected = detectLangHeuristic(combined);
    if (detected && detected !== lang) {
      console.warn(`[dialogue] Language mismatch detected. target=${lang} detected=${detected}. Retrying once with corrective instruction.`);
      messages = [
        { role: 'system', content: sys },
        { role: 'user', content: userParts.join("\n\n") },
        { role: 'user', content: `Your previous draft response was mostly in ${LANGUAGE_NAMES[detected] || detected}, but the required target language is ${lang} (${langName}). Regenerate the ENTIRE dialogue strictly in ${langName}, preserving pedagogical intent and vocabulary IDs. Output ONLY valid JSON again.` }
      ];
      try {
  // Use a slightly lower temperature for corrective retry to improve adherence while keeping some variability
  const retryPayload = { model: resolvedTextModel, messages, temperature: Math.max(0, Math.min(1.0, (typeof temperature === 'number' ? temperature - 0.15 : 0.65))), response_format: { type: 'json_object' } } as const;
        resp = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(retryPayload) });
        if (resp.ok) {
          const retryData = await resp.json();
            content = retryData?.choices?.[0]?.message?.content ?? content;
            try {
              const reparsed = JSON.parse(content) as DialogueResponse;
              if (reparsed.turns && Array.isArray(reparsed.turns)) {
                parsed = reparsed;
              }
            } catch {/* keep original parsed if reparsing fails */}
        }
      } catch (e) {
        console.warn('Retry after mismatch failed', e);
      }
    }
    return new Response(JSON.stringify(parsed), { status: 200, headers: { "Content-Type": "application/json", "X-Text-Model": resolvedTextModel, ...(requireBetter ? { 'X-Strict-Better': '1' } : {}) } });
  } catch {
    // Fallback: wrap raw text (not ideal, but prevents total failure)
    return new Response(JSON.stringify({ scenario: scenarioId, level, turns: [], usedItems: [], notes: "Model returned non-JSON" }), { status: 200, headers: { "Content-Type": "application/json", "X-Text-Model": resolvedTextModel, ...(requireBetter ? { 'X-Strict-Better': '1' } : {}) } });
  }
}
