// Checks for utils/soundV2/soundLog.ts (spec §7.3), on a Map-backed fake storage.
// Run with: node utils/soundV2/soundLog.check.ts   (Node 22.18+ strips the types), or npm run check:sound
// Exits non-zero on any failure.
//
// The load-bearing checks: nothing is written before load() (the load gate);
// a flush re-reads the store and merges by session id, so another tab's
// sessions survive; the budgets trim in their order (entries, then sessions,
// then bytes); records it cannot read are dropped while fields it does not
// know are kept; and a full or broken storage returns false, never throws.

import {
  SOUND_LOG_KEY,
  SOUND_LOG_MAX_SESSIONS,
  SOUND_LOG_MAX_ENTRIES,
  SOUND_LOG_MAX_BYTES,
  createSoundLog,
} from './soundLog.ts';
import type { SoundLogFields, SoundLogSession, StorageLike } from './soundLog.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}

/** Run fn with console.warn captured; returns what it warned. */
function warnsOf(fn: () => void): string[] {
  const seen: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    seen.push(args.map(String).join(' '));
  };
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return seen;
}

interface FakeStorage extends StorageLike {
  m: Map<string, string>;
  writes: number;
  failWrites: boolean;
  failReads: boolean;
}
function fakeStorage(): FakeStorage {
  const s: FakeStorage = {
    m: new Map(),
    writes: 0,
    failWrites: false,
    failReads: false,
    getItem(k: string): string | null {
      if (s.failReads) throw new Error('SecurityError');
      return s.m.has(k) ? (s.m.get(k) as string) : null;
    },
    setItem(k: string, v: string): void {
      if (s.failWrites) throw new Error('QuotaExceededError');
      s.writes++;
      s.m.set(k, String(v));
    },
  };
  return s;
}
const stored = (s: FakeStorage): SoundLogSession[] => JSON.parse(s.m.get(SOUND_LOG_KEY) ?? '[]');

/** An entry as App notes it (no `at`), typed as SoundLogFields so tsc checks it and proves it passes as note()'s
 *  argument; `i` makes it distinct, `extra` adds or overrides fields. */
function entry(i: number, extra?: Record<string, unknown>): SoundLogFields {
  const e: SoundLogFields = {
    engine: 'v2', sound_version: 2, output: 'headphones', render: 'binaural',
    f: 528, tone_hz: 528, carrier_hz: 264, partner_hz: 274 + i, beat_hz: 10, drone_hz: 33, pulse_hz: 8.25,
    tone_db: -26, beat_db: -23, drone_db: -24, drone_resting: false, music_only: false, v2_failed: false,
  };
  return Object.assign(e, extra);
}

check(SOUND_LOG_KEY === 'aetheria.soundSessions.v1' && SOUND_LOG_MAX_SESSIONS === 200 && SOUND_LOG_MAX_ENTRIES === 50
  && SOUND_LOG_MAX_BYTES === 262144, 'the key and the budgets: 200 sessions, 50 entries, 256 KB');

{
  // The load gate: before load() nothing is recorded and a flush writes nothing (and reports no failure).
  const st = fakeStorage();
  const other = '[{"id":"other","started":1,"ended":2,"entries":[],"retunes":0,"band_steps":0,"drone_rests":0}]';
  st.m.set(SOUND_LOG_KEY, other);
  const log = createSoundLog(st);
  log.open(100);
  check(log.note(entry(0), 101) === false && log.sessions().length === 0, 'before load(): nothing is recorded');
  check(log.flush() === true && st.writes === 0 && st.m.get(SOUND_LOG_KEY) === other, 'before load(): flush writes nothing and returns true');
  log.load();
  check(log.sessions().length === 1 && log.sessions()[0].id === 'other', "load() reads what is stored");
  log.open(200);
  check(log.note(entry(0), 201) === true, 'after load(): a note is recorded');
  check(log.flush() === true && st.writes === 1 && stored(st).length === 2, 'and the flush writes both sessions');
}

