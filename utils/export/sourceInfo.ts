// utils/export/sourceInfo.ts (v16.5 review, Export with layers: B1, B2)
//
// What a file's own bytes say about it, as pure rules on its first and last 64 KB (Node checks it: sourceInfo.check.ts,
// `npm run check:export`): the container, the sample rate, channels and bits where the header has them, and the length
// where the header states it (PCM WAV and AIFF exactly; FLAC from STREAMINFO's sample count; MP4/M4A from mdhd). The
// export reads these before it reads or decodes a track:
//   - B1: a track's length must be known before its decode, and known to be within the cap (a stored length of 0, or
//     one that is too short, let a 60-minute file decode in full); lengthLowerBound bounds it from the file's size;
//   - B2: the decode's memory per minute grows with the source's sample rate (a 96 kHz or 192 kHz file).
// Nothing here reads a whole file; the engine reads the two 64 KB ends (sniffBytes).
//
// v16.5 re-review:
//   - B1: an MP3's length from its frames (scanMp3, mp3ScanStep): every frame header walked and its samples summed (a
//     VBR file without a Xing header, whose length Chrome guesses from its first frames, and a joined file whose Xing
//     count is stale); the Xing / VBRI count is read and checked against it, and the frames win;
//   - B7: sniffFile reads on where the header isn't in the first bytes: past an ID3v2 tag longer than them (cover art),
//     a WAV's chunks before its fmt, an MP4's sample entry deep in its moov;
//   - multichannel: the channels where the header has them (an M4A's esds included), so the export refuses more than two;
//   - B2: ADTS AAC (a raw .aac, or one named .mp3) is recognised as AAC.
//
// v16.5 final fixes (a phone never decodes a file far past its memory cap: the renderer killed stops the music too):
//   - ADTS AAC's length from its frames (adtsScanStep), as an MP3's: a 25-minute stream-rip .aac read about 42 s;
//   - the MP3 walk: a tag in the middle is skipped only where a frame, a tag or the end follows it (a bogus size
//     skipped half a file), and more than 16 KB of junk before the first frame is walked through (it gave no scan);
//   - an Ogg's length from its pages (oggScanStep: each link's last granule), a WAV's MP3 payload walked as an MP3,
//     a G.711 WAV's from its data, a WebM's from its Info (and its channels from its track, so a 5.1 file is refused
//     before it is read). scanPlanFor says which walk measures a file; what none does, a phone doesn't decode.
//
// v16.5 export memory:
//   - tags aren't junk (id3Genuine, apeEnd, trailingTagsAt, settleTrailingTags): a short file's cover art in a trailing
//     APEv2 or ID3v2 tag made it 29–38 % "junk" and refused on a phone; a header whose body isn't a tag's is walked
//     through, so a frame it would hide is counted;
//   - a leading ID3v2 tag whose size runs past the file is passed by its header alone (pastLeadingTags: it gave no scan);
//   - AAC in Matroska (A_AAC) is AAC, and costs AAC's;
//   - the Ogg walk follows at most OGG_MAX_STREAMS streams at once (a link that ends is let go).

export type Container = 'wav' | 'aiff' | 'flac' | 'mp3' | 'ogg' | 'mp4' | 'webm' | 'adts' | 'unknown';

export interface SourceInfo {
  container: Container;
  /** The codec: 'pcm', 'flac', 'alac', 'mp3', 'aac', 'vorbis', 'opus', or null when the header doesn't say. */
  codec: string | null;
  lossless: boolean;
  /** The rate the decoder puts out (Opus: 48,000; HE-AAC: the SBR rate), or null. */
  sampleRate: number | null;
  channels: number | null;
  /** Bits per sample (PCM, FLAC, ALAC), or null. */
  bits: number | null;
  /** The length the header states (seconds), or null. */
  seconds: number | null;
  /** v16.5 final: a WAV's data chunk (where its body starts, its bytes), when it was found (an MP3 payload is walked). */
  payload?: { at: number; bytes: number } | null;
}

/** The bytes read from each end of a file. */
export const SNIFF_BYTES = 64 * 1024;

/** The highest bit rates a lossy file can have (bits per second): its length is at least its size over these. */
export const MAX_BITRATE: Readonly<Record<string, number>> = { mp3: 320_000, aac: 576_000, vorbis: 512_000, opus: 512_000 };

const NONE: SourceInfo = { container: 'unknown', codec: null, lossless: false, sampleRate: null, channels: null, bits: null, seconds: null };

const tag = (b: Uint8Array, o: number): string => (o + 4 <= b.length ? String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) : '');
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const okRate = (r: number) => Number.isFinite(r) && r >= 1000 && r <= 1_536_000;
const okCh = (c: number) => Number.isInteger(c) && c >= 1 && c <= 32;

