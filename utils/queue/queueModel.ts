// utils/queue/queueModel.ts (v16.0, the queue)
//
// The queue, inserted into the playing list (plan decision 10). Every function is pure: App reads its play state
// (stateRef, the walk arrays, the marks), calls one of these, and writes the result in ONE batch, so the pinned advance
// code (resolveNext, tryGaplessAdvance, playNext, handlePrev, the media-session Next) finds the queued tracks in the
// play order and the shuffle order with no change of its own.
//
// Marks, parallel to the play order (null: none):
//   0  the play order's own entry;
//   1  queued, waiting (ahead of the current entry in play sequence);
//   2  queued, played or passed (stays in the order, as any entry, for a loop; it no longer counts as queued).
// The marks never drive playback: they only say which entries the queue sheet lists, where "Add to queue" goes, and
// which entries are the play order's own (the source line, "Library" vs "Play order").
//
// Invariant (QO): the waiting entries' physical order in the play order IS their queue order, and so is their order in
// the play sequence. Inserts keep it (Play next goes physically before the first waiting entry, Add to queue after the
// last), moves permute songs among the waiting slots, removals keep relative order, and the gathers restore the sequence
// order after a shuffle order is made afresh.
//
// Each write returns a `remap` for App's cursor and shufflePos updaters: App applies them as FUNCTIONAL updates, so a
// write pending in React (the gapless swap's own setCurrentSongIndex, not yet committed) lands first and is then shifted.
// Prototyped with the spec (83,120 checks, 17 of 17 mutants); checked by queueModel.check.ts (npm run check:queue).
// No app imports and no word that reads as a style name in these comments: tailwind.config.js scans utils/.

export type Mark = 0 | 1 | 2;
export const BASE: Mark = 0;
export const WAITING: Mark = 1;
export const PLAYED: Mark = 2;

export interface HasId {
  id: string;
}
export interface WalkArrays {
  steps: number[] | null;
  phases: string[] | null;
}
export interface PlayState<S extends HasId> {
  order: S[];
  cursor: number;
  shuffle: boolean;
  /** The shuffle order (indices into `order`); must be a permutation of order's indices when `shuffle`. */
  shuffled: number[];
  shufflePos: number;
  marks: Mark[] | null;
  /** The playing walk's per-entry arrays (segments are per walk entry and never change here), or null. */
  walk: WalkArrays | null;
}

/** How a write moves indices: any cursor value (the one App holds, or one a pending write will set) and any shuffle
 *  position, old to new. */
export interface Remap {
  index: (i: number) => number;
  pos: (k: number) => number;
}
export const SAME: Remap = { index: (i) => i, pos: (k) => k };

// ---------------------------------------------------------------------------------------------------------------
// The play sequence (what resolveNext walks): the order itself, or the shuffle order.
// ---------------------------------------------------------------------------------------------------------------

/** The shuffle order is usable: a permutation of the order's indices (resolveNext regenerates otherwise). */
export function shuffleValid<S extends HasId>(st: PlayState<S>): boolean {
  return !st.shuffle || st.shuffled.length === st.order.length;
}

/** Sequence position of entry i (−1 for i < 0). Mirrors resolveNext: shuffled.indexOf(index). */
export function seqOf<S extends HasId>(st: PlayState<S>, i: number): number {
  if (i < 0) return -1;
  return st.shuffle ? st.shuffled.indexOf(i) : i;
}

/** The entry at sequence position k. */
export function atSeq<S extends HasId>(st: PlayState<S>, k: number): number {
  return st.shuffle ? st.shuffled[k] : k;
}

/** Indices ahead of the cursor in play sequence, nearest first, to the end of the sequence (no wrap). */
export function aheadIndices<S extends HasId>(st: PlayState<S>, limit = Infinity): number[] {
  const out: number[] = [];
  for (let k = seqOf(st, st.cursor) + 1; k < st.order.length && out.length < limit; k++) out.push(atSeq(st, k));
  return out;
}

