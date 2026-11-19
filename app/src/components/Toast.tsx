'use client';

import { useEffect, useState } from 'react';

type Listener = (msg: string) => void;
const listeners = new Set<Listener>();

/** Short confirmation shown above the stamp bar (e.g. "Kommen automatisch gestempelt"). */
export function toast(msg: string) {
  listeners.forEach((l) => l(msg));
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const l: Listener = (m) => {
      setMsg(m);
      setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 4000);
    };
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  if (!msg) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 top-20 z-40 mx-auto max-w-md rounded-card bg-text px-4 py-3 text-center font-semibold text-surface shadow-lg"
    >
      {msg}
    </div>
  );
}
