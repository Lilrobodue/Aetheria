// utils/freeMusic/model.check.ts (v16.13, "Aetheria's 222"): the checks for model.ts, the shipped list and the worker.
//   node utils/freeMusic/model.check.ts   (npm run check:freemusic; Node 22.18+ strips the types)
// Sections: 1 the list's check, 2 groups and what's missing, 3 the envelope file, 4 the Song, 5 words, 6 the shipped
// list (aetheria222.json: the 222 as the user approved them, each with Deep Scan's own reading), 7 public/sw.js (the
// free music and audio never answered from, or put in, its cache).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  MUSIC_BASE, parseFreeList, missingOf, groupViews, parseEnvelope, envelopeBytes, songOf, fileNameOf, isMusicUrl, audioUrl, envUrl,
  words, statusLine, IDLE_STATUS, PLAYLIST_NAMES, length,
} from './model.ts';
import type { FreeTrack, FreeMusicStatus } from './model.ts';
import { GUT_CRYSTALS, HEART_CRYSTALS, HEAD_CRYSTALS } from '../crystalData.ts';
import { DEEP_SCAN_RATE, crystalOrigin, needsDeepScan, needsRescan } from '../mix/distribution.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c: boolean, msg: string) => { if (c) pass++; else { fail++; if (fail <= 40) console.log('FAIL', msg); } };
const eq = (a: unknown, b: unknown, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const row = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'aetheria-neon-ronin', title: 'Neon Ronin', file: 'tracks/neon-ronin.ogg', kind: 'instrumental', duration: 104.56, size: 1_700_000,
  harmonicFreq: 1449.2, closestSolfeggio: 1449, harmonicDeviation: 0.2, scanRate: 48000, isAetheriaCandidate: true,
  chroma: [0.1, 0.05, 0.1, 0.05, 0.1, 0.1, 0.05, 0.1, 0.05, 0.1, 0.1, 0.1], chromaA4Hz: 440.12, musicKey: 'Am', keyConfidence: 0.71, chromaVersion: 1,
  env: 'tracks/neon-ronin.env', ...o,
});

// ---- 1. The list's check ----
{
  const good = parseFreeList({ tracks: [row()] });
  eq(good.length, 1, 'a good row is kept');
  eq(good[0].musicKey, 'Am', 'with its key');
  eq(good[0].env, 'tracks/neon-ronin.env', 'and its envelope file');
  const bad = [
    { id: 'neon-ronin' }, { id: 'aetheria-Neon' }, { id: 'aetheria-' }, { title: '' }, { title: '   ' }, { title: 'x'.repeat(121) },
    { file: 'neon-ronin.ogg' }, { file: 'tracks/../x.ogg' }, { file: 'tracks/neon ronin.ogg' }, { file: 'https://x/tracks/a.ogg' },
    { kind: 'vocal' }, { duration: 0 }, { duration: NaN }, { size: 1.5 }, { size: -3 }, { harmonicFreq: 0 }, { closestSolfeggio: null },
    { harmonicDeviation: -1 }, { scanRate: undefined },
  ];
  for (const b of bad) eq(parseFreeList({ tracks: [row(b)] }).length, 0, `a row with ${JSON.stringify(b).slice(0, 40)} is left out`);
  eq(parseFreeList({ tracks: [row(), row({ file: 'tracks/b.ogg' })] }).length, 1, 'an id seen before is left out');
  eq(parseFreeList({ tracks: [row(), row({ id: 'aetheria-b' })] }).length, 1, 'a file seen before is left out');
  eq(parseFreeList(null).length + parseFreeList({}).length + parseFreeList({ tracks: 'x' }).length + parseFreeList([row()]).length, 0, 'no list, no tracks');
  const partKey = parseFreeList({ tracks: [row({ musicKey: 'H' })] })[0];
  ok(partKey && partKey.chroma === undefined && partKey.musicKey === undefined && partKey.chromaVersion === undefined, 'a key that does not hold together comes in whole or not at all');
  const shortChroma = parseFreeList({ tracks: [row({ chroma: [0.5, 0.5] })] })[0];
  ok(shortChroma && shortChroma.chroma === undefined, 'a chroma of fewer than 12 is no key');
  const noEnv = parseFreeList({ tracks: [row({ env: 'tracks/neon-ronin.ogg' })] })[0];
  ok(noEnv && noEnv.env === undefined, 'an envelope path that is not a .env file is dropped (the track stays)');
  eq(parseFreeList({ tracks: [row({ title: '  Neon Ronin ' })] })[0].title, 'Neon Ronin', 'the title is trimmed');
  eq(parseFreeList({ tracks: [row({ fractalAnalysis: [1] })] })[0].fractalAnalysis, undefined, 'a fractal analysis that is not an object is dropped');
}

