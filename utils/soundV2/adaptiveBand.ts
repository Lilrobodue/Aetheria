// utils/soundV2/adaptiveBand.ts (v16.8.4 "Adaptive gamma")
//
// v2's Adaptive band on headphones reaches Gamma (40 Hz), as classic sound's Adaptive always has; the pulse (speakers,
// the phone speaker) stays capped at Alpha (the user's decision 6) and Car has no beat. On 11 of the 33 crystal tones
// the vendored plan() moves the beat pair up an octave for Gamma (its carrier rule: L = max(200, 10 × beat)), and a
// carrier move is a retune through the player's designed fade. The user chose to offer both ways of handling that, as
// the setting "Gamma in Adaptive":
//   - Smooth (the default): while Adaptive is on, on headphones, every band plays on Gamma's carrier (only the beat and
//     the partner follow the band), so a band step is only ever a glide;
//   - Sticky: v2's own pair for each band (a manual band's plan exactly), so those tones fade at Gamma's start and end,
//     and once reached, Gamma holds for at least GAMMA_HOLD_TICKS ticks (30 s at the 3 s tick).
// The live app (App's adaptive and plan effects) and Export with layers (bandSchedule, renderLayers' planFor) both go
// through this module, so a file's band steps and fades are what the live app plays. The list of the 11 tones is never
// written down here: adaptiveBand.check.ts derives it from plan() (npm run check:sound).
//
// Pure: no DOM, no React, no App imports. Erasable TypeScript only (type imports use `import type`), so Node runs the
// check directly. The vendored aetheria_sound_v2.ts is used as it is, never edited.

import type { Band, Plan } from './aetheria_sound_v2.ts';
import { BANDS, bandForIntensity, plan } from './aetheria_sound_v2.ts';
import type { BeatRender } from './layerHost.ts';
import { BandHysteresis, capBand } from './layerHost.ts';

export type GammaMode = 'smooth' | 'sticky';

/** The saved choice, written only from its radio (a tap), never from an effect: unset = the default. */
export const KEY_ADAPTIVE_GAMMA = 'aetheria.adaptiveGamma.v1';
export const DEFAULT_GAMMA_MODE: GammaMode = 'smooth';
/** Sticky: the ticks Gamma is counted before a downward step may count (10 × 3 s = 30 s). */
export const GAMMA_HOLD_TICKS = 10;

/** A stored choice: exactly 'smooth' or 'sticky'; anything else (unset, another case, padding, a number) the default. */
export function parseGammaMode(raw: unknown): GammaMode {
  return raw === 'smooth' || raw === 'sticky' ? raw : DEFAULT_GAMMA_MODE;
}

/** The highest band Adaptive steps to for a render: Gamma for the binaural pair, Alpha for the pulse (decision 6),
 *  null with no beat (Car, tone only: no adaptive band at all). */
export function adaptiveCap(render: BeatRender): Band | null {
  return render === 'binaural' ? 'gamma' : render === 'pulse' ? 'alpha' : null;
}

/**
 * The adaptive band's 3 s tick, for one arming of App's loop (or one track of an export): the target is the track's
 * intensity's band, capped for the render; the step is BandHysteresis's (two agreeing ticks, one band a step).
 *
 * Sticky's hold: while the current band is Gamma, the ticks there are counted (from the step into Gamma, or from
 * construction: a new track or a resume holds again), and until GAMMA_HOLD_TICKS have been counted every tick is
 * refused and resets the hysteresis. So the first downward tick that counts is the 10th at Gamma (30 s after the step
 * in) and the step down comes, as usual, on the second agreeing tick: the 11th at the earliest. The hold applies on
 * every tone (the setting means one thing everywhere), and only where Gamma is reachable (the binaural render): a
 * Gamma left over from headphones when the output moves to the pulse (capped at Alpha at once in the plan) steps down
 * as in v16.8.3. Smooth has no hold.
 */
export class AdaptiveBand {
  readonly mode: GammaMode;
  readonly cap: Band | null;
  /** The band in effect at construction (a Gamma start holds again: the count starts at 0 here whatever the band, and
   *  it only runs while the band is Gamma, restarting from 0 whenever it isn't). */
  readonly startBand: Band;
  private readonly hyst = new BandHysteresis();
  private readonly hold: boolean;
  /** Ticks counted at Gamma since the band stepped into it, or since construction. */
  private atGamma = 0;

  constructor(mode: GammaMode, render: BeatRender, startBand: Band) {
    this.mode = parseGammaMode(mode);
    this.cap = adaptiveCap(render);
    this.startBand = startBand;
    this.hold = this.mode === 'sticky' && this.cap === 'gamma';
  }

  /** The band to step to now, or null. `intensity` is readIntensity's (0..1) at the tick; `current` the band in effect. */
  tick(intensity: number, current: Band): Band | null {
    if (this.cap === null) return null;
    if (this.hold && current === 'gamma') {
      this.atGamma++;
      if (this.atGamma < GAMMA_HOLD_TICKS) {
        this.hyst.reset();
        return null;
      }
    } else {
      this.atGamma = 0;
    }
    return this.hyst.tick(capBand(bandForIntensity(intensity), this.cap), current);
  }
}

/**
 * The plan the player gets for crystal tone f at `band` (App's planBand: already capped at Alpha for the pulse).
 * Smooth, with Adaptive on and the binaural render: the band's own plan with Gamma's carrier, the partner that carrier
 * plus the band's beat (every other field is the band's plan's; on 22 of the 33 tones the carrier is the same anyway).
 * Otherwise exactly today's call, plan(f, planOutput, binaural or monaural, BANDS[band]): a manual band, Sticky, the
 * pulse and tone only are v16.8.3's plans, field for field.
 */
export function adaptivePlan(f: number, planOutput: string, band: Band, mode: GammaMode, adaptive: boolean, render: BeatRender): Plan | null {
  const p = plan(f, planOutput, render === 'binaural' ? 'binaural' : 'monaural', BANDS[band]);
  if (!p || parseGammaMode(mode) !== 'smooth' || adaptive !== true || render !== 'binaural') return p;
  const g = plan(f, planOutput, 'binaural', BANDS.gamma);
  if (!g) return p;
  return { ...p, carrier_hz: g.carrier_hz, partner_hz: g.carrier_hz + p.beat_hz };
}
