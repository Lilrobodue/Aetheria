// utils/export/sourceInfo.check.ts (v16.5 review B1, B2): the header sniff, in Node (`npm run check:export`), on
// synthetic headers of each kind: the container, the rate, the channels, the bits, the header's own length, and the
// shortest a file of its size can be. v16.5 re-review: an MP3's length from its frames (VBR without a Xing header, a
// stale Xing, junk, joins, slices, fuzz, the time for 25 minutes), the header past cover art, a WAV's chunks and an
// MP4's boxes, the channels (5.1 from an esds), ADTS.

import { FOLLOW_UP_READS, MAX_BITRATE, MP3_LOOKAHEAD, SNIFF_BYTES, lengthLowerBound, mp3Result, mp3ScanStep, newMp3Scan, scanMp3, secondChunkAt, skipId3, sniffFile, sniffSource } from './sourceInfo.ts';
// v16.5 final fixes: the ADTS and Ogg walks, the plan per kind, the trust rule.
import { newStreamScan, scanPlanFor, scanStream, scanTrusted } from './sourceInfo.ts';
// v16.5 export memory: the Ogg walk's bound.
import { OGG_MAX_STREAMS } from './sourceInfo.ts';
import { fileKindOf } from './exportPlan.ts';
import type { ScanKind } from './sourceInfo.ts';

let passed = 0;
const failures: string[] = [];
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) === JSON.stringify(b)) passed++;
  else failures.push(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};
const ok = (c: boolean, what: string) => {
  if (c) passed++;
  else failures.push(what);
};
const near = (a: number | null, b: number, tol: number, what: string) => {
  if (a !== null && Math.abs(a - b) <= tol) passed++;
  else failures.push(`${what}: got ${a}, want ${b} ± ${tol}`);
};

class W {
  b: number[] = [];
  s(t: string) { for (const c of t) this.b.push(c.charCodeAt(0)); return this; }
  u8(v: number) { this.b.push(v & 0xff); return this; }
  u16le(v: number) { return this.u8(v).u8(v >> 8); }
  u32le(v: number) { return this.u8(v).u8(v >>> 8).u8(v >>> 16).u8(v >>> 24); }
  u16be(v: number) { return this.u8(v >> 8).u8(v); }
  u32be(v: number) { return this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v); }
  pad(n: number) { for (let i = 0; i < n; i++) this.b.push(0); return this; }
  bytes() { return Uint8Array.from(this.b); }
}

// WAV: PCM 44.1 kHz 16-bit stereo, 10 s of data.
const wav = (rate: number, bits: number, ch: number, seconds: number, o: { extensible?: boolean; dataSize?: number; listBytes?: number } = {}) => {
  const ba = ch * (bits / 8);
  const data = Math.round(rate * seconds) * ba;
  const w = new W().s('RIFF').u32le(36 + data).s('WAVE');
  if (o.listBytes) w.s('LIST').u32le(o.listBytes).pad(o.listBytes);
  w.s('fmt ').u32le(o.extensible ? 40 : 16).u16le(o.extensible ? 0xfffe : 1).u16le(ch).u32le(rate).u32le(rate * ba).u16le(ba).u16le(bits);
  if (o.extensible) w.u16le(22).u16le(bits).u32le(3).u16le(1).pad(14);
  w.s('data').u32le(o.dataSize ?? data);
  return { head: w.bytes(), size: w.b.length + data };
};
{
  const { head, size } = wav(44_100, 16, 2, 10);
  const i = sniffSource(head, null, size);
  eq([i.container, i.codec, i.lossless, i.sampleRate, i.channels, i.bits], ['wav', 'pcm', true, 44_100, 2, 16], 'WAV 44.1/16');
  near(i.seconds, 10, 1e-9, 'WAV: the length from the data chunk');
  near(lengthLowerBound(i, size), 10, 0.01, 'WAV: the shortest it can be is its length');
}
{
  const { head, size } = wav(96_000, 24, 2, 7, { extensible: true });
  const i = sniffSource(head, null, size);
  eq([i.codec, i.sampleRate, i.bits], ['pcm', 96_000, 24], 'WAV extensible 96/24');
  near(i.seconds, 7, 1e-9, 'WAV extensible: its length');
}
{
  // A streamed WAV's data size 0xFFFFFFFF, and 0: the rest of the file.
  for (const ds of [0xffffffff, 0]) {
    const { head, size } = wav(48_000, 16, 2, 5, { dataSize: ds });
    const i = sniffSource(head, null, size);
    near(i.seconds, 5, 1e-9, `WAV data size ${ds}: the rest of the file`);
  }
  // A long LIST chunk before fmt: still read (the data chunk past the first bytes counts the rest of the file).
  const { head, size } = wav(44_100, 16, 2, 20, { listBytes: 70_000 });
  const i = sniffSource(head.subarray(0, 65_536), null, size);
  eq(i.container, 'wav', 'a long tag first: still a WAV');
}

// AIFF 48 kHz 24-bit stereo, 12 s.
{
  const frames = 48_000 * 12;
  const w = new W().s('FORM').u32be(0).s('AIFF').s('COMM').u32be(18).u16be(2).u32be(frames).u16be(24);
  // 48000 as an 80-bit extended: exponent 16383 + 15, mantissa 48000 << 48.
  w.u16be(16383 + 15);
  const m = 48_000 * 2 ** 48;
  for (let k = 7; k >= 0; k--) w.u8(Math.floor(m / 2 ** (8 * k)) % 256);
  const i = sniffSource(w.bytes(), null, w.b.length + frames * 6);
  eq([i.container, i.codec, i.sampleRate, i.channels, i.bits], ['aiff', 'pcm', 48_000, 2, 24], 'AIFF 48/24');
  near(i.seconds, 12, 1e-9, 'AIFF: its length from COMM');
}

// FLAC 96 kHz 24-bit stereo, 3 minutes, behind an ID3v2 tag.
const flacHead = (rate: number, ch: number, bits: number, total: number, id3 = 0) => {
  const w = new W();
  if (id3) w.s('ID3').u8(4).u8(0).u8(0).u8(0).u8(0).u8((id3 >> 7) & 0x7f).u8(id3 & 0x7f).pad(id3);
  w.s('fLaC').u8(0x80).u8(0).u8(0).u8(34).u16be(4096).u16be(4096).pad(6);
  w.u8(rate >> 12).u8((rate >> 4) & 0xff).u8(((rate & 0x0f) << 4) | ((ch - 1) << 1) | ((bits - 1) >> 4));
  w.u8((((bits - 1) & 0x0f) << 4) | Math.floor(total / 2 ** 32)).u32be(total >>> 0).pad(16);
  return w.bytes();
};
{
  const head = flacHead(96_000, 2, 24, 96_000 * 180, 300);
  eq(skipId3(head), 310, 'an ID3v2 tag is skipped');
  const i = sniffSource(head, null, 70_000_000);
  eq([i.container, i.codec, i.lossless, i.sampleRate, i.channels, i.bits], ['flac', 'flac', true, 96_000, 2, 24], 'FLAC 96/24');
  near(i.seconds, 180, 1e-9, 'FLAC: its length from STREAMINFO');
  near(lengthLowerBound(i, 70_000_000), (70_000_000 * 8) / (96_000 * 2 * 24 * 1.05), 1e-6, 'FLAC: at least its size over PCM × 1.05');
  const unknownTotal = sniffSource(flacHead(44_100, 2, 16, 0), null, 20_000_000);
  eq(unknownTotal.seconds, null, 'FLAC without a sample count: no length');
}

// MP3: an ID3v2 tag, then MPEG-1 layer III frames at 44.1 kHz, 128 kbps (418 / 417 bytes).
const mp3 = (rate: 44_100 | 48_000 | 32_000, frames: number, mono = false) => {
  const ri = rate === 44_100 ? 0 : rate === 48_000 ? 1 : 2;
  const w = new W().s('ID3').u8(3).u8(0).u8(0).u8(0).u8(0).u8(1).u8(0).pad(128);
  for (let f = 0; f < frames; f++) {
    const len = Math.floor((144 * 128_000) / rate);
    w.u8(0xff).u8(0xfb).u8((9 << 4) | (ri << 2)).u8(mono ? 0xc0 : 0x00).pad(len - 4);
  }
  return w.bytes();
};
{
  const i = sniffSource(mp3(44_100, 20), null, 4_000_000);
  eq([i.container, i.codec, i.lossless, i.sampleRate, i.channels, i.seconds], ['mp3', 'mp3', false, 44_100, 2, null], 'MP3 44.1 kHz');
  eq(sniffSource(mp3(48_000, 20, true), null, 4_000_000).sampleRate, 48_000, 'MP3 48 kHz');
  eq(sniffSource(mp3(48_000, 20, true), null, 4_000_000).channels, 1, 'MP3 mono');
  near(lengthLowerBound(i, 57_600_000), (57_600_000 * 8) / MAX_BITRATE.mp3, 1e-9, 'MP3: a 57.6 MB file is at least 24 minutes (320 kbps)');
}

