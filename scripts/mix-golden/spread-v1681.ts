// scripts/mix-golden/spread-v1681.ts (v16.8.2): v16.8.1's spread, frozen.
//
// v16.8.2 ("Key placement") ranks a spread's open tracks by their key band before Deep Scan's compatibility. Its
// invariant: a library with no clear-key track gets v16.8.1's plan (the same patches, the same counts but the new key
// counts) and v16.8.1's words. This file is the v16.8.1 side of that comparison, never shipped (utils/mix/devices.check.ts
// and e2e/tests/keys.spec.ts import it): spreadOrRestore, the private helpers it reads (storedScore, fnv1a, compatibility,
// measured) and a spread's words (plural, assignNeedsConfirm, assignNothingText, spreadConfirmText, assignModeDoneText:
// v16.8.2 adds sentences to two of them) are copied byte for byte from v16.8.1's utils/mix/distribution.ts (the commit
// FROZEN_V1681_REF names in utils/mix/devices.check.ts, the one place it is named), in the marked sections below (its
// line numbers), each with its doc comment. Nothing here may change (devices.check pins this file's sha256 and compares
// each section with git's copy at that commit). The rules it imports are the
// ones v16.8.2 leaves exactly as they were: the origin rule, the reading's crystal, the stand-in, the file key, the
// spread's role and mark, the constants.

import { getHarmonicSolfeggio, SOURCE_FREQ } from '../../utils/crystalData.ts';
import {
  ALL_CRYSTALS, ASSIGN_SCORE_CAP, SPREAD_MARK, SPREAD_ORDER, crystalOrigin, fileKey, readByDeepScan, scanCrystalOf, spreadFromScan,
  spreadRole, standInFreq,
} from '../../utils/mix/distribution.ts';
import type { AssignPlan, AssignSong, CrystalFields, CrystalPatch } from '../../utils/mix/distribution.ts';

// ---- lines 72-72 ----
const storedScore = (score: number) => Math.min(score, ASSIGN_SCORE_CAP);

// ---- lines 226-230 ----
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// ---- lines 272-289 ----
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

// ---- lines 476-480 ----
/** Deep Scan measured it (its crystal kept, put back, or spread): a spread scores it from its own reading. */
function measured(s: CrystalFields): boolean {
  // Review 3: a reading of 0 (or none) is no reading: such a scan is never spread (see spreadOrRestore).
  return readByDeepScan(s) && Number.isFinite(s.harmonicFreq) && (s.harmonicFreq as number) > 0;
}

