// Checks for utils/export/exportPlan.ts and exportWords.ts (v16.5, Export with layers).
// Run with: node utils/export/exportPlan.check.ts   (npm run check:export; Node 22.18+ strips the types). Exits non-zero
// on any failure.

import {
  PSF,
  OUT_RATE,
  BYTES_PER_FRAME,
  DECODE_RATE,
  LAYER_RATE,
  HEADER_ALLOWANCE,
  outSeconds,
  wavBytes,
  madeForDefault,
  outputFor,
  exportSpecFor,
  bandSchedule,
  safeTitle,
  fileNameFor,
  longFileName,
  fileKind,
  fileKindOf,
  exportCapSeconds,
  longFileCapSeconds,
  decodeMB,
  DECODE_MB_PER_MIN,
  decodeCostPerMin,
  capInfoFor,
  PCM_BASE_MB,
  BUDGET_MB,
  PHONE_MB_PER_ROOM_MIB,
  AAC_EXPORT_MB_PER_MIN,
  DECODE_MIB_PER_MIN,
  decodeRoomMiB,
  exportPeakMB,
  LAYERS_MB_PER_MIN,
  // v16.5 export memory
  PHONE_BUDGET_MB,
  PHONE_4GB_BUDGET_MB,
  PHONE_2GB_BUDGET_MB,
  COMPUTER_BUDGET_MB,
  decodeBudgetMB,
  PHONE_FIXED_MB,
  PHONE_MB_PER_MIN,
  phoneStepMB,
  phoneLineMB,
  PHONE_LONG_MB_PER_MIN,
  OUT_TRANSIT_MB,
  OUT_PART_BYTES,
  longFilePeakMB,
  LONG_CAP_MIN,
  STOPPING_LONG_MS,
  CANCEL_WAIT_MS,
  estimateSeconds,
  shareable,
  SHARE_MAX_OUT_SECONDS,
  PROGRESS_WEIGHTS,
  MADE_FOR,
} from './exportPlan.ts';
import type { ExportSnapshot, ExportSong, MadeFor } from './exportPlan.ts';
import * as W from './exportWords.ts';
import { BandHysteresis, readIntensity, capBand } from '../soundV2/layerHost.ts';
import { bandForIntensity, toneOf } from '../soundV2/aetheria_sound_v2.ts';
import type { Band } from '../soundV2/aetheria_sound_v2.ts';

let passed = 0;
const failures: string[] = [];
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) === JSON.stringify(b)) passed++;
  else failures.push(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};
const ok = (c: boolean, what: string) => (c ? passed++ : failures.push(what));

// ---- The format (decision 4 B).
eq([OUT_RATE, BYTES_PER_FRAME, LAYER_RATE], [48_000, 6, 12_000], '24-bit stereo at 48 kHz; layers at 12 kHz');
ok(Math.abs(DECODE_RATE - 48_888.89) < 0.01, `the decode rate is 48,000 / ${PSF} (${DECODE_RATE})`);
ok(Math.abs(outSeconds(60) - 61.1111) < 0.001, 'a source minute plays 61.1 s');
eq(wavBytes(60), HEADER_ALLOWANCE + Math.round((60 / PSF) * 48_000) * 6, 'bytes per source minute');
ok(Math.abs(wavBytes(60) / 1e6 - 17.6) < 0.1, `about 17.6 MB a source minute (${(wavBytes(60) / 1e6).toFixed(2)})`);
eq(SHARE_MAX_OUT_SECONDS, 182, 'Web Share takes about 3:02 of output');

// ---- Made for.
eq(['headphones', 'speakers', 'phone', 'car', null].map((o) => madeForDefault(o as never)), ['headphones', 'speakers', 'speakers', 'tone', 'headphones'], 'the default follows the Output');
eq(MADE_FOR.map((m) => outputFor(m, 'phone')), ['headphones', 'phone', 'car'], 'Speakers on a phone-speaker Output');
eq(MADE_FOR.map((m) => outputFor(m, 'headphones')), ['headphones', 'speakers', 'car'], 'Speakers otherwise');
eq(toneOf(174, 'phone'), 348, "the phone's tone floor (348 for 174)");

