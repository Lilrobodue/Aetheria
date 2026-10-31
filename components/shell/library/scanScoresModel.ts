// components/shell/library/scanScoresModel.ts (v16.5, Advanced's experimental scan scores; v16.4 spec §3.10, §3.15)
//
// What the new layout shows of Deep Scan's experimental scores when Advanced › "Show experimental scan scores" is on:
// the Library row badges (scanBadges) and Track info's section (scanScoreRows, scanScoreText for Copy). The names, the
// notes, the lead and the cut-offs are utils/library/scanScores.ts's (v16.3's builder reads the same module), so the
// words and the numbers cannot drift apart. The cut-offs are its 30 % / 20 % / 30 % (the superseding note of
// 2026-10-28; classic's own row badges keep 70 / 50 / 60 %), each "over" (exclusive), as every shipped one reads.
//
// Never the safety level or the recommended volume (decision 11): they are read from the same unreliable spectrum.
// Pure; Node checks it (scanScoresModel.check.ts: `npm run check:shell`).

import { SCAN_SCORES, SCAN_SCORES_LEAD, hasScore } from '../../../utils/library/scanScores.ts';
import type { ScanScoreDef, ScanScoreId, ScoreSong } from '../../../utils/library/scanScores.ts';

/** The setting: Advanced's switch (saved from its tap only; unset or anything but 'true' is off). */
export const SCAN_SCORES_KEY = 'aetheria.scanScores.v1';

export function parseScanScores(raw: string | null | undefined): boolean {
  return raw === 'true';
}

/** What a song carries for the section (types.ts Song: fractalAnalysis, intervalAnalysis). */
export interface ScanSong extends ScoreSong {
  intervalAnalysis?: unknown;
}

const def = (id: ScanScoreId): ScanScoreDef => {
  const d = SCAN_SCORES.find((x) => x.id === id);
  if (!d) throw new Error(`scanScores has no ${id}`);
  return d;
};

const pct = (v: number): number => Math.round(v * 100);

/** The badges' scores, in their order, with the words their accessible names use. */
const BADGES: ReadonlyArray<{ id: ScanScoreId; spoken: string; text: (p: number) => string }> = [
  { id: 'golden', spoken: 'golden ratio', text: (p) => `Φ ${p}%` },
  { id: 'p111', spoken: '111 pattern', text: () => '111' },
  // v16.6 (review C5): a row's badge carries no tag (never per row), so this data claims none either; its two words are
  // score names, allow-listed by name and scoped to the badges (scripts/copy-allow.json, kind score-name).
  { id: 'dna', spoken: 'DNA resonance', text: () => 'DNA' },
];

export interface ScanBadge {
  id: ScanScoreId;
  /** What the badge shows: "Φ 72%", "111", "DNA". */
  text: string;
  /** Its accessible name: "Experimental score: golden ratio 72 %". */
  label: string;
}

/** A Library row's badges: each of the three scores over its cut-off (scanScores.ts), none without a reading. */
export function scanBadges(song: ScanSong | null | undefined): ScanBadge[] {
  if (!song) return [];
  const out: ScanBadge[] = [];
  for (const b of BADGES) {
    const d = def(b.id);
    if (hasScore(d, song) !== true) continue;
    const p = pct(d.read(song) as number);
    out.push({ id: b.id, text: b.text(p), label: `Experimental score: ${b.spoken} ${p} %` });
  }
  return out;
}

export const SCAN_SECTION_TITLE = 'Experimental scan scores';
export const SCAN_SECTION_LEAD = SCAN_SCORES_LEAD;
export const PEAKS_LABEL = 'Peaks in the reading (Hz)';
export const PEAKS_NOTE = "Not the track's pitches";
export const COHERENCE_LABEL = 'Coherence';
export const RATIO369_LABEL = '3-6-9 ratio';

export interface ScanRow {
  label: string;
  value: string;
  note?: string;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The rows of Track info's section: the five scores (each with its note), the reading's peaks (the first 10), and the
 *  interval scores when present. Empty without any Deep Scan reading. */
export function scanScoreRows(song: ScanSong | null | undefined): ScanRow[] {
  if (!song) return [];
  const rows: ScanRow[] = [];
  // The five scores in SCAN_SCORES' own order (the Aetheria candidate is a builder filter only, not a row here).
  for (const d of SCAN_SCORES) {
    if (d.id === 'candidate') continue;
    const v = d.read(song);
    if (v === null) continue;
    rows.push(d.note ? { label: d.name, value: `${pct(v)} %`, note: d.note.replace(/\.$/, '') } : { label: d.name, value: `${pct(v)} %` });
  }
  const fa = song.fractalAnalysis as { infiniteOrderHarmonics?: unknown } | null | undefined;
  const peaks = fa && Array.isArray(fa.infiniteOrderHarmonics) ? fa.infiniteOrderHarmonics.filter(finite).slice(0, 10) : [];
  if (peaks.length) rows.push({ label: PEAKS_LABEL, value: peaks.map((f) => f.toFixed(1)).join(', '), note: PEAKS_NOTE });
  const ia = song.intervalAnalysis as { coherenceScore?: unknown; fingerprint?: { ratio369?: unknown } } | null | undefined;
  if (ia && typeof ia === 'object') {
    if (finite(ia.coherenceScore)) rows.push({ label: COHERENCE_LABEL, value: `${Math.round(ia.coherenceScore)}/100` });
    const r = ia.fingerprint?.ratio369;
    if (finite(r)) rows.push({ label: RATIO369_LABEL, value: `${pct(r)} %` });
  }
  return rows;
}

/** The section as Copy puts it on the clipboard (after Track info's own rows), or '' with nothing to show. */
export function scanScoreText(song: ScanSong | null | undefined): string {
  const rows = scanScoreRows(song);
  if (!rows.length) return '';
  const lines = [SCAN_SECTION_TITLE, SCAN_SECTION_LEAD, ...rows.map((r) => `${r.label}: ${r.value}${r.note ? ` (${r.note})` : ''}`)];
  return lines.join('\n');
}