/** Where the audio starts after an ID3v2 tag (0 without one). */
export function skipId3(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
  return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

type WavFmt = { format: number; channels: number; rate: number; byteRate: number; bits: number };

/** A WAV fmt chunk's body (at o: its first byte after the chunk's 8-byte header), or null when it isn't all there. */
function wavFmt(b: Uint8Array, o: number): WavFmt | null {
  if (o + 16 > b.length) return null;
  let format = u16le(b, o);
  if (format === 0xfffe && o + 26 <= b.length) format = u16le(b, o + 24); // WAVE_FORMAT_EXTENSIBLE: the sub-format
  return { format, channels: u16le(b, o + 2), rate: u32le(b, o + 4), byteRate: u32le(b, o + 8), bits: u16le(b, o + 14) };
}

/** The data chunk's bytes from its stated size (0 or 0xFFFFFFFF: the rest of the file) and where its body starts. */
const wavData = (size: number, bodyAt: number, fileSize: number): number => {
  const left = Math.max(0, fileSize - bodyAt);
  return size === 0 || size === 0xffffffff ? left : Math.min(size, left);
};

function wav(b: Uint8Array, fileSize: number): SourceInfo {
  let off = 12;
  let fmt: WavFmt | null = null;
  let dataBytes: number | null = null;
  let dataAt = 0;
  while (off + 8 <= b.length) {
    const id = tag(b, off);
    const size = u32le(b, off + 4);
    if (id === 'fmt ' && off + 24 <= b.length) fmt = wavFmt(b, off + 8);
    if (id === 'data') {
      dataBytes = wavData(size, off + 8, fileSize);
      dataAt = off + 8;
      break;
    }
    off += 8 + size + (size & 1);
  }
  return wavInfo(fmt, dataBytes, fileSize, dataAt);
}

function wavInfo(fmt: WavFmt | null, dataBytes: number | null, fileSize: number, dataAt = 0): SourceInfo {
  if (!fmt) return { ...NONE, container: 'wav', lossless: true };
  const pcm = fmt.format === 1 || fmt.format === 3;
  // v16.5 final: G.711 (A-law 6, µ-law 7: a byte a sample, so its length is its data over rate × channels) and an MP3
  // payload (0x55: its length is its frames', walked over the data chunk: scanPlanFor).
  const g711 = (fmt.format === 6 || fmt.format === 7) && okRate(fmt.rate) && okCh(fmt.channels);
  const mp3 = fmt.format === 0x55;
  // No data chunk seen in the first bytes (a long tag before it): all the file after the header counts.
  const data = dataBytes ?? Math.max(0, fileSize - 44);
  const seconds = pcm && fmt.byteRate > 0 ? data / fmt.byteRate : g711 ? data / (fmt.rate * fmt.channels) : null;
  return {
    container: 'wav',
    codec: pcm ? 'pcm' : g711 ? (fmt.format === 6 ? 'alaw' : 'ulaw') : mp3 ? 'mp3' : null,
    lossless: pcm,
    sampleRate: okRate(fmt.rate) ? fmt.rate : null,
    channels: okCh(fmt.channels) ? fmt.channels : null,
    bits: fmt.bits > 0 ? fmt.bits : null,
    seconds,
    payload: dataBytes !== null ? { at: dataAt, bytes: dataBytes } : null,
  };
}

/** An 80-bit IEEE extended float (AIFF's sample rate). */
function ext80(b: Uint8Array, o: number): number {
  const exp = ((b[o] & 0x7f) << 8) | b[o + 1];
  let mant = 0;
  for (let i = 0; i < 8; i++) mant = mant * 256 + b[o + 2 + i];
  if (exp === 0 && mant === 0) return 0;
  return (b[o] & 0x80 ? -1 : 1) * mant * Math.pow(2, exp - 16383 - 63);
}

function aiff(b: Uint8Array): SourceInfo {
  let off = 12;
  while (off + 8 <= b.length) {
    const id = tag(b, off);
    const size = u32be(b, off + 4);
    if (id === 'COMM' && off + 26 <= b.length) {
      const channels = u16be(b, off + 8);
      const frames = u32be(b, off + 10);
      const bits = u16be(b, off + 14);
      const rate = ext80(b, off + 16);
      const compressed = tag(b, 8) === 'AIFC' && size >= 22 && off + 30 <= b.length ? tag(b, off + 26) : 'NONE';
      const pcm = compressed === 'NONE' || compressed === 'sowt' || compressed === 'fl32' || compressed === 'FL32';
      return {
        container: 'aiff',
        codec: pcm ? 'pcm' : null,
        lossless: pcm,
        sampleRate: okRate(rate) ? Math.round(rate) : null,
        channels: okCh(channels) ? channels : null,
        bits: bits > 0 ? bits : null,
        seconds: okRate(rate) ? frames / rate : null,
      };
    }
    off += 8 + size + (size & 1);
  }
  return { ...NONE, container: 'aiff', lossless: true };
}

/** FLAC's STREAMINFO body (34 bytes) at o. */
function streamInfo(b: Uint8Array, o: number, container: Container): SourceInfo {
  if (o + 18 > b.length) return { ...NONE, container, codec: 'flac', lossless: true };
  const rate = (b[o + 10] << 12) | (b[o + 11] << 4) | (b[o + 12] >> 4);
  const channels = ((b[o + 12] >> 1) & 0x07) + 1;
  const bits = (((b[o + 12] & 0x01) << 4) | (b[o + 13] >> 4)) + 1;
  const total = (b[o + 13] & 0x0f) * 2 ** 32 + u32be(b, o + 14);
  return {
    container,
    codec: 'flac',
    lossless: true,
    sampleRate: okRate(rate) ? rate : null,
    channels,
    bits,
    seconds: total > 0 && okRate(rate) ? total / rate : null,
  };
}

const MP3_RATES = [
  [11025, 12000, 8000], // MPEG 2.5
  [0, 0, 0],
  [22050, 24000, 16000], // MPEG 2
  [44100, 48000, 32000], // MPEG 1
];
const MP3_KBPS_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MP3_KBPS_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

interface Mp3Header {
  /** 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5. */
  ver: number;
  rate: number;
  channels: number;
  /** The frame's bytes (its header included). */
  len: number;
  /** Samples per channel: 1,152 (MPEG-1), 576 (MPEG-2 and 2.5). */
  spf: number;
}

/** An MPEG audio layer III frame header at o: its version, rate, channels, length and samples, or null. */
function mp3Frame(b: Uint8Array, o: number): Mp3Header | null {
  if (o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const ver = (b[o + 1] >> 3) & 0x03;
  const layer = (b[o + 1] >> 1) & 0x03;
  const bi = b[o + 2] >> 4;
  const ri = (b[o + 2] >> 2) & 0x03;
  if (ver === 1 || layer !== 1 || bi === 0 || bi === 15 || ri === 3) return null;
  const rate = MP3_RATES[ver][ri];
  const kbps = ver === 3 ? MP3_KBPS_V1_L3[bi] : MP3_KBPS_V2_L3[bi];
  const pad = (b[o + 2] >> 1) & 0x01;
  const len = Math.floor(((ver === 3 ? 144 : 72) * kbps * 1000) / rate) + pad;
  return { ver, rate, channels: (b[o + 3] >> 6) === 3 ? 1 : 2, len, spf: ver === 3 ? 1152 : 576 };
}

const sameStream = (a: Mp3Header, b: Mp3Header | null): boolean => !!b && a.ver === b.ver && a.rate === b.rate;

function mp3(b: Uint8Array, start = skipId3(b)): SourceInfo {
  for (let o = start; o + 4 <= b.length && o < start + 16384; o++) {
    const f = mp3Frame(b, o);
    if (!f) continue;
    // Two frames in a row (a false sync rarely has a second one where it says).
    const g = mp3Frame(b, o + f.len);
    if (o + f.len + 4 <= b.length && !g) continue;
    return { container: 'mp3', codec: 'mp3', lossless: false, sampleRate: f.rate, channels: f.channels, bits: null, seconds: null };
  }
  return { ...NONE, container: 'mp3', codec: 'mp3' };
}

// ---- v16.5 re-review (B1): an MP3's length from its frames.
//
// Chrome reads an MP3's length from its Xing / VBRI header when it has one, else it guesses from the first frames'
// bit rate: a VBR file without the header that starts loud and goes quiet reads a quarter of its length (a 10-minute
// LAME V0 file read 138 s), and a joined or cut file's Xing count is the first part's. decodeAudioData decodes every
// frame. So the export counts them: each frame header gives its length in bytes and its samples, and the walk jumps
// from one to the next (some 40,000 jumps for a 25-minute file: milliseconds). Junk between frames (a tag, a damaged
// stretch) is skipped by a resync that wants two frames in a row where the first says the second is; a run at another
// rate or version (a joined file) counts at its own rate, so the length never comes out short. The Xing / VBRI frame
// (an information frame decoders skip) isn't counted; its own count is kept to compare.

/** Bytes past a step's last frame start that a non-final step needs (a frame, and the next header to confirm it). */
export const MP3_LOOKAHEAD = 16 * 1024;
/** How far into the audio the first frame is looked for. */
const MP3_FIRST_WINDOW = 16 * 1024;

export interface Mp3ScanState {
  /** The absolute offset the next step's bytes must start at. */
  pos: number;
  /** The first frame's stream (null: none found yet). */
  first: { ver: number; rate: number; channels: number } | null;
  /** Audio frames counted (the Xing / VBRI frame not among them), and their length in seconds (each at its own rate). */
  frames: number;
  seconds: number;
  channels: number;
  /** The Xing / VBRI frame count (null: none, or it doesn't give one), at the first frame's samples per frame. */
  xingFrames: number | null;
  xingSpf: number;
  /** Bytes skipped between frames (damage; a tag whose structure doesn't say it is one). */
  junk: number;
  /** v16.5 export memory: bytes of tags in the middle or at the end (their structure checked): not junk. */
  tags?: number;
  /** Where the junk run open now started (absolute), or -1: the trailing tags settle it at the end; and whether it
   *  started at a tag's header (an ID3v2 whose size ends at the walked bytes' end, or APETAGEX). */
  runFrom?: number;
  runTag?: boolean;
  /** The walked bytes in all, when known (a leading tag's size past them is bogus), or null. */
  size?: number | null;
  /** v16.5 final: the first-frame window held no frame: the walk resyncs on from it (junk after the tag). */
  searched?: boolean;
  /** The walk ended with no frame found: not an MP3. */
  none: boolean;
  /** Nothing more to walk. */
  done: boolean;
}

export function newMp3Scan(size: number | null = null): Mp3ScanState {
  return { pos: 0, first: null, frames: 0, seconds: 0, channels: 0, xingFrames: null, xingSpf: 1152, junk: 0, tags: 0, runFrom: -1, size, searched: false, none: false, done: false };
}

/** v16.5 export memory (fix 5): past the leading ID3v2 tags at o; a tag whose size runs past the walked bytes (its
 *  header bogus) is passed over by its 10-byte header alone (as junk), and the walk resyncs from there (it gave no scan:
 *  the next step started past the file's end). Returns where the audio is looked for. */
function pastLeadingTags(st: { pos: number; junk: number; size?: number | null }, b: Uint8Array, final: boolean): number {
  let o = 0;
  const total = final ? b.length : typeof st.size === 'number' ? st.size - st.pos : Infinity;
  for (let guard = 0; guard < 8; guard++) {
    const e = id3End(b, o);
    if (e === o) break;
    if (e > total) {
      st.junk += 10;
      return o + 10;
    }
    o = e;
  }
  return o;
}

/** The Xing / Info / VBRI header in the frame at o, if it is one: its frame count (or null when it states none). */
function infoFrame(b: Uint8Array, o: number, h: Mp3Header): { frames: number | null } | null {
  const mono = h.channels === 1;
  const x = o + 4 + (h.ver === 3 ? (mono ? 17 : 32) : mono ? 9 : 17);
  const t = tag(b, x);
  if ((t === 'Xing' || t === 'Info') && x + 8 <= b.length) {
    const flags = u32be(b, x + 4);
    return { frames: flags & 1 && x + 12 <= b.length ? u32be(b, x + 8) : null };
  }
  const v = o + 36;
  if (tag(b, v) === 'VBRI' && v + 18 <= b.length) return { frames: u32be(b, v + 14) };
  return null;
}

/** Where an ID3v2 tag at o ends (o itself without one). */
function id3End(b: Uint8Array, o: number): number {
  return o + skipId3(o === 0 ? b : b.subarray(o, o + 10));
}

/**
 * v16.5 final: whether a tag in the middle of a stream, ending at e, ends where something is: a frame (isFrame), another
 * tag (ID3v2, ID3v1, APE) or, in a final step, the end of the bytes. A tag whose size is bogus (0x7f7f7f7f: 256 MB)
 * ends nowhere, and neither does one whose end is past this step's bytes: the walk then treats it as junk and resyncs
 * (never short: a real tag is walked through to the frame after it).
 */
function tagLands(b: Uint8Array, e: number, final: boolean, isFrame: (b: Uint8Array, o: number) => unknown): boolean {
  if (final && e === b.length) return true;
  if (e + 4 > b.length) return false;
  const t = tag(b, e);
  return !!isFrame(b, e) || id3End(b, e) > e || t.startsWith('TAG') || (t === 'APET' && tag(b, e + 4) === 'AGEX') || ascii(b, e, 11) === 'LYRICSBEGIN';
}

// ---- v16.5 export memory (fix 4): tags are not junk. A trusted walk allows a quarter of its bytes junk; a short file
// with its cover art in a trailing APEv2 or ID3v2 tag (200 KB, 300 KB on a 60 s 64 kbps MP3) was 29–38 % "junk" and
// refused on a phone. A tag counts as one (st.tags, not st.junk) only where its own structure says it is one: an ID3v2's
// frames chain from its header to its end or its padding; an APEv2's items chain to its footer; an ID3v1 is its 128
// bytes; a Lyrics3 tag runs from LYRICSBEGIN to its own end mark. A header whose size skips audio (a bogus one in a
// stream) isn't a chain of frames, so its bytes stay junk, as before: the walk never trusts audio it didn't count.

const ascii = (b: Uint8Array, o: number, n: number): string => {
  if (o < 0 || o + n > b.length) return '';
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i]);
  return s;
};
const syncsafe32 = (b: Uint8Array, o: number) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const isIdChar = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39);

