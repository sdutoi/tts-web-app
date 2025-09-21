## Language TTS (EN/DE/FR) – Next.js App

This app lets you practice multiple languages (English, French, German, Italian, Spanish) using:
- A redesigned landing page: pick a language, then select one of five sample sentences (A1→C1 difficulty) to set your approximate level.
- Automatic handoff into the dialogue builder pre-filled with language + level + seed sentence.
- TTS (gpt-4o-mini-tts) playback with voice fallback and caching.
 - Dual-voice dialogue playback: pick two distinct voices (A / B) per language; client caches audio to avoid repeat API calls.

## Prerequisites

- Node.js 18+ (Node 20 recommended)
- An OpenAI API key with access to TTS

## Setup

1. Copy the env example and set your key:

  - cp .env.local.example .env.local
  - Edit .env.local and set OPENAI_API_KEY=...
  - If your key starts with `sk-proj-` (project-scoped), optionally set `OPENAI_PROJECT_ID` (and `OPENAI_ORG_ID` if applicable).

2. Install dependencies:

	- npm install

3. Run the dev server:

	- npm run dev

Open http://localhost:3000 to use the UI.

## How it works

- API route: `src/app/api/tts/route.ts`
  - Accepts POST with `{ text, lang, speed, format }`
  - Calls OpenAI TTS and returns audio (mp3 or ogg)
  - In-memory per-instance cache avoids duplicate requests

- UI page: `src/app/page.tsx`
  - Textarea + language select (en/de/fr), speed slider (0.5–1.25), format (mp3/ogg)
  - Plays audio and offers a download link

Notes on speed: The server may return normal-speed audio; the page applies the chosen speed using the browser's audio playbackRate for listening. The downloaded file will be at the generated speed, not the adjusted playback speed.

## Deploy

Vercel is recommended. Be sure to set the `OPENAI_API_KEY` environment variable in your Vercel project settings. The API route is configured to run on the Node.js runtime.

## Troubleshooting

- 401 invalid_api_key: Ensure your key is typed correctly and active. If you’re using a project-scoped key (`sk-proj-...`), try also setting `OPENAI_PROJECT_ID` and/or `OPENAI_ORG_ID`. Re-start `npm run dev` after changing env vars.
 - If a key works in an external script but not in the app: use `/api/diag` and `/api/ping` plus `node scripts/checkKey.mjs` to compare. Look for hidden CR characters or truncation (diag shows hex). Try a freshly generated standard key; if that succeeds while the project key fails with 401, regenerate the project key or omit extra headers.

### Voices
Supported voices (provider list): `alloy, echo, fable, onyx, nova, shimmer, coral, verse, ballad, ash, sage, marin, cedar`.

Language defaults:
- EN → alloy
- DE → verse (fallback alloy)
- FR → nova (fallback alloy)
- IT → ballad (fallback alloy)
- ES → ash (fallback alloy)

Any unsupported requested voice automatically falls back; response headers include `X-Voice-Selected` and `X-Voice-Fallback` when applied. Update `SUPPORTED_VOICES` in `src/app/api/tts/route.ts` if the provider list changes.

### Dialogue TTS Dual Voices & Caching
- On the dialogue page you can choose Voice A and Voice B (language-specific suggestions) so alternating turns sound distinct.
- Audio is cached in-memory keyed by `{ text, lang, speed, format, voice }` so re-playing a turn with unchanged parameters does not hit the API again.
- Changing speed / voice invalidates the relevant cache entries (new key).
- Empty/slow dev start: The first build can take a moment. If it stalls, cancel and re-run `npm run dev`. Ensure Node 18+ is used.
