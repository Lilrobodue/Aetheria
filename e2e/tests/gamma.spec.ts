import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  acceptDisclaimer,
  acceptDisclaimerNew,
  seedLibraryRecords,
  libraryState,
  openLibraryTab,
  libraryRowButton,
  openLayersTab,
  layersJump,
  layersSection,
  tab,
  phoneSize,
  layersState,
  expectLegendShown,
  openHarmonicControl,
  openApp,
  seedLayers,
  tapTraditional,
  PHONE_VIEWPORT,
  LAYER_ENGINE_KEY,
  LAYER_OUTPUT_KEY,
  LAYOUT_KEY,
  type SeedOptions,
} from './helpers';
import { plan as v2Plan, BANDS, BAND_ORDER } from '../../utils/soundV2/aetheria_sound_v2.ts';
import type { Band } from '../../utils/soundV2/aetheria_sound_v2.ts';

// v16.8.4 "Adaptive gamma" (spec §2.8): v2's Adaptive reaches Gamma on headphones, with Gamma in Adaptive:
//   - Smooth (the default) keeps Gamma's beat pair for every band while Adaptive is on, so on the 11 tones whose pair
//     moves at Gamma (852 here) a band step is only ever a glide, and on the other 22 (528) the plan is v16.8.3's;
//   - Sticky plays v2's own pair per band, so 852 fades once into Gamma and once out, and Gamma holds 10 ticks (30 s);
//   - the setting is saved (aetheria.adaptiveGamma.v1), the classic layout with the v2 sound uses it, and off headphones
//     it is disabled and says why;
//   - Export with layers follows it (a two-track long file reaching Gamma, in each mode).
// The tracks are synthetic tones with a synthetic band envelope (loud, then quiet), written as a Deep Scan would.
// Dev server only (the player's dev hook, window.__aetheriaLayers).

const GAMMA_KEY = 'aetheria.adaptiveGamma.v1';
/** The words (v1684 review page; fix round 1 corrected Smooth, Sticky and the note off headphones). */
const LEGEND = 'Gamma in Adaptive';
const SMOOTH_LINE = 'No fade. On 11 of the 33 tones the beat pair sits an octave or two higher all track.';
const STICKY_LINE = 'The usual beat pair. On 11 tones the layers drop out for a few seconds when Gamma starts or ends; once reached, Gamma holds at least 30 s.';
const OFF_HEADPHONES = 'Headphones only.';
const PRESETS_NOTE = 'Adaptive reaches Gamma on headphones. Off headphones the beat is a gentle pulse, capped at Alpha.';

/** The plan v16.8.3 played (the vendored plan(), binaural, the band's beat). */
const plan1683 = (f: number, band: Band) => v2Plan(f, 'headphones', 'binaural', BANDS[band])!;

type Ev = { t: number; e: 'arm' | 'tick' | 'clear' | 'chip' | 'phase' | 'carrier' | 'beat' | 'play' | 'sound' | 'setBeat'; id?: number; text?: string; v?: number };

/**
 * From the next load on, a record on the page's clock: every arm, tick and clear of a 3 s interval (the adaptive
 * band's), every text the band chip shows (the new layout's chip-beat, classic's Waves chip), and, every 100 ms, the v2
 * player's phase, its sounding carrier and the beat it was asked for, each when it changes; and (fix round 1, rev1 tests
 * N3) 'sound': the asked-for beat with the sounding plan's tone, carrier, drone and pulse, as JSON, whenever any changes,
 * so a test can read the sounding plan at each band.
 */
async function record(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: Array<Record<string, unknown>> = ((window as any).__gammaLog = []);
    const live = new Set<number>();
    const set = window.setInterval, clear = window.clearInterval;
    (window as any).setInterval = (handler: unknown, ms?: number, ...args: unknown[]) => {
      if (ms !== 3000 || typeof handler !== 'function') return set.call(window, handler as TimerHandler, ms, ...args);
      const id: number = set.call(window, () => {
        log.push({ t: performance.now(), e: 'tick', id });
        (handler as (...a: unknown[]) => void)(...args);
      }, ms);
      live.add(id);
      log.push({ t: performance.now(), e: 'arm', id });
      return id;
    };
    (window as any).clearInterval = (id?: number) => {
      if (id !== undefined && live.delete(id)) log.push({ t: performance.now(), e: 'clear', id });
      clear.call(window, id);
    };
    let chip: string | null = null, phase: string | null = null, carrier: number | null = null, beat: number | null = null, sound: string | null = null;
    set.call(window, () => {
      const t = performance.now();
      const fresh = document.querySelector('[data-testid="chip-beat"]');
      const title = document.querySelector('[data-testid="now-playing-title"]');
      const old = title?.parentElement?.querySelector('span:has(> svg.lucide-waves)');
      const text = (fresh ?? old)?.textContent?.trim() ?? null;
      if (text !== null && text !== chip) { chip = text; log.push({ t, e: 'chip', text }); }
      const st = (window as any).__aetheriaLayers?.state?.();
      if (!st) return;
      if (st.phase !== phase) { phase = st.phase; log.push({ t, e: 'phase', text: st.phase }); }
      const c = st.sounding?.carrier_hz ?? null;
      if (c !== carrier) { carrier = c; log.push({ t, e: 'carrier', v: c }); }
      const b = st.requested?.beat_hz ?? null;
      if (b !== beat) { beat = b; log.push({ t, e: 'beat', v: b }); }
      const so = st.sounding ? JSON.stringify([b, st.sounding.tone_hz, st.sounding.carrier_hz, st.sounding.drone_hz, st.sounding.pulse_hz]) : null;
      if (so !== sound) { sound = so; if (so !== null) log.push({ t, e: 'sound', text: so }); }
    }, 100);
  });
}
const events = (page: Page): Promise<Ev[]> => page.evaluate(() => (window as any).__gammaLog);
/** Log every LayerPlayer.play() call (its plan's carrier; 0 for a pause) into the record as 'play' (dev server: the live
 *  player's own module). A re-plan with the same voice is a play() too, so a band step that re-plans shows here. */
