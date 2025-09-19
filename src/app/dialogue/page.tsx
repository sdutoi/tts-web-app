"use client";

import { useEffect, useRef, useState } from "react";

type Level = "A1"|"A2"|"B1"|"B2"|"C1"|"C2";
interface VocabItem { id: string; term: string; cefr: Level; tags?: string[]; example?: string; hint?: string; }
interface Category { id: string; label: string; items: VocabItem[]; }
interface VocabData { language: string; categories: Category[]; }

interface DialogueTurn { speaker: string; text: string; vocabRefs: string[]; translation_en?: string; }
interface DialogueResponse { scenario: string; level: Level; turns: DialogueTurn[]; usedItems: string[]; notes?: string; }

export default function DialogueBuilder() {
  const [level, setLevel] = useState<Level>("A2");
  const [lang, setLang] = useState("en");
  const [vocab, setVocab] = useState<VocabData | null>(null);
  const [scenarioId, setScenarioId] = useState<string>("");
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [style, setStyle] = useState("");
  const [extra, setExtra] = useState("");
  const [turns, setTurns] = useState(8);
  const [dialogue, setDialogue] = useState<DialogueResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingTurn, setPlayingTurn] = useState<number | null>(null);
  const audioRefs = useRef<Record<number, HTMLAudioElement | null>>({});
  const [ttsSpeed, setTtsSpeed] = useState(0.95);
  const [ttsFormat, setTtsFormat] = useState<"mp3"|"ogg">("mp3");

  // Load English vocab for now. Multi-language later.
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/src/data/vocab_en.json"); // served as static asset if public? fallback fetch via next dynamic import
        if (!res.ok) throw new Error("Unable to load vocab_en.json via fetch");
        const data = await res.json();
        setVocab(data);
        if (data.categories?.length && !scenarioId) setScenarioId(data.categories[0].id);
      } catch {
        // fallback: dynamic import (bundled)
        try {
          const data = await import("../../data/vocab_en.json");
          setVocab(data as VocabData);
          if ((data as VocabData).categories?.length && !scenarioId) setScenarioId((data as VocabData).categories[0].id);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    }
    load();
  }, [scenarioId]);

  function toggleItem(id: string) {
    setSelectedItems(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id]);
  }

  async function generate(action: "generate"|"refine") {
    if (selectedItems.length === 0) {
      setError("Select at least one vocab item.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, lang, level, scenarioId, itemIds: selectedItems, turns, style, instructions: extra, previousDialogue: dialogue })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setDialogue(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function ttsTurn(idx: number, text: string) {
    setPlayingTurn(idx);
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang, speed: ttsSpeed, format: ttsFormat }) });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audioEl = audioRefs.current[idx];
      if (audioEl) {
        audioEl.src = url;
        audioEl.playbackRate = ttsSpeed;
        if ("preservesPitch" in audioEl) { (audioEl as unknown as { preservesPitch?: boolean }).preservesPitch = true; }
        await audioEl.play().catch(()=>undefined);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlayingTurn(null);
    }
  }

  const scenario = vocab?.categories.find(c=>c.id===scenarioId);
  const scenarioItems = scenario?.items || [];

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Dialogue Builder</h1>
      <section className="space-y-4">
        <div className="grid md:grid-cols-4 gap-4">
          <label className="flex items-center gap-2"><span className="w-20">Language</span>
            <select className="border rounded p-2 flex-1" value={lang} onChange={e=>setLang(e.target.value)}>
              <option value="en">English</option>
              <option value="fr">French</option>
            </select>
          </label>
          <label className="flex items-center gap-2"><span className="w-20">Level</span>
            <select className="border rounded p-2 flex-1" value={level} onChange={e=>setLevel(e.target.value as Level)}>
              {(["A1","A2","B1","B2","C1","C2"] as Level[]).map(l=> <option key={l}>{l}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2"><span className="w-20">Scenario</span>
            <select className="border rounded p-2 flex-1" value={scenarioId} onChange={e=>setScenarioId(e.target.value)}>
              {vocab?.categories.map(c=> <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2"><span className="w-20">Turns</span>
            <input type="number" min={4} max={18} className="border rounded p-2 w-24" value={turns} onChange={e=>setTurns(parseInt(e.target.value||"8",10))} />
          </label>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <input className="border rounded p-2" placeholder="Style / tone (optional)" value={style} onChange={e=>setStyle(e.target.value)} />
          <input className="border rounded p-2" placeholder="Extra instructions (optional)" value={extra} onChange={e=>setExtra(e.target.value)} />
        </div>
        <div>
          <h2 className="font-medium mb-2">Scenario Vocabulary</h2>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
            {scenarioItems.map(it => {
              const active = selectedItems.includes(it.id);
              return (
                <button key={it.id} type="button" onClick={()=>toggleItem(it.id)} className={`text-left border rounded p-2 text-sm hover:border-indigo-500 ${active?"bg-indigo-600 text-white border-indigo-600":"bg-white"}`}>
                  <div className="font-semibold">{it.term}</div>
                  <div className="opacity-80 text-xs">{it.cefr}</div>
                  {it.hint && <div className="mt-1 text-[11px] opacity-70 line-clamp-2">{it.hint}</div>}
                </button>
              );
            })}
          </div>
          {scenarioItems.length===0 && <div className="text-sm text-gray-600">No items.</div>}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={()=>generate("generate")} className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={loading || selectedItems.length===0}>{loading?"Working…":"Generate"}</button>
          <button onClick={()=>generate("refine")} className="px-4 py-2 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={loading || !dialogue}>Refine</button>
          <div className="text-sm opacity-70">Selected: {selectedItems.length}</div>
          {error && <div className="text-red-600 text-sm whitespace-pre-wrap">{error}</div>}
        </div>
      </section>

      {dialogue && (
        <section className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Dialogue</h2>
            {dialogue.notes && <div className="text-sm italic opacity-75 max-w-md">{dialogue.notes}</div>}
          </div>
          <div className="space-y-3">
            {dialogue.turns.map((t, i) => (
              <div key={i} className="border rounded p-3 bg-white shadow-sm">
                <div className="flex justify-between items-center mb-1">
                  <div className="font-semibold">{t.speaker || (i % 2 === 0 ? "A" : "B")}</div>
                  <div className="flex gap-2 items-center">
                    <button onClick={()=>ttsTurn(i, t.text)} className="text-xs px-2 py-1 rounded bg-indigo-600 text-white disabled:opacity-50" disabled={playingTurn!==null}>{playingTurn===i?"…":"TTS"}</button>
                    <audio ref={(el) => { audioRefs.current[i] = el; }} className="hidden" />
                  </div>
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">{t.text}</div>
                {t.translation_en && <div className="mt-1 text-sm text-gray-600">{t.translation_en}</div>}
                {t.vocabRefs?.length>0 && (
                  <div className="mt-2 flex flex-wrap gap-1 text-xs">
                    {t.vocabRefs.map(v=> <span key={v} className="px-2 py-0.5 rounded bg-gray-100 border text-gray-700">{v}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 border-t pt-4">
            <h3 className="font-medium mb-2">Playback Settings</h3>
            <div className="flex flex-wrap gap-4 items-center">
              <label className="flex items-center gap-2 text-sm">Speed
                <input type="range" min={0.5} max={1.25} step={0.05} value={ttsSpeed} onChange={e=>setTtsSpeed(parseFloat(e.target.value))} />
                <span className="tabular-nums">{ttsSpeed.toFixed(2)}x</span>
              </label>
              <label className="flex items-center gap-2 text-sm">Format
                <select value={ttsFormat} onChange={e=>setTtsFormat(e.target.value as "mp3"|"ogg")} className="border rounded p-1">
                  <option value="mp3">MP3</option>
                  <option value="ogg">OGG</option>
                </select>
              </label>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
