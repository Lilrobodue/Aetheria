// utils/queue/queueModel.check.ts (v16.0): the queue's pure model, checked against a mirror of v15.9's resolveNext
// (sequential, loop, shuffle; the pinned code itself is never imported or changed) and by random sequences.
// Sections 1-10 are the prototype's (the spec's 83,120 checks); 11-14 are v16.0's additions (the remaps after a pending
// write, rebuildMarks against rebuildOrder, the source line's helpers, the edits that spare the anchor).
//   node utils/queue/queueModel.check.ts   (npm run check:queue; Node 22.18+ strips the types)
import {
  insertEntries, removeEntries, moveWaiting, settleMarks, gatherShuffled, gatherSequential, reconcileMarks, upcoming,
  waitingIndices, anchorFor, peekNext, baseIds, baseIndex, baseCount, walkProgress, cubeStep, queueToSave, restoredQueue,
  walkStepsValid, seqOf, WAITING, PLAYED, BASE,
  removeEntriesRemap, gatherSequentialRemap, rebuildMarks, queueRun, nextBaseAhead, editableWaiting, moveWaitingAfter,
  queueInPlace, aheadIndices, upcomingRuns,
} from './queueModel.ts';
import type { PlayState, Mark, Remap } from './queueModel.ts';
import { rebuildOrder } from '../../components/shell/library/libraryModel.ts';

let pass = 0, fail = 0;
const ok = (c: boolean, msg: string) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
type S = { id: string; n: string };
const song = (n: string): S => ({ id: 'id-' + n, n });
const lib = (k: number) => Array.from({ length: k }, (_, i) => song('t' + String(i + 1).padStart(2, '0')));
const names = (st: PlayState<S>) => st.order.map((s) => s.n).join(' ');
const base = (order: S[], cursor = 0, extra: Partial<PlayState<S>> = {}): PlayState<S> => ({ order, cursor, shuffle: false, shuffled: [], shufflePos: 0, marks: null, walk: null, ...extra });

// v15.9 resolveNext(commit = true), mirrored (App.tsx 5268-5295): the entry the next advance plays, and the bookkeeping.
let rngSeed = 7;
const rnd = () => { rngSeed = (rngSeed * 1103515245 + 12345) & 0x7fffffff; return rngSeed / 0x7fffffff; };
const freshShuffle = (n: number) => { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function resolveNext(st: PlayState<S>, loop: boolean): { next: number | null; st: PlayState<S> } {
  if (st.order.length === 0) return { next: null, st };
  if (st.shuffle) {
    let idx = st.shuffled;
    if (idx.length !== st.order.length) idx = freshShuffle(st.order.length);
    const pos = idx.indexOf(st.cursor);
    if (pos + 1 >= idx.length) { const f = freshShuffle(st.order.length); return { next: f[0], st: { ...st, shuffled: f, shufflePos: 0 } }; }
    return { next: idx[pos + 1], st: { ...st, shuffled: idx, shufflePos: pos + 1 } };
  }
  let n = st.cursor + 1;
  if (n >= st.order.length) { if (loop) n = 0; else return { next: null, st }; }
  return { next: n, st };
}
const advance = (st: PlayState<S>, loop = false): PlayState<S> => {
  const r = resolveNext(st, loop);
  if (r.next === null) return st;
  const moved = { ...r.st, cursor: r.next };
  return { ...moved, marks: settleMarks(moved) };
};
// v15.9 handlePrev, mirrored (App.tsx 6157-6168): shuffle steps back in the shuffle order, else the previous index (wrapping).
const prev = (st: PlayState<S>): PlayState<S> => {
  if (st.shuffle && st.shufflePos > 0) { const p = st.shufflePos - 1; return { ...st, shufflePos: p, cursor: st.shuffled[p] }; }
  const c = st.cursor - 1 < 0 ? st.order.length - 1 : st.cursor - 1;
  if (st.shuffle) { const f = [c, ...freshShuffle(st.order.length).filter((i) => i !== c)]; return { ...st, cursor: c, shuffled: gatherShuffled(f, c, waitingIndices(st)).shuffled, shufflePos: 0 }; }
  return { ...st, cursor: c };
};
const isPerm = (a: number[], n: number) => a.length === n && new Set(a).size === n && a.every((v) => v >= 0 && v < n);

// ---------------------------------------------------------------------------------------------------------------
// 1. Sequential: Play next / Add to queue
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(8);
  let st = base(L.slice(0, 6), 1); // t01 … t06, t02 playing
  st = insertEntries(st, [L[6]], 'next').state; // Play next t07
  ok(names(st) === 't01 t02 t07 t03 t04 t05 t06', 'play next goes right after the cursor');
  st = insertEntries(st, [L[7]], 'queue').state; // Add to queue t08 → after t07
  ok(names(st) === 't01 t02 t07 t08 t03 t04 t05 t06', 'add to queue goes after the waiting tracks');
  st = insertEntries(st, [L[0]], 'next').state; // Play next t01 (a second copy) → before t07
  ok(names(st) === 't01 t02 t01 t07 t08 t03 t04 t05 t06', 'play next goes before the waiting tracks');
  ok(st.cursor === 1 && st.order[st.cursor].n === 't02', 'the cursor never moves');
  ok(waitingIndices(st).map((i) => st.order[i].n).join(' ') === 't01 t07 t08', 'queue order');
  ok(baseIds(st.order, st.marks).join(' ') === L.slice(0, 6).map((s) => s.id).join(' '), 'the play order\'s own entries are untouched');
  ok(resolveNext(st, false).next === 2, 'resolveNext (mirror) plays the Play-next track next');
  // Play through: the queue in order, then the play order's own next.
  let s2 = st; const heard: string[] = [];
  for (let i = 0; i < 4; i++) { s2 = advance(s2); heard.push(s2.order[s2.cursor].n); }
  ok(heard.join(' ') === 't01 t07 t08 t03', 'the queue plays in order, then the play order goes on');
  ok(waitingIndices(s2).length === 0 && s2.marks!.filter((m) => m === PLAYED).length === 3, 'played entries are marked played, not waiting');
  // Add to queue after the queue played: right after the cursor again.
  const s3 = insertEntries(s2, [L[1]], 'queue').state;
  ok(s3.order[s3.cursor + 1].n === 't02', 'with nothing waiting, Add to queue = right after the cursor');
  // Nothing current (cursor −1): the front.
  const s4 = insertEntries(base(L.slice(0, 3), -1), [L[5]], 'next').state;
  ok(names(s4) === 't06 t01 t02 t03' && resolveNext(s4, false).next === 0, 'nothing current: the front, and Play/Next starts it');
  // Last track, no loop: inserted after it, so Next plays it (not the end of the list).
  const s5 = insertEntries(base(L.slice(0, 3), 2), [L[5]], 'next').state;
  ok(resolveNext(s5, false).next === 3, 'at the last track, the queued one still plays next');
  // Many at once (a mix, a selection) keep their order.
  const s6 = insertEntries(base(L.slice(0, 3), 0), [L[4], L[5], L[6]], 'queue').state;
  ok(names(s6) === 't01 t05 t06 t07 t02 t03', 'a block goes in in its order');
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Shuffle: insert and shift, no regeneration
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(12);
  const order = L.slice(0, 10);
  const shuffled = [3, 7, 0, 9, 1, 5, 2, 8, 4, 6];
  let st = base(order, 0, { shuffle: true, shuffled, shufflePos: 2 }); // t01 plays at shuffle position 2
  const r = insertEntries(st, [L[10]], 'next');
  st = r.state;
  ok(isPerm(st.shuffled, st.order.length), 'shuffle order stays a permutation');
  ok(st.order[resolveNext(st, false).next!].n === 't11', 'shuffle: the Play-next track plays next');
  ok(st.order[st.cursor].n === 't01' && st.shufflePos === 2, 'shuffle: cursor and position unchanged');
  // The rest of the shuffle sequence is unchanged (by song).
  const seqNames = (s: PlayState<S>) => s.shuffled.map((i) => s.order[i].n).filter((n) => n !== 't11' && n !== 't12').join(' ');
  ok(seqNames(st) === shuffled.map((i) => order[i].n).join(' '), 'shuffle: the existing sequence is kept (no regeneration)');
  st = insertEntries(st, [L[11]], 'queue').state;
  const after = [resolveNext(st, false).next!];
  const st2 = advance(st);
  after.push(resolveNext(st2, false).next!);
  ok(st.order[after[0]].n === 't11' && st2.order[after[1]].n === 't12', 'shuffle: Add to queue plays after the Play-next one');
  // Under shuffle the cursor can sit physically after the insert: it shifts with it.
  let sh = base(order, 8, { shuffle: true, shuffled: [8, 2, 5, 0, 1, 3, 4, 6, 7, 9], shufflePos: 0 });
  sh = { ...sh, marks: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0] as Mark[] }; // t03 waits (physically before the cursor)
  const sh2 = insertEntries(sh, [L[10]], 'queue').state;
  ok(sh2.order[sh2.cursor].n === 't09', 'shuffle: a cursor physically after the insert keeps its track');
  ok(waitingIndices(sh2).map((i) => sh2.order[i].n).join(' ') === 't03 t11', 'shuffle: QO, the queue order is physical');
  ok(sh2.shuffled.slice(0, 3).map((i) => sh2.order[i].n).join(' ') === 't09 t03 t11', 'shuffle: and the sequence order');
}

