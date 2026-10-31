// utils/copy/copy.check.ts (v16.6; npm run check:copy, after scripts/check-copy.mjs): the copy modules' own rules.
//   - every tier has all its fields, a distinct label and heading, and an icon the tag knows;
//   - the 27 crystals, 111 and the 6 Lo Shu Perfect counterparts resolve, and nothing else does;
//   - no crystal name carries a gate word (a name stands alone, untagged, in the cube and on cards);
//   - every association reads "Traditionally associated with" (GUT) or "In the Aetheria framework" (HEART, HEAD), 111's
//     excepted, and carries a real tier;
//   - every topic's tags are tiers, every ref's URL is https, every tier the Guide's technical view lists has a source
//     where the spec says it must (Tier 1, 2 and 3);
//   - BAND_LINES has the five bands; place() is total in both layouts and differs where the places differ;
//   - no RETIRED phrase in any string of these modules.
import { TIERS, TIER_ORDER, TOPICS, TAG_LABELS, tagLabel, tagName, refsForTier, isTier, HOW_SURE_WORDS, HOW_SURE_INTRO, HOW_SURE_FOOTER } from './evidence.ts';
import type { Tier } from './evidence.ts';
import {
  CRYSTAL_COPY, CRYSTAL_111, PERFECT_OF, crystalCopy, perfectLine, REGIME_COPY, TRANSITION_COPY, BAND_LINES, bandLine, BEAT_EVIDENCE,
  RETUNE_SHORT, RETUNE_LONG, RETUNE_HISTORY, orderLine, perfectAssociation,
} from './crystalCopy.ts';
import { PLACES, PLACE_KEYS, place } from './places.ts';
import { TAGGED_SHAPES } from './crystalCopy.ts';
import { GEOMETRY_INFO } from '../../constants.ts';
import * as sound from './soundCopy.ts';
import * as evidence from './evidence.ts';
import * as crystal from './crystalCopy.ts';
import * as places from './places.ts';
import { WORDS, RETIRED, TIERS as GATE_TIERS, wordsIn } from '../../scripts/copy-words.mjs';

let passed = 0;
let failed = 0;
const ok = (c: boolean, m: string) => (c ? passed++ : (failed++, console.error('FAIL', m)));
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

// --- the tiers --------------------------------------------------------------------------------------------------
eq([...TIER_ORDER], GATE_TIERS, 'TIER_ORDER is the gate’s tier list, in order');
const ICONS = ['Sigma', 'CircleCheck', 'Contrast', 'Sprout', 'CircleHelp', 'PencilRuler', 'ScrollText'];
for (const t of TIER_ORDER) {
  const c = TIERS[t];
  ok(!!c && c.id === t, `${t}: its id`);
  for (const k of ['label', 'labelNumbered', 'heading', 'plain', 'technical'] as const) ok(typeof c[k] === 'string' && c[k].trim().length > 1, `${t}: ${k}`);
  ok(ICONS.includes(c.icon), `${t}: a known icon`);
  ok(Array.isArray(c.examples) && c.examples.length >= 2, `${t}: examples`);
  ok(c.dashed === (t === 'open' || t === 'tradition'), `${t}: dashed only for Open and Tradition (not a level of support)`);
  ok(tagName(t) === `Evidence: ${tagLabel(t)}. Opens How sure are we?`, `${t}: the tag’s name contains its label`);
  ok(c.heading.includes(c.label), `${t}: the heading contains the plain label`);
}
eq(new Set(TIER_ORDER.map((t) => TIERS[t].label)).size, 7, 'seven distinct labels');
eq(TAG_LABELS, 'plain', 'decision 1 A: plain words on the tag');
eq(TIER_ORDER.map(tagLabel), ['Arithmetic', 'Well studied', 'Mixed evidence', 'Early evidence', 'Open question', 'Design choice', 'Tradition'], 'the seven labels (decision 1 A)');
eq(['tier1', 'tier2', 'tier3'].map((t) => TIERS[t as Tier].heading), ['Tier 1 · Well studied', 'Tier 2 · Mixed evidence', 'Tier 3 · Early evidence'], 'the Guide’s headings add the tier number');
ok(isTier('tradition') && !isTier('maybe') && !isTier(null), 'isTier');

