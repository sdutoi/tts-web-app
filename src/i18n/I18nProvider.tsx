"use client";
import React, { createContext, useContext, useEffect, useState } from 'react';
import { translate, UILang } from './translations';

interface I18nContextValue {
  uiLang: UILang;
  setUiLang: (l: UILang)=>void;
  t: (key: string, vars?: Record<string,string|number>) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

interface ProviderProps { children: React.ReactNode; initialLang?: UILang; }

export function I18nProvider({ children, initialLang = 'en' }: ProviderProps) {
  const [uiLang, setUiLangState] = useState<UILang>(initialLang);

  function setUiLang(l: UILang) {
    setUiLangState(l);
    try {
      localStorage.setItem('uiLang', l);
      // Set a simple cookie for server-side layout use (expires ~1 year)
      document.cookie = `uiLang=${l}; path=/; max-age=${3600*24*365}`;
    } catch { /* ignore */ }
  }

  useEffect(()=> {
    try {
      const stored = localStorage.getItem('uiLang');
      if (stored === 'en' || stored === 'de') setUiLangState(stored);
    } catch {/* ignore */}
  }, []);

  const value: I18nContextValue = {
    uiLang,
    setUiLang,
    t: (key, vars) => translate(uiLang, key, vars)
  };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