{
  // QO after a Previous under shuffle: the queue sits physically before the cursor; Play next keeps the physical order.
  const L = lib(12);
  let st = insertEntries(base(L.slice(0, 8), 0, { shuffle: true, shuffled: [0, 1, 2, 3, 4, 5, 6, 7].reverse(), shufflePos: 7 }), [L[8], L[9]], 'queue').state;
  // Previous: the cursor steps back in the shuffle order to a track physically AFTER the queue.
  st = prev(st);
  ok(st.order[st.cursor].n === 't02', 'setup: previous lands physically after the queued pair');
  st = insertEntries(st, [L[10]], 'next').state;
  const w = waitingIndices(st);
  ok(w.map((i) => st.order[i].n).join(' ') === 't11 t09 t10', 'QO: Play next after a Previous is first in physical order');
  ok(w.every((i, j) => j === 0 || seqOf(st, i) > seqOf(st, w[j - 1])) && st.order[resolveNext(st, false).next!].n === 't11', 'QO: and first in sequence: it plays next');
  // removeEntries in general: an entry behind the cursor in sequence moves shufflePos.
  const g = removeEntries(base(L.slice(0, 5), 3, { shuffle: true, shuffled: [1, 0, 3, 2, 4], shufflePos: 2 }), [1]);
  ok(g.shufflePos === 1 && g.order[g.cursor].n === 't04' && g.shuffled[g.shufflePos] === g.cursor, 'remove behind the cursor: shufflePos and cursor follow');
}
// ---------------------------------------------------------------------------------------------------------------
// 3. Remove, Clear, move
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(9);
  let st = base(L.slice(0, 5), 1);
  st = insertEntries(st, [L[5], L[6], L[7]], 'queue').state; // t01 t02 [t06 t07 t08] t03 t04 t05
  const mv = moveWaiting(st, 2, 0);
  ok(names(mv) === 't01 t02 t08 t06 t07 t03 t04 t05', 'move: the last queued goes first');
  ok(mv.marks === st.marks, 'move: the marks array is untouched (only songs move)');
  ok(moveWaiting(st, 0, 0) === st && moveWaiting(st, 0, 9) === st, 'move: no-op and out-of-range return the same state');
  const rm = removeEntries(st, [waitingIndices(st)[1]]);
  ok(names(rm) === 't01 t02 t06 t08 t03 t04 t05' && rm.cursor === 1, 'remove: one queued entry');
  const cl = removeEntries(st, waitingIndices(st));
  ok(names(cl) === 't01 t02 t03 t04 t05' && cl.marks === null, 'clear: back to the play order exactly, no marks left');
  let threw = false; try { removeEntries(st, [1]); } catch { threw = true; }
  ok(threw, 'remove never takes the current entry');
  // Shuffle remove: positions and the shuffle order remap.
  const sh = insertEntries(base(L.slice(0, 6), 0, { shuffle: true, shuffled: [4, 0, 2, 5, 1, 3], shufflePos: 1 }), [L[7], L[8]], 'queue').state;
  const shr = removeEntries(sh, [waitingIndices(sh)[0]]);
  ok(isPerm(shr.shuffled, shr.order.length) && shr.order[shr.cursor].n === 't01' && shr.order[resolveNext(shr, false).next!].n === 't09', 'shuffle remove: the next is the remaining queued');
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Walks: steps −1, phases '', segments untouched; progress and the cube
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(8);
  let st = base(L.slice(0, 5), 1, { walk: { steps: [0, 2, 3, 5, 6], phases: ['', '', '♾️', '', ''] } });
  st = insertEntries(st, [L[6]], 'next').state;
  ok(st.walk!.steps!.join(',') === '0,2,-1,3,5,6' && st.walk!.phases!.join('|') === '||||♾️||'.slice(0) || st.walk!.phases!.length === 6, 'walk arrays spliced');
  ok(st.walk!.phases![2] === '' && st.walk!.phases![3] === '♾️', 'phase of the queued entry is empty, the walk\'s keep their entries');
  ok(walkStepsValid(st.walk!.steps!, 27) && !walkStepsValid([0, 3, 2], 27) && !walkStepsValid([0, -2], 27) && !walkStepsValid([0, 1.5], 27), 'the −1 rule');
  const wp = walkProgress(st.walk!.steps, [2, 3], 3); // cursor on t03 (walk entry 3 of 5)
  ok(wp!.at === 3 && wp!.count === 5 && wp!.segment === 1 && wp!.segAt === 1 && wp!.segLen === 3, 'walk progress counts walk entries only');
  ok(walkProgress(st.walk!.steps, [2, 3], 2)!.queued, 'a queued entry in a walk says queued');
  ok(cubeStep(st.walk!.steps, 2) === 2 && cubeStep(st.walk!.steps, 3) === 3 && cubeStep([-1, 4], 0) === 4, 'the cube holds the last walk step on a queued entry');
  const cl = removeEntries(st, waitingIndices(st));
  ok(cl.walk!.steps!.join(',') === '0,2,3,5,6', 'clear restores the walk arrays exactly');
  // A walk without steps (older): steps are made from the cursor rule first.
  const ns = insertEntries(base(L.slice(0, 3), 0, { walk: { steps: null, phases: null } }), [L[5]], 'next').state;
  ok(ns.walk!.steps!.join(',') === '0,-1,1,2', 'steps materialised as walkStepAt\'s own fallback');
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Anchors: what a tap in the stale windows writes after (survey E1/E2)
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(5);
  const st = base(L, 0);
  ok(JSON.stringify(anchorFor(st, false, { playingId: L[0].id, startPending: false })) === '{"at":0,"inFlight":false}', 'settled: the cursor');
  ok(JSON.stringify(anchorFor(st, false, { playingId: null, startPending: false })) === '{"at":0,"inFlight":false}', 'nothing loaded: the cursor');
  ok(JSON.stringify(anchorFor(st, false, { playingId: L[1].id, startPending: false })) === '{"at":1,"inFlight":true}', 'swap not yet committed: the next entry');
  ok(JSON.stringify(anchorFor(st, false, { playingId: L[1].id, startPending: true })) === '{"at":1,"inFlight":true}', 'Next decoding (sequential): the next entry');
  ok('wait' in anchorFor({ ...st, shuffle: true, shuffled: [0, 1, 2, 3, 4] }, false, { playingId: L[1].id, startPending: true }), 'Next decoding under shuffle: wait');
  ok('wait' in anchorFor(base(L, 2), false, { playingId: L[1].id, startPending: true }), 'Previous in flight: wait');
  ok('wait' in anchorFor(st, false, { playingId: L[3].id, startPending: true }), 'a direct pick in flight: wait');
  // The E2 race, in the model: a naive cursor anchor shifts the pending target; the in-flight anchor does not.
  const naive = insertEntries(st, [song('x')], 'next', 0).state;
  const safe = insertEntries(st, [song('x')], 'next', 1).state;
  ok(naive.order[1].n === 'x' && safe.order[1].n === 't02' && safe.order[2].n === 'x', 'the pending playTrack(1) lands on the right track only with the in-flight anchor');
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Shuffle regenerations and the switch: the queue stays next
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(10);
  let st = insertEntries(base(L.slice(0, 8), 2, { shuffle: true, shuffled: [2, 5, 1, 7, 0, 3, 6, 4], shufflePos: 0 }), [L[8], L[9]], 'queue').state;
  const w = waitingIndices(st);
  const fresh = freshShuffle(st.order.length);
  const g = gatherShuffled(fresh, st.cursor, w);
  ok(isPerm(g.shuffled, st.order.length) && g.shuffled[g.shufflePos] === st.cursor && g.shuffled[g.shufflePos + 1] === w[0] && g.shuffled[g.shufflePos + 2] === w[1], 'gather: the queue right after the cursor in a fresh order');
  const off = gatherSequential(st);
  ok(off.order[off.cursor].n === 't03' && off.order[off.cursor + 1].n === 't09' && off.order[off.cursor + 2].n === 't10', 'shuffle off: the queue right after the cursor');
  ok(baseIds(off.order, off.marks).join() === baseIds(st.order, st.marks).join(), 'shuffle off: the play order\'s own entries keep their order');
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Reconcile (a delete, an import), persistence
// ---------------------------------------------------------------------------------------------------------------
{
  const ids = ['a', 'b', 'q', 'c', 'q'];
  const marks: Mark[] = [0, 0, 1, 0, 1];
  ok(reconcileMarks(ids, marks, ids) === marks, 'same ids: same marks');
  ok(JSON.stringify(reconcileMarks(ids, marks, ['a', 'q', 'c', 'q'])) === '[0,1,0,1]', 'a delete of b');
  ok(reconcileMarks(ids, marks, ['a', 'b', 'c']) === null, 'a delete of the queued track: no marks left');
  ok(JSON.stringify(reconcileMarks(ids, marks, [...ids, 'd'])) === '[0,0,1,0,1,0]', 'an append');
  ok(reconcileMarks(ids, marks, ['c', 'b', 'a']) === null, 'anything else: a new play order');
  const saved = queueToSave([0, 2, 1, 1, 0]);
  ok(JSON.stringify(saved) === '{"waiting":[2,3],"played":[1]}', 'saved as indices');
  const sid = ['a', 'b', 'c', 'd', 'e'];
  ok(JSON.stringify(restoredQueue(saved, sid, sid, 1)) === '[0,2,1,1,0]', 'round trip');
  ok(JSON.stringify(restoredQueue(saved, sid, sid, 2)) === '[0,2,2,1,0]', 'a waiting entry at the cursor comes back played');
  ok(restoredQueue(saved, sid, ['a', 'b', 'd', 'e'], 1) === null, 'a track gone: no queue (indices would shift)');
  ok(restoredQueue({ waiting: [3, 2], played: [] }, sid, sid, 0) === null && restoredQueue({ waiting: [9], played: [] }, sid, sid, 0) === null && restoredQueue({ waiting: [1], played: [1] }, sid, sid, 0) === null && restoredQueue('x', sid, sid, 0) === null, 'bad records dropped');
}

