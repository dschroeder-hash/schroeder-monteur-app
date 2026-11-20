'use client';

import { localDate } from '@schroeder/shared';
import { useState } from 'react';
import { toast } from '@/components/Toast';
import { Button } from '@/components/ui/Button';
import { useTimezone } from '@/lib/offline/hooks';
import { useSync } from '@/lib/offline/SyncProvider';

const field = 'min-h-touch rounded-card border border-border bg-surface px-3';

/**
 * Sick report in 2 taps (PROMPT 5.9): "Krank melden" opens this dialog with "ab heute" preselected,
 * "Krankmeldung senden" records it – offline too. No diagnosis, no certificate upload.
 */
export function SickReportDialog({ onClose }: { onClose: () => void }) {
  const tz = useTimezone();
  const { run } = useSync();
  const today = localDate(new Date(), tz);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState('');
  const [comment, setComment] = useState('');
  const invalid = !!to && to < from;

  const send = async () => {
    await run('ReportSick', { fromDate: from, toDate: to || null, comment: comment.trim() || null });
    toast('Krankmeldung gespeichert – Ihr Meister wird informiert. Gute Besserung!');
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sick-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-card bg-surface p-4 sm:rounded-card">
        <h2 id="sick-title" className="text-xl font-semibold">
          Krank melden
        </h2>
        <label className="flex flex-col gap-1 font-semibold">
          Krank ab
          <input
            type="date"
            className={field}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 font-semibold">
          Voraussichtlich bis (optional)
          <input
            type="date"
            className={field}
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 font-semibold">
          Kommentar (optional)
          <input
            className={field}
            value={comment}
            maxLength={500}
            onChange={(e) => setComment(e.target.value)}
            placeholder="z. B. erreichbar per Telefon"
          />
          <span className="text-sm font-normal text-text-muted">
            Bitte keine Diagnose oder Krankheitsdetails angeben.
          </span>
        </label>
        <p className="rounded-card bg-surface-muted p-3 text-sm">
          Sie müssen keine Bescheinigung hochladen: Ihr Arbeitgeber ruft die elektronische
          Arbeitsunfähigkeitsbescheinigung (eAU) direkt bei Ihrer Krankenkasse ab.
        </p>
        {invalid && <p className="text-danger">Das Ende liegt vor dem Beginn.</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="lg" onClick={() => void send()} disabled={!from || invalid}>
            Krankmeldung senden
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
        </div>
      </div>
    </div>
  );
}