// ---- lines 615-776 ----
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
  let source = 0; // v16.7.3: a spread's Source tracks (the plan carries it for a spread only; 'restore' is as it was)
  const moves = { off: 0, again: 0, back: 0 }; // v16.7.3 (F2): a spread's measured tracks whose crystal changes
  let readings = 0; // fix round 2 (R3): a spread's tracks with a Deep Scan reading (the notice says they keep it)
  let sourceGiven = 0; // fix round 3 (W3): Source tracks with no crystal, given 2178 as Deep Scan's
  const opened: AssignSong[] = []; // a spread's open tracks (fix round 3, W1, W2: the plan says how many)
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
    // any other from the old stand-in. v16.7.3 (F1): which is which is spreadRole's, the rule the health card reads too.
    // v16.7.3 (the user's decision 2026-11-04): every Source track (Deep Scan read it at 2178 Hz) stays on 2178, or goes
    // back to it, recorded as the scan's, and is never open.
    // v16.8.1 (D3, the user's decision 2026-11-05, "full share on top"): the Source tracks no longer count toward 2178's
    // share. `counts` below is the fill's own count, the 'stays' tracks and the open tracks placed, never a Source track;
    // the fill gives a crystal a track at level L while that count is under L, and the balance gives each next track to
    // a crystal with the fewest. So the open tracks spread evenly over all 27, 2178 included, and 2178 holds its Source
    // tracks besides (270 tracks with 6 Source: about 10 on each crystal, about 16 on 2178). D3b: when the open tracks
    // can't give every crystal the fill's first round has to cover one (`short`), a 2178 that holds Source tracks
    // counts as covered in that round, so the empty crystals get the tracks: 27 − emptyAfter stays
    // min(27, pinned crystals + open tracks), the health card's spreadCover (source.check, devices.check).
    for (const s of lib) {
      const { role, crystal } = spreadRole(s);
      if (role === 'open') { opened.push(s); continue; }
      if (role === 'stays') counts.set(crystal!, counts.get(crystal!)! + 1);
      if (role !== 'source') continue;
      const hf = s.harmonicFreq as number;
      const back = s.closestSolfeggio !== SOURCE_FREQ;
      want(s, { closestSolfeggio: SOURCE_FREQ, harmonicDeviation: Math.abs(hf - SOURCE_FREQ), crystalSource: 'scan' });
      source++;
      readings++;
      // (Fix round 2, R4: one with no crystal at all, a shape Deep Scan never writes, gets one: given, not restored.)
      if (!s.closestSolfeggio) { plan.given++; sourceGiven++; }
      else if (back) plan.restored++;
      else plan.kept++;
      // (v16.8.1, D3: not counted toward 2178's share; perCrystal adds them below.)
    }
    // v16.8.1 (D2): ranked by the file, the same on every device that holds it (fileKey; the id only for exact
    // duplicates, the same file imported twice, and for tracks with no file).
    // v16.8.1 (D5r): and an unmeasured track's stand-in is seeded by its file too (standInFreq itself is unchanged; it
    // reads the id it is given): seeded by the per-device id, one never-scanned or failed track moved measured tracks
    // between devices in most libraries. A track with no file gets its id, so it is as before. (Only the spread reads a
    // stand-in here; the way back, 'restore', never does. Keep, above, still seeds by the id: D5.)
    const open = opened.map((s) => {
      const isMeasured = measured(s);
      if (isMeasured) readings++;
      const scanCrystal = isMeasured ? scanCrystalOf(s.harmonicFreq as number) : 0;
      const fk = fileKey(s);
      const bestMatch = isMeasured ? scanCrystal : getHarmonicSolfeggio(standInFreq({ ...s, id: fk }), true);
      return { s, isMeasured, scanCrystal, fk, key: fnv1a('order:' + fk), scores: new Map(ALL_CRYSTALS.map((f) => [f, compatibility(bestMatch, f)])) };
    });
    type Open = (typeof open)[number];
    // Order-free: (score, the file's hash, the file key, the id). The file key itself after its hash, so two files whose
    // hashes collide are still told apart by what every device has.
    const tie = (a: Open, b: Open) => (a.key !== b.key ? a.key < b.key : a.fk !== b.fk ? a.fk < b.fk : a.s.id < b.s.id);
    const better = (a: Open, b: Open, f: number) => {
      const d = a.scores.get(f)! - b.scores.get(f)!;
      return d !== 0 ? d < 0 : tie(a, b);
    };
    // D3b: too few open tracks for every crystal the first round fills (no 'stays' track on it): 2178, holding Source
    // tracks, counts as covered in that round.
    const short = source > 0 && open.length < SPREAD_ORDER.filter((f) => counts.get(f) === 0).length;
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
          // v16.7.3 (F2): back on it from another crystal (an older spread or Auto-Distribute had moved it).
          if (had && had !== f) moves.back++;
        } else {
          // Moved off it: Assign's (an anchor from now on), the measurement kept as the track's harmonicFreq, marked.
          const changed = want(s, { closestSolfeggio: f, harmonicDeviation: SPREAD_MARK + Math.abs(hf - f), crystalSource: 'assigned' });
          if (had === f && !changed) plan.unchanged++;
          else plan.spread++;
          // v16.7.3 (F2): off its Deep Scan crystal now, or moved again from another one (a record-only change: neither).
          if (had && had !== f) {
            if (had === x.scanCrystal) moves.off++;
            else moves.again++;
          }
        }
      } else {
        // v16.7.3 (F7): the score is stored capped (ASSIGN_SCORE_CAP); the fill above chose by the full score.
        const changed = want(s, { closestSolfeggio: f, harmonicFreq: f, harmonicDeviation: storedScore(x.scores.get(f)!), crystalSource: 'assigned' });
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
        if (counts.get(f)! + (level === 1 && short && f === SOURCE_FREQ ? 1 : 0) >= level) continue;
        let best: Open | null = null;
        for (const x of left) if (!best || better(x, best, f)) best = x;
        if (best) place(best, f);
      }
    }
    const rest = [...left].sort((a, b) => (a === b ? 0 : tie(a, b) ? -1 : 1));
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
  // (v16.8.1, D3: the tracks on each crystal, the Source tracks on 2178 included.)
  const perCrystal = ALL_CRYSTALS.map((f) => counts.get(f)! + (f === SOURCE_FREQ ? source : 0));
  return {
    patches, total: lib.length, ...plan, perCrystal, mode,
    emptyBefore: ALL_CRYSTALS.filter((f) => before.get(f) === 0).length,
    emptyAfter: perCrystal.filter((c) => c === 0).length,
    ...(mode === 'spread' ? { source, ...moves, readings, open: opened.length, sourceGiven } : {}),
  };
}