async function spyPlays(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const P = ((await import('/utils/soundV2/layerPlayer.ts')) as any).LayerPlayer.prototype;
    if (P.__gammaSpied) return;
    P.__gammaSpied = true;
    const play = P.play;
    P.play = function (this: unknown, plan: any, ...a: unknown[]) {
      (window as any).__gammaLog.push({ t: performance.now(), e: 'play', v: plan?.carrier_hz ?? 0 });
      return play.call(this, plan, ...a);
    };
  });
}
const after = (log: Ev[], t: number, e: Ev['e']) => log.filter((x) => x.e === e && x.t > t);
const report = (log: Ev[], t0: number) =>
  log.filter((x) => x.t > t0 && x.e !== 'tick' && x.e !== 'sound').map((x) => `${x.e} ${x.text ?? x.v ?? ''} +${((x.t - t0) / 1000).toFixed(1)}`).join(', ');

/**
 * Write a synthetic band envelope into the meta records at these library indexes (fps 20: each step `level` in all four
 * bands for `seconds`), from /manifest.json as helpers.writeBandEnvelope does, so the app can't save over it.
 */
async function writeEnvelopes(page: Page, entries: Array<{ index: number; steps: Array<[number, number]> }>): Promise<void> {
  await page.goto('/manifest.json');
  await page.evaluate(async (entries) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const get = (store: IDBObjectStore, key: string): Promise<any> =>
      new Promise((resolve, reject) => {
        const r = store.get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const tx = db.transaction(['playlist-state', 'meta'], 'readwrite');
    const state = await get(tx.objectStore('playlist-state'), 'current');
    for (const e of entries) {
      const id: string | undefined = state?.originalOrder?.[e.index];
      const meta = id ? await get(tx.objectStore('meta'), id) : undefined;
      if (!meta) throw new Error(`writeEnvelopes: no saved track at index ${e.index}`);
      const frames = e.steps.reduce((n, [, s]) => n + Math.round(s * 20), 0);
      const band = () => {
        const a = new Uint8Array(frames);
        let k = 0;
        for (const [level, s] of e.steps) { a.fill(level, k, k + Math.round(s * 20)); k += Math.round(s * 20); }
        return a;
      };
      meta.bandEnvelope = { fps: 20, sub: band(), bass: band(), mid: band(), high: band() };
      tx.objectStore('meta').put(meta);
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, entries);
}

/** A seeded library (v2, headphones unless told; the layout and Gamma in Adaptive as given), its envelopes, loaded. */
async function openSeeded(
  page: Page,
  o: { layout: 'new' | 'classic'; n: number; seed: SeedOptions; envelopes: Array<{ index: number; steps: Array<[number, number]> }>; gamma?: 'smooth' | 'sticky'; output?: string }
): Promise<void> {
  await page.addInitScript(
    ({ keys, layout, gamma, output }) => {
      try {
        if (sessionStorage.getItem('__e2eGammaSeeded') === null) {
          sessionStorage.setItem('__e2eGammaSeeded', '1');
          localStorage.setItem(keys.engine, 'v2');
          localStorage.setItem(keys.output, output);
          localStorage.setItem(keys.layout, layout);
          if (gamma) localStorage.setItem(keys.gamma, gamma);
        }
        localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      } catch {}
    },
    { keys: { engine: LAYER_ENGINE_KEY, output: LAYER_OUTPUT_KEY, layout: LAYOUT_KEY, gamma: GAMMA_KEY }, layout: o.layout, gamma: o.gamma ?? null, output: o.output ?? 'headphones' }
  );
  await seedLibraryRecords(page, o.n, o.seed);
  await writeEnvelopes(page, o.envelopes);
  await page.goto('/');
  if (o.layout === 'new') await acceptDisclaimerNew(page);
  else await acceptDisclaimer(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the seeded library restores', timeout: 60_000 }).toBe(o.n);
}

/** Loud (Gamma's intensity) for the first 16 s of the track, then quiet (Delta's) to `total` s. */
const LOUD_THEN_QUIET = (total: number): Array<[number, number]> => [[250, 16], [0, total - 16]];

/** Play tone-0001 from the new layout's Library tab, then show Now Playing (its chip). */
async function playNew(page: Page): Promise<number> {
  await openLibraryTab(page);
  const t = await page.evaluate(() => performance.now());
  await libraryRowButton(page, 'tone-0001').click();
  await expect.poll(async () => { const s = await libraryState(page); return s.playing && (s.t ?? 0) > 0.2; }, { timeout: 20_000 }).toBe(true);
  await tab(page, 'now');
  return t;
}

/** The record from the first time the player's gates were open after `t0` (the first play's own opening excluded). */
async function fromFirstOpen(page: Page, t0: number): Promise<{ log: Ev[]; open: number }> {
  await expect.poll(async () => after(await events(page), t0, 'phase').some((x) => x.text === 'open'), { message: 'the layers open', timeout: 20_000 }).toBe(true);
  const log = await events(page);
  return { log, open: after(log, t0, 'phase').find((x) => x.text === 'open')!.t };
}

/** Wait until the chip has read Gamma and then Beta again (up to Gamma and back), up to `ms`. */
async function upAndBack(page: Page, t0: number, ms: number): Promise<Ev[]> {
  await expect
    .poll(async () => {
      const chips = after(await events(page), t0, 'chip').map((x) => x.text);
      const g = chips.indexOf('Gamma');
      return g >= 0 && chips.slice(g + 1).includes('Beta');
    }, { message: 'Adaptive goes up to Gamma and back to Beta', timeout: ms, intervals: [500] })
    .toBe(true);
  return events(page);
}

test.describe('phone, the new layout', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  for (const hz of [852, 528] as const) {
    const moves = hz === 852;
    test(`GA${moves ? 1 : 2}. Smooth (the default) on ${hz}${moves ? ', one of the 11 whose pair moves at Gamma' : ', one of the 22'}: from Beta to Gamma and back the player never retunes, its carrier stays ${moves ? "Gamma's" : 'put'}${moves ? '' : ', and its plan is v16.8.3’s'}, the chip reads Gamma${moves ? ' @mobile' : ''}`, async ({ page }) => {
      test.setTimeout(180_000);
      await record(page);
      await openSeeded(page, { layout: 'new', n: 1, seed: { real: 1, seconds: 60, patch: [{ index: 0, crystal: hz }] }, envelopes: [{ index: 0, steps: LOUD_THEN_QUIET(60) }] });
      await phoneSize(page);
      expect(await page.evaluate((k) => localStorage.getItem(k), GAMMA_KEY), 'nothing saved: the default').toBeNull();
      await spyPlays(page);
      const t0 = await playNew(page);
      const { open } = await fromFirstOpen(page, t0);
      const log = await upAndBack(page, t0, 60_000);
      test.info().annotations.push({ type: `Smooth on ${hz}`, description: report(log, t0) });
      // The chip's texts (the Now tab may have shown Alpha before the play): a band a step, Beta, Gamma, then Beta again.
      const chips = after(log, t0, 'chip').map((x) => x.text);
      const g = chips.indexOf('Gamma');
      expect(chips.slice(g - 1, g + 2), 'Beta, Gamma, Beta: a band a step').toEqual(['Beta', 'Gamma', 'Beta']);
      expect(after(log, open, 'phase').map((x) => x.text), 'the gates stay open: no retune').toEqual([]);
      expect(after(log, t0, 'play').map((x) => x.v), 'one play (the start): the band steps never re-plan').toEqual([after(log, t0, 'carrier')[0]?.v]);
      const carriers = after(log, t0, 'carrier').map((x) => x.v);
      const want = moves ? plan1683(hz, 'gamma').carrier_hz : plan1683(hz, 'beta').carrier_hz;
      expect(carriers, `one carrier all through (${want} Hz)`).toEqual([want]);
      expect(after(log, t0, 'beat').map((x) => x.v), "the beat steps to Gamma's and back").toEqual(expect.arrayContaining([10, 20, 40]));
      const st = await layersState(page);
      expect(st.phase).toBe('open');
      if (moves) {
        expect(want, "852 on Gamma's pair (426), an octave above v16.8.3's below Gamma (213)").toBe(426);
        expect(plan1683(hz, 'beta').carrier_hz).toBe(213);
      } else {
        // v16.8.3's plan at each band it played: the same tone, carrier, drone and pulse (only the beat follows the band).
        // Fix round 1 (rev1 tests N3): read at each band from the record (every change of the asked-for beat or the
        // sounding plan), not once at the end.
        const byBand = new Map<Band, number[][]>();
        for (const x of after(log, t0, 'sound')) {
          const [beat, ...sounding] = JSON.parse(x.text!) as number[];
          const b = BAND_ORDER.find((k) => BANDS[k] === beat);
          if (b) byBand.set(b, [...(byBand.get(b) ?? []), sounding]);
        }
        test.info().annotations.push({ type: '528: the sounding plan at each band', description: JSON.stringify(Object.fromEntries(byBand)) });
        expect([...byBand.keys()], 'read at Beta and at Gamma at least').toEqual(expect.arrayContaining(['beta', 'gamma']));
        for (const [b, reads] of byBand) {
          const p = plan1683(hz, b);
          for (const r of reads) expect(r, `528 at ${b} (${reads.length} reads): v16.8.3's plan`).toEqual([p.tone_hz, p.carrier_hz, p.drone_hz, p.pulse_hz]);
        }
      }
    });
  }

  test('GA4. the setting: Smooth by default; Sticky is saved (Smooth again after it too, no reload) and kept across a reload; Adaptive off leaves it enabled; off headphones it is disabled and says why; Car hides it; a 44 px target @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await openSeeded(page, { layout: 'new', n: 1, seed: { real: 1, seconds: 10, patch: [{ index: 0, crystal: 852 }] }, envelopes: [{ index: 0, steps: [[0, 10]] }] });
    await phoneSize(page);
    await openLayersTab(page);
    await layersJump(page, 'beat').click();
    const beat = layersSection(page, 'beat');
    const group = beat.getByRole('group', { name: LEGEND, exact: true });
    await expect(group).toBeVisible();
    // Fix round 1 (rev1 tests SF6): the legend is shown, not sr-only (a 1×1 sr-only box passes toBeVisible()).
    await expectLegendShown(group, LEGEND, 'Gamma in Adaptive');
    const smooth = group.getByRole('radio', { name: /^Smooth/ });
    const sticky = group.getByRole('radio', { name: /^Sticky/ });
    await expect(smooth).toBeChecked();
    await expect(sticky).not.toBeChecked();
    await expect(group.getByText(SMOOTH_LINE, { exact: true })).toBeVisible();
    await expect(group.getByText(STICKY_LINE, { exact: true })).toBeVisible();
    await expect(beat.getByText(PRESETS_NOTE, { exact: true })).toBeVisible();
    // The bands are their own group still: five radios, under their own shown legend (fix round 1, B).
    await expect(beat.getByRole('group', { name: 'Beat band' }).getByRole('radio')).toHaveCount(5);
    await expectLegendShown(beat.getByRole('group', { name: 'Beat band', exact: true }), 'Beat band', 'the bands');
    // 44 px targets.
    for (const l of await group.locator('label').all()) {
      const box = await l.boundingBox();
      expect(box && box.height >= 44 && box.width >= 44, 'each row a 44 px target').toBe(true);
    }
    // Fix round 1 (rev1 app N4): a tap on the checked Smooth is not a choice (the engine's rule I9): nothing is saved.
    await group.getByText('Smooth', { exact: true }).click();
    await expect(smooth).toBeChecked();
    await page.waitForTimeout(300);
    expect(await page.evaluate((k) => localStorage.getItem(k), GAMMA_KEY), 'a tap on the checked Smooth saves nothing').toBeNull();
    // Sticky: saved from the tap.
    await group.getByText('Sticky', { exact: true }).click();
    await expect(sticky).toBeChecked();
    expect(await page.evaluate((k) => localStorage.getItem(k), GAMMA_KEY)).toBe('sticky');
    // Fix round 2 (rev2 tests N1): Smooth right after Sticky, in the same page life (no reload between), is a choice
    // too: checked and saved; then Sticky again, for the reload below.
    await group.getByText('Smooth', { exact: true }).click();
    await expect(smooth, 'Smooth after Sticky, no reload: checked').toBeChecked();
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), GAMMA_KEY), { message: 'Smooth after Sticky, no reload: saved', timeout: 2_000 }).toBe('smooth');
    await group.getByText('Sticky', { exact: true }).click();
    await expect(sticky, 'Sticky again: checked').toBeChecked();
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), GAMMA_KEY), { message: 'Sticky again: saved', timeout: 2_000 }).toBe('sticky');
    // Adaptive off: still enabled (a saved preference).
    await beat.getByRole('switch', { name: 'Adaptive' }).click();
    await expect(beat.getByRole('switch', { name: 'Adaptive' })).toHaveAttribute('aria-checked', 'false');
    await expect(smooth).toBeEnabled();
    await expect(sticky).toBeEnabled();
    // A reload keeps it.
    await page.reload();
    await acceptDisclaimerNew(page);
    await openLayersTab(page);
    await layersJump(page, 'beat').click();
    await expect(layersSection(page, 'beat').getByRole('group', { name: LEGEND }).getByRole('radio', { name: /^Sticky/ })).toBeChecked();
    // Off headphones: disabled, with its note; Car: no beat, so no control.
    const output = (label: string) => layersSection(page, 'sound').getByRole('group', { name: 'Output' }).getByRole('button', { name: label, exact: true });
    await layersJump(page, 'sound').click();
    await output('Speakers').click();
    await layersJump(page, 'beat').click();
    const g2 = layersSection(page, 'beat').getByRole('group', { name: LEGEND });
    await expect(g2.getByRole('radio', { name: /^Smooth/ })).toBeDisabled();
    await expect(g2.getByRole('radio', { name: /^Sticky/ })).toBeDisabled();
    await expect(g2.getByText(OFF_HEADPHONES, { exact: true })).toBeVisible();
    // Fix round 2 (rev2 tests N2): the bands' legend is shown off headphones too (the pulse).
    await expectLegendShown(layersSection(page, 'beat').getByRole('group', { name: 'Beat band', exact: true }), 'Beat band', 'the bands, on Speakers');
    await layersJump(page, 'sound').click();
    await output('Car').click();
    await layersJump(page, 'beat').click();
    await expect(layersSection(page, 'beat').getByRole('group', { name: LEGEND })).toHaveCount(0);
    await layersJump(page, 'sound').click();
    await output('Headphones').click();
    await layersJump(page, 'beat').click();
    await expect(layersSection(page, 'beat').getByRole('group', { name: LEGEND }).getByRole('radio', { name: /^Sticky/ })).toBeEnabled();
    await expect(layersSection(page, 'beat').getByText(OFF_HEADPHONES, { exact: true })).toHaveCount(0);
    // Picking Smooth again saves it.
    await layersSection(page, 'beat').getByRole('group', { name: LEGEND }).getByText('Smooth', { exact: true }).click();
    expect(await page.evaluate((k) => localStorage.getItem(k), GAMMA_KEY)).toBe('smooth');
  });
});