/** Whether the ID3v2 tag at o, ending at e (both within b), is one: its frames (IDs of capitals and digits) chain from
 *  its body to its end, or to padding of zeros. v2.4 sizes are syncsafe (some writers didn't: both are tried). */
function id3Genuine(b: Uint8Array, o: number, e: number): boolean {
  if (o < 0 || e > b.length || e - o < 20) return false;
  const ver = b[o + 3];
  if (ver < 2 || ver > 4) return false;
  const flags = b[o + 5];
  const end = e - (ver === 4 && flags & 0x10 ? 10 : 0);
  let body = o + 10;
  if (flags & 0x40 && ver >= 3) body += ver === 4 ? syncsafe32(b, body) : u32be(b, body) + 4; // an extended header
  const idLen = ver === 2 ? 3 : 4;
  const hdr = ver === 2 ? 6 : 10;
  const chain = (size: (p: number) => number): boolean => {
    let p = body;
    let n = 0;
    for (let guard = 0; guard < 100_000 && p < end; guard++) {
      if (b[p] === 0) {
        for (let q = p; q < end; q++) if (b[q] !== 0) return false;
        return n > 0;
      }
      if (p + hdr > end) return false;
      for (let k = 0; k < idLen; k++) if (!isIdChar(b[p + k])) return false;
      p += hdr + size(p);
      n++;
    }
    return n > 0 && p === end;
  };
  if (ver === 2) return chain((p) => (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5]);
  return (ver === 4 && chain((p) => syncsafe32(b, p + 4))) || chain((p) => u32be(b, p + 4));
}

/** An APEv2 tag's items from `from` to its footer at `footer` ('APETAGEX'): each a value size, flags, an ASCII key of 2
 *  to 255 bytes ending in a zero, then the value; `count` of them, ending at the footer. */
function apeItems(b: Uint8Array, from: number, footer: number, count: number): boolean {
  if (from < 0 || footer + 32 > b.length || count < 0 || count > 65_536) return false;
  let p = from;
  for (let i = 0; i < count; i++) {
    if (p + 11 > footer) return false;
    const size = u32le(b, p);
    let k = p + 8;
    while (k < footer && b[k] !== 0 && k - (p + 8) < 256) {
      if (b[k] < 0x20 || b[k] > 0x7e) return false;
      k++;
    }
    if (k >= footer || b[k] !== 0 || k - (p + 8) < 2) return false;
    p = k + 1 + size;
  }
  return p === footer;
}

/** Where an APEv2 tag that starts with its header at o ends (its items checked), or o when there is none. */
function apeEnd(b: Uint8Array, o: number): number {
  if (ascii(b, o, 8) !== 'APETAGEX' || o + 32 > b.length) return o;
  const size = u32le(b, o + 12);
  const flags = u32le(b, o + 20);
  // The header (flag bit 29); its size counts the items and the footer.
  if (!(flags & 0x2000_0000) || size < 32 || size > 64 * 1024 * 1024) return o;
  const footer = o + size;
  return ascii(b, footer, 8) === 'APETAGEX' && apeItems(b, o + 32, footer, u32le(b, o + 16)) ? o + 32 + size : o;
}

/** Where the tags at the end of these bytes start (an ID3v1, and before it an APE tag by its footer, a Lyrics3 tag),
 *  as an offset in b (it may be below 0: an APE tag longer than the bytes, by its footer's size); b.length for none. */
function trailingTagsAt(b: Uint8Array): number {
  let end = b.length;
  if (end >= 128 && ascii(b, end - 128, 3) === 'TAG') end -= 128;
  for (let guard = 0; guard < 4; guard++) {
    if (end >= 32 && ascii(b, end - 32, 8) === 'APETAGEX') {
      const f = end - 32;
      const size = u32le(b, f + 12);
      const flags = u32le(b, f + 20);
      const items = f + 32 - size;
      if (size >= 32 && size <= 64 * 1024 * 1024 && !(flags & 0x2000_0000) && (items < 0 || apeItems(b, items, f, u32le(b, f + 16)))) {
        end = items - (flags & 0x8000_0000 ? 32 : 0);
        if (end < 0) return end;
        continue;
      }
    }
    // An appended ID3v2.4 tag by its footer ('3DI'): its frames checked when its bytes are here.
    if (end >= 20 && ascii(b, end - 10, 3) === '3DI' && b[end - 7] === 4) {
      const start = end - 20 - syncsafe32(b, end - 4);
      if (start < 0 || (ascii(b, start, 3) === 'ID3' && id3Genuine(b, start, end))) {
        end = start;
        if (end < 0) return end;
        continue;
      }
    }
    if (end >= 15 && ascii(b, end - 9, 9) === 'LYRICS200') {
      const n = Number(ascii(b, end - 15, 6));
      const start = end - 15 - n;
      if (Number.isInteger(n) && n >= 11 && start >= 0 && ascii(b, start, 11) === 'LYRICSBEGIN') {
        end = start;
        continue;
      }
    }
    if (end >= 20 && ascii(b, end - 9, 9) === 'LYRICSEND') {
      let k = -1;
      for (let p = end - 20; p >= Math.max(0, end - 9 - 5100); p--) {
        if (b[p] === 0x4c && ascii(b, p, 11) === 'LYRICSBEGIN') {
          k = p;
          break;
        }
      }
      if (k >= 0) {
        end = k;
        continue;
      }
    }
    break;
  }
  return end;
}

type RunState = { pos: number; junk: number; tags?: number; runFrom?: number; runTag?: boolean; size?: number | null };

/** A junk run starts at o (unless one is open): where, and whether a tag's header starts it: an ID3v2 whose size ends at
 *  the end of the walked bytes, or an APE tag's preamble (the walk then finds no frame in it to the end, or it isn't one). */
function openRun(st: RunState, b: Uint8Array, o: number, final: boolean): void {
  if ((st.runFrom ?? -1) >= 0) return;
  st.runFrom = st.pos + o;
  const total = final ? st.pos + b.length : typeof st.size === 'number' ? st.size : -1;
  const e = id3End(b, o);
  st.runTag = ascii(b, o, 8) === 'APETAGEX' || (e > o && total >= 0 && st.pos + e === total);
}

/** The junk run open at the end of a final step (from st.runFrom to st.pos + o, absolute) that the trailing tags
 *  cover: moved from junk to tags. A run that a tag's header began and no frame broke, to the end, is the tag's whole
 *  (the review's 300 KB ID3v2 and its APETAGEX of noise: no frame in them, so nothing the walk could count is hidden). */
function settleTrailingTags(st: RunState, b: Uint8Array, o: number): void {
  const from = st.runFrom ?? -1;
  if (from < 0) return;
  const at = trailingTagsAt(b);
  // An APE footer claiming more than the walked bytes before it (a whole file's walk: more than the file) is no tag.
  if (!st.runTag && st.pos + at < 0) return;
  const lo = st.runTag ? from : Math.max(from, st.pos + at);
  const runEnd = st.pos + Math.min(o, b.length);
  if (runEnd > lo) {
    // The junk counted in the tags is theirs, and so are the last bytes the walk stops short of (under a header's).
    st.junk -= runEnd - lo;
    st.tags = (st.tags ?? 0) + (st.pos + b.length - lo);
  }
}

/** The stream's first frame (at o, counted as its stream's): its rate, version and channels, and, when it is a Xing /
 *  VBRI information frame, its count (that frame is passed over: decoders skip it). Where the walk goes on. */
function firstMp3Frame(st: Mp3ScanState, b: Uint8Array, o: number, f: Mp3Header): number {
  st.first = { ver: f.ver, rate: f.rate, channels: f.channels };
  st.xingSpf = f.spf;
  const info = infoFrame(b, o, f);
  if (!info) return o;
  st.xingFrames = info.frames;
  return o + f.len;
}

/**
 * One step of the frame walk over `b`, whose first byte is at the absolute offset state.pos: from there, every frame
 * whose header starts before b's end (less MP3_LOOKAHEAD unless `final`: the next step's bytes start where this one
 * stopped). On a whole file held in memory, one final step. Pure; never throws on any bytes.
 */
