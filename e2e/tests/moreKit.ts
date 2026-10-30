// e2e/tests/moreKit.ts (v16.4, the More area's specs: more, visuals, safety-about)
//
// What the three specs share: a playing seeded library in the new layout, the More tab's pages, the Visuals sheet's
// ways in, the saved visual settings, Chrome's accessibility tree (unnamed controls, a named control's presence) and
// the 44 × 44 targets (layout.spec 9's rule, for the new pages). Kept out of helpers.ts so its v16.4 edit stays small.

import { type Locator, type Page } from '@playwright/test';
import { expect } from './fixtures';
import { libraryRowButton, libraryState, openLibraryTab, openSeededNewLayout, phoneSize, tab, type SeedOptions } from './helpers';

export const VIZ_KEY = 'aetheria.vizSettings.v1';
export const PALETTE_KEY = 'aetheria.frequencyColorMode.v1';
export const PAUSED_KEY = 'aetheria.visualsPaused.v1';
export const AWAKE_KEY = 'aetheria.keepAwake.v1';
export const MUSIC_ONLY_KEY = 'aetheria.musicOnly.v1';
export const TUTORIAL_KEY = 'aetheria_v3_tutorial_seen';
export const DISCLAIMER_KEY = 'aetheria.disclaimer.v1';

/** The visualizer draws (dev server: below its cap, ~13–18/s; layout.spec's DRAWING). Paused is 0 in every window. */
export const DRAWING = 8;

/**
 * The new layout over `n` seeded real tones (v2, Headphones), tone-0001 playing from the Library tab. The page is
 * left on the Library tab. Returns the native-dialog list.
 */
export async function playingSeeded(page: Page, n = 6, opts: SeedOptions = {}): Promise<string[]> {
  const dialogs = await openSeededNewLayout(page, n, { real: n, seconds: 40, ...opts });
  await phoneSize(page);
  await openLibraryTab(page);
  await libraryRowButton(page, 'tone-0001').click();
  await expect.poll(async () => { const s = await libraryState(page); return s.playing && (s.t ?? 0) > 0.3; }, { message: 'tone-0001 plays', timeout: 20_000 }).toBe(true);
  return dialogs;
}

/** A row of the More root (by its test id). */
export const moreRow = (page: Page, testId: string): Locator => page.getByTestId('more-root').getByTestId(testId);

/** The More tab's page now showing ('root', 'safety', 'statement', 'about', 'links'; v16.5 'guide', 'journal', 'advanced'). */
export async function moreView(page: Page): Promise<string | null> {
  return page.getByTestId('more').getAttribute('data-more-view');
}

/** Open a More page from the root: the More tab, then its row (the statement through Safety & comfort). */
export async function openMorePage(page: Page, view: 'safety' | 'statement' | 'about' | 'links' | 'guide' | 'journal' | 'advanced'): Promise<void> {
  await tab(page, 'more');
  await page.getByTestId('more').waitFor();
  if ((await moreView(page)) !== 'root') await tab(page, 'more'); // a second tap: the root
  await expect.poll(() => moreView(page)).toBe('root');
  await moreRow(page, view === 'statement' ? 'more-safety-row' : `more-${view}-row`).click();
  if (view === 'statement') await page.getByTestId('safety-statement-row').click();
  await expect.poll(() => moreView(page)).toBe(view);
}

/** The Visuals sheet (the phone's dialog or the desktop's panel). */
export const visualsSheet = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Visuals', exact: true }).or(page.getByRole('region', { name: 'Visuals', exact: true }));

