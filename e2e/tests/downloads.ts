// e2e/tests/downloads.ts (v16.5: Record's and Export's files, read in the page)
//
// The app saves a file by clicking a hidden <a download href="blob:…">. stubDownloads (an init script) catches that
// click instead: the anchor's name and its Blob's bytes are kept in the page (window.__downloads), and NOTHING is saved,
// so the same tests run on the phone without a file landing on it (the device artifact guard). The analysis runs in the
// page too (a WAV of a long recording never crosses the wire): wavInfo reads a WAV's header and its RMS per window.
// A test that must prove the real download path uses Playwright's own `download` event instead (layout.spec 16b).

import { type Page } from '@playwright/test';
import { expect } from './fixtures';

/** Catch every <a download> click on a blob: URL (from the first load on). */
export async function stubDownloads(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__downloads = [];
    w.__revoked = [] as string[];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.hasAttribute('download') && this.href.startsWith('blob:')) {
        const entry: any = { name: this.download, href: this.href, at: performance.now(), size: null, error: null, buf: null };
        w.__downloads.push(entry);
        fetch(this.href)
          .then((r) => r.arrayBuffer())
          .then((b) => {
            entry.buf = b;
            entry.size = b.byteLength;
          })
          .catch((e) => {
            entry.error = String(e);
          });
        return;
      }
      return click.call(this);
    };
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = function (url: string) {
      w.__revoked.push(url);
      return revoke.call(URL, url);
    };
  });
}

export interface CaughtDownload {
  name: string;
  size: number | null;
  error: string | null;
}

/** The downloads caught so far (their bytes read: waits until each has its size or an error). */
export async function caughtDownloads(page: Page, n?: number, timeout = 20_000): Promise<CaughtDownload[]> {
  if (n !== undefined) {
    await expect
      .poll(() => page.evaluate(() => ((window as any).__downloads ?? []).filter((d: any) => d.size !== null || d.error).length), { timeout, message: `${n} download(s) caught` })
      .toBeGreaterThanOrEqual(n);
  }
  return page.evaluate(() => ((window as any).__downloads ?? []).map((d: any) => ({ name: d.name, size: d.size, error: d.error })));
}

/** How many blob: URLs the app has revoked (URL.revokeObjectURL), and whether this one is among them. */
export async function revoked(page: Page, index: number): Promise<{ count: number; mine: boolean }> {
  return page.evaluate((i) => {
    const w = window as any;
    const d = (w.__downloads ?? [])[i];
    return { count: (w.__revoked ?? []).length, mine: !!d && (w.__revoked ?? []).includes(d.href) };
  }, index);
}

export interface WavInfo {
  format: number;
  channels: number;
  rate: number;
  bits: number;
  frames: number;
  seconds: number;
  /** RMS of each window (both channels), in order. */
  rms: number[];
  /** The window, in seconds. */
  win: number;
  /** RMS over the file's last `tail` seconds, and over its first `head` seconds. */
  tailRms: number;
  headRms: number;
}

/** Read caught download `index` as a PCM WAV (16 or 24-bit) in the page: its header and its RMS per window. */
export async function wavInfo(page: Page, index: number, o: { win?: number; tail?: number; head?: number } = {}): Promise<WavInfo> {
  return page.evaluate(
    ({ index, win, tail, head }) => {
      const d = (window as any).__downloads[index];
      if (!d || !d.buf) throw new Error(`download ${index} has no bytes (${d ? d.error : 'none'})`);
      const v = new DataView(d.buf as ArrayBuffer);
      const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
      if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV');
      let off = 12;
      let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
      let data: { at: number; size: number } | null = null;
      while (off + 8 <= v.byteLength) {
        const id = tag(off);
        const size = v.getUint32(off + 4, true);
        if (id === 'fmt ') fmt = { format: v.getUint16(off + 8, true), channels: v.getUint16(off + 10, true), rate: v.getUint32(off + 12, true), bits: v.getUint16(off + 22, true) };
        if (id === 'data') {
          data = { at: off + 8, size: Math.min(size, v.byteLength - off - 8) };
          break;
        }
        off += 8 + size + (size & 1);
      }
      if (!fmt || !data) throw new Error('no fmt or data chunk');
      const B = fmt.bits / 8;
      const frameBytes = B * fmt.channels;
      const frames = Math.floor(data.size / frameBytes);
      const sample = (p: number): number => {
        if (fmt!.bits === 16) return v.getInt16(p, true) / 32768;
        let x = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16);
        if (x & 0x800000) x -= 0x1000000;
        return x / 8388608;
      };
      const energy = (f0: number, f1: number): number => {
        let e = 0;
        let n = 0;
        for (let i = Math.max(0, f0); i < Math.min(frames, f1); i++) {
          for (let c = 0; c < fmt!.channels; c++) {
            const x = sample(data!.at + i * frameBytes + c * B);
            e += x * x;
            n++;
          }
        }
        return n ? Math.sqrt(e / n) : 0;
      };
      const w = Math.max(1, Math.round(win * fmt.rate));
      const rms: number[] = [];
      for (let f = 0; f + w <= frames; f += w) rms.push(energy(f, f + w));
      return {
        ...fmt,
        frames,
        seconds: frames / fmt.rate,
        rms,
        win,
        tailRms: energy(frames - Math.round(tail * fmt.rate), frames),
        headRms: energy(0, Math.round(head * fmt.rate)),
      };
    },
    { index, win: o.win ?? 0.5, tail: o.tail ?? 2, head: o.head ?? 4 }
  );
}
