// components/shell/more/LinksPage.tsx (v16.4, More › Links; mockup links-phone)
//
// Classic's Links & Resources (linksData.ts: its seven sections, their links and the footer, in classic's words) as
// 64 px rows. The whole page sits in ExternalLinkGuard, so in the installed PWA a link opens in the browser rather
// than replacing the player (the music keeps playing); mailto: goes to the mail app. Static: it never re-renders.

import React from 'react';
import { ExternalLink, Mail } from 'lucide-react';
import { countRender } from '../devRenders';
import { ExternalLinkGuard } from './externalLinks';
import { LINKS_FOOTER, LINKS_HINT, LINK_SECTIONS } from './linksData';

const LinksPage = () => {
  countRender('LinksPage');
  return (
    <ExternalLinkGuard data-testid="more-links" className="pb-2">
      <p className="px-4 pt-3 text-xs text-ink-muted leading-snug">{LINKS_HINT}</p>
      {LINK_SECTIONS.map((sec, i) => (
        <section key={sec.section} aria-labelledby={`links-h-${i}`} data-testid="links-section">
          <h2 id={`links-h-${i}`} className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-widest text-ink-soft" data-testid="links-section-label">
            {sec.section}
          </h2>
          {sec.items.map((it) => {
            const mail = it.href.startsWith('mailto:');
            return (
              <a
                key={it.href}
                href={it.href}
                target={mail ? undefined : '_blank'}
                rel="noopener noreferrer"
                data-testid="links-row"
                className="flex items-center gap-3 min-h-row px-4 py-2 border-b border-line hover:bg-surface-raised/40 transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-400"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-ink-strong" data-testid="links-title">
                    {it.title}
                  </span>
                  <span className="block text-xs text-ink-muted" data-testid="links-sub">
                    {it.sub}
                  </span>
                </span>
                <span className="shrink-0 text-ink-faint" aria-hidden="true">
                  {mail ? <Mail size={18} /> : <ExternalLink size={18} />}
                </span>
              </a>
            );
          })}
        </section>
      ))}
      <div className="text-center pt-4 pb-4 space-y-1" data-testid="links-footer">
        {LINKS_FOOTER.map((line) => (
          <div key={line} className="text-xs text-ink-faint">
            {line}
          </div>
        ))}
      </div>
    </ExternalLinkGuard>
  );
};

export default React.memo(LinksPage);
