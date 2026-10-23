// Checks for utils/soundV2/keyFit.ts (Key fit, v15.2: build spec §12.1, with the critique's rulings M1–M3 and m15).
// Run with: node utils/soundV2/keyFit.check.ts   (Node 22.18+ strips the types), or npm run check:sound
// Exits non-zero on any failure and lists the first 20.
//
// A  golden values: keyFitFor is v2's own musicFit, bit for bit, at the heard A4 (A4 × the app's retune) and the
//    canonical tone of the plan output; pinned literals; Car = headphones; App's call passes PITCH_SHIFT_FACTOR.
// B  no usable key data (D10): no duck, never cached.
// C  the content-keyed cache (D14, m15: full precision).
// D  parseKeyFit and the view (M1: never −0).
// E  the duck's automation on a fake engine (ParamTrack anchors and glides only; M1, M2(a) holdRise, M3 E10).
// F  continuity of the duck's recorded calls, evaluated by the Web Audio spec here, not by ParamTrack (M3: the
//    designed slopes come from the script's literal τs).
// G  the copy (layerCopy's Key fit helpers).
// H  riseHoldFrom, riseStart, hostGlideHold, laterHold (M2(b): the rest guard); riseHold and restGuardAt (review A2:
//    the guard where a held rise starts), userFallEnd (A1), gatesSilent (A4).
// I  no swell (M2(d)): the real LayerPlayer and KeyFitDuck on a fake engine, driven the way App drives them, in every
//    scenario of the critique's table and the review's (A1 a layer faded to off, A2 a rest where a held rise starts,
//    A3 a track change measured from its commit); each measures ≤ +0.1 dB, and each has a control without App's hold
//    that must swell (so the scenario can see one). A4: a fall sent while the layers are silent never lets them open
//    above the level they settle at (≤ +0.1 dB), with its control.

import { readFileSync } from 'node:fs';
import {
  KeyFitDuck, keyFitFor, keyFitView, keyFitLogFields, hasKeyData, fitCacheKey, clearKeyFitCache, keyFitCacheStats,
  parseKeyFit, dbToGain, riseHoldFrom, riseStart, hostGlideHold, laterHold, riseHold, restGuardAt, userFallEnd, gatesSilent, trackHold,
  KEY_FIT_STORAGE_KEY, DEFAULT_KEY_FIT, DUCK_TAU_S, DUCK_FLIP_TAU_S, DUCK_MIN_STEP_DB, DUCK_MAX_HOLD_S, DUCK_REST_GUARD_S,
  DUCK_TRACK_HOLD_S, NO_DUCK_DB, FIT_CACHE_MAX,
} from './keyFit.ts';
import type { KeyFit, KeyFitView, KeyData } from './keyFit.ts';
import { musicFit, toneOf, CANONICAL_HZ, plan, DRONE_OUT_S, GATE_OUT_S } from './aetheria_sound_v2.ts';
import type { Plan } from './aetheria_sound_v2.ts';
import { planOutputFor } from './layerHost.ts';
import { LayerPlayer } from './layerPlayer.ts';
import type { LayerGains, LayerPlayerState } from './layerPlayer.ts';
import type { ParamTrack } from './layerSchedule.ts';
import { keyFitChipText, keyFitChipTitle, keyFitChipTone, keyFitRowText, KEY_FIT_DESCRIPTION } from '../../components/layers/layerCopy.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}
const near = (a: number, b: number, tol = 1e-12): boolean => Math.abs(a - b) <= tol;
const t0 = Date.now();

// --------------------------------------------------------------- fixtures --

const ONE = (k: number): number[] => Array.from({ length: 12 }, (_, i) => (i === k ? 1 : 0));
const RUB = ONE(1); // C#: rubs against 528 Hz on the A = 432 grid (rel 0.887)
const FIT = ONE(6); // F#: sits well under 528 Hz (rel 0.0007)
// The KK profiles at 4 dp (the reference analyser's KK_MAJOR / KK_MINOR, normalised, rotated):
const KK_C_MAJ = [0.152, 0.0534, 0.0833, 0.0558, 0.1048, 0.0979, 0.0603, 0.1242, 0.0572, 0.0876, 0.0548, 0.0689];
const KK_A_MIN = [0.1209, 0.0584, 0.0793, 0.0571, 0.1067, 0.0894, 0.0604, 0.075, 0.0712, 0.1422, 0.0602, 0.0791];
const KK_FS_MAJ = [0.0603, 0.1242, 0.0572, 0.0876, 0.0548, 0.0689, 0.152, 0.0534, 0.0833, 0.0558, 0.1048, 0.0979];
const KK_EB_MIN = [0.0604, 0.075, 0.0712, 0.1422, 0.0602, 0.0791, 0.1209, 0.0584, 0.0793, 0.0571, 0.1067, 0.0894];
const RETUNE = 0.981818;
const data = (chroma: number[], a4: number, conf: number | undefined, key: string): KeyData =>
  ({ chroma, chromaA4Hz: a4, keyConfidence: conf, musicKey: key });

// ------------------------------------------------- A. golden values (D8, D9) --

{
  const fixtures: Array<[string, number[], string]> = [
    ['RUB', RUB, 'C#'], ['FIT', FIT, 'F#'], ['KK_C_MAJ', KK_C_MAJ, 'C'], ['KK_A_MIN', KK_A_MIN, 'Am'],
    ['KK_FS_MAJ', KK_FS_MAJ, 'F#'], ['KK_EB_MIN', KK_EB_MIN, 'D#m'],
  ];
  let n = 0, bad = 0;
  const firstBad: string[] = [];
  for (const [name, chroma, key] of fixtures) {
    for (const conf of [-1, 0.45, 0.6, 0.71, 0.9]) {
      for (const a4 of [432, 439, 440, 441.5, 442.42]) {
        for (const f of [...CANONICAL_HZ, 111]) {
          for (const out of ['headphones', 'speakers', 'phone']) {
            for (const retune of [RETUNE, 1]) {
              const got = keyFitFor(data(chroma, a4, conf, key), f, out, retune);
              const want = musicFit(toneOf(f, out), chroma, a4 * retune, conf);
              const ok = got.duck_db === want.duck_db && got.rel === want.rel && got.strength === want.strength
                && got.toneHz === toneOf(f, out) && got.a4Heard === a4 * retune && got.hasChroma === true;
              n++;
              if (!ok) {
                bad++;
                if (firstBad.length < 3) firstBad.push(`${name} conf ${conf} A4 ${a4} f ${f} ${out} retune ${retune}: duck ${got.duck_db} vs ${want.duck_db}, a4 ${got.a4Heard}`);
              }
            }
          }
        }
      }
    }
  }
  check(bad === 0, `A1: keyFitFor is musicFit(toneOf(f, out), chroma, A4 × retune, conf) bit for bit in all ${n} cases (${bad} differ: ${firstBad.join('; ')})`);
  check(n === 6 * 5 * 5 * 34 * 3 * 2, `A1 ran ${n} cases`);
}

{
  // A2: pinned literals (the vendored musicFit, A4 × 0.981818; §16.2).
  const rows: Array<[string, number[], number, number, number, string, number, number, number]> = [
    ['RUB', RUB, 440, 0.9, 528, 'headphones', 528, -6, 0.8872670144341637],
    ['RUB', RUB, 440, 0.6, 528, 'headphones', 528, -2.9999999999999987, 0.8872670144341637],
    ['RUB', RUB, 440, 0.45, 528, 'headphones', 528, 0, 0.8872670144341637],
    ['RUB', RUB, 440, -1, 528, 'headphones', 528, -6, 0.8872670144341637],
    ['FIT', FIT, 440, 0.9, 528, 'headphones', 528, 0, 0.0007173261724465426],
    ['RUB', RUB, 440, 0.9, 396, 'headphones', 396, 0, 0.11354371652341903],
    ['RUB', RUB, 440, 0.9, 174, 'headphones', 174, -4.981185981095893, 0.6452552468890903],
    ['RUB', RUB, 440, 0.9, 174, 'phone', 348, 0, 0.25550339486054563],
    ['RUB', RUB, 440, 0.9, 75, 'headphones', 150, -3.601494683180382, 0.5768952198124845],
    ['RUB', RUB, 440, 0.9, 1692, 'headphones', 846, 0, 0.011674138964195084],
    ['RUB', RUB, 440, 0.9, 111, 'headphones', 222, -5.997686695063129, 0.7454480880387059],
    ['RUB', RUB, 432, 0.9, 528, 'headphones', 528, -1.7307298212046516, 0.49195857214873595],
    ['KK_C_MAJ', KK_C_MAJ, 440, 0.82, 528, 'headphones', 528, -2.125663460226527, 0.5106321535271264],
    ['KK_A_MIN', KK_A_MIN, 441.5, 0.71, 396, 'headphones', 396, -2.8418473557094712, 0.5494219136884844],
    ['KK_FS_MAJ', KK_FS_MAJ, 439, 0.9, 852, 'speakers', 852, -5.070559476697131, 0.6504783626046285],
    ['KK_EB_MIN', KK_EB_MIN, 442.42, 0.615, 4920, 'phone', 615, 0, 0.21874712988626432],
  ];
  for (const [name, c, a4, conf, f, out, tone, duck, rel] of rows) {
    const got = keyFitFor(data(c, a4, conf, 'X'), f, out, RETUNE);
    check(got.toneHz === tone && near(got.duck_db, duck) && near(got.rel, rel),
      `A2: ${name} A4 ${a4} conf ${conf} at ${f} Hz ${out}: tone ${got.toneHz} (${tone}), duck ${got.duck_db} (${duck}), rel ${got.rel} (${rel})`);
  }
  // The 432-native track is fitted as heard: A = 424.15 Hz.
  check(near(keyFitFor(data(RUB, 432, 0.9, 'C#'), 528, 'headphones', RETUNE).a4Heard, 424.145376, 1e-9), 'A2: a 432-native track is heard at A = 424.15 Hz');
}

{
  // A3: Car plays the speakers plan, whose tone equals the headphones' for every canonical frequency.
  const car = planOutputFor('car');
  const differ = CANONICAL_HZ.filter((f) => toneOf(f, car) !== toneOf(f, 'headphones'));
  check(car === 'speakers' && differ.length === 0, `A3: Car's fit is headphones' (planOutputFor('car') = ${car}; differ at ${differ.join(', ')})`);
  check(keyFitFor(data(RUB, 440, 0.9, 'C#'), 852, car, RETUNE).duck_db === keyFitFor(data(RUB, 440, 0.9, 'C#'), 852, 'headphones', RETUNE).duck_db,
    'A3: the same duck under Car and headphones');
}

{
  // A4: the retune is App's (read as text: never imported at run time).
  const constants = readFileSync(new URL('../../constants.ts', import.meta.url), 'utf8');
  check(constants.includes('export const PITCH_SHIFT_FACTOR = 0.981818;'), 'A4: constants.ts exports PITCH_SHIFT_FACTOR = 0.981818');
  const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
  const calls = app.split('keyFitFor(').length - 1;
  const passes = /keyFitFor\([^;]*layer\.f, planOutput, PITCH_SHIFT_FACTOR\)/.test(app);
  check(calls === 1 && passes, `A4: App.tsx makes exactly one keyFitFor( call, ending "layer.f, planOutput, PITCH_SHIFT_FACTOR)" (${calls} calls)`);
}

// ---------------------------------------------------- B. no usable data (D10) --

