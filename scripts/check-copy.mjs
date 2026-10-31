#!/usr/bin/env node
// scripts/check-copy.mjs (v16.6, "How sure are we?": the copy pass's gate; review round 1, C1-C11)
//
// Fails on any user-visible text that uses a health-claim word without an evidence tag. The words are the plan's gate
// (heal, repair, DNA, pineal, cure, "safe for") and their relatives (therapy, treat, medical, detox, miracle,
// cellular, immune, proven, scientifically, "frequency of love"): scripts/copy-words.mjs, shared with the DOM gate
// (e2e/tests/copy-dom.spec.ts) and utils/copy/copy.check.ts. The user's decision (2026-10-28): strong health words are
// rewritten as traditional associations with an evidence tag ("Traditionally associated with ..." + Tradition), never
// kept bare, never silently removed.
//
//   node scripts/check-copy.mjs                    the repo
//   node scripts/check-copy.mjs --root=DIR         another checkout (the negative control: the previous release FAILS)
//   node scripts/check-copy.mjs --list             every hit with its verdict (tagged T1-T4 / allowed <kind> / FAIL)
//   node scripts/check-copy.mjs --update-manifest  rewrite scripts/copy-manifest.json (a reviewed change; list it)
//   node scripts/check-copy.mjs --self-test        the built-in fixtures only (no repo read)
//   npm run check:copy                             this, its self-test, then utils/copy/copy.check.ts
//
// What it reads: every file the app ships, by walking the checkout (review C9): .ts/.tsx/.js/.jsx/.mjs and .html, the
// app's manifest.json and metadata.json and public/**/*.json; not tests (*.check.ts, *.smoke.ts, *.spec.ts), configs
// (*.config.*), scripts/, tools/, e2e/, node_modules/, dist/. Text units: the TypeScript AST's string literals, template
// pieces and JSX text, and the flattened text of an inline run (<b>Safe</b> for …, review C11); JSON string values with
// a space; index.html's text and its title/content/alt/aria-label values. Comments and identifiers never count.
// Re-review (round 2): a string-literal object key is a unit like any literal ({ 'Deep healing': 1 } read by
// Object.keys); every .json file the app imports, wherever it lives, is scanned (each string with a letter).
//
// Code contexts are skipped, as the spec lists them and no wider (review C6): import/export specifiers; a direct
// argument of console.*, *.warn, *.warnOnce, *.log, *.error, new *Error(...), throw, localStorage/sessionStorage calls
// and the DOM query methods; a direct operand of ===/!==/==/!=, a case label, a type position, an element-access key; a
// property name written as an identifier, and the values of className, key, id, testid, icon, href, src; the JSX
// attributes className, key, id, style, role, type, href, src, rel, target, htmlFor and data-*. (.warn/.log/.error
// count as logging on console only: notice.error('…') is shown.) A literal with no whitespace is code ('preset:healing',
// 'dna_repair') unless it reads as a word a user could see: letters only, in any case, maybe hyphenated or in
// parentheses ('DNA', 'healing', 'detox', 'Self-healing', '(safe)'; review C2, round 2), or an operand of string
// concatenation ('Healing ' + hz).
//
// A hit passes when it is TAGGED:
//   T1  JSX: it sits inside an element carrying data-evidence="<tier>" that renders an <EvidenceTag> for sure: an
//       unconditional one, or one shown on the very condition that sets the block's data-evidence (review C5);
//   T2  data: it is a property value in an object literal that also has `tag: '<tier>'` (or `tags: [...]`, every one a
//       tier); the nearest object literal decides;
//   T3  it is a prop of <EvidenceTag> itself;
//   T4  it is a citation: the value of a `cite` property (the cited work's own title);
// or ALLOWED by scripts/copy-allow.json: { file, text, words, count, kind, reason[, exact][, within][, deadComponents]
// [, deadFunctions][, dom][, scope] }. An entry allows the units of `file` whose text contains `text` (equals it, with
// `exact`; inside the declaration `within`; inside one of `deadFunctions`), for the listed words; it must allow exactly
// `count` distinct units, each keyed by its position (a new occurrence, even on the same line, or a stale entry fails;
// review C3). `dom: { scope: "<css selector>", match?: "exact" }` lets the DOM gate use the entry inside that scope only;
// `"scope": "dom"` entries are the DOM gate's alone (text built at run time).
//
// THE MANIFEST (review C4): every flagged-word unit that passes, tagged or allowed, is listed in scripts/copy-manifest.json
// with its file, its exact text and its verdict (the tier for a tagged one, the kind for an allowed one). A new or
// changed flagged unit turns the gate red until the manifest is rewritten (--update-manifest), which makes every claim's
// tier an explicit, reviewed line in a diff; a flagged sentence slipped into a big tagged block can't pass unseen.
//
// Guards:
//   1. reads (review C7): no scanned file but constants.ts reads SOLFEGGIO_INFO's benefit/anatomy (any object's
//      .benefit/.anatomy, ['benefit'], a destructured { benefit }), the description of SOLFEGGIO_INFO's or
//      BINAURAL_PRESETS' rows, or UNIFIED_THEORY's section1/section2 (all data the copy pass no longer renders).
//      Round 2: through an alias (const rows = SOLFEGGIO_INFO, .filter/.slice/[i] of it, transitively, in the same
//      file) and through a computed key whose value is a string constant of the same file (const k = 'benefit'; r[k]).
//      Not decidable here, so left to the DOM gate: a key computed at run time (a parameter, a concatenation), an alias
//      or key constant imported from another file, a table passed through a function's parameter;
//   2. dead stays dead (review C8): a `dead` entry's deadComponents are never rendered (JSX, createElement) nor imported
//      or re-exported (export { default as X } from …) by any other file, under any name; its deadFunctions are never
//      imported, re-exported or referenced outside those files;
//   3. RETIRED: no retired phrase in any unit outside a `dead` or `data` entry's;
//   4. blocks and tags pair up: every <EvidenceTag> sits inside a data-evidence element, and every data-evidence
//      element renders a tag for sure (as T1 above; `{false && <EvidenceTag/>}` doesn't count, nor does a block whose
//      data-evidence is undefined, null, false or a word that isn't a tier);
//   5. tagged data is shown with its tag (review C5): a T2 hit's declaration must be listed in the allow file's
//      `taggedData` ({ file, decl, renderers, bare?, reason }). The gate finds every component that shows it (files that
//      import it, or import a model's export built from it, through up to four .ts hops) and each must be a listed
//      renderer holding a tagged block, or listed under `bare` with its reason (a name, not a claim); a component
//      missing from the list, or a listed one that no longer shows it, fails. A data row's `tag` can't pass text that
//      renders bare (v16.6's Library badges did). A renderer may be { file, via }: `file` hands the data to the
//      component file `via` (which it imports), and `via` holds the tagged block;
//   6. DOM scopes (round 2): an entry's dom.scope is a list of data-* attribute selectors ([data-testid="x"],
//      [data-x="y"], [data-x]), never body, html, * or a tag or class; each must be set in the entry's own file or a file
//      that imports it (two hops), so a scope can't be widened to the whole page or moved to another component.

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, sep, resolve, isAbsolute, basename } from 'node:path';
import { TIERS, WORDS, RETIRED, KINDS, retiredIn, wordsIn } from './copy-words.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : null;
};
const root = resolve(arg('root') ?? join(here, '..'));
const allowPath = arg('allow') ?? join(root, 'scripts', 'copy-allow.json');
const manifestPath = arg('manifest') ?? join(root, 'scripts', 'copy-manifest.json');
const LIST = process.argv.includes('--list');
const SELF = process.argv.includes('--self-test');
const UPDATE = process.argv.includes('--update-manifest');
// TypeScript's own parser (a devDependency), from this checkout unless --tsroot names another (a bare archive of an old
// release has no node_modules).
const tsRootArg = arg('tsroot');
const tsRoot = tsRootArg ? resolve(tsRootArg) : existsSync(join(root, 'node_modules', 'typescript')) ? root : join(here, '..');
const require = createRequire(join(isAbsolute(tsRoot) ? tsRoot : resolve(tsRoot), 'package.json'));
const ts = require('typescript');

const CODE_ATTRS = /^(className|key|id|style|role|type|href|src|rel|target|htmlFor)$/;
const CODE_PROPS = /^(className|key|id|testid|icon|href|src)$/;
/** A word a user could see, though written without a space: letters only (any case: a lowercase label can be shown
 *  capitalised), maybe hyphenated or parenthesised. Round 2: lowercase words count too. */