// --- the topics and their sources -----------------------------------------------------------------------------------
eq(TOPICS.length, 9, 'nine topics');
eq(new Set(TOPICS.map((t) => t.id)).size, TOPICS.length, 'distinct topic ids');
for (const topic of TOPICS) {
  ok(topic.tags.length > 0 && topic.tags.every((t) => isTier(t)), `${topic.id}: every tag is a tier`);
  ok(topic.plain.length > 40 && topic.technical.length > 40, `${topic.id}: plain and technical words`);
  ok(topic.refs.length > 0, `${topic.id}: at least one source`);
  for (const r of topic.refs) ok(/^https:\/\/\S+$/.test(r.url) && r.cite.length > 10, `${topic.id}: ${r.url} is https with a citation`);
}
for (const t of ['tier1', 'tier2', 'tier3'] as Tier[]) ok(refsForTier(t).length >= 1, `${t}: the technical view lists at least one source`);
eq(new Set(refsForTier('tier1').map((r) => r.url)).size, refsForTier('tier1').length, 'refsForTier lists each source once');

// --- the crystals -----------------------------------------------------------------------------------------------
const HZ = [174, 285, 396, 417, 528, 639, 741, 852, 963, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];
eq(CRYSTAL_COPY.map((c) => c.hz), HZ, 'the 27 crystals, in order');
for (const c of CRYSTAL_COPY) {
  ok(isTier(c.tag), `${c.hz}: a real tier`);
  eq(c.tag, 'tradition', `${c.hz}: Tradition (decision 2 A)`);
  const gut = c.hz <= 963;
  ok(c.association.startsWith(gut ? 'Traditionally associated with ' : 'In the Aetheria framework, '), `${c.hz}: "${gut ? 'Traditionally associated with' : 'In the Aetheria framework'}"`);
  eq(wordsIn(c.name), [], `${c.hz}: the name "${c.name}" carries no gate word`);
  ok(crystalCopy(c.hz) === c, `${c.hz}: crystalCopy resolves`);
}
ok(crystalCopy(528)!.association.includes('DNA repair') && crystalCopy(963)!.association.includes('pineal activation'), 'the tradition’s content words are kept (the user’s decision)');
for (const w of ['acts as', 'anesthetic', 'Powerful', 'repairs DNA', 'Activates']) ok(CRYSTAL_COPY.every((c) => !c.association.includes(w)), `no mechanism or effect wording: "${w}"`);
eq(crystalCopy(111), CRYSTAL_111, '111 resolves');
eq([CRYSTAL_111.tag, CRYSTAL_111.association], ['design', 'Not one of the 27 crystals.'], '111: Design choice, the chip’s words');
eq(Object.keys(PERFECT_OF).map(Number), [75, 186, 297, 408, 519, 630], 'six Perfect counterparts');
for (const [p, base] of Object.entries(PERFECT_OF)) {
  const c = crystalCopy(Number(p));
  ok(!!c && c.hz === Number(p) && c.perfectOf === base && c.association === crystalCopy(base)!.association, `${p}: ${base}'s words, marked`);
}
eq(perfectLine(528), 'Lo Shu Perfect counterpart of 528 Hz.', 'the counterpart line');
for (const base of [174, 285, 396, 417, 528, 639]) ok(perfectAssociation(base).startsWith(`Its crystal, ${base} Hz, is traditionally associated with `), `${base}: the counterpart credits its crystal (review B4)`);
for (const x of [0, 100, 527, 529, 7000, NaN, Infinity, -174]) eq(crystalCopy(x), null, `${x}: no crystal`);
eq(REGIME_COPY.map((r) => [r.regime, r.tag]), [['GUT', 'tradition'], ['HEART', 'tradition'], ['HEAD', 'tradition']], 'the regimes’ lines, tagged');
ok(REGIME_COPY[0].line.startsWith('Traditionally associated with') && REGIME_COPY.slice(1).every((r) => r.line.startsWith('In the Aetheria framework')), 'the regimes’ lines are framed');
ok(TRANSITION_COPY.every((t) => t.tag === 'tradition' && t.line.startsWith('In the Aetheria framework')), 'the transitions are framed');
eq(orderLine(5, 1692, 243), 'Fifth Order · 1692 + 243', 'a card’s arithmetic line');

// --- decision 8: a geometry name with a health word is shown tagged; the set equals the table's flagged shapes ---------
eq([...TAGGED_SHAPES].sort(), GEOMETRY_INFO.filter((g) => wordsIn(`${g.shape} ${g.element}`).length > 0).map((g) => g.shape).sort(), 'TAGGED_SHAPES = the shapes whose name or element holds a gate word');