export function mp3ScanStep(st: Mp3ScanState, b: Uint8Array, final: boolean): void {
  if (st.done) return;
  const limit = final ? b.length : Math.max(0, b.length - MP3_LOOKAHEAD);
  let o = 0;
  if (!st.first && !st.searched) {
    // Past any ID3v2 tags (nested ones too): a tag longer than these bytes moves the next step past it; v16.5 export
    // memory: one longer than the file is passed over by its header alone (pastLeadingTags).
    o = pastLeadingTags(st, b, final);
    if (o >= limit && !final) {
      st.pos += o;
      return;
    }
    const from = o;
    let found = -1;
    for (let p = from; p + 4 <= b.length && p < from + MP3_FIRST_WINDOW; p++) {
      if (b[p] !== 0xff) continue;
      const f = mp3Frame(b, p);
      if (!f) continue;
      const next = p + f.len;
      if (next + 4 <= b.length ? sameStream(f, mp3Frame(b, next)) : final && next <= b.length + 4) {
        found = p;
        break;
      }
      if (!final && next + 4 > b.length) break;
    }
    if (found < 0) {
      if (!final && from + MP3_FIRST_WINDOW + MP3_LOOKAHEAD > b.length && b.length > from) {
        // The window runs past these bytes: the next step looks again from here.
        st.pos += from;
        return;
      }
      // v16.5 final: no frame in the window (more than 16 KB of junk after the tag gave no scan): the walk below resyncs
      // on from here, and its first counted frame is the stream's. A file with no frames in it ends with none.
      st.searched = true;
      o = from;
    } else {
      st.junk += found - from;
      o = firstMp3Frame(st, b, found, mp3Frame(b, found) as Mp3Header);
    }
  }
  // A frame counts when it follows a frame of its stream, or the next header confirms it (a run at another rate: a
  // joined file), or it is the file's last (nothing after it but less than a header).
  const counts = (h: Mp3Header | null, at: number, prev: Mp3Header | null): h is Mp3Header =>
    !!h && ((prev !== null && sameStream(h, prev)) || sameStream(h, mp3Frame(b, at + h.len)) || (final && at + h.len + 4 > b.length));
  let prev: Mp3Header | null = null;
  while (o < limit && o + 4 <= b.length) {
    const h = mp3Frame(b, o);
    if (counts(h, o, prev)) {
      if (!st.first) {
        // v16.5 final: the first frame after junk (found by the resync): the stream's, a Xing / VBRI frame passed over.
        const on = firstMp3Frame(st, b, o, h);
        if (on !== o) {
          o = on;
          continue;
        }
      }
      st.frames++;
      st.seconds += h.spf / h.rate;
      if (h.channels > st.channels) st.channels = h.channels;
      prev = h;
      o += h.len;
      st.runFrom = -1;
      continue;
    }
    prev = null;
    // An ID3v2 tag in the middle (joined files): skipped whole, when a frame, a tag or the end is where it says it ends
    // (v16.5 final: a bogus size skipped the rest of the file; such a header is junk, and the walk resyncs past it).
    // v16.5 export memory: skipped as a tag (not junk) when its frames chain (id3Genuine); a header whose body isn't a
    // tag's is walked through as junk, so any frame it would have hidden is counted.
    const e = id3End(b, o);
    if (e > o && tagLands(b, e, final, mp3Frame) && id3Genuine(b, o, e)) {
      st.tags = (st.tags ?? 0) + (e - o);
      st.runFrom = -1;
      o = e;
      continue;
    }
    // v16.5 export memory: an APEv2 tag with its header (its items checked), skipped whole where something follows it.
    const a = apeEnd(b, o);
    if (a > o && tagLands(b, a, final, mp3Frame)) {
      st.tags = (st.tags ?? 0) + (a - o);
      st.runFrom = -1;
      o = a;
      continue;
    }
    // Junk: on to the next place a frame counts (see `counts`); a non-final step stops where it can't tell.
    openRun(st, b, o, final);
    // v16.5 export memory: inside bytes a tag's header began, a frame ends them only with two more of its stream after it
    // (a stream resuming has many; art's false syncs come alone or in a pair).
    const third = (f: Mp3Header, at: number): boolean => {
      const g = mp3Frame(b, at + f.len);
      return !!g && sameStream(f, g) && sameStream(f, mp3Frame(b, at + f.len + g.len));
    };
    let p = o + 1;
    let at = -1;
    for (; p + 4 <= b.length; p++) {
      if (!final && p >= limit) break;
      if (b[p] !== 0xff) continue;
      const f = mp3Frame(b, p);
      if (counts(f, p, null) && (!st.runTag || third(f, p))) {
        at = p;
        break;
      }
    }
    if (at < 0) {
      st.junk += Math.min(p, b.length) - o;
      o = Math.min(p, b.length);
      break;
    }
    st.junk += at - o;
    o = at;
  }
  if (final) {
    // v16.5 export memory: the tags at the end (an ID3v1, an APE tag by its footer, Lyrics3) are not junk.
    settleTrailingTags(st, b, o);
    st.done = true;
    st.none = !st.first;
    st.pos += Math.min(o, b.length);
  } else st.pos += o;
}

export interface Mp3Scan {
  /** v16.5 final: the walk that measured it (an ADTS AAC's and an Ogg's give the same fields; no Xing count). */
  kind?: ScanKind;
  /** The length the frames add up to (seconds), and theirs. */
  seconds: number;
  frames: number;
  sampleRate: number;
  channels: number;
  /** The Xing / VBRI header's length (seconds), or null; whether it agrees with the frames (within one frame and 0.5 %). */
  xingSeconds: number | null;
  xingAgrees: boolean | null;
  /** Bytes between frames that weren't frames. */
  junk: number;
  /** v16.5 export memory: bytes of tags (in the middle, at the end), not counted as junk. */
  tags?: number;
}

/** The scan's result, or null when no MP3 stream was found. */
export function mp3Result(st: Mp3ScanState): Mp3Scan | null {
  if (!st.first || st.frames === 0) return null;
  const xingSeconds = st.xingFrames !== null ? (st.xingFrames * st.xingSpf) / st.first.rate : null;
  const tol = Math.max(st.xingSpf / st.first.rate, st.seconds * 0.005);
  return {
    kind: 'mp3',
    seconds: st.seconds,
    frames: st.frames,
    sampleRate: st.first.rate,
    channels: Math.max(st.channels, st.first.channels),
    xingSeconds,
    xingAgrees: xingSeconds === null ? null : Math.abs(xingSeconds - st.seconds) <= tol,
    junk: st.junk,
    tags: st.tags ?? 0,
  };
}

/** An MP3 held whole (the bytes read for the decode): its length from its frames, or null when it isn't one. */
export function scanMp3(b: Uint8Array): Mp3Scan | null {
  const st = newMp3Scan();
  mp3ScanStep(st, b, true);
  return mp3Result(st);
}

/** A scan's length is the file's when most of the file is frames (a quarter of it junk, or more: not trusted alone).
 *  v16.5 export memory: tags are not junk (their bytes are in `tags`), so cover art doesn't make a short file untrusted. */
export function mp3ScanTrusted(s: Mp3Scan | null, fileSize: number): s is Mp3Scan {
  return !!s && s.frames > 0 && s.junk <= 0.25 * Math.max(1, fileSize);
}

// ---- v16.5 final: which walk measures a file's length, over which of its bytes.

export type ScanKind = 'mp3' | 'adts' | 'ogg';

export interface ScanPlan {
  kind: ScanKind;
  /** Where the walked bytes start in the file, and how many there are (null: to its end). */
  at: number;
  bytes: number | null;
}

/**
 * The frame walk that measures this file (the length its frames or pages add up to), or null when none does: an MP3
 * (or bytes that don't say what they are), ADTS AAC, an Ogg, a WAV whose payload is MP3 (its data chunk). Every other
 * kind's length is its header's (PCM and G.711 WAV, AIFF, FLAC, MP4's mdhd, WebM's Info) or nothing here can tell it
 * (a phone then doesn't decode it: the engine's 'untrusted').
 */
export function scanPlanFor(info: SourceInfo): ScanPlan | null {
  if (info.container === 'mp3' || info.container === 'unknown') return { kind: 'mp3', at: 0, bytes: null };
  if (info.container === 'adts') return { kind: 'adts', at: 0, bytes: null };
  if (info.container === 'ogg') return { kind: 'ogg', at: 0, bytes: null };
  if (info.container === 'wav' && info.codec === 'mp3' && info.payload) return { kind: 'mp3', at: info.payload.at, bytes: info.payload.bytes };
  return null;
}

/** One walk, stepped by the engine over slices of a file (the long file's plan) or once over bytes held whole. */
export interface StreamScan {
  kind: ScanKind;
  /** Bytes past a step's last frame start that a non-final step needs. */
  lookahead: number;
  pos: () => number;
  done: () => boolean;
  step: (b: Uint8Array, final: boolean) => void;
  result: () => Mp3Scan | null;
}

export function newStreamScan(kind: ScanKind, size: number | null = null): StreamScan {
  if (kind === 'adts') {
    const st = newAdtsScan(size);
    return { kind, lookahead: ADTS_LOOKAHEAD, pos: () => st.pos, done: () => st.done, step: (b, f) => adtsScanStep(st, b, f), result: () => adtsResult(st) };
  }
  if (kind === 'ogg') {
    const st = newOggScan();
    return { kind, lookahead: OGG_LOOKAHEAD, pos: () => st.pos, done: () => st.done, step: (b, f) => oggScanStep(st, b, f), result: () => oggResult(st) };
  }
  const st = newMp3Scan(size);
  return { kind, lookahead: MP3_LOOKAHEAD, pos: () => st.pos, done: () => st.done, step: (b, f) => mp3ScanStep(st, b, f), result: () => mp3Result(st) };
}

/** A walk over bytes held whole (the read for the decode). */
export function scanStream(kind: ScanKind, b: Uint8Array): Mp3Scan | null {
  const s = newStreamScan(kind);
  s.step(b, true);
  return s.result();
}

/** Any walk's result is trusted as its file's length as an MP3's is (mp3ScanTrusted: frames, and at most a quarter
 *  of the walked bytes junk). */
export const scanTrusted = mp3ScanTrusted;

// ---- v16.5 re-review (B2): ADTS AAC (a raw .aac stream; or one named .mp3).

const ADTS_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 8];

