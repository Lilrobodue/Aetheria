import { type Locator, type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  confirmDelete,
  drawsPerSecond,
  expectShellHidden,
  instrumentAudio,
  libraryRowButton,
  libraryState,
  newShell,
  openApp,
  openLibraryTab,
  openNewLayout,
  openSeededNewLayout,
  importTones,
  recordHudDraws,
  seedLibraryRecords,
  shellHidden,
  sheet,
  tab,
  LAYOUT_KEY,
  PHONE_VIEWPORT,
} from './helpers';
import { openMorePage, playingSeeded } from './moreKit';
import { SHORTCUTS, FULLSCREEN_FAILED, KEYS_KEY } from '../../components/shell/shortcuts/keysModel.ts';

// v16.7, desktop polish (spec §5.3): the desktop shell's keyboard shortcuts (Space/K, ←/→, N/P, M, F, /, Q, L, V, Esc,
// ?), each calling what its visible control calls, and never acting behind a dialog, a sheet, the safety statement, a
// focused field, an IME composition, or with Ctrl/Alt/Meta; the "?" dialog and its switch; full screen (decision 4 A:
// full screen plus Zen); the kit's tooltips (decision 5 A); the key feedback pill (decision 6 B); the rail (decisions 1 A
// and 2 A); the transport's fit from 1024 px; the restore card in the notices stack. The new layout at 1280 × 800
// unless a test says otherwise. Synthetic tone-NNNN names only.

const MUSIC_ONLY_KEY = 'aetheria.musicOnly.v1';

const playButton = (page: Page) => page.getByTestId('desktop-play');
const announcer = (page: Page) => page.getByTestId('track-announcer');
const pill = (page: Page) => page.getByTestId('key-feedback');
const live = (page: Page) => page.getByTestId('key-live');
const zenButton = (page: Page) => page.getByTestId('zen-button-desktop');
const fsButton = (page: Page) => page.getByTestId('fullscreen-button');
const shortcutsDialog = (page: Page) => page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });

/** window.__aetheriaKeys (dev builds): how many keys the shortcuts handled, and the last one. */
async function keysDev(page: Page): Promise<{ handled: number; last: string | null } | null> {
  return page.evaluate(() => {
    const k = (window as any).__aetheriaKeys;
    return k ? { handled: k.handled, last: k.last } : null;
  });
}
const handled = async (page: Page) => (await keysDev(page))?.handled ?? -1;

/** Nothing focused (the keys then land on <body>, as after a click on the visuals). */
async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

/** The elapsed time the transport shows, in seconds. */
async function elapsed(page: Page): Promise<number> {
  const text = (await page.getByTestId('desktop-time-elapsed').textContent()) ?? '0:00';
  const [m, s] = text.trim().split(':').map(Number);
  return m * 60 + s;
}

async function musicOnlySaved(page: Page): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), MUSIC_ONLY_KEY);
}

/** Every gain on the music's own path (downstream of the music element's source), as instrumentAudio recorded it. */
async function musicPathGains(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const A = (window as any).__audio;
    const starts = A.edges.filter(([s]: any[]) => s instanceof MediaElementAudioSourceNode).map(([s]: any[]) => s);
    const seen = new Set<any>(starts);
    const queue = [...starts];
    const gains: number[] = [];
    while (queue.length) {
      const node = queue.shift();
      for (const [s, d] of A.edges as any[][]) {
        if (s !== node || !(d instanceof AudioNode) || seen.has(d)) continue;
        seen.add(d);
        queue.push(d);
        if (d instanceof GainNode) gains.push(Math.round(d.gain.value * 1e6) / 1e6);
      }
    }
    return gains;
  });
}

/** The new layout at 1280 × 800, tone-0001 of `n` seeded tones playing, on Now Playing, nothing focused. */
async function playingDesktop(page: Page, n = 3): Promise<string[]> {
  const dialogs = await playingSeeded(page, n);
  await page.getByTestId('nav-now').click();
  await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
  await blur(page);
  await expect(playButton(page)).toHaveAttribute('aria-label', 'Pause');
  return dialogs;
}

