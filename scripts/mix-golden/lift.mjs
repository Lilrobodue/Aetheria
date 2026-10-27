// v15.8 golden harness: lift App.tsx's OWN mix code (whatever version is given) into a function the recorder can run,
// so the golden is captured from the code that ships, not from a hand copy.
//
// It finds, with the TypeScript AST:
//   - module-level functions (getHarmonicSolfeggio, distributeUsingHarmonicOctaves, …) where App.tsx still defines
//     them (v15.7); from v15.8 they come from their modules instead (cfg.moduleImports);
//   - App-component-level `const NAME = …` statements (the generators, autoDistribute, restoreLibrary, and from v15.8
//     mixInput and applyMix), by name, text verbatim;
//   - the classic drawer's inline preset arrows (`onClick={() => generateFrequencyPlaylist([...], '...')}`), by the
//     button's visible label, so the presets' crystal lists and names are read from App, never retyped;
//   - the Collection title list and file-name marker inside generateAetheriaJourney (string literals), so the dead
//     Collection paths can be exercised with in-memory names that never reach a file.
// It composes `makeApp(env)`, which destructures every free identifier from `env` (the recorder) and returns the
// functions, and transpiles it with the TypeScript compiler (types stripped, nothing else changed).

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function loadTs(repo) {
  const require = createRequire(repo + '/package.json');
  return require('typescript');
}

export const MODULE_FUNCS = ['getHarmonicSolfeggio', 'distributeUsingHarmonicOctaves', 'distributeUsingHarmonicOctavesMaster'];
export const APP_FUNCS = [
  'generateFilteredPlaylist', 'generateAlignmentJourney', 'generateHeartAlignmentJourney', 'generateHeadAlignmentJourney',
  'generateLoShuWalk', 'clearLoShuWalkMode', 'generateFullLibraryAlignment', 'generateFrequencyPlaylist',
  'generateWellnessPlaylist', 'generateMoodPlaylist', 'generateMeditationPlaylist', 'generateGoldenRatioPlaylist',
  'generate111PatternPlaylist', 'generateSourceFieldPlaylist', 'generateUltimateAlignmentPlaylist',
  'generateAetheriaJourney', 'showAetheriaTracksOnly', 'restoreLibrary', 'autoDistribute',
];
/** From v15.8: App's two mix functions, lifted with the generators (the recipes come from the modules). */
export const APP_FUNCS_V158 = ['mixInput', 'applyMix', ...APP_FUNCS];
// Every identifier the lifted code may read from App's scope or imports. Missing ones surface as ReferenceErrors.
export const ENV_NAMES = [
  'originalPlaylist', 'playlist', 'userExperienceLevel', 'isScanning', 'playHistoryRef', 'loShuWalkSnapshotRef',
  'playTrackRef', 'window', 'setTimeout', 'console',
  'setPlaylist', 'setOriginalPlaylist', 'setUseChakraOrder', 'setCurrentSongIndex', 'setSearchTerm', 'setShowSidebar',
  'setLoShuWalkMode', 'setLoShuWalkSegments', 'setLoShuWalkPhases', 'setVizSettings', 'setUserExperienceLevel',
  'setAnalysisNotification', 'setShowLoShuWalkMenu', 'setSelectedSolfeggio', 'showStatusToast', 'dismissStatusToast',
  'setInfoDialog',
  'SOLFEGGIO_INFO', 'LO_SHU_WALKS', 'LO_SHU_WALK_INFO', 'LO_SHU_WALK_COMBINED', 'LO_SHU_WALK_OUROBOROS',
  'OUROBOROS_PHASES', 'SOURCE_FREQ', 'dedupeById', 'patchById',
];
/** v15.9: what the generators and Restore Library read since every mix plays through startPlayOrder. */
export const ENV_NAMES_V159 = ['startPlayOrder', 'shellOnRef', 'stateRef', 'setShuffledIndices', 'setShufflePos', 'sameIdOrder',
  // the review's fixes: a mix's classic notice (applyMix), and a start still in flight (Restore Library)
  'mixNoticeRef', 'mainAudioRef', 'startedRequestRef', 'playRequestSeqRef', 'playStartBusyRef', 'blobUrlsRef'];

/** A button's label: its first line of text (a direct text child, or a <span>'s), e.g. "Qi Strength", "Grounding". */
export function buttonLabel(ts, sf, el) {
  for (const c of el.children) {
    const text = ts.isJsxText(c) ? c.getText(sf)
      : ts.isJsxElement(c) && c.openingElement.tagName.getText(sf) === 'span' ? c.children.map((x) => (ts.isJsxText(x) ? x.getText(sf) : '')).join(' ')
      : '';
    const line = text.replace(/\s+/g, ' ').trim();
    if (line) return line;
  }
  return '';
}