{
  clearKeyFitCache();
  const nan5 = [...RUB];
  nan5[5] = NaN;
  const inf5 = [...RUB];
  inf5[5] = Infinity;
  const neg5 = [...RUB];
  neg5[5] = -0.1;
  const cases: Array<[string, KeyData | null | undefined, number]> = [
    ['null', null, RETUNE], ['undefined', undefined, RETUNE], ['{}', {}, RETUNE],
    ['chroma undefined', { chroma: undefined, chromaA4Hz: 440, keyConfidence: 0.9 }, RETUNE],
    ['[]', data([], 440, 0.9, 'C#'), RETUNE], ['11 values', data(RUB.slice(0, 11), 440, 0.9, 'C#'), RETUNE],
    ['13 values', data([...RUB, 0], 440, 0.9, 'C#'), RETUNE],
    ['a Float32Array', { chroma: new Float32Array(RUB), chromaA4Hz: 440, keyConfidence: 0.9 }, RETUNE],
    ['a NaN entry', data(nan5, 440, 0.9, 'C#'), RETUNE], ['an Infinity entry', data(inf5, 440, 0.9, 'C#'), RETUNE],
    ['a negative entry', data(neg5, 440, 0.9, 'C#'), RETUNE], ['all zeros', data(ONE(-1), 440, 0.9, ''), RETUNE],
    ['chromaA4Hz missing', { chroma: RUB, keyConfidence: 0.9 }, RETUNE], ['chromaA4Hz 0', data(RUB, 0, 0.9, 'C#'), RETUNE],
    ['chromaA4Hz −440', data(RUB, -440, 0.9, 'C#'), RETUNE], ['chromaA4Hz NaN', data(RUB, NaN, 0.9, 'C#'), RETUNE],
    ['retune 0', data(RUB, 440, 0.9, 'C#'), 0], ['retune NaN', data(RUB, 440, 0.9, 'C#'), NaN],
    ["a string 'abc'", { chroma: 'abc', chromaA4Hz: 440, keyConfidence: 0.9 }, RETUNE],
    ['{ length: 12 }', { chroma: { length: 12 }, chromaA4Hz: 440, keyConfidence: 0.9 }, RETUNE],
  ];
  for (const [name, s, retune] of cases) {
    const before = keyFitCacheStats().size;
    const f = keyFitFor(s, 528, 'headphones', retune);
    check(f.hasChroma === false && Object.is(f.duck_db, 0) && f.a4Heard === 0 && f.rel === 0 && f.strength === 0
      && keyFitCacheStats().size === before && Object.isFrozen(f),
    `B: ${name} is no key data (hasChroma ${f.hasChroma}, duck ${f.duck_db}, a4 ${f.a4Heard}, cache ${before} → ${keyFitCacheStats().size})`);
    if (s !== null && s !== undefined && retune === RETUNE) check(hasKeyData(s) === false, `B: hasKeyData(${name}) is false`);
  }
  check(hasKeyData(data(RUB, 440, 0.9, 'C#')) && hasKeyData({ chroma: RUB, chromaA4Hz: 440 }), 'B: hasKeyData holds for a plain chroma, with or without a confidence');
  // Data with no tone (a non-crystal frequency): the data counts, no duck, not cached.
  for (const hz of [0, NaN]) {
    const before = keyFitCacheStats().size;
    const f = keyFitFor(data(RUB, 440, 0.9, 'C#'), hz, 'headphones', RETUNE);
    check(f.hasChroma === true && f.toneHz === 0 && Object.is(f.duck_db, 0) && f.a4Heard === 440 * RETUNE && keyFitCacheStats().size === before,
      `B: data at canonicalHz ${hz}: hasChroma, tone 0, no duck, not cached`);
  }
  // A missing confidence is musicFit's −1: full strength (A2's row 4).
  const noConf = keyFitFor({ chroma: RUB, chromaA4Hz: 440, musicKey: 'C#' }, 528, 'headphones', RETUNE);
  check(noConf.strength === 1 && noConf.duck_db === -6 && noConf.keyConfidence === null, `B: no keyConfidence → strength 1, −6 dB (${noConf.strength}, ${noConf.duck_db})`);
}

// --------------------------------------------------------- C. the cache (D14) --

{
  clearKeyFitCache();
  const s0 = keyFitCacheStats();
  check(s0.size === 0 && s0.hits === 0 && s0.misses === 0, 'C: clearKeyFitCache empties the cache and zeroes the stats');
  const a = keyFitFor(data(RUB, 440, 0.9, 'C#'), 528, 'headphones', RETUNE);
  const b = keyFitFor(data(RUB, 440, 0.9, 'C#'), 528, 'headphones', RETUNE);
  check(a === b && Object.isFrozen(a) && keyFitCacheStats().hits === 1 && keyFitCacheStats().misses === 1, 'C: the same inputs twice return the same frozen object (one hit)');
  const c = keyFitFor(data([...RUB], 440, 0.9, 'C#'), 528, 'headphones', RETUNE);
  check(c === a && keyFitCacheStats().hits === 2, 'C: the same chroma in a new array is a hit');
  const misses = (label: string, s: KeyData, f = 528): void => {
    const m0 = keyFitCacheStats().misses;
    const r = keyFitFor(s, f, 'headphones', RETUNE);
    check(r !== a && keyFitCacheStats().misses === m0 + 1, `C: ${label} is a miss`);
  };
  misses('a different tone', data(RUB, 440, 0.9, 'C#'), 639);
  misses('a different A4 (1e-6 Hz: full precision, m15)', data(RUB, 440.000001, 0.9, 'C#'));
  misses('a different confidence', data(RUB, 440, 0.91, 'C#'));
  misses('a different key name', data(RUB, 440, 0.9, 'C#m'));
  const w = [...RUB];
  w[3] = 1e-4;
  misses('one weight changed by 1e-4', data(w, 440, 0.9, 'C#'));
  // Two chromas, the rest equal: two entries, two fits.
  const r1 = keyFitFor(data(RUB, 440, 0.9, 'K'), 528, 'headphones', RETUNE), r2 = keyFitFor(data(FIT, 440, 0.9, 'K'), 528, 'headphones', RETUNE);
  check(r1.duck_db === -6 && Object.is(r2.duck_db, 0), `C: two chromas with the other inputs equal are two fits (${r1.duck_db}, ${r2.duck_db})`);
  check(fitCacheKey(528, 440 * RETUNE, 0.9, 'C#', RUB) === '528|431.99992|0.9|C#|0,1,0,0,0,0,0,0,0,0,0,0',
    `C: fitCacheKey (${fitCacheKey(528, 440 * RETUNE, 0.9, 'C#', RUB)})`);
  check(fitCacheKey(528, 440.00001 * RETUNE, 0.9, 'C#', RUB) !== fitCacheKey(528, 440 * RETUNE, 0.9, 'C#', RUB),
    'C: fitCacheKey keeps full precision (m15): A4s 1e-5 Hz apart are two keys');
  // FIFO: 65 distinct inputs leave 64, and the first is gone.
  clearKeyFitCache();
  const first = keyFitFor(data(RUB, 400, 0.9, 'C#'), 528, 'headphones', RETUNE);
  for (let k = 1; k <= FIT_CACHE_MAX; k++) keyFitFor(data(RUB, 400 + k, 0.9, 'C#'), 528, 'headphones', RETUNE);
  check(keyFitCacheStats().size === FIT_CACHE_MAX && FIT_CACHE_MAX === 64, `C: 65 inputs leave ${keyFitCacheStats().size} entries`);
  const m0 = keyFitCacheStats().misses;
  const again = keyFitFor(data(RUB, 400, 0.9, 'C#'), 528, 'headphones', RETUNE);
  check(keyFitCacheStats().misses === m0 + 1 && again !== first && again.duck_db === first.duck_db, 'C: the first entry was evicted (a miss again)');
  clearKeyFitCache();
  check(keyFitCacheStats().size === 0 && keyFitCacheStats().hits === 0 && keyFitCacheStats().misses === 0, 'C: clear empties it again');
}

// ------------------------------------------------- D. parseKeyFit and the view --

{
  check(parseKeyFit('true') === true && parseKeyFit('false') === false, "D: 'true' / 'false' parse");
  for (const raw of [null, '', '1', 'TRUE', ' true']) check(parseKeyFit(raw) === null, `D: ${JSON.stringify(raw)} is unset`);
  check(DEFAULT_KEY_FIT === true && KEY_FIT_STORAGE_KEY === 'aetheria.keyFit.v1', 'D: on by default (v15.2.1), saved as aetheria.keyFit.v1');
  // App's rule (keyFitChoice ?? DEFAULT_KEY_FIT): a saved tap wins, either way; only an unset profile follows the default.
  check((parseKeyFit('false') ?? DEFAULT_KEY_FIT) === false && (parseKeyFit('true') ?? DEFAULT_KEY_FIT) === true
    && (parseKeyFit(null) ?? DEFAULT_KEY_FIT) === true, 'D: a tapped Off stays off, a tapped On stays on, unset is on');
  check(DUCK_TAU_S === 2 && DUCK_FLIP_TAU_S === 0.05 && DUCK_MIN_STEP_DB === 0.01 && DUCK_MAX_HOLD_S === 7 && NO_DUCK_DB === 0.05
    && DUCK_REST_GUARD_S === 0.5 && DUCK_TRACK_HOLD_S === 1, 'D: the constants');
  // A2: the longest wait App can ask for (a retune's 3.02 s, then a rest within the guard and its 3 s close) is not cut.
  check(DUCK_MAX_HOLD_S >= 3 + 0.02 + DUCK_REST_GUARD_S + DRONE_OUT_S, `D: DUCK_MAX_HOLD_S (${DUCK_MAX_HOLD_S}) covers a retune then a rest's close`);

  const rub9 = keyFitFor(data(RUB, 440, 0.9, 'C#'), 528, 'headphones', RETUNE);
  const rub45 = keyFitFor(data(RUB, 440, 0.45, 'C#'), 528, 'headphones', RETUNE);
  const fit9 = keyFitFor(data(FIT, 440, 0.9, 'F#'), 528, 'headphones', RETUNE);
  const nodata = keyFitFor(null, 528, 'headphones', RETUNE);
  // M1: musicFit's duck is −0 wherever it does not duck; keyFitFor hands out +0.
  check(Object.is(musicFit(528, RUB, 440 * RETUNE, 0.45).duck_db, -0) && Object.is(musicFit(528, FIT, 440 * RETUNE, 0.9).duck_db, -0),
    'D (M1): musicFit gives −0 for an unclear key and for a fitting tone (the leak the wrapper closes)');
  check(Object.is(rub45.duck_db, 0) && Object.is(fit9.duck_db, 0), `D (M1): keyFitFor normalises −0 (${Object.is(rub45.duck_db, -0) ? '−0' : '+0'}, ${Object.is(fit9.duck_db, -0) ? '−0' : '+0'})`);
  const view = (on: boolean, fit: KeyFit | null, hasTrack = true, musicPlaying = true, layersOn = true): KeyFitView =>
    keyFitView({ on, fit, hasTrack, musicPlaying, layersOn });
  const rows: Array<[string, KeyFitView, string, number, number]> = [
    ['no track', view(true, rub9, false), 'no-track', 0, 0],
    ['no data', view(true, nodata), 'no-data', 0, 0],
    ['layers off', view(true, rub9, true, true, false), 'layers-off', -6, 0],
    ['tone alone', view(true, rub9, true, false, true), 'no-music', -6, 0],
    ['unclear', view(true, rub45), 'unclear', 0, 0],
    ['fits', view(true, fit9), 'fits', 0, 0],
    ['ducks, on', view(true, rub9), 'ducks', -6, -6],
    ['ducks, off', view(false, rub9), 'ducks', -6, 0],
  ];
  for (const [name, v, status, would, applied] of rows) {
    check(v.status === status && Object.is(v.wouldDb, would) && Object.is(v.appliedDb, applied),
      `D: ${name}: ${v.status} (${status}), would ${v.wouldDb} (${would}), applied ${v.appliedDb} (${applied})`);
  }
  // B6: without the duck nothing applies (the would-be duck stays for the card); B4: `analysed` rides on 'no-data' only.
  const na = keyFitView({ on: true, fit: rub9, hasTrack: true, musicPlaying: true, layersOn: true, available: false });
  check(na.status === 'ducks' && na.wouldDb === -6 && Object.is(na.appliedDb, 0) && na.available === false,
    `D (B6): no duck → applied +0, would −6 (${na.status}, ${na.wouldDb}, ${na.appliedDb}, ${na.available})`);
  check(view(true, rub9).available === true && view(true, rub9).analysed === false, 'D: available by default, analysed false');
  const an = keyFitView({ on: true, fit: nodata, hasTrack: true, musicPlaying: true, layersOn: true, analysed: true });
  const an2 = keyFitView({ on: true, fit: rub9, hasTrack: true, musicPlaying: true, layersOn: true, analysed: true });
  check(an.status === 'no-data' && an.analysed === true && an2.analysed === false, 'D (B4): analysed is carried for no-data only');
  // M1: a fit object that still carries −0 (one made by hand, as a later caller might) is normalised too.
  const raw = Object.freeze({ ...rub45, duck_db: -0 });
  const vr = view(true, raw);
  check(Object.is(vr.wouldDb, 0) && Object.is(vr.appliedDb, 0), 'D (M1): keyFitView never returns −0');
  // Totality.
  let threw = false;
  const odd: unknown[] = [null, undefined, {}, { on: NaN, fit: { hasChroma: true, duck_db: NaN, strength: NaN }, hasTrack: NaN, musicPlaying: NaN, layersOn: NaN },
    { on: true, fit: { hasChroma: true, duck_db: NaN, strength: 1 }, hasTrack: true, musicPlaying: true, layersOn: true }];
  const outs: KeyFitView[] = [];
  try {
    for (const o of odd) outs.push(keyFitView(o as never));
  } catch {
    threw = true;
  }
  check(!threw && outs.every((v) => v.appliedDb === 0 && Object.is(v.appliedDb, 0) && Object.is(v.wouldDb, 0)), 'D: keyFitView is total on odd inputs, with 0 dB');
  // The log fields: rounded, never −0, null without data.
  const lf = keyFitLogFields(view(true, keyFitFor(data(RUB, 440, 0.6, 'C#'), 528, 'headphones', RETUNE)));
  check(lf.key_fit === true && lf.duck_db === -3 && lf.fit_db === -3 && lf.fit_rel === 0.887 && lf.fit_strength === 0.5
    && lf.fit_tone_hz === 528 && lf.fit_a4_hz === 432 && lf.track_key === 'C#' && lf.key_confidence === 0.6, `D: the log fields (${JSON.stringify(lf)})`);
  const ln = keyFitLogFields(view(false, nodata));
  check(ln.key_fit === false && Object.is(ln.duck_db, 0) && ln.fit_db === null && ln.fit_rel === null && ln.fit_a4_hz === null
    && ln.track_key === null && ln.key_confidence === null && ln.fit_tone_hz === 528, `D: the log fields without data (${JSON.stringify(ln)})`);
  const lu = keyFitLogFields(view(true, rub45));
  check(Object.is(lu.duck_db, 0) && Object.is(lu.fit_db, 0), 'D: the log fields never hold −0');
  check(typeof keyFitLogFields(null as never).duck_db === 'number', 'D: keyFitLogFields is total');
}

