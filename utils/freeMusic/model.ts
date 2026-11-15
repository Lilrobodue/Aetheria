// utils/freeMusic/model.ts (v16.13, "Aetheria's 222"; review page aeb068c3, the user's answers of 15 Nov 2026)
//
// Aetheria's own music, free: 222 tracks (85 instrumentals, 137 songs, OGG Opus 128 kbps) on their own GitHub Pages
// site (decision 1 A), that a listener adds to their library (2 A) as a group or one by one (3 A). The app ships the
// track list (aetheria222.json): each track's fixed id, title, length, size and the Deep Scan reading the app itself
// made of that very file (4 A, desktop Chrome, DEEP_SCAN_RATE: the crystal any device would read), its key, and the
// name of its envelope file beside the audio. The download is App's (addFreeMusic): it fetches only when a listener
// taps Add, from MUSIC_BASE alone, and the service worker never stores those requests (public/sw.js, v16.13).
// Pure: the list's check, the groups and what is missing from a library, the envelope file's reader, the Song fields,
// and every word the panel, the classic block and the toasts say.

import type { BandEnvelope, Song } from '../../types';

/** The music site (decision 1 A): its own Pages site in the Big Banana Studios organisation. */
export const MUSIC_ORIGIN = 'https://big-banana-studios.github.io';
export const MUSIC_BASE = `${MUSIC_ORIGIN}/aetheria-music/`;
/** Every free track's id starts so (`aetheria-<slug>`): fixed, so a track already added is never added twice. */
export const FREE_ID_PREFIX = 'aetheria-';
const ID_RE = /^aetheria-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILE_RE = /^tracks\/[a-z0-9]+(?:-[a-z0-9]+)*\.ogg$/;
const ENV_RE = /^tracks\/[a-z0-9]+(?:-[a-z0-9]+)*\.env$/;
const KEY_RE = /^(?:[A-G]#?m?)?$/;

export type FreeKind = 'instrumental' | 'song';
export type FreeGroup = 'all' | FreeKind;
export const GROUPS: readonly FreeGroup[] = ['all', 'instrumental', 'song'];

/** One track of the list, as the app ships it. */
export interface FreeTrack {
  id: string;
  title: string;
  /** Its path under MUSIC_BASE. */
  file: string;
  kind: FreeKind;
  /** Seconds. */
  duration: number;
  /** Bytes: the download must be exactly this long. */
  size: number;
  harmonicFreq: number;
  closestSolfeggio: number;
  harmonicDeviation: number;
  scanRate: number;
  isAetheriaCandidate?: boolean;
  fractalAnalysis?: Song['fractalAnalysis'];
  intervalAnalysis?: Song['intervalAnalysis'];
  chroma?: number[];
  chromaA4Hz?: number;
  musicKey?: string;
  keyConfidence?: number;
  chromaVersion?: number;
  /** Its envelope file under MUSIC_BASE (Deep Scan's band envelope), if it has one. */
  env?: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The list as shipped, checked row by row: a row that doesn't hold together is left out (never half-used), and an id
 *  or a file seen before is left out too. The order is the list's. */
export function parseFreeList(raw: unknown): FreeTrack[] {
  const rows = isObj(raw) && Array.isArray(raw.tracks) ? raw.tracks : [];
  const out: FreeTrack[] = [];
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const r of rows) {
    if (!isObj(r)) continue;
    const { id, title, file, kind, duration, size, harmonicFreq, closestSolfeggio, harmonicDeviation, scanRate } = r;
    if (typeof id !== 'string' || !ID_RE.test(id) || id.length > 120 || ids.has(id)) continue;
    if (typeof title !== 'string' || !title.trim() || title.length > 120) continue;
    if (typeof file !== 'string' || !FILE_RE.test(file) || files.has(file)) continue;
    if (kind !== 'instrumental' && kind !== 'song') continue;
    if (!isNum(duration) || duration <= 0 || !isNum(size) || size <= 0 || !Number.isInteger(size)) continue;
    if (!isNum(harmonicFreq) || harmonicFreq <= 0 || !isNum(closestSolfeggio) || closestSolfeggio <= 0) continue;
    if (!isNum(harmonicDeviation) || harmonicDeviation < 0 || !isNum(scanRate) || scanRate <= 0) continue;
    const t: FreeTrack = { id, title: title.trim(), file, kind, duration, size, harmonicFreq, closestSolfeggio, harmonicDeviation, scanRate };
    if (typeof r.isAetheriaCandidate === 'boolean') t.isAetheriaCandidate = r.isAetheriaCandidate;
    if (isObj(r.fractalAnalysis)) t.fractalAnalysis = r.fractalAnalysis as unknown as Song['fractalAnalysis'];
    if (isObj(r.intervalAnalysis)) t.intervalAnalysis = r.intervalAnalysis as unknown as Song['intervalAnalysis'];
    // The key fields come together or not at all (as playlistCache's keyFieldsOf restores them).
    const c = r.chroma;
    if (
      Array.isArray(c) && c.length === 12 && c.every(isNum) && isNum(r.chromaA4Hz) && typeof r.musicKey === 'string' &&
      KEY_RE.test(r.musicKey) && isNum(r.keyConfidence) && isNum(r.chromaVersion)
    ) {
      t.chroma = [...c];
      t.chromaA4Hz = r.chromaA4Hz;
      t.musicKey = r.musicKey;
      t.keyConfidence = r.keyConfidence;
      t.chromaVersion = r.chromaVersion;
    }
    if (typeof r.env === 'string' && ENV_RE.test(r.env)) t.env = r.env;
    ids.add(id);
    files.add(file);
    out.push(t);
  }
  return out;
}

export const inGroup = (t: FreeTrack, g: FreeGroup): boolean => g === 'all' || t.kind === g;

/** The group's tracks the library doesn't have yet (by id), in the list's order. */
export function missingOf(list: readonly FreeTrack[], g: FreeGroup, has: (id: string) => boolean): FreeTrack[] {
  return list.filter((t) => inGroup(t, g) && !has(t.id));
}

export interface GroupView {
  group: FreeGroup;
  count: number;
  bytes: number;
  seconds: number;
  missing: number;
  missingBytes: number;
}

export function groupViews(list: readonly FreeTrack[], has: (id: string) => boolean): Record<FreeGroup, GroupView> {
  const v = {} as Record<FreeGroup, GroupView>;
  for (const g of GROUPS) v[g] = { group: g, count: 0, bytes: 0, seconds: 0, missing: 0, missingBytes: 0 };
  for (const t of list) {
    for (const g of GROUPS) {
      if (!inGroup(t, g)) continue;
      const x = v[g];
      x.count++;
      x.bytes += t.size;
      x.seconds += t.duration;
      if (!has(t.id)) {
        x.missing++;
        x.missingBytes += t.size;
      }
    }
  }
  return v;
}

export const audioUrl = (t: FreeTrack, base: string = MUSIC_BASE): string => base + t.file;
export const envUrl = (t: FreeTrack, base: string = MUSIC_BASE): string | null => (t.env ? base + t.env : null);

/** True for a request the free music makes (the service worker passes these by; tests' routes match them). */
export const isMusicUrl = (url: string): boolean => url.startsWith(MUSIC_BASE);

/** An envelope file: "AEV1", the frames per second (uint16, little-endian), then the four bands (sub, bass, mid, high),
 *  each a uint32 length and that many bytes. null for anything else (the track then simply has no envelope). */
export function parseEnvelope(buf: ArrayBuffer): BandEnvelope | null {
  try {
    const dv = new DataView(buf);
    if (buf.byteLength < 6 + 16) return null;
    if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'AEV1') return null;
    const fps = dv.getUint16(4, true);
    if (fps < 1 || fps > 200) return null;
    let at = 6;
    const bands: Uint8Array[] = [];
    for (let b = 0; b < 4; b++) {
      if (at + 4 > buf.byteLength) return null;
      const n = dv.getUint32(at, true);
      at += 4;
      if (n < 1 || at + n > buf.byteLength) return null;
      bands.push(new Uint8Array(buf.slice(at, at + n)));
      at += n;
    }
    if (at !== buf.byteLength) return null;
    return { fps, sub: bands[0], bass: bands[1], mid: bands[2], high: bands[3] };
  } catch {
    return null;
  }
}