{
  // Notes: appended to the open session only; identical consecutive entries kept once; at most 50, the first and the
  // last 49; counts; close and reopen.
  const st = fakeStorage();
  const log = createSoundLog(st);
  log.load();
  check(log.note(entry(0), 1) === false, 'no open session: a note is not recorded');
  log.open(10);
  check(log.note(entry(0), 11) === true && log.note(entry(0), 12) === false && log.note(entry(1), 13) === true
    && log.note(entry(0), 14) === true, 'identical consecutive entries are kept once (an earlier duplicate is not consecutive)');
  const s0 = log.sessions()[0];
  check(s0.entries.length === 3 && s0.entries[0].at === 11 && s0.ended === 14, 'entries carry their time; the session its last');
  for (let i = 2; i < 62; i++) log.note(entry(i), 100 + i);
  const s = log.sessions()[0];
  // 63 noted: the 1st, then the 15th..63rd (entry(13)..entry(61)).
  check(s.entries.length === 50 && s.entries[0].at === 11 && s.entries[49].partner_hz === 274 + 61 && s.entries[1].partner_hz === 274 + 13,
    `63 entries keep 50: the first and the last 49 (${s.entries.length}, first at ${s.entries[0].at})`);
  log.count('retune');
  log.count('retune');
  log.count('band');
  log.count('rest');
  check(s.retunes === 2 && s.band_steps === 1 && s.drone_rests === 1, 'count() adds retunes, band steps and drone rests');
  log.close(500);
  check(s.ended === 500 && log.note(entry(99), 501) === false, 'close() ends the session; notes stop');
  log.open(600);
  check(log.sessions().length === 2 && log.sessions()[1].started === 600 && log.sessions()[1].id !== s.id, 'open() after close() starts a new one');
  log.open(700);
  check(log.sessions().length === 2, 'open() while one is open does nothing');
  check(log.flush() && stored(st)[0].entries.length === 50, 'the stored session holds the trimmed entries');
  // −∞ dB is off (null); a malformed entry is refused once, with one warning.
  check(log.note(entry(100, { tone_db: -Infinity }), 701) && log.sessions()[1].entries[0].tone_db === null, 'a −∞ dB level is stored as off (null)');
  const w = warnsOf(() => {
    check(log.note(entry(101, { f: NaN }), 702) === false && log.note(entry(102, { engine: 'v3' }), 703) === false,
      'a malformed entry is not recorded');
  });
  check(w.length === 1, `and warns once (${w.length})`);
  // Fields App adds later (v14.10's fit_* / duck_db) are kept.
  log.note(entry(103, { fit_rel: 0.4, duck_db: -1.5 }), 704);
  const last = log.sessions()[1].entries[log.sessions()[1].entries.length - 1];
  check(last.fit_rel === 0.4 && last.duck_db === -1.5, 'unknown entry fields are kept');
  check(log.note(entry(103, { fit_rel: 0.4, duck_db: -1.5 }), 705) === false && log.note(entry(103, { fit_rel: 0.5, duck_db: -1.5 }), 706) === true,
    'and take part in the dedupe');
}

{
  // 201 sessions → 200, the oldest dropped.
  const st = fakeStorage();
  const log = createSoundLog(st);
  log.load();
  for (let i = 0; i < 201; i++) {
    log.open(1000 + i * 10);
    log.note(entry(i), 1001 + i * 10);
    log.close(1005 + i * 10);
  }
  check(log.flush(), 'flush with 201 sessions');
  const ss = stored(st);
  check(ss.length === 200 && ss[0].started === 1010 && ss[199].started === 1000 + 200 * 10,
    `201 sessions keep the newest 200 (${ss.length}, oldest ${ss[0].started})`);
  check(log.sessions().length === 200, 'and so does memory');
}

{
  // The byte budget: the oldest sessions go until the JSON fits; the default 256 KB and a small one.
  const st = fakeStorage();
  const log = createSoundLog(st);
  log.load();
  const pad = 'x'.repeat(400);
  for (let i = 0; i < 150; i++) {
    log.open(i * 100);
    for (let k = 0; k < 50; k++) log.note(entry(k, { pad }), i * 100 + k);
    log.close(i * 100 + 60);
  }
  check(log.flush(), 'flush past the byte budget');
  const raw = st.m.get(SOUND_LOG_KEY) ?? '';
  const ss = stored(st);
  check(raw.length <= SOUND_LOG_MAX_BYTES && raw.length > SOUND_LOG_MAX_BYTES * 0.9, `the stored JSON fits 256 KB (${raw.length} chars)`);
  check(ss.length < 150 && ss[ss.length - 1].started === 149 * 100 && ss.every((s, i) => i === 0 || s.started > ss[i - 1].started),
    `the newest sessions are kept, oldest first (${ss.length} of 150)`);
  const small = fakeStorage();
  const tiny = createSoundLog(small, { maxBytes: 2000, maxEntries: 3, maxSessions: 4 });
  tiny.load();
  for (let i = 0; i < 6; i++) {
    tiny.open(i);
    for (let k = 0; k < 5; k++) tiny.note(entry(k), i + k / 10);
    tiny.close(i + 0.9);
  }
  check(tiny.flush(), 'flush with small budgets');
  const ts = stored(small);
  check(ts.length >= 1 && ts.length <= 4 && (small.m.get(SOUND_LOG_KEY) ?? '').length <= 2000
    && ts.every((s) => s.entries.length === 3 && s.entries[0].partner_hz === 274 && s.entries[2].partner_hz === 278),
    `small budgets: ≤ 4 sessions, ≤ 2000 chars, 3 entries each (first + last 2) (${ts.length} sessions)`);
}

