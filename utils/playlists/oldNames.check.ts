// utils/playlists/oldNames.check.ts (v16.10.1): the checks for oldNames.ts, the old score words in saved playlists.
//   node utils/playlists/oldNames.check.ts   (npm run check:playlists; Node 22.18+ strips the types)
// Sections: 1 the names v16.5 made (v165-mix-names.json), 2 the names v16.6 to v16.10 make, 3 names the app never made,
// 4 the playlists (records) and freeNames, 5 cost.
// v165-mix-names.json was recorded by running v16.5's own builderName (3260515), its cleanName and its freeName (a
// copy's " 2", " 3") and Duplicate's copies (copyName's " copy", numbered, a copy of a copy) over 6,000 seeded settings
// (sources, walks, sets, custom crystals, orders, filters with and without the score's filter), 9,000 more with the
// Aetheria number's filter after it, and 3,000 built from old-named playlists (their names in the "from …" part),
// then slimmed: every rare form, and samples of the rest. Grouped by form: whole (the name ends with the words), wholeCopy (then a copy's number),
// notLast and notLastRare (the words, then " · Aetheria number" or " +N more", perhaps cut and numbered: "… · A… 2",
// "… ·…", "… + 2"), cut (builderName's "…" at 80), cutCopy and cutCopyRare (a copy of a cut name: "… · DNA
// resonance s 2", "… over 3" where 3 is the copy's, "… over… 2"), dup and dupRare (Duplicate's: "… copy", "… copy 2",
// cut to "… c" or "… cop 2", "…… c"), fromOld (the words in a "from …" part, often twice), hidden (made with the
// filter, but the words were cut away or behind "+N more") and without (made without it).

import { readFileSync } from 'node:fs';
import { OLD_SCORE_WORDS, NEW_SCORE_WORDS, CUT_UNITS, CUT_POINTS, renamedOldWords, renameOldScoreWords, freeNames } from './oldNames.ts';
import { NAME_MAX, parseRecord, sortLists, createPlaylist, cleanName, freeName, headOfName } from './model.ts';
import type { PlaylistRecord } from './model.ts';
import { builderName, DEFAULT_SETTINGS } from '../mix/builder.ts';

