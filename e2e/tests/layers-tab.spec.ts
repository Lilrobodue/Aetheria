import { type Locator, type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  acceptDisclaimer,
  countConsole,
  crash,
  expectCache,
  layerIntensity,
  openHarmonicControl,
  seedTracks,
  importTones,
  openApp,
  optInNewLayout,
  drawsPerSecond,
  instrumentAudio,
  layerState,
  layersJump,
  layersSection,
  layersState,
  newShell,
  openLayersTab,
  openNewLayout,
  pauseCount,
  phoneSize,
  playInNewLayout,
  recordHudDraws,
  recordLiveDecodes,
  tapAt,
  renders,
  resetRenders,
  setSlider,
  sheet,
  tab,
  KEY_FIT_KEY,
  LAYER_ENGINE_KEY,
  LAYER_OUTPUT_ASK_AGAIN_KEY,
  LAYER_OUTPUT_KEY,
  LAYOUT_KEY,
  PHONE_VIEWPORT,
  TONE_LEVEL_CLASSIC_KEY,
  TONE_LEVEL_V2_KEY,
  type LayersSectionName,
  peekClassicLibrary,
} from './helpers';

// v15.6, the Layers tab: every sound control classic keeps in Harmonic Control, on one page in the new layout (decision
// 4, option A): a sticky row of five jump chips and five cards, Sound, Crystal, Levels (with Key fit), Beat and
// Advanced, each its own region. The Sound sheet keeps its place over Now Playing, on the same sections (decision 3).
// The 111 Hz chip, the optional experience filter (off by default), the comfort lines in place of the auto-opening
// Safety panel, and the Undo toast when the tone is lowered. Tests use the synthetic tone WAVs only.

const SECTIONS: readonly LayersSectionName[] = ['sound', 'crystal', 'levels', 'beat', 'advanced'];
const TITLES = ['Sound', 'Crystal', 'Levels', 'Beat', 'Advanced'];
const ANCHOR_UA = /Android|iPhone|iPad|Mobile/i;
// The visualizer draws (dev server: below its 30/s cap, layout.spec's measure); "paused" is 0.0 in every window.
const DRAWING = 8;

const scroller = (page: Page) => page.getByTestId('layers-scroll');
/** The crystal cells (not the 111 chip): buttons with aria-pressed. */
const cells = (root: Locator) => root.locator('button[aria-pressed][data-testid^="crystal-"]');
const classicHeader = (page: Page) => page.locator('header').getByTitle('Safety Protocols', { exact: true });
const peekPill = (page: Page) => page.getByTestId('peek-pill');
/** A slider's readout (SliderWithReadout's right-hand span). */
const readout = (slider: Locator) => slider.locator('span.tabular-nums').first();

/** A card's top inside the page's scroller, px. */
async function topInScroller(page: Page, name: LayersSectionName): Promise<number> {
  return page.evaluate((n) => {
    const s = document.querySelector('[data-testid="layers-scroll"]')!;
    const c = document.getElementById(`layers-sec-${n}`)!;
    return c.getBoundingClientRect().top - s.getBoundingClientRect().top;
  }, name);
}

/** Into classic's Harmonic Control, to compare: ⋯ › Back to classic, then the gear. (v16.4: Advanced's Visualizer row opens
 *  the Visuals sheet now, so its peek into Harmonic Control is gone.) */
async function peekHarmonic(page: Page): Promise<void> {
  await tab(page, 'now');
  await page.getByRole('button', { name: 'More options', exact: true }).first().click();
  await page.getByTestId('menu-back-to-classic').click();
  await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
  await openHarmonicControl(page);
  await expect(page.getByRole('heading', { name: 'Harmonic Control', exact: true })).toBeVisible();
  await expect(peekPill(page), 'no peek: classic proper').toHaveCount(0);
}

/** Back to the new layout (Harmonic Control's opt-in), on the Layers tab. */
async function backFromPeek(page: Page): Promise<void> {
  await page.getByTestId('try-new-layout').click();
  await newShell(page).waitFor();
  await openLayersTab(page);
  await expect(page.getByTestId('tab-layers')).toBeVisible();
}

/** Text with every run of whitespace removed (the same words, in the same order, whatever the markup). */
const squeeze = (s: string | null) => (s ?? '').replace(/\s+/g, '');

interface Snapshot {
  time: number;
  paused: boolean;
  ctxRunning: boolean;
  anchorPaused: boolean | null;
  pauses: number;
  playbackState: string;
  title: string | null;
}

async function snapshot(page: Page): Promise<Snapshot> {
  const s = await layerState(page);
  const ms = await page.evaluate(() => ({
    playbackState: navigator.mediaSession.playbackState as string,
    title: navigator.mediaSession.metadata?.title ?? null,
  }));
  return { time: s.music?.time ?? -1, paused: s.music?.paused ?? true, ctxRunning: s.ctxRunning, anchorPaused: s.anchorPaused, pauses: await pauseCount(page), ...ms };
}

/** Over the next 2 s the music plays on untouched (layout.spec's check). */
async function expectMusicPlaysOn(page: Page, label: string): Promise<void> {
  const mobile = await page.evaluate((re) => new RegExp(re).test(navigator.userAgent), ANCHOR_UA.source);
  const before = await snapshot(page);
  await page.waitForTimeout(2000);
  const after = await snapshot(page);
  expect.soft(after.time - before.time, `${label}: the music moved on`).toBeGreaterThanOrEqual(1.5);
  expect.soft(after.paused, `${label}: the music element is not paused`).toBe(false);
  expect.soft(after.pauses, `${label}: no pause() meanwhile`).toBe(before.pauses);
  expect.soft(after.ctxRunning, `${label}: the AudioContext runs`).toBe(true);
  expect.soft(after.playbackState, `${label}: the lock-screen card still says playing`).toBe('playing');
  expect.soft(after.title, `${label}: the card's title is unchanged`).toBe(before.title);
  if (mobile) expect.soft(after.anchorPaused, `${label}: the silent anchor plays on`).toBe(false);
}

const canvasDisplay = (page: Page) => page.evaluate(() => getComputedStyle(document.getElementById('viz-canvas')!).display);

async function expectPaused(page: Page, what: string): Promise<void> {
  await expect.poll(async () => Math.max(...(await drawsPerSecond(page, 1))), { message: `${what}: the visualizer stops`, timeout: 10_000, intervals: [0] }).toBe(0);
  expect.soft(await drawsPerSecond(page, 2), `${what}: 0.0 draws/s for 2 consecutive seconds`).toEqual([0, 0]);
  expect.soft(await canvasDisplay(page), `${what}: the canvas is display:none`).toBe('none');
}

async function expectDrawing(page: Page, what: string): Promise<void> {
  await expect.poll(async () => Math.min(...(await drawsPerSecond(page, 1))), { message: `${what}: the visualizer draws`, timeout: 10_000, intervals: [0] }).toBeGreaterThanOrEqual(DRAWING);
  expect.soft(await canvasDisplay(page), `${what}: the canvas shows`).not.toBe('none');
}

/** Chrome's accessibility tree: the controls with no name. */
async function unnamedControls(page: Page): Promise<string[]> {
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

/** Every control in the shell (the radio rows and the select too), its box grown by its ::after box, under 44 × 44. */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('[data-testid="new-shell"], [role="dialog"][aria-modal="true"]'));
    const out: string[] = [];
    for (const root of roots) {
      const controls = root.querySelectorAll<HTMLElement>('button, a[href], [role="slider"], input[type="range"], [role="switch"], select, label:has(> input[type="radio"])');
      for (const el of Array.from(controls)) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === 'hidden' || el.closest('.sr-only')) continue;
        if (r.bottom < 0 || r.top > innerHeight) continue; // scrolled out of the page: measured where it shows
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

/** Choose an output in the tab's Sound card. */
async function chooseOutput(page: Page, label: 'Headphones' | 'Speakers' | 'Phone speaker' | 'Car'): Promise<void> {
  await layersSection(page, 'sound').getByRole('group', { name: 'Output' }).getByRole('button', { name: label, exact: true }).click();
}

