// v16.10.1 (decision 6 A, 14 Nov 2026): the old score words in saved playlists' names.
// From 28 to 31 Oct (v16.3 to v16.5) a mix built with that score's filter on was named "… · DNA resonance score over
// 30 %" (Create a mix's name; the Library's filters never had the score), and saving it as a playlist kept that name
// and its "Saved from" line.
// v16.6 changed new names only; v16.10 took DNA out of everything else the app shows. As the playlists are read, those
// words become "Experimental tone-set score over 30 %" (the words a mix's name uses now: scanScores' nameWords), in
// memory only: the read still writes nothing, and the next change to that playlist stores the new name.
// - Only the forms the app made (v165-mix-names.json, recorded from v16.5's own code), so a name someone typed stays.
//   Every such place in a name is renamed:
//   - the whole words after "· " (how a mix joins its parts), followed by what the app put there: nothing, a copy's
//     number (" 2"), Duplicate's " copy" (copyName; numbers and copies in any order, a Duplicate of a numbered copy
//     being "… 2 copy"; the last cut to " c", " co" or " cop" at the limit), or what v16.5 put after the score's chip:
//     " · Aetheria number" or " +N more", perhaps cut ("…") and then copied;
//   - the whole words after "· from ": a mix built from an old-named playlist (any version since v16.3) has that
//     playlist's name in its "from …" part, then the mix's next part, a cut or the end;
//   - or the start of the words at the very end of a name cut at the 80-character limit: builderName's "…" ("… · DNA
//     resonance sc…", 79 or 80 UTF-16 units: CUT_UNITS) or a copy of one, cut by freeName ("… · DNA resonance 2",
//     "… over… 2", 78 to 80 code points: CUT_POINTS), Duplicate's words perhaps after them ("…… c", "… % cop 2": a
//     copy cut at 80 by cleanName). So "Gym · DNA 2" stays.
// - A longer name is cut back to 80 characters with "…", keeping a copy's number; a name that was cut keeps its "…".
//   A name another playlist already has gets the next free number, as freeName gives a new playlist.
// - Idempotent: the new words hold no DNA, so a second pass changes nothing. updatedAt is kept.
// Comments in utils/ must not hold words that look like style class names (the style build scans this folder).

import { NAME_MAX, cleanName, headOfName, sortLists } from './model.ts';
import type { PlaylistRecord } from './model.ts';

export const OLD_SCORE_WORDS = 'DNA resonance score over 30 %';
export const NEW_SCORE_WORDS = 'Experimental tone-set score over 30 %';

const OLD = OLD_SCORE_WORDS;
const COPY_NUMBER = / \d+$/;
/** builderName's cut: at least this many UTF-16 units (it measured in them: 79 kept, then "…"). */
export const CUT_UNITS = NAME_MAX - 1;
/** freeName's and cleanName's cuts: at least this many code points (theirs are 78 to 80; 2 to spare for graphemes). */
export const CUT_POINTS = NAME_MAX - 4;
/** What v16.5 put after the score's chip: the next chip (the only one after it), or the count of the rest. */
const NEXT_CHIP = ' · Aetheria number';
const MORE = /^ \+(\d+( (m(o(r(e)?)?)?)?)?)?$/;
const FROM = '· from ';
const codePoints = (s: string): number => Array.from(s).length;

/** What follows the whole words is the app's: nothing, or v16.5's next chip or "+N more", perhaps cut ("…"), then
 *  copies' marks in any order: a number (freeName's " 2") and Duplicate's " copy" ("… % 2 copy", "… % copy 2 copy"),
 *  the last perhaps cut at the limit ("… · Aetheria number co 2"). */
function afterWords(rest: string, atLimit: boolean): boolean {
  let t = rest;
  for (;;) {
    const before = t;
    t = t.replace(COPY_NUMBER, '').replace(/ copy$/, '').replace(/…$/, '');
    if (atLimit) t = t.replace(/ (?:c|co|cop)$/, '');
    if (t === before) break;
  }
  t = t.trimEnd();
  return t === '' || NEXT_CHIP.startsWith(t) || MORE.test(t);
}
/** After the words in a "from …" part (the source playlist's name): that name's own copies' marks, then the mix's next
 *  part (" · "), a cut ("…", perhaps inside a copy word) or the end. */
const FROM_TAIL = /^(?: (?:\d+|copy))*(?: (?:c|co|cop))?(?: · | ·…|…|$)/;

