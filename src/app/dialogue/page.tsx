"use client";

import { useEffect, useRef, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from '../../i18n/I18nProvider';

// Voice candidates per language (max 5 for demo selection). Order matters for initial defaults.
const VOICE_CANDIDATES: Record<string,string[]> = {
  en: ["alloy","echo","fable","nova","verse"],
  fr: ["nova","shimmer","alloy","verse","coral"],
  de: ["verse","onyx","alloy","echo","shimmer"],
  it: ["ballad","alloy","nova","ash","coral"],
  es: ["ash","alloy","nova","ballad","coral"],
  default: ["alloy","nova","echo","verse","shimmer"],
};

// Localized demo sentence: "Do you want to learn {LanguageName} with me?"
function demoSentence(lang: string): string {
  switch (lang) {
    case "fr": return "Veux-tu apprendre le français avec moi ?";
    case "de": return "Willst du Deutsch mit mir lernen?";
    case "it": return "Vuoi imparare l'italiano con me?";
    case "es": return "¿Quieres aprender español conmigo?";
    case "en": default: return "Do you want to learn English with me?";
  }
}

type Level = "A1"|"A2"|"B1"|"B2"|"C1"|"C2";
interface VocabItem { id: string; term: string; cefr: Level; tags?: string[]; example?: string; hint?: string; }
interface Category { id: string; label: string; items: VocabItem[]; }
interface VocabData { language: string; categories: Category[]; }

interface DialogueTurn { speaker: string; text: string; vocabRefs: string[]; translation_en?: string; }
interface DialogueResponse { scenario: string; level: Level; turns: DialogueTurn[]; usedItems: string[]; notes?: string; }

function DialogueBuilderInner() {
  const { t } = useI18n();
  const search = useSearchParams();
  const qpLang = search.get("lang") || "en";
  const qpLevel = (search.get("level") as Level) || "A2";
  const seed = search.get("seed") || "";
  const [level, setLevel] = useState<Level>(qpLevel);
  const [lang, setLang] = useState(qpLang);
  const [vocab, setVocab] = useState<VocabData | null>(null);
  const [enVocab, setEnVocab] = useState<VocabData | null>(null); // English reference for translations
  const [scenarioId, setScenarioId] = useState<string>("");
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [style, setStyle] = useState("");
  const [extra, setExtra] = useState("");
  const [customWordsRaw, setCustomWordsRaw] = useState("");
  const DEFAULT_TURNS = 6; // fixed number of turns
  const [dialogue, setDialogue] = useState<DialogueResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingTurn, setPlayingTurn] = useState<number | null>(null);
  const audioRefs = useRef<Record<number, HTMLAudioElement | null>>({});
  const [ttsSpeed, setTtsSpeed] = useState(0.95);
  const [ttsFormat, setTtsFormat] = useState<"mp3"|"ogg"|"wav">("wav");
  const [gapSeconds, setGapSeconds] = useState(0.5);
  // Voice selections and cache
  const [voiceA, setVoiceA] = useState<string>(()=> (VOICE_CANDIDATES["en"] || VOICE_CANDIDATES.default)[0]);
  const [voiceB, setVoiceB] = useState<string>(()=> (VOICE_CANDIDATES["en"] || VOICE_CANDIDATES.default)[1]);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Simple in-memory client audio cache
  const audioCache = useRef<Map<string, string>>(new Map()); // key -> objectURL

  // When language changes, ensure selected voices belong to new candidate list; if not, reset to first two.
  useEffect(()=> {
    const list = VOICE_CANDIDATES[lang] || VOICE_CANDIDATES.default;
    setVoiceError(null);
    // Use functional updates to avoid adding voiceA/voiceB to dependency array (only care on lang change)
    setVoiceA(prev => (!list.includes(prev) ? list[0] : prev));
    setVoiceB(prev => {
      if (!list.includes(prev) || prev === list[0]) {
        // prefer second distinct voice if available
        return list[1] || list[0];
      }
      return prev;
    });
  }, [lang]);

  // Load English reference vocab once (for translations & scenario labels)
  useEffect(()=> {
    let cancelled = false;
    async function loadEn() {
      if (enVocab) return; // already loaded
      try {
        const path = '/src/data/vocab_en.json';
        const res = await fetch(path);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setEnVocab(data);
          return;
        }
      } catch {/* ignore */}
      try {
        const imported = await import('../../data/vocab_en.json');
        if (!cancelled) setEnVocab(imported as VocabData);
      } catch {/* ignore */}
    }
    loadEn();
    return ()=> { cancelled = true; };
  }, [enVocab]);

  // Load vocab for selected language with fallback to English (for content). Re-runs when language changes.
  useEffect(() => {
    let cancelled = false;
    async function load(langCode: string) {
      const attemptOrder = [langCode, "en"] as string[]; // fallback to English
      for (const code of attemptOrder) {
        try {
          // First try fetch (works if statically served). If that fails, dynamic import.
          const fetchPath = `/src/data/vocab_${code}.json`;
          try {
            const res = await fetch(fetchPath);
            if (res.ok) {
              const data = await res.json();
              if (!cancelled) {
                setVocab(data);
                // Reset scenario to first category of new vocab unless existing id still present.
                const hasOldScenario = data.categories?.some((c: Category) => c.id === scenarioId);
                if (!hasOldScenario && data.categories?.length) setScenarioId(data.categories[0].id);
              }
              return; // success
            }
          } catch { /* swallow and try dynamic import */ }
          const imported = await import(`../../data/vocab_${code}.json`);
          if (!cancelled) {
            const data = imported as VocabData;
            setVocab(data);
            const hasOldScenario = data.categories?.some((c: Category) => c.id === scenarioId);
            if (!hasOldScenario && data.categories?.length) setScenarioId(data.categories[0].id);
          }
          return;
        } catch (e) {
          // Try next code in attemptOrder
          if (code === attemptOrder[attemptOrder.length - 1]) {
            if (!cancelled) setError(e instanceof Error ? e.message : String(e));
          }
        }
      }
    }
    load(lang);
    return () => { cancelled = true; };
  }, [lang, scenarioId]);

  function toggleItem(id: string) {
    setSelectedItems(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id]);
  }

  async function generate(action: "generate"|"refine") {
    const customWords = customWordsRaw.split(/[,\n;]/).map(s=>s.trim()).filter(Boolean);
    if (selectedItems.length === 0 && customWords.length===0) {
      setError("Select at least one vocab item or add custom words.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, lang, level, scenarioId, itemIds: selectedItems, customWords, turns: DEFAULT_TURNS, style, instructions: extra, previousDialogue: dialogue })
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
  const voice = speaker.startsWith("A") ? voiceA : voiceB; // manually selected voices
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

  // Helper: English label for scenario/category id
  function englishCategoryLabel(id: string, fallback: string): string {
    const cat = enVocab?.categories.find(c=> c.id===id);
    return cat?.label || fallback;
  }

  // Filter out removed scenarios
  const filteredCategories = useMemo(()=> (vocab?.categories || []).filter(c=> !["doctor_visit","climate_action"].includes(c.id)), [vocab]);
  const scenario = filteredCategories.find(c=>c.id===scenarioId) || filteredCategories[0];
  const [sampledItems, setSampledItems] = useState<VocabItem[]>([]);
  const SAMPLE_SIZE = 5;
  // Helper for sampling vocab items (extracted so a reshuffle button can reuse it)
  function computeSampledItems(currentScenario: Category | undefined, currentLevel: Level): VocabItem[] {
    if (!currentScenario) return [];
    const levelOrder: Level[] = ["A1","A2","B1","B2","C1","C2"];
    const targetIdx = levelOrder.indexOf(currentLevel);
    function candidatesFor(idx: number) {
      if (!currentScenario) return [];
      return currentScenario.items.filter(it=> levelOrder.indexOf(it.cefr)===idx);
    }
    let candidates = candidatesFor(targetIdx);
    let radius = 1;
    while (candidates.length < 20 && (targetIdx - radius >= 0 || targetIdx + radius < levelOrder.length)) {
      if (targetIdx - radius >= 0) candidates = candidates.concat(candidatesFor(targetIdx - radius));
      if (targetIdx + radius < levelOrder.length) candidates = candidates.concat(candidatesFor(targetIdx + radius));
      radius++;
    }
    const map = new Map<string, VocabItem>();
    for (const it of candidates) { if (!map.has(it.id)) map.set(it.id, it); }
    const pool = Array.from(map.values()).slice(0, 20);
    const shuffled = [...pool].sort(()=> Math.random() - 0.5);
    return shuffled.slice(0, SAMPLE_SIZE);
  }

  // Build a new sample preserving currently selected items; fills the remaining slots with random others.
  function reshuffleSample() {
    if (!scenario) return;
    // Resolve selected item objects present in current scenario
    const selectedSet = new Set(selectedItems);
    const selectedObjs: VocabItem[] = scenario.items.filter(it => selectedSet.has(it.id));
    // If user selected more items than sample size, we keep only the first SAMPLE_SIZE (stable order based on their current order)
    const preserved = selectedObjs.slice(0, SAMPLE_SIZE);
    const remainingSlots = SAMPLE_SIZE - preserved.length;
    if (remainingSlots <= 0) {
      setSampledItems(preserved);
      // Do NOT clear selection – requirement: keep them selected.
      return;
    }
    // Candidate pool excludes already preserved items
    const preservedIds = new Set(preserved.map(p=>p.id));
    // Reuse compute logic to get a broader pool (without selection weight). We'll merge scenario items across levels similar to computeSampledItems.
    const basePool = computeSampledItems(scenario, level)
      // ensure we also have access to other scenario items if computeSampledItems missed some due to level targeting
      .concat(scenario.items.filter(it => !preservedIds.has(it.id)))
      .filter((it, idx, arr)=> arr.findIndex(x=>x.id===it.id)===idx) // dedupe
      .filter(it => !preservedIds.has(it.id));
    const shuffledPool = [...basePool].sort(()=> Math.random() - 0.5);
    const fillers = shuffledPool.slice(0, remainingSlots);
    // Combine preserved + fillers. We keep preserved items first for predictability.
    const nextSample = [...preserved, ...fillers];
    setSampledItems(nextSample);
    // Keep selection intact (do not modify selectedItems)
  }

  // Initial / reactive sampling
  useEffect(()=> {
    // On scenario/level/lang changes we recompute fresh sample and clear previous selections (intended UX when context changes).
    setSampledItems(computeSampledItems(scenario, level));
    setSelectedItems([]);
  }, [scenarioId, scenario, level, lang]);
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

  const customWordsCount = customWordsRaw.split(/[,\n;]/).map(s=>s.trim()).filter(Boolean).length;

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
  <h1 className="text-2xl font-semibold">{t('dialogue.title')}</h1>
      {seed && (
        <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-sm rounded p-3">
          <span className="font-medium">Seed sentence:</span> {seed}
        </div>
      )}
    <section className="space-y-4">
  <div className="grid md:grid-cols-3 gap-4">
          <label className="flex items-center gap-2"><span className="w-20">{t('common.language')}</span>
            <select className="border rounded p-2 flex-1" value={lang} onChange={e=>setLang(e.target.value)}>
              <option value="en">English</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="es">Spanish</option>
            </select>
          </label>
          <label className="flex items-center gap-2"><span className="w-20">{t('common.level')}</span>
            <select className="border rounded p-2 flex-1" value={level} onChange={e=>setLevel(e.target.value as Level)}>
              {(["A1","A2","B1","B2","C1","C2"] as Level[]).map(l=> <option key={l}>{l}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2"><span className="w-20">{t('common.scenario')}</span>
            <select className="border rounded p-2 flex-1" value={scenarioId} onChange={e=>setScenarioId(e.target.value)}>
              {filteredCategories.map(c=> <option key={c.id} value={c.id}>{englishCategoryLabel(c.id, c.label)}</option>)}
            </select>
          </label>
          {/* Voice selection now handled in a dedicated section below */}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <input className="border rounded p-2" placeholder={t('placeholders.styleTone')} value={style} onChange={e=>setStyle(e.target.value)} />
          <input className="border rounded p-2" placeholder={t('placeholders.extraInstructions')} value={extra} onChange={e=>setExtra(e.target.value)} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-medium">{t('dialogue.scenarioVocabulary')}</h2>
            <button type="button" onClick={reshuffleSample} className="text-xs px-2 py-1 border rounded hover:bg-indigo-50">
              {t('dialogue.reshuffle')}
            </button>
          </div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
            {sampledItems.map(it => {
              const active = selectedItems.includes(it.id);
              // English translation lookup (only show if current lang not English)
              let enTerm: string | undefined;
              if (lang !== 'en' && enVocab) {
                for (const cat of enVocab.categories) {
                  const match = cat.items.find(i=> i.id === it.id);
                  if (match) { enTerm = match.term; break; }
                }
              }
              return (
                <button key={it.id} type="button" onClick={()=>toggleItem(it.id)} className={`text-left border rounded p-2 text-sm hover:border-indigo-500 ${active?"bg-indigo-600 text-white border-indigo-600":"bg-white"}`}>
                  <div className="font-semibold">{it.term}</div>
                  <div className="opacity-80 text-xs">{it.cefr}</div>
                  {enTerm && <div className="mt-0.5 text-[11px] italic opacity-70">EN: {enTerm}</div>}
                  {it.hint && <div className="mt-1 text-[11px] opacity-70 line-clamp-2">{it.hint}</div>}
                </button>
              );
            })}
          </div>
          {sampledItems.length===0 && <div className="text-sm text-gray-600">No items.</div>}
          <div className="mt-4">
            <h3 className="font-medium mb-1">{t('dialogue.yourOwnWords')}</h3>
            <textarea
              value={customWordsRaw}
              onChange={e=>setCustomWordsRaw(e.target.value)}
              placeholder="Enter words or phrases separated by commas or new lines"
              className="w-full border rounded p-2 h-28 text-sm"
            />
            <div className="text-xs text-gray-500 mt-1">{t('dialogue.yourOwnWords.hint')}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={()=>generate("generate")} className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={loading || (selectedItems.length===0 && customWordsCount===0)}>{loading?"Working…":t('common.generate')}</button>
          <button onClick={()=>generate("refine")} className="px-4 py-2 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={loading || !dialogue}>{t('common.refine')}</button>
          <div className="text-sm opacity-70">{t('labels.selected')}: {selectedItems.length} | {t('labels.custom')}: {customWordsCount}</div>
          {error && <div className="text-red-600 text-sm whitespace-pre-wrap">{error}</div>}
        </div>
      </section>

      {dialogue && (
        <section className="space-y-4">
          {/* Manual Voice Selection Section (moved post-generation) */}
          <div className="border rounded p-4 bg-white shadow-sm">
            <h2 className="font-medium mb-2">{t('dialogue.chooseVoicesTitle')}</h2>
            <p className="text-xs text-gray-600 mb-3">{t('dialogue.chooseVoicesDescription')}</p>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {(VOICE_CANDIDATES[lang] || VOICE_CANDIDATES.default).map(vc => {
                const isA = vc === voiceA;
                const isB = vc === voiceB;
                return (
                  <div key={vc} className={`border rounded p-2 text-xs flex flex-col gap-2 ${isA || isB ? 'bg-indigo-50 border-indigo-400' : 'bg-white'}`}>
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-[11px] uppercase tracking-wide">{vc}</span>
                      {(isA || isB) && <span className="text-[10px] px-1 py-0.5 rounded bg-indigo-600 text-white">{isA? 'A':'B'}</span>}
                    </div>
                    <button
                      type="button"
                      onClick={async ()=> {
                        try {
                          setVoiceError(null);
                          const text = demoSentence(lang);
                          const res = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ text, lang, voice: vc, speed: 0.95, format: 'mp3' }) });
                          if (!res.ok) throw new Error(await res.text());
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const audio = new Audio(url);
                          audio.play().catch(()=>undefined);
                        } catch (e) {
                          setVoiceError(e instanceof Error ? e.message : String(e));
                        }
                      }}
                      className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-gray-800"
                    >Demo</button>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={()=> {
                          if (voiceB === vc) { setVoiceB(voiceA); }
                          setVoiceA(vc);
                        }}
                        className={`flex-1 px-2 py-1 rounded border text-[11px] ${isA? 'bg-indigo-600 text-white border-indigo-600':'bg-white hover:bg-indigo-50'}`}
                      >Set A</button>
                      <button
                        type="button"
                        onClick={()=> {
                          if (voiceA === vc) { setVoiceA(voiceB); }
                          setVoiceB(vc);
                        }}
                        className={`flex-1 px-2 py-1 rounded border text-[11px] ${isB? 'bg-indigo-600 text-white border-indigo-600':'bg-white hover:bg-indigo-50'}`}
                      >Set B</button>
                    </div>
                  </div>
                );
              })}
            </div>
            {voiceError && <div className="text-xs text-red-600 mt-2">{voiceError}</div>}
            <div className="mt-2 text-xs text-gray-600">{t('dialogue.currentVoices')}: A → <strong>{voiceA}</strong> | B → <strong>{voiceB}</strong></div>
          </div>
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">{t('dialogue.dialogueTitle')}</h2>
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
            <h3 className="font-medium mb-2">{t('dialogue.playbackSettings')}</h3>
            <div className="flex flex-wrap gap-4 items-center">
              <label className="flex items-center gap-2 text-sm">{t('common.speed')}
                <input type="range" min={0.5} max={1.25} step={0.05} value={ttsSpeed} onChange={e=>setTtsSpeed(parseFloat(e.target.value))} />
                <span className="tabular-nums">{ttsSpeed.toFixed(2)}x</span>
              </label>
              <label className="flex items-center gap-2 text-sm">{t('common.format')}
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
              <div className="text-xs text-gray-500 max-w-xs space-y-1">
                <div>Voices: A: {voiceA} | B: {voiceB}</div>
                <div className="opacity-70">You manually picked these from the preview list above.</div>
                <div>Audio cached per text/voice/speed. Use WAV for reliable gaps (MP3 concat may collapse them).</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button onClick={downloadFullDialogue} disabled={compiling || !dialogue} className="px-4 py-2 bg-purple-600 text-white rounded disabled:opacity-50 text-sm">{compiling?`Compiling ${compileProgress.done}/${compileProgress.total}`:t('dialogue.downloadFull')}</button>
              {compiling && <div className="text-xs text-gray-600">{t('dialogue.buildingCombined')}</div>}
              {!compiling && error && <div className="text-xs text-red-600 max-w-sm">{error}</div>}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

// Export wrapped in Suspense to satisfy Next.js requirement for hooks like useSearchParams in certain rendering modes.
export default function DialogueBuilder() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-600">Loading dialogue builder…</div>}>
      <DialogueBuilderInner />
    </Suspense>
  );
}
