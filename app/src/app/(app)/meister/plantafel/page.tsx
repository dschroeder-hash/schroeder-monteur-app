'use client';

import {
  DndContext,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { addDays, localDate, localTime, zonedToUtc } from '@schroeder/shared';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { apiFetch, ApiError } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useMeisterLocations } from '@/lib/meister';

interface Monteur {
  id: string;
  name: string;
  isApprentice: boolean;
  resourceNo: string | null;
}
interface BoardAssignment {
  id: string;
  orderId: string;
  userId: string;
  plannedStart: string;
  plannedEnd: string;
  bcNo: string;
  customerName: string;
  appStatus: string;
  needsReplan: boolean;
  conflicts: Array<{ kind: string; message: string }>;
}
interface UnplannedOrder {
  id: string;
  bcNo: string;
  customerName: string;
  description: string;
  faultDescription: string;
  orderTypeCode: string;
  priority: string;
  responseDate: string | null;
  machine: string | null;
  needsReplan: boolean;
}
interface Board {
  location: { id: string; name: string; timezone: string };
  monteure: Monteur[];
  assignments: BoardAssignment[];
  absences: Array<{
    userId: string;
    type: 'KRANK' | 'URLAUB';
    requested: boolean;
    fromDate: string;
    toDate: string | null;
  }>;
  unplanned: UnplannedOrder[];
}

type View = 'tag' | 'woche';
const HOURS = Array.from({ length: 13 }, (_, i) => 6 + i); // 06–18 Uhr
const DEFAULT_HOURS = 2;

/** Drop into the cell under the finger/pointer; keyboard dragging falls back to rectangle intersection. */
const dropWherePointerIs: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