test('GA3. Sticky in the classic layout (the saved choice; classic has no control): on 852 exactly one retune into Gamma, Gamma holds at least 10 ticks, then one retune out', async ({ page }) => {
  test.setTimeout(240_000);
  await record(page);
  await openSeeded(page, { layout: 'classic', n: 1, gamma: 'sticky', seed: { real: 1, seconds: 75, patch: [{ index: 0, crystal: 852 }] }, envelopes: [{ index: 0, steps: LOUD_THEN_QUIET(75) }] });
  await expect(page.getByRole('group', { name: LEGEND }), 'classic has no control').toHaveCount(0);
  await spyPlays(page);
  const t0 = await page.evaluate(() => performance.now());
  await page.getByRole('complementary').getByText('tone-0001', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const { open } = await fromFirstOpen(page, t0);
  const log = await upAndBack(page, t0, 90_000);
  // Then the carrier back on Beta's pair.
  await expect.poll(async () => after(await events(page), t0, 'carrier').map((x) => x.v).at(-1), { timeout: 15_000 }).toBe(213);
  const all = await events(page);
  test.info().annotations.push({ type: 'Sticky on 852 (classic layout)', description: report(all, t0) });
  const chips = after(all, t0, 'chip');
  const g = chips.findIndex((x) => x.text === 'Gamma');
  const back = chips.slice(g + 1).find((x) => x.text === 'Beta')!;
  const arm = after(all, t0, 'arm').at(-1)!;
  const ticksAtGamma = all.filter((x) => x.e === 'tick' && x.id === arm.id && x.t > chips[g].t && x.t < back.t).length;
  expect(ticksAtGamma, 'Gamma holds at least 10 ticks before the step down (Smooth would hold 2)').toBeGreaterThanOrEqual(10);
  expect(after(all, t0, 'carrier').map((x) => x.v), "v2's own pairs: 213 below Gamma, 426 at Gamma, 213 again").toEqual([213, 426, 213]);
  const retunes = after(all, open, 'phase').filter((x) => x.text === 'retuning');
  expect(retunes.length, 'two retunes: into Gamma and out of it').toBe(2);
  expect(retunes[0].t, 'the first at the step into Gamma').toBeGreaterThan(chips[g].t - 1000);
  expect(retunes[0].t).toBeLessThan(back.t);
  expect(retunes[1].t, 'the second at the step out').toBeGreaterThan(back.t - 1000);
  expect(after(all, t0, 'play').map((x) => x.v), 'three plays: the start, into Gamma, out (no re-plan at the other steps)').toEqual([213, 426, 213]);
  expect(log.length).toBeGreaterThan(0);
  // The sound log's v2 entries carry the setting (saved every 5 s while listening).
  await expect
    .poll(() => page.evaluate(() => { const ss = JSON.parse(localStorage.getItem('aetheria.soundSessions.v1') ?? '[]'); return ss.flatMap((x: any) => x.entries).filter((e: any) => e.engine === 'v2').map((e: any) => e.gamma_mode ?? null); }), { message: 'the sound log notes Sticky', timeout: 15_000 })
    .toEqual(expect.arrayContaining(['sticky']));
});

// Fix round 1 (rev1 tests SF2, SF4, SF5): also a one-file-per-track Sticky export (Gamma held 30 s: engine.ts's track
// path passes the setting to bandSchedule) and an Adaptive-off one (v2's own pair, no retune); the live part's last poll
// is bounded at 5 s, so a re-plan that waits for the next band step fails, and it plays tone-0003 (852, no band
// envelope: no band step ever comes), so nothing but the tap can move the carrier.
test('GA5. Export with layers follows the setting: a two-track long file on 852 reaching Gamma, Smooth with one carrier and no retune, Sticky with a retune into and out of Gamma per track and Gamma held 30 s; one file per track in Sticky; Adaptive off; the carrier the live player starts on, and one retune live from Sticky to Smooth', async ({ page }) => {
  test.setTimeout(300_000);
  // Fix round 2 (rev2 tests N5): the record (the live player's phases, carriers and plays) for the live part's last tap.
  await record(page);
  await openSeeded(page, {
    layout: 'new',
    n: 3,
    seed: { real: 3, seconds: 50, patch: [{ index: 0, crystal: 852 }, { index: 1, crystal: 852 }, { index: 2, crystal: 852 }], playlists: [{ id: 'pgammalong', name: 'Gamma', indexes: [0, 1] }] },
    envelopes: [{ index: 0, steps: LOUD_THEN_QUIET(50) }, { index: 1, steps: LOUD_THEN_QUIET(50) }],
  });
  await page.setViewportSize(PHONE_VIEWPORT);
  await page.waitForFunction(() => typeof (window as any).__aetheriaExport?.render === 'function', null, { timeout: 10_000 });
  // The saved playlists load after the library: wait for this one.
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as any).__aetheriaPlaylists?.state?.() ?? null).slice(0, 400)), { message: 'the playlist loads', timeout: 20_000 }).toContain('pgammalong');
  const ids = (await libraryState(page)).libraryIds;
  const choose = async (mode: 'smooth' | 'sticky') => {
    await openLayersTab(page);
    await layersJump(page, 'beat').click();
    const group = layersSection(page, 'beat').getByRole('group', { name: LEGEND });
    await group.getByText(mode === 'smooth' ? 'Smooth' : 'Sticky', { exact: true }).click();
    await expect(group.getByRole('radio', { name: mode === 'smooth' ? /^Smooth/ : /^Sticky/ })).toBeChecked();
    // Saved, or (fix round 1, C2) the default Smooth never chosen: a tap on the mode in effect saves nothing.
    const ok = mode === 'smooth' ? ['smooth', null] : ['sticky'];
    await expect.poll(async () => ok.includes(await page.evaluate((k) => localStorage.getItem(k), GAMMA_KEY)), { message: `the key is ${ok.join(' or ')}` }).toBe(true);
  };
  const run = async (mode: 'smooth' | 'sticky', o: { files?: 'long' | 'one'; snap?: Record<string, unknown> } = {}) => {
    await choose(mode);
    return page.evaluate(async ({ id, files, snap }) => {
      const lp = await import('/utils/soundV2/layerPlayer.ts');
      const P = (lp as any).LayerPlayer.prototype;
      const play = P.play, setBeat = P.setBeat;
      const calls: Array<{ k: string; t: number; c?: number; b?: number }> = [];
      P.play = function (this: any, p: any, ...a: unknown[]) { calls.push({ k: 'play', t: this.state().t, c: p?.carrier_hz ?? 0 }); return play.call(this, p, ...a); };
      P.setBeat = function (this: any, b: number) { calls.push({ k: 'beat', t: this.state().t, b }); return setBeat.call(this, b); };
      try {
        const s = { adaptive: true, presetName: 'Beta', phiOn: false, ...snap };
        // 'one': the track alone, one file (engine.ts's track path); else the playlist as one long file.
        const r = await (window as any).__aetheriaExport.render(id, files === 'one' ? { snap: s } : { playlistId: 'pgammalong', files: 'long', snap: s });
        return { outcome: r.outcome, reason: r.reason ?? null, files: r.files.length, plan: r.files[0]?.plan ?? null, spec: r.spec, calls };
      } finally {
        P.play = play;
        P.setBeat = setBeat;
      }
    }, { id: ids[0], files: o.files ?? 'long', snap: o.snap ?? {} });
  };
  const sm = await run('smooth');
  const st = await run('sticky');
  expect([sm.outcome, st.outcome], JSON.stringify([sm.reason, st.reason, sm.files, st.files])).toEqual(['done', 'done']);
  test.info().annotations.push({ type: 'GA5 plays and beats', description: JSON.stringify({ smooth: sm.calls.filter((c) => c.k === 'play'), sticky: st.calls.filter((c) => c.k === 'play'), smoothRetunes: sm.plan.retunes, stickyRetunes: st.plan.retunes }) });
  expect([sm.outcome, st.outcome]).toEqual(['done', 'done']);
  expect(sm.spec.map((s: any) => s.gammaMode), 'the snapshot’s setting reaches each track’s spec').toEqual(['smooth', 'smooth']);
  expect(st.spec.map((s: any) => s.gammaMode)).toEqual(['sticky', 'sticky']);
  // Smooth: Gamma's carrier for the whole file, one play, every band step a beat glide that reaches 40 Hz.
  expect(sm.plan.segments.map((s: any) => s.carrierHz)).toEqual([426, 426]);
  expect(sm.calls.filter((c) => c.k === 'play').map((c) => c.c), 'Smooth: one play, no retune').toEqual([426]);
  expect(sm.plan.retunes).toBe(0);
  expect(sm.calls.some((c) => c.k === 'beat' && c.b === 40), 'Smooth: the beat reaches Gamma').toBe(true);
  expect(sm.plan.segments.every((s: any) => s.bands > 0), 'both tracks step').toBe(true);
  // Sticky: v2's own pair per band: into Gamma (426) and out (213) in each track, Gamma held 30 s or more each time.
  const plays = st.calls.filter((c) => c.k === 'play');
  expect(st.plan.segments.map((s: any) => s.carrierHz)).toEqual([213, 213]);
  expect(plays.map((c) => c.c), 'Sticky: the first play, then into and out of Gamma per track').toEqual([213, 426, 213, 426, 213]);
  expect(st.plan.retunes).toBe(4);
  for (const k of [1, 3]) expect(plays[k + 1].t - plays[k].t, `Gamma held at least 30 s (track ${(k + 1) / 2})`).toBeGreaterThanOrEqual(30);
  // The band steps are the live app's (bandSchedule ticks App's AdaptiveBand: exportPlan.check): the same counts here.
  const want = await page.evaluate(async () => {
    const ep = await import('/utils/export/exportPlan.ts');
    const env = (() => { const n = 50 * 20, a = new Uint8Array(n); a.fill(250, 0, 16 * 20); return { fps: 20, sub: a, bass: a, mid: a, high: a }; })();
    const out = (mode: string) => {
      const len = 50 / ep.PSF;
      const one = ep.bandSchedule(env, 'beta', 'binaural', len, true, ep.PSF, mode as any);
      const two = ep.bandSchedule(env, one[one.length - 1].band, 'binaural', len, true, ep.PSF, mode as any);
      return [one.length - 1, two.length - 1];
    };
    return { smooth: out('smooth'), sticky: out('sticky') };
  });
  expect(sm.plan.segments.map((s: any) => s.bands), 'Smooth: the schedule’s steps').toEqual(want.smooth);
  expect(st.plan.segments.map((s: any) => s.bands), 'Sticky: the schedule’s steps').toEqual(want.sticky);
  // Fix round 1 (rev1 tests SF4): one file per track (engine.ts's track path), Sticky: into Gamma and out, held 30 s.
  const one = await run('sticky', { files: 'one' });
  test.info().annotations.push({ type: 'GA5 one file, Sticky: plays', description: JSON.stringify({ plays: one.calls.filter((c) => c.k === 'play'), retunes: one.plan?.retunes ?? null }) });
  expect([one.outcome, one.files], JSON.stringify(one.reason)).toEqual(['done', 1]);
  expect(one.spec.map((s: any) => s.gammaMode)).toEqual(['sticky']);
  const onePlays = one.calls.filter((c) => c.k === 'play');
  expect(onePlays.map((c) => c.c), 'one file, Sticky: the first play, then into and out of Gamma').toEqual([213, 426, 213]);
  expect(onePlays[2].t - onePlays[1].t, 'one file, Sticky: Gamma held at least 30 s').toBeGreaterThanOrEqual(30);
  expect(one.plan.retunes).toBe(2);
  // Fix round 1 (rev1 tests SF5): Adaptive off (Smooth chosen): v2's own pair at Beta, 213, one play and no retune.
  const off = await run('smooth', { files: 'one', snap: { adaptive: false } });
  test.info().annotations.push({ type: 'GA5 one file, Adaptive off: plays', description: JSON.stringify({ plays: off.calls.filter((c) => c.k === 'play'), retunes: off.plan?.retunes ?? null }) });
  expect([off.outcome, off.files], JSON.stringify(off.reason)).toEqual(['done', 1]);
  expect(off.spec.map((s: any) => [s.gammaMode, s.adaptiveOn])).toEqual([['smooth', false]]);
  expect(off.calls.filter((c) => c.k === 'play').map((c) => c.c), 'Adaptive off: one play, on v2’s own pair (213)').toEqual([213]);
  expect(off.plan.retunes, 'Adaptive off: no retune').toBe(0);
  // The carrier as live: Sticky picked first (saved), then tone-0003 (852, no band envelope, so no band step ever)
  // plays on v2's own pair (213) at its band, the Sticky file's first; back to Smooth, it retunes to Gamma's pair (426),
  // the Smooth file's: within 5 s (fix round 1, SF2), so a re-plan left to a band step would fail; and (fix round 2,
  // rev2 tests N5) exactly once: from the tap to 1.5 s after the gates reopen, one retune, one play, one carrier, 426.
  await openLayersTab(page);
  await layersJump(page, 'beat').click();
  await layersSection(page, 'beat').getByRole('group', { name: LEGEND }).getByText('Sticky', { exact: true }).click();
  await openLibraryTab(page);
  await libraryRowButton(page, 'tone-0003').click();
  await expect.poll(async () => (await layersState(page))?.sounding?.carrier_hz ?? 0, { message: 'Sticky: the live start is the file’s', timeout: 10_000, intervals: [100] }).toBe(st.plan.segments[0].carrierHz);
  await expect.poll(async () => (await layersState(page))?.phase ?? null, { message: 'Sticky: the live start’s gates open', timeout: 20_000, intervals: [200] }).toBe('open');
  await openLayersTab(page);
  await layersJump(page, 'beat').click();
  await spyPlays(page);
  const tSm = await page.evaluate(() => performance.now());
  await layersSection(page, 'beat').getByRole('group', { name: LEGEND }).getByText('Smooth', { exact: true }).click();
  await expect.poll(async () => (await layersState(page))?.sounding?.carrier_hz ?? 0, { message: 'Smooth: Gamma’s pair, the file’s', timeout: 5_000 }).toBe(sm.plan.segments[0].carrierHz);
  const liveLog = await retunedAfter(page, tSm, 'Sticky to Smooth live: the retune ends (the gates reopen)');
  test.info().annotations.push({ type: 'GA5 live, Sticky to Smooth', description: report(liveLog, tSm) });
  expect(sinceAct(liveLog, tSm), 'Sticky to Smooth live: exactly one retune, one play, to Gamma’s pair').toEqual({ retunes: 1, carriers: [sm.plan.segments[0].carrierHz], plays: [sm.plan.segments[0].carrierHz] });
});