// ------------------------------------------------- E. the duck's automation --

const SR = 48000;
const EPS = 1.5 / SR;
interface PCall { m: 'set' | 'tgt' | 'cancel' | 'lin'; v: number; t: number; tau: number }
/** An AudioParam that records every call in order; any .value read and any cancelAndHoldAtTime throw. */
class FakeParam {
  calls: PCall[] = [];
  valueSets = 0;
  reads = 0;
  holds = 0;
  setAfterAutomation = 0;
  get value(): number {
    this.reads++;
    throw new Error('AudioParam.value read');
  }
  set value(_v: number) {
    if (this.calls.length) this.setAfterAutomation++;
    this.valueSets++;
  }
  setValueAtTime(v: number, t: number): this {
    this.calls.push({ m: 'set', v, t, tau: 0 });
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    this.calls.push({ m: 'lin', v, t, tau: 0 });
    return this;
  }
  setTargetAtTime(v: number, t: number, tau: number): this {
    this.calls.push({ m: 'tgt', v, t, tau });
    return this;
  }
  cancelScheduledValues(t: number): this {
    this.calls.push({ m: 'cancel', v: NaN, t, tau: 0 });
    return this;
  }
  cancelAndHoldAtTime(_t: number): this {
    this.holds++;
    throw new Error('cancelAndHoldAtTime called');
  }
}
class FakeNode {
  connects: unknown[] = [];
  disconnects = 0;
  connect(d: unknown): unknown {
    this.connects.push(d);
    return d;
  }
  disconnect(): void {
    this.disconnects++;
    this.connects = [];
  }
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeOsc extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
}
class FakeCtx {
  readonly sampleRate = SR;
  currentTime = 0;
  state = 'running';
  readonly destination = Object.assign(new FakeNode(), { maxChannelCount: 2 });
  gains: FakeGain[] = [];
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createOscillator(): FakeOsc {
    return new FakeOsc();
  }
  createChannelMerger(_n: number): FakeNode {
    return new FakeNode();
  }
}
const asCtx = (c: FakeCtx): BaseAudioContext => c as unknown as BaseAudioContext;
const callsText = (cs: PCall[]): string =>
  cs.map((c) => (c.m === 'cancel' ? `cancel @${c.t}` : c.m === 'tgt' ? `tgt ${c.v} @${c.t} tau ${c.tau}` : `${c.m} ${c.v} @${c.t}`)).join('; ');
/** A duck on a fake context with a virtual clock; warnings collected. */
function fakeDuck(): { duck: KeyFitDuck; ctx: FakeCtx; p: FakeParam; node: FakeGain; clock: { t: number }; warns: string[] } {
  const ctx = new FakeCtx(), clock = { t: 0 }, warns: string[] = [];
  const duck = new KeyFitDuck(asCtx(ctx), ctx.destination as unknown as AudioNode, { clock: () => clock.t, warn: (m) => warns.push(m) });
  const node = ctx.gains[0];
  return { duck, ctx, p: node.gain, node, clock, warns };
}
const G6 = dbToGain(-6), G3 = dbToGain(-3);

