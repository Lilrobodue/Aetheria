// tools/chromaParity.ts — Analyse tracks (v15.1): one key analysis against the reference analyser's stored values,
// and the verdict over a run (build spec v15.1 §11.2.2-11.2.3). Pure (no node or DOM APIs): shared by the node CLI
// (tools/chroma-parity.ts) and the browser page (tools/chroma-check.ts). Rows are keyed by library index, never by
// a name, so a report can be quoted anywhere.
//
// Bounds (§11.2.3):
//   strict   (ffmpeg input, all 80): chroma per-bin |d| ≤ 1e-4, A4 equal at 2 dp, key equal, |dconf| ≤ 1e-3.
//   tolerant (WAV, node or browser): chroma L1 ≤ 0.002 on ≥ 95 % and ≤ 0.03 on all; |dA4| ≤ 1.5 cents on all and
//            exact on ≥ 90 %; key equal except near-ties (ref margin ≤ 0.02), at most max(1, floor(n/80)) misses;
//            |dconf| ≤ 0.005 where the key matches.
//   mp3      (measured, node or browser): chroma L1 ≤ 0.01 on ≥ 95 % and ≤ 0.03 on all; |dA4| ≤ 2 cents on all;
//            key misses only among near-ties, at most 3; |dconf| ≤ 0.015 where the key matches.
//            MP3 cannot match exactly: CBR 192k plays 0.26 dB quieter and codec noise moves frames across the
//            reference's absolute loudness gate, which flips which half of a block votes. Measured on the 80 tracks
//            (node and Chrome, 2026-10-22): keys 80/80, L1 ≤ 0.01 on 78-79/80 (worst 0.0265), |dA4| ≤ 2 cents,
//            |dconf| ≤ 0.0115. These bounds are those measurements with a small margin, a guard against regressions.
// A bound that does not hold is reported, never loosened without a new measurement.

import { keyScores } from '../utils/soundV2/chroma.ts';
import type { PitchAnalysis } from '../utils/soundV2/chroma.ts';

/** The stored fields of one library.json track that the comparison reads. */
export interface RefEntry {
  chroma?: number[];
  chroma_a4_hz?: number;
  key?: string;
  key_confidence?: number;
  tuning_offset_cents?: number;
}
export type BoundsName = 'strict' | 'tolerant' | 'mp3';
export const NEAR_TIE = 0.02;
export const NEAR_GATE = 1e-5;

export interface ParityRow {
  index: number;                // library index
  status: string;               // the analysis status, or 'error: …'
  maxAbsD: number | null;       // max over bins of |unrounded chroma − stored|
  l1: number | null;            // Σ over bins of the same
  bins4dp: number | null;       // bins whose 4 dp value differs from the stored one
  a4: number | null;
  refA4: number | null;
  a4Equal: boolean;             // equal at 2 dp
  dA4Cents: number | null;      // the offset difference (both are half-integers), or from the A4 ratio
  key: string | null;
  refKey: string | null;
  keyEqual: boolean;
  dConf: number | null;         // |unrounded confidence − stored|
  refMargin: number | null;     // keyScores(stored chroma): r1 − r2
  nearTie: boolean;             // refMargin ≤ 0.02
  gateMarginRel: number | null; // the analysis' closest frame to the loudness gate, relative
  nearGate: boolean;            // within 1e-5: a 1-cent A4 miss there is explainable
  frames: number | null;
  votes: number | null;
  decodeMs?: number;
  analyseMs?: number;
  seconds?: number;             // the decoded audio's length
}

function refMarginOf(ref: RefEntry): number | null {
  if (!Array.isArray(ref.chroma) || ref.chroma.length !== 12) return null;
  const s = keyScores(ref.chroma);
  return s.length >= 2 ? s[0].r - s[1].r : null;
}

function blank(index: number, status: string, ref: RefEntry): ParityRow {
  const refMargin = refMarginOf(ref);
  return {
    index, status, maxAbsD: null, l1: null, bins4dp: null,
    a4: null, refA4: typeof ref.chroma_a4_hz === 'number' ? ref.chroma_a4_hz : null, a4Equal: false, dA4Cents: null,
    key: null, refKey: typeof ref.key === 'string' ? ref.key : null, keyEqual: false, dConf: null,
    refMargin, nearTie: refMargin !== null && refMargin <= NEAR_TIE,
    gateMarginRel: null, nearGate: false, frames: null, votes: null,
  };
}

/** A track that could not be read or decoded. */
export function errorRow(index: number, message: string, ref: RefEntry): ParityRow {
  return blank(index, 'error: ' + message, ref);
}