interface AdtsHeader {
  /** The sampling frequency index (AAC_RATES). */
  fi: number;
  /** The channel configuration (0: in the stream). */
  ch: number;
  /** The frame's bytes (frame_length: its header included). */
  len: number;
  /** Its raw data blocks (number_of_raw_data_blocks_in_frame + 1), 1,024 samples each. */
  blocks: number;
}

/** An ADTS header at o (sync 0xFFF, layer 0; frame_length: bits 30–42), or null. */
function adtsFrame(b: Uint8Array, o: number): AdtsHeader | null {
  if (o + 7 > b.length || b[o] !== 0xff || (b[o + 1] & 0xf6) !== 0xf0) return null;
  const fi = (b[o + 2] >> 2) & 0x0f;
  const ch = ((b[o + 2] & 0x01) << 2) | (b[o + 3] >> 6);
  const len = ((b[o + 3] & 0x03) << 11) | (b[o + 4] << 3) | (b[o + 5] >> 5);
  // The header is 7 bytes, 9 with its CRC (protection_absent 0).
  if (fi >= AAC_RATES.length || len < (b[o + 1] & 0x01 ? 7 : 9)) return null;
  return { fi, ch, len, blocks: (b[o + 6] & 0x03) + 1 };
}

function adts(b: Uint8Array, start = skipId3(b)): SourceInfo | null {
  const f = adtsFrame(b, start);
  if (!f) return null;
  const g = adtsFrame(b, start + f.len);
  if (start + f.len + 7 <= b.length && (!g || g.fi !== f.fi)) return null;
  const core = AAC_RATES[f.fi];
  // At 24 kHz and below an HE-AAC stream decodes at twice the core rate, which ADTS doesn't say: the rate is left
  // unknown (the long file then decodes it at 48 kHz, never under its real rate).
  return {
    container: 'adts',
    codec: 'aac',
    lossless: false,
    sampleRate: core > 24_000 ? core : null,
    channels: f.ch > 0 ? ADTS_CHANNELS[f.ch] : null,
    bits: null,
    seconds: null,
  };
}

// ---- v16.5 final (B1): ADTS AAC's length from its frames, as an MP3's (mp3ScanStep).
//
// ADTS states no length; Chrome (FFmpeg) estimates one from the first frames' bit rate: the re-review's 300 s files
// read 41.9 s and 83.1 s, so a 25-minute stream-rip .aac (or AAC named .mp3) passed the 8-minute AAC cap and would have
// decoded about 2.6 GB on a phone. Each header gives its frame's bytes (frame_length) and its raw data blocks of 1,024
// samples at its rate index's rate (HE-AAC's SBR doubles the samples and the rate alike: the seconds are the core's);
// the walk jumps from one to the next, resyncs on junk where the next header confirms a frame, and skips a tag in the
// middle only where something follows it (tagLands).

/** Bytes past a step's last frame start that a non-final step needs (a frame is at most 8,191 bytes, then a header). */
export const ADTS_LOOKAHEAD = 16 * 1024;

export interface AdtsScanState {
  pos: number;
  /** The first frame's rate index and rate (null: none found yet). */
  first: { fi: number; rate: number } | null;
  /** Past the leading tags. */
  searched: boolean;
  frames: number;
  seconds: number;
  channels: number;
  junk: number;
  /** v16.5 export memory: as Mp3ScanState's. */
  tags?: number;
  runFrom?: number;
  runTag?: boolean;
  size?: number | null;
  none: boolean;
  done: boolean;
}

export function newAdtsScan(size: number | null = null): AdtsScanState {
  return { pos: 0, first: null, searched: false, frames: 0, seconds: 0, channels: 0, junk: 0, tags: 0, runFrom: -1, size, none: false, done: false };
}

/** One step of the ADTS walk over `b` (its first byte at the absolute offset state.pos), as mp3ScanStep. Pure; never
 *  throws on any bytes. */
export function adtsScanStep(st: AdtsScanState, b: Uint8Array, final: boolean): void {
  if (st.done) return;
  const limit = final ? b.length : Math.max(0, b.length - ADTS_LOOKAHEAD);
  let o = 0;
  if (!st.searched) {
    // Past any leading ID3v2 tags (a stream rip's): a tag longer than these bytes moves the next step past it; v16.5
    // export memory: one longer than the file is passed over by its header alone (pastLeadingTags).
    o = pastLeadingTags(st, b, final);
    if (o >= limit && !final) {
      st.pos += o;
      return;
    }
    st.searched = true;
  }
  const sameRate = (h: AdtsHeader, g: AdtsHeader | null): boolean => !!g && g.fi === h.fi;
  // A frame counts when it follows one at its rate, or the next header confirms it, or it is the file's last.
  const counts = (h: AdtsHeader | null, at: number, prev: AdtsHeader | null): h is AdtsHeader =>
    !!h && ((prev !== null && sameRate(h, prev)) || sameRate(h, adtsFrame(b, at + h.len)) || (final && at + h.len + 7 > b.length));
  let prev: AdtsHeader | null = null;
  while (o < limit && o + 7 <= b.length) {
    const h = adtsFrame(b, o);
    if (counts(h, o, prev)) {
      if (!st.first) st.first = { fi: h.fi, rate: AAC_RATES[h.fi] };
      st.frames++;
      st.seconds += (1024 * h.blocks) / AAC_RATES[h.fi];
      if (h.ch > 0) st.channels = Math.max(st.channels, ADTS_CHANNELS[h.ch]);
      prev = h;
      o += h.len;
      st.runFrom = -1;
      continue;
    }
    prev = null;
    // v16.5 export memory: a tag (its frames chain) is skipped, not junk; a header whose body isn't a tag's is walked
    // through as junk (any frame in it counts); an APEv2 tag with its header is skipped whole.
    const e = id3End(b, o);
    if (e > o && tagLands(b, e, final, adtsFrame) && id3Genuine(b, o, e)) {
      st.tags = (st.tags ?? 0) + (e - o);
      st.runFrom = -1;
      o = e;
      continue;
    }
    const a = apeEnd(b, o);
    if (a > o && tagLands(b, a, final, adtsFrame)) {
      st.tags = (st.tags ?? 0) + (a - o);
      st.runFrom = -1;
      o = a;
      continue;
    }
    // Junk: on to the next place a frame counts; a non-final step stops where it can't tell.
    openRun(st, b, o, final);
    // v16.5 export memory: inside bytes a tag's header began, a frame ends them only with two more at its rate after it.
    const third = (h: AdtsHeader, at: number): boolean => {
      const g = adtsFrame(b, at + h.len);
      return !!g && sameRate(h, g) && sameRate(h, adtsFrame(b, at + h.len + g.len));
    };
    let p = o + 1;
    let next = -1;
    for (; p + 7 <= b.length && (final || p < limit); p++) {
      if (b[p] !== 0xff) continue;
      const h = adtsFrame(b, p);
      if (counts(h, p, null) && (!st.runTag || third(h, p))) {
        next = p;
        break;
      }
    }
    const to = next < 0 ? Math.min(p, b.length) : next;
    st.junk += to - o;
    o = to;
    if (next < 0) break;
  }
  if (final) {
    settleTrailingTags(st, b, o);
    st.done = true;
    st.none = !st.first;
    st.pos += Math.min(o, b.length);
  } else st.pos += o;
}

/** The ADTS walk's result (sampleRate: the core rate), or null when no frame was found. */
export function adtsResult(st: AdtsScanState): Mp3Scan | null {
  if (!st.first || st.frames === 0) return null;
  return { kind: 'adts', seconds: st.seconds, frames: st.frames, sampleRate: st.first.rate, channels: st.channels, xingSeconds: null, xingAgrees: null, junk: st.junk, tags: st.tags ?? 0 };
}

function ogg(b: Uint8Array): SourceInfo {
  if (b.length < 28) return { ...NONE, container: 'ogg' };
  const p = 27 + b[26];
  if (p + 8 > b.length) return { ...NONE, container: 'ogg' };
  if (b[p] === 0x01 && tag(b, p + 1) === 'vorb' && p + 16 <= b.length) {
    const channels = b[p + 11];
    const rate = u32le(b, p + 12);
    return { container: 'ogg', codec: 'vorbis', lossless: false, sampleRate: okRate(rate) ? rate : null, channels: okCh(channels) ? channels : null, bits: null, seconds: null };
  }
  if (tag(b, p) === 'Opus' && tag(b, p + 4) === 'Head') {
    // Opus always decodes at 48 kHz (the header's rate is the original's, for information).
    return { container: 'ogg', codec: 'opus', lossless: false, sampleRate: 48_000, channels: okCh(b[p + 9]) ? b[p + 9] : null, bits: null, seconds: null };
  }
  if (b[p] === 0x7f && tag(b, p + 1) === 'FLAC' && tag(b, p + 9) === 'fLaC') return streamInfo(b, p + 17, 'ogg');
  return { ...NONE, container: 'ogg' };
}

// ---- v16.5 final (B1): an Ogg's length from its pages.
//
// An Ogg file states no length up front; Chrome's is the last page's granule. The walk reads every page header (a page
// is at most 65,307 bytes: some 4,000 headers for 25 minutes) and keeps each logical stream's last granule position:
// its samples at its rate (Opus: less its pre-skip, at 48 kHz). A chained file (a stream rip: one link after another,
// each beginning again at 0) is the sum of its links, so the length is never the last link's alone. Bytes between
// pages are junk, resynced on at the next capture pattern ('OggS', version 0).

