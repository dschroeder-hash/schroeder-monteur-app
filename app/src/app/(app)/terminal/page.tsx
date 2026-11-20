'use client';

import { ACTIVITIES, ACTIVITY_SHORT_LABELS, type Activity } from '@schroeder/shared';
import { Coffee, LogIn, LogOut, Play, Square, UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiFetch, ApiError } from '@/lib/api';

interface Overview {
  name: string;
  clockedIn: boolean;
  onBreak: boolean;
  job: { orderId: string | null; activity: Activity | null } | null;
  orders: Array<{ id: string; bcNo: string; customerName: string; description: string }>;
  warnings?: string[];
}
type StampType =
  'StampClockIn' | 'StampClockOut' | 'StampJobStart' | 'StampJobStop' | 'StampBreakStart' | 'StampBreakStop';
const DONE: Record<StampType, string> = {
  StampClockIn: 'Kommen gestempelt',
  StampClockOut: 'Gehen gestempelt',
  StampJobStart: 'Auftrag gestartet',
  StampJobStop: 'Auftrag beendet',
  StampBreakStart: 'Pause gestartet',
  StampBreakStop: 'Pause beendet',
};
const IDLE_MS = 30_000;

/**
 * Shared workshop PC (E-72): personnel number + 4-digit PIN, then one tap – like the BC stamp clock. The PIN is
 * kept only in memory for this one action and cleared after it or after 30 seconds without input. Online only.
 */
export default function TerminalPage() {
  const [personnelNo, setPersonnelNo] = useState('');
  const [pin, setPin] = useState('');
  const [who, setWho] = useState<Overview | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const first = useRef<HTMLInputElement>(null);

  const reset = (keepMsg = false) => {
    setPersonnelNo('');
    setPin('');
    setWho(null);
    if (!keepMsg) setMsg(null);
    setTimeout(() => first.current?.focus(), 0);
  };
  const touch = () => {
    clearTimeout(idle.current);
    idle.current = setTimeout(() => reset(), IDLE_MS);
  };
  useEffect(() => {
    first.current?.focus();
    return () => clearTimeout(idle.current);
  }, []);

  const call = async <T,>(path: string, body: object) => {
    setBusy(true);
    try {
      return await apiFetch<T>(path, { method: 'POST', body: JSON.stringify({ personnelNo, pin, ...body }) });
    } catch (e) {
      setMsg({
        tone: 'err',
        text: e instanceof ApiError ? e.message : 'Keine Verbindung – bitte erneut versuchen',
      });
      return null;
    } finally {
      setBusy(false);
    }
  };
  const identify = async () => {
    touch();
    setMsg(null);
    const o = await call<Overview>('/v1/terminal/identify', {});
    if (o) setWho(o);
    else setPin('');
  };
  const stamp = async (type: StampType, extra: { orderId?: string; activity?: Activity } = {}) => {
    touch();
    const o = await call<Overview>('/v1/terminal/stamp', { type, ...extra });
    if (!o) return;
    const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    setMsg({
      tone: 'ok',
      text: `${o.name}: ${DONE[type]} (${time} Uhr)${o.warnings?.length ? ` – ${o.warnings.join(' ')}` : ''}`,
    });
    reset(true);
    setTimeout(() => setMsg(null), 6000);
  };

  const field =
    'min-h-16 w-full rounded-card border-2 border-border bg-surface px-4 text-2xl font-bold tracking-widest';
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="font-headline text-3xl">Stempeln am Werkstatt-PC</h1>
      {msg && (
        <p
          role={msg.tone === 'err' ? 'alert' : 'status'}
          className={`rounded-card p-4 text-lg font-semibold ${msg.tone === 'ok' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}
        >
          {msg.text}
        </p>
      )}

      {!who ? (
        <form
          className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void identify();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Personalnummer</span>
            <input
              ref={first}
              className={field}
              value={personnelNo}
              autoComplete="off"
              onChange={(e) => {
                touch();
                setPersonnelNo(e.target.value.toUpperCase());
              }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">PIN</span>
            <input
              className={field}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={pin}
              onChange={(e) => {
                touch();
                setPin(e.target.value.replace(/\D/g, '').slice(0, 4));
              }}
            />
          </label>
          <Button size="lg" type="submit" disabled={busy || !personnelNo || pin.length !== 4}>
            <UserRound aria-hidden className="h-6 w-6" /> Weiter
          </Button>
        </form>
      ) : (
        <section
          aria-label={`Stempeln für ${who.name}`}
          className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-2xl font-bold">{who.name}</p>
              <p className="text-text-muted">
                {!who.clockedIn
                  ? 'nicht eingestempelt'
                  : who.onBreak
                    ? 'in Pause'
                    : who.job?.orderId
                      ? `am Auftrag ${who.orders.find((o) => o.id === who.job?.orderId)?.bcNo ?? ''}`
                      : 'eingestempelt'}
              </p>
            </div>
            <Button variant="ghost" onClick={() => reset()}>
              <X aria-hidden className="h-5 w-5" /> Abbrechen
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {!who.clockedIn && (
              <Button size="lg" disabled={busy} onClick={() => void stamp('StampClockIn')}>
                <LogIn aria-hidden className="h-6 w-6" /> Kommen
              </Button>
            )}
            {who.clockedIn && !who.onBreak && (
              <Button
                size="lg"
                variant="secondary"
                disabled={busy}
                onClick={() => void stamp('StampBreakStart')}
              >
                <Coffee aria-hidden className="h-6 w-6" /> Pause
              </Button>
            )}
            {who.onBreak && (
              <Button size="lg" disabled={busy} onClick={() => void stamp('StampBreakStop')}>
                <Play aria-hidden className="h-6 w-6" /> Pause beenden
              </Button>
            )}
            {who.job?.orderId && !who.onBreak && (
              <Button
                size="lg"
                variant="secondary"
                disabled={busy}
                onClick={() => void stamp('StampJobStop', { orderId: who.job!.orderId! })}
              >
                <Square aria-hidden className="h-5 w-5" /> Auftrag beenden
              </Button>
            )}
            {who.clockedIn && (
              <Button size="lg" variant="danger" disabled={busy} onClick={() => void stamp('StampClockOut')}>
                <LogOut aria-hidden className="h-6 w-6" /> Gehen
              </Button>
            )}
          </div>
          {!who.onBreak && (
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-bold">Auftrag starten</h2>
              {who.orders.length === 0 && (
                <p className="text-text-muted">Heute sind keine Aufträge zugeordnet.</p>
              )}
              {who.orders.map((o) => (
                <div
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border p-3"
                >
                  <span>
                    <span className="font-semibold">{o.bcNo}</span> · {o.customerName}
                    <span className="block text-sm text-text-muted">{o.description}</span>
                  </span>
                  <span className="flex gap-2">
                    {ACTIVITIES.map((a) => (
                      <Button
                        key={a}
                        variant={
                          who.job?.orderId === o.id && who.job.activity === a ? 'primary' : 'secondary'
                        }
                        disabled={busy}
                        onClick={() => void stamp('StampJobStart', { orderId: o.id, activity: a })}
                      >
                        {ACTIVITY_SHORT_LABELS[a]}
                      </Button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      <p className="text-sm text-text-muted">
        Die PIN legt jeder Mitarbeiter auf seinem Gerät im Benutzermenü fest – oder der Admin. Nach 5 falschen
        Eingaben ist sie 15 Minuten gesperrt.
      </p>
    </div>
  );
}
