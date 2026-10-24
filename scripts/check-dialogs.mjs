#!/usr/bin/env node
// scripts/check-dialogs.mjs (v15.4)
//
// Fails on any native dialog CALL in the app sources: alert(), confirm() or prompt(), by name or through window.,
// globalThis. or self. A native dialog freezes the page's JavaScript until someone taps OK: auto-advance stops at the
// end of the track and the lock-screen card stalls, on a locked phone or in the car with no one to tap. The app says
// things with toasts and its own Dialog instead (components/ui/Dialog.tsx).
//
//   node scripts/check-dialogs.mjs            the repo
//   node scripts/check-dialogs.mjs --root=DIR another checkout (e.g. the previous release)
//
// It reads the TypeScript AST, so comments and strings never count: the pinned playTrack and resumePlayback carry
// "alert()" in comments (check-critical.mjs forbids editing them), and a text grep could never reach zero.
// Scans App.tsx, index.tsx, components/, hooks/, utils/ and src/, skipping the *.check.ts / *.smoke.ts node scripts.

import ts from 'typescript';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootArg = process.argv.find((a) => a.startsWith('--root='));
const root = rootArg ? rootArg.slice('--root='.length) : repoRoot;

const NAMES = new Set(['alert', 'confirm', 'prompt']);
const GLOBALS = new Set(['window', 'globalThis', 'self']);

const files = ['App.tsx', 'index.tsx'].filter((f) => existsSync(join(root, f)));
for (const dir of ['components', 'hooks', 'utils', 'src']) {
  const walk = (p) => {
    for (const f of readdirSync(p)) {
      const q = join(p, f);
      if (statSync(q).isDirectory()) walk(q);
      else if (/\.(tsx?|jsx?)$/.test(f) && !/\.(check|smoke)\.ts$/.test(f)) files.push(q.slice(join(root).length + 1).split(sep).join('/'));
    }
  };
  if (existsSync(join(root, dir))) walk(join(root, dir));
}

const calls = [];
for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      const name = ts.isIdentifier(e)
        ? e.text
        : ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && GLOBALS.has(e.expression.text)
          ? e.name.text
          : null;
      if (name && NAMES.has(name)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        calls.push(`${file}:${line}  ${node.getText(sf).replace(/\s+/g, ' ').slice(0, 100)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (calls.length) {
  console.error(`check:dialogs: ${calls.length} alert()/confirm()/prompt() call${calls.length === 1 ? '' : 's'} in ${files.length} files:`);
  for (const c of calls) console.error('  ' + c);
  console.error('Use showStatusToast(...) or the Dialog (components/ui/Dialog.tsx) instead: a native dialog freezes playback.');
  process.exit(1);
}
console.log(`check:dialogs: 0 alert()/confirm()/prompt() calls in ${files.length} files.`);