// ---- exportSpecFor over engine × musicOnly × Outputs × Made for × playing or not × a pick, 111, none × Perfect GUT.
const base: ExportSnapshot = {
  engine: 'v2', musicOnly: false, output: 'headphones', droneEnabled: true, keyFitOn: true, toneLevel: 0.0005,
  lowering: null, beatLevel: 0.03, presetName: 'Alpha', adaptive: true, phiOn: true, perfectGut: false, playingId: 'a', selectedHz: 528,
};
const song = (id: string, hz?: number, extra: Partial<ExportSong> = {}): ExportSong => ({ id, name: id, duration: 200, closestSolfeggio: hz, ...extra });
let combos = 0;
for (const engine of ['v2', 'classic'] as const) {
  for (const musicOnly of [false, true]) {
    for (const output of ['headphones', 'speakers', 'phone', 'car'] as const) {
      for (const madeFor of MADE_FOR) {
        for (const playing of [true, false]) {
          for (const pick of [528, 111, 0]) {
            for (const perfectGut of [false, true]) {
              const snap = { ...base, engine, musicOnly, output, perfectGut, selectedHz: pick, playingId: playing ? 'a' : 'zz' };
              const s = exportSpecFor(snap, song('a', 639), madeFor);
              const raw = playing ? (pick > 0 ? pick : 639) : 639;
              const f = raw === 111 ? 111 : raw === 528 ? (perfectGut ? 519 : 528) : perfectGut ? 630 : 639;
              const out = outputFor(madeFor, output);
              const render = out === 'car' ? 'off' : out === 'headphones' ? 'binaural' : 'pulse';
              const origin = raw === 111 ? '111' : playing && pick > 0 && pick !== 639 ? 'playing' : 'assigned';
              const good =
                s.crystalRaw === raw && s.f === f && s.crystalHz === f && s.origin === origin && s.layers === !musicOnly &&
                s.output === out && s.render === render && s.engineNote === (engine === 'classic') && s.startBand === 'alpha' &&
                s.phi === true && s.gains.drone === 1 && Math.abs(s.gains.tone - 0.05) < 1e-9 && Math.abs(s.gains.beat - 1) < 1e-9;
              if (good) combos++;
              else failures.push(`exportSpecFor ${JSON.stringify({ engine, musicOnly, output, madeFor, playing, pick, perfectGut })} → ${JSON.stringify(s)}`);
            }
          }
        }
      }
    }
  }
}
eq(combos, 2 * 2 * 4 * 3 * 2 * 3 * 2, 'every combination');
// No crystal at all: no layers, "none".
{
  const s = exportSpecFor({ ...base, playingId: null }, song('b'), 'headphones');
  eq([s.crystalRaw, s.f, s.layers, s.origin, s.duckDb], [null, 0, false, 'none', 0], 'no crystal: the music only');
  eq(W.crystalRow(s).note, 'None yet: the file has the music only', 'its words');
}
// The lowering: the playing track keeps the lowered level; another track the user's own.
{
  const snap = { ...base, toneLevel: 0.00025, lowering: { trackId: 'a', before: 0.0005, after: 0.00025 } };
  eq(exportSpecFor(snap, song('a', 528), 'headphones').toneLevel, 0.00025, 'the playing track: the lowered level');
  eq(exportSpecFor(snap, song('b', 528), 'headphones').toneLevel, 0.0005, 'another track: the user’s own level');
  const moved = { ...snap, toneLevel: 0.001 };
  eq(exportSpecFor(moved, song('b', 528), 'headphones').toneLevel, 0.001, 'a slider moved since: the user’s choice stays');
}
// Adaptive: only with a band envelope, never for Tone only.
{
  const env = { fps: 20, sub: new Uint8Array(100).fill(200), bass: new Uint8Array(100).fill(200), mid: new Uint8Array(100).fill(200), high: new Uint8Array(100).fill(200) };
  eq(exportSpecFor(base, song('a', 528, { bandEnvelope: env }), 'headphones').adaptive, true, 'adaptive with an envelope');
  eq(exportSpecFor(base, song('a', 528), 'headphones').adaptive, false, 'no envelope: the band stays');
  eq(exportSpecFor(base, song('a', 528, { bandEnvelope: env }), 'tone').adaptive, false, 'Tone only: no beat to adapt');
  eq(exportSpecFor({ ...base, adaptive: false }, song('a', 528, { bandEnvelope: env }), 'headphones').adaptive, false, 'Adaptive off');
}
// Key fit: off → 0; no key data → 0; with data → keyFitFor's duck (≤ 0).
{
  const chroma = Array.from({ length: 12 }, (_, k) => (k === 9 ? 0.4 : 0.05));
  const keyed = song('a', 528, { chroma, chromaA4Hz: 440, keyConfidence: 0.9, musicKey: 'Am' });
  const on = exportSpecFor(base, keyed, 'headphones').duckDb;
  ok(on <= 0 && on >= -6, `Key fit: a duck between 0 and −6 dB (${on})`);
  eq(exportSpecFor({ ...base, keyFitOn: false }, keyed, 'headphones').duckDb, 0, 'Key fit off: no duck');
  eq(exportSpecFor(base, song('a', 528), 'headphones').duckDb, 0, 'no key data: no duck');
  eq(exportSpecFor({ ...base, musicOnly: true }, keyed, 'headphones').duckDb, 0, 'no layers: no duck');
}

// ---- bandSchedule equals App's own loop (BandHysteresis, readIntensity at t × PSF, capBand) at equal ticks.
{
  const n = 20 * 400; // 400 s of envelope at 20 fps
  const mk = (f: (i: number) => number) => {
    const a = new Uint8Array(n);
    for (let i = 0; i < n; i++) a[i] = Math.max(0, Math.min(255, Math.round(f(i))));
    return a;
  };
  const envs = [
    { fps: 20, sub: mk((i) => 128 + 120 * Math.sin(i / 300)), bass: mk((i) => 128 + 120 * Math.sin(i / 300)), mid: mk(() => 90), high: mk(() => 40) },
    { fps: 20, sub: mk((i) => (i % 2000 < 1000 ? 250 : 10)), bass: mk((i) => (i % 2000 < 1000 ? 250 : 10)), mid: mk(() => 120), high: mk(() => 120) },
  ];
  for (const [k, env] of envs.entries()) {
    for (const render of ['binaural', 'pulse'] as const) {
      for (const start of ['delta', 'alpha', 'gamma'] as Band[]) {
        const T = 380;
        const got = bandSchedule(env, start, render, T);
        // App's loop: every 3 s of playback (wall), the element's time = wall × PSF.
        const want: Array<{ t: number; band: Band }> = [{ t: 0, band: start }];
        const hyst = new BandHysteresis();
        let cur = start;
        for (let t = 3; t < T; t += 3) {
          const target = capBand(bandForIntensity(readIntensity(env, t * PSF)), render === 'pulse' ? 'alpha' : 'beta');
          const next = hyst.tick(target, cur);
          if (next) {
            cur = next;
            want.push({ t, band: next });
          }
        }
        eq(got, want, `bandSchedule = App's loop (envelope ${k}, ${render}, from ${start})`);
        ok(got.length > 1, `the envelope steps the band (envelope ${k}, ${render}, ${start})`);
      }
    }
  }
  eq(bandSchedule(null, 'alpha', 'binaural', 300), [{ t: 0, band: 'alpha' }], 'no envelope: the band stays');
  eq(bandSchedule(envs[0], 'alpha', 'off', 300), [{ t: 0, band: 'alpha' }], 'Tone only: no steps');
}

