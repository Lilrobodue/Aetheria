// utils/library/summitMove.check.ts (v16.9.1, The Summit): node utils/library/summitMove.check.ts
//
// 1. Deep Scan's rule, swept from 1 to 24,000 Hz in half-hertz steps against its v16.9 answers (summit-runs-v169.json,
//    recorded from v16.9's rule before the change): the only change is 6318–6363 Hz, from 396 to 6336. Now all 27
//    crystals are reached (v16.9: 26, never 6336).
// 2. summitMove: only Deep Scan's own crystal moves, only to 6336, idempotent.

import { readFileSync } from 'node:fs';
import { crystalOrigin, scanCrystalOf, scanCrystalChanged, SPREAD_MARK } from '../mix/distribution.ts';
import { summitMove, SUMMIT_HZ } from './summitMove.ts';
import { SOLFEGGIO_INFO } from '../../constants.ts';

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) passed++;
  else { failed++; console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`); }
};

// ---- 1. the rule ---------------------------------------------------------------------------------------------------
const before = JSON.parse(readFileSync(new URL('./summit-runs-v169.json', import.meta.url), 'utf8')) as [number, number, number][];
check('the fixture covers 1–24,000 Hz', before[0][0] === 1 && before[before.length - 1][1] === 24000);
let run = 0;
const changed: Array<[number, number, number]> = [];
const reached = new Set<number>();
for (let i = 2; i <= 48000; i++) {
  const f = i / 2;
  while (f > before[run][1]) run++;
  const was = before[run][2];
  const now = scanCrystalOf(f);
  reached.add(now);
  if (now !== was) changed.push([f, was, now]);
}
check('only 6318–6363 Hz changed', changed.length === 91 && changed[0][0] === 6318 && changed[changed.length - 1][0] === 6363,
  `${changed.length} changed, ${changed.length ? `${changed[0][0]}–${changed[changed.length - 1][0]}` : 'none'}`);
check('each from 396 to 6336', changed.every(([, was, now]) => was === 396 && now === SUMMIT_HZ),
  JSON.stringify(changed.find(([, was, now]) => !(was === 396 && now === SUMMIT_HZ))));
check('6336 itself reads as 6336', scanCrystalOf(6336) === SUMMIT_HZ);
check('all 27 crystals reached', SOLFEGGIO_INFO.every((s) => reached.has(s.freq)), SOLFEGGIO_INFO.filter((s) => !reached.has(s.freq)).map((s) => s.freq).join());
check('nothing but the 27 (and the 396 fallback) reached', [...reached].every((c) => SOLFEGGIO_INFO.some((s) => s.freq === c)));

// ---- 2. the move on load -----------------------------------------------------------------------------------------
const FA = { dominantFrequency: 6340 };
// A record Deep Scan stored before v16.9.1, older shape (no crystalSource; its scan fields), on 396 from 6340 Hz.
const legacy = { harmonicFreq: 6340, closestSolfeggio: 396, harmonicDeviation: Math.abs(6340 - 396), fractalAnalysis: FA, isAetheriaCandidate: false };
check('the old record is a scan', crystalOrigin(legacy) === 'scan');
const lm = summitMove(legacy);
check('an older-shape scan on 396 from 6340 Hz moves to 6336', lm.closestSolfeggio === SUMMIT_HZ && lm.harmonicDeviation === 4, JSON.stringify(lm));
check('its other fields kept', lm.harmonicFreq === 6340 && lm.fractalAnalysis === FA && lm.isAetheriaCandidate === false && !('crystalSource' in lm));
check('still a scan after the move', crystalOrigin(lm) === 'scan');
check('the input is not changed', legacy.closestSolfeggio === 396);
check('idempotent: a moved track is returned as it is', summitMove(lm) === lm);
// Today's shape.
const modern = { harmonicFreq: 6330, closestSolfeggio: 396, harmonicDeviation: 6330 - 396, crystalSource: 'scan' as const, scanRate: 22050 };
const mm = summitMove(modern);
check('a scan record (crystalSource scan) moves', mm.closestSolfeggio === SUMMIT_HZ && mm.harmonicDeviation === 6 && mm.crystalSource === 'scan' && mm.scanRate === 22050);
// The band's edges: 6318 and 6363 move, 6317.5 and 6363.5 read as they did.
for (const [hf, moves] of [[6318, true], [6363, true], [6317.5, false], [6363.5, false]] as const) {
  const c = moves ? 396 : scanCrystalOf(hf);
  const r = { harmonicFreq: hf, closestSolfeggio: c, harmonicDeviation: Math.abs(hf - c), crystalSource: 'scan' as const };
  check(`${hf} Hz ${moves ? 'moves' : 'stays'}`, (summitMove(r).closestSolfeggio === SUMMIT_HZ) === moves, String(summitMove(r).closestSolfeggio));
}
// Review round 1: a record an older Auto-Distribute re-stored on Deep Scan's own 396 (its own score as the deviation):
// v16.9 counted its crystal as Deep Scan's (not changed); it moves too, keeps its score, and still isn't "changed".
const restored = { harmonicFreq: 6340, closestSolfeggio: 396, harmonicDeviation: 12.5, fractalAnalysis: FA, isAetheriaCandidate: false };
check('the re-stored record is scan-replaced', crystalOrigin(restored) === 'scan-replaced');
check('v16.9 counted it as Deep Scan’s (the map: 6340 Hz was 396)', before.find(([a, b]) => 6340 >= a && 6340 <= b)![2] === 396);
const rm = summitMove(restored);
check('the re-stored record moves to 6336, its score kept', rm.closestSolfeggio === SUMMIT_HZ && rm.harmonicDeviation === 12.5, JSON.stringify(rm));
check('still re-stored, and not counted as changed', crystalOrigin(rm) === 'scan-replaced' && !scanCrystalChanged(rm));
check('unmoved it would read as changed (why it moves)', scanCrystalChanged(restored));
check('idempotent on the re-stored record', summitMove(rm) === rm);
// Never moved.
const keep: Array<[string, Record<string, unknown>]> = [
  ['a spread placed it (Assign)', { harmonicFreq: 6340, closestSolfeggio: 528, harmonicDeviation: SPREAD_MARK + Math.abs(6340 - 528), crystalSource: 'assigned' }],
  ['assigned, never scanned', { harmonicFreq: 396, closestSolfeggio: 396, harmonicDeviation: 3, crystalSource: 'assigned' }],
  ['a scan that couldn’t read it (a measurement in the band, 999)', { harmonicFreq: 6340, closestSolfeggio: 396, harmonicDeviation: 999, crystalSource: 'scan' }],
  ['a scan that couldn’t read it, an older record (999, no scan fields)', { harmonicFreq: 6340, closestSolfeggio: 396, harmonicDeviation: 999 }],
  ['an older Auto-Distribute moved it elsewhere (scan-replaced on 4566)', { harmonicFreq: 6340, closestSolfeggio: 4566, harmonicDeviation: 2.5, fractalAnalysis: FA }],
  ['a scan record on another crystal than v16.9’s answer (528)', { harmonicFreq: 6340, closestSolfeggio: 528, harmonicDeviation: 6340 - 528, crystalSource: 'scan' }],
  ['already on 6336', { harmonicFreq: 6336, closestSolfeggio: 6336, harmonicDeviation: 0, crystalSource: 'scan' }],
  ['no measurement', { closestSolfeggio: 396, harmonicDeviation: 3, crystalSource: 'scan' }],
  ['a measurement of 0', { harmonicFreq: 0, closestSolfeggio: 396, harmonicDeviation: 396, crystalSource: 'scan' }],
  ['no crystal', {}],
];
for (const [name, s] of keep) check(`kept: ${name}`, summitMove(s) === s);

console.log(`summitMove: ${passed} checks passed, ${failed} failed (the rule: ${changed.length} half-hertz steps changed, ${reached.size} crystals reached)`);
if (failed) process.exit(1);