const wordish = (t) => /^\(?[A-Za-z]+(?:-[A-Za-z]+)*\)?$/.test(t);
const identLike = (s) => !/\s/.test(s) && /^[\w:.\-/#%[\]()]+$/.test(s) && !wordish(s);
const unwrap = (e) => {
  let x = e;
  while (x && (ts.isAsExpression(x) || ts.isParenthesizedExpression(x) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(x)) || ts.isTypeAssertionExpression(x))) x = x.expression;
  return x;
};
const INLINE = new Set(['b', 'strong', 'em', 'i', 'u', 'span', 'a', 'code', 'small', 'mark', 'sup', 'sub', 'br', 'abbr', 'q', 's', 'kbd']);
const TABLE_ROWS = ['SOLFEGGIO_INFO', 'BINAURAL_PRESETS'];
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** One TS/TSX source: its text units, its guarded reads, the components it renders or imports, its references. */
export function unitsOf(file, src) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : /\.m?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const out = [];
  const pos = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf));
  const isEl = (n) => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n);
  const jsxName = (n) => (ts.isJsxElement(n) ? n.openingElement.tagName.getText(sf) : ts.isJsxSelfClosingElement(n) ? n.tagName.getText(sf) : null);
  const attrsOf = (n) => (ts.isJsxElement(n) ? n.openingElement.attributes.properties : ts.isJsxSelfClosingElement(n) ? n.attributes.properties : []);
  const evidenceAttr = (n) => attrsOf(n).find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === 'data-evidence');

  // ---- blocks and their tags (T1, guard 4; review C5) ----
  /** The block's own condition: data-evidence={cond ? 'tier' : undefined} → "cond"; a plain value → null. */
  const blockCondition = (attr) => {
    const init = attr.initializer;
    if (!init || ts.isStringLiteral(init)) return null;
    const e = init.expression ? unwrap(init.expression) : null;
    if (e && ts.isConditionalExpression(e) && /^(?:undefined|null)$/.test(unwrap(e.whenFalse).getText(sf))) return unwrap(e.condition).getText(sf);
    return null;
  };
  /** The conditions a tag is shown on, from the tag up to `upto`: [] unconditional; ['false'] never. */
  const tagConditions = (tag, upto) => {
    const conds = [];
    let child = tag;
    for (let p = tag.parent; p && p !== upto; child = p, p = p.parent) {
      if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && p.right === child) conds.push(unwrap(p.left).getText(sf));
      if (ts.isConditionalExpression(p) && p.whenTrue === child) conds.push(unwrap(p.condition).getText(sf));
      if (ts.isConditionalExpression(p) && p.whenFalse === child) conds.push(`!(${unwrap(p.condition).getText(sf)})`);
    }
    return conds;
  };
  const tagsUnder = (n) => {
    const found = [];
    const v = (m) => {
      if (jsxName(m) === 'EvidenceTag') found.push(m);
      ts.forEachChild(m, v);
    };
    ts.forEachChild(n, v);
    return found;
  };
  /** A block that renders a tag for sure: data-evidence (a literal tier or an expression) and a tag that is unconditional,
   *  or shown on exactly the block's own condition; a literal `false` never shows. */
  const blockOk = (n) => {
    const a = evidenceAttr(n);
    if (!a || !a.initializer) return false;
    if (ts.isStringLiteral(a.initializer) && !TIERS.includes(a.initializer.text)) return false;
    // Review C5: data-evidence={undefined} (null, false, '', 0, a word that isn't a tier) is no block.
    const ev = a.initializer.expression ? unwrap(a.initializer.expression) : null;
    if (!ts.isStringLiteral(a.initializer)) {
      if (!ev) return false;
      const lit = (x) => /^(?:undefined|null|false|true|0|''|""|``)$/.test(x.getText(sf));
      if (lit(ev)) return false;
      if ((ts.isStringLiteral(ev) || ts.isNoSubstitutionTemplateLiteral(ev)) && !TIERS.includes(ev.text)) return false;
      if (ts.isConditionalExpression(ev)) {
        const t = unwrap(ev.whenTrue);
        if (lit(t) || ((ts.isStringLiteral(t) || ts.isNoSubstitutionTemplateLiteral(t)) && !TIERS.includes(t.text))) return false;
      }
    }
    const own = blockCondition(a);
    return tagsUnder(n).some((t) => {
      const c = tagConditions(t, n);
      if (c.some((x) => /^(?:false|0|null|undefined)$/.test(x))) return false;
      return c.length === 0 || (own !== null && c.length === 1 && c[0] === own);
    });
  };
  const tierOf = (n) => {
    const a = evidenceAttr(n);
    if (!a || !a.initializer) return '?';
    if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
    return `expr ${a.initializer.expression ? a.initializer.expression.getText(sf) : ''}`.slice(0, 80);
  };

  // ---- code contexts (review C6: the spec's list, direct relations only) ----
  const propName = (p) => (p.name ? p.name.getText(sf).replace(/^['"]|['"]$/g, '') : '');
  const codeCtx = (node) => {
    let n = node;
    let p = node.parent;
    // Through the wrappers that only build a string: a template, parentheses, +, a ternary's branch.
    while (
      p &&
      (ts.isTemplateSpan(p) || ts.isTemplateExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p) ||
        (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.PlusToken) ||
        (ts.isConditionalExpression(p) && p.condition !== n))
    ) {
      n = p;
      p = p.parent;
    }
    if (!p) return false;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isLiteralTypeNode(p) || ts.isTypeNode(p)) return true;
    if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && (p.arguments ?? []).includes(n)) {
      const t = p.expression.getText(sf);
      if (/^console\.\w+$/.test(t)) return true; // round 2: notice.error('…') is shown, so only console logs
      if (ts.isNewExpression(p) && /(?:^|\.)\w*Error$/.test(t)) return true;
      if (/^(?:window\.)?(?:localStorage|sessionStorage)\.\w+$/.test(t)) return true;
      if (/\.(?:querySelector|querySelectorAll|closest|matches|getElementById)$/.test(t)) return true;
      return false;
    }
    if (ts.isThrowStatement(p)) return true;
    if (ts.isBinaryExpression(p) && /^(?:===|!==|==|!=)$/.test(p.operatorToken.getText(sf))) return true;
    if (ts.isCaseClause(p) && p.expression === n) return true;
    if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return true;
    // Round 2: a string-literal key can be shown (Object.keys); an identifier key is never a literal.
    if (ts.isPropertyAssignment(p) && p.initializer === n && CODE_PROPS.test(propName(p))) return true;
    const attr = ts.isJsxAttribute(p) ? p : ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent) ? p.parent : null;
    if (attr) {
      const name = attr.name.getText(sf);
      return CODE_ATTRS.test(name) || name.startsWith('data-');
    }
    return false;
  };

  const taggedOf = (node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (isEl(p) && jsxName(p) === 'EvidenceTag') return { tagged: 'T3', tier: 'tag' };
      if (isEl(p) && blockOk(p)) return { tagged: 'T1', tier: tierOf(p) };
      if (p === node.parent && ts.isPropertyAssignment(p) && p.initializer === node && propName(p) === 'cite') return { tagged: 'T4', tier: 'cite' };
      if (ts.isObjectLiteralExpression(p)) {
        const tag = p.properties.find((q) => ts.isPropertyAssignment(q) && propName(q) === 'tag');
        const tv = tag ? unwrap(tag.initializer) : null;
        if (tv && ts.isStringLiteral(tv) && TIERS.includes(tv.text)) return { tagged: 'T2', tier: tv.text };
        const tags = p.properties.find((q) => ts.isPropertyAssignment(q) && propName(q) === 'tags');
        const ta = tags ? unwrap(tags.initializer) : null;
        if (ta && ts.isArrayLiteralExpression(ta) && ta.elements.length > 0 && ta.elements.every((e) => ts.isStringLiteral(unwrap(e)) && TIERS.includes(unwrap(e).text))) {
          return { tagged: 'T2', tier: ta.elements.map((e) => unwrap(e).text).join('+') };
        }
        break;
      }
    }
    return { tagged: null, tier: null };
  };
  const fnsOf = (node) => {
    const names = [];
    for (let p = node.parent; p; p = p.parent) {
      if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) names.push(p.name.getText(sf));
      if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parent) {
        const q = p.parent;
        if ((ts.isVariableDeclaration(q) || ts.isPropertyAssignment(q) || ts.isPropertyDeclaration(q)) && q.name) names.push(q.name.getText(sf));
      }
    }
    return names;
  };
  const declsOf = (node) => {
    const names = [];
    for (let p = node.parent; p; p = p.parent) if (ts.isVariableDeclaration(p) && p.name) names.push(p.name.getText(sf));
    return names;
  };
  const push = (node, text, extra = {}) => {
    const { line, character } = pos(node);
    out.push({ text: text.replace(/\s+/g, ' ').trim(), line: line + 1, col: character + 1, ...taggedOf(node), fns: fnsOf(node), decls: declsOf(node), ...extra });
  };

  // ---- the units ----
  const plusOperand = (node) => node.parent && ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken;
  const visit = (node) => {
    let s = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) s = node.text;
    if (s && /[a-z]/i.test(s) && !(ts.isStringLiteral(node) && identLike(s) && !plusOperand(node)) && !(!ts.isJsxText(node) && codeCtx(node))) push(node, s);
    // An inline run (review C11): <p><b>Safe</b> for …</p> reads as one phrase.
    if (isEl(node) && ts.isJsxElement(node) && INLINE.has(jsxName(node)) === false) {
      const kids = node.children;
      const inlineOnly = kids.length > 1 && kids.every((k) => ts.isJsxText(k) || (ts.isJsxExpression(k) && (!k.expression || ts.isStringLiteral(k.expression))) || (isEl(k) && INLINE.has(jsxName(k))));
      if (inlineOnly && kids.some((k) => isEl(k))) {
        const flat = (k) =>
          ts.isJsxText(k) ? k.text : ts.isJsxExpression(k) ? (k.expression && ts.isStringLiteral(k.expression) ? k.expression.text : ' ') : ts.isJsxElement(k) ? k.children.map(flat).join('') : ' ';
        const whole = kids.map(flat).join('').replace(/\s+/g, ' ').trim();
        const partWords = new Set();
        const collect = (k) => {
          if (ts.isJsxText(k)) for (const w of wordsIn(k.text)) partWords.add(w);
          else if (ts.isJsxExpression(k) && k.expression && ts.isStringLiteral(k.expression)) for (const w of wordsIn(k.expression.text)) partWords.add(w);
          else if (ts.isJsxElement(k)) k.children.forEach(collect);
        };
        kids.forEach(collect);
        if (wordsIn(whole).some((w) => !partWords.has(w))) push(node, whole, { inline: true });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // ---- guards' facts ----
  const reads = [];
  const rendered = [];
  const imports = []; // { spec, names }
  const refs = new Set();
  const structure = [];
  let hasJsx = false;
  let okBlocks = 0;
  // Guard 5's facts: each top-level declaration, whether it is exported, and the identifiers it uses.
  const topDecls = new Map();
  const exportedNames = new Set();
  for (const st of sf.statements) {
    const exported = !!(st.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const note = (name, node) => {
      const ids = new Set();
      const v = (m) => {
        if (ts.isIdentifier(m)) ids.add(m.text);
        ts.forEachChild(m, v);
      };
      v(node);
      topDecls.set(name, { exported, ids });
    };
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) note(d.name.text, d);
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) note(st.name.text, st);
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause) && !st.moduleSpecifier) for (const e of st.exportClause.elements) exportedNames.add((e.propertyName ?? e.name).text);
  }
  for (const nm of exportedNames) if (topDecls.has(nm)) topDecls.get(nm).exported = true;
  // Round 2: the same file's string constants (for computed keys) and its aliases of the guarded tables.
  const strConsts = new Map();
  const decls = [];
  const collect = (m) => {
    if (ts.isVariableDeclaration(m) && ts.isIdentifier(m.name) && m.initializer) {
      decls.push(m);
      const v = unwrap(m.initializer);
      if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) strConsts.set(m.name.text, v.text);
    }
    ts.forEachChild(m, collect);
  };
  collect(sf);
  const wordRe = (names) => new RegExp(`(?:^|[^\\w$])(?:${names.map((x) => x.replace(/[$]/g, '\\$')).join('|')})(?![\\w$])`);
  const aliasesOf = (base) => {
    const set = new Set(base);
    // An import under another name (import { SOLFEGGIO_INFO as TABLE }) is an alias too.
    for (const st of sf.statements) {
      const nb = ts.isImportDeclaration(st) ? st.importClause?.namedBindings : null;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) if (el.propertyName && set.has(el.propertyName.text)) set.add(el.name.text);
    }
    for (let changed = true; changed; ) {
      changed = false;
      const re = wordRe([...set]);
      for (const d of decls) {
        const nm = d.name.text;
        if (set.has(nm)) continue;
        const init = unwrap(d.initializer);
        // An alias: the table itself, a row of it, or a filtered / sliced / sorted / copied list of it.
        const root = (e) => {
          let x = unwrap(e);
          for (;;) {
            if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x) || ts.isNonNullExpression(x)) x = unwrap(x.expression);
            else if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && /^(?:filter|slice|sort|concat|reverse|at|find|findLast|toSorted|toReversed)$/.test(x.expression.name.text)) x = unwrap(x.expression.expression);
            else if (ts.isArrayLiteralExpression(x) && x.elements.length && x.elements.every((el) => ts.isSpreadElement(el))) x = unwrap(x.elements[0].expression);
            else break;
          }
          return x;
        };
        const r = root(init);
        if (ts.isIdentifier(r) && set.has(r.text) && re.test(init.getText(sf))) {
          set.add(nm);
          changed = true;
        }
      }
    }
    return [...set];
  };
  const TABLES = aliasesOf(TABLE_ROWS);
  const THEORY = aliasesOf(['UNIFIED_THEORY']);
  const keyOf = (n) => {
    if (ts.isPropertyAccessExpression(n)) return n.name.text;
    const a = unwrap(n.argumentExpression);
    if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return a.text;
    if (ts.isIdentifier(a) && strConsts.has(a.text)) return strConsts.get(a.text);
    return null;
  };
  const rootsInTable = (expr, namesIn) => {
    const names = namesIn === TABLE_ROWS ? TABLES : namesIn[0] === 'UNIFIED_THEORY' ? THEORY : namesIn;
    const re = wordRe(names);
    const t = expr.getText(sf);
    if (re.test(t)) return true;
    if (!ts.isIdentifier(expr)) return false;
    const id = expr.text;
    // A callback's parameter over a table (TABLE.map((s) => s.description)), or a variable set from one.
    for (let p = expr.parent; p; p = p.parent) {
      if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parameters.some((q) => q.name.getText(sf).includes(id)) && p.parent && ts.isCallExpression(p.parent)) {
        if (re.test(p.parent.expression.getText(sf))) return true;
      }
    }
    let hit = false;
    const v = (m) => {
      if (hit) return;
      if (ts.isVariableDeclaration(m) && m.name.getText(sf) === id && m.initializer && re.test(m.initializer.getText(sf))) hit = true;
      ts.forEachChild(m, v);
    };
    v(sf);
    return hit;
  };
  const g = (n) => {
    const line = () => pos(n).line + 1;
    // Guard 1 (reads).
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      const key = keyOf(n);
      if (key === 'benefit' || key === 'anatomy') reads.push(`${line()} .${key}`);
      if (key === 'description' && rootsInTable(n.expression, TABLE_ROWS)) reads.push(`${line()} a data table's .description`);
      if ((key === 'section1' || key === 'section2') && rootsInTable(n.expression, ['UNIFIED_THEORY'])) reads.push(`${line()} UNIFIED_THEORY.${key}`);
    }
    if (ts.isBindingElement(n) && n.parent && ts.isObjectBindingPattern(n.parent)) {
      const key = (n.propertyName ?? n.name).getText(sf);
      const pattern = n.parent;
      const holder = pattern.parent;
      const fromTable = (names) => {
        const re = wordRe(names === TABLE_ROWS ? TABLES : names[0] === 'UNIFIED_THEORY' ? THEORY : names);
        if (ts.isVariableDeclaration(holder) && holder.initializer) return re.test(holder.initializer.getText(sf));
        if (ts.isParameter(holder) && holder.parent && (ts.isArrowFunction(holder.parent) || ts.isFunctionExpression(holder.parent)) && holder.parent.parent && ts.isCallExpression(holder.parent.parent)) {
          return re.test(holder.parent.parent.expression.getText(sf));
        }
        return false;
      };
      if (key === 'benefit' || key === 'anatomy') reads.push(`${line()} { ${key} }`);
      if (key === 'description' && fromTable(TABLE_ROWS)) reads.push(`${line()} a data table's { description }`);
      if ((key === 'section1' || key === 'section2') && fromTable(['UNIFIED_THEORY'])) reads.push(`${line()} UNIFIED_THEORY's { ${key} }`);
    }
    // Guard 2 (dead): what is rendered, imported and referenced.
    const j = jsxName(n);
    if (j) rendered.push(j.split('.').pop());
    if (ts.isCallExpression(n) && /(?:^|\.)createElement$/.test(n.expression.getText(sf)) && n.arguments[0] && ts.isIdentifier(n.arguments[0])) rendered.push(n.arguments[0].text);
    // Round 2: a re-export is an import for the dead guard (export { default as Picker } from './FrequencySelector').
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      const names = [];
      if (n.exportClause && ts.isNamedExports(n.exportClause)) for (const e of n.exportClause.elements) names.push((e.propertyName ?? e.name).text);
      imports.push({ spec: n.moduleSpecifier.text, names });
    }
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const names = [];
      const c = n.importClause;
      if (c?.name) names.push(c.name.text);
      if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) names.push((e.propertyName ?? e.name).text);
      imports.push({ spec: n.moduleSpecifier.text, names });
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) imports.push({ spec: n.arguments[0].text, names: [] });
    if (ts.isIdentifier(n) && !(n.parent && ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) refs.add(n.text);
    if (isEl(n)) hasJsx = true;
    if (isEl(n) && evidenceAttr(n) && blockOk(n)) okBlocks++;
    // Guard 4 (blocks and tags).
    if (isEl(n)) {
      if (jsxName(n) === 'EvidenceTag') {
        let inBlock = false;
        for (let p = n.parent; p; p = p.parent) if (isEl(p) && evidenceAttr(p)) { inBlock = true; break; }
        if (!inBlock) structure.push(`${line()}: an EvidenceTag outside any data-evidence block`);
      } else if (evidenceAttr(n) && !blockOk(n)) structure.push(`${line()}: a data-evidence block that may not show its EvidenceTag`);
    }
    ts.forEachChild(n, g);
  };
  g(sf);
  return { units: out, reads, rendered, imports, refs, structure, topDecls, hasJsx, okBlocks };
}