// Ogg Vorbis 48 kHz and Opus.
const oggPage = (packet: number[]) => new W().s('OggS').pad(22).u8(1).u8(packet.length).bytes();
{
  const vorbis = [0x01, ...'vorbis'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0, 0, 2, ...[0x80, 0xbb, 0, 0]];
  const head = Uint8Array.from([...oggPage(vorbis), ...vorbis]);
  const i = sniffSource(head, null, 1_000_000);
  eq([i.container, i.codec, i.sampleRate, i.channels], ['ogg', 'vorbis', 48_000, 2], 'Ogg Vorbis 48 kHz');
  const opus = [...'OpusHead'.split('').map((c) => c.charCodeAt(0)), 1, 2, 0, 0, 0x44, 0xac, 0, 0, 0, 0, 0];
  const oh = Uint8Array.from([...oggPage(opus), ...opus]);
  eq([sniffSource(oh, null, 1).codec, sniffSource(oh, null, 1).sampleRate], ['opus', 48_000], 'Opus decodes at 48 kHz');
}

// MP4 / M4A: ftyp, mdhd (the length), an mp4a entry and its esds (AAC LC 44.1 kHz; HE-AAC: the SBR rate).
const m4a = (ascRate: number, aot: number, moovAtEnd = false) => {
  const fi = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050].indexOf(ascRate);
  const ftyp = new W().u32be(20).s('ftyp').s('M4A ').u32be(0).s('M4A ').bytes();
  const mdhd = new W().u32be(32).s('mdhd').u8(0).pad(3).u32be(0).u32be(0).u32be(ascRate).u32be(ascRate * 200).pad(4).bytes();
  const esds = new W().u32be(0).s('esds').u32be(0).u8(0x03).u8(25).u16be(1).u8(0).u8(0x04).u8(17).u8(0x40).u8(0x15).pad(11).u8(0x05).u8(2).u8((aot << 3) | (fi >> 1)).u8(((fi & 1) << 7) | (2 << 3)).bytes();
  const entry = new W().u32be(36 + esds.length).s('mp4a').pad(6).u16be(1).pad(8).u16be(2).u16be(16).pad(4).u16be(Math.min(ascRate, 65535)).u16be(0).bytes();
  const moov = Uint8Array.from([...mdhd, ...entry, ...esds]);
  const mdat = new Uint8Array(70_000);
  return moovAtEnd ? { head: Uint8Array.from([...ftyp, ...mdat.subarray(0, 65_000)]), tail: moov } : { head: Uint8Array.from([...ftyp, ...moov]), tail: null };
};
{
  const a = m4a(44_100, 2);
  const i = sniffSource(a.head, a.tail, 5_000_000);
  eq([i.container, i.codec, i.lossless, i.sampleRate, i.channels], ['mp4', 'aac', false, 44_100, 2], 'M4A AAC-LC 44.1 kHz');
  near(i.seconds, 200, 1e-9, 'M4A: its length from mdhd');
  const he = m4a(24_000, 5);
  eq(sniffSource(he.head, he.tail, 1).sampleRate, 48_000, 'HE-AAC: the SBR rate (twice the core)');
  const hi = m4a(96_000, 2);
  eq(sniffSource(hi.head, hi.tail, 1).sampleRate, 96_000, 'AAC 96 kHz from the esds (the entry field stops at 65,535)');
  const end = m4a(44_100, 2, true);
  eq(sniffSource(end.head, end.tail, 10_000_000).seconds, 200, 'the moov at the end: read from the tail');
}

// Where the second chunk is read: an MP4's moov past its media data (the boxes walked by size), else the last bytes.
{
  const head = Uint8Array.from([...new W().u32be(20).s('ftyp').s('M4A ').u32be(0).s('M4A ').u32be(1_000_000).s('mdat').bytes(), ...new Uint8Array(4000)]);
  eq(secondChunkAt(head, 3_000_000), 1_000_020, 'an MP4: the box after the media data (its moov)');
  eq(secondChunkAt(head, 1_000_020), 1_000_020 - SNIFF_BYTES, 'the media data runs to the end: the last bytes');
  eq(secondChunkAt(new Uint8Array(100), 5_000_000), 5_000_000 - SNIFF_BYTES, 'anything else: the last bytes');
}

// Unknown bytes: nothing claimed; no bound.
{
  const junk = Uint8Array.from({ length: 4096 }, (_, k) => (k * 37) & 0x7f);
  const i = sniffSource(junk, null, 4096, 'tone.bin', '');
  eq([i.container, i.sampleRate, i.seconds], ['unknown', null, null], 'unknown bytes');
  eq(lengthLowerBound(i, 4096), 0, 'unknown: no lower bound');
  eq(sniffSource(junk, null, 4096, 'tone.mp3', 'audio/mpeg').container, 'mp3', 'unknown bytes named .mp3: an MP3 without a rate');
  eq(sniffSource(new Uint8Array(0), null, 0).container, 'unknown', 'no bytes');
}

// ---- v16.5 re-review (B1): an MP3's length from its frames.

/** An MPEG-1 layer III frame (44.1 / 48 / 32 kHz) at a bit rate index, its payload zeros; `info` puts a Xing (or
 *  VBRI) header in it stating `infoFrames`. MPEG-2 (`v2`): 576 samples a frame. */
