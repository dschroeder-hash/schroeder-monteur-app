'use client';

import {
  DEFAULT_REQUIRED_FIELDS,
  fillTemplate,
  REQUIRED_FIELD_DEFS,
  reportCompleteness,
} from '@schroeder/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { BackLink } from '@/components/BackLink';
import { toast } from '@/components/Toast';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useDictation } from '@/lib/dictation';
import { kvGet, localDb } from '@/lib/offline/db';
import { navigate } from '@/lib/offline/OfflineNavigation';
import { useSync } from '@/lib/offline/SyncProvider';

const field = 'min-h-touch rounded-card border border-border bg-surface px-3';

/** Work report with quick documentation templates, required fields and dictation (PROMPT 5.6). Works offline. */
function ReportEditor() {
  const orderId = useSearchParams().get('orderId') ?? '';
  const router = useRouter();
  const { me } = useAuth();
  const { run } = useSync();
  const order = useLiveQuery(() => localDb.orders.get(orderId), [orderId]);
  const saved = useLiveQuery(() => localDb.workReports.get(orderId), [orderId]);
  const templates =
    useLiveQuery(() => localDb.templates.filter((t) => t.active).sortBy('sortOrder'), []) ?? [];
  const settings = useLiveQuery(() => kvGet<Array<{ key: string; value: unknown }>>(localDb, 'settings'), []);
  const [body, setBody] = useState('');
  const [fields, setFields] = useState<Record<string, string | number | null>>({});
  const [used, setUsed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const dict = useDictation();

  useEffect(() => {
    if (loaded || saved === undefined) return;
    if (saved) {
      setBody(saved.body);
      setFields(saved.requiredFields);
      setUsed(saved.usedTemplateIds);
    }
    setLoaded(true);
  }, [saved, loaded]);

  if (!order) return <p className="text-text-muted">Auftrag nicht auf diesem Gerät vorhanden.</p>;
  const machine = order.items[0]?.machine;
  const cfg =
    (settings?.find((s) => s.key === 'reportRequiredFields')?.value as
      Record<string, string[]> | undefined) ?? DEFAULT_REQUIRED_FIELDS;
  const required = cfg[order.orderTypeCode] ?? [];
  const status = reportCompleteness({ body, requiredFields: fields }, required);
  const suitable = templates.filter(
    (t) =>
      (!t.orderTypeCode || t.orderTypeCode === order.orderTypeCode) &&
      (!t.machineGroup || t.machineGroup === machine?.machineGroup),
  );
  const ctx = {
    Betriebsstunden: (fields.operatingHours as number | null) ?? machine?.operatingHours ?? null,
    Maschine: machine?.model ?? null,
    Seriennummer: machine?.serialNo ?? null,
    Kunde: order.customerName,
    Auftrag: order.bcNo,
    Datum: new Date().toLocaleDateString('de-DE'),
  };
  const append = (text: string) => setBody((b) => (b.trim() ? `${b.trim()}\n${text}` : text));

  const save = async () => {
    await run('SaveWorkReport', { orderId, body, requiredFields: fields, usedTemplateIds: used });
    toast(
      status.complete
        ? 'Bericht gespeichert – vollständig'
        : `Bericht gespeichert – es fehlt: ${status.missing.join(', ')}`,
    );
    navigate(router, `/monteur/auftrag?id=${orderId}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <BackLink orderId={orderId} />
      <header>
        <p className="text-sm text-text-muted">
          {order.bcNo} · {order.customerName} · {machine?.model}
        </p>
        <h1 className="font-headline text-2xl">Arbeitsbericht</h1>
      </header>

      {required.length > 0 && (
        <section aria-labelledby="pflicht" className="grid grid-cols-2 gap-2">
          <h2 id="pflicht" className="col-span-2 font-semibold">
            Pflichtangaben
          </h2>
          {required.map((k) => {
            const def = REQUIRED_FIELD_DEFS[k];
            if (!def) return null;
            return (
              <label key={k} className="flex flex-col gap-1">
                {def.label} {def.unit && `(${def.unit})`}
                <input
                  className={field}
                  inputMode={def.type === 'number' ? 'decimal' : 'text'}
                  type={def.type === 'number' ? 'number' : 'text'}
                  value={fields[k] ?? ''}
                  onChange={(e) =>
                    setFields({
                      ...fields,
                      [k]:
                        e.target.value === ''
                          ? null
                          : def.type === 'number'
                            ? Number(e.target.value)
                            : e.target.value,
                    })
                  }
                />
              </label>
            );
          })}
        </section>
      )}

      <section aria-labelledby="schnell" className="flex flex-col gap-2">
        <h2 id="schnell" className="font-semibold">
          Schnelldoku
        </h2>
        <div className="flex flex-wrap gap-2">
          {suitable.map((t) => (
            <Button
              key={t.id}
              variant={used.includes(t.id) ? 'primary' : 'secondary'}
              aria-pressed={used.includes(t.id)}
              onClick={() => {
                append(fillTemplate(t.body, ctx));
                setUsed((u) => [...new Set([...u, t.id])]);
              }}
            >
              {t.title}
            </Button>
          ))}
        </div>
      </section>

      <label className="flex flex-col gap-1">
        <span className="font-semibold">Bericht</span>
        <textarea
          className="min-h-48 rounded-card border border-border bg-surface p-3"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>

      <section aria-label="Diktat" className="flex flex-col gap-2">
        {me?.features.dictation && (
          <Button
            variant="secondary"
            onClick={() => (dict.listening ? dict.stop() : void dict.start())}
            aria-pressed={dict.listening}
          >
            {dict.listening ? '⏹ Diktat beenden' : '🎤 Diktieren'}
          </Button>
        )}
        {dict.error && (
          <p role="alert" className="text-danger">
            {dict.error}
          </p>
        )}
        {dict.text && !dict.listening && (
          <div className="flex flex-col gap-2 rounded-card border-2 border-info bg-info-bg p-3">
            <p className="text-sm font-semibold text-info">Vorschlag aus dem Diktat – bitte prüfen</p>
            <textarea
              className="min-h-24 rounded-card border border-border bg-surface p-2 text-text"
              value={dict.text}
              onChange={(e) => dict.setText(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  append(dict.text);
                  dict.setText('');
                }}
              >
                Übernehmen
              </Button>
              {me?.features['dictation.ai'] && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    void dict
                      .rewrite(dict.text)
                      .then(dict.setText)
                      .catch(() => toast('Umformulieren nicht verfügbar'))
                  }
                >
                  Umformulieren (KI)
                </Button>
              )}
              <Button variant="ghost" onClick={() => dict.setText('')}>
                Verwerfen
              </Button>
            </div>
          </div>
        )}
      </section>

      <p
        className={`rounded-card p-3 font-semibold ${status.complete ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'}`}
        role="status"
      >
        {status.complete ? 'Dokumentation vollständig' : `Es fehlt: ${status.missing.join(', ')}`}
      </p>
      <Button size="lg" onClick={() => void save()}>
        Speichern
      </Button>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="text-text-muted">Wird geladen …</p>}>
      <ReportEditor />
    </Suspense>
  );
}