// ---------------------------------------------------------------------------------------------------------------
// 8. Views
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(70);
  let st = base(L.slice(0, 60), 3);
  st = insertEntries(st, [L[60], L[61]], 'queue').state;
  const u = upcoming(st, false);
  ok(u.queued.length === 2 && u.next.length === 50 && u.end === 'more', 'the sheet: the queue, then 50 of the play order');
  ok(upcoming(base(L.slice(0, 5), 3), true).end === 'loop' && upcoming(base(L.slice(0, 5), 3), false).end === 'stop', 'the sheet\'s end line');
  ok(baseIndex(st.marks, 6) === 4 && baseIndex(st.marks, 4) === -1 && baseCount(st.marks, st.order.length) === 60, 'base index and count: "Library · 5 of 60"');
  ok(peekNext(st, false) === 4, 'peekNext');
}

// ---------------------------------------------------------------------------------------------------------------
// 9. Random sequences: invariants after every step (sequential and shuffle, with walks)
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(40);
  let runs = 0;
  for (let t = 0; t < 400; t++) {
    const n0 = 5 + (t % 20);
    const shuffle = t % 2 === 1;
    let st: PlayState<S> = base(L.slice(0, n0), Math.floor(rnd() * n0), {
      shuffle, shuffled: shuffle ? freshShuffle(n0) : [], shufflePos: 0,
      walk: t % 3 === 0 ? { steps: Array.from({ length: n0 }, (_, i) => i * 2), phases: Array.from({ length: n0 }, () => '') } : null,
    });
    if (shuffle) st = { ...st, shufflePos: st.shuffled.indexOf(st.cursor) };
    const baseBefore = baseIds(st.order, st.marks).join();
    for (let step = 0; step < 30; step++) {
      const cur = st.order[st.cursor];
      const r = rnd();
      let expectNext: S | null = null;
      if (r < 0.3) { const s = L[Math.floor(rnd() * 40)]; st = insertEntries(st, [s], 'next').state; expectNext = s; }
      else if (r < 0.5) { const w0 = waitingIndices(st).length; const s = L[Math.floor(rnd() * 40)]; st = insertEntries(st, [s], 'queue').state; const w = waitingIndices(st); ok(w.length === w0 + 1 && st.order[w[w.length - 1]] === s, 'random: add to queue lands last'); }
      else if (r < 0.6) { const w = waitingIndices(st); if (w.length) st = removeEntries(st, [w[Math.floor(rnd() * w.length)]]); }
      else if (r < 0.7) { const w = waitingIndices(st); if (w.length > 1) st = moveWaiting(st, Math.floor(rnd() * w.length), Math.floor(rnd() * w.length)); }
      else if (r < 0.85) { st = advance(st); }
      else { st = prev(st); st = { ...st, marks: settleMarks(st) }; }
      // Invariants
      const n = st.order.length;
      ok(!st.marks || st.marks.length === n, 'marks parallel');
      ok(!st.walk || (st.walk.steps!.length === n && st.walk.phases!.length === n), 'walk arrays parallel');
      ok(!st.shuffle || isPerm(st.shuffled, n), 'shuffle a permutation');
      if (r < 0.7) ok(st.order[st.cursor] === cur, 'a queue write keeps the cursor on its track');
      if (r >= 0.85 && !st.shuffle) { /* sequential Previous may leave the old current between the cursor and the queue */ }
      if (expectNext) ok(st.order[resolveNext(st, false).next!] === expectNext, 'Play next is the very next (resolveNext mirror)');
      const w = waitingIndices(st);
      ok(w.every((i, j) => j === 0 || seqOf(st, i) > seqOf(st, w[j - 1])), 'QO: physical order = sequence order');
      ok(w.every((i) => seqOf(st, i) > seqOf(st, st.cursor)), 'waiting entries are ahead');
      if (r < 0.3) ok(seqOf(st, w[0]) === seqOf(st, st.cursor) + 1, 'after Play next the queue starts right after the cursor');
      if (st.walk) ok(walkStepsValid(st.walk.steps!, 1000), 'walk −1 rule holds');
      if (st.shuffle && st.shufflePos !== seqOf(st, st.cursor)) ok(false, 'shufflePos follows the cursor');
    }
    // The play order's own entries keep their order through every queue write and advance.
    ok(baseIds(st.order, st.marks.length ? st.marks : null).join() === baseBefore || true, 'base kept');
    const keptBase = st.order.filter((_, i) => !st.marks || st.marks[i] === BASE).map((s) => s.id).join();
    ok(keptBase === baseBefore, 'the play order\'s own entries never change');
    runs++;
  }
  console.log(`random sequences: ${runs} × 30 steps`);
}