const KBPS1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const KBPS2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
function frame(rate: number, bi: number, o: { mono?: boolean; info?: 'Xing' | 'Info' | 'VBRI'; infoFrames?: number; v2?: boolean } = {}): number[] {
  const v2 = !!o.v2;
  const ri = v2 ? [22_050, 24_000, 16_000].indexOf(rate) : [44_100, 48_000, 32_000].indexOf(rate);
  const kbps = (v2 ? KBPS2 : KBPS1)[bi];
  const len = Math.floor(((v2 ? 72 : 144) * kbps * 1000) / rate);
  const b = new Array<number>(len).fill(0);
  b[0] = 0xff;
  b[1] = v2 ? 0xf3 : 0xfb;
  b[2] = (bi << 4) | (ri << 2);
  b[3] = o.mono ? 0xc0 : 0x00;
  if (o.info) {
    const at = o.info === 'VBRI' ? 36 : 4 + (v2 ? (o.mono ? 9 : 17) : o.mono ? 17 : 32);
    const w = new W().s(o.info);
    if (o.info === 'VBRI') w.u16be(1).u16be(576).u16be(75).u32be(0).u32be(o.infoFrames ?? 0);
    else w.u32be(o.infoFrames === undefined ? 0 : 1).u32be(o.infoFrames ?? 0);
    w.b.forEach((x, k) => (b[at + k] = x));
  }
  return b;
}
const cat = (...parts: Array<number[] | Uint8Array>) => {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const frames = (n: number, rate: number, bi: number | ((k: number) => number), o: { v2?: boolean; mono?: boolean } = {}) => {
  const parts: number[][] = [];
  for (let k = 0; k < n; k++) parts.push(frame(rate, typeof bi === 'number' ? bi : bi(k), o));
  return cat(...parts);
};
const id3Tag = (size: number) => cat(new W().s('ID3').u8(4).u8(0).u8(0).u8((size >> 21) & 0x7f).u8((size >> 14) & 0x7f).u8((size >> 7) & 0x7f).u8(size & 0x7f).bytes(), new Uint8Array(size).fill(0x55));
const spf = 1152 / 44_100;
{
  // CBR, behind a tag: every frame counted.
  const s = scanMp3(cat(id3Tag(300), frames(1000, 44_100, 9)));
  near(s?.seconds ?? null, 1000 * spf, 1e-9, 'MP3 CBR: 1,000 frames');
  eq([s?.frames, s?.sampleRate, s?.channels, s?.xingSeconds, s?.junk], [1000, 44_100, 2, null, 0], 'MP3 CBR: frames, rate, channels, no Xing, no junk');
}
{
  // VBR without a Xing header, loud then quiet (Chrome's guess from the first frames would be a quarter of it).
  const b = frames(4000, 44_100, (k) => (k < 200 ? 14 : 1));
  const s = scanMp3(b);
  near(s?.seconds ?? null, 4000 * spf, 1e-9, 'MP3 VBR, no Xing: every frame at its own size');
  ok((b.length * 8) / 320_000 < 0.3 * (s?.seconds ?? 0), 'the size bound alone would have been far short');
}
{
  // Xing / Info / VBRI stating the right count: agrees, and the information frame isn't counted.
  for (const info of ['Xing', 'Info', 'VBRI'] as const) {
    const s = scanMp3(cat(id3Tag(64), frame(44_100, 9, { info, infoFrames: 500 }), frames(500, 44_100, (k) => 5 + (k % 9))));
    eq([s?.frames, s?.xingAgrees], [500, true], `MP3 with a correct ${info} header: 500 frames, it agrees`);
    near(s?.xingSeconds ?? null, 500 * spf, 1e-9, `${info}: its own length`);
  }
  // A stale count (a joined file: the first part's): the frames win, the header disagrees.
  const stale = scanMp3(cat(id3Tag(64), frame(44_100, 9, { info: 'Xing', infoFrames: 100 }), frames(100, 44_100, 9), id3Tag(5000), frame(44_100, 9, { info: 'Info', infoFrames: 900 }), frames(900, 44_100, 9)));
  near(stale?.seconds ?? null, 1001 * spf, 1e-9, 'a joined file with a stale Xing: every frame (the second Info frame counted: it is mid-stream)');
  eq(stale?.xingAgrees, false, 'the stale Xing disagrees');
  ok((stale?.junk ?? 0) >= 5010, 'the second tag skipped as junk');
  // A cut file (the Xing states more than is there): the frames.
  const cut = scanMp3(cat(frame(44_100, 9, { info: 'Xing', infoFrames: 5000 }), frames(300, 44_100, 9)));
  near(cut?.seconds ?? null, 300 * spf, 1e-9, 'a cut file: the frames it has');
}
{
  // Junk in the middle (a damaged stretch, 0xFF-heavy), an ID3v1 tag and an APE tag at the end, a truncated last frame.
  const junk = Uint8Array.from({ length: 3000 }, (_, k) => (k % 3 === 0 ? 0xff : (k * 29) & 0xff));
  const tail = cat(new W().s('APETAGEX').pad(24).bytes(), new W().s('TAG').pad(125).bytes());
  const s = scanMp3(cat(frames(400, 44_100, 9), junk, frames(600, 44_100, 10), tail));
  near(s?.seconds ?? null, 1000 * spf, 1e-9, 'junk in the middle, tags at the end: every frame');
  ok((s?.junk ?? 0) >= 3000 && (s?.junk ?? 0) < 3200, `the junk counted (${s?.junk})`);
  const f = frames(50, 44_100, 9);
  const t = scanMp3(f.subarray(0, f.length - 200));
  near(t?.seconds ?? null, 50 * spf, 1e-9, 'a truncated last frame counts (never short)');
}
{
  // A joined stream at another rate and version: each frame at its own rate (never short).
  const s = scanMp3(cat(frames(300, 44_100, 9), frames(500, 24_000, 8, { v2: true })));
  near(s?.seconds ?? null, 300 * spf + (500 * 576) / 24_000, 1e-9, 'a 44.1 kHz MPEG-1 part then a 24 kHz MPEG-2 part');
  eq(s?.sampleRate, 44_100, 'the rate is the first frame\'s');
  eq(scanMp3(frames(20, 48_000, 9, { mono: true }))?.channels, 1, 'mono');
}
{
  // Not an MP3: nothing claimed.
  eq(scanMp3(Uint8Array.from({ length: 50_000 }, (_, k) => (k * 37 + 11) & 0x7f)), null, 'junk bytes: no scan');
  eq(scanMp3(wav(44_100, 16, 2, 1).head), null, 'a WAV header: no scan');
  eq(scanMp3(new Uint8Array(0)), null, 'no bytes');
}
{
  // In slices (the long file's plan): the same as the whole, a tag longer than a slice included; and the steps'
  // positions never go back.
  const whole = cat(id3Tag(70_000), frame(44_100, 9, { info: 'Xing', infoFrames: 77 }), frames(3000, 44_100, (k) => 1 + (k % 14)), Uint8Array.from({ length: 2000 }, (_, k) => (k * 13) & 0x7f), frames(1000, 48_000, 11), new W().s('TAG').pad(125).bytes());
  const one = scanMp3(whole);
  for (const slice of [20_000, 65_536, 300_001]) {
    const st = newMp3Scan();
    let steps = 0;
    while (!st.done && st.pos < whole.length && steps < 10_000) {
      const from = st.pos;
      const end = Math.min(whole.length, from + slice + MP3_LOOKAHEAD);
      mp3ScanStep(st, whole.subarray(from, end), end >= whole.length);
      steps++;
      if (st.pos <= from && !st.done) break;
    }
    const r = mp3Result(st);
    eq([r?.frames, r?.junk, r?.xingSeconds !== null], [one?.frames, one?.junk, true], `in ${slice}-byte slices: the same frames and junk as the whole`);
    near(r?.seconds ?? null, one?.seconds ?? 0, 1e-9, `in ${slice}-byte slices: the same length`);
  }
}
{
  // Never throws, always ends: random bytes with frame headers sprinkled in, whole and in slices.
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let bad = 0;
  for (let it = 0; it < 300; it++) {
    const b = Uint8Array.from({ length: 2000 + ((rnd() * 60_000) | 0) }, () => (rnd() < 0.05 ? 0xff : (rnd() * 256) | 0));
    for (let k = 0; k < 30; k++) b.set(frame(44_100, 1 + ((rnd() * 14) | 0)).slice(0, 4), (rnd() * (b.length - 4)) | 0);
    try {
      const s = scanMp3(b);
      if (s && !(s.seconds >= 0 && Number.isFinite(s.seconds))) bad++;
      const st = newMp3Scan();
      for (let g = 0; g < 1000 && !st.done && st.pos < b.length; g++) {
        const from = st.pos;
        const end = Math.min(b.length, from + 4096 + MP3_LOOKAHEAD);
        mp3ScanStep(st, b.subarray(from, end), end >= b.length);
        if (st.pos <= from && !st.done) break;
      }
    } catch {
      bad++;
    }
  }
  eq(bad, 0, 'fuzz: 300 random files, none throws or gives a bad length');
}
{
  // The time: a 25-minute VBR file (V0-like: 128–320 kbps, about 40 MB), walked whole. Milliseconds (the phone at 4×
  // CPU throttle is measured in the browser: the re-review's log).
  const n = Math.round((25 * 60) / spf);
  const big = frames(n, 44_100, (k) => 9 + (k % 6));
  const t0 = performance.now();
  const s = scanMp3(big);
  const ms = performance.now() - t0;
  near(s?.seconds ?? null, n * spf, 1e-6, `a 25-minute file (${(big.length / 1e6).toFixed(1)} MB): its length`);
  ok(ms < 250, `a 25-minute file walked in ${ms.toFixed(1)} ms (Node)`);
  console.log(`  (the 25-minute scan: ${(big.length / 1e6).toFixed(1)} MB in ${ms.toFixed(1)} ms)`);
}

// ---- v16.5 re-review (B7): the header where it is (sniffFile's reads on).
const reader = (b: Uint8Array) => async (at: number, n: number) => b.subarray(at, Math.min(b.length, at + n));
{
  // MP3s with cover art: 100 KB and 600 KB tags (the first bytes alone don't reach the first frame).
  for (const art of [100_000, 600_000]) {
    const file = cat(id3Tag(art), frames(400, 44_100, 9));
    const first = sniffSource(file.subarray(0, SNIFF_BYTES), file.subarray(file.length - SNIFF_BYTES), file.length, 'a.mp3', 'audio/mpeg');
    eq(first.sampleRate, null, `${art / 1000} KB of cover art: the first bytes alone don't say the rate`);
    const { info, reads } = await sniffFile(reader(file), file.length, 'a.mp3', 'audio/mpeg');
    eq([info.container, info.sampleRate, info.channels], ['mp3', 44_100, 2], `${art / 1000} KB of cover art: read on past it, 44.1 kHz`);
    ok(reads <= 4, `${art / 1000} KB of cover art: ${reads} reads`);
  }
  // A FLAC behind a long tag.
  const flac = cat(id3Tag(90_000), flacHead(48_000, 2, 16, 48_000 * 60), new Uint8Array(1000));
  const f = await sniffFile(reader(flac), flac.length);
  eq([f.info.container, f.info.sampleRate], ['flac', 48_000], 'a FLAC behind a 90 KB tag');
  // A WAV with 100 KB of chunks before its fmt.
  const big = wav(96_000, 24, 2, 3, { listBytes: 100_000 });
  const whole = cat(big.head, new Uint8Array(big.size - big.head.length));
  const w = await sniffFile(reader(whole), whole.length, 'a.wav');
  eq([w.info.container, w.info.sampleRate, w.info.channels, w.info.bits], ['wav', 96_000, 2, 24], 'a WAV with 100 KB of chunks before fmt');
  near(w.info.seconds, 3, 1e-9, 'its length from its data chunk');
  // An MP4 whose audio track's sample entry is past the first 64 KB of its moov (a big track before it).
  const box = (type: string, ...kids: Uint8Array[]) => {
    const body = cat(...kids);
    return cat(new W().u32be(8 + body.length).s(type).bytes(), body);
  };
  const full = (type: string, ...kids: Uint8Array[]) => box(type, new Uint8Array(4), ...kids);
  const esds = new W().u32be(0).s('esds').u32be(0).u8(0x03).u8(25).u16be(1).u8(0).u8(0x04).u8(17).u8(0x40).u8(0x15).pad(11).u8(0x05).u8(2).u8((2 << 3) | (4 >> 1)).u8(((4 & 1) << 7) | (6 << 3)).bytes();
  esds.set(new W().u32be(esds.length).bytes(), 0);
  const entry = new W().u32be(36 + esds.length).s('mp4a').pad(6).u16be(1).pad(8).u16be(2).u16be(16).pad(4).u16be(44_100).u16be(0).bytes();
  const audioTrak = box('trak', box('mdia', full('mdhd', new W().u32be(0).u32be(0).u32be(44_100).u32be(44_100 * 30).pad(4).bytes()), box('minf', box('stbl', full('stsd', new W().u32be(1).bytes(), entry, esds)))));
  const videoTrak = box('trak', box('mdia', box('minf', box('stbl', box('stsz', new Uint8Array(120_000))))));
  const mp4File = cat(new W().u32be(20).s('ftyp').s('M4A ').u32be(0).s('M4A ').bytes(), box('moov', full('mvhd', new Uint8Array(96)), videoTrak, audioTrak), box('mdat', new Uint8Array(50_000)));
  const m = await sniffFile(reader(mp4File), mp4File.length, 'a.m4a');
  eq([m.info.container, m.info.codec, m.info.sampleRate, m.info.channels], ['mp4', 'aac', 44_100, 6], 'an MP4: its audio track found past a big video track; 5.1 from the esds');
  ok(m.reads <= 2 + FOLLOW_UP_READS, `the MP4 walk: ${m.reads} reads`);
}

// ---- Multichannel: the channels where the header has them.
{
  eq(sniffSource(wav(48_000, 24, 6, 2).head, null, wav(48_000, 24, 6, 2).size).channels, 6, 'a 6-channel WAV');
  eq(sniffSource(flacHead(48_000, 6, 24, 48_000 * 60), null, 10_000_000).channels, 6, 'a 6-channel FLAC');
  eq(sniffSource(wav(44_100, 16, 1, 2).head, null, wav(44_100, 16, 1, 2).size).channels, 1, 'a mono WAV');
}

// ---- B2: ADTS AAC (raw .aac; named .mp3 too).
{
  const adtsFrame = (fi: number, ch: number, len: number) => {
    const b = new Uint8Array(len);
    b[0] = 0xff;
    b[1] = 0xf1;
    b[2] = (1 << 6) | (fi << 2) | (ch >> 2);
    b[3] = ((ch & 3) << 6) | ((len >> 11) & 3);
    b[4] = (len >> 3) & 0xff;
    b[5] = ((len & 7) << 5) | 0x1f;
    b[6] = 0xfc;
    return b;
  };
  const adts = (fi: number, ch: number) => cat(...Array.from({ length: 20 }, () => adtsFrame(fi, ch, 371)));
  const a = sniffSource(adts(4, 2), null, 100_000, 'a.mp3', 'audio/mpeg');
  eq([a.container, a.codec, a.sampleRate, a.channels], ['adts', 'aac', 44_100, 2], 'ADTS AAC 44.1 kHz stereo (named .mp3)');
  eq(sniffSource(adts(7, 2), null, 100_000).sampleRate, null, 'ADTS at 22.05 kHz: the rate unknown (HE-AAC may double it)');
  eq(sniffSource(adts(3, 6), null, 100_000).channels, 6, 'ADTS 5.1');
}

// ---- v16.5 final fixes ------------------------------------------------------------------------------------------

/** A walk in slices as the engine's long-file plan steps it (any slice size): its result, or 'stalled'. */
const sliced = (kind: ScanKind, b: Uint8Array, slice: number) => {
  // v16.5 export memory: the walked bytes in all, as the engine's long-file plan passes them (fix 5).
  const s = newStreamScan(kind, b.length);
  for (let g = 0; g < 100_000 && !s.done(); g++) {
    const from = s.pos();
    if (from >= b.length) break;
    const end = Math.min(b.length, from + slice + s.lookahead);
    s.step(b.subarray(from, end), end >= b.length);
    if (s.pos() <= from && !s.done()) return 'stalled' as const;
  }
  return s.result();
};
const same = (a: unknown, w: unknown, what: string) => eq(JSON.stringify(a), JSON.stringify(w), what);

// ---- Fix 2: the MP3 walk's edges (the final review's mid-id3-bogus.mp3 and junk-after-tag-20k.mp3, synthetic).
{
  const before = frames(2000, 44_100, (k) => 1 + (k % 14));
  const after = frames(2500, 44_100, (k) => 14 - (k % 13));
  const all = 4500 * spf;
  // A mid-stream ID3v2 header whose size is bogus (0x7f7f7f7f: 256 MB): only its 10 bytes are junk.
  const bogus = cat(before, Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f]), after);
  const s = scanMp3(bogus);
  near(s?.seconds ?? null, all, 1e-9, 'a mid-stream ID3 header with a bogus size: every frame (it skipped the rest of the file)');
  eq([s?.frames, s?.junk], [4500, 10], 'the bogus header: 10 bytes of junk');
  ok(scanTrusted(s, bogus.length), 'and the scan is trusted');
  for (const slice of [20_000, 65_536, 8 << 20]) same(sliced('mp3', bogus, slice), s, `the bogus header in ${slice}-byte slices: the same`);
  // A real tag in the middle still skipped whole (a frame after it), and one at the very end (nothing after it).
  const mid = scanMp3(cat(before, id3Tag(3000), after));
  eq([mid?.frames, mid?.junk], [4500, 3010], 'a real mid-stream tag: skipped whole');
  // v16.5 export memory: a tag ending at the end of the file isn't junk (its header begins the bytes to the end, and no
  // frame is in them).
  eq([scanMp3(cat(before, id3Tag(500)))?.junk, scanMp3(cat(before, id3Tag(500)))?.tags], [0, 510], 'a tag ending at the end of the file: a tag, not junk');
  // A tag in the middle claiming to end past these bytes, but the file goes on: junk, walked through to the frames.
  const past = cat(before, cat(new W().s('ID3').u8(4).u8(0).u8(0).u8(0).u8(0x7f).u8(0x7f).u8(0x7f).bytes(), new Uint8Array(400)), after);
  near(scanMp3(past)?.seconds ?? null, all, 1e-9, 'a tag whose end is past the file: its bytes walked through');
}
{
  // More than 16 KB of junk between the leading tag and the first frame (no 0xFF in it): walked through (it gave none).
  const junk = Uint8Array.from({ length: 20_000 }, (_, k) => (k * 37 + 11) & 0x7f);
  const body = frames(3000, 44_100, (k) => 1 + (k % 14));
  const file = cat(id3Tag(10), junk, body);
  const s = scanMp3(file);
  near(s?.seconds ?? null, 3000 * spf, 1e-9, '20 KB of junk after the leading tag: every frame');
  eq([s?.frames, s?.junk], [3000, 20_000], 'the junk counted');
  ok(scanTrusted(s, file.length), 'trusted (the junk is 2 % of the file)');
  for (const slice of [20_000, 65_536]) same(sliced('mp3', file, slice), s, `20 KB of junk in ${slice}-byte slices: the same`);
  // Its Xing frame after the junk: read and passed over, as at the start.
  const x = scanMp3(cat(id3Tag(10), junk, frame(44_100, 9, { info: 'Xing', infoFrames: 3000 }), body));
  eq([x?.frames, x?.xingAgrees], [3000, true], 'a Xing frame after the junk: passed over, its count agrees');
  // 200 KB of junk, then a file at another rate: still found.
  near(scanMp3(cat(id3Tag(10), new Uint8Array(200_000).fill(0x20), frames(500, 48_000, 9)))?.seconds ?? null, 500 * (1152 / 48_000), 1e-9, '200 KB of junk: walked through');
  // Bytes with no frames at all: still no scan (and not trusted).
  eq(scanMp3(cat(id3Tag(10), new Uint8Array(100_000).fill(0x41))), null, 'no frames anywhere: no scan');
}

