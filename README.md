## Language TTS & Dialogue Builder (EN/DE/FR/IT/ES) – Next.js App

This app lets you practice multiple languages (English, French, German, Italian, Spanish) using:
- A redesigned landing page: pick a language, then select one of five sample sentences (A1→C1 difficulty) to set your approximate level.
- Automatic handoff into the dialogue builder pre-filled with language + level + seed sentence.
- TTS (gpt-4o-mini-tts) playback with voice fallback and caching.
- Dual-voice dialogue playback: pick two distinct voices (A / B) per language; client caches audio to avoid repeat API calls.
- Random scenario vocabulary sampling: each scenario shows 5 randomly sampled items (from up to 20 that match or are near the chosen CEFR level) to keep sessions varied.
- Custom words panel: add any words/phrases (any language) that you want encouraged in the generated dialogue.
- Disabled scenarios: "Doctor Visit & Health Admin" and "Climate & Sustainability Action" intentionally omitted from the selector to reduce clutter.
- Full dialogue audio export (WAV recommended) with configurable inter-turn silence.

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

### Dialogue Builder (Random Sampling, Custom Words, Export)
- Per load, 5 vocab items are randomly chosen from a level-targeted pool (max 20). Refreshing or changing scenario re-samples.
- You can add your own free-form words; these are encouraged in generation but have no internal IDs.
- Removed scenarios: Doctor Visit & Health Admin, Climate & Sustainability Action (still in data file but filtered out).
- Export: choose WAV (adds silence reliably), MP3, or OGG. WAV path decodes + stitches segments with your selected gap (0–3s, default 0.50s).

#### Custom Words Adaptation / Translation
When you supply custom words or phrases (even if they are in another language), the system prompt now enforces that they are ADAPTED into the dialogue's target language. Examples:
- Target language = French; you enter German "Freund" → dialogue may include "ami" / "un ami proche" rather than leaving "Freund" untranslated.
- Target language = Spanish; you enter English "to book" → dialogue might use "reservar" or an appropriately conjugated form.

Rules:
1. Proper nouns (Berlin, Netflix) are kept as-is.
2. International loanwords may remain if natural.
3. Otherwise, foreign-language fragments are translated or morphologically adapted; no raw code-switching appears.
4. Style / tone descriptors and extra instructions are likewise interpreted in the target language.

If you observe untranslated fragments that are not proper nouns, regenerate— the strengthened prompt usually corrects this.

### Dialogue TTS Dual Voices: Post-Generation Demo & Selection
- Voice picker appears only AFTER a dialogue is generated (simpler initial UI).
- Preview up to 5 candidate voices for the language; each plays a localized sample sentence (e.g., "Veux-tu apprendre le français avec moi ?").
- Assign two distinct voices as Speaker A / B (swap logic prevents duplicates).
- Candidate list per language: `VOICE_CANDIDATES` in `src/app/dialogue/page.tsx`.
- Turn playback audio cached in-memory by `{ text, lang, speed, format, voice }`.
- WAV export inserts configurable silence (default 0.50s) between turns; MP3 concat is best-effort and may compress gaps.
- Keep candidate list small (~5) for responsiveness; consider pagination if expanding.
