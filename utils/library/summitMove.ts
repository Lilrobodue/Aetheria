// utils/library/summitMove.ts (v16.9.1, The Summit; the user's decisions, 14 Nov 2026)
//
// Deep Scan's rule (utils/crystalData.ts, getHarmonicSolfeggio) never gave 6336 Hz before v16.9.1. 6336 is 396 × 16
// (and 528 × 12), so 396's octave candidate scored exactly what 6336's own direct match did and, met first, kept the
// track. From v16.9.1 a HEAD crystal's direct match wins a tie with a harmonic candidate that lands exactly on it (only
// 6336 has one): a measured 6318–6363 Hz reads as 6336, The Summit, and nothing else changes. Its tone still
// folds for listening, as every crystal's does (792 Hz on the v2 sound, the sub-bass on classic).
//
// A track Deep Scan read before then sits on 396. The user's decision: it moves on load, quietly, on every device, with
// no rescan, re-read from the measurement it stored. This is that move, applied to each track as the saved library is
// read back (utils/playlistCache.ts, toSong); the next save stores it.
//
// Only a crystal that is Deep Scan's own, and only from 396 (v16.9's answer for every measurement in the band) to 6336:
// a scan ('scan', recorded or derived), or (review round 1) a record an older Auto-Distribute re-stored on Deep Scan's
// own crystal, its own score as the deviation ('scan-replaced' on 396: v16.9 counted it as Deep Scan's; unmoved it would
// read as replaced now, with a moved line). Never one Assign, a spread or an older Auto-Distribute moved elsewhere, a
// scan that couldn't read the track, or any other answer the rule might give. Idempotent. Pure, Node-checked
// (summitMove.check.ts).

import { crystalOrigin, scanCrystalOf } from '../mix/distribution.ts';
import type { CrystalFields } from '../mix/distribution.ts';

/** The Summit, the 27th crystal. */
export const SUMMIT_HZ = 6336;
/** What v16.9's rule gave every measurement that reads as 6336 now (summitMove.check's sweep: 6318–6363 Hz, all 396). */
export const SUMMIT_WAS_HZ = 396;

/** The track with Deep Scan's crystal moved from 396 to 6336 when its stored measurement reads as 6336 now; else the
 *  track itself (the same object). A scan's deviation is restated as Deep Scan stores it, |measurement − crystal|; a
 *  re-stored record keeps the older Auto-Distribute's score (so it stays what it was: re-stored, on Deep Scan's own). */
export function summitMove<T extends CrystalFields>(s: T): T {
  const o = crystalOrigin(s);
  if (o !== 'scan' && o !== 'scan-replaced') return s;
  const hf = s.harmonicFreq;
  if (typeof hf !== 'number' || !Number.isFinite(hf) || hf <= 0) return s;
  if (s.closestSolfeggio !== SUMMIT_WAS_HZ || scanCrystalOf(hf) !== SUMMIT_HZ) return s;
  return o === 'scan'
    ? { ...s, closestSolfeggio: SUMMIT_HZ, harmonicDeviation: Math.abs(hf - SUMMIT_HZ) }
    : { ...s, closestSolfeggio: SUMMIT_HZ };
}