async function chooseEngine(page: Page, label: 'Classic' | 'v2'): Promise<void> {
  await layersSection(page, 'sound').getByRole('group', { name: 'Layer sound: v2 / classic' }).getByRole('button', { name: label, exact: true }).click();
}

const key = (page: Page, k: string) => page.evaluate((k) => localStorage.getItem(k), k);

// ---------------------------------------------------------------------------------------------------------------
// 1. Structure: five sections, the jump row, the heat guard
// ---------------------------------------------------------------------------------------------------------------

test.describe('phone', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('1. five sections in order; a jump chip scrolls its card to the top and focuses its h2; the visuals pause behind the tab @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    await instrumentAudio(page);
    await recordHudDraws(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await page.evaluate(() => ((document.getElementById('viz-canvas') as any).__e2eId = 'the-canvas'));
    await expectDrawing(page, 'Now Playing');

    await openLayersTab(page);
    const cards = page.getByTestId('tab-layers').locator('section[aria-labelledby^="layers-h-"]');
    await expect(cards).toHaveCount(5);
    const headings = await cards.evaluateAll((els) => els.map((e) => document.getElementById(e.getAttribute('aria-labelledby')!)?.textContent ?? ''));
    expect(headings, 'the cards, in the plan’s order').toEqual(TITLES);
    expect(await page.getByTestId('layers-jump').getByRole('button').allTextContents(), 'the jump chips').toEqual(TITLES);
    // The stub is gone (its peek and its note).
    await expect(page.getByTestId('peek-sound')).toHaveCount(0);
    await expect(page.getByText('The new Layers page is coming in a later beta')).toHaveCount(0);
    await expect(layersJump(page, 'sound'), 'Sound is current at the top').toHaveAttribute('aria-current', 'true');

    for (const name of SECTIONS) {
      await layersJump(page, name).click();
      await expect(page.locator(`#layers-h-${name}`), `${name}: its h2 has the focus`).toBeFocused();
      await expect(layersJump(page, name), `${name}: its chip is current`).toHaveAttribute('aria-current', 'true');
      await expect(page.getByTestId('layers-jump').locator('[aria-current="true"]'), 'one current chip').toHaveCount(1);
      const top = await topInScroller(page, name);
      const { atEnd, height } = await scroller(page).evaluate((el) => ({ atEnd: el.scrollTop + el.clientHeight >= el.scrollHeight - 1, height: el.clientHeight }));
      // At the top of the page (its 12 px padding above), or, for a last card too short to get there, in its upper part.
      if (atEnd && name === 'advanced') expect(top, `${name}: as high as the page goes`).toBeLessThanOrEqual(height * 0.4);
      else expect(Math.abs(top - 12), `${name}: its card at the top (${top} px)`).toBeLessThanOrEqual(1);
    }
    // Scrolling by hand moves the mark.
    await scroller(page).evaluate((el) => (el.scrollTop = 0));
    await expect(layersJump(page, 'sound'), 'scrolled back to the top: Sound').toHaveAttribute('aria-current', 'true');

    // The tab is solid: the visuals pause behind it, and come back on the same canvas.
    await expectPaused(page, 'the Layers tab');
    await expectMusicPlaysOn(page, 'the Layers tab');
    await tab(page, 'now');
    await expectDrawing(page, 'back on Now Playing');
    expect(await page.evaluate(() => (document.getElementById('viz-canvas') as any).__e2eId), 'the same canvas node').toBe('the-canvas');
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2. The Sound section shows classic's panel's words, state by state
// ---------------------------------------------------------------------------------------------------------------

test('2. in six states the Sound section shows exactly the words of classic’s layer-sound panel; one Music-only switch', async ({ page }) => {
  test.setTimeout(240_000);
  // A one-shot failure of the next v2 player (layers.spec's failLayersOnce): its channel merger throws.
  await page.addInitScript(() => {
    const w = window as any;
    w.__failLayersOnce = false;
    const B = BaseAudioContext.prototype as any;
    const merger = B.createChannelMerger;
    B.createChannelMerger = function (...args: unknown[]) {
      if (w.__failLayersOnce) {
        w.__failLayersOnce = false;
        throw new DOMException('test: no channel merger', 'NotSupportedError');
      }
      return merger.apply(this, args);
    };
  });
  const dialogs = await openNewLayout(page, { engine: 'default' });
  const STATES: Array<{ name: string; set: Record<string, string>; fail?: boolean }> = [
    { name: 'v2 unanswered', set: {} },
    { name: 'v2 Headphones', set: { [LAYER_ENGINE_KEY]: 'v2', [LAYER_OUTPUT_KEY]: 'headphones' } },
    { name: 'v2 Car', set: { [LAYER_ENGINE_KEY]: 'v2', [LAYER_OUTPUT_KEY]: 'car' } },
    { name: 'classic chosen', set: { [LAYER_ENGINE_KEY]: 'classic' } },
    { name: 'asked again', set: { [LAYER_ENGINE_KEY]: 'v2', [LAYER_OUTPUT_KEY]: 'speakers', [LAYER_OUTPUT_ASK_AGAIN_KEY]: '1' } },
    { name: 'v2 failed, Car', set: { [LAYER_ENGINE_KEY]: 'v2', [LAYER_OUTPUT_KEY]: 'car' }, fail: true },
  ];
  for (const st of STATES) {
    await page.evaluate(
      ({ set, keys }) => {
        for (const k of keys) localStorage.removeItem(k);
        for (const [k, v] of Object.entries(set)) localStorage.setItem(k, v);
      },
      { set: st.set, keys: [LAYER_ENGINE_KEY, LAYER_OUTPUT_KEY, LAYER_OUTPUT_ASK_AGAIN_KEY] }
    );
    await page.reload();
    await newShell(page).waitFor();
    await openLayersTab(page);
    if (st.fail) {
      // Make v2 fail on its first player: a crystal from the tab wants the layers.
      await page.evaluate(() => ((window as any).__failLayersOnce = true));
      await layersJump(page, 'crystal').click();
      await page.getByTestId('crystal-528').click();
      await expect(layersSection(page, 'sound').getByTestId('layers-v2-unavailable'), `${st.name}: v2 failed`).toBeVisible();
    }
    await expect(page.getByTestId('tab-layers').getByRole('switch', { name: 'Music only' }), `${st.name}: one Music-only switch`).toHaveCount(1);
    // v16.6: the tab's drone row carries its Design-choice tag (spec §3.7: Layers › Sound only); the words compared are
    // the panel's own, so the tag's text is left out.
    const ours = squeeze(await page.getByTestId('layers-sound-body').evaluate((el) => {
      const c = el.cloneNode(true) as HTMLElement;
      c.querySelectorAll('[data-evidence-tag]').forEach((t) => t.remove());
      return c.textContent;
    }));
    await peekHarmonic(page);
    const classic = squeeze(await page.getByTestId('layer-sound-panel').first().textContent());
    test.info().annotations.push({ type: `words, ${st.name}`, description: classic.slice(0, 160) });
    expect.soft(ours, `${st.name}: the same words as classic's panel`).toBe(classic);
    await backFromPeek(page);
  }
  expect(dialogs).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// 3–8. The controls
// ---------------------------------------------------------------------------------------------------------------

test.describe('phone, controls', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('3. Sound: the engine and the output are saved from taps only; the drone is unusable off headphones; Ask me again; Export; Car', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openNewLayout(page, { engine: 'default' });
    await phoneSize(page);
    await openLayersTab(page);
    const sound = layersSection(page, 'sound');
    const engine = sound.getByRole('group', { name: 'Layer sound: v2 / classic' });
    // The pressed default, tapped before any choice: nothing is saved.
    await expect(engine.getByRole('button', { name: 'v2', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await chooseEngine(page, 'v2');
    await page.waitForTimeout(300);
    expect(await key(page, LAYER_ENGINE_KEY), 'a tap on the unchosen default saves nothing').toBeNull();
    await chooseEngine(page, 'Classic');
    await expect.poll(() => key(page, LAYER_ENGINE_KEY)).toBe('classic');
    await expect(sound.getByRole('group', { name: 'Output' }), 'classic: no Output group').toHaveCount(0);
    await expect(sound.getByTestId('layers-classic-note')).toBeVisible();
    await chooseEngine(page, 'v2');
    await expect.poll(() => key(page, LAYER_ENGINE_KEY)).toBe('v2');

    // Unanswered: Headphones assumed (outlined, not pressed).
    await expect(sound.getByText('Headphones (assumed)', { exact: true })).toBeVisible();
    await expect(sound.getByRole('group', { name: 'Output' }).getByRole('button', { name: 'Headphones', exact: true })).toHaveAttribute('aria-pressed', 'false');
    // Speakers: saved; the drone can't play there, and says why.
    await chooseOutput(page, 'Speakers');
    await expect.poll(() => key(page, LAYER_OUTPUT_KEY)).toBe('speakers');
    const drone = sound.getByRole('switch', { name: 'Sub-bass drone' });
    await expect(drone, 'the drone is disabled on Speakers').toBeDisabled();
    await expect(sound.getByText('Headphones only.', { exact: true })).toBeVisible();
    await chooseOutput(page, 'Headphones');
    await expect(drone).toBeEnabled();

    // Ask me again sets its key.
    await sound.getByTestId('layers-ask-again').click();
    await expect.poll(() => key(page, LAYER_OUTPUT_ASK_AGAIN_KEY)).toBe('1');
    await expect(sound.getByText('Asked again: the current output stays until you answer.', { exact: true })).toBeVisible();

    // Export sound log: a .json download (not on a device: it would land in the phone's Downloads).
    if (!ON_DEVICE) {
      const download = page.waitForEvent('download');
      await sound.getByTestId('layers-export-log').click();
      expect((await download).suggestedFilename(), 'the sound log').toMatch(/^aetheria-sound-log-\d{8}-\d{4}\.json$/);
    }

    // Car: saved, and Now Playing is the Car screen.
    await chooseOutput(page, 'Car');
    await expect.poll(() => key(page, LAYER_OUTPUT_KEY)).toBe('car');
    await tab(page, 'now');
    await expect(page.getByTestId('view-car')).toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test('4. Crystal: 27 cells play; Back to the track’s crystal; the 111 chip plays 111 as itself; Perfect GUT', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    // 28 tones: Auto-Distribute's library path gives every track a crystal (layout.spec 4's setup).
    const dialogs = await playInNewLayout(page, { count: 28, seconds: 30, autoDistribute: true });
    await phoneSize(page);
    await openLayersTab(page);
    await layersJump(page, 'crystal').click();
    const crystal = layersSection(page, 'crystal');
    await expect(cells(crystal)).toHaveCount(27);
    await expect(crystal.getByText("This is the track's own crystal.", { exact: true }), 'the track plays its own crystal').toBeVisible();
    const trackHz = Number(/^(\d+)/.exec(((await page.getByTestId('layers-crystal-hz').textContent()) ?? '').trim())?.[1] ?? 0);
    const target = trackHz === 1449 ? 1692 : 1449;

    // A tap plays it: v2 plans it, the tile and the mini-player say it.
    await crystal.getByTestId(`crystal-${target}`).click();
    await expect.poll(async () => (await layersState(page))?.requested?.canonical_hz ?? 0, { timeout: 10_000 }).toBe(target);
    await expect(page.getByTestId('layers-crystal-hz')).toContainText(`${target} Hz`);
    await expect(crystal.getByTestId(`crystal-${target}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('mini-player')).toContainText(`${target} Hz`);
    await expect(layersSection(page, 'crystal').getByTestId('layers-crystal-status')).toHaveText(`${target} Hz playing`);

    // Back to the track's crystal (Auto-Distribute gave the track one).
    const back = crystal.getByTestId('crystal-back-to-track');
    await expect(back).toBeVisible();
    const backHz = Number(/\((\d+) Hz\)/.exec((await back.textContent()) ?? '')?.[1] ?? 0);
    await back.click();
    await expect.poll(async () => (await layersState(page))?.requested?.canonical_hz ?? 0, { timeout: 10_000 }).toBe(backHz);
    await expect(back, 'the way back goes once there').toHaveCount(0);

    // The 111 Hz chip: v2 plays 111 itself, the layers say it, and no cell is ringed.
    await crystal.getByTestId('crystal-111').click();
    await expect.poll(async () => (await layersState(page))?.requested?.canonical_hz ?? 0, { timeout: 10_000 }).toBe(111);
    await expect(layersSection(page, 'sound').getByTestId('layers-sound-status')).toHaveText('Layers v2 · Headphones · 111 Hz non-canonical');
    await expect(page.getByTestId('layers-crystal-hz')).toContainText('111 Hz');
    await expect(cells(crystal).and(page.locator('[aria-pressed="true"]')), 'no cell is ringed').toHaveCount(0);
    await expect(page.getByTestId('layers-heard')).toHaveText('v2 plays it as a 222 Hz tone under the music.');

    // Perfect GUT: the GUT cells read their 111 Hz-family twins.
    await crystal.getByRole('switch', { name: 'Lo Shu Perfect GUT' }).click();
    const gut = crystal.locator('section[aria-label^="GUT "]');
    expect(await cells(gut).evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-testid')!.slice('crystal-'.length)))), 'Perfect GUT').toEqual([75, 186, 297, 408, 519, 630, 741, 852, 963]);
    await crystal.getByRole('switch', { name: 'Lo Shu Perfect GUT' }).click();
    await tab(page, 'now');
    await expect(page.getByTestId('chip-crystal')).toHaveAttribute('aria-label', /^Crystal 111 Hz/);
    expect(dialogs).toEqual([]);
  });

  test('5. the crystal filter: off shows 27 at every level; on, 9 / 13 / 23 / 27, the playing crystal kept; Show all; saved from the switch only; the sheet too', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await openLayersTab(page);
    const crystal = layersSection(page, 'crystal');
    const level = page.getByRole('combobox', { name: 'Experience level' });
    const filter = layersSection(page, 'advanced').getByRole('switch', { name: 'Filter the crystals by experience level' });
    await expect(filter, 'off by default').toHaveAttribute('aria-checked', 'false');
    // A GUT crystal first, so each level's count is the ceiling's alone (the playing crystal always shows).
    await crystal.getByTestId('crystal-528').click();
    await expect.poll(async () => (await layersState(page))?.requested?.canonical_hz ?? 0, { timeout: 10_000 }).toBe(528);
    for (const l of ['beginner', 'intermediate', 'advanced', 'expert']) {
      await level.selectOption(l);
      await expect(cells(crystal), `off, ${l}: all 27`).toHaveCount(27);
    }
    expect(await key(page, 'aetheria.crystalFilter.v1'), 'never written without a tap').toBeNull();

    await filter.click();
    await expect.poll(() => key(page, 'aetheria.crystalFilter.v1')).toBe('true');
    for (const [l, n] of [['beginner', 9], ['intermediate', 13], ['advanced', 23], ['expert', 27]] as const) {
      await level.selectOption(l);
      await expect(cells(crystal), `on, ${l}`).toHaveCount(n);
    }
    // A playing crystal beyond the ceiling stays, marked.
    await crystal.getByTestId('crystal-4920').click();
    await expect.poll(async () => (await layersState(page))?.requested?.canonical_hz ?? 0, { timeout: 10_000 }).toBe(4920);
    await level.selectOption('beginner');
    await expect(cells(crystal), 'beginner + the playing 4920').toHaveCount(10);
    await expect(crystal.getByTestId('crystal-4920')).toHaveAttribute('aria-pressed', 'true');
    await expect(crystal.getByTestId('crystal-filter-note')).toContainText('Showing 10 of 27 · experience filter: Beginner');

    // The Crystal sheet obeys the same filter.
    await tab(page, 'now');
    await page.getByTestId('chip-crystal').click();
    await expect(cells(sheet(page, 'Crystal')), 'the sheet, filtered').toHaveCount(10);
    await page.keyboard.press('Escape');
    await openLayersTab(page);

    // Show all turns it off (a tap: saved).
    await layersSection(page, 'crystal').getByTestId('crystal-show-all').click();
    await expect(filter).toHaveAttribute('aria-checked', 'false');
    await expect(cells(layersSection(page, 'crystal'))).toHaveCount(27);
    await expect.poll(() => key(page, 'aetheria.crystalFilter.v1')).toBe('false');
    expect(dialogs).toEqual([]);
  });

  test('6. Levels: classic’s readouts for the same values; a drag saves only the tone level; Car disables the beat; classic reads %', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await openLayersTab(page);
    await layersJump(page, 'levels').click();
    const levels = layersSection(page, 'levels');
    const before = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
    await setSlider(levels.getByTestId('level-volume').locator('input'), 0.5);
    await setSlider(levels.getByTestId('level-tone').locator('input'), 0.02);
    await setSlider(levels.getByTestId('level-beat').locator('input'), 0.06);
    await expect(readout(levels.getByTestId('level-volume'))).toHaveText('50 %');
    await expect(readout(levels.getByTestId('level-tone'))).toHaveText('+6.0 dB · −20.0 dB re music');
    await expect(readout(levels.getByTestId('level-beat'))).toHaveText('Beat +6.0 dB · −17.0 dB re music');
    await expect.poll(() => key(page, TONE_LEVEL_V2_KEY)).toBe('0.02');
    const after = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
    const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k] && k !== 'aetheria.soundSessions.v1');
    expect(changed, 'only the tone level is saved (volume and beat are not)').toEqual([TONE_LEVEL_V2_KEY]);
    const tone = await readout(levels.getByTestId('level-tone')).textContent();
    const beat = await readout(levels.getByTestId('level-beat')).textContent();

    // Classic shows the same readouts for the same values.
    await peekHarmonic(page);
    await expect(page.locator('#v2-tone-level-readout')).toHaveText(tone!);
    await expect(page.getByTestId('player-bar').locator('input[aria-label="Beat level"]')).toHaveAttribute('aria-valuetext', beat!);
    await backFromPeek(page);

    // Car: the beat slider is off, and says why.
    await chooseOutput(page, 'Car');
    await layersJump(page, 'levels').click();
    await expect(levels.getByTestId('level-beat').locator('input')).toBeDisabled();
    await expect(levels.getByText('Car output plays no beat.', { exact: true })).toBeVisible();
    await chooseOutput(page, 'Headphones');

    // The classic engine: %.
    await chooseEngine(page, 'Classic');
    await expect(readout(levels.getByTestId('level-tone'))).toHaveText(/^\d+ %$/);
    await expect(readout(levels.getByTestId('level-beat'))).toHaveText(/^\d+ %$/);
    expect(dialogs).toEqual([]);
  });

  test('7. Beat: Adaptive on by default; a band turns it off and plays; ArrowDown moves it; Car disables the bands', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await openLayersTab(page);
    await layersJump(page, 'beat').click();
    const beat = layersSection(page, 'beat');
    const adaptive = beat.getByRole('switch', { name: 'Adaptive' });
    await expect(adaptive, 'Adaptive is on by default').toHaveAttribute('aria-checked', 'true');
    await expect(beat.getByTestId('layers-beat-status')).toHaveText('Adaptive · Alpha');

    await beat.getByText('Theta · 6 Hz', { exact: true }).click();
    await expect(beat.getByRole('radio', { name: /^Theta · 6 Hz/ })).toBeChecked();
    await expect(adaptive, 'a band picked by hand turns Adaptive off').toHaveAttribute('aria-checked', 'false');
    await expect(beat.getByTestId('layers-beat-status')).toHaveText('Theta');
    await expect.poll(async () => (await layersState(page))?.requested?.beat_hz ?? 0, { message: 'v2 delivers Theta (6 Hz)', timeout: 15_000 }).toBe(6);

    // The arrow keys move the choice, each move a pick.
    await beat.getByRole('radio', { name: /^Theta · 6 Hz/ }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(beat.getByRole('radio', { name: /^Alpha · 10 Hz/ })).toBeChecked();
    await expect(beat.getByTestId('layers-beat-status')).toHaveText('Alpha');
    await tab(page, 'now');
    await expect(page.getByTestId('chip-beat')).toHaveAttribute('aria-label', 'Beat Alpha');
    await openLayersTab(page);

    // Classic: the chip reads the preset.
    await chooseEngine(page, 'Classic');
    await layersJump(page, 'beat').click();
    await beat.getByText('Theta · 6 Hz', { exact: true }).click();
    await expect(beat.getByTestId('layers-beat-status')).toHaveText('Theta');
    await chooseEngine(page, 'v2');

    // Car (v2 renders no beat): the bands are disabled, and say why.
    await chooseOutput(page, 'Car');
    await layersJump(page, 'beat').click();
    const radios = beat.getByRole('radio');
    await expect(radios).toHaveCount(5);
    for (let i = 0; i < 5; i++) await expect(radios.nth(i)).toBeDisabled();
    await expect(beat.getByText('Car: tone only, so there is no beat or pulse.', { exact: true })).toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test('7b. Beat: a tap on the band Adaptive is showing holds it and turns Adaptive off, as classic’s row does', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await openLayersTab(page);
    await layersJump(page, 'beat').click();
    const beat = layersSection(page, 'beat');
    const adaptive = beat.getByRole('switch', { name: 'Adaptive' });
    await expect(adaptive).toHaveAttribute('aria-checked', 'true');
    const alpha = beat.getByRole('radio', { name: /^Alpha · 10 Hz/ });
    await expect(alpha, 'Adaptive shows Alpha').toBeChecked();
    // The checked row: a native radio fires no change here, the pick must still happen.
    await beat.getByText('Alpha · 10 Hz', { exact: true }).click();
    await expect(adaptive, 'Adaptive is off').toHaveAttribute('aria-checked', 'false');
    await expect(alpha, 'Alpha is held').toBeChecked();
    await expect(beat.getByTestId('layers-beat-status')).toHaveText('Alpha');
    expect(dialogs).toEqual([]);
  });

  test('7c. Beat: while the tone plays alone (no beat) no band says “now”; with the music it does again', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await openLayersTab(page);
    const nowRows = () => layersSection(page, 'beat').getByRole('radio', { name: /· now/ });
    await layersJump(page, 'beat').click();
    await expect(nowRows(), 'playing: one band delivered now').toHaveCount(1);
    await expect(layersSection(page, 'beat').getByRole('radio', { name: /^Alpha · 10 Hz/ })).toHaveAccessibleName(/· now/);
    // Pause the music (the mini-player), then a crystal: the tone alone, and v2 plays no beat with it.
    await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await layerState(page)).music?.paused, { timeout: 5_000 }).toBe(true);
    await layersJump(page, 'crystal').click();
    await layersSection(page, 'crystal').getByTestId('crystal-528').click();
    await expect.poll(async () => (await layersState(page))?.requested?.render ?? '', { message: 'v2 plays the tone alone, no beat', timeout: 10_000 }).toBe('off');
    await layersJump(page, 'beat').click();
    await expect(layersSection(page, 'beat').getByTestId('layers-beat-status'), 'the chip says no beat').toHaveText('Adaptive · Beat off');
    await expect(nowRows(), 'tone alone: no band is "now"').toHaveCount(0);
    // The music again: the beat plays, and its band is "now" again.
    await page.getByTestId('mini-player').getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(async () => (await layerState(page)).music?.paused, { timeout: 5_000 }).toBe(false);
    await expect(nowRows(), 'playing again: one band is "now"').toHaveCount(1);
    expect(dialogs).toEqual([]);
  });

  test('8. Key fit: v2 only; its switch saves aetheria.keyFit.v1; its status line is classic’s', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await openLayersTab(page);
    await layersJump(page, 'levels').click();
    const fit = page.getByTestId('layers-keyfit');
    await expect(fit).toBeVisible();
    const sw = fit.getByRole('switch', { name: 'Key fit' });
    await expect(sw, 'on by default').toHaveAttribute('aria-checked', 'true');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => key(page, KEY_FIT_KEY)).toBe('false');
    const status = (await page.getByTestId('layers-keyfit-status').textContent()) ?? '';
    expect(status).toMatch(/^Off\./);
    await peekHarmonic(page);
    await expect(page.getByTestId('key-fit-status'), "classic's card says the same").toHaveText(status);
    await backFromPeek(page);
    await chooseEngine(page, 'Classic');
    await expect(page.getByTestId('layers-keyfit'), 'classic: no Key fit').toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('9. while playing no section re-renders; a Tone-level drag re-renders only the sliders', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await openLayersTab(page);
    const SECTION_VIEWS = ['LayersTab', 'LayersJumpRow', 'LayersSound', 'LayersCrystal', 'CrystalPicker', 'LayersLevelsCard', 'LayersLevels', 'LayersKeyFit', 'LayersBeat', 'LayersAdvanced'];
    await page.waitForTimeout(2500);
    await resetRenders(page);
    await page.waitForTimeout(3000);
    const idle = await renders(page);
    test.info().annotations.push({ type: 'renders on the Layers tab, 3 s', description: JSON.stringify(idle) });
    expect(Object.keys(idle).length, 'the dev hook counted (needs the dev server)').toBeGreaterThan(0);
    for (const v of SECTION_VIEWS) expect.soft(idle[v] ?? 0, `${v} renders while playing`).toBe(0);
    expect.soft(idle.MiniProgress ?? 0, 'MiniProgress follows the clock').toBeGreaterThanOrEqual(8);

    await layersJump(page, 'levels').click();
    await page.waitForTimeout(300);
    await resetRenders(page);
    const slider = layersSection(page, 'levels').getByTestId('level-tone').locator('input');
    for (let i = 1; i <= 45; i++) {
      await setSlider(slider, Math.min(0.04, 0.0005 + i * 0.0005));
      await page.waitForTimeout(33);
    }
    const drag = await renders(page);
    test.info().annotations.push({ type: 'renders during a 45-step Tone drag', description: JSON.stringify(drag) });
    expect.soft(drag.LayersLevels ?? 0, 'the sliders follow the drag').toBeGreaterThanOrEqual(20);
    for (const v of SECTION_VIEWS.filter((v) => v !== 'LayersLevels')) expect.soft(drag[v] ?? 0, `${v} renders during the drag`).toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('10. Advanced: φ off removes the ticks and the phase word and disables Track shape; Track shape off does too; the track’s peak', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    const ticks = () => page.getByTestId('np-seek').locator('span.w-0\\.5');
    const phase = () => page.getByTestId('np-time').locator('span').nth(1);
    await expect(ticks()).toHaveCount(2);
    await expect(phase()).toHaveText(/^φ · (Build|Peak|Resolve)$/);

    await openLayersTab(page);
    await layersJump(page, 'advanced').click();
    const adv = layersSection(page, 'advanced');
    const phi = adv.getByRole('switch', { name: 'φ integration' });
    const shape = adv.getByRole('switch', { name: 'Track shape' });
    // The track's peak, from its length (60 s tones: 0:37).
    const d = (await layerState(page)).music ? await page.evaluate(() => ((window as any).__audio.music as HTMLMediaElement).duration) : 0;
    const peak = d * 0.6180339887498949;
    const fmt = `${Math.floor(peak / 60)}:${String(Math.floor(peak % 60)).padStart(2, '0')}`;
    await expect(adv.getByText(`This track peaks at ${fmt} (61.8 %).`, { exact: true })).toBeVisible();

    await phi.click();
    await expect(phi).toHaveAttribute('aria-checked', 'false');
    await expect(shape, 'Track shape needs φ').toBeDisabled();
    await expect(adv.getByText('Needs φ integration', { exact: true })).toBeVisible();
    await expect(layersSection(page, 'advanced').getByTestId('layers-advanced-status')).toHaveText('φ off');
    await tab(page, 'now');
    await expect(ticks(), 'φ off: no ticks').toHaveCount(0);
    await expect(phase(), 'φ off: no phase word').toHaveText('');

    await openLayersTab(page);
    await layersJump(page, 'advanced').click();
    await phi.click();
    await expect(shape).toBeEnabled();
    await shape.click();
    await expect(shape).toHaveAttribute('aria-checked', 'false');
    await tab(page, 'now');
    await expect(ticks(), 'Track shape off: no ticks').toHaveCount(0);
    await expect(phase(), 'Track shape off: no phase word').toHaveText('');

    await openLayersTab(page);
    await layersJump(page, 'advanced').click();
    await shape.click();
    await tab(page, 'now');
    await expect(ticks(), 'both on: the ticks are back').toHaveCount(2);
    expect(dialogs).toEqual([]);
  });

  /** Classic layers (or v2) seeded before the library exists, the tones imported, then (new layout) the opt-in: the
   *  first Play is playTrack's, so the unscanned tone-01 runs the high-frequency check (it "hears" 1,286.6 Hz). */
  async function seededImport(page: Page, set: Record<string, string>, optIn: boolean): Promise<{ dialogs: string[]; analyses: () => number }> {
    const analyses = countConsole(page, 'Fractal Analysis Result');
    const dialogs = await openApp(page, { engine: 'classic' });
    await page.evaluate((set) => {
      for (const [k, v] of Object.entries(set)) localStorage.setItem(k, v);
    }, set);
    await page.reload();
    await acceptDisclaimer(page);
    // 90 s tones: tone-01's "heard" frequency then reads 1,286.6 Hz (the aliasing artefact, spec §2.6; 60 s reads 845).
    await importTones(page, 3, 90);
    if (optIn) {
      await optInNewLayout(page);
      await phoneSize(page);
    }
    return { dialogs, analyses };
  }
  const loweredToast = (p: Page) => p.getByTestId('notices').getByText(/^Tone level lowered from/);

  test('11. comfort guidance: in the new layout the tone lowering is a toast with Undo, nothing is saved, and the Safety panel never opens', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const { dialogs, analyses } = await seededImport(page, { [LAYER_ENGINE_KEY]: 'classic', [TONE_LEVEL_CLASSIC_KEY]: '0.5' }, true);
    await page.getByTestId('np-play').click();
    await expect(loweredToast(page), 'the toast says what changed').toHaveText('Tone level lowered from 50 % to 29 % for this track.', { timeout: 20_000 });
    expect(analyses(), 'the high-frequency check ran').toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId('notices').getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    expect(await key(page, TONE_LEVEL_CLASSIC_KEY), 'the lowering is for the session').toBe('0.5');
    await page.getByTestId('np-output').click();
    await expect(readout(sheet(page, 'Sound').getByTestId('level-tone'))).toHaveText('29 %');
    await page.keyboard.press('Escape');
    // Undo: back to 50 % for the session, nothing saved.
    await page.getByTestId('notices').getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(loweredToast(page)).toHaveCount(0);
    await page.getByTestId('np-output').click();
    await expect(readout(sheet(page, 'Sound').getByTestId('level-tone')), 'Undo restores the level').toHaveText('50 %');
    await page.keyboard.press('Escape');
    expect(await key(page, TONE_LEVEL_CLASSIC_KEY), 'Undo saves nothing').toBe('0.5');
    // No Safety state was set: a peek into classic shows no Safety panel.
    await openLayersTab(page);
    await peekHarmonic(page);
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: 'Close Safety Panel' }), 'no Safety panel in the peek').toHaveCount(0);
    await backFromPeek(page);
    expect(dialogs).toEqual([]);
  });

  test('11b. comfort guidance: v2 at its +12 dB cap is not lowered, so no toast', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const { dialogs, analyses } = await seededImport(page, { [LAYER_ENGINE_KEY]: 'v2', [LAYER_OUTPUT_KEY]: 'headphones', [TONE_LEVEL_V2_KEY]: '0.04' }, true);
    await page.getByTestId('np-play').click();
    await expect.poll(() => analyses(), { message: 'the high-frequency check ran', timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(1500);
    // Read once, not a retrying toHaveCount(0): a toast that did show would pass that by timing out (6 s) meanwhile.
    expect(await loweredToast(page).count(), 'v2 at its cap: no toast').toBe(0);
    await page.getByTestId('np-output').click();
    await expect(readout(sheet(page, 'Sound').getByTestId('level-tone'))).toHaveText('+12.0 dB (max) · −14.0 dB re music');
    await page.keyboard.press('Escape');
    // And no Safety state leaks into classic (v15.5 set it here too, spec §2.6): a peek shows no Safety panel.
    await tab(page, 'library');
    await peekClassicLibrary(page);
    await expect(peekPill(page)).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: 'Close Safety Panel' }), 'no Safety panel in the peek').toHaveCount(0);
    await peekPill(page).click();
    expect(dialogs).toEqual([]);
  });

  test('11c. comfort guidance: the classic layout opens its Safety panel by itself as before, and shows no toast', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const { dialogs, analyses } = await seededImport(page, { [LAYER_ENGINE_KEY]: 'classic', [TONE_LEVEL_CLASSIC_KEY]: '0.5' }, false);
    await phoneSize(page);
    await page.getByText('tone-01', { exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Close Safety Panel' }), 'classic: the panel opens by itself').toBeVisible({ timeout: 20_000 });
    expect(analyses(), 'the high-frequency check ran').toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(800);
    expect(await page.getByText(/^Tone level lowered from/).count(), 'classic: no toast (read once)').toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('11d. comfort guidance: a level moved during the analysis is the one the toast names and Undo restores', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    await recordLiveDecodes(page);
    const { dialogs } = await seededImport(page, { [LAYER_ENGINE_KEY]: 'classic', [TONE_LEVEL_CLASSIC_KEY]: '0.5' }, true);
    // The track's decode (before the analysis) takes 3 s more: room to move the tone level meanwhile, as a user can.
    await page.evaluate(() => ((window as any).__slowLiveDecode = true));
    await page.getByTestId('np-play').click();
    await page.getByTestId('np-output').click();
    const tone = sheet(page, 'Sound').getByTestId('level-tone');
    await setSlider(tone.locator('input'), 0.6);
    await expect(readout(tone)).toHaveText('60 %');
    await page.keyboard.press('Escape');
    expect(await loweredToast(page).count(), 'the analysis has not finished yet').toBe(0);
    await expect(loweredToast(page), 'the toast names the level in effect when it was lowered').toHaveText('Tone level lowered from 60 % to 29 % for this track.', { timeout: 20_000 });
    await page.getByTestId('notices').getByRole('button', { name: 'Undo', exact: true }).click();
    await page.getByTestId('np-output').click();
    await expect(readout(sheet(page, 'Sound').getByTestId('level-tone')), 'Undo restores that level').toHaveText('60 %');
    await page.keyboard.press('Escape');
    expect(dialogs).toEqual([]);
  });

  test('12. the comfort lines: the engine’s own in the Crystal section and the sheet, never "near the top of hearing"; the tile names v2’s tone', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    const V2_LINE = /^v2 plays every crystal as an audible tone between 150 and 1,000 Hz under the music/;
    const CLASSIC_LINE = /^Classic plays crystals up to 639 Hz at pitch and higher ones as a low hum/;
    await openLayersTab(page);
    await layersJump(page, 'crystal').click();
    const crystal = layersSection(page, 'crystal');
    await expect(crystal.getByTestId('crystal-comfort')).toHaveText(V2_LINE);
    await expect(layersSection(page, 'levels').getByText(/^Keep the layers comfortable\. If anything feels unpleasant/)).toBeVisible();
    // The tile names the tone v2 actually plans for the crystal.
    await crystal.getByTestId('crystal-4920').click();
    await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0, { timeout: 10_000 }).toBe(615);
    await expect(page.getByTestId('layers-heard')).toHaveText('v2 plays it as a 615 Hz tone under the music.');
    expect(await page.getByTestId('tab-layers').textContent(), 'the tab').not.toContain('near the top of hearing');
    // The sheet: the same line, and no HEAD line.
    await tab(page, 'now');
    await page.getByTestId('chip-crystal').click();
    await expect(sheet(page, 'Crystal').getByTestId('crystal-comfort')).toHaveText(V2_LINE);
    expect(await sheet(page, 'Crystal').textContent(), 'the sheet').not.toContain('near the top of hearing');
    await page.keyboard.press('Escape');
    // Classic: its own line, and the hum it plays.
    await openLayersTab(page);
    await chooseEngine(page, 'Classic');
    await layersJump(page, 'crystal').click();
    await expect(crystal.getByTestId('crystal-comfort')).toHaveText(CLASSIC_LINE);
    await expect(page.getByTestId('layers-heard')).toHaveText(/^Classic plays it as a \d+ Hz hum\.$/);
    await crystal.getByTestId('crystal-528').click();
    await expect(page.getByTestId('layers-heard')).toHaveText('Classic plays it at 528 Hz.');
    expect(dialogs).toEqual([]);
  });

  test('13. accessibility: every control named and ≥ 44 × 44 at the top, Crystal filtered, Beat under Car and the desktop panel; labelled groups; readouts are the valuetext', async ({ page }) => {
    test.setTimeout(180_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await openLayersTab(page);
    const states: Array<[string, () => Promise<void>]> = [
      ['the top', async () => {}],
      ['Crystal, the filter on', async () => {
        await layersJump(page, 'advanced').click();
        await layersSection(page, 'advanced').getByRole('switch', { name: 'Filter the crystals by experience level' }).click();
        await layersJump(page, 'crystal').click();
        await expect(page.getByTestId('crystal-filter-note')).toBeVisible();
      }],
      ['Beat under Car', async () => {
        await layersJump(page, 'sound').click();
        await chooseOutput(page, 'Car');
        await layersJump(page, 'beat').click();
      }],
      ['the desktop panel', async () => {
        await layersJump(page, 'sound').click();
        await chooseOutput(page, 'Headphones');
        await page.setViewportSize({ width: 1280, height: 800 });
        await expect(page.getByTestId('desktop-panel').getByTestId('tab-layers')).toBeVisible();
      }],
    ];
    for (const [state, enter] of states) {
      await enter();
      await page.waitForTimeout(300);
      expect.soft(await unnamedControls(page), `${state}: unnamed controls`).toEqual([]);
      expect.soft(await smallTargets(page), `${state}: targets under 44 × 44`).toEqual([]);
    }
    // The radio group and the select are labelled; a slider's valuetext is its readout.
    await expect(page.getByRole('group', { name: 'Beat band' }).getByRole('radio')).toHaveCount(5);
    await expect(page.getByRole('combobox', { name: 'Experience level' })).toHaveCount(1);
    const tone = layersSection(page, 'levels').getByTestId('level-tone');
    await expect(tone.locator('input')).toHaveAttribute('aria-valuetext', (await readout(tone).textContent())!);
    await expect(tone.getByRole('slider', { name: 'Tone level' })).toHaveCount(1);
    expect(dialogs).toEqual([]);
  });

  test('14. the Sound sheet: the new sections, one Music-only switch; its row opens the tab at Sound; the tab reopens where it was left', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await page.getByTestId('np-output').click();
    const s = sheet(page, 'Sound');
    await expect(s).toBeVisible();
    await expect(s.getByRole('switch', { name: 'Music only' })).toHaveCount(1);
    await expect(s.getByRole('group', { name: 'Output' }).getByRole('button', { name: 'Headphones', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(s.getByRole('slider', { name: 'Tone level' })).toHaveCount(1);
    await expect(s.getByRole('switch', { name: 'Key fit' })).toHaveCount(1);
    await expect(s.getByTestId('layer-sound-panel'), "no classic panel in the sheet").toHaveCount(0);
    await expect(s.getByTestId('layers-export-log'), 'no Export in the sheet').toHaveCount(0);

    // Down the tab, away and back: where it was left.
    await page.keyboard.press('Escape');
    await openLayersTab(page);
    await layersJump(page, 'beat').click();
    const left = await scroller(page).evaluate((el) => el.scrollTop);
    expect(left).toBeGreaterThan(200);
    await tab(page, 'now');
    await openLayersTab(page);
    expect(Math.abs((await scroller(page).evaluate((el) => el.scrollTop)) - left), 'the tab reopens where it was left').toBeLessThanOrEqual(2);
    await expect(layersJump(page, 'beat')).toHaveAttribute('aria-current', 'true');

    // The sheet's row: the tab, at Sound.
    await tab(page, 'now');
    await page.getByTestId('np-output').click();
    await sheet(page, 'Sound').getByRole('button', { name: 'Every sound setting is in the Layers tab' }).click();
    await expect(page.getByTestId('tab-layers')).toBeVisible();
    await expect(page.getByTestId('sheet-sound')).toHaveCount(0);
    expect(await scroller(page).evaluate((el) => el.scrollTop), 'at Sound').toBeLessThanOrEqual(1);
    await expect(layersJump(page, 'sound')).toHaveAttribute('aria-current', 'true');
    expect(dialogs).toEqual([]);
  });

  // 16. A crash drill per section region: the others stay, the music plays on, Reload panel brings it back.
  for (const name of SECTIONS) {
    test(`16. a crash in layers-${name} leaves the other sections and the music; Reload panel brings it back`, async ({ page }) => {
      test.setTimeout(120_000);
      await instrumentAudio(page);
      const dialogs = await playInNewLayout(page);
      await phoneSize(page);
      await openLayersTab(page);
      const pausesBefore = await pauseCount(page);
      await crash(page, `layers-${name}` as any);
      const fallback = page.getByTestId(`layers-${name}-fallback`);
      await expect(fallback, 'the fallback shows').toBeVisible();
      await expect(fallback.getByRole('alert')).toContainText('This section hit a problem. The music keeps playing.');
      for (const other of SECTIONS.filter((s) => s !== name)) await expect(layersSection(page, other), `${other} is still there`).toHaveCount(1);
      await expectMusicPlaysOn(page, `after the layers-${name} crash`);
      await fallback.getByRole('button', { name: 'Reload panel', exact: true }).click();
      await expect(fallback).toHaveCount(0);
      await expect(layersSection(page, name), 'the section is back').toBeVisible();
      expect(await pauseCount(page), 'no pause through the drill').toBe(pausesBefore);
      expect(dialogs).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 15. The desktop panel
// ---------------------------------------------------------------------------------------------------------------

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('15. Layers opens in the 420 px panel; the transport works meanwhile; Escape closes it', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    if (ON_DEVICE) await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('nav-layers').click();
    const panel = page.getByTestId('desktop-panel');
    await expect(panel.getByTestId('tab-layers')).toBeVisible();
    expect((await panel.boundingBox())!.width, 'the 420 px panel').toBe(420);
    await expect(panel.getByRole('heading', { name: 'Layers', exact: true })).toBeFocused();
    // Non-modal: Pause and Play from the transport while it is open.
    await page.getByTestId('desktop-play').click();
    await expect.poll(async () => (await layerState(page)).music?.paused, { timeout: 5_000 }).toBe(true);
    await expect(panel.getByTestId('tab-layers')).toBeVisible();
    await page.getByTestId('desktop-play').click();
    await expect.poll(async () => (await layerState(page)).music?.paused, { timeout: 5_000 }).toBe(false);
    // A control in the panel works too.
    await panel.getByTestId('layers-jump-beat').click();
    await expect(panel.getByTestId('layers-jump-beat')).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 17. Narrow phones: the jump row scrolls inside itself
// ---------------------------------------------------------------------------------------------------------------

test.describe('narrow phone, touch', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true });

  test('17. at 320 and 360 px the jump row scrolls sideways: every chip comes fully into view and takes a tap; the current chip stays in view', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    // Each chip's touchend and click, timed in the page: on the phone the gap shows whether Chrome held the tap for its
    // double-tap check (the annotation below).
    await page.evaluate(() => {
      const w = window as any;
      w.__jumpTouches = [] as Array<{ type: string; chip: string | null; t: number }>;
      for (const type of ['touchend', 'click']) {
        document.addEventListener(
          type,
          (e) => w.__jumpTouches.push({ type, chip: (e.target as Element | null)?.closest?.('[data-testid^="layers-jump-"]')?.getAttribute('data-testid') ?? null, t: e.timeStamp }),
          true
        );
      }
    });
    const timings: string[] = [];
    try {
      for (const width of [320, 360]) {
        await page.setViewportSize({ width, height: 780 });
        await openLayersTab(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} px: the page itself never scrolls sideways`).toBe(true);
        const row = page.getByTestId('layers-jump');
        // From the page's end (Advanced current), so every tap below must change the current chip, and each one's click
        // has landed before the next finger comes down. (On the phone a second CDP tap within Chrome's double-tap window
        // of the first, 300 ms and near it, is a double tap: neither gives a click. See tapAt. The v15.6 gate's failure:
        // Sound was already current, so its check passed before its click, and Crystal's tap came inside the window.)
        await scroller(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
        await expect(layersJump(page, 'advanced')).toHaveAttribute('aria-current', 'true');
        for (const name of SECTIONS) {
          const chip = layersJump(page, name);
          await chip.scrollIntoViewIfNeeded();
          await rowAndPageStill(page);
          const box = (await chip.boundingBox())!;
          const rowBox = (await row.boundingBox())!;
          expect(box.x >= rowBox.x - 0.5 && box.x + box.width <= rowBox.x + rowBox.width + 0.5 && box.x + box.width <= width + 0.5, `${width} px, ${name}: fully in view (${Math.round(box.x)}–${Math.round(box.x + box.width)})`).toBe(true);
          const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid^="layers-jump-"]')?.getAttribute('data-testid') ?? null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
          expect(hit, `${width} px, ${name}: a tap at its centre lands on it`).toBe(`layers-jump-${name}`);
          const seen = await page.evaluate(() => (window as any).__jumpTouches.length as number);
          await tapAt(page, box.x + box.width / 2, box.y + box.height / 2);
          await expect(chip, `${width} px, ${name}: the tap jumps`).toHaveAttribute('aria-current', 'true');
          const events = await page.evaluate((from) => ((window as any).__jumpTouches as Array<{ type: string; chip: string | null; t: number }>).slice(from), seen);
          const end = events.find((e) => e.type === 'touchend');
          const click = events.find((e) => e.type === 'click' && e.chip === `layers-jump-${name}`);
          timings.push(`${width}/${name}: ${end && click ? `${Math.round(click.t - end.t)} ms` : `touchend ${end ? 'yes' : 'no'}, click ${click ? 'yes' : 'no'}`}`);
        }
        // Scrolled by hand to the end of the page: Advanced is current, and the row brings it into view by itself.
        await layersJump(page, 'sound').evaluate((b) => (b as HTMLButtonElement).click());
        await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeLessThanOrEqual(1);
        await scroller(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
        await expect(layersJump(page, 'advanced')).toHaveAttribute('aria-current', 'true');
        await expect
          .poll(async () => {
            const b = (await layersJump(page, 'advanced').boundingBox())!;
            return b.x + b.width <= width + 0.5 && b.x >= 0;
          }, { message: `${width} px: the current chip is kept in view` })
          .toBe(true);
        await tab(page, 'now');
      }
      // Diagnostic only, not asserted (v15.6 phone gate): the old test's pattern, a tap on the current chip and at once one
      // on its neighbour. On the phone the annotation says whether the second still gives a click.
      await openLayersTab(page);
      await layersJump(page, 'sound').evaluate((b) => (b as HTMLButtonElement).click());
      await expect(layersJump(page, 'sound')).toHaveAttribute('aria-current', 'true');
      await rowAndPageStill(page);
      const s = (await layersJump(page, 'sound').boundingBox())!;
      const c = (await layersJump(page, 'crystal').boundingBox())!;
      const seen = await page.evaluate(() => (window as any).__jumpTouches.length as number);
      await tapAt(page, s.x + s.width / 2, s.y + s.height / 2);
      await tapAt(page, c.x + c.width / 2, c.y + c.height / 2, { spaced: false });
      await page.waitForTimeout(1500);
      const pair = await page.evaluate((from) => ((window as any).__jumpTouches as Array<{ type: string; chip: string | null; t: number }>).slice(from), seen);
      const current = await page.evaluate(() => document.querySelector('[data-testid^="layers-jump-"][aria-current="true"]')?.getAttribute('data-testid') ?? 'none');
      timings.push(`quick pair (Sound current, then Crystal at once): ${pair.map((e) => `${e.type} ${e.chip?.replace('layers-jump-', '') ?? '-'} @${Math.round(e.t)}`).join(', ') || 'no events'}; current after: ${current.replace('layers-jump-', '')}`);
    } finally {
      test.info().annotations.push({ type: 'touchend → click per chip', description: timings.join('; ') || 'none' });
    }
    expect(dialogs).toEqual([]);
  });
});

/** Until the jump row and the page have both stopped moving: the same scroll offsets over two frames, twice running
 *  (a finger that lands on a scroller still moving stops it and gives no click). */
async function rowAndPageStill(page: Page): Promise<void> {
  const offsets = () =>
    page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const read = () => {
            const row = document.querySelector('[data-testid="layers-jump"]');
            const scroll = document.querySelector('[data-testid="layers-scroll"]');
            return `${row?.scrollLeft ?? -1}/${scroll?.scrollTop ?? -1}`;
          };
          const a = read();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(a === read() ? a : '')));
        })
    );
  let last = '';
  await expect
    .poll(
      async () => {
        const now = await offsets();
        const still = now !== '' && now === last;
        last = now;
        return still;
      },
      { message: 'the jump row and the page are still', timeout: 5_000, intervals: [50] }
    )
    .toBe(true);
}

// ---------------------------------------------------------------------------------------------------------------
// 18. The tone lowering is for the track (the user's decision): the next track restores the level, in both layouts
// ---------------------------------------------------------------------------------------------------------------

/**
 * Classic layers at 50 %, 90 s tones: tone-01 unscanned (its check lowers the tone to 29 %), tone-02 and tone-03 with
 * a crystal (no check on them, and the gapless advance can take them). Optionally into the new layout.
 */
async function perTrackSetup(page: Page, optIn: boolean): Promise<string[]> {
  const dialogs = await openApp(page, { engine: 'classic' });
  await page.evaluate((k) => localStorage.setItem(k, '0.5'), TONE_LEVEL_CLASSIC_KEY);
  await page.reload();
  await acceptDisclaimer(page);
  await importTones(page, 3, 90);
  await expectCache(page, { library: 3, meta: 3 });
  await seedTracks(page, [{ index: 1, crystal: 528 }, { index: 2, crystal: 639 }]);
  await page.goto('/');
  await acceptDisclaimer(page);
  await page.getByText('tone-01', { exact: true }).first().waitFor({ timeout: 20_000 });
  if (optIn) {
    await optInNewLayout(page);
    await phoneSize(page);
  }
  return dialogs;
}

/** The new layout's tone readout, from the Sound sheet. */
async function soundSheetTone(page: Page): Promise<string> {
  await page.getByTestId('np-output').click();
  const text = (await readout(sheet(page, 'Sound').getByTestId('level-tone')).textContent()) ?? '';
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sheet-sound')).toHaveCount(0);
  return text;
}

const lowered = (page: Page) =>
  page.getByTestId('notices').getByText('Tone level lowered from 50 % to 29 % for this track.', { exact: true });

test.describe('phone, the tone lowering per track', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('18a. new layout: Next restores the level the lowering took, and nothing is saved', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await perTrackSetup(page, true);
    await page.getByTestId('np-play').click();
    await expect(lowered(page)).toBeVisible({ timeout: 20_000 });
    expect(await soundSheetTone(page)).toBe('29 %');
    await page.getByRole('button', { name: 'Next track' }).click();
    await expect(page.getByTestId('np-title')).toHaveText('tone-02', { timeout: 15_000 });
    await expect.poll(() => soundSheetTone(page), { message: 'the next track: the level back', timeout: 10_000 }).toBe('50 %');
    expect(await key(page, TONE_LEVEL_CLASSIC_KEY), 'nothing saved').toBe('0.5');
    expect(dialogs).toEqual([]);
  });

  test('18b. new layout: a gapless auto-advance restores it too', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await perTrackSetup(page, true);
    await page.getByTestId('np-play').click();
    await expect(lowered(page)).toBeVisible({ timeout: 20_000 });
    expect(await soundSheetTone(page)).toBe('29 %');
    const pausesBefore = await pauseCount(page);
    // To the track's last moment: the gapless advance takes tone-02 (it has a crystal).
    await page.getByTestId('np-seek').focus();
    await page.keyboard.press('End');
    await expect(page.getByTestId('np-title')).toHaveText('tone-02', { timeout: 20_000 });
    expect(await pauseCount(page), 'gapless: no pause() at the advance').toBe(pausesBefore);
    await expect.poll(() => soundSheetTone(page), { message: 'after the gapless advance: the level back', timeout: 10_000 }).toBe('50 %');
    expect(await key(page, TONE_LEVEL_CLASSIC_KEY)).toBe('0.5');
    expect(dialogs).toEqual([]);
  });

  test('18c. new layout: a level the user set since stays at the next track', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await perTrackSetup(page, true);
    await page.getByTestId('np-play').click();
    await expect(lowered(page)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('np-output').click();
    await setSlider(sheet(page, 'Sound').getByTestId('level-tone').locator('input'), 0.4);
    await expect(readout(sheet(page, 'Sound').getByTestId('level-tone'))).toHaveText('40 %');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Next track' }).click();
    await expect(page.getByTestId('np-title')).toHaveText('tone-02', { timeout: 15_000 });
    await page.waitForTimeout(1000);
    expect(await soundSheetTone(page), 'the level the user set stands').toBe('40 %');
    expect(dialogs).toEqual([]);
  });

  test('18d. new layout: Undo, then Next: no change', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await perTrackSetup(page, true);
    await page.getByTestId('np-play').click();
    await expect(lowered(page)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('notices').getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await soundSheetTone(page)).toBe('50 %');
    await page.getByRole('button', { name: 'Next track' }).click();
    await expect(page.getByTestId('np-title')).toHaveText('tone-02', { timeout: 15_000 });
    await page.waitForTimeout(1000);
    expect(await soundSheetTone(page)).toBe('50 %');
    expect(await key(page, TONE_LEVEL_CLASSIC_KEY)).toBe('0.5');
    expect(dialogs).toEqual([]);
  });
});

