// e2e/tests/wav.ts (v16.5, Export with layers: the WAV oracle, in the page)
//
// An export's file is read where it was made (a caught download, downloads.ts, or the dev hook's kept Blob,
// window.__exportBlobs), so a long file never crosses the wire and the phone saves nothing. It reads the RIFF header
// (fmt, LIST/INFO's INAM, data) and answers:
//   amp: a Hann-windowed single-bin DFT, amplitude-normalised (a full-scale sine reads 0 dB), per channel and window;
//   rms per window; the clipped samples (at ±full scale); and the largest |2nd difference| at the 4,096-frame slice
//   seams against everywhere else (a click detector).
// v16.5 review: `joins` adds a long file's joins (frames, the dev hook's) to the seams: their ±3 frames count as seams
// and are kept out of "elsewhere" (it looked only at k·4096 ± 2, never where the tracks met); the file's first and last
// 2 ms are out of both (the music's own start and end).

import { type Page } from '@playwright/test';

export interface WavProbe {
  /** Hz. */
  f: number;
  /** Seconds (output time). */
  t0: number;
  t1: number;
  ch: 0 | 1;
}

export interface WavReport {
  format: number;
  channels: number;
  rate: number;
  bits: number;
  frames: number;
  seconds: number;
  title: string | null;
  /** dB re full scale, one per probe. */
  amps: number[];
  rms: number[];
  clipped: number;
  /** Max |2nd difference| at the slice seams (frames k·4096 ± 2) and elsewhere, per channel 0. */
  seamD2: number;
  otherD2: number;
  /** The largest |2nd difference| within 3 frames of a join (o.joins), or 0. */
  joinD2: number;
}

/** Analyse a WAV in the page: `source` 'download' (downloads.ts's caught list) or 'hook' (window.__exportBlobs). */
export async function wavReport(page: Page, source: 'download' | 'hook', index: number, probes: WavProbe[] = [], o: { rmsWin?: number; seams?: boolean; joins?: number[] } = {}): Promise<WavReport> {
  return page.evaluate(
    async ({ source, index, probes, rmsWin, seams, joins }) => {
      const w = window as any;
      let buf: ArrayBuffer;
      if (source === 'download') {
        const d = (w.__downloads ?? [])[index];
        if (!d || !d.buf) throw new Error(`download ${index} has no bytes`);
        buf = d.buf;
      } else {
        const b: Blob | undefined = (w.__exportBlobs ?? [])[index];
        if (!b) throw new Error(`no kept blob ${index}`);
        buf = await b.arrayBuffer();
      }
      const v = new DataView(buf);
      const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
      if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV');
      let off = 12;
      let fmt: any = null;
      let data: { at: number; size: number } | null = null;
      let title: string | null = null;
      while (off + 8 <= v.byteLength) {
        const id = tag(off);
        const size = v.getUint32(off + 4, true);
        if (id === 'fmt ') fmt = { format: v.getUint16(off + 8, true), channels: v.getUint16(off + 10, true), rate: v.getUint32(off + 12, true), bits: v.getUint16(off + 22, true) };
        if (id === 'LIST' && tag(off + 8) === 'INFO') {
          let p = off + 12;
          while (p < off + 8 + size) {
            const sid = tag(p);
            const ssz = v.getUint32(p + 4, true);
            if (sid === 'INAM') title = new TextDecoder().decode(new Uint8Array(buf, p + 8, Math.max(0, ssz - 1)));
            p += 8 + ssz + (ssz & 1);
          }
        }
        if (id === 'data') {
          data = { at: off + 8, size: Math.min(size, v.byteLength - off - 8) };
          break;
        }
        off += 8 + size + (size & 1);
      }
      if (!fmt || !data) throw new Error('no fmt or data');
      const B = fmt.bits / 8;
      const fb = B * fmt.channels;
      const frames = Math.floor(data.size / fb);
      const FS = fmt.bits === 16 ? 32768 : 8388608;
      const sample = (i: number, c: number): number => {
        const p = data!.at + i * fb + c * B;
        if (fmt.bits === 16) return v.getInt16(p, true) / FS;
        let x = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16);
        if (x & 0x800000) x -= 0x1000000;
        return x / FS;
      };
      const amps = probes.map((pr: any) => {
        const s0 = Math.max(0, Math.round(pr.t0 * fmt.rate));
        const s1 = Math.min(frames, Math.round(pr.t1 * fmt.rate));
        const n = s1 - s0;
        if (n < 16) return -Infinity;
        let re = 0, im = 0, ws = 0;
        const k = (2 * Math.PI * pr.f) / fmt.rate;
        for (let i = 0; i < n; i++) {
          const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
          const x = sample(s0 + i, pr.ch) * win;
          re += x * Math.cos(k * i);
          im -= x * Math.sin(k * i);
          ws += win;
        }
        const a = (2 * Math.hypot(re, im)) / ws;
        return a > 0 ? 20 * Math.log10(a) : -Infinity;
      });
      const rms: number[] = [];
      const wn = Math.max(1, Math.round(rmsWin * fmt.rate));
      for (let f = 0; f + wn <= frames; f += wn) {
        let e = 0;
        for (let i = 0; i < wn; i++) for (let c = 0; c < fmt.channels; c++) { const x = sample(f + i, c); e += x * x; }
        rms.push(Math.sqrt(e / (wn * fmt.channels)));
      }
      let clipped = 0;
      for (let i = 0; i < frames; i++) for (let c = 0; c < fmt.channels; c++) { const x = sample(i, c); if (x >= (FS - 1) / FS || x <= -1) clipped++; }
      let seamD2 = 0, otherD2 = 0, joinD2 = 0;
      if (seams) {
        const J: number[] = Array.isArray(joins) ? joins : [];
        const edge = Math.round(0.002 * fmt.rate);
        for (let i = Math.max(1, edge); i < frames - 1 - edge; i++) {
          const d2 = Math.abs(sample(i + 1, 0) - 2 * sample(i, 0) + sample(i - 1, 0));
          const m = i % 4096;
          const atJoin = J.some((j) => Math.abs(i - j) <= 3);
          if (atJoin) joinD2 = Math.max(joinD2, d2);
          if (atJoin || m <= 2 || m >= 4094) seamD2 = Math.max(seamD2, d2);
          else otherD2 = Math.max(otherD2, d2);
        }
      }
      return { ...fmt, frames, seconds: frames / fmt.rate, title, amps, rms, clipped, seamD2, otherD2, joinD2 };
    },
    { source, index, probes, rmsWin: o.rmsWin ?? 0.5, seams: o.seams ?? false, joins: o.joins ?? [] }
  );
}
