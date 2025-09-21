export const runtime = "nodejs";

// Simple diagnostic endpoint using the newer Responses API
export async function GET() {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  const payload = { model: "gpt-4o-mini", input: "ping" };
  const headers: Record<string,string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  try {
    const resp = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers, body: JSON.stringify(payload) });
    const text = await resp.text();
    return new Response(JSON.stringify({ status: resp.status, bodySnippet: text.slice(0,400) }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
