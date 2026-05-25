// Smoke test for utils/intervalAnalysis.ts
// Run with: npx tsx utils/intervalAnalysis.smoke.ts
// Exits non-zero on any assertion failure.

import {
  analyzeIntervals,
  classificationLabel,
  couldBeAetheria,
  digitalRoot,
  type Peak,
} from './intervalAnalysis';

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

const peak = (hz: number): Peak => ({ frequency: hz, score: 1 });

// ---------- digitalRoot ----------
section('digitalRoot known values');
assert(digitalRoot(528) === 6, 'digitalRoot(528) === 6', `got ${digitalRoot(528)}`);
assert(digitalRoot(174) === 3, 'digitalRoot(174) === 3', `got ${digitalRoot(174)}`);
assert(digitalRoot(963) === 9, 'digitalRoot(963) === 9', `got ${digitalRoot(963)}`);
assert(digitalRoot(0) === 0,   'digitalRoot(0) === 0');
assert(digitalRoot(111) === 3, 'digitalRoot(111) === 3');
assert(digitalRoot(243) === 9, 'digitalRoot(243) === 9');
assert(digitalRoot(354) === 3, 'digitalRoot(354) === 3');
assert(digitalRoot(440) === 8, 'digitalRoot(440) === 8');

// ---------- couldBeAetheria ----------
section('couldBeAetheria filter');
assert(couldBeAetheria(528) === true,  '528 accepted');
assert(couldBeAetheria(174) === true,  '174 accepted');
assert(couldBeAetheria(963) === true,  '963 accepted');
assert(couldBeAetheria(440) === false, '440 rejected (not /3)');
assert(couldBeAetheria(100) === false, '100 rejected (below range)');
assert(couldBeAetheria(7000) === false, '7000 rejected (above range)');
assert(couldBeAetheria(120) === false, '120 rejected (digital root 3 but below 150 range)');

// ---------- Test Case 1: Known Aetheria triad ----------
section('Test 1: Aetheria triad (528, 396, 741)');
{
  const result = analyzeIntervals([peak(528), peak(396), peak(741)]);
  const gaps = result.intervals.map(i => Math.round(i.gap)).sort((a, b) => a - b);
  console.log(`  gaps: ${gaps.join(', ')}`);
  console.log(`  score: ${result.coherenceScore}, classification: ${classificationLabel(result.classification)}, ratio369: ${(result.fingerprint.ratio369 * 100).toFixed(0)}%`);

  // Expected gaps: 132 (528-396), 213 (741-528), 345 (741-396)
  assert(gaps.includes(132), 'gap 132 present');
  assert(gaps.includes(213), 'gap 213 present');
  assert(gaps.includes(345), 'gap 345 present');

  // All three gaps divisible by 3, digital roots {6, 6, 3}
  assert(result.fingerprint.ratio369 === 1.0, '100% 3-6-9 ratio');
  assert(result.intervals.every(i => i.isDivisibleBy3), 'all gaps divisible by 3');

  // Coherence: each interval gets +5 (369) +5 (div3) = +10 minimum. Plus 345 ≈ 354-9 within tol? 345 is 354-9 → |dev|=9 > 5 tolerance, so no Aetheria match. None of these gaps are exact Aetheria multiples. So per-interval ~10/30 ≈ 33.
  assert(result.coherenceScore >= 25 && result.coherenceScore <= 50,
    `coherence in [25,50] band`, `got ${result.coherenceScore}`);
  // Per spec: "partially_aligned" (>=25) or higher
  assert(['partially_aligned', 'harmonically_aligned', 'aetheria_tuned'].includes(result.classification),
    `classification at least partially_aligned`, `got ${result.classification}`);
}

// ---------- Test Case 2: Standard A tuning octaves ----------
section('Test 2: A=440 octaves (440, 880, 1760)');
{
  const result = analyzeIntervals([peak(440), peak(880), peak(1760)]);
  console.log(`  gaps: ${result.intervals.map(i => Math.round(i.gap)).join(', ')}`);
  console.log(`  ratios: ${result.intervals.map(i => i.ratio.toFixed(2)).join(', ')}`);
  console.log(`  score: ${result.coherenceScore}, classification: ${classificationLabel(result.classification)}, ratio369: ${(result.fingerprint.ratio369 * 100).toFixed(0)}%`);

  // Octaves and double octave should match harmonic ratios
  const harmonicHits = result.intervals.filter(i => i.isHarmonicRatio.match);
  assert(harmonicHits.length === 3, 'all 3 pairs match harmonic ratios (2 octaves + 1 double-octave)',
    `got ${harmonicHits.length}`);

  // 440 dr=8, 880 dr=7, 1320 dr=6 → only 1 of 3 gaps in 3-6-9 family
  assert(result.fingerprint.ratio369 < 0.5, '3-6-9 ratio < 50%',
    `got ${(result.fingerprint.ratio369 * 100).toFixed(0)}%`);

  // Not Aetheria-tuned despite harmonic structure
  assert(result.classification !== 'aetheria_tuned', 'NOT classified aetheria_tuned',
    `got ${result.classification}`);
}

