import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { ACTIVITY_LABELS, REQUIRED_FIELD_DEFS, checklistLines, type Activity } from '@schroeder/shared';
import type { Db } from '../../db/client.js';
import {
  appUser,
  checklistTemplate,
  consumption,
  item,
  location,
  machine,
  orderChecklist,
  orderSignature,
  serviceOrder,
  serviceOrderItem,
  timeEntry,
  workReport,
} from '../../db/schema.js';

const A4: [number, number] = [595.28, 841.89];
const M = 48; // page margin
const GREEN = rgb(0.024, 0.478, 0.31);
const GREY = rgb(0.4, 0.42, 0.43);

/** Helvetica (WinAnsi) has umlauts and ß but not every Unicode sign – replace what it cannot draw. */
const safe = (s: string) =>
  s
    .replace(/[–—]/g, '-')
    .replace(/[„“”]/g, '"')
    .replace(/[‚‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF€\n]/g, '?');

class Writer {
  page: PDFPage;
  y: number;
  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.page = doc.addPage(A4);
    this.y = A4[1] - M;
  }
  private ensure(h: number) {
    if (this.y - h < M) {
      this.page = this.doc.addPage(A4);
      this.y = A4[1] - M;
    }
  }
  wrap(text: string, size: number, width: number, f = this.font): string[] {
    const out: string[] = [];
    for (const para of safe(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) > width && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  }
  text(
    text: string,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number } = {},
  ) {
    const size = opts.size ?? 10;
    const f = opts.bold ? this.bold : this.font;
    const x = opts.x ?? M;
    for (const line of this.wrap(text, size, A4[0] - x - M, f)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x, y: this.y - size, size, font: f, color: opts.color ?? rgb(0, 0, 0) });
      this.y -= size + 4;
    }
  }
  heading(text: string) {
    this.y -= 8;
    this.ensure(30);
    this.text(text, { size: 12, bold: true, color: GREEN });
    this.page.drawLine({
      start: { x: M, y: this.y + 1 },
      end: { x: A4[0] - M, y: this.y + 1 },
      thickness: 0.6,
      color: GREEN,
    });
    this.y -= 6;
  }
  /** Simple table; column widths as fractions of the content width, `right` = right-aligned columns. */
  table(head: string[], rows: string[][], widths: number[], right: number[] = [], boldLast = false) {
    const W = A4[0] - 2 * M;
    const xs = widths.reduce<number[]>((acc, w, i) => [...acc, (acc[i] ?? M) + w * W], [M]);
    const row = (cells: string[], f: PDFFont) => {
      this.ensure(14);
      cells.forEach((c, i) => {
        const cell = safe(c);
        const w = widths[i]! * W - 6;
        let t = cell;
        while (t.length > 1 && f.widthOfTextAtSize(t, 9) > w) t = t.slice(0, -1);
        const x = right.includes(i) ? xs[i]! + w - f.widthOfTextAtSize(t, 9) : xs[i]!;
        this.page.drawText(t, { x, y: this.y - 9, size: 9, font: f });
      });
      this.y -= 14;
    };
    row(head, this.bold);
    rows.forEach((r, i) => row(r, boldLast && i === rows.length - 1 ? this.bold : this.font));
  }
  image(png: Awaited<ReturnType<PDFDocument['embedPng']>>, maxW: number, maxH: number) {
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    const w = png.width * scale;
    const h = png.height * scale;
    this.ensure(h + 4);
    this.page.drawImage(png, { x: M, y: this.y - h, width: w, height: h });
    this.y -= h + 4;
  }
}

const hhmm = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(d);
const day = (iso: string) => iso.split('-').reverse().join('.');
const hours = (min: number) =>
  (Math.round((min / 60) * 100) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 });

/**
 * The workshop order (Werkstattauftrag) as PDF for BC (E-68): header, machine, working hours, parts, report,
 * checklist and the customer's signature. Built by the transfer worker when the attachment is sent, so it shows
 * the final state of the order.
 */
