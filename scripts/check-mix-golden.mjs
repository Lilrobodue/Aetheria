// v15.8: the mix golden. Every mix and walk generator, Restore Library and Assign crystals (classic: Auto-Distribute),
// run over synthetic fixtures and a scenario matrix through App's OWN code (lifted from App.tsx by AST, the recipes
// imported from utils/), with every state write, timer, toast and random draw recorded. A release's results are
// frozen in scripts/mix-golden/golden.json; any later change to what a mix does shows here, call by call.
//
//   node scripts/check-mix-golden.mjs                     the working tree against scripts/mix-golden/golden.json
//        --golden=FILE                                    … against another golden
//        --explain=KEY                                    … and print the first differing call of that run
//   node scripts/check-mix-golden.mjs --write=FILE [--label=NAME]
//                                                         freeze the working tree's results as a golden
//   node scripts/check-mix-golden.mjs --capture=REV --out=FILE
//                                                         freeze a commit's results, lifted from git in memory
//                                                         (`--capture=016fc28` is v15.7, the base of v15.8's steps);
//                                                         run twice, and refused unless both runs are identical
//   node scripts/check-mix-golden.mjs --step=N --from=FILE --to=FILE [--report=FILE]
//                                                         a release step's diff: only what the step's allow-list
//                                                         names may change, and the step's own assertions hold
//
// The golden holds, per run, the raw calls in order (song ids as `#<fixture>:<index>`), the number of random draws,
// what was thrown and returned, and the derived walk facts; the canonical record (recorder.mjs) is a function of the
// calls, so equal calls mean equal effects. Runs are content-addressed: one output per distinct result.
//
// The engine: three walks (CAB, Ouroboros, CABI) sort with a random comparator, and V8's short-array sort changed
// between versions (Node 22 and Chrome 156 differ), so their picks for a seed depend on the engine. The golden records
// its V8 version; on another V8 those three generators are skipped, and the report says so.
//
// The Collection paths in App.tsx hold real file names. They are read in memory only; any string in a result that
// contains one is stored as its hash, and nothing is written while one remains.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadTs, liftText, definesModuleFuncs, APP_FUNCS, APP_FUNCS_V158, ENV_NAMES } from './mix-golden/lift.mjs';
import { buildFixtures, buildHistory, mulberry32 } from './mix-golden/fixture.mjs';
import { runScenarios } from './mix-golden/recorder.mjs';
import { GENS, buildScenarios } from './mix-golden/scenarios.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const GOLDEN_DEFAULT = ROOT + '/scripts/mix-golden/golden.json';
const ENGINE_DEPENDENT = ['walk:combined', 'walk:ouroboros', 'walk:cabi'];
const arg = (k, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const ts = loadTs(ROOT);
const cjs = (src) => ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const evalCjs = (code) => { const m = { exports: {} }; new Function('module', 'exports', 'require', code)(m, m.exports, () => ({})); return m.exports; };

// ---- the fixtures, and song ids as `#<fixture>:<index>` ---------------------------------------------------------
const fixtures = buildFixtures();
const fixturesSha = sha(JSON.stringify(fixtures)).slice(0, 16);
const H1 = buildHistory(fixtures.F160);
const scenarios = buildScenarios(H1);
const toRef = new Map();
const fromRef = new Map();
for (const [name, list] of Object.entries(fixtures)) {
  list.forEach((s, i) => {
    if (!s || typeof s !== 'object' || toRef.has(s.id)) return;
    toRef.set(s.id, `#${name}:${i}`);
    fromRef.set(`#${name}:${i}`, s.id);
  });
}
const compact = (v, op) => {
  if (typeof v === 'string') return op === 'walkSnapshot' ? v.split('|').map((x) => toRef.get(x) ?? x).join('|') : (toRef.get(v) ?? v);
  if (Array.isArray(v)) return v.map((x) => compact(x, op));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compact(x, op)]));
  return v;
};
const compactOutput = (r) => ({
  calls: r.calls.map((c) => [c[0], ...c.slice(1).map((x) => compact(x, c[0]))]),
  rngCalls: r.rngCalls,
  thrown: r.canon.thrown,
  returned: r.returned,
  derived: r.derived,
});

// The fixture tracks flagged `collection: k` get their in-memory Collection names (never in a file).
function materialize(lifted) {
  const out = {};
  for (const [k, list] of Object.entries(fixtures)) {
    const copy = JSON.parse(JSON.stringify(list));
    for (let i = 0; i < copy.length; i++) {
      const s = copy[i];
      if (typeof s === 'string' && s.startsWith('__dup__:')) { copy[i] = copy[Number(s.slice(8))]; continue; }
      if (s.collection !== undefined && lifted.titles) {
        s.name = `${lifted.titles[s.collection]} (take ${s.collection})`;
        if (s.collection % 2 === 0 && lifted.marker) s.file = { ...s.file, name: `x${lifted.marker}${s.collection}.wav` };
      }
    }
    out[k] = copy;
  }
  return out;
}