/** The waiting entries (mark 1), in queue order (= sequence order = physical order, QO). O(n). */
export function waitingIndices<S extends HasId>(st: Pick<PlayState<S>, 'marks'>): number[] {
  if (!st.marks) return [];
  const out: number[] = [];
  for (let i = 0; i < st.marks.length; i++) if (st.marks[i] === WAITING) out.push(i);
  return out;
}

/** The entry that plays after the cursor (resolveNext's peek, without its regenerate cases), or null. */
export function peekNext<S extends HasId>(st: PlayState<S>, loop: boolean): number | null {
  if (st.order.length === 0) return null;
  if (st.shuffle) {
    if (!shuffleValid(st)) return null;
    const k = seqOf(st, st.cursor) + 1;
    return k < st.shuffled.length ? st.shuffled[k] : null;
  }
  const n = st.cursor + 1;
  return n < st.order.length ? n : loop ? 0 : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Where a queue write is anchored. App's half: `playingId` is the id the music element plays (its src, through
// blobUrlsRef: set synchronously by every start, the gapless swap included), or null with nothing loaded.
// ---------------------------------------------------------------------------------------------------------------

export type Anchor = { at: number; inFlight: boolean } | { wait: true };

export interface StartState {
  /** The id the music element plays (its src through blobUrlsRef), or null with nothing loaded. */
  playingId: string | null;
  /** A playTrack has not reached recordPlay yet (startedRequestRef !== playRequestSeqRef): it will write its captured
   *  index to the cursor later, after its awaits. The gapless swap records its play at once, so it never counts. */
  startPending: boolean;
  /** That start's entry when App knows it (a start issued outside the pinned advance code records its index; the
   *  pinned Next, auto-advance and Previous don't), else null or absent. */
  target?: number | null;
  /** A start that has recorded its play (recordPlay) but whose cursor write has not committed yet. 'swap': the gapless
   *  swap (its entry is the one after the cursor, its setCurrentSongIndex already queued in React). 'start': a playTrack
   *  in its last step (it counts as in flight). Null or absent: none. */
  landing?: 'swap' | 'start' | null;
}

/**
 * The entry the queue writes after.
 *   Settled (no start in flight, the element plays the cursor's track, or nothing): the cursor.
 *   The gapless swap's render not committed yet (survey E1, E6: ~31 ms, 2 tasks; it records its play at once, so no
 *     start is pending): its target is the entry after the cursor, its setCurrentSongIndex is already queued in React,
 *     so App's functional cursor/shufflePos shifts apply after it: any write is safe with that entry as the anchor.
 *   A playTrack still awaiting its decode or play() (survey E2) writes its captured index LATER, so nothing may move
 *     physically at or before that index. Sequential writes only touch indices after the anchor, so its entry is the
 *     anchor when it is known: the one App recorded, else the entry after the cursor when the element plays another
 *     track than the cursor's (Next, auto-advance, the car's Next). The element playing the cursor's own track is no
 *     proof of a settled start: a restart, or a copy of the same track starting (Play next of the playing track, then
 *     its end), look alike, so with no recorded entry the write waits. Shuffle, or any other start (Previous, a direct
 *     pick, a shuffle wrap that regenerates the order): wait until it lands.
 *   A shuffle order not made yet (the switch just turned on): wait for it.
 * A start's play is recorded before its cursor commits (`landing`): the swap's entry is the next one even when it holds
 * the cursor's own track (a copy of it; the element alone can't tell them apart), and a playTrack's last step is still
 * in flight. With no recorded entry, the pinned code's starts are a Next (the entry after the cursor), a Previous (the
 * entry before it, or the last) and a restart (the cursor's own): the entry after the cursor is the anchor only when no
 * other of them holds the same track.
 */
export function anchorFor<S extends HasId>(st: PlayState<S>, loop: boolean, start: StartState): Anchor {
  if (!shuffleValid(st)) return { wait: true };
  const curId = st.cursor >= 0 && st.cursor < st.order.length ? st.order[st.cursor].id : null;
  if (start.playingId === null) return { at: st.cursor, inFlight: false };
  const next = peekNext(st, loop);
  const isNext = next !== null && st.order[next].id === start.playingId;
  if (!start.startPending && start.landing !== 'start') {
    if (start.landing === 'swap') return isNext ? { at: next, inFlight: true } : { wait: true };
    if (start.playingId === curId) return { at: st.cursor, inFlight: false };
    return isNext ? { at: next, inFlight: true } : { wait: true };
  }
  if (st.shuffle) return { wait: true };
  const t = start.target;
  if (t !== undefined && t !== null && t >= 0 && t < st.order.length && st.order[t].id === start.playingId) return { at: t, inFlight: t !== st.cursor };
  const prev = st.cursor > 0 ? st.cursor - 1 : st.order.length - 1;
  const ambiguous = start.playingId === curId || (prev !== next && st.order[prev]?.id === start.playingId);
  if (isNext && !ambiguous) return { at: next, inFlight: true };
  return { wait: true };
}

// ---------------------------------------------------------------------------------------------------------------
// The writes
// ---------------------------------------------------------------------------------------------------------------

function spliceCopy<T>(a: readonly T[], at: number, del: number, add: readonly T[]): T[] {
  const out = a.slice();
  out.splice(at, del, ...add);
  return out;
}
const fill = <T>(n: number, v: T): T[] => Array.from({ length: n }, () => v);

export interface InsertResult<S extends HasId> {
  state: PlayState<S>;
  /** Physical index of the first inserted entry. */
  at: number;
  count: number;
  remap: Remap;
}

/**
 * Play next (`next`): right after the anchor in play sequence. Add to queue (`queue`): after the last waiting entry
 * ahead of the anchor, else right after the anchor. Writes the order, the marks, the walk arrays (step −1, phase ''),
 * and under shuffle the shuffle order (indices at or after the insert shift up; the new ones go in at their sequence
 * place; no regeneration). The cursor and shufflePos only move when entries go in physically before them.
 */
export function insertEntries<S extends HasId>(st: PlayState<S>, songs: readonly S[], mode: 'next' | 'queue', anchor: number = st.cursor): InsertResult<S> {
  const k = songs.length;
  if (k === 0) return { state: st, at: -1, count: 0, remap: SAME };
  if (!shuffleValid(st)) throw new Error('insertEntries: invalid shuffle order (App generates one first)');
  const n = st.order.length;
  const anchorSeq = seqOf(st, anchor);
  const waiting = waitingIndices(st).filter((i) => seqOf(st, i) > anchorSeq);
  // Sequence position the new entries follow, and their physical index.
  let afterSeq = anchorSeq;
  let p: number;
  if (mode === 'queue' && waiting.length > 0) {
    const last = waiting[waiting.length - 1];
    afterSeq = seqOf(st, last);
    p = last + 1;
  } else if (st.shuffle && waiting.length > 0) {
    p = waiting[0]; // physically before the first waiting entry (QO), sequentially right after the anchor
  } else {
    p = anchorSeq < 0 ? 0 : atSeq(st, anchorSeq) + 1;
  }
  if (!st.shuffle) p = afterSeq + 1;
  const order = spliceCopy(st.order, p, 0, songs);
  const marks = spliceCopy(st.marks ?? fill<Mark>(n, BASE), p, 0, fill<Mark>(k, WAITING));
  let walk = st.walk;
  if (walk) {
    const steps = walk.steps ? spliceCopy(walk.steps, p, 0, fill(k, -1)) : spliceCopy(Array.from({ length: n }, (_, i) => i), p, 0, fill(k, -1));
    const phases = walk.phases ? spliceCopy(walk.phases, p, 0, fill(k, '')) : null;
    walk = { steps, phases };
  }
  const shiftIndex = (i: number) => (i >= p ? i + k : i);
  const cursor = st.cursor >= p ? st.cursor + k : st.cursor;
  let shuffled = st.shuffled;
  let shufflePos = st.shufflePos;
  if (st.shuffle) {
    const shifted = st.shuffled.map((v) => (v >= p ? v + k : v));
    shuffled = spliceCopy(shifted, afterSeq + 1, 0, Array.from({ length: k }, (_, j) => p + j));
    if (shufflePos > afterSeq) shufflePos += k;
  }
  const shuffle = st.shuffle;
  const remap: Remap = { index: shiftIndex, pos: (q) => (shuffle && q > afterSeq ? q + k : q) };
  return { state: { ...st, order, marks, walk, cursor, shuffled, shufflePos }, at: p, count: k, remap };
}

/** Remove entries (the queue's Remove and Clear: never the current one). Cursor, shuffle order, marks and walk follow.
 *  The remap shifts any index and any shuffle position by the removals before it. */
export function removeEntriesRemap<S extends HasId>(st: PlayState<S>, indices: readonly number[]): { state: PlayState<S>; remap: Remap } {
  const drop = new Set(indices.filter((i) => i >= 0 && i < st.order.length));
  if (drop.size === 0) return { state: st, remap: SAME };
  if (drop.has(st.cursor)) throw new Error('removeEntries: never the current entry');
  const keep = (i: number) => !drop.has(i);
  const sortedDrop = [...drop].sort((a, b) => a - b);
  const before = (i: number) => { let c = 0; for (const d of sortedDrop) { if (d < i) c++; else break; } return c; };
  const order = st.order.filter((_, i) => keep(i));
  const marks = st.marks ? st.marks.filter((_, i) => keep(i)) : null;
  const walk = st.walk ? { steps: st.walk.steps ? st.walk.steps.filter((_, i) => keep(i)) : null, phases: st.walk.phases ? st.walk.phases.filter((_, i) => keep(i)) : null } : null;
  const cursor = st.cursor < 0 ? st.cursor : st.cursor - before(st.cursor);
  let shuffled = st.shuffled;
  let shufflePos = st.shufflePos;
  // The sequence positions removed (shuffle), for the shufflePos remap.
  const droppedSeq: number[] = [];
  if (st.shuffle) {
    // Remap through a prefix count (O(n)).
    const shift = new Int32Array(st.order.length + 1);
    for (let i = 0, c = 0; i < st.order.length; i++) { shift[i] = c; if (drop.has(i)) c++; }
    let posDrop = 0;
    const out: number[] = [];
    st.shuffled.forEach((v, k) => { if (drop.has(v)) { droppedSeq.push(k); if (k < st.shufflePos) posDrop++; } else out.push(v - shift[v]); });
    shuffled = out;
    shufflePos = st.shufflePos - posDrop;
  }
  const remap: Remap = {
    index: (i) => (i < 0 ? i : i - before(i)),
    pos: (q) => { let c = 0; for (const d of droppedSeq) { if (d < q) c++; else break; } return q - c; },
  };
  return { state: { ...st, order, marks: marks && marks.some((m) => m !== BASE) ? marks : null, walk, cursor, shuffled, shufflePos }, remap };
}

/** removeEntriesRemap's state alone (the prototype's signature). */
export function removeEntries<S extends HasId>(st: PlayState<S>, indices: readonly number[]): PlayState<S> {
  return removeEntriesRemap(st, indices).state;
}

/** Reorder the queue: the waiting entry at queue position `from` goes to `to`. Only songs move, among the waiting slots
 *  (their marks, steps and phases are identical: 1, −1, ''), so nothing else changes and no index shifts. */
export function moveWaiting<S extends HasId>(st: PlayState<S>, from: number, to: number): PlayState<S> {
  const slots = waitingIndices(st);
  if (from === to || from < 0 || to < 0 || from >= slots.length || to >= slots.length) return st;
  const songs = slots.map((i) => st.order[i]);
  const [s] = songs.splice(from, 1);
  songs.splice(to, 0, s);
  const order = st.order.slice();
  slots.forEach((i, j) => { order[i] = songs[j]; });
  return { ...st, order };
}

/** The waiting entries a queue edit may touch: those ahead of the anchor in sequence. With a start in flight the anchor
 *  is the entry after the cursor, which may itself still be marked waiting (it is starting): it is never moved or
 *  removed. Queue order (QO). */
export function editableWaiting<S extends HasId>(st: PlayState<S>, anchor: number): number[] {
  const a = seqOf(st, anchor);
  return waitingIndices(st).filter((i) => seqOf(st, i) > a);
}

/** Reorder among the editable waiting entries (positions in editableWaiting): moveWaiting, offset past the waiting
 *  entries at or behind the anchor (QO puts them first). */
export function moveWaitingAfter<S extends HasId>(st: PlayState<S>, anchor: number, from: number, to: number): PlayState<S> {
  const editable = editableWaiting(st, anchor).length;
  if (from < 0 || to < 0 || from >= editable || to >= editable) return st;
  const offset = waitingIndices(st).length - editable;
  return moveWaiting(st, offset + from, offset + to);
}

/** After the cursor moves: waiting entries at or behind it in play sequence become played (2). The same marks array
 *  when nothing changes (App's setState is then a no-op). A shuffle order that does not describe the play order (a
 *  delete changed the order's length; App's shuffle effect makes a fresh one, the queue gathered, a commit later) is
 *  no sequence to judge by: nothing settles until it does. */
export function settleMarks<S extends HasId>(st: PlayState<S>): Mark[] | null {
  if (!st.marks) return null;
  if (!shuffleValid(st)) return st.marks;
  const cur = seqOf(st, st.cursor);
  if (cur < 0) return st.marks;
  let out: Mark[] | null = null;
  for (let i = 0; i < st.marks.length; i++) {
    if (st.marks[i] !== WAITING) continue;
    if (seqOf(st, i) <= cur) { if (!out) out = st.marks.slice(); out[i] = PLAYED; }
  }
  return out ?? st.marks;
}

/**
 * A shuffle order made afresh (App's shuffle effect after a length change or the switch, or playTrack's own pick rule):
 * the waiting entries, in queue order, straight after the cursor. The rest keep the fresh order.
 */
export function gatherShuffled(fresh: readonly number[], cursor: number, waitingIn: readonly number[]): { shuffled: number[]; shufflePos: number } {
  // The current entry is never waiting (a pick of a queued entry consumes it).
  const waiting = waitingIn.filter((v) => v !== cursor);
  if (waiting.length === 0) return { shuffled: fresh.slice(), shufflePos: Math.max(0, fresh.indexOf(cursor)) };
  const w = new Set(waiting);
  const rest = fresh.filter((v) => !w.has(v));
  const at = cursor >= 0 ? rest.indexOf(cursor) : -1;
  const shuffled = [...rest.slice(0, at + 1), ...waiting, ...rest.slice(at + 1)];
  return { shuffled, shufflePos: Math.max(0, at) };
}

/** The waiting entries sit straight after the cursor in the play sequence, in queue order (nothing to gather). */
export function queueInPlace<S extends HasId>(st: PlayState<S>): boolean {
  const waiting = waitingIndices(st).filter((i) => i !== st.cursor);
  if (waiting.length === 0) return true;
  const cur = seqOf(st, st.cursor);
  return waiting.every((i, j) => seqOf(st, i) === cur + 1 + j);
}

/** Shuffle switched off: the waiting entries move physically to straight after the cursor (a no-op when already there,
 *  the usual case). */
export function gatherSequential<S extends HasId>(st: PlayState<S>): PlayState<S> {
  return gatherSequentialRemap(st).state;
}
export function gatherSequentialRemap<S extends HasId>(st: PlayState<S>): { state: PlayState<S>; remap: Remap } {
  const seqSt: PlayState<S> = { ...st, shuffle: false, shuffled: [], shufflePos: 0 };
  // The current entry is never moved (it may still be marked waiting for a commit: a queued track that just started).
  const waiting = waitingIndices(seqSt).filter((i) => i !== st.cursor);
  if (waiting.length === 0 || waiting.every((i, j) => i === st.cursor + 1 + j)) return { state: seqSt, remap: SAME };
  const songs = waiting.map((i) => st.order[i]);
  const removed = removeEntriesRemap(seqSt, waiting);
  const inserted = insertEntries(removed.state, songs, 'next');
  return { state: inserted.state, remap: { index: (i) => inserted.remap.index(removed.remap.index(i)), pos: () => 0 } };
}

// ---------------------------------------------------------------------------------------------------------------
// Keeping the marks honest when another writer changes the play order (deleteSong, an import appending, the by-id
// refresh): an O(n) re-alignment, else none (a new play order). Never drives playback.
// ---------------------------------------------------------------------------------------------------------------

export function reconcileMarks(oldIds: readonly string[], marks: readonly Mark[] | null, newIds: readonly string[]): Mark[] | null {
  if (!marks || marks.length !== oldIds.length) return null;
  const same = oldIds.length === newIds.length && oldIds.every((id, i) => id === newIds[i]);
  if (same) return marks as Mark[];
  // Appended (an import into a play order that was the library): the old ids are a prefix.
  if (newIds.length > oldIds.length && oldIds.every((id, i) => id === newIds[i])) return [...marks, ...fill<Mark>(newIds.length - oldIds.length, BASE)];
  // Every occurrence of some ids removed (a delete): newIds is oldIds without them.
  const present = new Set(newIds);
  const kept: Mark[] = [];
  const keptIds: string[] = [];
  for (let i = 0; i < oldIds.length; i++) if (present.has(oldIds[i])) { kept.push(marks[i]); keptIds.push(oldIds[i]); }
  if (keptIds.length === newIds.length && keptIds.every((id, i) => id === newIds[i])) return kept.some((m) => m !== BASE) ? kept : null;
  return null;
}

/** The marks for an Undo's rebuilt play order (libraryModel.rebuildOrder): the entries whose track is still in the
 *  library keep their marks, exactly as rebuildOrder keeps their ids. Null without marks or with none queued left. */
export function rebuildMarks(ids: readonly string[], marks: readonly Mark[] | null, library: readonly HasId[]): Mark[] | null {
  if (!marks || marks.length !== ids.length) return null;
  const lib = new Set<string>();
  for (const s of library) lib.add(s.id);
  const out: Mark[] = [];
  for (let i = 0; i < ids.length; i++) if (lib.has(ids[i])) out.push(marks[i]);
  return out.some((m) => m !== BASE) ? out : null;
}

// ---------------------------------------------------------------------------------------------------------------
// What the views show
// ---------------------------------------------------------------------------------------------------------------

export interface UpcomingRow {
  index: number;
  queued: boolean;
}
/** The queue sheet's list: the waiting entries (up to `maxQueued`), then the play order's own entries ahead, up to
 *  `cap` (the plan's 50). `more`: waiting entries beyond maxQueued. `end`: what follows the last row. */
export function upcoming<S extends HasId>(st: PlayState<S>, loop: boolean, cap = 50, maxQueued = 100): { queued: number[]; more: number; next: number[]; end: 'stop' | 'loop' | 'reshuffle' | 'more' } {
  const ahead = aheadIndices(st);
  const queued: number[] = [];
  const next: number[] = [];
  let more = 0;
  for (const i of ahead) {
    const m = st.marks ? st.marks[i] : BASE;
    if (m === WAITING) { if (queued.length < maxQueued) queued.push(i); else more++; }
    else if (next.length < cap) next.push(i);
  }
  const shownAll = next.length === ahead.length - queued.length - more;
  return { queued, more, next, end: !shownAll ? 'more' : endAfter(st, loop) };
}

/** What follows the last entry of the sequence: under shuffle always a new shuffle order (resolveNext makes one at the
 *  end whatever Repeat says: it never stops), else the top with Repeat, else the end. */
function endAfter<S extends HasId>(st: PlayState<S>, loop: boolean): 'stop' | 'loop' | 'reshuffle' {
  return st.shuffle ? 'reshuffle' : loop ? 'loop' : 'stop';
}

export interface UpcomingRun {
  queued: boolean;
  rows: number[];
}
/**
 * The Up next sheet's list in the ORDER OF PLAY (spec §3.12, "the true sequence"): the runs of waiting entries and of
 * the play order's own entries as they come in the sequence ahead. Usually one queued run, then the play order's own;
 * after a Previous, the track stepped back from comes before the queue. Up to `maxQueued` waiting entries and `cap` own
 * entries are listed; `more` counts the own entries ahead not listed (the end line's "Then 388 more tracks"),
 * `moreQueued` the waiting ones. `end`: what follows the last listed row, as upcoming's.
 */
export function upcomingRuns<S extends HasId>(st: PlayState<S>, loop: boolean, cap = 50, maxQueued = 100): { runs: UpcomingRun[]; more: number; moreQueued: number; end: 'stop' | 'loop' | 'reshuffle' | 'more' } {
  const runs: UpcomingRun[] = [];
  let own = 0, queued = 0, more = 0, moreQueued = 0;
  if (shuffleValid(st)) {
    for (const i of aheadIndices(st)) {
      const q = !!st.marks && st.marks[i] === WAITING;
      if (q ? queued >= maxQueued : own >= cap) {
        if (q) moreQueued++;
        else more++;
        continue;
      }
      if (q) queued++;
      else own++;
      const last = runs[runs.length - 1];
      if (last && last.queued === q) last.rows.push(i);
      else runs.push({ queued: q, rows: [i] });
    }
  }
  return { runs, more, moreQueued, end: more > 0 ? 'more' : endAfter(st, loop) };
}

/** The play order's own entries (marks 0): its count, and the index among them of entry i (−1 for a queued one). */
export function baseIndex(marks: readonly Mark[] | null, i: number): number {
  if (!marks) return i;
  if (i < 0 || i >= marks.length || marks[i] !== BASE) return -1;
  let c = 0;
  for (let j = 0; j < i; j++) if (marks[j] === BASE) c++;
  return c;
}
export function baseCount(marks: readonly Mark[] | null, n: number): number {
  if (!marks) return n;
  let c = 0;
  for (const m of marks) if (m === BASE) c++;
  return c;
}
export function baseIds<S extends HasId>(order: readonly S[], marks: readonly Mark[] | null): string[] {
  return marks ? order.filter((_, i) => marks[i] === BASE).map((s) => s.id) : order.map((s) => s.id);
}

/** The run of queued entries (marks 1 or 2) around the current one in play sequence, when the current one is queued:
 *  "Your queue · 2 of 3". Null when the current entry is the play order's own (or nothing is current). */
export function queueRun<S extends HasId>(st: PlayState<S>): { at: number; of: number } | null {
  const m = st.marks;
  if (!m || st.cursor < 0 || st.cursor >= m.length || m[st.cursor] === BASE || !shuffleValid(st)) return null;
  const cur = seqOf(st, st.cursor);
  if (cur < 0) return null;
  let first = cur;
  while (first > 0 && m[atSeq(st, first - 1)] !== BASE) first--;
  let last = cur;
  while (last + 1 < st.order.length && m[atSeq(st, last + 1)] !== BASE) last++;
  return { at: cur - first + 1, of: last - first + 1 };
}

/** The first of the play order's own entries ahead of the cursor in sequence (what plays after the queue), or null. */
export function nextBaseAhead<S extends HasId>(st: PlayState<S>): number | null {
  if (!shuffleValid(st)) return null;
  for (let k = seqOf(st, st.cursor) + 1; k < st.order.length; k++) {
    const i = atSeq(st, k);
    if (!st.marks || st.marks[i] === BASE) return i;
  }
  return null;
}

/** A walk's progress for the source line and classic's chip, counting walk entries only (step ≥ 0): "step 4 of 27"
 *  and the segment by walk-entry index. A queued entry (step −1): queued. */
export function walkProgress(steps: readonly number[] | null, segments: readonly number[] | null, cursor: number): { queued: boolean; at: number; count: number; segment: number; segAt: number; segLen: number } | null {
  if (cursor < 0) return null;
  if (!steps) {
    return { queued: false, at: cursor + 1, count: NaN, segment: -1, segAt: 0, segLen: 0 };
  }
  if (steps[cursor] === -1) return { queued: true, at: 0, count: steps.filter((s) => s >= 0).length, segment: -1, segAt: 0, segLen: 0 };
  let at = 0;
  let count = 0;
  for (let i = 0; i < steps.length; i++) if (steps[i] >= 0) { count++; if (i <= cursor) at++; }
  let segment = -1, segAt = 0, segLen = 0;
  if (segments) {
    let start = 0;
    for (let s = 0; s < segments.length; s++) {
      if (at - 1 < start + segments[s]) { segment = s; segAt = at - start; segLen = segments[s]; break; }
      start += segments[s];
    }
  }
  return { queued: false, at, count, segment, segAt, segLen };
}

/** The cube's step: the walk's own; on a queued entry the last walk step before it (else the next one). */
export function cubeStep(steps: readonly number[] | null, cursor: number): number {
  if (!steps || cursor < 0 || cursor >= steps.length) return cursor;
  if (steps[cursor] >= 0) return steps[cursor];
  for (let j = cursor - 1; j >= 0; j--) if (steps[j] >= 0) return steps[j];
  for (let j = cursor + 1; j < steps.length; j++) if (steps[j] >= 0) return steps[j];
  return -1;
}

// ---------------------------------------------------------------------------------------------------------------
// The 'current' record's optional `queue` field (DB_VERSION stays 2)
// ---------------------------------------------------------------------------------------------------------------

export interface SavedQueue {
  waiting: number[];
  played: number[];
}
export function queueToSave(marks: readonly Mark[] | null): SavedQueue | null {
  if (!marks) return null;
  const waiting: number[] = [];
  const played: number[] = [];
  marks.forEach((m, i) => { if (m === WAITING) waiting.push(i); else if (m === PLAYED) played.push(i); });
  return waiting.length || played.length ? { waiting, played } : null;
}
/** The stored queue, validated against the restored order (exactly the saved ids, as restoredWalk), or null. After a
 *  reload the order plays in sequence (shuffle is never restored), so a waiting entry at or before the cursor is
 *  restored as played. */
export function restoredQueue(raw: unknown, savedIds: readonly string[], restoredIds: readonly string[], cursor: number): Mark[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  const n = restoredIds.length;
  if (n === 0 || n !== savedIds.length) return null;
  for (let i = 0; i < n; i++) if (restoredIds[i] !== savedIds[i]) return null;
  const ok = (a: unknown): a is number[] => Array.isArray(a) && a.every((x, j) => Number.isInteger(x) && x >= 0 && x < n && (j === 0 || x > (a as number[])[j - 1]));
  if (!ok(q.waiting) || !ok(q.played)) return null;
  const marks = fill<Mark>(n, BASE);
  for (const i of q.played) marks[i] = PLAYED;
  for (const i of q.waiting) { if (marks[i] !== BASE) return null; marks[i] = i > cursor ? WAITING : PLAYED; }
  return marks.some((m) => m !== BASE) ? marks : null;
}

/** v15.9's restoredWalk with the queue's rule (survey: v15.9 drops any walk holding a −1 step): steps are integers,
 *  −1 (a queued entry) or a walk position; the walk positions strictly increasing; segments sum to the WALK entries. */
export function walkStepsValid(steps: readonly unknown[], walkLength: number): boolean {
  let last = -1;
  for (const s of steps) {
    if (!Number.isInteger(s)) return false;
    if (s === -1) continue;
    if ((s as number) <= last || (s as number) >= walkLength) return false;
    last = s as number;
  }
  return true;
}