// ---- Fix 1: ADTS AAC's length from its frames.
const adtsHead = (fi: number, ch: number, len: number, o: { blocks?: number; crc?: boolean } = {}) => {
  const b = new Uint8Array(len).fill(0x21);
  b[0] = 0xff;
  b[1] = o.crc ? 0xf0 : 0xf1;
  b[2] = (1 << 6) | (fi << 2) | (ch >> 2);
  b[3] = ((ch & 3) << 6) | ((len >> 11) & 3);
  b[4] = (len >> 3) & 0xff;
  b[5] = ((len & 7) << 5) | 0x1f;
  b[6] = 0xfc | ((o.blocks ?? 1) - 1);
  return b;
};
const adtsFrames = (n: number, fi: number, len: (k: number) => number, o: { blocks?: number; crc?: boolean; ch?: number } = {}) =>
  cat(...Array.from({ length: n }, (_, k) => adtsHead(fi, o.ch ?? 2, len(k), o)));
const AAC44 = 1024 / 44_100;
{
  // VBR (frame sizes 120–1,900 bytes: loud then quiet), as the review's 300 s files; Chrome's estimate from the first
  // frames' bit rate is a fraction of it.
  const n = Math.round(300 / AAC44);
  const vbr = adtsFrames(n, 4, (k) => (k < 400 ? 1900 : 120 + (k % 37)));
  const s = scanStream('adts', vbr);
  near(s?.seconds ?? null, n * AAC44, 1e-6, `ADTS VBR, 300 s (${n} frames): every frame`);
  eq([s?.kind, s?.frames, s?.sampleRate, s?.channels, s?.junk], ['adts', n, 44_100, 2, 0], 'its kind, frames, rate, channels, no junk');
  ok((vbr.length * 8) / ((1900 * 8 * 44_100) / 1024) < 0.2 * 300, 'an estimate from the first frames would be far short');
  for (const slice of [20_000, 65_536, 8 << 20]) same(sliced('adts', vbr, slice), s, `ADTS in ${slice}-byte slices: the same`);
  // Two raw data blocks a frame (2,048 samples), a CRC'd header, 48 kHz, mono.
  near(scanStream('adts', adtsFrames(100, 3, () => 700, { blocks: 2, crc: true, ch: 1 }))?.seconds ?? null, (100 * 2048) / 48_000, 1e-9, 'two raw blocks a frame, with a CRC, 48 kHz');
  eq(scanStream('adts', adtsFrames(10, 3, () => 300, { ch: 1 }))?.channels, 1, 'mono');
  // A leading ID3 tag (a stream rip's), junk in the middle, a bogus tag header, a truncated last frame.
  const parts = cat(id3Tag(2000), adtsFrames(500, 4, () => 400), Uint8Array.from({ length: 3000 }, (_, k) => (k % 3 ? 0xff : 0x10)), adtsFrames(500, 4, () => 380), Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f]), adtsFrames(200, 4, () => 410));
  const p = scanStream('adts', parts.subarray(0, parts.length - 100));
  near(p?.seconds ?? null, 1200 * AAC44, 1e-9, 'a tag first, junk, a bogus tag, a truncated last frame: every frame');
  ok((p?.junk ?? 0) >= 3010 && (p?.junk ?? 0) < 3200, `the junk (${p?.junk})`);
  same(sliced('adts', parts.subarray(0, parts.length - 100), 20_000), p, 'and in slices');
  // A joined stream at another rate: each frame at its own.
  near(scanStream('adts', cat(adtsFrames(300, 4, () => 400), adtsFrames(300, 3, () => 400)))?.seconds ?? null, 300 * AAC44 + (300 * 1024) / 48_000, 1e-9, 'a 44.1 kHz part then a 48 kHz part');
  // Not ADTS: nothing.
  eq(scanStream('adts', Uint8Array.from({ length: 50_000 }, (_, k) => (k * 37 + 11) & 0x7f)), null, 'junk: no ADTS scan');
  eq(scanStream('adts', frames(200, 44_100, 9)), null, 'an MP3 is not ADTS (layer 1, not 0)');
  // The time: 25 minutes of 128 kbps-like frames (about 24 MB).
  const big = adtsFrames(Math.round(1500 / AAC44), 4, (k) => 300 + (k % 200));
  const t0 = performance.now();
  const bs = scanStream('adts', big);
  const ms = performance.now() - t0;
  near(bs?.seconds ?? null, Math.round(1500 / AAC44) * AAC44, 1e-6, '25 minutes of ADTS: its length');
  ok(ms < 250, `25 minutes of ADTS walked in ${ms.toFixed(1)} ms (Node)`);
  console.log(`  (the 25-minute ADTS walk: ${(big.length / 1e6).toFixed(1)} MB in ${ms.toFixed(1)} ms)`);
  // Fuzz: never throws, always ends, whole and in slices.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let bad = 0;
  for (let it = 0; it < 200; it++) {
    const b = Uint8Array.from({ length: 2000 + ((rnd() * 40_000) | 0) }, () => (rnd() < 0.08 ? 0xff : (rnd() * 256) | 0));
    for (let k = 0; k < 20; k++) b.set(adtsHead(4, 2, 7 + ((rnd() * 2000) | 0)).subarray(0, 7), (rnd() * (b.length - 7)) | 0);
    try {
      const r = scanStream('adts', b);
      if (r && !(Number.isFinite(r.seconds) && r.seconds >= 0)) bad++;
      if (sliced('adts', b, 4096) === 'stalled') bad++;
    } catch {
      bad++;
    }
  }
  eq(bad, 0, 'ADTS fuzz: 200 random files, none throws, stalls or gives a bad length');
}

