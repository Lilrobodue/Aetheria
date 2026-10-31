// utils/copy/soundCopy.ts (v16.6, "How sure are we?": the copy pass with evidence tags)
//
// Classic's comfort and readout words, rewritten (the v16.6 spec §3.4.6–3.4.8):
//   - R6, safety becomes comfort: no frequency is "safe", has a safety level, an experience requirement, a minute limit
//     or a volume percentage. Classic's Safety panel and its readout say what the layers actually play (the Layers tab's
//     heardLine) and the one comfort line (COMFORT_LEVELS), as the new layout does.
//   - R8, assigned, not measured (memory: the Deep Scan detector artefact): Deep Scan reads a song and gives it a
//     crystal; its number is "Deep Scan's reading", not the music's pitch, and there is no match grade.
//   - R9, scores are scores: each is named "<name> score" and marked experimental, with v16.3's lead line.
// Pure, Node-checked (copy.check.ts), no React.
//
// tailwind.config.js scans utils/: no word in these comments is meant as a style name.

import { SCAN_SCORES, SCAN_SCORES_LEAD } from '../library/scanScores.ts';

export { SCAN_SCORES, SCAN_SCORES_LEAD };

// ---------------------------------------------------------------------------------------------------------------
// Classic's Safety panel (G1, G2) and the high-crystal lines (G4, D2)
// ---------------------------------------------------------------------------------------------------------------

/** G1: the row that was "Safety Level", valued with the crystal's regime ("GUT"). */
export const RANGE_LABEL = 'Range';
/** G2 / G3: the block that was "Recommendations". */
export const COMFORT_HEADING = 'Comfort';
/** G4: the high crystals' line (classic's grid and the Frequency Lab); it was a "caution" warning. */
export const HIGH_CRYSTALS_LINE = 'High crystals: v2 plays them an octave or more lower, classic as a low hum. Keep the layers comfortable.';
/** G4: the grid's first group; it was "Traditional Scale (Safe)". */
export const TRADITIONAL_SOLFEGGIO = 'Traditional Solfeggio';
/** G4: classic's experience select, in the new layout's own words (layersModel's EXPERIENCE_LEVELS' ceilings). */
export const CLASSIC_LEVEL_OPTIONS: ReadonlyArray<{ id: 'beginner' | 'intermediate' | 'advanced' | 'expert'; label: string }> = [
  { id: 'beginner', label: 'Beginner (up to 963 Hz)' },
  { id: 'intermediate', label: 'Intermediate (up to 2,000 Hz)' },
  { id: 'advanced', label: 'Advanced (up to 5,000 Hz)' },
  { id: 'expert', label: 'Expert (all 27)' },
];
/** D2: classic's (non-v2) subtle-resonance line, and feltLineV2's fallback. */
export function highCrystalHumLine(hz: number | string): string {
  return `High crystal (${hz} Hz): classic plays it as a low hum under the music. Keep the layers comfortable.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Classic's readouts (F3, G3, H3, H4, P9): plain text in a dialog, so no tags (the density rule)
// ---------------------------------------------------------------------------------------------------------------

export const READOUT_TITLE = '🎵 DEEP SCAN';
/** "📊 Deep Scan's reading: 176.5 Hz (not the music's pitch)". */
export function readoutReading(hz: number): string {
  return `📊 Deep Scan's reading: ${hz.toFixed(1)} Hz (not the music's pitch)`;
}
/** "🎯 Crystal: 174 Hz (GUT)". */
export function readoutCrystal(hz: number, regime: string): string {
  return `🎯 Crystal: ${hz} Hz (${regime})`;
}
/** "📏 2.5 Hz from the crystal" (no grade: a reading's distance from an assignment rates nothing). */
export function readoutDistance(hz: number): string {
  return `📏 ${hz.toFixed(1)} Hz from the crystal`;
}
export const READOUT_PEAKS = "🌀 PEAKS IN THE READING (first 10; not the track's pitches):";
export const READOUT_NUMBER_YES = "🎯 AETHERIA NUMBER: yes, Deep Scan's reading is itself an Aetheria number";
export const READOUT_NUMBER_NO = '🎯 AETHERIA NUMBER: no, the crystal came through a harmonic relationship';
export const READOUT_COMFORT = '💡 COMFORT:';
export const READOUT_SCORES = '🧪 EXPERIMENTAL SCAN SCORES (not measurements; not evidence of any effect):';
/** The classic card's peaks heading (F7). */
export const CARD_PEAKS = "Peaks in the reading (first 10; not the track's pitches):";
/** The classic card's title (H2). */
export const CARD_SCORES_TITLE = 'Experimental scan scores';

const pct = (v: number): string => `${Math.round((Number.isFinite(v) ? v : 0) * 100)}%`;

/** The readout's score lines (H3): the scores, named as scores, with their notes; no safety level, no volume. */
export function readoutScoreLines(fa: { goldenRatioAlignment: number; pattern111Presence: number; dnaResonanceScore: number; sacredGeometryAlignment: number; schumannResonanceHarmony: number }): string[] {
  return [
    `• Golden ratio score: ${pct(fa.goldenRatioAlignment)}`,
    `• 111 pattern score: ${pct(fa.pattern111Presence)}`,
    `• DNA resonance score: ${pct(fa.dnaResonanceScore)} (a name for a score, not a biological measure)`,
    `• Sacred geometry score: ${pct(fa.sacredGeometryAlignment)} (higher for noisy sound)`,
    `• Schumann harmony score: ${pct(fa.schumannResonanceHarmony)}`,
  ];
}

/** The diagnostics' score lines (H4), in v16.2/16.3's words. */
export const DIAG_SCORES = '🧪 EXPERIMENTAL SCAN SCORES:';
export function diagScoreLines(golden: number, p111: number, dna: number): string[] {
  return [
    `• Golden ratio score over 30 %: ${golden}`,
    `• 111 pattern score over 20 %: ${p111}`,
    `• DNA resonance score over 30 %: ${dna}`,
  ];
}
/** P9: the diagnostics' advice when a range has no tracks (it named "Test Distribution", a button that no longer
 *  exists). Classic names its own button; the new layout (Library tools) names Assign. */
export function diagNoRangeLine(range: 'HEART' | 'HEAD', layout: 'classic' | 'new'): string {
  return layout === 'new'
    ? `• No ${range} crystals: tap Assign in Library`
    : `• No ${range} frequencies - use Auto-Distribute Frequencies for 27-track playlists`;
}

// ---------------------------------------------------------------------------------------------------------------
// Deep Scan's notice, toast and title (F4), the classic badges' titles (H1), the Journal's toast (L2)
// ---------------------------------------------------------------------------------------------------------------

export const SCAN_NOTICE_TITLE = 'Deep Scan in progress';
export function scanNoticeLine(percent: number): string {
  return `Progress: ${percent}% • This takes a while.`;
}
export function scanStartToast(count: number, eta: string): string {
  return `Starting Deep Scan of ${count} songs. About ${eta}. You can cancel any time.`;
}
export const SCAN_BUTTON_TITLE = 'Start Deep Scan (slow)';

export const BADGE_GOLDEN_TITLE = 'Golden ratio score over 70 % (experimental)';
export const BADGE_111_TITLE = '111 pattern score over 50 % (experimental)';
export const BADGE_DNA_TITLE = 'DNA resonance score over 60 % (experimental)';

export function journalSavedToast(hz: number | string): string {
  return `Experience documented! Your ${hz} Hz session is saved on this device.`;
}
