// utils/library/listOps.ts
//
// Pure list operations for the library (`originalPlaylist`) and the play order
// (`playlist`). They exist because three paths used to write the PLAY ORDER
// into the LIBRARY when a mix or walk was showing (Deep Scan, Auto-Distribute,
// import), and the blob sync then deleted every other track's stored audio.
//
// The invariants these helpers enforce:
//   - The library only ever grows by import and shrinks by an explicit delete.
//   - Analysis results are applied BY ID to whichever lists hold the track; a
//     list is never replaced with a snapshot of another list.
//   - Removing a track from the play order moves the cursor by the number of
//     entries removed before it (walks can hold the same track more than once).
//
// Generic over `{ id: string }` and free of app imports so Node can run the
// checks in listOps.check.ts directly (type stripping, no build step).

export interface HasId {
  id: string;
}

/** The list with repeated ids removed, keeping each id's first occurrence. */
export function dedupeById<T extends HasId>(list: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of list) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/** True when both lists hold the same ids in the same order. */
export function sameIdOrder(a: readonly HasId[], b: readonly HasId[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
  }
  return true;
}

/**
 * Apply per-id field patches to every entry that carries the id (a walk may
 * hold one track several times). Returns the SAME array when nothing matched,
 * so a React setState with this result is a no-op for lists that don't hold
 * the patched tracks.
 */
export function patchById<T extends HasId>(
  list: T[],
  patches: ReadonlyMap<string, Partial<T>>
): T[] {
  if (patches.size === 0) return list;
  let out: T[] | null = null;
  for (let i = 0; i < list.length; i++) {
    const patch = patches.get(list[i].id);
    if (!patch) continue;
    if (!out) out = list.slice();
    out[i] = { ...list[i], ...patch };
  }
  return out ?? list;
}

export interface RemovalResult<T> {
  list: T[];
  /** The cursor after removal; -1 when the entry under the cursor was removed. */
  cursor: number;
  /** True when the entry under the cursor was one of the removed ids. */
  removedCurrent: boolean;
}

/**
 * Remove every entry whose id is in `ids` and remap a cursor into the list.
 * The cursor drops by the number of removed entries before it; it is
 * unchanged when none of the ids are in the list (the old code decremented it
 * whenever the track was missing, because findIndex returned -1).
 */
export function removeIdsWithCursor<T extends HasId>(
  list: readonly T[],
  ids: ReadonlySet<string>,
  cursor: number
): RemovalResult<T> {
  const removedCurrent = cursor >= 0 && cursor < list.length && ids.has(list[cursor].id);
  let removedBefore = 0;
  const out: T[] = [];
  for (let i = 0; i < list.length; i++) {
    if (ids.has(list[i].id)) {
      if (i < cursor) removedBefore++;
      continue;
    }
    out.push(list[i]);
  }
  if (removedCurrent) return { list: out, cursor: -1, removedCurrent: true };
  const next = cursor < 0 ? cursor : cursor - removedBefore;
  return { list: out, cursor: next, removedCurrent: false };
}

/** Append new tracks to the library, skipping ids it already holds. */
export function appendToLibrary<T extends HasId>(library: readonly T[], added: readonly T[]): T[] {
  if (added.length === 0) return library as T[];
  const have = new Set(library.map((s) => s.id));
  const fresh = added.filter((s) => !have.has(s.id));
  return fresh.length ? [...library, ...fresh] : (library as T[]);
}

export interface HasFile extends HasId {
  file: { name: string; size: number };
}

export interface OrphanSplit<T> {
  /** Stored tracks the library has no copy of: offered back. */
  fresh: T[];
  /** Removable copies: of a library track whose audio is stored, or of an
   *  earlier orphan (which is itself kept or offered). */
  duplicates: T[];
  /** Copies of a library track whose OWN audio is not stored (its save failed
   *  or hasn't run): the orphan is the only stored copy, so it is kept. */
  unconfirmed: T[];
}

/**
 * Sort stored tracks the library doesn't list into ones to offer back, copies
 * to remove, and copies to keep. A copy is matched by file name and size (a
 * re-import gets a new id). An orphan whose id the library now holds is in no
 * list. Run it against the CURRENT library: an import after launch can turn
 * an orphan into a copy.
 *
 * `storedIds` (the ids whose audio is on disk) decides whether a library twin
 * counts: a copy is only removable when its twin is stored. Without it every
 * twin counts as stored — good enough to word a banner, never to delete by.
 */
export function splitOrphans<T extends HasFile>(
  orphans: readonly T[],
  library: readonly T[],
  storedIds?: ReadonlySet<string>
): OrphanSplit<T> {
  const key = (s: T) => `${s.file.name}|${s.file.size}`;
  const ids = new Set(library.map((s) => s.id));
  const storedTwin = new Set<string>();
  const unstoredTwin = new Set<string>();
  for (const s of library) {
    if (!storedIds || storedIds.has(s.id)) storedTwin.add(key(s));
    else unstoredTwin.add(key(s));
  }
  const seenOrphan = new Set<string>();
  const fresh: T[] = [];
  const duplicates: T[] = [];
  const unconfirmed: T[] = [];
  for (const s of orphans) {
    if (ids.has(s.id)) continue;
    const k = key(s);
    if (storedTwin.has(k) || seenOrphan.has(k)) {
      duplicates.push(s);
    } else if (unstoredTwin.has(k)) {
      seenOrphan.add(k);
      unconfirmed.push(s);
    } else {
      seenOrphan.add(k);
      fresh.push(s);
    }
  }
  return { fresh, duplicates, unconfirmed };
}