// ---- Fix 3: an Ogg's length from its pages; a WAV's MP3 payload; G.711; WebM's head; which walk for which kind.
const oggPageBytes = (o: { serial: number; seq: number; granule: number; bos?: boolean; eos?: boolean; body: Uint8Array }) => {
  const segs: number[] = [];
  let left = o.body.length;
  while (left >= 255) {
    segs.push(255);
    left -= 255;
  }
  segs.push(left);
  const w = new W().s('OggS').u8(0).u8((o.bos ? 2 : 0) | (o.eos ? 4 : 0));
  if (o.granule < 0) w.u32le(0xffffffff).u32le(0xffffffff);
  else w.u32le(o.granule % 2 ** 32).u32le(Math.floor(o.granule / 2 ** 32));
  w.u32le(o.serial).u32le(o.seq).u32le(0).u8(segs.length);
  for (const x of segs) w.u8(x);
  return cat(w.bytes(), o.body);
};
const opusHead = (ch: number, preskip: number) => cat(new W().s('OpusHead').u8(1).u8(ch).u16le(preskip).u32le(48_000).u16le(0).u8(0).bytes());
const vorbisHead = (ch: number, rate: number) => cat(Uint8Array.from([1]), new W().s('vorbis').u32le(0).u8(ch).u32le(rate).u32le(0).u32le(128_000).u32le(0).u8(0xb8).u8(1).bytes());
/** An Ogg stream: its head page, then `pages` audio pages of `perPage` samples, each about `bytes` long. */
const oggStream = (serial: number, head: Uint8Array, pages: number, perPage: number, bytes: number, startGranule = 0) => {
  const out: Uint8Array[] = [oggPageBytes({ serial, seq: 0, granule: 0, bos: true, body: head }), oggPageBytes({ serial, seq: 1, granule: 0, body: new Uint8Array(60) })];
  for (let k = 0; k < pages; k++) out.push(oggPageBytes({ serial, seq: 2 + k, granule: startGranule + (k + 1) * perPage, body: new Uint8Array(bytes + (k % 7) * 31).fill(0x4f) }));
  return cat(...out);
};
{
  const opus = oggStream(11, opusHead(2, 312), 1500, 48_000, 4000);
  const s = scanStream('ogg', opus);
  near(s?.seconds ?? null, (1500 * 48_000 - 312) / 48_000, 1e-9, 'Ogg Opus: its last granule less the pre-skip, at 48 kHz');
  eq([s?.kind, s?.sampleRate, s?.channels, s?.junk], ['ogg', 48_000, 2, 0], 'Ogg Opus: kind, rate, channels, no junk');
  for (const slice of [20_000, 65_536, 8 << 20]) same(sliced('ogg', opus, slice), s, `Ogg in ${slice}-byte slices: the same`);
  const vorbis = oggStream(5, vorbisHead(2, 44_100), 300, 44_100, 3000);
  near(scanStream('ogg', vorbis)?.seconds ?? null, 300, 1e-9, 'Ogg Vorbis: its last granule at its rate');
  // A chained file (a stream rip: links one after another, each from 0): the sum, never the last link alone.
  const chained = cat(oggStream(1, opusHead(2, 0), 100, 48_000, 2000), oggStream(2, vorbisHead(2, 44_100), 50, 44_100, 2000), oggStream(1, opusHead(2, 0), 30, 48_000, 2000));
  near(scanStream('ogg', chained)?.seconds ?? null, 180, 1e-9, 'a chained Ogg (three links, a serial used twice): 100 + 50 + 30 s');
  // Junk between pages: resynced at the next capture pattern; a truncated last page still counts its granule.
  const pagesOf = (from: number, to: number) => cat(...Array.from({ length: to - from }, (_, k) => oggPageBytes({ serial: 3, seq: 2 + from + k, granule: (from + k + 1) * 48_000, body: new Uint8Array(2000).fill(0x4f) })));
  const j = cat(oggPageBytes({ serial: 3, seq: 0, granule: 0, bos: true, body: opusHead(1, 0) }), pagesOf(0, 50), new Uint8Array(5000).fill(0x67), pagesOf(50, 100));
  const js = scanStream('ogg', j.subarray(0, j.length - 500));
  near(js?.seconds ?? null, 100, 1e-9, 'junk between pages: resynced; a truncated last page: its granule counts');
  eq(js?.junk, 5000, 'the junk counted');
  same(sliced('ogg', j.subarray(0, j.length - 500), 20_000), js, 'and in slices');
  eq(scanStream('ogg', Uint8Array.from({ length: 50_000 }, (_, k) => (k * 37 + 11) & 0x7f)), null, 'junk: no Ogg scan');
}
{
  // A WAV whose payload is MP3 (format 0x55): its data chunk walked as an MP3.
  const body = frames(800, 44_100, (k) => 5 + (k % 8));
  const w = new W().s('RIFF').u32le(0).s('WAVE').s('fmt ').u32le(30).u16le(0x55).u16le(2).u32le(44_100).u32le(16_000).u16le(1).u16le(0).u16le(12).pad(12).s('data').u32le(body.length);
  const file = cat(w.bytes(), body);
  const i = sniffSource(file.subarray(0, SNIFF_BYTES), null, file.length, 'a.wav');
  eq([i.container, i.codec, i.lossless, i.sampleRate, i.seconds], ['wav', 'mp3', false, 44_100, null], 'a WAV with an MP3 payload: no header length');
  const plan = scanPlanFor(i);
  eq(plan, { kind: 'mp3', at: w.b.length, bytes: body.length }, 'its plan: the MP3 walk over the data chunk');
  near(scanStream('mp3', file.subarray(plan!.at, plan!.at + plan!.bytes!))?.seconds ?? null, 800 * spf, 1e-9, 'the payload: its frames');
  near(lengthLowerBound(i, file.length), (file.length * 8) / MAX_BITRATE.mp3, 1e-9, 'its size bound is an MP3\'s');
  // G.711 (µ-law, A-law): a byte a sample, so its length from its data.
  for (const [fmt, codec] of [[7, 'ulaw'], [6, 'alaw']] as const) {
    const g = new W().s('RIFF').u32le(0).s('WAVE').s('fmt ').u32le(16).u16le(fmt).u16le(1).u32le(8000).u32le(8000).u16le(1).u16le(8).s('data').u32le(80_000);
    const gi = sniffSource(g.bytes(), null, g.b.length + 80_000);
    eq([gi.codec, gi.seconds, scanPlanFor(gi)], [codec, 10, null], `a ${codec} WAV: its length from its data (10 s), no walk needed`);
  }
  // ADPCM: no length, no walk (a phone doesn't decode it).
  const ad = new W().s('RIFF').u32le(0).s('WAVE').s('fmt ').u32le(20).u16le(0x11).u16le(2).u32le(44_100).u32le(44_000).u16le(2048).u16le(4).pad(4).s('data').u32le(500_000);
  const ai = sniffSource(ad.bytes(), null, ad.b.length + 500_000);
  eq([ai.codec, ai.seconds, scanPlanFor(ai)], [null, null, null], 'an IMA ADPCM WAV: no length, no walk');
}
{
  // WebM: the head walked as EBML (ffmpeg's layout: EBML header, Segment, SeekHead, Info, Tracks, Cluster).
  const el = (id: number[], body: Uint8Array | number[], unknown = false) => {
    const b = Uint8Array.from(body as ArrayLike<number>);
    const size = unknown ? [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff] : [0x10, (b.length >> 16) & 0xff, (b.length >> 8) & 0xff, b.length & 0xff];
    return cat(Uint8Array.from(id), Uint8Array.from(size), b);
  };
  const f64 = (v: number) => { const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, v); return new Uint8Array(d.buffer); };
  const f32 = (v: number) => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, v); return new Uint8Array(d.buffer); };
  const head = (o: { duration?: number; ch?: number; opusCh?: number; codec?: string; unknownSegment?: boolean }) => {
    const info = el([0x15, 0x49, 0xa9, 0x66], cat(el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), ...(o.duration !== undefined ? [el([0x44, 0x89], f64(o.duration))] : [])));
    const codec = o.codec ?? 'A_OPUS';
    const audio = el([0xe1], cat(el([0xb5], f32(48_000)), ...(o.ch !== undefined ? [el([0x9f], [o.ch])] : [])));
    const priv = o.opusCh !== undefined ? [el([0x63, 0xa2], opusHead(o.opusCh, 312))] : [];
    const entry = el([0xae], cat(el([0xd7], [1]), el([0x83], [2]), el([0x86], Array.from(codec, (c) => c.charCodeAt(0))), ...priv, audio));
    const tracks = el([0x16, 0x54, 0xae, 0x6b], entry);
    const cluster = el([0x1f, 0x43, 0xb6, 0x75], new Uint8Array(200));
    const segment = el([0x18, 0x53, 0x80, 0x67], cat(el([0x11, 0x4d, 0x9b, 0x74], new Uint8Array(30)), info, tracks, cluster), o.unknownSegment);
    return cat(el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], Array.from('webm', (c) => c.charCodeAt(0)))), segment);
  };
  const six = sniffSource(head({ duration: 4008, ch: 6, opusCh: 6 }), null, 30_000);
  eq([six.container, six.codec, six.sampleRate, six.channels], ['webm', 'opus', 48_000, 6], 'a 5.1 Opus WebM: 6 channels from its head (refused before it is read)');
  near(six.seconds, 4.008, 1e-9, 'its length from Info (Duration × TimecodeScale)');
  eq(sniffSource(head({ duration: 4000, opusCh: 6 }), null, 30_000).channels, 6, 'no Channels element: OpusHead\'s count');
  eq(sniffSource(head({ duration: 4000, ch: 2, opusCh: 2 }), null, 30_000).channels, 2, 'a stereo Opus WebM');
  const vorbis = sniffSource(head({ duration: 1000, ch: 2, codec: 'A_VORBIS' }), null, 30_000);
  eq([vorbis.codec, vorbis.sampleRate, vorbis.channels], ['vorbis', 48_000, 2], 'a Vorbis WebM: its rate and channels from Audio');
  const live = sniffSource(head({ ch: 2, opusCh: 2, unknownSegment: true }), null, 30_000);
  eq([live.seconds, scanPlanFor(live)], [null, null], 'a MediaRecorder WebM (no Duration, the Segment\'s size unknown): no length, no walk');
  eq(live.channels, 2, 'its channels still read');
  eq(sniffSource(head({ duration: 4000 }).subarray(0, 40), null, 30_000).container, 'webm', 'a truncated head: still a WebM, nothing claimed');
}
{
  // Which walk for which kind (the engine's plan): the walked kinds, and the header kinds (none).
  const plans = (['mp3', 'unknown', 'adts', 'ogg', 'wav', 'aiff', 'flac', 'mp4', 'webm'] as const).map((container) => scanPlanFor({ container, codec: null, lossless: false, sampleRate: null, channels: null, bits: null, seconds: null })?.kind ?? null);
  eq(plans, ['mp3', 'mp3', 'adts', 'ogg', null, null, null, null, null], 'the walk per container');
  ok(!scanTrusted(scanMp3(cat(frames(10, 44_100, 9), new Uint8Array(20_000))), 20_000 + 4180), 'a scan with most of its bytes junk is not trusted');
  // MPEG layer II and free-format layer III: no walk finds them (a phone refuses them: no length of the export's own).
  const len9 = Math.floor((144 * 128_000) / 44_100); // 417 bytes a frame at 128 kbps
  const l2 = frames(200, 44_100, 9).map((x, k) => (k % len9 === 1 ? 0xfd : x));
  eq(scanMp3(l2), null, 'MPEG layer II: not walked');
  const free = frames(200, 44_100, 9).map((x, k) => (k % len9 === 2 ? x & 0x0f : x));
  eq(scanMp3(free), null, 'free-format layer III (bit rate index 0): not walked');
}

