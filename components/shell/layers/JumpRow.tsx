// components/shell/layers/JumpRow.tsx (v15.6, the Layers tab)
//
// The tab's sticky jump row (mockups layers-phone-A-*): five chips, Sound · Crystal · Levels · Beat · Advanced. A tap
// scrolls that section to the top of the page and focuses its h2. The section at the top is marked (aria-current,
// raised, never gold) from the cards' positions, read on scroll (once per frame at most) into this row's own state, so
// a scroll re-renders the row and nothing else. A jump pins its chip while the page stays where the jump left it, so a
// last section too short to reach the top still reads as current. The five chips need ~381 px: on a narrower phone the
// row scrolls sideways inside itself (no bar drawn), and the current chip is kept in view.
// v16.4: the Visuals sheet's row too (Look · Hexes · Overlays · Motion · Comfort): `sections` and `prefix` give its
// chips, ids and test ids; left out, they are the Layers tab's, so its markup is unchanged.

import React, { useEffect, useRef, useState } from 'react';
import Chip from '../../ui/Chip';
import { countRender } from '../devRenders';
import { LAYERS_SECTIONS, currentSectionIndex } from './layersModel';

interface JumpRowProps {
  /** The page's scroller (LayersTab's content). */
  scrollRef: { current: HTMLDivElement | null };
  inPanel: boolean;
  /** v16.4: the chips (default: the Layers tab's five). */
  sections?: ReadonlyArray<{ id: string; title: string }>;
  /** v16.4: the ids' and test ids' prefix (default 'layers': #layers-sec-sound, layers-jump-sound). */
  prefix?: string;
}

const JumpRow = ({ scrollRef, inPanel, sections = LAYERS_SECTIONS, prefix = 'layers' }: JumpRowProps) => {
  countRender(prefix === 'layers' ? 'LayersJumpRow' : 'VisualsJumpRow');
  const sectionId = (id: string) => `${prefix}-sec-${id}`;
  const headingId = (id: string) => `${prefix}-h-${id}`;
  const [current, setCurrent] = useState<string>(sections[0].id);
  // A jump's chip and the scrollTop it left the page at: pinned until the page moves away from there.
  const pinRef: { current: { id: string; top: number } | null } = useRef(null);
  const navRef: { current: HTMLElement | null } = useRef(null);

  // The current chip stays in view when the row is narrower than its chips (16 px of the row's padding beside it).
  useEffect(() => {
    const nav = navRef.current;
    const chip = nav?.querySelector(`[data-testid="${prefix}-jump-${current}"]`);
    if (!nav || !(chip instanceof HTMLElement)) return;
    const n = nav.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    if (c.left < n.left + 16) nav.scrollLeft -= n.left + 16 - c.left;
    else if (c.right > n.right - 16) nav.scrollLeft += c.right - (n.right - 16);
  }, [current]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const pin = pinRef.current;
      if (pin && Math.abs(root.scrollTop - pin.top) <= 2) {
        setCurrent(pin.id);
        return;
      }
      pinRef.current = null;
      const r = root.getBoundingClientRect();
      const tops = sections.map((s) => {
        const el = root.querySelector(`#${sectionId(s.id)}`);
        return el ? el.getBoundingClientRect().top - r.top : NaN;
      });
      setCurrent(sections[currentSectionIndex(tops, r.height)].id);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    read();
    return () => {
      root.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const jump = (id: string) => {
    const root = scrollRef.current;
    const sec = root?.querySelector(`#${sectionId(id)}`);
    if (!root || !sec) return;
    // Instant (nothing moves on its own: I13); 12 px of the page's padding above the card.
    root.scrollTop += sec.getBoundingClientRect().top - root.getBoundingClientRect().top - 12;
    pinRef.current = { id, top: root.scrollTop };
    setCurrent(id);
    const h = root.querySelector(`#${headingId(id)}`);
    if (h instanceof HTMLElement) h.focus({ preventScroll: true });
  };

  return (
    <nav
      ref={navRef}
      aria-label="Sections"
      data-testid={`${prefix}-jump`}
      className={
        inPanel
          ? 'relative shrink-0 h-[52px] px-4 flex items-center gap-2 bg-surface-deep border-b border-line overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          : 'shrink-0 h-[52px] px-4 flex items-center gap-2 bg-surface-deep border-b border-line overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      }
    >
      {sections.map((s) => (
        // (A fragment carries the key: without @types/react, tsc knows no `key` on the kit's typed props.)
        <React.Fragment key={s.id}>
          <Chip label={s.title} current={current === s.id} onClick={() => jump(s.id)} data-testid={`${prefix}-jump-${s.id}`}>
            {s.title}
          </Chip>
        </React.Fragment>
      ))}
      {/* The row's end padding, kept when it scrolls (a scroll container's own inline-end padding may not be). */}
      <span aria-hidden="true" className="shrink-0 w-2 h-px" />
    </nav>
  );
};

export default React.memo(JumpRow);
