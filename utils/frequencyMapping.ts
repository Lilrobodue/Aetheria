/**
 * Frequency Mapping for Aetheria — SINGLE SOURCE OF TRUTH
 *
 * Every place that turns a displayed Solfeggio frequency into an actual
 * oscillator frequency MUST import from here. This module exists because the
 * mapping was previously duplicated in App.tsx and components/FrequencySelector.tsx
 * with DIVERGENT thresholds (639 vs 963) — so the selector's preview tone played
 * 741/852/963 Hz at full pitch while playback emitted 46/53/30 Hz. The UI showed
 * one frequency and the app emitted another, which invalidated any listening test
 * calibrated against the preview. Do not re-inline these helpers.
 *
 * Two layers occupy the low end, and they must NOT land on the same frequency:
 *   • SUB-BASS DRONE  — owns the felt band. feltCarrierHz() + thetaAlphaModHz().
 *   • SOLFEGGIO TONE  — solfeggioHz(). Steps off the drone by φ where they would
 *                       otherwise collide.
 * See solfeggioHz() for why.
 */

import { PHI } from './phiIntegration';

// --- Felt sub-bass band (the drone's territory) ------------------------------
export const SUB_BASS_CARRIER_MIN_HZ = 27;  // A0 — lowest still-felt sub-bass
export const SUB_BASS_CARRIER_MAX_HZ = 55;  // ~A1 — top of the felt "foundation" band
export const SUB_BASS_MOD_MIN_HZ = 5;       // theta-alpha capture floor (guide range 5–12)
export const SUB_BASS_MOD_MAX_HZ = 10;      // theta-alpha crossover ceiling (ambient default)

// --- Solfeggio octave-drop threshold ----------------------------------------
// Above this, the solfeggio tone is octave-dropped rather than played at pitch.
// Was 963 originally; lowered to 639 so the GUT band's upper three positions
// (741/852/963) also drop out of the harsh upper range during playback. The UI
// still displays the canonical Hz — only the oscillator frequency shifts.
export const SUB_BASS_THRESHOLD_HZ = 639;
export const SUB_BASS_DROP_CEIL_HZ = 60;    // halve until at or below this

/**
 * Octave-divide `freq` down into [min,max] by repeated halving — the guide's
 * sub-harmonic algorithm. Result is always the same note class as the source
 * (pure 2:1 octaves), so it stays harmonically locked. `clampUp` bumps one
 * octave back up if it undershoots the floor (required for the carrier, which
 * MUST stay felt).
 */
export const octaveInto = (freq: number, min: number, max: number, clampUp = false): number => {
  if (!(freq > 0)) return min;
  let f = freq;
  while (f > max) f /= 2;
  if (clampUp) while (f < min) f *= 2;
  return f;
};

/** Drone CARRIER — the active frequency halved into the felt sub-bass band. */
export const feltCarrierHz = (freq: number): number =>
  octaveInto(freq, SUB_BASS_CARRIER_MIN_HZ, SUB_BASS_CARRIER_MAX_HZ, true);

/** Drone MODULATION rate — the active frequency halved into the theta-alpha band. */
export const thetaAlphaModHz = (freq: number): number =>
  octaveInto(freq, SUB_BASS_MOD_MIN_HZ, SUB_BASS_MOD_MAX_HZ, false);

/**
 * Raw octave-drop for frequencies above the threshold. Kept exported for the
 * collision check in solfeggioHz() and for tests; callers wanting the actual
 * solfeggio oscillator frequency should use solfeggioHz() instead.
 *
 * NOTE: there is no low-end guard here, and none is needed. The halving loop
 * exits the first time f <= 60, and the value it halved was > 60, so the result
 * is always in (30, 60] — it can never fall below the 20 Hz floor the old
 * `if (f < 20) f *= 2` line was guarding. That branch was unreachable for every
 * possible input and has been removed rather than carried forward.
 */
export const toSubBass = (freq: number): number => {
  if (freq <= SUB_BASS_THRESHOLD_HZ) return freq;
  let f = freq;
  while (f > SUB_BASS_DROP_CEIL_HZ) f /= 2;
  return f;
};

/**
 * The SOLFEGGIO oscillator's actual frequency.
 *
 * The drone owns the felt sub-bass band. Above the threshold, toSubBass() and
 * feltCarrierHz() both halve by pure 2:1 from the same source, so they land on
 * the IDENTICAL frequency for 21 of the 27 catalogued frequencies — two
 * independent oscillators on one pitch, started at unrelated times, so their
 * relative phase is arbitrary per session and the emitted signal is not
 * reproducible run to run.
 *
 * Rather than mute the layer, we step it off the carrier by φ. φ is irrational,
 * so the two can never fall into a 2:1 (or any rational) lock and therefore
 * cannot beat — the relationship becomes deterministic and intentional instead
 * of accidental. Example: 741 Hz → drone carrier 46.3125 Hz, solfeggio 74.92 Hz.
 *
 * Frequencies at or below the threshold play at pitch and are untouched — no
 * collision exists there (e.g. 396 Hz plays at 396 Hz against a 49.5 Hz carrier).
 */
export const solfeggioHz = (freq: number): number => {
  const f = toSubBass(freq);
  return f === feltCarrierHz(freq) ? f * PHI : f;
};
