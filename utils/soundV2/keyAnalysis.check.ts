// Checks for utils/soundV2/keyAnalysis.ts (build spec v15.1 §11.1): the downmix, the stored fields and the guards.
// Run with: node utils/soundV2/keyAnalysis.check.ts   (Node 22.18+ strips the types), or npm run check:chroma
// Exits non-zero on any failure.

import {
  CHROMA_VERSION,
  createDecodeContext,
  downmixInPlace,
  downmixInPlaceSliced,
  toKeyFields,
  needsKey,
  analyseKeyOf,
} from './keyAnalysis.ts';
import type { ChannelSource, KeyFields } from './keyAnalysis.ts';
import { SR } from './chroma.ts';
import type { PitchAnalysis, PitchContent, PitchStats } from './chroma.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}

/** A fake decoded buffer over the given channels. */
function source(channels: Float32Array[], sampleRate = SR): ChannelSource {
  return { numberOfChannels: channels.length, length: channels[0].length, sampleRate, getChannelData: (c: number) => channels[c] };
}
const filled = (n: number, v: number): Float32Array => new Float32Array(n).fill(v);
function noise(n: number, seed: number): Float32Array {
  const x = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    x[i] = s / 2147483648 - 1;
  }
  return x;
}
const sameBits = (a: Float32Array, b: Float32Array): boolean => {
  if (a.length !== b.length) return false;
  const ua = new Uint32Array(a.buffer, a.byteOffset, a.length), ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) return false;
  return true;
};