// ---- lines 779-779 ----
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---- lines 792-799 ----
/** Assign asks first only when crystals that tracks already have would change. */
export function assignNeedsConfirm(p: AssignPlan): boolean {
  // v16.7.1: a spread also moves scanned tracks. v16.7.3: exactly when a crystal a track has changes (F2): an assigned
  // or placeholder crystal moves, a scanned track moves off, again or back (off, again, back), or a Source track goes back
  // on 2178 (restored); a record-only change (the same crystal) does not ask.
  if (p.mode === 'spread') return p.moved + p.movedFailed + (p.off ?? 0) + (p.again ?? 0) + (p.back ?? 0) + p.restored > 0;
  return p.moved + p.movedFailed + p.restored > 0;
}

// ---- lines 818-829 ----
/** Nothing to change (a second press, or after a delete): the toast. */
export function assignNothingText(p: AssignPlan): string {
  if (p.total === 0) return 'Your library is empty.';
  // v16.7.1: "all 27" only when every crystal has a track (a library of fewer than 27 can't fill them all).
  if (p.mode === 'spread') {
    if (p.emptyAfter === 0) return 'Every track is already spread over all 27 crystals.';
    // v16.7.3 (F3): the crystals left empty are the SOURCE tracks' doing (they stay together on 2178), so say so.
    return (p.source ?? 0) > 0 ? 'Every track is already spread over the crystals; tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal.' : 'Every track is already spread over the crystals.';
  }
  if (p.mode === 'restore') return "Deep Scan's crystals are already in place.";
  return `Every track already has its crystal (${p.kept} from Deep Scan, ${p.anchored + p.unchanged} assigned).`;
}

// ---- lines 875-913 ----
/** v16.7.1: the spread's confirmation (the new layout's health card asks first when crystals tracks have would move). */
function spreadConfirmText(p: AssignPlan): { title: string; body: string } {
  // (A spread's unchanged count mixes scanned and assigned tracks, so only the ones it places now.)
  // (Fix round 3, W3: a Source track given 2178 got Deep Scan's crystal, not an assigned one.)
  const unmeasured = p.given - (p.sourceGiven ?? 0) + p.moved + p.movedFailed;
  // v16.7.3: the Source tracks first (F3); they are never among the scanned tracks that move (those are open ones only).
  const source = p.source ?? 0;
  const off = p.off ?? 0, again = p.again ?? 0, back = p.back ?? 0;
  const them = (n: number) => (n === 1 ? 'it' : 'them');
  // v16.7.3 (F2): the scanned tracks whose crystal changes, by how: off the crystal Deep Scan gave them, moved again
  // (already off it: an older Auto-Distribute or spread had moved them), or back on it. The reading stays with the ones
  // that move. (Fix round 2, R1: "again" in words true for both, never "spread before".)
  const offWords = `${plural(off, 'scanned track moves', 'scanned tracks move')} off the crystal Deep Scan gave ${them(off)}`;
  const moving = off && again
    ? `${offWords}; ${plural(again, 'already off it moves', 'already off it move')} again`
    : off
      ? offWords
      : again
        ? `${plural(again, 'scanned track already off the crystal Deep Scan gave it moves', 'scanned tracks already off the crystal Deep Scan gave them move')} again`
        : '';
  const sentences = [
    source > 0
      ? p.restored > 0
        ? `${plural(p.restored, 'track Deep Scan placed on 2178 Hz goes', 'tracks Deep Scan placed on 2178 Hz go')} back to the SOURCE crystal.`
        : 'Tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal.'
      : '',
    // (Fix round 2, R2, and round 3, W1: no "Every other track" when no other track is spread: every track a SOURCE one,
    // or the rest unreadable scans the spread leaves where they are.)
    source === 0 || (p.open ?? 0) > 0 ? `${source > 0 ? 'Every other track' : 'Every track'} is spread over ${p.emptyAfter === 0 ? 'all 27 crystals' : 'the crystals'}, the GUT, HEART and HEAD ranges in turn.` : '',
    moving ? `${moving}; Deep Scan's reading is kept.` : '',
    back ? `${plural(back, 'scanned track goes', 'scanned tracks go')} back to the crystal Deep Scan gave ${them(back)}.` : '',
    p.given > 0 ? `${plural(p.given, 'track without one gets', 'tracks without one get')} a crystal.` : '',
    p.moved + p.movedFailed > 0 ? `${plural(p.moved + p.movedFailed, 'assigned crystal moves', 'assigned crystals move')}.` : '',
    p.emptyBefore > 0 && p.emptyAfter === 0 ? 'Afterwards every crystal has a track.' : '',
    unmeasured > 0 ? "Assigned crystals aren't a scan: Deep Scan can still analyse those tracks." : '',
    'Keys and visual sync are kept.',
  ];
  return { title: 'Assign crystals?', body: sentences.filter(Boolean).join(' ') };
}

