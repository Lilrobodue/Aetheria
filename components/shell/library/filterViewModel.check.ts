// components/shell/library/filterViewModel.check.ts (v16.2): every word the smart filters show around the list.
//   node components/shell/library/filterViewModel.check.ts   (npm run check:shell; Node 22.18+ strips the types)

import { readFileSync } from 'node:fs';
import {
  FROM_FILTERS,
  PLAYLIST_CAP,
  ROW_TAP_LIBRARY_HINT,
  PERFECT_GUT_NOTE,
  CLEAR_ALL,
  ADD_TO_PLAYLIST_LINE,
  filterSummaryParts,
  filterSummaryText,
  rowTapHint,
  filtersButtonName,
  removeChipName,
  moreButtonName,
  sheetCountText,
  chipName,
  regimeChipLabel,
  regimeRangeText,
  showButtonText,
  actionsTitle,
  playNextManyLine,
  addToQueueManyLine,
  saveLine,
  saveSentence,
  filterStartText,
  emptyTitle,
  emptyHintLine,
  removeFacetText,
} from './filterViewModel.ts';
import { REGIMES, NO_FILTERS, buildFacetIndex, filterPass, emptyHint, withFacet, activeChips } from '../../../utils/library/filterModel.ts';
import type { FilterSong } from '../../../utils/library/filterModel.ts';
import { queuedToast, carryText } from '../queue/queueViewModel.ts';