/** The name with the old score words replaced, fitted to NAME_MAX; the same string when it has none. */
export function renamedOldWords(name: string): string {
  let out = ''; // the new name, up to `copied`
  let copied = 0;
  let from = 0;
  let changed = false;
  let copyNumber = '';
  const atLimit = codePoints(name) >= CUT_POINTS;
  for (;;) {
    const at = name.indexOf('DNA', from);
    if (at < 0) break;
    from = at + 3;
    if (at < 2 || name.slice(at - 2, at) !== '· ') continue;
    // How much of the old words is here (at least "DNA").
    let k = 3;
    while (k < OLD.length && name[at + k] === OLD[k]) k++;
    const rest = name.slice(at + k);
    const inFrom = name.lastIndexOf(FROM, at) >= 0;
    if (k === OLD.length && (afterWords(rest, atLimit) || (inFrom && FROM_TAIL.test(rest)))) {
      out += name.slice(copied, at) + NEW_SCORE_WORDS;
      copied = from = at + k;
      changed = true;
      continue;
    }
    // A cut start of the words, only at the very end of a name at the limit: builderName's "…" (a name cut at 80),
    // then perhaps copies' marks in any order (numbers, Duplicate's " copy", the last perhaps cut: "…… c", "over… 2"),
    // or with no "…" a copy cut by freeName or cleanName ("DNA resonance 2", "… s copy c"). The longest start that
    // leaves only those: in "score over 3" the 3 is a copy's number, not the start of "30 %". With the "…" the name was
    // builderName's cut and has only grown since: at least CUT_UNITS long; without it, at least CUT_POINTS code points.
    // The new name keeps the "…" (something was cut) and the marks after it.
    for (let j = k; j >= 3; j--) {
      const m = /^(…)?((?: (?:\d+|copy))*(?: (?:c|co|cop))?(?: \d+)?)$/.exec(name.slice(at + j));
      if (!m || (!m[1] && !m[2])) continue;
      if (m[1] ? name.length < CUT_UNITS : codePoints(name) < CUT_POINTS) break;
      out += name.slice(copied, at) + NEW_SCORE_WORDS + '…' + m[2];
      copied = name.length;
      changed = true;
      break;
    }
    if (copied === name.length) break;
  }
  if (!changed) return name;
  // The words' tail (" · Aetheria number 2"), then the copy's number apart, to be kept when the name is cut.
  out += name.slice(copied);
  if (!copyNumber) {
    const m = out.match(COPY_NUMBER);
    if (m) {
      copyNumber = m[0];
      out = out.slice(0, out.length - copyNumber.length);
    }
  }
  if (codePoints(out) + codePoints(copyNumber) <= NAME_MAX) return out + copyNumber;
  return `${headOfName(out, NAME_MAX - codePoints(copyNumber) - 1).trimEnd()}…${copyNumber}`;
}

/** freeName's answer for each name in turn (the name itself if free, else the first "<name> N" not taken, N from 2,
 *  the name cut to fit), against one set of lowercased names kept across the pass, each name's next N carried on:
 *  every try is a set lookup, and no N is tried twice for a name, so a pass stays O(n) even when many names clash. */
export function freeNames(taken: Iterable<string>): (name: string) => string {
  const low = new Set<string>();
  for (const t of taken) low.add(t.toLocaleLowerCase('en-US'));
  const next = new Map<string, number>();
  return (name: string): string => {
    const b = cleanName(name) ?? 'Playlist';
    const key = b.toLocaleLowerCase('en-US');
    let pick = b;
    if (low.has(key)) {
      const heads = new Map<number, string>();
      for (let n = next.get(key) ?? 2; n < 10_000; n++) {
        const suffix = ` ${n}`;
        const room = NAME_MAX - suffix.length;
        let head = heads.get(room);
        if (head === undefined) {
          head = headOfName(b, room).trimEnd();
          heads.set(room, head);
        }
        const c = cleanName(`${head}${suffix}`) as string;
        if (!low.has(c.toLocaleLowerCase('en-US'))) {
          next.set(key, n + 1);
          pick = c;
          break;
        }
      }
    }
    low.add(pick.toLocaleLowerCase('en-US'));
    return pick;
  };
}

/** Every playlist with the old words renamed (its name and its "Saved from" label), each new name kept apart from every
 *  other playlist's (case-insensitive, as freeName), in the store's order (sortLists). The same array when none has
 *  them. A new name given a number on a clash is worked out again at each read until the playlist is next saved, so
 *  it can change if the playlist it met is renamed or deleted meanwhile. */
export function renameOldScoreWords(lists: PlaylistRecord[]): PlaylistRecord[] {
  const renamed = new Map<string, PlaylistRecord>();
  for (const p of lists) {
    const name = renamedOldWords(p.name);
    const label = p.from?.label === undefined ? undefined : renamedOldWords(p.from.label);
    if (name === p.name && label === p.from?.label) continue;
    const next: PlaylistRecord = { ...p, name };
    if (p.from) next.from = label === undefined ? { kind: p.from.kind } : { kind: p.from.kind, label };
    renamed.set(p.id, next);
  }
  if (!renamed.size) return lists;
  // The names taken: every playlist's that keeps its name; then each new name, as it is given.
  const free = freeNames(lists.filter((p) => (renamed.get(p.id)?.name ?? p.name) === p.name).map((p) => p.name));
  for (const p of lists) {
    const r = renamed.get(p.id);
    if (r && r.name !== p.name) r.name = free(r.name);
  }
  return sortLists(lists.map((p) => renamed.get(p.id) ?? p));
}