/** Bytes past a step's last page start that a non-final step needs (a whole page). */
export const OGG_LOOKAHEAD = 72 * 1024;
/** v16.5 export memory (fix 8): the most logical streams the walk follows at once. A link that ends (its end-of-stream
 *  page) is added up and let go, so a chained file of any length keeps one; more than this many open at once (24 MB of
 *  crafted begin-of-stream pages made a map of 830,000, 94 MB) and the walk gives no length: untrusted. */
export const OGG_MAX_STREAMS = 64;

interface OggLink {
  codec: 'vorbis' | 'opus' | 'flac' | null;
  rate: number;
  preskip: number;
  /** The highest granule position seen (-1: none). */
  last: number;
}

export interface OggScanState {
  pos: number;
  /** The first audio stream's rate (null: none found yet). */
  first: { rate: number } | null;
  /** The logical streams by serial number; `closed`: the seconds of links a later one with the same serial replaced. */
  links: Map<number, OggLink>;
  closed: number;
  /** v16.5 export memory: more than OGG_MAX_STREAMS open at once (no length then). */
  overflow?: boolean;
  /** Pages counted. */
  frames: number;
  channels: number;
  junk: number;
  none: boolean;
  done: boolean;
}

export function newOggScan(): OggScanState {
  return { pos: 0, first: null, links: new Map(), closed: 0, overflow: false, frames: 0, channels: 0, junk: 0, none: false, done: false };
}

/** An Ogg page header at o: its size, flags, granule (-1: none ends on it), serial and where its first packet starts. */
function oggPage(b: Uint8Array, o: number): { size: number; type: number; granule: number; serial: number; body: number } | null {
  if (o + 27 > b.length || b[o] !== 0x4f || b[o + 1] !== 0x67 || b[o + 2] !== 0x67 || b[o + 3] !== 0x53 || b[o + 4] !== 0) return null;
  const n = b[o + 26];
  if (o + 27 + n > b.length) return null;
  let size = 27 + n;
  for (let i = 0; i < n; i++) size += b[o + 27 + i];
  const lo = u32le(b, o + 6);
  const hi = u32le(b, o + 10);
  // A granule with its top bit set (-1 included) ends no packet here.
  const granule = hi >= 0x8000_0000 ? -1 : hi * 2 ** 32 + lo;
  return { size, type: b[o + 5], granule, serial: u32le(b, o + 14), body: o + 27 + n };
}

const linkSeconds = (l: OggLink): number => (l.codec === null || l.last < 0 ? 0 : Math.max(0, l.last - l.preskip) / l.rate);

/** One step of the Ogg page walk over `b` (its first byte at the absolute offset state.pos), as mp3ScanStep. Pure;
 *  never throws on any bytes. */
export function oggScanStep(st: OggScanState, b: Uint8Array, final: boolean): void {
  if (st.done) return;
  const limit = final ? b.length : Math.max(0, b.length - OGG_LOOKAHEAD);
  let o = 0;
  while (o < limit && o + 27 <= b.length) {
    const pg = oggPage(b, o);
    if (pg) {
      st.frames++;
      if (pg.type & 0x02) {
        // A stream begins (the first, or a chained file's next link): its codec from its first packet.
        const old = st.links.get(pg.serial);
        if (old) {
          st.closed += linkSeconds(old);
          st.links.delete(pg.serial);
        }
        // v16.5 export memory (fix 8): never more than OGG_MAX_STREAMS followed at once.
        if (st.links.size >= OGG_MAX_STREAMS) {
          st.overflow = true;
          o += pg.size;
          continue;
        }
        const p = pg.body;
        const link: OggLink = { codec: null, rate: 0, preskip: 0, last: -1 };
        let ch = 0;
        if (b[p] === 0x01 && tag(b, p + 1) === 'vorb' && p + 16 <= b.length) {
          Object.assign(link, { codec: 'vorbis', rate: u32le(b, p + 12) });
          ch = b[p + 11];
        } else if (tag(b, p) === 'Opus' && tag(b, p + 4) === 'Head' && p + 12 <= b.length) {
          Object.assign(link, { codec: 'opus', rate: 48_000, preskip: u16le(b, p + 10) });
          ch = b[p + 9];
        } else if (b[p] === 0x7f && tag(b, p + 1) === 'FLAC' && p + 17 + 18 <= b.length) {
          const si = streamInfo(b, p + 17, 'ogg');
          Object.assign(link, { codec: 'flac', rate: si.sampleRate ?? 0 });
          ch = si.channels ?? 0;
        }
        if (!okRate(link.rate)) link.codec = null;
        st.links.set(pg.serial, link);
        if (link.codec !== null) {
          if (!st.first) st.first = { rate: link.rate };
          if (okCh(ch)) st.channels = Math.max(st.channels, ch);
        }
      }
      const l = st.links.get(pg.serial);
      // v16.5 review: a page of a stream with no open link (it ended, or never began) can't be counted, so it is junk:
      // a stream that goes on after an early end-of-stream flag makes the walk untrusted rather than short.
      if (!l && !(pg.type & 0x02)) st.junk += pg.size;
      if (l && pg.granule > l.last) l.last = pg.granule;
      // v16.5 export memory (fix 8): a link that ends is added up and let go (a chained file keeps one open).
      if (l && pg.type & 0x04) {
        st.closed += linkSeconds(l);
        st.links.delete(pg.serial);
      }
      o += pg.size;
      continue;
    }
    // Junk: on to the next capture pattern; a non-final step stops where it can't tell.
    let p = o + 1;
    let page = -1;
    for (; p + 27 <= b.length && (final || p < limit); p++) {
      if (b[p] === 0x4f && oggPage(b, p)) {
        page = p;
        break;
      }
    }
    const to = page < 0 ? Math.min(p, b.length) : page;
    st.junk += to - o;
    o = to;
    if (page < 0) break;
  }
  if (final) {
    st.done = true;
    st.none = !st.first;
    st.pos += Math.min(o, b.length);
  } else st.pos += Math.min(o, b.length);
}

/** The Ogg walk's result (frames: pages), or null when no audio stream was found. */
export function oggResult(st: OggScanState): Mp3Scan | null {
  if (!st.first || st.frames === 0 || st.overflow) return null;
  let seconds = st.closed;
  for (const l of st.links.values()) seconds += linkSeconds(l);
  return { kind: 'ogg', seconds, frames: st.frames, sampleRate: st.first.rate, channels: st.channels, xingSeconds: null, xingAgrees: null, junk: st.junk };
}

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** An MPEG-4 descriptor's length (1–4 bytes, 7 bits each) at o: [length, bytes used]. */
function descLen(b: Uint8Array, o: number): [number, number] {
  let n = 0;
  for (let i = 0; i < 4 && o + i < b.length; i++) {
    n = (n << 7) | (b[o + i] & 0x7f);
    if (!(b[o + i] & 0x80)) return [n, i + 1];
  }
  return [n, 4];
}

/** The AAC output rate from an 'esds' box's AudioSpecificConfig (HE-AAC's SBR doubles the core rate), and its channel
 *  configuration's channels (v16.5 re-review: a 5.1 AAC's sample entry may say 2), or null. */
function esdsRate(b: Uint8Array, o: number, end: number): { rate: number; channels: number | null } | null {
  let p = o + 4; // version and flags
  for (let guard = 0; guard < 8 && p < end; guard++) {
    const t = b[p];
    const [len, used] = descLen(b, p + 1);
    const body = p + 1 + used;
    if (t === 0x03) p = body + 3; // ES_Descriptor: ES_ID (2) and flags (1), then its children
    else if (t === 0x04) p = body + 13; // DecoderConfigDescriptor: 13 bytes, then DecoderSpecificInfo
    else if (t === 0x05) {
      if (body + 2 > b.length) return null;
      const aot = b[body] >> 3;
      const fi = ((b[body] & 0x07) << 1) | (b[body + 1] >> 7);
      let rate = fi < AAC_RATES.length ? AAC_RATES[fi] : null;
      if (fi === 0x0f && body + 5 <= b.length) rate = ((b[body + 1] & 0x7f) << 17) | (b[body + 2] << 9) | (b[body + 3] << 1) | (b[body + 4] >> 7);
      if (rate === null) return null;
      const cfgByte = fi === 0x0f ? body + 4 : body + 1;
      const cfg = cfgByte < b.length ? (b[cfgByte] >> 3) & 0x0f : 0;
      const channels = cfg >= 1 && cfg <= 6 ? cfg : cfg === 7 ? 8 : null;
      return { rate: aot === 5 || aot === 29 ? rate * 2 : rate, channels };
    } else p = body + len;
  }
  return null;
}

