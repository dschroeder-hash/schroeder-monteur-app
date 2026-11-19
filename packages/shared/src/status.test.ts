import { describe, expect, it } from 'vitest';
import { APP_STATUSES, DEFAULT_STATUS_DEFINITIONS, appStatusFromBc, canTransition } from './status.js';
import { defaultFeatureState } from './features.js';

describe('status machine', () => {
  it('maps every app status except ABGERECHNET to a BC status', () => {
    for (const s of APP_STATUSES) {
      if (s === 'ABGERECHNET') expect(DEFAULT_STATUS_DEFINITIONS[s].bcStatus).toBeNull();
      else expect(DEFAULT_STATUS_DEFINITIONS[s].bcStatus).not.toBeNull();
    }
  });

  it('writes to BC only on Meister approval by default (E-14)', () => {
    const writing = APP_STATUSES.filter((s) => DEFAULT_STATUS_DEFINITIONS[s].writeToBc);
    expect(writing).toEqual(['FREIGEGEBEN']);
  });

  it('Monteur cannot approve or bill', () => {
    expect(canTransition('FERTIG', 'FREIGEGEBEN', 'MONTEUR')).toBe(false);
    expect(canTransition('FERTIG', 'ABGERECHNET', 'MEISTER')).toBe(false);
    expect(canTransition('FERTIG', 'FREIGEGEBEN', 'MEISTER')).toBe(true);
  });

  it('Monteur cannot reopen a terminal order', () => {
    expect(canTransition('FREIGEGEBEN', 'IN_ARBEIT', 'MONTEUR')).toBe(false);
    expect(canTransition('IN_ARBEIT', 'WARTET_TEILE', 'MONTEUR')).toBe(true);
  });

  it('derives initial status from BC', () => {
    expect(appStatusFromBc('Pending')).toBe('NEU');
    expect(appStatusFromBc('On Hold')).toBe('WARTET_KUNDE');
  });
});

describe('feature defaults', () => {
  it('disables works-council modules in prod', () => {
    expect(defaultFeatureState('stamping', 'prod')).toBe(false);
    expect(defaultFeatureState('productivity.team', 'prod')).toBe(false);
    expect(defaultFeatureState('chat', 'prod')).toBe(true);
    expect(defaultFeatureState('dictation.ai', 'prod')).toBe(false);
    expect(defaultFeatureState('stamping', 'dev')).toBe(true);
  });
});
