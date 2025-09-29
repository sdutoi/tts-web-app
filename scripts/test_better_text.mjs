#!/usr/bin/env node
/*
 simple tester to verify access to better chat models.
 - tries gpt-4o then gpt-4.1 with a tiny prompt
 - respects OPENAI_API_KEY, OPENAI_PROJECT_ID, OPENAI_ORG_ID
 - if env var missing, attempts to load from .env.local / .env
 - exits non-zero if neither is accessible
*/

async function tryLoadDotenv(file) {
  try {
    const fs = await import('node:fs/promises');
    const { constants } = await import('node:fs');
    await fs.access(file, constants.F_OK);
    const txt = await fs.readFile(file, 'utf8');
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* ignore */
  }
}

if (!process.env.OPENAI_API_KEY) {
  await tryLoadDotenv('.env.local');
  if (!process.env.OPENAI_API_KEY) await tryLoadDotenv('.env');
}

const apiKey = (process.env.OPENAI_API_KEY || '').trim();
if (!apiKey) {
  console.error('Missing OPENAI_API_KEY');
  process.exit(2);
}

const headers = {
  'Authorization': `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
};
if (process.env.OPENAI_PROJECT_ID) headers['OpenAI-Project'] = process.env.OPENAI_PROJECT_ID.trim();
if (process.env.OPENAI_ORG_ID) headers['OpenAI-Organization'] = process.env.OPENAI_ORG_ID.trim();

const url = 'https://api.openai.com/v1/chat/completions';
const candidates = ['gpt-4o','gpt-4.1'];

for (const model of candidates) {
  const payload = { model, messages: [{ role: 'user', content: 'Say ok in JSON {"ok":true}.' }], max_tokens: 10, response_format: { type: 'json_object' } };
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!r.ok) {
      const t = await r.text();
      console.error(`[${model}] not accessible: ${r.status} ${t.slice(0,200)}`);
      continue;
    }
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content ?? '';
    try {
      const parsed = JSON.parse(content);
      if (parsed && parsed.ok === true) {
        console.log(`SUCCESS: ${model} is accessible.`);
        process.exit(0);
      } else {
        console.log(`SUCCESS: ${model} returned JSON.`);
        process.exit(0);
      }
    } catch {
      console.log(`SUCCESS: ${model} responded (non-JSON).`);
      process.exit(0);
    }
  } catch (e) {
    console.error(`[${model}] network error:`, e?.message || String(e));
  }
}

console.error('FAIL: Neither gpt-4o nor gpt-4.1 were accessible.');
process.exit(1);