/** The envelope file's bytes for a band envelope (the build script's writer, and the checks'). */
export function envelopeBytes(e: BandEnvelope): Uint8Array {
  const parts = [e.sub, e.bass, e.mid, e.high];
  const out = new Uint8Array(6 + parts.reduce((n, p) => n + 4 + p.length, 0));
  const dv = new DataView(out.buffer);
  out.set([65, 69, 86, 49], 0); // "AEV1"
  dv.setUint16(4, e.fps, true);
  let at = 6;
  for (const p of parts) {
    dv.setUint32(at, p.length, true);
    at += 4;
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The library track for a downloaded free track: its fixed id, its title as the name, its length, and the reading the
 *  list carries (crystalSource 'scan' at scanRate: Deep Scan's queue and Scan again both leave it alone), with its key
 *  and its envelope when there are any. The file is named after the title (its playlist entries' fingerprint). */
export function songOf(t: FreeTrack, file: File, bandEnvelope: BandEnvelope | null): Song {
  const s: Song = {
    file,
    id: t.id,
    name: t.title,
    duration: t.duration,
    harmonicFreq: t.harmonicFreq,
    closestSolfeggio: t.closestSolfeggio,
    harmonicDeviation: t.harmonicDeviation,
    crystalSource: 'scan',
    scanRate: t.scanRate,
  };
  if (t.isAetheriaCandidate !== undefined) s.isAetheriaCandidate = t.isAetheriaCandidate;
  if (t.fractalAnalysis) s.fractalAnalysis = t.fractalAnalysis;
  if (t.intervalAnalysis) s.intervalAnalysis = t.intervalAnalysis;
  if (t.chroma) {
    s.chroma = [...t.chroma];
    s.chromaA4Hz = t.chromaA4Hz;
    s.musicKey = t.musicKey;
    s.keyConfidence = t.keyConfidence;
    s.chromaVersion = t.chromaVersion;
  }
  if (bandEnvelope) s.bandEnvelope = bandEnvelope;
  return s;
}

/** The audio file's name in the library: the title, safe as a file name, ".ogg". */
export function fileNameOf(t: FreeTrack): string {
  const safe = t.title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'Track';
  return `${safe}.ogg`;
}

// ---- What a download is doing (App's state; the panel and classic's block read it) ----

export type FreeAddWhat = FreeGroup | 'one';
/** Why an add failed (review round 1, U8): the connection (a fetch that never answered), the site (an error status or
 *  a file of the wrong size: the same on every retry until the site is fixed), or this device (a save of the audio
 *  that failed, or a download it couldn't hold). */
export type FreeFailReason = 'network' | 'file' | 'save';
export interface FreeMusicStatus {
  phase: 'idle' | 'adding' | 'done' | 'stopped' | 'failed';
  /** What the running or last add was for (a group, or one track by id in `one`). */
  what: FreeAddWhat | null;
  one: string | null;
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  /** The playlists the last add filled (decision 7 A), for its end line. */
  lists: FreeKind[];
  /** A failed add's reason, and for 'file' the track the site couldn't send. */
  reason: FreeFailReason | null;
  failedTitle: string | null;
  /** A new number for each add's end (its line's key: read once); an add's start keeps the last one. */
  id: number;
}
export const IDLE_STATUS: FreeMusicStatus = { phase: 'idle', what: null, one: null, done: 0, total: 0, bytesDone: 0, bytesTotal: 0, lists: [], reason: null, failedTitle: null, id: 0 };

// ---- Words (v16.6's plain style) ----

export const mb = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1e6)).toLocaleString('en-US')} MB`;
export const hours = (seconds: number): string => `${(seconds / 3600).toFixed(1)} h`;
/** m:ss, the seconds rounded down as the Library's own lengths are (shellModel formatTime): 239.8 s is 3:59, never
 *  "3:60" (review round 1, U7). */
export const length = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const tracks = (n: number) => `${n.toLocaleString('en-US')} track${n === 1 ? '' : 's'}`;

/** Decision 7 A: what adding makes, by kind. */
export const PLAYLIST_NAMES: Record<FreeKind, string> = { instrumental: 'Aetheria · Instrumentals', song: 'Aetheria · Songs' };

export const words = {
  /** The Import sheet's third choice. */
  choiceTitle: "Aetheria's music",
  choiceSub: (n: number) => `${n.toLocaleString('en-US')} free tracks · download once, then play offline`,
  title: "Aetheria's music",
  subtitle: 'Free. Each track downloads once and is kept on this device.',
  back: 'Back to Import music',
  /** Decision 8 C (A's line, then the licence). */
  credit: 'Music by Aetheria · Big Banana Studios. Free to play in Aetheria.',
  licence: 'Shared under Creative Commons BY-NC 4.0: share it with credit, never sell it.',
  licenceLink: 'About the licence',
  licenceUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
  from: 'Downloads come from big-banana-studios.github.io.',
  groupName: (g: FreeGroup, n: number) => (g === 'all' ? `All ${n.toLocaleString('en-US')} tracks` : g === 'instrumental' ? 'Instrumentals' : 'Songs'),
  groupLine: (v: GroupView) =>
    v.missing === 0
      ? `${tracks(v.count)} · in your library`
      : v.missing === v.count
        ? `${tracks(v.count)} · ${mb(v.bytes)} · ${hours(v.seconds)}`
        : `${v.missing.toLocaleString('en-US')} more ${v.missing === 1 ? 'track' : 'tracks'} · ${mb(v.missingBytes)}`,
  add: 'Add',
  added: 'Added',
  adding: 'Adding…',
  // A button's accessible name always holds its visible text (review round 1, U3: WCAG 2.5.3 label in name), so
  // "Add…", "Adding… …", "Added: …".
  /** A group's Add, read out: "Add all 222 tracks", "Add the 85 instrumentals", "Add the other 2 songs", "Add the
   *  other song". */
  groupAddLabel: (g: FreeGroup, v: GroupView) => {
    const noun = (n: number) => (g === 'all' ? 'track' : g === 'instrumental' ? 'instrumental' : 'song') + (n === 1 ? '' : 's');
    if (v.missing === v.count) return g === 'all' ? `Add all ${tracks(v.count)}` : `Add the ${v.count.toLocaleString('en-US')} ${noun(v.count)}`;
    return v.missing === 1 ? `Add the other ${noun(1)}` : `Add the other ${v.missing.toLocaleString('en-US')} ${noun(v.missing)}`;
  },
  groupBusyLabel: (g: FreeGroup, n: number) => `Adding… ${g === 'all' ? `all ${tracks(n)}` : g === 'instrumental' ? 'the instrumentals' : 'the songs'}`,
  groupDoneLabel: (g: FreeGroup, n: number) =>
    `Added: ${g === 'all' ? `all ${tracks(n)} are` : g === 'instrumental' ? 'the instrumentals are' : 'the songs are'} in your library`,
  choose: 'Choose tracks',
  chooseHide: 'Hide the list',
  kindName: (k: FreeKind) => (k === 'instrumental' ? 'Instrumental' : 'Song'),
  rowLine: (t: FreeTrack) => `${t.kind === 'instrumental' ? 'Instrumental' : 'Song'} · ${length(t.duration)} · ${(t.size / 1e6).toFixed(1)} MB`,
  rowAddLabel: (t: FreeTrack) => `Add ${t.title}`,
  rowBusyLabel: (t: FreeTrack) => `Adding… ${t.title}`,
  rowAddedLabel: (t: FreeTrack) => `Added: ${t.title} is in your library`,
  stop: 'Stop adding',
  /** Read once as an add starts (the progress after it is not read out as it changes). */
  started: (n: number) => `Adding ${tracks(n)}.`,
  progress: (s: FreeMusicStatus) => `Adding ${s.done.toLocaleString('en-US')} of ${tracks(s.total)} · ${Math.round(s.bytesDone / 1e6).toLocaleString('en-US')} of ${mb(s.bytesTotal)}`,
  /** The end line of an add that finished. */
  done: (n: number, lists: readonly FreeKind[]) => {
    const head = `Added ${tracks(n)} to your library.`;
    if (lists.length === 0) return head;
    const names = lists.map((k) => `"${PLAYLIST_NAMES[k]}"`).join(' and ');
    return `${head} ${n === 1 ? "It's" : "They're"} in ${names} too.`;
  },
  /** Review round 1 (U8): one advice for the rest, "Adding again gets the rest", in both layouts (classic's buttons
   *  are named by group, not "Add"). */
  stopped: (done: number, total: number) => `Stopped after ${done.toLocaleString('en-US')} of ${tracks(total)}. Adding again gets the rest.`,
  failed: (done: number, total: number, reason: FreeFailReason | null, title: string | null) => {
    const of = `${done.toLocaleString('en-US')} of ${tracks(total)}`;
    if (reason === 'file') {
      const which = title ? `"${title}"` : 'a track';
      return done === 0 ? `The music site couldn't send ${which}. Try again later.` : `Stopped after ${of}: the music site couldn't send ${which}. Try again later for the rest.`;
    }
    if (reason === 'save') return `${of[0].toUpperCase()}${of.slice(1)} came in, but this device couldn't save them for offline use. Free some space, then add again.`;
    return done === 0 ? "Couldn't reach the music site. Check the connection, then try again." : `The connection dropped after ${of}. Adding again gets the rest.`;
  },
  notReady: 'Your library is still loading. Try again in a moment.',
  busy: "Aetheria's music is already being added. Wait for it to finish, or stop it first.",
  /** The empty Library's second offer. */
  emptyOffer: (n: number) => `Or start with Aetheria's ${n.toLocaleString('en-US')} free tracks`,
  /** Classic's block. */
  classicHead: "Aetheria's music",
  classicSub: (n: number, allIn: boolean) => (allIn ? `${n.toLocaleString('en-US')} free tracks · all in your library` : `${n.toLocaleString('en-US')} free tracks to add`),
  classicButton: (g: FreeGroup, n: number) => (g === 'all' ? `All ${n.toLocaleString('en-US')}` : g === 'instrumental' ? 'Instrumentals' : 'Songs'),
  /** Classic's buttons, read out with their visible name first: "Songs: add 137 tracks", "All 222: add the other 2
   *  tracks". */
  classicAddLabel: (g: FreeGroup, v: GroupView) =>
    `${g === 'all' ? `All ${v.count.toLocaleString('en-US')}` : g === 'instrumental' ? 'Instrumentals' : 'Songs'}: add ${v.missing === v.count ? tracks(v.missing) : `the other ${tracks(v.missing)}`}`,
  /** Classic's button for a group that's all in, read out with its visible name. */
  classicDoneLabel: (g: FreeGroup, n: number) => `${g === 'all' ? `All ${n.toLocaleString('en-US')}` : g === 'instrumental' ? 'Instrumentals' : 'Songs'}: all in your library`,
} as const;

/** The status's line: the progress while adding, the end line after (null when idle). */
export function statusLine(s: FreeMusicStatus): string | null {
  switch (s.phase) {
    case 'adding':
      return words.progress(s);
    case 'done':
      return words.done(s.done, s.lists);
    case 'stopped':
      return words.stopped(s.done, s.total);
    case 'failed':
      return words.failed(s.done, s.total, s.reason, s.failedTitle);
    default:
      return null;
  }
}
