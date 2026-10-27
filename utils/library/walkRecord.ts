// utils/library/walkRecord.ts (v15.9)
//
// "Walks survive a reload": the walk that built the play order (its mode, the per-segment counts, the phase tokens and
// the cube steps) is stored on the play state's 'current' record, beside the play order it belongs to (the same write,
// so the two can't drift). On restore it reaches App's state only through restoredWalk(), which drops it unless it is
// exactly consistent with the play order that came back: every saved id restored (a track whose audio is gone ends the
// walk, as a delete does today), and each array the order's length with sane values. A record without a walk (any
// release before v15.9) restores no walk, as before. Pure; checked by walkRecord.check.ts (check:playlists).
// v16.0: queued tracks are entries of the walk's play order with step -1 and phase '' (utils/queue/queueModel.ts), so a
// walk with a queue survives a reload: the walk positions (the steps >= 0) strictly increase, and the segments count
// the walk entries only.

import { LO_SHU_WALKS } from '../../constants.ts';
import type { LoShuWalkMode } from '../../constants.ts';

export interface SavedWalk {
  mode: LoShuWalkMode;
  segments: number[] | null;
  phases: string[] | null;
  steps: number[] | null;
}

const MODES: readonly string[] = Object.keys(LO_SHU_WALKS);
const SEGMENT_COUNT: Readonly<Record<string, number>> = { combined: 3, ouroboros: 1, cabi: 4 };
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

/** The walk to store with a play order (a copy), or null when no walk plays. */
export function walkToSave(mode: LoShuWalkMode | null, segments: number[] | null, phases: string[] | null, steps: number[] | null): SavedWalk | null {
  if (!mode) return null;
  return { mode, segments: segments ? segments.slice() : null, phases: phases ? phases.slice() : null, steps: steps ? steps.slice() : null };
}

/**
 * The stored walk, validated against the restored play order, or null.
 * v16.0 (the queue): a step is an integer, either -1 (a queued entry) or a walk position; the walk positions strictly
 * increase and stay in range; with steps, the segments sum to the walk entries (steps >= 0), and a queued entry's
 * phase is ''. (v15.9 dropped any walk holding a -1 step; rolling back to it drops such a walk, keeping the order.)
 * @param raw          the record's `walk` field (anything: it comes from storage)
 * @param savedIds     the record's play order, as saved
 * @param restoredIds  the play order as restored (tracks whose audio is gone are missing from it)
 */
export function restoredWalk(raw: unknown, savedIds: readonly string[], restoredIds: readonly string[]): SavedWalk | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.mode !== 'string' || !MODES.includes(w.mode)) return null;
  const mode = w.mode as LoShuWalkMode;
  const n = restoredIds.length;
  if (n === 0 || n !== savedIds.length) return null;
  for (let i = 0; i < n; i++) if (restoredIds[i] !== savedIds[i]) return null;

  let steps: number[] | null = null;
  // The walk's own entries (steps >= 0): all of them without steps.
  let walkEntries = n;
  if (w.steps != null) {
    if (!Array.isArray(w.steps) || w.steps.length !== n) return null;
    const len = LO_SHU_WALKS[mode].length;
    let last = -1;
    walkEntries = 0;
    for (const s of w.steps) {
      if (!isInt(s)) return null;
      if (s === -1) continue; // a queued entry
      if (s <= last || s >= len) return null;
      last = s;
      walkEntries++;
    }
    if (walkEntries === 0) return null;
    steps = (w.steps as number[]).slice();
  }
  let phases: string[] | null = null;
  if (w.phases != null) {
    if (!Array.isArray(w.phases) || w.phases.length !== n || !w.phases.every((p) => typeof p === 'string' && p.length <= 8)) return null;
    if (steps && steps.some((s, i) => s === -1 && (w.phases as string[])[i] !== '')) return null; // a queued entry has no phase
    phases = (w.phases as string[]).slice();
  }
  let segments: number[] | null = null;
  if (w.segments != null) {
    if (!Array.isArray(w.segments) || w.segments.length !== SEGMENT_COUNT[mode]) return null;
    if (!w.segments.every((c) => isInt(c) && c >= 0)) return null;
    if ((w.segments as number[]).reduce((a, b) => a + b, 0) !== walkEntries) return null;
    segments = (w.segments as number[]).slice();
  }
  return { mode, segments, phases, steps };
}