let passed = 0;
let failed = 0;
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) === JSON.stringify(b)) passed++;
  else {
    failed++;
    console.error(`FAIL ${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  }
};

// The summary: "10 of 440 tracks · 25 min"; no length with nothing shown; one track; thousands.
eq(filterSummaryText(10, 440, 25 * 60), '10 of 440 tracks · 25 min', 'summary');
eq(filterSummaryParts(10, 440, 25 * 60), { count: '10 of 440', rest: ' tracks · 25 min' }, 'summary parts (the bold count)');
eq(filterSummaryText(0, 440, 0), '0 of 440 tracks', 'summary: nothing shown, no length');
eq(filterSummaryText(1, 1, 200), '1 of 1 track · 3 min', 'summary: a library of one');
eq(filterSummaryText(1200, 5000, 4 * 3600 + 120), '1,200 of 5,000 tracks · 4 h 2 min', 'summary: thousands and hours');
eq(filterSummaryText(3, 30, 0), '3 of 30 tracks', 'summary: lengths not read yet');

// Both decision-1 hints (A in use).
eq(rowTapHint(10), 'A tap plays these 10, from that track.', 'hint A');
eq(rowTapHint(1), 'A tap plays this one track.', 'hint A, one');
eq(ROW_TAP_LIBRARY_HINT, 'A tap plays your whole library from that track.', 'hint B');

// The Filters button's name.
eq(filtersButtonName(0), 'Filters', 'button: none on');
eq(filtersButtonName(1), 'Filters, 1 on', 'button: one on');
eq(filtersButtonName(3), 'Filters, 3 on', 'button: three on');

// Chips and the sheet.
eq(removeChipName('528 Hz'), 'Remove 528 Hz', 'active chip name');
eq(moreButtonName(10), 'More for these 10 tracks', 'the ⋯ name');
eq(moreButtonName(1), 'More for this track', 'the ⋯ name, one');
eq(sheetCountText(10, 440), '10 of 440 tracks', 'sheet count');
eq(chipName('528 Hz', 6), '528 Hz, 6 tracks', 'chip name');
eq(chipName('No crystal', 1), 'No crystal, 1 track', 'chip name, one');
eq(chipName('10 min or more', 0), '10 min or more, 0 tracks', 'chip name, none');
eq(regimeChipLabel('GUT'), 'All GUT', 'regime chip');
eq(REGIMES.map((r) => regimeRangeText(r.crystals)), ['174–963 Hz', '1206–3150 Hz', '3504–6336 Hz'], 'regime ranges');
eq(regimeRangeText([]), '', 'regime range, empty');
eq(showButtonText(10), 'Show 10 tracks', 'footer');
eq(showButtonText(1), 'Show 1 track', 'footer, one');
eq(showButtonText(0), 'Show 0 tracks', 'footer, none');
eq(CLEAR_ALL, 'Clear all', 'footer clear');
eq(PERFECT_GUT_NOTE, 'With Perfect GUT on, 174–639 play as 75–630 Hz.', 'Perfect GUT line');

// The ⋯ sheet's lines: with a queue, without, and with nothing current.
eq(actionsTitle(10, 25 * 60), 'These 10 tracks · 25 min', 'actions title');
eq(actionsTitle(1, 0), 'This track', 'actions title, one, no length');
eq(playNextManyLine(10, false), 'All 10, right after the track that’s playing, in this order', 'play next line');
eq(playNextManyLine(10, true), 'All 10, first when you press Play, in this order', 'play next line, nothing current');
eq(addToQueueManyLine(10, 2, false), 'All 10, after the 2 tracks waiting in your queue', 'queue line, 2 waiting');
eq(addToQueueManyLine(10, 1, false), 'All 10, after the track waiting in your queue', 'queue line, 1 waiting');
eq(addToQueueManyLine(10, 0, false), 'All 10, right after the track that’s playing, in this order', 'queue line, none waiting');
eq(addToQueueManyLine(10, 0, true), 'All 10, first when you press Play, in this order', 'queue line, nothing current');
eq(addToQueueManyLine(1, 3, false), 'This track, after the 3 tracks waiting in your queue', 'queue line, one track');
eq(ADD_TO_PLAYLIST_LINE, 'To one of your playlists, or a new one', 'add to a playlist line');
eq(saveLine(10), 'A new playlist of these 10, in this order', 'save line');
eq(saveLine(PLAYLIST_CAP), 'A new playlist of these 10,000, in this order', 'save line at the cap');
eq(saveLine(PLAYLIST_CAP + 1), 'A playlist holds up to 10,000 tracks', 'save line over the cap');
const cap = /export const ENTRIES_MAX = ([\d_]+);/.exec(readFileSync(new URL('../../../utils/playlists/model.ts', import.meta.url), 'utf8'));
eq(cap ? Number(cap[1].replace(/_/g, '')) : null, PLAYLIST_CAP, "the cap is v16.1's ENTRIES_MAX");
eq(
  saveSentence(10),
  'The 10 tracks your filters show, in the list’s order. The playlist keeps these 10; it won’t change when your filters or your library do.',
  'save sentence'
);
eq(saveSentence(1), 'The track your filters show. The playlist keeps it; it won’t change when your filters or your library do.', 'save sentence, one');

// The toasts: Play these, with the queue's carry, Shuffle, a row's tap; and the queue's own, from the filters.
eq(filterStartText(10, { row: false, shuffle: false }), 'Playing the 10 tracks your filters show.', 'toast: play these');
eq(`${filterStartText(10, { row: false, shuffle: false })} ${carryText(2)}`, 'Playing the 10 tracks your filters show. Your 2 queued tracks play next.', 'toast: play these, 2 queued');
eq(filterStartText(10, { row: false, shuffle: true }), 'Shuffling the 10 tracks your filters show. Shuffle is on.', 'toast: shuffle');
eq(filterStartText(10, { row: true, shuffle: false }), 'Playing the 10 tracks your filters show, from this one.', 'toast: a row');
eq(filterStartText(1, { row: true, shuffle: false }), 'Playing the track your filters show.', 'toast: a row, one');
eq(filterStartText(1, { row: false, shuffle: true }), 'Shuffling the track your filters show. Shuffle is on.', 'toast: shuffle, one');
eq(filterStartText(1500, { row: false, shuffle: false }), 'Playing the 1,500 tracks your filters show.', 'toast: thousands');
const q = (mode: 'next' | 'queue', nothingCurrent = false) => queuedToast({ name: '10 tracks', mode, position: nothingCurrent ? 1 : 3, noCrystal: false, nothingCurrent, count: 10, from: FROM_FILTERS });
eq(q('next'), 'Playing next: 10 tracks from your filters.', 'toast: play next');
eq(q('queue'), 'Added 10 tracks from your filters to your queue.', 'toast: add to queue');
eq(q('queue', true), 'Queued: 10 tracks from your filters. Play starts with them.', 'toast: add to queue, nothing loaded');

// The empty card, from the model's own hint.
eq(emptyTitle(''), 'No tracks match these filters', 'empty title');
eq(emptyTitle('  deep  '), 'No tracks match ‘deep’ with these filters', 'empty title with a search');
eq(emptyHintLine('10 min or more', 16), 'Without “10 min or more”, 16 tracks match.', 'empty hint');
eq(emptyHintLine('10 min or more', 1), 'Without “10 min or more”, 1 track matches.', 'empty hint, one');
eq(removeFacetText('10 min or more'), 'Remove “10 min or more”', 'empty button');
{
  const songs: FilterSong[] = [
    { id: 'a', name: 'tone-0001', closestSolfeggio: 4212, duration: 200 },
    { id: 'b', name: 'tone-0002', closestSolfeggio: 4212, duration: 240 },
    { id: 'c', name: 'tone-0003', closestSolfeggio: 528, duration: 700 },
  ];
  const f = withFacet(withFacet(NO_FILTERS, 'crystal', ['4212']), 'length', ['ge10']);
  const r = filterPass(buildFacetIndex(songs), f);
  const h = emptyHint(r, f);
  eq(h ? emptyHintLine(h.label, h.count) : null, 'Without “10 min or more”, 2 tracks match.', 'empty hint from the model (the facet that helps most)');
  eq(h ? removeFacetText(h.label) : null, 'Remove “10 min or more”', 'its button');
  eq(activeChips(f).map((c) => removeChipName(c.label)), ['Remove 4212 Hz', 'Remove 10 min or more'], 'the active chips’ names');
}

console.log(`filterViewModel.check: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
