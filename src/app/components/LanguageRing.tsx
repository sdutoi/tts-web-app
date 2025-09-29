"use client";
import { useEffect, useRef, useState } from 'react';

type Lang = "en"|"fr"|"de"|"it"|"es";

interface LanguageRingProps {
  onSelect: (lang: Lang) => void;
  initial?: Lang;
}

// Simple 3D ring using CSS perspective & rotateY interactions.
// Keeps implementation lightweight without external libs.
export function LanguageRing({ onSelect, initial = 'en' }: LanguageRingProps) {
  const langs: Lang[] = ["en","fr","de","it","es"];
  const [active, setActive] = useState<Lang>(initial);
  const [angle, setAngle] = useState(()=> langs.indexOf(initial) * (360 / langs.length));
  const dragging = useRef(false);
  const startX = useRef(0);
  const startAngle = useRef(0);

  const segment = 360 / langs.length;

  function snapAngle(raw: number) {
    const normalized = ((raw % 360) + 360) % 360;
    // Find closest index
    let idx = Math.round(normalized / segment) % langs.length;
    if (idx < 0) idx += langs.length;
    const snapped = idx * segment;
    setAngle(snapped);
    setActive(langs[idx]);
  }

  function handlePointerDown(e: React.PointerEvent) {
    dragging.current = true;
    startX.current = e.clientX;
    startAngle.current = angle;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current;
    const delta = dx * 0.4; // sensitivity
    setAngle(startAngle.current + delta);
  }
  function handlePointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    snapAngle(angle);
  }

  useEffect(()=> {
    onSelect(active);
  }, [active, onSelect]);

  return (
    <div className="flex flex-col items-center gap-6 select-none">
      <div className="text-sm uppercase tracking-wider text-gray-500">Choose Language</div>
      <div
        className="relative w-72 h-72 perspective"
        style={{ perspective: '1200px' }}
      >
        <div
          className="absolute inset-0 transition-transform duration-150 ease-out"
          style={{ transformStyle: 'preserve-3d', transform: `translateZ(-140px) rotateY(${-angle}deg)` }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {langs.map((l, i) => {
            const rot = i * segment;
            return (
              <div
                key={l}
                style={{
                  transform: `rotateY(${rot}deg) translateZ(140px)`,
                }}
                className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-xl flex flex-col items-center justify-center gap-1 shadow-md border backdrop-blur-sm cursor-grab bg-white/80 ${active===l? 'ring-4 ring-indigo-500':''}`}
                onClick={()=> snapAngle(rot)}
              >
                <span className="text-3xl font-bold tracking-tight">{l.toUpperCase()}</span>
                <span className="text-[11px] tracking-wide text-gray-600 uppercase">
                  {l === 'en' ? 'English' : l === 'fr' ? 'Français' : l === 'de' ? 'Deutsch' : l === 'it' ? 'Italiano' : 'Español'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <button
        onClick={()=> {
          const url = new URL(window.location.origin + '/dialogue');
          url.searchParams.set('lang', active);
          window.location.href = url.pathname + '?' + url.searchParams.toString();
        }}
        className="px-6 py-2 rounded-lg bg-indigo-600 text-white shadow hover:bg-indigo-500 transition"
      >Start → {active.toUpperCase()}</button>
    </div>
  );
}