// ---- Fix round 1 (rev1 tests SF1, SF3, the gaps; app N2) --------------------------------------------------------------

/** Beta's intensity all through (level 166: 0.65, between 0.55 and 0.75): Adaptive steps Alpha to Beta and stays. */
const AT_BETA = (total: number): Array<[number, number]> => [[166, total]];

/**
 * After an action at `t`: wait until the player's gates have opened again after it (a retune ended), then 1.5 s more,
 * and return the record. With no retune nothing opens after `t`, so this fails with `what`.
 */
async function retunedAfter(page: Page, t: number, what: string): Promise<Ev[]> {
  await expect.poll(async () => after(await events(page), t, 'phase').some((x) => x.text === 'open'), { message: what, timeout: 20_000, intervals: [200] }).toBe(true);
  await page.waitForTimeout(1500);
  return events(page);
}
/** What the player did after `t`: its retunes, the carriers it sounded, and the carriers of the plays it was given. */
const sinceAct = (log: Ev[], t: number) => ({
  retunes: after(log, t, 'phase').filter((x) => x.text === 'retuning').length,
  carriers: after(log, t, 'carrier').map((x) => x.v),
  plays: after(log, t, 'play').map((x) => x.v),
});

test('GA6. Smooth on 852 at Beta: switching Adaptive off retunes once, to v2’s own pair (213); on again, once, back to Gamma’s (426)', async ({ page }) => {
  test.setTimeout(180_000);
  await record(page);
  await openSeeded(page, { layout: 'new', n: 1, seed: { real: 1, seconds: 90, patch: [{ index: 0, crystal: 852 }] }, envelopes: [{ index: 0, steps: AT_BETA(90) }] });
  await page.setViewportSize(PHONE_VIEWPORT);
  await spyPlays(page);
  const t0 = await playNew(page);
  await fromFirstOpen(page, t0);
  await expect.poll(async () => after(await events(page), t0, 'beat').map((x) => x.v).at(-1), { message: 'Adaptive steps to Beta', timeout: 20_000 }).toBe(20);
  expect(after(await events(page), t0, 'carrier').map((x) => x.v), 'Smooth at Beta: Gamma’s pair').toEqual([426]);
  await openLayersTab(page);
  await layersJump(page, 'beat').click();
  const adaptive = layersSection(page, 'beat').getByRole('switch', { name: 'Adaptive' });
  // Off: v2's own pair at Beta (the band stays).
  const tOff = await page.evaluate(() => performance.now());
  await adaptive.click();
  await expect(adaptive).toHaveAttribute('aria-checked', 'false');
  const offLog = await retunedAfter(page, tOff, 'Adaptive off: a retune, to v2’s own pair');
  test.info().annotations.push({ type: 'GA6 Adaptive off', description: report(offLog, tOff) });
  expect(sinceAct(offLog, tOff), 'Adaptive off: one retune, to 213').toEqual({ retunes: 1, carriers: [plan1683(852, 'beta').carrier_hz], plays: [213] });
  expect(after(offLog, tOff, 'beat'), 'the band stays Beta').toEqual([]);
  // On: Gamma's pair again.
  const tOn = await page.evaluate(() => performance.now());
  await adaptive.click();
  await expect(adaptive).toHaveAttribute('aria-checked', 'true');
  const onLog = await retunedAfter(page, tOn, 'Adaptive on: a retune, to Gamma’s pair');
  test.info().annotations.push({ type: 'GA6 Adaptive on', description: report(onLog, tOn) });
  expect(sinceAct(onLog, tOn), 'Adaptive on: one retune, to 426').toEqual({ retunes: 1, carriers: [plan1683(852, 'gamma').carrier_hz], plays: [426] });
});

