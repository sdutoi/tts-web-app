"use client";
import { useI18n } from '../i18n/I18nProvider';

export function LanguageToggle() {
  const { uiLang, setUiLang } = useI18n();
  return (
    <div className="flex gap-2 items-center">
      <button
        aria-label="English UI"
        onClick={()=>setUiLang('en')}
        className={`w-7 h-5 rounded overflow-hidden ring-1 ring-gray-300 flex items-center justify-center text-xs ${uiLang==='en'?'bg-indigo-600 text-white':'bg-white'}`}
      >🇬🇧</button>
      <button
        aria-label="Deutsche Oberfläche"
        onClick={()=>setUiLang('de')}
        className={`w-7 h-5 rounded overflow-hidden ring-1 ring-gray-300 flex items-center justify-center text-xs ${uiLang==='de'?'bg-indigo-600 text-white':'bg-white'}`}
      >🇩🇪</button>
    </div>
  );
}
