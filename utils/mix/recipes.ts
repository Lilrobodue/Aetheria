// utils/mix/recipes.ts (v15.8)
//
// Every mix and walk generator App.tsx had, as a PURE function: the library, the experience level, the play history
// and the random source go in; a MixResult comes out, and App's applyMix() applies it. The selection code (each
// filter, sort and picker) is copied VERBATIM from App.tsx at 016fc28 (v15.7); only the state writes became fields of
// the result. Two additions, both data: the play history and the rng are injected (the walks' LRU tiebreak), and the
// walks report the sequence position each entry fills (`walk.steps`, which the cube uses).
//
// No React, no DOM, no storage: Node runs it (type stripping) for check:mix and the golden comparison.
// v15.8 fixed three slips (decision 3): GUT Alignment clears a walk's segments and phases, a walk that finds nothing
// writes nothing, and the 111 Sequence's notice lists the crystals it picked.
// Behaviour otherwise kept exactly (the golden gate holds it): GUT/HEART/HEAD Alignment, Ultimate and the walks start
// playing; Full Alignment, the five presets, Golden Φ, the 111 Sequence and the 2178 Hz filter only swap the list
// (`play: false`, the bug v14.17 fixes); 111 and 2178 set the tone (`solfeggio`, which v14.17 drops).
// v15.9 (the user's decision 2): a mix never changes the visual settings. The recipes no longer carry the Tree of Life,
// morph, chakra colours, flow, auto-rotate or hexagons they used to switch on (the `viz` field is gone), so nothing
// can apply them; the user's own visual settings stay exactly as they set them.
// v15.9 (the plan's v14.17): the 111 Sequence and the 2178 Hz filter no longer set the tone (the 111/2178 overrides are
// dropped: each track plays its own crystal; 111 Hz itself is the "111 Hz · non-canonical" chip), and no recipe raises
// the experience level any more, nor announces it (decision 11: the level is an optional filter the user sets).
// The selection code is otherwise kept exactly (the golden gate holds it).

import type { Song } from '../../types.ts';
import {
  SOLFEGGIO_INFO, LO_SHU_WALKS, LO_SHU_WALK_INFO, LO_SHU_WALK_COMBINED, LO_SHU_WALK_OUROBOROS, OUROBOROS_PHASES, SOURCE_FREQ,
} from '../crystalData.ts';
import type { LoShuWalkMode } from '../crystalData.ts';

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface MixInput {
  /** App's originalPlaylist (the LIBRARY) as the calling render sees it. Never the play order; never written. */
  library: readonly Song[];
  /** userExperienceLevel as the calling render sees it. v15.9: no recipe reads it (decision 11); kept for the builder. */
  experience: ExperienceLevel;
  /** playHistoryRef.current: song id → last-played ms (the walks' LRU order). Read only. */
  history?: Readonly<Record<string, number>>;
  /** The walks' random tiebreak: Math.random in the app, a seeded generator in the checks. */
  rng?: () => number;
}

/** A classic "Analysis Status" notice: shown now (`delayMs` null) or after `delayMs` (a real setTimeout, even 0),
 *  then cleared `clearAfterMs` later (the clear empties whatever notice is showing then, as today). */
export interface MixNotice { text: string; delayMs: number | null; clearAfterMs: number }

/** The not-found message. `details` becomes the toast's Details button and its readout dialog (v15.4). */
export interface MixToast { text: string; durationMs: number; details?: { title: string; body: string } }

export interface MixWalk {
  mode: LoShuWalkMode;
  /** The index into LO_SHU_WALKS[mode] that each entry of `order` fills (a position with no track is skipped). */
  steps: number[];
}

export interface MixResult {
  /** A walk's segments and phases (GUT Alignment: none). Written only with a found order (v15.8: a walk that finds
   *  nothing leaves those of a walk that is playing alone). Undefined: left as they are. */
  segmentsAndPhases?: { segments: number[] | null; phases: string[] | null };
  /** The new play order (entries are the library's own Song objects), or null when nothing matched. */
  order: Song[] | null;
  /** Start order[0] now (today: GUT, HEART, HEAD, Ultimate, the walks). False: the list is swapped under whatever is
   *  playing, cursor 0 (today: Full, presets, Golden Φ, 111, 2178 — v14.17 makes every one play). */
  play: boolean;
  /** A walk (GUT Alignment's 'traditional' included): its mode, the snapshot of the order, and the steps. Null: not a
   *  walk (the snapshot effect ends a walk that was playing). GUT Alignment clears segmentsAndPhases (v15.8). */
  walk: MixWalk | null;
  /** setUseChakraOrder's value (written, never read; kept until v14.26). */
  chakraOrder: boolean;
  notices: MixNotice[];
  /** The classic walk popover closes (the walks). */
  closeWalkMenu: boolean;
  /** On a phone-width window the classic drawer closes (every found mix). */
  closeDrawerOnPhone: boolean;
  /** Set exactly when `order` is null. */
  toast: MixToast | null;
}

