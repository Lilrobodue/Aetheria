// Checks for utils/library/walkRecord.ts (v15.9: walks survive a reload).
// Run with: node utils/library/walkRecord.check.ts   (Node 22.18+ strips the types). Exits non-zero on any failure.

import { restoredWalk, walkToSave } from './walkRecord.ts';
import { LO_SHU_WALKS } from '../../constants.ts';

let passed = 0;
const failures: string[] = [];
const check = (ok: boolean, what: string) => { if (ok) passed++; else failures.push(what); };

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
const five = ids(5);
const ascent = { mode: 'A', segments: null, phases: null, steps: [0, 1, 3, 4, 9] };
const cab = { mode: 'combined', segments: [2, 2, 1], phases: null, steps: [0, 5, 27, 40, 60] };
const ouro = { mode: 'ouroboros', segments: [5], phases: ['♾️', '', '', '', ''], steps: [0, 1, 2, 3, 4] };

// Valid walks come back as copies.
const a = restoredWalk(ascent, five, five);
check(!!a && a.mode === 'A' && JSON.stringify(a.steps) === '[0,1,3,4,9]' && a.segments === null && a.phases === null, 'Ascent restores');
check(!!a && a.steps !== ascent.steps, 'a copy, not the stored array');
check(JSON.stringify(restoredWalk(cab, five, five)) === JSON.stringify(cab), 'CAB restores with its segments');
check(JSON.stringify(restoredWalk(ouro, five, five)) === JSON.stringify(ouro), 'Ouroboros restores with its phases');
check(JSON.stringify(restoredWalk({ mode: 'traditional', segments: null, phases: null, steps: null }, five, five)) === JSON.stringify({ mode: 'traditional', segments: null, phases: null, steps: null }), 'a walk without steps (an older one) restores; the cube then uses the cursor');

// Not a walk / no record.
for (const raw of [null, undefined, 0, 'A', [], { mode: 'Z' }, { mode: 'toString' }, { mode: 7 }]) check(restoredWalk(raw, five, five) === null, `junk ${JSON.stringify(raw)} → null`);

// The play order must be exactly the saved one.
check(restoredWalk(ascent, five, five.slice(0, 4)) === null, 'a track whose audio is gone ends the walk');
check(restoredWalk(ascent, five, ['t0', 't1', 't2', 't4', 't3']) === null, 'another order ends the walk');
check(restoredWalk(ascent, [], []) === null, 'an empty order has no walk');

// Steps.
check(restoredWalk({ ...ascent, steps: [0, 1, 3, 4] }, five, five) === null, 'steps shorter than the order');
check(restoredWalk({ ...ascent, steps: [0, 1, 1, 4, 9] }, five, five) === null, 'steps not strictly increasing');
check(restoredWalk({ ...ascent, steps: [0, 1, 3, 4, 27] }, five, five) === null, 'a step past the walk (27 positions)');
check(restoredWalk({ ...ascent, steps: [-2, 1, 3, 4, 9] }, five, five) === null, 'a negative step other than -1');
check(restoredWalk({ ...ascent, steps: [0, 1, 3.5, 4, 9] }, five, five) === null, 'a fractional step');
check(restoredWalk({ ...ascent, steps: [0, 1, '3', 4, 9] }, five, five) === null, 'a string step');
check(restoredWalk({ mode: 'cabi', segments: [1, 1, 1, 2], phases: null, steps: [0, 1, 2, 81, LO_SHU_WALKS.cabi.length - 1] }, five, five) !== null, 'CABI steps run to 109');

// v16.0, the queue: queued entries have step -1 and phase '' (the walk positions still strictly increase).
const six = ids(6);
const ascentQ = { mode: 'A', segments: null, phases: null, steps: [0, -1, 1, 3, 4, 9] };
check(JSON.stringify(restoredWalk(ascentQ, six, six)) === JSON.stringify(ascentQ), 'Ascent with a queued entry restores');
check(JSON.stringify(restoredWalk({ ...ascent, steps: [-1, 1, 3, 4, 9] }, five, five)) === JSON.stringify({ ...ascent, steps: [-1, 1, 3, 4, 9] }), 'a queued entry first (Play next with nothing current)');
const cabiQ = { mode: 'cabi', segments: [1, 1, 1, 2], phases: ['', '', '', '', '♾️', ''], steps: [0, 30, 60, -1, 81, 82] };
check(JSON.stringify(restoredWalk(cabiQ, six, six)) === JSON.stringify(cabiQ), 'CABI with a queued entry: segments count the walk entries');
check(restoredWalk({ ...cabiQ, segments: [1, 1, 1, 3] }, six, six) === null, 'segments counting the queued entry too');
check(restoredWalk({ ...cabiQ, phases: ['', '', '', '♾️', '', ''] }, six, six) === null, 'a queued entry with a phase');
check(restoredWalk({ ...ascentQ, steps: [0, -1, 3, 1, 4, 9] }, six, six) === null, 'walk positions decreasing around a queued entry');
check(restoredWalk({ ...ascentQ, steps: [0, -1, 1, 1.5, 4, 9] }, six, six) === null, 'a fractional step beside a queued entry');
check(restoredWalk({ ...ascentQ, steps: [-1, -1, -1, -1, -1, -1] }, six, six) === null, 'only queued entries: no walk');
check(restoredWalk({ mode: 'combined', segments: [2, 2, 1], phases: null, steps: [0, -1, 5, 27, -1, 40, 60] }, ids(7), ids(7)) !== null, 'CAB with two queued entries');

// Segments.
check(restoredWalk({ ...cab, segments: [2, 2, 2] }, five, five) === null, 'segments that do not add up to the order');
check(restoredWalk({ ...cab, segments: [5] }, five, five) === null, 'CAB has three segments');
check(restoredWalk({ ...cab, segments: [3, 3, -1] }, five, five) === null, 'a negative segment');
check(restoredWalk({ ...ascent, segments: [5] }, five, five) === null, 'Ascent has no segments');

// Phases.
check(restoredWalk({ ...ouro, phases: ['♾️'] }, five, five) === null, 'phases shorter than the order');
check(restoredWalk({ ...ouro, phases: [1, '', '', '', ''] }, five, five) === null, 'a non-string phase');

// walkToSave.
check(walkToSave(null, [1], ['x'], [0]) === null, 'no walk, nothing to save');
const segs = [1, 2, 3];
const saved = walkToSave('combined', segs, null, [0, 1, 2, 3, 4, 5]);
check(!!saved && saved.segments !== segs && JSON.stringify(saved.segments) === '[1,2,3]', 'a copy of the arrays');

if (failures.length) {
  console.error(`walkRecord.check: ${failures.length} failed of ${passed + failures.length}:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`walkRecord.check: ${passed} checks passed.`);
