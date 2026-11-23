import { Sparkles, Tractor } from 'lucide-react';

/**
 * Icon for "Warenkorb übertragen": a tractor that conjures – sparkles twinkle around it, and while the AI reads the
 * cart the tractor hops. Motion only when the device allows it (prefers-reduced-motion).
 */
export function MagicTractor({ busy = false }: { busy?: boolean }) {
  return (
    <span aria-hidden className="relative inline-flex h-6 w-7 shrink-0 items-end">
      <Tractor className={`h-6 w-6 ${busy ? 'motion-safe:animate-bounce' : ''}`} strokeWidth={2.2} />
      <Sparkles
        className={`absolute -right-1 -top-2 h-4 w-4 text-amber-400 ${
          busy ? 'motion-safe:animate-spin' : 'motion-safe:animate-pulse'
        }`}
        strokeWidth={2.4}
      />
      {busy && (
        <Sparkles
          className="absolute -left-2 -top-1 h-3 w-3 text-amber-300 motion-safe:animate-ping"
          strokeWidth={2.4}
        />
      )}
    </span>
  );
}