function htmlUnits(src) {
  const out = [];
  const noTags = src.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  noTags.split(/\r?\n/).forEach((l, i) => {
    for (const m of l.matchAll(/(?:title|content|alt|aria-label)="([^"]*)"/g)) out.push({ text: m[1], line: i + 1, col: m.index + 1, tagged: null });
    const t = l.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (/[a-z]/i.test(t)) out.push({ text: t, line: i + 1, col: 0, tagged: null });
  });
  return out;
}
function jsonUnits(src) {
  const out = [];
  src.split(/\r?\n/).forEach((l, i) => {
    for (const m of l.matchAll(/"((?:[^"\\]|\\.)*)"\s*[,}\]:]?/g)) if (/[a-z]/i.test(m[1])) out.push({ text: m[1], line: i + 1, col: m.index + 1, tagged: null });
  });
  return out;
}

/** Problems with the allow-list's own shape (each fails the gate). */
export function entryProblems(allow) {
  const keys = WORDS.map(([w]) => w);
  const out = [];
  allow.forEach((e, i) => {
    const at = `entry ${i} (${e.file}: "${String(e.text).slice(0, 40)}")`;
    if (typeof e.file !== 'string' || !e.file) out.push(`${at}: no file`);
    if (typeof e.text !== 'string') out.push(`${at}: no text`);
    if (!KINDS.includes(e.kind)) out.push(`${at}: unknown kind ${e.kind}`);
    if (typeof e.reason !== 'string' || e.reason.trim().length < 8) out.push(`${at}: a reason is required`);
    if (!Array.isArray(e.words) || !e.words.length || e.words.some((w) => !keys.includes(w))) out.push(`${at}: words must be gate words`);
    if (e.text === '' && e.kind !== 'dead' && e.kind !== 'data') out.push(`${at}: an empty text (any unit of the file) is for 'dead' or 'data' only`);
    if (e.kind === 'brand' && !e.exact) out.push(`${at}: a brand entry is exact (review C3)`);
    if (e.scope === 'dom') {
      if (!e.text || !e.dom || typeof e.dom.scope !== 'string') out.push(`${at}: a DOM entry needs a text and a dom.scope`);
    } else if (!Number.isInteger(e.count) || e.count < 1) out.push(`${at}: count must be a whole number ≥ 1`);
    if (e.dom !== undefined && (typeof e.dom !== 'object' || typeof e.dom.scope !== 'string' || !e.dom.scope)) out.push(`${at}: dom needs a scope (a CSS selector)`);
    if (e.kind === 'dead' && (!Array.isArray(e.deadComponents) || !e.deadComponents.length)) out.push(`${at}: a 'dead' entry names its deadComponents`);
    if (e.within !== undefined && (typeof e.within !== 'string' || !e.within || (e.kind !== 'data' && e.kind !== 'dead'))) out.push(`${at}: 'within' names one declaration, for 'data' or 'dead' entries`);
  });
  return out;
}

