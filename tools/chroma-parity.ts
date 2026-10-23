// tools/chroma-parity.ts — Analyse tracks (v15.1): golden parity of utils/soundV2/chroma.ts against the reference
// analyser's library.json (build spec v15.1 §11.2). Node only; run by hand for the release gates, never in CI
// (it needs ffmpeg and the reference data). Paths are arguments: nothing about the data is written here.
//
//   node tools/chroma-parity.ts --library <library.json> --wavs <dir> [--mp3s <dir>] [--mode ffmpeg|wav|mp3|all]
//                               [--only <i,j,…>] [--limit N] [--json <out.json>] [--write-subset <out.json> [--every 4]]
//
// Modes (§11.2.1):
//   ffmpeg  exactly the reference's input (ref L235-237): ffmpeg decodes, downmixes and resamples to 22050 Hz mono
//           f32. Must match the stored values within the STRICT bounds on every track.
//   wav     the file read here (RIFF: PCM 16/24/32 or float 32, LIST and other chunks skipped), downmixed by
//           keyAnalysis.ts's (L+R)·√½ and resampled by a re-implementation of scipy's resample_poly (Kaiser β 9):
//           a different good resampler, standing in for a browser's. TOLERANT bounds.
//   mp3     <stem of source>.mp3 from --mp3s, decoded by ffmpeg as in ffmpeg mode: what MP3 encoding does to the
//           results. MP3 bounds (provisional).
//   all     ffmpeg, then wav, then mp3 (when --mp3s is given).
// Tracks map to files by their `source` (WAV) and `<stem>.mp3` (MP3); --only takes library indices. Output: one
// line per track by library index, then a summary with PASS or FAIL, on stdout; exit 1 on any FAIL. Nothing else
// is written, apart from --json (every row and verdict) and --write-subset.
//
// --write-subset <out.json> [--every N]: writes the JSON array of the `source`s of every Nth track in library order
// (indices 0, N, 2N, …) plus every track whose WAV is not 48 kHz (from its RIFF header), for the phone runs.
//
// It runs at below-normal priority (spawned ffmpegs inherit it), one track at a time.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
import { join, parse as parsePath, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { analysePitchContentSync, SR } from '../utils/soundV2/chroma.ts';
import { downmixInPlace } from '../utils/soundV2/keyAnalysis.ts';
import { compareWithRef, errorRow, verdict, formatRow, formatVerdict } from './chromaParity.ts';
import type { ParityRow, RefEntry, BoundsName, Verdict } from './chromaParity.ts';

type Mode = 'ffmpeg' | 'wav' | 'mp3';
interface Track extends RefEntry { source: string }

// ------------------------------------------------------------------------------------------------ args --

function parseArgs(argv: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
    m.set(a.slice(2), v);
    i++;
  }
  return m;
}

// ----------------------------------------------------------------------------------------- decoding --

/** f32le PCM from ffmpeg, exactly the reference's call (ref L235-236). maxBuffer is mandatory: 215 s of PCM is
 *  19 MB, and the default 1 MiB would truncate silently. */
export function ffmpegPcm(file: string): Float32Array {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'],
    { maxBuffer: 1 << 30, windowsHide: true });
  if (r.error) throw r.error;
  // The file's path is cut out of ffmpeg's message, so a report never carries a name.
  if (r.status !== 0) throw new Error(`ffmpeg exit ${r.status}: ${String(r.stderr).split(file).join('<file>').trim().slice(0, 200)}`);
  const out = r.stdout as Buffer;
  if (out.byteLength % 4 !== 0) throw new Error('ffmpeg output is not whole float32 samples');
  const pcm = new Float32Array(out.byteLength / 4);
  new Uint8Array(pcm.buffer).set(out);
  return pcm;
}

export interface Wav { rate: number; channels: Float32Array[]; frames: number }