test.describe('desktop, the tone lowering per track', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('18e. classic layout: the lowering (Safety panel as before) is for the track; Next restores the level', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await perTrackSetup(page, false);
    await page.getByText('tone-01', { exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Close Safety Panel' }), 'classic: the panel opens by itself').toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Close Safety Panel' }).evaluate((b) => (b as HTMLButtonElement).click());
    await openHarmonicControl(page);
    await expect(layerIntensity(page)).toHaveText('29%');
    await page.getByRole('button', { name: 'Next track' }).click();
    await expect(page.getByTestId('now-playing-title')).toHaveText('tone-02', { timeout: 15_000 });
    await expect(layerIntensity(page), 'the next track: the level back').toHaveText('50%', { timeout: 10_000 });
    expect(await key(page, TONE_LEVEL_CLASSIC_KEY), 'nothing saved').toBe('0.5');
    expect(dialogs).toEqual([]);
  });

  test('18f. classic layout: a gapless auto-advance restores it too', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await perTrackSetup(page, false);
    await page.getByText('tone-01', { exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Close Safety Panel' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Close Safety Panel' }).evaluate((b) => (b as HTMLButtonElement).click());
    await openHarmonicControl(page);
    await expect(layerIntensity(page)).toHaveText('29%');
    const pausesBefore = await pauseCount(page);
    // To the track's last moment: the gapless advance takes tone-02 (it has a crystal).
    await page.evaluate(() => {
      const m = (window as any).__audio.music as HTMLMediaElement;
      m.currentTime = Math.max(0, m.duration - 1.5);
    });
    await expect(page.getByTestId('now-playing-title')).toHaveText('tone-02', { timeout: 20_000 });
    expect(await pauseCount(page), 'gapless: no pause() at the advance').toBe(pausesBefore);
    await expect(layerIntensity(page), 'after the gapless advance: the level back').toHaveText('50%', { timeout: 10_000 });
    expect(await key(page, TONE_LEVEL_CLASSIC_KEY)).toBe('0.5');
    expect(dialogs).toEqual([]);
  });
});
