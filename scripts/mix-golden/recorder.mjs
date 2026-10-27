// v15.8 golden harness: the recorder. One self-contained function (no imports, no closures over this file), so the
// very same source runs in Node and, through page.evaluate, in Chrome: the engine-parity check compares the two.
//
// runScenarios(makeApp, deps, fixtures, scenarios, gens, mulberry32Src) runs each generator under each scenario with:
//   - a seeded Math.random (mulberry32(seed)) for exactly the duration of the run, restored after;
//   - App's state as plain values (originalPlaylist = the fixture library, the play order, the experience level,
//     isScanning, the play history object) and every setter, ref, toast and timer as a recorder;
//   - setTimeout on a fake clock, drained after the call in (due, registration) order, so nested notices replay with
//     their times;
//   - a toast's action button pressed, so its Details dialog is captured;
// and returns, per run, the raw calls in order, a canonical record (the final value of each setter after React's
// batch, the play calls, toasts, the notice timeline, the library patch), and derived walk facts (expected steps).

export function runScenarios(makeApp, deps, fixtures, scenarios, gens, mulberry32Src) {
  const mulberry32 = new Function('return ' + mulberry32Src)();
  const { LO_SHU_WALKS } = deps;
  const out = {};
  const idsOf = (arr) => arr.map((s) => (s && typeof s === 'object' ? s.id : s));
  const crystalTriple = (s) => (s.crystalSource === undefined ? [s.harmonicFreq ?? null, s.closestSolfeggio ?? null, s.harmonicDeviation ?? null] : [s.harmonicFreq ?? null, s.closestSolfeggio ?? null, s.harmonicDeviation ?? null, s.crystalSource]);
  const WALK_GENS = { gut: 'traditional', 'walk:A': 'A', 'walk:B': 'B', 'walk:C': 'C', 'walk:traditional': 'traditional', 'walk:combined': 'combined', 'walk:ouroboros': 'ouroboros', 'walk:cabi': 'cabi' };

  for (const sc of scenarios) {
    const lib = fixtures[sc.fixture];
    const history = sc.history ? JSON.parse(JSON.stringify(sc.history)) : {};
    for (const gen of gens) {
      if (sc.only && !sc.only.includes(gen)) continue;
      // v15.9: optional scenario parts (added to the key only when present, so every older key stays as it was): the
      // new layout (shell), and a play order other than the library with a cursor and shuffle (Restore Library).
      const extra = [sc.shell ? 'shell' : null, sc.playOrder ? `po:${sc.playOrder.from}+${sc.playOrder.count}${sc.playOrder.reverse ? 'r' : ''}@${sc.cursor}${sc.shuffle ? 's' : ''}` : null].filter(Boolean);
      const key = [gen, sc.fixture, sc.exp, sc.historyName || 'none', sc.seed, sc.width, sc.scanning ? 'scan' : 'idle', ...extra].join('|');
      const calls = [];
      const timers = [];
      let now = 0;
      let seq = 0;
      const playOrder = sc.playOrder ? (() => { const p = lib.slice(sc.playOrder.from, sc.playOrder.from + sc.playOrder.count); return sc.playOrder.reverse ? p.reverse() : p; })() : lib;
      const listArg = (v, base) => {
        if (typeof v === 'function') {
          const res = v(base);
          const changed = [];
          for (let i = 0; i < res.length; i++) if (res[i] !== base[i]) changed.push([res[i].id, crystalTriple(res[i])]);
          return { updater: true, same: res === base, ids: idsOf(res), changed };
        }
        return { ids: idsOf(v), isLibrary: v === lib };
      };
      const set = (op) => (v) => calls.push([op, v]);
      const env = {
        originalPlaylist: lib,
        playlist: playOrder,
        userExperienceLevel: sc.exp,
        isScanning: !!sc.scanning,
        playHistoryRef: { current: history },
        loShuWalkSnapshotRef: {
          get current() { return ''; },
          set current(v) { calls.push(['walkSnapshot', v]); },
        },
        playTrackRef: { current: (i, list) => { calls.push(['playTrack', i, list ? idsOf(list) : null]); return Promise.resolve(); } },
        window: { innerWidth: sc.width },
        setTimeout: (fn, ms) => { timers.push({ due: now + (ms || 0), seq: seq++, fn, ms: ms ?? null }); calls.push(['setTimeout', ms ?? null]); return seq; },
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        setPlaylist: (v) => calls.push(['setPlaylist', listArg(v, playOrder)]),
        setOriginalPlaylist: (v) => calls.push(['setOriginalPlaylist', listArg(v, lib)]),
        setUseChakraOrder: set('setUseChakraOrder'),
        setCurrentSongIndex: set('setCurrentSongIndex'),
        setSearchTerm: set('setSearchTerm'),
        setShowSidebar: set('setShowSidebar'),
        setLoShuWalkMode: set('setLoShuWalkMode'),
        setLoShuWalkSegments: (v) => calls.push(['setLoShuWalkSegments', v === null ? null : [...v]]),
        setLoShuWalkPhases: (v) => calls.push(['setLoShuWalkPhases', v === null ? null : [...v]]),
        setLoShuWalkSteps: (v) => calls.push(['setLoShuWalkSteps', v === null ? null : [...v]]),
        setVizSettings: (v) => calls.push(['setVizSettings', typeof v === 'function' ? { patch: v({}) } : v]),
        setUserExperienceLevel: set('setUserExperienceLevel'),
        setAnalysisNotification: (v) => calls.push(['notice', v, now]),
        setShowLoShuWalkMenu: set('setShowLoShuWalkMenu'),
        setSelectedSolfeggio: set('setSelectedSolfeggio'),
        showStatusToast: (message, opts) => {
          calls.push(['toast', message, opts?.durationMs ?? null, opts?.actionLabel ?? null, !!opts?.sticky]);
          if (opts?.onAction) { calls.push(['toastAction']); opts.onAction(); }
        },
        dismissStatusToast: () => calls.push(['dismissToast']),
        setInfoDialog: (v) => calls.push(['infoDialog', v]),
        // v15.9: every mix plays through App's startPlayOrder (recorded with what it is given, never run), the new
        // layout's flag, the play state Restore Library reads, and the shuffle setters.
        startPlayOrder: (order, index, text, opts) => calls.push(['startPlayOrder', {
          ids: idsOf(order), index, text,
          walk: opts && opts.walk ? { mode: opts.walk.mode, segments: opts.walk.segments ? [...opts.walk.segments] : null, phases: opts.walk.phases ? [...opts.walk.phases] : null, steps: opts.walk.steps ? [...opts.walk.steps] : null } : null,
          viz: opts && opts.viz ? { ...opts.viz } : null,
          mix: !!(opts && opts.mix),
        }]),
        shellOnRef: { current: !!sc.shell },
        stateRef: { current: { playlist: playOrder, currentSongIndex: sc.cursor ?? (playOrder.length ? 0 : -1), isShuffle: !!sc.shuffle, isLoop: false, shuffledIndices: [], shufflePos: 0 } },
        setShuffledIndices: (v) => calls.push(['setShuffledIndices', [...v]]),
        setShufflePos: set('setShufflePos'),
        // Never a start in flight here (no music element), and a notice's text is only remembered.
        mixNoticeRef: { current: null },
        mainAudioRef: { current: null },
        startedRequestRef: { current: 0 },
        playRequestSeqRef: { current: 0 },
        playStartBusyRef: { current: false },
        blobUrlsRef: { current: {} },
        ...deps,
      };
      const realRandom = Math.random;
      let thrown = null;
      let ret;
      Math.random = mulberry32(sc.seed);
      let rngCalls = 0;
      const seeded = Math.random;
      Math.random = () => { rngCalls++; return seeded(); };
      try {
        const app = makeApp(env);
        const fn = gen.startsWith('walk:') ? () => app.generateLoShuWalk(gen.slice(5))
          : gen === 'gut' ? app.generateAlignmentJourney
          : gen === 'heart' ? app.generateHeartAlignmentJourney
          : gen === 'head' ? app.generateHeadAlignmentJourney
          : gen === 'full' ? app.generateFullLibraryAlignment
          : gen === 'preset:qi' ? app.__jsx.qi
          : gen === 'preset:healing' ? app.generateWellnessPlaylist
          : gen === 'preset:mood' ? app.generateMoodPlaylist
          : gen === 'preset:meditation' ? app.generateMeditationPlaylist
          : gen === 'preset:flow' ? app.__jsx.flow
          : gen === 'golden' ? app.generateGoldenRatioPlaylist
          : gen === 'seq111' ? app.generate111PatternPlaylist
          : gen === 'source2178' ? app.generateSourceFieldPlaylist
          : gen === 'ultimate' ? app.generateUltimateAlignmentPlaylist
          : gen === 'restore' ? app.restoreLibrary
          : gen === 'autoDistribute' ? app.autoDistribute
          : gen === 'filtered' ? () => app.generateFilteredPlaylist((s) => s.closestSolfeggio === 528 || s.closestSolfeggio === 2178, 'Filter test')
          : gen === 'aetheriaJourney' ? app.generateAetheriaJourney
          : gen === 'aetheriaOnly' ? app.showAetheriaTracksOnly
          : null;
        if (!fn) throw new Error('unknown generator ' + gen);
        ret = fn();
        // Drain the fake clock.
        while (timers.length) {
          timers.sort((a, b) => a.due - b.due || a.seq - b.seq);
          const t = timers.shift();
          now = t.due;
          t.fn();
        }
      } catch (e) {
        thrown = String(e && e.message || e);
      } finally {
        Math.random = realRandom;
      }
      // Canonical record: what React's batch leaves, plus the ordered non-state effects.
      const canon = { state: {}, play: [], toasts: [], notices: [], timers: [], thrown };
      for (const c of calls) {
        const [op] = c;
        if (op === 'playTrack') canon.play.push([c[1], c[2]]);
        else if (op === 'toast') canon.toasts.push({ message: c[1], durationMs: c[2], actionLabel: c[3], sticky: c[4], action: [] });
        else if (op === 'toastAction' || op === 'dismissToast' || op === 'infoDialog') {
          const last = canon.toasts[canon.toasts.length - 1];
          if (last) last.action.push(op === 'infoDialog' ? ['infoDialog', c[1]] : [op]);
          else canon.state[op] = c[1] ?? true;
        } else if (op === 'notice') canon.notices.push([c[2], c[1]]);
        else if (op === 'setTimeout') canon.timers.push(c[1]);
        else if (op === 'setVizSettings') canon.state.setVizSettings = { ...(canon.state.setVizSettings || {}), ...(c[1].patch || c[1]) };
        else canon.state[op] = c[1];
      }
      // Derived walk facts: the sequence position each entry fills (the rule: a position is skipped iff no library
      // track has that crystal), and how far the cube's index (the cursor) lags behind it.
      let derived = null;
      const mode = WALK_GENS[gen];
      const order = (canon.state.setPlaylist && canon.state.setPlaylist.ids) || (canon.state.startPlayOrder && canon.state.startPlayOrder.ids);
      if (mode && order) {
        const seqArr = LO_SHU_WALKS[mode];
        const has = new Set(lib.filter((s) => s.closestSolfeggio).map((s) => s.closestSolfeggio));
        const steps = [];
        seqArr.forEach((f, j) => { if (has.has(f)) steps.push(j); });
        const byId = new Map(lib.map((s) => [s.id, s]));
        const consistent = steps.length === order.length && order.every((id, i) => byId.get(id).closestSolfeggio === seqArr[steps[i]]);
        const cursorCrystalMismatch = order.reduce((n, id, i) => n + (byId.get(id).closestSolfeggio !== seqArr[i] ? 1 : 0), 0);
        derived = { sequenceLength: seqArr.length, expectedSteps: steps, consistent, driftEntries: steps.filter((s, i) => s !== i).length, maxLag: steps.reduce((m, s, i) => Math.max(m, s - i), 0), cursorCrystalMismatch };
      }
      out[key] = { calls, canon, derived, rngCalls, returned: ret instanceof Promise ? 'promise' : ret === undefined ? null : String(ret) };
    }
  }
  return out;
}
