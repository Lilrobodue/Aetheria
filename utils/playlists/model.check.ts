// utils/playlists/model.check.ts (v16.1): the checks for model.ts (the spec's 24,820; 22 of 22 mutants caught).
//   node utils/playlists/model.check.ts   (npm run check:playlists; Node 22.18+ strips the types)
//   (A mutation runner copies this file beside a mutant named model.ts: the import is static, as check:writers asks.)
// Sections: 1 keys/ids/names, 2 validation on read (malformed and hostile records), 3 fingerprints and resolution
// (by id, by fingerprint, ambiguity, missing), 4 edits (immutability, order, duplicates, caps, relink on edit),
// 5 counts and the playing playlist, 6 Undo's rule, 7 random sequences (moves and removes keep the multiset and the
// order of the rest), 8 cost (1,000-entry playlist; 50 playlists of 1,000 against a 5,000-track library).

import * as Model from './model.ts';
// Untyped, as the prototype's checks were written: they feed the model hostile and partial shapes on purpose.
const M: any = Model;
const {
  RECORD_VERSION, KEY_PREFIX, NAME_MAX, ENTRIES_MAX, PLAYLISTS_MAX,
  keyOf, isPlaylistId, isPlaylistKey, newPlaylistId, cleanName, freeName, fpKey, entryOf, parseRecord, parseAll,
  indexLibrary, resolveEntry, resolvePlaylist, presentTracks, summaries, playlistsWith, playlistPlaying,
  createPlaylist, renamePlaylist, duplicatePlaylist, addTracks, removeAt, moveEntry, missingIndices, undoApplies, relinked,
} = M;

