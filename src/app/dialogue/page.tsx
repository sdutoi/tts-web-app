"use client";

import { useEffect, useRef, useState, useMemo, Suspense, useCallback } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useI18n } from '../../i18n/I18nProvider';
import { ProficiencySelector } from '../components/ProficiencySelector';
import logo from "../../../logo.png";

// Voice candidates per language (max 5 for demo selection). Order matters for initial defaults.
const VOICE_CANDIDATES: Record<string,string[]> = {
  en: ["ash","coral","alloy","echo","verse"],
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
interface VocabItem { id: string; term: string; cefr: Level; tags?: string[]; example?: string; hint?: string; translations?: Record<string,string>; }
interface Category { id: string; label: string; items: VocabItem[]; }
interface VocabData { language: string; categories: Category[]; }

interface DialogueTurn { speaker: string; text: string; vocabRefs: string[]; translation_en?: string; }
interface DialogueResponse { scenario: string; level: Level; turns: DialogueTurn[]; usedItems: string[]; notes?: string; }

function DialogueBuilderInner() {
  const { t } = useI18n();
  const search = useSearchParams();
  const qpLang = search.get("lang") || "en";
  const qpLevel = (search.get("level") as Level) || "A2";
  const seed = search.get("seed") || ""; // retain seed support for display
  const [showProficiencyPrompt, setShowProficiencyPrompt] = useState(!search.get('level'));
  const [level, setLevel] = useState<Level>(qpLevel);
  const [lang] = useState(qpLang); // selected previously on landing page; no UI to change here now
  const [vocab, setVocab] = useState<VocabData | null>(null);
  const [enVocab, setEnVocab] = useState<VocabData | null>(null); // English reference for translations
  const [scenarioId, setScenarioId] = useState<string>(""); // '' none selected
  const [customScenario, setCustomScenario] = useState("");
  const [showCustomScenarioModal, setShowCustomScenarioModal] = useState(false);
  const [customScenarioDraft, setCustomScenarioDraft] = useState("");
  const [prevScenarioId, setPrevScenarioId] = useState<string | null>(null);
  const [customScenarioError, setCustomScenarioError] = useState<string | null>(null);
  const isCustomScenario = scenarioId === '__custom__';
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [style, setStyle] = useState("");
  const [extra, setExtra] = useState("");
  const [customWordsRaw, setCustomWordsRaw] = useState("");
  // Creativity (temperature) control: align with API clamp [0, 1.5]
  const [creativity, setCreativity] = useState<number>(0.8);
  // Dialogue length selector: short=4, medium=6, long=8
  type LengthChoice = 'short' | 'medium' | 'long';
  const [lengthChoice, setLengthChoice] = useState<LengthChoice>('medium');
  const TURNS_BY_LENGTH: Record<LengthChoice, number> = { short: 4, medium: 6, long: 8 };
  const [dialogue, setDialogue] = useState<DialogueResponse | null>(null);
  const [finalized, setFinalized] = useState(false);
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
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [dragOverA, setDragOverA] = useState(false);
  const [dragOverB, setDragOverB] = useState(false);
  const [showTranslateModal, setShowTranslateModal] = useState(false);
  const [translateLoading, setTranslateLoading] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translated, setTranslated] = useState<{ lang: 'en'|'de'; turns: { speaker: string; original: string; translation: string; notes?: string }[] } | null>(null);

  // Simple in-memory client audio cache
  const audioCache = useRef<Map<string, string>>(new Map()); // key -> objectURL
  const voiceDemoCache = useRef<Map<string, string>>(new Map()); // voice+lang -> objectURL

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
        // Use the high school English set as canonical reference for labels/IDs
        const path = '/src/data/vocab_en_hs.json';
        const res = await fetch(path);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setEnVocab(data);
          return;
        }
      } catch {/* ignore */}
      try {
        const imported = await import('../../data/vocab_en_hs.json');
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
  // Map languages to specific vocab files when needed. Use HS sets for French and English.
  const fileLang = (code: string) => (code === 'fr' ? 'fr_hs' : code === 'en' ? 'en_hs' : code);
      const attemptOrder = [langCode, "en"] as string[]; // fallback to English
      for (const code of attemptOrder) {
        try {
          // First try fetch (works if statically served). If that fails, dynamic import.
          const fetchPath = `/src/data/vocab_${fileLang(code)}.json`;
          try {
            const res = await fetch(fetchPath);
            if (res.ok) {
              const data = await res.json();
              if (!cancelled) {
                setVocab(data);
                // Reset scenario to first category of new vocab unless existing id still present.
                // Keep placeholder; do not auto-select first scenario
              }
              return; // success
            }
          } catch { /* swallow and try dynamic import */ }
          const imported = await import(`../../data/vocab_${fileLang(code)}.json`);
          if (!cancelled) {
            const data = imported as VocabData;
            setVocab(data);
            // Keep placeholder; do not auto-select
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

  const [refineNotes, setRefineNotes] = useState("");

  const { uiLang } = useI18n();

  async function openTranslateModal() {
    if (!dialogue) return;
    setShowTranslateModal(true);
    setTranslateLoading(true);
    setTranslateError(null);
    setTranslated(null);
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uiLang, dialogue: { scenario: dialogue.scenario, level: dialogue.level, turns: dialogue.turns.map(t=> ({ speaker: t.speaker, text: t.text })) } })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setTranslated(data);
    } catch (e: unknown) {
      setTranslateError(e instanceof Error ? e.message : String(e));
    } finally {
      setTranslateLoading(false);
    }
  }

  function copyAllTranslated() {
    if (!translated) return;
    const lines = translated.turns.map(t => `${t.speaker}: ${t.original}\n${t.translation}${t.notes ? `\n(${t.notes})` : ''}`);
    const full = lines.join('\n\n');
    navigator.clipboard.writeText(full).catch(()=>{/* ignore */});
  }

  async function generate(action: "generate"|"refine") {
  const customWords = customWordsRaw.split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean);
    setLoading(true);
    setError(null);
    setFinalized(false);
    try {
      const res = await fetch("/api/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          lang,
          level,
          scenarioId,
          customScenario: isCustomScenario ? customScenario : undefined,
          itemIds: selectedItems,
            customWords,
          turns: TURNS_BY_LENGTH[lengthChoice],
          style,
          instructions: extra,
          temperature: creativity,
          previousDialogue: dialogue,
          refineNotes: action==='refine'? refineNotes: undefined
        })
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

  async function downloadTurn(idx: number, text: string, speaker: string) {
    try {
      const { arrayBuffer } = await ensureAudio({ text, speaker });
      const type = ttsFormat === 'mp3' ? 'audio/mpeg' : ttsFormat === 'ogg' ? 'audio/ogg' : 'audio/wav';
      const blob = new Blob([arrayBuffer], { type });
      const safeSpeaker = (speaker || '').toUpperCase() || ((idx % 2 === 0) ? 'A' : 'B');
      triggerDownload(blob, `turn_${(idx+1).toString().padStart(2,'0')}_${safeSpeaker}.${ttsFormat}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
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

  // Prefetch short demo clips for each candidate voice (once per language)
  useEffect(()=> {
    let cancelled = false;
    const voices = VOICE_CANDIDATES[lang] || VOICE_CANDIDATES.default;
    async function prefetch() {
      for (const v of voices) {
        const key = `${lang}|${v}`;
        if (voiceDemoCache.current.has(key)) continue;
        try {
          const text = demoSentence(lang);
          const res = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ text, lang, voice: v, speed: 0.95, format: 'mp3' }) });
          if (!res.ok) continue;
          const blob = await res.blob();
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          voiceDemoCache.current.set(key, url);
        } catch { /* ignore individual failures */ }
      }
    }
    prefetch();
    return ()=> { cancelled = true; };
  }, [lang]);
  function englishCategoryLabel(id: string, fallback: string): string {
    const cat = enVocab?.categories.find(c=> c.id===id);
    return cat?.label || fallback;
  }

  // Filtered categories (could add further filtering later)
  const filteredCategories = useMemo(()=> (vocab?.categories ?? []), [vocab]);

  // Selected scenario object
  const scenario = useMemo(()=> filteredCategories.find(c=> c.id === scenarioId), [filteredCategories, scenarioId]);

  // Helper for sampling vocab items
  function levelGroup(l: Level): Level[] {
    if (l === 'A1' || l === 'A2') return ['A1','A2'];
    if (l === 'B1' || l === 'B2') return ['B1','B2'];
    return [l];
  }

  const computeSampledItems = useCallback((currentScenario: Category | undefined, currentLevel: Level, nonce: number): VocabItem[] => {
    if (!currentScenario) return [];
    const poolLevels = new Set(levelGroup(currentLevel));
    const pool = currentScenario.items.filter(it => poolLevels.has(it.cefr));
    // Deterministic shuffle by nonce: rotate by (nonce mod length)
    const arr = [...pool];
    if (arr.length === 0) return arr;
    const k = nonce % arr.length;
    const rotated = arr.slice(k).concat(arr.slice(0, k));
    return rotated.slice(0, 12);
  }, []);

  const [sampleNonce, setSampleNonce] = useState(0);
  const sampledItems = useMemo(()=> computeSampledItems(scenario, level, sampleNonce), [computeSampledItems, scenario, level, sampleNonce]);
  const reshuffleSample = () => setSampleNonce(n=>n+1);

  // Full dialogue download build state
  const [compiling, setCompiling] = useState(false);
  const [compileProgress, setCompileProgress] = useState<{done:number; total:number}>({ done: 0, total: 0 });

  async function downloadFullDialogue() {
    if (!dialogue) return;
    setCompiling(true);
    setError(null);
    try {
      const encoded: ArrayBuffer[] = [];
      setCompileProgress({ done: 0, total: dialogue.turns.length });
      for (let i=0;i<dialogue.turns.length;i++) {
        const turn = dialogue.turns[i];
        const sp = turn.speaker || (i % 2 === 0 ? 'A' : 'B');
        const { arrayBuffer } = await ensureAudio({ text: turn.text, speaker: sp });
        encoded.push(arrayBuffer);
        setCompileProgress({ done: i+1, total: dialogue.turns.length });
      }
      if (ttsFormat === 'mp3') {
        const joined = concatenateMp3(encoded);
        const ab = new ArrayBuffer(joined.byteLength);
        new Uint8Array(ab).set(joined);
        const blob = new Blob([ab], { type: 'audio/mpeg' });
        triggerDownload(blob, `dialogue_${lang}_${level}.mp3`);
      } else {
        const wav = await buildWavWithSilence(encoded, gapSeconds);
        const blob = new Blob([wav], { type: 'audio/wav' });
        triggerDownload(blob, `dialogue_${lang}_${level}.wav`);
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
      <main className="min-h-screen bg-gray-100">
        {showProficiencyPrompt && (
          <ProficiencySelector
            lang={lang}
            initialLevel={undefined}
            onConfirm={(lev)=> { setLevel(lev); setShowProficiencyPrompt(false); }}
          />
        )}
        <div className="max-w-5xl mx-auto p-6 space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Image src={logo} alt="Logo" width={36} height={36} className="rounded" />
            </div>
            <Link href="/" className="text-sm inline-flex items-center gap-1 px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-white transition-colors bg-gray-50">
              <span>← {t('nav.home')}</span>
            </Link>
          </div>
      {seed && (
        <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-sm rounded p-3">
          <span className="font-medium">{t('seed.sentence')}</span> {seed}
        </div>
      )}
    <section className="space-y-4">
        <div className="grid md:grid-cols-3 gap-4 items-start">
          <div className="col-span-3 md:col-span-2 lg:col-span-1">
            <select
              className={`border rounded p-2 w-full ${(!scenarioId || scenarioId==='') ? 'italic text-gray-600' : 'text-gray-800'}`}
              value={scenarioId}
              onChange={(e)=> {
                const val = e.target.value;
                if (val === '__custom__') {
                  setPrevScenarioId(scenarioId || null);
                  setScenarioId('__custom__');
                  setCustomScenarioDraft(customScenario || '');
                  setCustomScenarioError(null);
                  setShowCustomScenarioModal(true);
                } else {
                  setScenarioId(val);
                }
              }}
            >
              <option value="" disabled hidden>{t('dialogue.pickScenario')}</option>
              {filteredCategories.map(c=> (
                <option key={c.id} value={c.id}>{englishCategoryLabel(c.id, c.label)}</option>
              ))}
              <option value="__custom__">{t('dialogue.ownScenario')}</option>
            </select>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <input className="border rounded p-2" placeholder={t('placeholders.styleTone')} value={style} onChange={e=>setStyle(e.target.value)} />
          <input className="border rounded p-2" placeholder={t('placeholders.extraInstructions')} value={extra} onChange={e=>setExtra(e.target.value)} />
        </div>
        <div className="grid md:grid-cols-3 gap-4 items-center">
          <label className="flex items-center gap-2 text-sm col-span-2 md:col-span-1">
            <span className="w-28">{t('dialogue.creativity')}</span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={creativity}
              onChange={e=>setCreativity(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="w-12 text-right tabular-nums">{creativity.toFixed(2)}</span>
          </label>
          <div className="text-xs text-gray-500 col-span-2 md:col-span-1">{t('dialogue.creativityHint')}</div>
          <div className="flex items-center gap-2 text-sm col-span-2 md:col-span-1">
            <span className="w-20">{t('dialogue.length')}</span>
            <div className="inline-flex rounded border overflow-hidden">
              <button type="button" onClick={()=>setLengthChoice('short')} className={`px-3 py-1 ${lengthChoice==='short'?'bg-indigo-600 text-white':'bg-white hover:bg-indigo-50'}`}>{t('dialogue.length.short')}</button>
              <button type="button" onClick={()=>setLengthChoice('medium')} className={`px-3 py-1 border-l ${lengthChoice==='medium'?'bg-indigo-600 text-white':'bg-white hover:bg-indigo-50'}`}>{t('dialogue.length.medium')}</button>
              <button type="button" onClick={()=>setLengthChoice('long')} className={`px-3 py-1 border-l ${lengthChoice==='long'?'bg-indigo-600 text-white':'bg-white hover:bg-indigo-50'}`}>{t('dialogue.length.long')}</button>
            </div>
          </div>
        </div>
        <div>
          {(!scenarioId || isCustomScenario) ? null : (
            <>
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-medium">{t('dialogue.scenarioVocabulary')}</h2>
                <button type="button" onClick={reshuffleSample} className="text-xs px-2 py-1 border rounded hover:bg-indigo-50" disabled={!scenario}>{t('dialogue.reshuffle')}</button>
              </div>
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
                {sampledItems.map(it => {
                  const active = selectedItems.includes(it.id);
                  let enTerm: string | undefined;
                  if (lang !== 'en') {
                    // Prefer English from reference vocab when aligned IDs exist
                    if (enVocab) {
                      for (const cat of enVocab.categories) {
                        const match = cat.items.find(i=> i.id === it.id);
                        if (match) { enTerm = match.term; break; }
                      }
                    }
                    // Fallback to inline translation metadata (schema v2)
                    if (!enTerm && it.translations && typeof it.translations.en === 'string') {
                      enTerm = it.translations.en;
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
              {sampledItems.length===0 && scenarioId && <div className="text-sm text-gray-600 mt-1">{t('common.noItems')}</div>}
            </>
          )}
          {!scenarioId && <div className="text-sm text-gray-500 italic">{t('dialogue.pickScenarioHint')}</div>}
          <div className="mt-4">
            <h3 className="font-medium mb-1">{t('dialogue.yourOwnWords')}</h3>
            <textarea
              value={customWordsRaw}
              onChange={e=>setCustomWordsRaw(e.target.value)}
              placeholder={t('dialogue.customWords.placeholder')}
              className="w-full border rounded p-2 h-28 text-sm"
            />
            <div className="text-xs text-gray-500 mt-1">{t('dialogue.yourOwnWords.hint')}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={()=>generate("generate")} className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={loading}>{loading?t('common.loading'):t('common.generate')}</button>
          <div className="text-sm opacity-70">{t('labels.selected')}: {selectedItems.length} | {t('labels.custom')}: {customWordsCount}</div>
          {error && <div className="text-red-600 text-sm whitespace-pre-wrap">{error}</div>}
        </div>
      </section>

      {dialogue && (
        <section className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">{t('dialogue.dialogueTitle')}</h2>
            {dialogue.notes && <div className="text-sm italic opacity-75 max-w-md hidden md:block">{dialogue.notes}</div>}
          </div>
          <div className="space-y-3">
            {dialogue.turns.map((turn, i) => (
              <div key={i} className="border rounded p-3 bg-white shadow-sm">
                <div className="flex justify-between items-center mb-1">
                  <div className="font-semibold">{turn.speaker || (i % 2 === 0 ? "A" : "B")}</div>
                  {finalized && (
                    <div className="flex gap-2 items-center">
                      <button onClick={()=>ttsTurn(i, turn.text, turn.speaker || (i % 2 === 0 ? "A" : "B"))} className="text-xs px-2 py-1 rounded bg-indigo-600 text-white disabled:opacity-50" disabled={playingTurn!==null}>{playingTurn===i?"…":t('common.audio')}</button>
                      <button onClick={()=>downloadTurn(i, turn.text, turn.speaker || (i % 2 === 0 ? "A" : "B"))} className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50">{t('common.download')}</button>
                      <audio ref={(el) => { audioRefs.current[i] = el; }} className="hidden" />
                    </div>
                  )}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">{turn.text}</div>
                {turn.translation_en && <div className="mt-1 text-sm text-gray-600">{turn.translation_en}</div>}
                {turn.vocabRefs?.length>0 && (
                  <div className="mt-2 flex flex-wrap gap-1 text-xs">
                    {turn.vocabRefs.map(v=> <span key={v} className="px-2 py-0.5 rounded bg-gray-100 border text-gray-700">{v}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-6 border-t pt-4 space-y-4">
            <div>
              <h3 className="font-medium mb-1">{t('dialogue.refineTitle')}</h3>
              <textarea
                value={refineNotes}
                onChange={e=>setRefineNotes(e.target.value)}
                placeholder={t('dialogue.refinePlaceholder')}
                className="w-full border rounded p-2 h-32 text-sm"
              />
              <div className="flex gap-2 mt-2">
                <button onClick={()=>generate("refine")} className="px-4 py-2 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={loading || !dialogue}>{loading?t('common.loading'):t('common.refine')}</button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {!finalized && (
                <button
                  type="button"
                  onClick={()=> { setFinalized(true); setShowVoiceModal(true); }}
                  className="text-sm px-3 py-1.5 rounded bg-emerald-600 text-white"
                >{t('dialogue.finalizeCTA')}</button>
              )}
              {finalized && (
                <button
                  type="button"
                  onClick={()=> setShowVoiceModal(true)}
                  className="text-sm px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50"
                >{t('dialogue.chooseVoicesButton')}</button>
              )}
              {dialogue && (
                <button
                  type="button"
                  onClick={openTranslateModal}
                  className="text-sm px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50"
                  title={t('dialogue.translateExplainHint')}
                >{t('dialogue.translateExplain')}</button>
              )}
            </div>
          </div>
          {finalized && (
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
                  <option value="wav">WAV</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">{t('dialogue.gap')}
                <input type="range" min={0} max={3} step={0.25} value={gapSeconds} onChange={e=>setGapSeconds(parseFloat(e.target.value))} />
                <span className="tabular-nums w-8 text-right">{gapSeconds.toFixed(2)}s</span>
              </label>
              <div className="text-xs text-gray-500 max-w-xs space-y-1">
                <div>{t('dialogue.voicesLabel')}: A: {voiceA} | B: {voiceB}</div>
                <div className="opacity-70">{t('dialogue.voicesPickedNote')}</div>
                <div>{t('dialogue.audioCacheNote')}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button onClick={downloadFullDialogue} disabled={compiling || !dialogue} className="px-4 py-2 bg-purple-600 text-white rounded disabled:opacity-50 text-sm">{compiling?t('dialogue.compiling', { done: compileProgress.done, total: compileProgress.total }):t('dialogue.downloadFull')}</button>
              {compiling && <div className="text-xs text-gray-600">{t('dialogue.buildingCombined')}</div>}
              {!compiling && error && <div className="text-xs text-red-600 max-w-sm">{error}</div>}
            </div>
          </div>
          )}
        </section>
      )}
      </div>
      {showCustomScenarioModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold">{t('dialogue.customScenarioTitle')}</h2>
            <textarea
              autoFocus
              value={customScenarioDraft}
              onChange={e=> setCustomScenarioDraft(e.target.value)}
              placeholder={t('dialogue.customScenarioPlaceholder')}
              className="w-full border rounded p-3 h-40 text-sm resize-none"
            />
            {customScenarioError && <div className="text-xs text-red-600">{customScenarioError}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50"
                onClick={()=> {
                  setShowCustomScenarioModal(false);
                  if (prevScenarioId) {
                    setScenarioId(prevScenarioId);
                  } else {
                    setScenarioId('');
                  }
                }}
              >{t('common.cancel')}</button>
              <button
                type="button"
                className="px-4 py-1.5 text-sm rounded bg-indigo-600 text-white disabled:opacity-50"
                onClick={()=> {
                  const trimmed = customScenarioDraft.trim();
                  if (trimmed.length < 5) { setCustomScenarioError(t('errors.moreDetail')); return; }
                  setCustomScenario(trimmed);
                  setShowCustomScenarioModal(false);
                }}
              >{t('common.confirm')}</button>
            </div>
          </div>
        </div>
      )}

      {showVoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t('dialogue.chooseVoicesTitle')}</h2>
              <button onClick={()=> setShowVoiceModal(false)} className="text-sm px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">{t('common.close')}</button>
            </div>
            <p className="text-sm text-gray-600">{t('dialogue.chooseVoicesDescription')}</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div
                onDragOver={(e)=> { e.preventDefault(); setDragOverA(true); }}
                onDragLeave={()=> setDragOverA(false)}
                onDrop={(e)=> {
                  e.preventDefault();
                  setDragOverA(false);
                  const v = e.dataTransfer.getData('text/voice');
                  if (!v) return;
                  if (voiceB === v) { setVoiceB(voiceA); }
                  setVoiceA(v);
                }}
                className={`relative rounded border-2 p-4 h-24 flex flex-col items-center justify-center text-center transition ${dragOverA ? 'border-indigo-500 bg-indigo-50' : 'border-dashed border-gray-300 bg-gray-50'}`}
              >
                <div className="text-xs uppercase tracking-wide font-semibold text-gray-600 mb-1">{t('dialogue.speakerA')}</div>
                <div className="font-bold text-sm">{voiceA || <span className="italic text-gray-500">{t('dialogue.dragVoiceHere')}</span>}</div>
              </div>
              <div
                onDragOver={(e)=> { e.preventDefault(); setDragOverB(true); }}
                onDragLeave={()=> setDragOverB(false)}
                onDrop={(e)=> {
                  e.preventDefault();
                  setDragOverB(false);
                  const v = e.dataTransfer.getData('text/voice');
                  if (!v) return;
                  if (voiceA === v) { setVoiceA(voiceB); }
                  setVoiceB(v);
                }}
                className={`relative rounded border-2 p-4 h-24 flex flex-col items-center justify-center text-center transition ${dragOverB ? 'border-indigo-500 bg-indigo-50' : 'border-dashed border-gray-300 bg-gray-50'}`}
              >
                <div className="text-xs uppercase tracking-wide font-semibold text-gray-600 mb-1">{t('dialogue.speakerB')}</div>
                <div className="font-bold text-sm">{voiceB || <span className="italic text-gray-500">{t('dialogue.dragVoiceHere')}</span>}</div>
              </div>
            </div>
            <div className="text-xs text-gray-500">{t('dialogue.chooseVoicesDescription')}</div>
            <div className="flex flex-wrap gap-2">
              {(VOICE_CANDIDATES[lang] || VOICE_CANDIDATES.default).map(vc => {
                const assigned = vc === voiceA || vc === voiceB;
                return (
                  <button
                    key={vc}
                    type="button"
                    draggable
                    onDragStart={(e)=> {
                      e.dataTransfer.setData('text/voice', vc);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={async ()=> {
                      try {
                        setVoiceError(null);
                        const key = `${lang}|${vc}`;
                        let url = voiceDemoCache.current.get(key);
                        if (!url) {
                          const staticPath = `/demos/${lang}_${vc}.mp3`;
                          try {
                            const head = await fetch(staticPath, { method: 'HEAD' });
                            if (head.ok) url = staticPath;
                          } catch {/* ignore */}
                          if (!url) {
                            const text = demoSentence(lang);
                            const res = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ text, lang, voice: vc, speed: 0.95, format: 'mp3' }) });
                            if (!res.ok) throw new Error(await res.text());
                            const blob = await res.blob();
                            url = URL.createObjectURL(blob);
                          }
                          voiceDemoCache.current.set(key, url);
                        }
                        const audio = new Audio(url);
                        audio.play().catch(()=>undefined);
                      } catch (e) {
                        setVoiceError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                    className={`px-3 py-2 rounded border text-xs font-semibold tracking-wide uppercase select-none transition shadow-sm ${assigned ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white hover:bg-indigo-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-indigo-500`}
                    title={t('dialogue.voiceChipTitle')}
                  >{vc}</button>
                );
              })}
            </div>
            {voiceError && <div className="text-xs text-red-600 mt-1">{voiceError}</div>}
            <div className="flex justify-end pt-2">
              <button onClick={()=> setShowVoiceModal(false)} className="px-4 py-1.5 rounded bg-indigo-600 text-white text-sm">{t('common.done')}</button>
            </div>
          </div>
        </div>
      )}

      {showTranslateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t('dialogue.translateExplain')}</h2>
              <div className="flex items-center gap-2">
                <button onClick={copyAllTranslated} className="text-sm px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">{t('dialogue.copyAll')}</button>
                <button onClick={()=> setShowTranslateModal(false)} className="text-sm px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">{t('common.close')}</button>
              </div>
            </div>
            {translateLoading && <div className="text-sm text-gray-600">{t('common.loading')}</div>}
            {translateError && <div className="text-sm text-red-600">{translateError}</div>}
            {translated && (
              <div className="space-y-3 select-text">
                {translated.turns.map((tr, i) => (
                  <div key={i} className="border rounded p-3 bg-white">
                    <div className="text-xs font-semibold mb-1">{tr.speaker}</div>
                    <div className="text-sm whitespace-pre-wrap">{tr.original}</div>
                    <div className="text-sm mt-1 text-gray-700"><span className="font-medium">{t('dialogue.translation')}:</span> {tr.translation}</div>
                    {tr.notes && <div className="text-xs mt-1 text-gray-500"><span className="font-medium">{t('dialogue.explanation')}:</span> {tr.notes}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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