export async function buildWorkOrderPdf(db: Db, orderId: string): Promise<Uint8Array> {
  const [order] = await db.select().from(serviceOrder).where(eq(serviceOrder.id, orderId));
  if (!order) throw new Error(`order ${orderId} not found`);
  const [loc] = await db.select().from(location).where(eq(location.id, order.locationId));
  const tz = loc?.timezone ?? 'Europe/Berlin';
  const [m] = await db
    .select({ m: machine })
    .from(serviceOrderItem)
    .innerJoin(machine, eq(machine.id, serviceOrderItem.machineId))
    .where(eq(serviceOrderItem.orderId, orderId))
    .limit(1);
  const times = await db
    .select({ e: timeEntry, name: appUser.displayName })
    .from(timeEntry)
    .innerJoin(appUser, eq(appUser.id, timeEntry.userId))
    .where(and(eq(timeEntry.orderId, orderId), eq(timeEntry.kind, 'ORDER')))
    .orderBy(asc(timeEntry.startAt));
  const parts = await db
    .select({ c: consumption, number: item.number, name: item.name })
    .from(consumption)
    .innerJoin(item, eq(item.id, consumption.itemId))
    .where(and(eq(consumption.orderId, orderId), ne(consumption.state, 'REJECTED')))
    .orderBy(asc(consumption.deviceTime));
  const [report] = await db.select().from(workReport).where(eq(workReport.orderId, orderId));
  const [cl] = await db.select().from(orderChecklist).where(eq(orderChecklist.orderId, orderId));
  const [tpl] = cl
    ? await db
        .select()
        .from(checklistTemplate)
        .where(inArray(checklistTemplate.id, [cl.templateId]))
    : [];
  const [sig] = await db.select().from(orderSignature).where(eq(orderSignature.orderId, orderId));

  const doc = await PDFDocument.create();
  doc.setTitle(`Werkstattauftrag ${order.bcNo}`);
  doc.setAuthor('Schröder Werkstatt-App');
  const w = new Writer(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
  );

  w.text('Heinrich Schröder Landmaschinen KG', { size: 9, color: GREY });
  w.text(`Werkstattauftrag ${order.bcNo}`, { size: 18, bold: true });
  w.text(`${loc?.name ?? ''} · Auftragsart ${order.orderTypeCode}`, { size: 9, color: GREY });
  w.y -= 6;
  w.text(order.customerName, { size: 11, bold: true });
  const addr = order.address as { street?: string; postCode?: string; city?: string } | null;
  if (addr?.street) w.text(`${addr.street}, ${addr.postCode ?? ''} ${addr.city ?? ''}`);
  if (m)
    w.text(
      `Maschine: ${m.m.brand} ${m.m.model} · SN ${m.m.serialNo}${m.m.operatingHours != null ? ` · ${m.m.operatingHours.toLocaleString('de-DE')} Bh.` : ''}`,
    );
  const task = order.faultDescription || order.description;
  if (task) w.text(`Auftrag: ${task}`);

  w.heading('Arbeitsstunden');
  if (times.length) {
    let total = 0;
    const rows = times.map(({ e, name }) => {
      const min = e.billableMinutes ?? e.actualMinutes ?? 0;
      total += min;
      return [
        day(e.workDate),
        name,
        e.activity ? ACTIVITY_LABELS[e.activity as Activity] : '',
        `${hhmm(e.startAt, tz)} - ${e.endAt ? hhmm(e.endAt, tz) : ''}`,
        hours(min),
      ];
    });
    w.table(
      ['Datum', 'Monteur', 'Tätigkeit', 'Von - Bis', 'Std.'],
      [...rows, ['', '', '', 'Gesamt', hours(total)]],
      [0.15, 0.3, 0.2, 0.2, 0.15],
      [4],
      true,
    );
  } else w.text('Keine Zeiten gebucht.', { color: GREY });

  w.heading('Ersatzteile und Material');
  if (parts.length)
    w.table(
      ['Menge', 'Einheit', 'Artikel-Nr.', 'Bezeichnung'],
      parts.map((p) => [p.c.quantity.toLocaleString('de-DE'), p.c.unit, p.number, p.name]),
      [0.12, 0.12, 0.24, 0.52],
      [0],
    );
  else w.text('Keine Teile gebucht.', { color: GREY });

  w.heading('Arbeitsbericht');
  w.text(report?.body?.trim() || '-');
  for (const [k, v] of Object.entries(report?.requiredFields ?? {}))
    if (v !== null && v !== '')
      w.text(
        `${REQUIRED_FIELD_DEFS[k]?.label ?? k}: ${typeof v === 'number' ? v.toLocaleString('de-DE') : v}${REQUIRED_FIELD_DEFS[k]?.unit ? ` ${REQUIRED_FIELD_DEFS[k]!.unit}` : ''}`,
      );

  if (cl && tpl) {
    w.heading(`Checkliste: ${tpl.title}`);
    for (const line of checklistLines(tpl.items, cl.results)) w.text(line);
  }

  w.heading('Bestätigung des Kunden');
  if (sig?.imagePng) {
    const png = await doc.embedPng(Buffer.from(sig.imagePng.split(',')[1] ?? '', 'base64'));
    w.text('Die aufgeführten Arbeiten und Teile wurden ausgeführt bzw. verwendet.', { size: 9 });
    w.image(png, 220, 90);
    w.text(
      `${sig.signerName} · ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(sig.signedAt)}`,
    );
  } else if (sig?.absentReason) w.text(`Ohne Unterschrift: ${sig.absentReason}`);
  else w.text('Keine Unterschrift erfasst.', { color: GREY });

  return doc.save();
}