test('GA7. Smooth on 852: a band tap (which turns Adaptive off) retunes once, to v2’s own pair for that band', async ({ page }) => {
  test.setTimeout(150_000);
  await record(page);
  await openSeeded(page, { layout: 'new', n: 1, seed: { real: 1, seconds: 60, patch: [{ index: 0, crystal: 852 }] }, envelopes: [] });
  await page.setViewportSize(PHONE_VIEWPORT);
  await spyPlays(page);
  const t0 = await playNew(page);
  await fromFirstOpen(page, t0);
  expect(after(await events(page), t0, 'carrier').map((x) => x.v), 'Smooth: Gamma’s pair').toEqual([426]);
  await openLayersTab(page);
  await layersJump(page, 'beat').click();
  const beat = layersSection(page, 'beat');
  const tTap = await page.evaluate(() => performance.now());
  await beat.getByText('Theta · 6 Hz', { exact: true }).click();
  await expect(beat.getByRole('radio', { name: /^Theta · 6 Hz/ })).toBeChecked();
  await expect(beat.getByRole('switch', { name: 'Adaptive' }), 'the tap turns Adaptive off').toHaveAttribute('aria-checked', 'false');
  const log = await retunedAfter(page, tTap, 'the band tap: a retune, to v2’s own pair');
  test.info().annotations.push({ type: 'GA7 the band tap', description: report(log, tTap) });
  const own = plan1683(852, 'theta').carrier_hz;
  expect(own, "v2's own pair at Theta").toBe(213);
  expect(sinceAct(log, tTap), 'the band tap: one retune, to Theta’s own pair').toEqual({ retunes: 1, carriers: [own], plays: [own] });
  expect(after(log, tTap, 'beat').map((x) => x.v), 'the beat is Theta’s').toEqual([6]);
});

