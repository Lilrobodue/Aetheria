#!/usr/bin/env node
// scripts/check-critical.mjs
//
// Pins the code the lock screen, the car and gapless playback depend on, so a
// change to any of it is deliberate and listed in the release notes rather
// than a side effect of unrelated work. The protected paths (see the roadmap's
// cross-cutting rules): the synchronous gapless swap and auto-advance, the
// silent media-session anchor, explicit pause/resume, the media-session wiring
// and the AudioContext teardown on unmount.
//
//   node scripts/check-critical.mjs            compare against scripts/critical-pins.json
//   node scripts/check-critical.mjs --update   rewrite the pins (only for an intended change)
//   node scripts/check-critical.mjs --root=DIR compare another checkout (e.g. the previous
//                                              release, via git worktree) against these pins
//
// Regions are found by name with the TypeScript compiler API (already a dev
// dependency), so line moves elsewhere in App.tsx never trip it. Text is
// hashed with LF line endings, so a CRLF checkout hashes the same.

import ts from 'typescript';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootArg = process.argv.find((a) => a.startsWith('--root='));
const root = rootArg ? rootArg.slice('--root='.length) : repoRoot;
const PINS_PATH = join(repoRoot, 'scripts', 'critical-pins.json');

/** `const NAME = …` declarations inside App.tsx (component scope or module scope). */
const APP_CONSTS = [
  'IS_MOBILE_DEVICE',
  'initAudio',
  'applyMusicElementVolume',
  'currentTrack',
  'AUTO_ADVANCE_LOOKAHEAD_S',
  'resolveNext',
  'tryGaplessAdvance',
  'handleAutoAdvance',
  'applyPlaybackRate',
  'setupAudioElement',
  'playTrack',
  'playNext',
  'SILENT_ANCHOR_ENABLED',
  'buildAnchorWavDataUrl',
  'ensureSilentAnchor',
  'startSilentAnchor',
  'stopSilentAnchor',
  'pausePlayback',
  'resumePlayback',
  'handlePlayPause',
  'handleNext',
  'handlePrev',
];

const REGIONS = [
  ...APP_CONSTS.map((name) => ({ id: `App.tsx#${name}`, file: 'App.tsx', kind: 'const', name })),
  { id: 'App.tsx#useMediaSession(...)', file: 'App.tsx', kind: 'call', name: 'useMediaSession' },
  { id: 'App.tsx#unmount-cleanup', file: 'App.tsx', kind: 'commented-statement', marker: '// Cleanup on unmount' },
  { id: 'App.tsx#keep-alive-effect', file: 'App.tsx', kind: 'commented-statement', marker: '// Wake lock + AudioContext keep-alive' },
  { id: 'App.tsx#watchdog-effect', file: 'App.tsx', kind: 'commented-statement', marker: '// Background-playback watchdog.' },
  // The refs the swap and the auto-advance read at run time.
  { id: 'App.tsx#stateRef-sync', file: 'App.tsx', kind: 'effect-containing', marker: 'stateRef.current = { playlist' },
  { id: 'App.tsx#handleAutoAdvanceRef-sync', file: 'App.tsx', kind: 'effect-containing', marker: 'handleAutoAdvanceRef.current = handleAutoAdvance' },
  { id: 'App.tsx#playNextRef-sync', file: 'App.tsx', kind: 'effect-containing', marker: 'playNextRef.current = playNext' },
  { id: 'hooks/useMediaSession.ts', file: 'hooks/useMediaSession.ts', kind: 'file' },
];

// LF line endings and no UTF-8 BOM, so a CRLF or BOM'd checkout hashes the same.
const lf = (s) => s.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const sha = (s) => createHash('sha256').update(lf(s), 'utf8').digest('hex');

const sources = new Map();
function source(file) {
  if (!sources.has(file)) {
    const text = readFileSync(join(root, file), 'utf8');
    sources.set(file, { text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) });
  }
  return sources.get(file);
}

function findAll(sf, predicate) {
  const out = [];
  const visit = (node) => {
    if (predicate(node)) out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function regionText(region) {
  const { text, sf } = source(region.file);
  if (region.kind === 'file') return [text];
  if (region.kind === 'const') {
    // The whole `const name = …;` statement.
    return findAll(sf, (n) =>
      ts.isVariableStatement(n) &&
      n.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === region.name)
    ).map((n) => n.getText(sf));
  }
  if (region.kind === 'call') {
    return findAll(sf, (n) =>
      ts.isExpressionStatement(n) &&
      ts.isCallExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === region.name
    ).map((n) => n.getText(sf));
  }
  if (region.kind === 'effect-containing') {
    // The useEffect(...) statement whose text contains the marker.
    return findAll(sf, (n) =>
      ts.isExpressionStatement(n) &&
      ts.isCallExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'useEffect' &&
      n.getText(sf).includes(region.marker)
    ).map((n) => n.getText(sf));
  }
  if (region.kind === 'commented-statement') {
    // A statement whose leading comment contains the marker.
    return findAll(sf, (n) => {
      if (!ts.isExpressionStatement(n)) return false;
      const ranges = ts.getLeadingCommentRanges(text, n.getFullStart()) || [];
      return ranges.some((r) => text.slice(r.pos, r.end).includes(region.marker));
    }).map((n) => n.getText(sf));
  }
  throw new Error(`unknown region kind ${region.kind}`);
}

const update = process.argv.includes('--update');
const current = {};
const problems = [];
for (const region of REGIONS) {
  const matches = regionText(region);
  if (matches.length !== 1) {
    problems.push(`${region.id}: expected exactly 1 match, found ${matches.length}`);
    continue;
  }
  current[region.id] = sha(matches[0]);
}

if (problems.length) {
  console.error('check:critical could not locate every protected region:');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

if (update) {
  const before = existsSync(PINS_PATH) ? JSON.parse(readFileSync(PINS_PATH, 'utf8')) : {};
  const changed = Object.keys(current).filter((k) => before[k] !== current[k]);
  writeFileSync(PINS_PATH, JSON.stringify(current, null, 2) + '\n', 'utf8');
  console.log(`critical-pins.json written (${Object.keys(current).length} regions).`);
  if (changed.length) {
    console.log('Changed or new — list these in the release notes:');
    for (const k of changed) console.log('  ' + k);
  }
  process.exit(0);
}

if (!existsSync(PINS_PATH)) {
  console.error('scripts/critical-pins.json is missing; create it with --update.');
  process.exit(1);
}
const pins = JSON.parse(readFileSync(PINS_PATH, 'utf8'));
const changed = Object.keys(current).filter((k) => pins[k] !== current[k]);
const removed = Object.keys(pins).filter((k) => !(k in current));
if (changed.length || removed.length) {
  console.error('check:critical: protected code changed. If this is intended, run with --update');
  console.error('and list the regions in the release notes.');
  for (const k of changed) console.error('  changed: ' + k);
  for (const k of removed) console.error('  removed: ' + k);
  process.exit(1);
}
console.log(`check:critical: ${Object.keys(current).length} protected regions unchanged.`);
