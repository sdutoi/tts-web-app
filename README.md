## Language TTS (EN/DE/FR) – Next.js App

This app lets you generate speech audio for English, German, and French using OpenAI TTS (gpt-4o-mini-tts). It includes a simple UI to enter text, choose language, speed, and format, then play or download the result.

## Prerequisites

- Node.js 18+ (Node 20 recommended)
- An OpenAI API key with access to TTS

## Setup

1. Copy the env example and set your key:

	- cp .env.local.example .env.local
	- Edit .env.local and set OPENAI_API_KEY=...

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