{
  // Another tab's sessions, written between this tab's load and flush, survive; ours win for our own ids.
  const st = fakeStorage();
  const a = createSoundLog(st), b = createSoundLog(st);
  a.load();
  b.load();
  a.open(10);
  a.note(entry(1), 11);
  b.open(20);
  b.note(entry(2), 21);
  check(b.flush(), 'tab B flushes first');
  check(a.flush(), 'then tab A');
  let ss = stored(st);
  check(ss.length === 2 && ss[0].started === 10 && ss[1].started === 20, "both tabs' sessions are stored");
  b.note(entry(3), 22); // B goes on in its session
  check(b.flush(), 'tab B again');
  a.note(entry(4), 12);
  check(a.flush(), 'tab A again');
  ss = stored(st);
  check(ss.length === 2 && ss[1].entries.length === 2 && ss[0].entries.length === 2,
    "A's flush keeps B's newer entries (re-read + merge by id), and its own");
  check(a.sessions().some((s) => s.started === 20 && s.entries.length === 2), "A's memory now has B's session as stored");
}

{
  // Malformed records are dropped; unknown fields kept; a non-JSON or non-array value reads as empty.
  const st = fakeStorage();
  const good = { id: 'g', started: 5, ended: 9, retunes: 1, band_steps: 0, drone_rests: 0, app: 'v14.10',
    entries: [{ ...entry(1), at: 6, duck_db: -2 }, { ...entry(2), at: 7, engine: 'bogus' }, { ...entry(3), at: 'soon' }, null] };
  const bad = [
    null, 5, 'str', [],
    { started: 1, ended: 2, entries: [], retunes: 0, band_steps: 0, drone_rests: 0 }, // no id
    { id: 'e', started: 1, ended: 2, entries: 'x', retunes: 0, band_steps: 0, drone_rests: 0 }, // entries not a list
    { id: 'n', started: 1, ended: 2, entries: [], retunes: -1, band_steps: 0, drone_rests: 0 }, // a negative count
    { id: 'm', started: 'x', ended: 2, entries: [], retunes: 0, band_steps: 0, drone_rests: 0 }, // no start time
  ];
  st.m.set(SOUND_LOG_KEY, JSON.stringify([...bad, good]));
  const log = createSoundLog(st);
  log.load();
  const ss = log.sessions();
  check(ss.length === 1 && ss[0].id === 'g', `only the well-formed session is read (${ss.map((s) => s.id).join(',')})`);
  check(ss[0].entries.length === 1 && ss[0].entries[0].duck_db === -2 && ss[0].app === 'v14.10',
    'its malformed entries are dropped; unknown session and entry fields are kept');
  check(log.flush() && stored(st).length === 1 && stored(st)[0].app === 'v14.10', 'and written back as read');
  const junk = fakeStorage();
  junk.m.set(SOUND_LOG_KEY, '{not json');
  const jl = createSoundLog(junk);
  const w = warnsOf(() => jl.load());
  check(jl.sessions().length === 0 && w.length === 1, 'a stored value that is not JSON reads as empty, with a warning');
  const obj = fakeStorage();
  obj.m.set(SOUND_LOG_KEY, '{"sessions":[]}');
  const ol = createSoundLog(obj);
  const w2 = warnsOf(() => ol.load());
  check(ol.sessions().length === 0 && w2.length === 1, 'a stored value that is not a list reads as empty, with a warning');
}

{
  // A throwing setItem (quota) → false, never a throw; a throwing getItem → false, nothing written; no storage → false.
  const st = fakeStorage();
  const log = createSoundLog(st);
  log.load();
  log.open(1);
  log.note(entry(0), 2);
  st.failWrites = true;
  let threw = false;
  let r = true;
  try {
    r = log.flush();
  } catch {
    threw = true;
  }
  check(!threw && r === false, 'a throwing setItem: flush() is false and does not throw');
  check(log.sessions().length === 1 && log.sessions()[0].entries.length === 1, 'the log stays in memory for the next flush or the export');
  st.failWrites = false;
  check(log.flush() === true && stored(st).length === 1, 'the next flush writes it');
  st.failReads = true;
  const writes = st.writes;
  check(log.flush() === false && st.writes === writes, 'a store that cannot be read is never overwritten blind');
  const unreadable = fakeStorage();
  unreadable.failReads = true;
  const ul = createSoundLog(unreadable);
  ul.load();
  ul.open(1);
  check(ul.note(entry(0), 2) === true && ul.flush() === false && unreadable.writes === 0,
    'an unreadable store at load: the log still records in memory, and never writes');
  const none = createSoundLog(null);
  none.load();
  none.open(1);
  check(none.note(entry(0), 2) === true && none.flush() === false && JSON.parse(none.exportJson()).sessions.length === 1,
    'no storage: flush is false, the export still has the session');
}

{
  // exportJson round-trips through JSON.parse.
  const st = fakeStorage();
  const log = createSoundLog(st);
  log.load();
  log.open(1);
  log.note(entry(0, { fit_rel: 0.25 }), 2);
  log.count('band');
  log.note(entry(1), 3);
  log.close(4);
  const parsed = JSON.parse(log.exportJson());
  check(parsed.format === SOUND_LOG_KEY && JSON.stringify(parsed.sessions) === JSON.stringify(log.sessions()),
    'exportJson() round-trips through JSON.parse');
}

console.log(`soundLog: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures.slice(0, 20)) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