// ---- 2. Groups and what's missing ----
const LIST: FreeTrack[] = parseFreeList({
  tracks: [
    row({ id: 'aetheria-a', file: 'tracks/a.ogg', kind: 'instrumental', size: 1_000_000, duration: 100 }),
    row({ id: 'aetheria-b', file: 'tracks/b.ogg', kind: 'song', size: 2_000_000, duration: 200 }),
    row({ id: 'aetheria-c', file: 'tracks/c.ogg', kind: 'song', size: 3_000_000, duration: 300 }),
  ],
});
{
  eq(LIST.length, 3, 'the test list');
  const none = (_: string) => false;
  const hasB = (id: string) => id === 'aetheria-b';
  eq(missingOf(LIST, 'all', none).map((t) => t.id), ['aetheria-a', 'aetheria-b', 'aetheria-c'], 'all missing, in the list order');
  eq(missingOf(LIST, 'song', hasB).map((t) => t.id), ['aetheria-c'], 'songs: only the one not there');
  eq(missingOf(LIST, 'instrumental', hasB).map((t) => t.id), ['aetheria-a'], 'instrumentals');
  const v = groupViews(LIST, hasB);
  eq([v.all.count, v.all.missing, v.all.bytes, v.all.missingBytes, v.all.seconds], [3, 2, 6_000_000, 4_000_000, 600], 'all: counts, bytes, seconds');
  eq([v.song.count, v.song.missing, v.instrumental.count, v.instrumental.missing], [2, 1, 1, 1], 'by kind');
  eq(words.groupLine(v.all), '2 more tracks · 4 MB', 'a group partly there: what is left');
  eq(words.groupLine(groupViews(LIST, none).song), '2 tracks · 5 MB · 0.1 h', 'a group not there: all of it');
  eq(words.groupLine(groupViews(LIST, () => true).all), '3 tracks · in your library', 'a group all there');
  eq(words.groupLine(groupViews(LIST, (id) => id !== 'aetheria-c').all), '1 more track · 3 MB', 'one more: singular');
  eq(words.groupAddLabel('all', groupViews(LIST, none).all), 'Add all 3 tracks', "All's button, read out");
  eq(words.groupAddLabel('song', v.song), 'Add the other song', "Songs' button, one left");
  eq(words.groupAddLabel('all', v.all), 'Add the other 2 tracks', "All's button, partly there");
  eq(words.groupAddLabel('song', groupViews(LIST, none).song), 'Add the 2 songs', "Songs' button, none there");
  eq(words.groupAddLabel('instrumental', groupViews(LIST, none).instrumental), 'Add the 1 instrumental', 'one instrumental');
  eq(words.groupDoneLabel('instrumental', 1), 'Added: the instrumentals are in your library', 'a group all there, read out (holds "Added")');
  eq(words.groupDoneLabel('all', 222), 'Added: all 222 tracks are in your library', 'All, all there');
  eq(words.groupBusyLabel('song', 3), 'Adding… the songs', 'a group being added, read out (holds "Adding…")');
  eq(words.classicDoneLabel('all', 222), 'All 222: all in your library', "classic's All, all there (holds its visible name)");
  eq([words.classicSub(222, false), words.classicSub(222, true)], ['222 free tracks to add', '222 free tracks · all in your library'], "classic's sub-line");
  // Review round 1 U3: each name holds its button's visible text (WCAG 2.5.3), case aside.
  const holds = (name: string, visible: string) => name.toLowerCase().includes(visible.toLowerCase());
  ok(holds(words.groupAddLabel('all', v.all), words.add) && holds(words.groupBusyLabel('all', 3), words.adding) && holds(words.groupDoneLabel('all', 3), words.added), 'the panel group names hold Add / Adding… / Added');
  ok(holds(words.rowAddLabel(LIST[0]), words.add) && holds(words.rowBusyLabel(LIST[0]), words.adding) && holds(words.rowAddedLabel(LIST[0]), words.added), 'the row names too');
  for (const has of [none, hasB, (id: string) => id !== 'aetheria-a']) {
    const gv = groupViews(LIST, has);
    for (const g of ['all', 'instrumental', 'song'] as const) {
      ok(holds(words.classicAddLabel(g, gv[g]), words.classicButton(g, gv[g].count)), `classic's ${g} name holds its text (${words.classicAddLabel(g, gv[g])})`);
      ok(holds(words.classicDoneLabel(g, gv[g].count), words.classicButton(g, gv[g].count)), `classic's ${g} done name holds its text`);
    }
  }
  eq([words.classicAddLabel('song', groupViews(LIST, none).song), words.classicAddLabel('all', v.all)], ['Songs: add 2 tracks', 'All 3: add the other 2 tracks'], "classic's names");
}

