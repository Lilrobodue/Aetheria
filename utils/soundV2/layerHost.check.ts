// Checks for utils/soundV2/layerHost.ts (spec §7.2), plus the vendored-plan facts App relies on (§2.3).
// Run with: node utils/soundV2/layerHost.check.ts   (Node 22.18+ strips the types), or npm run check:sound
// Exits non-zero on any failure.
//
// The load-bearing checks: a selected frequency resolves to its crystal first,
// so a Lo Shu toggle re-plans the layers (519 → 528 without Perfect); tone-only
// follows the volume with no duck (music not playing); the hysteresis agrees
// by direction; and every helper that runs during App's render is total —
// App has no error boundary, so a throw there unmounts the root and the pinned
// unmount cleanup stops the music (I10). The §10 copy helpers
// (components/layers/layerCopy.ts) are checked here too: the exact §11
// strings, and the same totality.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_BOOST,
  DEFAULT_LAYER_ENGINE,
  DEFAULT_DRONE_ENABLED,
  KEY_LAYER_ENGINE,
  KEY_LAYER_OUTPUT,
  KEY_LAYER_OUTPUT_ASK_AGAIN,
  KEY_DRONE_ENABLED,
  TONE_SLIDER_DEFAULT,
  BEAT_SLIDER_DEFAULT,
  V2_TONE_SLIDER_MAX,
  V2_TONE_SLIDER_STEP,
  V2_BEAT_SLIDER_MAX,
  CLASSIC_TONE_SLIDER_MAX,
  KEY_TONE_LEVEL_V2,
  KEY_TONE_LEVEL_CLASSIC,
  V2_TONE_LEVEL_DEFAULT,
  CLASSIC_TONE_LEVEL_DEFAULT,
  TONE_REF_DB,
  BEAT_REF_DB,
  DRONE_REF_DB,
  NON_CANONICAL_EXCEPTIONS,
  parseLayerEngine,
  parseLayerOutput,
  parseOutputAskAgain,
  parseDroneEnabled,
  toneLevelKey,
  defaultToneLevel,
  parseToneLevel,
  crystalIdOf,
  canonicalLayerHz,
  renderForOutput,
  planOutputFor,
  bandOfPresetName,
  capBand,
  sliderGain,
  gainToDb,
  formatDb,
  readIntensity,
  BandHysteresis,
  musicGainFactor,
} from './layerHost.ts';
import type { LayerOutput } from './layerHost.ts';
import { MAX_BOOST as SCHEDULE_MAX_BOOST } from './layerSchedule.ts';
import {
  plan,
  toneOf,
  frequencyOf,
  phiEnvelope,
  SOLFEGGIO,
  PERFECT_GUT,
  HEART,
  HEAD,
  CANONICAL_HZ,
  BANDS,
  BAND_ORDER,
  LEVEL_TONE,
  LEVEL_BEAT,
  LEVEL_DRONE_SUB,
} from './aetheria_sound_v2.ts';
import type { Band } from './aetheria_sound_v2.ts';
import type { LayerPlayerState } from './layerPlayer.ts';
import * as copy from '../../components/layers/layerCopy.ts';
import type { LayerStatus } from '../../components/layers/layerCopy.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;
const MINUS = '\u2212';
const DASH = '\u2014';

/** Run fn with console.warn captured; returns what it warned. */
function warnsOf(fn: () => void): string[] {
  const seen: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    seen.push(args.map(String).join(' '));
  };
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return seen;
}

// ------------------------------------------------------------ constants --
check(DEFAULT_LAYER_ENGINE === 'v2' && DEFAULT_DRONE_ENABLED === true, 'v2 (since v15.0) and the drone on are the release defaults');
check(KEY_LAYER_ENGINE === 'aetheria.layerEngine.v1' && KEY_LAYER_OUTPUT === 'aetheria.layerOutput.v1'
  && KEY_DRONE_ENABLED === 'aetheria.droneEnabled.v1', 'the three storage keys');
check(KEY_LAYER_OUTPUT_ASK_AGAIN === 'aetheria.layerOutputAskAgain.v1', 'a pending "Ask me again" has its own key: the saved output stays beside it');
check(TONE_SLIDER_DEFAULT === 0.01 && BEAT_SLIDER_DEFAULT === 0.03, "0 dB on the v2 sliders is classic's default, 1 % and 3 %");
check(V2_TONE_SLIDER_MAX === 0.04 && V2_TONE_SLIDER_STEP === 0.0005 && V2_BEAT_SLIDER_MAX === 0.12 && CLASSIC_TONE_SLIDER_MAX === 1,
  'the slider ranges (v2 tone and beat, classic tone)');

// --------------------------------------------- the tone level, per engine (v15.0) --
check(KEY_TONE_LEVEL_V2 === 'aetheria.toneLevelV2.v1' && KEY_TONE_LEVEL_CLASSIC === 'aetheria.toneLevelClassic.v1'
  && toneLevelKey('v2') === KEY_TONE_LEVEL_V2 && toneLevelKey('classic') === KEY_TONE_LEVEL_CLASSIC, 'one tone level key per engine');
check(V2_TONE_LEVEL_DEFAULT === V2_TONE_SLIDER_STEP && V2_TONE_LEVEL_DEFAULT === 0.0005 && defaultToneLevel('v2') === 0.0005,
  "v2's tone level default is the slider's lowest step before off (0.0005)");
check(CLASSIC_TONE_LEVEL_DEFAULT === 0.01 && defaultToneLevel('classic') === 0.01, "classic's tone level default stays its 1 %");
check(near(gainToDb(sliderGain(V2_TONE_LEVEL_DEFAULT, TONE_SLIDER_DEFAULT))!, -26.0206, 1e-4),
  "v2's default plays 26.02 dB under the validated level (0 dB stays at the 1 % reference)");
