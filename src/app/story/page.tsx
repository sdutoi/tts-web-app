"use client";

import { useRef, useState } from "react";
import { useI18n } from '../../i18n/I18nProvider';

type Lang = "en" | "de" | "fr";
type Level = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
type AudioFormat = "mp3" | "ogg";

type VocabItem = { word: string; meaning_en: string };
type Story = { title: string; story: string; vocab: VocabItem[] };

export default function StoryAssistant() {
  const { t } = useI18n();
  const [lang, setLang] = useState<Lang>("de");
  const [level, setLevel] = useState<Level>("A2");
  const [interests, setInterests] = useState("");
  const [sentence, setSentence] = useState("");
  const [style, setStyle] = useState("");
  const [wordCount, setWordCount] = useState(120);
  const [storyJson, setStoryJson] = useState<Story | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [format, setFormat] = useState<AudioFormat>("mp3");
  const [speed, setSpeed] = useState(0.95);
  const audioRef = useRef<HTMLAudioElement>(null);

  async function callStory(action: "generate" | "refine") {
    setGenLoading(true);
    setGenError(null);
    setAudioUrl(null);
    try {
      const res = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, lang, level, interests, sentence, style, wordCount, story: storyJson?.story }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setStoryJson(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setGenError(msg);
    } finally {
      setGenLoading(false);
    }
  }

  async function tts() {
    if (!storyJson?.story) return;
    setAudioUrl(null);
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: storyJson.story, lang, speed, format }),
    });
    if (!res.ok) {
      const t = await res.text();
      setGenError(t);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    setAudioUrl(url);
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.playbackRate = speed;
      if ("preservesPitch" in audioRef.current) {
        (audioRef.current as unknown as { preservesPitch?: boolean }).preservesPitch = true;
      }
      await audioRef.current.play().catch(() => undefined);
    }
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">{t('story.title')}</h1>

      <section className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="flex items-center gap-2"><span className="w-24">{t('common.language')}</span>
            <select className="border rounded p-2 flex-1" value={lang} onChange={(e)=>setLang(e.target.value as Lang)}>
              <option value="en">English</option>
              <option value="de">German</option>
              <option value="fr">French</option>
            </select>
          </label>
          <label className="flex items-center gap-2"><span className="w-24">{t('common.level')}</span>
            <select className="border rounded p-2 flex-1" value={level} onChange={(e)=>setLevel(e.target.value as Level)}>
              {(["A1","A2","B1","B2","C1","C2"] as Level[]).map(l=> <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2"><span className="w-24">{t('common.words')}</span>
            <input type="number" className="border rounded p-2 w-24" min={60} max={300} value={wordCount} onChange={(e)=>setWordCount(parseInt(e.target.value||"120",10))} />
          </label>
        </div>
        <input className="w-full border rounded p-2" placeholder={t('placeholders.interests')} value={interests} onChange={(e)=>setInterests(e.target.value)} />
        <input className="w-full border rounded p-2" placeholder={t('placeholders.optionalSentence')} value={sentence} onChange={(e)=>setSentence(e.target.value)} />
        <input className="w-full border rounded p-2" placeholder={t('placeholders.optionalStyle')} value={style} onChange={(e)=>setStyle(e.target.value)} />
        <div className="flex gap-2">
          <button className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50" onClick={()=>callStory("generate")} disabled={genLoading}>{t('story.generate')}</button>
          <button className="px-4 py-2 rounded bg-emerald-600 text-white disabled:opacity-50" onClick={()=>callStory("refine")} disabled={genLoading || !storyJson}>{t('story.refine')}</button>
        </div>
        {genError && <div className="text-red-600 text-sm whitespace-pre-wrap">{genError}</div>}
      </section>

      {storyJson && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{storyJson.title || t('story.miniStory')}</h2>
          <textarea className="w-full border rounded p-3" rows={10} value={storyJson.story || ""} onChange={(e)=>setStoryJson({...storyJson, story: e.target.value})} />
          {Array.isArray(storyJson.vocab) && storyJson.vocab.length>0 && (
            <div>
              <h3 className="font-medium mb-2">{t('story.vocabulary')}</h3>
              <ul className="list-disc pl-6 space-y-1">
                {storyJson.vocab.map((v: VocabItem, i: number) => (
                  <li key={i}><span className="font-medium">{v.word}</span> — {v.meaning_en}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            <label className="flex items-center gap-2"><span className="w-20">{t('common.speed')}</span>
              <input type="range" min={0.5} max={1.25} step={0.05} value={speed} onChange={(e)=>setSpeed(parseFloat(e.target.value))} className="flex-1"/>
              <span className="w-12 text-right tabular-nums">{speed.toFixed(2)}x</span>
            </label>
            <label className="flex items-center gap-2"><span className="w-20">{t('common.format')}</span>
              <select className="border rounded p-2 flex-1" value={format} onChange={(e)=>setFormat(e.target.value as AudioFormat)}>
                <option value="mp3">MP3</option>
                <option value="ogg">OGG Opus</option>
              </select>
            </label>
            <button className="px-4 py-2 rounded bg-indigo-600 text-white disabled:opacity-50" onClick={tts} disabled={!storyJson?.story}>{t('common.generateAudio')}</button>
          </div>
          <audio ref={audioRef} controls className="w-full" />
          {audioUrl && (
            <a href={audioUrl} download={`story.${format}`} className="text-blue-700 underline">{t('common.download')}</a>
          )}
        </section>
      )}
    </main>
  );
}