// ---- Names.
eq(safeTitle('a\\b/c:d*e?f"g<h>i|j'), 'a b c d e f g h i j', 'reserved characters');
eq(safeTitle('ctl\u0001\u001f\u007fx'), 'ctl x', 'controls');
eq(safeTitle('  ..My   song.. '), 'My song', 'spaces and dots trimmed, whitespace collapsed');
eq(safeTitle('tone-01.mp3'), 'tone-01', 'an audio extension dropped');
eq(safeTitle('tone-01.M4A'), 'tone-01', 'any case');
eq(safeTitle(''), 'Track', 'empty');
eq(safeTitle(null), 'Track', 'missing');
eq(safeTitle('...'), 'Track', 'dots only');
{
  const long = 'x'.repeat(79) + '😀' + 'yyy';
  const s = safeTitle(long);
  eq(Array.from(s).length, 80, '80 code points');
  ok(s.endsWith('😀'), 'a surrogate pair at the edge stays whole');
  const s2 = safeTitle('x'.repeat(80) + '😀');
  ok(!/[\uD800-\uDBFF]$/.test(s2) && Array.from(s2).length === 80, 'never half a pair');
}
eq(safeTitle('é'), 'é', 'NFC');
eq(fileNameFor('tone-01', 174, 'headphones', true), 'tone-01 · 174 Hz · Aetheria.wav', 'headphones');
eq(fileNameFor('tone-01', 528, 'speakers', true), 'tone-01 · 528 Hz · speakers · Aetheria.wav', 'speakers');
eq(fileNameFor('tone-01', 528, 'tone', true), 'tone-01 · 528 Hz · tone only · Aetheria.wav', 'tone only');
eq(fileNameFor('tone-01', 519, 'headphones', true), 'tone-01 · 519 Hz · Aetheria.wav', 'Perfect GUT as heard');
eq(fileNameFor('tone-01', 528, 'headphones', false), 'tone-01 · Aetheria.wav', 'music only');
eq(longFileName('Evening'), 'Evening · Aetheria.wav', 'a long file');