function mp4(chunks: Uint8Array[]): SourceInfo {
  let codec: string | null = null;
  let rate: number | null = null;
  let channels: number | null = null;
  let bits: number | null = null;
  let seconds: number | null = null;
  for (const b of chunks) {
    for (let o = 4; o + 4 <= b.length; o++) {
      const t = tag(b, o);
      if (t === 'mdhd' && o + 28 <= b.length) {
        const v = b[o + 4];
        const scale = v === 1 ? u32be(b, o + 24) : u32be(b, o + 16);
        const dur = v === 1 ? (o + 36 <= b.length ? u32be(b, o + 28) * 2 ** 32 + u32be(b, o + 32) : 0) : u32be(b, o + 20);
        if (scale > 0 && dur > 0 && dur !== 0xffffffff) seconds = Math.max(seconds ?? 0, dur / scale);
      } else if ((t === 'mp4a' || t === 'alac' || t === 'fLaC' || t === 'Opus') && o + 32 <= b.length && u32be(b, o - 4) >= 36) {
        codec = t === 'mp4a' ? 'aac' : t === 'alac' ? 'alac' : t === 'fLaC' ? 'flac' : 'opus';
        const ch = u16be(b, o + 20);
        const sz = u16be(b, o + 22);
        const r = u16be(b, o + 28);
        if (okCh(ch)) channels = ch;
        if (sz > 0 && codec !== 'aac' && codec !== 'opus') bits = sz;
        if (okRate(r)) rate = Math.max(rate ?? 0, r);
        if (codec === 'opus') rate = 48_000;
      } else if (t === 'esds') {
        const r = esdsRate(b, o + 4, Math.min(b.length, o + 4 + 64));
        if (r !== null && okRate(r.rate)) rate = Math.max(rate ?? 0, r.rate);
        if (r !== null && r.channels !== null) channels = Math.max(channels ?? 0, r.channels);
      } else if (t === 'alac' && codec === 'alac' && o + 32 <= b.length && u32be(b, o - 4) === 36) {
        // ALAC's own 'alac' config box (inside the sample entry): its rate is 32-bit.
        const r = u32be(b, o + 28);
        if (okRate(r)) rate = Math.max(rate ?? 0, r);
      }
    }
  }
  const lossless = codec === 'alac' || codec === 'flac';
  return { container: 'mp4', codec, lossless, sampleRate: rate, channels, bits, seconds };
}

// ---- v16.5 final: a WebM / Matroska head, walked as EBML: the Segment's Info (TimecodeScale, Duration) and its first
// audio track (CodecID, CodecPrivate's OpusHead, Audio's SamplingFrequency and Channels), up to the first Cluster.

/** An EBML variable-length integer at o: [value, bytes]. An ID keeps its length marker; a size of all ones is -1
 *  (unknown: to its parent's end). */
function vint(b: Uint8Array, o: number, id: boolean): [number, number] | null {
  if (o >= b.length || b[o] === 0) return null;
  let len = 1;
  while (!(b[o] & (0x100 >> len))) len++;
  if (len > 8 || o + len > b.length) return null;
  const mask = (0x100 >> len) - 1;
  let v = id ? b[o] : b[o] & mask;
  let ones = (b[o] & mask) === mask;
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[o + i];
    if (b[o + i] !== 0xff) ones = false;
  }
  return [!id && ones ? -1 : v, len];
}

const EBML = {
  Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, Tracks: 0x1654ae6b, TrackEntry: 0xae,
  TrackType: 0x83, CodecID: 0x86, CodecPrivate: 0x63a2, Audio: 0xe1, SamplingFrequency: 0xb5, Channels: 0x9f, Cluster: 0x1f43b675,
  OutputSamplingFrequency: 0x78b5,
} as const;

interface WebmHead {
  scale: number;
  duration: number | null;
  track: { codec: string | null; rate: number | null; channels: number | null; opusChannels: number | null; outRate?: number | null } | null;
}

function ebmlUint(b: Uint8Array, at: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n && at + i < b.length; i++) v = v * 256 + b[at + i];
  return v;
}
function ebmlFloat(b: Uint8Array, at: number, n: number): number | null {
  if (at + n > b.length) return null;
  const d = new DataView(b.buffer, b.byteOffset + at, n);
  return n === 8 ? d.getFloat64(0, false) : n === 4 ? d.getFloat32(0, false) : null;
}

/** The head's Info and first audio track (what the bytes hold of them; never throws). */
function webmHead(b: Uint8Array): WebmHead {
  const out: WebmHead = { scale: 1_000_000, duration: null, track: null };
  let budget = 4096;
  const walk = (from: number, to: number, entry: Record<string, unknown> | null): boolean => {
    let o = from;
    while (o < to && budget-- > 0) {
      const id = vint(b, o, true);
      const sz = id ? vint(b, o + id[1], false) : null;
      if (!id || !sz) return false;
      const at = o + id[1] + sz[1];
      const end = sz[0] < 0 ? to : Math.min(to, at + sz[0]);
      const n = end - at;
      const v = id[0];
      if (v === EBML.Cluster) return false;
      if (v === EBML.Segment || v === EBML.Info || v === EBML.Tracks || v === EBML.Audio) {
        if (!walk(at, end, entry)) return false;
      } else if (v === EBML.TrackEntry) {
        const e: Record<string, unknown> = {};
        walk(at, end, e);
        if (e.type === 2 && !out.track) {
          out.track = { codec: (e.codec as string) ?? null, rate: (e.rate as number) ?? null, channels: (e.channels as number) ?? null, opusChannels: (e.opusChannels as number) ?? null, outRate: (e.outRate as number) ?? null };
        }
      } else if (v === EBML.TimecodeScale && n > 0 && n <= 8) out.scale = ebmlUint(b, at, n);
      else if (v === EBML.Duration) out.duration = ebmlFloat(b, at, n);
      else if (entry && v === EBML.TrackType) entry.type = ebmlUint(b, at, n);
      else if (entry && v === EBML.CodecID) entry.codec = String.fromCharCode(...Array.from(b.subarray(at, Math.min(end, at + 32)))).replace(/\0+$/, '');
      else if (entry && v === EBML.CodecPrivate && tag(b, at) === 'Opus' && tag(b, at + 4) === 'Head' && at + 9 < b.length) entry.opusChannels = b[at + 9];
      else if (entry && v === EBML.SamplingFrequency) entry.rate = ebmlFloat(b, at, n);
      else if (entry && v === EBML.OutputSamplingFrequency) entry.outRate = ebmlFloat(b, at, n);
      else if (entry && v === EBML.Channels && n > 0 && n <= 8) entry.channels = ebmlUint(b, at, n);
      if (sz[0] < 0 && v !== EBML.Segment) return false; // an unknown size ends nowhere this walk can see
      o = end;
    }
    return true;
  };
  try {
    walk(0, b.length, null);
  } catch {
    // what was read stands
  }
  return out;
}

function webm(b: Uint8Array): SourceInfo {
  const text = String.fromCharCode(...Array.from(b.subarray(0, Math.min(b.length, 8192))));
  // v16.5 final: the head walked as EBML (its channels refuse a 5.1 file before it is read; its Duration is its length).
  const head = webmHead(b);
  const t = head.track;
  const opus = t?.codec ? t.codec === 'A_OPUS' : text.includes('A_OPUS');
  const channels = opus && t?.opusChannels && okCh(t.opusChannels) ? t.opusChannels : t?.channels && okCh(t.channels) ? t.channels : null;
  const seconds = head.duration !== null && Number.isFinite(head.duration) && head.duration > 0 && head.scale > 0 ? (head.duration * head.scale) / 1e9 : null;
  let rate: number | null = opus ? 48_000 : t?.rate && okRate(t.rate) ? Math.round(t.rate) : null;
  if (!opus && rate === null) {
    for (let o = 0; o + 10 <= b.length; o++) {
      if (b[o] !== 0xb5) continue;
      if (b[o + 1] === 0x88) {
        const v = new DataView(b.buffer, b.byteOffset + o + 2, 8).getFloat64(0, false);
        if (okRate(v)) { rate = Math.round(v); break; }
      } else if (b[o + 1] === 0x84) {
        const v = new DataView(b.buffer, b.byteOffset + o + 2, 4).getFloat32(0, false);
        if (okRate(v)) { rate = Math.round(v); break; }
      }
    }
  }
  const vorbis = t?.codec ? t.codec === 'A_VORBIS' : text.includes('A_VORBIS');
  // v16.5 export memory (fix 6): AAC in Matroska (A_AAC, A_AAC/MPEG4/LC, …) costs AAC's, not the others'. HE-AAC's
  // SamplingFrequency is its core rate: the decoder's is OutputSamplingFrequency when it is there, else at 24 kHz and
  // below the rate is left unknown (as ADTS: the long file then decodes it at 48 kHz, never under its real rate).
  const aac = !opus && !vorbis && (t?.codec ? t.codec.startsWith('A_AAC') : text.includes('A_AAC'));
  if (aac) {
    const out = t?.outRate && okRate(t.outRate) ? Math.round(t.outRate) : null;
    rate = out ?? (rate !== null && rate > 24_000 ? rate : null);
  }
  return { container: 'webm', codec: opus ? 'opus' : vorbis ? 'vorbis' : aac ? 'aac' : null, lossless: false, sampleRate: rate, channels, bits: null, seconds };
}

/**
 * Where to read the second SNIFF_BYTES: an MP4's first box past the first bytes (its top-level boxes walked from their
 * sizes: past the media data, where the moov is when it isn't at the start); for anything else the file's last bytes.
 */
export function secondChunkAt(head: Uint8Array, fileSize: number): number {
  const end = Math.max(0, fileSize - SNIFF_BYTES);
  if (tag(head, 4) !== 'ftyp') return end;
  let off = 0;
  for (let guard = 0; guard < 64; guard++) {
    if (off + 16 > head.length) return off < fileSize ? Math.min(off, end) : end;
    let size = u32be(head, off);
    if (size === 1) size = u32be(head, off + 8) * 2 ** 32 + u32be(head, off + 12);
    if (size === 0 || size < 8) return end;
    if (tag(head, off + 4) === 'moov') return off;
    off += size;
    if (off >= fileSize) return end;
  }
  return end;
}

