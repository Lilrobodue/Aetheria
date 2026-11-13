import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { libraryState, openSeededNewLayout, openLibraryTab, libraryRowButton, tab } from './helpers';

// v16.8.7, the song row (the user's decisions C and C1, 2026-11-13; spec scratchpad v1687/v1687-spec.md). On v16.8.6 the
// desktop transport's title and chips shared one clipped line in the bar's left column: 118 px at 1024, 198 at 1280, so
// the Layers chip was cut and the beat and Key fit chips never showed. Now the bar is 120 px, a 32 px song row (the title,
// then every chip, centred over Play; the chips never shrink, the title truncates first) over the 88 px controls row (the
// crystal tile, Output, Walks, Up next, and REC while recording | the centre | the volume, Zen, Full screen, ⋯).
// Review round 1: REC moved left (the user's choice), exact orders on both sides, the groups clear of the centre column,
// a recording leg (B5), the 1024 × 600 window, the song row's tab stops and centring.

const SIZES = [
  [1024, 768],
  [1280, 800],
  [1920, 1080],
] as const;
/** With the desktop shell's smallest window (1024 × 600: the panel is 480 px tall). */
const SIZES_ALL = [[1024, 600], ...SIZES] as const;

const LONG = 'Traces (Extended Mix) · Halcyon Valley Sessions, Part II · the long remaster with every take';

/** 27 seeded tracks (the first named LONG when `long`), the first playing, Now Playing (no panel). */
async function playingFirst(page: Page, opts: { long?: boolean; tuned?: boolean } = {}): Promise<string[]> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const names = Array.from({ length: 27 }, (_, i) => (i === 0 && opts.long ? LONG : `tone-${String(i + 1).padStart(4, '0')}`));
  const dialogs = await openSeededNewLayout(page, 27, { real: 3, seconds: 40, crystals: 'all', names });
  if (opts.tuned) {
    const id = (await libraryState(page)).libraryIds[0];
    await page.evaluate((id) => (window as any).__aetheriaTuning.set(id, -14, 174), id);
  }
  await openLibraryTab(page);
  await libraryRowButton(page, names[0]).click();
  await expect.poll(async () => { const s = await libraryState(page); return s.playing && (s.t ?? 0) > 0.3; }, { timeout: 20_000 }).toBe(true);
  await tab(page, 'now');
  await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
  return dialogs;
}

/** Start an audio recording (More › Record › Audio Only), back on Now Playing with no panel. */
async function startRecording(page: Page): Promise<void> {
  await tab(page, 'more');
  await page.getByTestId('more').waitFor();
  if ((await page.getByTestId('more').getAttribute('data-more-view')) !== 'root') await tab(page, 'more');
  await page.getByTestId('more-root').getByTestId('more-record-row').click();
  await page.getByRole('button', { name: /Audio Only/ }).click();
  await expect(page.getByTestId('rec-open').first()).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('nav-now').click();
  await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
}
async function stopRecording(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByTestId('desktop-transport').getByTestId('rec-open').click();
  await page.getByTestId('record-stop-save').click();
  await expect(page.getByTestId('rec-open')).toHaveCount(0, { timeout: 10_000 });
}

/** The bar, measured: its rows, the title, every chip, the controls in each column and where the groups end. */
async function measure(page: Page) {
  return page.getByTestId('desktop-transport').evaluate((bar) => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
    };
    const row = bar.querySelector('[data-testid="desktop-song-row"]');
    const chips = bar.querySelector('[data-testid="desktop-chips"]') as HTMLElement | null;
    const title = bar.querySelector('[data-testid="desktop-title"]') as HTMLElement | null;
    const controls = bar.querySelector('[data-testid="desktop-controls"]');
    const cols = controls ? Array.from(controls.children) : [];
    const named = (col: Element | undefined) =>
      col ? Array.from(col.querySelectorAll('button, input, [role="slider"]')).map((el) => ({ name: el.getAttribute('aria-label') || (el.textContent || '').trim(), ...box(el)! })) : [];
    const left = named(cols[0]);
    const right = named(cols[2]);
    const play = bar.querySelector('[data-testid="desktop-play"]');
    return {
      bar: box(bar)!,
      row: box(row),
      rowStops: row ? row.querySelectorAll('button, a[href], input, select, textarea, [tabindex]').length : -1,
      title: title ? { ...box(title)!, cut: title.scrollWidth > title.clientWidth + 1, text: title.textContent } : null,
      chips: chips ? Array.from(chips.children).map((c) => ({ text: (c.textContent || '').trim(), ...box(c)! })) : [],
      left,
      centre: named(cols[1]),
      right,
      centreBox: box(cols[1] ?? null),
      // Where each side's controls actually end (the left column is min-w-0: its content could spill past its box).
      leftEnd: left.length ? Math.max(...left.map((c) => c.right)) : null,
      rightStart: right.length ? Math.min(...right.map((c) => c.left)) : null,
      play: box(play)!,
      vw: innerWidth,
      vh: innerHeight,
      scrollW: document.documentElement.scrollWidth,
    };
  });
}