check(parseToneLevel('0.002', 'v2') === 0.002 && parseToneLevel('0', 'v2') === 0 && parseToneLevel('0.04', 'v2') === 0.04
  && parseToneLevel('0.0005', 'v2') === 0.0005, 'parseToneLevel, v2: a saved slider value, 0 (off) to 0.04');
check(parseToneLevel('0.05', 'classic') === 0.05 && parseToneLevel('1', 'classic') === 1 && parseToneLevel('0', 'classic') === 0,
  'parseToneLevel, classic: a saved slider value, 0 to 1');
check(parseToneLevel('0.0405', 'v2') === null && parseToneLevel('0.5', 'v2') === null && parseToneLevel('1.01', 'classic') === null
  && parseToneLevel('-0.001', 'v2') === null, "parseToneLevel: off the engine's slider is unset");
check([null, '', ' ', 'abc', 'NaN', 'Infinity', '-Infinity', '0.01x'].every((r) => parseToneLevel(r, 'v2') === null && parseToneLevel(r, 'classic') === null),
  'parseToneLevel: missing, empty or not a number is unset');
check(TONE_REF_DB === -26 && BEAT_REF_DB === -23 && DRONE_REF_DB === -24, 'the display reference levels');
check(near(20 * Math.log10(LEVEL_TONE), TONE_REF_DB, 0.01) && near(20 * Math.log10(LEVEL_BEAT), BEAT_REF_DB, 0.01)
  && near(20 * Math.log10(LEVEL_DRONE_SUB), DRONE_REF_DB, 0.01), 'and they are the vendored levels in dB');
check(NON_CANONICAL_EXCEPTIONS.length === 1 && NON_CANONICAL_EXCEPTIONS[0] === 111, '111 Hz is the one non-canonical exception');
check(MAX_BOOST === SCHEDULE_MAX_BOOST && near(MAX_BOOST, 3.981071705534972, 1e-12), 'one +12 dB cap, shared with the player');

// ---------------------------------------------------------- parse helpers --
check(parseLayerEngine('classic') === 'classic' && parseLayerEngine('v2') === 'v2', 'parseLayerEngine: the two engines');
check(parseLayerEngine(null) === null && parseLayerEngine('V2') === null && parseLayerEngine(' v2') === null && parseLayerEngine('') === null,
  'parseLayerEngine: anything else is unset');
for (const o of ['headphones', 'speakers', 'phone', 'car']) check(parseLayerOutput(o) === o, `parseLayerOutput: ${o}`);
check(parseLayerOutput(null) === null && parseLayerOutput('assumed') === null && parseLayerOutput('Car') === null,
  'parseLayerOutput: anything else is unanswered');
check(parseOutputAskAgain('1') === true, "parseOutputAskAgain: '1' is a pending question");
check([null, '', '0', ' 1', '01', 'true', 'car'].every((r) => parseOutputAskAgain(r) === false), 'parseOutputAskAgain: anything else is none');
check(parseDroneEnabled('true') === true && parseDroneEnabled('false') === false, 'parseDroneEnabled: true and false');
check(parseDroneEnabled(null) === null && parseDroneEnabled('1') === null && parseDroneEnabled('TRUE') === null,
  'parseDroneEnabled: anything else is unset');

// ------------------------------------------------------ canonical layers --
{
  const crystals = [...SOLFEGGIO, ...HEART, ...HEAD];
  let ok = true;
  for (let i = 0; i < 27; i++) {
    const id = 'c' + String(i + 1).padStart(2, '0');
    const s = canonicalLayerHz(crystals[i], false), p = canonicalLayerHz(crystals[i], true);
    if (s.id !== id || !s.canonical || s.f !== frequencyOf(id)) ok = false;
    if (p.id !== id || !p.canonical || p.f !== frequencyOf(id, 'perfect')) ok = false;
    if (crystalIdOf(crystals[i]) !== id) ok = false;
  }
  check(ok, 'the 27 raw crystal frequencies resolve to c01..c27 and read on both scales');
  let ok6 = true;
  for (let i = 0; i < 6; i++) {
    const id = 'c0' + (i + 1);
    const s = canonicalLayerHz(PERFECT_GUT[i], false), p = canonicalLayerHz(PERFECT_GUT[i], true);
    if (s.id !== id || s.f !== SOLFEGGIO[i] || p.id !== id || p.f !== PERFECT_GUT[i]) ok6 = false;
  }
  check(ok6, 'the 6 Lo Shu Perfect values resolve to c01..c06 and read on both scales');
  check(canonicalLayerHz(528, true).f === 519, '528 with Perfect GUT plays 519');
  check(canonicalLayerHz(519, false).f === 528, '519 without Perfect GUT plays 528 (the crystal first: a toggle re-plans)');
  check(canonicalLayerHz(741, false).f === 741 && canonicalLayerHz(741, true).f === 741, '741 is the same on both scales');
  check(canonicalLayerHz(2178, false).f === 2178 && canonicalLayerHz(2178, true).f === 2178 && canonicalLayerHz(2178, true).id === 'c14',
    'HEART 2178 is c14 on both scales');
  check(canonicalLayerHz(75, false).f === 174 && canonicalLayerHz(75, true).f === 75, '75 without Perfect GUT plays 174');
  const c111 = canonicalLayerHz(111, true);
  check(c111.f === 111 && c111.id === null && c111.canonical === false, '111 plays as itself, non-canonical');
  // Anything else plays nothing, with one warning per distinct value.
  for (const bad of [999, 0, NaN]) {
    const w = warnsOf(() => {
      const a = canonicalLayerHz(bad, false), b = canonicalLayerHz(bad, true);
      check(a.f === 0 && a.id === null && !a.canonical && b.f === 0, `${bad} Hz: f 0, not canonical`);
    });
    check(w.length === 1, `${bad} Hz: warned once (${w.length})`);
  }
  check(warnsOf(() => canonicalLayerHz(999, false)).length === 0, 'a value already warned about stays quiet');
  check(crystalIdOf(Infinity) === null && crystalIdOf(-528) === null && crystalIdOf(528.0000001) === 'c05', 'crystalIdOf edge values');
  check(warnsOf(() => check(canonicalLayerHz(111, false).f === 111, '111 again')).length === 0, '111 never warns');
}

