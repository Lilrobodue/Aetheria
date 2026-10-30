// components/shell/more/AboutPage.tsx (v16.4, More › About; mockup about-phone)
//
// The version (APP_VERSION, which isolation.spec keeps equal to classic's header badge); the update card while one is
// ready, in the shared toast's words (Reload = App's flushAndReload by reference; Later = the toast's dismiss), which
// refuses to reload while a recording runs (the shared toast is unchanged); the offline and network status and Check
// for updates; Show the tour; Links; and the disclaimer's data sentence.
// The status is the page's own (no App state), event-driven, never a timer: caches.keys() on mount and again whenever
// the service worker changes something (v16.4 review: a new controller, a worker's state, its "cached" message), the
// SW registration once, the online / offline events. Only THIS version's offline cache counts as saved. Check for
// updates asks the registration to update; "Downloading the new version…" follows the new worker and clears once it
// has installed (the usual card then comes through index.tsx's onUpdate) or says it couldn't when the install fails.
// Nothing here ever reloads by itself.

import React, { useEffect, useRef, useState } from 'react';
import { Activity as PulseIcon, CloudCheck, CloudOff, Compass, ExternalLink, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import Button from '../../ui/Button';
import ListRow from '../../ui/ListRow';
import { APP_VERSION } from '../../ErrorBoundary';
import { useActions, useMore } from '../contexts';
import { countRender } from '../devRenders';
import { LINKS_ROW_SUBTITLE, TOUR_ROW_SUBTITLE, aboutStatus, checkAfterUpdate, settleCheck } from './moreModel';
import type { MoreView, UpdateCheck } from './moreModel';

/** The disclaimer's own data sentence, verbatim. */
export const DATA_SENTENCE = 'Nothing about your listening sessions leaves your device.';

function swContainer(): ServiceWorkerContainer | null {
  try {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
  } catch {
    return null;
  }
}

const StatusLine = ({ icon, title, sub, testId }: { icon: React.ReactNode; title: string; sub: string; testId: string }) => (
  <div className="flex items-center gap-3 py-2" data-testid={testId}>
    <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control bg-surface-raised flex items-center justify-center text-ink-soft">
      {icon}
    </span>
    <span className="min-w-0">
      <span className="block text-sm text-ink-strong">{title}</span>
      <span className="block text-xs text-ink-muted">{sub}</span>
    </span>
  </div>
);

const AboutPage = ({ go }: { go: (v: MoreView) => void }) => {
  countRender('AboutPage');
  const actions = useActions();
  const { updateReady, audible, recording } = useMore();
  const [cacheKeys, setCacheKeys] = useState<string[] | null>(null);
  const [controller, setController] = useState<boolean>(() => !!swContainer()?.controller);
  const [online, setOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine !== false : true));
  const [registration, setRegistration] = useState(false);
  const [check, setCheck] = useState<UpdateCheck>('idle');
  const aliveRef: { current: boolean } = useRef(true);
  // Undoes whatever this page is listening to (the registration, its workers, the worker a check follows).
  const unlistenRef: { current: Array<() => void> } = useRef([]);

  useEffect(() => {
    aliveRef.current = true;
    // This run's own flag (StrictMode's dev remount runs the effect twice: the first run's late answers stay quiet).
    let live = true;
    const listen = (target: EventTarget | null | undefined, type: string, fn: EventListener) => {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, fn);
      unlistenRef.current.push(() => target.removeEventListener(type, fn));
    };
    // What is cached and who serves the page: on mount, and again on each service-worker event below.
    const readStatus = () => {
      if (!live) return;
      setController(!!swContainer()?.controller);
      try {
        if (typeof caches !== 'undefined') {
          caches.keys().then(
            (k) => live && setCacheKeys(k),
            () => live && setCacheKeys([])
          );
        } else setCacheKeys([]);
      } catch {
        setCacheKeys([]);
      }
    };
    readStatus();
    const sw = swContainer();
    // A worker's state (installed, activated, redundant) changes what is cached and who serves the page.
    const followed = new Set<EventTarget>();
    const follow = (w: ServiceWorker | null | undefined) => {
      if (!w || followed.has(w)) return;
      followed.add(w);
      listen(w, 'statechange', readStatus);
    };
    try {
      sw?.getRegistration().then(
        (r) => {
          if (!live) return;
          setRegistration(!!r);
          if (!r) return;
          follow(r.installing);
          follow(r.waiting);
          follow(r.active);
          listen(r, 'updatefound', () => {
            follow(r.installing);
            readStatus();
          });
        },
        () => {}
      );
    } catch {}
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    // The worker's own word that it cached this page's files (public/sw.js's OFFLINE_READY).
    const onMessage = (e: Event) => {
      if ((e as MessageEvent).data?.type === 'OFFLINE_READY') readStatus();
    };
    listen(window, 'online', onOnline);
    listen(window, 'offline', onOffline);
    listen(sw, 'controllerchange', readStatus);
    listen(sw, 'message', onMessage);
    return () => {
      live = false;
      aliveRef.current = false;
      for (const off of unlistenRef.current.splice(0)) off();
    };
  }, []);

  const checkForUpdates = async () => {
    setCheck('checking');
    try {
      const r = await swContainer()?.getRegistration();
      if (!r) {
        if (aliveRef.current) setCheck('failed');
        return;
      }
      await r.update();
      if (!aliveRef.current) return;
      const w = r.installing || r.waiting;
      const next = checkAfterUpdate(w ? w.state : null);
      setCheck(next);
      if (w && next === 'downloading') {
        // Follow the new worker: installed clears the line, redundant (or an error) says it couldn't.
        const onState = () => {
          if (aliveRef.current) setCheck((c) => settleCheck(c, w.state));
        };
        const onError = () => {
          if (aliveRef.current) setCheck((c) => settleCheck(c, 'redundant'));
        };
        w.addEventListener('statechange', onState);
        w.addEventListener('error', onError);
        unlistenRef.current.push(() => {
          w.removeEventListener('statechange', onState);
          w.removeEventListener('error', onError);
        });
      }
    } catch {
      if (aliveRef.current) setCheck('failed');
    }
  };

  const s = aboutStatus({ controller, cacheKeys, version: APP_VERSION, online, registration, updateReady, audible, recording: !!recording, check });
  return (
    <div data-testid="more-about" className="px-4 py-3 space-y-3">
      <div className="flex items-center gap-3 py-2">
        <span aria-hidden="true" className="shrink-0 w-12 h-12 rounded-pill bg-gold-500 flex items-center justify-center text-black">
          <PulseIcon size={24} />
        </span>
        <span>
          <span className="block text-lg font-serif tracking-[0.2em] text-gold-400">AETHERIA</span>
          <span className="block text-sm text-ink-muted tabular-nums" data-testid="about-version">
            Version {APP_VERSION} · new layout (beta)
          </span>
        </span>
      </div>
      {s.update ? (
        <div className="p-3 rounded-card border border-line-strong bg-surface-panel" data-testid="about-update">
          <p className="text-sm text-ink-strong">{s.update.text}</p>
          <div className="mt-2 flex gap-2">
            <Button variant="primary" onClick={actions.reloadForUpdate} disabled={s.update.reloadDisabled} data-testid="about-reload">
              Reload
            </Button>
            <Button variant="secondary" onClick={actions.dismissUpdate} data-testid="about-later">
              Later
            </Button>
          </div>
          {s.update.note ? (
            <p className="mt-2 text-xs text-ink-muted" data-testid="about-reload-note">
              {s.update.note}
            </p>
          ) : null}
        </div>
      ) : null}
      <section aria-labelledby="about-h-status" className="rounded-card bg-surface-panel border border-line p-4" data-testid="about-status">
        <h2 id="about-h-status" className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
          Status
        </h2>
        <div className="mt-2 space-y-3">
          <StatusLine
            testId="about-offline"
            icon={s.offline.saved ? <CloudCheck size={20} /> : <CloudOff size={20} />}
            title={s.offline.title}
            sub={s.offline.sub}
          />
          <StatusLine testId="about-network" icon={online ? <Wifi size={20} /> : <WifiOff size={20} />} title={s.network.title} sub={s.network.sub} />
          <Button
            variant="secondary"
            onClick={checkForUpdates}
            disabled={s.checkDisabled}
            className="w-full flex items-center justify-center gap-2"
            data-testid="about-check"
          >
            <RefreshCw size={16} className="text-ink-muted" aria-hidden="true" />
            Check for updates
          </Button>
          {s.checkLine ? (
            <p className="text-xs text-ink-muted" data-testid="about-check-line">
              {s.checkLine}
            </p>
          ) : null}
        </div>
      </section>
      <div className="rounded-card bg-surface-panel border border-line overflow-hidden">
        <ListRow title="Show the tour" subtitle={TOUR_ROW_SUBTITLE} icon={<Compass size={20} />} chevron onClick={actions.showTour} data-testid="about-tour-row" />
        <ListRow title="Links" subtitle={LINKS_ROW_SUBTITLE} icon={<ExternalLink size={20} />} chevron onClick={() => go('links')} data-testid="about-links-row" />
      </div>
      <p className="text-xs text-center text-ink-faint leading-snug">{DATA_SENTENCE}</p>
    </div>
  );
};

export default React.memo(AboutPage);
