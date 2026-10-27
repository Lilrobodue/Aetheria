// components/shell/mixes/mixesModel.ts (v15.9, the Mixes tab)
//
// The Mixes tab's words and decisions, pure (Node-checked by mixesModel.check.ts, npm run check:shell): the summary,
// each mix's count text and accessible name, why a mix can't start (its disabled reason), the empty and no-crystals
// states, and the decorative dot pattern of each row. The catalogue itself (ids, names, sub-lines, sections, counts)
// is utils/mix/catalog.ts, shared with the Undo toast's words in both layouts.

import type { Song } from '../../../types.ts';
import { MIXES, mixCounts } from '../../../utils/mix/catalog.ts';
import type { MixDef, MixId, MixSection } from '../../../utils/mix/catalog.ts';
import { GUT_CRYSTALS, HEART_CRYSTALS, HEAD_CRYSTALS, LO_SHU_WALKS, PRESETS } from '../../../utils/crystalData.ts';

export const MIXES_INTRO = 'A tap builds a play order from your library and starts it. Undo for 10 s.';
export const MIXES_LOADING = 'Loading your library…';
export const EXPERIMENTAL_NOTE =
  'These rank tracks by Deep Scan’s experimental scores. The scores haven’t been shown to measure anything you can hear, so treat them as curiosities. They need tracks Deep Scan has measured.';
/** The 111 Sequence row's pointer to the 111 Hz chip (Layers › Crystal). */
export const SEQ111_LINE = 'Plays each track’s own crystal. For a 111\u00a0Hz tone: Layers › Crystal'; // (a no-break space keeps Hz with 111)
export const NO_CRYSTALS_TITLE = 'Your tracks have no crystals yet';
export const NO_CRYSTALS_BODY = 'Every mix follows the crystals. Assign them now (instant), or let Deep Scan measure them (slow).';
export const EMPTY_TITLE = 'Nothing to mix yet';
export const EMPTY_BODY = 'Mixes are built from your library. Import music first; your files are not changed.';
export const SECTION_TITLES: Readonly<Record<MixSection, string>> = {
  walks: 'Lo Shu walks',
  journeys: 'Journeys',
  sets: 'Crystal sets',
  experimental: 'Experimental',
};

/** What the tab needs to know about the library, in one pass (plus mixCounts' own): O(n). */
export interface MixesStats {
  total: number;
  withCrystal: number;
  /** Tracks Deep Scan has measured (a fractal analysis). */
  scanned: number;
  /** The crystals that have at least one track. */
  available: ReadonlySet<number>;
  counts: Readonly<Record<MixId, number>>;
}