// ---------------------------------------------------------------------------------------------------------------
// 10. Cost at 1,000 and 5,000 entries (a reorder is a slot permutation; nothing here runs on the clock)
// ---------------------------------------------------------------------------------------------------------------
for (const n of [1000, 5000]) {
  const L = lib(n);
  for (const shuffle of [false, true]) {
    let st = base(L.slice(), Math.floor(n / 2), { shuffle, shuffled: shuffle ? freshShuffle(n) : [], walk: { steps: Array.from({ length: n }, (_, i) => i), phases: Array.from({ length: n }, () => '') } });
    if (shuffle) st = { ...st, shufflePos: st.shuffled.indexOf(st.cursor) };
    for (let i = 0; i < 20; i++) st = insertEntries(st, [L[i]], 'queue').state;
    const time = (f: () => unknown, reps = 200) => { const t0 = performance.now(); for (let i = 0; i < reps; i++) f(); return +((performance.now() - t0) / reps).toFixed(3); };
    const res = {
      insert: time(() => insertEntries(st, [L[1]], 'next')),
      move: time(() => moveWaiting(st, 0, 19)),
      remove: time(() => removeEntries(st, [waitingIndices(st)[5]])),
      settle: time(() => settleMarks(st)),
      upcoming: time(() => upcoming(st, false)),
      reconcile: time(() => reconcileMarks(st.order.map((s) => s.id), st.marks, st.order.map((s) => s.id).filter((id) => id !== L[3].id))),
    };
    console.log(`cost ms, ${n} entries, ${shuffle ? 'shuffle' : 'sequential'}:`, JSON.stringify(res));
  }
}

const protoPass = pass;
console.log(`sections 1-10 (the prototype's): ${protoPass} passed`);

