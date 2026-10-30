// utils/export/renderLayers.ts (v16.5, Export with layers; the addendum §3.3, engine (c); lazy: in the export chunk)
//
// The layers of a file, made by the app's OWN v2 player and Key fit duck, unchanged (utils/soundV2's LayerPlayer and
// KeyFitDuck), in an OfflineAudioContext at a quarter of the output rate, driven by a virtual clock through the calls
// App makes, in App's order: the duck's target, the host level, the gains, the plan, the beat; App's 0.25 s level tick
// (φ timing's envelope over each track, a track change's 1.5 s glide for 2 s); the adaptive band's steps (a retune
// when "binaural gamma or not" changes, else a τ 3 s beat glide); at the end the layers fade to 0 over 2 s.
// Everything is scheduled before startRendering(), so there is one render pass and no suspend(); the player's mirrors
// only ever see increasing times. One segment is one track; a long file (decision 2 B) is several, rendered as ONE
// continuous player: the layers carry on across the joins (a new crystal is a retune through silence, as live).
// v16.5 review:
//   - B3: the engine renders WITHOUT the end fade (endFade false) and fades the layers in the mix, anchored to the
//     file's real last frame (a long file's planned end, from the tracks' lengths before their decodes, was off by
//     a second: every long file ended with the layers at about half their level);
//   - B9: the player's timer is a virtual one, ticked once a minute after the first hour as the clock moves, so the
//     drone's duty cycle is extended past its 2 h horizon as the live player's own timer does (a long file over 2 h
//     lost it); the live player is unchanged;
//   - B11: at a long file's join the duck's rise is held as App holds it (keyFitHold: the player's own holds and the
//     track change's 2 s glide), and a fall with both gates shut lands at once;
//   - B18: the record says the rate the layers were rendered at.

import { LayerPlayer, DUTY_HORIZON_S, DUTY_EXTEND_BELOW_S } from '../soundV2/layerPlayer';
import { KeyFitDuck, DUCK_TAU_S, riseHold, trackHold, gatesSilent } from '../soundV2/keyFit';
import { plan as v2Plan, BANDS, phiEnvelope } from '../soundV2/aetheria_sound_v2';
import type { Band, Plan } from '../soundV2/aetheria_sound_v2';
import { capBand } from '../soundV2/layerHost';
import type { BeatRender } from '../soundV2/layerHost';
import { END_FADE_S, HOST_STEP_S, LAYER_RATE } from './exportPlan';
import type { ExportSpec } from './exportPlan';

export interface LayerSegment {
  spec: ExportSpec;
  /** Where the track starts in the file (output seconds), and its length. */
  startS: number;
  durS: number;
  /** Its band steps (bandSchedule), times relative to its start. */
  bands: Array<{ t: number; band: Band }>;
}

export interface LayerPlanRecord {
  /** Per segment: the plan's tone / carrier / drone (Hz), the duck, the band steps. */
  segments: Array<{ toneHz: number; carrierHz: number; droneHz: number; duckDb: number; bands: number; layers: boolean }>;
  hostSteps: number;
  calls: number;
  /** v16.5 review (B18): the rate the layers were rendered at (LAYER_RATE: 12,000 Hz), 0 before a render. */
  rate: number;
  /** v16.5 review (B9): the player's timer ticks (each after the first hour, once a minute). */
  ticks: number;
}

/** v16.5 review (B9): the virtual timer ticks from here (the duty is pre-scheduled DUTY_HORIZON_S ahead and extended
 *  when less than DUTY_EXTEND_BELOW_S is left), once a minute. */
export const TICK_FROM_S = DUTY_HORIZON_S - DUTY_EXTEND_BELOW_S;
export const TICK_EVERY_S = 60;

const planBandOf = (b: Band, render: BeatRender): Band => (render === 'pulse' ? capBand(b, 'alpha') : b);

function planFor(spec: ExportSpec, band: Band): Plan | null {
  if (!spec.layers) return null;
  return v2Plan(spec.f, spec.planOutput, spec.render === 'binaural' ? 'binaural' : 'monaural', BANDS[planBandOf(band, spec.render)]);
}