const matches = (e, file, u) =>
  e.file === file &&
  (e.exact ? u.text === e.text : u.text.includes(e.text)) &&
  (!(e.kind === 'dead' && Array.isArray(e.deadFunctions) && e.deadFunctions.length) || (u.fns ?? []).some((n) => e.deadFunctions.includes(n))) &&
  (!e.within || (u.decls ?? []).includes(e.within));
const ownFile = (f, name) => f.endsWith(`/${name}.tsx`) || f === `${name}.tsx`;

// ---- guard 5: tagged data is shown with its tag (review C5) ----
const noExt = (f) => f.replace(/\.(tsx?|jsx?|mjs)$/, '').replace(/\/index$/, '');
/** The file an import in `from` names (relative specifiers only), without its extension. */
function importTarget(from, spec) {
  if (!spec.startsWith('.')) return null;
  const parts = from.split('/').slice(0, -1);
  for (const p of spec.split('/')) {
    if (p === '.' || p === '') continue;
    if (p === '..') parts.pop();
    else parts.push(p);
  }
  return noExt(parts.join('/'));
}
/** The components that show `decl` of `file`: importers with JSX; a .ts importer passes it on through its exports
 *  built from it (up to four hops); the declaring file itself when it has JSX using it. */
export function showersOf(file, decl, facts) {
  const out = new Set();
  const seen = new Set();
  const queue = [[file, decl, 0]];
  while (queue.length) {
    const [f, name, depth] = queue.shift();
    const k = `${f}|${name}`;
    if (seen.has(k) || depth > 4) continue;
    seen.add(k);
    const own = facts.get(f);
    if (own) {
      for (const [d, info] of own.topDecls) {
        if (d === name || !info.ids.has(name)) continue;
        if (own.hasJsx) out.add(f);
        else queue.push([f, d, depth + 1]); // a helper too: an export built on it passes it on
      }
    }
    for (const [g, fg] of facts) {
      if (g === f) continue;
      if (!fg.imports.some((im) => im.names.includes(name) && importTarget(g, im.spec) === noExt(f))) continue;
      if (fg.hasJsx) {
        out.add(g);
        continue;
      }
      for (const [d, info] of fg.topDecls) if (info.ids.has(name)) queue.push([g, d, depth + 1]);
    }
  }
  return out;
}
// ---- guard 6: DOM scopes (round 2) ----
/** A dom.scope's parts: each a data-* attribute selector, or null when the scope is not one. */
export function scopeParts(scope) {
  if (typeof scope !== 'string' || !scope.trim()) return null;
  const parts = scope.split(',').map((x) => x.trim());
  const out = [];
  for (const p of parts) {
    const m = /^\[(data-[a-z0-9-]+)(?:="([^"\]]*)")?\]$/.exec(p);
    if (!m) return null;
    out.push({ attr: m[1], value: m[2] ?? null });
  }
  return out;
}
function scopeProblems(allowAll, files, facts) {
  const out = [];
  const src = new Map(files.map((f) => [f.file, f.src]));
  const importersOf = (f) => [...facts].filter(([g, fg]) => g !== f && fg.imports.some((im) => importTarget(g, im.spec) === noExt(f))).map(([g]) => g);
  allowAll.forEach((e, i) => {
    if (!e.dom) return;
    const at = `entry ${i} (${e.file}: "${String(e.text).slice(0, 40)}")`;
    const parts = scopeParts(e.dom.scope);
    if (!parts) {
      out.push(`${at}: dom.scope "${e.dom.scope}" must be data-* attribute selectors (never body, html, * or a tag or class)`);
      return;
    }
    if (!src.has(e.file)) return; // the entry's own file is missing: its pin reports it
    const near = new Set([e.file]);
    for (const f of importersOf(e.file)) {
      near.add(f);
      for (const g of importersOf(f)) near.add(g);
    }
    for (const p of parts) {
      const lit = p.value === null ? null : new RegExp(`${p.attr}=(?:"${p.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"|\\{['"\`]${p.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]\\})`);
      const dyn = new RegExp(`${p.attr}=\\{(?!['"\`])`);
      const ok = [...near].some((f) => {
        const s = src.get(f) ?? '';
        return p.value === null ? s.includes(`${p.attr}=`) || s.includes(`${p.attr}\n`) : lit.test(s) || dyn.test(s);
      });
      if (!ok) out.push(`${at}: dom.scope ${p.attr}${p.value === null ? '' : `="${p.value}"`} is set in neither ${e.file} nor a file that imports it`);
    }
  });
  return out;
}