{
  // E1: construction.
  const { duck, p, node, ctx } = fakeDuck();
  check(p.valueSets === 1 && p.calls.length === 0 && node.connects.length === 1 && node.connects[0] === ctx.destination
    && (duck.input as unknown) === node, 'E1: gain.value = 1 set once before any automation; input → destination once');
  check(near(G6, 0.5011872336272722, 0) && dbToGain(0) === 1, `E: dbToGain(−6) = ${G6}`);
}
{
  // E2–E5, E8–E9.
  const { duck, p, clock, warns } = fakeDuck();
  clock.t = 10;
  check(duck.setTarget(-6, { tauS: 2 }) === true, 'E2: setTarget(−6) sends');
  check(callsText(p.calls) === `set 1 @10; cancel @${10 + EPS}; tgt 0.5011872336272722 @10 tau 2`, `E2: exactly set 1 @10; cancel @10+1.5/sr; tgt @10 τ 2 (${callsText(p.calls)})`);
  let s = duck.state();
  check(s.target_db === -6 && s.sends === 1 && s.requests === 1 && s.tau_s === 2 && s.start_at === 10 && s.hold_until === null, 'E2: the state after it');
  // E3: the same target (any τ) and a change under 0.01 dB send nothing.
  const n0 = p.calls.length;
  duck.setTarget(-6, { tauS: 0.05 });
  duck.setTarget(-6.009, { tauS: 2 });
  duck.setTarget(-5.991, { tauS: 2 });
  s = duck.state();
  check(p.calls.length === n0 && s.requests === 4 && s.sends === 1, `E3: no send for the same target or within 0.009 dB (requests ${s.requests}, sends ${s.sends})`);
  // E5: a retarget mid-glide anchors at the mirror's exact value.
  clock.t = 11;
  const v11 = G6 + (1 - G6) * Math.exp(-0.5);
  duck.setTarget(-3, { tauS: 2 });
  const last3 = p.calls.slice(-3);
  check(last3.length === 3 && last3[0].m === 'set' && last3[0].t === 11 && near(last3[0].v, v11, 1e-15) && last3[1].m === 'cancel' && last3[1].t === 11 + EPS
    && last3[2].m === 'tgt' && last3[2].t === 11 && last3[2].v === G3 && last3[2].tau === 2, `E5: set v @11 (v = ${v11}); cancel; tgt (${callsText(last3)})`);
  // E4: clamps.
  clock.t = 12;
  duck.setTarget(3, { tauS: 2 });
  check(duck.state().target_db === 0 && p.calls[p.calls.length - 1].m === 'tgt' && p.calls[p.calls.length - 1].v === 1, 'E4: +3 dB glides to exactly 1');
  clock.t = 13;
  duck.setTarget(-9, { tauS: 0 });
  let lt = p.calls[p.calls.length - 1];
  check(duck.state().target_db === -6 && lt.v === G6 && lt.tau === 2, `E4: −9 dB glides to 10^(−6/20), τ 0 → 2 (${lt.v}, τ ${lt.tau})`);
  for (const [tau, want] of [[-1, 2], [NaN, 2], [100, 10], [0.001, 0.01]] as Array<[number, number]>) {
    clock.t += 1;
    duck.setTarget(duck.state().target_db === -6 ? -1 : -6, { tauS: tau });
    lt = p.calls[p.calls.length - 1];
    check(lt.m === 'tgt' && lt.tau === want, `E4: tauS ${tau} → τ ${want} (${lt.tau})`);
  }
  const w0 = warns.length, c0 = p.calls.length;
  duck.setTarget(NaN, { tauS: 2 });
  duck.setTarget(NaN, { tauS: 2 });
  check(p.calls.length === c0 && warns.length === w0 + 1, `E4: NaN warns once and sends nothing (${warns.length - w0} warnings)`);
  // E9: a hold beyond DUCK_MAX_HOLD_S is capped at now + 7.
  clock.t = 30;
  duck.setTarget(-6, { tauS: 0.05 });
  clock.t = 31;
  duck.setTarget(0, { tauS: 2, holdRiseUntil: 40 });
  s = duck.state();
  check(s.start_at === 38 && s.hold_until === 40, `E9: a hold to 40 at 31 starts at 38 (${s.start_at})`);
}
{
  // E6–E8: a held rise, a fall with a hold, a retarget before the held start.
  const { duck, p, clock, warns } = fakeDuck();
  clock.t = 10;
  duck.setTarget(-6, { tauS: 2 });
  clock.t = 20;
  const v20 = G6 + (1 - G6) * Math.exp(-5);
  const n0 = p.calls.length;
  duck.setTarget(0, { tauS: 2, holdRiseUntil: 21.5 });
  const sent = p.calls.slice(n0);
  check(sent.length === 5 && sent[0].m === 'set' && sent[0].t === 20 && near(sent[0].v, v20, 1e-15) && sent[1].m === 'cancel' && sent[1].t === 20 + EPS
    && sent[2].m === 'set' && sent[2].t === 21.5 && near(sent[2].v, v20, 1e-15) && sent[3].m === 'cancel' && sent[3].t === 21.5 + EPS
    && sent[4].m === 'tgt' && sent[4].t === 21.5 && sent[4].v === 1 && sent[4].tau === 2,
  `E6: set v @20; cancel; set v @21.5; cancel; tgt 1 @21.5 τ 2 (${callsText(sent)})`);
  let s = duck.state();
  check(s.start_at === 21.5 && s.hold_until === 21.5 && s.target_db === 0, 'E6: start_at = hold_until = 21.5');
  const tr = (duck as unknown as { track: ParamTrack }).track;
  let flat = true;
  for (let x = 20; x <= 21.5; x += 0.01) if (tr.valueAt(x) !== v20) flat = false;
  check(flat && tr.valueAt(22) > v20, 'E6: the mirror is constant on [20, 21.5], then rises');
  // E8: a retarget at 21 removes the pending set and glide at 21.5.
  clock.t = 21;
  duck.setTarget(-6, { tauS: 2 });
  s = duck.state();
  check(s.events.every((e) => e.t <= 21) && s.events.some((e) => e.type === 'set' && e.t === 21 && e.v === v20) && s.start_at === 21,
    `E8: the retarget at 21 cancelled the held start at 21.5 (${JSON.stringify(s.events)})`);
  // E7: a fall with a hold starts at once.
  const d2 = fakeDuck();
  d2.clock.t = 5;
  d2.duck.setTarget(-6, { tauS: 2, holdRiseUntil: 30 });
  check(d2.duck.state().start_at === 5 && d2.p.calls.length === 3 && d2.p.calls[2].t === 5, 'E7: a fall ignores the hold and starts at once');
  check(warns.length === 0 && d2.warns.length === 0, `E6–E8: no warnings (${warns.join('; ')})`);
}
{
  // E10: two calls in one clock reading leave the second's glide alone, with no warning (spec), and M3's version:
  // from −6, setTarget(−3) then setTarget(0, { holdRiseUntil: t + 1.5 }) at one clock value hold the mirror constant on
  // [t, t + 1.5] with one glide from there.
  const { duck, p, clock, warns } = fakeDuck();
  clock.t = 1;
  duck.setTarget(-6, { tauS: 0.05 });
  clock.t = 5;
  duck.setTarget(-3, { tauS: 2 });
  duck.setTarget(-1, { tauS: 2 });
  let s = duck.state();
  const tgts = s.events.filter((e) => e.type === 'tgt' && e.t >= 5);
  check(tgts.length === 1 && tgts[0].v === dbToGain(-1) && warns.length === 0, `E10: two calls at 5: one glide, the second's (${JSON.stringify(tgts)}, ${warns.length} warnings)`);
  clock.t = 8;
  duck.setTarget(-6, { tauS: 0.05 });
  clock.t = 10;
  const v10 = (duck as unknown as { track: ParamTrack }).track.valueAt(10);
  duck.setTarget(-3, { tauS: 2 });
  duck.setTarget(0, { tauS: 2, holdRiseUntil: 11.5 });
  s = duck.state();
  const tr = (duck as unknown as { track: ParamTrack }).track;
  let flat = true;
  for (let x = 10; x < 11.5; x += 0.005) if (tr.valueAt(x) !== v10) flat = false;
  const after = s.events.filter((e) => e.type === 'tgt' && e.t >= 10);
  check(flat && after.length === 1 && after[0].t === 11.5 && after[0].v === 1 && warns.length === 0,
    `E10 (M3): from −6, −3 then a held 0 at one clock value: constant on [10, 11.5], one glide (${JSON.stringify(after)}), ${warns.length} warnings (${warns.join('; ')})`);
  check(p.holds === 0 && p.reads === 0, 'E10: no cancelAndHold, no .value read');
}
{
  // E11: 1000 alternating retargets 0.5 s apart leave ≤ 10 events (prune).
  const { duck, clock } = fakeDuck();
  for (let k = 0; k < 1000; k++) {
    clock.t = 1 + k * 0.5;
    duck.setTarget(k % 2 ? 0 : -6, { tauS: 2 });
  }
  const n = duck.state().events.length;
  check(n <= 10, `E11: ${n} events after 1000 retargets`);
}
{
  // E12: dispose.
  const { duck, p, node, clock, warns } = fakeDuck();
  clock.t = 2;
  duck.setTarget(-6, { tauS: 2 });
  duck.dispose();
  duck.dispose();
  const c0 = p.calls.length;
  clock.t = 3;
  const r1 = duck.setTarget(0, { tauS: 2 }), r2 = duck.setTarget(-3, { tauS: 2 });
  const s = duck.state();
  check(node.disconnects === 1 && duck.disposed && !r1 && !r2 && p.calls.length === c0 && warns.length === 1 && s.target_db === -6 && s.requests === 3,
    `E12: dispose disconnects once; later setTarget warns once and sends nothing; state() still works (${node.disconnects}, ${warns.length})`);
}
{
  // E13 (M1): −0 never reaches the target.
  const { duck, p, clock } = fakeDuck();
  clock.t = 1;
  duck.setTarget(-0, { tauS: 2 });
  check(p.calls.length === 0 && Object.is(duck.state().target_db, 0), 'E13 (M1): setTarget(−0) on a fresh duck sends nothing and the target stays +0');
  duck.setTarget(-6, { tauS: 2 });
  clock.t = 2;
  duck.setTarget(-0, { tauS: 2 });
  const s = duck.state();
  check(Object.is(s.target_db, 0) && p.calls[p.calls.length - 1].v === 1, `E13 (M1): from −6, setTarget(−0) targets +0 (${Object.is(s.target_db, -0) ? '−0' : '+0'})`);
  // keyFitFor's −0 source, through the view, to the duck.
  const v = keyFitView({ on: true, fit: keyFitFor(data(FIT, 440, 0.9, 'F#'), 528, 'headphones', RETUNE), hasTrack: true, musicPlaying: true, layersOn: true });
  clock.t = 3;
  duck.setTarget(-6, { tauS: 2 });
  clock.t = 4;
  duck.setTarget(v.appliedDb, { tauS: 2 });
  check(Object.is(duck.state().target_db, 0), 'E13 (M1): a fitting track\'s applied duck reaches the duck as +0');
}
{
  // E14 (M2(a)): holdRise.
  const { duck, p, clock, warns } = fakeDuck();
  clock.t = 1;
  duck.setTarget(-6, { tauS: 0.05 });
  clock.t = 3;
  const c0 = p.calls.length, s0 = duck.state();
  check(duck.holdRise() === false && p.calls.length === c0, 'E14: holdRise with no rise under way does nothing');
  check(duck.state().holds === 1 && duck.state().held === 0 && duck.state().requests === s0.requests, 'E14: counted in holds, not requests');
  clock.t = 4;
  duck.setTarget(0, { tauS: 0.05 }); // a switch-off rise
  clock.t = 4.02;
  const tr = (duck as unknown as { track: ParamTrack }).track;
  const v = tr.valueAt(4.02);
  const c1 = p.calls.length, sends1 = duck.state().sends, req1 = duck.state().requests;
  check(duck.holdRise() === true, 'E14: holdRise stops a rise in flight');
  const sent = p.calls.slice(c1);
  let s = duck.state();
  check(sent.length === 2 && sent[0].m === 'set' && sent[0].t === 4.02 && near(sent[0].v, v, 1e-15) && sent[1].m === 'cancel' && sent[1].t === 4.02 + EPS,
    `E14: an anchor at now, nothing more (${callsText(sent)})`);
  check(near(s.target_db, 20 * Math.log10(v), 1e-12) && s.start_at === 4.02 && s.held === 1 && s.requests === req1 && s.sends === sends1
    && tr.valueAt(9) === v, `E14: the target is the held value (${s.target_db} dB), constant after; requests and sends unchanged`);
  clock.t = 5;
  check(duck.setTarget(0, { tauS: 2 }) === true && duck.state().target_db === 0, 'E14: the next wanted send goes out');
  // holdRise(resumeAt): the rest of the rise resumes there, toward the same target and τ.
  clock.t = 6;
  duck.setTarget(-6, { tauS: 0.05 });
  clock.t = 7;
  duck.setTarget(0, { tauS: 0.05 });
  clock.t = 7.03;
  const v7 = tr.valueAt(7.03);
  duck.holdRise(9);
  s = duck.state();
  let flat = true;
  for (let x = 7.03; x < 9; x += 0.01) if (tr.valueAt(x) !== v7) flat = false;
  const tg = s.events.filter((e) => e.type === 'tgt' && e.t > 7.03);
  check(flat && s.target_db === 0 && s.start_at === 9 && tg.length === 1 && tg[0].t === 9 && tg[0].v === 1 && (tg[0] as { tau: number }).tau === 0.05,
    `E14: holdRise(9) holds until 9, then the same rise (τ 0.05) resumes (${JSON.stringify(tg)})`);
  // A resume never comes before a start already waiting, and is capped at now + 7.
  clock.t = 12;
  duck.setTarget(-6, { tauS: 0.05 });
  clock.t = 13;
  duck.setTarget(0, { tauS: 2, holdRiseUntil: 15 });
  clock.t = 13.5;
  duck.holdRise(14);
  check(duck.state().start_at === 15, `E14: a resume at 14 keeps the start waiting until 15 (${duck.state().start_at})`);
  clock.t = 14;
  duck.holdRise(30);
  check(duck.state().start_at === 21, `E14: a resume at 30 from 14 is capped at 21 (${duck.state().start_at})`);
  // In the same clock reading as the call that started the rise, holdRise cancels that rise.
  clock.t = 25;
  duck.setTarget(-6, { tauS: 0.05 });
  clock.t = 26;
  const v26 = tr.valueAt(26);
  duck.setTarget(0, { tauS: 0.05 });
  duck.holdRise();
  check(near(tr.valueAt(27), v26, 0) && near(duck.state().target_db, 20 * Math.log10(v26), 1e-12) && warns.length === 0,
    `E14: a hold in the rise's own clock reading leaves the duck where it was (${warns.join('; ')})`);
  check(p.reads === 0 && p.holds === 0 && p.calls.every((c) => c.t >= 0), 'E14: no .value read, no cancelAndHold');
  duck.dispose();
  check(duck.holdRise() === false && warns.length === 1, 'E14: holdRise after dispose warns once and does nothing');
}
{
  // E15: hygiene over a busy session: no .value read, no cancelAndHold, no ramp, nothing before the clock.
  const { duck, p, clock } = fakeDuck();
  let past = 0;
  const seq: Array<[number, () => void]> = [];
  for (let k = 0; k < 200; k++) {
    const t = 1 + k * 0.37;
    seq.push([t, () => (k % 7 === 3 ? duck.holdRise(k % 2 ? t + 1 : null) : duck.setTarget(-((k * 1.7) % 6), { tauS: k % 3 ? 2 : 0.05, holdRiseUntil: k % 5 ? null : t + 1.2 }))]);
  }
  for (const [t, fn] of seq) {
    clock.t = t;
    const n = p.calls.length;
    fn();
    past += p.calls.slice(n).filter((c) => c.t < t).length;
  }
  check(p.reads === 0 && p.holds === 0 && past === 0 && p.calls.every((c) => c.m !== 'lin') && p.setAfterAutomation === 0,
    `E15: ${p.calls.length} calls: no .value read, no cancelAndHold, no ramp, ${past} events in the past`);
}
{
  // E16 (review A5): a rise held a hair under unity (within the 0.01 dB minimum step) still goes back to exactly 1
  // when Key fit asks for unity (off), so D15 holds; any other target within the step still sends nothing.
  const { duck, p, clock, warns } = fakeDuck();
  const tr = (duck as unknown as { track: ParamTrack }).track;
  clock.t = 1;
  duck.setTarget(-6, { tauS: 0.05 });
  clock.t = 3;
  duck.setTarget(0, { tauS: 0.05 }); // the switch off
  clock.t = 3.35; // 7 τ in: 1 − 0.5 e^−7 = 0.99954 (−0.004 dB)
  duck.holdRise(); // a pause
  const held = duck.state().target_db;
  check(held < 0 && held > -DUCK_MIN_STEP_DB, `E16: the held target is a hair under unity (${held} dB)`);
  clock.t = 5;
  const c0 = p.calls.length;
  check(duck.setTarget(0, { tauS: 2 }) === true && p.calls.length > c0 && duck.state().target_db === 0 && tr.valueAt(400) === 1,
    `E16 (A5): setTarget(0) from ${held} dB sends, and the mirror ends at exactly 1 (${tr.valueAt(400)})`);
  // Fresh and at unity: still nothing (D15); a non-unity target within the step: still nothing.
  const d2 = fakeDuck();
  d2.clock.t = 1;
  check(d2.duck.setTarget(0, { tauS: 2 }) === false && d2.p.calls.length === 0, 'E16: a fresh duck sent 0 dB sends nothing (D15)');
  d2.duck.setTarget(-3, { tauS: 2 });
  d2.clock.t = 2;
  const c1 = d2.p.calls.length;
  check(d2.duck.setTarget(-3.005, { tauS: 2 }) === false && d2.p.calls.length === c1, 'E16: −3 → −3.005 dB still sends nothing');
  check(warns.length === 0 && d2.warns.length === 0, 'E16: no warnings');
}
{
  // E17 (review A4): a fall sent while the layers are silent glides with the switch's τ (0.05 s), so it has landed by
  // the time the gates open; a rise, or a fall with sound, keeps its τ.
  const { duck, p, clock } = fakeDuck();
  clock.t = 1;
  duck.setTarget(-6, { tauS: 2, silent: true });
  let lt = p.calls[p.calls.length - 1];
  check(lt.m === 'tgt' && lt.tau === DUCK_FLIP_TAU_S && lt.t === 1 && duck.state().tau_s === DUCK_FLIP_TAU_S && duck.state().start_at === 1,
    `E17: a silent fall glides with τ ${DUCK_FLIP_TAU_S} from now (τ ${lt.tau} at ${lt.t})`);
  clock.t = 10;
  duck.setTarget(0, { tauS: 2, silent: true, holdRiseUntil: 10.05 });
  lt = p.calls[p.calls.length - 1];
  check(lt.m === 'tgt' && lt.tau === 2 && lt.t === 10.05, `E17: a silent rise keeps τ 2 and its hold (τ ${lt.tau} at ${lt.t})`);
  clock.t = 20;
  duck.setTarget(-6, { tauS: 2, silent: false });
  lt = p.calls[p.calls.length - 1];
  check(lt.m === 'tgt' && lt.tau === 2, `E17: a fall with sound keeps τ 2 (${lt.tau})`);
  clock.t = 30;
  duck.setTarget(0, { tauS: 2 });
  clock.t = 60;
  duck.setTarget(-2, { tauS: 0.01, silent: true });
  check(p.calls[p.calls.length - 1].tau === 0.01, 'E17: a silent fall never slows a faster τ');
}

// ------------------------------------------- F. continuity (an independent evaluator) --

interface FEv { type: 'set' | 'tgt'; t: number; v: number; tau: number }
/** The final timeline of a param's calls by the Web Audio spec: a same-type same-time event replaces, a cancel drops
 *  every event at or after its time. */
function timelineOf(calls: PCall[]): FEv[] {
  let ev: FEv[] = [];
  for (const c of calls) {
    if (c.m === 'cancel') {
      ev = ev.filter((e) => e.t < c.t);
      continue;
    }
    if (c.m === 'lin') throw new Error('a ramp: the duck must never send one');
    const e: FEv = { type: c.m, t: c.t, v: c.v, tau: c.tau };
    const j = ev.findIndex((x) => x.t === e.t && x.type === e.type);
    if (j >= 0) ev[j] = e;
    else {
      let k = ev.length;
      while (k > 0 && ev[k - 1].t > e.t) k--;
      ev.splice(k, 0, e);
    }
  }
  return ev;
}
/** A forward sampler of a timeline (times must not decrease): a set holds; a glide decays from the value at its start. */
function sampler(ev: FEv[], init: number): (x: number) => number {
  let k = 0;
  let hold = init, glide: { t0: number; v0: number; target: number; tau: number } | null = null;
  const at = (x: number): number => (glide ? glide.target + (glide.v0 - glide.target) * Math.exp(-(x - glide.t0) / glide.tau) : hold);
  return (x: number): number => {
    while (k < ev.length && ev[k].t <= x) {
      const e = ev[k];
      if (e.type === 'set') {
        hold = e.v;
        glide = null;
      } else glide = { t0: e.t, v0: at(e.t), target: e.v, tau: e.tau };
      k++;
    }
    return at(x);
  };
}

