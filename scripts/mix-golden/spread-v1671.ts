// scripts/mix-golden/spread-v1671.ts (v16.7.3): v16.7.1's spread, frozen.
//
// v16.7.3 (the user's decision 2026-11-04) keeps every track Deep Scan placed on 2178 Hz, the SOURCE crystal, on 2178
// when Auto-Distribute / Assign crystals spreads. Its invariant: a library with no such track gets v16.7.1's plan (the
// same patches, the same counts; F7's capped score aside, see source.check). This file is the v16.7.1 side of that
// comparison, never shipped (only utils/mix/source.check.ts and e2e/tests/assign.spec.ts import it): spreadOrRestore
// below, the helpers it reads that v16.7.3 changes or keeps private (fnv1a, compatibility, spreadFromScan,
// readByDeepScan, measured) and a spread's words (plural, assignNeedsConfirm, assignNothingText, spreadConfirmText,
// assignModeDoneText: v16.7.3's F2 and F3 change them) are copied byte for byte from 666132c:utils/mix/distribution.ts (v16.7.1; v16.7.2 did not
// change that file), in the marked sections below, each with its doc comment. Nothing here may change (source.check
// pins this file's sha256 and compares each section with git's 666132c). The rules it imports are the ones v16.7.3 leaves
// exactly as they were: the origin rule, the reading's crystal, the stand-in, the constants. (v16.7.3's F7 changed
// spreadFromScan, so v16.7.1's own is frozen here too.)
//
// In the e2e suite it also builds "a library v16.7.1 already spread" (its Source tracks moved off 2178, as v16.7.1's
// own code moved them).

import { getHarmonicSolfeggio } from '../../utils/crystalData.ts';
import { ALL_CRYSTALS, SPREAD_MARK, SPREAD_ORDER, crystalOrigin, scanCrystalOf, standInFreq } from '../../utils/mix/distribution.ts';
import type { AssignPlan, AssignSong, CrystalFields, CrystalPatch } from '../../utils/mix/distribution.ts';

// ---- 666132c:utils/mix/distribution.ts lines 120-124 ----
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// ---- lines 158-176 ----
/** The old compatibility score of a stand-in against one crystal (lower is better), verbatim. */
function compatibility(bestMatch: number, freq: number): number {
  let harmonicScore = Math.abs(bestMatch - freq);
  for (let octave = -3; octave <= 3; octave++) {
    if (octave !== 0) {
      const octaveScore = Math.abs(bestMatch - freq * Math.pow(2, octave));
      if (octaveScore < harmonicScore) harmonicScore = octaveScore * 0.5;
    }
  }
  const fifthUp = Math.abs(bestMatch - (freq * 1.5));
  const fifthDown = Math.abs(bestMatch - (freq / 1.5));
  if (fifthUp < harmonicScore) harmonicScore = fifthUp * 0.7;
  if (fifthDown < harmonicScore) harmonicScore = fifthDown * 0.7;
  const fourthUp = Math.abs(bestMatch - (freq * 4 / 3));
  const fourthDown = Math.abs(bestMatch - (freq * 3 / 4));
  if (fourthUp < harmonicScore) harmonicScore = fourthUp * 0.8;
  if (fourthDown < harmonicScore) harmonicScore = fourthDown * 0.8;
  return harmonicScore;
}

// ---- lines 304-314 ----
/** A scanned track a spread placed (on any crystal): recorded as Assign's, its harmonicFreq still Deep Scan's reading. */
export function spreadFromScan(s: CrystalFields): boolean {
  return (
    s.crystalSource === 'assigned' &&
    Number.isFinite(s.harmonicFreq) &&
    (s.harmonicFreq as number) > 0 &&
    !!s.closestSolfeggio &&
    Number.isFinite(s.harmonicDeviation) &&
    (s.harmonicDeviation as number) >= SPREAD_MARK
  );
}

