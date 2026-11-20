'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiFetch, ApiError } from '@/lib/api';
import { useApi } from '@/lib/useApi';

interface Transfer {
  id: string;
  target: string;
  state: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'FAILED' | 'DEAD';
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  updatedAt: string;
  locationName: string | null;
  payload: { op: string; endpoint: string; body: Record<string, unknown> };
}

const TARGET: Record<string, string> = {
  SERVICE_LINE_RESOURCE: 'Zeit → Servicezeile',
  SERVICE_LINE_ITEM: 'Artikel → Servicezeile',
  RESOURCE_JOURNAL: 'Zeit → Ressourcen Buch.-Blatt',
  ITEM_JOURNAL: 'Artikel Buch.-Blatt',
  ALLOCATION: 'Einplanung → Zuordnung',
  COMMENT: 'Arbeitsbericht',
  ABSENCE: 'Abwesenheit',
  STATUS: 'Auftragsstatus',
};
const STATE: Record<Transfer['state'], string> = {
  PENDING: 'wartet',
  IN_PROGRESS: 'läuft',
  DONE: 'erledigt',
  FAILED: 'fehlgeschlagen',
  DEAD: 'aufgegeben',
};

/** "Fehlgeschlagene Übertragungen" (PROMPT 6.2): resend or mark as handled in BC, both audited. */
export default function TransfersPage() {
  const [filter, setFilter] = useState<'FAILED' | 'DEAD' | 'PENDING' | ''>('');
  const list = useApi<Transfer[]>(`/v1/admin/transfers${filter ? `?state=${filter}` : ''}`);
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (path: string, body?: unknown) => {
    try {
      await apiFetch(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      setMsg('Gespeichert.');
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Fehler');
    }
    await list.reload();
  };
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-headline text-2xl">Übertragungen nach Business Central</h1>
      <div className="flex flex-wrap gap-2">
        {(['', 'FAILED', 'DEAD', 'PENDING'] as const).map((f) => (
          <Button key={f} variant={filter === f ? 'primary' : 'secondary'} onClick={() => setFilter(f)}>
            {f === '' ? 'Offen & fehlerhaft' : STATE[f]}
          </Button>
        ))}
      </div>
      {msg && <p role="status">{msg}</p>}
      {list.data && !list.data.length && <p className="text-text-muted">Keine Einträge.</p>}
      <ul className="flex flex-col gap-2">
        {list.data?.map((t) => (
          <li
            key={t.id}
            className={`flex flex-col gap-2 rounded-card border-l-[6px] bg-surface p-3 ${t.state === 'FAILED' || t.state === 'DEAD' ? 'border-l-danger' : 'border-l-info'}`}
          >
            <div className="flex flex-wrap justify-between gap-2">
              <p className="font-semibold">
                {TARGET[t.target] ?? t.target} · {t.locationName ?? '–'}
              </p>
              <p className="text-sm">
                {STATE[t.state]} · {t.attempts} Versuche · {new Date(t.updatedAt).toLocaleString('de-DE')}
              </p>
            </div>
            <p className="font-mono text-sm">
              {t.payload.op} {t.payload.endpoint} {String(t.payload.body.documentNumber ?? '')}{' '}
              {String(t.payload.body.quantity ?? '')}
            </p>
            {t.lastError && <p className="text-sm text-danger">{t.lastError}</p>}
            {(t.state === 'FAILED' || t.state === 'DEAD' || t.state === 'PENDING') && (
              <div className="flex gap-2">
                <Button onClick={() => void act(`/v1/admin/transfers/${t.id}/retry`)}>Erneut senden</Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const reason = window.prompt('Wie wurde der Vorgang in BC erledigt? (Pflicht)');
                    if (reason) void act(`/v1/admin/transfers/${t.id}/resolve`, { reason });
                  }}
                >
                  Als erledigt markieren
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