function taggedDataProblems(hits, facts, taggedData) {
  const out = [];
  const decls = new Map(); // "file|decl" -> [file, decl]
  for (const h of hits) {
    if (h.tagged !== 'T2') continue;
    const d = (h.decls ?? [])[(h.decls ?? []).length - 1];
    if (!d) {
      out.push(`tagged data: ${h.file}:${h.line}: a tagged row outside any declaration`);
      continue;
    }
    decls.set(`${h.file}|${d}`, [h.file, d]);
  }
  const used = new Set();
  for (const [key, [file, decl]] of decls) {
    const i = taggedData.findIndex((e) => e.file === file && e.decl === decl);
    if (i < 0) {
      out.push(`tagged data: ${decl} (${file}) holds tagged rows but has no taggedData entry naming where it shows`);
      continue;
    }
    used.add(i);
    const e = taggedData[i];
    const renderers = (e.renderers ?? []).map((r) => (typeof r === 'string' ? r : r.file));
    const vias = new Map((e.renderers ?? []).filter((r) => typeof r === 'object' && r).map((r) => [r.file, r.via]));
    const bare = (e.bare ?? []).map((b) => b.file);
    if (typeof e.reason !== 'string' || e.reason.trim().length < 8) out.push(`tagged data: ${decl}: a reason is required`);
    for (const b of e.bare ?? []) if (typeof b.reason !== 'string' || b.reason.trim().length < 8) out.push(`tagged data: ${decl}: the bare use in ${b.file} needs a reason`);
    const shows = showersOf(file, decl, facts);
    for (const s of shows) {
      if (renderers.includes(s)) {
        const via = vias.get(s);
        if (via) {
          const imported = (facts.get(s)?.imports ?? []).some((im) => importTarget(s, im.spec) === noExt(via));
          if (!imported) out.push(`tagged data: ${decl}: ${s} doesn't import ${via}, its listed renderer`);
          if (!(facts.get(via)?.okBlocks > 0)) out.push(`tagged data: ${decl} shows through ${via}, which has no tagged block`);
        } else if (!(facts.get(s)?.okBlocks > 0)) out.push(`tagged data: ${decl} shows in ${s}, which has no tagged block`);
      } else if (!bare.includes(s)) out.push(`tagged data: ${decl} (${file}) shows in ${s}, which isn't a listed renderer (tag it there) or a listed bare use`);
    }
    for (const s of [...renderers, ...bare]) if (!shows.has(s)) out.push(`tagged data: ${decl}: ${s} is listed but no longer shows it`);
  }
  taggedData.forEach((e, i) => {
    if (!used.has(i)) out.push(`tagged data: ${e.decl} (${e.file}) is listed but holds no tagged hit (a stale entry)`);
  });
  return out;
}
const ukey = (file, u) => `${file}:${u.line}:${u.col ?? 0}|${u.text}`;

export function scan(files /* [{file, src}] */, allowAll /* entries */, manifest /* units or null */ = null, taggedData /* entries or null (off) */ = null) {
  const allow = allowAll.filter((e) => e.scope !== 'dom');
  const facts = new Map(); // file -> { topDecls, hasJsx, okBlocks, imports }
  const hits = [];
  const reads = [];
  const renderedBy = new Map();
  const importsBy = [];
  const refsBy = new Map();
  const retired = [];
  const retiredUsed = [];
  const structure = [];
  for (const { file, src } of files) {
    let r;
    if (/\.(tsx?|jsx?|mjs)$/.test(file)) r = unitsOf(file, src);
    else if (/\.html$/.test(file)) r = { units: htmlUnits(src), reads: [], rendered: [], imports: [], refs: new Set(), structure: [] };
    else r = { units: jsonUnits(src), reads: [], rendered: [], imports: [], refs: new Set(), structure: [] };
    if (file !== 'constants.ts') for (const l of r.reads) reads.push(`${file}:${l}`);
    for (const p of r.structure) structure.push(`${file}:${p}`);
    for (const j of r.rendered) {
      if (!renderedBy.has(j)) renderedBy.set(j, []);
      renderedBy.get(j).push(file);
    }
    for (const im of r.imports) importsBy.push({ file, ...im });
    facts.set(file, { topDecls: r.topDecls ?? new Map(), hasJsx: !!r.hasJsx, okBlocks: r.okBlocks ?? 0, imports: r.imports });
    for (const id of r.refs) {
      if (!refsBy.has(id)) refsBy.set(id, new Set());
      refsBy.get(id).add(file);
    }
    for (const u of r.units) {
      const ws = wordsIn(u.text);
      for (const w of ws) hits.push({ file, line: u.line, col: u.col, word: w, text: u.text, tagged: u.tagged, tier: u.tier, fns: u.fns, decls: u.decls, inline: u.inline });
      const rp = retiredIn(u.text);
      if (rp.length) {
        const at = allow.findIndex((e) => (e.kind === 'dead' || e.kind === 'data') && matches(e, file, u));
        if (at >= 0) retiredUsed.push([at, ukey(file, u)]);
        const ok = at >= 0 || allow.some((e) => e.kind === 'dead' && (e.deadComponents ?? []).some((dc) => ownFile(file, dc)));
        if (!ok) retired.push({ file, line: u.line, phrases: rp, text: u.text });
      }
    }
  }
  const used = new Map();
  const fails = [];
  const passing = new Map(); // unit key -> { file, text, verdict, words }
  for (const h of hits) {
    const key = ukey(h.file, h);
    if (h.tagged) {
      h.verdict = `tagged ${h.tagged}`;
      const v = passing.get(key) ?? { file: h.file, text: h.text, verdict: `${h.tagged}:${h.tier}`, words: [] };
      v.words.push(h.word);
      passing.set(key, v);
      continue;
    }
    const i = allow.findIndex((e) => matches(e, h.file, h) && e.words.includes(h.word));
    if (i >= 0) {
      h.verdict = 'allowed ' + allow[i].kind;
      if (!used.has(i)) used.set(i, new Set());
      used.get(i).add(key);
      const v = passing.get(key) ?? { file: h.file, text: h.text, verdict: `allowed:${allow[i].kind}`, words: [] };
      v.words.push(h.word);
      passing.set(key, v);
      continue;
    }
    h.verdict = 'FAIL';
    const prev = fails.find((f) => f.key === key);
    if (prev) prev.words.push(h.word);
    else fails.push({ key, file: h.file, line: h.line, words: [h.word], text: h.text });
  }
  for (const [i, key] of retiredUsed) {
    if (!used.has(i)) used.set(i, new Set());
    used.get(i).add(key);
  }
  const pins = [];
  allow.forEach((e, i) => {
    const n = used.get(i)?.size ?? 0;
    if (n !== e.count) pins.push(`${e.file}: "${e.text.slice(0, 60)}" allows ${n} unit(s), pinned ${e.count}`);
    if (e.kind === 'dead') {
      const deadFile = (f) => (e.deadComponents ?? []).some((dc) => ownFile(f, dc));
      for (const dc of e.deadComponents ?? []) {
        const where = (renderedBy.get(dc) ?? []).filter((f) => !ownFile(f, dc));
        if (where.length) pins.push(`${dc} is rendered in ${[...new Set(where)].join(', ')}: its 'dead' entries no longer hold`);
        const imp = importsBy.filter((im) => !ownFile(im.file, dc) && basename(im.spec).replace(/\.(tsx?|jsx?)$/, '') === dc);
        if (imp.length) pins.push(`${dc} is imported by ${[...new Set(imp.map((x) => x.file))].join(', ')}: a dead component is imported by no one`);
      }
      for (const fn of e.deadFunctions ?? []) {
        const imp = importsBy.filter((im) => im.names.includes(fn) && !deadFile(im.file)).map((x) => x.file);
        const ref = [...(refsBy.get(fn) ?? [])].filter((f) => f !== e.file && !deadFile(f));
        const where = [...new Set([...imp, ...ref])];
        if (where.length) pins.push(`${fn} is imported or used in ${where.join(', ')}: only the dead ${e.deadComponents.join(' / ')} may use it`);
      }
    }
  });
  pins.push(...entryProblems(allowAll));
  pins.push(...structure.map((p) => `blocks and tags: ${p}`));
  if (taggedData) pins.push(...taggedDataProblems(hits, facts, taggedData));
  pins.push(...scopeProblems(allowAll, files, facts));
  // The manifest (review C4): the passing flagged units, as reviewed.
  const units = [...passing.values()].map((v) => ({ file: v.file, verdict: v.verdict, words: [...new Set(v.words)].sort().join(','), text: v.text }));
  units.sort((a, b) => (a.file + a.text + a.verdict < b.file + b.text + b.verdict ? -1 : 1));
  const drift = [];
  if (manifest) {
    const key = (u) => `${u.file}|${u.verdict}|${u.text}`;
    const want = new Map();
    for (const u of manifest) want.set(key(u), (want.get(key(u)) ?? 0) + 1);
    const have = new Map();
    for (const u of units) have.set(key(u), (have.get(key(u)) ?? 0) + 1);
    for (const [k, n] of have) if ((want.get(k) ?? 0) < n) drift.push(`new or changed: ${k.slice(0, 200)}`);
    for (const [k, n] of want) if ((have.get(k) ?? 0) < n) drift.push(`gone or changed: ${k.slice(0, 200)}`);
  }
  return { hits, fails, pins, reads, retired, units, drift };
}

