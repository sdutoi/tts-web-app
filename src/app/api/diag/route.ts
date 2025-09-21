import crypto from "crypto";

export const runtime = "nodejs";

function redactKeySample(key: string | undefined) {
  if (!key) return null;
  // Return only prefix and checksum, no secrets
  const prefix = key.slice(0, 6);
  const sum = crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
  return `${prefix}...#${sum}`;
}

export async function GET() {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  const openaiProject = process.env.OPENAI_PROJECT_ID?.trim();
  const openaiOrg = process.env.OPENAI_ORG_ID?.trim();

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Missing OPENAI_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const baseHeaders: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (openaiProject) baseHeaders["OpenAI-Project"] = openaiProject;
  if (openaiOrg) baseHeaders["OpenAI-Organization"] = openaiOrg;

  async function safeFetch(url: string, init: RequestInit) {
    try {
      const r = await fetch(url, init);
      const ct = r.headers.get("content-type") || "";
      let snippet = "";
      if (ct.includes("application/json")) {
        const j = await r.json().catch(()=>null);
        snippet = JSON.stringify(j)?.slice(0, 300);
      } else {
        snippet = (await r.text().catch(()=>""))?.slice(0, 300);
      }
      return { status: r.status, snippet };
    } catch (e) {
      return { status: 0, snippet: (e instanceof Error ? e.message : String(e)).slice(0,200) };
    }
  }

  const [modelsResp, speechResp, chatResp] = await Promise.all([
    safeFetch("https://api.openai.com/v1/models", { method: "GET", headers: baseHeaders }),
    safeFetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { ...baseHeaders, Accept: "audio/mpeg" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", input: "diagnostic", voice: "alloy", format: "mp3" }),
    }),
    safeFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [ { role: "user", content: "diag" } ], max_tokens: 8 })
    })
  ]);

  let speechVariant: { status: number; snippet: string } | null = null;
  if (openaiProject) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ["OpenAI-Project"]: _omittedProject, ...noProject } = baseHeaders;
    speechVariant = await safeFetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { ...noProject, Accept: "audio/mpeg" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", input: "diagnostic", voice: "alloy", response_format: "mp3" })
    });
  }

  function keyDiagnostics(k: string) {
    if (!k) return null;
    const len = k.length;
    const prefix = k.slice(0, 10);
    const suffix = k.slice(-6);
    // Show a small hex slice to catch hidden chars
    const hexFirst = Buffer.from(k.slice(0, 16)).toString("hex");
    const hasCR = /\r/.test(k);
    const hasSpaceEnd = /\s$/.test(process.env.OPENAI_API_KEY || "");
    const sha256 = crypto.createHash("sha256").update(k).digest("hex");
    return { len, prefix, suffix, hexFirst, hasCR, hasSpaceEnd, sha256 };
  }

  const body = {
    headersPresent: {
      hasKey: apiKey.startsWith("sk-"),
      project: Boolean(openaiProject),
      org: Boolean(openaiOrg),
      keySample: redactKeySample(apiKey),
    },
    diagnostics: {
      key: keyDiagnostics(apiKey),
      runtime: process.version,
      envVars: Object.keys(process.env).filter(k => k.startsWith("OPENAI_")),
      sentHeaders: Object.fromEntries(Object.entries(baseHeaders).map(([k,v]) => [k, k.toLowerCase()==="authorization" ? `${v.slice(0,12)}...${v.slice(-4)}` : v])),
      authHeaderLength: baseHeaders.Authorization.length
    },
    results: {
      models: modelsResp,
      speech: speechResp,
      speechNoProject: speechVariant,
      chat: chatResp,
    },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