/** One analysis against its stored entry. */
export function compareWithRef(index: number, a: PitchAnalysis, ref: RefEntry): ParityRow {
  const row = blank(index, a.status, ref);
  if (a.status === 'ok' || a.status === 'empty') {
    row.gateMarginRel = a.stats.gateMarginRel;
    row.nearGate = a.stats.gateMarginRel < NEAR_GATE;
    row.frames = a.stats.frames;
    row.votes = a.stats.votes;
  }
  if (a.status !== 'ok') return row;
  const c = a.content;
  row.a4 = c.chromaA4Hz;
  row.key = c.key;
  if (Array.isArray(ref.chroma) && ref.chroma.length === 12) {
    let max = 0, l1 = 0, bins = 0;
    for (let i = 0; i < 12; i++) {
      const d = Math.abs(c.chromaRaw[i] - ref.chroma[i]);
      if (d > max) max = d;
      l1 += d;
      if (c.chroma[i] !== ref.chroma[i]) bins++;
    }
    row.maxAbsD = max;
    row.l1 = l1;
    row.bins4dp = bins;
  }
  if (row.refA4 !== null) {
    row.a4Equal = c.chromaA4Hz === row.refA4;
    row.dA4Cents = typeof ref.tuning_offset_cents === 'number'
      ? c.tuningOffsetCents - ref.tuning_offset_cents
      : 1200 * Math.log2(c.chromaA4Hz / row.refA4);
  }
  row.keyEqual = row.refKey !== null && c.key === row.refKey;
  if (typeof ref.key_confidence === 'number') row.dConf = Math.abs(c.keyConfidenceRaw - ref.key_confidence);
  return row;
}

export interface Verdict {
  bounds: BoundsName;
  pass: boolean;
  n: number;
  failures: string[];
  summary: {
    maxAbsD: number | null; worstL1: number | null; l1Over: number; a4Misses: number[]; maxDA4Cents: number | null;
    keyMisses: number[]; nearTieFlips: number[]; maxDConf: number | null; nearGate: number[]; notOk: number[];
  };
}

const fmt = (v: number | null, digits = 6): string =>
  v === null ? '-' : v !== 0 && Math.abs(v) < 1e-3 ? v.toExponential(2) : v.toFixed(digits);

/** The verdict of a run against one set of bounds. Every failing condition is listed. */
export function verdict(rows: readonly ParityRow[], bounds: BoundsName): Verdict {
  const n = rows.length;
  const failures: string[] = [];
  const ok = rows.filter((r) => r.status === 'ok' && r.l1 !== null);
  const notOk = rows.filter((r) => !(r.status === 'ok' && r.l1 !== null)).map((r) => r.index);
  const keyMisses = ok.filter((r) => !r.keyEqual).map((r) => r.index);
  const nearTieFlips = ok.filter((r) => !r.keyEqual && r.nearTie).map((r) => r.index);
  const a4Misses = ok.filter((r) => !r.a4Equal).map((r) => r.index);
  const max = (xs: (number | null)[]): number | null => xs.reduce<number | null>((m, x) => (x === null ? m : m === null || x > m ? x : m), null);
  const summary: Verdict['summary'] = {
    maxAbsD: max(ok.map((r) => r.maxAbsD)),
    worstL1: max(ok.map((r) => r.l1)),
    l1Over: 0,
    a4Misses,
    maxDA4Cents: max(ok.map((r) => (r.dA4Cents === null ? null : Math.abs(r.dA4Cents)))),
    keyMisses,
    nearTieFlips,
    maxDConf: max(ok.filter((r) => r.keyEqual).map((r) => r.dConf)),
    nearGate: rows.filter((r) => r.nearGate).map((r) => r.index),
    notOk,
  };
  if (n === 0) failures.push('no tracks were compared');
  if (notOk.length) failures.push(`not analysed (or no stored chroma): #${notOk.join(', #')}`);
  const each = (cond: (r: ParityRow) => boolean, what: string): void => {
    const bad = ok.filter((r) => !cond(r)).map((r) => r.index);
    if (bad.length) failures.push(`${what}: #${bad.join(', #')}`);
  };
  if (bounds === 'strict') {
    each((r) => (r.maxAbsD as number) <= 1e-4, 'chroma per-bin |d| > 1e-4');
    each((r) => r.a4Equal, 'A4 differs at 2 dp');
    each((r) => r.keyEqual, 'key differs');
    each((r) => r.dConf !== null && r.dConf <= 1e-3, '|dconf| > 1e-3');
  } else {
    const l1Cap = bounds === 'tolerant' ? 0.002 : 0.01;
    const within = ok.filter((r) => (r.l1 as number) <= l1Cap).length;
    summary.l1Over = ok.length - within;
    if (within * 100 < 95 * n) failures.push(`chroma L1 ≤ ${l1Cap} on ${within}/${n} (needs ≥ 95 %)`);
    each((r) => (r.l1 as number) <= 0.03, 'chroma L1 > 0.03');
    const a4Cap = bounds === 'tolerant' ? 1.5 : 2;
    each((r) => r.dA4Cents !== null && Math.abs(r.dA4Cents) <= a4Cap + 1e-9, `|dA4| > ${a4Cap} cents`);
    if (bounds === 'tolerant' && a4Misses.length * 10 > n) failures.push(`A4 exact on ${n - a4Misses.length}/${n} (needs ≥ 90 %)`);
    const nonTieMisses = ok.filter((r) => !r.keyEqual && !r.nearTie).map((r) => r.index);
    if (nonTieMisses.length) failures.push(`key differs on a track that is not a near-tie: #${nonTieMisses.join(', #')}`);
    const allowed = bounds === 'tolerant' ? Math.max(1, Math.floor(n / 80)) : 3;
    if (keyMisses.length > allowed) failures.push(`${keyMisses.length} key misses (at most ${allowed})`);
    const confCap = bounds === 'tolerant' ? 0.005 : 0.015;
    each((r) => !r.keyEqual || (r.dConf !== null && r.dConf <= confCap), `|dconf| > ${confCap} where the key matches`);
  }
  return { bounds, pass: failures.length === 0, n, failures, summary };
}