// ----------------------------------------- vendored-plan facts (§2.3) --
{
  const p528 = plan(528, 'headphones', 'binaural', 10)!;
  check(p528.tone_hz === 528 && p528.carrier_hz === 264 && p528.partner_hz === 274 && p528.drone_hz === 33
    && p528.pulse_hz === 8.25 && p528.drone_sub === true, '528 on headphones: tone 528, carrier 264, partner 274, drone 33, pulse 8.25');
  check(p528.level_tone === 0.0501 && p528.level_beat === 0.0708 && p528.level_drone === 0.0631, '528: the validated levels');
  check(near(p528.level_tone * 0.8, 0.04008) && near(p528.level_beat * 0.8, 0.05664) && near(p528.level_drone * 0.8, 0.05048),
    'at volume 0.8: tone 0.04008, beat 0.05664 per ear, drone 0.05048');
  const p111 = plan(111, 'headphones', 'binaural', 10)!;
  check(p111.tone_hz === 222 && p111.carrier_hz === 444 && p111.partner_hz === 454 && p111.drone_hz === 27.75 && p111.pulse_hz === 6.9375,
    '111: tone 222, carrier 444, partner 454, drone 27.75, pulse 6.9375 (octaves)');
  const p174 = plan(174, 'headphones', 'binaural', 40)!;
  check(p174.carrier_hz === 696 && p174.partner_hz === 736, '174 at gamma: carrier 696, partner 736 (LG-05)');
  check(CANONICAL_HZ.length === 33 && CANONICAL_HZ.every((f) => toneOf(f, 'speakers') === toneOf(f, 'headphones')),
    'toneOf speakers = headphones for all 33 (the car plans as speakers)');
  // The carrier holds for delta..beta and moves at gamma for exactly 11 of the 33.
  const moving: number[] = [];
  let steady = true;
  for (const f of CANONICAL_HZ) {
    const c = (b: Band) => plan(f, 'headphones', 'binaural', BANDS[b])!.carrier_hz;
    if (c('delta') !== c('alpha') || c('theta') !== c('alpha') || c('beta') !== c('alpha')) steady = false;
    if (c('gamma') !== c('alpha')) moving.push(f);
  }
  check(steady, 'the carrier is the same at 2, 6, 10 and 20 Hz for all 33');
  check(moving.join(',') === '75,174,186,408,417,852,963,1692,1935,3504,3858', `gamma moves the carrier for exactly these 11 (${moving.join(',')})`);
  // Off headphones: no sub drone; speakers and phone differ only for 75, 174, 186.
  const spk528 = plan(528, 'speakers', 'monaural', 10)!, ph528 = plan(528, 'phone', 'monaural', 10)!;
  check(!spk528.drone_sub && spk528.drone_hz === 132 && !ph528.drone_sub && ph528.drone_hz === 0,
    '528: an audible 132 Hz drone in the speakers plan (never played by v2), none on the phone');
  const differ = CANONICAL_HZ.filter((f) => {
    const s = plan(f, 'speakers', 'monaural', 10)!, p = plan(f, 'phone', 'monaural', 10)!;
    return s.tone_hz !== p.tone_hz || s.carrier_hz !== p.carrier_hz;
  });
  check(differ.join(',') === '75,174,186', `speakers and phone differ in tone/carrier only for 75, 174, 186 (${differ.join(',')})`);
  const ph174 = plan(174, 'phone', 'monaural', 10)!;
  check(ph174.tone_hz === 348 && ph174.carrier_hz === 696, '174 on the phone: tone 348, carrier 696');
  check(plan(396, 'headphones', 'binaural', 10)!.drone_hz === 49.5 && plan(6336, 'headphones', 'binaural', 10)!.drone_hz === 49.5,
    'c03 (396) and c27 (6336) share the 49.5 Hz drone');
  const tones = CANONICAL_HZ.map((f) => toneOf(f, 'headphones'));
  const drones = CANONICAL_HZ.map((f) => plan(f, 'headphones', 'binaural', 10)!.drone_hz);
  check(Math.min(...tones) === 150 && Math.max(...tones) === 967.5 && Math.min(...drones) === 25.5 && Math.max(...drones) === 49.5,
    'tones span 150-967.5 Hz and drones 25.5-49.5 Hz');
  check(Number.isNaN(phiEnvelope(10, NaN)) && phiEnvelope(10, Infinity) === 0 && phiEnvelope(10, 0) === 1,
    'phiEnvelope: duration NaN → NaN, Infinity → 0 (why App holds the last value), 0 → 1');
  check(near(phiEnvelope(5, 240), 0.00723, 5e-6) && near(phiEnvelope(24, 240), 0.0915, 5e-5), 'phiEnvelope (5, 240) 0.00723, (24, 240) 0.0915');
  check(near(phiEnvelope(0.381966 * 240, 240), 0.8, 1e-5) && near(phiEnvelope(0.618034 * 240, 240), 1, 1e-5)
    && near(phiEnvelope(240, 240), 0.802, 5e-4), 'phiEnvelope: 0.8 at 38.2 %, 1 at 61.8 %, 0.802 at the end');
  check(frequencyOf('c05', 'perfect') === 519 && frequencyOf('c05') === 528, "frequencyOf('c05'): 528, 519 on the Perfect scale");
}