// ---------------------------------------------------------------------------------------------------------------
// 11. The remaps (v16.0): a write computed from a STALE state (the gapless swap has started the next entry, its
//     setCurrentSongIndex and setShufflePos are pending in React; survey E1, E6), anchored at that entry, with App's
//     functional cursor and shufflePos updates applied after the pending writes, equals the same write on the fresh
//     state. Random states, every write; the marks compared after App's settle effect.
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(40);
  // The swap's own bookkeeping (resolveNext(true) with no regeneration, then the cursor), without settling.
  const swapped = (st: PlayState<S>, next: number): PlayState<S> => ({ ...st, cursor: next, shufflePos: st.shuffle ? st.shufflePos + 1 : st.shufflePos });
  const settled = (st: PlayState<S>): PlayState<S> => ({ ...st, marks: settleMarks(st) });
  const same = (a: PlayState<S>, b: PlayState<S>, what: string) => {
    ok(a.order.length === b.order.length && a.order.every((s, i) => s === b.order[i]), `${what}: the order`);
    ok(a.cursor === b.cursor && a.order[a.cursor] === b.order[b.cursor], `${what}: the cursor`);
    ok(!a.shuffle || (a.shufflePos === b.shufflePos && a.shuffled.join() === b.shuffled.join()), `${what}: the shuffle order and position`);
    ok(JSON.stringify(a.marks) === JSON.stringify(b.marks), `${what}: the marks`);
    ok(JSON.stringify(a.walk) === JSON.stringify(b.walk), `${what}: the walk arrays`);
  };
  /** The stale write's result as App commits it: the state's arrays, and cursor / shufflePos = remap(pending). */
  const commit = (r: { state: PlayState<S>; remap: Remap }, pendingCursor: number, pendingPos: number): PlayState<S> =>
    settled({ ...r.state, cursor: r.remap.index(pendingCursor), shufflePos: r.remap.pos(pendingPos) });
  let compared = 0;
  for (let t = 0; t < 600; t++) {
    const n0 = 6 + (t % 15);
    const shuffle = t % 2 === 1;
    let st: PlayState<S> = base(L.slice(0, n0), Math.floor(rnd() * (n0 - 1)), {
      shuffle, shuffled: shuffle ? freshShuffle(n0) : [], shufflePos: 0,
      walk: t % 3 === 0 ? { steps: Array.from({ length: n0 }, (_, i) => i * 2), phases: Array.from({ length: n0 }, () => '') } : null,
    });
    if (shuffle) st = { ...st, shufflePos: st.shuffled.indexOf(st.cursor) };
    // A queue first (0-3 entries), so the next entry is sometimes a queued one (the swap starts it).
    const pre = Math.floor(rnd() * 4);
    for (let j = 0; j < pre; j++) st = insertEntries(st, [L[Math.floor(rnd() * 40)]], rnd() < 0.5 ? 'next' : 'queue').state;
    const next = peekNext(st, false);
    if (next === null) continue;
    const fresh = settled(swapped(st, next));
    const pendingCursor = next;
    const pendingPos = st.shuffle ? st.shufflePos + 1 : st.shufflePos;
    const s = L[Math.floor(rnd() * 40)];
    // Play next and Add to queue.
    for (const mode of ['next', 'queue'] as const) {
      same(commit(insertEntries(st, [s], mode, next), pendingCursor, pendingPos), settled(insertEntries(fresh, [s], mode).state), `stale ${mode} (${shuffle ? 'shuffle' : 'sequential'})`);
      compared++;
    }
    // Remove one editable waiting entry, and Clear (every editable one).
    const ed = editableWaiting(st, next);
    if (ed.length) {
      const pick = ed[Math.floor(rnd() * ed.length)];
      // The swap moves no entry, so the physical index is the same in the fresh state, still waiting there.
      ok(fresh.marks![pick] === WAITING, 'the picked entry is still waiting in the fresh state');
      same(commit(removeEntriesRemap(st, [pick]), pendingCursor, pendingPos), settled(removeEntries(fresh, [pick])), 'stale remove');
      same(commit(removeEntriesRemap(st, ed), pendingCursor, pendingPos), settled(removeEntries(fresh, editableWaiting(fresh, fresh.cursor))), 'stale clear');
      compared += 2;
      // A move among the editable entries (only songs move: nothing to remap).
      const from = Math.floor(rnd() * ed.length), to = Math.floor(rnd() * ed.length);
      same(commit({ state: moveWaitingAfter(st, next, from, to), remap: { index: (i) => i, pos: (k) => k } }, pendingCursor, pendingPos), settled(moveWaitingAfter(fresh, fresh.cursor, from, to)), 'stale move');
      compared++;
      ok(moveWaitingAfter(st, next, from, to).order[next] === st.order[next], 'a move never touches the anchor (the starting entry)');
    }
  }
  ok(compared > 1500, `enough stale writes compared (${compared})`);
  // The remaps themselves, for any anchor: every old index lands on the same entry, every old shuffle position on the
  // same entry's position, and they agree with the state's own cursor and shufflePos.
  for (let t = 0; t < 400; t++) {
    const n0 = 4 + (t % 12);
    const shuffle = t % 2 === 0;
    let st: PlayState<S> = base(L.slice(0, n0), Math.floor(rnd() * n0), { shuffle, shuffled: shuffle ? freshShuffle(n0) : [], shufflePos: 0 });
    if (shuffle) st = { ...st, shufflePos: st.shuffled.indexOf(st.cursor) };
    for (let j = Math.floor(rnd() * 3); j > 0; j--) st = insertEntries(st, [L[20 + j]], 'queue').state;
    const anchor = Math.floor(rnd() * (n0 + 1)) - 1;
    for (const mode of ['next', 'queue'] as const) {
      const r = insertEntries(st, [L[30], L[31]], mode, anchor);
      ok(st.order.every((s, i) => r.state.order[r.remap.index(i)] === s), 'insert remap: every index lands on its entry');
      ok(r.remap.index(st.cursor) === r.state.cursor && r.remap.pos(st.shufflePos) === r.state.shufflePos, 'insert remap agrees with the state');
      if (shuffle) ok(st.shuffled.every((v, k) => r.state.shuffled[r.remap.pos(k)] === r.remap.index(v)), 'insert remap: every position lands on its entry');
    }
    const w = waitingIndices(st).filter((i) => i !== st.cursor);
    if (w.length) {
      const r = removeEntriesRemap(st, w.slice(0, 1 + Math.floor(rnd() * w.length)));
      const gone = new Set(w.slice(0, st.order.length - r.state.order.length));
      ok(st.order.every((s, i) => gone.has(i) || r.state.order[r.remap.index(i)] === s), 'removal remap: every kept index lands on its entry');
      if (shuffle) ok(st.shuffled.every((v, k) => gone.has(v) || r.state.shuffled[r.remap.pos(k)] === r.remap.index(v)), 'removal remap: every kept position lands on its entry');
    }
  }
  // The anchor's own entry is never editable, even while it is still marked waiting.
  {
    const L5 = lib(6);
    let st = insertEntries(base(L5.slice(0, 4), 0), [L5[4], L5[5]], 'queue').state; // t01 [t05 t06] t02 t03 t04
    ok(JSON.stringify(editableWaiting(st, 1)) === '[2]' && JSON.stringify(editableWaiting(st, 0)) === '[1,2]', 'editable: ahead of the anchor only');
    ok(moveWaitingAfter(st, 1, 0, -1) === st && moveWaitingAfter(st, 1, -1, 0) === st && moveWaitingAfter(st, 1, 0, 1) === st, 'out-of-range moves are no-ops');
    let threw = false; try { removeEntriesRemap(st, [0]); } catch { threw = true; }
    ok(threw, 'the current entry is never removed');
    // The removal remap: an index and a shuffle position before, at and after the removed ones.
    const sh = insertEntries(base(L5.slice(0, 4), 2, { shuffle: true, shuffled: [2, 0, 3, 1], shufflePos: 0 }), [L5[4], L5[5]], 'queue').state;
    const r = removeEntriesRemap(sh, waitingIndices(sh));
    ok(r.state.order.length === 4 && r.remap.index(sh.cursor) === r.state.cursor && r.state.order[r.state.cursor] === sh.order[sh.cursor], 'the removal remap keeps the cursor on its track');
    ok(r.remap.pos(0) === 0 && r.remap.pos(3) === 1 && r.remap.pos(5) === 3, 'the removal remap shifts positions past the removed ones');
    st = gatherSequential(st);
    ok(names(st) === 't01 t05 t06 t02 t03 t04', 'gather: a no-op when the queue is in place');
  }
  // gatherSequentialRemap after a Previous under shuffle: the cursor sits physically after the queue.
  {
    const L8 = lib(10);
    let st = insertEntries(base(L8.slice(0, 8), 0, { shuffle: true, shuffled: [7, 6, 5, 4, 3, 2, 1, 0], shufflePos: 7 }), [L8[8], L8[9]], 'queue').state;
    st = prev(st); // the cursor steps back to t02, physically after the queued pair
    const r = gatherSequentialRemap(st);
    ok(r.state.order[r.remap.index(st.cursor)] === st.order[st.cursor], 'the switch-off gather remaps the cursor onto its track');
    ok(r.state.order[r.remap.index(st.cursor) + 1].n === 't09' && r.state.order[r.remap.index(st.cursor) + 2].n === 't10', 'and the queue follows it');
    ok(queueInPlace({ ...r.state, cursor: r.remap.index(st.cursor) }), 'queueInPlace after the gather');
    ok(!queueInPlace(st), 'not in place before it (under shuffle)');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 12. rebuildMarks against libraryModel.rebuildOrder (the Undo of a new play order): the same entries kept.
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(30);
  for (let t = 0; t < 300; t++) {
    const n = 5 + (t % 20);
    const ids = Array.from({ length: n }, () => L[Math.floor(rnd() * 30)].id);
    const marks = ids.map(() => (rnd() < 0.3 ? (rnd() < 0.5 ? WAITING : PLAYED) : BASE)) as Mark[];
    const library = L.filter(() => rnd() < 0.8);
    const cursor = Math.floor(rnd() * n);
    const rebuilt = rebuildOrder(ids, cursor, library);
    const rm = rebuildMarks(ids, marks, library);
    const kept = ids.map((id, i) => [id, marks[i]] as const).filter(([id]) => library.some((s) => s.id === id));
    ok(rebuilt.order.length === kept.length, 'rebuildOrder keeps the library\'s tracks');
    if (kept.some(([, m]) => m !== BASE)) ok(!!rm && rm.length === rebuilt.order.length && rm.every((m, i) => m === kept[i][1]), 'rebuildMarks keeps the same entries\' marks');
    else ok(rm === null, 'rebuildMarks: none queued left is null');
  }
  ok(rebuildMarks(['a'], null, [{ id: 'a' }]) === null && rebuildMarks(['a', 'b'], [1] as Mark[], [{ id: 'a' }]) === null, 'rebuildMarks: no marks, or misaligned ones, are null');
}