/** Open the Visuals sheet: More › Visualizer, ⋯ › Visuals, or Layers › Advanced › Visualizer settings › Open. */
export async function openVisuals(page: Page, via: 'more' | 'menu' | 'layers' = 'more'): Promise<void> {
  if (via === 'more') {
    await tab(page, 'more');
    await page.getByTestId('more').waitFor();
    if ((await moreView(page)) !== 'root') await tab(page, 'more');
    await moreRow(page, 'more-visualizer').click();
  } else if (via === 'menu') {
    await tab(page, 'now');
    await page.getByTestId('np-menu-button').or(page.getByTestId('desktop-transport').getByRole('button', { name: 'More options', exact: true })).first().click();
    await page.getByTestId('menu-visuals').click();
  } else {
    await tab(page, 'layers');
    await page.getByTestId('layers-jump-advanced').click();
    await page.getByTestId('layers-open-visualizer').click();
  }
  await expect(visualsSheet(page)).toBeVisible();
}

/** A control of the Visuals sheet by its label: a switch, else a slider, else a choice group. */
export const vizSwitch = (page: Page, label: string): Locator => visualsSheet(page).getByRole('switch', { name: label, exact: true });
export const vizSlider = (page: Page, label: string): Locator => visualsSheet(page).getByRole('slider', { name: label, exact: true });
export const vizChoice = (page: Page, group: string, label: string): Locator =>
  visualsSheet(page).getByRole('group', { name: group, exact: true }).getByRole('button', { name: label, exact: true });
/** Alias the spec names: a visual setting's control, a switch by default. */
export const vizSetting = vizSwitch;

/** Jump the sheet to a group (its chip). */
export async function vizJump(page: Page, group: 'look' | 'hexes' | 'overlays' | 'motion' | 'comfort'): Promise<void> {
  await page.getByTestId(`visuals-jump-${group}`).click();
}

/** The saved visual settings (the whole object App writes on each change), or null. */
export async function savedViz(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  }, VIZ_KEY);
}

export async function stored(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

/** The visualizer's canvas is display:none (VisualsPause hidden). */
export async function canvasHidden(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const c = document.getElementById('viz-canvas');
    return !!c && getComputedStyle(c).display === 'none';
  });
}

/** Chrome's accessibility tree: the controls with no name (layout.spec 9's rule). */
export async function unnamedControls(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: any[] };
    const CONTROLS = new Set(['button', 'slider', 'link', 'switch', 'checkbox', 'textbox', 'combobox', 'menuitem', 'tab', 'radio', 'spinbutton']);
    return nodes
      .filter((n) => !n.ignored && CONTROLS.has(n.role?.value) && !String(n.name?.value ?? '').trim())
      .map((n) => `${n.role.value} #${n.backendDOMNodeId}`);
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Whether Chrome's accessibility tree exposes (not ignored) a control of this role and name. */
export async function inAxTree(page: Page, role: string, name: string): Promise<boolean> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: any[] };
    return nodes.some((n) => !n.ignored && n.role?.value === role && String(n.name?.value ?? '') === name);
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Every control in the shell and the open modal, its box grown by its ::after box, under 44 × 44. */
export async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('[data-testid="new-shell"], [role="dialog"][aria-modal="true"]'));
    const out: string[] = [];
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('button, a[href], [role="slider"], input[type="range"], [role="switch"], select'))) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === 'hidden' || el.closest('.sr-only')) continue;
        let w = r.width;
        let h = r.height;
        const after = getComputedStyle(el, '::after');
        if (after.content && after.content !== 'none' && after.position === 'absolute') {
          const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : 0);
          w = Math.max(w, r.width - px(after.left) - px(after.right));
          h = Math.max(h, r.height - px(after.top) - px(after.bottom));
        }
        if (w < 44 - 0.5 || h < 44 - 0.5) {
          const name = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 30) || el.tagName;
          out.push(`${name}: ${Math.round(w)}×${Math.round(h)}`);
        }
      }
    }
    return out;
  });
}

/** The text nodes under `root` (each trimmed, empty ones dropped): disclaimer.spec's reading of the words. */
export async function textNodes(root: Locator): Promise<string[]> {
  return root.evaluate((el) => {
    const parts: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t) parts.push(t);
    }
    return parts;
  });
}
