// components/shell/SeekBar.tsx (v15.5, the new layout beta)
//
// Now Playing's seek bar: a 44 px row around a 4 px rail, the progress in gold (the φ progress) and, while φ timing
// is on, two static ticks at 38.2 % and 61.8 % (never animated: classic's pulsing φ marker restyled the page every
// frame, spec §2.5). A slider for assistive tech: "1:12 of 3:15"; arrows ±5 s, PageUp/PageDown ±30 s, Home/End.
// One of the few readers of the time context, so it alone (with TimeText and MiniProgress) follows the 4 Hz clock.
// A drag shows its position here and seeks once, when the finger lifts: a seek per pointermove was a media seek and an
// App render 60-120 times a second, and dragging through the track's last seconds could start auto-advances mid-drag.
// A tap seeks on release, the keys at once.

import React, { useRef, useState } from 'react';
import { useActions, useTime } from './contexts';
import { countRender } from './devRenders';
import { formatTime, PHI_BUILD_END, PHI_PEAK } from './shellModel';

interface SeekBarProps {
  /** φ mode and φ timing on (the ticks also need a duration). */
  phi: boolean;
  /** 'desktop': the transport's thin rail, its times beside it. */
  variant?: 'phone' | 'desktop';
}

const SeekBar = ({ phi, variant = 'phone' }: SeekBarProps) => {
  countRender('SeekBar');
  const { t, d } = useTime();
  const actions = useActions();
  const dragging: { current: boolean } = useRef(false);
  // While a finger or the mouse holds the bar: where it is (0..1), shown instead of the time; null otherwise.
  const [drag, setDrag] = useState<number | null>(null);
  const dragRef: { current: number | null } = useRef(null);
  const pct = drag !== null ? drag * 100 : d > 0 ? Math.min(100, Math.max(0, (t / d) * 100)) : 0;
  const ticks = phi && d > 0;

  const fractionAt = (el: HTMLElement, clientX: number): number | null => {
    const r = el.getBoundingClientRect();
    return r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : null;
  };
  const holdAt = (f: number | null) => {
    if (f === null) return;
    dragRef.current = f;
    setDrag(f);
  };
  // One seek, on release (or a cancelled pointer): to where the bar was last held.
  const release = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const f = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (f !== null) actions.seekTo(f);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const step: Record<string, number> = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 30, PageDown: -30 };
    if (e.key in step) actions.seekBy(step[e.key]);
    else if (e.key === 'Home') actions.seekTo(0);
    else if (e.key === 'End') actions.seekTo(0.999);
    else return;
    e.preventDefault();
  };

  const slider = (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(d)}
      aria-valuenow={Math.round(t)}
      aria-valuetext={`${formatTime(t)} of ${formatTime(d)}`}
      data-testid="np-seek"
      onKeyDown={onKeyDown}
      onPointerDown={(e: PointerEvent & { currentTarget: HTMLElement }) => {
        dragging.current = true;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
        holdAt(fractionAt(e.currentTarget, e.clientX));
      }}
      onPointerMove={(e: PointerEvent & { currentTarget: HTMLElement }) => {
        if (dragging.current) holdAt(fractionAt(e.currentTarget, e.clientX));
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      className={
        variant === 'desktop'
          ? 'relative flex-1 h-touch flex items-center cursor-pointer touch-none rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400'
          : 'relative h-touch flex items-center cursor-pointer touch-none rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400'
      }
    >
      <div className="relative w-full h-1 rounded-pill bg-surface-control">
        <div data-testid="np-seek-progress" className="absolute inset-y-0 left-0 rounded-pill bg-gold-500" style={{ width: `${pct}%` }} />
        {ticks ? (
          <>
            <span aria-hidden="true" className="absolute -top-1.5 h-4 w-0.5 rounded-pill bg-ink-faint" style={{ left: `${PHI_BUILD_END * 100}%` }} />
            <span aria-hidden="true" className="absolute -top-1.5 h-4 w-0.5 rounded-pill bg-ink-faint" style={{ left: `${PHI_PEAK * 100}%` }} />
          </>
        ) : null}
        {variant === 'phone' ? (
          <span aria-hidden="true" className="absolute top-1/2 -translate-y-1/2 -ml-2 w-4 h-4 rounded-pill bg-ink-strong shadow-raised" style={{ left: `${pct}%` }} />
        ) : null}
      </div>
    </div>
  );

  if (variant === 'phone') return slider;
  return (
    <div className="w-full flex items-center gap-3 text-xs tabular-nums text-ink-muted">
      <span data-testid="desktop-time-elapsed">{formatTime(t)}</span>
      {slider}
      <span>{formatTime(d)}</span>
    </div>
  );
};

export default React.memo(SeekBar);