// ---- the files the app ships (review C9) ----
const SKIP_DIRS = new Set(['node_modules', 'e2e', 'scripts', 'tools', 'dist', '.git', 'test-results', 'parity-baseline', '.vite', 'android', 'ios']);
function repoFiles() {
  const files = [];
  const walk = (dir, rel) => {
    for (const f of readdirSync(dir)) {
      const q = join(dir, f);
      const r = rel ? `${rel}/${f}` : f;
      let st;
      try {
        st = statSync(q);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(f) && !f.startsWith('.')) walk(q, r);
        continue;
      }
      if (/\.(check|smoke|spec|test)\.[cm]?[jt]sx?$/.test(f) || /\.config\.[cm]?[jt]s$/.test(f) || f.endsWith('.d.ts')) continue;
      if (/\.(tsx?|jsx?|mjs|html)$/.test(f)) files.push(r);
      else if (/\.json$/.test(f) && (r === 'manifest.json' || r === 'metadata.json' || r.startsWith('public/'))) files.push(r);
    }
  };
  walk(root, '');
  // Round 2: every .json the shipped code imports, wherever it lives (not node_modules).
  const extra = new Set();
  for (const f of files) {
    if (!/\.(tsx?|jsx?|mjs)$/.test(f)) continue;
    const s = readFileSync(join(root, f), 'utf8');
    for (const m of s.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+\.json)['"]/g)) {
      const t = importTarget(f, m[1]);
      const rel = t && !t.endsWith('.json') ? `${t}.json` : t;
      if (rel && !rel.startsWith('..') && !rel.includes('node_modules') && existsSync(join(root, rel)) && !files.includes(rel)) extra.add(rel);
    }
  }
  files.push(...extra);
  return files.sort().map((file) => ({ file, src: readFileSync(join(root, file), 'utf8') }));
}