// The scripted session: setTarget(db, τ, hold) or holdRise(resumeAt) at t. τs are literals, used again below.
type FStep = { t: number; db: number; tau: number; hold?: number } | { t: number; holdRise: true; resumeAt?: number };
const F_SCRIPT: FStep[] = [
  { t: 1, db: -6, tau: 2 },
  { t: 8, db: 0, tau: 0.05 }, // the switch off
  { t: 9, db: -6, tau: 0.05 }, // and on
  { t: 10, db: -3, tau: 2 }, // a track
  { t: 11, db: -5, tau: 2 }, // a retarget
  { t: 14, db: 0, tau: 2, hold: 15.5 }, // a held rise (a retune's silence)
  { t: 20, db: -6, tau: 2 }, // a fall
  { t: 24, db: 0, tau: 0.05 }, // the switch off ...
  { t: 24.03, holdRise: true }, // ... and a pause 30 ms later (M2(a))
  { t: 25, db: 0, tau: 2 }, // the resume's send
  { t: 27, db: -6, tau: 0.05 },
  { t: 27.5, db: 0, tau: 0.05 }, // the switch off ...
  { t: 27.52, holdRise: true, resumeAt: 28.5 }, // ... and a seek: the rest of the rise waits for the host's glide
];
const F_END = 31;
{
  const { duck, p, clock, warns } = fakeDuck();
  for (const st of F_SCRIPT) {
    clock.t = st.t;
    if ('holdRise' in st) duck.holdRise(st.resumeAt ?? null);
    else duck.setTarget(st.db, { tauS: st.tau, holdRiseUntil: st.hold ?? null });
  }
  const ev = timelineOf(p.calls);
  const f = sampler(ev, 1);
  // The design, from the script alone: at each step, the glide it asks for (its literal target and τ) from when it
  // starts, or a hold. A rise waits for its hold; a holdRise holds, then (with resumeAt) the previous glide resumes.
  interface Seg { from: number; until: number; target: number | null; tau: number }
  const segs: Seg[] = [];
  let prev: { target: number; tau: number } = { target: 1, tau: 2 };
  const vAt = (t: number): number => sampler(ev, 1)(t);
  for (let i = 0; i < F_SCRIPT.length; i++) {
    const st = F_SCRIPT[i], next = i + 1 < F_SCRIPT.length ? F_SCRIPT[i + 1].t : F_END;
    if ('holdRise' in st) {
      if (st.resumeAt !== undefined) {
        segs.push({ from: st.t, until: st.resumeAt, target: null, tau: 0 }, { from: st.resumeAt, until: next, target: prev.target, tau: prev.tau });
      } else segs.push({ from: st.t, until: next, target: null, tau: 0 });
      continue;
    }
    const g = dbToGain(st.db);
    const rising = g > vAt(st.t) + 1e-9;
    const start = rising && st.hold !== undefined ? Math.min(st.hold, st.t + DUCK_MAX_HOLD_S) : st.t;
    if (start > st.t) segs.push({ from: st.t, until: start, target: null, tau: 0 });
    segs.push({ from: start, until: next, target: g, tau: st.tau });
    prev = { target: g, tau: st.tau };
  }
  const segAt = (x: number): Seg => {
    let s = segs[0];
    for (const g of segs) if (g.from <= x) s = g;
    return s;
  };
  let lo = Infinity, hi = -Infinity, worstRatio = 0, where = '', steps = 0, held = true;
  const N = Math.round(F_END * SR);
  let vPrev = f(0);
  const flatSpans: Array<[number, number, number]> = [[14, 15.5, sampler(ev, 1)(14)]];
  const v24 = sampler(ev, 1)(24.03), v27 = sampler(ev, 1)(27.52);
  flatSpans.push([24.03, 25, v24], [27.52, 28.5, v27]);
  for (let n = 1; n <= N; n++) {
    const x = n / SR, xp = (n - 1) / SR;
    const v = f(x);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    const slope = (s: Seg, at: number): number => (s.target === null ? 0 : Math.abs(s.target - at) * (1 - Math.exp(-1 / (s.tau * SR))));
    const bound = 1.02 * Math.max(slope(segAt(xp), vPrev), slope(segAt(x), vPrev)) + 1e-12;
    const step = Math.abs(v - vPrev);
    if (step > 0) steps++;
    const r = step / bound;
    if (r > worstRatio) {
      worstRatio = r;
      where = `${x.toFixed(5)} s (step ${step.toExponential(3)}, bound ${bound.toExponential(3)})`;
    }
    for (const [a, b, want] of flatSpans) if (x >= a && x < b && v !== want) held = false;
    vPrev = v;
  }
  check(lo >= 0.5011 && hi <= 1.0000001, `F: every value in [0.5011, 1.0000001] (${lo}, ${hi})`);
  check(worstRatio <= 1, `F: every sample step ≤ 1.02 × the designed slope + 1e-12 (worst ${worstRatio.toFixed(4)} of the bound at ${where})`);
  check(held, 'F: constant on [14, 15.5] (the held rise), [24.03, 25) (holdRise) and [27.52, 28.5) (holdRise with a resume)');
  check(warns.length === 0 && p.reads === 0 && p.holds === 0 && steps > 0, `F: no warnings (${warns.join('; ')})`);
  console.log(`  F: ${N} samples at 48 kHz; worst step ${worstRatio.toFixed(4)} of 1.02 × the designed slope`);
}

// ---------------------------------------------------------------- G. copy --

{
  type O = { hasTrack?: boolean; musicPlaying?: boolean; layersOn?: boolean; available?: boolean; analysed?: boolean; hz?: number };
  const v = (on: boolean, s: KeyData | null, o: O = {}): KeyFitView =>
    keyFitView({ on, fit: keyFitFor(s, o.hz ?? 528, 'headphones', RETUNE), hasTrack: o.hasTrack ?? true, musicPlaying: o.musicPlaying ?? true,
      layersOn: o.layersOn ?? true, available: o.available, analysed: o.analysed });
  const RUB9 = data(RUB, 440, 0.9, 'C#'), RUB6 = data(RUB, 440, 0.6, 'C#'), RUB45 = data(RUB, 440, 0.45, 'C#'), FIT9 = data(FIT, 440, 0.9, 'F#');
  // B5: the tone rubs (rel 0.887) but the key is barely clear (confidence 0.46: strength 0.0033, −0.02 dB): no duck, and
  // no "sits well" either.
  const RUB46 = data(RUB, 440, 0.46, 'C#');
  const rel = (pct: number, tail: string): string =>
    `The 528 Hz tone is ${pct} % of the way from the smoothest to the roughest pitch in the octave around it${tail}`;
  const heard = (k: string, c: string): string => `${k}, confidence ${c}, heard at A = 432.0 Hz.`;
  const rows: Array<[string, KeyFitView, string, string, string, string]> = [
    ['RUB 0.9 on', v(true, RUB9), 'Key fit −6.0 dB',
      `${heard('C# major', '0.90')} ${rel(89, ', so the layers are 6.0 dB softer.')}`,
      'duck', 'On. On this track the layers are 6.0 dB softer.'],
    ['RUB 0.9 off', v(false, RUB9), 'Key fit off', 'Key fit is off: the layers play at their set level.', 'plain',
      'Off. On this track it would make the layers 6.0 dB softer.'],
    ['RUB 0.6 on', v(true, RUB6), 'Key fit −3.0 dB',
      `${heard('C# major', '0.60')} ${rel(89, ', so the layers are 3.0 dB softer.')}`,
      'duck', 'On. On this track the layers are 3.0 dB softer.'],
    ['RUB 0.6 off', v(false, RUB6), 'Key fit off', 'Key fit is off: the layers play at their set level.', 'plain',
      'Off. On this track it would make the layers 3.0 dB softer.'],
    ['RUB 0.45 on', v(true, RUB45), 'Key fit 0 dB', "This track's key is unclear (confidence 0.45), so the layers stay at their set level.", 'plain',
      "On. This track's key is unclear, so it changes nothing."],
    ['RUB 0.45 off', v(false, RUB45), 'Key fit off', 'Key fit is off: the layers play at their set level.', 'plain',
      "Off. This track's key is unclear, so it would change nothing."],
    ['FIT on', v(true, FIT9), 'Key fit 0 dB',
      `${heard('F# major', '0.90')} ${rel(0, ': no change.')}`, 'plain',
      'On. The tone sits well with this track: no change.'],
    ['FIT off', v(false, FIT9), 'Key fit off', 'Key fit is off: the layers play at their set level.', 'plain',
      'Off. The tone sits well with this track: it would change nothing.'],
    ['no data on', v(true, null), 'Key fit · no key data', 'This track has no key data yet. Analyse tracks gives it some.', 'none',
      'On. This track has no key data yet: run Analyse tracks.'],
    ['no data off', v(false, null), 'Key fit off', 'Key fit is off: the layers play at their set level.', 'none', 'Off. This track has no key data yet.'],
    ['tone alone on', v(true, RUB9, { musicPlaying: false }), 'Key fit · tone alone',
      'No music is playing, so there is nothing to fit: the tone plays at its set level.', 'plain',
      'On. No music is playing, so the tone plays at its set level.'],
    ['tone alone off', v(false, RUB9, { musicPlaying: false }), 'Key fit off', 'Key fit is off: the layers play at their set level.', 'plain', 'Off.'],
    ['no track on', v(true, RUB9, { hasTrack: false }), 'Key fit · tone alone',
      'No music is playing, so there is nothing to fit: the tone plays at its set level.', 'plain', 'On. Play a track to see how it fits.'],
    ['no track off', v(false, RUB9, { hasTrack: false }), 'Key fit off', 'Key fit is off: the layers play at their set level.', 'plain', 'Off.'],
    // B5: a rubbing tone under a barely clear key.
    ['RUB 0.46 on', v(true, RUB46), 'Key fit 0 dB',
      `${heard('C# major', '0.46')} ${rel(89, ', but the key is barely clear, so the layers stay at their set level.')}`, 'plain',
      "On. This track's key is barely clear, so it changes nothing."],
    ['RUB 0.46 off', v(false, RUB46), 'Key fit off', 'Key fit is off: the layers play at their set level.', 'plain',
      "Off. This track's key is barely clear, so it would change nothing."],
    // B3: the layers off (Music only, paused) and a frequency with no crystal tone: nothing applies now.
    ['layers off on', v(true, RUB9, { layersOn: false }), 'Key fit off', 'The layers are off.', 'plain',
      'On. The layers are off now; on this track they would be 6.0 dB softer.'],
    ['layers off off', v(false, RUB9, { layersOn: false }), 'Key fit off', 'Key fit is off: the layers play at their set level.', 'plain',
      'Off. On this track it would make the layers 6.0 dB softer.'],
    ['layers off, fits, on', v(true, FIT9, { layersOn: false }), 'Key fit off', 'The layers are off.', 'plain', 'On. The tone sits well with this track: no change.'],
    ['no crystal tone on', v(true, RUB9, { layersOn: false, hz: 0 }), 'Key fit off', 'The layers are off.', 'plain', 'On. The layers are off now, so it changes nothing.'],
    ['no crystal tone off', v(false, RUB9, { layersOn: false, hz: 0 }), 'Key fit off', 'Key fit is off: the layers play at their set level.', 'plain', 'Off.'],
    // B4: analysed, no usable key data (an empty or too-short track: never retried).
    ['analysed, no key on', v(true, null, { analysed: true }), 'Key fit · no key data',
      'Analyse tracks found no clear key in this track, so the layers stay at their set level.', 'none', 'On. Analyse tracks found no clear key in this track: no change.'],
    ['analysed, no key off', v(false, null, { analysed: true }), 'Key fit off', 'Key fit is off: the layers play at their set level.', 'none',
      'Off. Analyse tracks found no clear key in this track.'],
    // B6: the duck could not be made.
    ['no duck on', v(true, RUB9, { available: false }), 'Key fit · unavailable',
      'Key fit could not start on this device, so the layers play at their set level.', 'none',
      'On. Key fit could not start on this device, so the layers play at their set level.'],
    ['no duck off', v(false, RUB9, { available: false }), 'Key fit off', 'Key fit is off: the layers play at their set level.', 'plain',
      'Off. On this track it would make the layers 6.0 dB softer.'],
  ];
  // B1: no Key fit string names the tone, beat and drone (Car plays the tone alone; Speakers and Phone no drone).
  const all = [KEY_FIT_DESCRIPTION, ...rows.flatMap(([, view]) => [keyFitChipText(view), keyFitChipTitle(view), keyFitRowText(view)])];
  check(all.every((x) => !/\bbeat\b|\bdrone\b/.test(x)), `G (B1): no Key fit string names the beat or the drone (${all.filter((x) => /\bbeat\b|\bdrone\b/.test(x)).join(' | ')})`);
  for (const [name, view, chip, title, tone, row] of rows) {
    const got = [keyFitChipText(view), keyFitChipTitle(view), keyFitChipTone(view), keyFitRowText(view)];
    check(got[0] === chip && got[1] === title && got[2] === tone && got[3] === row, `G: ${name}: ${JSON.stringify(got)}`);
  }
  check(keyFitChipText(v(true, RUB6)) === 'Key fit −3.0 dB' && keyFitChipText(v(true, RUB6)).includes('−'),
    'G: −2.9999999999999987 reads "Key fit −3.0 dB", with U+2212');
  const keyed = (k: string): string => keyFitChipTitle(v(true, data(RUB, 440, 0.9, k)));
  check(keyed('C#m').startsWith('C# minor,') && keyed('C').startsWith('C major,') && keyed('').startsWith('No clear key,'),
    `G: key names (${keyed('C#m').slice(0, 9)} / ${keyed('C').slice(0, 8)} / ${keyed('').slice(0, 13)})`);
  let threw = false;
  const odd: unknown[] = [null, undefined, {}, { on: true, status: 'ducks', wouldDb: NaN, appliedDb: NaN, fit: { hasChroma: true, rel: NaN, toneHz: NaN, a4Heard: NaN, keyConfidence: NaN, strength: NaN } },
    { on: true, status: 'sideways', wouldDb: -3, appliedDb: -3, fit: null }];
  try {
    for (const o of odd) {
      for (const fn of [keyFitChipText, keyFitChipTitle, keyFitRowText, keyFitChipTone]) {
        if (typeof (fn as (x: unknown) => unknown)(o) !== 'string') threw = true;
      }
    }
  } catch {
    threw = true;
  }
  check(!threw, 'G: the four helpers return strings for null, undefined, {}, NaN numbers and an unknown status');
}