test('GA3b. Smooth to Sticky mid-play at Gamma (the radio, the new layout): no retune at the switch, then Gamma holds at least 10 ticks before the step down, which retunes once to v2’s own pair', async ({ page }) => {
  test.setTimeout(240_000);
  await record(page);
  await openSeeded(page, { layout: 'new', n: 1, seed: { real: 1, seconds: 75, patch: [{ index: 0, crystal: 852 }] }, envelopes: [{ index: 0, steps: [[250, 22], [0, 53]] }] });
  await page.setViewportSize(PHONE_VIEWPORT);
  await spyPlays(page);
  const t0 = await playNew(page);
  await fromFirstOpen(page, t0);
  await openLayersTab(page);
  await layersJump(page, 'beat').click();
  const group = layersSection(page, 'beat').getByRole('group', { name: LEGEND });
  // Smooth reaches Gamma (beat 40) on Gamma's pair; then Sticky, by the radio, while Gamma plays.
  await expect.poll(async () => after(await events(page), t0, 'beat').map((x) => x.v).at(-1), { message: 'Adaptive reaches Gamma (Smooth)', timeout: 30_000, intervals: [200] }).toBe(40);
  const tSw = await page.evaluate(() => performance.now());
  await group.getByText('Sticky', { exact: true }).click();
  await expect(group.getByRole('radio', { name: /^Sticky/ })).toBeChecked();
  // The step down, then the retune to Beta's own pair.
  await expect.poll(async () => after(await events(page), tSw, 'beat').some((x) => x.v !== 40), { message: 'Gamma steps down', timeout: 75_000, intervals: [500] }).toBe(true);
  const down = after(await events(page), tSw, 'beat').find((x) => x.v !== 40)!;
  await expect.poll(async () => after(await events(page), tSw, 'carrier').map((x) => x.v).at(-1), { message: 'Beta’s own pair after the step', timeout: 15_000 }).toBe(213);
  await page.waitForTimeout(1500);
  const log = await events(page);
  test.info().annotations.push({ type: 'GA3b Smooth to Sticky at Gamma', description: report(log, tSw) });
  const arm = log.filter((x) => x.e === 'arm' && x.t < down.t).at(-1)!;
  const ticksAtGamma = log.filter((x) => x.e === 'tick' && x.id === arm.id && x.t > tSw && x.t < down.t).length;
  expect(ticksAtGamma, 'Sticky from the switch: Gamma holds at least 10 ticks (Smooth would step down after 2 quiet ones)').toBeGreaterThanOrEqual(10);
  expect(arm.t, 'the switch re-armed the adaptive band').toBeGreaterThan(tSw);
  const retunes = after(log, tSw, 'phase').filter((x) => x.text === 'retuning');
  expect(retunes.length, 'one retune: the step out (none at the switch: Gamma’s pair either way)').toBe(1);
  expect(retunes[0].t, 'the retune is the step out').toBeGreaterThan(down.t - 1000);
  expect(after(log, tSw, 'play').map((x) => x.v), 'one play: the step out, to 213').toEqual([213]);
});