type Measured = Awaited<ReturnType<typeof measure>>;
/** Names as the tests list them: the crystal without its regime, Up next and REC without their counts and states. */
const names = (list: { name: string }[]) => list.map((c) => c.name.replace(/, .*$/, '').replace(/^Up next.*$/, 'Up next'));
/** v16.8.8 (the user, 2026-11-13: "center the matter on the ends in the middle"): every control in both end
 *  groups centred on the bar's vertical middle (60 px down the 120 px bar), not on the controls row's (76). */
function expectEndsAtMiddle(m: Measured, where: string): void {
  const middle = m.bar.top + m.bar.h / 2;
  for (const c of [...m.left, ...m.right]) {
    const centre = c.top + c.h / 2;
    expect.soft(Math.abs(centre - middle), `${where}: ${c.name} at the bar's vertical middle (${(centre - m.bar.top).toFixed(1)} px down, the middle ${(middle - m.bar.top).toFixed(1)})`).toBeLessThanOrEqual(1.5);
  }
}
/** Both side groups clear of the centre column (the review's mutation h: a wide left group spilled over Shuffle). */
function expectClearOfCentre(m: Measured, where: string): void {
  expect.soft(m.leftEnd!, `${where}: the left group ends before the centre column (${Math.round(m.leftEnd!)} ≤ ${Math.round(m.centreBox!.left)})`).toBeLessThanOrEqual(m.centreBox!.left + 0.5);
  expect.soft(m.rightStart!, `${where}: the right group starts after the centre column (${Math.round(m.rightStart!)} ≥ ${Math.round(m.centreBox!.right)})`).toBeGreaterThanOrEqual(m.centreBox!.right - 0.5);
}

