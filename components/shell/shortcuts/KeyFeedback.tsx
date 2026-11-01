// components/shell/shortcuts/KeyFeedback.tsx (v16.7, desktop polish; decision 6 B)
//
// What a key press shows, mounted by AppShell on the desktop shell OUTSIDE the shell region and its inert root (as
// ZenReveal), so it shows while Zen, or full screen's Zen, hides every control:
//   - a small pill over the visuals for 1.2 s for Space/K, ←/→, N/P and M ("Pause", "+5 s", "Next", "Music only: layers
//     off"), the things a key can change while the controls are hidden. aria-hidden, pointer-events-none, no
//     transition and no animation (I13); a new key replaces it; rendered only while shown (idle: nothing in the DOM).
//   - one polite live region (sr-only) that changes only on M, Space and F (full screen entered, left or refused), never
//     on a time tick. The track's title is TrackAnnouncer's.
// Its feed is feedback.ts's emitter (DesktopKeys, immersive.ts). No timer while idle.
// v16.7 review: the pill sits at the top of the open visuals, centred between the nav (and any open panel) and the
// window's right edge (the whole width while Zen hides the controls), measured once as it shows: clear of the notices
// stack (bottom right) and of the transport's tooltips. A line equal to the last one is announced again (the live
// region's text node is replaced).

import React, { useEffect, useRef, useState } from 'react';
import { EyeOff, FastForward, Pause, Play, Rewind, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { useShell } from '../contexts';
import { countRender } from '../devRenders';
import { FEEDBACK_MS, feedbackLive, feedbackText } from './keysModel';
import type { FeedbackKind } from './keysModel';
import { onKeyFeedback } from './feedback';

const ICONS: Partial<Record<FeedbackKind, any>> = {
  play: Play,
  pause: Pause,
  back5: Rewind,
  back30: Rewind,
  forward5: FastForward,
  forward30: FastForward,
  next: SkipForward,
  prev: SkipBack,
  musicOnlyOn: VolumeX,
  musicOnlyOff: Volume2,
  fullscreenFailed: EyeOff,
};

const KeyFeedback = () => {
  countRender('KeyFeedback');
  const [pill, setPill] = useState<{ kind: FeedbackKind; text: string; seq: number; left: number } | null>(null);
  const [live, setLive] = useState<{ text: string; seq: number }>({ text: '', seq: 0 });
  const { zen } = useShell();
  const zenHiddenRef: { current: boolean } = useRef(zen.hidden);
  zenHiddenRef.current = zen.hidden;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let seq = 0;
    // The open visuals' centre: right of the nav and an open panel (none while Zen hides them), to the window's edge.
    const centre = (): number => {
      let start = 0;
      if (!zenHiddenRef.current) {
        for (const sel of ['[data-testid="side-nav"]', '[data-testid="desktop-panel"]']) {
          const el = document.querySelector(sel);
          if (el) start = Math.max(start, el.getBoundingClientRect().right);
        }
      }
      return Math.round((start + window.innerWidth) / 2);
    };
    const off = onKeyFeedback((kind: FeedbackKind) => {
      seq++;
      const line = feedbackLive(kind);
      if (line) setLive({ text: line, seq });
      const text = feedbackText(kind);
      if (!text) return;
      setPill({ kind, text, seq, left: centre() });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setPill(null);
      }, FEEDBACK_MS);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const Icon = pill ? ICONS[pill.kind] : null;
  return (
    <>
      {pill ? (
        <div
          aria-hidden="true"
          data-testid="key-feedback"
          data-kind={pill.kind}
          className="fixed top-6 -translate-x-1/2 z-popover h-10 px-4 rounded-pill bg-surface-panel/90 border border-line-strong shadow-overlay text-sm text-ink-strong flex items-center gap-2 whitespace-nowrap pointer-events-none"
          style={{ left: pill.left }}
        >
          {Icon ? <Icon size={18} className="text-ink-soft" aria-hidden="true" /> : null}
          {pill.text}
        </div>
      ) : null}
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="key-live" className="sr-only">
        {live.text ? <span key={live.seq}>{live.text}</span> : null}
      </div>
    </>
  );
};

export default React.memo(KeyFeedback);