// ---- Fix round 2 (rev2 tests SF1, N6): C1 under 'off', both ways in (Car, and the tone alone), and a tap that reaches Gamma

/** Log every LayerPlayer.setBeat() call (the beat App asks the player for: BANDS[planBand]) into the record as 'setBeat'. */
async function spyBeats(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const P = ((await import('/utils/soundV2/layerPlayer.ts')) as any).LayerPlayer.prototype;
    if (P.__gammaBeatSpied) return;
    P.__gammaBeatSpied = true;
    const setBeat = P.setBeat;
    P.setBeat = function (this: unknown, hz: number, ...a: unknown[]) {
      (window as any).__gammaLog.push({ t: performance.now(), e: 'setBeat', v: hz });
      return setBeat.call(this, hz, ...a);
    };
  });
}
/** Classic's Harmonic Control: a beat preset's row (the element its tap goes to), by its name and beat. */
const presetRow = (page: Page, name: string, hz: number) =>
  page.getByText(`${name} (${hz}Hz)`, { exact: true }).locator('xpath=ancestor::div[contains(@class,"cursor-pointer")][1]');
/** The selected row's look (classic: a blue border; the others' are slate). */
const SELECTED_ROW = /(^|\s)border-blue-500(\s|$)/;

/**
 * In classic's open Harmonic Control, layers sounding: tap the Gamma row; check that the tap reached Gamma, the preset
 * (its row is the selected one and no other is; App asks the player for Gamma's beat, 40 Hz, and nothing else) and
 * turned Adaptive off; then the record of the 3 s after the tap.
 */