const sameVoice = (a: ExportSpec, b: ExportSpec): boolean => a.layers === b.layers && a.f === b.f && a.render === b.render && a.planOutput === b.planOutput;

/** The calls, in time order, on a player and duck whose clock is the virtual time set by `at`. `tick` runs the
 *  player's timer at a time (B9); without the end fade (B3) the layers play to totalS at their level. */
export function driveLayers(
  segs: LayerSegment[], totalS: number, player: LayerPlayer, duck: KeyFitDuck, at: (t: number) => void,
  o: { endFade?: boolean; tick?: ((t: number) => void) | null } = {},
): LayerPlanRecord {
  const rec: LayerPlanRecord = { segments: [], hostSteps: 0, calls: 0, rate: 0, ticks: 0 };
  if (!segs.length) return rec;
  const endFade = o.endFade !== false;
  const fadeAt = endFade ? Math.max(0, totalS - END_FADE_S) : totalS;
  let lastTick = -Infinity;
  const segAt = (t: number): number => {
    let k = 0;
    while (k + 1 < segs.length && segs[k + 1].startS <= t + 1e-9) k++;
    return k;
  };
  const host = (t: number): number => {
    const s = segs[segAt(t)];
    if (!s.spec.layers) return 0;
    return s.spec.phi ? phiEnvelope(Math.max(0, t - s.startS), s.durS) : 1;
  };
  const gamma = (spec: ExportSpec, band: Band) => spec.render === 'binaural' && planBandOf(band, spec.render) === 'gamma';
  for (const s of segs) {
    const p = planFor(s.spec, s.bands[0]?.band ?? s.spec.startBand);
    rec.segments.push({ toneHz: p?.tone_hz ?? 0, carrierHz: p?.carrier_hz ?? 0, droneHz: p?.drone_hz ?? 0, duckDb: s.spec.duckDb, bands: Math.max(0, s.bands.length - 1), layers: s.spec.layers });
  }

  // t = 0: App's first play (the plan effect, then the beat effect).
  at(0);
  let cur = 0;
  let spec = segs[0].spec;
  let band = segs[0].bands[0]?.band ?? spec.startBand;
  let isGamma = gamma(spec, band);
  duck.setTarget(spec.duckDb, { tauS: DUCK_TAU_S, silent: true });
  player.setHostLevel(host(0));
  player.setLayerGains(spec.gains);
  player.play(planFor(spec, band), spec.render, true);
  player.setBeat(BANDS[planBandOf(band, spec.render)]);
  rec.calls += 5;

  // Every event, in time order: band steps (absolute), track boundaries, the level ticks.
  const steps: Array<{ t: number; seg: number; band: Band }> = [];
  segs.forEach((s, k) => s.bands.slice(1).forEach((b) => steps.push({ t: s.startS + b.t, seg: k, band: b.band })));
  steps.sort((a, b) => a.t - b.t);
  let si = 0;
  let glideUntil = -1;
  for (let k = 1; ; k++) {
    const t = k * HOST_STEP_S;
    // Track boundaries before this tick (a long file).
    while (cur + 1 < segs.length && segs[cur + 1].startS <= t && segs[cur + 1].startS < fadeAt) {
      cur++;
      const next = segs[cur];
      at(next.startS);
      const prevSpec = spec;
      spec = next.spec;
      // The band carries over (App's preset state), unless the new track starts elsewhere.
      band = next.bands[0]?.band ?? band;
      if (!sameVoice(prevSpec, spec)) {
        player.setHostLevel(host(next.startS), { glideS: 1.5 });
        player.setLayerGains(spec.gains);
        player.play(planFor(spec, band), spec.render, true);
        rec.calls += 3;
        isGamma = gamma(spec, band);
      } else if (JSON.stringify(prevSpec.gains) !== JSON.stringify(spec.gains)) {
        player.setLayerGains(spec.gains);
        rec.calls++;
      }
      player.setBeat(BANDS[planBandOf(band, spec.render)]);
      // B11: App's fit effect at a track change: a rise waits for the player's own holds and the track's 2 s glide
      // (keyFitHold: riseHold with trackHold from the change); a fall with both gates shut lands at once.
      const st = player.state();
      duck.setTarget(spec.duckDb, { tauS: DUCK_TAU_S, holdRiseUntil: riseHold(st, trackHold(next.startS, next.startS, 2)), silent: gatesSilent(st) });
      rec.calls += 2;
      glideUntil = next.startS + 2;
    }
    // Band steps before this tick.
    while (si < steps.length && steps[si].t <= t && steps[si].t < fadeAt) {
      const st = steps[si++];
      if (st.seg !== cur) continue;
      at(st.t);
      band = st.band;
      const g = gamma(spec, band);
      if (g !== isGamma) {
        isGamma = g;
        player.setHostLevel(host(st.t));
        player.setLayerGains(spec.gains);
        player.play(planFor(spec, band), spec.render, true);
        rec.calls += 3;
      }
      player.setBeat(BANDS[planBandOf(band, spec.render)]);
      rec.calls++;
    }
    if (t >= fadeAt) {
      if (endFade) {
        at(fadeAt);
        player.setHostLevel(0, { glideS: Math.max(0.05, Math.min(END_FADE_S, totalS - fadeAt || END_FADE_S)) });
        rec.calls++;
      }
      break;
    }
    at(t);
    player.setHostLevel(host(t), t < glideUntil ? { glideS: 1.5 } : undefined);
    rec.calls++;
    rec.hostSteps++;
    if (o.tick && t >= TICK_FROM_S && t - lastTick >= TICK_EVERY_S) {
      lastTick = t;
      o.tick(t);
      rec.ticks++;
    }
  }
  return rec;
}