// ---- running a version's code -----------------------------------------------------------------------------------
async function sources(rev) {
  if (rev) {
    const show = (p) => execFileSync('git', ['show', `${rev}:${p}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
    return { label: `git ${rev}`, app: show('App.tsx'), constants: show('constants.ts'), listOps: show('utils/library/listOps.ts'), modules: null };
  }
  const read = (p) => readFileSync(ROOT + '/' + p, 'utf8');
  const app = read('App.tsx');
  if (definesModuleFuncs(ts, app)) return { label: 'working tree (v15.7 shape)', app, constants: read('constants.ts'), listOps: read('utils/library/listOps.ts'), modules: null };
  const imp = (p) => import(pathToFileURL(ROOT + '/' + p).href);
  const [C, D, R, L] = await Promise.all([imp('utils/crystalData.ts'), imp('utils/mix/distribution.ts'), imp('utils/mix/recipes.ts'), imp('utils/library/listOps.ts')]);
  return { label: 'working tree', app, modules: { C, D, R, L } };
}

function run(src) {
  let lifted, deps;
  if (!src.modules) {
    // v15.7: the mix helpers are module-level functions in App.tsx; constants and listOps are evaluated from source.
    lifted = liftText(ts, src.app);
    const C = evalCjs(cjs(src.constants));
    const L = evalCjs(cjs(src.listOps));
    deps = {
      SOLFEGGIO_INFO: C.SOLFEGGIO_INFO, LO_SHU_WALKS: C.LO_SHU_WALKS, LO_SHU_WALK_INFO: C.LO_SHU_WALK_INFO,
      LO_SHU_WALK_COMBINED: C.LO_SHU_WALK_COMBINED, LO_SHU_WALK_OUROBOROS: C.LO_SHU_WALK_OUROBOROS,
      OUROBOROS_PHASES: C.OUROBOROS_PHASES, SOURCE_FREQ: C.SOURCE_FREQ, dedupeById: L.dedupeById, patchById: L.patchById,
    };
  } else {
    // v15.8 and later: App's generators, mixInput and applyMix are lifted; the recipes, the distribution and the
    // crystal data come from the modules as Node loads them (every export is offered; the code takes what it uses).
    const { C, D, R, L } = src.modules;
    const moduleImports = Object.fromEntries(Object.entries({ ...C, ...D, ...R }).filter(([k, v]) => typeof v === 'function' || k === k.toUpperCase()));
    lifted = liftText(ts, src.app, {
      moduleFuncs: [],
      appFuncs: APP_FUNCS_V158,
      envNames: [...new Set([...ENV_NAMES, 'setLoShuWalkSteps', ...Object.keys(moduleImports)])],
      moduleImports,
    });
    deps = { ...moduleImports, dedupeById: L.dedupeById, patchById: L.patchById };
  }
  const live = materialize(lifted);
  // The copied debug logging (Golden Φ, 111, SOURCE, getHarmonicSolfeggio) prints names: keep it out of the output.
  const realLog = console.log, realWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  let results;
  try {
    results = runScenarios(evalCjs(lifted.js).makeApp, deps, live, scenarios, GENS, mulberry32.toString());
  } finally {
    console.log = realLog; console.warn = realWarn;
  }
  const forbidden = [...(lifted.titles || []), lifted.marker, ...(lifted.marker ? lifted.marker.split(/[^A-Za-z]+/).filter((w) => w.length >= 4) : [])].filter(Boolean);
  const redact = (v) => {
    if (typeof v === 'string') return forbidden.some((t) => v.includes(t)) ? 'sha256:' + sha(v).slice(0, 24) : v;
    if (Array.isArray(v)) return v.map(redact);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x)]));
    return v;
  };
  const out = {};
  for (const [key, r] of Object.entries(results)) out[key] = compactOutput(redact(r));
  const leaks = forbidden.filter((t) => JSON.stringify(out).includes(t));
  if (leaks.length) throw new Error(`${leaks.length} Collection strings left in the results: refusing to go on`);
  return { results: out, lifted, forbidden };
}

function goldenOf(results, lifted, label, source) {
  const runs = {};
  const outputs = {};
  for (const [key, r] of Object.entries(results)) {
    const h = sha(JSON.stringify(r)).slice(0, 20);
    runs[key] = h;
    outputs[h] = r;
  }
  return {
    about: 'Aetheria mix golden (scripts/check-mix-golden.mjs): every generator\'s calls, draws and walk facts over the synthetic fixtures',
    meta: {
      label, source, app: lifted.provenance, presetsFromJsx: lifted.jsxArrows, node: process.version, v8: process.versions.v8,
      fixturesSha, historyH1Size: Object.keys(H1).length, scenarios: scenarios.length, generators: GENS,
      runs: Object.keys(runs).length, uniqueOutputs: Object.keys(outputs).length, ids: '#<fixture>:<index>',
    },
    runs,
    outputs,
  };
}
// One line per run and per output: compact, and a diff of the file shows which outputs changed.
// crystalData's PRESETS (data for v14.17's tiles) against the classic drawer's own literals: each preset button's label,
// and the crystals and name its onClick passes to generateFrequencyPlaylist (inline, or through a wrapper).
function presetsAgainstDrawer(appText, PRESETS) {
  const sf = ts.createSourceFile('App.tsx', appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const consts = new Map();
  const callIn = (node) => {
    let found = null;
    const v = (n) => {
      if (!found && ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'generateFrequencyPlaylist' && n.arguments.length === 2
        && ts.isArrayLiteralExpression(n.arguments[0]) && ts.isStringLiteral(n.arguments[1])) {
        found = { crystals: n.arguments[0].elements.map((e) => Number(e.getText(sf))), name: n.arguments[1].text };
      }
      ts.forEachChild(n, v);
    };
    v(node);
    return found;
  };
  const byLabel = new Map();
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) consts.set(n.name.text, n.initializer);
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(sf) === 'button') {
      const label = n.children.map((c) => (ts.isJsxText(c) ? c.getText(sf) : '')).join(' ').replace(/\s+/g, ' ').trim();
      const attr = n.openingElement.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'onClick');
      const expr = attr?.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : null;
      if (expr) byLabel.set(label, expr);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const problems = [];
  for (const p of PRESETS) {
    const expr = byLabel.get(p.label);
    const target = expr && ts.isIdentifier(expr) ? consts.get(expr.text) : expr;
    const lit = target ? callIn(target) : null;
    if (!lit) problems.push(`${p.id}: no drawer button "${p.label}" calling generateFrequencyPlaylist`);
    else if (JSON.stringify(lit.crystals) !== JSON.stringify([...p.crystals]) || lit.name !== p.name) problems.push(`${p.id}: the drawer has ${JSON.stringify(lit)}`);
  }
  return problems;
}

const serialize = (g) => {
  const block = (o) => '{\n' + Object.entries(o).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n }';
  return `{\n "about": ${JSON.stringify(g.about)},\n "meta": ${JSON.stringify(g.meta)},\n "runs": ${block(g.runs)},\n "outputs": ${block(g.outputs)}\n}\n`;
};
const load = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ---- the step diff ------------------------------------------------------------------------------------------------
const ALLOW = {
  1: [{ id: 'cube: walks and GUT write their steps', gens: ['gut', 'walk:*'], ops: ['setLoShuWalkSteps'], change: 'added' }],
  2: [
    { id: 'slip a: GUT clears segments and phases', gens: ['gut'], ops: ['setLoShuWalkSegments', 'setLoShuWalkPhases'], change: 'added' },
    { id: 'slip b: an empty walk leaves them alone', gens: ['walk:*'], ops: ['setLoShuWalkSegments', 'setLoShuWalkPhases'], change: 'removed', when: 'noOrder' },
    { id: "slip c: 111's labels", gens: ['seq111'], ops: ['notice'], change: 'text', fixtures: ['F111gap'] },
  ],
  3: [{ id: 'Assign crystals', gens: ['autoDistribute'], change: 'any' }],
};
function stepDiff(step, A, B) {
  const allow = ALLOW[step];
  if (!allow) throw new Error('--step=1|2|3');
  const genMatch = (pat, gen) => (pat.endsWith('*') ? gen.startsWith(pat.slice(0, -1)) : pat === gen);
  const crystalOf = (fixture, ref) => {
    const id = fromRef.get(ref) ?? ref;
    return fixtures[fixture].find((s) => s && typeof s === 'object' && s.id === id)?.closestSolfeggio;
  };
  const violations = [];
  const touched = Object.fromEntries(allow.map((r) => [r.id, 0]));
  const asserts = [];
  for (const key of Object.keys(A.runs)) {
    const [gen, fixture] = key.split('|');
    const a = A.outputs[A.runs[key]];
    const b = B.outputs[B.runs[key]];
    if (!b) { violations.push([key, 'missing']); continue; }
    if (b.thrown) asserts.push([key, 'threw: ' + b.thrown]); // never a throw, in any step
    const rules = allow.filter((r) => r.gens.some((p) => genMatch(p, gen)) && (!r.fixtures || r.fixtures.includes(fixture)));
    const noOrderB = !b.calls.some((c) => c[0] === 'setPlaylist');
    const live = rules.filter((r) => r.when !== 'noOrder' || noOrderB);
    if (live.some((r) => r.change === 'any')) {
      if (JSON.stringify(a.calls) !== JSON.stringify(b.calls)) touched[live.find((r) => r.change === 'any').id]++;
    } else {
      const residual = (calls) => calls
        .filter((c) => !live.some((r) => (r.change === 'added' || r.change === 'removed') && r.ops.includes(c[0])))
        .map((c) => (live.some((r) => r.change === 'text' && r.ops.includes(c[0])) && typeof c[1] === 'string' ? [c[0], '<text>', ...c.slice(2)] : c));
      if (JSON.stringify(residual(a.calls)) !== JSON.stringify(residual(b.calls)) || a.rngCalls !== b.rngCalls) violations.push([key, 'outside the allow-list']);
      for (const r of live) {
        const pick = (calls) => JSON.stringify(calls.filter((c) => r.ops.includes(c[0])));
        if (pick(a.calls) !== pick(b.calls)) touched[r.id]++;
      }
    }
    // The step's own assertions.
    if (step === '1' && a.derived) {
      const st = b.calls.filter((c) => c[0] === 'setLoShuWalkSteps');
      if (st.length !== 1 || JSON.stringify(st[0][1]) !== JSON.stringify(a.derived.expectedSteps)) asserts.push([key, 'steps']);
    }
    if (step === '2') {
      if (gen === 'gut' && !noOrderB) {
        const head = b.calls.slice(0, 2).map((c) => `${c[0]}=${JSON.stringify(c[1])}`).join(' ');
        if (head !== 'setLoShuWalkSegments=null setLoShuWalkPhases=null') asserts.push([key, 'GUT head: ' + head]);
      }
      if (gen.startsWith('walk:') && noOrderB && b.calls.some((c) => c[0] === 'setLoShuWalkSegments' || c[0] === 'setLoShuWalkPhases')) asserts.push([key, 'empty walk wrote']);
      if (gen === 'seq111' && !noOrderB) {
        const order = b.calls.find((c) => c[0] === 'setPlaylist')[1].ids;
        const n = b.calls.find((c) => c[0] === 'notice' && typeof c[1] === 'string' && c[1].startsWith('111 Pattern Complete'));
        const shown = n[1].match(/\((.*?)\)/)[1].replace(/⚠️/g, '').split('→').map((x) => Number(x.replace('Hz', '')));
        const picked = order.map((ref) => crystalOf(fixture, ref));
        if (JSON.stringify(shown) !== JSON.stringify(picked)) asserts.push([key, `111 labels ${shown} vs ${picked}`]);
      }
    }
    if (step === '3' && gen === 'autoDistribute' && b.rngCalls !== 0) asserts.push([key, 'draws ' + b.rngCalls]);
  }
  if (step === '3') {
    // Assign is the same whatever the seed, width, experience or history: one output per fixture (and Deep Scan state).
    const byFixture = {};
    for (const key of Object.keys(B.runs)) {
      const [gen, fixture, , , , , scan] = key.split('|');
      if (gen !== 'autoDistribute') continue;
      (byFixture[fixture + '|' + scan] ??= new Set()).add(B.runs[key]);
    }
    for (const [f, set] of Object.entries(byFixture)) if (set.size !== 1) asserts.push([f, `${set.size} different outputs`]);
  }
  return { step, runs: Object.keys(A.runs).length, violations: violations.length, firstViolations: violations.slice(0, 10), touched, assertionFailures: asserts.length, firstAssertionFailures: asserts.slice(0, 10) };
}

// ---- main -------------------------------------------------------------------------------------------------------------
const STEP = arg('step');
const CAPTURE = arg('capture');
const WRITE = arg('write');
if (STEP) {
  const report = { ...stepDiff(STEP, load(arg('from')), load(arg('to'))), from: arg('from'), to: arg('to') };
  if (arg('report')) writeFileSync(arg('report'), JSON.stringify(report, null, 1) + '\n');
  console.log(`check-mix-golden --step=${STEP}: ${report.runs} runs; ${report.violations} outside the allow-list; ${report.assertionFailures} assertion failures; touched ${JSON.stringify(report.touched)}`);
  if (report.violations || report.assertionFailures) { console.log(JSON.stringify({ firstViolations: report.firstViolations, firstAssertionFailures: report.firstAssertionFailures })); process.exit(1); }
} else if (CAPTURE) {
  const OUT = arg('out');
  if (!OUT) throw new Error('--capture needs --out=FILE');
  const src = await sources(CAPTURE);
  const t0 = Date.now();
  const r1 = run(src);
  const r2 = run(src);
  const s1 = JSON.stringify(r1.results), s2 = JSON.stringify(r2.results);
  if (s1 !== s2) { console.error('capture: two runs differ; refusing to write'); process.exit(1); }
  const text = serialize(goldenOf(r1.results, r1.lifted, arg('label', CAPTURE), src.label));
  writeFileSync(OUT, text);
  console.log(`captured ${Object.keys(r1.results).length} runs from ${src.label} (two runs identical) in ${Date.now() - t0} ms → ${OUT}; file sha256 ${sha(text)}`);
} else {
  const src = await sources('');
  const t0 = Date.now();
  const { results, lifted } = run(src);
  if (WRITE) {
    const text = serialize(goldenOf(results, lifted, arg('label', 'working tree'), src.label));
    writeFileSync(WRITE, text);
    console.log(`wrote ${Object.keys(results).length} runs (${src.label}) → ${WRITE}; file sha256 ${sha(text)}`);
    process.exit(0);
  }
  const GOLDEN = arg('golden', GOLDEN_DEFAULT);
  const golden = load(GOLDEN);
  const sameEngine = golden.meta.v8 === process.versions.v8;
  let pass = 0, skipped = 0;
  const fails = [];
  for (const [key, h] of Object.entries(golden.runs)) {
    const gen = key.split('|')[0];
    if (!sameEngine && ENGINE_DEPENDENT.includes(gen)) { skipped++; continue; }
    const want = golden.outputs[h];
    const got = results[key];
    if (!got) { fails.push([key, 'missing']); continue; }
    const problems = [];
    if (got.thrown) problems.push('threw: ' + got.thrown);
    if (JSON.stringify(got.calls) !== JSON.stringify(want.calls)) problems.push('calls');
    if (got.rngCalls !== want.rngCalls) problems.push(`draws ${got.rngCalls}/${want.rngCalls}`);
    if (got.thrown !== want.thrown || got.returned !== want.returned) problems.push('thrown/returned');
    if (JSON.stringify(got.derived) !== JSON.stringify(want.derived)) problems.push('derived');
    if (problems.length) fails.push([key, problems.join(', ')]);
    else pass++;
  }
  const extra = Object.keys(results).filter((k) => !(k in golden.runs));
  const total = Object.keys(golden.runs).length;
  if (src.modules) for (const p of presetsAgainstDrawer(src.app, src.modules.C.PRESETS)) fails.push(['PRESETS', p]);
  const report = { golden: GOLDEN, goldenLabel: golden.meta.label, candidate: src.label, v8: process.versions.v8, goldenV8: golden.meta.v8, sameEngine, pass, total, skipped, extraRuns: extra.length, ms: Date.now() - t0, fails: fails.slice(0, 50) };
  if (arg('report')) writeFileSync(arg('report'), JSON.stringify(report, null, 1) + '\n');
  console.log(`check-mix-golden: ${pass} of ${total - skipped} runs identical to ${golden.meta.label} (calls, draws, walk facts)` +
    (sameEngine ? '' : `; another V8 (${process.versions.v8}, the golden's ${golden.meta.v8}): the ${skipped} CAB, Ouroboros and CABI runs skipped`) +
    (extra.length ? `; ${extra.length} runs not in the golden` : ''));
  const EXPLAIN = arg('explain');
  if (EXPLAIN) {
    const want = golden.outputs[golden.runs[EXPLAIN]];
    const got = results[EXPLAIN];
    if (!want || !got) console.log('no such run:', EXPLAIN);
    else {
      const n = Math.max(want.calls.length, got.calls.length);
      let i = 0;
      while (i < n && JSON.stringify(want.calls[i]) === JSON.stringify(got.calls[i])) i++;
      console.log(i === n ? `${EXPLAIN}: calls identical (draws ${got.rngCalls}/${want.rngCalls})` : `${EXPLAIN}: first difference at call ${i}\n  golden:    ${JSON.stringify(want.calls[i])}\n  candidate: ${JSON.stringify(got.calls[i])}`);
    }
  }
  if (fails.length || extra.length) { console.log('first failures:', JSON.stringify(fails.slice(0, 10))); process.exit(1); }
}