// ---- lines 324-329 ----
/** Deep Scan has read it: its crystal kept or put back, or a spread placed it with the reading kept (review 3: counted as
 *  scanned everywhere: the filters, the health card, classic's readout and diagnostics). */
export function readByDeepScan(s: CrystalFields): boolean {
  const o = crystalOrigin(s);
  return o === 'scan' || o === 'scan-replaced' || spreadFromScan(s);
}

// ---- lines 336-340 ----
/** Deep Scan measured it (its crystal kept, put back, or spread): a spread scores it from its own reading. */
function measured(s: CrystalFields): boolean {
  // Review 3: a reading of 0 (or none) is no reading: such a scan is never spread (see spreadOrRestore).
  return readByDeepScan(s) && Number.isFinite(s.harmonicFreq) && (s.harmonicFreq as number) > 0;
}

// ---- lines 445-556 ----
/** v16.8: the plan of a spread or a way back (planAssign's modes); the same shape, with the mode and its own counts. */
function spreadOrRestore(library: readonly AssignSong[], mode: 'spread' | 'restore'): AssignPlan {
  const seen = new Set<string>();
  const lib: AssignSong[] = [];
  for (const s of library) if (!seen.has(s.id)) { seen.add(s.id); lib.push(s); }
  const before = new Map<number, number>(ALL_CRYSTALS.map((f) => [f, 0]));
  for (const s of lib) if (s.closestSolfeggio && before.has(s.closestSolfeggio)) before.set(s.closestSolfeggio, before.get(s.closestSolfeggio)! + 1);
  const counts = new Map<number, number>(ALL_CRYSTALS.map((f) => [f, 0]));
  const patches = new Map<string, CrystalPatch>();
  const plan = { kept: 0, restored: 0, anchored: 0, given: 0, moved: 0, movedFailed: 0, unchanged: 0, spread: 0 };
  /** Only the fields that differ: a second press (or a spread already spread) writes nothing. */
  const want = (s: AssignSong, w: CrystalPatch) => {
    const p: CrystalPatch = {};
    let any = false;
    for (const k of Object.keys(w) as (keyof CrystalPatch)[]) {
      if (s[k] !== w[k]) {
        (p as Record<string, unknown>)[k] = w[k];
        any = true;
      }
    }
    if (any) patches.set(s.id, p);
    return any;
  };
  if (mode === 'restore') {
    for (const s of lib) {
      let c = s.closestSolfeggio;
      if (spreadFromScan(s)) {
        const f = s.harmonicFreq as number;
        c = scanCrystalOf(f);
        const changed = c !== s.closestSolfeggio;
        want(s, { closestSolfeggio: c, harmonicDeviation: Math.abs(f - c), crystalSource: 'scan' });
        if (changed) plan.restored++;
        else plan.kept++;
      }
      if (c !== undefined && counts.has(c)) counts.set(c, counts.get(c)! + 1);
    }
  } else {
    // Every track is open (decision 8: Assign's earlier placements too), but a scan with no usable reading: Assign's own
    // rule keeps it where it is, and so does a spread (review 3). A measured one is scored from its own reading's crystal;
    // any other from the old stand-in.
    const unreadable = (s: AssignSong) => {
      const o = crystalOrigin(s);
      return (o === 'scan' || o === 'scan-replaced') && !measured(s);
    };
    for (const s of lib) if (unreadable(s) && counts.has(s.closestSolfeggio as number)) counts.set(s.closestSolfeggio!, counts.get(s.closestSolfeggio!)! + 1);
    const open = lib.filter((s) => !unreadable(s)).map((s) => {
      const isMeasured = measured(s);
      const scanCrystal = isMeasured ? scanCrystalOf(s.harmonicFreq as number) : 0;
      const bestMatch = isMeasured ? scanCrystal : getHarmonicSolfeggio(standInFreq(s), true);
      return { s, isMeasured, scanCrystal, key: fnv1a('order:' + s.id), scores: new Map(ALL_CRYSTALS.map((f) => [f, compatibility(bestMatch, f)])) };
    });
    type Open = (typeof open)[number];
    const better = (a: Open, b: Open, f: number) => {
      const d = a.scores.get(f)! - b.scores.get(f)!;
      return d !== 0 ? d < 0 : a.key !== b.key ? a.key < b.key : a.s.id < b.s.id;
    };
    const left = new Set(open);
    const place = (x: Open, f: number) => {
      left.delete(x);
      counts.set(f, counts.get(f)! + 1);
      const s = x.s;
      const had = s.closestSolfeggio;
      if (x.isMeasured) {
        const hf = s.harmonicFreq as number;
        if (f === x.scanCrystal) {
          // Its own Deep Scan crystal: recorded as the scan's.
          want(s, { closestSolfeggio: f, harmonicDeviation: Math.abs(hf - f), crystalSource: 'scan' });
          plan.kept++;
        } else {
          // Moved off it: Assign's (an anchor from now on), the measurement kept as the track's harmonicFreq, marked.
          const changed = want(s, { closestSolfeggio: f, harmonicDeviation: SPREAD_MARK + Math.abs(hf - f), crystalSource: 'assigned' });
          if (had === f && !changed) plan.unchanged++;
          else plan.spread++;
        }
      } else {
        const changed = want(s, { closestSolfeggio: f, harmonicFreq: f, harmonicDeviation: x.scores.get(f)!, crystalSource: 'assigned' });
        if (!had) plan.given++;
        else if (had === f) plan.unchanged++;
        else if (crystalOrigin(s) === 'scan-failed') plan.movedFailed++;
        else plan.moved++;
        void changed;
      }
    };
    for (let level = 1; level <= 3; level++) {
      for (const f of SPREAD_ORDER) {
        if (!left.size) break;
        if (counts.get(f)! >= level) continue;
        let best: Open | null = null;
        for (const x of left) if (!best || better(x, best, f)) best = x;
        if (best) place(best, f);
      }
    }
    const rest = [...left].sort((a, b) => (a.key !== b.key ? a.key - b.key : a.s.id < b.s.id ? -1 : 1));
    for (const x of rest) {
      let min = Infinity;
      for (const f of SPREAD_ORDER) min = Math.min(min, counts.get(f)!);
      let bestF = SPREAD_ORDER[0], bestScore = Infinity;
      for (const f of SPREAD_ORDER) {
        if (counts.get(f) !== min) continue;
        const sc = x.scores.get(f)!;
        if (sc < bestScore) { bestScore = sc; bestF = f; }
      }
      place(x, bestF);
    }
  }
  const perCrystal = ALL_CRYSTALS.map((f) => counts.get(f)!);
  return {
    patches, total: lib.length, ...plan, perCrystal, mode,
    emptyBefore: ALL_CRYSTALS.filter((f) => before.get(f) === 0).length,
    emptyAfter: perCrystal.filter((c) => c === 0).length,
  };
}

