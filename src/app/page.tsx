"use client";

import Image from "next/image";
import { LanguageToggle } from "../components/LanguageToggle";
import logo from "../../logo.png";
// Removed 3D LanguageRing; reverting to simple clickable language buttons

// Removed old static grid; dynamic 3D ring handles language selection.

export default function Page() {

  return (
    <main className="min-h-screen bg-gray-100 text-gray-800">
      <div className="absolute top-4 right-4 z-20"><LanguageToggle /></div>
      <div className="mx-auto max-w-4xl px-6 pt-20 pb-16">
        <div className="flex justify-center mb-12">
          <Image
            src={logo}
            alt="ConvoLutions logo"
            priority
            className="drop-shadow-sm"
            sizes="(min-width: 768px) 480px, 70vw"
            style={{ height: "auto", width: "min(70vw, 480px)" }}
          />
        </div>

        <section className="max-w-5xl mx-auto">
          <h2 className="text-center text-sm uppercase tracking-wider text-gray-500 mb-4">Choose Language</h2>
          <div className="flex flex-nowrap gap-3 overflow-x-auto py-2">
            {[
              { code: 'en', label: 'English' },
              { code: 'fr', label: 'Français' },
              { code: 'de', label: 'Deutsch' },
              { code: 'it', label: 'Italiano' },
              { code: 'es', label: 'Español' },
            ].map(l => (
              <button
                key={l.code}
                onClick={() => {
                  const url = new URL(window.location.origin + '/dialogue');
                  url.searchParams.set('lang', l.code);
                  window.location.href = url.pathname + '?' + url.searchParams.toString();
                }}
                className="group relative overflow-hidden rounded-xl bg-white shadow border px-5 py-4 flex flex-col items-center gap-1 hover:shadow-md transition flex-shrink-0 w-40"
              >
                <span className="text-2xl font-extrabold tracking-tight group-hover:text-indigo-600 transition">{l.code.toUpperCase()}</span>
                <span className="text-[11px] tracking-wide text-gray-600 uppercase">{l.label}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