/** What the box of an element is: whether two intersect. */
const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  // A phone shows the phone shell whatever its viewport, so these desktop-shell tests can't run there (they waited
  // for the desktop nav and timed out, or passed only because the phone shell has no shortcuts). 'elsewhere' below
  // runs on the device: no keys in the phone shell (K13).
  test.skip(ON_DEVICE, 'the desktop shell: a phone shows the phone shell (the desktop runs check this)');

  // ---------------------------------------------------------------------------------------------------------------
  // Keys
  // ---------------------------------------------------------------------------------------------------------------

  test('K1. Space and K toggle play, the same path as the Play button (one handlePlayPause each)', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playingDesktop(page);
    const h0 = await handled(page);
    await page.keyboard.press('Space');
    await expect(playButton(page), 'Space pauses').toHaveAttribute('aria-label', 'Play');
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    expect(await keysDev(page)).toEqual({ handled: h0 + 1, last: 'playPause' });
    await page.keyboard.press('k');
    await expect(playButton(page), 'K plays').toHaveAttribute('aria-label', 'Pause');
    await expect.poll(async () => (await libraryState(page)).playing).toBe(true);
    await page.keyboard.press('K'); // Caps Lock
    await expect(playButton(page), 'K (Caps Lock) pauses').toHaveAttribute('aria-label', 'Play');
    expect(await keysDev(page)).toEqual({ handled: h0 + 3, last: 'playPause' });
    // The button's own click, after the keys: the same toggle.
    await playButton(page).click();
    await expect(playButton(page)).toHaveAttribute('aria-label', 'Pause');
    expect(dialogs).toEqual([]);
  });

  test('K2. → / ← seek ±5 s, Shift ±30 s; a held → repeats; with no track nothing happens', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingDesktop(page);
    await page.keyboard.press('Space'); // paused, so the time holds still between reads
    await expect(playButton(page)).toHaveAttribute('aria-label', 'Play');
    const t0 = await elapsed(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => elapsed(page)).toBeGreaterThanOrEqual(t0 + 4);
    expect(Math.abs((await elapsed(page)) - (t0 + 5)), '→ is +5 s').toBeLessThanOrEqual(1);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => Math.abs((await elapsed(page)) - t0), { message: '← is −5 s' }).toBeLessThanOrEqual(1);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => Math.abs((await elapsed(page)) - (t0 + 30)), { message: 'Shift+→ is +30 s' }).toBeLessThanOrEqual(1);
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => Math.abs((await elapsed(page)) - t0), { message: 'Shift+← is −30 s' }).toBeLessThanOrEqual(1);
    // Held: one keydown, then two repeats: +15 s.
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.up('ArrowRight');
    await expect.poll(async () => Math.abs((await elapsed(page)) - (t0 + 15)), { message: 'a held → repeats (3 steps)' }).toBeLessThanOrEqual(1);
    expect(dialogs).toEqual([]);
  });

  test('K2b. an empty library: the arrows and Space do nothing at all (no time, no pill, no announcement, no audio started)', async ({ page }) => {
    test.setTimeout(90_000);
    await instrumentAudio(page);
    const dialogs = await openNewLayout(page);
    await blur(page);
    const h0 = await handled(page);
    await expect(page.getByTestId('desktop-time-elapsed')).toHaveText('0:00');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(400);
    await expect(page.getByTestId('desktop-time-elapsed')).toHaveText('0:00');
    await expect(pill(page), 'no pill without a track').toHaveCount(0);
    // Space with nothing loaded: no pill, nothing announced.
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    await expect(pill(page), 'Space without a track: no pill').toHaveCount(0);
    await expect(live(page), 'and nothing announced').toHaveText('');
    expect(await handled(page) - h0, 'Space was not acted on (the arrows were: seekBy returns with no track)').toBe(2);
    expect(await page.evaluate(() => (window as any).__audio.anchor), 'no silent anchor started').toBeNull();
    expect(await page.evaluate(() => (window as any).__audio.music), 'no music started').toBeNull();
    expect(dialogs).toEqual([]);
  });

  test('K2c. a library with nothing loaded: Space is the Play button (track 1 plays) with its pill and announcement', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 40 });
    await expect(page.getByTestId('desktop-title'), 'nothing loaded').toHaveText('Nothing playing');
    await blur(page);
    await page.keyboard.press('Space');
    await expect(pill(page), 'its pill').toHaveText('Play');
    await expect(live(page), 'its announcement').toHaveText('Playing.');
    await expect.poll(async () => (await libraryState(page)).playing, { message: 'track 1 plays', timeout: 20_000 }).toBe(true);
    await expect(announcer(page)).toHaveText('Now playing: tone-0001');
    expect(dialogs).toEqual([]);
  });

  test('K2d. an empty library, a mouse-clicked control: Space presses nothing (prevented), plays nothing, counts nothing', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await openNewLayout(page);
    const h0 = await handled(page);
    for (const name of ['Shuffle', 'Repeat']) {
      const b = page.getByRole('button', { name, exact: true });
      await b.click();
      await expect(b).toBeFocused();
      const pressed = await b.getAttribute('aria-pressed');
      await page.keyboard.press('Space');
      await page.waitForTimeout(300);
      await expect(b, `${name}: Space did not press it again`).toHaveAttribute('aria-pressed', pressed!);
    }
    await expect(pill(page)).toHaveCount(0);
    await expect(live(page)).toHaveText('');
    expect(await handled(page), 'not counted').toBe(h0);
    expect(dialogs).toEqual([]);
  });

  test('K2e. Space and Play agree on what can play: the play order emptied by a delete, then a track queued ("first when you press Play"): Space plays it', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 4, { real: 4, seconds: 40, playlists: [{ id: 'pkeysone', name: 'One', indexes: [0] }] });
    await page.evaluate(() => (window as any).__aetheriaPlaylists.play('pkeysone'));
    await expect(announcer(page)).toHaveText('Now playing: tone-0001', { timeout: 20_000 });
    await openLibraryTab(page);
    await page.getByRole('button', { name: 'Options for tone-0001', exact: true }).click();
    await page.getByRole('button', { name: /Delete from library/ }).click();
    await confirmDelete(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length).toBe(3);
    await page.getByTestId('nav-now').click();
    await expect(page.getByTestId('desktop-title'), 'nothing loaded').toHaveText('Nothing playing');
    const ids = (await libraryState(page)).libraryIds;
    await page.evaluate((id) => (window as any).__aetheriaQueue.add([id], 'queue'), ids[0]);
    await expect(page.getByTestId('desktop-queue')).toHaveAttribute('aria-label', /1 queued/);
    await blur(page);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await libraryState(page)).playing, { message: 'Space plays the queued track, as Play would', timeout: 20_000 }).toBe(true);
    await expect(announcer(page)).toHaveText('Now playing: tone-0002');
    await expect(pill(page)).toHaveText('Play');
    expect(dialogs).toEqual([]);
  });

  test('K3. N and P change the track; a held N advances once', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingDesktop(page);
    await expect(announcer(page)).toHaveText('Now playing: tone-0001');
    await page.keyboard.press('n');
    await expect(announcer(page), 'N: the next track').toHaveText('Now playing: tone-0002');
    await page.keyboard.press('p');
    await expect(announcer(page), 'P: the previous track').toHaveText('Now playing: tone-0001');
    const h0 = await handled(page);
    await page.keyboard.down('n');
    await page.keyboard.down('n');
    await page.keyboard.down('n');
    await page.keyboard.up('n');
    await expect(announcer(page)).toHaveText('Now playing: tone-0002');
    await page.waitForTimeout(800);
    await expect(announcer(page), 'held: once, not three times').toHaveText('Now playing: tone-0002');
    expect(await handled(page), 'the repeats are not shortcuts').toBe(h0 + 1);
    expect(dialogs).toEqual([]);
  });

  test('K4. M toggles Music only (the layers) and never the music: the volume, the element and its gains stay as they were', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playingDesktop(page);
    const chip = page.getByTestId('desktop-chips').getByText('Music only', { exact: true });
    await expect(chip).toHaveCount(0);
    const volume = page.getByRole('slider', { name: 'Volume', exact: true });
    const before = {
      slider: await volume.inputValue(),
      el: await page.evaluate(() => {
        const m = (window as any).__audio.music as HTMLMediaElement;
        return { volume: m.volume, muted: m.muted };
      }),
      gains: await musicPathGains(page),
    };
    // The music plays straight to the OS (no Web Audio node on its path, App's playTrack): its level is the element's.
    test.info().annotations.push({ type: 'gains on the music path', description: JSON.stringify(before.gains) });
    await page.keyboard.press('m');
    await expect(chip, 'the chip says Music only').toBeVisible();
    expect(await musicOnlySaved(page), 'saved as the switch saves it').toBe('true');
    await page.waitForTimeout(600); // past the layers' 0.25 s fade
    const during = {
      slider: await volume.inputValue(),
      el: await page.evaluate(() => {
        const m = (window as any).__audio.music as HTMLMediaElement;
        return { volume: m.volume, muted: m.muted, paused: m.paused };
      }),
      gains: await musicPathGains(page),
    };
    expect(during.slider, 'the master volume is unchanged').toBe(before.slider);
    expect(during.el, "the music element's volume and mute are unchanged; it plays").toEqual({ ...before.el, paused: false });
    expect(during.gains, "the music path's gains are unchanged").toEqual(before.gains);
    await page.keyboard.press('m');
    await expect(chip, 'M again: the layers are back').toHaveCount(0);
    expect(await musicOnlySaved(page)).toBe('false');
    expect(await volume.inputValue()).toBe(before.slider);
    expect(await musicPathGains(page)).toEqual(before.gains);
    expect(dialogs).toEqual([]);
  });

  test('K5. Q, L and V open their panels and the same key closes them; the focus goes to the heading, then back', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingDesktop(page);
    const repeat = page.getByRole('button', { name: 'Repeat', exact: true });
    for (const [key, name, open] of [
      ['q', 'Up next', () => sheet(page, 'Up next')],
      ['l', 'Layers', () => page.getByTestId('tab-layers')],
      ['v', 'Visuals', () => sheet(page, 'Visuals')],
    ] as const) {
      await repeat.focus();
      await page.keyboard.press(key);
      await expect(open(), `${key.toUpperCase()} opens ${name}`).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => { const a = document.activeElement; return !!a && a.closest('[data-testid="desktop-panel"]') !== null && /^H[12]$/.test(a.tagName); }), { message: `${name}: the focus is on its heading` })
        .toBe(true);
      await page.keyboard.press(key);
      await expect(page.getByTestId('desktop-panel'), `${key.toUpperCase()} again closes it`).toHaveCount(0);
      await expect(repeat, `${name}: the focus comes back`).toBeFocused();
    }
    expect(dialogs).toEqual([]);
  });

  test('K6. "/" from Now Playing, Mixes and a playlist: Library › Tracks with the search focused; "n m / q" lands in the field', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 6, { real: 3, seconds: 40, playlists: [{ id: 'pkeys001', name: 'Evening', indexes: [0, 1] }] });
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    await page.getByTestId('nav-now').click();
    await blur(page);
    const search = page.getByTestId('library-search');
    // From Now Playing.
    await page.keyboard.press('/');
    await expect(page.getByTestId('tab-library')).toBeVisible();
    await expect(search, 'from Now Playing: the field has the focus').toBeFocused();
    const h0 = await handled(page);
    const before = await libraryState(page);
    await page.keyboard.type('n m / q');
    await expect(search).toHaveValue('n m / q');
    expect(await handled(page), 'typing: no shortcut').toBe(h0);
    await expect(announcer(page)).toHaveText('Now playing: tone-0001');
    expect(await musicOnlySaved(page)).not.toBe('true');
    expect((await libraryState(page)).playing).toBe(before.playing);
    await expect(page.getByTestId('desktop-panel').getByRole('region', { name: 'Up next' })).toHaveCount(0);
    await search.fill('');
    // From Mixes.
    await page.getByTestId('nav-mixes').click();
    await expect(page.getByTestId('tab-mixes')).toBeVisible();
    await page.keyboard.press('/');
    await expect(search, 'from Mixes').toBeFocused();
    // From Library › Playlists › a playlist.
    await page.evaluate(() => (window as any).__aetheriaPlaylists.open('pkeys001'));
    await expect(page.getByTestId('library-search')).toHaveCount(0);
    await blur(page);
    await page.keyboard.press('/');
    await expect(search, "from a playlist's view").toBeFocused();
    await expect(page.getByTestId('library-view-tracks')).toHaveAttribute('aria-selected', 'true');
    // Decision 7: from Library › Tracks itself (the focus on a row), "/" goes to the field again; it never closes.
    await search.fill('');
    await libraryRowButton(page, 'tone-0002').focus();
    await page.keyboard.press('/');
    await expect(search, 'from a row of Tracks: the field again').toBeFocused();
    await expect(page.getByTestId('tab-library'), 'the panel stays').toBeVisible();
    await blur(page);
    await page.keyboard.press('/');
    await expect(search, 'from nowhere, with Tracks showing').toBeFocused();
    await expect(page.getByTestId('tab-library')).toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test('K7. typing: the Journal, the name Dialog and an IME composition: keys act on the field only', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await playingDesktop(page);
    const h0 = await handled(page);
    // An IME composition (on <body>): nothing.
    await page.evaluate(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', isComposing: true, bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', keyCode: 229, bubbles: true, cancelable: true } as KeyboardEventInit));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', keyCode: 229, bubbles: true, cancelable: true } as KeyboardEventInit));
    });
    await page.waitForTimeout(500);
    expect(await handled(page), 'IME: no shortcut').toBe(h0);
    await expect(announcer(page)).toHaveText('Now playing: tone-0001');
    await expect(playButton(page)).toHaveAttribute('aria-label', 'Pause');

    // The Journal's note (a textarea), More › Journal.
    await openMorePage(page, 'journal');
    const journal = page.getByTestId('more-journal');
    await journal.getByRole('button', { name: /Start Experience Documentation/ }).click();
    // Behind the Journal's forms (classic's full-screen panels, not kit overlays), the keys do nothing.
    const startDocumenting = page.getByRole('button', { name: 'Start Documenting', exact: true });
    await expect(startDocumenting).toBeVisible();
    await blur(page);
    await page.keyboard.press('n');
    await page.keyboard.press('m');
    await page.waitForTimeout(300);
    expect(await handled(page), "behind the Journal's start form: no shortcut").toBe(h0);
    await expect(announcer(page)).toHaveText('Now playing: tone-0001');
    await startDocumenting.click();
    // The note field (an input): typed into, then added with Enter (the end form needs a note).
    const note = journal.getByPlaceholder('Add observation or note...');
    await note.click();
    await page.keyboard.type('n m');
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('v');
    await expect(note).toHaveValue('n mv ');
    expect(await handled(page), 'the note field: no shortcut').toBe(h0);
    await page.keyboard.press('Enter');
    await journal.getByRole('button', { name: 'End Session', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save Experience', exact: true })).toBeVisible();
    const notes = page.getByPlaceholder('Describe any other observations, insights, or experiences...');
    await blur(page);
    await page.keyboard.press('n');
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    expect(await handled(page), "behind the Journal's end form: no shortcut").toBe(h0);
    await notes.click();
    await page.keyboard.type('n m k');
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('q');
    await expect(notes).toHaveValue('n m kq ');
    expect(await handled(page), 'the textarea: no shortcut').toBe(h0);
    await expect(announcer(page)).toHaveText('Now playing: tone-0001');
    await expect(playButton(page)).toHaveAttribute('aria-label', 'Pause');
    expect(await musicOnlySaved(page)).not.toBe('true');
    await page.getByRole('button', { name: 'Save Experience', exact: true }).click();
    await expect(page.getByPlaceholder('Describe any other observations, insights, or experiences...')).toHaveCount(0);

    // The playlist name Dialog (Library › Playlists › New playlist).
    await tab(page, 'library');
    await page.getByTestId('library-view-playlists').click();
    await page.getByTestId('playlists-new').click();
    const name = page.getByRole('dialog').getByRole('textbox');
    await expect(name).toBeFocused();
    await page.keyboard.type('n m');
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('p');
    await expect(name).toHaveValue('n mp ');
    expect(await handled(page), 'the name field: no shortcut').toBe(h0);
    await expect(announcer(page)).toHaveText('Now playing: tone-0001');
    expect(dialogs).toEqual([]);
  });

  test('K8. Ctrl+K, Ctrl+F, Alt+N and Meta+P do nothing of ours', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    const h0 = await handled(page);
    for (const k of ['Control+k', 'Control+f', 'Alt+n', 'Meta+p', 'Control+Alt+m']) await page.keyboard.press(k);
    await page.waitForTimeout(500);
    expect(await handled(page)).toBe(h0);
    await expect(announcer(page)).toHaveText('Now playing: tone-0001');
    await expect(playButton(page)).toHaveAttribute('aria-label', 'Pause');
    expect(await musicOnlySaved(page)).not.toBe('true');
    expect(dialogs).toEqual([]);
  });

  test('K9. with Track info, the delete Dialog or the ⋯ menu open, Space, N and M do nothing; Esc closes only the top one', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await playingDesktop(page);
    const h0 = await handled(page);
    // N and M, then Space with the focus on the overlay's own panel (on one of its buttons, Space presses that button:
    // the delete Dialog's Cancel would close it, rightly).
    const tryKeys = async (what: string) => {
      await page.keyboard.press('n');
      await page.keyboard.press('m');
      await page.locator('[aria-modal="true"]').last().focus();
      await page.keyboard.press('Space');
      await page.waitForTimeout(300);
      expect(await handled(page), `${what}: no shortcut`).toBe(h0);
      await expect(announcer(page), `${what}: the track`).toHaveText('Now playing: tone-0001');
      await expect(playButton(page), `${what}: still playing`).toHaveAttribute('aria-label', 'Pause');
      expect(await musicOnlySaved(page), `${what}: Music only`).not.toBe('true');
    };
    // The ⋯ menu (a modal sheet).
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    const menu = page.getByTestId('sheet-menu');
    await expect(menu).toBeVisible();
    await tryKeys('the ⋯ menu');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    // Track info (a Dialog).
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByTestId('menu-track-info').click();
    const info = page.getByRole('dialog').filter({ hasText: 'tone-0001' }).first();
    await expect(info).toBeVisible();
    await tryKeys('Track info');
    await page.keyboard.press('Escape');
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
    // The delete Dialog over the Library panel: Esc closes the Dialog, the panel stays.
    await openLibraryTab(page);
    await page.getByRole('button', { name: 'Options for tone-0002', exact: true }).click();
    await page.getByRole('button', { name: /Delete from library/ }).click();
    const del = page.getByRole('alertdialog', { name: 'Delete this track?' });
    await expect(del).toBeVisible();
    await tryKeys('the delete Dialog');
    await page.keyboard.press('Escape');
    await expect(del).toHaveCount(0);
    await expect(page.getByTestId('tab-library'), 'Esc closed only the Dialog').toBeVisible();
    expect((await libraryState(page)).libraryIds.length, 'nothing deleted').toBe(3);
    expect(dialogs).toEqual([]);
  });

  test('K10. the safety statement (a fresh profile): Space, K, N and M do nothing behind it', async ({ page }) => {
    test.setTimeout(120_000);
    await seedLibraryRecords(page, 3, { real: 3, seconds: 40 });
    await page.addInitScript((k) => {
      localStorage.setItem(k, 'new');
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
    }, LAYOUT_KEY);
    await page.goto('/');
    await newShell(page).waitFor();
    await expect(page.getByTestId('disclaimer'), 'the statement shows').toBeVisible();
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(3);
    await expect.poll(() => keysDev(page), { message: 'the shell (and its keys) is mounted under the statement' }).not.toBeNull();
    await blur(page);
    for (const k of ['Space', 'k', 'n', 'm', 'ArrowRight', 'q', 'l', 'f', '/', '?']) await page.keyboard.press(k);
    await page.waitForTimeout(600);
    expect(await keysDev(page), 'nothing handled').toEqual({ handled: 0, last: null });
    expect((await libraryState(page)).playing, 'nothing plays').toBe(false);
    expect(await musicOnlySaved(page)).not.toBe('true');
    expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    await expect(page.getByTestId('disclaimer')).toBeVisible();
  });

  test('K11. controls the keyboard reached keep their keys: Space presses Shuffle, the arrows move the volume, → on the seek bar seeks once', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingDesktop(page);
    const h0 = await handled(page);
    const shuffle = page.getByRole('button', { name: 'Shuffle', exact: true });
    const pressed = await shuffle.getAttribute('aria-pressed');
    // Reached by the keyboard (Shift+Tab from Previous): :focus-visible, so Space is the button's.
    await page.getByRole('button', { name: 'Previous track', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(shuffle).toBeFocused();
    await page.keyboard.press('Space');
    await expect(shuffle, 'Space pressed Shuffle').toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true');
    await expect(playButton(page), 'and not Play').toHaveAttribute('aria-label', 'Pause');
    expect(await handled(page)).toBe(h0);
    // Pause with the button, so the time holds still.
    await playButton(page).click();
    await expect(playButton(page)).toHaveAttribute('aria-label', 'Play');
    const t0 = await elapsed(page);
    const volume = page.getByRole('slider', { name: 'Volume', exact: true });
    const v0 = Number(await volume.inputValue());
    await page.getByTestId('desktop-queue').focus();
    await page.keyboard.press('Tab'); // the volume, by the keyboard
    await expect(volume).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => Number(await volume.inputValue()), { message: 'the arrows move the volume' }).toBeLessThan(v0);
    expect(await elapsed(page), 'not the time').toBe(t0);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(Number(await volume.inputValue())).toBeCloseTo(v0, 5);
    expect(await handled(page)).toBe(h0);
    // The seek bar (Tab from Repeat): its own step, once.
    await page.getByRole('button', { name: 'Repeat', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('np-seek')).toBeFocused();
    // Focused by the keyboard, its ring is drawn above the buttons' row (Play's disc doesn't cover its top edge), by a
    // non-interactive layer: the press under it stays Play's (K11g).
    expect(
      await page.evaluate(() => {
        const ring = getComputedStyle(document.querySelector('[data-testid="np-seek"]')!, '::after');
        return { position: ring.position, z: ring.zIndex, outline: ring.outlineStyle, pointer: ring.pointerEvents };
      }),
      "the seek bar's keyboard-focus ring, above the buttons' row"
    ).toEqual({ position: 'absolute', z: '2', outline: 'solid', pointer: 'none' });
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => elapsed(page)).toBeGreaterThanOrEqual(t0 + 4);
    await page.waitForTimeout(400);
    expect(Math.abs((await elapsed(page)) - (t0 + 5)), '+5, not +10').toBeLessThanOrEqual(1);
    expect(await handled(page)).toBe(h0);
    // Rule 1: a key some component handled (it called preventDefault) is left alone, wherever the focus is.
    await page.evaluate(() => window.addEventListener('keydown', (e) => { if (e.key === 'n') e.preventDefault(); }, { capture: true, once: true }));
    await blur(page);
    await page.keyboard.press('n');
    await page.waitForTimeout(400);
    await expect(announcer(page), 'a handled N is not Next').toHaveText('Now playing: tone-0001');
    expect(await handled(page)).toBe(h0);
    expect(dialogs).toEqual([]);
  });

  test("K11g. the seek bar keyboard-focused, a press on Play's foot (the 5 px over the bar) plays or pauses, never seeks", async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    await page.getByRole('button', { name: 'Repeat', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('np-seek')).toBeFocused();
    const at = await page.evaluate(() => {
      const seek = document.querySelector('[data-testid="np-seek"]')!.getBoundingClientRect();
      const play = document.querySelector('[data-testid="desktop-play"]')!.getBoundingClientRect();
      return { x: play.left + play.width / 2, y: Math.min(play.bottom, seek.top + 5) - 2, overlap: play.bottom > seek.top };
    });
    expect(at.overlap, "Play's foot lies over the seek bar").toBe(true);
    const t0 = (await libraryState(page)).t ?? 0;
    await page.mouse.click(at.x, at.y);
    await expect(playButton(page), 'the press paused').toHaveAttribute('aria-label', 'Play');
    const t1 = (await libraryState(page)).t ?? 0;
    expect(Math.abs(t1 - t0), 'and did not seek').toBeLessThan(2);
    await page.mouse.click(at.x, at.y);
    await expect(playButton(page), 'and again plays').toHaveAttribute('aria-label', 'Pause');
    expect(dialogs).toEqual([]);
  });

  test('K11b. after a mouse click the shortcuts win (decision 10): Space plays or pauses, ←/→ seek; no Space-click, no volume step', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingDesktop(page);
    // A click on Shuffle: then Space is Play/Pause, never a second press of Shuffle.
    const shuffle = page.getByRole('button', { name: 'Shuffle', exact: true });
    await shuffle.click();
    const pressed = await shuffle.getAttribute('aria-pressed');
    await expect(shuffle).toBeFocused();
    await page.keyboard.press('Space');
    await expect(playButton(page), 'Space paused').toHaveAttribute('aria-label', 'Play');
    await expect(shuffle, 'and did not press Shuffle').toHaveAttribute('aria-pressed', pressed!);
    expect((await keysDev(page))?.last).toBe('playPause');
    // A drag on the volume: then the arrows seek and never change the volume.
    const volume = page.getByRole('slider', { name: 'Volume', exact: true });
    const box = (await volume.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 3 });
    await page.mouse.up();
    await expect(volume).toBeFocused();
    const v1 = await volume.inputValue();
    const t0 = await elapsed(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => elapsed(page), { message: '→ seeks' }).toBeGreaterThanOrEqual(t0 + 4);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    expect(await volume.inputValue(), 'the volume never moves').toBe(v1);
    expect(Math.abs((await elapsed(page)) - Math.max(0, t0 - 5)), '+5 −5 −5').toBeLessThanOrEqual(1);
    // And a Space there is Play/Pause too.
    await page.keyboard.press('Space');
    await expect(playButton(page)).toHaveAttribute('aria-label', 'Pause');
    expect(await volume.inputValue()).toBe(v1);

    // Review round 2: only a press ON the control makes it the mouse's. A click on Shuffle, then the focus moved to
    // Next by a script (as a screen reader moves it): Next is the keyboard's, so Space presses Next.
    await shuffle.click();
    const next = page.getByRole('button', { name: 'Next track', exact: true });
    await next.focus();
    await page.keyboard.press('Space');
    await expect(announcer(page), 'Space pressed Next (a focus that no click brought)').toHaveText('Now playing: tone-0002');
    await expect(playButton(page), 'and did not pause').toHaveAttribute('aria-label', 'Pause');
    // A click on Next itself: its Space is Play/Pause.
    await next.click();
    await expect(announcer(page)).toHaveText('Now playing: tone-0003');
    await page.keyboard.press('Space');
    await expect(playButton(page), 'after a click on Next, Space pauses').toHaveAttribute('aria-label', 'Play');
    await expect(announcer(page), 'and Next was not pressed again').toHaveText('Now playing: tone-0003');
    expect(dialogs).toEqual([]);
  });

  test('K11c. a clicked Library row keeps both arrows (row ↔ ⋯), as before decision 10: no seek', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingSeeded(page, 6);
    const row = libraryRowButton(page, 'tone-0003');
    await row.click(); // plays tone-0003; the row keeps the focus (a mouse's)
    await expect(announcer(page)).toHaveText('Now playing: tone-0003');
    await expect(row).toBeFocused();
    await page.waitForTimeout(300);
    const h0 = await handled(page);
    const t1 = (await libraryState(page)).t ?? 0;
    // ← on the row (nothing to its left), → to its ⋯, ← back: the row's own keys, never a seek.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button', { name: 'Options for tone-0003', exact: true }), "→ goes to the row's ⋯").toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(row, '← comes back to the row').toBeFocused();
    const t2 = (await libraryState(page)).t ?? 0;
    expect(await handled(page), 'no shortcut').toBe(h0);
    expect(t2 - t1, 'no seek (only the time played meanwhile)').toBeGreaterThanOrEqual(-0.5);
    expect(t2 - t1, 'no seek (only the time played meanwhile)').toBeLessThan(3);
    expect(dialogs).toEqual([]);
  });

  test('K11d. the app moving the focus within a click keeps it the mouse\'s: a panel\'s Close gives it back to Up next, and Space pauses', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingDesktop(page);
    // (a) Up next, then the panel's Close: the focus goes back to Up next, and Space is Play/Pause.
    const upNext = page.getByTestId('desktop-queue');
    await upNext.click();
    await expect(sheet(page, 'Up next')).toBeVisible();
    await page.getByTestId('desktop-panel').getByRole('button', { name: 'Close panel', exact: true }).click();
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    await expect(upNext, 'the panel gave the focus back').toBeFocused();
    await page.keyboard.press('Space');
    await expect(playButton(page), 'Space paused').toHaveAttribute('aria-label', 'Play');
    await expect(page.getByTestId('desktop-panel'), 'and did not reopen Up next').toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('K11f. a RadioList row (a label around a hidden radio) clicked: the arrows seek, Space plays; the band stays', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingDesktop(page);
    await playButton(page).click(); // paused: the time holds still
    await expect(playButton(page)).toHaveAttribute('aria-label', 'Play');
    await page.getByTestId('nav-layers').click();
    await page.getByTestId('tab-layers').waitFor();
    const radios = page.getByTestId('layers-bands').getByRole('radio');
    await radios.nth(2).locator('xpath=ancestor::label').click();
    await expect(radios.nth(2)).toBeChecked();
    await expect(radios.nth(2), 'the label gave the radio the focus').toBeFocused();
    const t0 = await elapsed(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => elapsed(page), { message: '→ seeks' }).toBeGreaterThanOrEqual(t0 + 4);
    await expect(radios.nth(2), 'the band is unchanged').toBeChecked();
    await expect(radios.nth(3)).not.toBeChecked();
    await page.keyboard.press('Space');
    await expect(playButton(page), 'Space plays').toHaveAttribute('aria-label', 'Pause');
    await expect(radios.nth(2)).toBeChecked();
    expect(dialogs).toEqual([]);
  });

  test('K11e. a click, then Tab away and Shift+Tab back (within 1 s): the keyboard\'s focus, so Space presses the control', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    const shuffle = page.getByRole('button', { name: 'Shuffle', exact: true });
    await shuffle.click();
    const pressed = await shuffle.getAttribute('aria-pressed');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(shuffle).toBeFocused();
    await page.keyboard.press('Space');
    await expect(shuffle, 'Space pressed Shuffle').toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true');
    await expect(playButton(page), 'and did not pause').toHaveAttribute('aria-label', 'Pause');
    expect(dialogs).toEqual([]);
  });

  test("K11h. a touchscreen's tap on a panel's Close (its click built a task after touchend): the focus it gives back to Up next is still the pointer's, so Space pauses", async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    const upNext = page.getByTestId('desktop-queue');
    await upNext.click();
    await expect(sheet(page, 'Up next')).toBeVisible();
    await page.evaluate(async () => {
      const btn = document.querySelector('[data-testid="desktop-panel"] [aria-label="Close panel"]') as HTMLElement;
      const o = { bubbles: true, cancelable: true, composed: true, pointerType: 'touch', isPrimary: true, pointerId: 7 };
      btn.dispatchEvent(new PointerEvent('pointerdown', o));
      btn.dispatchEvent(new PointerEvent('pointerup', o));
      await new Promise((r) => setTimeout(r, 60)); // the click comes later, in its own task
      btn.click();
    });
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    await expect(upNext, 'the panel gave the focus back').toBeFocused();
    await page.keyboard.press('Space');
    await expect(playButton(page), 'Space paused').toHaveAttribute('aria-label', 'Play');
    await expect(page.getByTestId('desktop-panel'), 'and did not reopen Up next').toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('K11i. a pointerdown whose pointerup never comes (a native popup took it): after 1 s a focus that no click brought is the keyboard\'s again', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    await page.evaluate(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse', isPrimary: true, pointerId: 1 }));
    });
    await page.waitForTimeout(1200);
    const shuffle = page.getByRole('button', { name: 'Shuffle', exact: true });
    const pressed = await shuffle.getAttribute('aria-pressed');
    await shuffle.focus();
    await page.keyboard.press('Space');
    await expect(shuffle, 'Space pressed Shuffle (the keyboard\'s focus)').toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true');
    await expect(playButton(page), 'and did not pause').toHaveAttribute('aria-label', 'Pause');
    expect(dialogs).toEqual([]);
  });

  test('K12. the media keys are left alone: not handled, not defaultPrevented', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    await page.evaluate(() => {
      const w = window as any;
      w.__mediaKeys = [];
      window.addEventListener('keydown', (e) => {
        if (e.key.startsWith('Media') || e.key.startsWith('AudioVolume')) w.__mediaKeys.push({ key: e.key, prevented: e.defaultPrevented });
      });
    });
    const h0 = await handled(page);
    for (const k of ['MediaPlayPause', 'MediaTrackNext', 'MediaTrackPrevious', 'AudioVolumeMute']) await page.keyboard.press(k);
    await page.waitForTimeout(400);
    expect(await handled(page), 'none handled here').toBe(h0);
    const seen = await page.evaluate(() => (window as any).__mediaKeys);
    expect(seen.map((s: any) => s.key)).toEqual(['MediaPlayPause', 'MediaTrackNext', 'MediaTrackPrevious', 'AudioVolumeMute']);
    expect(seen.every((s: any) => !s.prevented), 'none defaultPrevented').toBe(true);
    expect(dialogs).toEqual([]);
  });

  test('K14. the switch: off from the "?" dialog, N does nothing, Esc still closes a panel and leaves Zen; it survives a reload; no keycaps', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await playingDesktop(page);
    await page.keyboard.press('?');
    await expect(shortcutsDialog(page)).toBeVisible();
    const sw = shortcutsDialog(page).getByRole('switch', { name: 'Keyboard shortcuts' });
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(sw, 'its line is its description').toHaveAccessibleDescription('Single-key shortcuts. Esc always works.');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(await page.evaluate((k) => localStorage.getItem(k), KEYS_KEY)).toBe('off');
    await page.keyboard.press('Escape');
    await expect(shortcutsDialog(page)).toHaveCount(0);
    await blur(page);
    const h0 = await handled(page);
    await page.keyboard.press('n');
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    await expect(announcer(page), 'N does nothing').toHaveText('Now playing: tone-0001');
    await expect(playButton(page), 'Space does nothing').toHaveAttribute('aria-label', 'Pause');
    expect(await handled(page)).toBe(h0);
    // Esc still closes a panel (its own listener) ...
    await page.getByTestId('desktop-queue').click();
    await expect(sheet(page, 'Up next')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    // ... and leaves Zen (ours).
    await zenButton(page).click();
    await expect(zenButton(page)).toHaveAttribute('aria-pressed', 'true');
    await blur(page);
    await page.keyboard.press('Escape');
    await expect(zenButton(page), 'Esc leaves Zen with the shortcuts off').toHaveAttribute('aria-pressed', 'false');
    // No keycaps, no aria-keyshortcuts.
    await expect(playButton(page)).not.toHaveAttribute('aria-keyshortcuts', /.*/);
    await page.mouse.move(10, 400);
    await playButton(page).hover();
    const bubble = page.locator('[data-tooltip]');
    await expect(bubble).toBeVisible({ timeout: 2_000 });
    await expect(bubble.locator('kbd')).toHaveCount(0);
    // A reload: still off (the rail's Shortcuts button opens the list; ? is off too).
    await page.reload();
    await expect(newShell(page)).toBeVisible();
    await blur(page);
    await page.keyboard.press('?');
    await page.waitForTimeout(300);
    await expect(shortcutsDialog(page), '? is off').toHaveCount(0);
    await page.getByTestId('nav-shortcuts').click();
    await expect(shortcutsDialog(page).getByRole('switch', { name: 'Keyboard shortcuts' }), 'saved').toHaveAttribute('aria-checked', 'false');
    await shortcutsDialog(page).getByRole('switch', { name: 'Keyboard shortcuts' }).click();
    expect(await page.evaluate((k) => localStorage.getItem(k), KEYS_KEY), 'on: removed').toBeNull();
    expect(dialogs).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Escape
  // ---------------------------------------------------------------------------------------------------------------

  test('E1. a panel open and Zen on: Esc 1 closes the panel only, Esc 2 leaves Zen', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    await zenButton(page).click();
    await expect(zenButton(page)).toHaveAttribute('aria-pressed', 'true');
    await blur(page);
    await page.keyboard.press('q');
    await expect(sheet(page, 'Up next')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('desktop-panel'), 'Esc 1: the panel').toHaveCount(0);
    await expect(zenButton(page), 'Esc 1: Zen stays').toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(zenButton(page), 'Esc 2: Zen ends').toHaveAttribute('aria-pressed', 'false');
    // A HELD Esc acts once: it closes the panel, and its repeats never also leave Zen.
    await zenButton(page).click();
    await expect(zenButton(page)).toHaveAttribute('aria-pressed', 'true');
    await blur(page);
    await page.keyboard.press('q');
    await expect(sheet(page, 'Up next')).toBeVisible();
    await page.keyboard.down('Escape');
    await page.waitForTimeout(100);
    await page.keyboard.down('Escape');
    await page.keyboard.down('Escape');
    await page.keyboard.up('Escape');
    await expect(page.getByTestId('desktop-panel'), 'held Esc: the panel').toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(zenButton(page), 'held Esc: Zen stays').toHaveAttribute('aria-pressed', 'true');
    // Library open, Up next over it (Q): a held Esc closes Up next only; Library stays.
    await page.getByTestId('nav-library').click();
    await expect(page.getByTestId('tab-library')).toBeVisible();
    await blur(page);
    await page.keyboard.press('q');
    await expect(sheet(page, 'Up next')).toBeVisible();
    await page.keyboard.down('Escape');
    await page.waitForTimeout(150);
    await page.keyboard.down('Escape');
    await page.waitForTimeout(150);
    await page.keyboard.down('Escape');
    await page.keyboard.up('Escape');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('desktop-panel').getByRole('region', { name: 'Up next', exact: true }), 'held Esc: Up next').toHaveCount(0);
    await expect(page.getByTestId('tab-library'), 'held Esc: Library stays').toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test('E4. the output question open when the shell mounts: one Esc answers it (Later) and leaves Zen alone', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 40 });
    await page.evaluate(() => localStorage.removeItem('aetheria.layerOutput.v1')); // v2 asks again on the next play
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.reload();
    await newShell(page).waitFor();
    await expect(page.locator('[data-shell="phone"]')).toBeVisible();
    await tab(page, 'library');
    await libraryRowButton(page, 'tone-0001').click();
    await expect(page.getByTestId('output-sheet'), 'the output question').toBeVisible({ timeout: 20_000 });
    await tab(page, 'now');
    await page.getByTestId('zen-button').click();
    await expect(page.getByTestId('zen-button')).toHaveAttribute('aria-pressed', 'true');
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('[data-shell="desktop"]')).toBeVisible();
    await expect(page.getByTestId('output-sheet')).toBeVisible();
    await blur(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('output-sheet'), 'Esc 1: the question (Later)').toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(zenButton(page), 'Esc 1 only answered the question: Zen stays').toHaveAttribute('aria-pressed', 'true');
    expect(dialogs).toEqual([]);
  });

  test('E3. the shell mounted with a sheet already open (a window widened from the phone shell): one Esc closes the panel only', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingSeeded(page, 3);
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(page.locator('[data-shell="phone"]')).toBeVisible();
    await tab(page, 'now');
    await page.getByTestId('zen-button').click();
    await expect(page.getByTestId('zen-button')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('np-upnext').click();
    await expect(page.getByRole('dialog', { name: 'Up next', exact: true })).toBeVisible();
    // Wider: the desktop shell mounts with Up next already open (its panel's Escape listener comes before the keys').
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId('desktop-panel').getByRole('region', { name: 'Up next', exact: true })).toBeVisible();
    await expect(zenButton(page)).toHaveAttribute('aria-pressed', 'true');
    await blur(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('desktop-panel'), 'Esc 1: the panel').toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(zenButton(page), 'Esc 1 only closed the panel: Zen stays').toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(zenButton(page), 'Esc 2: Zen ends').toHaveAttribute('aria-pressed', 'false');
    expect(dialogs).toEqual([]);
  });

  test('E2. Esc in the search field with text clears it and nothing else', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    await page.keyboard.press('/');
    const search = page.getByTestId('library-search');
    await expect(search).toBeFocused();
    await search.fill('tone');
    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('');
    await expect(page.getByTestId('tab-library'), 'the panel stays').toBeVisible();
    expect(dialogs).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Full screen
  // ---------------------------------------------------------------------------------------------------------------

  const fullscreen = (page: Page) => page.evaluate(() => (document.fullscreenElement === document.documentElement ? 'html' : document.fullscreenElement ? 'other' : 'none'));

  test('F1. F: full screen on <html> and Zen; the controls hide 3 s later; a mouse move shows them, still in full screen', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    await page.keyboard.press('f');
    await expect.poll(() => fullscreen(page), { message: 'full screen on <html>' }).toBe('html');
    await expect(zenButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(fsButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expectShellHidden(page, 'the controls hide');
    await page.mouse.move(400, 300);
    await page.mouse.move(420, 320);
    await expect.poll(() => shellHidden(page), { message: 'a mouse move shows them' }).toBe(false);
    expect(await fullscreen(page), 'still in full screen').toBe('html');
    await expect(live(page)).toHaveText('Full screen. Move the mouse for the controls; Esc leaves.');
    expect(dialogs).toEqual([]);
  });

  test('F2. F again or the button leaves, and Zen ends; a Zen that was on before stays', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingDesktop(page);
    // F, then F.
    await page.keyboard.press('f');
    await expect.poll(() => fullscreen(page)).toBe('html');
    await page.keyboard.press('f');
    await expect.poll(() => fullscreen(page), { message: 'F again leaves' }).toBe('none');
    await expect(zenButton(page), 'and Zen ends').toHaveAttribute('aria-pressed', 'false');
    await expect(live(page)).toHaveText('Left full screen.');
    // F, then the button.
    await page.keyboard.press('f');
    await expect.poll(() => fullscreen(page)).toBe('html');
    await page.mouse.move(600, 300);
    await page.mouse.move(610, 310);
    await expect.poll(() => shellHidden(page)).toBe(false);
    await fsButton(page).click();
    await expect.poll(() => fullscreen(page), { message: 'the button leaves' }).toBe('none');
    await expect(zenButton(page), 'and Zen ends').toHaveAttribute('aria-pressed', 'false');
    // Zen on first: it stays after.
    await zenButton(page).click();
    await expect(zenButton(page)).toHaveAttribute('aria-pressed', 'true');
    await blur(page);
    await page.keyboard.press('f');
    await expect.poll(() => fullscreen(page)).toBe('html');
    await page.keyboard.press('f');
    await expect.poll(() => fullscreen(page)).toBe('none');
    await expect(zenButton(page), 'Zen was on before F: it stays').toHaveAttribute('aria-pressed', 'true');
    expect(dialogs).toEqual([]);
  });

  test("F3. the browser's own exit (exitFullscreen) ends it through fullscreenchange: Zen off, the button not pressed", async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    await page.keyboard.press('f');
    await expect.poll(() => fullscreen(page)).toBe('html');
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(() => fullscreen(page)).toBe('none');
    await expect(zenButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(fsButton(page)).toHaveAttribute('aria-pressed', 'false');
    expect(dialogs).toEqual([]);
  });

  test('F4. full screen refused: Zen only, and the pill and the live line say so', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      Element.prototype.requestFullscreen = function () {
        return Promise.reject(new TypeError('refused'));
      };
    });
    const dialogs = await playingDesktop(page);
    await page.keyboard.press('f');
    await expect(live(page)).toHaveText(FULLSCREEN_FAILED);
    await expect(pill(page)).toHaveText(FULLSCREEN_FAILED);
    expect(await fullscreen(page)).toBe('none');
    await expect(zenButton(page), 'Zen only').toHaveAttribute('aria-pressed', 'true');
    expect(dialogs).toEqual([]);
  });

  test('F5. in full screen, ? opens the dialog and it shows (its portal is on <body>, inside the full-screen <html>)', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    await page.keyboard.press('f');
    await expect.poll(() => fullscreen(page)).toBe('html');
    await page.keyboard.press('?');
    const dlg = shortcutsDialog(page);
    await expect(dlg).toBeVisible();
    // What a click at its centre reaches: the dialog itself, not something drawn over it.
    const hit = await dlg.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!at && el.contains(at);
    });
    expect(hit, 'the dialog is on top').toBe(true);
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('F6. Back to classic while in full screen: full screen ends', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    await page.keyboard.press('f');
    await expect.poll(() => fullscreen(page)).toBe('html');
    await page.mouse.move(600, 300);
    await page.mouse.move(610, 310);
    await expect.poll(() => shellHidden(page)).toBe(false);
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByTestId('menu-back-to-classic').click();
    await expect(newShell(page)).toHaveCount(0);
    await expect.poll(() => fullscreen(page), { message: 'classic has no way out: it ends' }).toBe('none');
    expect(await keysDev(page), 'and the keys are gone with the shell').toBeNull();
    expect(dialogs).toEqual([]);
  });

  test('F7. in full screen the visualizer stays under its 30 fps cap', async ({ page }) => {
    test.setTimeout(120_000);
    await recordHudDraws(page);
    const dialogs = await playingDesktop(page);
    await page.keyboard.press('f');
    await expect.poll(() => fullscreen(page)).toBe('html');
    const draws = await drawsPerSecond(page, 3);
    test.info().annotations.push({ type: 'draws/s in full screen', description: draws.join(', ') });
    for (const d of draws) expect.soft(d, 'draws/s never above the cap').toBeLessThanOrEqual(31);
    expect(Math.max(...draws), 'and it draws').toBeGreaterThan(0);
    expect(dialogs).toEqual([]);
  });

  /** The browser's full-screen request, slowed (it lands `ms` later) and counted in window.__fsRequests. */
  async function slowFullscreen(page: Page, ms: number): Promise<void> {
    await page.addInitScript((ms) => {
      const w = window as any;
      w.__fsRequests = 0;
      w.__fsChanges = [];
      document.addEventListener('fullscreenchange', () => w.__fsChanges.push(!!document.fullscreenElement));
      const real = Element.prototype.requestFullscreen;
      Element.prototype.requestFullscreen = function (this: Element, opts?: FullscreenOptions) {
        w.__fsRequests++;
        return new Promise<void>((resolve, reject) => setTimeout(() => real.call(this, opts).then(resolve, reject), ms));
      };
    }, ms);
  }

  test('F8. F twice while the request is on its way: one request, and full screen stays on', async ({ page }) => {
    test.setTimeout(90_000);
    await slowFullscreen(page, 700);
    const dialogs = await playingDesktop(page);
    await page.keyboard.press('f');
    await page.keyboard.press('f');
    await expect.poll(() => fullscreen(page), { message: 'it lands' }).toBe('html');
    await page.waitForTimeout(900);
    expect(await fullscreen(page), 'the second F (in flight) did not undo it').toBe('html');
    expect(await page.evaluate(() => (window as any).__fsRequests), 'one request').toBe(1);
    // Landed: F now leaves, at once.
    await page.keyboard.press('f');
    await expect.poll(() => fullscreen(page)).toBe('none');
    expect(dialogs).toEqual([]);
  });

  test('F9. Back to classic while the request is on its way: once it lands, full screen ends', async ({ page }) => {
    test.setTimeout(90_000);
    await slowFullscreen(page, 1500);
    const dialogs = await playingDesktop(page);
    await page.keyboard.press('f');
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByTestId('menu-back-to-classic').click();
    await expect(newShell(page)).toHaveCount(0);
    expect(await fullscreen(page), 'still on its way').toBe('none');
    await page.waitForTimeout(2500);
    await expect.poll(() => fullscreen(page), { message: 'classic has no way out: it ends as soon as it lands' }).toBe('none');
    // It did land (two changes: in, then out; the exit can run before the first is dispatched, so both may read none).
    expect((await page.evaluate(() => (window as any).__fsChanges)).length, 'it landed, then ended').toBe(2);
    expect(dialogs).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Tooltips
  // ---------------------------------------------------------------------------------------------------------------

  // v16.7 review: the bubble is drawn in a portal on <body> (above the notices); one shows at a time.
  const bubbleOf = (target: Locator) => target.page().locator('[data-tooltip]');

  test('T1. hover Play: no bubble at 300 ms, one by 700 ms with "Pause" and Space or K; leaving hides it', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    await page.mouse.move(640, 300);
    await page.waitForTimeout(400); // past any warm window
    const b = (await playButton(page).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(300);
    await expect(bubbleOf(playButton(page)), 'none at 300 ms').toHaveCount(0);
    await page.waitForTimeout(400);
    const bubble = bubbleOf(playButton(page));
    await expect(bubble, 'one by 700 ms').toBeVisible();
    await expect(bubble).toHaveText('PauseSpaceorK');
    await expect(bubble.locator('kbd')).toHaveText(['Space', 'K']);
    expect(await bubble.getAttribute('aria-hidden')).toBe('true');
    // The window resizes under it (full screen, a narrower window): the bubble follows Play.
    const centres = async () => ({
      play: await playButton(page).evaluate((el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; }),
      bubble: await bubble.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; }),
    });
    let c = await centres();
    expect(Math.abs(c.bubble - c.play), 'over Play').toBeLessThanOrEqual(2);
    const playBefore = c.play;
    await page.setViewportSize({ width: 1366, height: 800 });
    await expect.poll(async () => { c = await centres(); return Math.abs(c.bubble - c.play); }, { message: 'after a resize, still over Play' }).toBeLessThanOrEqual(2);
    expect(Math.abs(c.play - playBefore), 'Play moved with the resize').toBeGreaterThan(5);
    await page.mouse.move(640, 300);
    await expect(bubble, 'leaving hides it').toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('T2. Tab onto Next: the bubble shows at once; leaving it hides it', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    const next = page.getByRole('button', { name: 'Next track', exact: true });
    await page.getByRole('button', { name: 'Previous track', exact: true }).focus();
    await page.keyboard.press('Tab'); // Play
    await page.keyboard.press('Tab'); // Next
    await expect(next).toBeFocused();
    const bubble = bubbleOf(next);
    await expect(bubble, 'at once on keyboard focus').toBeVisible({ timeout: 300 });
    await expect(bubble).toHaveText('Next trackN');
    await page.keyboard.press('Tab'); // Repeat: Next's bubble goes, Repeat's comes (one at a time)
    await expect(bubble, 'blur hides it; the next control shows its own').toHaveText('Repeat');
    await blur(page);
    await expect(bubble, 'blur hides it').toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('T4. Esc with a bubble showing hides it only: the open panel stays', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    await page.keyboard.press('q');
    await expect(sheet(page, 'Up next')).toBeVisible();
    await playButton(page).hover();
    const bubble = bubbleOf(playButton(page));
    await expect(bubble).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bubble, 'Esc 1: the bubble').toHaveCount(0);
    await expect(sheet(page, 'Up next'), 'the panel stays').toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('desktop-panel'), 'Esc 2: the panel').toHaveCount(0);
    // Held: its first press takes the bubble, its repeats close nothing (the panel stays).
    await blur(page);
    await page.keyboard.press('q');
    await expect(sheet(page, 'Up next')).toBeVisible();
    await page.mouse.move(640, 300);
    await page.waitForTimeout(400);
    await playButton(page).hover();
    await expect(bubble).toBeVisible();
    await page.keyboard.down('Escape');
    await page.waitForTimeout(150);
    await page.keyboard.down('Escape');
    await page.keyboard.down('Escape');
    await page.keyboard.up('Escape');
    await expect(bubble, 'held Esc: the bubble').toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(sheet(page, 'Up next'), 'held Esc: the panel stays (its repeats are ignored)').toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test('T5. the keys reach assistive tech: aria-describedby and aria-keyshortcuts; Up next has no title', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    const play = playButton(page);
    await expect(play).toHaveAttribute('aria-keyshortcuts', 'Space K');
    const desc = await play.evaluate((el) => {
      const id = el.getAttribute('aria-describedby');
      return id ? document.getElementById(id)?.textContent ?? null : null;
    });
    expect(desc).toBe('Shortcut: Space or K');
    await expect(play).toHaveAccessibleDescription('Shortcut: Space or K');
    await expect(play).toHaveAccessibleName('Pause');
    for (const [name, keys] of [['Next track', 'N'], ['Previous track', 'P'], ['Full screen', 'F'], ['Keyboard shortcuts', '?'], ['Layers', 'L']] as const) {
      await expect(page.getByRole('button', { name, exact: true }), name).toHaveAttribute('aria-keyshortcuts', keys);
    }
    await expect(page.getByTestId('desktop-queue')).toHaveAttribute('aria-keyshortcuts', 'Q');
    await expect(page.getByTestId('desktop-queue'), 'Up next: no native title').not.toHaveAttribute('title', /.*/);
    await expect(zenButton(page), 'Zen: no native title on the desktop').not.toHaveAttribute('title', /.*/);
    expect(dialogs).toEqual([]);
  });

  test('T6. a rail bubble shown at 1279 px, then the window widened to 1280 (it hides there): Escape is not taken by it', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    await page.setViewportSize({ width: 1279, height: 800 });
    await blur(page);
    await page.keyboard.press('q');
    await expect(sheet(page, 'Up next')).toBeVisible();
    await page.getByTestId('nav-mixes').hover();
    await expect(page.locator('[data-tooltip]'), 'the rail bubble at 1279').toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('[data-tooltip]'), 'from 1280 it is hidden').toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('desktop-panel'), 'Esc closed the panel, not an invisible bubble').toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('T7. bubbles only where a name or key is hidden (decision 9): none on the labelled nav, nor on Output and Walks from 1280', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingDesktop(page);
    const bubble = page.locator('[data-tooltip]');
    const hoverFor = async (target: Locator) => {
      await page.mouse.move(640, 300);
      await page.waitForTimeout(400);
      await target.hover();
      await page.waitForTimeout(800);
    };
    for (const [width, expectBubble] of [[1280, false], [1279, true]] as const) {
      await page.setViewportSize({ width, height: 800 });
      for (const id of ['nav-layers', 'nav-shortcuts', 'nav-library', 'desktop-output', 'desktop-walks']) {
        await hoverFor(page.getByTestId(id));
        if (expectBubble) await expect(bubble, `${width}: ${id} has a bubble (its name or key is hidden)`).toBeVisible();
        else await expect(bubble, `${width}: ${id} shows its name and key: no bubble`).toHaveCount(0);
      }
      // Icon buttons keep theirs at every width.
      await hoverFor(page.getByTestId('desktop-queue'));
      await expect(bubble, `${width}: Up next (an icon) keeps its bubble`).toBeVisible();
    }
    // The bubble is drawn above the notices stack.
    expect(await bubble.evaluate((el) => Number(getComputedStyle(el).zIndex)), 'above the notices (70)').toBeGreaterThan(70);
    // The labelled nav still tells assistive tech the key.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId('nav-layers')).toHaveAttribute('aria-keyshortcuts', 'L');
    expect(dialogs).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // The rail and the transport
  // ---------------------------------------------------------------------------------------------------------------

  test('R1. 1279 px: the 72 px rail, the panel at 72; 1280 px: the 200 px labelled nav, the full names, the panel at 200', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await openSeededNewLayout(page, 3);
    await openLibraryTab(page);
    const nav = page.getByTestId('side-nav');
    const panel = page.getByTestId('desktop-panel');
    await page.setViewportSize({ width: 1279, height: 800 });
    await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(72);
    expect(Math.round((await panel.boundingBox())!.x), 'the panel beside the rail').toBe(72);
    await expect(page.getByTestId('nav-now').getByText('Playing', { exact: true })).toBeVisible();
    await expect(page.getByTestId('nav-now').getByText('Now Playing', { exact: true })).toBeHidden();
    await expect(page.getByTestId('nav-shortcuts')).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(200);
    expect(Math.round((await panel.boundingBox())!.x), 'the panel moves right with it').toBe(200);
    for (const label of ['Now Playing', 'Library', 'Mixes', 'Layers', 'More']) {
      await expect(nav.getByText(label, { exact: true }).filter({ visible: true }), `${label} shows`).toHaveCount(1);
    }
    await expect(page.getByTestId('nav-now').getByText('Playing', { exact: true })).toBeHidden();
    await expect(nav.getByText('Shortcuts', { exact: true }).filter({ visible: true })).toHaveCount(1);
    await expect(page.getByTestId('nav-layers').locator('kbd')).toHaveText('L');
    await expect(page.getByTestId('nav-now')).toHaveAccessibleName('Now Playing');
    expect(dialogs).toEqual([]);
  });

  test('R2. the open section: aria-current="page", the tint and a 3 px gold bar at the nav’s edge', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await openSeededNewLayout(page, 3);
    for (const [id, width] of [['now', 1280], ['library', 1280], ['layers', 1100]] as const) {
      await page.setViewportSize({ width, height: 800 });
      await tab(page, id);
      const on = page.getByTestId(`nav-${id}`);
      await expect(on).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('nav[aria-label="Main"] [aria-current="page"]')).toHaveCount(1);
      const bar = on.getByTestId('nav-active-bar');
      await expect(bar).toHaveCount(1);
      await expect(page.getByTestId('nav-active-bar'), 'one bar').toHaveCount(1);
      const box = (await bar.boundingBox())!;
      expect(Math.abs(box.x), `${id} at ${width}: at the nav's edge`).toBeLessThanOrEqual(1);
      expect(Math.round(box.width)).toBe(3);
      expect(Math.round(box.height)).toBe(32);
      expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(251, 191, 36)');
    }
    expect(dialogs).toEqual([]);
  });

  test('R3. the skip links come first and reach Play and the panel’s heading', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await openSeededNewLayout(page, 3);
    await openLibraryTab(page);
    const firstTwo = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="new-shell"]')!;
      return Array.from(root.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])')).slice(0, 2).map((el) => el.getAttribute('data-testid'));
    });
    expect(firstTwo, 'first in the shell').toEqual(['skip-player', 'skip-panel']);
    const skipPlayer = page.getByTestId('skip-player');
    await skipPlayer.focus();
    await expect(skipPlayer, 'visible while focused').toBeVisible();
    expect(Math.round((await skipPlayer.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Enter');
    await expect(playButton(page)).toBeFocused();
    await page.getByTestId('skip-panel').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tab-library').getByRole('heading', { name: 'Library', exact: true })).toBeFocused();
    // With no panel open there is no "Skip to the panel".
    await tab(page, 'now');
    await expect(page.getByTestId('skip-panel')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  /** The transport's controls, columns and chips, measured. */
  async function transportBoxes(page: Page) {
    return page.evaluate(() => {
      const f = document.querySelector('[data-testid="new-shell"] [data-testid="desktop-transport"]')!;
      const controls = Array.from(f.querySelectorAll('button, input, [role="slider"]')).map((el) => {
        const r = el.getBoundingClientRect();
        return { name: el.getAttribute('aria-label') || el.textContent?.trim() || el.tagName, left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
      });
      const left = (f.children[0] as HTMLElement).getBoundingClientRect();
      const crystal = f.querySelector('[data-testid="desktop-crystal"]')!.getBoundingClientRect();
      const time = f.querySelector('[data-testid="desktop-time-elapsed"]')!.getBoundingClientRect();
      const chips = f.querySelector('[data-testid="desktop-chips"]')!.getBoundingClientRect();
      // The one showing (recording below 1280 there are two: the icon alone, and the words from xl).
      const mo = Array.from(f.querySelectorAll('[data-testid="desktop-music-only-chip"]')).find((el) => el.getBoundingClientRect().width > 0) ?? null;
      const music = mo ? mo.getBoundingClientRect() : null;
      return {
        controls,
        leftW: left.width,
        crystalRight: crystal.right,
        timeLeft: time.left,
        chipsRight: chips.right,
        music: music ? { left: music.left, right: music.right, width: music.width, title: mo!.getAttribute('title'), text: (mo!.textContent || '').trim() } : null,
        vw: innerWidth,
        vh: innerHeight,
        scrollW: document.documentElement.scrollWidth,
      };
    });
  }

  test('TR1. the transport fits from 1024 px, also while recording and with Music only on: every control (the whole seek row too) inside the viewport and 44 × 44, the title has room, the tile clear of the time', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await playingSeeded(page, 15);
    // Twelve queued: Up next shows a two-digit count, the widest it usually gets (the spec's probe had 3).
    const ids = (await libraryState(page)).libraryIds;
    await page.evaluate((ids) => (window as any).__aetheriaQueue.add(ids, 'queue'), ids.slice(2, 14));
    await expect(page.getByTestId('desktop-queue')).toHaveAttribute('aria-label', /12 queued/);
    await page.getByTestId('nav-now').click();
    const widths = [[1024, 700], [1100, 800], [1279, 800], [1280, 800], [1366, 800]] as const;
    const check = async (state: string) => {
      for (const [width, height] of widths) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(250);
        const m = await transportBoxes(page);
        test.info().annotations.push({ type: `transport at ${width}, ${state}`, description: `left column ${Math.round(m.leftW)} px; crystal right ${Math.round(m.crystalRight)}, time left ${Math.round(m.timeLeft)}` });
        for (const c of m.controls) {
          expect.soft(c.left >= 0 && c.right <= m.vw + 0.5 && c.top >= 0 && c.bottom <= m.vh + 0.5, `${width}, ${state}: ${c.name} inside the viewport (${Math.round(c.left)}–${Math.round(c.right)} × ${Math.round(c.top)}–${Math.round(c.bottom)})`).toBe(true);
          expect.soft(c.w >= 43.5 && c.h >= 43.5, `${width}, ${state}: ${c.name} at least 44 × 44 (${Math.round(c.w)} × ${Math.round(c.h)})`).toBe(true);
        }
        expect.soft(m.leftW, `${width}, ${state}: the left column`).toBeGreaterThanOrEqual(100);
        expect.soft(m.crystalRight, `${width}, ${state}: the crystal tile clear of the elapsed time`).toBeLessThanOrEqual(m.timeLeft);
        expect.soft(m.scrollW, `${width}, ${state}: no sideways scroll`).toBeLessThanOrEqual(m.vw);
        if (state.includes('Music only')) {
          expect.soft(m.music, `${width}, ${state}: the Music only chip`).not.toBeNull();
          if (m.music) expect.soft(m.music.right, `${width}, ${state}: the Music only chip whole, not clipped`).toBeLessThanOrEqual(m.chipsRight + 0.5);
          // Decision 9: a native title only where the chip is its icon alone (recording below 1280).
          const iconOnly = state.includes('recording') && width < 1280;
          if (m.music) expect.soft(m.music.title, `${width}, ${state}: the chip's title`).toBe(iconOnly ? 'Music only' : null);
        }
      }
    };
    await check('playing');
    // The seek row and the buttons over it (decision 8): a press on a button is the button's; beside them, the seek bar's.
    await page.setViewportSize({ width: 1280, height: 800 });
    const hits = await page.evaluate(() => {
      const f = document.querySelector('[data-testid="desktop-transport"]')!;
      const seek = f.querySelector('[role="slider"]')!.getBoundingClientRect();
      const play = f.querySelector('[data-testid="desktop-play"]')!.getBoundingClientRect();
      const prev = f.querySelector('[aria-label="Previous track"]')!.getBoundingClientRect();
      const hitAt = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y);
        return el ? ((el.closest('[role="slider"], button') as HTMLElement | null)?.getAttribute('aria-label') ?? el.tagName) : 'nothing';
      };
      return {
        seekTopBesideButtons: hitAt(seek.left + 12, seek.top + 2),
        // Inside the 5 px where the buttons' row overlaps the seek row, in the gap between Previous and Play.
        seekTopInGap: hitAt((prev.right + play.left) / 2, seek.top + 2),
        overlap: prev.bottom > seek.top || play.bottom > seek.top,
        seekFoot: hitAt(seek.left + seek.width / 2, seek.bottom - 1),
        playFoot: hitAt(play.left + play.width / 2, play.bottom - 2),
        seekBottom: seek.bottom,
        vh: innerHeight,
      };
    });
    expect(hits.seekTopBesideButtons, "the seek row's top edge, beside the buttons").toBe('Seek');
    expect(hits.overlap, 'the rows overlap (the trim)').toBe(true);
    expect(hits.seekTopInGap, "between two buttons, in the overlap: the seek bar's").toBe('Seek');
    expect(hits.seekFoot, "the seek row's foot (on screen now)").toBe('Seek');
    expect(hits.playFoot, "Play's foot is Play's").toMatch(/^(Play|Pause)$/);
    expect(hits.seekBottom, 'the whole seek row on screen').toBeLessThanOrEqual(hits.vh);
    // Recording: the compact REC below 1280 keeps the title's room.
    await tab(page, 'more');
    await page.getByTestId('more').waitFor();
    if ((await page.getByTestId('more').getAttribute('data-more-view')) !== 'root') await tab(page, 'more');
    await page.getByTestId('more-root').getByTestId('more-record-row').click();
    await page.getByRole('button', { name: /Audio Only/ }).click();
    await expect(page.getByTestId('rec-open').first()).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('nav-now').click();
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    await check('recording');
    // Music only on (M), recording and not: its chip first and whole.
    await blur(page);
    await page.keyboard.press('m');
    await check('recording, Music only');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('desktop-transport').getByTestId('rec-open').click();
    await page.getByTestId('record-stop-save').click();
    await expect(page.getByTestId('rec-open')).toHaveCount(0, { timeout: 10_000 });
    await page.getByTestId('nav-now').click();
    await check('Music only');
    await page.keyboard.press('m');
    expect(dialogs).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // The "?" dialog and the key feedback
  // ---------------------------------------------------------------------------------------------------------------

  test('D1. ?, the rail’s Shortcuts and ⋯ › Keyboard shortcuts each open the dialog; its rows are SHORTCUTS; Esc closes it and the focus returns', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingDesktop(page);
    const rows = SHORTCUTS.flatMap((g) => g.rows);
    const expectRows = async () => {
      const dlg = shortcutsDialog(page);
      await expect(dlg).toBeVisible();
      await expect(dlg.getByRole('heading', { level: 3 })).toHaveText(SHORTCUTS.map((g) => g.title));
      await expect(dlg.getByTestId('shortcut-row')).toHaveCount(rows.length);
      const got = await dlg.getByTestId('shortcut-row').evaluateAll((els) =>
        els.map((el) => ({ id: el.getAttribute('data-shortcut'), label: el.querySelector('dt')!.textContent, keys: Array.from(el.querySelectorAll('kbd')).map((k) => k.textContent) }))
      );
      expect(got).toEqual(rows.map((r) => ({ id: r.id, label: r.label, keys: r.keys.flat() })));
    };
    // ? (the focus on Repeat first).
    const repeat = page.getByRole('button', { name: 'Repeat', exact: true });
    await repeat.focus();
    await page.keyboard.press('?');
    await expectRows();
    await page.keyboard.press('Escape');
    await expect(shortcutsDialog(page)).toHaveCount(0);
    await expect(repeat, '? : the focus returns').toBeFocused();
    // The rail's Shortcuts button.
    const rail = page.getByTestId('nav-shortcuts');
    await rail.click();
    await expectRows();
    await page.keyboard.press('Escape');
    await expect(rail, 'the rail button: the focus returns').toBeFocused();
    // ⋯ › Keyboard shortcuts: the menu closes first.
    const more = page.getByRole('button', { name: 'More options', exact: true });
    await more.click();
    await page.getByTestId('menu-shortcuts').click();
    await expectRows();
    await expect(page.getByTestId('sheet-menu'), 'the menu closed first').toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(more, '⋯: the focus returns to ⋯').toBeFocused();
    expect(dialogs).toEqual([]);
  });

  test('FB1. Space, →, N and M each show their pill for about 1.2 s; it is aria-hidden; the live line reads M; idle: no pill', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingDesktop(page);
    await expect(pill(page), 'idle: no pill in the DOM').toHaveCount(0);
    for (const [key, text] of [['Space', 'Pause'], ['ArrowRight', '+5 s'], ['n', 'Next'], ['m', 'Music only: layers off']] as const) {
      const t0 = Date.now();
      await page.keyboard.press(key);
      await expect(pill(page), `${key}: its pill`).toHaveText(text);
      expect(await pill(page).getAttribute('aria-hidden')).toBe('true');
      await page.waitForTimeout(Math.max(0, 900 - (Date.now() - t0)));
      await expect(pill(page), `${key}: still there at 0.9 s`).toHaveText(text);
      await page.waitForTimeout(Math.max(0, 1600 - (Date.now() - t0)));
      await expect(pill(page), `${key}: gone by 1.6 s`).toHaveCount(0);
    }
    await expect(live(page)).toHaveText('Music only on: the tone, beat and drone are off.');
    await page.keyboard.press('m');
    await expect(pill(page)).toHaveText('Layers on');
    await expect(live(page)).toHaveText('Music only off: the layers are back.');
    expect(dialogs).toEqual([]);
  });

  test('FB2. the pill sits at the top of the open visuals (right of the nav and any panel), clear of the notices; the same line twice is announced twice', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingDesktop(page);
    // A notice showing (the offline-ready card), so the pill must keep clear of the stack.
    await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'OFFLINE_READY', added: 3, total: 9 } })));
    await expect(page.getByTestId('notices').getByTestId('offline-ready')).toBeVisible();
    const placed = async () =>
      page.evaluate(() => {
        const p = document.querySelector('[data-testid="key-feedback"]')!.getBoundingClientRect();
        const nav = document.querySelector('[data-testid="side-nav"]')!.getBoundingClientRect();
        const panel = document.querySelector('[data-testid="desktop-panel"]')?.getBoundingClientRect() ?? null;
        const cards = Array.from(document.querySelectorAll('[data-testid="notices"] > div')).map((c) => c.getBoundingClientRect());
        const overlaps = cards.some((c) => p.left < c.right && c.left < p.right && p.top < c.bottom && c.top < p.bottom);
        const start = Math.max(nav.right, panel ? panel.right : 0);
        return { centre: p.left + p.width / 2, want: (start + innerWidth) / 2, top: p.top, overlaps };
      });
    await page.keyboard.press('ArrowRight');
    await expect(pill(page)).toBeVisible();
    let at = await placed();
    expect(Math.abs(at.centre - at.want), 'centred on the open visuals (no panel)').toBeLessThanOrEqual(2);
    expect(at.top, 'at the top').toBeLessThanOrEqual(30);
    expect(at.overlaps, 'clear of the notices').toBe(false);
    await page.keyboard.press('q');
    await expect(sheet(page, 'Up next')).toBeVisible();
    await blur(page);
    await page.keyboard.press('ArrowLeft');
    await expect(pill(page)).toHaveText('−5 s');
    at = await placed();
    expect(Math.abs(at.centre - at.want), 'centred right of the open panel').toBeLessThanOrEqual(2);
    expect(at.overlaps).toBe(false);
    await page.keyboard.press('q');
    // The same line twice in a row (Pause, the button's Play, Pause): announced again (the region's node replaced).
    await page.evaluate(() => {
      const w = window as any;
      w.__liveNodes = 0;
      new MutationObserver((rs) => { for (const r of rs) w.__liveNodes += r.addedNodes.length; }).observe(document.querySelector('[data-testid="key-live"]')!, { childList: true, subtree: true });
    });
    await blur(page);
    await page.keyboard.press('Space');
    await expect(live(page)).toHaveText('Paused.');
    await playButton(page).click();
    await expect(playButton(page)).toHaveAttribute('aria-label', 'Pause');
    await blur(page);
    await page.keyboard.press('Space');
    await expect(playButton(page)).toHaveAttribute('aria-label', 'Play');
    await expect.poll(() => page.evaluate(() => (window as any).__liveNodes), { message: '"Paused." twice: two announcements' }).toBe(2);
    await expect(live(page)).toHaveText('Paused.');
    expect(dialogs).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // The restore card
  // ---------------------------------------------------------------------------------------------------------------

  test('N1. restore plus offline-ready: the restore card is in the notices and no two notices overlap (desktop, phone Now Playing and Library)', async ({ page }) => {
    test.setTimeout(150_000);
    // Hold the restore notice up for the test (App drops it 2 s after the restore).
    await page.addInitScript(() => {
      const st = window.setTimeout;
      (window as any).setTimeout = function (fn: any, ms?: number, ...rest: any[]) {
        if (typeof fn === 'function' && ms === 2000 && String(fn).includes('setIsRestoring')) ms = 120_000;
        return st(fn, ms, ...rest);
      };
    });
    const dialogs = await openSeededNewLayout(page, 12);
    const notices = page.getByTestId('notices');
    const card = page.getByTestId('restore-card');
    await expect(card).toHaveText('Restored 12 tracks from cache.');
    await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'OFFLINE_READY', added: 3, total: 9 } })));
    await expect(notices.getByTestId('offline-ready')).toBeVisible();
    const check = async (where: string, at: 'head' | 'foot') => {
      await page.waitForTimeout(300);
      await expect(notices.getByTestId('restore-card'), `${where}: in the notices`).toBeVisible();
      const boxes = await page.evaluate(() => {
        const kids = Array.from(document.querySelectorAll('[data-testid="notices"] > div')).map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.getAttribute('data-testid'), x: r.x, y: r.y, width: r.width, height: r.height };
        });
        // Anything else saying "Restored" (classic's pill) must not exist in the new layout.
        const outside = Array.from(document.querySelectorAll('body *')).filter(
          (el) => el.children.length === 0 && /Restored \d+ tracks/.test(el.textContent || '') && !el.closest('[data-testid="notices"]')
        ).length;
        return { kids: kids.filter((k) => k.height > 0), outside };
      });
      expect(boxes.outside, `${where}: no restore pill outside the notices`).toBe(0);
      expect(boxes.kids.length, `${where}: two cards`).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < boxes.kids.length; i++)
        for (let j = i + 1; j < boxes.kids.length; j++)
          expect(intersects(boxes.kids[i], boxes.kids[j]), `${where}: ${boxes.kids[i].id} and ${boxes.kids[j].id} overlap`).toBe(false);
      // On screen, top to bottom (the card keeps one place in the DOM; its flex order moves it).
      const ids = [...boxes.kids].sort((a, b) => a.y - b.y).map((k) => k.id);
      expect(at === 'head' ? ids[0] : ids[ids.length - 1], `${where}: the card at the stack's ${at}`).toBe('restore-card');
    };
    await check('desktop', 'head');
    await page.setViewportSize(PHONE_VIEWPORT);
    await expect(page.locator('[data-shell="phone"]')).toBeVisible();
    await check('phone, Now Playing', 'foot');
    // A tab switch moves the card within the stack without inserting it again (so it isn't read out again).
    await page.evaluate(() => {
      const w = window as any;
      w.__restoreInserts = 0;
      new MutationObserver((rs) => {
        for (const r of rs) for (const n of Array.from(r.addedNodes)) if ((n as HTMLElement).getAttribute?.('data-testid') === 'restore-card') w.__restoreInserts++;
      }).observe(document.querySelector('[data-testid="notices"]')!, { childList: true });
    });
    await tab(page, 'library');
    await check('phone, Library', 'head');
    expect(await page.evaluate(() => (window as any).__restoreInserts), 'the card was not inserted again').toBe(0);
    expect(dialogs).toEqual([]);
  });
});

