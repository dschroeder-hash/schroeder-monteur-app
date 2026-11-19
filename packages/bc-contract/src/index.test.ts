import { describe, expect, it } from 'vitest';
import { entityPath, endpoints } from './index.js';

describe('bc-contract', () => {
  it('builds standard and custom paths', () => {
    const c = '11111111-1111-1111-1111-111111111111';
    expect(entityPath('items', c)).toBe(`v2.0/companies(${c})/items`);
    expect(entityPath('serviceOrders', c)).toBe(`schroeder/werkstatt/v1.0/companies(${c})/serviceOrders`);
  });

  it('every writable custom endpoint carries the idempotency field', () => {
    for (const [name, e] of Object.entries(endpoints)) {
      if (e.writable?.create) {
        const shape = (e.schema as unknown as { shape: Record<string, unknown> }).shape;
        expect(shape, name).toHaveProperty('monteurAppId');
      }
    }
  });
});
