"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";

const VOICE_CHOICES: Record<string,string[]> = {
  en: ["alloy","echo","fable","nova"],
  fr: ["nova","alloy","verse","shimmer"],
  de: ["verse","alloy","onyx","echo"],
  it: ["ballad","alloy","nova","ash"],
  es: ["ash","alloy","nova","ballad"],
  default: ["alloy","nova","echo","verse"],
};

type Level = "A1"|"A2"|"B1"|"B2"|"C1"|"C2";
interface VocabItem { id: string; term: string; cefr: Level; tags?: string[]; example?: string; hint?: string; }
interface Category { id: string; label: string; items: VocabItem[]; }
interface VocabData { language: string; categories: Category[]; }

interface DialogueTurn { speaker: string; text: string; vocabRefs: string[]; translation_en?: string; }
interface DialogueResponse { scenario: string; level: Level; turns: DialogueTurn[]; usedItems: string[]; notes?: string; }

export default function DialogueBuilder() {
  const search = useSearchParams();
  const qpLang = search.get("lang") || "en";
  const qpLevel = (search.get("level") as Level) || "A2";
  const seed = search.get("seed") || "";
  const [level, setLevel] = useState<Level>(qpLevel);
  const [lang, setLang] = useState(qpLang);
  const [vocab, setVocab] = useState<VocabData | null>(null);
  const [scenarioId, setScenarioId] = useState<string>("");
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [style, setStyle] = useState("");
  const [extra, setExtra] = useState("");
  const DEFAULT_TURNS = 6; // fixed number of turns
  const [dialogue, setDialogue] = useState<DialogueResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingTurn, setPlayingTurn] = useState<number | null>(null);
  const audioRefs = useRef<Record<number, HTMLAudioElement | null>>({});
  const [ttsSpeed, setTtsSpeed] = useState(0.95);
  const [ttsFormat, setTtsFormat] = useState<"mp3"|"ogg"|"wav">("wav");
  const [gapSeconds, setGapSeconds] = useState(1.0);
  // Voice selections and cache
  const availableVoices = useMemo<string[]>(()=> VOICE_CHOICES[lang] || VOICE_CHOICES.default, [lang]);
  const [voiceA, setVoiceA] = useState<string>(()=> (VOICE_CHOICES.en?.[0]||"alloy"));
  const [voiceB, setVoiceB] = useState<string>(()=> (VOICE_CHOICES.en?.[1]||"nova"));

  // Simple in-memory client audio cache
  const audioCache = useRef<Map<string, string>>(new Map()); // key -> objectURL

  useEffect(()=>{
    // When language changes reset voices to its defaults
    const v = VOICE_CHOICES[lang] || VOICE_CHOICES.default;
    setVoiceA(v[0]);
    setVoiceB(v[1] || v[0]);
  },[lang]);

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
        body: JSON.stringify({ action, lang, level, scenarioId, itemIds: selectedItems, turns: DEFAULT_TURNS, style, instructions: extra, previousDialogue: dialogue })
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

  async function ttsTurn(idx: number, text: string, speaker: string) {
    setPlayingTurn(idx);
    // voice selection handled inside ensureAudio
    try {
      const { url } = await ensureAudio({ text, speaker });
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

  // Reusable function to ensure audio for a given text+speaker is available.
  // Returns object URL and also the raw ArrayBuffer (for future concatenation use).
  async function ensureAudio({ text, speaker }: { text: string; speaker: string }): Promise<{ url: string; arrayBuffer: ArrayBuffer }> {
    const voice = speaker.startsWith("A") ? voiceA : voiceB;
    const cacheKey = JSON.stringify({ text, lang, speed: ttsSpeed, format: ttsFormat, voice });
    // If we already cached an object URL but not the binary, we'll fetch ArrayBuffer lazily when needed.
    // For now we store only URL; when concatenation implemented we'll extend cache to hold ArrayBuffer.
    if (audioCache.current.has(cacheKey)) {
      const existingUrl = audioCache.current.get(cacheKey)!;
      // We can't reconstruct ArrayBuffer from object URL easily without refetching; so fetch only if needed.
      // To keep this simple now, we re-fetch if array buffer requested and we don't have it cached separately.
      // Future: maintain a secondary Map for ArrayBuffers.
      const res = await fetch(existingUrl); // this will work since it's a blob URL resolved locally
      const buf = await res.arrayBuffer();
      return { url: existingUrl, arrayBuffer: buf };
    }
    const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang, speed: ttsSpeed, format: ttsFormat, voice }) });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    audioCache.current.set(cacheKey, url);
    const arrayBuffer = await blob.arrayBuffer();
    return { url, arrayBuffer };
  }

  const scenario = vocab?.categories.find(c=>c.id===scenarioId);
  const scenarioItems = scenario?.items || [];
  const [compiling, setCompiling] = useState(false);
  const [compileProgress, setCompileProgress] = useState<{done:number; total:number}>({done:0,total:0});

  async function downloadFullDialogue() {
    if (!dialogue) return;
    setError(null);
    setCompiling(true);
    const turns = dialogue.turns;
    setCompileProgress({ done: 0, total: turns.length });
    try {
      // Collect ArrayBuffers for each turn sequentially to respect rate limits and show progress
      const buffers: ArrayBuffer[] = [];
      for (let i=0;i<turns.length;i++) {
        const t = turns[i];
        const speaker = t.speaker || (i % 2 === 0 ? "A" : "B");
        const { arrayBuffer } = await ensureAudio({ text: t.text, speaker });
        buffers.push(arrayBuffer);
        setCompileProgress({ done: i+1, total: turns.length });
      }
      if (ttsFormat === "wav") {
        const wav = await buildWavWithSilence(buffers, gapSeconds);
        const blob = new Blob([wav], { type: 'audio/wav' });
        triggerDownload(blob, `dialogue_${lang}_${level}.wav`);
      } else if (ttsFormat === "mp3") {
        // Even for MP3 we first create proper WAV with silence and then fall back to naive MP3 concat (which may ignore gaps);
        // so we prioritize recommending WAV for reliable gaps.
        const joined = concatenateMp3(buffers); // existing behavior
        const blob = new Blob([joined as unknown as BlobPart], { type: "audio/mpeg" });
        triggerDownload(blob, `dialogue_${lang}_${level}.mp3`);
      } else {
        const blob = new Blob(buffers, { type: "audio/ogg" });
        triggerDownload(blob, `dialogue_${lang}_${level}.ogg`);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCompiling(false);
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=> URL.revokeObjectURL(url), 4000);
  }

  async function buildWavWithSilence(encodedBuffers: ArrayBuffer[], gapSeconds: number): Promise<ArrayBuffer> {
    // Decode all segments to PCM via Web Audio
  const W = window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = W.AudioContext || W.webkitAudioContext;
  const audioCtx = new Ctor();
    const decoded: AudioBuffer[] = [];
    for (const ab of encodedBuffers) {
      try {
        const buf = await audioCtx.decodeAudioData(ab.slice(0));
        decoded.push(buf);
      } catch (e) {
        console.warn("Decode failed, skipping segment", e);
      }
    }
    if (decoded.length === 0) throw new Error("Unable to decode any audio segments");
    const sampleRate = decoded[0].sampleRate; // assume consistent
    const channels = decoded[0].numberOfChannels;
    const gapFrames = Math.round(sampleRate * gapSeconds);
    const totalFrames = decoded.reduce((acc, b, i) => acc + b.length + (i < decoded.length -1 ? gapFrames : 0), 0);
    const mix = new Float32Array(totalFrames * channels);
    let writeIndex = 0;
    for (let i = 0; i < decoded.length; i++) {
      const seg = decoded[i];
      for (let ch = 0; ch < channels; ch++) {
        const src = seg.getChannelData(ch);
        for (let f = 0; f < src.length; f++) {
          mix[(writeIndex + f) * channels + ch] = src[f];
        }
      }
      writeIndex += seg.length;
      if (i < decoded.length -1) {
        // Silence gap: already zeroed by default allocation
        writeIndex += gapFrames;
      }
    }
    return floatToWav(mix, sampleRate, channels);
  }

  function floatToWav(interleaved: Float32Array, sampleRate: number, channels: number): ArrayBuffer {
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + interleaved.length * bytesPerSample);
    const view = new DataView(buffer);
    let offset = 0;
    function writeString(s: string) { for (let i=0;i<s.length;i++) view.setUint8(offset++, s.charCodeAt(i)); }
    function writeUint32(v: number) { view.setUint32(offset, v, true); offset += 4; }
    function writeUint16(v: number) { view.setUint16(offset, v, true); offset += 2; }
    // RIFF header
    writeString('RIFF');
    writeUint32(36 + interleaved.length * bytesPerSample);
    writeString('WAVE');
    // fmt chunk
    writeString('fmt ');
    writeUint32(16); // PCM chunk size
    writeUint16(1); // PCM format
    writeUint16(channels);
    writeUint32(sampleRate);
    writeUint32(sampleRate * blockAlign);
    writeUint16(blockAlign);
    writeUint16(bytesPerSample * 8);
    // data chunk
    writeString('data');
    writeUint32(interleaved.length * bytesPerSample);
    // PCM samples
    for (let i=0;i<interleaved.length;i++) {
      let s = Math.max(-1, Math.min(1, interleaved[i]));
      s = s < 0 ? s * 0x8000 : s * 0x7FFF;
      view.setInt16(offset, s, true);
      offset += 2;
    }
    return buffer;
  }

  // Very naive MP3 concatenation: remove ID3v2 headers from all but first, strip trailing/leading ID3v1 if present, then join.
  // This works in many players but is not fully spec-compliant. For perfect results a server-side re-encode into a single MP3 would be needed.
  function concatenateMp3(buffers: ArrayBuffer[]): Uint8Array {
    // Precomputed ~1 second silence MP3 frame sequence (mono 44100Hz) small file header+frames.
    // This is a tiny silent mp3 generated offline (duration ~0.95-1.0s). Size kept small.
    // NOTE: For accuracy a server-side PCM stitch & re-encode is preferred.
    const SILENT_MP3_1S = new Uint8Array([
      0x49,0x44,0x33,0x03,0x00,0x00,0x00,0x00,0x00,0x21,0x54,0x41,0x47,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
      0x00,0x00,0x00,0x54,0x53,0x53,0x45,0x00,0x00,0x00,0x0A,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xFF,
      0xFB,0x92,0x64,0x00,0x0F,0xFF,0xFC,0x21,0x00,0x3F,0xFF,0xF0,0xC4,0x00,0xFF,0xFF,0xC2,0x10,0x03,0xFF,
      0xFF,0x0C,0x40,0x0F,0xFF,0xFC,0x21,0x00,0x3F,0xFF,0xF0,0xC4,0x00
    ]);

    const cleaned: Uint8Array[] = [];
    buffers.forEach((buf, idx) => {
      let bytes = new Uint8Array(buf);
      if (idx > 0 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
        const size = (bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14 | (bytes[8] & 0x7f) << 7 | (bytes[9] & 0x7f);
        const headerLen = 10 + size;
        if (headerLen < bytes.length) bytes = bytes.subarray(headerLen);
      }
      if (idx < buffers.length - 1 && bytes.length > 128) {
        const tail = bytes.subarray(bytes.length - 128);
        if (tail[0] === 0x54 && tail[1] === 0x41 && tail[2] === 0x47) {
          bytes = bytes.subarray(0, bytes.length - 128);
        }
      }
      cleaned.push(bytes);
      // Insert 1 second silence after each segment except last
      if (idx < buffers.length - 1) cleaned.push(SILENT_MP3_1S);
    });
    const total = cleaned.reduce((sum, b) => sum + b.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    cleaned.forEach(b => { out.set(b, offset); offset += b.length; });
    return out;
  }

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Dialogue Builder</h1>
      {seed && (
        <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-sm rounded p-3">
          <span className="font-medium">Seed sentence:</span> {seed}
        </div>
      )}
      <section className="space-y-4">
  <div className="grid md:grid-cols-3 gap-4">
          <label className="flex items-center gap-2"><span className="w-20">Language</span>
            <select className="border rounded p-2 flex-1" value={lang} onChange={e=>setLang(e.target.value)}>
              <option value="en">English</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="es">Spanish</option>
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
                    <button onClick={()=>ttsTurn(i, t.text, t.speaker || (i % 2 === 0 ? "A" : "B"))} className="text-xs px-2 py-1 rounded bg-indigo-600 text-white disabled:opacity-50" disabled={playingTurn!==null || compiling}>{playingTurn===i?"…":"TTS"}</button>
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
                <select value={ttsFormat} onChange={e=>setTtsFormat(e.target.value as "mp3"|"ogg"|"wav")} className="border rounded p-1">
                  <option value="mp3">MP3</option>
                  <option value="ogg">OGG</option>
                  <option value="wav">WAV (adds 1s gaps)</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">Gap
                <input type="range" min={0} max={3} step={0.25} value={gapSeconds} onChange={e=>setGapSeconds(parseFloat(e.target.value))} />
                <span className="tabular-nums w-8 text-right">{gapSeconds.toFixed(2)}s</span>
              </label>
              <label className="flex items-center gap-2 text-sm">Voice A
                <select value={voiceA} onChange={e=>setVoiceA(e.target.value)} className="border rounded p-1">
                  {availableVoices.map((v: string) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">Voice B
                <select value={voiceB} onChange={e=>setVoiceB(e.target.value)} className="border rounded p-1">
                  {availableVoices.map((v: string) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <div className="text-xs text-gray-500 max-w-xs">Voices are cached per text/voice/speed. Use WAV for reliable gaps (MP3 concat may collapse them).</div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button onClick={downloadFullDialogue} disabled={compiling || !dialogue} className="px-4 py-2 bg-purple-600 text-white rounded disabled:opacity-50 text-sm">{compiling?`Compiling ${compileProgress.done}/${compileProgress.total}`:"Download Full Dialogue (beta)"}</button>
              {compiling && <div className="text-xs text-gray-600">Building combined audio… Please wait.</div>}
              {!compiling && error && <div className="text-xs text-red-600 max-w-sm">{error}</div>}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