// ---- lines 915-938 ----
/** What a spread or a way back did (the notice, as assignDoneText for Assign's own rule). */
function assignModeDoneText(p: AssignPlan): string {
  const cab = p.perCrystal.filter((c) => c >= 3).length;
  const cover = p.emptyAfter === 0 ? 'Every crystal has a track, so walks have no gaps. ' : `${plural(p.emptyAfter, 'crystal still has', 'crystals still have')} no track. `;
  const ready = cab === 27 ? 'CAB-ready: all 27 crystals have 3 or more.' : `CAB readiness: ${cab}/27 crystals at 3 or more.`;
  if (p.mode === 'restore') return `Deep Scan's crystals are back on ${plural(p.restored, 'track', 'tracks')}. ` + cover + ready;
  // v16.7.3 (F2): the moved scanned tracks by how they move (see spreadConfirmText).
  const off = p.off ?? 0, again = p.again ?? 0, back = p.back ?? 0;
  const parts = [
    off ? `${plural(off, 'scanned track', 'scanned tracks')} moved off Deep Scan's crystal` : '',
    again ? `${plural(again, 'scanned track', 'scanned tracks')} moved again` : '', // (fix round 2, R1)
    back ? `${plural(back, 'track', 'tracks')} back on Deep Scan's crystal` : '',
    // v16.7.3: Source tracks an older spread had moved, back on 2178 (a spread's restored counts only those).
    p.restored ? `${plural(p.restored, 'track', 'tracks')} back on 2178 Hz` : '',
    p.given ? `${plural(p.given, 'track', 'tracks')} got a crystal` : '',
    p.moved + p.movedFailed ? `${plural(p.moved + p.movedFailed, 'assigned crystal', 'assigned crystals')} moved` : '',
  ].filter(Boolean);
  // v16.7.1: no way back in this release, so none is promised.
  // (Fix round 3, W2: with Source tracks and nothing else to place, nothing spreads: the heading of Assign's own notice.)
  const head = (p.source ?? 0) > 0 && (p.open ?? 0) === 0 ? 'Crystals assigned' : p.emptyAfter === 0 ? 'Tracks spread over all 27 crystals' : 'Tracks spread over the crystals';
  // (Fix round 2, R3: "Deep Scan's readings are kept." only when the library holds one.)
  return `${head}: ${parts.length ? parts.join(', ') : 'every track keeps its crystal'}. ` + cover + ready + ((p.readings ?? 0) > 0 ? " Deep Scan's readings are kept." : '') +
    ((p.source ?? 0) > 0 ? ' Tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal.' : '');
}

/** v16.8.1's planAssign(library, 'spread'), exactly. */
export function spreadV1681(library: readonly AssignSong[]): AssignPlan {
  return spreadOrRestore(library, 'spread');
}
/** v16.8.1's words for a spread's plan: its confirmation's body, its notice, its toast, and whether it asked first. */
export function wordsV1681(p: AssignPlan): { confirm: string; done: string; nothing: string; needsConfirm: boolean } {
  return { confirm: spreadConfirmText(p).body, done: assignModeDoneText(p), nothing: assignNothingText(p), needsConfirm: assignNeedsConfirm(p) };
}