// ------------------------------------------------- H. holds and the rise start --

{
  const st = (o: Partial<LayerPlayerState> & { t?: number }): LayerPlayerState => ({
    sound_version: 2, player_version: 1, t: 10, phase: 'open', sounding: null, requested: null, retune_at: null,
    gates: { tone_beat: 1, drone: 1 }, host_level: 0.8, gains: { tone: 1, beat: 1, drone: 1 }, mono_output: false,
    drone: { resting: false, on_s: 100, quiet_s: 0, rest_ends_at: null, next_rest_at: 1110 }, ...o,
  }) as LayerPlayerState;
  check(riseHoldFrom(st({ phase: 'retuning', retune_at: 12.3 })) === 12.3, 'H: retuning → retune_at');
  check(riseHoldFrom(st({ phase: 'open' })) === null, 'H: open → null');
  const resting = { resting: true, on_s: 0, quiet_s: 0, rest_ends_at: 600, next_rest_at: 1800 };
  check(riseHoldFrom(st({ gates: { tone_beat: 1, drone: 0.5 }, drone: resting })) === 11.5, 'H: a resting drone at 0.5 → t + 1.5');
  check(riseHoldFrom(st({ gates: { tone_beat: 1, drone: 0 }, drone: resting })) === null, 'H: a rested drone at 0 → null');
  check(riseHoldFrom(st({ phase: 'retuning', retune_at: 11, gates: { tone_beat: 0, drone: 0.5 }, drone: resting })) === 11.5
    && riseHoldFrom(st({ phase: 'retuning', retune_at: 12.3, gates: { tone_beat: 0, drone: 0.5 }, drone: resting })) === 12.3, 'H: both → the later');
  // M2(b): a rest about to start.
  const soon = (dt: number): number | null => riseHoldFrom(st({ drone: { resting: false, on_s: 1199, quiet_s: 0, rest_ends_at: null, next_rest_at: 10 + dt } }));
  check(soon(0.3) === 10.3 + DRONE_OUT_S && soon(0.5) === 10.5 + DRONE_OUT_S && soon(0) === 10 + DRONE_OUT_S,
    `H (M2(b)): a drone rest within 0.5 s holds a rise to its close's end (${soon(0.3)}, ${soon(0.5)}, ${soon(0)})`);
  check(soon(0.51) === null && soon(-0.1) === null, 'H (M2(b)): a rest further off, or already past, holds nothing');
  check(laterHold(soon(0.2), 12.3) === 13.2 && riseHoldFrom(st({ phase: 'retuning', retune_at: 14, drone: { resting: false, on_s: 1199, quiet_s: 0, rest_ends_at: null, next_rest_at: 10.2 } })) === 14,
    'H (M2(b)): the rest guard and a retune: the later');
  let threw = false;
  const odd: unknown[] = [null, undefined, {}, { phase: 'retuning', retune_at: NaN }, { t: NaN, gates: { drone: NaN }, drone: { resting: true, next_rest_at: NaN } },
    { phase: 'retuning', retune_at: Infinity }, { t: 1, gates: null, drone: null }];
  try {
    for (const o of odd) if (riseHoldFrom(o as never) !== null) threw = true;
  } catch {
    threw = true;
  }
  check(!threw, 'H: null, {} and NaN fields → null, never a throw');
  check(riseStart({ now: 5, rising: false, holdUntil: 9 }) === 5 && riseStart({ now: 5, rising: true, holdUntil: null }) === 5
    && riseStart({ now: 5, rising: true, holdUntil: 4 }) === 5 && riseStart({ now: 5, rising: true, holdUntil: 14 }) === 12
    && riseStart({ now: 5, rising: true, holdUntil: 6.5 }) === 6.5, 'H: riseStart: a fall, no hold and a past hold start now; a far hold is capped at now + 7');
  check(hostGlideHold(10, 1.2) === 11.2 && hostGlideHold(10, 0) === null && hostGlideHold(10, -1) === null && hostGlideHold(NaN, 1) === null
    && hostGlideHold(10, NaN) === null, 'H (M2(b)): hostGlideHold');
  check(laterHold(null, null) === null && laterHold(3, null) === 3 && laterHold(null, 4) === 4 && laterHold(3, 4) === 4 && laterHold(NaN, 2) === 2,
    'H: laterHold');

  // Review A2: the rest guard where a held rise starts. A rest at 12 (t 10): a start at 10 is outside the 0.5 s guard;
  // at 11.6, 12.2 or 14.9 the rise would meet the rest's close (12 → 15); at 15 the close is over.
  const restAt = (r: number, o: Partial<LayerPlayerState> = {}): LayerPlayerState => st({ drone: { resting: false, on_s: 1199, quiet_s: 0, rest_ends_at: null, next_rest_at: r }, ...o });
  check(restGuardAt(restAt(12), 10) === null && restGuardAt(restAt(12), 11.6) === 15 && restGuardAt(restAt(12), 12.2) === 15
    && restGuardAt(restAt(12), 14.9) === 15 && restGuardAt(restAt(12), 15) === null && restGuardAt(restAt(12), 11.4) === null,
  `H (A2): restGuardAt (${[10, 11.6, 12.2, 14.9, 15, 11.4].map((a) => restGuardAt(restAt(12), a)).join(', ')})`);
  check(restGuardAt(st({ gates: { tone_beat: 1, drone: 0.5 }, drone: resting }), 10.5) === 11.5 && restGuardAt(st({ gates: { tone_beat: 1, drone: 0.5 }, drone: resting }), 11.5) === null,
    'H (A2): restGuardAt: a resting drone still closing at the start holds to its close');
  for (const r of [10.3, 10.5, 11, 1110]) {
    check(restGuardAt(restAt(r), 10) === (riseHoldFrom(restAt(r)) === null ? null : r + DRONE_OUT_S), `H (A2): restGuardAt at now is riseHoldFrom's rest part (rest at ${r})`);
  }
  check(riseHold(restAt(12), 11.9) === 15 && riseHold(restAt(12), 11.4) === 11.4 && riseHold(restAt(12), null) === null,
    `H (A2): riseHold moves a held start past the rest it would meet (${riseHold(restAt(12), 11.9)}, ${riseHold(restAt(12), 11.4)})`);
  check(riseHold(st({ phase: 'retuning', retune_at: 13.02, drone: { resting: false, on_s: 1199, quiet_s: 0, rest_ends_at: null, next_rest_at: 13.4 } })) === 16.4,
    'H (A2): a retune whose reopening meets a rest waits for the rest\'s close (13.4 + 3)');
  check(riseHold(st({}), 9.5) === null && riseHold(st({}), 10) === null && riseHold(null, 11) === 11 && riseHold(st({}), 11, null, 10.5) === 11,
    'H: riseHold: a past hold holds nothing; without a state, the latest of the holds');
  check(riseHold(st({ phase: 'retuning', retune_at: 12.3 })) === riseHoldFrom(st({ phase: 'retuning', retune_at: 12.3 })), 'H: riseHold is riseHoldFrom with no extra');

  // Review A1: userFallEnd.
  const on = (g: Partial<LayerPlayerState> = {}): LayerPlayerState => st(g);
  check(userFallEnd(on(), { tone: 1, beat: 1, drone: 0 }) === 10 + DRONE_OUT_S && userFallEnd(on(), { tone: 0, beat: 1, drone: 1 }) === 10 + GATE_OUT_S
    && userFallEnd(on(), { tone: 1, beat: 0, drone: 1 }) === 10 + GATE_OUT_S && userFallEnd(on(), { tone: 0, beat: 1, drone: 0 }) === 10 + DRONE_OUT_S,
  'H (A1): userFallEnd: the drone off ends at t + 3, a slider to 0 at t + 0.8, both the later');
  check(userFallEnd(on(), { tone: 1, beat: 1, drone: 1 }) === null && userFallEnd(on(), { tone: 0.5, beat: 2, drone: 1 }) === null
    && userFallEnd(on({ gains: { tone: 0, beat: 1, drone: 1 } }), { tone: 0 }) === null, 'H (A1): no layer going off, or one already off: null');
  check(userFallEnd(on({ gates: { tone_beat: 0, drone: 0 } }), { tone: 0, drone: 0 }) === null && userFallEnd(on({ gates: { tone_beat: 1, drone: 0 } }), { drone: 0 }) === null,
    'H (A1): a layer whose gate is shut steps (no fade): null');
  let threw2 = false;
  try {
    for (const o of [null, undefined, {}, { t: NaN, gains: null, gates: null }]) if (userFallEnd(o as never, { drone: 0 }) !== null || userFallEnd(on(), o as never) !== null) threw2 = true;
  } catch {
    threw2 = true;
  }
  check(!threw2, 'H (A1): userFallEnd is total');

  // Review A3: trackHold: the window after a track change, and the glide the tick started for it.
  check(trackHold(10, 9.5, 0) === 10.5 && trackHold(10, 9.5, 1.8) === 11.8 && trackHold(10, 9, 1.8) === null && trackHold(10, null, 1) === null
    && trackHold(10, 9.9, -1) === 10.9 && trackHold(NaN, 9.9, 1) === null, 'H (A3): trackHold: the later of the window and the glide while the window is open');
  // Review A4: gatesSilent.
  check(gatesSilent(on({ gates: { tone_beat: 0, drone: 0 } })) && !gatesSilent(on({ gates: { tone_beat: 1e-6, drone: 0 } })) && !gatesSilent(on({ gates: { tone_beat: 0, drone: 0.3 } }))
    && !gatesSilent(null) && !gatesSilent({} as never), 'H (A4): gatesSilent: both gates at exactly 0, else false');
}

// ------------------------------------------- I. no swell (critique M2, review A1–A4) --

/** App's protections for the duck, by name, so a control can leave out exactly one: the rest-soon guard (M2(b)), the
 *  switch's host-glide hold (M2(b)), the holdRise calls at a pause, a stop, a retune and a seek (M2(a)), a layer's fade
 *  to off (review A1), the rest guard where a held rise starts (A2), the track-change hold and the level tick holding
 *  any rise (A3), and the silent fall (A4). */
type Guard = 'restGuard' | 'glide' | 'holds' | 'userFall' | 'restRecheck' | 'trackHold' | 'silent';
const ALL_GUARDS: readonly Guard[] = ['restGuard', 'glide', 'holds', 'userFall', 'restRecheck', 'trackHold', 'silent'];
type Layer = 'tone' | 'beat' | 'drone';
const ALL_LAYERS: readonly Layer[] = ['tone', 'beat', 'drone'];