let pass = 0, fail = 0;
const ok = (c: boolean, msg: string) => { if (c) pass++; else { fail++; if (fail <= 40) console.log('FAIL', msg); } };
const eq = (a: unknown, b: unknown, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const cp = (s: string) => Array.from(s).length;
/** builderName's cut, in code points: the start (79), its end spaces dropped, then "…". */
const cut80 = (s: string) => (cp(s) <= NAME_MAX ? s : `${Array.from(s).slice(0, NAME_MAX - 1).join('').trimEnd()}…`);
/** The new name's fit: the body as it is when it and the copy's number fit, else cut (whole graphemes) with "…". */
const fit = (body: string, copy: string) => (cp(body) + cp(copy) <= NAME_MAX ? body + copy : `${headOfName(body, NAME_MAX - cp(copy) - 1).trimEnd()}…${copy}`);

const fx = JSON.parse(readFileSync(new URL('./v165-mix-names.json', import.meta.url), 'utf8')) as Record<string, string[]>;
const SHOWS = ['whole', 'wholeCopy', 'notLast', 'notLastRare', 'cut', 'cutCopy', 'cutCopyRare', 'dup', 'dupRare', 'fromOld'];
const CUTS = ['cut', 'cutCopy', 'cutCopyRare'];

// ---------------------------------------------------------------------------------------------------------------
// 1. The names v16.5 made
// ---------------------------------------------------------------------------------------------------------------
ok(OLD_SCORE_WORDS === 'DNA resonance score over 30 %' && NEW_SCORE_WORDS === 'Experimental tone-set score over 30 %', 'the words');
for (const g of [...SHOWS, 'hidden', 'without']) ok(Array.isArray(fx[g]) && fx[g].length > 0, `the fixture has ${g}`);
ok(fx.cutCopyRare.some((n) => /· DNA resonance score over 3 \d+$/.test(n)) && fx.cutCopyRare.some((n) => /· DNA resonance score over \d+$/.test(n)) && fx.cutCopyRare.some((n) => /… \d+$/.test(n)), 'the fixture holds the rare copy forms');
ok(fx.notLast.some((n) => n.endsWith(' · Aetheria number')) && fx.notLast.some((n) => / \+\d+ more$/.test(n)), 'the fixture holds both tails');
ok(fx.notLastRare.some((n) => / ·…$/.test(n)) && fx.notLastRare.some((n) => / \+ \d+$/.test(n)) && fx.notLastRare.some((n) => / · \d+$/.test(n)) && fx.notLastRare.some((n) => / · A…$/.test(n)), 'and their cut and copy forms');
ok(fx.dupRare.some((n) => / c$/.test(n)) && fx.dupRare.some((n) => / cop \d+$/.test(n) || / co \d+$/.test(n)) && fx.dupRare.some((n) => /… c$/.test(n)) && fx.dup.some((n) => / copy \d+$/.test(n)), "the fixture holds Duplicate's forms");
ok(fx.fromOld.some((n) => (n.match(/· DNA/g) ?? []).length === 2), 'and names with the words twice');
ok(fx.dupRare.some((n) => /(Aetheria number|more)( copy)* (c|co|cop)( \d+)?$/.test(n)), "and a copy word cut after v16.5's next chip");
// Every cut v16.5 made is at its limit: builderName's "…" in UTF-16 units, freeName's and cleanName's in code points.
for (const g of [...CUTS, 'dupRare']) for (const n of fx[g]) {
  const isCut = !n.includes(OLD_SCORE_WORDS) || / (c|co|cop)( \d+)?$/.test(n) || n.includes('…');
  if (!isCut) continue; // "… copy copy": nothing cut
  const byFree = / \d+$/.test(n) || / (c|co|cop)$/.test(n) || !n.includes('…');
  if (byFree) ok(cp(n) >= CUT_POINTS, `${g}: a freeName or cleanName cut is at the limit (${cp(n)} >= ${CUT_POINTS} code points): ${n}`);
  else ok(n.length >= CUT_UNITS, `${g}: builderName's cut is at the limit (${n.length} >= ${CUT_UNITS} units): ${n}`);
}
const seen = new Map<string, string>();
for (const g of SHOWS) {
  for (const n of fx[g]) {
    ok(n.includes('· DNA'), `${g}: the fixture name shows the words: ${n}`);
    const r = renamedOldWords(n);
    ok(!/DNA/.test(r), `${g}: no DNA left: ${n} -> ${r}`);
    ok(cp(r) <= NAME_MAX, `${g}: at most ${NAME_MAX}: ${r} (${cp(r)})`);
    ok(cleanName(r) === r, `${g}: a clean name (parseRecord keeps it as it is): ${r}`);
    eq(renamedOldWords(r), r, `${g}: a second pass changes nothing`);
    const prefix = n.slice(0, n.lastIndexOf('· DNA') + 2);
    const copy = (n.match(/ \d+$/) ?? [''])[0];
    if (copy) ok(r.endsWith(copy), `${g}: the copy's number kept: ${n} -> ${r}`);
    const first = n.slice(0, n.indexOf('· DNA') + 2);
    ok(r.startsWith(first), `${g}: everything before the words kept: ${n} -> ${r}`);
    if (g === 'whole') eq(r, cut80(n.replace(OLD_SCORE_WORDS, NEW_SCORE_WORDS)), `whole: the words replaced, cut as builderName cuts: ${n}`);
    if (g === 'wholeCopy' || g === 'notLast' || g === 'notLastRare' || (g === 'dup' && n.slice(prefix.length).startsWith(OLD_SCORE_WORDS))) {
      // The words replaced, what followed them kept (the next chip, "+N more", a cut, Duplicate's words, a number), fitted.
      const tail = n.slice(prefix.length + OLD_SCORE_WORDS.length, n.length - copy.length);
      eq(r, fit(prefix + NEW_SCORE_WORDS + tail, copy), `${g}: the words replaced, the rest kept: ${n}`);
    }
    if (CUTS.includes(g)) {
      eq(r, fit(prefix + NEW_SCORE_WORDS + '…', copy), `${g}: the new words, still marked as cut: ${n}`);
      ok(r.slice(0, r.length - copy.length).endsWith('…'), `${g}: keeps its "…": ${r}`);
    }
    // Two different old names meet in one new name only when the new one is cut and the cut hides what told them apart
    // ("… over 30 %" and "… over 30 % · A…"); renameOldScoreWords then numbers them apart (section 4).
    const before = seen.get(r);
    ok(before === undefined || before === n || r.slice(0, r.length - copy.length).endsWith('…'), `${g}: one new name per old name: ${before} and ${n} -> ${r}`);
    seen.set(r, n);
  }
}
for (const g of ['hidden', 'without']) for (const n of fx[g]) eq(renamedOldWords(n), n, `${g}: unchanged: ${n}`);
// Hand-picked, as the reviewer reads them.
eq(renamedOldWords('Grounding · DNA resonance score over 30 %'), 'Grounding · Experimental tone-set score over 30 %', 'the common form');
eq(renamedOldWords('Grounding · DNA resonance score over 30 % 2'), 'Grounding · Experimental tone-set score over 30 % 2', 'its copy');
eq(renamedOldWords('Grounding · from Evening · Golden ratio score over 30 % · DNA resonance score over 30 %'.slice(0, 79) + '…'), 'Grounding · from Evening · Golden ratio score over 30 % · Experimental tone-set…', 'a cut one');
eq(renamedOldWords('Flow · 1 per crystal · 111 pattern score over 20 % · DNA resonance score over 3'), 'Flow · 1 per crystal · 111 pattern score over 20 % · Experimental tone-set sc… 3', 'a third copy of a cut one: the 3 is the copy\'s');
eq(renamedOldWords('HEART · from 🌙 Night · 111 pattern score over 20 % · DNA resonance score over… 2'), 'HEART · from 🌙 Night · 111 pattern score over 20 % · Experimental tone-set sc… 2', '"… 2": freeName kept the "…"; code points counted (🌙 is one)');
eq(renamedOldWords('GUT · DNA resonance score over 30 % · Aetheria number'), 'GUT · Experimental tone-set score over 30 % · Aetheria number', 'the words not last: the next chip kept (review round 1)');
eq(renamedOldWords('GUT · DNA resonance score over 30 % +2 more'), 'GUT · Experimental tone-set score over 30 % +2 more', 'the words not last: "+2 more" kept');
eq(renamedOldWords('Layer Ascent · low to high · DNA resonance score over 30 % · Aetheria number'), 'Layer Ascent · low to high · Experimental tone-set score over 30 % · Aetheria n…', 'the next chip cut when the new words need the room');
eq(renamedOldWords('Grounding · DNA resonance score over 30 % copy'), 'Grounding · Experimental tone-set score over 30 % copy', "Duplicate's copy (review round 2)");
eq(renamedOldWords('Grounding · DNA resonance score over 30 % copy 2'), 'Grounding · Experimental tone-set score over 30 % copy 2', 'its second copy');
eq(renamedOldWords('Grounding · DNA resonance score over 30 % copy copy'), 'Grounding · Experimental tone-set score over 30 % copy copy', 'a copy of the copy');
// Review round 3: Duplicate of a numbered one, its marks in any order.
for (const marks of [' 2 copy', ' copy 2 copy', ' 2 copy 2', ' 3 copy copy 2']) eq(renamedOldWords(`Grounding · DNA resonance score over 30 %${marks}`), `Grounding · Experimental tone-set score over 30 %${marks}`, `Duplicate of a numbered one: "${marks}"`);
{
  // ...and cut at 80 by cleanName ("… copy 2 co"); a name that short of the limit (74) keeps its " co" as typed.
  const prefix = 'Grounding · 3 per crystal · Key clear · ';
  const cut = Array.from(`${prefix}${OLD_SCORE_WORDS} copy 2 copy`).slice(0, NAME_MAX).join('').trimEnd();
  ok(cp(cut) === NAME_MAX && / copy 2 co?p?$/.test(cut), `the cut copy (${cut})`);
  const r = renamedOldWords(cut);
  ok(!/DNA/.test(r) && cp(r) <= NAME_MAX && r.startsWith(`${prefix}Experimental`) && r.endsWith('…'), `and cut at 80 by cleanName: ${r}`);
  const short = 'Combined Walk · in library order · DNA resonance score over 30 % copy 2 co';
  eq(renamedOldWords(short), short, 'short of the limit: " co" is a typed word');
}
eq(renamedOldWords('HEART · from Grounding · DNA resonance score over 30 % · DNA resonance score ov…'), 'HEART · from Grounding · Experimental tone-set score over 30 % · Experimental t…', 'the words twice: both renamed (review round 2)');
eq(renamedOldWords('GUT · from Grounding · DNA resonance score over 30 % · Golden ratio score over 30 %'), 'GUT · from Grounding · Experimental tone-set score over 30 % · Golden ratio sco…', 'the words in the "from" part, a chip after them');
{
  // A cut name whose start is mostly emoji (two UTF-16 units each): the new words fit in 80 code points, and the "…"
  // stays, since something was cut (review round 1).
  const emoji = '🌙'.repeat(20) + ' · Key clear · ';
  const n = `${emoji}DNA resonance score over…`;
  ok(n.length === 80 && cp(n) === 60, `the emoji case is a cut at 80 UTF-16 units (${n.length}, ${cp(n)} code points)`);
  eq(renamedOldWords(n), `${emoji}${NEW_SCORE_WORDS}…`, 'keeps its "…" though it fits');
  // Its room under 80 code points lets Duplicate's marks follow the "…" in any order (a copy of "… copy 2").
  for (const marks of [' copy', ' copy 2', ' copy 2 copy', ' 2 copy 3']) {
    const num = (marks.match(/ \d+$/) ?? [''])[0];
    const r = renamedOldWords(`${n}${marks}`);
    eq(r, fit(`${emoji}${NEW_SCORE_WORDS}…${marks.slice(0, marks.length - num.length)}`, num), `and then Duplicate's marks: "${marks}"`);
    ok(!/DNA/.test(r), `no DNA: ${r}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 2. The names v16.6 to v16.10 make (never DNA): unchanged
// ---------------------------------------------------------------------------------------------------------------
{
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const sets = ['preset:qi', 'gut', 'heart', 'head', 'all'];
  let made = 0;
  for (let i = 0; i < 400; i++) {
    const f: Record<string, string[]> = { 'x-dna': ['over'] };
    if (rnd() < 0.5) f['x-golden'] = ['over'];
    if (rnd() < 0.5) f['x-p111'] = ['over'];
    if (rnd() < 0.5) f.length = ['short'];
    if (rnd() < 0.4) f['x-candidate'] = ['over']; // after the score's chip, as in v16.5 (review round 1)
    const s = { ...DEFAULT_SETTINGS, follow: { kind: 'set' as const, set: sets[i % sets.length] as never }, per: ([1, 3, 'all'] as const)[i % 3], filters: f, order: (['pattern', 'low-high', 'shuffle'] as const)[i % 3] };
    const n = builderName(s as never, 'your library');
    if (n.includes('tone-set')) made++;
    eq(renamedOldWords(n), n, `today's name unchanged: ${n}`);
  }
  ok(made > 100, `today's builder names hold the new words (${made})`);
  for (const n of ['Grounding · Experimental resonance score over 30 %', 'Grounding · Experimental tone-set score over 30 %', 'Grounding · Experimental tone-set score over 30 % 2']) eq(renamedOldWords(n), n, `v16.6 / v16.10 words unchanged: ${n}`);
  // A mix built today (or in v16.6 to v16.10) from an old-named playlist: the playlist's name, with the old words, is
  // in its "from …" part; the read renames them there, and today's own words stay (review round 2).
  const sources = [...fx.whole, ...fx.wholeCopy, ...fx.dup].slice(0, 120);
  let fromParts = 0;
  sources.forEach((src, i) => {
    const f: Record<string, string[]> = i % 2 ? { 'x-dna': ['over'] } : { 'x-golden': ['over'] };
    const s = { ...DEFAULT_SETTINGS, source: { kind: 'playlist' as const, id: 'p1' }, follow: { kind: 'set' as const, set: sets[i % sets.length] as never }, filters: f };
    const n = builderName(s as never, src);
    if (!n.includes('· DNA')) return; // the source's words cut away
    fromParts++;
    const r = renamedOldWords(n);
    ok(!/DNA/.test(r), `from an old-named playlist, today: no DNA left: ${n} -> ${r}`);
    ok(cp(r) <= NAME_MAX && cleanName(r) === r && renamedOldWords(r) === r, `and a clean, settled name: ${r}`);
    ok(r.startsWith(n.slice(0, n.indexOf('· DNA') + 2)), `everything before the words kept: ${n} -> ${r}`);
    if (n.includes('tone-set') && !r.includes('tone-set')) ok(false, `today's own words kept: ${n} -> ${r}`);
  });
  ok(fromParts > 60, `the old words in today's "from" parts (${fromParts})`);
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Names the app never made: left alone
// ---------------------------------------------------------------------------------------------------------------
for (const n of [
  'DNA', 'DNA research', 'My DNA mix', 'DNA resonance score over 30 %', 'DNA resonance score over 30 % 2',
  'Mix · DNA', 'Mix · DNA research', 'Mix · DNA resonance', 'Mix·DNA resonance score over 30 %', 'Mix · dna resonance score over 30 %',
  'Mix · DNA resonance score over 30 %!', 'Mix · DNA resonance score over 40 %', 'Mix  DNA resonance score over 30 %', '',
  // Review round 1: a cut start of the words in a name short of the limit was never a cut (v16.5 cut at 80).
  'Gym · DNA 2', 'Mix · DNA…', 'Notes · DNA res…', 'A · DNA r 3', 'Love · DNA 10', 'Mix · DNA resonance score over 3',
  'Grounding · from Mix · DNA', 'Grounding · from Mix · DNA 2', 'Grounding · from Mix · DNA 3',
  // ...and the whole words followed by anything v16.5 never put after them.
  'Gym · DNA resonance score over 30 % workout', 'Gym · DNA resonance score over 30 % · Monday', 'Gym · DNA resonance score over 30 % +x',
  'Gym · DNA resonance score over 30 %, again', 'Gym · DNA resonance score over 30 %… later',
  // Review round 2: a short typed name of emoji is short in code points, whatever its UTF-16 length.
  `${'🌙'.repeat(33)} · DNA 2`, 'Mix · DNA copy', 'Mix · DNA c', 'Mix · DNA resonance s… copy',
  // Review round 3: after "· from " too, only the app's marks; a typed word after the words keeps the name as typed.
  'Songs · from Mom · DNA resonance score over 30 % rocks', 'Songs · from Mom · DNA resonance score over 30 % 2 rocks',
]) eq(renamedOldWords(n), n, `never made by the app, left alone: ${JSON.stringify(n)}`);
// The limits: builderName's "…" cut at 79 UTF-16 units or more, freeName's and cleanName's cuts at 76 code points or
// more (theirs are 78 to 80).
eq([CUT_UNITS, CUT_POINTS], [NAME_MAX - 1, NAME_MAX - 4], 'the limits');
{
  const at = (len: number, end: string) => `${'x'.repeat(len - 2 - end.length)}· ${end}`;
  for (const [limit, end] of [[CUT_UNITS, 'DNA res…'], [CUT_POINTS, 'DNA res 2'], [CUT_POINTS, 'DNA resonance score over 30 % c'], [CUT_UNITS, 'DNA res… c'], [CUT_UNITS, 'DNA res… 2 copy']] as const) {
    // With builderName's "…" the name was its cut (79 units or more) and has only grown since; without one, freeName's or
    // cleanName's (76 code points or more).
    const short = at(limit - 1, end);
    const long = at(limit, end);
    ok(cp(short) === limit - 1 && renamedOldWords(short) === short, `one short of the limit: left alone (${end})`);
    ok(cp(long) === limit && renamedOldWords(long) !== long && !/DNA/.test(renamedOldWords(long)), `at the limit: read as a cut (${end})`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 4. The playlists
// ---------------------------------------------------------------------------------------------------------------
const tracks = [{ id: 't1', name: 'tone-0001', file: { name: 'tone-0001.wav', size: 1001 } }];
const rec = (id: string, name: string, at: number, from?: PlaylistRecord['from']): PlaylistRecord => {
  const p = createPlaylist({ id, name, tracks, now: at, from }) as PlaylistRecord;
  ok(!!p, `fixture record ${id}`);
  return p;
};
const OLD_NAME = 'Grounding · DNA resonance score over 30 %';
const NEW_NAME = 'Grounding · Experimental tone-set score over 30 %';
{
  const plain = [rec('paaaaaaa1', 'Evening', 3000), rec('paaaaaaa2', 'Drive', 2000, { kind: 'queue' })];
  ok(renameOldScoreWords(plain) === plain, 'nothing to rename: the same array back');
  ok(renameOldScoreWords([]).length === 0, 'no playlists');

  const old = rec('paaaaaaa3', OLD_NAME, 1000, { kind: 'builder', label: OLD_NAME });
  const frozen = JSON.stringify(old);
  const out = renameOldScoreWords([...plain, old]);
  const r = out.find((p) => p.id === old.id)!;
  eq([r.name, r.from], [NEW_NAME, { kind: 'builder', label: NEW_NAME }], 'the name and its Saved from line');
  eq([r.key, r.v, r.id, r.createdAt, r.updatedAt, r.entries], [old.key, old.v, old.id, old.createdAt, old.updatedAt, old.entries], 'everything else as stored (updatedAt too)');
  eq(JSON.stringify(old), frozen, 'the record read is not changed (a new one)');
  eq(out.map((p) => p.id), sortLists(out).map((p) => p.id), "in the store's order");
  eq(parseRecord(JSON.parse(JSON.stringify(r))), r, 'parseRecord reads the renamed record back as it is');
  ok(renameOldScoreWords(out) === out, 'a second pass: the same array back');

  const labelOnly = rec('paaaaaaa4', 'My mix', 900, { kind: 'playing', label: OLD_NAME });
  const lo = renameOldScoreWords([labelOnly])[0];
  eq([lo.name, lo.from], ['My mix', { kind: 'playing', label: NEW_NAME }], 'a typed name stays; its Saved from line changes');
  const noLabel = rec('paaaaaaa5', OLD_NAME, 800, { kind: 'builder' });
  eq(renameOldScoreWords([noLabel])[0].from, { kind: 'builder' }, 'a Saved from with no label stays as it is');
  const noFrom = rec('paaaaaaa6', OLD_NAME, 700);
  ok(!('from' in renameOldScoreWords([noFrom])[0]), 'no Saved from: none added');

  // A name another playlist already has (one saved today with the new words, in any case): the next free number.
  const today = rec('paaaaaaa7', NEW_NAME.toUpperCase(), 5000);
  const both = renameOldScoreWords([today, old]);
  eq(both.map((p) => p.name), [NEW_NAME.toUpperCase(), `${NEW_NAME} 2`], 'a taken name gets " 2"');
  const two = renameOldScoreWords([today, old, rec('paaaaaaa8', `${NEW_NAME} 2`, 4000), rec('paaaaaaa9', `${OLD_NAME} 2`, 600)]);
  // The old copy's new name is taken too, so it gets freeName's next number on top, as any copy of "X 2" would ("X 2 2").
  eq(two.map((p) => p.name), [NEW_NAME.toUpperCase(), `${NEW_NAME} 2`, `${NEW_NAME} 3`, `${NEW_NAME} 2 2`], 'every new name kept apart');
  // A renamed playlist doesn't hold its own old name against itself.
  eq(renameOldScoreWords([old])[0].name, NEW_NAME, 'its own old name is not taken');
  // The tail kept on a record too.
  const notLast = rec('paaaaaab1', 'GUT · DNA resonance score over 30 % · Aetheria number', 650, { kind: 'builder', label: 'GUT · DNA resonance score over 30 % · Aetheria number' });
  eq([renameOldScoreWords([notLast])[0].name, renameOldScoreWords([notLast])[0].from?.label], ['GUT · Experimental tone-set score over 30 % · Aetheria number', 'GUT · Experimental tone-set score over 30 % · Aetheria number'], 'the words not last, on a record');
  // Two old names that the new words' cut makes one (v16.5's own pair from the fixture): numbered apart.
  const pairA = 'Stillness · 3 per crystal · in library order · DNA resonance score over 30 %';
  const pairB = 'Stillness · 3 per crystal · in library order · DNA resonance score over 30 % ·…';
  eq(renamedOldWords(pairA), renamedOldWords(pairB), 'the pair meets in one new name');
  const met = renameOldScoreWords([rec('paaaaaab2', pairA, 640), rec('paaaaaab3', pairB, 630)]);
  eq(met.map((p) => p.name), [renamedOldWords(pairA), `${headOfName(renamedOldWords(pairA), NAME_MAX - 2).trimEnd()} 2`], 'and is numbered apart, as freeName would');
}

// freeNames gives what freeName gives, name after name, against the names taken so far (seeded runs with clashes, case,
// long names that need cutting, and emoji).
{
  let seed = 99;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const bases = ['Evening', 'evening', 'EVENING 2', 'Evening 2', `${'Long name '.repeat(9)}end`, `🌙 ${'night '.repeat(14)}`, 'Grounding · Experimental tone-set score over 30 %'];
  for (let run = 0; run < 60; run++) {
    const start = Array.from({ length: Math.floor(rnd() * 6) }, () => bases[Math.floor(rnd() * bases.length)]);
    const free = freeNames(start);
    const taken = [...start];
    for (let i = 0; i < 25; i++) {
      const b = bases[Math.floor(rnd() * bases.length)];
      const want = freeName(b, taken);
      const got = free(b);
      if (got !== want) { eq(got, want, `freeNames run ${run} step ${i} (${b})`); break; }
      taken.push(got);
    }
    pass++;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Cost: 500 playlists (PLAYLISTS_MAX) of 80-character names, every one renamed
// ---------------------------------------------------------------------------------------------------------------
{
  const many = Array.from({ length: 500 }, (_, i) => rec(`pz${String(i).padStart(7, '0')}`, cut80(`Mix ${i} · from a long playlist name · Golden ratio score over 30 % · ${OLD_SCORE_WORDS}`), 10_000 + i, { kind: 'builder', label: cut80(`Mix ${i} · ${OLD_SCORE_WORDS}`) }));
  const t0 = performance.now();
  const out = renameOldScoreWords(many);
  const ms = performance.now() - t0;
  ok(out.every((p) => !/DNA/.test(p.name) && !/DNA/.test(p.from?.label ?? '')), '500: no DNA left');
  ok(new Set(out.map((p) => p.name.toLowerCase())).size === 500, '500: every name its own');
  ok(ms < 100, `500 playlists in ${ms.toFixed(1)} ms (under 100; about 27 on the PC)`);
}
{
  // Review round 1: 500 playlists all typed with one old name (the name dialog lets names repeat): every one clashes,
  // and freeNames carries each name's count on, so this stays O(n) too (freeName per clash took 238 ms).
  const same = Array.from({ length: 500 }, (_, i) => rec(`py${String(i).padStart(7, '0')}`, OLD_NAME, 20_000 + i));
  const t0 = performance.now();
  const out = renameOldScoreWords(same);
  const ms = performance.now() - t0;
  ok(new Set(out.map((p) => p.name.toLowerCase())).size === 500, '500 clashing: every name its own');
  eq(out.map((p) => p.name).sort().slice(0, 3), [NEW_NAME, `${NEW_NAME} 10`, `${NEW_NAME} 100`], '500 clashing: numbered from 2 (a string sort)');
  ok(out.some((p) => p.name === `${NEW_NAME} 500`) && !out.some((p) => p.name === `${NEW_NAME} 501`), '500 clashing: 2 to 500');
  ok(ms < 100, `500 clashing playlists in ${ms.toFixed(1)} ms (under 100)`);
}

console.log(`oldNames: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
