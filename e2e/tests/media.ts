// e2e/tests/media.ts (v16.5 re-review): synthetic test media made by ffmpeg (tones and noise only: never a real
// track), for the export's tests that need real encoded files (a VBR MP3 without a Xing header, a joined MP3, cover art,
// an AAC named .mp3, a FLAC whose header understates its length, a 5.1 Opus). Each file is made once per run into the
// system's temp folder and read back as base64 for seedLibraryRecords' `bytes`. With no ffmpeg on PATH the tests that
// need it say so and skip (as device.spec's export masters do).

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

let available: boolean | null = null;

/** ffmpeg runs (once per worker). */
export function ffmpegAvailable(): boolean {
  if (available === null) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-version'], { encoding: 'utf8' });
    available = r.status === 0;
  }
  return available;
}

const DIR = join(tmpdir(), 'aetheria-e2e-media');

/** ffmpeg's output for these arguments (the output file named here, last), made once: its path. */
export function ffmpegPath(name: string, args: string[]): string {
  mkdirSync(DIR, { recursive: true });
  const key = createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 12);
  const out = join(DIR, `${key}-${name}`);
  if (!existsSync(out)) {
    const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args, out], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffmpeg failed for ${name}: ${r.stderr}`);
  }
  return out;
}

/** The same, its bytes. */
export function ffmpegFile(name: string, args: string[]): Buffer {
  return readFileSync(ffmpegPath(name, args));
}

/** Several files' bytes joined (a "joined" MP3: two files back to back, the first one's Xing header now stale). */
export function joined(...parts: Buffer[]): Buffer {
  return Buffer.concat(parts);
}

/** Media made by ffmpeg, by kind. */
export const MEDIA = {
  /** A LAME V0 VBR MP3 without a Xing header: `loudS` of pink noise then a quiet 220 Hz tone, `seconds` in all. Chrome
   *  guesses its length from its first (loud) frames: about a quarter of it. */
  vbrNoXing: (seconds: number, loudS = 10) =>
    ffmpegFile(`vbr-noxing-${seconds}.mp3`, ['-f', 'lavfi', '-i', `anoisesrc=d=${loudS}:c=pink:a=0.5:r=44100`, '-f', 'lavfi', '-i', `sine=f=220:d=${seconds - loudS}:r=44100,volume=0.01`, '-filter_complex', '[0][1]concat=n=2:v=0:a=1,aformat=channel_layouts=stereo', '-c:a', 'libmp3lame', '-q:a', '0', '-write_xing', '0']),
  /** An MP3 of a tone with a Xing header (LAME -q:a 2). */
  toneMp3: (seconds: number, hz: number) => ffmpegFile(`tone-${seconds}-${hz}.mp3`, ['-f', 'lavfi', '-i', `sine=f=${hz}:d=${seconds}:r=44100`, '-ac', '2', '-c:a', 'libmp3lame', '-q:a', '2']),
  /** A 128 kbps CBR MP3 of a 440 Hz tone with a cover image of about `kb` KB in its ID3v2 tag. */
  withCover: (seconds: number, kb: number, hz = 440) => {
    // A PNG of noise (it doesn't compress): about 3 bytes a pixel; made first, then attached as the front cover.
    const side = Math.round(Math.sqrt((kb * 1024) / 3));
    const png = ffmpegPath(`cover-${kb}k.png`, ['-f', 'lavfi', '-i', `color=c=gray:s=${side}x${side},noise=alls=100:allf=t`, '-frames:v', '1']);
    return ffmpegFile(`cover-${kb}k-${seconds}-${hz}.mp3`, ['-f', 'lavfi', '-i', `sine=f=${hz}:d=${seconds}:r=44100`, '-i', png, '-map', '0:a', '-map', '1:v', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', '-c:v', 'copy', '-id3v2_version', '3', '-metadata:s:v', 'comment=Cover (front)', '-disposition:v', 'attached_pic']);
  },
  /** AAC-LC in an M4A. */
  m4a: (seconds: number) => ffmpegFile(`aac-${seconds}.m4a`, ['-f', 'lavfi', '-i', `sine=f=440:d=${seconds}:r=44100`, '-ac', '2', '-c:a', 'aac', '-b:a', '128k']),
  /** AAC-LC as ADTS (a raw .aac stream). */
  adts: (seconds: number) => ffmpegFile(`aac-${seconds}.aac`, ['-f', 'lavfi', '-i', `sine=f=440:d=${seconds}:r=44100`, '-ac', '2', '-c:a', 'aac', '-b:a', '128k', '-f', 'adts']),
  /** A FLAC of a quiet 220 Hz tone (48 kHz stereo, so it compresses to a few percent). */
  flac: (seconds: number) => ffmpegFile(`flac-${seconds}.flac`, ['-f', 'lavfi', '-i', `sine=f=220:d=${seconds}:r=48000,volume=0.01`, '-ac', '2', '-c:a', 'flac']),
  /** A 5.1 Opus in WebM (v16.5 final: its head's track says 6 channels; the sniff reads it there). */
  opus51: (seconds: number) => ffmpegFile(`opus51-${seconds}.webm`, ['-f', 'lavfi', '-i', `sine=f=440:d=${seconds}:r=48000`, '-af', 'aformat=channel_layouts=5.1', '-c:a', 'libopus', '-b:a', '192k']),
  // ---- v16.5 final fixes
  /** ADTS AAC, `loudS` of pink noise then a quiet tone, VBR (-q:a 2) or ABR (128k): FFmpeg's (Chrome's) estimate from
   *  the first frames' bit rate is a fraction of its length (the final review's vbr-adts-300 / abr-adts-300). */
  adtsVbr: (seconds: number, loudS = 10) =>
    ffmpegFile(`adts-vbr-${seconds}.aac`, ['-f', 'lavfi', '-i', `anoisesrc=d=${loudS}:c=pink:a=0.5:r=44100`, '-f', 'lavfi', '-i', `sine=f=220:d=${seconds - loudS}:r=44100,volume=0.01`, '-filter_complex', '[0][1]concat=n=2:v=0:a=1,aformat=channel_layouts=stereo', '-c:a', 'aac', '-q:a', '2', '-f', 'adts']),
  adtsAbr: (seconds: number, loudS = 10) =>
    ffmpegFile(`adts-abr-${seconds}.aac`, ['-f', 'lavfi', '-i', `anoisesrc=d=${loudS}:c=pink:a=0.5:r=44100`, '-f', 'lavfi', '-i', `sine=f=220:d=${seconds - loudS}:r=44100,volume=0.01`, '-filter_complex', '[0][1]concat=n=2:v=0:a=1,aformat=channel_layouts=stereo', '-c:a', 'aac', '-b:a', '128k', '-f', 'adts']),
  /** MPEG-1 layer II named .mp3 (no layer III frames for the walk to find). */
  mp2: (seconds: number) => ffmpegFile(`l2-${seconds}.mp3`, ['-f', 'lavfi', '-i', `sine=f=440:d=${seconds}:r=44100`, '-ac', '2', '-c:a', 'mp2', '-b:a', '192k', '-f', 'mp2']),
  /** A WAV whose payload is MP3 (format 0x55): its data chunk walked as an MP3. */
  wavMp3: (seconds: number) => ffmpegFile(`mp3in-${seconds}.wav`, ['-f', 'lavfi', '-i', `sine=f=440:d=${seconds}:r=44100`, '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'wav']),
  /** An Opus WebM without a Duration (as a live recording is written): no length in its head. */
  webmLive: (seconds: number) => ffmpegFile(`opus-live-${seconds}.webm`, ['-f', 'lavfi', '-i', `sine=f=440:d=${seconds}:r=48000`, '-ac', '2', '-c:a', 'libopus', '-b:a', '96k', '-live', '1', '-f', 'webm']),
  /** A fragmented M4A (its mdhd states no length; the fragments do). */
  fragM4a: (seconds: number) => ffmpegFile(`aac-frag-${seconds}.m4a`, ['-f', 'lavfi', '-i', `sine=f=440:d=${seconds}:r=44100`, '-ac', '2', '-c:a', 'aac', '-b:a', '128k', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4']),
  /** 5.1 AAC as ADTS with a program config element (channel_configuration 0: its header doesn't say 6 channels, so
   *  only the decode does; its length is its frames'). */
  pce51: (seconds: number) => ffmpegFile(`aac-pce51-${seconds}.aac`, ['-f', 'lavfi', '-i', `sine=f=440:d=${seconds}:r=48000`, '-af', 'aformat=channel_layouts=5.1', '-c:a', 'aac', '-aac_pce', '1', '-b:a', '256k', '-f', 'adts']),
  /** A µ-law WAV (G.711: its length from its data). */
  ulawWav: (seconds: number) => ffmpegFile(`ulaw-${seconds}.wav`, ['-f', 'lavfi', '-i', `sine=f=440:d=${seconds}:r=8000`, '-c:a', 'pcm_mulaw']),
  /** A 320 kbps CBR MP3 without a Xing header (its size bound is its length). */
  cbr320: (seconds: number) => ffmpegFile(`cbr320-${seconds}.mp3`, ['-f', 'lavfi', '-i', `anoisesrc=d=${seconds}:c=pink:a=0.3:r=44100`, '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '320k', '-write_xing', '0']),
  /** Ogg Opus and Vorbis (their lengths from their pages). */
  oggOpus: (seconds: number) => ffmpegFile(`opus-${seconds}.ogg`, ['-f', 'lavfi', '-i', `sine=f=440:d=${seconds}:r=48000`, '-ac', '2', '-c:a', 'libopus', '-b:a', '96k']),
  oggVorbis: (seconds: number) => ffmpegFile(`vorbis-${seconds}.ogg`, ['-f', 'lavfi', '-i', `sine=f=440:d=${seconds}:r=44100`, '-ac', '2', '-c:a', 'libvorbis', '-q:a', '4']),
  // ---- v16.5 export memory
  /** AAC-LC in Matroska (.mka: CodecID A_AAC), the review's mka40.mka made again. */
  mka: (seconds: number) => ffmpegFile(`aac-${seconds}.mka`, ['-f', 'lavfi', '-i', `sine=f=440:d=${seconds}:r=44100`, '-ac', '2', '-c:a', 'aac', '-b:a', '128k', '-f', 'matroska']),
  /** A 64 kbps CBR MP3 of a tone (the review's short file whose cover art is in a trailing tag). */
  cbr64: (seconds: number) => ffmpegFile(`cbr64-${seconds}.mp3`, ['-f', 'lavfi', '-i', `sine=f=440:d=${seconds}:r=44100`, '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '64k']),
};

/** Where an MP3's frames start (layer III, a simple header walk past a leading ID3v2 tag: the test files are clean). */
function mp3FrameStarts(b: Buffer): number[] {
  const out: number[] = [];
  const KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const RATES = [44_100, 48_000, 32_000];
  let o = b.toString('latin1', 0, 3) === 'ID3' ? 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)) : 0;
  while (o + 4 <= b.length) {
    const bi = b[o + 2] >> 4;
    const ri = (b[o + 2] >> 2) & 3;
    if (b[o] !== 0xff || (b[o + 1] & 0xfe) !== 0xfa || bi === 0 || bi === 15 || ri === 3) {
      o++;
      continue;
    }
    out.push(o);
    o += Math.floor((144 * KBPS[bi] * 1000) / RATES[ri]) + ((b[o + 2] >> 1) & 1);
  }
  return out;
}

/** v16.5 final (the final review's mid-id3-bogus.mp3): an ID3v2 header whose size is bogus (0x7f7f7f7f: 256 MB) put in
 *  at the frame boundary nearest the middle (it made the frame walk skip the rest of the file). */
export function midId3Bogus(mp3: Buffer): Buffer {
  const cut = mp3FrameStarts(mp3).find((x) => x >= mp3.length / 2) as number;
  return Buffer.concat([mp3.subarray(0, cut), Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f]), mp3.subarray(cut)]);
}

/** v16.5 final (junk-after-tag-20k.mp3): a 10-byte ID3v2 tag, `n` bytes of junk (no 0xFF), then the file (it gave no
 *  frame walk: the first frame was looked for in the 16 KB after the tag only). */
export function junkAfterTag(mp3: Buffer, n = 20_000): Buffer {
  const junk = Buffer.alloc(n);
  for (let i = 0; i < n; i++) junk[i] = (i * 37 + 11) & 0x7f;
  return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 10]), Buffer.alloc(10), junk, mp3]);
}

// ---- v16.5 export memory: tags as taggers write them (a cover image's bytes: a JPEG's entropy data, each 0xFF
// followed by a 0x00), and a leading ID3v2 header whose size runs past the file.

function artBytes(n: number): Buffer {
  let x = 7;
  const o = Buffer.alloc(n);
  for (let k = 0; k < n; k++) {
    x = (x * 1103515245 + 12345) >>> 0;
    o[k] = k > 0 && o[k - 1] === 0xff ? 0 : x >>> 24;
  }
  return o;
}
const syncsafe = (n: number) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
const be32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const le32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

/** An ID3v2.3 tag: a TIT2 frame, an APIC frame of `art` bytes, 1 KB of padding. */
export function id3v2Tag(art: number): Buffer {
  const tit2Body = Buffer.concat([Buffer.from([3]), Buffer.from('Title')]);
  const apicBody = Buffer.concat([Buffer.from([0]), Buffer.from('image/jpeg\0', 'latin1'), Buffer.from([3, 0]), artBytes(art)]);
  const body = Buffer.concat([Buffer.from('TIT2'), be32(tit2Body.length), Buffer.from([0, 0]), tit2Body, Buffer.from('APIC'), be32(apicBody.length), Buffer.from([0, 0]), apicBody, Buffer.alloc(1024)]);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(body.length), body]);
}

/** An APEv2 tag: its header, a Title item and a binary Cover Art (Front) item of `art` bytes, its footer. */
export function apeTag(art: number): Buffer {
  const item = (key: string, value: Buffer, flags: number) => Buffer.concat([le32(value.length), le32(flags), Buffer.from(key + '\0', 'latin1'), value]);
  const items = Buffer.concat([item('Title', Buffer.from('A title'), 0), item('Cover Art (Front)', Buffer.concat([Buffer.from('cover.jpg\0', 'latin1'), artBytes(art)]), 2)]);
  const hf = (header: boolean) => Buffer.concat([Buffer.from('APETAGEX'), le32(2000), le32(items.length + 32), le32(2), le32((0x8000_0000 | (header ? 0x2000_0000 : 0)) >>> 0), Buffer.alloc(8)]);
  return Buffer.concat([hf(true), items, hf(false)]);
}

/** A leading ID3v2 header whose size runs past the file (0x7f7f7f7f), then the file's frames. */
export function bogusLeadingTag(mp3: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f]), mp3.subarray(mp3FrameStarts(mp3)[0])]);
}

/** A FLAC's STREAMINFO total samples set to `samples` (a header that understates its length: B09b). */
export function understateFlac(b: Buffer, samples: number): Buffer {
  const out = Buffer.from(b);
  if (out.toString('latin1', 0, 4) !== 'fLaC') throw new Error('not a FLAC');
  // STREAMINFO's body starts at 8; its 36-bit sample count at 13 (low nibble) … 17.
  out[8 + 13] = out[8 + 13] & 0xf0;
  out.writeUInt32BE(samples >>> 0, 8 + 14);
  return out;
}