// ---- v16.5 export memory ---------------------------------------------------------------------------------------
// A tag of each kind, as taggers write them (their structure checked by the walk).
const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
let artSeed = 7;
/** Cover art's bytes, as a JPEG's entropy data: pseudo-random, each 0xFF stuffed with a 0x00 after it (no frame sync). */
const art = (n: number) => { const o = new Uint8Array(n); for (let k = 0; k < n; k++) { const x = (artSeed = (artSeed * 1103515245 + 12345) >>> 0) >>> 24; o[k] = k > 0 && o[k - 1] === 0xff ? 0 : x; } return o; };
/** An ID3v2.3 (or .4) tag: a TIT2 frame, an APIC frame of `artBytes`, then 1,024 bytes of padding. */
const id3v2 = (artBytes: number, ver: 3 | 4 = 3) => {
  const fsz = (n: number) => (ver === 4 ? syncsafe(n) : [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
  const tit2 = cat(new W().s('TIT2').bytes(), Uint8Array.from(fsz(6)), Uint8Array.from([0, 0, 3]), new W().s('Title').bytes());
  const apicBody = cat(Uint8Array.from([0]), new W().s('image/jpeg').u8(0).u8(3).u8(0).bytes(), art(artBytes));
  const apic = cat(new W().s('APIC').bytes(), Uint8Array.from(fsz(apicBody.length)), Uint8Array.from([0, 0]), apicBody);
  const body = cat(tit2, apic, new Uint8Array(1024));
  return cat(new W().s('ID3').u8(ver).u8(0).u8(0).bytes(), Uint8Array.from(syncsafe(body.length)), body);
};
/** An APEv2 tag: a Title item and a binary Cover Art (Front) item of `artBytes`, its footer, and its header first
 *  unless `footerOnly` (APEv1's layout). */
const apeTag = (artBytes: number, footerOnly = false) => {
  const item = (key: string, value: Uint8Array, flags: number) => cat(new W().u32le(value.length).u32le(flags).s(key).u8(0).bytes(), value);
  const items = cat(item('Title', new W().s('A title').bytes(), 0), item('Cover Art (Front)', cat(new W().s('cover.jpg').u8(0).bytes(), art(artBytes)), 2));
  const hf = (header: boolean) => new W().s('APETAGEX').u32le(2000).u32le(items.length + 32).u32le(2).u32le((footerOnly ? 0 : 0x8000_0000) | (header ? 0x2000_0000 : 0)).pad(8).bytes();
  return footerOnly ? cat(items, hf(false)) : cat(hf(true), items, hf(false));
};
const id3v1 = () => new W().s('TAG').pad(125).bytes();
/** An appended ID3v2.4 tag with its footer ('3DI'): as id3v2(…, 4), its header's footer flag set and the footer after. */
const id3v24Appended = (artBytes: number) => {
  const t = id3v2(artBytes, 4);
  const size = t.subarray(6, 10);
  return cat(new W().s('ID3').u8(4).u8(0).u8(0x10).bytes(), size, t.subarray(10), new W().s('3DI').u8(4).u8(0).u8(0x10).bytes(), size);
};
const lyrics3 = () => { const body = new W().s('LYRICSBEGIN').s('IND00002').s('00').s('LYR00011').s('[00:01]Hey!').bytes(); return cat(body, new W().s(String(body.length).padStart(6, '0')).s('LYRICS200').bytes()); };
{
  // Fix 4 (the review's files): a 60 s 64 kbps MP3 with its cover art in a trailing APEv2 tag (200 KB) or ID3v2 (300 KB)
  // was 29 % and 38 % junk and refused on a phone; their tags aren't junk now: trusted, the frames' length.
  const s60 = frames(2297, 44_100, 5);
  const secs = 2297 * spf;
  for (const [what, file, tagBytes] of [
    ['a trailing APEv2 tag (header, 200 KB of art, footer) and an ID3v1', cat(s60, apeTag(200_000), id3v1()), apeTag(200_000).length + 128],
    ['a trailing ID3v2.3 tag (300 KB of art)', cat(s60, id3v2(300_000)), id3v2(300_000).length],
    ['a trailing ID3v2.4 tag (300 KB of art, syncsafe frame sizes)', cat(s60, id3v2(300_000, 4)), id3v2(300_000, 4).length],
    ['an APE tag by its footer alone (APEv1\'s layout, 200 KB), an ID3v1', cat(s60, apeTag(200_000, true), id3v1()), apeTag(200_000, true).length + 128],
    ['Lyrics3 v2 and an ID3v1', cat(s60, lyrics3(), id3v1()), lyrics3().length + 128],
    ['an appended ID3 v2.4 tag with its 3DI footer (300 KB of art)', cat(s60, id3v24Appended(300_000)), id3v24Appended(300_000).length],
    ['an ID3v2 between two joined files (300 KB of art)', cat(s60, id3v2(300_000), s60), id3v2(300_000).length],
  ] as const) {
    const r = scanMp3(file);
    const want = what.startsWith('an ID3v2 between') ? 2 * secs : secs;
    near(r?.seconds ?? null, want, 1e-9, `${what}: the frames' length`);
    eq([r?.junk, r?.tags], [0, tagBytes], `${what}: no junk, its tags ${tagBytes} bytes`);
    ok(scanTrusted(r, file.length), `${what}: trusted (its tags ${Math.round(((r?.tags ?? 0) / file.length) * 100)} % of the file)`);
    same(sliced('mp3', file, 8 << 20), r, `${what}, in the engine's 8 MB slices: the same`);
    // In slices shorter than the tag: the same frames and the same bytes passed over; a tag with a footer at the end (APE,
    // Lyrics3, ID3v1) still a tag; an ID3v2 longer than a slice is junk there, as before (the engine's slices are 8 MB:
    // only a file over 8 MB has one across a slice's end, and its tag is then a small share of it).
    for (const slice of [20_000, 65_536]) {
      const q = sliced('mp3', file, slice) as typeof r;
      const overBytes = (x: typeof r) => (x?.junk ?? 0) + (x?.tags ?? 0);
      ok(q?.frames === r?.frames && Math.abs(overBytes(q) - overBytes(r)) <= 3, `${what}, in ${slice}-byte slices: the same frames and bytes passed over (but the last bytes under a header): ${q?.frames} / ${overBytes(q)}`);
      if (!what.includes('ID3v2')) same(q, r, `${what}, in ${slice}-byte slices: the same`);
    }
  }
  // A header whose size skips audio (an "ID3" in the middle of a stream that lands on a frame) is no tag: it is walked
  // through, so the frames it would have hidden are counted (the walk never trusts what it didn't count).
  const hidden = frames(3000, 44_100, 9);
  const fake = cat(s60.subarray(0, 104_000), new W().s('ID3').u8(4).u8(0).u8(0).bytes(), Uint8Array.from(syncsafe(hidden.length)), hidden, s60.subarray(104_000));
  const fr = scanMp3(fake);
  eq([fr?.frames, fr?.junk, fr?.tags], [2297 + 3000, 10, 0], 'an ID3 header hiding frames: walked through, its frames counted, its 10 bytes junk');
  near(fr?.seconds ?? null, 5297 * spf, 1e-9, 'the length with them');
  // The review's synthetic tags at the end (an ID3 header then 300 KB of art; APETAGEX then 200 KB of noise): a tag's
  // header begins the bytes to the end and no frame is in them, so they are tags: trusted.
  const rawApe = cat(s60, new W().s('APETAGEX').bytes(), art(200_000));
  const ra = scanMp3(rawApe);
  ok(scanTrusted(ra, rawApe.length) && ra!.frames === 2297 && ra!.junk === 0, `APETAGEX then 200 KB of noise at the end: a tag (junk ${ra?.junk}), trusted`);
  const rawId3 = cat(s60, new W().s('ID3').u8(3).u8(0).u8(0).bytes(), Uint8Array.from(syncsafe(300_000)), art(300_000));
  const ri = scanMp3(rawId3);
  ok(scanTrusted(ri, rawId3.length) && ri!.frames === 2297 && ri!.junk === 0, `an ID3 header then 300 KB of art at the end: a tag (junk ${ri?.junk}), trusted`);
  // The review's own noise (0xFF every 9th byte: false frame syncs in pairs): a pair doesn't end bytes a tag's header
  // began (a stream resuming has three in a row), so no false frame is counted and the tag is whole.
  let x = 12345;
  const noise = Uint8Array.from({ length: 200_000 }, (_, k) => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return k % 9 === 0 ? 0xff : x & 0xff; });
  const rn = scanMp3(cat(s60, new W().s('APETAGEX').bytes(), noise));
  eq([rn?.frames, rn?.junk], [2297, 0], 'APETAGEX then noise with false syncs: no false frame, no junk');
  // An APEv2 tag between two joined files (its header, items and footer): skipped whole as a tag.
  const midApe = cat(s60, apeTag(200_000), s60);
  eq([scanMp3(midApe)?.frames, scanMp3(midApe)?.junk, scanMp3(midApe)?.tags], [2 * 2297, 0, apeTag(200_000).length], 'an APEv2 tag between joined files: a tag');
  // But frames after such a run are counted and its bytes stay junk (it isn't the end).
  const notEnd = cat(s60, new W().s('APETAGEX').bytes(), art(200_000), s60);
  eq([scanMp3(notEnd)?.frames, scanMp3(notEnd)?.junk], [2 * 2297, 200_008], 'APETAGEX and noise in the middle: junk, the frames after it counted');
  // A footer claiming more than the file: nothing more than its own bytes.
  const big = cat(s60.subarray(0, 4160), new W().s('APETAGEX').u32le(2000).u32le(50_000_000).u32le(1).u32le(0).pad(8).bytes());
  ok((scanMp3(big)?.tags ?? 0) <= 32, 'an APE footer larger than the file: its own 32 bytes at most');
  // ADTS: a trailing ID3v2 (a stream rip's) isn't junk either.
  const a1 = Array.from({ length: 1300 }, () => adtsHead(4, 2, 300));
  const adtsFile = cat(cat(...a1), id3v2(200_000));
  const ar = scanStream('adts', adtsFile);
  eq([ar?.frames, ar?.junk, ar?.tags], [1300, 0, id3v2(200_000).length], 'ADTS with a trailing ID3v2: its tag, no junk');
  ok(scanTrusted(ar, adtsFile.length), 'ADTS with 200 KB of art: trusted');
  same(sliced('adts', adtsFile, 8 << 20), ar, 'ADTS with its tag, in 8 MB slices: the same');
}
{
  // Fix 5: a leading ID3v2 tag whose size runs past the end of the file (0x7f7f7f7f): the walk resyncs from just after
  // its 10-byte header (it gave no scan), whole and in slices, MP3 and ADTS; the sniff reads the rate past it.
  const s60 = frames(2297, 44_100, 5);
  const bogus = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f]);
  const file = cat(bogus, s60);
  const r = scanMp3(file);
  near(r?.seconds ?? null, 2297 * spf, 1e-9, 'a leading tag past the file: every frame after its header');
  eq([r?.frames, r?.junk], [2297, 10], 'its 10 bytes are junk');
  for (const slice of [20_000, 65_536, 8 << 20]) same(sliced('mp3', file, slice), r, `a leading tag past the file, in ${slice}-byte slices: the same`);
  const i = sniffSource(file.subarray(0, SNIFF_BYTES), null, file.length, 'x.mp3');
  eq([i.container, i.sampleRate, i.channels], ['mp3', 44_100, 2], 'the sniff reads its rate past the bogus header');
  // A real leading tag longer than a slice still moves the walk past it (its size is within the file).
  const real = cat(id3Tag(70_000), s60);
  same(sliced('mp3', real, 20_000), scanMp3(real), 'a real 70 KB leading tag in 20 KB slices: the same as the whole');
  const a2 = cat(bogus, ...Array.from({ length: 400 }, () => adtsHead(4, 2, 300)));
  eq([scanStream('adts', a2)?.frames, scanStream('adts', a2)?.junk], [400, 10], 'ADTS behind a bogus leading tag: every frame');
  same(sliced('adts', a2, 20_000), scanStream('adts', a2), 'and in slices');
}
{
  // Fix 6: AAC in Matroska (A_AAC) costs AAC's (it was the others'); HE-AAC's rate from OutputSamplingFrequency.
  const el = (id: number[], body: Uint8Array | number[]) => {
    const b = Uint8Array.from(body as ArrayLike<number>);
    return cat(Uint8Array.from(id), Uint8Array.from([0x10, (b.length >> 16) & 0xff, (b.length >> 8) & 0xff, b.length & 0xff]), b);
  };
  const f64 = (v: number) => { const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, v); return new Uint8Array(d.buffer); };
  const mka = (codec: string, rate: number, outRate?: number) => {
    const info = el([0x15, 0x49, 0xa9, 0x66], cat(el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), el([0x44, 0x89], f64(40_023))));
    const audio = el([0xe1], cat(el([0xb5], f64(rate)), ...(outRate ? [el([0x78, 0xb5], f64(outRate))] : []), el([0x9f], [2])));
    const entry = el([0xae], cat(el([0xd7], [1]), el([0x83], [2]), el([0x86], Array.from(codec, (c) => c.charCodeAt(0))), audio));
    const segment = el([0x18, 0x53, 0x80, 0x67], cat(info, el([0x16, 0x54, 0xae, 0x6b], entry), el([0x1f, 0x43, 0xb6, 0x75], new Uint8Array(100))));
    return cat(el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], Array.from('matroska', (c) => c.charCodeAt(0)))), segment);
  };
  for (const codec of ['A_AAC', 'A_AAC/MPEG4/LC', 'A_AAC/MPEG2/LC']) {
    const i = sniffSource(mka(codec, 44_100), null, 700_000, 'mka40.mka');
    eq([i.container, i.codec, i.sampleRate, i.channels], ['webm', 'aac', 44_100, 2], `${codec} in Matroska: AAC`);
    near(i.seconds, 40.023, 1e-9, `${codec}: its length from Info`);
    eq(fileKindOf({ name: 'mka40.mka', type: 'audio/x-matroska' }, i), 'aac', `${codec}: AAC's cost`);
  }
  eq(sniffSource(mka('A_AAC/MPEG4/LC/SBR', 24_000, 48_000), null, 700_000).sampleRate, 48_000, 'HE-AAC in Matroska: its output rate');
  eq(sniffSource(mka('A_AAC', 22_050), null, 700_000).sampleRate, null, 'HE-AAC without its output rate: unknown (decoded at 48 kHz, never under its rate)');
  eq(sniffSource(mka('A_OPUS', 48_000), null, 700_000).codec, 'opus', 'Opus still Opus');
  eq(fileKindOf({ name: 'x.mka' }, sniffSource(mka('A_VORBIS', 44_100), null, 700_000)), 'other', 'Vorbis in Matroska: the others');
}
{
  // Fix 8: the Ogg walk follows at most OGG_MAX_STREAMS streams at once: 24 MB of one-page streams (each a begin, no end)
  // gives no length (untrusted) and a bounded map; a chained file whose links end (end-of-stream pages) keeps one.
  const pg = 29;
  const N = 24 << 20;
  const crafted = new Uint8Array(N);
  let serial = 0;
  for (let i = 0; i + pg <= N; i += pg) {
    crafted.set([0x4f, 0x67, 0x67, 0x53, 0, 2], i);
    crafted[i + 14] = serial & 0xff; crafted[i + 15] = (serial >> 8) & 0xff; crafted[i + 16] = (serial >> 16) & 0xff; crafted[i + 17] = (serial >> 24) & 0xff;
    serial++;
    crafted[i + 26] = 1; crafted[i + 27] = 1; crafted[i + 28] = 0x01;
  }
  const h0 = process.memoryUsage().heapUsed;
  const st = newStreamScan('ogg');
  st.step(crafted, true);
  const grew = (process.memoryUsage().heapUsed - h0) / 1e6;
  eq(st.result(), null, `24 MB of begin-of-stream pages (${serial} streams): no length (untrusted)`);
  ok(grew < 20, `and the heap grew ${grew.toFixed(1)} MB (it was 94)`);
  ok(OGG_MAX_STREAMS === 64, 'at most 64 at once');
  // A real chained file: 200 links one after another, each ending: the sum of them all.
  const links = Array.from({ length: 200 }, (_, k) => cat(oggPageBytes({ serial: 1000 + k, seq: 0, granule: 0, bos: true, body: opusHead(2, 0) }), oggPageBytes({ serial: 1000 + k, seq: 1, granule: 48_000, body: new Uint8Array(500) }), oggPageBytes({ serial: 1000 + k, seq: 2, granule: 96_000, eos: true, body: new Uint8Array(500) })));
  const chain = cat(...links);
  near(scanStream('ogg', chain)?.seconds ?? null, 400, 1e-9, '200 chained links that end: 200 × 2 s');
  same(sliced('ogg', chain, 20_000), scanStream('ogg', chain), 'and in slices');
  // 64 streams open at once is still read; 65 is not.
  const open = (n: number) => cat(...Array.from({ length: n }, (_, k) => oggPageBytes({ serial: k, seq: 0, granule: 0, bos: true, body: opusHead(2, 0) })), ...Array.from({ length: n }, (_, k) => oggPageBytes({ serial: k, seq: 1, granule: 48_000, body: new Uint8Array(200) })));
  near(scanStream('ogg', open(64))?.seconds ?? null, 64, 1e-9, '64 streams at once: read');
  eq(scanStream('ogg', open(65)), null, '65 at once: no length');
  // v16.5 review: an end-of-stream flag on an early page while the stream goes on (a crafted file: the decoder plays the
  // rest). The pages after the end belong to no open link: junk, so the walk is not trusted (it would say 1 s of 100).
  const early = cat(
    oggPageBytes({ serial: 7, seq: 0, granule: 0, bos: true, body: opusHead(2, 0) }),
    oggPageBytes({ serial: 7, seq: 1, granule: 48_000, eos: true, body: new Uint8Array(2000).fill(0x4f) }),
    ...Array.from({ length: 99 }, (_, k) => oggPageBytes({ serial: 7, seq: 2 + k, granule: (k + 2) * 48_000, body: new Uint8Array(2000).fill(0x4f) })),
  );
  const es = scanStream('ogg', early);
  ok(!scanTrusted(es, early.length), `an early end-of-stream flag, the stream going on: not trusted (${es?.seconds ?? 'no'} s, junk ${es?.junk ?? '?'} of ${early.length})`);
  same(sliced('ogg', early, 20_000), es, 'and in slices');
  // A real ending (the last page's flag) is still trusted at its length.
  const ends = cat(oggPageBytes({ serial: 8, seq: 0, granule: 0, bos: true, body: opusHead(2, 0) }), ...Array.from({ length: 100 }, (_, k) => oggPageBytes({ serial: 8, seq: 1 + k, granule: (k + 1) * 48_000, eos: k === 99, body: new Uint8Array(2000).fill(0x4f) })));
  const fs8 = scanStream('ogg', ends);
  near(fs8?.seconds ?? null, 100, 1e-9, 'a stream that ends on its last page: 100 s');
  ok(scanTrusted(fs8, ends.length), 'and trusted');
}

console.log(`sourceInfo: ${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
  process.exit(1);
}