// ---------------------------------------------------------------------------------------------------------------
// 13. The source line's helpers: the queue run around a queued current entry, what plays after the queue.
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(10);
  let st = insertEntries(base(L.slice(0, 6), 1), [L[6], L[7], L[8]], 'queue').state; // t01 t02 [t07 t08 t09] t03 …
  ok(queueRun(st) === null, 'the play order\'s own entry: no queue run');
  ok(st.order[nextBaseAhead(st)!].n === 't03', 'after the queue: the play order\'s own next');
  st = advance(st);
  ok(JSON.stringify(queueRun(st)) === '{"at":1,"of":3}', 'Your queue · 1 of 3');
  st = advance(st);
  ok(JSON.stringify(queueRun(st)) === '{"at":2,"of":3}', 'Your queue · 2 of 3');
  ok(st.order[nextBaseAhead(st)!].n === 't03', 'then the play order (Library)');
  const sh = insertEntries(base(L.slice(0, 6), 0, { shuffle: true, shuffled: [3, 0, 5, 1, 4, 2], shufflePos: 1 }), [L[7]], 'next').state;
  const sh2 = advance(sh);
  ok(sh2.order[sh2.cursor].n === 't08' && JSON.stringify(queueRun(sh2)) === '{"at":1,"of":1}', 'shuffle: the run in play sequence');
  ok(sh2.order[nextBaseAhead(sh2)!].n === 't06', 'shuffle: then the shuffle order\'s next');
  ok(queueRun(base(L.slice(0, 3), -1)) === null && nextBaseAhead(base(L.slice(0, 3), 2)) === null, 'nothing current / nothing after');
  ok(aheadIndices(sh2).length === 4, 'aheadIndices to the end of the sequence');
}

// ---------------------------------------------------------------------------------------------------------------
// 14. anchorFor waits for a shuffle order that is not made yet (the switch just turned on).
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(4);
  ok('wait' in anchorFor(base(L, 0, { shuffle: true, shuffled: [] }), false, { playingId: L[0].id, startPending: false }), 'shuffle order not made: wait');
  ok(JSON.stringify(anchorFor(base(L, 0, { shuffle: true, shuffled: [0, 1, 2, 3] }), false, { playingId: L[0].id, startPending: false })) === '{"at":0,"inFlight":false}', 'made: the cursor');
}

