#!/usr/bin/env node
// scripts/check-library-writers.mjs (v15.7)
//
// Pins every place the LIBRARY is written or stored audio deleted, so a new one, or a changed one, is deliberate and
// listed in the release notes rather than a side effect. The library (App's originalPlaylist) grows only by import and
// shrinks only by an explicit Delete or Clear (memory: "Library data safety"); v14.4 lost libraries when a mix's list
// was written over it and the blob sync then deleted the rest of the audio. v15.7's Library tab replaces the PLAY
// order from a row tap; this makes it a build-time rule that it never touches the library.
//
// What counts as a writer, resolved through the TypeScript AST (comments and strings never count):
//   - playlistCache's deleteTracksFromCache and clearPlaylistCache, however they are imported: by name, renamed
//     (`import { deleteTracksFromCache as x }`) or through a namespace (`import * as ns` … `ns.clearPlaylistCache()`,
//     `ns['…']`). A namespace used any other way (passed on, aliased, indexed by a variable), a default import, a
//     re-export, a dynamic import() or a require() of a writer's module is refused outright;
//   - App's library setter (the second element of `const [originalPlaylist, …] = useState(…)`), whatever it is named;
//   - every function that uses a writer — App's deleteSong, settleOrphans, the Clear, Auto-Distribute, the import, the
//     passes …, or a function in any other file — found to a fixed point, so a use of a wrapper is a writer use too
//     (a wrapper in another module is followed through its imports the same way);
//   - App mutating the library array in place (originalPlaylist / libraryRef.current: push, splice, sort …, an element
//     assignment), and any assignment to libraryRef.current.
//
// Rules:
//   1. Every use (a call or any other reference) of a writer or a wrapper, in every source file (App.tsx, index.tsx,
//      components/, hooks/, utils/, src/, tools/ — utils/playlistCache.ts, where they are defined, excepted), counted
//      by its enclosing function / effect / JSX attribute, equals the pinned table (scripts/library-writers.json):
//      the count AND a hash of the enclosing code (the innermost site, and the whole App-level function or effect it
//      sits in), so a changed line inside an allowed writer fails until it is deliberately re-pinned.
//   2. Nothing under components/shell/ imports utils/playlistCache.
//   3. The play-order functions (startPlayOrder, playFromLibrary, undoPlayOrder) exist once each in App.tsx and use no
//      writer and no wrapper.
//
//   node scripts/check-library-writers.mjs            compare against scripts/library-writers.json
//   node scripts/check-library-writers.mjs --update   rewrite the table (only for an intended change; list it)
//   node scripts/check-library-writers.mjs --root=DIR check another checkout (e.g. a scratch copy with an injection)

import ts from 'typescript';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, sep, posix } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootArg = process.argv.find((a) => a.startsWith('--root='));
const root = rootArg ? rootArg.slice('--root='.length) : repoRoot;
const PINS_PATH = join(root, 'scripts', 'library-writers.json');

const CACHE_FILE = 'utils/playlistCache.ts';
const CACHE_WRITERS = ['deleteTracksFromCache', 'clearPlaylistCache'];
const ROOT_COMPONENT = 'App'; // App.tsx's component: its own body is not a wrapper, its inner functions are
const PLAY_ORDER_FUNCTIONS = ['startPlayOrder', 'playFromLibrary', 'undoPlayOrder', 'applyMix']; // v15.8: applyMix, the mixes' one way into App's state
const MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);

const lf = (s) => s.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const sha = (s) => createHash('sha256').update(lf(s), 'utf8').digest('hex').slice(0, 16);
const problems = new Set();
const problem = (s) => problems.add(s);