/**
 * App, as far as the duck is concerned, on a fake engine with a virtual clock: the real LayerPlayer plays into the
 * real KeyFitDuck. The handlers do what App's do (App.tsx: the plan effect, setV2Gains, stopLayersNow, the level tick,
 * the track effect and the fit effect, each hold through keyFitHold); `protect` true is App, false leaves out every
 * protection (the critique's controls), and { without } leaves out the named ones (the review's controls).
 */
class AppSim {
  t = 0;
  readonly ctx = new FakeCtx();
  readonly duck: KeyFitDuck;
  readonly player: LayerPlayer;
  readonly warns: string[] = [];
  glideUntil = -Infinity;
  sentOn: boolean | null = null;
  userFall: number | null = null;
  trackAt: number | null = null;
  private readonly off: ReadonlySet<Guard>;
  constructor(protect: boolean | { without: Guard[] }, restInS: number | null = null) {
    this.off = new Set(protect === true ? [] : protect === false ? ALL_GUARDS : protect.without);
    const clock = (): number => this.t;
    const warn = (m: string): void => {
      this.warns.push(m);
    };
    this.duck = new KeyFitDuck(asCtx(this.ctx), this.ctx.destination as unknown as AudioNode, { clock, warn });
    const resumeDuty = restInS === null ? null : { on_s: 1200 - restInS, quiet_s: 0, rest_ends_at: null, t: 0 };
    this.player = LayerPlayer.for(asCtx(this.ctx), this.duck.input, { clock, timer: null, warn, resumeDuty });
  }
  private on(g: Guard): boolean {
    return !this.off.has(g);
  }
  /** The first play, or a resume: host first, then the gains and the voice (App's plan effect). */
  open(pl: Plan, host: number): void {
    this.player.setHostLevel(host);
    this.player.setLayerGains({ tone: 1, beat: 1, drone: 1 });
    this.player.play(pl, 'binaural', true);
  }
  /** keyFitHold: the player's holds, a layer's fade to off, a track change the tick has not seen (or the glide it started
   *  for it), and `extra`, moved past a drone rest where the rise would start (riseHold). */
  hold(...extra: Array<number | null>): number | null {
    const st = this.player.state();
    const ex = [this.on('userFall') ? this.userFall : null, this.on('trackHold') ? trackHold(this.t, this.trackAt, this.glideUntil - this.t) : null, ...extra];
    const s0 = this.on('restGuard') ? st : { ...st, drone: { ...st.drone, next_rest_at: null } };
    if (this.on('restRecheck')) return riseHold(s0, ...ex);
    let h = riseHoldFrom(s0);
    for (const x of ex) h = laterHold(h, x);
    return h !== null && h > st.t ? h : null;
  }
  /** The fit effect: the switch's τ on the first send after a flip; a rise waits (hold; for the switch also the host's
   *  glide window); a fall while both gates are shut lands at once. */
  fit(db: number, on: boolean): void {
    const flip = this.sentOn !== null && this.sentOn !== on;
    const glide = flip && this.on('glide') ? hostGlideHold(this.duck.state().t, this.glideUntil - this.t) : null;
    const silent = this.on('silent') && gatesSilent(this.player.state());
    this.duck.setTarget(db, { tauS: flip ? DUCK_FLIP_TAU_S : DUCK_TAU_S, holdRiseUntil: this.hold(glide), silent });
    this.sentOn = on;
  }
  /** The track effect: the playing track changed (the fit effect runs after it, in the same commit). */
  track(): void {
    this.trackAt = this.duck.state().t;
  }
  /** setV2Gains: the sliders and the drone switch; a layer faded to off holds a rise in flight until the fade's end. */
  gains(g: Partial<LayerGains>): void {
    const end = userFallEnd(this.player.state(), g);
    this.player.setLayerGains(g);
    if (end !== null && this.on('userFall')) {
      this.userFall = laterHold(this.userFall, end);
      this.duck.holdRise(this.hold());
    }
  }
  /** A pause (the plan effect with the layers no longer wanted). */
  pause(): void {
    if (this.on('holds')) this.duck.holdRise();
    this.player.play(null);
  }
  /** stopLayersNow: Music only (0.1 s), Emergency Stop (0.1 s), leaving v2 (0.25 s). */
  stop(glideS: number): void {
    if (this.on('holds')) this.duck.holdRise();
    this.player.setHostLevel(0, { glideS });
    this.player.play(null);
  }
  /** A crystal change (the plan effect retunes, then holds a rise in flight until the retune's silence). */
  retune(pl: Plan, host: number): void {
    this.player.setHostLevel(host);
    this.player.play(pl, 'binaural', true);
    const st = this.player.state();
    if (this.on('holds') && st.phase === 'retuning') this.duck.holdRise(this.hold());
  }
  /** The level tick seeing a seek or a track change: a 2 s glide window, the host glides over 1.5 s; a duck rise in
   *  flight or waiting waits for the window's end (without A3's trackHold, only the switch's fast one). */
  detect(level: number): void {
    this.glideUntil = this.t + 2;
    if (this.on('holds') && (this.on('trackHold') || this.duck.state().tau_s <= DUCK_FLIP_TAU_S)) this.duck.holdRise(this.hold(this.t + 2));
    this.player.setHostLevel(level, { glideS: 1.5 });
  }
  /** host × gate × user gain × duck now, per layer (the plan levels are constant). */
  levels(x: number): Record<Layer, number> {
    type U = { track: ParamTrack };
    const P = this.player as unknown as { gateTB: ParamTrack; gateDrone: ParamTrack; host: ParamTrack; users: Record<Layer, U> };
    const d = (this.duck as unknown as { track: ParamTrack }).track.valueAt(x), h = P.host.valueAt(x);
    const tb = h * P.gateTB.valueAt(x) * d;
    return {
      tone: tb * P.users.tone.track.valueAt(x), beat: tb * P.users.beat.track.valueAt(x),
      drone: h * P.gateDrone.valueAt(x) * d * P.users.drone.track.valueAt(x),
    };
  }
  done(): void {
    this.player.dispose();
    this.duck.dispose();
  }
}

const P528 = plan(528, 'headphones', 'binaural', 10) as Plan;
const P639 = plan(639, 'headphones', 'binaural', 10) as Plan;
type Swell = Record<Layer, number> & { warns: number };
type Act = [number, (a: AppSim) => void];
/** Run `acts` at their times (the clock at each act's time), sampling every ms from 0 to `end`; `look` sees each sample
 *  from `from` on. */
function runActs(a: AppSim, acts: Act[], from: number, end: number, look: (x: number, l: Record<Layer, number>) => void): void {
  const all = [...acts].sort((x, y) => x[0] - y[0]);
  let i = 0;
  for (let n = 0; n * 0.001 <= end + 1e-9; n++) {
    const x = n * 0.001;
    while (i < all.length && all[i][0] <= x + 1e-9) {
      a.t = all[i][0];
      all[i][1](a);
      i++;
    }
    a.t = Math.max(a.t, x);
    if (x + 1e-9 >= from) look(x, a.levels(x));
  }
}
/**
 * One scenario: the voice opens at 0 (host 0.8), the duck settles at −6 (the switch on at 0.1, τ 0.05), then `acts`
 * run at their times; from `fall` the levels are sampled every ms for `spanTB` (tone and beat) and `spanDrone` (drone).
 * The swell is the most a level rises over the lowest it has been since `fall`, in dB (0 for a monotone fade).
 */
function scenario(protect: boolean | { without: Guard[] }, acts: Act[], fall: number, spanTB: number, spanDrone: number, restInS: number | null = null): Swell {
  const a = new AppSim(protect, restInS);
  const pre: Act[] = [
    [0, (s) => s.open(P528, 0.8)],
    // The switch turned on at 0.1 (a flip: τ 0.05), so every scenario starts with the duck settled at −6.
    [0.1, (s) => { s.sentOn = false; s.fit(-6, true); }],
  ];
  const span: Record<Layer, number> = { tone: spanTB, beat: spanTB, drone: spanDrone };
  // The swell: how far a level rises over the lowest it has been since the fall began (a fade must never turn back
  // up); stricter than a rise over its value at the fall.
  const min = { tone: Infinity, beat: Infinity, drone: Infinity }, worst = { tone: 0, beat: 0, drone: 0 };
  let p0: Record<Layer, number> | null = null;
  runActs(a, [...pre, ...acts], fall, fall + Math.max(spanTB, spanDrone) + 0.01, (x, l) => {
    if (!p0) p0 = l;
    for (const k of ALL_LAYERS) {
      if (x > fall + span[k] + 1e-9) continue;
      min[k] = Math.min(min[k], l[k]);
      if (min[k] > 1e-6 * p0[k]) worst[k] = Math.max(worst[k], 20 * Math.log10(l[k] / min[k]));
    }
  });
  const warns = a.warns.length;
  a.done();
  return { ...worst, warns };
}
/** Review A4: from `from` for `span` s, the most each layer's level rises above the level it settles at (its level at
 *  the end), in dB; acts run from 0 (no prelude). */
function overshoot(protect: boolean | { without: Guard[] }, acts: Act[], from: number, span: number): Swell {
  const a = new AppSim(protect);
  const peak = { tone: 0, beat: 0, drone: 0 };
  let last: Record<Layer, number> = { tone: 0, beat: 0, drone: 0 };
  runActs(a, acts, from, from + span, (_x, l) => {
    for (const k of ALL_LAYERS) peak[k] = Math.max(peak[k], l[k]);
    last = l;
  });
  const warns = a.warns.length;
  a.done();
  const over = (k: Layer): number => (last[k] > 0 ? 20 * Math.log10(peak[k] / last[k]) : Infinity);
  return { tone: over('tone'), beat: over('beat'), drone: over('drone'), warns };
}

