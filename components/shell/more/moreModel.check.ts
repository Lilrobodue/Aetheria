// Checks for components/shell/more/moreModel.ts (v16.4, the More area: its pages, its rows, About's status lines).
// Run with: node components/shell/more/moreModel.check.ts   (npm run check:shell; Node 22.18+ strips the types)
// Exits non-zero on any failure.

import fs from 'node:fs';
import {
  MORE_VIEWS,
  isMoreView,
  VIEW_TITLES,
  backTarget,
  backLabel,
  GROUP_VISUALS,
  GROUP_SAFETY,
  GROUP_ABOUT,
  GROUP_CLASSIC,
  SAFETY_ROW_SUBTITLE,
  LINKS_ROW_SUBTITLE,
  CLASSIC_ROW_TITLE,
  CLASSIC_ROW_SUBTITLE,
  TOUR_ROW_SUBTITLE,
  STATEMENT_ROW_SUBTITLE,
  aboutRowSubtitle,
  KEEP_AWAKE_KEY,
  parseKeepAwake,
  KEEP_AWAKE_LINE,
  STOP_ALL_LINE,
  statementVersionLine,
  isAppCacheKey,
  offlineCacheName,
  aboutStatus,
  checkAfterUpdate,
  settleCheck,
  openerOf,
  onMoreRootRequest,
  requestMoreRoot,
} from './moreModel.ts';
import type { AboutInput, MoreView, MoreViewState, UpdateCheck } from './moreModel.ts';

