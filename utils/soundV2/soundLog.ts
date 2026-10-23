// utils/soundV2/soundLog.ts
//
// The sound log: what the layers played in each listening session, so a
// by-ear A/B sitting can be read back afterwards (Harmonic Control → Export
// sound log). App runs it only once an engine has been chosen.
//
// One localStorage key holds every session as JSON, within budgets: 200
// sessions, 50 entries per session (the first and the last 49), 256 KB in
// all. Like the library since v14.5, it is careful with what it did not
// write: nothing is written before load() has read what is there, and every
// flush re-reads the store and merges by session id, so sessions another tab
// wrote in between survive. Records it cannot read are dropped; fields it
// does not know are kept (v15.2 adds key_fit, duck_db and fit_*). A stored value that
// is not a list of sessions is replaced, so a new format takes a new key.
//
// Pure: the storage is injected (null = none) and times come from the caller.
// Erasable TypeScript only, so Node runs soundLog.check.ts directly.

export const SOUND_LOG_KEY = 'aetheria.soundSessions.v1';
export const SOUND_LOG_MAX_SESSIONS = 200, SOUND_LOG_MAX_ENTRIES = 50, SOUND_LOG_MAX_BYTES = 256 * 1024;

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/**
 * An entry's own fields: what App notes (the log stamps `at`). A type alias, not an interface, so a value typed
 * with it passes as note()'s argument: Omit<SoundLogEntry, 'at'> keeps none of the field types (the index
 * signature swallows them), so build the entry as a SoundLogFields to have tsc check it.
 */
export type SoundLogFields = {
  engine: 'classic' | 'v2';
  sound_version: 1 | 2; // the engine's own label (the v2 player's state().sound_version is always 2)
  output: 'headphones' | 'speakers' | 'phone' | 'car' | 'assumed';
  render: 'binaural' | 'pulse' | 'off' | 'none'; // 'none' = nothing sounding
  f: number; // v2: canonical Hz; classic: selected Hz after the Lo Shu map
  tone_hz: number;
  carrier_hz: number;
  partner_hz: number;
  beat_hz: number;
  drone_hz: number;
  pulse_hz: number;
  tone_db: number | null; // re the music, at the envelope's peak; null = off
  beat_db: number | null;
  drone_db: number | null;
  drone_resting: boolean;
  music_only: boolean;
  v2_failed: boolean;
  // Key fit (v15.2), v2 entries only (keyFit.ts keyFitLogFields):
  key_fit?: boolean; // the switch
  duck_db?: number; // the duck applied (dB, ≤ 0; 0 when off, without data, or with no music)
  fit_db?: number | null; // what Key fit gives on this track, crystal and output (null = no key data)
  fit_rel?: number | null;
  fit_strength?: number | null;
  fit_tone_hz?: number;
  fit_a4_hz?: number | null; // the A the notes are heard at
  track_key?: string | null;
  key_confidence?: number | null;
};

export interface SoundLogEntry extends SoundLogFields {
  at: number; // Date.now()
  [extra: string]: unknown; // unknown fields are kept
}

export interface SoundLogSession {
  id: string;
  started: number;
  ended: number;
  entries: SoundLogEntry[]; // ≤ 50: the first and the last 49
  retunes: number;
  band_steps: number;
  drone_rests: number;
  [extra: string]: unknown;
}

export interface SoundLog {
  /** The load gate: read + validate what is stored. Nothing is recorded or written before it ran. */
  load(): void;
  /** Start a session if none is open. */
  open(now: number): void;
  /** Append an entry (built as a SoundLogFields; extra fields are kept) to the open session, unless it equals the
   *  last one (ignoring `at`). True when appended; false before load(), with no session open, or for a malformed
   *  entry (one warning). A non-finite dB level is stored as off (null). */
  note(e: Omit<SoundLogEntry, 'at'>, now: number): boolean;
  count(kind: 'retune' | 'band' | 'rest'): void;
  close(now: number): void;
  /** Re-read storage, merge by session id, trim, write. False if it could not read or write (never throws). */
  flush(): boolean;
  exportJson(): string;
  sessions(): readonly SoundLogSession[];
}