// ---- 3. The envelope file ----
{
  const env = { fps: 20, sub: new Uint8Array([1, 2, 3]), bass: new Uint8Array([4, 5, 6]), mid: new Uint8Array([7, 8, 9]), high: new Uint8Array([10, 11, 12]) };
  const bytes = envelopeBytes(env);
  eq(bytes.length, 6 + 4 * (4 + 3), 'the file is the header and four bands');
  const back = parseEnvelope(bytes.buffer.slice(0));
  ok(!!back && back.fps === 20 && [...back.sub].join() === '1,2,3' && [...back.high].join() === '10,11,12', 'it reads back as written');
  ok(!!back && back.sub instanceof Uint8Array && back.mid instanceof Uint8Array, 'as Uint8Arrays (the meta store keeps them so)');
  const wrong = new Uint8Array(bytes); wrong[0] = 66;
  eq(parseEnvelope(wrong.buffer), null, 'another magic: none');
  eq(parseEnvelope(bytes.buffer.slice(0, bytes.length - 1)), null, 'cut short: none');
  const longer = new Uint8Array(bytes.length + 1); longer.set(bytes);
  eq(parseEnvelope(longer.buffer), null, 'bytes after the last band: none');
  eq(parseEnvelope(new ArrayBuffer(3)), null, 'too short for a header: none');
  const zeroFps = new Uint8Array(bytes); zeroFps[4] = 0; zeroFps[5] = 0;
  eq(parseEnvelope(zeroFps.buffer), null, 'no frames per second: none');
}

// ---- 4. The Song ----
{
  const t = LIST[0];
  const f = { name: 'Neon Ronin.ogg', size: 1_000_000 } as unknown as File;
  const s = songOf(t, f, null);
  eq([s.id, s.name, s.duration, s.crystalSource, s.scanRate, s.closestSolfeggio], ['aetheria-a', 'Neon Ronin', 100, 'scan', 48000, 1449], 'id, name, length, and the reading as Deep Scan wrote it');
  ok(s.file === f, 'the downloaded file');
  ok(s.chroma !== t.chroma && JSON.stringify(s.chroma) === JSON.stringify(t.chroma), 'the chroma is a copy (a plain Array)');
  ok(Array.isArray(s.chroma), 'chroma is a plain Array (v15.2 key fit needs Array.isArray)');
  ok(!('bandEnvelope' in s), 'no envelope when the file had none');
  const env = { fps: 20, sub: new Uint8Array(1), bass: new Uint8Array(1), mid: new Uint8Array(1), high: new Uint8Array(1) };
  ok(songOf(t, f, env).bandEnvelope === env, 'with the envelope when there is one');
  const bare = songOf(parseFreeList({ tracks: [row({ chroma: undefined })] })[0], f, null);
  ok(!('chroma' in bare) && !('musicKey' in bare), 'no key fields when the list has no key');
  eq(fileNameOf({ ...t, title: "Outcasts' Lament: A Struggle for Sanity" }), "Outcasts' Lament A Struggle for Sanity.ogg", 'a file name without the characters a file name cannot hold');
  eq(fileNameOf({ ...t, title: 'What? / Why*' }), 'What Why.ogg', 'more of them');
  eq(audioUrl(t), MUSIC_BASE + 'tracks/a.ogg', 'the audio address');
  eq(envUrl(t), MUSIC_BASE + 'tracks/neon-ronin.env', 'the envelope address');
  eq(envUrl({ ...t, env: undefined }), null, 'no envelope address without one');
  ok(isMusicUrl(audioUrl(t)) && !isMusicUrl('https://big-banana-studios.github.io/aetheria-reader/x.ogg') && !isMusicUrl('https://aetheria432.com/tracks/a.ogg'), 'only the music site is the music');
}

