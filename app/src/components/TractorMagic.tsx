'use client';

import { useEffect, useRef, useState } from 'react';
import { TractorArt } from './TractorArt';

const MIN_FLIGHT_MS = 2200;
const FINALE_MS = 1700;
const TRAIL = Array.from({ length: 14 }, (_, i) => i);
const BURST = Array.from({ length: 22 }, (_, i) => i);

/**
 * The magic effect of "Warenkorb übertragen": while the cart is being read the green tractor flies across the
 * whole screen, wheels turning, trailing glitter and stars; when the lines are there it shoots off with a burst of
 * stars. Purely decorative (no pointer events, hidden from screen readers) and off with prefers-reduced-motion.
 */
export function TractorMagic({ busy }: { busy: boolean }) {
  const [phase, setPhase] = useState<'idle' | 'flying' | 'finale'>('idle');
  const started = useRef(0);

  useEffect(() => {
    if (busy) {
      started.current = Date.now();
      setPhase('flying');
      return;
    }
    if (phase !== 'flying') return;
    const wait = Math.max(0, MIN_FLIGHT_MS - (Date.now() - started.current));
    const t1 = setTimeout(() => setPhase('finale'), wait);
    const t2 = setTimeout(() => setPhase('idle'), wait + FINALE_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // phase is read only to know whether a flight is running; the effect reacts to `busy` alone.
  }, [busy]);

  if (phase === 'idle') return null;
  return (
    <div aria-hidden className="tractor-magic pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      <div className="tractor-veil" />
      <div className={phase === 'flying' ? 'tractor-flight' : 'tractor-flight tractor-exit'}>
        <div className="tractor-body">
          <div className="tractor-glow" />
          <TractorArt className="relative h-36 w-56 drop-shadow-2xl" spin />
          {TRAIL.map((i) => (
            <span
              key={i}
              className={i % 3 === 0 ? 'tractor-star' : 'tractor-dust'}
              style={
                {
                  '--d': `${(i * 0.11) % 1.2}s`,
                  '--y': `${((i * 37) % 70) - 20}px`,
                  '--s': `${0.6 + ((i * 13) % 10) / 10}`,
                } as React.CSSProperties
              }
            >
              {i % 3 === 0 ? '✦' : ''}
            </span>
          ))}
        </div>
      </div>
      {phase === 'finale' &&
        BURST.map((i) => (
          <span
            key={i}
            className="tractor-burst"
            style={
              {
                '--a': `${(360 / BURST.length) * i}deg`,
                '--r': `${140 + ((i * 53) % 160)}px`,
                '--c': ['#fbbf24', '#fde68a', '#86efac', '#ffffff'][i % 4],
              } as React.CSSProperties
            }
          >
            ✦
          </span>
        ))}
    </div>
  );
}