const found = (order: Song[], fields: Partial<MixResult>): MixResult => ({
  order, play: false, walk: null, chakraOrder: true, notices: [],
  closeWalkMenu: false, closeDrawerOnPhone: true, toast: null, ...fields,
});
const notFound = (toast: MixToast, fields: Partial<MixResult> = {}): MixResult => ({
  order: null, play: false, walk: null, chakraOrder: true, notices: [],
  closeWalkMenu: false, closeDrawerOnPhone: false, toast, ...fields,
});

/** The cube's step for a cursor: the walk's own step when it has one, else the cursor (today's index). */
export function walkStepAt(steps: readonly number[] | null, cursor: number): number {
  return steps && cursor >= 0 && cursor < steps.length ? steps[cursor] : cursor;
}

// ---------------------------------------------------------------------------------------------------------------
// GUT Alignment (was generateAlignmentJourney): the traditional nine, best per crystal; plays; the 'traditional' walk.
// ---------------------------------------------------------------------------------------------------------------
export function gutAlignment(input: MixInput): MixResult {
  const originalPlaylist = input.library;
      const journeyOrder = [174, 285, 396, 417, 528, 639, 741, 852, 963];
      const journeyPlaylist: Song[] = [];
      const usedIds = new Set<string>();
      const steps: number[] = [];

      journeyOrder.forEach((freq, j) => {
          const candidates = originalPlaylist.filter(s => s.closestSolfeggio === freq && !usedIds.has(s.id));
          if (candidates.length > 0) {
              // Enhanced sorting with fractal analysis priority
              candidates.sort((a, b) => {
                  // Prioritize songs with high golden ratio alignment
                  const aGolden = a.fractalAnalysis?.goldenRatioAlignment || 0;
                  const bGolden = b.fractalAnalysis?.goldenRatioAlignment || 0;

                  if (Math.abs(aGolden - bGolden) > 0.1) {
                      return bGolden - aGolden; // Higher golden ratio first
                  }

                  // Then sort by harmonic deviation (accuracy)
                  return (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
              });

              const bestMatch = candidates[0];
              journeyPlaylist.push(bestMatch);
              usedIds.add(bestMatch.id);
              steps.push(j);
          }
      });

      if (journeyPlaylist.length > 0) {
          return found(journeyPlaylist, { segmentsAndPhases: { segments: null, phases: null }, play: true, walk: { mode: 'traditional', steps } });
      }
      return notFound({ text: "Not enough analyzed songs. Try scanning library first.", durationMs: 8000 });
}

// ---------------------------------------------------------------------------------------------------------------
// HEART Alignment (was generateHeartAlignmentJourney): 1206–3150, best per crystal; plays.
// ---------------------------------------------------------------------------------------------------------------
export function heartAlignment(input: MixInput): MixResult {
  const originalPlaylist = input.library;
      const heartFrequencies = SOLFEGGIO_INFO
          .filter(s => s.freq >= 1000 && s.freq <= 3150)
          .map(s => s.freq)
          .sort((a, b) => a - b);

      const heartPlaylist: Song[] = [];
      const usedIds = new Set<string>();

      heartFrequencies.forEach(freq => {
          const candidates = originalPlaylist.filter(s => s.closestSolfeggio === freq && !usedIds.has(s.id));
          if (candidates.length > 0) {
              candidates.sort((a, b) => {
                  const aGolden = a.fractalAnalysis?.goldenRatioAlignment || 0;
                  const bGolden = b.fractalAnalysis?.goldenRatioAlignment || 0;

                  if (Math.abs(aGolden - bGolden) > 0.1) {
                      return bGolden - aGolden;
                  }

                  return (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
              });

              const bestMatch = candidates[0];
              heartPlaylist.push(bestMatch);
              usedIds.add(bestMatch.id);
          }
      });

      if (heartPlaylist.length > 0) {
          // v15.9: no experience raise, and no notice announcing one (decision 11).
          return found(heartPlaylist, { play: true });
      }
      // v15.4: one line. Its old list of "HEART frequencies detected" was always empty (every closestSolfeggio
      // is one of the 27 crystals, so this branch runs only when no track holds a HEART one).
      return notFound({ text: 'HEART Alignment: no tracks have a HEART crystal (1206–3150 Hz) yet. Try scanning your library first, or use Auto-Distribute.', durationMs: 8000 });
}

// ---------------------------------------------------------------------------------------------------------------
// HEAD Alignment (was generateHeadAlignmentJourney): 3504 and up, best per crystal; plays.
// ---------------------------------------------------------------------------------------------------------------
export function headAlignment(input: MixInput): MixResult {
  const originalPlaylist = input.library;
      const headFrequencies = SOLFEGGIO_INFO
          .filter(s => s.freq >= 3504)
          .map(s => s.freq)
          .sort((a, b) => a - b);

      const headPlaylist: Song[] = [];
      const usedIds = new Set<string>();

      headFrequencies.forEach(freq => {
          const candidates = originalPlaylist.filter(s => s.closestSolfeggio === freq && !usedIds.has(s.id));
          if (candidates.length > 0) {
              candidates.sort((a, b) => {
                  const aGolden = a.fractalAnalysis?.goldenRatioAlignment || 0;
                  const bGolden = b.fractalAnalysis?.goldenRatioAlignment || 0;

                  if (Math.abs(aGolden - bGolden) > 0.1) {
                      return bGolden - aGolden;
                  }

                  return (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
              });

              const bestMatch = candidates[0];
              headPlaylist.push(bestMatch);
              usedIds.add(bestMatch.id);
          }
      });

      if (headPlaylist.length > 0) {
          // v15.9: no experience raise, and no notice announcing one (decision 11).
          return found(headPlaylist, { play: true });
      }
      // v15.4: one line, as HEART's (its list of "HEAD frequencies detected" was always empty).
      return notFound({ text: 'HEAD Alignment: no tracks have a HEAD crystal (3504 Hz and up) yet. Try scanning your library first, or use Auto-Distribute.', durationMs: 8000 });
}

// ---------------------------------------------------------------------------------------------------------------
// The Lo Shu walks (was generateLoShuWalk): A / B / C / traditional best-unused per crystal; combined (CAB) LRU
// trios; ouroboros best-unused LRU with repeats at SOURCE; cabi = CAB then Ouroboros sharing usedIds. Plays.
// ---------------------------------------------------------------------------------------------------------------
export function loShuWalk(input: MixInput, mode: LoShuWalkMode): MixResult {
  const originalPlaylist = input.library;
  const history = input.history ?? {};
  const rng = input.rng ?? Math.random;
      const sequence = LO_SHU_WALKS[mode];
      const info = LO_SHU_WALK_INFO[mode];
      const walkPlaylist: Song[] = [];
      const walkSteps: number[] = [];
      let segmentsAndPhases: MixResult['segmentsAndPhases'];

      const sortCandidates = (a: Song, b: Song) => {
          const aGolden = a.fractalAnalysis?.goldenRatioAlignment || 0;
          const bGolden = b.fractalAnalysis?.goldenRatioAlignment || 0;
          if (Math.abs(aGolden - bGolden) > 0.1) return bGolden - aGolden;
          const devDiff = (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
          if (Math.abs(devDiff) > 0.1) return devDiff;
          // Final tiebreaker: song id. Auto-distribute often produces many
          // ties at deviation 0 (perfect matches); without this the sort
          // falls back to insertion order and we end up playing songs
          // alphabetically by upload order. Song ids are timestamp+random
          // strings, so this spreads tied songs unpredictably.
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      };

      // Used song IDs accumulated across the whole walk. Shared between
      // pickers so cabi's Ouroboros tail avoids replaying songs heard in
      // its CAB head.
      const usedIds = new Set<string>();
      // Parallel to walkPlaylist — same length, '' for steps with no
      // special phase token. Ouroboros emits ♾️/✕ at the SOURCE visits.
      const walkPhases: string[] = [];

      // LRU comparator — sorts by [lastPlayed ASC, random tiebreaker].
      // Never-played songs (timestamp 0) always come first, in random order
      // among themselves; played songs follow with oldest first. Random
      // tiebreaker preserves the user's "click again for variety" feel
      // when the candidate pool is fresh (all timestamps zero).
      const lruCompare = (a: Song, b: Song): number => {
          const aLast = history[a.id] || 0;
          const bLast = history[b.id] || 0;
          if (aLast !== bLast) return aLast - bLast;
          return rng() - 0.5;
      };

      // Top-K candidate cap for CAB-style pickers. Balanced auto-distribute
      // can place ~13 candidates per freq; the cap keeps shuffle picks
      // among the strongest matches while still giving C(6,3) × 3! = 120
      // possible trio arrangements per freq for the user's "regen" variety.
      const CAB_POOL_SIZE = 6;

      // CAB picker — drives 'combined' and the first 81 steps of 'cabi'.
      // Returns the per-segment counts [Vortex, Ascent, Pillar] so the
      // footer chip can show "Vortex 14/27".
      const runCabPicker = (cabSequence: number[], stepOffset: number): [number, number, number] => {
          const uniqueFreqs = Array.from(new Set(cabSequence));
          const passPicks = new Map<number, (Song | undefined)[]>();
          uniqueFreqs.forEach(freq => {
              const allCandidates = originalPlaylist.filter((s: Song) => s.closestSolfeggio === freq);
              if (allCandidates.length === 0) {
                  passPicks.set(freq, [undefined, undefined, undefined]);
                  return;
              }
              // Top-K by quality stays the same — the candidate pool is
              // still the 6 best-matching songs at this freq.
              const candidates = [...allCandidates]
                  .sort(sortCandidates)
                  .slice(0, Math.min(allCandidates.length, CAB_POOL_SIZE));
              const n = candidates.length;
              // Within the top-K pool, pick by LRU instead of pure random.
              // Never-played candidates surface first (random tiebreak keeps
              // the "click again for variety" feel when the pool is fresh);
              // once everyone in the pool has been heard at least once, the
              // 3 longest-not-heard win — guaranteeing rotation through all
              // 6 quality candidates over a few CAB sessions instead of
              // letting random chance favour the same 3 forever.
              const lruOrdered = [...candidates].sort(lruCompare);
              const trio: Song[] = [
                  lruOrdered[0 % n],
                  lruOrdered[1 % n],
                  lruOrdered[2 % n],
              ];
              const sortedTrio = [...trio].sort(sortCandidates);
              // sortedTrio[0] = best, [1] = mid, [2] = weakest
              // Pass 0 (Vortex / C) → mid
              // Pass 1 (Ascent / A) → weakest
              // Pass 2 (Pillar / B) → best
              passPicks.set(freq, [sortedTrio[1], sortedTrio[2], sortedTrio[0]]);
          });

          // cabSequence = C (0..26) + A (27..53) + B (54..80).
          //   Pass 0 = Vortex (C), Pass 1 = Ascent (A), Pass 2 = Pillar (B).
          const segmentCounts: [number, number, number] = [0, 0, 0];
          cabSequence.forEach((freq, i) => {
              const pass = Math.floor(i / 27);
              const pick = passPicks.get(freq)?.[pass];
              if (pick) {
                  walkPlaylist.push(pick);
                  walkPhases.push('');
                  walkSteps.push(stepOffset + i);
                  usedIds.add(pick.id);
                  segmentCounts[pass]++;
              }
          });
          return segmentCounts;
      };

      // Ouroboros picker — best-unused-per-freq from the shared usedIds.
      // When a freq has no unused songs left (typical at the 2nd/3rd
      // SOURCE visit), it REPEATS the best match instead of skipping —
      // this is the spec's "do not deduplicate" rule made concrete. The
      // figure-8's three crossings at SOURCE always produce a playlist
      // entry. Emits ♾️/✕ tokens into walkPhases at SOURCE visits.
      const runOuroborosPicker = (ouroSequence: number[], stepOffset: number): number => {
          let pushed = 0;
          let sourceVisit = 0;
          ouroSequence.forEach((freq, j) => {
              const allCandidates = originalPlaylist.filter((s: Song) => s.closestSolfeggio === freq);
              if (allCandidates.length === 0) return; // no songs at all → skip
              // Unused-at-this-freq sorted LRU first, quality second.
              // Means the figure-8's traversal naturally cycles through
              // the user's library at each freq across sessions, instead
              // of always picking the same deviation-best song first.
              const unused = allCandidates
                  .filter((s: Song) => !usedIds.has(s.id))
                  .sort((a: Song, b: Song) => {
                      const cmp = lruCompare(a, b);
                      return cmp !== 0 ? cmp : sortCandidates(a, b);
                  });
              let pick: Song;
              if (unused.length > 0) {
                  pick = unused[0];
                  usedIds.add(pick.id);
              } else {
                  // Fresh pool exhausted at this freq — repeat the best
                  // match. Intentional at the three SOURCE visits when
                  // the library has fewer distinct SOURCE songs than the
                  // walk requires.
                  pick = [...allCandidates].sort(sortCandidates)[0];
              }
              walkPlaylist.push(pick);
              walkSteps.push(stepOffset + j);
              let phase = '';
              if (freq === SOURCE_FREQ) {
                  phase = OUROBOROS_PHASES[sourceVisit] ?? '';
                  sourceVisit++;
              }
              walkPhases.push(phase);
              pushed++;
          });
          return pushed;
      };

      if (mode === 'combined') {
          const cabCounts = runCabPicker(sequence, 0);
          segmentsAndPhases = { segments: [...cabCounts], phases: null };
      } else if (mode === 'ouroboros') {
          const oCount = runOuroborosPicker(sequence, 0);
          segmentsAndPhases = { segments: [oCount], phases: [...walkPhases] };
      } else if (mode === 'cabi') {
          // CABI = CAB (81 steps) + Ouroboros (29 steps), shared usedIds
          // so the closing Ouroboros doesn't replay songs heard in CAB.
          const cabCounts = runCabPicker(LO_SHU_WALK_COMBINED, 0);
          const oCount = runOuroborosPicker(LO_SHU_WALK_OUROBOROS, LO_SHU_WALK_COMBINED.length);
          segmentsAndPhases = { segments: [cabCounts[0], cabCounts[1], cabCounts[2], oCount], phases: [...walkPhases] };
      } else {
          segmentsAndPhases = { segments: null, phases: null };
          // Single walks (A / B / C / traditional): best unused per freq.
          sequence.forEach((freq, j) => {
              const candidates = originalPlaylist
                  .filter((s: Song) => s.closestSolfeggio === freq && !usedIds.has(s.id))
                  .sort(sortCandidates);
              if (candidates.length > 0) {
                  const bestMatch = candidates[0];
                  walkPlaylist.push(bestMatch);
                  walkSteps.push(j);
                  usedIds.add(bestMatch.id);
              }
          });
      }

      if (walkPlaylist.length > 0) {
          // v15.9: walks no longer raise the experience level (decision 11).
          return found(walkPlaylist, {
              segmentsAndPhases,
              play: true,
              walk: { mode, steps: walkSteps },
              closeWalkMenu: true,
              notices: [{
                  text: `Lo Shu · ${info.fullName} — ${walkPlaylist.length}/${sequence.length} positions filled.` +
                      ((mode === 'combined' || mode === 'cabi') ? ' Click again for a different shuffle.' : ''),
                  delayMs: null, clearAfterMs: 5000,
              }],
          });
      }
      return notFound({
          text: (`Lo Shu · ${info.fullName}: no matching songs in your library yet.\n\n` +
              `This walk needs songs whose closest Solfeggio frequency matches positions in the 27-frequency Aetheria set. ` +
              `Try running Deep Scan, or load tracks across the GUT/HEART/HEAD ranges.`).replace(/\n+/g, ' '),
          durationMs: 10000,
      });
}

// ---------------------------------------------------------------------------------------------------------------
// Full Alignment (was generateFullLibraryAlignment): every track with a crystal, in crystal order; swaps the list.
// ---------------------------------------------------------------------------------------------------------------
export function fullAlignment(input: MixInput): MixResult {
  const originalPlaylist = input.library;
      // Get all frequency values from SOLFEGGIO_INFO in order
      const frequencyOrder = SOLFEGGIO_INFO.map(info => info.freq);
      const alignedPlaylist: Song[] = [];

      // Sort songs by frequency order, then by harmonic deviation (quality)
      frequencyOrder.forEach(freq => {
          const songsForFreq = originalPlaylist
              .filter(s => s.closestSolfeggio === freq)
              .sort((a, b) => (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999));

          alignedPlaylist.push(...songsForFreq);
      });

      if (alignedPlaylist.length > 0) {
          // v15.9: no experience raise, and no notice announcing one (decision 11).
          return found(alignedPlaylist, {});
      }
      return notFound({ text: "No analyzed songs found. Please scan your library first.", durationMs: 8000 });
}

// ---------------------------------------------------------------------------------------------------------------
// A crystal set (was generateFrequencyPlaylist): the five presets. Swaps the list.
// ---------------------------------------------------------------------------------------------------------------
export function crystalSetMix(input: MixInput, frequencies: readonly number[], name: string): MixResult {
  const originalPlaylist = input.library;
      const filtered = originalPlaylist
          .filter(s => frequencies.includes(s.closestSolfeggio || 0))
          .sort((a, b) => {
              const freqIndexA = frequencies.indexOf(a.closestSolfeggio || 0);
              const freqIndexB = frequencies.indexOf(b.closestSolfeggio || 0);
              if (freqIndexA !== freqIndexB) return freqIndexA - freqIndexB;
              return (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
          });

      if (filtered.length > 0) {
          return found(filtered, {});
      }
      return notFound({ text: `No songs found for ${name}. Try scanning your library first or add more variety.`, durationMs: 8000 });
}

// ---------------------------------------------------------------------------------------------------------------
// Golden Φ (was generateGoldenRatioPlaylist): golden ratio alignment > 0.3, highest first. Swaps the list.
// ---------------------------------------------------------------------------------------------------------------
export function goldenRatioMix(input: MixInput): MixResult {
  const originalPlaylist = input.library;
    // Debug: Log fractal analysis values for all tracks
    console.log('=== GOLDEN RATIO PLAYLIST DEBUG ===');
    originalPlaylist.forEach(song => {
      if (song.fractalAnalysis) {
        console.log(`${song.name}: Golden Ratio = ${(song.fractalAnalysis.goldenRatioAlignment * 100).toFixed(1)}%`);
      } else {
        console.log(`${song.name}: No fractal analysis data`);
      }
    });

    // Lowered threshold from 0.7 to 0.3 (30%) for more realistic filtering
    const goldenTracks = originalPlaylist
      .filter(s => s.fractalAnalysis && s.fractalAnalysis.goldenRatioAlignment > 0.3)
      .sort((a, b) => (b.fractalAnalysis?.goldenRatioAlignment || 0) - (a.fractalAnalysis?.goldenRatioAlignment || 0));

    console.log(`Found ${goldenTracks.length} tracks with golden ratio alignment > 30%`);

    if (goldenTracks.length > 0) {
      return found(goldenTracks, { chakraOrder: false });
    }
      // v15.4: a one-line toast; Details opens the whole explanation (its per-track list) in a dialog.
      const details = `No tracks with golden ratio alignment > 30% found.\n\nActual analysis results:\n${originalPlaylist.slice(0, 5).map(s => `• ${s.name}: ${s.fractalAnalysis ? (s.fractalAnalysis.goldenRatioAlignment * 100).toFixed(1) : 'No analysis'}%`).join('\n')}\n\nTry scanning your library with fractal analysis first.`;
      return notFound({ text: 'No tracks with golden ratio alignment above 30% yet.', durationMs: 12000, details: { title: 'Golden Φ', body: details } });
}

// ---------------------------------------------------------------------------------------------------------------
// The 111 Sequence (was generate111PatternPlaylist): each order's first crystal, best 111 presence. Swaps the list and
// sets the tone to 111.
// ---------------------------------------------------------------------------------------------------------------
export function sequence111(input: MixInput): MixResult {
  const originalPlaylist = input.library;
    // Composition of the first in sequence of each solfeggio order based on 111 Hz pattern presence
    console.log('=== 111 PATTERN SOLFEGGIO SEQUENCE COMPOSITION ===');

    // Define the solfeggio orders and their first frequencies - ALL 9 ORDERS
    const solfeggioOrders = [
      { order: 'First', frequencies: [174, 285] },
      { order: 'Second', frequencies: [396, 417, 528, 639] },
      { order: 'Third', frequencies: [741, 852, 963] },
      { order: 'Fourth', frequencies: [1206, 1449, 1692] },
      { order: 'Fifth', frequencies: [1935, 2178, 2421] },
      { order: 'Sixth', frequencies: [2664, 2907, 3150] },
      { order: 'Seventh', frequencies: [3504, 3858, 4212] },
      { order: 'Eighth', frequencies: [4566, 4920, 5274] },
      { order: 'Ninth', frequencies: [5628, 5982, 6336] }
    ];

    const compositionPlaylist: Song[] = [];
    const usedIds = new Set<string>();

    // For each order, find the best song with the highest 111 pattern presence from the first frequency
    solfeggioOrders.forEach(orderGroup => {
      const firstFrequency = orderGroup.frequencies[0]; // Get the first frequency of each order

      // Find songs that match this frequency and have 111 pattern presence
      const candidatesForOrder = originalPlaylist.filter(song => {
        if (!song.fractalAnalysis || usedIds.has(song.id)) return false;
        return song.closestSolfeggio === firstFrequency;
      });

      if (candidatesForOrder.length > 0) {
        // Sort by 111 pattern presence, then by DNA resonance, then by harmonic accuracy
        candidatesForOrder.sort((a, b) => {
          const a111 = a.fractalAnalysis?.pattern111Presence || 0;
          const b111 = b.fractalAnalysis?.pattern111Presence || 0;

          // Prioritize 111 pattern presence
          if (Math.abs(a111 - b111) > 0.05) {
            return b111 - a111;
          }

          // Then DNA resonance as a tiebreaker
          const aDNA = a.fractalAnalysis?.dnaResonanceScore || 0;
          const bDNA = b.fractalAnalysis?.dnaResonanceScore || 0;

          if (Math.abs(aDNA - bDNA) > 0.05) {
            return bDNA - aDNA;
          }

          // Finally by harmonic accuracy
          return (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
        });

        const bestTrack = candidatesForOrder[0];
        compositionPlaylist.push(bestTrack);
        usedIds.add(bestTrack.id);

        const pattern111Strength = (bestTrack.fractalAnalysis?.pattern111Presence || 0) * 100;
        console.log(`${orderGroup.order} Order (${firstFrequency}Hz): "${bestTrack.name}" - 111 Pattern: ${pattern111Strength.toFixed(1)}%`);
      } else {
        console.log(`${orderGroup.order} Order (${firstFrequency}Hz): No suitable tracks found`);
      }
    });

    console.log(`111 Pattern Composition: ${compositionPlaylist.length} tracks selected from ${solfeggioOrders.length} orders`);

    if (compositionPlaylist.length > 0) {
      // v15.9: the 111 Hz tone override is dropped (each track plays its own crystal; 111 Hz itself is the chip), and
      // so is the experience raise with its notice (decision 11).
      const r = found(compositionPlaylist, {});
      const hasTranspersonalFrequencies = compositionPlaylist.some(s => (s.closestSolfeggio || 0) >= 3786);

      // Provide detailed feedback about the composition
      const ordersCovered = compositionPlaylist.length;
      const avg111Pattern = compositionPlaylist.reduce((sum, song) =>
        sum + (song.fractalAnalysis?.pattern111Presence || 0), 0) / compositionPlaylist.length * 100;

      // Create frequency progression display
      const frequencyProgression = compositionPlaylist.map((s) => {
        const freq = s.closestSolfeggio;
        if (freq && freq >= 3786) {
          return `${freq}Hz⚠️`; // Add warning symbol for transpersonal frequencies
        }
        return `${freq}Hz`;
      }).join('→');

      const safetyNote = hasTranspersonalFrequencies ? ' ⚠️ CAUTION: Contains transpersonal frequencies - use minimal volume.' : '';
      r.notices.push({
        text: `111 Pattern Complete Journey activated! ${ordersCovered}/9 orders represented (${frequencyProgression}). Average 111 pattern strength: ${avg111Pattern.toFixed(1)}%.${safetyNote}`,
        delayMs: 500, clearAfterMs: 10000, // v15.9: no notice before it any more (it waited 8.5 s for one)
      });
      return r;
    }
      // Show diagnostic information
      const analyzedTracks = originalPlaylist.filter(s => s.fractalAnalysis).length;
      const orderAvailability = solfeggioOrders.map(order => {
        const freq = order.frequencies[0];
        const count = originalPlaylist.filter(s => s.closestSolfeggio === freq).length;
        return `${order.order} (${freq}Hz): ${count} tracks`;
      }).join('\n');

      // v15.4: a one-line toast; Details opens the whole explanation (the per-order counts) in a dialog.
      const details = `Unable to create 111 Pattern Solfeggio Sequence.\n\n` +
            `Requirements: At least one analyzed track from each order's first frequency:\n\n` +
            `${orderAvailability}\n\n` +
            `Total analyzed tracks: ${analyzedTracks}\n\n` +
            `Try scanning your library with fractal analysis to enable this composition feature.`;
      return notFound({ text: 'The 111 Sequence needs at least one scanned track for the first frequency of each order.', durationMs: 12000, details: { title: '111 Sequence', body: details } });
}

// ---------------------------------------------------------------------------------------------------------------
// The 2178 Hz SOURCE filter (was generateSourceFieldPlaylist): scanned 2178 tracks, ranked by sacred geometry, then
// golden ratio, then accuracy. Swaps the list and sets the tone to 2178.
// ---------------------------------------------------------------------------------------------------------------
export function sourceField(input: MixInput): MixResult {
  const originalPlaylist = input.library;
    // Strict 2178Hz resonance filter - only the pure 2178Hz frequency
    console.log('=== STRICT 2178Hz SOURCE FIELD FILTER ===');
    originalPlaylist.forEach(song => {
      if (song.fractalAnalysis && song.closestSolfeggio === 2178) {
        const geometryScore = song.fractalAnalysis.sacredGeometryAlignment * 100;
        const goldenScore = song.fractalAnalysis.goldenRatioAlignment * 100;
        console.log(`${song.name}: Geometry=${geometryScore.toFixed(1)}% | Golden=${goldenScore.toFixed(1)}% | 2178Hz=true | Accuracy=${song.harmonicDeviation?.toFixed(1) || 'N/A'}Hz`);
      }
    });

    // STRICT filtering: ONLY 2178Hz tracks that carry fractal analysis.
    // Deliberately NOT gated on a score being > 0: sacredGeometryAlignment is
    // 0 for every track analysed before the normalisation fix in
    // calculateSacredGeometryAlignment, so gating on it emptied the playlist
    // even when 2178Hz matches existed. Frequency match + analysed is the real
    // requirement; the scores below decide ORDER, not membership.
    const pure2178Tracks = originalPlaylist
      .filter(song => {
        // Must be exactly 2178Hz frequency match
        if (song.closestSolfeggio !== 2178) return false;

        // Must have fractal analysis data
        return Boolean(song.fractalAnalysis);
      })
      .sort((a, b) => {
        // Sort by sacred geometry alignment (highest first)
        const aGeometry = a.fractalAnalysis?.sacredGeometryAlignment || 0;
        const bGeometry = b.fractalAnalysis?.sacredGeometryAlignment || 0;

        if (Math.abs(aGeometry - bGeometry) > 0.01) {
          return bGeometry - aGeometry;
        }

        // Fall back to golden ratio alignment — φ is the first of the sacred
        // ratios and this metric normalises against the spectrum's own peak,
        // so it yields real values on tracks analysed before the fix. Keeps
        // the ordering meaningful without forcing a full library re-scan.
        const aGolden = a.fractalAnalysis?.goldenRatioAlignment || 0;
        const bGolden = b.fractalAnalysis?.goldenRatioAlignment || 0;

        if (Math.abs(aGolden - bGolden) > 0.01) {
          return bGolden - aGolden;
        }

        // Then by harmonic accuracy (closest to pure 2178Hz)
        const aAccuracy = a.harmonicDeviation || 999;
        const bAccuracy = b.harmonicDeviation || 999;

        return aAccuracy - bAccuracy;
      });

    console.log(`Found ${pure2178Tracks.length} pure 2178Hz tracks for SOURCE field playlist`);

    if (pure2178Tracks.length > 0) {
      // v15.9: the 2178 Hz tone override is dropped (every track here plays 2178 Hz anyway).
      const r = found(pure2178Tracks, {
        chakraOrder: false,
      });

      // Calculate quality metrics for user feedback. Report whichever
      // alignment score actually carries data: sacredGeometryAlignment reads 0
      // across the board on pre-fix analyses, and quoting "0.0%" would look
      // like a broken playlist rather than a stale metric.
      const avgGeometryScore = pure2178Tracks.reduce((sum, song) =>
        sum + (song.fractalAnalysis?.sacredGeometryAlignment || 0), 0) / pure2178Tracks.length;

      const avgGoldenScore = pure2178Tracks.reduce((sum, song) =>
        sum + (song.fractalAnalysis?.goldenRatioAlignment || 0), 0) / pure2178Tracks.length;

      const usingGeometry = avgGeometryScore > 0;
      const rankedBy = usingGeometry ? 'sacred geometry' : 'golden ratio';
      const avgRankScore = usingGeometry ? avgGeometryScore : avgGoldenScore;

      const highQualityTracks = pure2178Tracks.filter(s =>
        ((usingGeometry ? s.fractalAnalysis?.sacredGeometryAlignment : s.fractalAnalysis?.goldenRatioAlignment) || 0) > 0.3).length;

      const avgAccuracy = pure2178Tracks.reduce((sum, song) =>
        sum + (song.harmonicDeviation || 0), 0) / pure2178Tracks.length;

      r.notices.push({
        text: `Pure 2178Hz SOURCE Field Filter activated! ${pure2178Tracks.length} tracks found. Average ${rankedBy} alignment: ${(avgRankScore * 100).toFixed(1)}%, ${highQualityTracks} high-alignment tracks, avg accuracy: ±${avgAccuracy.toFixed(1)}Hz from pure 2178Hz.${usingGeometry ? '' : ' (Re-scan to rank by sacred geometry.)'}`,
        delayMs: 500, clearAfterMs: 8000,
      });
      return r;
    }
      const tracksWith2178 = originalPlaylist.filter(s => s.closestSolfeggio === 2178).length;
      const analyzedTracks = originalPlaylist.filter(s => s.fractalAnalysis).length;
      const unanalyzedTracks = originalPlaylist.length - analyzedTracks;

      // v15.4: a one-line toast; Details opens the whole explanation (the library's status) in a dialog.
      const details = (`No pure 2178Hz tracks found for SOURCE field filter.\n\n` +
            `Current library status:\n` +
            `• Total tracks: ${originalPlaylist.length}\n` +
            `• Analyzed tracks: ${analyzedTracks}\n` +
            `• Unanalyzed tracks: ${unanalyzedTracks}\n` +
            `• 2178Hz frequency matches: ${tracksWith2178}\n\n` +
            `To use this filter:\n` +
            `1. Import music containing 2178Hz content\n` +
            `2. Run "Deep Scan" to analyze harmonic frequencies\n` +
            `3. This filter requires exact 2178Hz frequency matches\n\n` +
            `Note: This filter only shows tracks that are harmonically centered on pure 2178Hz — HEART position 5, the centre of the Lo Shu cube.`);
      return notFound({ text: 'No scanned 2178 Hz tracks for the SOURCE filter yet.', durationMs: 12000, details: { title: '2178 Hz SOURCE filter', body: details } });
}

// ---------------------------------------------------------------------------------------------------------------
// Ultimate Alignment (was generateUltimateAlignmentPlaylist): all 27, best per crystal (golden, DNA, accuracy). Plays.
// ---------------------------------------------------------------------------------------------------------------
export function ultimateAlignment(input: MixInput): MixResult {
  const originalPlaylist = input.library;
    // Get all solfeggio frequencies in order from all Nine orders (1-9)
    const ultimateFrequencyOrder = SOLFEGGIO_INFO.map(info => info.freq);
    const ultimatePlaylist: Song[] = [];
    const usedIds = new Set<string>();

    // For each frequency, find the best matching track
    ultimateFrequencyOrder.forEach(freq => {
      const candidates = originalPlaylist.filter(s => s.closestSolfeggio === freq && !usedIds.has(s.id));
      if (candidates.length > 0) {
        // Enhanced sorting with multiple criteria
        candidates.sort((a, b) => {
          // 1. Prioritize songs with high golden ratio alignment
          const aGolden = a.fractalAnalysis?.goldenRatioAlignment || 0;
          const bGolden = b.fractalAnalysis?.goldenRatioAlignment || 0;

          if (Math.abs(aGolden - bGolden) > 0.1) {
            return bGolden - aGolden; // Higher golden ratio first
          }

          // 2. Then prioritize DNA resonance
          const aDNA = a.fractalAnalysis?.dnaResonanceScore || 0;
          const bDNA = b.fractalAnalysis?.dnaResonanceScore || 0;

          if (Math.abs(aDNA - bDNA) > 0.1) {
            return bDNA - aDNA;
          }

          // 3. Finally sort by harmonic deviation (accuracy)
          return (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
        });

        const bestMatch = candidates[0];
        ultimatePlaylist.push(bestMatch);
        usedIds.add(bestMatch.id);
      }
    });

    if (ultimatePlaylist.length > 0) {
      // v15.9: no experience raise, and no notice announcing one (decision 11).
      const r = found(ultimatePlaylist, { play: true });

      // Show notification about the ultimate alignment
      const ordersIncluded = new Set(ultimatePlaylist.map(s =>
        SOLFEGGIO_INFO.find(info => info.freq === s.closestSolfeggio)?.order
      )).size;

      r.notices.push({
        text: `Ultimate Alignment activated! Journey through ${ultimatePlaylist.length} frequencies across ${ordersIncluded} orders of consciousness.`,
        delayMs: 0, clearAfterMs: 7000, // v15.9: no notice before it any more (it waited 5.5 s for one)
      });
      return r;
    }
      return notFound({ text: "Not enough analyzed songs for Ultimate Alignment. Please scan your library first.", durationMs: 8000 });
}