export function mixesStats(songs: readonly Song[]): MixesStats {
  let withCrystal = 0;
  let scanned = 0;
  const available = new Set<number>();
  for (const s of songs) {
    const c = s.closestSolfeggio || 0;
    if (c) {
      withCrystal++;
      available.add(c);
    }
    if (s.fractalAnalysis) scanned++;
  }
  return { total: songs.length, withCrystal, scanned, available, counts: mixCounts(songs) };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const tracksText = (n: number): string => plural(n, 'track', 'tracks');

/** "440 tracks · 400 with a crystal". */
export function summaryText(st: Pick<MixesStats, 'total' | 'withCrystal'>): string {
  return `${tracksText(st.total)} · ${st.withCrystal} with a crystal`;
}

/** The library has tracks, and not one has a crystal: the card that offers Assign crystals. */
export function noCrystals(st: Pick<MixesStats, 'total' | 'withCrystal'>): boolean {
  return st.total > 0 && st.withCrystal === 0;
}

/** A walk's size (its positions: 27, 27, 27, 81, 29, 110). */
export function walkSize(def: MixDef): number {
  return def.walk ? LO_SHU_WALKS[def.walk].length : 0;
}

export interface MixView {
  /** A button (it has tracks, and the library is loaded). */
  enabled: boolean;
  /** The count line ("59 tracks", "26 of 27 positions"), or why it can't start ("No tracks yet", "Needs Deep Scan"). */
  text: string;
  /** The button's accessible name: "Flying Star Vortex, 26 of 27 positions, playing" (", paused"), "Grounding, 59 tracks". */
  label: string;
}

/**
 * One mix's tile or row. `playing` / `paused`: the walk that is the play order now (WalkContext.mode), while the music
 * plays or while it is paused. `loading`: the library has not been read back from storage yet (every mix waits).
 */
export function mixView(def: MixDef, st: MixesStats, o: { playing?: boolean; paused?: boolean; loading?: boolean } = {}): MixView {
  const n = st.counts[def.id] ?? 0;
  if (o.loading) return { enabled: false, text: 'Loading…', label: `${def.fullName}, loading` };
  if (n <= 0) {
    const reason = def.needs === 'scan' && st.withCrystal > 0 && st.scanned === 0 ? 'Needs Deep Scan' : 'No tracks yet';
    return { enabled: false, text: reason, label: `${def.fullName}, ${reason}` };
  }
  const text = def.walk ? `${n} of ${walkSize(def)} positions` : tracksText(n);
  return { enabled: true, text, label: `${def.fullName}, ${text}${o.playing ? ', playing' : o.paused ? ', paused' : ''}` };
}

export function mixesIn(section: MixSection): readonly MixDef[] {
  return MIXES.filter((m) => m.section === section);
}

// ---------------------------------------------------------------------------------------------------------------
// The dots: a decorative 3 × 3 tile (aria-hidden) per row. '.' an empty cell, 'o' a hollow dot (a crystal with no
// track, or a mix that can't start), 'g' / 'h' / 'b' a regime's dot (GUT, HEART, HEAD). A journey shows its nine
// crystals; a set its crystals (3: the middle row, 4: the corners, 5: an X); Ultimate and Full the cube's three layers
// (HEAD on top); Golden Φ and 111 (any crystal) a GUT → HEAD diagonal; 2178 Hz · SOURCE one larger dot.
// ---------------------------------------------------------------------------------------------------------------

export type Dot = '.' | 'o' | 'g' | 'h' | 'b';
export type Dots = { kind: 'grid'; cells: Dot[] } | { kind: 'source'; hollow: boolean };

const SET_CELLS: Readonly<Record<number, readonly number[]>> = { 3: [3, 4, 5], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8] };
const grid = (pattern: string): Dot[] => pattern.replace(/ /g, '').split('') as Dot[];

export function dotsFor(id: MixId, available: ReadonlySet<number>, disabled: boolean): Dots {
  if (id === 'source2178') return { kind: 'source', hollow: disabled };
  let cells: Dot[];
  const lit = (c: number, d: Dot): Dot => (available.has(c) ? d : 'o');
  if (id === 'gut') cells = GUT_CRYSTALS.map((c) => lit(c, 'g'));
  else if (id === 'heart') cells = HEART_CRYSTALS.map((c) => lit(c, 'h'));
  else if (id === 'head') cells = HEAD_CRYSTALS.map((c) => lit(c, 'b'));
  else if (id === 'ultimate' || id === 'full') cells = grid('bbb hhh ggg');
  else if (id === 'golden' || id === 'seq111') cells = grid('..b .h. g..');
  else if (id.startsWith('preset:')) {
    const p = PRESETS.find((x) => `preset:${x.id}` === id);
    cells = grid('... ... ...');
    if (p) {
      const at = SET_CELLS[p.crystals.length] ?? SET_CELLS[5];
      p.crystals.forEach((c, i) => { if (at[i] !== undefined) cells[at[i]] = lit(c, 'g'); });
    }
  } else cells = grid('... ... ...');
  return { kind: 'grid', cells: disabled ? cells.map((d) => (d === '.' ? '.' : 'o')) : cells };
}
