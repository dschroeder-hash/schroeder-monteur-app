/**
 * Reads the lines of a manufacturer parts cart (AGCO shop) from a screenshot (E-76). The browser cannot read the
 * shop page itself (other origin), so the Monteur hands over a picture of the cart; an AI model returns part
 * numbers and quantities. Nothing is ordered – the lines only fill the app's parts list for the order.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

export const CART_READER = Symbol('CART_READER');

export interface CartLineRead {
  partNo: string;
  quantity: number;
  name: string | null;
}

export interface CartReader {
  readonly configured: boolean;
  read(image: Buffer, mediaType: CartImageType): Promise<CartLineRead[]>;
}

export const CART_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type CartImageType = (typeof CART_IMAGE_TYPES)[number];

/** Thrown when the model declines or returns nothing usable – shown to the Monteur as a plain message. */
export class CartReadError extends Error {}

const CartSchema = z.object({
  lines: z.array(
    z.object({
      partNo: z.string(),
      quantity: z.number(),
      name: z.string().nullable(),
    }),
  ),
});

const PROMPT = `Das Bild zeigt den Warenkorb bzw. die Bestellanfrage eines Ersatzteil-Shops (z. B. AGCO Parts).
Lies jede Warenkorbzeile aus:
- partNo: die Teilenummer genau wie angezeigt (z. B. hinter „AGCO-Teilenr.“), ohne Zusätze;
- quantity: die eingestellte Menge (die Zahl zwischen den Minus-/Plus-Knöpfen, sonst „n X … pro Stück“);
- name: die Bezeichnung des Teils, falls sichtbar, sonst null.
Nur Zeilen, deren Teilenummer vollständig zu lesen ist. Preise, Summen, Lieferkosten und Bestellnummern
gehören nicht dazu. Ist kein Warenkorb zu sehen, gib eine leere Liste zurück.`;

export class ClaudeCartReader implements CartReader {
  readonly configured = true;
  private readonly client = new Anthropic();
  constructor(private readonly model: string) {}

  async read(image: Buffer, mediaType: CartImageType): Promise<CartLineRead[]> {
    // Server-side fallback: if the model declines, the API retries on a fallback model in the same call.
    const response = await this.client.beta.messages.parse({
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      model: this.model,
      max_tokens: 4000,
      output_config: { effort: 'low', format: zodOutputFormat(CartSchema) },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: image.toString('base64') },
            },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output)
      throw new CartReadError(
        'Der Warenkorb konnte nicht gelesen werden – bitte ein deutlicheres Bild nehmen.',
      );
    return cleanLines(response.parsed_output.lines);
  }
}

/** Dev/test: fixed cart, no external call (CART_AI=mock). */
export class MockCartReader implements CartReader {
  readonly configured = true;
  async read(): Promise<CartLineRead[]> {
    return cleanLines([
      { partNo: 'F931.200.020.010', quantity: 2, name: 'Motorölfilter' },
      { partNo: 'X548844266000', quantity: 1, name: 'O-Ring' },
    ]);
  }
}

export class NoCartReader implements CartReader {
  readonly configured = false;
  async read(): Promise<CartLineRead[]> {
    throw new CartReadError('nicht eingerichtet');
  }
}

/** Plausibility: trimmed part number, whole positive quantity (1–999), duplicates summed. */
export function cleanLines(lines: CartLineRead[]): CartLineRead[] {
  const out = new Map<string, CartLineRead>();
  for (const l of lines) {
    const partNo = l.partNo.trim().replace(/\s+/g, ' ');
    if (!/[0-9]/.test(partNo) || partNo.length < 4 || partNo.length > 40) continue;
    const quantity = Math.min(999, Math.max(1, Math.round(Number.isFinite(l.quantity) ? l.quantity : 1)));
    const key = partNo.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const prev = out.get(key);
    if (prev) prev.quantity = Math.min(999, prev.quantity + quantity);
    else out.set(key, { partNo, quantity, name: l.name?.trim() || null });
  }
  return [...out.values()];
}

export function cartReaderFor(mode: 'off' | 'claude' | 'mock', model: string): CartReader {
  if (mode === 'claude') return new ClaudeCartReader(model);
  if (mode === 'mock') return new MockCartReader();
  return new NoCartReader();
}