const ENGINES: readonly unknown[] = ['classic', 'v2'];
const OUTPUTS: readonly unknown[] = ['headphones', 'speakers', 'phone', 'car', 'assumed'];
const RENDERS: readonly unknown[] = ['binaural', 'pulse', 'off', 'none'];
const HZ_FIELDS = ['f', 'tone_hz', 'carrier_hz', 'partner_hz', 'beat_hz', 'drone_hz', 'pulse_hz'];
const DB_FIELDS = ['tone_db', 'beat_db', 'drone_db'];
const FLAG_FIELDS = ['drone_resting', 'music_only', 'v2_failed'];
const COUNT_FIELDS = ['retunes', 'band_steps', 'drone_rests'];

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** A copy of x if it is a well-formed entry (unknown fields kept), else null. */
function readEntry(x: unknown): SoundLogEntry | null {
  if (!isRecord(x) || !isNum(x.at)) return null;
  if (!ENGINES.includes(x.engine) || (x.sound_version !== 1 && x.sound_version !== 2)) return null;
  if (!OUTPUTS.includes(x.output) || !RENDERS.includes(x.render)) return null;
  for (const k of HZ_FIELDS) if (!isNum(x[k])) return null;
  for (const k of DB_FIELDS) if (x[k] !== null && !isNum(x[k])) return null;
  for (const k of FLAG_FIELDS) if (typeof x[k] !== 'boolean') return null;
  return { ...x } as SoundLogEntry;
}

/** A copy of x if it is a well-formed session (malformed entries dropped, unknown fields kept), else null. */
function readSession(x: unknown): SoundLogSession | null {
  if (!isRecord(x) || typeof x.id !== 'string' || x.id === '' || !isNum(x.started) || !isNum(x.ended)) return null;
  if (!Array.isArray(x.entries)) return null;
  for (const k of COUNT_FIELDS) if (!isNum(x[k]) || (x[k] as number) < 0) return null;
  const entries: SoundLogEntry[] = [];
  for (const e of x.entries) {
    const r = readEntry(e);
    if (r) entries.push(r);
  }
  return { ...x, entries } as SoundLogSession;
}

function byAge(a: SoundLogSession, b: SoundLogSession): number {
  return a.started - b.started || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Entries equal but for `at` (values are primitives; anything else compares as JSON). */
function sameEntry(a: SoundLogEntry, b: SoundLogEntry): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (k === 'at') continue;
    if (!(k in b)) return false;
    const x = a[k], y = b[k];
    if (x === y) continue;
    if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return false;
    if (JSON.stringify(x) !== JSON.stringify(y)) return false;
  }
  return true;
}

/** The first entry and the last max − 1. */
function trimEntries(s: SoundLogSession, max: number): void {
  if (s.entries.length > max) s.entries = [s.entries[0], ...s.entries.slice(s.entries.length - (max - 1))];
}

function positiveInt(x: number | undefined, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 1 ? Math.floor(x) : fallback;
}