function selfTest() {
  const F = (src, file = 'X.tsx') => [{ file, src }];
  const A = (o) => ({ file: 'X.tsx', words: ['medical'], count: 1, kind: 'negation', reason: 'a test entry', ...o });
  const red = (r) => r.fails.length + r.pins.length + r.retired.length + r.reads.length;
  const cases = [
    ['an untagged string fails', F(`const a = 'This tone heals.';`), [], 1],
    ['a comment never counts', F(`// heals the body\nconst a = 1;`), [], 0],
    ['an identifier never counts', F(`const healTone = dnaScore + 1;`), [], 0],
    ['an identifier-like literal never counts', F(`const id = 'preset:healing'; const k = 'dna_repair';`), [], 0],
    // Round 2: lowercase words, string keys, logs on other objects.
    ['R2: title="healing" fails', F(`const C = () => <span title="healing" />;`), [], 1],
    ["R2: { label: 'detox' } fails", F(`const B = { label: 'detox' };`), [], 1],
    ["R2: { 'Deep healing': 1 } (a key read by Object.keys) fails", F(`const B = { 'Deep healing': 1 };`), [], 1],
    ["R2: notice.error('Repairs DNA') fails", F(`notice.error('Repairs DNA');`), [], 1],
    ["R2: console.error('Repairs DNA') never counts", F(`console.error('Repairs DNA');`), [], 0],
    ['R2: an alias of a table reading .description fails', F(`const rows = SOLFEGGIO_INFO; const d = rows.map((r) => r.description);`), [], 1],
    ['R2: an import alias of a table reading .description fails', F(`import { SOLFEGGIO_INFO as TABLE } from './constants';
const rows = TABLE; const d = rows.map((r) => r.description);`), [], 1],
    ['R2: a filtered alias, destructured, fails', F(`const some = SOLFEGGIO_INFO.filter((x) => x.order); const { description } = some[0];`), [], 1],
    ["R2: r[k] with k = 'benefit' fails", F(`const k = 'benefit'; const b = SOLFEGGIO_INFO[0][k];`), [], 1],
    ['R2: an unrelated .description passes', F(`const arrows = 1; const d = props.description;`), [], 0],
    ['console text never counts', F(`console.log('DNA repair');`), [], 0],
    ['JSX text untagged fails', F(`const C = () => <p>Repairs DNA</p>;`), [], 1],
    ['a tagged block passes (T1)', F(`const C = () => <div data-evidence="tradition"><p>Traditionally associated with healing</p><EvidenceTag tier="tradition" /></div>;`), [], 0],
    ['a block WITHOUT a tag fails (the hit, and the bare block)', F(`const C = () => <div data-evidence="tradition"><p>Traditionally associated with healing</p></div>;`), [], 2],
    ['a block naming an unknown tier fails', F(`const C = () => <div data-evidence="maybe"><p>Traditionally associated with healing</p><EvidenceTag tier="tradition" /></div>;`), [], 2],
    ['a data entry with tag passes (T2)', F(`const X = [{ hz: 528, association: 'Traditionally associated with DNA repair', tag: 'tradition' }];`), [], 0],
    ['a data entry with an unknown tag fails', F(`const X = [{ hz: 528, association: 'Traditionally associated with DNA repair', tag: 'maybe' }];`), [], 1],
    ['a citation passes (T4)', F(`const R = [{ cite: 'Music therapy for depression. Cochrane.' }];`), [], 0],
    ['an allow-list entry passes at its count', F(`const a = 'not a medical device';`), [A({ text: 'not a medical device' })], 0],
    ['an exact entry allows only its exact text', F(`const C = () => <><b>DNA</b><i>more DNA</i></>;`), [A({ text: 'DNA', exact: true, words: ['DNA'], kind: 'score-name' })], 1],
    ['a DOM-only entry allows nothing here', F(`const a = 'more DNA'; const C = () => <p data-x="1" />;`), [A({ text: 'DNA', scope: 'dom', dom: { scope: '[data-x]' }, words: ['DNA'], kind: 'score-name', count: undefined })], 1],
    ['a retired phrase fails, even with no gate word', F(`const a = 'This gives EXCELLENT match results.';`), [], 1],
    ['a retired phrase in a data entry passes', [{ file: 'constants.ts', src: `export const X = [{ d: 'Deep Sleep & Healing (0.5-4Hz).' }];` }], [{ file: 'constants.ts', text: 'Deep Sleep & Healing', words: ['heal'], count: 1, kind: 'data', reason: 'a test entry' }], 0],
    ['an entry without a reason fails', F(`const a = 'not a medical device';`), [A({ text: 'not a medical device', reason: '' })], 1],
    // Review C2: one-word and hyphenated literals that read as words.
    ["C2: text: () => 'DNA' in untagged data fails", F(`const B = [{ id: 'dna', text: () => 'DNA' }];`), [], 1],
    ["C2: { label: 'DNA' } fails", F(`const B = { label: 'DNA' };`), [], 1],
    ["C2: 'Self-healing' fails", F(`const B = { label: 'Self-healing' };`), [], 1],
    ["C2: 'DNA-repair' fails", F(`const B = { label: 'DNA-repair' };`), [], 1],
    ["C2: '(safe)' fails", F(`const B = { label: '(safe)' };`), [], 1],
    // Review C3: a second motto on the same line; a motto made into a claim.
    ['C3: a second motto on the same line breaks the pin', F(`const a = <><p>Healing the world heART</p><p>Healing the world heART</p></>;`), [A({ text: 'Healing the world heART', exact: true, words: ['heal'], kind: 'brand' })], 1],
    ['C3: "Healing the world heART: these tones heal you" fails', F(`const a = <p>Healing the world heART: these tones heal you</p>;`), [A({ text: 'Healing the world heART', exact: true, words: ['heal'], kind: 'brand' })], 2],
    ['C3: a brand entry must be exact', F(`const a = <p>Healing the world heART</p>;`), [A({ text: 'Healing the world heART', words: ['heal'], kind: 'brand' })], 1],
    // Review C5: a tag that never shows.
    ['C5: {false && <EvidenceTag/>} fails', F(`const C = () => <div data-evidence="tradition"><p>Traditionally associated with healing</p>{false && <EvidenceTag tier="tradition" />}</div>;`), [], 2],
    ['C5: a tag on another condition than the block fails', F(`const C = ({ a, b }) => <div data-evidence={a ? 'design' : undefined}><p>healing</p>{b ? <EvidenceTag tier="design" /> : null}</div>;`), [], 2],
    ['C5: a block whose tag shows on its own condition pairs', F(`const C = ({ on }) => <div data-evidence={on ? 'design' : undefined}><p>x</p>{on ? <EvidenceTag tier="design" /> : null}</div>;`), [], 0],
    ['C5: data-evidence={undefined} is no block', F(`const C = () => <div data-evidence={undefined}><p>healing</p><EvidenceTag tier="design" /></div>;`), [], 2],
    ["C5: data-evidence={on ? 'maybe' : undefined} is no block", F(`const C = ({ on }) => <div data-evidence={on ? 'maybe' : undefined}><p>x</p>{on ? <EvidenceTag tier="design" /> : null}</div>;`), [], 1],
    ['blocks and tags: a tag outside any block fails', F(`const C = () => <div><p>Shape</p><EvidenceTag tier="design" /></div>;`), [], 1],
    // Review C6: the code-context skips, the spec's list only.
    ["C6: showError('Repairs DNA') fails", F(`showError('Repairs DNA');`), [], 1],
    ["C6: x.includes('Repairs DNA') fails", F(`const a = x.includes('Repairs DNA');`), [], 1],
    ["C6: ({ a: 'Repairs DNA' })['a'] fails", F(`const a = ({ a: 'Repairs DNA' })['a'];`), [], 1],
    ['C6: <input value="Repairs DNA" /> fails', F(`const C = () => <input value="Repairs DNA" />;`), [], 1],
    ["C6: throw new Error('heal') never counts", F(`throw new Error('Repairs DNA');`), [], 0],
    // Review C7: the reads.
    ['C7: a destructured { benefit } fails', F(`const { benefit } = SOLFEGGIO_INFO[0];`), [], 1],
    ["C7: ['benefit'] fails", F(`const b = SOLFEGGIO_INFO[0]['benefit'];`), [], 1],
    ["C7: SOLFEGGIO_INFO's .description fails", F(`const b = SOLFEGGIO_INFO[0].description;`), [], 1],
    ['C7: a table callback reading .description fails', F(`const b = SOLFEGGIO_INFO.map((s) => s.description);`), [], 1],
    ['C7: UNIFIED_THEORY.section1 fails', F(`const b = UNIFIED_THEORY.section1.content;`), [], 1],
    ['C7: a kit prop .description passes', F(`const b = props.description;`), [], 0],
    // Review C11: concatenation, inline runs, the new words.
    ["C11: 'Healing ' + hz fails", F(`const a = 'Healing ' + hz;`), [], 1],
    ['C11: <b>Safe</b> for long sessions fails', F(`const C = () => <p><b>Safe</b> for long sessions</p>;`), [], 1],
    ['C11: medicinal / love frequency fail', F(`const a = 'A medicinal tone'; const b = 'The love frequency';`), [], 2],
  ];
  let bad = 0;
  const report = (ok, name, got, want) => {
    if (!ok) {
      bad++;
      console.error(`  FAIL ${name}${got !== undefined ? `: ${got} failures, wanted ${want}` : ''}`);
    } else console.log(`  ok   ${name}`);
  };
  for (const [name, files, allow, want] of cases) {
    const r = scan(files, allow);
    report(red(r) === want, name, red(r), want);
  }
  const drift = scan(F(`const a = 'not a medical device'; const b = 'not a medical device, again';`), [A({ text: 'not a medical device' })]);
  report(drift.pins.length === 1, 'a second occurrence breaks the pin');
  const stale = scan(F(`const a = 1;`), [A({ text: 'gone', words: ['heal'] })]);
  report(stale.pins.length === 1, 'a stale entry fails');
  const deadE = { file: 'components/Old.tsx', text: '', words: ['heal'], count: 1, kind: 'dead', deadComponents: ['Old'], reason: 'a test entry' };
  const old = { file: 'components/Old.tsx', src: `const Old = () => <p>heals</p>;` };
  report(scan([old, { file: 'App.tsx', src: `const A = () => <Old />;` }], [deadE]).pins.length >= 1, 'a re-mounted dead component fails');
  report(scan([old, { file: 'App.tsx', src: `const A = () => <div>{/* <Old /> */}</div>;` }], [deadE]).pins.length === 0, 'a commented-out mount stays dead');
  report(scan([old, { file: 'App.tsx', src: `import Gone from './components/Old';\nconst A = 1;` }], [deadE]).pins.length === 1, 'C8: importing a dead component under another name fails');
  report(scan([old, { file: 'App.tsx', src: `import Old from './components/Old';\nconst A = React.createElement(Old);` }], [deadE]).pins.length >= 1, 'C8: createElement(dead) fails');
  const fnE = { file: 'utils/w.ts', text: 'healing', words: ['heal'], count: 1, kind: 'dead', deadComponents: ['Old'], deadFunctions: ['warn'], reason: 'a test entry' };
  const w = { file: 'utils/w.ts', src: `export const warn = () => 'Sound healing training';` };
  report(scan([w, { file: 'components/Old.tsx', src: `const Old = () => <p>{warn()}</p>;` }], [fnE]).pins.length === 0, 'a dead function used only by its dead component passes');
  report(scan([w, { file: 'App.tsx', src: `const A = () => <p>{warn()}</p>;` }], [fnE]).pins.length >= 1, 'a dead function called from a live file fails');
  report(scan([w, { file: 'App.tsx', src: `import { warn as w2 } from './utils/w';\nconst x = 1;` }], [fnE]).pins.length >= 1, 'C8: a dead function imported under an alias fails');
  const inside = scan([{ file: 'utils/w.ts', src: `export const warn = () => 'Sound healing training'; export const live = () => 'healing again';` }, { file: 'components/Old.tsx', src: `const Old = () => <p>{warn()}</p>;` }], [{ ...fnE, text: '' }]);
  report(inside.fails.length === 1 && inside.pins.length === 0, 'a deadFunctions entry allows only the units inside those functions');
  report(scan([{ file: 'components/Old.tsx', src: `const Old = () => <p>Focus on feeling rather than hearing.</p>;` }, w], [fnE]).retired.length === 0, "a retired phrase in a proven-dead component's own file passes");
  const tableE = { file: 'constants.ts', text: '', within: 'TABLE', words: ['heal'], count: 2, kind: 'data', reason: 'a test entry' };
  const table = scan([{ file: 'constants.ts', src: "export const TABLE = [{ d: 'Deep Sleep & Healing' }, { d: 'acts as natural anesthetic' }];\nexport const LIVE = [{ d: 'healing here' }];" }], [tableE]);
  report(table.fails.length === 1 && table.retired.length === 0 && table.pins.length === 0, "a 'within' entry allows its table only, and pins its retired-phrase units too");
  report(scan(F(`const C = () => <p>{SOLFEGGIO_INFO[0].benefit}</p>;`), []).reads.length === 1, 'a read of .benefit fails');
  // Review C5, guard 5: tagged data shows with its tag.
  const td = (reason = 'a test entry') => [{ file: 'utils/b.ts', decl: 'BADGES', renderers: ['components/Info.tsx'], reason }];
  const bData = { file: 'utils/b.ts', src: `export const BADGES = [{ id: 'dna', text: () => 'DNA', tag: 'design' }];\nexport const badgesOf = () => BADGES.map((b) => b.text());` };
  const info = { file: 'components/Info.tsx', src: `import { BADGES } from '../utils/b';\nconst I = () => <div data-evidence="design"><p>{BADGES[0].text()}</p><EvidenceTag tier="design" /></div>;` };
  const row = { file: 'components/Row.tsx', src: `import { badgesOf } from '../utils/b';\nconst R = () => <span>{badgesOf()[0]}</span>;` };
  report(scan([bData, info], [], null, td()).pins.length === 0, 'C5: tagged data shown only by its listed, tagged renderer passes');
  report(scan([bData, info], [], null, []).pins.length === 1, 'C5: tagged data with no taggedData entry fails');
  report(scan([bData, info, row], [], null, td()).pins.length === 1, 'C5: tagged data shown bare through a model function (the Library badges) fails');
  report(scan([bData, info, row], [], null, [{ ...td()[0], bare: [{ file: 'components/Row.tsx', reason: 'a name, not a claim' }] }]).pins.length === 0, 'C5: a listed bare use with its reason passes');
  report(scan([bData, { ...info, src: info.src.replace(' data-evidence="design"', '').replace('<EvidenceTag tier="design" />', '') }], [], null, td()).pins.length === 1, 'C5: a listed renderer without a tagged block fails');
  report(scan([bData], [], null, td()).pins.length === 1, 'C5: a listed renderer that no longer shows it fails');
  // Round 2: re-exports, scopes, renderers via a child.
  report(scan([old, { file: 'components/index.ts', src: `export { default as Picker } from './Old';` }], [deadE]).pins.length >= 1, 'R2: a re-export of a dead component fails');
  report(scan([w, { file: 'App.tsx', src: `export { warn } from './utils/w';` }], [fnE]).pins.length >= 1, 'R2: a re-export of a dead function fails');
  const sE = (scope) => ({ file: 'components/S.tsx', text: 'not a medical device', words: ['medical'], count: 1, kind: 'negation', reason: 'a test entry', dom: { scope } });
  const sFiles = [{ file: 'components/S.tsx', src: `const S = () => <p data-testid="s-root">It is not a medical device.</p>;` }, { file: 'components/T.tsx', src: `const T = () => <p data-testid="other">x</p>;` }];
  report(scan(sFiles, [sE('[data-testid="s-root"]')]).pins.length === 0, 'R2: a scope set in its own component passes');
  report(scan(sFiles, [sE('body')]).pins.length === 1, 'R2: a scope widened to body fails');
  report(scan(sFiles, [sE('[data-testid="s-root"], *')]).pins.length === 1, 'R2: a scope with * fails');
  report(scan(sFiles, [sE('[data-testid="other"]')]).pins.length === 1, "R2: a scope set in another component (not an importer) fails");
  report(scan([...sFiles, { file: 'components/Host.tsx', src: `import S from './S';\nconst H = () => <div data-testid="host"><S /></div>;` }], [sE('[data-testid="host"]')]).pins.length === 0, 'R2: a scope set by a component that imports it passes');
  const viaTd = [{ file: 'utils/b.ts', decl: 'BADGES', renderers: [{ file: 'components/Row.tsx', via: 'components/Chips.tsx' }], reason: 'a test entry' }];
  const rowVia = { file: 'components/Row.tsx', src: `import { badgesOf } from '../utils/b';\nimport Chips from './Chips';\nconst R = () => <Chips items={badgesOf()} />;` };
  const chips = (tagged) => ({ file: 'components/Chips.tsx', src: tagged ? `const Chips = ({ items }) => <div data-evidence="design">{items[0]}<EvidenceTag tier="design" /></div>;` : `const Chips = ({ items }) => <div>{items[0]}</div>;` });
  report(scan([bData, rowVia, chips(true)], [], null, viaTd).pins.length === 0, 'R2: a renderer via the child that holds the tagged block passes');
  report(scan([bData, rowVia, chips(false)], [], null, viaTd).pins.length === 1, 'R2: a renderer via a child without a tagged block fails');
  // Review C4: the manifest.
  const base = F(`const C = () => <div data-evidence="tier1"><p>Music therapy helps.</p><EvidenceTag tier="tier1" /></div>;`);
  const m0 = scan(base, []).units;
  report(scan(base, [], m0).drift.length === 0, 'C4: the manifest holds as reviewed');
  const added = F(`const C = () => <div data-evidence="tier1"><p>Music therapy helps.</p><p>These tones heal you.</p><EvidenceTag tier="tier1" /></div>;`);
  report(scan(added, [], m0).drift.length === 1, 'C4: a new flagged sentence inside a tagged block fails until reviewed');
  report(scan(F(`const X = [{ blurb: 'Repairs DNA', tag: 'tier1' }];`), [], []).drift.length === 1, "C4: { blurb: 'Repairs DNA', tag: 'tier1' } fails until reviewed");
  const para = F(`const a = 'It is not a medical device.';`);
  const pa = [A({ text: 'not a medical device' })];
  report(scan(F(`const a = 'It is not a medical device, and it heals.';`), [A({ text: 'not a medical device', words: ['medical', 'heal'] })], scan(para, pa).units).drift.length >= 1, 'C4: a changed allowed paragraph fails until reviewed');
  return bad;
}