/**
 * What the file's first bytes (`head`, its first SNIFF_BYTES) and last bytes (`tail`: an MP4's moov may be at the end)
 * say about it. `fileSize` is the whole file's; `name` and `type` only break a tie when the bytes don't say.
 */
export function sniffSource(head: Uint8Array, tail: Uint8Array | null, fileSize: number, name?: string | null, type?: string | null): SourceInfo {
  try {
    const b = head;
    const t0 = tag(b, 0);
    if ((t0 === 'RIFF' || t0 === 'RF64') && tag(b, 8) === 'WAVE') return wav(b, fileSize);
    if (t0 === 'FORM' && (tag(b, 8) === 'AIFF' || tag(b, 8) === 'AIFC')) return aiff(b);
    if (t0 === 'OggS') return ogg(b);
    if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return webm(b);
    if (tag(b, 4) === 'ftyp') return mp4(tail && tail !== head ? [b, tail] : [b]);
    // v16.5 export memory (fix 5): a leading ID3v2 tag whose size runs past the file: its header alone (the walk resyncs
    // from there too: pastLeadingTags).
    const id3 = skipId3(b) > fileSize ? 10 : skipId3(b);
    if (tag(b, id3) === 'fLaC') return id3 + 8 + 34 <= b.length ? streamInfo(b, id3 + 8, 'flac') : { ...NONE, container: 'flac', codec: 'flac', lossless: true };
    const a = adts(b, id3);
    if (a) return a;
    const m = mp3(b, id3);
    if (m.sampleRate !== null) return m;
    const n = (name ?? '').toLowerCase();
    const ty = (type ?? '').toLowerCase();
    if (/\.mp3$/.test(n) || ty === 'audio/mpeg' || ty === 'audio/mp3') return m;
    return { ...NONE };
  } catch {
    return { ...NONE };
  }
}

/**
 * The shortest the file can be (seconds): its size over the highest bit rate its kind can have (PCM's own rate × 1.05
 * for FLAC and ALAC; the lossy codecs' MAX_BITRATE), or 0 when the kind is unknown. A stored length shorter than this is
 * wrong (B1: the export would decode more than it planned).
 */
export function lengthLowerBound(info: SourceInfo, fileSize: number): number {
  if (!(fileSize > 0)) return 0;
  if ((info.codec === 'pcm' || info.codec === 'flac' || info.codec === 'alac') && info.sampleRate && info.channels && info.bits) {
    const pcmBps = info.sampleRate * info.channels * Math.ceil(info.bits / 8) * 8;
    return (fileSize * 8) / (pcmBps * (info.codec === 'pcm' ? 1 : 1.05));
  }
  const max = info.codec ? MAX_BITRATE[info.codec] : undefined;
  return max ? (fileSize * 8) / max : 0;
}

// ---- v16.5 re-review (B7, multichannel): where the header isn't in the first bytes.

/** Reads up to `n` bytes at `at` (fewer at the file's end). */
export type ReadAt = (at: number, n: number) => Promise<Uint8Array>;

/** At most this many reads after the first two (each a box or chunk header, or a header's bytes). */
export const FOLLOW_UP_READS = 64;

/**
 * sniffSource over a whole file through `read`: its first SNIFF_BYTES and its second chunk (secondChunkAt); then, where
 * the rate or the channels aren't in them, a few reads more: past an ID3v2 tag longer than the first bytes (cover art:
 * the first MP3 frame, or 'fLaC', after it; a 100 KB tag left the rate unknown, and the long file decoded the track at
 * 48 kHz, so Chrome's resampler came back at its join), along a WAV's chunks to its fmt and data, down an MP4's boxes
 * to its audio track's sample entry and mdhd. Never throws: what a read can't find leaves the first sniff as it was.
 */
export async function sniffFile(read: ReadAt, fileSize: number, name?: string | null, type?: string | null): Promise<{ info: SourceInfo; reads: number }> {
  let reads = 0;
  const rd = async (at: number, n: number): Promise<Uint8Array> => {
    reads++;
    if (reads > FOLLOW_UP_READS + 2) throw new Error('too many reads');
    return read(at, Math.max(0, Math.min(n, fileSize - at)));
  };
  const head = await rd(0, SNIFF_BYTES);
  const at2 = secondChunkAt(head, fileSize);
  const tail = fileSize > SNIFF_BYTES ? await rd(at2, SNIFF_BYTES) : null;
  const info = sniffSource(head, tail, fileSize, name, type);
  if (info.sampleRate !== null && info.channels !== null) return { info, reads };
  try {
    const more = (await pastId3(rd, head, info, fileSize, name, type)) ?? (await wavChunks(rd, head, info, fileSize)) ?? (await mp4Boxes(rd, head, info, fileSize));
    return { info: more ?? info, reads };
  } catch {
    return { info, reads };
  }
}

async function pastId3(rd: ReadAt, head: Uint8Array, info: SourceInfo, fileSize: number, name?: string | null, type?: string | null): Promise<SourceInfo | null> {
  let start = skipId3(head);
  // The first frame is looked for in the 16 KB after the tag: all within the first bytes, it was.
  if (start === 0 || start + 16_384 + 4 <= head.length || info.container === 'flac') return null;
  for (let guard = 0; guard < 4 && start < fileSize; guard++) {
    const b = await rd(start, SNIFF_BYTES);
    const more = skipId3(b);
    if (more > 0) {
      start += more;
      continue;
    }
    const i = sniffSource(b, null, fileSize - start, name, type);
    if (i.container === 'flac' || (i.container !== 'unknown' && i.sampleRate !== null)) return i;
    return null;
  }
  return null;
}

async function wavChunks(rd: ReadAt, head: Uint8Array, info: SourceInfo, fileSize: number): Promise<SourceInfo | null> {
  if (info.container !== 'wav' || info.sampleRate !== null) return null;
  const bytes = async (at: number, n: number) => (at + n <= head.length ? head.subarray(at, at + n) : rd(at, n));
  let off = 12;
  let fmt: WavFmt | null = null;
  let dataBytes: number | null = null;
  let dataAt = 0;
  for (let guard = 0; guard < FOLLOW_UP_READS && off + 8 <= fileSize; guard++) {
    const h = await bytes(off, 8);
    if (h.length < 8) break;
    const id = tag(h, 0);
    const size = u32le(h, 4);
    if (id === 'fmt ') fmt = wavFmt(await bytes(off + 8, Math.min(size, 40)), 0);
    if (id === 'data') {
      dataBytes = wavData(size, off + 8, fileSize);
      dataAt = off + 8;
      break;
    }
    off += 8 + size + (size & 1);
  }
  return fmt ? wavInfo(fmt, dataBytes, fileSize, dataAt) : null;
}

interface Box {
  type: string;
  at: number;
  size: number;
  hdr: number;
}

/** The boxes in [from, to): their types, places and sizes (each header one read). */
async function boxesIn(rd: ReadAt, from: number, to: number, budget: { n: number }): Promise<Box[]> {
  const out: Box[] = [];
  let off = from;
  while (off + 8 <= to && budget.n-- > 0) {
    const h = await rd(off, 16);
    if (h.length < 8) break;
    let size = u32be(h, 0);
    let hdr = 8;
    if (size === 1 && h.length >= 16) {
      size = u32be(h, 8) * 2 ** 32 + u32be(h, 12);
      hdr = 16;
    } else if (size === 0) size = to - off;
    if (size < hdr) break;
    out.push({ type: tag(h, 4), at: off, size, hdr });
    off += size;
  }
  return out;
}

async function mp4Boxes(rd: ReadAt, head: Uint8Array, info: SourceInfo, fileSize: number): Promise<SourceInfo | null> {
  if (info.container !== 'mp4') return null;
  void head;
  const budget = { n: FOLLOW_UP_READS };
  const child = async (parent: Box, type: string): Promise<Box | null> =>
    (await boxesIn(rd, parent.at + parent.hdr, parent.at + parent.size, budget)).find((b) => b.type === type) ?? null;
  const moov = (await boxesIn(rd, 0, fileSize, budget)).find((b) => b.type === 'moov');
  if (!moov) return null;
  for (const trak of (await boxesIn(rd, moov.at + moov.hdr, moov.at + moov.size, budget)).filter((b) => b.type === 'trak')) {
    const mdia = await child(trak, 'mdia');
    if (!mdia) continue;
    const kids = await boxesIn(rd, mdia.at + mdia.hdr, mdia.at + mdia.size, budget);
    const minf = kids.find((b) => b.type === 'minf');
    const stbl = minf ? await child(minf, 'stbl') : null;
    const stsd = stbl ? await child(stbl, 'stsd') : null;
    if (!stsd) continue;
    // stsd: version and flags (4), the entry count (4), then the first sample entry (with its esds).
    const entry = mp4([await rd(stsd.at + stsd.hdr + 8, Math.min(1024, stsd.size - stsd.hdr - 8))]);
    if (entry.codec === null) continue;
    const mdhd = kids.find((b) => b.type === 'mdhd');
    const own = mdhd ? mp4([await rd(mdhd.at, Math.min(64, mdhd.size))]).seconds : null;
    return {
      container: 'mp4',
      codec: entry.codec,
      lossless: entry.lossless,
      sampleRate: entry.sampleRate ?? info.sampleRate,
      channels: entry.channels ?? info.channels,
      bits: entry.bits ?? info.bits,
      seconds: info.seconds ?? own,
    };
  }
  return null;
}