/** A WAV's samples, per channel, as float32 in [−1, 1). */
export function readWav(file: string): Wav {
  const b = readFileSync(file);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag4 = (at: number): string => b.toString('latin1', at, at + 4);
  if (tag4(0) !== 'RIFF' || tag4(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let pos = 12;
  let fmt: { tag: number; ch: number; rate: number; align: number; bits: number } | null = null;
  while (pos + 8 <= b.byteLength) {
    const id = tag4(pos), size = dv.getUint32(pos + 4, true), body = pos + 8;
    if (id === 'fmt ') {
      let tag = dv.getUint16(body, true);
      if (tag === 0xfffe) tag = dv.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE: the subformat's first 2 bytes
      fmt = { tag, ch: dv.getUint16(body + 2, true), rate: dv.getUint32(body + 4, true), align: dv.getUint16(body + 12, true), bits: dv.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('data before fmt');
      const { tag, ch, rate, align, bits } = fmt;
      const frames = Math.floor(Math.min(size, b.byteLength - body) / align);
      const channels: Float32Array[] = [];
      for (let c = 0; c < ch; c++) channels.push(new Float32Array(frames));
      const bytes = bits / 8;
      for (let f = 0; f < frames; f++) {
        const at = body + f * align;
        for (let c = 0; c < ch; c++) {
          const p = at + c * bytes;
          let v: number;
          if (tag === 1 && bits === 16) v = dv.getInt16(p, true) / 32768;
          else if (tag === 1 && bits === 24) v = ((dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getInt8(p + 2) << 16))) / 8388608;
          else if (tag === 1 && bits === 32) v = dv.getInt32(p, true) / 2147483648;
          else if (tag === 3 && bits === 32) v = dv.getFloat32(p, true);
          else throw new Error(`unsupported WAV format tag ${tag}, ${bits} bits`);
          channels[c][f] = v;
        }
      }
      return { rate, channels, frames };
    }
    pos = body + size + (size & 1); // chunks are word-aligned
  }
  throw new Error('no data chunk');
}

/** Only the RIFF header's sample rate (for --write-subset). */
function wavRate(file: string): number {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(65536);
    const n = readSync(fd, head, 0, head.length, 0);
    let pos = 12;
    while (pos + 8 <= n) {
      const id = head.toString('latin1', pos, pos + 4), size = head.readUInt32LE(pos + 4);
      if (id === 'fmt ' && pos + 16 <= n) return head.readUInt32LE(pos + 12);
      pos += 8 + size + (size & 1);
    }
  } finally {
    closeSync(fd);
  }
  throw new Error('no fmt chunk in the first 64 KiB');
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** The modified Bessel function I0, as a power series summed until a term is under 1e-17 × the sum. */
function besselI0(x: number): number {
  const q = (x / 2) * (x / 2);
  let term = 1, sum = 1;
  for (let k = 1; k < 500; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < 1e-17 * sum) break;
  }
  return sum;
}

/** scipy.signal.resample_poly(x, up, down, window=('kaiser', 9.0)) to 22050 Hz, re-implemented (§11.2.1):
 *  h[n] = fc·sinc(fc·(n − half))·kaiser(n), normalised to sum `up`; y[k] = Σ_i x[i]·h[k·down − i·up + half]
 *  over the input (zeros outside it); ceil(n·up/down) outputs. Accumulated in float64. */
export function resamplePoly(x: Float32Array, rate: number): Float32Array {
  const g = gcd(SR, rate), up = SR / g, down = rate / g;
  if (up === 1 && down === 1) return x.slice();
  const maxRate = Math.max(up, down), fc = 1 / maxRate, half = 10 * maxRate, taps = 2 * half + 1;
  const h = new Float64Array(taps);
  const i0beta = besselI0(9);
  let sum = 0;
  for (let n = 0; n < taps; n++) {
    const m = n - half;
    const sinc = m === 0 ? 1 : Math.sin(Math.PI * fc * m) / (Math.PI * fc * m);
    const r = (2 * n) / (taps - 1) - 1;
    h[n] = fc * sinc * (besselI0(9 * Math.sqrt(Math.max(0, 1 - r * r))) / i0beta);
    sum += h[n];
  }
  for (let n = 0; n < taps; n++) h[n] = (h[n] / sum) * up;
  const nIn = x.length;
  const nOut = Math.floor((nIn * up + down - 1) / down);
  const y = new Float32Array(nOut);
  for (let k = 0; k < nOut; k++) {
    const t = k * down + half; // input i meets tap t − i·up
    const iLo = Math.max(0, Math.ceil((t - (taps - 1)) / up));
    const iHi = Math.min(nIn - 1, Math.floor(t / up));
    let acc = 0;
    for (let i = iLo, tap = t - iLo * up; i <= iHi; i++, tap -= up) acc += x[i] * h[tap];
    y[k] = acc;
  }
  return y;
}

/** WAV mode's input: the file, (L+R)·√½ (keyAnalysis.ts's downmix), resample_poly to 22050. */
export function wavPcm(file: string): Float32Array {
  const w = readWav(file);
  const mono = downmixInPlace({ numberOfChannels: w.channels.length, length: w.frames, sampleRate: w.rate, getChannelData: (c) => w.channels[c] });
  return w.rate === SR ? mono : resamplePoly(mono, w.rate);
}

// ---------------------------------------------------------------------------------------------- main --

function runMode(mode: Mode, tracks: Track[], picks: number[], dirs: { wavs: string; mp3s?: string }): { rows: ParityRow[]; v: Verdict } {
  const bounds: BoundsName = mode === 'ffmpeg' ? 'strict' : mode === 'wav' ? 'tolerant' : 'mp3';
  console.log(`== ${mode} mode (${bounds} bounds), ${picks.length} tracks`);
  const rows: ParityRow[] = [];
  for (const i of picks) {
    const t = tracks[i];
    const file = mode === 'mp3' ? join(dirs.mp3s as string, parsePath(t.source).name + '.mp3') : join(dirs.wavs, t.source);
    let row: ParityRow;
    try {
      if (!existsSync(file)) throw new Error('file missing');
      const t0 = performance.now();
      const pcm = mode === 'wav' ? wavPcm(file) : ffmpegPcm(file);
      const t1 = performance.now();
      const a = analysePitchContentSync(pcm);
      const t2 = performance.now();
      row = compareWithRef(i, a, t);
      row.decodeMs = t1 - t0;
      row.analyseMs = t2 - t1;
      row.seconds = pcm.length / SR;
    } catch (e) {
      row = errorRow(i, e instanceof Error ? e.message : String(e), t);
    }
    rows.push(row);
    console.log(formatRow(row));
  }
  const v = verdict(rows, bounds);
  console.log(formatVerdict(v, `${mode} mode`));
  return { rows, v };
}

function main(): number {
  try {
    os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    console.log('(could not lower the process priority)');
  }
  const args = parseArgs(process.argv.slice(2));
  const libPath = args.get('library'), wavs = args.get('wavs');
  if (!libPath || !wavs) {
    console.log('usage: node tools/chroma-parity.ts --library <library.json> --wavs <dir> [--mp3s <dir>] [--mode ffmpeg|wav|mp3|all] [--only <i,j,…>] [--limit N] [--json <out.json>] [--write-subset <out.json> [--every 4]]');
    return 2;
  }
  const lib = JSON.parse(readFileSync(libPath, 'utf8')) as { tracks?: Track[] };
  const tracks = Array.isArray(lib.tracks) ? lib.tracks : [];
  if (!tracks.length) throw new Error('the library has no tracks');

  const subsetOut = args.get('write-subset');
  if (subsetOut) {
    const every = Number(args.get('every') ?? 4);
    if (!(every >= 1)) throw new Error('--every needs a positive number');
    const picked: number[] = [];
    tracks.forEach((t, i) => {
      if (i % every === 0 || wavRate(join(wavs, t.source)) !== 48000) picked.push(i);
    });
    writeFileSync(subsetOut, JSON.stringify(picked.map((i) => tracks[i].source), null, 1) + '\n');
    console.log(`subset: ${picked.length} tracks (indices ${picked.join(', ')})`);
    return 0;
  }

  let picks = tracks.map((_, i) => i);
  const only = args.get('only');
  if (only) {
    picks = only.split(',').map((s) => Number(s.trim()));
    if (picks.some((i) => !Number.isInteger(i) || i < 0 || i >= tracks.length)) throw new Error('--only takes library indices');
  }
  const limit = args.get('limit');
  if (limit) picks = picks.slice(0, Number(limit));

  const mode = args.get('mode') ?? 'all';
  const mp3s = args.get('mp3s');
  const modes: Mode[] = mode === 'all' ? (mp3s ? ['ffmpeg', 'wav', 'mp3'] : ['ffmpeg', 'wav']) : [mode as Mode];
  if (modes.some((m) => m !== 'ffmpeg' && m !== 'wav' && m !== 'mp3')) throw new Error(`unknown --mode ${mode}`);
  if (modes.includes('mp3') && !mp3s) throw new Error('mp3 mode needs --mp3s');

  const results: { mode: Mode; rows: ParityRow[]; verdict: Verdict }[] = [];
  for (const m of modes) {
    const { rows, v } = runMode(m, tracks, picks, { wavs, mp3s });
    results.push({ mode: m, rows, verdict: v });
  }
  const jsonOut = args.get('json');
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ results }, null, 1) + '\n');
  const pass = results.every((r) => r.verdict.pass);
  console.log(`== ${pass ? 'PASS' : 'FAIL'}: ${results.map((r) => `${r.mode} ${r.verdict.pass ? 'PASS' : 'FAIL'}`).join(', ')}`);
  return pass ? 0 : 1;
}

// Run only as a script, so a scratch check can import the readers and the resampler.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.log('error: ' + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 2;
  }
}