// --- the beat, 432 ------------------------------------------------------------------------------------------------
eq(Object.keys(BAND_LINES), ['Delta', 'Theta', 'Alpha', 'Beta', 'Gamma'], 'five bands');
for (const [k, v] of Object.entries(BAND_LINES)) ok(!/best for|healing|sleep &/i.test(v) && /band/.test(v), `${k}: names the band, never "best for"`);
eq(bandLine('Delta'), 'The 0.5–4 Hz band: deep sleep’s rhythm', 'Delta’s line');
eq(bandLine('Nope'), null, 'an unknown band');
eq(BEAT_EVIDENCE.tag, 'tier2', 'the beat’s evidence line is Mixed evidence');
ok(RETUNE_SHORT.includes('third of a semitone') && !/natural/i.test(RETUNE_SHORT), '432 short: arithmetic first, no "natural"');
eq(RETUNE_LONG.map((p) => p.tag), ['arithmetic', 'tier3'], '432 long: the arithmetic, then the studies (review B6: tagged by what each states)');
ok(RETUNE_HISTORY.includes('Verdi') && !/heal|tradition/i.test(RETUNE_HISTORY), '432: the history, a sourced fact');
ok(RETUNE_LONG[0].text.includes('0.98182') && RETUNE_LONG[0].text.includes('31.8 cents') && RETUNE_LONG[0].text.includes('4:04'), '432: the arithmetic');
ok(Math.abs(1200 * Math.log2(432 / 440) + 31.77) < 0.01 && Math.abs(240 / (432 / 440) - 244.44) < 0.01, '432: 31.8 cents lower, 4:00 → 4:04 (checked)');
ok(RETUNE_LONG[0].text.includes('2⁴ × 3³') && 2 ** 4 * 3 ** 3 === 432, '432 = 2⁴ × 3³, under Arithmetic');

// --- the places -------------------------------------------------------------------------------------------------
for (const k of PLACE_KEYS) {
  for (const l of ['classic', 'new'] as const) ok(typeof place(k, l) === 'string' && place(k, l).length > 10, `place(${k}, ${l})`);
  ok(PLACES[k].classic !== PLACES[k].new, `${k}: the layouts' places differ`);
}
eq(place('deepScan', 'classic').startsWith('Click "Deep Scan"'), true, 'classic keeps its own place (E9)');
ok(place('deepScan', 'new').startsWith('In Library, open Library health and tap Scan'), 'the new layout’s place (E9)');
eq(place('deepScan', 'nope' as any), place('deepScan', 'classic'), 'an unknown layout reads as classic');

// --- the sound words ------------------------------------------------------------------------------------------------
eq(sound.highCrystalHumLine(1206), 'High crystal (1206 Hz): classic plays it as a low hum under the music. Keep the layers comfortable.', 'D2');
eq(sound.readoutReading(176.5), "📊 Deep Scan's reading: 176.5 Hz (not the music's pitch)", 'F3: a reading, not a pitch');
eq(sound.readoutDistance(2.5), '📏 2.5 Hz from the crystal', 'F3: no grade');
eq(sound.diagNoRangeLine('HEART', 'classic').includes('Test Distribution'), false, 'P9: the stale button name is gone');
eq(sound.CLASSIC_LEVEL_OPTIONS.map((o) => o.label), ['Beginner (up to 963 Hz)', 'Intermediate (up to 2,000 Hz)', 'Advanced (up to 5,000 Hz)', 'Expert (all 27)'], 'G4: the levels');
eq(sound.journalSavedToast(528), 'Experience documented! Your 528 Hz session is saved on this device.', 'L2');

// --- the words themselves -----------------------------------------------------------------------------------------
eq(WORDS.length, 15, 'the gate’s fifteen words');
ok(HOW_SURE_WORDS.includes('Traditionally associated with') && HOW_SURE_INTRO.length > 50 && HOW_SURE_FOOTER.includes('October 2026'), 'the section’s fixed words');
/** Every string a module exports, deeply (functions are called with sample arguments where they take numbers). */
const strings: string[] = [];
const collect = (v: unknown, depth = 0): void => {
  if (depth > 6 || v === null || v === undefined) return;
  if (typeof v === 'string') strings.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collect(x, depth + 1));
  else if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach((x) => collect(x, depth + 1));
};
for (const mod of [evidence, crystal, places, sound] as Record<string, unknown>[]) for (const v of Object.values(mod)) collect(v);
for (const hz of HZ) collect(crystalCopy(hz));
collect(sound.readoutScoreLines({ goldenRatioAlignment: 0.5, pattern111Presence: 0.5, dnaResonanceScore: 0.5, sacredGeometryAlignment: 0.5, schumannResonanceHarmony: 0.5 }));
collect([sound.readoutCrystal(174, 'GUT'), sound.scanNoticeLine(50), sound.scanStartToast(3, '2 min'), sound.diagNoRangeLine('HEAD', 'new'), ...sound.diagScoreLines(1, 2, 3)]);
ok(strings.length > 150, `the modules' strings are read (${strings.length})`);
for (const s of strings) for (const p of RETIRED) ok(!s.includes(p), `no retired phrase "${p}" in "${s.slice(0, 60)}"`);

console.log(`copy.check: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