let pass = 0, fail = 0;
const ok = (c: boolean, msg: string) => { if (c) pass++; else { fail++; if (fail <= 40) console.log('FAIL', msg); } };
const eq = (a: unknown, b: unknown, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

type T = { id: string; name: string; file: { name: string; size: number }; duration?: number };
const tr = (n: number, o: Partial<T> = {}): T => ({ id: `t${n}`, name: `tone-${String(n).padStart(4, '0')}`, file: { name: `tone-${String(n).padStart(4, '0')}.wav`, size: 1000 + n }, duration: 60 + n, ...o });
const lib = (k: number) => Array.from({ length: k }, (_, i) => tr(i + 1));
let seed = 11;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ID = 'pabc12345';
const mk = (tracks: T[], o: Record<string, unknown> = {}) => createPlaylist({ id: ID, name: 'Evening', tracks, now: 1000, ...o });

// ---------------------------------------------------------------------------------------------------------------
// 1. Keys, ids, names
// ---------------------------------------------------------------------------------------------------------------
ok(KEY_PREFIX === 'pl:' && RECORD_VERSION === 1, 'constants');
ok(keyOf(ID) === 'pl:' + ID, 'keyOf');
ok(isPlaylistKey('pl:' + ID) && !isPlaylistKey('current') && !isPlaylistKey('pl:') && !isPlaylistKey('pl:__proto__') && !isPlaylistKey('pl;' + ID) && !isPlaylistKey(42), 'isPlaylistKey');
ok(isPlaylistId(ID) && !isPlaylistId('__proto__') && !isPlaylistId('constructor') && !isPlaylistId('pA1') && !isPlaylistId('p' + 'a'.repeat(40)), 'isPlaylistId');
{
  const ids = new Set<string>();
  for (let i = 0; i < 2000; i++) { const id = newPlaylistId(1_761_600_000_000 + i, rnd); ok(isPlaylistId(id), 'new id valid ' + id); ids.add(id); }
  ok(ids.size === 2000, 'new ids unique');
}
eq(cleanName('  Evening\u0007  walk\n'), 'Evening walk', 'cleanName: control chars and runs of spaces');
ok(cleanName('   ') === null && cleanName('') === null && cleanName(5) === null && cleanName(null) === null, 'cleanName: empty and non-strings');
ok(cleanName('x'.repeat(200))!.length === NAME_MAX, 'cleanName: capped at NAME_MAX');
ok(Array.from(cleanName('🎵'.repeat(100))!).length === NAME_MAX, 'cleanName: caps by characters, never splits a pair');
eq(freeName('New playlist', []), 'New playlist', 'freeName free');
eq(freeName('New playlist', ['new playlist', 'New playlist 2']), 'New playlist 3', 'freeName taken (case-insensitive)');

// ---------------------------------------------------------------------------------------------------------------
// 2. Validation on read
// ---------------------------------------------------------------------------------------------------------------
const good = () => ({ key: 'pl:' + ID, v: 1, id: ID, name: 'Evening', createdAt: 1, updatedAt: 2, entries: [{ id: 't1', name: 'tone-0001', file: 'tone-0001.wav', size: 1001 }] });
ok(parseRecord(good()) !== null, 'a good record parses');
eq(parseRecord(good()), good(), 'a good record parses to itself');
const bad: Array<[string, (r: any) => any]> = [
  ['null', () => null], ['array', () => []], ['string', () => 'pl:x'], ['v 2', (r) => ({ ...r, v: 2 })], ['no v', (r) => { delete r.v; return r; }],
  ['key mismatch', (r) => ({ ...r, key: 'pl:pzzzzzzz' })], ['key current', (r) => ({ ...r, key: 'current' })], ['bad id', (r) => ({ ...r, id: '__proto__', key: 'pl:__proto__' })],
  ['name empty', (r) => ({ ...r, name: '   ' })], ['name number', (r) => ({ ...r, name: 7 })], ['name huge', (r) => ({ ...r, name: 'x'.repeat(5000) })],
  ['createdAt NaN', (r) => ({ ...r, createdAt: NaN })], ['updatedAt negative', (r) => ({ ...r, updatedAt: -1 })], ['entries object', (r) => ({ ...r, entries: {} })],
  ['entries too many', (r) => ({ ...r, entries: Array.from({ length: ENTRIES_MAX + 1 }, () => r.entries[0]) })],
  ['entry null', (r) => ({ ...r, entries: [null] })], ['entry id empty', (r) => ({ ...r, entries: [{ ...r.entries[0], id: '' }] })],
  ['entry id control', (r) => ({ ...r, entries: [{ ...r.entries[0], id: 'a\u0000b' }] })], ['entry id long', (r) => ({ ...r, entries: [{ ...r.entries[0], id: 'x'.repeat(200) }] })],
  ['entry size float', (r) => ({ ...r, entries: [{ ...r.entries[0], size: 1.5 }] })], ['entry size negative', (r) => ({ ...r, entries: [{ ...r.entries[0], size: -1 }] })],
  ['entry size string', (r) => ({ ...r, entries: [{ ...r.entries[0], size: '1001' }] })], ['entry file empty', (r) => ({ ...r, entries: [{ ...r.entries[0], file: '' }] })],
  ['from bad kind', (r) => ({ ...r, from: { kind: 'hack' } })], ['from null', (r) => ({ ...r, from: null })], ['from empty label', (r) => ({ ...r, from: { kind: 'queue', label: ' ' } })],
];
for (const [what, f] of bad) ok(parseRecord(f(good())) === null, 'rejects: ' + what);
{
  const r: any = good();
  r.entries[0].extra = 'x';
  const p = parseRecord(r);
  ok(!!p && !('extra' in p.entries[0]), 'unknown entry fields are dropped (never reach state)');
  const proto = JSON.parse('{"key":"pl:' + ID + '","v":1,"id":"' + ID + '","name":"x","createdAt":1,"updatedAt":1,"entries":[],"__proto__":{"polluted":1}}');
  const q = parseRecord(proto);
  ok(!!q && ({} as any).polluted === undefined && !Object.prototype.hasOwnProperty.call(q, '__proto__'), 'a __proto__ key pollutes nothing');
}
{
  const a = good();
  const b = { ...good(), updatedAt: 9, id: 'pbbbbbbbb', key: 'pl:pbbbbbbbb', name: 'Morning' };
  const { lists, unreadable } = parseAll([a, null, b, { ...a }, { v: 7 }]);
  eq(lists.map((l: any) => l.id), ['pbbbbbbbb', ID], 'parseAll: newest change first');
  ok(unreadable === 3, 'parseAll: a null, a duplicate id and a future version are unreadable (3)');
  const many = Array.from({ length: PLAYLISTS_MAX + 5 }, (_, i) => ({ ...good(), id: `p${String(i).padStart(8, '0')}`, key: `pl:p${String(i).padStart(8, '0')}` }));
  ok(parseAll(many).lists.length === PLAYLISTS_MAX, 'parseAll: capped at PLAYLISTS_MAX');
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Fingerprints and resolution
// ---------------------------------------------------------------------------------------------------------------
ok(fpKey('tone.wav', 7) === 'tone.wav|7' && fpKey('a|b', 12) !== fpKey('a', 12) && fpKey('1:x', 2) !== fpKey('x', 21) && fpKey('a1', 2) !== fpKey('a', 12) && fpKey('a:1', 2) !== fpKey('a', 1), 'fpKey: no two pairs collide (name|size, the size last)');
eq(entryOf(tr(3)), { id: 't3', name: 'tone-0003', file: 'tone-0003.wav', size: 1003 }, 'entryOf');
{
  const L = lib(5);
  const pl = mk([L[0], L[1], L[2]])!;
  const idx = indexLibrary(L);
  ok(resolveEntry(pl.entries[1], idx) === L[1], 'resolves by id');
  // t2 deleted; re-imported as t9 (same file, new id)
  const L2 = [L[0], L[2], L[3], L[4], tr(2, { id: 't9' })];
  const idx2 = indexLibrary(L2);
  ok(resolveEntry(pl.entries[1], idx2)?.id === 't9', 'relinks a re-import by name + size');
  // imported twice: the first copy in library order, every time
  const L3 = [L[0], tr(2, { id: 't9' }), L[2], tr(2, { id: 't8' })];
  ok(resolveEntry(pl.entries[1], indexLibrary(L3))?.id === 't9', 'ambiguous fingerprint: the first copy in library order');
  ok(resolveEntry(pl.entries[1], indexLibrary([...L3].reverse()))?.id === 't8', '… which follows the library order');
  // the original comes back (Recover keeps the id): it wins over a copy
  ok(resolveEntry(pl.entries[1], indexLibrary([tr(2, { id: 't9' }), L[1]]))?.id === 't2', 'its own id wins over a fingerprint twin');
  // different size, or renamed: missing
  ok(resolveEntry(pl.entries[1], indexLibrary([tr(2, { id: 't9', file: { name: 'tone-0002.wav', size: 5 } })])) === null, 'same name, other size: missing');
  ok(resolveEntry(pl.entries[1], indexLibrary([tr(2, { id: 't9', file: { name: 'renamed.wav', size: 1002 } })])) === null, 'renamed file: missing');
  // after a Clear: everything missing
  const r = resolvePlaylist(pl, indexLibrary([]));
  ok(r.present === 0 && r.missing === 3 && r.rows.every((x: any) => x.track === null), 'an empty library: every entry missing');
  const r2 = resolvePlaylist(pl, idx);
  ok(r2.present === 3 && r2.seconds === 61 + 62 + 63, 'present count and seconds');
}
{
  const L = lib(3);
  const pl = mk([L[0], L[1], L[0], L[0]])!;
  const r = resolvePlaylist(pl, indexLibrary(L));
  eq(r.rows.map((x: any) => x.key), ['t1#1', 't2#1', 't1#2', 't1#3'], 'row keys: occurrence-numbered (duplicates allowed)');
  eq(presentTracks(pl, indexLibrary([L[1]])).map((t: T) => t.id), ['t2'], 'presentTracks leaves missing out');
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Edits
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(6);
  const pl = mk([L[0], L[1], L[2]])!;
  const frozen = JSON.stringify(pl);
  ok(pl.key === 'pl:' + ID && pl.v === 1 && pl.createdAt === 1000 && pl.updatedAt === 1000, 'create');
  ok(createPlaylist({ id: 'bad', name: 'x', tracks: [], now: 1 }) === null && createPlaylist({ id: ID, name: '  ', tracks: [], now: 1 }) === null, 'create refuses a bad id or an empty name');
  ok(mk(lib(1), { from: { kind: 'queue', label: '  ' } })!.from!.label === undefined, 'create drops an empty from-label');
  const a = addTracks(pl, [L[3], L[0]], 2000)!;
  eq(a.entries.map((e: any) => e.id), ['t1', 't2', 't3', 't4', 't1'], 'add appends (duplicates allowed)');
  ok(a.updatedAt === 2000 && a.createdAt === 1000, 'add bumps updatedAt only');
  ok(addTracks(pl, [], 3000) === pl, 'adding nothing returns the same record');
  ok(addTracks({ ...pl, entries: Array.from({ length: ENTRIES_MAX }, () => pl.entries[0]) }, [L[0]], 1) === null, 'add refuses past ENTRIES_MAX');
  const m = moveEntry(a, 4, 0, 2100);
  eq(m.entries.map((e: any) => e.id), ['t1', 't1', 't2', 't3', 't4'], 'move to the top');
  eq(moveEntry(a, 0, 99, 2100).entries.map((e: any) => e.id), ['t2', 't3', 't4', 't1', 't1'], 'move past the end clamps');
  ok(moveEntry(a, 2, 2, 2100) === a && moveEntry(a, -1, 0, 1) === a && moveEntry(a, 9, 0, 1) === a, 'a no-op move returns the same record');
  eq(removeAt(a, [1, 4, 99, -1], 2200).entries.map((e: any) => e.id), ['t1', 't3', 't4'], 'remove by index, ignoring bad ones');
  ok(removeAt(a, [], 1) === a, 'removing nothing returns the same record');
  const rn = renamePlaylist(a, '  Late  night ', 2300)!;
  ok(rn.name === 'Late night' && rn.updatedAt === 2300 && rn.createdAt === a.createdAt && rn.entries === a.entries, 'rename keeps the entries and createdAt');
  ok(renamePlaylist(a, ' ', 1) === null && renamePlaylist(a, a.name, 1) === a, 'rename: empty refused, same name a no-op');
  const d = duplicatePlaylist(a, { id: 'pcopy0001', name: 'Evening copy', now: 2400 })!;
  ok(d.id === 'pcopy0001' && d.key === 'pl:pcopy0001' && d.from!.kind === 'duplicate' && d.from!.label === 'Evening' && d.entries !== a.entries, 'duplicate: new id, own entries');
  eq(d.entries, a.entries, 'duplicate: same entries');
  ok(duplicatePlaylist(a, { id: a.id, name: 'x', now: 1 }) === null, 'duplicate refuses the same id');
  ok(JSON.stringify(pl) === frozen, 'no edit mutated its input');
  // missing and relink on edit
  const L2 = [L[0], L[2], tr(2, { id: 't9' })]; // t2 re-imported as t9; t4 gone
  const idx2 = indexLibrary(L2);
  eq(missingIndices(a, idx2), [3], 'missingIndices');
  eq(relinked(a.entries, idx2).map((e: any) => e.id), ['t1', 't9', 't3', 't4', 't1'], 'relinked: a fingerprint match takes the new id; missing stays');
  const e2 = moveEntry(a, 0, 1, 2500, idx2);
  eq(e2.entries.map((e: any) => e.id), ['t9', 't1', 't3', 't4', 't1'], 'an edit stores the relinked ids');
  eq(removeAt(a, missingIndices(a, idx2), 2600, idx2).entries.map((e: any) => e.id), ['t1', 't9', 't3', 't1'], 'Remove missing');
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Counts and the playing playlist
// ---------------------------------------------------------------------------------------------------------------
{
  const L = lib(8);
  const idx = indexLibrary(L);
  const p1 = createPlaylist({ id: 'p11111111', name: 'One', tracks: [L[0], L[1]], now: 5 })!;
  const p2 = createPlaylist({ id: 'p22222222', name: 'Two', tracks: [L[1], L[1], L[2]], now: 6 })!;
  const p3 = createPlaylist({ id: 'p33333333', name: 'Three', tracks: [L[0], L[1]], now: 7 })!; // same as One
  const lists = [p3, p2, p1];
  eq(playlistsWith('t2', lists, idx), ['p33333333', 'p22222222', 'p11111111'], 'playlistsWith: each playlist once (Two holds t2 twice), in list order');
  ok(playlistsWith('t1', lists, idx).length === 2 && playlistsWith('t8', lists, idx).length === 0, 'playlistsWith counts playlists, not entries');
  const idxRe = indexLibrary([tr(2, { id: 't9' }), L[0], L[2]]);
  ok(playlistsWith('t9', lists, idxRe).length === 3, 'playlistsWith counts a relinked copy');
  eq(summaries(lists, idx).map((s: any) => [s.id, s.count, s.present, s.missing]), [['p33333333', 2, 2, 0], ['p22222222', 3, 3, 0], ['p11111111', 2, 2, 0]], 'summaries');
  ok(playlistPlaying(['t1', 't2'], lists, idx) === 'p33333333', 'playing: a tie goes to the newest');
  ok(playlistPlaying(['t1', 't2'], lists, idx, 'p11111111') === 'p11111111', 'playing: the one started last wins a tie');
  ok(playlistPlaying(['t2', 't1'], lists, idx) === null && playlistPlaying([], lists, idx) === null && playlistPlaying(['t1'], lists, idx) === null, 'playing: order and length must match');
  ok(playlistPlaying(['t2', 't3'], lists, indexLibrary([L[1], L[2]])) === null, 'playing: present tracks only (Two has t2 twice)');
  const p4 = createPlaylist({ id: 'p44444444', name: 'Four', tracks: [L[0], L[5], L[1]], now: 8 })!;
  ok(playlistPlaying(['t1', 't2'], [p4], indexLibrary([L[0], L[1]])) === 'p44444444', 'playing: a missing entry is skipped, as Play skips it');
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Undo's rule
// ---------------------------------------------------------------------------------------------------------------
{
  const pl = mk(lib(2))!;
  const after = addTracks(pl, [tr(3)], 2)!;
  ok(undoApplies(after, after) && !undoApplies(addTracks(after, [tr(4)], 3), after) && !undoApplies(null, after) && undoApplies(null, null), 'Undo applies only over the record the op made (or over nothing, for a delete)');
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Random sequences: moves and removes keep the rest in order
// ---------------------------------------------------------------------------------------------------------------
for (let run = 0; run < 300; run++) {
  const L = lib(12);
  let pl = mk(Array.from({ length: 5 + Math.floor(rnd() * 20) }, () => L[Math.floor(rnd() * L.length)]))!;
  for (let step = 0; step < 25; step++) {
    const n = pl.entries.length;
    const before = pl.entries.map((e: any) => e.id);
    const k = rnd();
    if (k < 0.5 && n > 0) {
      const from = Math.floor(rnd() * n), to = Math.floor(rnd() * n);
      const after = moveEntry(pl, from, to, step).entries.map((e: any) => e.id);
      ok(after.length === n && [...after].sort().join() === [...before].sort().join(), 'move keeps the multiset');
      ok(after[to] === before[from], 'the moved entry lands at `to`');
      const restB = before.filter((_: any, i: number) => i !== from), restA = after.filter((_: any, i: number) => i !== to);
      ok(restA.join() === restB.join(), 'the others keep their order');
      pl = moveEntry(pl, from, to, step);
    } else if (k < 0.75 && n > 1) {
      const i = Math.floor(rnd() * n);
      const after = removeAt(pl, [i], step).entries.map((e: any) => e.id);
      ok(after.join() === before.filter((_: any, j: number) => j !== i).join(), 'remove drops exactly that entry');
      pl = removeAt(pl, [i], step);
    } else {
      const t = L[Math.floor(rnd() * L.length)];
      pl = addTracks(pl, [t], step)!;
      ok(pl.entries.length === n + 1 && pl.entries[n].id === t.id, 'add appends');
    }
    ok(parseRecord(JSON.parse(JSON.stringify(pl))) !== null, 'every edit stays a valid record');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 8. Cost
// ---------------------------------------------------------------------------------------------------------------
{
  const time = (f: () => void, reps: number) => { const t0 = performance.now(); for (let i = 0; i < reps; i++) f(); return (performance.now() - t0) / reps; };
  const L = lib(5000);
  const idx = indexLibrary(L);
  const big = mk(Array.from({ length: 1000 }, (_, i) => L[(i * 7) % 5000]))!;
  const fifty = Array.from({ length: 50 }, (_, j) => createPlaylist({ id: `p${String(j).padStart(8, '0')}`, name: 'P' + j, tracks: Array.from({ length: 1000 }, (_, i) => L[(i * 13 + j) % 5000]), now: j })!);
  const half = indexLibrary(L.slice(0, 2500)); // half the entries missing: the fingerprint path runs too
  const c = {
    index5000: time(() => indexLibrary(L), 20),
    resolve1000: time(() => resolvePlaylist(big, idx), 50),
    resolve1000HalfMissing: time(() => resolvePlaylist(big, half), 50),
    move1000: time(() => moveEntry(big, 999, 0, 1), 200),
    remove1000: time(() => removeAt(big, [500], 1), 200),
    add1000: time(() => addTracks(big, [L[1]], 1), 200),
    parse1000: time(() => parseRecord(big), 50),
    summaries50x1000: time(() => summaries(fifty, idx), 10),
    playlistsWith50x1000: time(() => playlistsWith('t4999', fifty, idx), 10),
    playing50x1000: time(() => playlistPlaying(presentTracks(fifty[7], idx).map((t: T) => t.id), fifty, idx), 10),
    recordJsonBytes1000: JSON.stringify(big).length,
  };
  console.log('cost (ms per call; bytes):', JSON.stringify(c, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)));
  ok(c.resolve1000 < 5 && c.summaries50x1000 < 50 && c.move1000 < 2, 'cost bounds (generous: Node on the desktop)');
}

console.log(`model.check: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