// --------------------------------------------------------------- outputs --
check(renderForOutput('headphones') === 'binaural' && renderForOutput('speakers') === 'pulse' && renderForOutput('phone') === 'pulse'
  && renderForOutput('car') === 'off', 'renderForOutput: binaural, pulse, pulse, off');
check(planOutputFor('headphones') === 'headphones' && planOutputFor('speakers') === 'speakers' && planOutputFor('phone') === 'phone'
  && planOutputFor('car') === 'speakers', 'planOutputFor: the car plans as speakers');
check(renderForOutput('bogus' as LayerOutput) === 'binaural' && planOutputFor(undefined as unknown as LayerOutput) === 'headphones',
  'an unknown output plays as headphones (the unanswered default)');

// --------------------------------------------------------------- bands --
{
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'constants.ts'), 'utf8');
  const block = /BINAURAL_PRESETS[^=]*=\s*\[([\s\S]*?)\];/.exec(text);
  const names = block ? [...block[1].matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]) : [];
  check(names.length === 5, `constants.ts lists five binaural presets (${names.join(', ')})`);
  check(names.map((n) => bandOfPresetName(n)).join(',') === BAND_ORDER.join(','), 'bandOfPresetName maps each preset name to its band, in order');
  check(bandOfPresetName('Theta') === 'theta' && bandOfPresetName('Mystery') === 'alpha' && bandOfPresetName('') === 'alpha',
    'bandOfPresetName: unknown names are alpha');
  check(capBand('gamma', 'alpha') === 'alpha' && capBand('beta', 'alpha') === 'alpha' && capBand('alpha', 'alpha') === 'alpha'
    && capBand('theta', 'alpha') === 'theta' && capBand('gamma', 'beta') === 'beta' && capBand('delta', 'beta') === 'delta',
    'capBand: never above the cap');
}
{
  const ticks = (h: BandHysteresis, current: Band, targets: Band[]): string =>
    targets.map((t) => h.tick(t, current) ?? '-').join(',');
  check(ticks(new BandHysteresis(), 'alpha', ['delta', 'theta']) === '-,theta', 'alternating targets on one side step on the 2nd tick');
  check(ticks(new BandHysteresis(), 'alpha', ['delta', 'beta', 'delta', 'delta']) === '-,-,-,theta', 'a flip of direction restarts the count');
  check(ticks(new BandHysteresis(), 'alpha', ['delta', 'alpha', 'delta', 'delta']) === '-,-,-,theta', 'a target equal to the current band resets');
  check(ticks(new BandHysteresis(), 'beta', [capBand('gamma', 'alpha'), capBand('gamma', 'alpha')]) === '-,alpha',
    'a cap below the current band steps down');
  check(ticks(new BandHysteresis(), 'alpha', ['gamma', 'gamma']) === '-,beta', 'one band per step');
  const h = new BandHysteresis();
  h.tick('delta', 'alpha');
  h.reset();
  check(h.tick('delta', 'alpha') === null && h.tick('delta', 'alpha') === 'theta', 'reset() forgets the first tick');
  check(new BandHysteresis().tick('x' as Band, 'alpha') === null, 'an unknown band never steps');
  // After a step the count starts over (two more ticks for the next band).
  const h2 = new BandHysteresis();
  let cur: Band = 'alpha';
  const seen: string[] = [];
  for (let k = 0; k < 6; k++) {
    const next = h2.tick('gamma', cur);
    if (next) cur = next;
    seen.push(cur);
  }
  check(seen.join(',') === 'alpha,beta,beta,gamma,gamma,gamma', `a steady target steps every second tick (${seen.join(',')})`);
}

// ------------------------------------------------------------- intensity --
{
  const flat = (level: number, frames: number) => {
    const a = new Uint8Array(frames).fill(level);
    return { fps: 20, sub: a, bass: a, mid: a, high: a };
  };
  check(near(readIntensity(flat(128, 1200), 30), 128 / 255, 1e-12) && near(128 / 255, 0.502, 5e-4), 'a constant 128 reads 0.502');
  check(near(readIntensity(flat(128, 1200), 0), 128 / 255, 1e-12), 'frame 0 clamps the window to the start');
  const env = flat(0, 100);
  env.sub = new Uint8Array(100).map((_, i) => i); // frame f has sub = f: the window mean is easy to state
  const nofps = { sub: env.sub, bass: env.bass, mid: env.mid, high: env.high };
  // fps 20: frame 50 at 2.5 s, window 30 frames: frames 20..50, mean sub 35 → (35 / 4) / 255.
  check(near(readIntensity(env, 2.5), 35 / 4 / 255, 1e-12) && near(readIntensity(nofps, 2.5), 35 / 4 / 255, 1e-12),
    'the 1.5 s window ends at t; a missing fps is 20');
  check(near(readIntensity({ ...env, fps: 10 }, 5), 42.5 / 4 / 255, 1e-12), 'the window follows fps (10: frames 35..50)');
  check(readIntensity(flat(200, 100), 60) === 0 && readIntensity(flat(200, 100), 1e300) === 0, 'past the envelope it reads 0, and returns');
  // 5.5 s = frame 110: frames 80..110, of which 80..99 exist (20 of 31).
  check(near(readIntensity(flat(200, 100), 5.5), (200 * 20 / 31) / 255, 1e-12), 'samples outside the envelope read 0');
  check(readIntensity(flat(200, 100), -3) === 0 && near(readIntensity(flat(200, 100), NaN), 200 / 255, 1e-12)
    && readIntensity(flat(200, 100), Infinity) === 0, 'negative, NaN and infinite times: 0, frame 0, 0');
  check(readIntensity({ fps: 20, sub: [], bass: [], mid: [], high: [] }, 1) === 0, 'an empty envelope reads 0');
}