// ---------------------------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------------------------
const files = ['App.tsx', 'index.tsx'].filter((f) => existsSync(join(root, f)));
for (const dir of ['components', 'hooks', 'utils', 'src', 'tools']) {
  const walk = (p) => {
    for (const f of readdirSync(p)) {
      if (f === 'node_modules') continue;
      const q = join(p, f);
      if (statSync(q).isDirectory()) walk(q);
      else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(f) && !/\.d\.ts$/.test(f)) files.push(q.slice(join(root).length + 1).split(sep).join('/'));
    }
  };
  if (existsSync(join(root, dir))) walk(join(root, dir));
}
const fileSet = new Set(files);
const parsed = new Map();
const parse = (file) => {
  if (!parsed.has(file)) {
    const text = readFileSync(join(root, file), 'utf8');
    parsed.set(file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
  }
  return parsed.get(file);
};
const lineOf = (sf, n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

/** A relative import specifier → the repo file it names (or null for a package). */
function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  for (const c of [base, ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '/index.ts', '/index.tsx'].map((e) => base + e)]) if (fileSet.has(c)) return c;
  return base;
}

// ---------------------------------------------------------------------------------------------------------------
// Where a node sits: "App › scanLibrary › applyResult", with its sites (the code whose text is pinned)
// ---------------------------------------------------------------------------------------------------------------
const isFunctionLike = (n) => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);
const functionInit = (init) => !!init && (isFunctionLike(init) || (ts.isCallExpression(init) && init.arguments.some(isFunctionLike)));

function where(node, sf) {
  const labels = []; // innermost first: { label, node, jsx }
  let child = node;
  for (let p = node.parent; p; child = p, p = p.parent) {
    let label = null;
    let jsx = false;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && functionInit(p.initializer) && p.initializer === child) label = p.name.text;
    else if (ts.isFunctionDeclaration(p) && p.name) label = p.name.text;
    else if (ts.isClassDeclaration(p) && p.name) label = p.name.text;
    else if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) && p.name && ts.isIdentifier(p.name) && (ts.isMethodDeclaration(p) || isFunctionLike(p.initializer))) label = p.name.text;
    else if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && /^use(Layout)?Effect$/.test(p.expression.text) && p.arguments[0] === child) {
      const deps = p.arguments[1];
      label = `${p.expression.text}(${deps ? deps.getText(sf).replace(/\s+/g, ' ') : 'no deps'})`;
    } else if (ts.isJsxAttribute(p)) {
      const opening = p.parent?.parent;
      const tag = opening && (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) ? opening.tagName.getText(sf) : 'jsx';
      label = `<${tag} ${p.name.getText(sf)}>`;
      jsx = true;
    }
    if (label) {
      const site = ts.isVariableDeclaration(p) && p.parent?.parent && ts.isVariableStatement(p.parent.parent) ? p.parent.parent : p;
      labels.push({ label, node: site, jsx });
    }
  }
  const outer = [...labels].reverse(); // outermost first
  const path = outer.map((l) => l.label).join(' › ') || '(module)';
  // The function that would be a wrapper: App's own inner function, or a top-level function elsewhere.
  const top = sf.fileName === 'App.tsx' && outer[0]?.label === ROOT_COMPONENT ? outer[1] : outer[0];
  const wrapper = top && /^[A-Za-z_$][\w$]*$/.test(top.label) ? top.label : null;
  // Sites: the innermost labelled code, and the whole App-level function or effect around it (not a JSX attribute,
  // which in classic wraps whole panels). No label at all (a module's own code): the file.
  const sites = new Set();
  if (labels[0] && labels[0].label !== ROOT_COMPONENT) sites.add(labels[0].node);
  if (top && !top.jsx) sites.add(top.node);
  if (!sites.size) sites.add(sf);
  return { path, wrapper, moduleLevel: !!top && top === outer[0], sites: [...sites] };
}