async function main(): Promise<void> {
  check(CHROMA_VERSION === 1, 'CHROMA_VERSION is 1');

  // ----------------------------------------------------------------------------------------- downmix --
  {
    const half = Math.fround(0.5 * Math.SQRT1_2); // 0.353553…
    const a = source([filled(4, 0.25), filled(4, 0.25)]);
    const ma = downmixInPlace(a);
    check(ma === a.getChannelData(0) && ma.every((v) => v === half), `downmix: L = R = 0.25 gives fround(0.5·√½) = ${half.toFixed(6)} in channel 0, in place (${ma[0]})`);
    const b = downmixInPlace(source([filled(4, 0.5), filled(4, 0)]));
    check(b.every((v) => v === half), `downmix: L = 0.5, R = 0 gives the same (${b[0]})`);
    const monoData = Float32Array.of(0.1, -0.2, 0.3);
    const mono = source([monoData]);
    const mm = downmixInPlace(mono);
    check(mm === monoData && mm[0] === Math.fround(0.1) && mm[1] === Math.fround(-0.2) && mm[2] === Math.fround(0.3), 'downmix: mono is returned untouched (the same object)');
    const three = downmixInPlace(source([filled(4, 0.25), filled(4, 0.25), filled(4, 0.9)]));
    check(three.every((v) => v === half), `downmix: 3 channels use the front pair only (${three[0]})`);
    const loud = downmixInPlace(source([filled(4, 1), filled(4, 1)]));
    check(loud.every((v) => v === Math.fround(2 * Math.SQRT1_2)) && loud[0] > 1.414, `downmix: L = R = 1 gives 1.4142, not clipped (${loud[0]})`);
    const part = source([filled(6, 0.25), filled(6, 0.25)]);
    downmixInPlace(part, 2, 4);
    const p = part.getChannelData(0);
    check(p[0] === 0.25 && p[1] === 0.25 && p[2] === half && p[3] === half && p[4] === 0.25, 'downmix: only [from, to) changes');
  }
  {
    const n = 10_000;
    const l = noise(n, 1), r = noise(n, 2);
    const whole = source([l.slice(), r.slice()]);
    downmixInPlace(whole);
    const sliced = source([l.slice(), r.slice()]);
    let yields = 0;
    const out = await downmixInPlaceSliced(sliced, { sliceSamples: 1_000, yieldFn: async () => { yields++; } });
    check(out !== null && out === sliced.getChannelData(0) && sameBits(out, whole.getChannelData(0)) && yields === 9,
      `downmixInPlaceSliced: bitwise equal to downmixInPlace (${yields} yields between 10 slices)`);
    const c = source([l.slice(), r.slice()]);
    let seen = 0;
    const cancelled = await downmixInPlaceSliced(c, { sliceSamples: 1_000, yieldFn: async () => { seen++; }, shouldCancel: () => seen >= 2 });
    check(cancelled === null && seen === 2, `downmixInPlaceSliced: honours shouldCancel (null after the 2nd yield) (${cancelled === null ? 'null' : 'data'}, ${seen})`);
    const m = Float32Array.of(0.5, 0.25);
    check((await downmixInPlaceSliced(source([m]))) === m, 'downmixInPlaceSliced: mono is channel 0, untouched');
  }

  // -------------------------------------------------------------------------------------- toKeyFields --
  {
    const stats: PitchStats = { frames: 100, loud: 100, votes: 50, peaks: 60, gateMarginRel: 0.5 };
    const content: PitchContent = {
      chroma: [0.0634, 0.0329, 0.137, 0.0196, 0.0885, 0.1558, 0.0578, 0.0544, 0.0337, 0.1899, 0.1436, 0.0234],
      chromaA4Hz: 441.15, key: 'Dm', keyConfidence: 0.825, tuningOffsetCents: 2.5, tuningHz: 440,
      chromaRaw: new Array(12).fill(1 / 12), keyConfidenceRaw: 0.82512,
    };
    const ok = toKeyFields({ status: 'ok', content, stats });
    check(ok !== null && Array.isArray(ok.chroma) && ok.chroma !== content.chroma && ok.chroma.length === 12
      && ok.chroma.every((v, i) => v === content.chroma[i]), 'toKeyFields(ok): the chroma is a fresh plain Array of the stored 12 values');
    check(ok !== null && ok.chromaA4Hz === 441.15 && ok.musicKey === 'Dm' && ok.keyConfidence === 0.825 && ok.chromaVersion === CHROMA_VERSION
      && Object.keys(ok).sort().join(',') === 'chroma,chromaA4Hz,chromaVersion,keyConfidence,musicKey', 'toKeyFields(ok): A4, key, confidence and version; nothing else');
    const empty = toKeyFields({ status: 'empty', stats });
    const short = toKeyFields({ status: 'too-short', samples: 10 });
    const only = (f: KeyFields | null): boolean => f !== null && f.chromaVersion === CHROMA_VERSION && Object.keys(f).join(',') === 'chromaVersion';
    check(only(empty), 'toKeyFields(empty): { chromaVersion } alone (analysed, no pitch, never retried)');
    check(only(short), 'toKeyFields(too-short): { chromaVersion } alone');
    check(toKeyFields({ status: 'cancelled' } as PitchAnalysis) === null, 'toKeyFields(cancelled): null');
  }

  // -------------------------------------------------------------------------------------------- needsKey --
  check(needsKey({}) && needsKey({ chromaVersion: 0 }) && needsKey({ chromaVersion: CHROMA_VERSION + 1 }) && !needsKey({ chromaVersion: CHROMA_VERSION }),
    'needsKey: true unless the data is from this CHROMA_VERSION (older and newer both redo)');

  // ------------------------------------------------------------------------------------------ analyseKeyOf --
  {
    const n = 5 * SR;
    const l = new Float32Array(n), r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      l[i] = 0.2 * Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 220 * 2 ** (7 / 12) * t);
      r[i] = 0.2 * Math.sin(2 * Math.PI * 220 * 2 ** (3 / 12) * t);
    }
    let yields = 0;
    const f = await analyseKeyOf(source([l, r]), { sliceMs: 0, sliceSamples: 50_000, yieldFn: async () => { yields++; } });
    check(f !== null && Array.isArray(f.chroma) && f.chroma.length === 12 && f.musicKey === 'Am' && f.chromaVersion === CHROMA_VERSION
      && typeof f.chromaA4Hz === 'number' && typeof f.keyConfidence === 'number', `analyseKeyOf: a 22050 Hz stereo A-minor triad gives Am fields (${f ? f.musicKey : 'null'})`);
    check(yields > 2, `analyseKeyOf: the downmix and the analysis both yield (${yields})`);
    let threw = false;
    try {
      await analyseKeyOf(source([l.slice(), r.slice()], 44100), {});
    } catch {
      threw = true;
    }
    check(threw, 'analyseKeyOf: a 44.1 kHz buffer throws');
    let calls = 0;
    const cancelled = await analyseKeyOf(source([l.slice(), r.slice()]), { sliceMs: 0, sliceSamples: 50_000, yieldFn: async () => { calls++; }, shouldCancel: () => calls >= 1 });
    check(cancelled === null, 'analyseKeyOf: a cancel is null');
    const short = await analyseKeyOf(source([new Float32Array(1000)]), {});
    check(short !== null && short.chromaVersion === CHROMA_VERSION && short.chroma === undefined, 'analyseKeyOf: a too-short buffer is { chromaVersion } alone');
  }

  // ---------------------------------------------------------------------------------- createDecodeContext --
  {
    let ctx: unknown = 'threw';
    try {
      ctx = createDecodeContext();
    } catch {
      ctx = 'threw';
    }
    check(ctx === null, 'createDecodeContext() is null in node (no OfflineAudioContext), and never throws');
  }
}

await main();
console.log(`keyAnalysis: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures.slice(0, 30)) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