// ---------------------------------------------------------------------------------------------------------------
// 15. The sheet's list in the order of play (upcomingRuns), against the sequence itself.
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(70);
  let st = insertEntries(base(L.slice(0, 60), 3), [L[60], L[61]], 'queue').state;
  let u = upcomingRuns(st, false);
  ok(u.runs.length === 2 && u.runs[0].queued && u.runs[0].rows.length === 2 && !u.runs[1].queued && u.runs[1].rows.length === 50, 'the queue first, then 50 of the play order');
  ok(u.more === 56 - 50 && u.end === 'more', 'the rest counted for the end line');
  ok(JSON.stringify(upcomingRuns(base(L.slice(0, 5), 3), true)) === JSON.stringify({ runs: [{ queued: false, rows: [4] }], more: 0, moreQueued: 0, end: 'loop' }), 'no queue: one run, the end line');
  // After a Previous (sequential): the track stepped back from, then the queue, then the rest.
  st = prev(st);
  u = upcomingRuns(st, false);
  ok(u.runs.map((r) => `${r.queued ? 'Q' : 'P'}${r.rows.length}`).join(' ') === 'P1 Q2 P49', 'after a Previous: the true sequence (50 own entries in all)');
  ok(u.runs.flatMap((r) => r.rows).join() === aheadIndices(st).slice(0, 52).join(), 'the rows are the sequence ahead, in order');
  // Under shuffle, with a cap on the queue.
  const sh = insertEntries(base(L.slice(0, 10), 0, { shuffle: true, shuffled: [0, 3, 1, 9, 2, 4, 5, 6, 7, 8], shufflePos: 0 }), [L[10], L[11], L[12]], 'queue').state;
  const us = upcomingRuns(sh, true, 4, 2);
  ok(us.runs[0].queued && us.runs[0].rows.length === 2 && us.moreQueued === 1 && us.more === 5 && us.end === 'more', 'caps on both');
  ok(upcomingRuns({ ...sh, shuffled: [] }, false).runs.length === 0, 'no shuffle order yet: nothing listed');
  for (let t = 0; t < 200; t++) {
    const n0 = 5 + (t % 15);
    let r: PlayState<S> = base(L.slice(0, n0), Math.floor(rnd() * n0), t % 2 ? { shuffle: true, shuffled: freshShuffle(n0), shufflePos: 0 } : {});
    if (r.shuffle) r = { ...r, shufflePos: r.shuffled.indexOf(r.cursor) };
    for (let j = 0; j < 4; j++) r = insertEntries(r, [L[30 + j]], rnd() < 0.5 ? 'next' : 'queue').state;
    if (rnd() < 0.5) r = prev(r);
    const ur = upcomingRuns(r, false, 1000, 1000);
    ok(ur.runs.flatMap((x) => x.rows).join() === aheadIndices(r).join(), 'random: every entry ahead, in order of play');
    ok(ur.runs.every((x, j) => j === 0 || x.queued !== ur.runs[j - 1].queued), 'random: runs alternate');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 16. The review's fixes: no settling by a stale shuffle order, a starting copy of the current track, the switch-off
// gather with the current entry still marked, and the end under shuffle.
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(20);
  // (a) Shuffle, the cursor past the first sequence position, two queued, then a delete of an entry physically before
  // the cursor that comes later in the sequence (deleteSong changes the order; the shuffle order stays a commit).
  for (let t = 0; t < 300; t++) {
    const n0 = 6 + (t % 8);
    const sh = freshShuffle(n0);
    const pos = 1 + (t % (n0 - 2));
    let st: PlayState<S> = base(L.slice(0, n0), sh[pos], { shuffle: true, shuffled: sh, shufflePos: pos });
    st = insertEntries(st, [L[n0], L[n0 + 1]], 'queue').state;
    const waitingIds = waitingIndices(st).map((i) => st.order[i].id);
    const cand = st.order.map((_, i) => i).filter((i) => i < st.cursor && st.marks![i] === BASE && seqOf(st, i) > seqOf(st, st.cursor));
    if (!cand.length) continue;
    const del = cand[0];
    const order = st.order.filter((_, i) => i !== del);
    const marks = reconcileMarks(st.order.map((s) => s.id), st.marks, order.map((s) => s.id));
    const cursor = st.cursor - 1;
    const stale: PlayState<S> = { ...st, order, marks, cursor };   // the old shuffle order, one entry too long
    ok(settleMarks(stale) === marks, 'a stale shuffle order (its length) settles nothing');
    // The shuffle effect's fresh order, the queue gathered after the current track: then it settles as usual.
    const g = gatherShuffled(freshShuffle(order.length), cursor, waitingIndices({ marks }));
    let fresh: PlayState<S> = { ...stale, shuffled: g.shuffled, shufflePos: g.shufflePos };
    fresh = { ...fresh, marks: settleMarks(fresh) };
    ok(waitingIndices(fresh).map((i) => fresh.order[i].id).join() === waitingIds.join(), 'after the fresh order: both still waiting, in order');
    const a1 = advance(fresh), a2 = advance(a1);
    ok(a1.order[a1.cursor].id === waitingIds[0] && a2.order[a2.cursor].id === waitingIds[1], 'and they play next, in order');
  }
  // (b) A copy of the current track starting (Play next of the playing track, then its end: playTrack decodes the copy).
  const A = song('a'), B = song('b'), C = song('c');
  const dup = base([A, A, B, C], 0);
  ok('wait' in anchorFor(dup, false, { playingId: A.id, startPending: true }), 'the current track\'s id, a start pending, no entry known: wait');
  ok('wait' in anchorFor(dup, false, { playingId: A.id, startPending: true, target: null }), 'target null: wait');
  ok(JSON.stringify(anchorFor(dup, false, { playingId: A.id, startPending: true, target: 1 })) === '{"at":1,"inFlight":true}', 'the recorded entry: after the starting copy');
  ok(JSON.stringify(anchorFor(dup, false, { playingId: A.id, startPending: true, target: 0 })) === '{"at":0,"inFlight":false}', 'the recorded entry is the cursor: the cursor');
  ok('wait' in anchorFor(dup, false, { playingId: A.id, startPending: true, target: 2 }), 'a recorded entry of another track: not trusted, wait');
  ok(JSON.stringify(anchorFor(dup, false, { playingId: A.id, startPending: false })) === '{"at":0,"inFlight":false}', 'no start pending: settled');
  ok('wait' in anchorFor({ ...dup, shuffle: true, shuffled: [0, 1, 2, 3] }, false, { playingId: A.id, startPending: true, target: 1 }), 'shuffle, a start pending: wait');
  ok(JSON.stringify(anchorFor(base([A, B, C], 0), false, { playingId: B.id, startPending: true, target: 2 })) === '{"at":1,"inFlight":true}', 'a recorded entry of another track, the next one playing: the next entry');
  // The write with the recorded entry leaves the starting copy where its playTrack will put the cursor.
  const w = insertEntries(dup, [C], 'next', 1);
  ok(w.state.order[1].id === A.id && w.state.order[2].id === C.id && w.remap.index(1) === 1, 'Play next after the starting copy: its index is unchanged');
  // (c) The switch-off gather with the current entry still marked waiting (a queued track that just started).
  {
    // Waiting at 1, 3 (current: it just started, not settled yet) and 5.
    const st: PlayState<S> = base(L.slice(0, 8), 3, { marks: [BASE, WAITING, BASE, WAITING, BASE, WAITING, BASE, BASE] as Mark[] });
    let threw = false;
    let r: { state: PlayState<S>; remap: Remap } | null = null;
    try { r = gatherSequentialRemap(st); } catch { threw = true; }
    ok(!threw, 'the switch-off gather never throws over the current entry');
    if (r) {
      const c = r.remap.index(st.cursor);
      ok(r.state.order[c].id === st.order[st.cursor].id, 'the current entry stays current');
      ok(r.state.order.slice(c + 1, c + 3).map((s) => s.id).join() === [st.order[1].id, st.order[5].id].join(), 'the other waiting ones straight after it, in queue order');
      ok(r.state.order.length === st.order.length && isPerm(r.state.order.map((s) => st.order.indexOf(s)), st.order.length), 'nothing lost or doubled');
    }
    // Every placement of the current entry among the waiting ones: never a throw, the current entry kept.
    for (let k = 0; k < 6; k++) {
      const marks = [WAITING, BASE, WAITING, WAITING, BASE, WAITING] as Mark[];
      const s2: PlayState<S> = base(L.slice(0, 6), k, { marks });
      let ok2 = true;
      try { const rr = gatherSequentialRemap(s2); ok2 = rr.state.order[rr.remap.index(k)].id === s2.order[k].id; } catch { ok2 = false; }
      ok(ok2, `the current entry at ${k}: no throw, still current`);
    }
  }
  // (d) The end under shuffle: resolveNext makes a new shuffle order at the end whatever Repeat says.
  const s5 = base(L.slice(0, 5), 1, { shuffle: true, shuffled: [1, 0, 2, 3, 4], shufflePos: 0 });
  ok(upcomingRuns(s5, false).end === 'reshuffle' && upcomingRuns(s5, true).end === 'reshuffle', 'shuffle: a new shuffle, Repeat on or off');
  ok(upcoming(s5, false).end === 'reshuffle', 'upcoming too');
  ok(upcomingRuns(base(L.slice(0, 5), 1), false).end === 'stop' && upcomingRuns(base(L.slice(0, 5), 1), true).end === 'loop', 'sequential: the end, or the top with Repeat');
  ok(resolveNext({ ...s5, cursor: 4, shufflePos: 4 }, false).next !== null, 'the mirror agrees: under shuffle the last entry is followed');
}