let passed = 0;
const failures: string[] = [];
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) === JSON.stringify(b)) passed++;
  else failures.push(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

// The pages.
eq(MORE_VIEWS, ['root', 'safety', 'statement', 'about', 'links'], "v16.4's pages");
eq([isMoreView('about'), isMoreView('guide'), isMoreView(null), isMoreView(3)], [true, false, false, false], 'a page or not');
eq(MORE_VIEWS.map((v) => VIEW_TITLES[v]), ['More', 'Safety & comfort', 'Safety statement', 'About', 'Links'], 'the headers');
eq(MORE_VIEWS.map((v) => backTarget(v)), ['root', 'root', 'safety', 'root', 'root'], 'where Back goes');
eq([backLabel('safety'), backLabel('statement'), backLabel('links')], ['Back to More', 'Back to Safety & comfort', 'Back to More'], "Back's name");
// v16.4 review: Links opened from About's row goes back to About; from the root, to the root.
eq(MORE_VIEWS.map((v) => openerOf(v, 'links') ?? null), [null, null, null, 'about', null], "only About is remembered as Links' opener");
eq(MORE_VIEWS.map((v) => openerOf('about', v) ?? null), [null, null, null, null, 'about'], 'and only for Links');
eq([backTarget('links', 'about'), backTarget('links', 'root'), backTarget('links', null), backTarget('about', 'about'), backTarget('statement', 'about')], ['about', 'root', 'root', 'root', 'safety'], 'Back with an opener');
eq([backLabel('links', 'about'), backLabel('links')], ['Back to About', 'Back to More'], "Back's name with an opener");

// The rows' words.
eq([GROUP_VISUALS, GROUP_SAFETY, GROUP_ABOUT, GROUP_CLASSIC], ['Visuals and recording', 'Safety', 'About', 'In the classic layout for now'], 'the headings');
eq(SAFETY_ROW_SUBTITLE, 'Stop all sound, Music only, the safety statement', 'Safety & comfort');
eq(LINKS_ROW_SUBTITLE, 'Apps, books, music, community and contact', 'Links');
eq([CLASSIC_ROW_TITLE, CLASSIC_ROW_SUBTITLE], ['Guide, Record, Journal, scan scores', 'Use the classic layout; the music keeps playing'], 'the classic row');
eq(TOUR_ROW_SUBTITLE, 'Four cards: your music, the 27 crystals, the layers, where things are', 'Show the tour');
eq(STATEMENT_ROW_SUBTITLE, 'What this tool is and is not; photosensitivity, audio, data', 'Safety statement');
eq([aboutRowSubtitle('v16.4', false), aboutRowSubtitle('v16.4', true), aboutRowSubtitle(null, true)], ['Version v16.4', 'Version v16.4 · an update is ready', 'Version · an update is ready'], 'About, with and without an update');

// Keep screen awake: unset is on (today's behaviour); only 'false' is off.
eq(KEEP_AWAKE_KEY, 'aetheria.keepAwake.v1', 'the key');
eq([parseKeepAwake(null), parseKeepAwake(undefined), parseKeepAwake('true'), parseKeepAwake('false'), parseKeepAwake('0')], [true, true, true, false, true], 'the stored value');
eq(KEEP_AWAKE_LINE, 'While music plays, the screen stays on. Off: it sleeps as your phone is set to, and the music plays on. Saved.', 'its line');
eq(STOP_ALL_LINE, 'The music, the tone, the beat and the drone', "Stop all's line (the ⋯ row's)");
eq(statementVersionLine('2026-10-21'), 'Shown when you first open Aetheria, and again whenever it changes (this version: 2026-10-21).', 'the version line');

// About's status lines over controller × cache keys × online × update × audible × recording.
// v16.4 review: only THIS version's offline cache counts.
eq(offlineCacheName('v16.4'), 'aetheria-v16.4-offline', "this version's cache");
eq(
  [
    isAppCacheKey('aetheria-v16.4-offline', 'v16.4'),
    isAppCacheKey('aetheria-v16.1-offline', 'v16.4'),
    isAppCacheKey('aetheria-v16.5-offline', 'v16.4'),
    isAppCacheKey('workbox-precache', 'v16.4'),
    isAppCacheKey(null, 'v16.4'),
    isAppCacheKey('aetheria-v16.4-offline', ''),
    isAppCacheKey('aetheria--offline', ''),
  ],
  [true, false, false, false, false, false, false],
  'the cache name'
);
// public/sw.js names its cache from the same version as the header badge (else About would never say "Works offline").
{
  const sw = fs.readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8');
  const eb = fs.readFileSync(new URL('../../ErrorBoundary.tsx', import.meta.url), 'utf8');
  const cache = /const CACHE_NAME = '([^']+)'/.exec(sw)?.[1];
  const version = /export const APP_VERSION = '([^']+)'/.exec(eb)?.[1];
  eq(!!version && cache === offlineCacheName(version), true, `sw.js CACHE_NAME (${cache}) is offlineCacheName(APP_VERSION ${version})`);
}
const KEYS: Array<ReadonlyArray<string> | null> = [null, [], ['other'], ['aetheria-v16.4-offline'], ['x', 'aetheria-v16.1-offline'], ['aetheria-v16.5-offline']];
let combos = 0;
for (const controller of [false, true]) {
  for (const cacheKeys of KEYS) {
    for (const online of [false, true]) {
      for (const updateReady of [false, true]) {
        for (const audible of [false, true]) {
          for (const recording of [false, true]) {
            const input: AboutInput = { controller, cacheKeys, version: 'v16.4', online, registration: true, updateReady, audible, recording, check: 'idle' };
            const s = aboutStatus(input);
            const saved = controller && !!cacheKeys && cacheKeys.includes('aetheria-v16.4-offline');
            const ok =
              s.offline.saved === saved &&
              s.offline.title === (saved ? 'Works offline' : 'Not saved for offline use yet') &&
              s.offline.sub === (saved ? 'This version is saved on this device' : 'It is saved after the first full load with a connection') &&
              s.network.title === (online ? 'Online' : 'Offline') &&
              s.network.sub === (online ? 'Updates are checked when the app opens' : 'The app works offline; updates wait for a connection') &&
              (updateReady
                ? s.update !== null &&
                  s.update.text === (audible ? 'A new version of Aetheria is ready. Reloading stops the music.' : 'A new version of Aetheria is ready.') &&
                  s.update.reloadDisabled === recording &&
                  s.update.note === (recording ? 'Stop the recording first: reloading would lose it.' : null)
                : s.update === null) &&
              s.checkDisabled === !online;
            if (ok) combos++;
            else failures.push(`aboutStatus ${JSON.stringify(input)} → ${JSON.stringify(s)}`);
          }
        }
      }
    }
  }
}
eq(combos, 2 * 6 * 2 * 2 * 2 * 2, 'every combination');
eq(aboutStatus({ controller: true, cacheKeys: ['aetheria-v16.4-offline'] }).offline.saved, false, 'no version: not saved');
eq(aboutStatus({ online: true, registration: false }).checkDisabled, true, 'no registration: Check for updates is off');
const lines = (['idle', 'checking', 'latest', 'downloading', 'failed'] as UpdateCheck[]).map((check) => aboutStatus({ online: true, registration: true, check }));
eq(lines.map((l) => l.checkLine), [null, 'Checking…', 'This is the latest version.', 'Downloading the new version…', "Couldn't check for updates."], 'the check lines');
eq(lines.map((l) => l.checkDisabled), [false, true, false, false, false], 'disabled while checking');
// v16.4 review: "Downloading the new version…" follows the new worker and never stays.
eq(
  [checkAfterUpdate(null), checkAfterUpdate(undefined), checkAfterUpdate('installing'), checkAfterUpdate('parsed'), checkAfterUpdate('installed'), checkAfterUpdate('activated'), checkAfterUpdate('redundant')],
  ['latest', 'latest', 'downloading', 'downloading', 'idle', 'idle', 'failed'],
  'the line right after update()'
);
eq(['installing', 'installed', 'activating', 'activated', 'redundant', null].map((st) => settleCheck('downloading', st)), ['downloading', 'idle', 'idle', 'idle', 'failed', 'downloading'], 'downloading, as the worker moves on');
eq((['idle', 'checking', 'latest', 'failed'] as UpdateCheck[]).map((c) => settleCheck(c, 'installed')), ['idle', 'checking', 'latest', 'failed'], 'another line is kept');
const none = aboutStatus(null);
eq([none.offline.title, none.network.title, none.update, none.checkDisabled, none.checkLine], ['Not saved for offline use yet', 'Online', null, true, null], 'total on missing input');
eq(aboutStatus({ controller: true, cacheKeys: 'nope' as unknown as string[] }).offline.saved, false, 'cache keys of the wrong shape');

// A tap on the active More tab.
{
  let n = 0;
  const off = onMoreRootRequest(() => n++);
  requestMoreRoot();
  off();
  requestMoreRoot();
  eq(n, 1, 'the mounted tab hears the request; once unmounted, nothing');
  // v16.4 review: with no More tab mounted, the place it was left becomes the root (it opens there next time)...
  const ref: { current: MoreViewState } = { current: { view: 'about' as MoreView, top: 120 } };
  requestMoreRoot(ref);
  eq(ref.current, { view: 'root', top: 0 }, 'unmounted: the root next time');
  const links: { current: MoreViewState } = { current: { view: 'links', top: 40, from: 'about' } };
  requestMoreRoot(links);
  eq(links.current, { view: 'root', top: 0 }, 'unmounted: the opener goes too');
  // ...and with one mounted, the tab answers (and moves its own ref).
  let heard = 0;
  const off2 = onMoreRootRequest(() => heard++);
  const kept: { current: MoreViewState } = { current: { view: 'safety', top: 10 } };
  requestMoreRoot(kept);
  off2();
  eq([heard, kept.current.view], [1, 'safety'], "mounted: the tab hears it; the ref is the tab's to move");
}

console.log(`moreModel: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
