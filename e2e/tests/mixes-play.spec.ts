import { type Locator, type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  acceptDisclaimer,
  acceptDisclaimerNew,
  cacheCounts,
  countLibraryDeletes,
  libraryRowButton,
  libraryState,
  layersState,
  libraryUndo,
  openLibraryTab,
  openSeededNewLayout,
  savedState,
  startWalk,
  undoToast,
  LAYER_ENGINE_KEY,
  LAYER_OUTPUT_KEY,
  LAYOUT_KEY,
  PHONE_VIEWPORT,
} from './helpers';
import { EXPERIENCE_KEY, heard, mediaHooks, oscSince, perfNow, savedViz, seedTones, toneName, vizProps, type ToneSeed } from './tones';

// v15.9 (the plan's v14.17), Stage A: every mix starts playing through startPlayOrder (the list-swap bug's regression
// test), with an Undo; the 111/2178 tone overrides and the experience raises are gone; mixes never change the visual
// settings (the user's decision 2); Restore Library's cursor; the classic 111 chip; walks survive a reload; only taps of
// one kind chain. Synthetic tones only (tone-01 …), each with its OWN length (20 s + its index), so the track the music
// element really plays is known from the element's duration, not from the cursor or the title.
// The classic labels accept v15.8's names too, so the same file runs on v15.8 as the negative control.

const nameOf = toneName;
const seed = seedTones;
const hooks = mediaHooks;
const now = perfNow;
type Seed = ToneSeed;

/** Classic layout and sound (`engine`: v2 on headphones instead), tutorial skipped, the experience level set once. */
async function openClassic(page: Page, s: Seed, o: { engine?: 'classic' | 'v2'; experience?: string } = {}): Promise<string[]> {
  await page.addInitScript(({ keys, engine, experience }) => {
    localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
    if (sessionStorage.getItem('__mixesSeeded') === null) {
      sessionStorage.setItem('__mixesSeeded', '1');
      localStorage.setItem(keys.engine, engine);
      if (engine === 'v2') localStorage.setItem(keys.output, 'headphones');
      if (experience) localStorage.setItem(keys.experience, experience);
    }
  }, { keys: { engine: LAYER_ENGINE_KEY, output: LAYER_OUTPUT_KEY, experience: EXPERIENCE_KEY }, engine: o.engine ?? 'classic', experience: o.experience ?? null });
  await hooks(page);
  const ids = await seed(page, s);
  await page.goto('/');
  await acceptDisclaimer(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(s.n - (s.noBlob?.length ?? 0));
  return ids;
}

const aside = (page: Page) => page.locator('aside');
/** Classic's Undo toast (the always-mounted status region; its data-testid is the new layout's only). */
const classicToast = (page: Page) => page.getByRole('status').locator('div[aria-atomic="true"]').filter({ has: page.getByRole('button', { name: 'Undo', exact: true }) });
const nextClassic = (page: Page) => page.getByRole('button', { name: 'Next track', exact: true }).first();

/**
 * The classic drawer's mixes by their accessible names (v15.8's names too, for the negative control). The presets'
 * names carry their recipe ("Flow 285·417·528·639·741"): "Flow" alone is also the visual settings' Flow switch.
 * `toast`: the words the Undo toast must say (the count is checked against the play order).
 */
const CLASSIC: Array<{ label: RegExp; toast: string }> = [
  { label: /^GUT Alignment/, toast: 'GUT Alignment' },
  { label: /^Full Alignment/, toast: 'Full Alignment' },
  { label: /^HEART Alignment/, toast: 'HEART Alignment' },
  { label: /^HEAD Alignment/, toast: 'HEAD Alignment' },
  { label: /^(Grounding 174·285·396·417|Qi Strength)/, toast: 'Grounding' },
  { label: /^(Stillness 174·285·528|Deep Healing)/, toast: 'Stillness' },
  { label: /^(Uplift 396·417·639|Mood Elevate)/, toast: 'Uplift' },
  { label: /^Meditation( 741·852·963)?$/, toast: 'Meditation' },
  { label: /^(Flow 285·417·528·639·741|Flow State)/, toast: 'Flow' },
  { label: /^Golden Φ/, toast: 'Golden Φ' },
  { label: /^111 Sequence/, toast: '111 Sequence' },
  { label: /^2178Hz Filter/, toast: '2178 Hz · SOURCE' },
  { label: /^Ultimate/, toast: 'Ultimate' },
];
const mixButton = (page: Page, label: RegExp): Locator => aside(page).getByRole('button', { name: label }).first();
async function tapMix(page: Page, label: RegExp): Promise<void> {
  const b = mixButton(page, label);
  await b.scrollIntoViewIfNeeded();
  await b.click();
}
/** Classic's Lo Shu popover, then a walk by its title. */
async function tapClassicWalk(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: /^Lo Shu (controls|Walk active|Perfect GUT mapping)/ }).click();
  await page.locator(`button[title^="${title}"]`).click();
}
/** Restore Library (the library around the playing track), then tone-05 playing from the classic list. */
async function fromTone05(page: Page): Promise<void> {
  await aside(page).getByRole('button', { name: 'Restore Library', exact: true }).click();
  await expect.poll(async () => { const s = await libraryState(page); return s.ids.length === s.libraryIds.length; }, { timeout: 10_000 }).toBe(true);
  if ((await heard(page)).name !== nameOf(4)) {
    const row = aside(page).getByText(nameOf(4), { exact: true });
    await row.scrollIntoViewIfNeeded();
    await row.click();
  }
  await expect.poll(async () => { const h = await heard(page); const s = await libraryState(page); return h.name === nameOf(4) && s.playing && h.t > 0.3; }, { message: 'tone-05 plays', timeout: 20_000 }).toBe(true);
}