// ------------------------------------------------------- the music level --
{
  const o = (musicPlaying: boolean, mobile: boolean, elementVolumeTakes: boolean) =>
    ({ musicPlaying, mobile, elementVolumeTakes, duckCompensation: 1.6 });
  check(musicGainFactor(0.8, o(true, false, true)) === 0.8, 'desktop, music playing: the volume (0.8)');
  check(musicGainFactor(0.8, o(true, true, true)) === 0.625, 'phone, music playing: min(0.8, 1/1.6) = 0.625');
  check(musicGainFactor(0.5, o(true, true, true)) === 0.5, 'phone below 0.625: the volume');
  check(musicGainFactor(0.8, o(true, true, false)) === 0.625 && musicGainFactor(0.3, o(true, true, false)) === 0.625,
    'element volume not taking (iOS): 1/1.6 whatever the volume');
  check(musicGainFactor(0.8, o(false, true, true)) === 0.8 && musicGainFactor(0.8, o(false, true, false)) === 0.8
    && musicGainFactor(0.8, o(false, false, true)) === 0.8, 'music not playing (tone only): the volume on every device (AC-04)');
  check(musicGainFactor(NaN, o(true, false, true)) === 0 && musicGainFactor(7, o(true, false, true)) === 1
    && musicGainFactor(0.8, { musicPlaying: true, mobile: true, elementVolumeTakes: true, duckCompensation: 0 }) === 0.8,
    'a bad volume or duck compensation stays in range');
}

// ----------------------------------------------------- sliders and dB --
check(sliderGain(0.01, TONE_SLIDER_DEFAULT) === 1 && sliderGain(0.03, BEAT_SLIDER_DEFAULT) === 1, 'the default slider is 0 dB');
check(sliderGain(0.02, 0.01) === 2 && near(gainToDb(2)!, 6.0206, 1e-4), '0.02 is 2 = +6.02 dB');
check(sliderGain(0.0399, 0.01) === MAX_BOOST && sliderGain(0.04, 0.01) === MAX_BOOST && sliderGain(0.2, 0.03) === MAX_BOOST,
  'at and past 4 × the default: the +12 dB cap');
check(sliderGain(0, 0.01) === 0 && sliderGain(-0.01, 0.01) === 0, '0 (and below) is off');
check(gainToDb(1) === 0 && gainToDb(0) === null && gainToDb(-1) === null && gainToDb(NaN) === null && gainToDb(Infinity) === null,
  'gainToDb: 0 dB at 1; off for 0, negatives and non-finite');
check(formatDb(0) === '+0.0 dB' && formatDb(-26) === `${MINUS}26.0 dB` && formatDb(6.0206) === '+6.0 dB' && formatDb(12) === '+12.0 dB'
  && formatDb(-14) === `${MINUS}14.0 dB` && formatDb(-0.04) === '+0.0 dB' && formatDb(-23.04) === `${MINUS}23.0 dB`,
  "formatDb: '+0.0 dB', '−26.0 dB' (U+2212), one decimal, no '−0.0'");
check(formatDb(gainToDb(MAX_BOOST)!) === '+12.0 dB' && formatDb(gainToDb(MAX_BOOST)! + TONE_REF_DB) === `${MINUS}14.0 dB`,
  'the cap reads +12.0 dB, −14.0 dB re music for the tone');

// ------------------------------------------- totality (runs during render) --
{
  // Whatever App hands them during render — null, undefined, NaN, ±Infinity, 0, −1, an unknown band or output —
  // these return a value of their kind and never throw (I10).
  const odd: unknown[] = [null, undefined, NaN, Infinity, -Infinity, 0, -1, 'x', {}];
  let threw = 0;
  let ok = true;
  for (const x of odd) {
    try {
      const n = x as number;
      const s = formatDb(n);
      if (typeof s !== 'string') ok = false;
      if (!(typeof x === 'number' && Number.isFinite(x)) && s !== DASH) ok = false;
      const g = gainToDb(n);
      if (g !== null && !Number.isFinite(g)) ok = false;
      if (typeof sliderGain(n, 0.01) !== 'number' || !Number.isFinite(sliderGain(n, 0.01)) || !Number.isFinite(sliderGain(0.01, n))) ok = false;
      if (typeof renderForOutput(x as LayerOutput) !== 'string' || typeof planOutputFor(x as LayerOutput) !== 'string') ok = false;
      if (!BAND_ORDER.includes(bandOfPresetName(x as string)) || !BAND_ORDER.includes(capBand(x as Band, 'alpha'))) ok = false;
      if (typeof capBand('beta', x as Band) !== 'string') ok = false;
      if (!Number.isFinite(musicGainFactor(n, { musicPlaying: true, mobile: true, elementVolumeTakes: true, duckCompensation: n }))) ok = false;
      if (crystalIdOf(n) !== null && typeof x !== 'number') ok = false;
      // The tone level is read in a useState initializer (App's first render).
      if (parseToneLevel(x as string, 'v2') !== null || parseToneLevel('0.01', x as 'v2') !== 0.01) ok = false;
      if (typeof toneLevelKey(x as 'v2') !== 'string' || !Number.isFinite(defaultToneLevel(x as 'v2'))) ok = false;
    } catch {
      threw++;
    }
  }
  check(threw === 0 && ok, `formatDb and the helpers are total: odd inputs give '${DASH}' or a value of their kind (${threw} threw)`);
  check(formatDb(null as unknown as number) === DASH && formatDb(undefined as unknown as number) === DASH && formatDb(NaN) === DASH
    && formatDb(Infinity) === DASH && formatDb(-Infinity) === DASH, `formatDb: no number, no dB ('${DASH}')`);
  const warned = warnsOf(() => {
    try {
      for (const x of odd) canonicalLayerHz(x as number, false);
    } catch {
      threw++;
    }
  });
  check(threw === 0 && warned.length <= odd.length, 'canonicalLayerHz never throws on odd input');
}