test.describe('desktop, touch', () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  test.skip(ON_DEVICE, 'the desktop shell: a phone shows the phone shell (the desktop runs check this)');

  test('T3. a touch tablet with the desktop shell: a tap on Play shows no bubble', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await playingDesktop(page);
    await playButton(page).tap();
    await expect(playButton(page), 'the tap pressed it').toHaveAttribute('aria-label', 'Play');
    await page.waitForTimeout(900);
    await expect(page.locator('[data-tooltip]'), 'no bubble for a touch').toHaveCount(0);
    await playButton(page).tap();
    await page.waitForTimeout(900);
    await expect(page.locator('[data-tooltip]')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });
});

test.describe('elsewhere', () => {
  test('K13. no keys in classic, nor in the phone shell', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialogs = await openApp(page);
    await importTones(page, 2, 30);
    await page.getByText('tone-01', { exact: true }).first().click();
    await expect.poll(async () => !!(await page.evaluate(() => (window as any).__audio.music && !(window as any).__audio.music.paused)), { timeout: 20_000 }).toBe(true);
    expect(await keysDev(page), 'classic: no listener').toBeNull();
    await blur(page);
    for (const k of ['Space', 'n', 'm', 'f']) await page.keyboard.press(k);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__audio.music.paused), 'classic: Space on <body> does nothing').toBe(false);
    expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    // The phone shell.
    await page.setViewportSize(PHONE_VIEWPORT);
    await page.evaluate((k) => localStorage.setItem(k, 'new'), LAYOUT_KEY);
    await page.reload();
    await expect(page.locator('[data-shell="phone"]')).toBeVisible();
    expect(await keysDev(page), 'the phone shell: no listener').toBeNull();
    await blur(page);
    const paused = await page.evaluate(() => (window as any).__audio.music?.paused ?? null);
    for (const k of ['Space', 'm']) await page.keyboard.press(k);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__audio.music?.paused ?? null)).toBe(paused);
    expect(await musicOnlySaved(page)).not.toBe('true');
    expect(dialogs).toEqual([]);
  });
});
