"use client";

import { useRef, useState } from "react";

type Lang = "en" | "de" | "fr";
type AudioFormat = "mp3" | "ogg";

export default function Home() {
  const [text, setText] = useState(
    "Guten Tag! Willkommen zu unserem kleinen Sprachlernprojekt."
  );
  const [lang, setLang] = useState<Lang>("de");
  const [speed, setSpeed] = useState(0.8);
  const [format, setFormat] = useState<AudioFormat>("mp3");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setAudioUrl(null);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang, speed, format }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.playbackRate = speed; // reflect chosen speed in-browser
        if ("preservesPitch" in audioRef.current) {
          audioRef.current.preservesPitch = true;
        }
        await audioRef.current.play().catch(() => undefined);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Language TTS (EN/DE/FR)</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="w-full border rounded p-3"
          placeholder="Type the text to synthesize"
          required
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="flex items-center gap-2">
            <span className="w-20">Language</span>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              className="border rounded p-2 flex-1"
            >
              <option value="en">English</option>
              <option value="de">German</option>
              <option value="fr">French</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-20">Speed</span>
            <input
              type="range"
              min={0.5}
              max={1.25}
              step={0.05}
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="tabular-nums w-12 text-right">
              {speed.toFixed(2)}x
            </span>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-20">Format</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as AudioFormat)}
              className="border rounded p-2 flex-1"
            >
              <option value="mp3">MP3</option>
              <option value="ogg">OGG Opus</option>
            </select>
          </label>
        </div>
        <button
          type="submit"
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
          disabled={loading}
        >
          {loading ? "Synthesizing…" : "Create audio"}
        </button>
      </form>

      {error && (
        <div className="text-red-600 text-sm whitespace-pre-wrap">{error}</div>
      )}

      <div className="space-y-2">
        <audio ref={audioRef} controls className="w-full" />
        {audioUrl && (
          <a
            href={audioUrl}
            download={`tts.${format}`}
            className="text-blue-700 underline"
          >
            Download audio
          </a>
        )}
      </div>

      <div className="pt-6">
        <a href="/story" className="text-indigo-700 underline">
          Try the Story Assistant →
        </a>
      </div>
    </main>
  );
}