/** One line per track, by library index. */
export function formatRow(r: ParityRow): string {
  const t = (s: string, w: number): string => s.padEnd(w);
  if (r.status !== 'ok') return `#${String(r.index).padStart(2, '0')}  ${r.status}`;
  return [
    `#${String(r.index).padStart(2, '0')}`,
    t(`maxd ${fmt(r.maxAbsD)}`, 16),
    t(`L1 ${fmt(r.l1)}`, 14),
    t(`bins≠ ${r.bins4dp}`, 9),
    t(`A4 ${r.a4?.toFixed(2)}${r.a4Equal ? ' =' : ` ≠ ${r.refA4?.toFixed(2)} (${r.dA4Cents !== null && r.dA4Cents > 0 ? '+' : ''}${r.dA4Cents?.toFixed(2)} c)`}`, 30),
    t(`key ${r.key}${r.keyEqual ? ' =' : ` ≠ ${r.refKey}`}`, 14),
    t(`dconf ${fmt(r.dConf)}`, 17),
    t(`margin ${r.refMargin === null ? '-' : r.refMargin.toFixed(4)}${r.nearTie ? '*' : ''}`, 15),
    `gate ${r.gateMarginRel === null ? '-' : r.gateMarginRel.toExponential(1)}${r.nearGate ? '!' : ''}`,
    r.decodeMs !== undefined ? `dec ${Math.round(r.decodeMs)} ms` : '',
    r.analyseMs !== undefined ? `ana ${Math.round(r.analyseMs)} ms` : '',
  ].filter(Boolean).join('  ');
}

/** The summary block after the rows. */
export function formatVerdict(v: Verdict, label: string): string {
  const s = v.summary;
  const list = (xs: number[]): string => (xs.length ? '#' + xs.join(', #') : 'none');
  const lines = [
    `${label}: ${v.pass ? 'PASS' : 'FAIL'} (${v.n} tracks, ${v.bounds} bounds)`,
    `  max per-bin |d| ${fmt(s.maxAbsD)}; worst L1 ${fmt(s.worstL1)}` + (v.bounds === 'strict' ? '' : `; L1 over the 95 % cap on ${s.l1Over}`),
    `  A4 misses ${s.a4Misses.length} (${list(s.a4Misses)}); max |dA4| ${s.maxDA4Cents === null ? '-' : s.maxDA4Cents.toFixed(2)} cents`,
    `  key misses ${s.keyMisses.length} (${list(s.keyMisses)}), of them near-ties ${s.nearTieFlips.length} (${list(s.nearTieFlips)})`,
    `  max |dconf| where the key matches ${fmt(s.maxDConf)}`,
    `  frames within ${NEAR_GATE} of the gate: ${list(s.nearGate)}`,
  ];
  for (const f of v.failures) lines.push('  FAIL ' + f);
  return lines.join('\n');
}