/** Is this identifier a declaration's own name or a member name (not a use)? */
function isDeclarationName(n) {
  const p = n.parent;
  return (
    (ts.isVariableDeclaration(p) && p.name === n) ||
    (ts.isBindingElement(p) && p.name === n) ||
    (ts.isBindingElement(p) && p.propertyName === n) ||
    ts.isImportSpecifier(p) ||
    ts.isImportClause(p) ||
    ts.isNamespaceImport(p) ||
    ts.isExportSpecifier(p) ||
    (ts.isPropertyAccessExpression(p) && p.name === n) ||
    (ts.isPropertyAssignment(p) && p.name === n) ||
    (ts.isMethodDeclaration(p) && p.name === n) ||
    (ts.isFunctionDeclaration(p) && p.name === n) ||
    (ts.isClassDeclaration(p) && p.name === n) ||
    (ts.isParameter(p) && p.name === n) ||
    (ts.isJsxAttribute(p) && p.name === n) ||
    (ts.isPropertySignature(p) && p.name === n) ||
    ts.isTypeReferenceNode(p) ||
    ts.isQualifiedName(p)
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Writer modules and bindings
// ---------------------------------------------------------------------------------------------------------------
/** file → the names it exports that are writers or wrappers. */
const writerModules = new Map([[CACHE_FILE, new Set(CACHE_WRITERS)]]);
/** file → local name → writer/wrapper name, for names bound in that file (App's setter, local wrappers). */
const localWriters = new Map();

/** The library setter: the second element of `const [originalPlaylist, X] = useState(…)` (App.tsx). */
function librarySetter(sf) {
  let name = null;
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isArrayBindingPattern(n.name) && n.initializer && ts.isCallExpression(n.initializer) && /useState$/.test(n.initializer.expression.getText(sf))) {
      const [a, b] = n.name.elements;
      if (a && ts.isBindingElement(a) && ts.isIdentifier(a.name) && a.name.text === 'originalPlaylist' && b && ts.isBindingElement(b) && ts.isIdentifier(b.name)) name = b.name.text;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return name;
}

/** Imports of writer modules in a file: local names (by name or renamed) and namespaces; refuses what can't be followed. */
function importBindings(file, sf) {
  const names = new Map(); // local → writer
  const namespaces = new Map(); // local → Set of writers
  const visit = (n) => {
    let spec = null;
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) spec = n.moduleSpecifier.text;
    const dynamic =
      ts.isCallExpression(n) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'));
    if (dynamic) spec = n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) ? n.arguments[0].text : '(computed)';
    if (spec !== null) {
      const target = spec === '(computed)' ? null : resolveImport(file, spec);
      const exported = target && writerModules.get(target);
      if (dynamic && (exported || /playlistCache/.test(spec) || spec === '(computed)')) {
        problem(`${file}:${lineOf(sf, n)}: a dynamic import of ${spec} (a writer's module must be imported statically, by name or namespace)`);
      } else if (exported && ts.isExportDeclaration(n)) {
        problem(`${file}:${lineOf(sf, n)}: re-exports ${spec}, a writer's module (an indirection the check won't follow)`);
      } else if (exported && ts.isImportDeclaration(n)) {
        const clause = n.importClause;
        if (clause?.name) problem(`${file}:${lineOf(sf, n)}: a default import of ${spec}, a writer's module`);
        const b = clause?.namedBindings;
        if (b && ts.isNamespaceImport(b)) namespaces.set(b.name.text, exported);
        if (b && ts.isNamedImports(b)) for (const el of b.elements) {
          const imported = (el.propertyName ?? el.name).text;
          if (exported.has(imported)) names.set(el.name.text, imported);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { names, namespaces };
}

const libraryTarget = (e, sf) => (ts.isIdentifier(e) && e.text === 'originalPlaylist') || e.getText(sf).replace(/\s/g, '') === 'libraryRef.current';

/** Every use of a writer or wrapper in a file: { name, call, path, wrapper, sites, line }. */
function writerUses(file) {
  const sf = parse(file);
  const { names, namespaces } = importBindings(file, sf);
  const local = localWriters.get(file) ?? new Map();
  const uses = [];
  const add = (node, name, call) => uses.push({ name, call, line: lineOf(sf, node), ...where(node, sf) });
  const visit = (n) => {
    if (ts.isIdentifier(n) && !isDeclarationName(n)) {
      const writer = names.get(n.text) ?? local.get(n.text);
      if (writer) add(n, writer, ts.isCallExpression(n.parent) && n.parent.expression === n);
      else if (namespaces.has(n.text)) {
        // A namespace may only be used as ns.member / ns['member'].
        const p = n.parent;
        const member =
          ts.isPropertyAccessExpression(p) && p.expression === n ? p.name.text
          : ts.isElementAccessExpression(p) && p.expression === n && ts.isStringLiteralLike(p.argumentExpression) ? p.argumentExpression.text
          : null;
        if (member === null) problem(`${file}:${lineOf(sf, n)}: the namespace ${n.text} (a writer's module) is used other than as ${n.text}.member`);
        else if (namespaces.get(n.text).has(member)) add(p, member, ts.isCallExpression(p.parent) && p.parent.expression === p);
      }
    }
    if (file === 'App.tsx') {
      // The library array mutated in place, or libraryRef.current reassigned.
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && MUTATORS.has(n.expression.name.text) && libraryTarget(n.expression.expression, sf)) {
        add(n, `${n.expression.expression.getText(sf)}.${n.expression.name.text}`, true);
      }
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        const l = n.left;
        if (ts.isElementAccessExpression(l) && libraryTarget(l.expression, sf)) add(n, `${l.expression.getText(sf)}[…] =`, true);
        if (ts.isPropertyAccessExpression(l) && libraryTarget(l, sf)) add(n, 'libraryRef.current =', true);
        if (ts.isPropertyAccessExpression(l) && libraryTarget(l.expression, sf)) add(n, `${l.expression.getText(sf)}.${l.name.text} =`, true);
      }
    }
    ts.forEachChild(n, visit);
  };
  if (file !== CACHE_FILE) visit(sf);
  return uses;
}

// ---------------------------------------------------------------------------------------------------------------
// The setter and the wrappers, to a fixed point (across files)
// ---------------------------------------------------------------------------------------------------------------
const setter = existsSync(join(root, 'App.tsx')) ? librarySetter(parse('App.tsx')) : null;
if (!setter) problem('App.tsx: no `const [originalPlaylist, …] = useState(…)` found');
else localWriters.set('App.tsx', new Map([[setter, 'setOriginalPlaylist']]));
const wrappers = new Map(); // "file › name" → file
for (let round = 0, changed = true; changed && round < 30; round++) {
  changed = false;
  for (const file of files) {
    for (const u of writerUses(file)) {
      const fn = u.wrapper;
      if (!fn || (file === 'App.tsx' && PLAY_ORDER_FUNCTIONS.includes(fn))) continue;
      const key = `${file} › ${fn}`;
      if (wrappers.has(key)) continue;
      wrappers.set(key, file);
      if (!localWriters.has(file)) localWriters.set(file, new Map());
      if (!localWriters.get(file).has(fn)) localWriters.get(file).set(fn, fn);
      // A module-level function can be imported elsewhere (followed like the writers); App's inner ones can't.
      if (u.moduleLevel) {
        if (!writerModules.has(file)) writerModules.set(file, new Set());
        writerModules.get(file).add(fn);
      }
      changed = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Rule 1: the table
// ---------------------------------------------------------------------------------------------------------------
const table = {};
const usesAll = [];
for (const file of files) {
  const sf = parse(file);
  for (const u of writerUses(file)) {
    const loc = file === 'App.tsx' ? u.path : `${file}: ${u.path}`;
    const key = `${u.name} ${u.call ? 'call' : 'reference'} in ${loc}`;
    const e = (table[key] ??= { count: 0, sites: new Set(), file, lines: [] });
    e.count++;
    for (const s of u.sites) e.sites.add(s.getText(sf));
    e.lines.push(u.line);
    usesAll.push({ ...u, file, key });
  }
}
const current = Object.fromEntries(
  Object.entries(table)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, e]) => [k, { count: e.count, sha: sha([...e.sites].map(lf).sort().join('\n---\n')) }])
);

if (process.argv.includes('--update')) {
  const before = existsSync(PINS_PATH) ? JSON.parse(readFileSync(PINS_PATH, 'utf8')) : {};
  writeFileSync(PINS_PATH, (JSON.stringify(current, null, 2) + '\n').replace(/\n/g, '\r\n'), 'utf8');
  const changedKeys = [...new Set([...Object.keys(before), ...Object.keys(current)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(current[k]));
  console.log(`library-writers.json written (${Object.keys(current).length} places).`);
  if (changedKeys.length) {
    console.log('Changed or new — list these in the release notes:');
    for (const k of changedKeys) console.log(`  ${k}: ${JSON.stringify(before[k] ?? null)} → ${JSON.stringify(current[k] ?? null)}`);
  }
}
const pins = existsSync(PINS_PATH) ? JSON.parse(readFileSync(PINS_PATH, 'utf8')) : null;
if (!pins) problem('scripts/library-writers.json is missing; create it with --update.');
else {
  for (const k of new Set([...Object.keys(pins), ...Object.keys(current)])) {
    const want = pins[k];
    const got = current[k];
    const at = table[k] ? `${table[k].file}:${table[k].lines.join(',')}` : '';
    if (!want || typeof want !== 'object') problem(`not pinned: ${k} (${at})`);
    else if (!got) problem(`gone: ${k} (pinned ${want.count})`);
    else if (want.count !== got.count) problem(`${k}: ${got.count} uses, pinned ${want.count} (${at})`);
    else if (want.sha !== got.sha) problem(`${k}: its code changed (${at}); re-pin with --update if intended`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Rule 2: the shell never imports playlistCache
// ---------------------------------------------------------------------------------------------------------------
// v15.8: nor do the mix recipes and the crystal data (pure modules: they return data, App applies it).
const NO_CACHE = (f) => f.startsWith('components/shell/') || f.startsWith('utils/mix/') || f === 'utils/crystalData.ts';
for (const file of files.filter(NO_CACHE)) {
  const sf = parse(file);
  const visit = (n) => {
    const spec =
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) ? n.moduleSpecifier.text
      : ts.isCallExpression(n) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require')) ? n.arguments[0].text
      : null;
    if (spec && resolveImport(file, spec) === CACHE_FILE) problem(`${file}:${lineOf(sf, n)}: imports ${spec} (the shell, the mix recipes and the crystal data never reach the library's storage)`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// ---------------------------------------------------------------------------------------------------------------
// Rule 3: the play-order functions use no writer and no wrapper
// ---------------------------------------------------------------------------------------------------------------
if (existsSync(join(root, 'App.tsx'))) {
  const app = parse('App.tsx');
  for (const name of PLAY_ORDER_FUNCTIONS) {
    const decls = [];
    const visit = (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) decls.push(n);
      ts.forEachChild(n, visit);
    };
    visit(app);
    if (decls.length !== 1) problem(`App.tsx: expected exactly one \`const ${name}\`, found ${decls.length}`);
  }
  for (const u of usesAll) {
    const inside = u.file === 'App.tsx' && PLAY_ORDER_FUNCTIONS.find((f) => u.path.split(' › ').includes(f));
    if (inside) problem(`App.tsx:${u.line}: ${inside} uses ${u.name} (a play-order function never writes the library)`);
  }
}

const places = Object.keys(current).length;
const total = Object.values(current).reduce((a, b) => a + b.count, 0);
if (problems.size) {
  console.error(`check:writers: ${problems.size} problem${problems.size === 1 ? '' : 's'}:`);
  for (const p of problems) console.error('  ' + p);
  console.error('If a change to the library writers is intended, run with --update and list it in the release notes.');
  process.exit(1);
}
console.log(
  `check:writers: ${total} uses of the library's writers and their ${wrappers.size} wrappers, in ${places} places across ` +
    `${files.length} files, as pinned (counts and code); components/shell, utils/mix and utils/crystalData never import playlistCache; ` +
    `${PLAY_ORDER_FUNCTIONS.join(', ')} use no writer.`
);
