import { describe, expect, it } from 'vitest';
import { cleanLines, MockCartReader } from '../src/modules/material/cart-reader.js';

describe('cart reader (E-76)', () => {
  it('cleans the lines read from the cart picture', () => {
    expect(
      cleanLines([
        { partNo: ' X548844266000 ', quantity: 1, name: 'O-Ring' },
        { partNo: 'x548 844 266 000', quantity: 2.4, name: null },
        { partNo: 'Lieferkosten', quantity: 1, name: null },
        { partNo: 'F530200220390', quantity: 0, name: ' ' },
      ]),
    ).toEqual([
      { partNo: 'X548844266000', quantity: 3, name: 'O-Ring' },
      { partNo: 'F530200220390', quantity: 1, name: null },
    ]);
  });
  it('mock returns fixed lines without an external call', async () => {
    expect(await new MockCartReader().read()).toHaveLength(2);
  });
});