async function tapGammaRow(page: Page): Promise<{ tTap: number; log: Ev[] }> {
  await spyBeats(page);
  const tTap = await page.evaluate(() => performance.now());
  await page.getByText('Gamma (40Hz)', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Adaptive OFF' }), 'the row click turns Adaptive off').toBeVisible();
  await expect(presetRow(page, 'Gamma', 40), 'the row click selected Gamma').toHaveClass(SELECTED_ROW);
  for (const [name, hz] of [['Delta', 2], ['Theta', 6], ['Alpha', 10], ['Beta', 20]] as const) {
    await expect(presetRow(page, name, hz), `${name} is not selected`).not.toHaveClass(SELECTED_ROW);
  }
  await expect.poll(async () => after(await events(page), tTap, 'setBeat').map((x) => x.v), { message: 'App asks the player for Gamma’s beat (40 Hz), once', timeout: 5_000 }).toEqual([40]);
  await page.waitForTimeout(3000);
  return { tTap, log: await events(page) };
}

test('GA8. Car on 852 in the classic layout, the music playing: a Gamma row tap selects Gamma and gives no new play() (as v16.8.3: the plan never moves under Car)', async ({ page }) => {
  test.setTimeout(150_000);
  await record(page);
  await openSeeded(page, { layout: 'classic', n: 1, output: 'car', seed: { real: 1, seconds: 60, patch: [{ index: 0, crystal: 852 }] }, envelopes: [] });
  await spyPlays(page);
  const t0 = await page.evaluate(() => performance.now());
  await page.getByRole('complementary').getByText('tone-0001', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await fromFirstOpen(page, t0);
  expect(after(await events(page), t0, 'play').length, 'the start played').toBeGreaterThanOrEqual(1);
  await openHarmonicControl(page);
  const { tTap, log } = await tapGammaRow(page);
  test.info().annotations.push({ type: 'GA8 Car, the Gamma row', description: report(log, t0) });
  expect(after(log, tTap, 'play').map((x) => x.v), 'no new play() under Car').toEqual([]);
  expect(after(log, tTap, 'phase').map((x) => x.text), 'no retune').toEqual([]);
});

test('GA8b. Tone only (the 852 tone alone, no music) on headphones in the classic layout: a Gamma row tap selects Gamma and gives no new play() (as v16.8.3: the plan never moves under tone only)', async ({ page }) => {
  test.setTimeout(150_000);
  await record(page);
  await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'headphones' });
  await openHarmonicControl(page);
  await spyPlays(page);
  const t0 = await page.evaluate(() => performance.now());
  await tapTraditional(page, 852);
  // Headphones render binaural with music; the tone alone renders 'off'.
  await expect.poll(async () => (await layersState(page))?.requested?.render ?? null, { message: 'the tone alone: the plan under off', timeout: 15_000 }).toBe('off');
  await expect.poll(async () => (await layersState(page))?.sounding?.tone_hz ?? null, { message: 'the 852 tone sounds', timeout: 15_000 }).toBe(852);
  await fromFirstOpen(page, t0);
  expect(after(await events(page), t0, 'play').length, 'the tone’s start played').toBeGreaterThanOrEqual(1);
  const { tTap, log } = await tapGammaRow(page);
  test.info().annotations.push({ type: 'GA8b tone only, the Gamma row', description: report(log, t0) });
  expect(after(log, tTap, 'play').map((x) => x.v), 'no new play() under tone only').toEqual([]);
  expect(after(log, tTap, 'phase').map((x) => x.text), 'no retune').toEqual([]);
  const st = await layersState(page);
  expect([st?.requested?.render, st?.sounding?.tone_hz], 'still the tone alone on 852').toEqual(['off', 852]);
});