/** Does this App.tsx still define the mix helpers at module level (v15.7), or import them (v15.8)? */
export function definesModuleFuncs(ts, appText) {
  const sf = ts.createSourceFile('App.tsx', appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return sf.statements.some((st) => ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && MODULE_FUNCS.includes(d.name.text)));
}

/** Lift from App.tsx's text (a working file or `git show <rev>:App.tsx`). */
export function liftText(ts, appText, cfg = {}) {
  const sf = ts.createSourceFile('App.tsx', appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const moduleFuncs = cfg.moduleFuncs ?? MODULE_FUNCS;
  const appFuncs = cfg.appFuncs ?? APP_FUNCS;

  // Module level.
  const modText = {};
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && moduleFuncs.includes(d.name.text)) modText[d.name.text] = st.getText(sf);
    }
  }
  // The App component's body.
  let appBody = null;
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === 'App' && d.initializer && ts.isArrowFunction(d.initializer) && ts.isBlock(d.initializer.body)) appBody = d.initializer.body;
    }
  }
  if (!appBody) throw new Error('App component not found');
  const appText2 = {};
  for (const st of appBody.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && appFuncs.includes(d.name.text)) {
        if (appText2[d.name.text]) throw new Error('two declarations of ' + d.name.text);
        appText2[d.name.text] = st.getText(sf);
      }
    }
  }
  const missing = appFuncs.filter((n) => !appText2[n]);
  if (missing.length) throw new Error('App functions not found: ' + missing.join(', '));

  // The classic drawer's preset arrows, by label.
  const jsxArrows = {};
  // v15.9: the presets' neutral names; either name is the same button (one of them exists in any version).
  const labels = cfg.jsxLabels ?? { qi: ['Qi Strength', 'Grounding'], flow: ['Flow State', 'Flow'] };
  const visit = (n) => {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(sf) === 'button') {
      const text = buttonLabel(ts, sf, n);
      for (const [key, label] of Object.entries(labels)) {
        if ((Array.isArray(label) ? label : [label]).includes(text)) {
          const attr = n.openingElement.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'onClick');
          const expr = attr?.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : null;
          // v15.9: a preset's arrow calls generateFrequencyPlaylist ("Flow" is also a visual-settings toggle's label).
          if (expr && ts.isArrowFunction(expr) && expr.getText(sf).includes('generateFrequencyPlaylist(')) {
            if (jsxArrows[key]) throw new Error('two buttons labelled ' + label);
            jsxArrows[key] = expr.getText(sf);
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  for (const k of Object.keys(labels)) if (!jsxArrows[k]) throw new Error('no button labelled ' + [labels[k]].flat().join(' or '));

  // The Collection title list and the file marker (in-memory only).
  let titles = null;
  let marker = null;
  const aj = appBody.statements.find((st) => ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === 'generateAetheriaJourney'));
  if (aj) {
    const v2 = (n) => {
      if (ts.isArrayLiteralExpression(n) && n.elements.length >= 20 && n.elements.every((e) => ts.isStringLiteral(e))) titles = titles ?? n.elements.map((e) => e.text);
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'includes' && n.expression.expression.getText(sf) === 'song.file.name' && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) marker = marker ?? n.arguments[0].text;
      ts.forEachChild(n, v2);
    };
    v2(aj);
  }

  const envNames = [...new Set([...(cfg.envNames ?? ENV_NAMES), ...(cfg.moduleImports ? Object.keys(cfg.moduleImports) : [])])];
  const body = [
    `export function makeApp(env: any) {`,
    `  const { ${envNames.join(', ')} } = env;`,
    ...moduleFuncs.filter((n) => modText[n]).map((n) => modText[n]),
    ...appFuncs.map((n) => appText2[n]),
    `  const __jsx = { ${Object.entries(jsxArrows).map(([k, t]) => `${k}: ${t}`).join(', ')} };`,
    `  return { ${appFuncs.join(', ')}, __jsx };`,
    `}`,
  ].join('\n');
  const out = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.Preserve } }).outputText;
  const sha = (s) => createHash('sha256').update(s.replace(/\r\n?/g, '\n')).digest('hex').slice(0, 16);
  return {
    js: out,
    titles,
    marker,
    jsxArrows,
    provenance: {
      appSha: sha(appText),
      functions: Object.fromEntries([...moduleFuncs.filter((n) => modText[n]).map((n) => [n, sha(modText[n])]), ...appFuncs.map((n) => [n, sha(appText2[n])])]),
      moduleFuncsFromApp: moduleFuncs.filter((n) => modText[n]),
    },
  };
}

/** Lift from a checkout's App.tsx. */
export function extract(repo, cfg = {}) {
  return liftText(loadTs(cfg.tsRepo ?? repo), readFileSync(repo + '/App.tsx', 'utf8'), cfg);
}
