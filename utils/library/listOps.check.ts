// Checks for utils/library/listOps.ts.
// Run with: node utils/library/listOps.check.ts   (Node 22.18+ strips the types)
// Exits non-zero on any failure.

import {
  dedupeById,
  sameIdOrder,
  patchById,
  removeIdsWithCursor,
  appendToLibrary,
  splitOrphans,
  refreshById,
} from './listOps.ts';

type T = { id: string; tag?: string; n?: number };

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}
const ids = (l: readonly T[]) => l.map((s) => s.id).join(',');
const mk = (...xs: string[]): T[] => xs.map((id) => ({ id }));

// dedupeById
check(ids(dedupeById(mk('a', 'b', 'a', 'c', 'b'))) === 'a,b,c', 'dedupe keeps first occurrences in order');
check(dedupeById(mk()).length === 0, 'dedupe of empty');

// sameIdOrder
check(sameIdOrder(mk('a', 'b'), mk('a', 'b')), 'same order');
check(!sameIdOrder(mk('a', 'b'), mk('b', 'a')), 'different order');
check(!sameIdOrder(mk('a', 'b'), mk('a', 'b', 'c')), 'different length');

// patchById: identity, duplicates, untouched entries
{
  const list = mk('a', 'b', 'a', 'c');
  const patched = patchById(list, new Map([['a', { tag: 'x' }]]));
  check(patched !== list, 'patch returns a new array when something matched');
  check(patched[0].tag === 'x' && patched[2].tag === 'x', 'patch applies to every occurrence (walk duplicates)');
  check(patched[1] === list[1] && patched[3] === list[3], 'unpatched entries keep their identity');
  check(list[0].tag === undefined, 'patch does not mutate the input');
  const none = patchById(list, new Map([['z', { tag: 'y' }]]));
  check(none === list, 'patch with no matching id returns the same array (setState no-op)');
  check(patchById(list, new Map()) === list, 'empty patch map returns the same array');
}

// removeIdsWithCursor
{
  // cursor on 'c' (index 3); two 'a' entries before it are removed
  const r = removeIdsWithCursor(mk('a', 'b', 'a', 'c', 'a'), new Set(['a']), 3);
  check(ids(r.list) === 'b,c', 'removal drops every occurrence');
  check(r.cursor === 1 && !r.removedCurrent, 'cursor drops by the number removed before it (duplicates)');
}
{
  const r = removeIdsWithCursor(mk('a', 'b', 'c'), new Set(['z']), 2);
  check(r.cursor === 2 && !r.removedCurrent && ids(r.list) === 'a,b,c',
    'a track that is not in the play order leaves the cursor alone (old code decremented it)');
}
{
  const r = removeIdsWithCursor(mk('a', 'b', 'c'), new Set(['b']), 1);
  check(r.removedCurrent && r.cursor === -1, 'removing the current entry reports it and clears the cursor');
}
{
  const r = removeIdsWithCursor(mk('a', 'b', 'c'), new Set(['c']), 0);
  check(r.cursor === 0 && !r.removedCurrent, 'removal after the cursor leaves it alone');
}
{
  const r = removeIdsWithCursor(mk('a', 'b'), new Set(['a']), -1);
  check(r.cursor === -1 && !r.removedCurrent, 'no cursor stays no cursor');
}

// appendToLibrary
{
  const lib = mk('a', 'b');
  const out = appendToLibrary(lib, mk('c', 'a'));
  check(ids(out) === 'a,b,c', 'append adds only new ids, after the existing library');
  check(appendToLibrary(lib, mk('a')) === lib, 'append of known ids returns the same array');
  check(appendToLibrary(lib, []) === lib, 'append of nothing returns the same array');
}