test.describe('desktop bar', () => {
  test('B1. the bar is 120 px, a 32 px song row over the controls, from 1024 × 600; the side nav and an open panel end at its top; the song row has no tab stops and centres its chips', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await playingFirst(page);
    for (const [width, height] of SIZES_ALL) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(250);
      const m = await measure(page);
      const where = `${width} × ${height}`;
      expect(Math.round(m.bar.h), `${where}: the bar`).toBe(120);
      expect(Math.round(m.bar.bottom), `${where}: at the window's foot`).toBe(height);
      expect(m.row, `${where}: the song row`).not.toBeNull();
      expect(Math.round(m.row!.h), `${where}: the song row's height`).toBe(32);
      expect(Math.round(m.row!.top) - Math.round(m.bar.top), `${where}: the song row at the bar's top (under its 1 px border)`).toBeLessThanOrEqual(1);
      expect(m.rowStops, `${where}: display only, no tab stops on the song row`).toBe(0);
      // Centred in its 32 px (review round 1: the chips keep 4 px clear of Play's disc).
      for (const c of m.chips) {
        expect.soft(Math.abs((c.top - m.row!.top) - (m.row!.bottom - c.bottom)), `${where}: "${c.text}" centred in the row`).toBeLessThanOrEqual(1);
      }
      // The side nav and the panel sit at bottom-transport: they end where the bar starts.
      const nav = await page.getByTestId('side-nav').boundingBox();
      expect(Math.abs(nav!.y + nav!.height - m.bar.top), `${where}: the side nav ends at the bar's top`).toBeLessThanOrEqual(1);
      await tab(page, 'library');
      const panel = await page.getByTestId('desktop-panel').boundingBox();
      expect(Math.abs(panel!.y + panel!.height - m.bar.top), `${where}: the panel ends at the bar's top`).toBeLessThanOrEqual(1);
      expect(Math.round(panel!.height), `${where}: the panel's height`).toBe(height - 120);
      await tab(page, 'now');
      await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    }
    expect(dialogs).toEqual([]);
  });

  test('B2. every chip shows in full at 1024, 1280 and 1920 px: as it plays (a tuning and Key fit on), then with Music only (which hides Key fit); a long title truncates first', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await playingFirst(page, { long: true, tuned: true });
    await expect(page.getByTestId('desktop-tuning-chip'), 'the tuning chip').toHaveText(/^Tuned /);
    const states = ['as it plays', 'Music only on'] as const;
    for (const state of states) {
      if (state === 'Music only on') {
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('m');
        await expect(page.getByTestId('desktop-music-only-chip')).toHaveText('Music only');
      }
      for (const [width, height] of SIZES) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(250);
        const m = await measure(page);
        const where = `${width}, ${state}`;
        const order = m.chips.map((c) => c.text);
        if (state === 'as it plays') {
          // The tuning, the crystal, the layers, the beat and Key fit: five (review round 1: Key fit by name).
          expect(m.chips.length, `${where}: the chips (${order.join(' | ')})`).toBe(5);
          expect(order.some((t) => /^Key fit/.test(t)), `${where}: the Key fit chip`).toBe(true);
        } else {
          // Music only, the tuning, the crystal, the layers, the beat (Key fit needs the layers: hidden).
          expect(m.chips.length, `${where}: the chips (${order.join(' | ')})`).toBe(5);
          expect(order[0], `${where}: Music only first`).toBe('Music only');
        }
        for (const c of m.chips) {
          expect.soft(c.left >= m.row!.left - 0.5 && c.right <= m.row!.right + 0.5, `${where}: "${c.text}" inside the song row (${Math.round(c.left)}–${Math.round(c.right)} of ${Math.round(m.row!.left)}–${Math.round(m.row!.right)})`).toBe(true);
          expect.soft(c.top >= m.row!.top - 0.5 && c.bottom <= m.row!.bottom + 0.5, `${where}: "${c.text}" within the row's height`).toBe(true);
        }
        // Whole chips: the chips' box holds every chip (nothing clipped at the row's edge).
        const chipsBox = await page.getByTestId('desktop-chips').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
        expect.soft(chipsBox.sw, `${where}: the chips' box clips nothing`).toBeLessThanOrEqual(chipsBox.cw + 1);
        // The title gives way first: at 1024 px this one truncates while every chip stays whole; at any width it truncates
        // only when the row is full (wider windows show it whole).
        const fill = await page.getByTestId('desktop-song-row').evaluate((row) => {
          const cs = getComputedStyle(row);
          const inner = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          const kids = Array.from(row.children).map((k) => k.getBoundingClientRect());
          return { inner, used: Math.max(...kids.map((k) => k.right)) - Math.min(...kids.map((k) => k.left)) };
        });
        if (width === 1024) expect.soft(m.title!.cut, `${where}: the long title truncates at 1024 px (the chips keep their room)`).toBe(true);
        if (m.title!.cut) expect.soft(fill.used, `${where}: the title truncates only when the row is full`).toBeGreaterThanOrEqual(fill.inner - 2);
        else expect.soft(m.title!.text, `${where}: the title whole`).toBe(LONG);
        expect.soft(m.title!.w, `${where}: the title keeps some room`).toBeGreaterThanOrEqual(80);
        expect.soft(m.scrollW, `${where}: no sideways scroll`).toBeLessThanOrEqual(m.vw);
        expect.soft(order.findIndex((t) => /^Tuned /.test(t)), `${where}: the tuning chip before the crystal chip`).toBeLessThan(order.findIndex((t) => /Hz$/.test(t)));
      }
    }
    await page.keyboard.press('m');
    expect(dialogs).toEqual([]);
  });

  test('B3. the controls in their columns, in order: the tile, Output, Walks, Up next | the centre | the volume, Zen, Full screen, ⋯; each 44 × 44 or more, inside the window, clear of the centre column; the end groups at the bar’s vertical middle (v16.8.8)', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await playingFirst(page);
    for (const [width, height] of SIZES_ALL) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(250);
      const m = await measure(page);
      const where = `${width} × ${height}`;
      expect(names(m.left), `${where}: the left column`).toEqual(['Crystal 174 Hz', 'Output', 'Walks', 'Up next']);
      expect(names(m.centre), `${where}: the centre`).toEqual(['Shuffle', 'Previous track', 'Pause', 'Next track', 'Repeat', 'Seek']);
      expect(names(m.right), `${where}: the right column, the volume first`).toEqual(['Volume', 'Zen mode', 'Full screen', 'More options']);
      for (const c of [...m.left, ...m.centre, ...m.right]) {
        if (c.name === 'Volume' || c.name === 'Seek') continue; // sliders: their own heights (44 px hit rows, checked in desktop-keys TR1)
        expect.soft(c.w >= 43.5 && c.h >= 43.5, `${where}: ${c.name} at least 44 × 44 (${Math.round(c.w)} × ${Math.round(c.h)})`).toBe(true);
        expect.soft(c.left >= 0 && c.right <= m.vw + 0.5 && c.top >= 0 && c.bottom <= m.vh + 0.5, `${where}: ${c.name} inside the window`).toBe(true);
        expect.soft(c.top >= m.row!.bottom - 0.5, `${where}: ${c.name} under the song row`).toBe(true);
      }
      expectClearOfCentre(m, where);
      expectEndsAtMiddle(m, where);
      expect.soft(m.scrollW, `${where}: no sideways scroll`).toBeLessThanOrEqual(m.vw);
    }
    expect(dialogs).toEqual([]);
  });

  test('B4. Play sits at the bar’s centre at 1024, 1280 and 1920 px (the old right group pushed it left), and the song row is centred over it', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await playingFirst(page);
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(250);
      const m = await measure(page);
      const playCentre = m.play.left + m.play.w / 2;
      expect(Math.abs(playCentre - width / 2), `${width}: Play's centre ${playCentre.toFixed(1)} vs the window's ${width / 2}`).toBeLessThanOrEqual(2);
      // The song row's content (title, separator, chips) is centred on the bar.
      const content = await page.getByTestId('desktop-song-row').evaluate((row) => {
        const kids = Array.from(row.children).map((k) => k.getBoundingClientRect());
        return { left: Math.min(...kids.map((k) => k.left)), right: Math.max(...kids.map((k) => k.right)) };
      });
      expect(Math.abs((content.left + content.right) / 2 - width / 2), `${width}: the song row centred over Play`).toBeLessThanOrEqual(2);
    }
    expect(dialogs).toEqual([]);
  });

  test('B5. while recording, with 12 queued: REC after Up next on the left, the right side as before, both clear of the centre, every control 44 × 44 and Play still at the centre (review round 1)', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = await playingFirst(page);
    // Twelve queued: Up next shows a two-digit count, the widest it usually gets.
    const ids = (await libraryState(page)).libraryIds;
    await page.evaluate((ids) => (window as any).__aetheriaQueue.add(ids, 'queue'), ids.slice(2, 14));
    await expect(page.getByTestId('desktop-queue')).toHaveAttribute('aria-label', /12 queued/);
    await startRecording(page);
    for (const [width, height] of [...SIZES_ALL, [1043, 768], [1279, 800], [1535, 900]] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(250);
      const m = await measure(page);
      const where = `${width} × ${height}, recording`;
      expect(names(m.left), `${where}: the left column, REC after Up next`).toEqual(['Crystal 174 Hz', 'Output', 'Walks', 'Up next', 'Rec']);
      expect(names(m.right), `${where}: the right column`).toEqual(['Volume', 'Zen mode', 'Full screen', 'More options']);
      for (const c of [...m.left, ...m.right]) {
        if (c.name === 'Volume') continue;
        expect.soft(c.w >= 43.5 && c.h >= 43.5, `${where}: ${c.name} at least 44 × 44 (${Math.round(c.w)} × ${Math.round(c.h)})`).toBe(true);
        expect.soft(c.left >= 0 && c.right <= m.vw + 0.5, `${where}: ${c.name} inside the window`).toBe(true);
      }
      expectClearOfCentre(m, where);
      expectEndsAtMiddle(m, where);
      const playCentre = m.play.left + m.play.w / 2;
      expect.soft(Math.abs(playCentre - width / 2), `${where}: Play's centre ${playCentre.toFixed(1)} vs the window's ${width / 2}`).toBeLessThanOrEqual(2);
      expect.soft(m.scrollW, `${where}: no sideways scroll`).toBeLessThanOrEqual(m.vw);
    }
    await stopRecording(page);
    expect(dialogs).toEqual([]);
  });

  test('B6. a song row too wide for its window clips its far end, never Music only at its start (safe centre; review round 2)', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingFirst(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('m');
    await expect(page.getByTestId('desktop-music-only-chip')).toHaveText('Music only');
    await page.setViewportSize({ width: 1024, height: 768 });
    // An overflow, as a very large browser font would make one: every chip 240 px wide (five of them in 984 px).
    await page.addStyleTag({ content: '[data-testid="desktop-chips"] > * { min-width: 240px !important; }' });
    await page.waitForTimeout(250);
    const r = await page.getByTestId('desktop-song-row').evaluate((row) => {
      const cs = getComputedStyle(row);
      const innerLeft = row.getBoundingClientRect().left + parseFloat(cs.paddingLeft);
      const kids = Array.from(row.children).map((k) => k.getBoundingClientRect());
      const mo = row.querySelector('[data-testid="desktop-music-only-chip"]')!.getBoundingClientRect();
      const left = Math.min(...kids.map((k) => k.left));
      const right = Math.max(...kids.map((k) => k.right));
      return { overflows: right - left > row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + 1, innerLeft, left, moLeft: mo.left };
    });
    expect(r.overflows, 'the row overflows (the setup)').toBe(true);
    expect(r.left, `the row's content starts at its start (${Math.round(r.left)} ≥ ${Math.round(r.innerLeft)})`).toBeGreaterThanOrEqual(r.innerLeft - 0.5);
    expect(r.moLeft, 'Music only whole at the start').toBeGreaterThanOrEqual(r.innerLeft - 0.5);
    await page.keyboard.press('m');
    expect(dialogs).toEqual([]);
  });
});
