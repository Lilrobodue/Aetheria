// e2e/tests/copyKit.ts (v16.6, "How sure are we?"): what evidence.spec and copy-dom.spec share.
//
//   - domScan: the DOM gate (spec §5.8) on the rendered screen: every visible text node, inline run (text split by
//     <b>, <em>, <a>, … inside one element) and title / aria-label / placeholder carrying a gate word sits in a
//     [data-evidence] block with a VISIBLE tag inside it, or matches an allow-list entry's text for that word INSIDE that
//     entry's dom.scope (the same JSON the static gate reads, scripts/copy-allow.json; entries without dom.scope are the
//     static gate's only; dom.match 'exact' compares the whole text); no unit holds a RETIRED phrase. The words and
//     phrases come from scripts/copy-words.mjs, shared with check:copy.
//   - tagAudit: every [data-evidence-tag] is a named button with a 44 × 44 px hit box, inside a [data-evidence] block;
//     legend tags (the Guide's own headings) are not buttons.
//   - shot: a screenshot to E2E_SHOTS (when set), for the checkpoint review beside the mockups.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Locator, type Page } from '@playwright/test';
import { WORDS, RETIRED } from '../../scripts/copy-words.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

interface AllowEntry {
  file: string;
  text: string;
  words: string[];
  kind: string;
  exact?: boolean;
  scope?: string;
  dom?: { scope: string; match?: 'exact' | 'contains' };
}

/** The DOM gate's view of the allow-list (review C2): the entries with a dom.scope, each usable only inside it. */
export function domAllow(): Array<{ text: string; words: string[]; scope: string; exact: boolean }> {
  const raw = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'scripts', 'copy-allow.json'), 'utf8')) as { entries: AllowEntry[] };
  const usable = raw.entries.filter((e) => typeof e.text === 'string' && e.text.length > 0 && e.dom && typeof e.dom.scope === 'string' && e.dom.scope.trim());
  // Round 2: a scope is data-* attribute selectors only (check:copy's guard 6 also ties each to its component): never
  // body, html, * or a tag, which would let the entry allow its text anywhere on the page.
  for (const e of usable) {
    const parts = e.dom!.scope.split(',').map((x) => x.trim());
    if (!parts.every((p) => /^\[data-[a-z0-9-]+(?:="[^"\]]*")?\]$/.test(p))) throw new Error(`copy-allow.json: ${e.file} "${e.text}": dom.scope "${e.dom!.scope}" is not data-* attribute selectors`);
  }
  return usable.map((e) => ({ text: e.text, words: e.words, scope: e.dom!.scope, exact: e.dom!.match === 'exact' }));
}

export interface DomHit {
  /** text: a text node; run: an inline run; or the attribute it came from (title, aria-label, placeholder). */
  kind: 'text' | 'run' | 'title' | 'aria-label' | 'placeholder';
  text: string;
  words: string[];
  tagged: boolean;
  allowed: boolean;
  retired: string[];
}

/** The DOM gate over the page (or `root`): every visible text unit with a gate word or a retired phrase. */
export async function domScan(page: Page, root: Locator | null = null): Promise<DomHit[]> {
  const args = {
    words: (WORDS as Array<[string, RegExp]>).map(([k, re]) => [k, re.source, re.flags] as [string, string, string]),
    retired: RETIRED as string[],
    allow: domAllow(),
  };
  const run = (rootEl: Element | null, a: typeof args): DomHit[] => {
    const words = a.words.map(([k, src, flags]) => [k, new RegExp(src, flags)] as [string, RegExp]);
    // A unit is checked when it is laid out and not display:none / visibility:hidden (opacity and aria-hidden don't
    // exempt text: a sighted reader still sees it).
    const shown = (el: Element): boolean => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      }
      return el.getClientRects().length > 0;
    };
    // review C5/C10: the block's tag counts only when it is really there: laid out, not transparent, not aria-hidden.
    const tagShown = (el: Element): boolean => {
      if (!shown(el)) return false;
      for (let e: Element | null = el; e; e = e.parentElement) {
        if (getComputedStyle(e).opacity === '0' || e.getAttribute('aria-hidden') === 'true') return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const taggedAt = (el: Element): boolean => {
      const block = el.closest('[data-evidence]');
      if (!block || !block.getAttribute('data-evidence')) return false;
      return Array.from(block.querySelectorAll('[data-evidence-tag],[data-evidence-legend],[data-evidence-text]')).some(tagShown);
    };
    const allowedAt = (el: Element, t: string, w: string): boolean =>
      a.allow.some((e) => e.words.includes(w) && !!el.closest(e.scope) && (e.exact ? t === e.text : t.includes(e.text)));
    const norm = (v: string) => v.replace(/\s+/g, ' ').trim();
    const out: DomHit[] = [];
    const add = (el: Element, kind: DomHit['kind'], t: string, only: ((w: string) => boolean) | null = null) => {
      const hitWords = words.filter(([k, re]) => re.test(t) && (!only || only(k))).map(([k]) => k);
      const retired = a.retired.filter((p) => t.includes(p));
      if (!hitWords.length && !retired.length) return;
      if (!shown(el)) return;
      out.push({ kind, text: t.slice(0, 160), words: hitWords, tagged: taggedAt(el), allowed: hitWords.every((w) => allowedAt(el, t, w)), retired });
    };
    const top = rootEl ?? document.body;
    const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest('script,style,noscript')) continue;
      const t = norm(n.textContent ?? '');
      if (t) add(el, 'text', t);
    }
    // review C11: an inline run (<b>Safe</b> for …) reads as one sentence; a word only the whole run spells is a hit.
    const INLINE = new Set(['B', 'STRONG', 'EM', 'I', 'SPAN', 'A', 'CODE', 'SMALL', 'SUP', 'SUB', 'MARK', 'U', 'ABBR', 'BR']);
    const all = [top, ...Array.from(top.querySelectorAll('*'))];
    for (const el of all) {
      if (el.closest('script,style,noscript')) continue;
      const kids = Array.from(el.childNodes);
      const hasText = kids.some((k) => k.nodeType === 3 && norm(k.textContent ?? ''));
      const els = kids.filter((k): k is Element => k.nodeType === 1);
      if (!els.length || (!hasText && els.length < 2) || !els.every((k) => INLINE.has(k.tagName))) continue;
      const t = norm(el.textContent ?? '');
      const pieces: string[] = [];
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) pieces.push(norm(n.textContent ?? ''));
      const inPiece = (k: string) => {
        const re = words.find(([w]) => w === k)![1];
        return pieces.some((pc) => re.test(pc));
      };
      add(el, 'run', t, (k) => !inPiece(k));
    }
    // review C10: what the screen says without text (a tooltip, a spoken name, a field's hint) is held to the same rule.
    for (const attr of ['title', 'aria-label', 'placeholder'] as const) {
      for (const el of Array.from(top.querySelectorAll(`[${attr}]`))) {
        const t = norm(el.getAttribute(attr) ?? '');
        if (t) add(el, attr, t);
      }
    }
    return out;
  };
  return (root ?? page.locator('body')).evaluate(run, args);
}

