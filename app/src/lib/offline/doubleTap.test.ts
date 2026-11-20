import { describe, expect, it } from 'vitest';
import { createDoubleTapGuard, DOUBLE_TAP_MS } from './doubleTap';

describe('double tap guard (stamp bar)', () => {
  it('suppresses the same stamp within the window, allows it afterwards and never touches other commands', () => {
    let t = 1_000;
    const g = createDoubleTapGuard(() => t);
    expect(g.check('StampClockIn', {})).toBeNull();
    g.remember('StampClockIn', {}, 'a');
    t += 300;
    expect(g.check('StampClockIn', {})).toBe('a');
    expect(g.check('StampJobStart', { orderId: 'x', activity: 'WORK' })).toBeNull();
    t += DOUBLE_TAP_MS;
    expect(g.check('StampClockIn', {})).toBeNull();
    g.remember('SendChatMessage', { orderId: 'x', body: 'Hallo' }, 'c');
    expect(g.check('SendChatMessage', { orderId: 'x', body: 'Hallo' })).toBeNull();
  });
});