// ---------- Test Case 3: Unstructured / "noise" ----------
section('Test 3: Unstructured peaks (chosen to avoid 3-6-9 family)');
{
  // Pick peaks where pairwise gaps mostly don't land on 3-6-9 digital roots or harmonic ratios.
  // 437, 521, 619, 743 → gaps: 84, 98, 122, 182, 222, 306. Digital roots: 3,8,5,2,6,9.
  // Hmm 3 of 6 are 3-6-9. Let me pick less aligned numbers.
  // 401, 503, 617, 739 → gaps: 102, 114, 122, 216, 236, 338. DRs: 3,6,5,9,2,5 → 4/6 in 3-6-9. Still high because gaps are clustered.
  // The truth is: random gaps have ~1/3 chance per gap of digital root 3/6/9. Hard to construct "no" coherence with small peak sets.
  // Use 7 prime-ish peaks: 113, 197, 311, 419, 547, 653, 787 — all primes, no special ratios.
  const result = analyzeIntervals([
    peak(113), peak(197), peak(311), peak(419), peak(547), peak(653), peak(787),
  ]);
  console.log(`  score: ${result.coherenceScore}, classification: ${classificationLabel(result.classification)}, ratio369: ${(result.fingerprint.ratio369 * 100).toFixed(0)}%`);
  console.log(`  Aetheria matches: ${result.fingerprint.aetheriaMatches}, harmonic matches: ${result.fingerprint.harmonicMatches}`);

  // Should not be aetheria_tuned (the score gate is what matters, not raw match count;
  // with 30 candidate target values × ±5 Hz, random gaps hit at ~9% rate by chance).
  assert(result.classification !== 'aetheria_tuned', 'NOT aetheria_tuned',
    `got ${result.classification}`);
  assert(result.coherenceScore < 75, 'coherence below aetheria threshold',
    `got ${result.coherenceScore}`);
}

// ---------- Test Case 4: Two Aetheria frequencies ----------
section('Test 4: Aetheria GUT pair (174, 285) — gap = 111');
{
  const result = analyzeIntervals([peak(174), peak(285)]);
  const it = result.intervals[0];
  console.log(`  gap: ${it.gap}, ratio: ${it.ratio.toFixed(3)}, dr: ${it.gapDigitalRoot}`);
  console.log(`  Aetheria match: ${JSON.stringify(it.isAetheriaInterval)}`);
  console.log(`  Harmonic ratio: ${JSON.stringify(it.isHarmonicRatio)}`);
  console.log(`  score: ${result.coherenceScore}, classification: ${classificationLabel(result.classification)}`);

  assert(it.gap === 111, 'gap is exactly 111');
  assert(it.isAetheriaInterval.match === true, 'Aetheria interval match');
  assert(it.isAetheriaInterval.base === 111, 'base is 111');
  assert(it.gapDigitalRoot === 3, 'digital root 3');
  assert(it.isDivisibleBy3 === true, 'divisible by 3');
  assert(result.fingerprint.ratio369 === 1.0, '100% 3-6-9 ratio');
  // Note: 285/174 ≈ 1.638 matches phi (1.618) with dev 0.02, costing ~2 points.
  // Aetheria's GUT pair is a near-golden-ratio coincidence.
  assert(result.coherenceScore >= 90, 'near-perfect coherence (>=90)',
    `got ${result.coherenceScore}`);
  assert(result.classification === 'aetheria_tuned', 'classified aetheria_tuned',
    `got ${result.classification}`);
}

// ---------- Test Case 5: HEART step (1206 + 1449) ----------
section('Test 5: HEART pair (1206, 1449) — gap = 243');
{
  const result = analyzeIntervals([peak(1206), peak(1449)]);
  const it = result.intervals[0];
  console.log(`  gap: ${it.gap}, dr: ${it.gapDigitalRoot}, match: ${JSON.stringify(it.isAetheriaInterval)}`);
  assert(it.gap === 243, 'gap === 243');
  assert(it.isAetheriaInterval.match && it.isAetheriaInterval.base === 243, 'matched 243 base');
  assert(it.gapDigitalRoot === 9, 'digital root 9');
}

// ---------- Test Case 6: HEAD step (3504 + 3858) ----------
section('Test 6: HEAD pair (3504, 3858) — gap = 354');
{
  const result = analyzeIntervals([peak(3504), peak(3858)]);
  const it = result.intervals[0];
  console.log(`  gap: ${it.gap}, dr: ${it.gapDigitalRoot}, match: ${JSON.stringify(it.isAetheriaInterval)}`);
  assert(it.gap === 354, 'gap === 354');
  assert(it.isAetheriaInterval.match && it.isAetheriaInterval.base === 354, 'matched 354 base');
  assert(it.gapDigitalRoot === 3, 'digital root 3');
}

// ---------- Empty / single peak edge cases ----------
section('Edge cases');
{
  const empty = analyzeIntervals([]);
  assert(empty.coherenceScore === 0, 'empty peaks → score 0');
  assert(empty.classification === 'unstructured', 'empty peaks → unstructured');

  const single = analyzeIntervals([peak(528)]);
  assert(single.intervals.length === 0, 'single peak → no intervals');
  assert(single.coherenceScore === 0, 'single peak → score 0');
}

// ---------- Summary ----------
console.log(`\n=========================`);
console.log(`Passed: ${passes}`);
console.log(`Failed: ${failures}`);
console.log(`=========================`);
process.exit(failures > 0 ? 1 : 0);