const T = 20; // every scenario's event, well after the gates (2.5 s / 8 s) and the duck (−6 by 1 s) are settled
const fmtDb = (x: number): string => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(3)}` : String(x));
const swellRows: string[] = [];
const layersText = (s: Swell, layers: readonly Layer[]): string => layers.map((k) => `${k} ${fmtDb(s[k])} dB`).join(', ');
/** The closing (or opening) layers in `layers` must not swell over +0.1 dB; the others may rise (the duck's own rise). */
const report = (name: string, s: Swell, layers: readonly Layer[] = ALL_LAYERS): void => {
  const worst = Math.max(...layers.map((k) => s[k]));
  swellRows.push(`${name}: ${layersText(s, layers)}`);
  check(worst <= 0.1 && s.warns === 0, `I: ${name}: no swell over +0.1 dB (${layersText(s, layers)}; ${s.warns} warnings)`);
};
const control = (name: string, s: Swell, layers: readonly Layer[] = ALL_LAYERS): void => {
  const worst = Math.max(...layers.map((k) => s[k]));
  swellRows.push(`control ${name}: ${layersText(s, layers)}`);
  check(worst > 0.1, `I: control ${name} swells over +0.1 dB, so the scenario can see a swell (${fmtDb(worst)} dB)`);
};
{
  // I1: the host's 1.5 s fall at a same-crystal track change (the level tick sees it up to 250 ms after the commit).
  for (const delta of [0, 0.1, 0.25]) {
    report(`I1a the new track's τ 2 rise, the host's fall ${delta} s later`, scenario(true, [
      [T, (s) => { s.track(); s.fit(0, true); }], [T + delta, (s) => s.detect(0)],
    ], T + delta, 1.5, 1.5));
  }
  for (const eps of [0.01, 0.05, 0.1]) {
    report(`I1b the switch off ${eps} s before the host's fall`, scenario(true, [
      [T - eps, (s) => s.fit(0, false)], [T, (s) => s.detect(0)],
    ], T, 1.5, 1.5));
  }
  report('I1c the switch off 0.5 s into the host\'s fall', scenario(true, [
    [T, (s) => s.detect(0)], [T + 0.5, (s) => s.fit(0, false)],
  ], T, 1.5, 1.5));
  control('I1b (0.01 s)', scenario(false, [[T - 0.01, (s) => s.fit(0, false)], [T, (s) => s.detect(0)]], T, 1.5, 1.5));
  control('I1c', scenario(false, [[T, (s) => s.detect(0)], [T + 0.5, (s) => s.fit(0, false)]], T, 1.5, 1.5));
}
{
  // I2: a pause within 0.1 s of a rise (the switch's τ 0.05, a track's τ 2): tone and beat close over 0.8 s, the drone
  // over 3 s.
  for (const [what, on] of [['the switch off', false], ['a τ 2 rise', true]] as Array<[string, boolean]>) {
    for (const eps of [0.01, 0.05, 0.1]) {
      report(`I2 ${what} ${eps} s before a pause`, scenario(true, [[T - eps, (s) => s.fit(0, on)], [T, (s) => s.pause()]], T, GATE_OUT_S, DRONE_OUT_S));
    }
  }
  control('I2 the switch off 0.01 s before a pause', scenario(false, [[T - 0.01, (s) => s.fit(0, false)], [T, (s) => s.pause()]], T, GATE_OUT_S, DRONE_OUT_S));
  control('I2 a τ 2 rise 0.01 s before a pause', scenario(false, [[T - 0.01, (s) => s.fit(0, true)], [T, (s) => s.pause()]], T, GATE_OUT_S, DRONE_OUT_S));
}
{
  // I3: leaving v2 (stopLayersNow(0.25)); I4: Music only and Emergency Stop (stopLayersNow(0.1)).
  for (const [name, glide] of [['I3 leaving v2', 0.25], ['I4 Music only / Emergency Stop', 0.1]] as Array<[string, number]>) {
    for (const [what, on] of [['the switch off', false], ['a τ 2 rise', true]] as Array<[string, boolean]>) {
      for (const eps of [0.001, 0.01, 0.05, 0.1]) {
        report(`${name}: ${what} ${eps} s before`, scenario(true, [[T - eps, (s) => s.fit(0, on)], [T, (s) => s.stop(glide)]], T, glide, glide));
      }
    }
    control(`${name}: the switch off 0.001 s before`, scenario(false, [[T - 0.001, (s) => s.fit(0, false)], [T, (s) => s.stop(glide)]], T, glide, glide));
  }
}
{
  // I5: a rise just before a drone rest (the rest starts at 20 s: resumeDuty 1180 s of drone time), the drone closing
  // over 3 s from the rest's start.
  const R = 20;
  for (const [what, on] of [['the switch off', false], ['a τ 2 rise', true]] as Array<[string, boolean]>) {
    for (const eps of [0.05, 0.01, 0.3, 0.45, 0.6]) {
      report(`I5 ${what} ${eps} s before a drone rest`, scenario(true, [[R - eps, (s) => s.fit(0, on)]], R, 0, DRONE_OUT_S, R), ['drone']);
    }
  }
  control('I5 the switch off 0.05 s before a drone rest', scenario(false, [[R - 0.05, (s) => s.fit(0, false)]], R, 0, DRONE_OUT_S, R), ['drone']);
  control('I5 a τ 2 rise 0.05 s before a drone rest', scenario(false, [[R - 0.05, (s) => s.fit(0, true)]], R, 0, DRONE_OUT_S, R), ['drone']);
}
{
  // I6: a crystal change (a retune) with a rise in flight: the plan effect holds it until the retune's silence.
  for (const [what, on] of [['the switch off', false], ['a τ 2 rise', true]] as Array<[string, boolean]>) {
    for (const eps of [0.01, 0.05, 0.1]) {
      report(`I6 ${what} ${eps} s before a crystal change`, scenario(true, [[T - eps, (s) => s.fit(0, on)], [T, (s) => s.retune(P639, 0.8)]], T, GATE_OUT_S, DRONE_OUT_S));
    }
  }
  control('I6 the switch off 0.01 s before a crystal change', scenario(false, [[T - 0.01, (s) => s.fit(0, false)], [T, (s) => s.retune(P639, 0.8)]], T, GATE_OUT_S, DRONE_OUT_S));
}
{
  // I7 (review A1): a layer faded to off by the user (the drone switch: 3 s; a tone or beat slider to 0: 0.8 s) and the
  // Key fit switch within that fade, in both orders. Only the fading layer is measured: the others rise with the duck.
  const NO_FALL: { without: Guard[] } = { without: ['userFall'] };
  for (const d of [0.1, 0.5, 1, 2, 2.9]) {
    report(`I7a the drone off, the switch off ${d} s later`, scenario(true, [[T, (s) => s.gains({ drone: 0 })], [T + d, (s) => s.fit(0, false)]], T, 0, DRONE_OUT_S), ['drone']);
  }
  for (const d of [0.05, 0.2, 0.5]) {
    report(`I7b the tone slider to 0, the switch off ${d} s later`, scenario(true, [[T, (s) => s.gains({ tone: 0 })], [T + d, (s) => s.fit(0, false)]], T, GATE_OUT_S, 0), ['tone']);
  }
  report('I7c the beat slider to 0, the switch off 0.05 s later', scenario(true, [[T, (s) => s.gains({ beat: 0 })], [T + 0.05, (s) => s.fit(0, false)]], T, GATE_OUT_S, 0), ['beat']);
  for (const d of [0.01, 0.05, 0.1]) {
    report(`I7d the switch off, the drone off ${d} s later`, scenario(true, [[T - d, (s) => s.fit(0, false)], [T, (s) => s.gains({ drone: 0 })]], T, 0, DRONE_OUT_S), ['drone']);
  }
  for (const d of [0.01, 0.05]) {
    report(`I7e the switch off, the tone slider to 0 ${d} s later`, scenario(true, [[T - d, (s) => s.fit(0, false)], [T, (s) => s.gains({ tone: 0 })]], T, GATE_OUT_S, 0), ['tone']);
  }
  report('I7f a τ 2 rise, the drone off 0.1 s later', scenario(true, [[T - 0.1, (s) => s.fit(0, true)], [T, (s) => s.gains({ drone: 0 })]], T, 0, DRONE_OUT_S), ['drone']);
  report('I7g the drone off, a τ 2 rise 0.05 s later', scenario(true, [[T, (s) => s.gains({ drone: 0 })], [T + 0.05, (s) => s.fit(0, true)]], T, 0, DRONE_OUT_S), ['drone']);
  control('I7a (0.1 s) without the fade hold', scenario(NO_FALL, [[T, (s) => s.gains({ drone: 0 })], [T + 0.1, (s) => s.fit(0, false)]], T, 0, DRONE_OUT_S), ['drone']);
  control('I7b (0.05 s) without the fade hold', scenario(NO_FALL, [[T, (s) => s.gains({ tone: 0 })], [T + 0.05, (s) => s.fit(0, false)]], T, GATE_OUT_S, 0), ['tone']);
  control('I7c without the fade hold', scenario(NO_FALL, [[T, (s) => s.gains({ beat: 0 })], [T + 0.05, (s) => s.fit(0, false)]], T, GATE_OUT_S, 0), ['beat']);
  control('I7d (0.01 s) without the fade hold', scenario(NO_FALL, [[T - 0.01, (s) => s.fit(0, false)], [T, (s) => s.gains({ drone: 0 })]], T, 0, DRONE_OUT_S), ['drone']);
  control('I7e (0.01 s) without the fade hold', scenario(NO_FALL, [[T - 0.01, (s) => s.fit(0, false)], [T, (s) => s.gains({ tone: 0 })]], T, GATE_OUT_S, 0), ['tone']);
  control('I7f without the fade hold', scenario(NO_FALL, [[T - 0.1, (s) => s.fit(0, true)], [T, (s) => s.gains({ drone: 0 })]], T, 0, DRONE_OUT_S), ['drone']);
  control('I7g without the fade hold', scenario(NO_FALL, [[T, (s) => s.gains({ drone: 0 })], [T + 0.05, (s) => s.fit(0, true)]], T, 0, DRONE_OUT_S), ['drone']);
}
{
  // I8 (review A2): a rise held to a later start (a host glide's end, a resume after a seek, a fade's end) that a drone
  // rest (at R = 20 s) would meet there: the guard is checked where the rise starts.
  const R = 20, NO_RECHECK: { without: Guard[] } = { without: ['restRecheck'] };
  const glideFlip = (pre: number): Act[] => [[R + pre - 2, (s) => s.detect(0.8)], [R + pre - 1.9, (s) => s.fit(0, false)]];
  for (const pre of [0.05, 0.2, 0.4, -0.3]) {
    report(`I8a the switch held to a host glide ending ${pre} s after the rest's start`, scenario(true, glideFlip(pre), R, 0, DRONE_OUT_S, R), ['drone']);
  }
  const seekResume: Act[] = [[R - 2, (s) => s.fit(0, false)], [R - 1.95, (s) => s.detect(0.8)]];
  report('I8b the switch\'s rise held by a seek to just after the rest\'s start', scenario(true, seekResume, R, 0, DRONE_OUT_S, R), ['drone']);
  const fadeEnd: Act[] = [[R - 0.9, (s) => s.gains({ tone: 0 })], [R - 0.85, (s) => s.fit(0, true)]];
  report('I8c a τ 2 rise held for a tone fade ending 0.1 s before the rest', scenario(true, fadeEnd, R, 0, DRONE_OUT_S, R), ['drone']);
  control('I8a (0.05 s) without the re-check', scenario(NO_RECHECK, glideFlip(0.05), R, 0, DRONE_OUT_S, R), ['drone']);
  control('I8b without the re-check', scenario(NO_RECHECK, seekResume, R, 0, DRONE_OUT_S, R), ['drone']);
  control('I8c without the re-check', scenario(NO_RECHECK, fadeEnd, R, 0, DRONE_OUT_S, R), ['drone']);
}
{
  // I9 (review A3): a gapless track change: the new track's τ 2 rise is committed at T and the level tick sees the new
  // source δ later (then the host's 1.5 s fall): measured from the commit, nothing rises before the fall.
  const change = (delta: number): Act[] => [[T, (s) => { s.track(); s.fit(0, true); }], [T + delta, (s) => s.detect(0)]];
  for (const delta of [0.1, 0.25, 0.5, 0.9]) report(`I9 a track change, the tick sees it ${delta} s later (from the commit)`, scenario(true, change(delta), T, 2.5, 2.5));
  // The tick can see the new source a moment before React commits the new track (the swap sets the element's src first);
  // the host's fall is then to the new track's level (−6 dB here, over 1.5 s), so a rise started in it would turn the fall
  // back up. Measured over that fall: the duck's own rise after it is the new track's fit.
  const early: Act[] = [[T - 0.01, (s) => s.detect(0.4)], [T, (s) => { s.track(); s.fit(0, true); }]];
  report('I9 a track change the tick saw 10 ms before the commit (from its fall)', scenario(true, early, T - 0.01, 1.5, 1.5));
  control('I9 (10 ms early) without the track hold', scenario({ without: ['trackHold'] }, early, T - 0.01, 1.5, 1.5));
  control('I9 (0.25 s) without the track hold', scenario({ without: ['trackHold'] }, change(0.25), T, 2.5, 2.5));
}
{
  // I10 (review A4): a fall sent while the gates are both shut lands before they open: no layer opens above the level
  // it settles at. The first play of a session (the duck made at unity, its first send −6) and a resume after a full
  // pause with a new track's duck.
  const first: Act[] = [[0, (s) => { s.open(P528, 0.8); s.fit(-6, true); }]];
  const resume: Act[] = [
    [0, (s) => { s.open(P528, 0.8); s.fit(0, true); }], [10, (s) => s.pause()],
    [14, (s) => { s.open(P528, 0.8); s.fit(-6, true); }],
  ];
  for (const [name, acts, from] of [['the first play', first, 0], ['a resume after a full pause', resume, 14]] as Array<[string, Act[], number]>) {
    const o = overshoot(true, acts, from, 12);
    swellRows.push(`I10 ${name}: over the settled level ${layersText(o, ALL_LAYERS)}`);
    check(Math.max(o.tone, o.beat, o.drone) <= 0.1 && o.warns === 0, `I10 (A4): ${name}: no layer opens over +0.1 dB above its settled level (${layersText(o, ALL_LAYERS)})`);
    const c = overshoot({ without: ['silent'] }, acts, from, 12);
    swellRows.push(`control I10 ${name} without the silent fall: ${layersText(c, ALL_LAYERS)}`);
    check(Math.max(c.tone, c.beat, c.drone) > 0.1, `I10: control ${name} without the silent fall overshoots (${layersText(c, ALL_LAYERS)})`);
  }
}
{
  // The scenarios start where they should: the duck at −6 and every gate open at T; the rest at R.
  const a = new AppSim(true, 20);
  a.open(P528, 0.8);
  a.t = 0.1;
  a.sentOn = false;
  a.fit(-6, true);
  a.t = 19.9;
  const st = a.player.state(), d = a.duck.state();
  check(near(d.value, G6, 1e-9) && st.gates.tone_beat === 1 && st.gates.drone === 1 && near(st.drone.next_rest_at ?? NaN, 20, 1e-9) && d.tau_s === DUCK_FLIP_TAU_S,
    `I: the scenarios' start: duck ${d.value}, gates ${st.gates.tone_beat}/${st.gates.drone}, next rest ${st.drone.next_rest_at}`);
  a.done();
}
const worstSwell = swellRows.filter((r) => !r.startsWith('control'));
console.log(`  I: ${worstSwell.length} no-swell scenarios and ${swellRows.length - worstSwell.length} controls`);
for (const r of swellRows) console.log(`    ${r}`);

// ------------------------------------------------------------------ done --

const secs = (Date.now() - t0) / 1000;
console.log(`  ${secs.toFixed(1)} s`);
console.log(`keyFit: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures.slice(0, 20)) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
