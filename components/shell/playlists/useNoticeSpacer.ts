// components/shell/playlists/useNoticeSpacer.ts (v16.1)
//
// On the phone the notices (the Undo toast, the update banner) sit over the bottom of a scroller, above the mini-player:
// a spacer as tall as they are ends the scroller, so every row can scroll clear of them (LibraryTracks' rule, v15.7).
// Set on the element, never through state (no render).

import { useEffect } from 'react';

export function useNoticeSpacer(spacerRef: { current: HTMLDivElement | null }, inPanel: boolean, dep: unknown): void {
  useEffect(() => {
    const notices = document.querySelector('[data-testid="notices"]');
    const spacer = spacerRef.current;
    if (inPanel || !notices || !spacer || typeof ResizeObserver !== 'function') return;
    const fit = () => {
      const h = notices.getBoundingClientRect().height;
      spacer.style.height = h > 0 ? `${Math.ceil(h) + 8}px` : '0px';
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(notices);
    return () => ro.disconnect();
  }, [inPanel, dep]);
}
