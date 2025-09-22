"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from '../i18n/I18nProvider';
import { LanguageToggle } from '../components/LanguageToggle';

type Lang = "en" | "de" | "fr" | "it" | "es";

interface LevelSentence { level: string; text: string; }

const SENTENCE_BANK: Record<Lang, LevelSentence[]> = {
  en: [
    { level: "A1", text: "Hello, how are you today?" },
    { level: "A2", text: "I usually take the bus to work in the morning." },
    { level: "B1", text: "Learning regularly helps me build confidence in conversations." },
    { level: "B2", text: "She outlined several compelling reasons to reconsider the plan." },
    { level: "C1", text: "Balancing clarity with nuance is essential in persuasive writing." },
  ],
  de: [
    { level: "A1", text: "Guten Morgen! Wie geht es dir?" },
    { level: "A2", text: "Am Wochenende besuche ich oft meine Freunde." },
    { level: "B1", text: "Regelmäßiges Üben macht mich beim Sprechen viel sicherer." },
    { level: "B2", text: "Er erklärte die Situation ausführlich und sehr überzeugend." },
    { level: "C1", text: "Zwischen den Zeilen erkennt man die eigentliche Absicht des Autors." },
  ],
  fr: [
    { level: "A1", text: "Bonjour, tu vas bien ?" },
    { level: "A2", text: "Le soir, je prépare un dîner simple pour ma famille." },
    { level: "B1", text: "Pratiquer un peu chaque jour améliore vraiment ma fluidité." },
    { level: "B2", text: "Elle a présenté un argument solide et nuancé." },
    { level: "C1", text: "La subtilité des expressions enrichit la compréhension du texte." },
  ],
  it: [
    { level: "A1", text: "Ciao! Come stai oggi?" },
    { level: "A2", text: "La sera guardo spesso un film con mia sorella." },
    { level: "B1", text: "Studiare con costanza rende le conversazioni più naturali." },
    { level: "B2", text: "Ha descritto la situazione in modo chiaro e convincente." },
    { level: "C1", text: "Cogliere le sfumature linguistiche richiede attenzione continua." },
  ],
  es: [
    { level: "A1", text: "¡Hola! ¿Cómo estás hoy?" },
    { level: "A2", text: "Por la tarde suelo caminar con mi perro." },
    { level: "B1", text: "Practicar a diario hace que hablar sea más sencillo." },
    { level: "B2", text: "Explicó la situación con detalle y mucha claridad." },
    { level: "C1", text: "Interpretar los matices depende del contexto y la intención." },
  ],
};

export default function Home() {
  const { t } = useI18n();
  const [stage, setStage] = useState<"language" | "level">("language");
  const [language, setLanguage] = useState<Lang | null>(null);
  const router = useRouter();

  function pickLanguage(l: Lang) {
    setLanguage(l);
    setStage("level");
  }

  function chooseSentence(s: LevelSentence) {
    // Navigate to dialogue page with selected lang + level + seed sentence
    const url = new URL(window.location.origin + "/dialogue");
    url.searchParams.set("lang", language!);
    url.searchParams.set("level", s.level);
    url.searchParams.set("seed", s.text);
    router.push(url.pathname + "?" + url.searchParams.toString());
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-8 relative">
      <div className="absolute top-4 right-4"><LanguageToggle /></div>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('landing.title')}</h1>
        <p className="text-gray-600 text-sm leading-relaxed">{t('landing.subtitle')}</p>
      </header>

      {stage === "language" && (
        <section className="grid sm:grid-cols-3 md:grid-cols-5 gap-4">
          {(["en","fr","de","it","es"] as Lang[]).map(l => (
            <button key={l} onClick={()=>pickLanguage(l)} className="border rounded-lg p-4 hover:border-indigo-500 flex flex-col items-center gap-2 bg-white shadow-sm">
              <span className="text-lg font-medium uppercase">{l}</span>
              <span className="text-xs tracking-wide text-gray-600">{l === 'en' ? 'English' : l === 'fr' ? 'Français' : l === 'de' ? 'Deutsch' : l === 'it' ? 'Italiano' : 'Español'}</span>
            </button>
          ))}
        </section>
      )}

      {stage === "level" && language && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{t('landing.pickSentence')}</h2>
            <button className="text-sm text-indigo-600 underline" onClick={()=>{ setStage("language"); setLanguage(null); }}>{t('landing.changeLanguage')}</button>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {SENTENCE_BANK[language].map(s => (
              <button key={s.level} onClick={()=>chooseSentence(s)} className="text-left border rounded p-4 bg-white hover:border-indigo-500 shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Level {s.level}</span>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{s.text}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <footer className="pt-8 text-sm text-gray-500 flex flex-wrap gap-4">
        <a className="underline" href="/story">{t('footer.storyAssistant')}</a>
        <a className="underline" href="/dialogue">{t('footer.dialogueBuilder')}</a>
        <a className="underline" href="https://" target="_blank" rel="noreferrer">{t('footer.docs')}</a>
      </footer>
    </main>
  );
}