// ---- 5. Words ----
{
  const s = (o: Partial<FreeMusicStatus>): FreeMusicStatus => ({ ...IDLE_STATUS, ...o });
  eq(statusLine(IDLE_STATUS), null, 'idle: no line');
  eq(statusLine(s({ phase: 'adding', done: 31, total: 85, bytesDone: 114_400_000, bytesTotal: 314_000_000 })), 'Adding 31 of 85 tracks · 114 of 314 MB', 'progress');
  eq(statusLine(s({ phase: 'done', done: 85, total: 85, lists: ['instrumental'] })), 'Added 85 tracks to your library. They\'re in "Aetheria · Instrumentals" too.', 'done, one playlist');
  eq(statusLine(s({ phase: 'done', done: 222, total: 222, lists: ['instrumental', 'song'] })), 'Added 222 tracks to your library. They\'re in "Aetheria · Instrumentals" and "Aetheria · Songs" too.', 'done, both');
  eq(statusLine(s({ phase: 'done', done: 1, total: 1, lists: ['song'] })), 'Added 1 track to your library. It\'s in "Aetheria · Songs" too.', 'done, one track');
  eq(statusLine(s({ phase: 'done', done: 2, total: 2, lists: [] })), 'Added 2 tracks to your library.', 'done, no playlist');
  eq(statusLine(s({ phase: 'stopped', done: 3, total: 85 })), 'Stopped after 3 of 85 tracks. Adding again gets the rest.', 'stopped');
  // Review round 1 U8: the failure says why, and gives the advice that fits.
  eq(statusLine(s({ phase: 'failed', done: 0, total: 85, reason: 'network' })), "Couldn't reach the music site. Check the connection, then try again.", 'failed: no connection, nothing in');
  eq(statusLine(s({ phase: 'failed', done: 31, total: 85, reason: 'network' })), 'The connection dropped after 31 of 85 tracks. Adding again gets the rest.', 'failed: the connection dropped');
  eq(statusLine(s({ phase: 'failed', done: 0, total: 2, reason: 'file', failedTitle: 'Test Glow' })), 'The music site couldn\'t send "Test Glow". Try again later.', 'failed: the site, nothing in');
  eq(statusLine(s({ phase: 'failed', done: 1, total: 3, reason: 'file', failedTitle: 'Test Lantern: Night' })), 'Stopped after 1 of 3 tracks: the music site couldn\'t send "Test Lantern: Night". Try again later for the rest.', 'failed: the site, some in');
  eq(statusLine(s({ phase: 'failed', done: 4, total: 5, reason: 'save' })), "4 of 5 tracks came in, but this device couldn't save them for offline use. Free some space, then add again.", 'failed: the device');
  eq(statusLine(s({ phase: 'failed', done: 2, total: 2, reason: 'save' })), "2 of 2 tracks came in, but this device couldn't save them for offline use. Free some space, then add again.", 'failed: the device, all downloaded');
  eq(statusLine(s({ phase: 'failed', done: 0, total: 1, reason: null })), "Couldn't reach the music site. Check the connection, then try again.", 'failed with no reason reads as the connection');
  eq(words.started(85), 'Adding 85 tracks.', 'the start, read once');
  // Review round 1 U7: lengths round down, as the Library's do.
  eq([length(239.8), length(59.99), length(60), length(0), length(3600.4)], ['3:59', '0:59', '1:00', '0:00', '60:00'], 'm:ss rounds the seconds down');
  eq(Object.values(PLAYLIST_NAMES), ['Aetheria · Instrumentals', 'Aetheria · Songs'], "decision 7 A's names");
  eq(words.groupName('all', 222), 'All 222 tracks', 'the All row');
  ok(words.credit.includes('Big Banana Studios') && words.licence.includes('BY-NC 4.0'), 'decision 8 C: the credit, then the licence');
}