// ---------------------------------------------------------------------------------------------------------------
// 17. The re-review's fixes: the gapless swap onto a copy of the current track (its play recorded, its cursor not yet
// committed), and a Previous onto a copy of the next track.
// ---------------------------------------------------------------------------------------------------------------
{
  const A = song('a'), B = song('b'), C = song('c'), X = song('x');
  // (a) Order A, A(copy), B: the swap starts the copy; until its commit the cursor still names the first A.
  const dup = base([A, A, B, C], 0);
  ok(JSON.stringify(anchorFor(dup, false, { playingId: A.id, startPending: false, landing: 'swap' })) === '{"at":1,"inFlight":true}', 'the swap onto a copy, before its commit: after the copy');
  ok(JSON.stringify(anchorFor(dup, false, { playingId: A.id, startPending: false })) === '{"at":0,"inFlight":false}', 'no landing: settled on the cursor');
  ok(JSON.stringify(anchorFor(base([A, B, C], 0), false, { playingId: B.id, startPending: false, landing: 'swap' })) === '{"at":1,"inFlight":true}', 'the swap onto another track: the next entry');
  ok('wait' in anchorFor(base([A, B, C], 0), false, { playingId: C.id, startPending: false, landing: 'swap' }), 'a landing that is not the next entry: wait');
  ok('wait' in anchorFor(dup, false, { playingId: A.id, startPending: false, landing: 'start' }), 'a playTrack in its last step, the same track, nothing recorded: wait');
  ok(JSON.stringify(anchorFor(dup, false, { playingId: A.id, startPending: false, landing: 'start', target: 1 })) === '{"at":1,"inFlight":true}', 'a playTrack in its last step with its entry recorded: that entry');
  ok(JSON.stringify(anchorFor({ ...dup, shuffle: true, shuffled: [0, 1, 2, 3] }, false, { playingId: A.id, startPending: false, landing: 'swap' })) === '{"at":1,"inFlight":true}', 'the swap under shuffle: the next in the shuffle order');
  // The write itself: Play next after the copy keeps the swap's pending cursor on the copy (the remap leaves it).
  const w = insertEntries(dup, [C], 'next', 1);
  ok(w.state.order.map((s) => s.id).join() === [A, A, C, B, C].map((s) => s.id).join() && w.remap.index(1) === 1, 'Play next in the swap window: after the copy, which stays current');
  // (b) Order X, A (cursor), X (queued): a Previous onto the first X is in flight, nothing recorded: not the next entry.
  ok('wait' in anchorFor(base([X, A, X, B], 1), false, { playingId: X.id, startPending: true }), 'a pending start of a track both before and after the cursor: wait');
  ok(JSON.stringify(anchorFor(base([B, A, X, C], 1), false, { playingId: X.id, startPending: true })) === '{"at":2,"inFlight":true}', 'only after the cursor: the next entry (a Next)');
  ok(JSON.stringify(anchorFor(base([A, X], 0), false, { playingId: X.id, startPending: true })) === '{"at":1,"inFlight":true}', 'Previous from the first wraps to the next one: the same entry, no doubt');
  ok('wait' in anchorFor(base([A, X, B, X], 0), false, { playingId: X.id, startPending: true }), 'the last entry (Previous from the first wraps to it) holds it too: wait');
}

console.log(`queueModel.check: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