export function createSoundLog(
  storage: StorageLike | null,
  opts?: { maxSessions?: number; maxEntries?: number; maxBytes?: number },
): SoundLog {
  const maxSessions = positiveInt(opts?.maxSessions, SOUND_LOG_MAX_SESSIONS);
  const maxEntries = Math.max(2, positiveInt(opts?.maxEntries, SOUND_LOG_MAX_ENTRIES));
  const maxBytes = positiveInt(opts?.maxBytes, SOUND_LOG_MAX_BYTES);
  let loaded = false;
  let list: SoundLogSession[] = []; // every session known here, oldest first
  const mine = new Set<string>(); // the sessions this log created: only these are written from memory
  let current: SoundLogSession | null = null;
  let warnedEntry = false;

  /** What is stored (validated), or null when it cannot be read. */
  const read = (): SoundLogSession[] | null => {
    if (!storage) return [];
    let raw: string | null;
    try {
      raw = storage.getItem(SOUND_LOG_KEY);
    } catch {
      return null;
    }
    if (raw === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (!Array.isArray(parsed)) {
      console.warn('Sound log: the stored log is not a list of sessions; it will be replaced.');
      return [];
    }
    const byId = new Map<string, SoundLogSession>();
    for (const x of parsed) {
      const s = readSession(x);
      if (!s) continue;
      const seen = byId.get(s.id);
      if (!seen || s.ended > seen.ended) byId.set(s.id, s);
    }
    return [...byId.values()];
  };

  /** Other tabs' sessions as stored, ours as in memory. */
  const merge = (stored: SoundLogSession[]): SoundLogSession[] => {
    const out = new Map<string, SoundLogSession>();
    for (const s of stored) if (!mine.has(s.id)) out.set(s.id, s);
    for (const s of list) if (mine.has(s.id)) out.set(s.id, s);
    return [...out.values()].sort(byAge);
  };

  /** Entries per session, then the oldest sessions past the count, then the oldest until the JSON fits. */
  const trim = (sessions: SoundLogSession[]): SoundLogSession[] => {
    for (const s of sessions) trimEntries(s, maxEntries);
    const kept = sessions.length > maxSessions ? sessions.slice(sessions.length - maxSessions) : sessions;
    // The array's JSON is '[' + the sessions joined by ',' + ']'; sizes are in characters (all ASCII here).
    const sizes = kept.map((s) => JSON.stringify(s).length);
    let total = 2 + Math.max(0, kept.length - 1);
    for (const n of sizes) total += n;
    let drop = 0;
    while (drop < kept.length && total > maxBytes) {
      total -= sizes[drop] + (kept.length - drop > 1 ? 1 : 0);
      drop++;
    }
    return drop > 0 ? kept.slice(drop) : kept;
  };

  /** The open session stays in memory even if the budget left it out of storage. */
  const adopt = (next: SoundLogSession[]): void => {
    list = current && !next.includes(current) ? [...next, current] : next;
  };

  return {
    load(): void {
      const stored = read();
      // An unreadable store is not overwritten: every flush re-reads first and writes only after a good read.
      adopt(merge(stored ?? []));
      loaded = true;
    },

    open(now: number): void {
      if (!loaded || current) return;
      const t = isNum(now) ? now : 0;
      // Unique across tabs in practice (time + 31 random bits), and checked against what is known here.
      let id = '';
      while (id === '' || list.some((s) => s.id === id)) {
        id = `${Math.floor(t).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      }
      current = { id, started: t, ended: t, entries: [], retunes: 0, band_steps: 0, drone_rests: 0 };
      mine.add(id);
      list.push(current);
    },

    note(e: Omit<SoundLogEntry, 'at'>, now: number): boolean {
      if (!loaded || !current) return false;
      const raw: Record<string, unknown> = Object.assign({ at: now }, e, { at: now });
      // −∞ dB is off: stored as null like any other off layer.
      for (const k of DB_FIELDS) if (typeof raw[k] === 'number' && !Number.isFinite(raw[k])) raw[k] = null;
      const entry = readEntry(raw);
      if (!entry) {
        if (!warnedEntry) console.warn('Sound log: a malformed entry was not recorded.', e);
        warnedEntry = true;
        return false;
      }
      const s = current;
      if (now > s.ended) s.ended = now;
      const last = s.entries[s.entries.length - 1];
      if (last && sameEntry(last, entry)) return false;
      s.entries.push(entry);
      if (s.entries.length > maxEntries) s.entries.splice(1, 1); // keep the first and the latest
      return true;
    },

    count(kind: 'retune' | 'band' | 'rest'): void {
      if (!loaded || !current) return;
      if (kind === 'retune') current.retunes++;
      else if (kind === 'band') current.band_steps++;
      else if (kind === 'rest') current.drone_rests++;
    },

    close(now: number): void {
      if (!loaded || !current) return;
      if (isNum(now) && now > current.ended) current.ended = now;
      current = null;
    },

    flush(): boolean {
      if (!loaded) return true; // the load gate: nothing was read, so nothing is written
      if (!storage) return false;
      const stored = read();
      if (stored === null) return false; // what is there could not be read: never overwrite it blind
      const next = trim(merge(stored));
      adopt(next);
      let json: string;
      try {
        json = JSON.stringify(next);
        storage.setItem(SOUND_LOG_KEY, json);
      } catch {
        return false;
      }
      return true;
    },

    exportJson(): string {
      return JSON.stringify({ format: SOUND_LOG_KEY, sessions: list }, null, 2);
    },

    sessions(): readonly SoundLogSession[] {
      return list;
    },
  };
}
