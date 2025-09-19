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

  // Probe /v1/models
  const modelsResp = await fetch("https://api.openai.com/v1/models", {
    method: "GET",
    headers: baseHeaders,
  });

  // Probe /v1/audio/speech (small payload)
  const speechResp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { ...baseHeaders, Accept: "audio/mpeg" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      input: "diagnostic",
      voice: "alloy",
      format: "mp3",
    }),
  });

  const body = {
    headersPresent: {
      hasKey: apiKey.startsWith("sk-"),
      project: Boolean(openaiProject),
      org: Boolean(openaiOrg),
      keySample: redactKeySample(apiKey),
    },
    results: {
      modelsStatus: modelsResp.status,
      speechStatus: speechResp.status,
    },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
