// utils/library/filterModel.check.ts (v16.2): node utils/library/filterModel.check.ts [--bench]
// The pass against a brute-force oracle on random libraries; the facets' rules at their edges; the saved form against
// hostile input; purity; the words. Synthetic tone-NNNN names only.

import {
  LIBRARY_FACETS, NO_FILTERS, LENGTH_EDGES, REGIMES, CRYSTAL_HELP,
  buildFacetIndex, filterPass, countOf, regimeCount, toggleValue, toggleRegime, regimeState, withFacet, pickedCount, filtersOn,
  parseFilters, serializeFilters, valueLabel, activeLabel, activeChips, filterName, keyIndex, emptyHint,
  crystalValue, lengthValue, scanValue, syncValue, keyValue, confidenceValue, normalText,
} from './filterModel.ts';
import type { FilterSong, Filters, FacetDef } from './filterModel.ts';
import { ALL_CRYSTALS, crystalOrigin } from '../mix/distribution.ts';
import { CHROMA_VERSION } from '../soundV2/keyAnalysis.ts';

let passed = 0;
let failed = 0;
const ok = (c: boolean, msg: string) => {
  if (c) passed++;
  else {
    failed++;
    if (failed < 30) console.error('FAIL', msg);
  }
};
const eq = (a: unknown, b: unknown, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

// ---- a seeded generator and random tracks ---------------------------------------------------------------------
let seed = 0x2f6e2b1;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const env = (n: number) => ({ bass: { length: n } });
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function track(i: number): FilterSong {
  const s: FilterSong = { id: `17710${String(i).padStart(8, '0')}-x${i}`, name: `tone-${String(i).padStart(4, '0')}` };
  const r = rnd();
  if (r < 0.75) s.duration = pick([0, NaN, -1, 1, 90, 179.9, 180, 180.4, 299.99, 300, 431, 599, 600, 601, 3600, Infinity]);
  const c = rnd();
  if (c < 0.6) {
    const hz = rnd() < 0.95 ? pick(ALL_CRYSTALS) : pick([111, 75, 527.5, 7000]);
    s.closestSolfeggio = hz;
    const kind = rnd();
    if (kind < 0.35) { s.harmonicFreq = hz + 3; s.harmonicDeviation = 3; s.crystalSource = 'scan'; }
    else if (kind < 0.45) { s.harmonicFreq = 440; s.harmonicDeviation = 999; s.crystalSource = 'scan'; }
    else if (kind < 0.55) { s.harmonicFreq = 900; s.harmonicDeviation = 12; s.isAetheriaCandidate = false; } // derived: replaced
    else if (kind < 0.65) { s.harmonicFreq = hz + 2; s.harmonicDeviation = 2; s.fractalAnalysis = null as never; } // derived: scan
    else { s.harmonicFreq = hz; s.harmonicDeviation = 5; s.crystalSource = 'assigned'; }
  } else if (c < 0.7) {
    s.closestSolfeggio = pick([0, NaN, -5]);
  }
  if (rnd() < 0.3) s.bandEnvelope = env(pick([0, 40]));
  if (rnd() < 0.4) s.visualEnvelope = rnd() < 0.2 ? null : env(pick([0, 40]));
  const k = rnd();
  if (k < 0.5) {
    s.chromaVersion = CHROMA_VERSION;
    if (rnd() < 0.85) { s.musicKey = pick([...KEYS, ...KEYS.map((x) => x + 'm'), '', 'Bb', 'Ebm', 'H', 'c']); s.keyConfidence = pick([0, 0.2, 0.4499, 0.45, 0.6, 0.7499, 0.75, 0.9, NaN]); }
  } else if (k < 0.6) {
    s.analysisFailedV = CHROMA_VERSION;
  } else if (k < 0.65) {
    s.chromaVersion = CHROMA_VERSION + 1; // a future version: not analysed by this one
  }
  return s;
}
const library = (n: number) => Array.from({ length: n }, (_, i) => track(i));
const facetVals = (f: FacetDef<any>) => f.values.filter((v) => !f.hidden.includes(v));
function randomFilters(): Filters {
  let f: Filters = NO_FILTERS;
  for (const facet of LIBRARY_FACETS) {
    if (rnd() < 0.55) continue;
    const vals = facetVals(facet);
    const k = 1 + Math.floor(rnd() * Math.min(4, vals.length));
    for (let j = 0; j < k; j++) f = withFacet(f, facet.id, [...(f[facet.id] ?? []), pick(vals)]);
  }
  if (rnd() < 0.05) f = { ...f, crystal: ['528', 'other', 'nope'] } as Filters; // hand-made: hidden + unknown ignored
  return f;
}

// ---- the oracle -----------------------------------------------------------------------------------------------
function oracle(songs: readonly FilterSong[], f: Filters, text: string) {
  const q = normalText(text);
  const sel = LIBRARY_FACETS.map((facet) => {
    const v = (f[facet.id] ?? []).filter((x) => facet.values.includes(x) && !facet.hidden.includes(x));
    return v.length ? new Set(v) : null;
  });
  const passExcept = (s: FilterSong, skip: number) =>
    (!q || String(s.name).toLowerCase().includes(q)) &&
    LIBRARY_FACETS.every((facet, i) => i === skip || !sel[i] || sel[i]!.has(facet.values[facet.valueOf(s)]));
  const results = songs.filter((s) => passExcept(s, -1));
  const counts = LIBRARY_FACETS.map((facet, i) => facet.values.map((v) => songs.filter((s) => passExcept(s, i) && facet.values[facet.valueOf(s)] === v).length));
  return { results, counts };
}

// ---- 1. the pass equals the oracle ----------------------------------------------------------------------------
for (let round = 0; round < 400; round++) {
  const songs = library(1 + Math.floor(rnd() * 120));
  const f = randomFilters();
  const text = rnd() < 0.3 ? pick(['', '00', 'TONE-00', ' 1 ', 'zzz', '-0']) : '';
  const idx = buildFacetIndex(songs);
  const r = filterPass(idx, f, text);
  const o = oracle(songs, f, text);
  ok(r.results.length === o.results.length && r.results.every((s, i) => s === o.results[i]), `round ${round}: results equal the oracle, in order`);
  for (let i = 0; i < LIBRARY_FACETS.length; i++) eq(Array.from(r.counts[i]), o.counts[i], `round ${round}: counts of ${LIBRARY_FACETS[i].id}`);
  eq(r.total, songs.length, `round ${round}: total`);
  const secs = o.results.reduce((a, s) => a + (typeof s.duration === 'number' && Number.isFinite(s.duration) && s.duration > 0 ? s.duration : 0), 0);
  ok(Math.abs(r.seconds - secs) < 1e-6, `round ${round}: seconds`);
  // Invariants: an active facet's picked counts sum to the results; an inactive facet's counts sum to the results.
  LIBRARY_FACETS.forEach((facet, i) => {
    const picked = (f[facet.id] ?? []).filter((v) => facet.values.includes(v) && !facet.hidden.includes(v));
    const sum = picked.length
      ? picked.reduce((a, v) => a + r.counts[i][facet.values.indexOf(v)], 0)
      : Array.from(r.counts[i]).reduce((a, b) => a + b, 0);
    ok(sum === r.results.length, `round ${round}: ${facet.id} counts sum to the shown tracks`);
  });
}

// ---- 2. the facets' rules at their edges ------------------------------------------------------------------------
const S = (o: Partial<FilterSong>): FilterSong => ({ id: '1771000000000-a', name: 'tone-0001', ...o });
const V = (facet: string, s: FilterSong) => {
  const f = LIBRARY_FACETS.find((x) => x.id === facet)!;
  return f.values[f.valueOf(s)];
};
eq([undefined, 0, NaN, -5, Infinity, 528, 6336, 174, 111, 527.5].map((c) => V('crystal', S({ closestSolfeggio: c as number }))), ['none', 'none', 'none', 'none', 'none', '528', '6336', '174', 'other', 'other'], 'crystal values (the row\'s crystalText rule: Infinity is no crystal)');
eq(ALL_CRYSTALS.map((c) => V('crystal', S({ closestSolfeggio: c }))), ALL_CRYSTALS.map(String), 'all 27 crystals have their own value');
eq([undefined, 0, NaN, -1, 1, 179.99, 180, 299.99, 300, 599.99, 600, 7200].map((d) => V('length', S({ duration: d as number }))), ['unknown', 'unknown', 'unknown', 'unknown', 'lt3', 'lt3', '3to5', '3to5', '5to10', '5to10', 'ge10', 'ge10'], 'length edges');
eq(LENGTH_EDGES, [180, 300, 600], 'length edges are decision 3 A');
const scanCases: Partial<FilterSong>[] = [
  {}, { closestSolfeggio: 528 }, { closestSolfeggio: 528, harmonicFreq: 528, harmonicDeviation: 5, crystalSource: 'assigned' },
  { closestSolfeggio: 528, harmonicFreq: 530, harmonicDeviation: 2, crystalSource: 'scan' },
  { closestSolfeggio: 528, harmonicFreq: 440, harmonicDeviation: 999, crystalSource: 'scan' },
  { closestSolfeggio: 528, harmonicFreq: 900, harmonicDeviation: 12, isAetheriaCandidate: false },
  { closestSolfeggio: 528, harmonicFreq: 530.5, harmonicDeviation: 2.5, fractalAnalysis: null as never },
];
eq(scanCases.map((c) => V('scan', S(c))), ['unscanned', 'unscanned', 'unscanned', 'scanned', 'failed', 'scanned', 'scanned'], 'Deep Scan values');
for (const c of scanCases) {
  const o = crystalOrigin(S(c));
  ok((V('scan', S(c)) === 'scanned') === (o === 'scan' || o === 'scan-replaced'), 'Deep Scan follows crystalOrigin');
}
eq([{}, { bandEnvelope: env(0) }, { bandEnvelope: env(1) }, { visualEnvelope: env(1) }, { bandEnvelope: null, visualEnvelope: env(0) }, { visualEnvelope: null }].map((c) => V('sync', S(c as Partial<FilterSong>))), ['no', 'no', 'yes', 'yes', 'no', 'no'], 'visual sync values');
eq([
  {}, { chromaVersion: CHROMA_VERSION, musicKey: 'Am' }, { chromaVersion: CHROMA_VERSION, musicKey: '' }, { chromaVersion: CHROMA_VERSION },
  { analysisFailedV: CHROMA_VERSION }, { chromaVersion: CHROMA_VERSION, musicKey: 'C#', analysisFailedV: CHROMA_VERSION },
  { chromaVersion: CHROMA_VERSION + 1, musicKey: 'Am' }, { chromaVersion: CHROMA_VERSION, musicKey: 'Bbm' }, { chromaVersion: CHROMA_VERSION, musicKey: 'H' },
].map((c) => V('key', S(c as Partial<FilterSong>))), ['unanalysed', 'Am', 'noclear', 'noclear', 'failed', 'C#', 'unanalysed', 'A#m', 'noclear'], 'key values (analysed first, then failed)');
eq(['C', 'B', 'Cm', 'Bm', 'Db', 'C♯', 'Cb', 'E#', 'Am ', '', 'x', 7].map(keyIndex), [0, 11, 12, 23, 1, 1, 11, 5, 21, -1, -1, -1], 'keyIndex');
eq([0, 0.4499, 0.45, 0.7499, 0.75, 1, NaN].map((c) => V('confidence', S({ chromaVersion: CHROMA_VERSION, musicKey: 'A', keyConfidence: c }))), ['weak', 'weak', 'partial', 'partial', 'strong', 'strong', 'na'], 'confidence edges (Key fit: 0.45, 0.75)');
eq(V('confidence', S({ keyConfidence: 0.9 })), 'na', 'confidence without the current analysis: na');
// The crystal facet's "No crystal" equals the health card's noCrystal count (closestSolfeggio falsy) on non-negative data.
{
  const songs = library(300).filter((s) => !(typeof s.closestSolfeggio === 'number' && s.closestSolfeggio < 0));
  const r = filterPass(buildFacetIndex(songs), NO_FILTERS);
  ok(countOf(r, LIBRARY_FACETS, 'crystal', 'none') === songs.filter((s) => !s.closestSolfeggio).length, 'No crystal = the health card\'s count');
}

// ---- 3. picking: toggles, regimes, purity -----------------------------------------------------------------------
{
  const f0: Filters = NO_FILTERS;
  const f1 = toggleValue(f0, 'crystal', '639');
  const f2 = toggleValue(f1, 'crystal', '528');
  eq(f2, { crystal: ['528', '639'] }, 'picks kept in the facet\'s order');
  eq(toggleValue(f2, 'crystal', '528'), { crystal: ['639'] }, 'a second tap drops it');
  eq(toggleValue(f1, 'crystal', '639'), {}, 'an empty facet goes');
  eq(toggleValue(f0, 'crystal', 'other'), {}, 'a hidden value is never picked');
  eq(toggleValue(f0, 'nope', 'x'), {}, 'an unknown facet is ignored');
  eq(f0, {}, 'NO_FILTERS untouched');
  eq(f1, { crystal: ['639'] }, 'toggleValue never mutates its input');
  const g = toggleRegime(f1, 'gut');
  eq(g.crystal, ['174', '285', '396', '417', '528', '639', '741', '852', '963'], 'a regime picks its nine');
  eq(regimeState(g, 'gut'), 'all', 'regime all');
  eq(regimeState(f1, 'gut'), 'some', 'regime some');
  eq(regimeState(f1, 'heart'), 'none', 'regime none');
  eq(toggleRegime(g, 'gut'), {}, 'all nine picked: the regime drops them (639 too)');
  eq(toggleRegime(toggleValue(f0, 'crystal', '1206'), 'gut').crystal?.length, 10, 'a regime keeps the other picks');
  eq(pickedCount(withFacet(g, 'length', ['lt3', 'ge10'])), 11, 'picked count');
  ok(!filtersOn(NO_FILTERS) && filtersOn(f1), 'filtersOn');
  for (const r of REGIMES) eq(r.crystals.length, 9, `${r.name} has nine`);
  eq(REGIMES.flatMap((r) => r.crystals), [...ALL_CRYSTALS], 'the regimes cover the 27, in order');
  // Regime counts are the sum of their crystals'.
  const songs = library(200);
  const r = filterPass(buildFacetIndex(songs), { length: ['lt3', '3to5'] });
  for (const reg of REGIMES) eq(regimeCount(r, reg.id), reg.crystals.reduce((a, c) => a + countOf(r, LIBRARY_FACETS, 'crystal', String(c)), 0), `regime ${reg.id} count`);
  // The index never mutates the songs, and the pass keeps object identity.
  const before = JSON.stringify(songs);
  const idx = buildFacetIndex(songs);
  const res = filterPass(idx, { crystal: ['528'] }, 'tone');
  ok(JSON.stringify(songs) === before, 'the index and the pass write nothing on the tracks');
  ok(res.results.every((s) => songs.includes(s)), 'results are the library\'s own objects');
  // An OR within a facet: picking more values never shows fewer; an AND across: another facet never shows more.
  for (let i = 0; i < 100; i++) {
    const lib = library(80);
    const ix = buildFacetIndex(lib);
    const a = randomFilters();
    const facet = pick(LIBRARY_FACETS);
    const more = withFacet(a, facet.id, [...(a[facet.id] ?? []), pick(facetVals(facet))]);
    const na = filterPass(ix, a).results.length;
    const nm = filterPass(ix, more).results.length;
    if ((a[facet.id] ?? []).length > 0) ok(nm >= na, 'OR within a facet: more picks, never fewer tracks');
    else ok(nm <= na, 'AND across facets: a new facet, never more tracks');
  }
  // Duplicates (a playlist's) stay, and count as entries.
  const dupe = [songs[0], songs[1], songs[0]];
  eq(filterPass(buildFacetIndex(dupe), NO_FILTERS).results.length, 3, 'duplicates stay');
}

// ---- 4. the text: the search's own rule ----------------------------------------------------------------------
{
  const songs = [S({ id: 'a', name: 'tone-0001' }), S({ id: 'b', name: 'Tone-0002 Deep' }), S({ id: 'c', name: '' }), S({ id: 'd', name: undefined as never })];
  const ix = buildFacetIndex(songs);
  eq(filterPass(ix, NO_FILTERS, '  TONE ').results.map((s) => s.id), ['a', 'b'], 'case-blind, trimmed substring');
  eq(filterPass(ix, NO_FILTERS, 'deep').results.map((s) => s.id), ['b'], 'any part of the name');
  eq(filterPass(ix, NO_FILTERS, '').results.length, 4, 'no text: all');
  eq(filterPass(ix, NO_FILTERS, 'undefined').results.length, 0, 'a missing name is the empty string');
  const r = filterPass(ix, { crystal: ['528'] }, 'tone');
  eq(Array.from(r.counts[0]).reduce((a, b) => a + b, 0), 2, 'counts honour the text (only tracks matching it count)');
}

// ---- 5. saved: parse / serialize ------------------------------------------------------------------------------
{
  const f: Filters = { crystal: ['528', '639'], length: ['lt3'], key: ['Am', 'noclear'], confidence: ['strong'], scan: ['failed'], sync: ['yes'] };
  const s = serializeFilters(f);
  eq(JSON.parse(s), { v: 1, f: { crystal: ['528', '639'], length: ['lt3'], scan: ['failed'], sync: ['yes'], key: ['Am', 'noclear'], confidence: ['strong'] } }, 'serialized: facets and values in order');
  eq(parseFilters(s), withFacet(withFacet(withFacet(withFacet(withFacet(withFacet(NO_FILTERS, 'crystal', ['528', '639']), 'length', ['lt3']), 'scan', ['failed']), 'sync', ['yes']), 'key', ['Am', 'noclear']), 'confidence', ['strong']), 'round trip');
  ok(!s.includes('tone'), 'the text is never saved');
  eq(serializeFilters(NO_FILTERS), '{"v":1,"f":{}}', 'none');
  const hostile: unknown[] = [
    null, undefined, 42, '', 'null', '[]', '{}', '{"v":2,"f":{"crystal":["528"]}}', '{"v":"1","f":{"crystal":["528"]}}', '{"v":1}', '{"v":1,"f":[]}', '{"v":1,"f":null}',
    '{"v":1,"f":{"crystal":"528"}}', '{"v":1,"f":{"crystal":[528]}}', '{"v":1,"f":{"crystal":["other","nope","528","528"]}}',
    '{"v":1,"f":{"__proto__":{"crystal":["528"]}}}', '{"v":1,"f":{"constructor":["x"],"toString":["y"]}}', '{"v":1,"f":{"confidence":["na"]}}',
    '{"v":1,"f":{"length":["lt3","ge10","lt3"]}}', 'x'.repeat(5000), '{"v":1,"f":{"crystal":' + JSON.stringify(Array(40).fill('528')) + '}}', '{bad json',
  ];
  const parsed = hostile.map((h) => parseFilters(h));
  eq(parsed, [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, { crystal: ['528'] }, {}, {}, {}, { length: ['lt3', 'ge10'] }, {}, {}, {}], 'hostile saved shapes');
  ok(({} as Record<string, unknown>).crystal === undefined, 'no prototype pollution');
}

// ---- 6. words -------------------------------------------------------------------------------------------------
eq(['lt3', '3to5', '5to10', 'ge10', 'unknown'].map((v) => valueLabel('length', v)), ['Under 3 min', '3–5 min', '5–10 min', '10 min or more', 'Length not read yet'], 'length words');
eq(['528', 'none', 'other'].map((v) => valueLabel('crystal', v)), ['528 Hz', 'No crystal', 'Other'], 'crystal words');
eq(['Am', 'C#', 'A#m', 'noclear', 'unanalysed', 'failed'].map((v) => valueLabel('key', v)), ['A minor', 'C♯ major', 'A♯ minor', 'No clear key', 'Not analysed yet', "Couldn't be read"], 'key words');
eq(['scanned', 'unscanned', 'failed'].map((v) => activeLabel('scan', v)), ['Deep Scan: scanned', 'Deep Scan: not scanned', "Deep Scan: couldn't read"], 'active scan words');
eq(['strong', 'partial', 'weak'].map((v) => activeLabel('confidence', v)), ['Key clear', 'Key partly clear', 'Key unclear'], 'active confidence words');
ok(CRYSTAL_HELP.includes('Not a measured pitch'), 'the crystal help says it is not a measured pitch');
eq(activeChips(toggleRegime(toggleValue(NO_FILTERS, 'crystal', '1206'), 'gut')).map((c) => c.label), ['GUT', '1206 Hz'], 'a whole regime is one chip');
eq(filterName({ crystal: ['528'], length: ['lt3'] }), '528 Hz · Under 3 min', 'filter name');
eq(filterName({ crystal: ['174', '285', '396', '528'], length: ['lt3'] }), '174 Hz · 285 Hz · 396 Hz +2 more', 'filter name, long');
eq(filterName(NO_FILTERS), 'Library', 'filter name, none');

// ---- 6b. the empty result's hint, against the oracle ----------------------------------------------------------
{
  let empties = 0;
  for (let round = 0; round < 1500 && empties < 200; round++) {
    const songs = library(10 + Math.floor(rnd() * 60));
    const f = randomFilters();
    const text = rnd() < 0.2 ? pick(['00', 'zzz']) : '';
    const r = filterPass(buildFacetIndex(songs), f, text);
    const h = emptyHint(r, f);
    if (r.results.length > 0) { ok(h === null, 'no hint when something shows'); continue; }
    empties++;
    // The oracle: each active facet cleared in turn.
    const opts = LIBRARY_FACETS.filter((facet) => (f[facet.id] ?? []).some((v) => facet.values.includes(v) && !facet.hidden.includes(v)))
      .map((facet) => ({ id: facet.id, n: oracle(songs, withFacet(f, facet.id, []), text).results.length }));
    const max = Math.max(0, ...opts.map((o) => o.n));
    if (max === 0) ok(h === null, `round ${round}: no single facet helps → no hint`);
    else {
      const first = opts.find((o) => o.n === max)!;
      ok(!!h && h.facet === first.id && h.count === max, `round ${round}: the hint clears the facet that shows the most (${JSON.stringify(h)} vs ${first.id} ${max})`);
    }
  }
  ok(empties >= 50, `enough empty results were tried (${empties})`);
  const songs = [S({ id: 'a', closestSolfeggio: 528, duration: 100 }), S({ id: 'b', closestSolfeggio: 639, duration: 100 }), S({ id: 'c', closestSolfeggio: 4212, duration: 200 })];
  const f = { crystal: ['528', '639'], length: ['3to5'] };
  eq(emptyHint(filterPass(buildFacetIndex(songs), f), f), { facet: 'length', label: '3–5 min', count: 2 }, 'hint: clearing the length shows 2, the crystals 1');
  const g = { crystal: ['528', '639'], length: ['ge10'] };
  const songs2 = [...songs, S({ id: 'd', closestSolfeggio: 4212, duration: 900 }), S({ id: 'e', closestSolfeggio: 174, duration: 700 })];
  eq(emptyHint(filterPass(buildFacetIndex(songs2), g), g), { facet: 'crystal', label: '528 Hz or 639 Hz', count: 2 }, 'hint words for several picks');
}

// ---- 7. cost ----------------------------------------------------------------------------------------------------
if (process.argv.includes('--bench')) {
  const time = (fn: () => void, reps: number) => {
    for (let i = 0; i < 3; i++) fn();
    const t0 = performance.now();
    for (let i = 0; i < reps; i++) fn();
    return (performance.now() - t0) / reps;
  };
  for (const n of [450, 1000, 5000, 10000]) {
    const songs = library(n);
    let idx = buildFacetIndex(songs);
    const tIndex = time(() => { idx = buildFacetIndex(songs); }, 30);
    const tNone = time(() => filterPass(idx, NO_FILTERS), 60);
    const tTwo = time(() => filterPass(idx, { crystal: ['528', '639', '741'], length: ['lt3', '3to5'] }), 60);
    const tAll = time(() => filterPass(idx, { crystal: ['528', '639'], length: ['lt3'], scan: ['scanned'], sync: ['yes'], key: ['Am', 'C'], confidence: ['strong'] }, 'tone-0'), 60);
    const tText = time(() => filterPass(idx, { crystal: ['528'] }, 'tone-01'), 60);
    console.log(`bench n=${n}: index ${tIndex.toFixed(3)} ms; pass none ${tNone.toFixed(3)} / two facets ${tTwo.toFixed(3)} / six facets + text ${tAll.toFixed(3)} / one facet + text ${tText.toFixed(3)} ms`);
  }
}

console.log(`filterModel.check: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