// ---- File kinds and caps.
eq(['a.m4a', 'a.MP4', 'a.aac', 'a.mp3', 'a.flac', 'a.ogg', 'a.opus', 'a.wav', 'a.webm'].map((name) => fileKind({ name })), ['aac', 'aac', 'aac', 'other', 'other', 'other', 'other', 'other', 'other'], 'kinds by extension');
eq(['audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/mpeg', ''].map((type) => fileKind({ name: 'x', type })), ['aac', 'aac', 'aac', 'other', 'other'], 'kinds by MIME');
eq(fileKind(null), 'other', 'no file');
// v16.5 re-review (B2): the bytes' own kind first: an AAC named .mp3 costs AAC's (an M4A or ADTS); an MP3 named .m4a
// the others'; an MP4 whose codec isn't known counts as AAC; unknown bytes: by name and type.
eq(fileKindOf({ name: 'a.mp3', type: 'audio/mpeg' }, { container: 'mp4', codec: 'aac' }), 'aac', 'an M4A named .mp3: AAC');
eq(fileKindOf({ name: 'a.mp3', type: 'audio/mpeg' }, { container: 'adts', codec: 'aac' }), 'aac', 'ADTS named .mp3: AAC');
eq(fileKindOf({ name: 'a.m4a', type: 'audio/mp4' }, { container: 'mp3', codec: 'mp3' }), 'other', 'an MP3 named .m4a: the others');
eq(fileKindOf({ name: 'a.m4a' }, { container: 'mp4', codec: 'alac' }), 'other', 'ALAC in an M4A: the others (lossless costs its own)');
eq(fileKindOf({ name: 'a.wav' }, { container: 'mp4', codec: null }), 'aac', 'an MP4 of unknown codec: AAC (the dearer)');
eq(fileKindOf({ name: 'a.m4a' }, { container: 'unknown', codec: null }), 'aac', 'unknown bytes: by the name');
eq(fileKindOf({ name: 'a.mp3' }, null), 'other', 'nothing sniffed: by the name');
eq(decodeCostPerMin(fileKindOf({ name: 'a.mp3', type: 'audio/mpeg' }, { container: 'mp4', codec: 'aac' })), 105, 'an AAC named .mp3 costs 105 MB a minute, not 86');
for (const kind of ['other', 'aac'] as const) {
  const phone = exportCapSeconds(kind, true, 8);
  const computer = exportCapSeconds(kind, false);
  // v16.5 final: the longest whole minutes whose export peak fits the budget; a minute more doesn't.
  ok(exportPeakMB(kind, phone, true) <= BUDGET_MB.phone && exportPeakMB(kind, phone + 60, true) > BUDGET_MB.phone, `${kind}: the phone cap is the last minute whose peak fits`);
  ok(exportPeakMB(kind, computer, false) <= BUDGET_MB.computer && exportPeakMB(kind, computer + 60, false) > BUDGET_MB.computer, `${kind}: the computer cap likewise`);
  ok(exportCapSeconds(kind, true, 4) <= phone && exportCapSeconds(kind, true, 2) <= exportCapSeconds(kind, true, 4) && exportCapSeconds(kind, true, 2) >= 60, `${kind}: lower tiers for ≤ 4 and ≤ 2 GB, never under a minute`);
  for (const dm of [undefined, null, 0, NaN, -1]) eq(exportCapSeconds(kind, true, dm as never), phone, `${kind}: deviceMemory ${dm} → by mobile alone`);
}
// The decode's room: its output (DECODE_RATE, stereo float) rounded up to a power of two; the steps at 5.7, 11.4, 22.9 min.
ok(Math.abs(DECODE_MIB_PER_MIN - 22.38) < 0.01, `the decode's output: ${DECODE_MIB_PER_MIN.toFixed(2)} MiB a minute`);
eq([3, 5, 5.7, 5.8, 10, 11.4, 11.5, 22.8, 22.9].map((m) => decodeRoomMiB(m)), [128, 128, 128, 256, 256, 256, 512, 512, 1024], 'the room in powers of two');
eq([3, 5, 6, 7, 10].map((m) => phoneStepMB('other', m * 60)), [576, 576, 1152, 1152, 1152].map((x) => x * PHONE_MB_PER_ROOM_MIB / 4.5), "the phone's step: one peak for each step (3 and 5 min alike, 6, 7 and 10 alike)");
eq([phoneStepMB('aac', 60), exportPeakMB('aac', 60, false)], [AAC_EXPORT_MB_PER_MIN.phone, AAC_EXPORT_MB_PER_MIN.computer], 'AAC: its minute');
// v16.5 export memory: the phone's peak is the larger of the step and the Note 20's line (v16.5 final: 200 + 120 a
// minute, over its D-E1 runs; the minute scaled by the source's cost against the others').
eq([PHONE_FIXED_MB + 3 * PHONE_MB_PER_MIN, PHONE_FIXED_MB + 5 * PHONE_MB_PER_MIN, PHONE_FIXED_MB + 10 * PHONE_MB_PER_MIN], [560, 800, 1400], "the line over the Note 20's D-E1 runs (3 min up to 520, 5 min 714, 10 min 1,303)");
eq([1, 2, 3, 4, 5, 6].map((m) => Math.round(exportPeakMB('other', m * 60, true))), [320, 440, 576, 680, 800, 1152], 'a phone, the others: the larger of the step and the line, minute by minute');
eq([1, 2, 3, 4].map((m) => Math.round(exportPeakMB('aac', m * 60, true))), [347, 493, 720, 960], "a phone, AAC: the larger of its minute and the line (its minute at 105 / 86 of the others')");
for (const m of [0.5, 1, 2, 2.9, 3, 4.4, 5, 5.8, 7, 10, 12, 20]) for (const k of ['other', 'aac'] as const) {
  const e = exportPeakMB(k, m * 60, true);
  ok(e >= phoneStepMB(k, m * 60) && e >= phoneLineMB(k, m * 60) && (e === phoneStepMB(k, m * 60) || e === phoneLineMB(k, m * 60)), `${k} ${m} min: the envelope is the larger of the two`);
}
ok(Math.abs(phoneLineMB('aac', 600) - (PHONE_FIXED_MB + PHONE_MB_PER_MIN * (105 / 86) * 10)) < 1e-9, "AAC's line: its minute scaled by 105 / 86, the fixed part as the others'");
eq(exportPeakMB('other', 0, true), 0, 'no length: nothing');
// The budgets, one named constant each (the user confirms them), by tier.
eq([PHONE_BUDGET_MB, PHONE_4GB_BUDGET_MB, PHONE_2GB_BUDGET_MB, COMPUTER_BUDGET_MB], [1500, 600, 375, 2000], 'the budgets: 1,500 / 600 / 375 on a phone (the meminfo figure: a quarter of each is MB; the user chose 10-minute tracks and the long file its growth allows on phones over 4 GB, 2026-10-30), 2 GB on a computer');
eq([decodeBudgetMB(true, 8), decodeBudgetMB(true, 6), decodeBudgetMB(true, 4), decodeBudgetMB(true, 3), decodeBudgetMB(true, 2), decodeBudgetMB(true, 1), decodeBudgetMB(true, null), decodeBudgetMB(false, 2)], [1500, 1500, 600, 600, 375, 375, 1500, 2000], 'each tier its budget');
eq(exportPeakMB('other', 600, false), DECODE_MB_PER_MIN.other * 10, 'a computer: the decode’s minute');
// The whole-export peaks measured (the dev hook, layers on): each under the model at its length, so each cap holds them.
// (A computer keeps the decode's linear minute: just past a step it can read up to 7 % under the peak (desktop MP3 3 min
// 276 MB, 6 min 548, against 258 and 516), but not near its caps: 23 minutes measured 1,659 MB, under the 2 GB.)
for (const [what, kind, mobile, minutes, mb] of [['Note 20 MP3 3 min 44.1 kHz', 'other', true, 3, 520], ['Note 20 MP3 5 min 48 kHz', 'other', true, 5, 714], ['Note 20 MP3 10 min 48 kHz', 'other', true, 10, 1303], ['desktop MP3 7 min', 'other', false, 7, 551], ['desktop MP3 10 min', 'other', false, 10, 568], ['desktop MP3 20 min', 'other', false, 20, 1130], ['desktop MP3 22 min', 'other', false, 22, 1190], ['desktop MP3 23 min', 'other', false, 23, 1659], ['desktop AAC 3 min', 'aac', false, 3, 245], ['desktop AAC 8 min', 'aac', false, 8, 952], ['desktop AAC 12 min', 'aac', false, 12, 1296], ['desktop AAC 19 min', 'aac', false, 19, 2153]] as const) {
  const model = exportPeakMB(kind, minutes * 60, mobile);
  ok(model >= mb - 1e-9, `${what}: the model's ${Math.round(model)} MB covers the measured ${mb}`);
}
ok(exportCapSeconds('aac', true, 8) < exportCapSeconds('other', true, 8), 'AAC has its own, lower cap');
// The measured table at 24-bit 48 kHz (DECODE_MB_PER_MIN's note), minutes: phone > 4 GB, ≤ 4 GB, ≤ 2 GB, computer.
// v16.5 final: with the export's own peak (exportPeakMB), was 10 / 6 / 4 / 23 and 8 / 5 / 3 / 19.
// v16.5 export memory (the envelope): was 5 / 5 / 2 / 23 and 3 / 2 / 1 / 16; with the user's 1,200 MB (2026-10-30) the
// > 4 GB phone takes 10 minutes (the Note 20 measured 1,136 MB for a 10-minute 48 kHz MP3) and AAC 5. v16.5 final (the
// phone gate: the line 200 + 120 a minute, the user's 1,500): 10 minutes still, AAC 6.
eq([8, 4, 2].map((dm) => exportCapSeconds('other', true, dm) / 60).concat(exportCapSeconds('other', false) / 60), [10, 3, 1, 23], 'MP3, OGG, Opus, WAV, FLAC, WebM: 10 / 3 / 1 / 23 minutes');
eq([8, 4, 2].map((dm) => exportCapSeconds('aac', true, dm) / 60).concat(exportCapSeconds('aac', false) / 60), [6, 2, 1, 16], 'AAC: 6 / 2 / 1 / 16 minutes');
// Every tier: the cap is the last minute whose peak fits that tier's budget, and the next minute doesn't.
for (const kind of ['other', 'aac'] as const) for (const dm of [8, 4, 2]) {
  const cap = exportCapSeconds(kind, true, dm);
  const budget = decodeBudgetMB(true, dm);
  ok(cap >= 60 && exportPeakMB(kind, cap, true) <= budget && exportPeakMB(kind, cap + 60, true) > budget, `${kind}, ${dm} GB: the cap (${cap / 60} min, ${Math.round(exportPeakMB(kind, cap, true))} MB) fits ${budget} MB; a minute more (${Math.round(exportPeakMB(kind, cap + 60, true))}) doesn't`);
}
// D-E1's files on the phone, per tier: the 5-minute 48 kHz MP3 is within the > 4 GB cap (its 800 under 1,500) and over
// the ≤ 4 GB one (800 against 600: refused there), the 3-minute (576) within ≤ 4 GB's, the 1-minute (320) within ≤ 2 GB's.
eq([[5, 8], [5, 4], [3, 4], [1, 2], [2, 2]].map(([m, dm]) => m * 60 <= exportCapSeconds('other', true, dm)), [true, false, true, true, false], 'the 48 kHz MP3s by tier: 5 min > 4 GB only, 3 min ≤ 4 GB, 1 min ≤ 2 GB');
// A source whose first minute is over a tier's budget: no minute (it was at least 1).
ok(exportCapSeconds('other', true, 2, { sampleRate: 96_000, lossless: true, bytesPerSecond: 96_000 * 6 }) === 0, 'a 96 kHz WAV on a ≤ 2 GB phone: none (its first minute 445 MB against 375)');
ok(exportCapSeconds('other', true, 8, { sampleRate: 96_000, lossless: true, bytesPerSecond: 96_000 * 6 }) >= 60, '…on a > 4 GB phone it has its minutes');
ok(Math.abs(LAYERS_MB_PER_MIN - 5.493) < 0.01, `the long file's layers: ${LAYERS_MB_PER_MIN.toFixed(3)} MB a minute`);
// v16.5 review (B2): the source's own cost. An ordinary file keeps its type's caps (decision 7); a sample rate over
// 48 kHz, and a lossless file's read buffer, cost more (the measured table: decodeCostPerMin's note).
{
  const wav = (rate: number, bits: number) => ({ sampleRate: rate, lossless: true, bytesPerSecond: rate * 2 * (bits / 8) });
  for (const src of [wav(44_100, 16), wav(48_000, 16), wav(48_000, 24), { sampleRate: 44_100, lossless: true, bytesPerSecond: 96_000 }, { sampleRate: 48_000 }, { sampleRate: 44_100 }, null]) {
    eq(exportCapSeconds('other', true, 8, src), exportCapSeconds('other', true, 8), `an ordinary source keeps the caps: ${JSON.stringify(src)}`);
    eq(exportCapSeconds('other', false, null, src), exportCapSeconds('other', false), `…on a computer too: ${JSON.stringify(src)}`);
  }
  eq(exportCapSeconds('aac', true, 8, { sampleRate: 44_100 }), exportCapSeconds('aac', true, 8), 'an ordinary AAC keeps its caps');
  // Each measured peak (the decode over the bytes held, + the read buffer, MB a minute) is under the model's cost.
  const measured: Array<[string, 'other' | 'aac', { sampleRate: number; lossless?: boolean; bytesPerSecond?: number }, number]> = [
    ['WAV 44.1/16', 'other', wav(44_100, 16), 64.6 + 10.1],
    ['WAV 48/24', 'other', wav(48_000, 24), 64.5 + 16.5],
    ['WAV 88.2/24', 'other', wav(88_200, 24), 89 + 30.3],
    ['WAV 96/16', 'other', wav(96_000, 16), 142.8 + 22],
    ['WAV 96/24', 'other', wav(96_000, 24), 138.2 + 33],
    ['WAV 176.4/24', 'other', wav(176_400, 24), 224.6 + 60.6],
    ['WAV 192/24', 'other', wav(192_000, 24), 233.2 + 65.9],
    ['FLAC 96/24', 'other', { sampleRate: 96_000, lossless: true, bytesPerSecond: (23.5 * 1048576) / 60 }, 128.9 + 23.5],
    ['MP3 48 kHz', 'other', { sampleRate: 48_000 }, 62.8 + 1.4],
    ['AAC 44.1 kHz', 'aac', { sampleRate: 44_100 }, 106.7 + 1.4],
    ['AAC 96 kHz', 'aac', { sampleRate: 96_000 }, 264.5 + 1.9],
  ];
  for (const [what, kind, src, mb] of measured) {
    const cost = decodeCostPerMin(kind, src);
    // Within 3 %: AAC at 44.1 kHz measured 106.7 + 1.4 against its 105 (decision 7 keeps its caps; at them it fits).
    ok(cost >= mb * 0.97, `${what}: the model's ${cost.toFixed(1)} MB a minute covers the measured ${mb.toFixed(1)}`);
    const cap = exportCapSeconds(kind, true, 8, src);
    ok(exportPeakMB(kind, cap, true, src) <= BUDGET_MB.phone, `${what}: at its phone cap (${cap / 60} min) the measured peak ${Math.round((mb * cap) / 60)} MB fits the 900 MB budget`);
    const capC = exportCapSeconds(kind, false, null, src);
    ok((mb * capC) / 60 <= BUDGET_MB.computer * 1.03, `${what}: at its computer cap (${capC / 60} min) it fits the 2 GB budget`);
  }
  // The table (minutes: phone > 4 GB, computer).
  const tbl = (kind: 'other' | 'aac', src: object | null) => [exportCapSeconds(kind, true, 8, src) / 60, exportCapSeconds(kind, false, null, src) / 60];
  // v16.5 final (a phone's decode room, AAC's whole-export minute): was 4 / 10, 5 / 11, 5 / 11, 2 / 5, 3 / 7; then (the
  // phone gate's 1,500) 96/24 2 → 5, 192/24 1 → 2, AAC 96 kHz 1 → 2.
  eq(tbl('other', wav(96_000, 24)), [5, 10], 'WAV 96/24: 5 / 10 minutes');
  eq(tbl('other', wav(96_000, 16)), [5, 11], 'WAV 96/16: 5 / 11 minutes');
  eq(tbl('other', wav(88_200, 24)), [5, 11], 'WAV 88.2/24: 5 / 11 minutes');
  eq(tbl('other', wav(192_000, 24)), [2, 5], 'WAV 192/24: 2 / 5 minutes');
  eq(tbl('aac', { sampleRate: 96_000 }), [2, 6], 'AAC 96 kHz: 2 / 6 minutes');
  ok(exportCapSeconds('other', true, 8, wav(96_000, 24)) < exportCapSeconds('other', true, 8), 'a 96 kHz source gets the lower cap');
  ok(decodeCostPerMin('other', { lossless: true, sampleRate: 48_000, bytesPerSecond: 0 }) === DECODE_MB_PER_MIN.other && PCM_BASE_MB < DECODE_MB_PER_MIN.other, 'never under the type\'s cost');
  eq(decodeMB('other', 120, wav(96_000, 24)), decodeCostPerMin('other', wav(96_000, 24)) * 2, 'decodeMB follows the source');
  const c = capInfoFor(6 * 60, 'other', 8, wav(96_000, 24));
  eq([c.what, c.kHz, c.phoneMin, c.computerMin], ['hires', 96, 5, 10], 'the refusal names a 96 kHz file and its caps');
  eq(capInfoFor(20 * 60, 'aac', 8).what, 'aac', 'an AAC refusal');
  eq(capInfoFor(20 * 60, 'other', 8, { sampleRate: 44_100 }).what, 'tracks', 'an ordinary refusal');
}
{
  const phoneLong = longFileCapSeconds(true, exportPeakMB('other', 5 * 60, true), 8);
  ok(phoneLong > 0 && phoneLong <= 45 * 60, `the long file on a phone: ${phoneLong / 60} min`);
  ok(longFileCapSeconds(true, 2000, 8) === 0, 'a decode over the budget: no long file');
  ok(longFileCapSeconds(false, decodeMB('other', 10 * 60)) > phoneLong, 'a computer takes longer');
  ok((longFileCapSeconds(false, 0) / 60 / PSF) * 60 * OUT_RATE * BYTES_PER_FRAME < 0xffff_ffff, 'never past the RIFF limit');
  // v16.5 export memory: the long file's peak is the heaviest track's export peak (a phone: the envelope) + what grows
  // with the length (a phone: PHONE_LONG_MB_PER_MIN, from the phone gate's long files; a computer: the layers) + two output
  // parts in transit (the engine's 4 MiB parts).
  eq([OUT_PART_BYTES, OUT_TRANSIT_MB], [4 * 1024 * 1024, 8], 'the output in the renderer: two 4 MiB parts');
  // v16.5 final (the Note 20, each decode let go once used): the 3-minute 44.1 kHz MP3 × 8 (24 min) 1,043 and × 14 (42 min)
  // 1,818 on their own, and D-E4's 42 minutes with the library playing 1,930.
  for (const [min, mb] of [[24, 1043], [42, 1818], [42, 1930]] as const) ok(longFilePeakMB(true, exportPeakMB('other', 180, true), min * 60) >= mb, `a phone, ${min} minutes of 3-minute MP3s: the model's ${Math.round(longFilePeakMB(true, exportPeakMB('other', 180, true), min * 60))} covers the measured ${mb}`);
  eq(longFilePeakMB(true, 576, 45 * 60), 576 + 45 * PHONE_LONG_MB_PER_MIN + 8, "the long file's peak: the heaviest + a minute's growth + the parts");
  // The desktop measurements (fix 4's probe, Android UA, MB over the base): each under the computer's model.
  for (const [what, heavy, min, mb] of [['10 min of 5-minute 48 kHz MP3s', 5, 10, 274], ['20 min', 5, 20, 501], ['45 min', 5, 45, 667], ['90 min', 5, 90, 918], ['45 min of 3-minute 44.1 kHz', 3, 45, 476]] as const) {
    const model = longFilePeakMB(false, exportPeakMB('other', heavy * 60, false), min * 60);
    ok(model >= mb, `a computer, ${what}: the model's ${Math.round(model)} MB covers the measured ${mb}`);
  }
  // Per tier (> 4 GB, ≤ 4 GB, ≤ 2 GB, computer), by the heaviest track: the caps, each the last minute whose long-file
  // peak fits the tier's budget (and never over the rule).
  const longRow = (k: 'other' | 'aac', min: number) => [8, 4, 2].map((dm) => longFileCapSeconds(true, exportPeakMB(k, min * 60, true), dm) / 60).concat(longFileCapSeconds(false, exportPeakMB(k, min * 60, false)) / 60);
  eq(longRow('other', 3), [26, 0, 0, 180], 'the long file, 3-minute tracks: 26 / 0 / 0 / 180 minutes');
  eq(longRow('other', 4), [23, 0, 0, 180], '4-minute tracks: 23 / 0 / 0 / 180 (a 4-minute track is over the ≤ 4 GB cap itself)');
  eq(longRow('other', 5), [20, 0, 0, 180], '5-minute 48 kHz tracks: 20 / 0 / 0 / 180');
  eq(longRow('other', 2), [30, 4, 0, 180], '2-minute tracks: 30 / 4 / 0 / 180');
  eq(longRow('aac', 3), [22, 0, 0, 180], 'AAC, 3-minute tracks: 22 / 0 / 0 / 180');
  eq(longRow('aac', 2), [29, 2, 0, 180], 'AAC, 2-minute tracks: 29 / 2 / 0 / 180');
  for (const k of ['other', 'aac'] as const) for (const min of [1, 2, 2.5, 3, 4, 5]) for (const dm of [8, 4, 2, null]) {
    const mobile = dm !== null;
    const heavy = exportPeakMB(k, min * 60, mobile);
    const cap = longFileCapSeconds(mobile, heavy, dm);
    const budget = decodeBudgetMB(mobile, dm);
    const rule = mobile ? LONG_CAP_MIN.phone * (dm! <= 2 ? 5 / 12 : dm! <= 4 ? 8 / 12 : 1) : LONG_CAP_MIN.computer;
    ok(cap === 0 || longFilePeakMB(mobile, heavy, cap) <= budget, `${k} ${min}-min tracks, ${dm ?? 'computer'}: at the long cap (${cap / 60} min) the peak fits ${budget} MB`);
    ok(cap >= Math.floor(rule) * 60 || longFilePeakMB(mobile, heavy, cap + 60) > budget, `${k} ${min}-min tracks, ${dm ?? 'computer'}: a minute more is over the budget, or the cap is the rule's`);
  }
  // Ordinary playlists (3–5-minute songs) as one long file where the tier's own track cap takes them: on a > 4 GB phone,
  // at least two of the longest such song; on a ≤ 4 GB phone a 3-minute song leaves no room (576 + 8 of 600 MB: see
  // the report); a ≤ 2 GB phone takes none of them alone.
  for (const min of [3, 4, 5]) ok(longFileCapSeconds(true, exportPeakMB('other', min * 60, true), 8) >= 2 * min * 60, `> 4 GB: ${min}-minute songs, two or more in a long file`);
  ok(exportCapSeconds('other', true, 2) < 3 * 60, '≤ 2 GB: no 3-minute song alone');
}

