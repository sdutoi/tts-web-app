export const runtime = 'nodejs';

// TEMPORARY: Hard-code the suspected working key to verify if Next.js env loading is at fault.
// Replace the placeholder string with the exact key used in your Python script.
// IMPORTANT: Remove this file after diagnosing to avoid committing secrets.
const DIRECT_KEY = 'REPLACE_WITH_WORKING_KEY';

export async function GET() {
  if (!DIRECT_KEY || DIRECT_KEY.startsWith('REPLACE')) {
    return new Response(JSON.stringify({ error: 'Set DIRECT_KEY first' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  const auth = `Bearer ${DIRECT_KEY}`;
  const headers: Record<string,string> = { Authorization: auth };
  const r = await fetch('https://api.openai.com/v1/models', { headers });
  const text = await r.text();
  // Return minimal diagnostics WITHOUT exposing full key.
  return new Response(JSON.stringify({
    status: r.status,
    bodySnippet: text.slice(0,180),
    directKeyLen: DIRECT_KEY.length,
    authHeaderLen: auth.length,
    prefix: DIRECT_KEY.slice(0,10),
    suffix: DIRECT_KEY.slice(-6)
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