if (SELF) {
  const bad = selfTest();
  console.log(bad ? `check:copy self-test: ${bad} failed` : 'check:copy self-test: all passed');
  process.exit(bad ? 1 : 0);
}
const allowJson = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, 'utf8')) : { entries: [], taggedData: [] };
const allow = allowJson.entries ?? [];
const taggedData = Array.isArray(allowJson.taggedData) ? allowJson.taggedData : [];
const manifest = existsSync(manifestPath) && !UPDATE ? JSON.parse(readFileSync(manifestPath, 'utf8')).units : UPDATE ? null : [];
const files = repoFiles();
const r = scan(files, allow, manifest, taggedData);
if (UPDATE) {
  const body = {
    version: 1,
    about:
      "check:copy's manifest (v16.6, review C4): every flagged-word unit that passes, with its verdict (T1/T2 and the tier, T3, T4, or allowed:<kind>). A new or changed flagged unit fails the gate until this is rewritten with `node scripts/check-copy.mjs --update-manifest`: a reviewed change, listed in the commit.",
    units: r.units,
  };
  writeFileSync(manifestPath, JSON.stringify(body, null, 1).replace(/\n/g, '\r\n') + '\r\n');
  console.log(`check:copy: the manifest now lists ${r.units.length} flagged units (${manifestPath}).`);
}
if (LIST) {
  for (const h of r.hits) console.log(`${h.verdict.padEnd(18)} ${h.file}:${h.line} [${h.word}]${h.inline ? ' (inline run)' : ''} ${h.text.slice(0, 140)}`);
  for (const x of r.retired) console.log(`${'RETIRED'.padEnd(18)} ${x.file}:${x.line} [${x.phrases.join(', ')}] ${x.text.slice(0, 140)}`);
}
const byFile = {};
for (const h of r.fails) byFile[h.file] = (byFile[h.file] ?? 0) + 1;
const drift = UPDATE ? [] : r.drift;
if (r.fails.length || r.pins.length || r.reads.length || r.retired.length || drift.length) {
  console.error(
    `check:copy: ${r.fails.length} untagged hit(s) in ${Object.keys(byFile).length} file(s), ${r.retired.length} retired phrase(s), ` +
      `${r.pins.length} allow-list problem(s), ${r.reads.length} guarded read(s), ${drift.length} manifest change(s) (${files.length} files scanned)`
  );
  for (const [f, n] of Object.entries(byFile).sort()) console.error(`  ${String(n).padStart(3)}  ${f}`);
  if (!LIST) {
    for (const h of r.fails.slice(0, 400)) console.error(`  ${h.file}:${h.line} [${h.words.join(', ')}] ${h.text.slice(0, 120)}`);
    for (const x of r.retired) console.error(`  retired: ${x.file}:${x.line} [${x.phrases.join(', ')}] ${x.text.slice(0, 100)}`);
  }
  for (const p of r.pins) console.error(`  pin: ${p}`);
  for (const p of r.reads) console.error(`  read: ${p}`);
  for (const d of drift.slice(0, 60)) console.error(`  manifest: ${d}`);
  if (drift.length) console.error('  A flagged unit changed: review it, then run node scripts/check-copy.mjs --update-manifest and list the change.');
  console.error('Rewrite it as a traditional association with an evidence tag (spec v16.6 §3), or allow-list it with a reason in scripts/copy-allow.json.');
  process.exit(1);
}
const tagged = r.hits.filter((h) => h.verdict.startsWith('tagged')).length;
const allowed = r.hits.filter((h) => h.verdict.startsWith('allowed')).length;
const nEntries = allow.filter((e) => e.scope !== 'dom').length;
console.log(
  `check:copy: 0 untagged hits in ${files.length} files (${tagged} tagged, ${allowed} allowed by ${nEntries} entries; ${allow.length - nEntries} DOM-only entries; ${r.units.length} flagged units as in the manifest).`
);
