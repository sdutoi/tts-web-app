"use client";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";

type Level = "A1"|"A2"|"B1"|"B2"|"C1"; // deliberately omit C2 for initial comfort selection

export interface SampleSet {
  level: Level;
  sentence: string;
  translation?: string;
}

interface Props {
  lang: string; // target language code
  onConfirm: (level: Level) => void;
  initialLevel?: Level; // preselected level if user already chose
  samplesProvider?: (lang: string) => Promise<SampleSet[]> | SampleSet[]; // override for tests
}

// Basic default samples. Everyday-life sentences (non-topic-specific).
const STATIC_SAMPLES: Record<string, Record<Level, string>> = {
  en: {
    A1: "I have a cat and two plants.",
    A2: "I usually walk to school when the weather is nice.",
    B1: "I'm trying to manage my time better during the week.",
    B2: "Could you suggest a practical way to stay focused after lunch?",
    C1: "I'm fascinated by how small daily habits compound into long-term change."
  },
  fr: {
    A1: "J'ai un chat et deux plantes.",
    A2: "Je vais souvent au lycée à pied quand il fait beau.",
    B1: "J'essaie d'organiser mon temps pendant la semaine.",
    B2: "Peux-tu proposer une méthode concrète pour rester concentré après le déjeuner ?",
    C1: "Je trouve fascinant la façon dont de petites habitudes quotidiennes s'accumulent en changements durables."
  },
  de: {
    A1: "Ich habe eine Katze und zwei Pflanzen.",
    A2: "Ich gehe oft zu Fuß zur Schule, wenn das Wetter gut ist.",
    B1: "Ich versuche, meine Zeit unter der Woche besser zu planen.",
    B2: "Kannst du eine praktische Methode empfehlen, um nach dem Mittag konzentriert zu bleiben?",
    C1: "Mich fasziniert, wie kleine tägliche Gewohnheiten langfristige Veränderungen bewirken."
  },
  es: {
    A1: "Tengo un gato y dos plantas.",
    A2: "Suelo ir al instituto a pie cuando hace buen tiempo.",
    B1: "Intento organizar mejor mi tiempo durante la semana.",
    B2: "¿Puedes sugerir una manera práctica de mantener la concentración después de comer?",
    C1: "Me fascina cómo los pequeños hábitos diarios se convierten en cambios a largo plazo."
  },
  it: {
    A1: "Ho un gatto e due piante.",
    A2: "Di solito vado a scuola a piedi quando c'è bel tempo.",
    B1: "Sto cercando di gestire meglio il tempo durante la settimana.",
    B2: "Puoi suggerire un modo pratico per restare concentrato dopo pranzo?",
    C1: "Mi affascina come le piccole abitudini quotidiane si trasformino in cambiamenti duraturi."
  }
};

function defaultSamples(lang: string): SampleSet[] {
  const map = STATIC_SAMPLES[lang] || STATIC_SAMPLES.en;
  return (Object.keys(map) as Level[]).map(l => ({ level: l, sentence: map[l] }));
}

export function ProficiencySelector({ lang, onConfirm, initialLevel, samplesProvider }: Props) {
  const { t } = useI18n();
  const [choice, setChoice] = useState<Level | undefined>(initialLevel);
  const [samples, setSamples] = useState<SampleSet[]>([]);
  const [confirmed, setConfirmed] = useState<boolean>(!!initialLevel);

  useEffect(()=> {
    let active = true;
    async function load() {
      try {
        const data = samplesProvider ? await samplesProvider(lang) : defaultSamples(lang);
        if (active) setSamples(data);
      } catch {
        if (active) setSamples(defaultSamples(lang));
      }
    }
    load();
    return ()=> { active = false; };
  }, [lang, samplesProvider]);

  if (confirmed) return null; // do not show once confirmed

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">{t('proficiency.title')}</h2>
        <p className="text-sm text-gray-600">{t('proficiency.description')}</p>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
          {samples.map(s => {
            const active = choice === s.level;
            return (
              <button
                key={s.level}
                type="button"
                onClick={()=> setChoice(s.level)}
                className={`text-left border rounded-lg p-3 text-sm transition group ${active? 'bg-indigo-600 text-white border-indigo-600 shadow':'bg-white hover:border-indigo-400'}`}
              >
                <div className="font-semibold mb-1">{s.level}</div>
                <div className="leading-snug whitespace-pre-wrap">{s.sentence}</div>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={()=> setConfirmed(true)}
            className="text-xs px-3 py-2 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
          >{t('proficiency.skip')}</button>
          <button
            disabled={!choice}
            type="button"
            onClick={()=> { if (!choice) return; setConfirmed(true); onConfirm(choice); }}
            className="text-xs px-4 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
          >{t('proficiency.confirm')}</button>
        </div>
      </div>
    </div>
  );
}