/** The DOM gate's failures: untagged and not allowed, or holding a retired phrase. */
export function domFailures(hits: DomHit[]): DomHit[] {
  return hits.filter((h) => (h.words.length && !h.tagged && !h.allowed) || h.retired.length);
}

export const TAG_NAME = /^Evidence: (Arithmetic|Well studied|Mixed evidence|Early evidence|Open question|Design choice|Tradition)\. Opens How sure are we\?$/;

export interface TagAudit {
  count: number;
  problems: string[];
}

/** Every evidence tag on the page (or under `root`): a named button, 44 × 44 with its ::after box, inside a block. */
export async function tagAudit(page: Page): Promise<TagAudit> {
  return page.evaluate((nameSrc) => {
    const NAME = new RegExp(nameSrc);
    const problems: string[] = [];
    const tags = Array.from(document.querySelectorAll<HTMLElement>('[data-evidence-tag]'));
    for (const el of tags) {
      const name = el.getAttribute('aria-label') ?? '';
      const at = `${el.dataset.evidenceTag} "${(el.textContent ?? '').trim()}"`;
      if (el.tagName !== 'BUTTON') problems.push(`${at}: not a button`);
      if (!NAME.test(name)) problems.push(`${at}: named "${name}"`);
      if (!name.includes((el.textContent ?? '').trim())) problems.push(`${at}: its name doesn't contain its label`);
      if (!el.closest('[data-evidence]')) problems.push(`${at}: outside a data-evidence block`);
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue; // not on screen (a collapsed region)
      const after = getComputedStyle(el, '::after');
      const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : 0);
      let w = r.width;
      let h = r.height;
      if (after.content && after.content !== 'none' && after.position === 'absolute') {
        w = Math.max(w, r.width - px(after.left) - px(after.right));
        h = Math.max(h, r.height - px(after.top) - px(after.bottom));
      }
      if (w < 43.5 || h < 43.5) problems.push(`${at}: hit box ${Math.round(w)}×${Math.round(h)}`);
    }
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-evidence-legend]'))) {
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') problems.push(`legend ${el.dataset.evidenceLegend}: a button`);
    }
    return { count: tags.length, problems };
  }, TAG_NAME.source);
}

/** A screenshot for the checkpoint review (E2E_SHOTS=<dir>); nothing without it. */
export async function shot(page: Page, name: string, opts: { fullPage?: boolean; locator?: Locator } = {}): Promise<void> {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  if (opts.locator) await opts.locator.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: !!opts.fullPage });
}

/** The element focused now: its id. */
export const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '');

/** Where `#id` sits, from the top of the scroller around it (px). */
export async function topInScroller(page: Page, id: string, scrollerSelector: string): Promise<number | null> {
  return page.evaluate(
    ({ id, sel }) => {
      const el = document.getElementById(id);
      const sc = el?.closest(sel) ?? document.querySelector(sel);
      if (!el || !sc) return null;
      return el.getBoundingClientRect().top - sc.getBoundingClientRect().top;
    },
    { id, sel: scrollerSelector }
  );
}
