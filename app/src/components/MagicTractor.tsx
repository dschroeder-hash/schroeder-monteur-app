import { Sparkles } from 'lucide-react';
import { TractorArt } from './TractorArt';

/** Button icon for "Warenkorb übertragen": the green tractor with a twinkling magic spark. */
export function MagicTractor({ busy = false }: { busy?: boolean }) {
  return (
    <span aria-hidden className="relative inline-flex h-7 w-10 shrink-0 items-end">
      <TractorArt className="h-7 w-10" spin={busy} />
      <Sparkles
        className="absolute -right-2 -top-2 h-4 w-4 text-amber-400 motion-safe:animate-pulse"
        strokeWidth={2.4}
      />
    </span>
  );
}
