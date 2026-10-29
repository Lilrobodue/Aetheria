// utils/library/scanScores.check.ts (v16.3; npm run check:filters): the scores' cut-offs and words, and the seam the
// builder uses: the Library's facets composed with the experimental ones, over any set of tracks.
import { LIBRARY_FACETS, buildFacetIndex, filterPass, countOf, withFacet, NO_FILTERS } from './filterModel.ts';
import { EXPERIMENTAL_FACETS, SCAN_SCORES, hasScore, scoreChipText, SCAN_SCORES_LEAD } from './scanScores.ts';
import type { ScoreSong } from './scanScores.ts';

let passed = 0, failed = 0;
const ok = (c: boolean, m: string) => (c ? passed++ : (failed++, console.error('FAIL', m)));
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const T = (i: number, o: Partial<ScoreSong>): ScoreSong => ({ id: `t${i}`, name: `tone-${String(i).padStart(4, '0')}`, ...o });
const songs: ScoreSong[] = [
  T(1, { closestSolfeggio: 528, fractalAnalysis: { goldenRatioAlignment: 0.31, pattern111Presence: 0.1, dnaResonanceScore: 0.5 }, isAetheriaCandidate: true }),
  T(2, { closestSolfeggio: 528, fractalAnalysis: { goldenRatioAlignment: 0.3, pattern111Presence: 0.21, dnaResonanceScore: 0.3 }, isAetheriaCandidate: false }),
  T(3, { closestSolfeggio: 639, fractalAnalysis: null }),
  T(4, { closestSolfeggio: 639 }),
  T(5, { closestSolfeggio: 528, fractalAnalysis: { goldenRatioAlignment: NaN } }),
];
const golden = SCAN_SCORES.find((d) => d.id === 'golden')!;
eq(songs.map((s) => hasScore(golden, s)), [true, false, null, null, null], 'golden: over 0.3, exclusive (the Golden mix\'s rule); no reading → null');
eq(SCAN_SCORES.filter((d) => d.over !== null).map((d) => [d.id, d.over]), [['golden', 0.3], ['p111', 0.2], ['dna', 0.3], ['candidate', 0.5]], 'the cut-offs (decision 4 A)');
eq(EXPERIMENTAL_FACETS.map((f) => f.id), ['x-golden', 'x-p111', 'x-dna', 'x-candidate'], 'the experimental facets');
eq(SCAN_SCORES.filter((d) => d.over !== null).map(scoreChipText), ['Golden ratio score over 30 %', '111 pattern score over 20 %', 'DNA resonance score over 30 %', 'Aetheria number'], 'chip words');
ok(SCAN_SCORES_LEAD.includes('not a pitch measurement'), 'the lead says it is not a measurement');

// Composed: the library's facets + the experimental ones, on a playlist-like set with a repeat.
const facets = [...LIBRARY_FACETS, ...EXPERIMENTAL_FACETS] as typeof EXPERIMENTAL_FACETS;
const set = [...songs, songs[0]];
const idx = buildFacetIndex(set, facets);
let f = withFacet(NO_FILTERS, 'crystal', ['528'], facets);
f = withFacet(f, 'x-golden', ['over'], facets);
const r = filterPass(idx, f);
eq(r.results.map((s) => s.id), ['t1', 't1'], 'crystal 528 AND golden over 30 %: the repeat stays');
eq(countOf(r, facets, 'x-golden', 'over'), 2, 'the golden chip\'s count');
eq(countOf(r, facets, 'crystal', '639'), 0, 'crystal counts under the golden filter');
eq(withFacet(NO_FILTERS, 'x-golden', ['under'], facets), {}, 'a hidden value is never picked');

console.log(`scanScores.check: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