/**
 * The layers' schedule on `ctx` (an OfflineAudioContext): the app's own LayerPlayer and KeyFitDuck on a virtual clock,
 * with a virtual timer the player arms as it arms the live one (B9: driveLayers runs it as the clock moves, so the
 * drone's duty is extended past its 2 h horizon), every call scheduled by driveLayers. Nothing is rendered here.
 */
export function scheduleLayers(
  ctx: BaseAudioContext, segs: LayerSegment[], totalS: number, o: { endFade?: boolean } = {},
): { player: LayerPlayer; duck: KeyFitDuck; rec: LayerPlanRecord } {
  let vt = 0;
  const clock = () => vt;
  const warn = (m: string) => console.warn(m);
  const duck = new KeyFitDuck(ctx, ctx.destination, { clock, warn });
  let timerFn: (() => void) | null = null;
  const timer = {
    set: (fn: () => void): unknown => {
      timerFn = fn;
      return 1;
    },
    clear: (): void => {
      timerFn = null;
    },
  };
  const player = new LayerPlayer(ctx, duck.input, { clock, timer, warn });
  try {
    const rec = driveLayers(
      segs,
      totalS,
      player,
      duck,
      (t) => {
        vt = t;
      },
      {
        endFade: o.endFade,
        tick: (t) => {
          vt = t;
          timerFn?.();
        },
      },
    );
    return { player, duck, rec };
  } catch (e) {
    try { player.dispose(); } catch {}
    try { duck.dispose(); } catch {}
    throw e;
  }
}

/** Render the layers for `totalS` output seconds at `rate` (the quarter rate by default). endFade false: no fade at the
 *  end (the engine fades them in the mix, at the file's real end: B3). */
export async function renderLayers(
  segs: LayerSegment[], totalS: number, rate: number = LAYER_RATE, o: { endFade?: boolean } = {},
): Promise<{ buf: AudioBuffer; rec: LayerPlanRecord; scheduleMs: number; renderMs: number }> {
  const frames = Math.ceil(totalS * rate) + 64;
  const ctx = new OfflineAudioContext(2, frames, rate);
  const t0 = performance.now();
  const { player, duck, rec } = scheduleLayers(ctx, segs, totalS, o);
  rec.rate = rate;
  const t1 = performance.now();
  const buf = await ctx.startRendering();
  const t2 = performance.now();
  try { player.dispose(); } catch {}
  try { duck.dispose(); } catch {}
  return { buf, rec, scheduleMs: t1 - t0, renderMs: t2 - t1 };
}