// ---- 6. The shipped list ----
{
  const raw = JSON.parse(readFileSync(join(HERE, 'aetheria222.json'), 'utf8'));
  const list = parseFreeList(raw);
  eq(raw.tracks.length, 222, 'the shipped list has 222 rows');
  eq(list.length, 222, 'and every one holds together');
  eq([list.filter((t) => t.kind === 'instrumental').length, list.filter((t) => t.kind === 'song').length], [85, 137], '85 instrumentals, 137 songs');
  const all = new Set([...GUT_CRYSTALS, ...HEART_CRYSTALS, ...HEAD_CRYSTALS]);
  eq(list.filter((t) => !all.has(t.closestSolfeggio)).map((t) => t.title), [], 'every crystal is one of the 27');
  eq(list.filter((t) => t.scanRate !== DEEP_SCAN_RATE).map((t) => t.title), [], 'every reading at DEEP_SCAN_RATE (v16.8.1: the same on every device)');
  // A failed read is Deep Scan's placeholder (deviation exactly 999, distribution.ts SCAN_FAILED_DEVIATION); a large
  // deviation alone is a harmonic match (1345 Hz on 2664), a real reading. The app's own crystalOrigin says which.
  eq(list.filter((t) => crystalOrigin({ ...t, crystalSource: 'scan' }) !== 'scan').map((t) => t.title), [], 'every reading is a scan, none failed (crystalOrigin)');
  eq(list.filter((t) => t.chromaVersion !== 1).map((t) => t.title), [], 'every track has its key (CHROMA_VERSION 1)');
  // As library tracks, Deep Scan's queue and Scan again leave them alone (decision 4 A: no scan on the phone).
  const songs = list.map((t) => songOf(t, { name: fileNameOf(t), size: t.size } as unknown as File, null));
  eq(songs.filter((s) => needsDeepScan(s)).map((s) => s.name), [], "none is in Deep Scan's queue");
  eq(songs.filter((s) => needsRescan(s)).map((s) => s.name), [], "none is offered to Scan again");
  eq(list.filter((t) => !t.env).map((t) => t.title), [], 'every track has its envelope file');
  const mbAll = list.reduce((n, t) => n + t.size, 0) / 1e6;
  ok(mbAll > 800 && mbAll < 900, `about 844 MB in all (${mbAll.toFixed(0)})`);
  eq(list.filter((t) => /Web Of Deceit/i.test(t.title)).length, 0, 'Web of Deceit is out (the review, 15 Nov)');
  ok(list.some((t) => t.title === 'Gotta Kill my Ego') && list.some((t) => t.title === 'Dark Horizons To The West') && list.some((t) => t.title === 'The Edge of Darkness'), "the user's picks are in");
  eq(list.filter((t) => /\b(MV|WV|FE|Mcv|Edit)\)?$/.test(t.title)).map((t) => t.title), [], 'decision 6 A: no version tags');
  const titles = list.map((t) => t.title.toLowerCase());
  eq(titles.filter((t, i) => titles.indexOf(t) !== i), [], 'no title twice');
  eq(list.filter((t) => fileNameOf(t) !== `${t.title}.ogg` && !/[\\/:*?"<>|]/.test(t.title)).map((t) => t.title), [], 'file names are the titles');
}

// ---- 7. public/sw.js ----
{
  const src = readFileSync(join(HERE, '..', '..', 'public', 'sw.js'), 'utf8');
  const handlers: Record<string, (e: any) => void> = {};
  const self: any = { location: { origin: 'https://aetheria432.com' }, addEventListener: (t: string, h: (e: any) => void) => { handlers[t] = h; }, skipWaiting: () => {}, clients: { claim: async () => {} } };
  const sandbox: any = {
    self, URL, console: { log() {}, warn() {}, error() {} }, setTimeout, Promise, Response: class {}, Request: class {},
    caches: { open: async () => ({ match: async () => undefined, put: async () => {} }), keys: async () => [], delete: async () => true },
    fetch: async () => ({ ok: true, clone() { return this; } }),
  };
  vm.runInNewContext(src, sandbox);
  ok(typeof handlers.fetch === 'function', 'the worker has a fetch handler');
  const answered = (url: string, mode = 'cors') => {
    let n = 0;
    handlers.fetch({ request: { url, method: 'GET', mode }, respondWith: () => { n++; } });
    return n > 0;
  };
  ok(!answered(MUSIC_BASE + 'tracks/neon-ronin.ogg'), 'a free track: not answered (never cached)');
  ok(!answered(MUSIC_BASE + 'tracks/neon-ronin.env'), 'its envelope: not answered');
  ok(!answered(MUSIC_BASE + 'library.json'), 'anything else of the music site: not answered');
  ok(!answered('https://aetheria432.com/some/track.ogg') && !answered('https://example.com/a.MP3') && !answered('https://aetheria432.com/x.opus'), 'any audio file: not answered');
  ok(answered('https://aetheria432.com/assets/main-x.js'), 'the app source: still answered (network-first)');
  ok(answered('https://aetheria432.com/images/icon-192x192.png'), 'its images: still answered (cache-first)');
  ok(answered('https://aetheria432.com/', 'navigate'), 'a navigation: still answered');
  ok(answered('https://big-banana-studios.github.io/aetheria-reader/app.js'), 'another site of the organisation: as before');
  ok(/const MUSIC_BASE = 'https:\/\/big-banana-studios\.github\.io\/aetheria-music\/';/.test(src) && src.includes(MUSIC_BASE), "the worker's music address is model.ts's MUSIC_BASE");
}

console.log(`free music: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
