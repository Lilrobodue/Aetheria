// components/shell/more/externalLinks.tsx (v16.4, the More area)
//
// The installed PWA's guard for external links: in standalone mode a browser may ignore target="_blank" and open the
// link INSIDE the app's window, replacing the player and stopping the music. So a tap on any http(s) anchor inside
// the guard becomes window.open(href, '_blank', 'noopener,noreferrer'), which hands it to the system browser; mailto:
// and tel: pass through to the OS. openExternalLink is classic's Links panel handler (App, "Links & Resources Panel"),
// as a named function; classic keeps its own inline copy.

import React from 'react';
import type { ReactNode } from 'react';

export function openExternalLink(e: { target: EventTarget | null; preventDefault: () => void }): void {
  const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!anchor) return;
  const href = anchor.getAttribute('href') || '';
  if (href.startsWith('http://') || href.startsWith('https://')) {
    e.preventDefault();
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

export const ExternalLinkGuard = ({ children, className, 'data-testid': testId }: { children: ReactNode; className?: string; 'data-testid'?: string }) => (
  <div onClick={openExternalLink} className={className} data-testid={testId}>
    {children}
  </div>
);
