'use client';

import { availableQuantity, belowMinimum, meterPlausible } from '@schroeder/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { BackLink } from '@/components/BackLink';
import { toast } from '@/components/Toast';
import { Button } from '@/components/ui/Button';
import { localDb, type LocalContainer, type LocalItem } from '@/lib/offline/db';
import { useSync } from '@/lib/offline/SyncProvider';

const ICON: Record<LocalContainer['kind'], string> = {
  FASS: '🛢️',
  IBC: '🧴',
  TANK: '⛽',
  KANISTER: '🪣',
  KARTUSCHE: '🧪',
};
const field = 'min-h-touch rounded-card border border-border bg-surface px-3';

/** Consumables shop (PROMPT 5.4): oil from drums/IBC, grease, AdBlue, diesel from the tank – stock reduced at once. */
function ConsumablesShop() {
  const orderId = useSearchParams().get('orderId');
  const order = useLiveQuery(() => (orderId ? localDb.orders.get(orderId) : undefined), [orderId]);
  const data =
    useLiveQuery(async () => {
      const containers = (await localDb.containers.toArray()).filter((c) => c.active);
      const items = await localDb.items.bulkGet(containers.map((c) => c.itemId));
      const stocks = await Promise.all(
        containers.map((c) => localDb.stocks.get([c.itemId, c.storageLocationId])),
      );
      return containers.map((c, i) => ({
        c,
        item: items[i]!,
        available: availableQuantity(stocks[i]?.bcInventory ?? 0, stocks[i]?.pendingWithdrawal ?? 0),
      }));
    }, []) ?? [];
  const [selected, setSelected] = useState<{ c: LocalContainer; item: LocalItem; available: number } | null>(
    null,
  );

  return (
    <div className="flex flex-col gap-4">
      <BackLink orderId={orderId} />
      <header>
        <p className="text-sm text-text-muted">
          {order ? `${order.bcNo} · ${order.customerName}` : 'Ohne Auftrag (intern)'}
        </p>
        <h1 className="font-headline text-2xl">Öl, Diesel & Co.</h1>
      </header>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {data.map(({ c, item, available }) => (
          <li key={c.id}>
            <button
              type="button"
              data-container={c.name}
              onClick={() => setSelected({ c, item, available })}
              className={`flex h-full w-full flex-col items-start gap-1 rounded-card border bg-surface p-3 text-left ${belowMinimum(available, c.minStock) ? 'border-warning border-l-[6px]' : 'border-border'}`}
            >
              <span aria-hidden className="text-3xl">
                {ICON[c.kind]}
              </span>
              <span className="font-semibold">{c.name}</span>
              <span className="font-emphasis text-xl tabular-nums">
                {available.toLocaleString('de-DE')} {item?.unit}
              </span>
              {belowMinimum(available, c.minStock) && (
                <span className="text-sm font-semibold text-warning">unter Mindestbestand</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {selected && <TakeSheet {...selected} orderId={orderId} onClose={() => setSelected(null)} />}
    </div>
  );
}

function TakeSheet({
  c,
  item,
  available,
  orderId,
  onClose,
}: {
  c: LocalContainer;
  item: LocalItem;
  available: number;
  orderId: string | null;
  onClose: () => void;
}) {
  const { run } = useSync();
  const [qty, setQty] = useState<number | ''>('');
  const [target, setTarget] = useState<'ORDER' | 'INTERN'>(orderId ? 'ORDER' : 'INTERN');
  const [purpose, setPurpose] = useState<'SERVICEWAGEN' | 'VORFUEHRMASCHINE' | 'SONSTIGES'>('SERVICEWAGEN');
  const [costCenter, setCostCenter] = useState('');
  const [before, setBefore] = useState<number | ''>('');
  const [after, setAfter] = useState<number | ''>('');
  const isDiesel = c.kind === 'TANK';
  const plausible = meterPlausible(Number(qty), before === '' ? null : before, after === '' ? null : after);
  const submit = async () => {
    if (!qty) return;
    await run('ConsumeItem', {
      orderId: target === 'ORDER' ? orderId : null,
      itemId: c.itemId,
      storageLocationId: c.storageLocationId,
      containerId: c.id,
      quantity: Number(qty),
      internalPurpose: target === 'INTERN' ? purpose : null,
      costCenter: target === 'INTERN' ? costCenter : null,
      meterBefore: before === '' ? null : before,
      meterAfter: after === '' ? null : after,
    });
    toast(`${qty} ${item.unit} ${item.name} gebucht`);
    onClose();
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="take-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-card bg-surface p-4">
        <h2 id="take-title" className="text-lg font-semibold">
          {c.name}
        </h2>
        <p className="text-sm text-text-muted">
          Bestand: {available.toLocaleString('de-DE')} {item.unit}
        </p>
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="Schnellwahl">
          {c.quickQuantities.map((q) => (
            <Button
              key={q}
              className="whitespace-nowrap px-1"
              variant={qty === q ? 'primary' : 'secondary'}
              aria-pressed={qty === q}
              onClick={() => setQty(q)}
            >
              {q} {item.unit}
            </Button>
          ))}
        </div>
        <label className="flex flex-col gap-1">
          Menge ({item.unit})
          <input
            type="number"
            inputMode="decimal"
            min={0.1}
            step={0.1}
            className={field}
            value={qty}
            onChange={(e) => setQty(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </label>
        {isDiesel && (
          <fieldset className="flex flex-col gap-2">
            <legend className="font-semibold">Abgabe an</legend>
            {orderId && (
              <label className="flex min-h-touch items-center gap-3">
                <input
                  type="radio"
                  name="target"
                  className="h-6 w-6"
                  checked={target === 'ORDER'}
                  onChange={() => setTarget('ORDER')}
                />
                Kundenmaschine (Auftrag)
              </label>
            )}
            <label className="flex min-h-touch items-center gap-3">
              <input
                type="radio"
                name="target"
                className="h-6 w-6"
                checked={target === 'INTERN'}
                onChange={() => setTarget('INTERN')}
              />
              Intern
            </label>
            {target === 'INTERN' && (
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label="Zweck"
                  className={field}
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value as typeof purpose)}
                >
                  <option value="SERVICEWAGEN">Servicewagen</option>
                  <option value="VORFUEHRMASCHINE">Vorführmaschine</option>
                  <option value="SONSTIGES">Sonstiges</option>
                </select>
                <input
                  aria-label="Kostenstelle"
                  placeholder="Kostenstelle"
                  className={field}
                  value={costCenter}
                  onChange={(e) => setCostCenter(e.target.value)}
                  required
                />
              </div>
            )}
            {c.hasMeter && (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  Zähler vorher
                  <input
                    type="number"
                    inputMode="decimal"
                    className={field}
                    value={before}
                    onChange={(e) => setBefore(e.target.value === '' ? '' : Number(e.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Zähler nachher
                  <input
                    type="number"
                    inputMode="decimal"
                    className={field}
                    value={after}
                    onChange={(e) => setAfter(e.target.value === '' ? '' : Number(e.target.value))}
                  />
                </label>
              </div>
            )}
            {!plausible && <p className="font-semibold text-warning">Zählerstände passen nicht zur Menge.</p>}
          </fieldset>
        )}
        {!isDiesel && !orderId && (
          <p className="text-warning">
            Ohne Auftrag nur für Diesel möglich – bitte aus dem Auftrag heraus buchen.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            disabled={
              !qty || (target === 'INTERN' && (!costCenter || !isDiesel)) || (target === 'ORDER' && !orderId)
            }
            onClick={() => void submit()}
          >
            Buchen
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="text-text-muted">Wird geladen …</p>}>
      <ConsumablesShop />
    </Suspense>
  );
}