// splitOrphans
{
  type F = { id: string; file: { name: string; size: number } };
  const f = (id: string, name: string, size = 100): F => ({ id, file: { name, size } });
  const library = [f('a', 'one.mp3'), f('b', 'two.mp3')];
  const orphans = [
    f('x', 'three.mp3'), // not in the library: offered
    f('y', 'one.mp3'), // a copy of library track a
    f('z', 'one.mp3', 999), // same name, different size: offered
    f('w', 'three.mp3'), // a copy of orphan x
    f('a', 'one.mp3'), // the library holds this id now: neither
  ];
  const split = splitOrphans(orphans, library);
  const fIds = (l: F[]) => l.map((s) => s.id).join(',');
  check(fIds(split.fresh) === 'x,z', 'orphans the library lacks are offered (name AND size must match to be a copy)');
  check(fIds(split.duplicates) === 'y,w', 'copies of library tracks and of earlier orphans are copies');
  check(split.unconfirmed.length === 0, 'without stored ids every library twin counts as stored');
  // An import after launch turns an offered orphan into a copy.
  const reimported = [...library, f('n', 'three.mp3')];
  const later = splitOrphans(orphans, reimported);
  check(fIds(later.fresh) === 'z' && fIds(later.duplicates) === 'x,y,w',
    'splitting against the current library catches a re-import made after launch');
  // ...but only a STORED re-import makes the orphan removable. The re-import
  // 'n' is not stored (its save failed): x is the only stored copy, kept; w,
  // a copy of x, is still removable.
  const unsaved = splitOrphans(orphans, reimported, new Set(['a', 'b']));
  check(fIds(unsaved.unconfirmed) === 'x' && fIds(unsaved.duplicates) === 'y,w' && fIds(unsaved.fresh) === 'z',
    'an orphan whose library twin is not stored is kept, not removed');
  const saved = splitOrphans(orphans, reimported, new Set(['a', 'b', 'n']));
  check(fIds(saved.duplicates) === 'x,y,w' && saved.unconfirmed.length === 0,
    'once the twin is stored the orphan is a removable copy');
  const unknown = splitOrphans(orphans, reimported, new Set());
  check(fIds(unknown.duplicates) === 'w' && fIds(unknown.unconfirmed) === 'x,y',
    'when nothing is known to be stored, no copy of a library track is removable');
}

// How the app applies a scan's results while a mix is showing: the same patch
// map goes to the library and to the play order, and each list gets the
// results for the tracks it holds. (The regression test for the v14.4 library
// loss itself is e2e/tests/smoke.spec.ts, which fails on v14.4's App.tsx.)
{
  const library: T[] = mk('a', 'b', 'c', 'd', 'e');
  const mix: T[] = [library[1], library[3], library[1]];
  const results = new Map<string, Partial<T>>([['b', { n: 1 }], ['d', { n: 2 }]]);
  const lib2 = patchById(library, results);
  const mix2 = patchById(mix, results);
  check(lib2[1].n === 1 && lib2[3].n === 2 && lib2[0] === library[0], 'library gets the results for its tracks only');
  check(mix2[0].n === 1 && mix2[1].n === 2 && mix2[2].n === 1, 'the mix gets them too, repeats included');
}

// refreshById (v15.7): the play order takes the library's own objects, by id; nothing else changes.
{
  const lib: T[] = [{ id: 'a', n: 2 }, { id: 'b', n: 2 }, { id: 'c', n: 2 }];
  const stale: T[] = [{ id: 'c', n: 1 }, lib[0], { id: 'c', n: 1 }, { id: 'x', n: 1 }];
  const r = refreshById(stale, lib);
  check(ids(r) === 'c,a,c,x' && r.length === 4, 'refreshById keeps the ids, the order and the length');
  check(r[0] === lib[2] && r[2] === lib[2] && r[1] === lib[0], "stale entries (repeats too) become the library's objects");
  check(r[3] === stale[3], 'an entry the library lacks stays');
  check(stale[0].n === 1, 'the input is not mutated');
  const fresh = [lib[1], lib[0]];
  check(refreshById(fresh, lib) === fresh, 'nothing stale: the same array');
  check(refreshById([], lib).length === 0 && refreshById(stale, []) === stale, 'empty lists');
  const dupLib: T[] = [{ id: 'a', n: 5 }, { id: 'a', n: 6 }];
  check(refreshById([{ id: 'a' }], dupLib)[0] === dupLib[0], 'a library repeat: its first entry');
}

console.log(`listOps: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
