// Checks for components/shell/library/scanScoresModel.ts (v16.5: Advanced's experimental scan scores).
// Run with: node components/shell/library/scanScoresModel.check.ts   (npm run check:shell; Node 22.18+ strips the types)
// Exits non-zero on any failure.

import {
  SCAN_SCORES_KEY,
  parseScanScores,
  scanBadges,
  scanScoreRows,
  scanScoreText,
  SCAN_SECTION_TITLE,
  SCAN_SECTION_LEAD,
  PEAKS_LABEL,
  PEAKS_NOTE,
} from './scanScoresModel.ts';
import { SCAN_SCORES } from '../../../utils/library/scanScores.ts';

let passed = 0;
const failures: string[] = [];
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) === JSON.stringify(b)) passed++;
  else failures.push(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

const song = (fa: Record<string, unknown> | null, ia?: unknown) => ({ id: 'x', name: 'tone-01', fractalAnalysis: fa ?? undefined, intervalAnalysis: ia });

// The setting: off unless 'true'.
eq(SCAN_SCORES_KEY, 'aetheria.scanScores.v1', 'the key');
eq([parseScanScores(null), parseScanScores(undefined), parseScanScores('false'), parseScanScores('1'), parseScanScores('true')], [false, false, false, false, true], 'the stored value');

// The cut-offs are scanScores.ts's (30 / 20 / 30 %, the superseding note), exclusive.
eq(SCAN_SCORES.filter((d) => ['golden', 'p111', 'dna'].includes(d.id)).map((d) => d.over), [0.3, 0.2, 0.3], "scanScores' cut-offs");
const over = song({ goldenRatioAlignment: 0.75, pattern111Presence: 0.55, dnaResonanceScore: 0.65 });
eq(scanBadges(over).map((b) => b.text), ['Φ 75%', '111', 'DNA'], 'over every cut-off: three badges');
eq(scanBadges(over).map((b) => b.label), ['Experimental score: golden ratio 75 %', 'Experimental score: 111 pattern 55 %', 'Experimental score: DNA resonance 65 %'], 'their names');
const at = song({ goldenRatioAlignment: 0.3, pattern111Presence: 0.2, dnaResonanceScore: 0.3 });
eq(scanBadges(at), [], 'AT the cut-offs: none (over is exclusive)');
const just = song({ goldenRatioAlignment: 0.3001, pattern111Presence: 0.2001, dnaResonanceScore: 0.3001 });
eq(scanBadges(just).map((b) => b.id), ['golden', 'p111', 'dna'], 'just over: all three');
// Classic's 70/50/60 would have shown none of these; the new layout's 30/20/30 shows them.
const mid = song({ goldenRatioAlignment: 0.42, pattern111Presence: 0.25, dnaResonanceScore: 0.31 });
eq(scanBadges(mid).map((b) => b.text), ['Φ 42%', '111', 'DNA'], 'between the two sets of cut-offs: the new ones apply');
const some = song({ goldenRatioAlignment: 0.1, pattern111Presence: 0.9, dnaResonanceScore: NaN });
eq(scanBadges(some).map((b) => b.id), ['p111'], 'one over, one under, one NaN');
for (const bad of [null, undefined, song(null), song({}), song({ goldenRatioAlignment: '0.9' }), { id: 'y', name: 'z', fractalAnalysis: 7 }]) {
  eq(scanBadges(bad as never), [], `no badges for ${JSON.stringify(bad)}`);
  eq(scanScoreRows(bad as never), [], `no rows for ${JSON.stringify(bad)}`);
  eq(scanScoreText(bad as never), '', `no text for ${JSON.stringify(bad)}`);
}

// Track info's rows: the five scores with their notes, the peaks (first 10), the interval scores.
const full = song(
  {
    goldenRatioAlignment: 0.72,
    pattern111Presence: 0.18,
    dnaResonanceScore: 0.41,
    sacredGeometryAlignment: 0.9,
    schumannResonanceHarmony: 0.05,
    infiniteOrderHarmonics: [1838, 919.25, 612.8, 459.6, 367.7, 306.4, 262.6, 229.8, 204.2, 183.8, 167.1],
    safetyLevel: 'SAFE',
    recommendedVolume: 0.5,
  },
  { coherenceScore: 63.4, fingerprint: { ratio369: 0.333 } }
);
const rows = scanScoreRows(full);
eq(rows.map((r) => r.label), ['Golden ratio score', '111 pattern score', 'DNA resonance score', 'Sacred geometry score', 'Schumann harmony score', PEAKS_LABEL, 'Coherence', '3-6-9 ratio'], 'the rows in order');
eq(rows.map((r) => r.value).slice(0, 5), ['72 %', '18 %', '41 %', '90 %', '5 %'], 'their values');
eq(rows.find((r) => r.label === 'DNA resonance score')?.note, 'A name for a score, not a biological measure', "DNA's note");
eq(rows.find((r) => r.label === 'Sacred geometry score')?.note, 'Higher for noisy sound than for pure tones', "geometry's note");
eq(rows.find((r) => r.label === PEAKS_LABEL), { label: PEAKS_LABEL, value: '1838.0, 919.3, 612.8, 459.6, 367.7, 306.4, 262.6, 229.8, 204.2, 183.8', note: PEAKS_NOTE }, 'the first 10 peaks');
eq(rows.slice(-2).map((r) => r.value), ['63/100', '33 %'], 'the interval scores');
const text = scanScoreText(full);
eq(text.split('\n').slice(0, 2), [SCAN_SECTION_TITLE, SCAN_SECTION_LEAD], 'Copy: the title and the lead first');
eq(/safety|SAFE|volume|0\.5/i.test(text), false, 'never the safety level or the recommended volume');
eq(rows.some((r) => /safety|volume/i.test(r.label)), false, 'no safety or volume row');
eq(SCAN_SECTION_LEAD, "Scores from Deep Scan's reading of the spectrum, which is not a pitch measurement. Not evidence of any effect.", 'the lead');
eq(scanScoreRows(song({ goldenRatioAlignment: 0.5 })).map((r) => r.label), ['Golden ratio score'], 'only what is there');
eq(scanScoreRows(song(null, { coherenceScore: 'x', fingerprint: { ratio369: Infinity } })), [], 'bad interval fields: nothing');

if (failures.length) {
  console.error(`scanScoresModel: ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`scanScoresModel: ${passed} checks passed, 0 failed`);