// ------------------------------------- copy helpers (components/layers/layerCopy.ts) --
{
  const B = copy.layersBadgeText;
  check(B('classic', false, null, 528) === 'Layers classic' && B('classic', false, 'car', 111) === 'Layers classic',
    "badge: 'Layers classic' (the 111 suffix is v2's)");
  check(B('v2', false, 'headphones', 528) === 'Layers v2 · Headphones' && B('v2', false, null, 528) === 'Layers v2 · Headphones (assumed)'
    && B('v2', false, 'speakers', 528) === 'Layers v2 · Speakers (pulse)' && B('v2', false, 'phone', 528) === 'Layers v2 · Phone (pulse)'
    && B('v2', false, 'car', 528) === 'Layers v2 · Car (tone only)', 'badge: the five v2 outputs (§11)');
  check(B('v2', true, 'headphones', 528) === 'Layers classic · v2 unavailable', "badge: 'Layers classic · v2 unavailable'");
  // v2's failure with Car in effect: classic's layers stay off (App), and the badge says so. A chosen classic is classic.
  check(B('v2', true, 'car', 528) === 'Layers off · Car · v2 unavailable' && B('v2', true, null, 528) === 'Layers classic · v2 unavailable'
    && B('v2', true, 'speakers', 528) === 'Layers classic · v2 unavailable' && B('classic', true, 'car', 528) === 'Layers classic',
    "badge: 'Layers off · Car · v2 unavailable' for the Car fallback only");
  check(B('v2', false, 'speakers', 111) === 'Layers v2 · Speakers (pulse) · 111 Hz non-canonical', "badge: ' · 111 Hz non-canonical' in v2");

  const C = copy.bandChipText;
  check(C(false, 'Alpha', 'pulse', 'beta', 'alpha') === 'Alpha' && C(false, 'Gamma', 'off', 'gamma', 'gamma') === 'Gamma',
    "band chip, classic: the preset's name as v14.7");
  check(C(true, 'Alpha', 'binaural', 'alpha', 'alpha') === 'Alpha' && C(true, 'Gamma', 'binaural', 'gamma', 'gamma') === 'Gamma',
    'band chip, v2 binaural: the band name');
  check(C(true, 'Beta', 'pulse', 'beta', 'alpha') === 'Pulse · Alpha (capped)' && C(true, 'Theta', 'pulse', 'theta', 'theta') === 'Pulse · Theta',
    "band chip, v2 pulse: 'Pulse · Alpha', ' (capped)' when the preset is above alpha");
  check(C(true, 'Alpha', 'off', 'alpha', 'alpha') === 'Beat off', "band chip, v2 off: 'Beat off'");

  check(copy.toneReadout(1) === `+0.0 dB · ${MINUS}26.0 dB re music`, "tone readout: '+0.0 dB · −26.0 dB re music' at 0 dB (1 %)");
  check(copy.toneReadout(sliderGain(V2_TONE_LEVEL_DEFAULT, TONE_SLIDER_DEFAULT)) === `${MINUS}26.0 dB · ${MINUS}52.0 dB re music`,
    "tone readout: '−26.0 dB · −52.0 dB re music' at v2's default, the lowest step before off (v15.0)");
  check(copy.toneReadout(MAX_BOOST) === `+12.0 dB (max) · ${MINUS}14.0 dB re music`
    && copy.toneReadout(sliderGain(0.04, TONE_SLIDER_DEFAULT)) === `+12.0 dB (max) · ${MINUS}14.0 dB re music`
    && copy.toneReadout(sliderGain(0.3, TONE_SLIDER_DEFAULT)) === `+12.0 dB (max) · ${MINUS}14.0 dB re music`,
  "tone readout: '+12.0 dB (max) · −14.0 dB re music' at the cap (a classic 30% plays there too)");
  check(copy.toneReadout(sliderGain(0.02, TONE_SLIDER_DEFAULT)) === `+6.0 dB · ${MINUS}20.0 dB re music` && copy.toneReadout(0) === 'off',
    "tone readout: +6 dB at 2 %, 'off' at 0");
  check(copy.beatReadout(1, 'binaural') === `Beat +0.0 dB · ${MINUS}23.0 dB re music`
    && copy.beatReadout(1, 'pulse') === `Pulse +0.0 dB · ${MINUS}23.0 dB re music` && copy.beatReadout(1, 'off') === 'Car: tone only',
    "beat readout: 'Beat …', 'Pulse …', 'Car: tone only' (§11)");
  check(copy.beatReadout(sliderGain(0.12, BEAT_SLIDER_DEFAULT), 'binaural') === `Beat +12.0 dB (max) · ${MINUS}11.0 dB re music`
    && copy.beatReadout(0, 'pulse') === 'Pulse off', 'beat readout: the cap at the v2 slider max; off at 0');
  check(copy.feltLineV2(2178, toneOf(2178, 'headphones'))
    === 'High-order frequency (2178 Hz). v2 plays its octave 544.5 Hz: an audible tone under the music.'
    && copy.feltLineV2(4920, toneOf(4920, 'phone')) === 'High-order frequency (4920 Hz). v2 plays its octave 615 Hz: an audible tone under the music.',
    'felt line, v2: the octave v2 plays (2178 → 544.5 Hz, 4920 → 615 Hz)');
  check(copy.feltLineV2(2178, 0) === 'High frequency detected (2178Hz). Focus on feeling rather than hearing.',
    'felt line: no tone (layer.f 0) gives the classic line');

  // Status and tooltip, from player states shaped like layerPlayer's (the p528 plan, headphones, alpha).
  const p = plan(528, 'headphones', 'binaural', 10)!;
  const voice = (render: 'binaural' | 'pulse' | 'off', partner: number, drone: boolean) => ({
    key: `k-${render}`, canonical_hz: p.canonical_hz, sounding_hz: p.sounding_hz, sham_cents: 0, arm: 'on', output: 'headphones', render,
    tone_hz: p.tone_hz, carrier_hz: p.carrier_hz, partner_hz: partner, beat_hz: render === 'off' ? 0 : 10, pulse_rate_hz: render === 'pulse' ? 10 : 0,
    drone_hz: drone ? p.drone_hz : 0, pulse_hz: drone ? p.pulse_hz : 0,
  });
  const st = (phase: string, v: ReturnType<typeof voice> | null, resting = false, mono = false) => ({
    sound_version: 2, player_version: 1, t: 10, phase, sounding: v, requested: v, retune_at: null,
    gates: { tone_beat: 1, drone: 1 }, host_level: 0.8, gains: { tone: 1, beat: 1, drone: 1 }, mono_output: mono,
    drone: { resting, on_s: 0, quiet_s: 0, rest_ends_at: null, next_rest_at: null },
  }) as unknown as LayerPlayerState;
  const open = copy.mergeLayerStatus(null, st('open', voice('binaural', 274, true)));
  check(!!open && open.tone === 528 && open.carrier === 264 && open.partner === 274 && open.drone === 33 && open.pulse === p.pulse_hz
    && open.key === 'k-binaural' && open.render === 'binaural' && !open.resting && !open.mono, 'status: the sounding voice of a state');
  check(copy.mergeLayerStatus(open, st('open', voice('binaural', 274, true))) === open,
    'status: an unchanged transition returns the same object (no re-render)');
  check(copy.mergeLayerStatus(open, null) === open && copy.mergeLayerStatus(null, undefined) === null, 'status: no state keeps the status');
  const T = copy.layersTooltip;
  check(T('classic', false, open) === 'Classic layers (v2 is the default). Tap to compare with v2.', 'tooltip, classic (§11; v15.0)');
  check(T('v2', false, open) === 'Sounding: tone 528 Hz, beat 264/274 Hz, drone 33 Hz', "tooltip, v2: 'Sounding: tone {t} Hz, beat {c}/{p} Hz, drone {d} Hz'");
  check(T('v2', false, copy.mergeLayerStatus(open, st('open', voice('binaural', 274, true), true, false)))
    === 'Sounding: tone 528 Hz, beat 264/274 Hz, drone 33 Hz · drone resting', "tooltip: ' · drone resting'");
  check(T('v2', false, copy.mergeLayerStatus(null, st('open', voice('pulse', 0, false), false, true)))
    === 'Sounding: tone 528 Hz, beat 264 Hz · mono output: pulse', "tooltip: no partner in pulse; ' · mono output: pulse'");
  check(T('v2', false, copy.mergeLayerStatus(null, st('open', voice('off', 0, false)))) === 'Sounding: tone 528 Hz',
    'tooltip: the tone alone off the beat (car, tone-only)');
  check(T('v2', false, copy.mergeLayerStatus(null, st('silent', voice('binaural', 274, true)))) === 'Sounding: nothing'
    && T('v2', false, null) === 'Sounding: nothing yet', 'tooltip: nothing sounding (paused, or no player yet)');
  check(T('v2', true, open) === copy.V2_UNAVAILABLE, 'tooltip: v2 failed says so');
  check(T('v2', true, open, 'car') === copy.V2_UNAVAILABLE_CAR && T('v2', true, open, 'speakers') === copy.V2_UNAVAILABLE
    && T('v2', true, open, null) === copy.V2_UNAVAILABLE && T('classic', true, open, 'car') === copy.CLASSIC_TOOLTIP,
    "tooltip: the Car fallback's notice for Car only; a chosen classic keeps classic's");

  // The exact §11 strings (classic strings stay in App's v14.7 markup).
  check(copy.ENGINE_GROUP_LABEL === 'Layer sound: v2 / classic'
    && copy.ENGINE_NOTE === 'v2 is the default. Classic stays available: compare the two by ear.'
    && copy.ENGINE_LABELS.classic === 'Classic' && copy.ENGINE_LABELS.v2 === 'v2', 'copy: the engine group, its buttons and note');
  check(copy.CLASSIC_OUTPUT_NOTE
    === 'Output and Car apply to v2. Classic plays its beat and drone whatever the output: for driving, use v2 with Car output, or Music only.',
    'copy: the classic note (Car is v2 only)');
  check(copy.OUTPUT_LABELS.headphones === 'Headphones' && copy.OUTPUT_LABELS.speakers === 'Speakers'
    && copy.OUTPUT_LABELS.phone === 'Phone speaker' && copy.OUTPUT_LABELS.car === 'Car'
    && copy.OUTPUT_DESCRIPTIONS.headphones === 'Binaural beat + sub-bass drone. Both earbuds in; mono audio and spatial audio off.'
    && copy.OUTPUT_DESCRIPTIONS.speakers === 'A gentle pulse instead of the beat; no drone.'
    && copy.OUTPUT_DESCRIPTIONS.phone === "A gentle pulse; the tone moves up into the phone's range; no drone."
    && copy.OUTPUT_DESCRIPTIONS.car === 'Tone only.' && copy.OUTPUT_ASSUMED_NOTE === 'Not answered yet: playing as headphones.'
    // "Ask me again" keeps the saved answer and saves the question, so the output in effect outlasts a restart too.
    && copy.OUTPUT_ASKED_AGAIN_NOTE === 'Asked again: the current output stays until you answer.'
    && copy.OUTPUT_ORDER.join(',') === 'headphones,speakers,phone,car', 'copy: the four outputs, the assumed and the asked-again notes');
  check(copy.HEADPHONES_HINT === 'Binaural beats need headphones with both earbuds in, and mono audio and spatial audio turned off.',
    'copy: the headphones hint');
  check(copy.DRONE_LABEL === 'Sub-bass drone'
    && copy.DRONE_DESCRIPTION === `${MINUS}24 dB. Fades in over 8 s and out over 3 s; rests 10 min after 20 min.`
    && copy.DRONE_HEADPHONES_ONLY === 'Headphones only.' && copy.ASK_AGAIN_LABEL === 'Ask me again'
    // When the layers next play, not "at the next play": under Music only the question waits for the layers.
    && copy.ASK_AGAIN_DESCRIPTION === "Asks again which output you're using, now or when the layers next play. "
      + 'Your current output stays until you answer.'
    && copy.EXPORT_LOG_LABEL === 'Export sound log'
    && copy.V2_UNAVAILABLE === 'v2 unavailable on this device: classic is playing.'
    && copy.V2_UNAVAILABLE_CAR === 'v2 unavailable on this device. For Car output the layers are off; only the music plays.',
    'copy: drone, ask again, export, v2 failed (and for Car)');
  check(copy.SHEET_HEADING === 'What are you listening on?'
    && copy.SHEET_BODY === 'The layers are shaped for your output. Change it any time with the layers button in the player.'
    && copy.SHEET_LATER === 'Ask me later' && copy.QUICK_SWITCH_LABEL === 'Layer sound and output',
    "copy: the sheet ('Ask me later', never the orphan banner's 'Not now') and the quick switch");
  check(copy.TONE_LEVEL_LABEL === 'Tone level'
    && copy.PRESETS_NOTE_V2 === 'Adaptive stops at Beta; Gamma is a manual choice. Off headphones the beat is a gentle pulse, capped at Alpha.'
    && copy.PRESETS_NOTE_CAR_V2 === 'Car: tone only, so there is no beat or pulse.'
    && copy.GAMMA_DESCRIPTION_V2 === 'Gamma (40 Hz) is a design choice: the MIT 40 Hz work used light flicker and click trains, not binaural beats, '
      + 'and above about 30 Hz a binaural beat is heard as two tones rather than a beat.', 'copy: tone level, presets note, Gamma (v2)');
  check(copy.PHI_LEVELS_V2 === `Layer levels: tone ${MINUS}26, beat ${MINUS}23, drone ${MINUS}24 dB under the music (fixed; φ ratios are classic only)`
    && copy.PHI_BINAURAL_V2 === 'Binaural: carrier left, partner right (no phase offset)'
    && copy.PHI_ENVELOPE_V2 === 'One continuous envelope on every layer: 0 → 0.8 at 38.2% → 1 at 61.8% → 0.8 at the end'
    && copy.KEEP_COMFORTABLE_V2 === '• Keep the layers comfortable (v2 plays an audible octave)'
    && copy.SOUND_LOG_SAVE_FAILED === 'The sound log could not be saved (storage may be full). Export it from Harmonic Control.',
    'copy: the PHI panel lines, the felt line and the sound-log toast');

  // Totality: whatever App hands them during render, a string and never a throw (I10).
  const odd: unknown[] = [null, undefined, NaN, Infinity, -Infinity, 0, -1, 'x', 'gamma', {}];
  let threw = 0;
  let ok = true;
  const str = (s: unknown): void => {
    if (typeof s !== 'string' || s.length === 0) ok = false;
  };
  for (const x of odd) {
    try {
      const n = x as number;
      str(B(x as 'v2', x as boolean, x as LayerOutput, n));
      str(B('v2', false, x as LayerOutput, n));
      str(B('v2', true, x as LayerOutput, n));
      str(C(true, x as string, x as 'pulse', x as Band, x as Band));
      str(C(true, 'Alpha', 'pulse', 'alpha', x as Band));
      str(C(true, 'Alpha', x as 'pulse', 'alpha', 'alpha'));
      str(C(false, x as string, 'binaural', 'alpha', 'alpha'));
      str(copy.toneReadout(n));
      str(copy.beatReadout(n, 'binaural'));
      str(copy.beatReadout(1, x as 'binaural'));
      str(copy.feltLineV2(n, n));
      str(T('v2', false, x as LayerStatus));
      str(T(x as 'v2', x as boolean, null));
      str(T('v2', true, null, x as LayerOutput));
      const m = copy.mergeLayerStatus(null, x as LayerPlayerState);
      if (m !== null && typeof m !== 'object') ok = false;
    } catch {
      threw++;
    }
  }
  check(threw === 0 && ok, `the copy helpers are total: odd inputs give a string (${threw} threw)`);
  check(copy.toneReadout(NaN) === DASH && copy.toneReadout(Infinity) === DASH && copy.toneReadout(-1) === 'off'
    && copy.beatReadout(NaN, 'pulse') === DASH && copy.beatReadout(1, 'x' as 'pulse') === DASH,
    `the readouts: no number (or no render) gives '${DASH}', below 0 is off`);
}

console.log(`layerHost: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures.slice(0, 20)) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
