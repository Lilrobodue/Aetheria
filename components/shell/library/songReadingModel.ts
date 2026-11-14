// components/shell/library/songReadingModel.ts (v16.9, Track info's "What it says")
//
// The song reading for a library track: the crystal Deep Scan gave it (scanCrystalOf its harmonicFreq, so an Assign or
// a spread that moved the track elsewhere doesn't change what the song itself reads as), read through the tone codex
// (utils/copy/songReading.ts) and the crystal's own name and association (crystalCopy.ts). A track Deep Scan hasn't
// read has no reading. Pure, Node-checked (songReadingModel.check.ts), no React.

import { crystalOrigin, readByDeepScan, scanCrystalOf, spreadFromScan } from '../../../utils/mix/distribution.ts';
import type { CrystalFields } from '../../../utils/mix/distribution.ts';
import { crystalCopy } from '../../../utils/copy/crystalCopy.ts';
import { toneReading, LEGGE_CREDIT, SONG_READING_FAILED, SONG_READING_HOW, SONG_READING_TITLE, SONG_READING_UNSCANNED } from '../../../utils/copy/songReading.ts';
import { tagLabel } from '../../../utils/copy/evidence.ts';
import { GEOMETRY_INFO } from '../../../constants.ts';

export interface ReadingRow {
  label: string;
  value: string;
  /** A quoted passage under the value (the Judgment). */
  quote?: string;
  note?: string;
}

export interface SongReadingView {
  /** The crystal the reading is for (Deep Scan's). */
  crystal: number;
  rows: ReadingRow[];
  /** When the track now sits on another crystal (Assign or a spread moved it). */
  movedNote: string | null;
}

/** A crystal's Geometry row (null without a GEOMETRY_INFO entry). Review round 1: the codex's line where it dropped
 *  health words (1692, 5274), else GEOMETRY_INFO's own. Per crystal, so the check covers all 27 (Deep Scan itself never
 *  gives 6336: a measured 6336 Hz folds to its fundamental, 396). */
export function geometryRow(crystal: number): ReadingRow | null {
  const geo = GEOMETRY_INFO.find((g) => g.freq === `${crystal}Hz`);
  if (!geo) return null;
  return { label: 'Geometry', value: `${geo.shape}. ${toneReading(crystal)?.geometryLine ?? geo.desc}` };
}

/** The reading for a track, or null when Deep Scan hasn't read it (or read nothing). */
export function songReadingView(s: CrystalFields): SongReadingView | null {
  if (!readByDeepScan(s)) return null;
  const hf = s.harmonicFreq;
  if (!(typeof hf === 'number' && Number.isFinite(hf) && hf > 0)) return null;
  const crystal = scanCrystalOf(hf);
  const t = toneReading(crystal);
  const c = crystalCopy(crystal);
  if (!t || !c) return null;
  const rows: ReadingRow[] = [
    // The user (14 Nov): "Scanned as", never a second "Crystal" in Track info (its own Crystal row can show another
    // crystal, where Assign placed the track).
    { label: 'Scanned as', value: `${crystal} Hz · ${t.script} · ${c.name}`, note: c.association },
    { label: 'In the cube', value: t.palace },
    { label: 'Hexagram', value: `${t.hexagram} ${t.hexagramName}`, quote: t.judgment, note: LEGGE_CREDIT },
  ];
  const geo = geometryRow(crystal);
  if (geo) rows.push(geo);
  rows.push({ label: 'Moon mansion', value: `${t.mansion}, “${t.mansionMeaning}”. Its deity: ${t.deity}. Its symbol: ${t.symbol}. Its ruling planet: ${t.planet}.` });
  const now = s.closestSolfeggio;
  // Review round 1: a spread is Assign's (the health card's Assign); the only other way a read track sits off its scan
  // crystal is an older Auto-Distribute ('scan-replaced'), as Track info's own Crystal row says.
  const movedNote = typeof now === 'number' && now !== crystal
    ? `It now plays on ${now} Hz, where ${spreadFromScan(s) ? 'Assign' : 'an older Auto-Distribute'} placed it; the reading follows the crystal its scan gave.`
    : null;
  return { crystal, rows, movedNote };
}

/** Review round 1: the line in place of a reading: a scan that couldn't read the track has its own (no queue scans it
 *  again), any other track the Scan line. */
export function songReadingNone(s: CrystalFields): string {
  return crystalOrigin(s) === 'scan-failed' ? SONG_READING_FAILED : SONG_READING_UNSCANNED;
}

/** The section as plain text, for Track info's Copy ('' when there is no reading). Review round 1: with its tags in
 *  words (the heading's Tradition, the scan note's Design choice), so a pasted reading never reads as a plain fact. */
export function songReadingText(s: CrystalFields): string {
  const v = songReadingView(s);
  if (!v) return '';
  const lines = [`${SONG_READING_TITLE} (${tagLabel('tradition')})`];
  for (const r of v.rows) {
    lines.push(`${r.label}: ${r.value}`);
    if (r.quote) lines.push(`  “${r.quote}”`);
    if (r.note) lines.push(`  ${r.note}`);
  }
  if (v.movedNote) lines.push(v.movedNote);
  lines.push(`${SONG_READING_HOW.text} (${tagLabel(SONG_READING_HOW.tag)})`);
  return lines.join('\n');
}

export { SONG_READING_TITLE, SONG_READING_HOW, SONG_READING_UNSCANNED, SONG_READING_FAILED };
