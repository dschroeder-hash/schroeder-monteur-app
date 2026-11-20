import { STAMP_COMMAND_KIND, type CommandType } from '@schroeder/shared';

/** Same stamp action within this window = one tap (gloves, bouncing touch screens). */
export const DOUBLE_TAP_MS = 1500;

/**
 * Guards stamp commands against double taps: the same command type with the same payload within DOUBLE_TAP_MS
 * returns the id of the first command instead of recording a second one. Other commands are never suppressed.
 */
export function createDoubleTapGuard(now: () => number = Date.now) {
  const last = new Map<string, { at: number; id: string }>();
  return {
    check(type: CommandType, payload: unknown): string | null {
      if (!(type in STAMP_COMMAND_KIND)) return null;
      const hit = last.get(`${type}|${JSON.stringify(payload)}`);
      return hit && now() - hit.at < DOUBLE_TAP_MS ? hit.id : null;
    },
    remember(type: CommandType, payload: unknown, id: string) {
      if (type in STAMP_COMMAND_KIND) last.set(`${type}|${JSON.stringify(payload)}`, { at: now(), id });
    },
  };
}