// ---- lines 559-559 ----
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---- lines 563-568 ----
/** Assign asks first only when crystals that tracks already have would change. */
export function assignNeedsConfirm(p: AssignPlan): boolean {
  // v16.7.1: a spread also moves scanned tracks off Deep Scan's crystal (p.spread).
  if (p.mode === 'spread') return p.moved + p.movedFailed + (p.spread ?? 0) > 0;
  return p.moved + p.movedFailed + p.restored > 0;
}

// ---- lines 587-594 ----
/** Nothing to change (a second press, or after a delete): the toast. */
export function assignNothingText(p: AssignPlan): string {
  if (p.total === 0) return 'Your library is empty.';
  // v16.7.1: "all 27" only when every crystal has a track (a library of fewer than 27 can't fill them all).
  if (p.mode === 'spread') return p.emptyAfter === 0 ? 'Every track is already spread over all 27 crystals.' : 'Every track is already spread over the crystals.';
  if (p.mode === 'restore') return "Deep Scan's crystals are already in place.";
  return `Every track already has its crystal (${p.kept} from Deep Scan, ${p.anchored + p.unchanged} assigned).`;
}

// ---- lines 640-654 ----
/** v16.7.1: the spread's confirmation (the new layout's health card asks first when crystals tracks have would move). */
function spreadConfirmText(p: AssignPlan): { title: string; body: string } {
  // (A spread's unchanged count mixes scanned and assigned tracks, so only the ones it places now.)
  const unmeasured = p.given + p.moved + p.movedFailed;
  const sentences = [
    p.emptyAfter === 0 ? 'Every track is spread over all 27 crystals, the GUT, HEART and HEAD ranges in turn.' : 'Every track is spread over the crystals, the GUT, HEART and HEAD ranges in turn.',
    p.spread ? `${plural(p.spread, 'scanned track moves', 'scanned tracks move')} off the crystal Deep Scan gave ${p.spread === 1 ? 'it' : 'them'}; Deep Scan's reading is kept.` : '',
    p.given > 0 ? `${plural(p.given, 'track without one gets', 'tracks without one get')} a crystal.` : '',
    p.moved + p.movedFailed > 0 ? `${plural(p.moved + p.movedFailed, 'assigned crystal moves', 'assigned crystals move')}.` : '',
    p.emptyBefore > 0 && p.emptyAfter === 0 ? 'Afterwards every crystal has a track.' : '',
    unmeasured > 0 ? "Assigned crystals aren't a scan: Deep Scan can still analyse those tracks." : '',
    'Keys and visual sync are kept.',
  ];
  return { title: 'Assign crystals?', body: sentences.filter(Boolean).join(' ') };
}

