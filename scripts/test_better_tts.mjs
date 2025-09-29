#!/usr/bin/env node
/*
 Tester to verify access to better TTS model (gpt-4o-audio-preview).
 - Generates a short audio clip and writes to ./tmp/tts_test.mp3
 - Respects OPENAI_API_KEY, OPENAI_PROJECT_ID, OPENAI_ORG_ID
 - Exits non-zero on failure
*/

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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
  } catch { /* ignore */ }
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

const model = 'gpt-4o-audio-preview';
const text = 'This is a short test of the better TTS model.';
const voice = process.env.TTS_TEST_VOICE || 'alloy';
const format = 'mp3';

const headers = {
  'Authorization': `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'Accept': 'audio/mpeg',
};
if (process.env.OPENAI_PROJECT_ID) headers['OpenAI-Project'] = process.env.OPENAI_PROJECT_ID.trim();
if (process.env.OPENAI_ORG_ID) headers['OpenAI-Organization'] = process.env.OPENAI_ORG_ID.trim();

// Prefer Responses API for wider availability of modalities
const url = 'https://api.openai.com/v1/responses';
const payload = { model, input: text, audio: { voice, format } };

try {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!r.ok) {
    const t = await r.text();
    console.error(`TTS not accessible: ${r.status} ${t.slice(0,200)}`);
    process.exit(1);
  }
  const j = await r.json();
  // Find base64 audio data in response
  let b64 = null;
  const outputs = j?.output || j?.outputs || j?.data || [];
  const arr = Array.isArray(outputs) ? outputs : [];
  outer: for (const item of arr) {
    const content = item?.content || [];
    if (Array.isArray(content)) {
      for (const part of content) {
        const audioObj = part?.audio || part?.output_audio;
        const data = audioObj?.data;
        if (typeof data === 'string' && data.length > 0) { b64 = data; break outer; }
      }
    }
  }
  if (!b64) {
    console.error('TTS Responses payload did not include audio data');
    process.exit(1);
  }
  const buf = Buffer.from(b64, 'base64');
  const outPath = resolve(process.cwd(), 'tmp/tts_test.mp3');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buf);
  console.log(`SUCCESS: ${model} wrote ${buf.length} bytes to ${outPath}`);
  process.exit(0);
} catch (e) {
  console.error('Network error:', e?.message || String(e));
  process.exit(1);
}
