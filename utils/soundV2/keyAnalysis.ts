// utils/soundV2/keyAnalysis.ts — Analyse tracks (v15.1): from a decoded buffer to the stored key fields.
//
// The browser path (build spec v15.1 §5.2, D1): decode with `new OfflineAudioContext(1, 1, 22050).decodeAudioData`
// (the browser resamples to 22050 Hz and keeps the channels), downmix channel 0 IN PLACE to ffmpeg's `-ac 1`
// scale, (L+R)·√½, then chroma.ts. The downmix mutates the buffer, so it runs only after anything else that reads
// the buffer (the envelope renders) has finished with it.
//
// Erasable TypeScript only (node runs it directly: keyAnalysis.check.ts). Nothing touches the DOM until
// createDecodeContext() is called.

import { analysePitchContent, SR } from './chroma.ts';
import type { PitchAnalysis, AnalyseOptions } from './chroma.ts';

/** What stored key data was made with: chroma.ts's results AND this module's decode/downmix path. Bump it
 *  when either changes for the same file; every track's key data is then redone (envelopes are kept). */
export const CHROMA_VERSION = 1;
export interface KeyFields { chroma?: number[]; chromaA4Hz?: number; musicKey?: string; keyConfidence?: number; chromaVersion: number }
/** The part of an AudioBuffer this module reads (an AudioBuffer is one). */
export interface ChannelSource { readonly numberOfChannels: number; readonly length: number; readonly sampleRate: number; getChannelData(c: number): Float32Array }

/** A context that decodes straight to 22050 Hz; null where there is none (node, or a browser without Web Audio). */
export function createDecodeContext(): OfflineAudioContext | null {
  try {
    return new OfflineAudioContext(1, 1, SR);
  } catch {
    return null;
  }
}

/** Channel 0 becomes the mono mix, in place, over samples [from, to): (L+R)·√½ as ffmpeg's `-ac 1` makes it, not
 *  Web Audio's 0.5·(L+R). One channel: channel 0 is returned untouched. More than two: the front pair only (ffmpeg
 *  rematrixes every channel; an approximation). Nothing is clipped: mono peaks reach 1.43. Returns channel 0. */
export function downmixInPlace(buf: ChannelSource, from = 0, to = buf.length): Float32Array {
  const ch0 = buf.getChannelData(0);
  if (buf.numberOfChannels < 2) return ch0;
  const ch1 = buf.getChannelData(1);
  const end = Math.min(to, ch0.length, ch1.length);
  for (let i = Math.max(0, from); i < end; i++) ch0[i] = (ch0[i] + ch1[i]) * Math.SQRT1_2;
  return ch0;
}

/** downmixInPlace in slices of sliceSamples (default 262,144), awaiting yieldFn(work ms) between slices; null when
 *  shouldCancel() turns true after a yield (channel 0 is then partly mixed: drop the buffer). Bitwise the same
 *  result as downmixInPlace. */
export async function downmixInPlaceSliced(
  buf: ChannelSource,
  o: { sliceSamples?: number; yieldFn?: (workMs: number) => Promise<void>; shouldCancel?: () => boolean; now?: () => number } = {},
): Promise<Float32Array | null> {
  const ch0 = buf.getChannelData(0);
  if (buf.numberOfChannels < 2) return ch0;
  const step = Math.max(1, Math.floor(o.sliceSamples ?? 262_144));
  const now = o.now ?? (() => performance.now());
  for (let from = 0; from < buf.length; from += step) {
    const t0 = now();
    downmixInPlace(buf, from, Math.min(buf.length, from + step));
    if (from + step >= buf.length) break;
    if (o.yieldFn) await o.yieldFn(now() - t0);
    if (o.shouldCancel && o.shouldCancel()) return null;
  }
  return ch0;
}

/** The Song fields for an analysis: the key data when it found pitch; { chromaVersion } alone when it found
 *  none or the track is too short (analysed, never retried); null when cancelled. The chroma is a fresh PLAIN
 *  Array: v15.2's key fit relies on Array.isArray, and IndexedDB keeps the type it is given. */
export function toKeyFields(a: PitchAnalysis): KeyFields | null {
  if (a.status === 'ok') {
    const c = a.content;
    return { chroma: [...c.chroma], chromaA4Hz: c.chromaA4Hz, musicKey: c.key, keyConfidence: c.keyConfidence, chromaVersion: CHROMA_VERSION };
  }
  if (a.status === 'empty' || a.status === 'too-short') return { chromaVersion: CHROMA_VERSION };
  return null;
}

/** True when a track has no key data from this CHROMA_VERSION. */
export function needsKey(s: { chromaVersion?: number }): boolean {
  return s.chromaVersion !== CHROMA_VERSION;
}

/** A 22050 Hz decode → its key fields: the sliced downmix, then the sliced analysis. null = cancelled. Throws on
 *  any other sample rate. MUTATES channel 0 (the downmix): call it only after the envelope renders are done. */
export async function analyseKeyOf(buf: ChannelSource, o: AnalyseOptions & { sliceSamples?: number }): Promise<KeyFields | null> {
  if (buf.sampleRate !== SR) throw new Error(`analyseKeyOf needs a ${SR} Hz buffer, not ${buf.sampleRate} Hz`);
  const mono = await downmixInPlaceSliced(buf, { sliceSamples: o.sliceSamples, yieldFn: o.yieldFn, shouldCancel: o.shouldCancel, now: o.now });
  if (!mono) return null;
  return toKeyFields(await analysePitchContent(mono, o));
}