test.beforeEach(async ({ page, viewport }) => {
  if (ON_DEVICE && viewport) await page.setViewportSize(viewport);
});

test.describe('desktop, classic', () => {
  test('R1. the list-swap regression: after Grounding the PLAYING track is the mix’s first, the card names it, Undo is offered, Next goes to the second and third', async ({ page }) => {
    test.setTimeout(150_000);
    await openClassic(page, { n: 30 });
    await aside(page).getByText(nameOf(4), { exact: true }).click();
    await expect.poll(async () => { const h = await heard(page); return h.name === nameOf(4) && h.t > 1; }, { message: 'tone-05 plays', timeout: 20_000 }).toBe(true);
    const before = await heard(page);
    await tapMix(page, /^(Grounding 174·285·396·417|Qi Strength)/);
    // The mix: the 174, 285, 396 and 417 tracks in that order (tone-01, tone-28, tone-02, tone-29, tone-03, tone-30, tone-04).
    const mix = [0, 27, 1, 28, 2, 29, 3].map(nameOf);
    await expect.poll(async () => (await libraryState(page)).names, { timeout: 10_000 }).toEqual(mix);
    await expect.poll(async () => (await heard(page)).name, { message: 'the element plays the mix’s first track', timeout: 15_000 }).toBe(mix[0]);
    const after = await heard(page);
    expect(after.src, 'a new source').not.toBe(before.src);
    expect(after.t, 'from its start').toBeLessThan(3);
    await expect.poll(async () => (await heard(page)).card, { message: 'the lock-screen card' }).toBe(mix[0]);
    expect((await libraryState(page)).cursor).toBe(0);
    await expect(classicToast(page)).toContainText('Playing Grounding: 7 tracks.');
    for (const k of [1, 2]) {
      await nextClassic(page).click();
      await expect.poll(async () => (await heard(page)).name, { message: `Next → the mix's track ${k + 1}`, timeout: 15_000 }).toBe(mix[k]);
      await expect.poll(async () => (await heard(page)).card).toBe(mix[k]);
    }
    const c = await cacheCounts(page);
    expect([c.blobs, c.library]).toEqual([30, 30]);
  });

  test('R1b. each of the 13 classic mixes and a walk plays its own first track, started from a track that is not its first, with its own Undo toast', async ({ page }) => {
    test.setTimeout(300_000);
    // Every crystal has a track; tracks 0–26 scanned (the 111 Sequence and the 2178 filter find theirs), and two of them
    // over Golden Φ's 30 % (tone-21 at 60 %, tone-23 at 50 %).
    await openClassic(page, { n: 30, scanned: (i) => i < 27, golden: (i) => (i === 20 ? 0.6 : i === 22 ? 0.5 : 0.2) });
    const firsts: Record<string, string> = {};
    const run = async (what: string, toast: RegExp, tap: () => Promise<void>) => {
      await fromTone05(page);
      const before = await heard(page);
      await tap();
      await expect
        .poll(async () => { const s = await libraryState(page); const h = await heard(page); return s.cursor === 0 && s.playing && h.name === s.names[0] && h.src !== before.src && h.t < 5; }, { message: `${what}: its first track plays`, timeout: 15_000 })
        .toBe(true);
      const s = await libraryState(page);
      expect(s.names[0], `${what}: started from a track that is not its first`).not.toBe(before.name);
      await expect(classicToast(page), `${what}: its Undo toast`).toContainText(toast);
      await expect.poll(async () => (await heard(page)).card, { message: `${what}: the card` }).toBe(s.names[0]);
      firsts[what] = s.names[0];
    };
    for (const m of CLASSIC) {
      await run(m.toast, new RegExp(`^Playing ${m.toast.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: \\d+ tracks?\\.`), () => tapMix(page, m.label));
    }
    await run('Layer Ascent', /^Playing Layer Ascent: 27 of 27 positions\./, () => tapClassicWalk(page, 'Layer Ascent'));
    test.info().annotations.push({ type: 'first tracks', description: JSON.stringify(firsts) });
    expect(Object.keys(firsts).length).toBe(14);
  });

  test('R12. a one-track mix plays its track: the 2178 filter with one scanned 2178 track', async ({ page }) => {
    test.setTimeout(120_000);
    await openClassic(page, { n: 30, scanned: (i) => i === 13 });
    await fromTone05(page);
    await tapMix(page, /^2178Hz Filter/);
    await expect.poll(async () => (await heard(page)).name, { message: 'its one track plays', timeout: 15_000 }).toBe(nameOf(13));
    const s = await libraryState(page);
    expect([s.names, s.cursor, s.playing]).toEqual([[nameOf(13)], 0, true]);
    expect((await heard(page)).t).toBeLessThan(3);
    await expect(classicToast(page)).toContainText('Playing 2178 Hz · SOURCE: 1 track.');
    await expect.poll(async () => (await heard(page)).card).toBe(nameOf(13));
  });

  test('R6. Restore Library keeps the music and points the cursor at it; Next goes on in library order', async ({ page }) => {
    test.setTimeout(120_000);
    await openClassic(page, { n: 30 });
    await tapMix(page, /^HEART Alignment/); // tone-10 … tone-18
    await expect.poll(async () => (await heard(page)).name, { timeout: 15_000 }).toBe(nameOf(9));
    await page.waitForTimeout(1500);
    const before = await heard(page);
    await aside(page).getByRole('button', { name: 'Restore Library', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).ids.length).toBe(30);
    const s = await libraryState(page);
    expect(s.cursor, 'the cursor on the playing track’s place in the library').toBe(9);
    expect(s.current).toBe(nameOf(9));
    const h = await heard(page);
    expect(h.src, 'the music never restarted').toBe(before.src);
    expect(h.t).toBeGreaterThanOrEqual(before.t);
    expect(h.card).toBe(nameOf(9));
    await nextClassic(page).click();
    await expect.poll(async () => (await heard(page)).name, { message: 'Next → library[10]', timeout: 15_000 }).toBe(nameOf(10));
  });

  test('R4. the 111 Sequence plays its first track at that track’s crystal, never 111 Hz; the classic 111 chip sets 111 Hz', async ({ page }) => {
    test.setTimeout(120_000);
    // The nine orders' first crystals (174, 396, 741, 1206, 1935, 2664, 3504, 4566, 5628) scanned.
    const firsts = new Set([0, 2, 6, 9, 12, 15, 18, 21, 24]);
    await openClassic(page, { n: 30, scanned: (i) => firsts.has(i) });
    await aside(page).getByText(nameOf(4), { exact: true }).click();
    await expect.poll(async () => (await heard(page)).name, { timeout: 20_000 }).toBe(nameOf(4));
    await tapMix(page, /^111 Sequence/);
    await expect.poll(async () => (await heard(page)).name, { message: 'its first track plays', timeout: 15_000 }).toBe(nameOf(0));
    const seen = new Set<number>();
    for (let k = 0; k < 10; k++) { seen.add((await vizProps(page)).hz); await page.waitForTimeout(200); }
    expect([...seen], 'the tone (the Visualizer’s frequency) is the first track’s crystal throughout').toEqual([174]);
    // The chip, in Harmonic Control under the Traditional Scale.
    await page.getByRole('button', { name: 'Harmonic Control', exact: true }).click();
    const chip = page.getByTestId('classic-crystal-111');
    await chip.scrollIntoViewIfNeeded();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(chip).toHaveAccessibleName('111 Hz · non-canonical');
    await chip.click();
    await expect.poll(async () => (await vizProps(page)).hz).toBe(111);
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  test('R2. v2: the 111 Sequence and the 2178 filter retune the layers to their first track’s own plan, never the 111 Hz fold (222 / 444 / 454 / 27.75 Hz)', async ({ page }) => {
    test.setTimeout(240_000);
    await openClassic(page, { n: 30, scanned: (i) => i < 27 }, { engine: 'v2' });
    const FOLD_111 = [27.75, 111, 222, 444, 454];
    // The layers while a mix's first track plays, against the same track played straight from the list.
    const planAfter = async (tap: () => Promise<void>, want: string) => {
      const t0 = await now(page);
      await tap();
      await expect.poll(async () => (await heard(page)).name, { message: `${want} plays`, timeout: 15_000 }).toBe(want);
      await page.waitForTimeout(4000);
      return { osc: await oscSince(page, t0), requested: (await layersState(page))?.requested ?? null };
    };
    for (const [label, first] of [[/^111 Sequence/, nameOf(0)], [/^2178Hz Filter/, nameOf(13)]] as const) {
      await fromTone05(page);
      await page.waitForTimeout(2000);
      const viaMix = await planAfter(() => tapMix(page, label), first);
      await fromTone05(page);
      await page.waitForTimeout(2000);
      const direct = await planAfter(async () => {
        const row = aside(page).getByText(first, { exact: true });
        await row.scrollIntoViewIfNeeded();
        await row.click();
      }, first);
      test.info().annotations.push({ type: `${label.source}`, description: `mix ${JSON.stringify(viaMix)}; the track itself ${JSON.stringify(direct)}` });
      expect(viaMix.osc.length, 'the layers retune').toBeGreaterThan(0);
      expect(viaMix.osc.filter((v) => FOLD_111.includes(v)), 'no oscillator set to the 111 Hz fold').toEqual([]);
      // The v2 player's plan: the one it plays for that track when the track is played by itself.
      expect(viaMix.requested, 'a plan').not.toBeNull();
      expect(viaMix.requested, 'the first track’s own plan').toEqual(direct.requested);
    }
  });

  test('R7. no experience raise: a beginner plays HEART, HEAD, Full, the 111 Sequence and Ultimate; the level stays beginner and no notice announces a raise', async ({ page }) => {
    test.setTimeout(180_000);
    await openClassic(page, { n: 30, scanned: (i) => i < 27 }, { experience: 'beginner' });
    for (const label of [/^HEART Alignment/, /^HEAD Alignment/, /^Full Alignment/, /^111 Sequence/, /^Ultimate/]) {
      await tapMix(page, label);
      await expect.poll(async () => (await libraryState(page)).playing, { message: `${label.source} plays`, timeout: 15_000 }).toBe(true);
      await page.waitForTimeout(1500);
      expect(await page.evaluate((k) => localStorage.getItem(k), EXPERIENCE_KEY), `${label.source}: the level`).toBe('beginner');
      await expect(page.getByText(/Experience level|Use extreme caution/), `${label.source}: no raise notice`).toHaveCount(0);
    }
  });

  test('R11. mixes never change the visual settings (decision 2): GUT, Ultimate, the 111 Sequence, the 2178 filter and a walk, and their Undo, leave them exactly as they were', async ({ page }) => {
    test.setTimeout(240_000);
    await openClassic(page, { n: 30, scanned: (i) => i < 27 });
    await page.waitForTimeout(500);
    const base = await savedViz(page);
    const baseProps = JSON.stringify((await vizProps(page)).settings);
    expect(JSON.parse(base ?? '{}').showTreeOfLife, 'the Tree of Life is off (the default)').toBe(false);
    const same = async (what: string) => {
      await page.waitForTimeout(800);
      expect(await savedViz(page), `${what}: the saved visual settings`).toBe(base);
      expect(JSON.stringify((await vizProps(page)).settings), `${what}: the Visualizer's settings`).toBe(baseProps);
    };
    const steps: Array<[string, () => Promise<void>]> = [
      ['GUT Alignment', () => tapMix(page, /^GUT Alignment/)],
      ['Ultimate', () => tapMix(page, /^Ultimate/)],
      ['111 Sequence', () => tapMix(page, /^111 Sequence/)],
      ['2178 filter', () => tapMix(page, /^2178Hz Filter/)],
      ['Layer Ascent', () => tapClassicWalk(page, 'Layer Ascent')],
    ];
    for (const [what, tap] of steps) {
      await fromTone05(page);
      await tap();
      await expect
        .poll(async () => { const s = await libraryState(page); const h = await heard(page); return s.cursor === 0 && s.playing && h.name === s.names[0] && s.names[0] !== nameOf(4); }, { message: `${what} plays`, timeout: 15_000 })
        .toBe(true);
      await same(what);
      await libraryUndo(page);
      await same(`${what}, then Undo`);
    }
  });

  test('R10. data safety: the 13 mixes, the 6 walks and Restore, each followed by Undo, never change the stored audio, metadata or library, and delete nothing', async ({ page }) => {
    test.setTimeout(480_000);
    await countLibraryDeletes(page);
    await openClassic(page, { n: 30, scanned: (i) => i < 27, golden: (i) => (i === 20 ? 0.6 : 0.2) });
    await page.waitForTimeout(3000);
    const base = await cacheCounts(page);
    const baseOrder = (await savedState(page)).originalOrder as string[];
    expect([base.blobs, base.meta, base.library, base.libraryRaw]).toEqual([30, 30, 30, 30]);
    const settle = async (label: string) => {
      await page.waitForTimeout(2600); // past the 2 s metadata debounce
      const c = await cacheCounts(page);
      expect.soft([c.blobs, c.meta, c.library, c.libraryRaw], `${label}: blobs, meta, library, libraryRaw`).toEqual([30, 30, 30, 30]);
      expect.soft(await page.evaluate(() => (window as any).__idbDeletes), `${label}: no IndexedDB delete or clear`).toBe(0);
      expect.soft((await savedState(page)).originalOrder, `${label}: the saved library order`).toEqual(baseOrder);
      expect.soft((await libraryState(page)).libraryIds, `${label}: the library in memory`).toEqual(baseOrder);
    };
    const undo = async (label: string) => {
      await page.waitForTimeout(800);
      await libraryUndo(page);
      await settle(label + ', then Undo');
    };
    for (const m of CLASSIC) {
      await tapMix(page, m.label);
      await settle(m.toast);
      await undo(m.toast);
    }
    for (const title of ['Layer Ascent', 'Pillar Walk', 'Flying Star Vortex', 'Combined Walk', 'Ouroboros', 'Calling a CABI']) {
      await tapClassicWalk(page, title);
      await expect.poll(async () => (await libraryState(page)).walk !== null, { message: `${title} starts`, timeout: 15_000 }).toBe(true);
      await settle(title);
      await undo(title);
    }
    await tapMix(page, /^GUT Alignment/);
    await aside(page).getByRole('button', { name: 'Restore Library', exact: true }).click();
    await settle('Restore Library');
    await undo('Restore Library');
  });
});

test.describe('desktop, classic: the review’s fixes', () => {
  test('R14. Restore Library while the mix’s first track is still starting (a slow decode): the cursor and the card follow the track that plays; Next goes on in library order', async ({ page }) => {
    test.setTimeout(150_000);
    // Every decode takes 2 s longer, so the mix's first track (tone-03, no measured frequency) is still starting.
    await page.addInitScript(() => {
      const d = BaseAudioContext.prototype.decodeAudioData;
      BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...a: unknown[]) {
        return new Promise((r) => setTimeout(r, 2000)).then(() => (d as any).apply(this, a));
      } as any;
    });
    await openClassic(page, { n: 30, unscanned: (i) => i === 2 });
    await aside(page).getByText(nameOf(4), { exact: true }).click();
    await expect.poll(async () => { const h = await heard(page); return h.name === nameOf(4) && h.t > 0.5; }, { message: 'tone-05 plays', timeout: 20_000 }).toBe(true);
    // Uplift (396 · 417 · 639: tone-03 first), then Restore Library in the next task.
    await page.evaluate(() => new Promise<void>((res) => {
      const text = (b: Element) => (b.textContent || '').replace(/\s+/g, ' ').trim();
      const btns = [...document.querySelectorAll('aside button')] as HTMLButtonElement[];
      btns.find((b) => text(b).startsWith('Uplift'))!.click();
      setTimeout(() => { btns.find((b) => text(b) === 'Restore Library')!.click(); res(); }, 0);
    }));
    await expect.poll(async () => (await heard(page)).name, { message: 'tone-03 plays', timeout: 20_000 }).toBe(nameOf(2));
    await page.waitForTimeout(2500); // past any late write of the superseded start
    const s = await libraryState(page);
    expect(JSON.stringify(s.ids) === JSON.stringify(s.libraryIds), 'the library is the play order').toBe(true);
    expect([s.cursor, s.current], 'the cursor on the track that plays').toEqual([2, nameOf(2)]);
    expect((await heard(page)).card, 'the card').toBe(nameOf(2));
    await nextClassic(page).click();
    await expect.poll(async () => (await heard(page)).name, { message: 'Next → library[3]', timeout: 15_000 }).toBe(nameOf(3));
  });

  test('R15. Undo from a tone-only session: the 111 Hz chip (no music), the 111 Sequence, then Undo: the music stops and the 111 Hz tone sounds again', async ({ page }) => {
    test.setTimeout(150_000);
    const firsts = new Set([0, 2, 6, 9, 12, 15, 18, 21, 24]);
    await openClassic(page, { n: 30, scanned: (i) => firsts.has(i) }, { engine: 'v2' });
    await page.getByRole('button', { name: 'Harmonic Control', exact: true }).click();
    const chip = page.getByTestId('classic-crystal-111');
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    const toneOnly = async () => { const s = await libraryState(page); const v = await vizProps(page); const l = await layersState(page); return { playing: s.playing, hz: v?.hz ?? null, tone: l?.requested?.tone_hz ?? null }; };
    await expect.poll(toneOnly, { message: 'a tone-only session at 111 Hz' }).toEqual({ playing: false, hz: 111, tone: 222 });
    await tapMix(page, /^111 Sequence/);
    await expect.poll(async () => (await heard(page)).name, { message: 'the mix plays', timeout: 15_000 }).toBe(nameOf(0));
    await expect.poll(async () => (await vizProps(page))?.hz).toBe(174);
    await classicToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(toneOnly, { message: 'back: no music, the 111 Hz tone sounding', timeout: 10_000 }).toEqual({ playing: false, hz: 111, tone: 222 });
    await page.waitForTimeout(1500);
    expect(await toneOnly(), 'and it stays').toEqual({ playing: false, hz: 111, tone: 222 });
  });
});

test.describe('phone, new layout', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('R16. a Library row’s Undo (v15.7) puts the tone back too: a paused walk with the 111 Hz chip picked, a row tap, Undo: paused, the walk, 111 Hz sounding', async ({ page }) => {
    test.setTimeout(150_000);
    await hooks(page);
    await openSeededNewLayout(page, 30, { patch: [{ index: 7, crystal: null }] });
    await startWalk(page, 'A');
    await page.getByTestId('view-now').getByRole('button', { name: 'Pause', exact: true }).first().click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    await page.getByTestId('chip-crystal').click();
    await page.getByTestId('crystal-111').click();
    await page.keyboard.press('Escape');
    const state = async () => { const s = await libraryState(page); const v = await vizProps(page); const l = await layersState(page); return { walk: s.walk, playing: s.playing, hz: v?.hz ?? null, tone: l?.requested?.tone_hz ?? null }; };
    await expect.poll(state, { message: 'the paused walk, a tone-only 111 Hz' }).toEqual({ walk: 'A', playing: false, hz: 111, tone: 222 });
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0011').click();
    await expect.poll(async () => (await libraryState(page)).current, { timeout: 15_000 }).toBe('tone-0011');
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(state, { message: 'back exactly: the walk, paused, the 111 Hz tone', timeout: 10_000 }).toEqual({ walk: 'A', playing: false, hz: 111, tone: 222 });
  });

  test('R5. a walk survives a reload: mode, segments, phases, steps, cursor, the source line and the cube step; Next goes on', async ({ page }) => {
    test.setTimeout(180_000);
    await hooks(page);
    await openSeededNewLayout(page, 30, { patch: [{ index: 7, crystal: null }] });
    await startWalk(page, 'cabi');
    for (let k = 1; k <= 3; k++) {
      await page.getByTestId('view-now').getByRole('button', { name: 'Next track', exact: true }).click();
      await expect.poll(async () => (await libraryState(page)).cursor, { timeout: 15_000 }).toBe(k);
    }
    await expect.poll(async () => { const st = await savedState(page); return st?.currentSongIndex === 3 && st?.loShuWalkMode === 'cabi' && st?.walk?.mode === 'cabi'; }, { message: 'the walk saved with the play order', timeout: 15_000 }).toBe(true);
    const before = await libraryState(page);
    await page.reload();
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(30);
    await expect.poll(async () => (await libraryState(page)).walk, { message: 'the walk is back', timeout: 10_000 }).toBe('cabi');
    const after = await libraryState(page);
    expect(after.ids).toEqual(before.ids);
    expect(after.cursor).toBe(3);
    expect(after.segments).toEqual(before.segments);
    expect(after.phases).toEqual(before.phases);
    expect(after.steps).toEqual(before.steps);
    await expect(page.getByTestId('np-source')).toContainText('Lo Shu walk · CABI · step 4 of');
    await expect.poll(async () => (await vizProps(page))?.step, { message: 'the cube marker on the restored step' }).toBe(after.steps![3]);
    await page.getByTestId('view-now').getByRole('button', { name: 'Play', exact: true }).first().click();
    await page.getByTestId('view-now').getByRole('button', { name: 'Next track', exact: true }).click();
    await expect.poll(async () => { const s = await libraryState(page); return s.cursor === 4 && s.walk === 'cabi' && s.playing; }, { timeout: 15_000 }).toBe(true);
  });

  test('R5b. a stored walk comes back only when every one of its tracks did', async ({ page }) => {
    test.setTimeout(120_000);
    const walk = { mode: 'A', segments: null, phases: null, steps: [0, 1, 2, 3, 4] };
    await page.addInitScript(({ keys }) => { localStorage.setItem('aetheria_v3_tutorial_seen', 'true'); localStorage.setItem(keys.layout, 'new'); localStorage.setItem(keys.engine, 'v2'); localStorage.setItem(keys.output, 'headphones'); }, { keys: { layout: LAYOUT_KEY, engine: LAYER_ENGINE_KEY, output: LAYER_OUTPUT_KEY } });
    await seed(page, { n: 10, state: { order: [0, 1, 2, 3, 4], cursor: 2, walk } });
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).walk, { message: 'a whole walk restores', timeout: 30_000 }).toBe('A');
    expect((await libraryState(page)).steps).toEqual([0, 1, 2, 3, 4]);
    expect((await libraryState(page)).cursor).toBe(2);
    // The same record with tone-04's audio gone: the walk ends (the order comes back without it).
    await page.evaluate(() => new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase('aetheria-db'); r.onsuccess = r.onerror = r.onblocked = () => resolve(); }));
    await seed(page, { n: 10, state: { order: [0, 1, 2, 3, 4], cursor: 2, walk }, noBlob: [3] });
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(9);
    await page.waitForTimeout(1000);
    const s = await libraryState(page);
    expect(s.ids.length, 'the order without the missing track').toBe(4);
    expect(s.walk, 'no walk').toBeNull();
    expect(s.steps).toBeNull();
  });

  test('R9. a walk from the Walks sheet leaves exactly one toast, the Undo, for 5 s and more; neither the walk nor its Undo touches the visual settings', async ({ page }) => {
    test.setTimeout(120_000);
    await hooks(page);
    await openSeededNewLayout(page, 30, { patch: [{ index: 7, crystal: null }] });
    await page.waitForTimeout(500);
    const base = await savedViz(page);
    await startWalk(page, 'A');
    const toasts = page.getByTestId('notices').locator('div[aria-atomic="true"]');
    await expect(toasts).toHaveCount(1);
    await expect(toasts.first()).toContainText('Playing Layer Ascent: 26 of 27 positions.');
    await page.waitForTimeout(5000);
    await expect(toasts, 'still one toast after 5 s').toHaveCount(1);
    await expect(toasts.first().getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    expect(await savedViz(page), 'the walk left the visual settings alone').toBe(base);
    expect((await vizProps(page)).settings.showTreeOfLife, 'no Tree of Life').toBe(false);
    await toasts.first().getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).walk).toBeNull();
    await page.waitForTimeout(500);
    expect(await savedViz(page), 'and so did its Undo').toBe(base);
  });

  test('R8. only taps of one kind chain: a Library row tapped while a walk’s toast shows has its own Undo, back to the walk; a walk tapped while a row’s toast shows, back to the row’s order; two walks chain', async ({ page }) => {
    test.setTimeout(180_000);
    await openSeededNewLayout(page, 30, { patch: [{ index: 7, crystal: null }] });
    // A walk, then within its toast's 10 s a Library row.
    await startWalk(page, 'C');
    const walk = await libraryState(page);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0011').click();
    await expect.poll(async () => (await libraryState(page)).current, { timeout: 15_000 }).toBe('tone-0011');
    await expect(undoToast(page), 'the row’s own words').toContainText('Playing your library from this track. The Vortex walk stopped.');
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.walk, s.ids, s.cursor, s.segments, s.steps]; }, { message: 'back to the walk, not past it', timeout: 15_000 })
      .toEqual(['C', walk.ids, walk.cursor, walk.segments, walk.steps]);
    // A Library row, then within its toast's 10 s a walk.
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0012').click();
    await expect.poll(async () => (await libraryState(page)).current, { timeout: 15_000 }).toBe('tone-0012');
    const row = await libraryState(page);
    await startWalk(page, 'A');
    await expect(undoToast(page), 'the walk’s own words').toContainText('Playing Layer Ascent: 26 of 27 positions.');
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.walk, s.ids, s.current]; }, { message: 'back to the row’s order', timeout: 15_000 })
      .toEqual([null, row.ids, 'tone-0012']);
    // Two walks within the toast's life chain, as two rows do: the toast says the second, the Undo goes back to before
    // the first.
    const start = await libraryState(page);
    await startWalk(page, 'A');
    await startWalk(page, 'B');
    await expect(undoToast(page), 'the second walk’s words').toContainText('Playing Pillar Walk: 26 of 27 positions.');
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.walk, s.ids, s.current]; }, { message: 'back to before the first walk', timeout: 15_000 })
      .toEqual([start.walk, start.ids, start.current]);
  });
});