// ---- Estimates, sharing, progress.
eq(estimateSeconds(12 * 60, false, false), Math.round(12 * 1.2), 'the desktop: about 1.2 s a source minute');
ok(estimateSeconds(12 * 60, true, true) > estimateSeconds(12 * 60, true, false), 'a phone while playing takes longer');
eq(estimateSeconds(60, true, true, 3), 3, 'a learned rate wins');
eq([shareable([52_428_800]), shareable([52_428_801]), shareable([1, 2], 10), shareable([1, 2], 11), shareable([])], [true, false, true, false, false], 'the share limits');
ok(Math.abs(Object.values(PROGRESS_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9, 'the progress weights add up to 1');

// ---- Words.
eq([W.timeLeft(0), W.timeLeft(2.9), W.timeLeft(3), W.timeLeft(59), W.timeLeft(60), W.timeLeft(61), W.timeLeft(125)], ['Almost done', 'Almost done', 'About 5 s left', 'About 60 s left', 'About 1 min left', 'About 1 min left', 'About 2 min 10 s left'], 'time left');
eq(W.timeLeft(null), '', 'no estimate yet');
eq(W.rowExporting(61.6), 'Exporting · 62 %', 'the rows while exporting');
eq(W.fileLine(199, 35_000_000), 'WAV · 24-bit · 48 kHz · 3:19 · about 35 MB', 'the file line');
eq(W.doneLine(199, 35_000_000), '3:19 · 35 MB · WAV 24-bit 48 kHz', 'the done line');
eq(W.overCap(47 * 60, 'other', true, 11, 26), 'This track is 47 minutes long. On a phone, Export with layers takes tracks up to 11 minutes; on a computer, up to 26.', 'over the cap');
ok(W.overCap(20 * 60, 'aac', true, 6, 13).includes('this kind of file (AAC audio)'), 'over the cap: AAC names its kind (whatever its container: .m4a, .aac, .mka)');
// v16.5 review: a hi-res refusal (B2), the length (B1), the skipped tracks (B6), Share's window (B12), the waits (B10).
eq(W.overCapInfo({ seconds: 6 * 60, phoneMin: 4, computerMin: 10, what: 'hires', kHz: 96 }, true), 'This track is 6 minutes long. On a phone, Export with layers takes this kind of file (96 kHz) up to 4 minutes; on a computer, up to 10.', 'over the cap: a 96 kHz file');
eq(W.overCapInfo({ seconds: 30 * 60, phoneMin: 10, computerMin: 23, what: 'tracks', kHz: null }, false), 'This track is 30 minutes long. On a computer, Export with layers takes tracks up to 23 minutes.', 'over the cap: an ordinary file on a computer');
eq(W.skippedLine([{ title: 'tone-0002', why: 'decode' }, { title: 'tone-0004', why: 'too-long' }]), "Skipped 2: tone-0002 (it can't be decoded in this browser); tone-0004 (too long for this device).", 'the skipped line names each track');
eq(W.skippedLine([]), null, 'nothing skipped: no line');
eq([W.savedOf(3, 3), W.savedOf(2, 3)], ['Saved to your downloads', 'Saved 2 of 3 to your downloads'], 'saved, all or some');
ok(W.longCantDecode('tone-0002').startsWith("tone-0002 can't be decoded"), 'the long file names the track it stopped at');
for (const r of [W.NO_LENGTH, W.SHARE_GONE, W.RECORD_WHILE_EXPORTING, W.ANALYSE_WHILE_EXPORTING, W.SCAN_WHILE_EXPORTING, W.BUSY_EXPORT, W.RECORD_EXPORTING_LINE]) ok(r.length > 10, `a reason has words: ${r}`);
eq(W.stopped("This file can't be decoded in this browser."), "The export stopped: This file can't be decoded in this browser.", 'a failure');
eq(W.playlistTotals(5, 234_000_000, 120), '5 files, one per track · about 234 MB · about 2 min', 'the playlist totals');
eq(W.trackOf(2, 5, 'tone-02'), 'Track 2 of 5 · tone-02', 'a playlist running');
eq(W.moreCardTitle('tone-01', 62), 'Exporting tone-01 · 62 %', 'the More card');
for (const [k, v] of Object.entries(W.PHASE_WORDS)) ok(typeof v === 'string' && v.length > 3, `phase ${k} has words`);
for (const m of MADE_FOR as MadeFor[]) ok(W.MADE_FOR_WORDS[m].title.length > 3 && W.MADE_FOR_WORDS[m].line.length > 10, `Made for ${m} has words`);
for (const r of [W.AUDIO_MISSING, W.BUSY_ANALYSE, W.BUSY_SCAN, W.ANOTHER, W.OFFLINE_FIRST, W.CANT_DECODE, W.NO_MEMORY, W.SOMETHING, W.SHARE_FAILED, W.TOO_LARGE, W.LOUD_LINE]) ok(r.length > 10, `a reason has words: ${r}`);
ok(!/heal|cure|therap|effect on/i.test(Object.values(W).filter((v) => typeof v === 'string').join(' ')), 'no word states an effect');
// v16.5 final fixes: a length a phone can't check (its own words, and a playlist's skip line), the let-go job's hold.
eq(W.stopped(W.NO_PHONE_LENGTH), "The export stopped: This track's length can't be checked on a phone, so it can't be exported here. A computer can export it.", 'a phone that can\'t check a length');
eq(W.skippedLine([{ title: 'tone-0003', why: 'untrusted' }]), "Skipped 1: tone-0003 (its length can't be checked on a phone).", 'a playlist skips it by name');
for (const r of [W.STILL_STOPPING, W.ANALYSE_WHILE_STOPPING, W.SCAN_WHILE_STOPPING, W.BUSY_STOPPING]) ok(r.length > 10 && /stop/.test(r), `the let-go hold has words: ${r}`);
// v16.5 export memory: after a minute still stopping, each held line adds the reload (which always works).
eq([W.STILL_STOPPING_LONG, W.ANALYSE_WHILE_STOPPING_LONG, W.SCAN_WHILE_STOPPING_LONG, W.BUSY_STOPPING_LONG], [W.STILL_STOPPING.replace(/\.$/, ', or reload Aetheria.'), W.ANALYSE_WHILE_STOPPING.replace(/\.$/, ', or reload Aetheria.'), W.SCAN_WHILE_STOPPING.replace(/\.$/, ', or reload Aetheria.'), W.BUSY_STOPPING + ', or reload Aetheria'], 'the held lines after a minute: "or reload Aetheria"');
eq([STOPPING_LONG_MS, CANCEL_WAIT_MS], [60_000, 10_000], 'a minute after it was let go');
// A refusal where not even a minute fits (a 96 kHz WAV on a ≤ 2 GB phone), and a long file with no room.
eq(W.overCapInfo(capInfoFor(3 * 60, 'other', 2, { sampleRate: 96_000, lossless: true, bytesPerSecond: 96_000 * 6 }), true), "This track is 3 minutes long. On this phone, Export with layers can't take this kind of file (96 kHz); on a computer, up to 10 minutes.", 'no minute on this phone: the words');
eq(W.longOverCap(9 * 60, longFileCapSeconds(true, exportPeakMB('other', 4 * 60, true), 4), true), 'This playlist is 9 minutes long. On this phone, its tracks need more memory than one long file can have: export one file per track instead.', 'no long file at all: the words');

if (failures.length) {
  console.error(`exportPlan: ${failures.length} failed, ${passed} passed`);
  for (const f of failures.slice(0, 40)) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`exportPlan: ${passed} checks passed, 0 failed`);