// ---- lines 656-670 ----
/** What a spread or a way back did (the notice, as assignDoneText for Assign's own rule). */
function assignModeDoneText(p: AssignPlan): string {
  const cab = p.perCrystal.filter((c) => c >= 3).length;
  const cover = p.emptyAfter === 0 ? 'Every crystal has a track, so walks have no gaps. ' : `${plural(p.emptyAfter, 'crystal still has', 'crystals still have')} no track. `;
  const ready = cab === 27 ? 'CAB-ready: all 27 crystals have 3 or more.' : `CAB readiness: ${cab}/27 crystals at 3 or more.`;
  if (p.mode === 'restore') return `Deep Scan's crystals are back on ${plural(p.restored, 'track', 'tracks')}. ` + cover + ready;
  const parts = [
    p.spread ? `${plural(p.spread, 'scanned track', 'scanned tracks')} moved off Deep Scan's crystal` : '',
    p.given ? `${plural(p.given, 'track', 'tracks')} got a crystal` : '',
    p.moved + p.movedFailed ? `${plural(p.moved + p.movedFailed, 'assigned crystal', 'assigned crystals')} moved` : '',
  ].filter(Boolean);
  // v16.7.1: no way back in this release, so none is promised.
  const head = p.emptyAfter === 0 ? 'Tracks spread over all 27 crystals' : 'Tracks spread over the crystals';
  return `${head}: ${parts.length ? parts.join(', ') : 'every track keeps its crystal'}. ` + cover + ready + " Deep Scan's readings are kept.";
}

/** v16.7.1's planAssign(library, 'spread'), exactly. */
export function spreadV1671(library: readonly AssignSong[]): AssignPlan {
  return spreadOrRestore(library, 'spread');
}
/** v16.7.1's words for a spread's plan: its confirmation's body, its notice, its toast, and whether it asked first. */
export function wordsV1671(p: AssignPlan): { confirm: string; done: string; nothing: string; needsConfirm: boolean } {
  return { confirm: spreadConfirmText(p).body, done: assignModeDoneText(p), nothing: assignNothingText(p), needsConfirm: assignNeedsConfirm(p) };
}
/** v16.7.1's planAssign(library, 'restore') (v16.7.3 leaves the way back as it was). */
export function restoreV1671(library: readonly AssignSong[]): AssignPlan {
  return spreadOrRestore(library, 'restore');
}
