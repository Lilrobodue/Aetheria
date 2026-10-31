// utils/copy/places.ts (v16.6, "How sure are we?": the copy pass; the v16.6 spec §3.8)
//
// Where things are, in each layout. The Guide's two views and the Lo Shu cube are shared by classic and the new layout
// (from v16.5); their host passes `layout`, and each sentence that names a place reads it here, so classic keeps its
// own (accurate) positions and the new layout gets its own. Pure, Node-checked (copy.check.ts: place() is total).
//
// tailwind.config.js scans utils/: no word in these comments is meant as a style name.

export type Layout = 'classic' | 'new';

export type PlaceKey = 'deepScan' | 'assign' | 'modes' | 'walks' | 'cubeVisual' | 'walksFirst' | 'tree' | 'walksNeed' | 'cellTap' | 'soundLog';

export const PLACES: Readonly<Record<PlaceKey, { classic: string; new: string }>> = {
  // P1: the Guide (Plain), How to Get Started, step 3
  deepScan: {
    classic: 'Click "Deep Scan" — wait for your music to be processed',
    new: 'In Library, open Library health and tap Scan (Deep Scan: slow, and optional)',
  },
  // P2: step 4
  assign: {
    classic: 'Click "Auto-Distribute Frequencies" — songs Deep Scan scanned keep their crystal, and every other song is given one of the 27 Aetheria frequencies',
    new: 'In Library’s health card, tap Assign — songs Deep Scan scanned keep their crystal, and every other song is given one of the 27',
  },
  // P3: step 5
  modes: {
    classic: 'Pick a listening mode — try "Full Alignment" to hear your library played across all 27 frequencies in order, or choose just the GUT, HEART, HEAD range, or all regimes by selecting the Ultimate all orders playlist.',
    new: 'Pick a listening mode — in the Mixes tab, try "Full Alignment" to hear your library played across all 27 frequencies in order, or a single range (GUT, HEART or HEAD), or "Ultimate" for all 27.',
  },
  // P4: the Lo Shu section: where the walks are
  walks: {
    classic: 'You can find the Lo Shu quick settings in the media player controls as a cube icon next to the repeat button',
    new: 'You can find the walks under Walks on Now Playing, or in the Mixes tab',
  },
  // P5: where the cube's visual settings are
  cubeVisual: {
    classic: 'and the Lo Shu Visual settings card can be found in the Visual settings by clicking the gear icon in the app header.',
    new: 'and the cube’s visual settings in More › Visualizer › Overlays › Lo Shu Cube.',
  },
  // P5b: what a walk needs (it said "added/imported, scanned, and assigned": Deep Scan is optional)
  walksFirst: {
    classic: 'Music needs crystals first (Auto-Distribute Frequencies) to select one of the Lo Shu Walks.',
    new: 'Music needs crystals first (Assign in Library) to select one of the Lo Shu Walks.',
  },
  // P6: the technical view, the Tree of Life
  tree: {
    classic: '🌳 Enable "Tree of Life" in Visualization Engine',
    new: '🌳 Turn on "Tree of Life" in More › Visualizer › Overlays',
  },
  // P7: the cube's walks note
  walksNeed: {
    classic: 'Walks need songs with crystals. If your library has none yet, use Auto-Distribute Frequencies (or Deep Scan).',
    new: 'Walks need songs with crystals. If your library has none yet, tap Assign in Library (or Scan).',
  },
  // P8: the cube's cells
  cellTap: {
    classic: 'Click any cell to set the playing frequency.',
    new: 'Tap any cell to play its tone under the music.',
  },
  // P10: the sound log's save failure
  soundLog: {
    classic: 'The sound log could not be saved (storage may be full). Export it from Harmonic Control.',
    new: 'The sound log could not be saved (storage may be full). Export it from Layers › Sound.',
  },
};

export const PLACE_KEYS = Object.keys(PLACES) as PlaceKey[];

/** The words for a place in a layout. Total: an unknown layout reads as classic (the default layout). */
export function place(key: PlaceKey, layout: Layout): string {
  const p = PLACES[key];
  return layout === 'new' ? p.new : p.classic;
}