function Draggable({
  id,
  children,
  label,
  actions,
}: {
  id: string;
  children: ReactNode;
  label: string;
  /** Buttons rendered next to (not inside) the draggable element – no nested interactive controls. */
  actions?: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  return (
    <div>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        aria-label={label}
        data-drag={id}
        style={
          transform
            ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
            : undefined
        }
        className={`cursor-grab touch-manipulation select-none [-webkit-touch-callout:none] ${isDragging ? 'opacity-70 shadow-lg' : ''}`}
      >
        {children}
      </div>
      {actions}
    </div>
  );
}

function Cell({
  id,
  absent,
  children,
  label,
}: {
  id: string;
  absent: boolean;
  children?: ReactNode;
  label: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-cell={id}
      role="group"
      aria-label={label}
      className={`min-h-16 border-b border-l border-border p-1 ${absent ? 'bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,var(--color-surface-muted)_6px,var(--color-surface-muted)_12px)]' : 'bg-surface'} ${isOver ? 'outline outline-3 outline-primary' : ''}`}
    >
      {children}
    </div>
  );
}

/** Planning board (PROMPT 5.2): Monteure as rows, drag & drop of service orders onto Monteur/day/hour. */
export default function PlanningBoardPage() {
  const locations = useMeisterLocations();
  const [locationId, setLocationId] = useState<string | null>(null);
  const [view, setView] = useState<View>('tag');
  const [day, setDay] = useState(() => localDate(new Date(), 'Europe/Berlin'));
  const [board, setBoard] = useState<Board | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [planFor, setPlanFor] = useState<UnplannedOrder | null>(null);

  useEffect(() => {
    if (!locationId && locations[0]) setLocationId(locations[0].id);
  }, [locations, locationId]);

  const tz = board?.location.timezone ?? 'Europe/Berlin';
  const monday = addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
  const days = view === 'tag' ? [day] : Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const load = useCallback(async () => {
    if (!locationId) return;
    const from = zonedToUtc(days[0]!, '00:00', tz).toISOString();
    const to = zonedToUtc(addDays(days.at(-1)!, 1), '00:00', tz).toISOString();
    setBoard(
      await apiFetch<Board>(
        `/v1/planning/board?locationId=${locationId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    );
  }, [locationId, view, day, tz]);
  useEffect(() => {
    load().catch((e) => setMsg({ tone: 'err', text: e instanceof Error ? e.message : 'Fehler' }));
  }, [load]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Finger (iPad): press and hold briefly, then drag – a quick swipe still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  /** Label of the absence on that day: "krank", "Urlaub", "Urlaub beantragt" – open-ended sick reports included. */
  const absent = (userId: string, d: string): string | null => {
    const a = board?.absences.find(
      (x) => x.userId === userId && x.fromDate <= d && (x.toDate ?? '9999-12-31') >= d,
    );
    return !a ? null : a.type === 'KRANK' ? 'krank' : a.requested ? 'Urlaub beantragt' : 'Urlaub';
  };
  const assignmentsIn = (userId: string, d: string, hour: number | null) =>
    (board?.assignments ?? []).filter((a) => {
      if (a.userId !== userId || localDate(new Date(a.plannedStart), tz) !== d) return false;
      if (hour === null) return true;
      const h = Number(localTime(new Date(a.plannedStart), tz).slice(0, 2));
      return hour === HOURS[0] ? h <= hour : hour === HOURS.at(-1) ? h >= hour : h === hour;
    });

  const result = (conflicts: Array<{ message: string }>, ok: string) =>
    setMsg(
      conflicts.length
        ? { tone: 'warn', text: `Gespeichert, aber: ${conflicts.map((c) => c.message).join(', ')}` }
        : { tone: 'ok', text: ok },
    );

  const save = async (fn: () => Promise<{ conflicts: Array<{ message: string }> }>, ok: string) => {
    try {
      result((await fn()).conflicts, ok);
    } catch (e) {
      setMsg({ tone: 'err', text: e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen' });
    }
    await load();
  };

  const plan = (orderId: string, userId: string, start: Date, hours = DEFAULT_HOURS) =>
    save(
      () =>
        apiFetch('/v1/planning/assignments', {
          method: 'POST',
          body: JSON.stringify({
            orderId,
            userId,
            plannedStart: start.toISOString(),
            plannedEnd: new Date(start.getTime() + hours * 3_600_000).toISOString(),
          }),
        }),
      'Eingeplant – der Monteur wird benachrichtigt.',
    );

  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over?.id ? String(e.over.id) : null;
    if (!over || !board) return;
    const [, userId, d, hourStr] = over.split('|') as [string, string, string, string];
    const [kind, id] = String(e.active.id).split('|') as ['order' | 'assign', string];
    if (kind === 'order') {
      void plan(id, userId, zonedToUtc(d, `${hourStr || '07'}:00`, tz));
      return;
    }
    const a = board.assignments.find((x) => x.id === id);
    if (!a) return;
    const duration = Date.parse(a.plannedEnd) - Date.parse(a.plannedStart);
    const time = hourStr ? `${hourStr}:00` : localTime(new Date(a.plannedStart), tz);
    const start = zonedToUtc(d, time, tz);
    void save(
      () =>
        apiFetch(`/v1/planning/assignments/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            userId,
            plannedStart: start.toISOString(),
            plannedEnd: new Date(start.getTime() + duration).toISOString(),
          }),
        }),
      'Einplanung verschoben – der Monteur wird benachrichtigt.',
    );
  };

  const cols =
    view === 'tag' ? HOURS.map((h) => ({ d: day, h })) : days.map((d) => ({ d, h: null as number | null }));
  const chip = (a: BoardAssignment) => (
    <Draggable
      key={a.id}
      id={`assign|${a.id}`}
      label={`${a.bcNo} ${a.customerName} verschieben`}
      actions={
        <button
          type="button"
          className="mb-1 min-h-touch text-xs font-semibold underline"
          onPointerDown={(ev) => ev.stopPropagation()}
          onClick={() =>
            void save(
              async () => (
                await apiFetch(`/v1/planning/assignments/${a.id}`, { method: 'DELETE' }),
                { conflicts: [] }
              ),
              'Einplanung entfernt.',
            )
          }
        >
          Entfernen
        </button>
      }
    >
      <div
        className={`mb-1 overflow-hidden break-words rounded-md border-l-4 bg-surface-muted px-2 py-1 text-xs [hyphens:auto] ${a.conflicts.length ? 'border-l-danger' : 'border-l-accent'}`}
      >
        <p className="font-semibold tabular-nums">
          {localTime(new Date(a.plannedStart), tz)}–{localTime(new Date(a.plannedEnd), tz)} {a.bcNo}
        </p>
        <p className="truncate">{a.customerName}</p>
        {a.conflicts.map((c) => (
          <p key={c.message} className="font-semibold text-danger">
            ⚠ {c.message}
          </p>
        ))}
      </div>
    </Draggable>
  );

  // German screen reader announcements with order number and Monteur instead of raw ids.
  const describe = (id: string | number) => {
    const [kind, x] = String(id).split('|');
    if (kind === 'order') return board?.unplanned.find((o) => o.id === x)?.bcNo ?? 'Auftrag';
    if (kind === 'assign') return board?.assignments.find((a) => a.id === x)?.bcNo ?? 'Einplanung';
    const [, userId, d, h] = String(id).split('|');
    const m = board?.monteure.find((y) => y.id === userId)?.name ?? '';
    return `${m}, ${d ? fmtDate(d) : ''}${h ? `, ${h}:00 Uhr` : ''}`;
  };
  const announcements = {
    onDragStart: ({ active }: { active: { id: string | number } }) => `${describe(active.id)} aufgenommen.`,
    onDragOver: ({
      active,
      over,
    }: {
      active: { id: string | number };
      over: { id: string | number } | null;
    }) =>
      over
        ? `${describe(active.id)} über ${describe(over.id)}.`
        : `${describe(active.id)} außerhalb der Plantafel.`,
    onDragEnd: ({
      active,
      over,
    }: {
      active: { id: string | number };
      over: { id: string | number } | null;
    }) =>
      over
        ? `${describe(active.id)} bei ${describe(over.id)} abgelegt.`
        : `${describe(active.id)} nicht abgelegt.`,
    onDragCancel: ({ active }: { active: { id: string | number } }) =>
      `Verschieben von ${describe(active.id)} abgebrochen.`,
  };

  const sortedUnplanned = useMemo(
    () => [...(board?.unplanned ?? [])].sort((a, b) => Number(b.needsReplan) - Number(a.needsReplan)),
    [board],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-headline mr-auto text-2xl">Plantafel {board?.location.name}</h1>
        {locations.length > 1 && (
          <select
            aria-label="Standort"
            className="min-h-touch rounded-card border border-border bg-surface px-3"
            value={locationId ?? ''}
            onChange={(e) => setLocationId(e.target.value)}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        {(['tag', 'woche'] as View[]).map((v) => (
          <Button
            key={v}
            variant={view === v ? 'primary' : 'secondary'}
            aria-pressed={view === v}
            onClick={() => setView(v)}
          >
            {v === 'tag' ? 'Tag' : 'Woche'}
          </Button>
        ))}
        <Button
          variant="secondary"
          aria-label="Zurück"
          onClick={() => setDay(addDays(day, view === 'tag' ? -1 : -7))}
        >
          ←
        </Button>
        <span className="font-semibold">{view === 'tag' ? fmtDate(day) : `ab ${fmtDate(monday)}`}</span>
        <Button
          variant="secondary"
          aria-label="Weiter"
          onClick={() => setDay(addDays(day, view === 'tag' ? 1 : 7))}
        >
          →
        </Button>
      </div>

      {msg && (
        <p
          role="status"
          className={`rounded-card p-3 font-semibold ${msg.tone === 'ok' ? 'bg-success-bg text-success' : msg.tone === 'warn' ? 'bg-warning-bg text-warning' : 'bg-danger-bg text-danger'}`}
        >
          {msg.text}
        </p>
      )}

      <DndContext
        sensors={sensors}
        onDragEnd={onDragEnd}
        collisionDetection={dropWherePointerIs}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              'Leertaste zum Aufnehmen, Pfeiltasten zum Bewegen, Leertaste zum Ablegen, Escape zum Abbrechen.',
          },
        }}
      >
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <section aria-labelledby="offen" className="flex min-w-0 flex-col gap-2">
            <h2 id="offen" className="font-bold">
              Nicht eingeplant ({sortedUnplanned.length})
            </h2>
            <p className="text-sm text-text-muted">
              Auftrag gedrückt halten und auf Monteur und Uhrzeit ziehen.
            </p>
            <div
              tabIndex={0}
              role="region"
              aria-label="Nicht eingeplante Aufträge"
              className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 lg:max-h-[75vh] lg:flex-col lg:overflow-x-visible lg:overflow-y-auto"
            >
              {sortedUnplanned.map((o) => (
                <div key={o.id} className="w-64 shrink-0 lg:w-auto">
                  <Draggable
                    id={`order|${o.id}`}
                    label={`${o.bcNo} ${o.customerName} einplanen`}
                    actions={
                      <button
                        type="button"
                        className="min-h-touch text-sm font-semibold underline"
                        onPointerDown={(ev) => ev.stopPropagation()}
                        onClick={() => setPlanFor(o)}
                      >
                        Einplanen ohne Ziehen …
                      </button>
                    }
                  >
                    <article
                      className={`rounded-card border bg-surface p-3 ${o.needsReplan ? 'border-danger' : 'border-border'}`}
                    >
                      <p className="text-sm text-text-muted">
                        {o.bcNo} · {o.orderTypeCode}
                        {o.priority === 'High' && (
                          <span className="font-semibold text-danger"> · dringend</span>
                        )}
                      </p>
                      {o.needsReplan && (
                        <p className="text-sm font-semibold text-danger">Neu einplanen (Monteur abwesend)</p>
                      )}
                      <p className="font-semibold">{o.customerName}</p>
                      <p className="text-sm">{o.machine ?? o.description}</p>
                      <p className="text-sm text-text-muted">{o.faultDescription}</p>
                    </article>
                  </Draggable>
                </div>
              ))}
            </div>
          </section>

          <div
            tabIndex={0}
            role="region"
            aria-label="Plantafel (seitlich scrollbar)"
            className="overflow-x-auto rounded-card border border-border"
          >
            <div
              className="grid min-w-[56rem]"
              style={{ gridTemplateColumns: `11rem repeat(${cols.length}, minmax(5.5rem, 1fr))` }}
            >
              <div className="border-b border-border bg-surface-muted p-2 text-sm font-semibold">Monteur</div>
              {cols.map((c) => (
                <div
                  key={`${c.d}-${c.h}`}
                  className="border-b border-l border-border bg-surface-muted p-2 text-center text-sm font-semibold"
                >
                  {c.h !== null ? `${String(c.h).padStart(2, '0')}:00` : fmtDate(c.d)}
                </div>
              ))}
              {board?.monteure.map((m) => (
                <div key={m.id} className="contents">
                  <div className="border-b border-border bg-surface p-2">
                    <p className="font-semibold">{m.name.replace(/\s*\(.*\)$/, '')}</p>
                    {m.isApprentice && <p className="text-xs text-text-muted">Azubi</p>}
                  </div>
                  {cols.map((c) => {
                    const hh = c.h !== null ? String(c.h).padStart(2, '0') : '';
                    return (
                      <Cell
                        key={`${m.id}-${c.d}-${c.h}`}
                        id={`cell|${m.id}|${c.d}|${hh}`}
                        absent={!!absent(m.id, c.d)}
                        label={`${m.name} ${c.d} ${hh}`}
                      >
                        {absent(m.id, c.d) && (
                          <p className="text-xs font-semibold text-text-muted">{absent(m.id, c.d)}</p>
                        )}
                        {assignmentsIn(m.id, c.d, c.h).map(chip)}
                      </Cell>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </DndContext>

      {planFor && board && (
        <PlanDialog
          order={planFor}
          monteure={board.monteure}
          defaultDate={day}
          onCancel={() => setPlanFor(null)}
          onSubmit={(userId, date, time, hours) => {
            setPlanFor(null);
            void plan(planFor.id, userId, zonedToUtc(date, time, tz), hours);
          }}
        />
      )}
    </div>
  );
}

/** Keyboard/screen-reader friendly alternative to drag & drop. */
function PlanDialog({
  order,
  monteure,
  defaultDate,
  onCancel,
  onSubmit,
}: {
  order: UnplannedOrder;
  monteure: Monteur[];
  defaultDate: string;
  onCancel: () => void;
  onSubmit: (userId: string, date: string, time: string, hours: number) => void;
}) {
  const [userId, setUserId] = useState(monteure[0]?.id ?? '');
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('07:00');
  const [hours, setHours] = useState(2);
  const field = 'min-h-touch rounded-card border border-border bg-surface px-3';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <form
        className="flex w-full max-w-md flex-col gap-3 rounded-card bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(userId, date, time, hours);
        }}
      >
        <h2 id="plan-title" className="text-lg font-semibold">
          {order.bcNo} einplanen
        </h2>
        <label className="flex flex-col gap-1">
          Monteur
          <select className={field} value={userId} onChange={(e) => setUserId(e.target.value)}>
            {monteure.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1">
            Datum
            <input
              type="date"
              className={field}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            Beginn
            <input
              type="time"
              className={field}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            Stunden
            <input
              type="number"
              min={0.5}
              max={16}
              step={0.5}
              className={field}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              required
            />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button type="submit">Einplanen</Button>
        </div>
      </form>
    </div>
  );
}
