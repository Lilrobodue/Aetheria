// Smoke test for utils/frequencyMapping.ts
// Run with: npx tsx utils/frequencyMapping.smoke.ts
// Exits non-zero on any assertion failure.
//
// The load-bearing check here is COLLISION: solfeggioHz() must never equal
// feltCarrierHz() for the same input. Before this module existed, the raw
// octave-drop landed exactly on the sub-bass drone's carrier for 21 of the 27
// catalogued frequencies — two oscillators on one pitch, arbitrary relative
// phase per session, emitted signal not reproducible run to run.

import {
  octaveInto,
  feltCarrierHz,
  thetaAlphaModHz,
  toSubBass,
  solfeggioHz,
  SUB_BASS_CARRIER_MIN_HZ,
  SUB_BASS_CARRIER_MAX_HZ,
  SUB_BASS_MOD_MIN_HZ,
  SUB_BASS_MOD_MAX_HZ,
  SUB_BASS_THRESHOLD_HZ,
} from './frequencyMapping';

let failures = 0;
let passes = 0;

function assert(cond: boolean, label: string, detail?: string) {
  if (cond) {
    passes++;
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name: string) {
  console.log(`\n== ${name} ==`);
}

const r = (n: number) => Number(n.toFixed(5));

// The 27 catalogued UNIFIED_THEORY frequencies (constants.ts).
const FREQS = [
  174, 285, 396, 417, 528, 639, 741, 852, 963,
  1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150,
  3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336,
];

// The six Lo Shu Perfect GUT swap targets (App.tsx LO_SHU_PERFECT_MAP).
// Positions 7-9 are identical in both sets, so they are absent from the table.
const LO_SHU_TARGETS = [75, 186, 297, 408, 519, 630];

const ALL = [...FREQS, ...LO_SHU_TARGETS];

// ---------------------------------------------------------------------------
section('No solfeggio/drone collision (the regression guard)');

let collisions = 0;
for (const f of ALL) {
  const s = solfeggioHz(f);
  const c = feltCarrierHz(f);
  if (s === c) {
    collisions++;
    console.log(`  FAIL  ${f} Hz — solfeggio ${r(s)} == carrier ${r(c)}`);
  }
}
assert(collisions === 0, `all ${ALL.length} frequencies clear of the drone carrier`,
  `${collisions} collision(s)`);

// Guard the guard: the RAW drop must still collide, or the fixture has drifted
// and the test above would pass vacuously.
const rawCollisions = FREQS.filter(f => toSubBass(f) === feltCarrierHz(f)).length;
assert(rawCollisions === 21,
  'raw toSubBass() still collides for 21/27 (proves the test is not vacuous)',
  `got ${rawCollisions}`);

// ---------------------------------------------------------------------------
section('Drone carrier stays in the felt band');

for (const f of ALL) {
  const c = feltCarrierHz(f);
  assert(c >= SUB_BASS_CARRIER_MIN_HZ && c <= SUB_BASS_CARRIER_MAX_HZ,
    `${f} Hz -> carrier ${r(c)} in [${SUB_BASS_CARRIER_MIN_HZ}, ${SUB_BASS_CARRIER_MAX_HZ}]`);
}

// ---------------------------------------------------------------------------
section('Theta-alpha modulation stays in band');

for (const f of ALL) {
  const m = thetaAlphaModHz(f);
  assert(m >= SUB_BASS_MOD_MIN_HZ && m <= SUB_BASS_MOD_MAX_HZ,
    `${f} Hz -> mod ${r(m)} in [${SUB_BASS_MOD_MIN_HZ}, ${SUB_BASS_MOD_MAX_HZ}]`);
}

// ---------------------------------------------------------------------------
section('Threshold behaviour');

for (const f of ALL.filter(x => x <= SUB_BASS_THRESHOLD_HZ)) {
  assert(solfeggioHz(f) === f, `${f} Hz (<= threshold) plays at pitch`);
}

assert(solfeggioHz(SUB_BASS_THRESHOLD_HZ) === SUB_BASS_THRESHOLD_HZ,
  'threshold itself plays at pitch (boundary is inclusive)');
assert(solfeggioHz(SUB_BASS_THRESHOLD_HZ + 1) !== SUB_BASS_THRESHOLD_HZ + 1,
  'one Hz above threshold is octave-dropped');

// ---------------------------------------------------------------------------
section('Removed low-end guard was genuinely unreachable');

// toSubBass halves until <= 60; the value it halved was > 60, so the result is
// always in (30, 60] and can never fall under the old 20 Hz floor. Sweep well
// past the catalogue to show this is structural, not a property of these 27.
let underFloor = 0;
for (let f = SUB_BASS_THRESHOLD_HZ + 1; f <= 200000; f += 7) {
  const v = toSubBass(f);
  if (v <= 30 || v > 60) underFloor++;
}
assert(underFloor === 0, 'toSubBass() output always in (30, 60] across a 200 kHz sweep',
  `${underFloor} out-of-range`);

// ---------------------------------------------------------------------------
section('octaveInto edge cases');

assert(octaveInto(0, 27, 55, true) === 27, 'zero input falls back to min');
assert(octaveInto(-5, 27, 55, true) === 27, 'negative input falls back to min');
assert(octaveInto(NaN, 27, 55, true) === 27, 'NaN input falls back to min');
assert(octaveInto(40, 27, 55, true) === 40, 'already-in-band value is unchanged');
// 13.5 doubles once to exactly 27 and the loop stops — the floor is inclusive.
assert(octaveInto(13.5, 27, 55, true) === 27, 'clampUp lifts an undershoot back into band');
assert(octaveInto(10, 27, 55, true) === 40, 'clampUp doubles as many times as needed');
assert(octaveInto(13.5, 27, 55, false) === 13.5, 'without clampUp an undershoot is left alone');

// ---------------------------------------------------------------------------
section('Reference table');

console.log('  Hz      | solfeggio  | carrier    | mod');
console.log('  --------|------------|------------|--------');
for (const f of FREQS) {
  console.log(
    `  ${String(f).padEnd(7)} | ${String(r(solfeggioHz(f))).padEnd(10)} | ` +
    `${String(r(feltCarrierHz(f))).padEnd(10)} | ${r(thetaAlphaModHz(f))}`
  );
}

// ---------------------------------------------------------------------------
console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
