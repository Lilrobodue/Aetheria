// components/more/Tour.tsx (v16.4, the new layout's 4-card tour)
//
// The new layout's first run, and More › About › Show the tour: four cards (mockups tour-phone-1, tour-phone-4). It
// replaces classic's 6-step Quick Guide in the new layout only (App's tutorial region picks it while the new layout
// shows; classic's branch is unchanged), with the same showTutorial state, the same aetheria_v3_tutorial_seen gate and
// the same closeTutorial.
//
// A kit modal (the overlay stack: the focus trap, Escape, #root inert and the focus given back on close), so the
// shell's own controls can't be reached behind it, which classic's tutorial over the shell allowed. A labelled dialog,
// "Tour, card n of 4"; "n of 4" and Close in its header, Back / Next (Done on the last) and four dots in its footer.
// No animation, no blur.
//
// The words: card 1 is the tutorial's step 1 verbatim; card 2 its step 2 (the description and the three tails
// verbatim, the labels naming the new layout's buttons); card 3 its step 6, with the Guidebook's place as v16.4 has it
// (the classic layout, through More's classic row: v16.4 review; v16.5 brings the Guide to More and changes it again);
// card 4 is new.

import React, { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Gem, Headphones, MapPin, Music, X } from 'lucide-react';
import { useOverlay } from '../ui/overlayStack';
import { CLASSIC_ROW_TITLE } from '../shell/more/moreModel';

interface TourLine {
  label: string;
  text: string;
}

interface TourCard {
  title: string;
  desc: string;
  icon: ReactNode;
  lines: TourLine[];
}

/** The four cards. `desktop` changes card 4's first line (sections on the left, not tabs at the bottom). */
export function tourCards(desktop: boolean): TourCard[] {
  return [
    {
      title: 'Welcome to Aetheria',
      desc: 'An advanced music player that takes the songs you already love and does three things.',
      icon: <Music size={28} aria-hidden="true" />,
      lines: [
        { label: 'Retunes to 432 Hz:', text: 'A natural tuning many listeners find warmer than standard 440 Hz.' },
        { label: 'Sorts into 27 frequencies:', text: 'Each song is assigned to one of three ranges — GUT, HEART, or HEAD.' },
        { label: 'Layers binaural beats:', text: 'A subtle layer underneath your music. Headphones recommended.' },
      ],
    },
    {
      title: '27 crystals, three ranges',
      desc: 'Two clicks let the player understand your library and sort it into the 27 frequencies.',
      icon: <Gem size={28} aria-hidden="true" />,
      lines: [
        { label: 'Scan:', text: "The engine analyzes each song's frequency content." },
        {
          label: 'Assign crystals:',
          text: 'Keeps the frequencies Deep Scan found and gives every other song one of the 27 across the GUT, HEART, and HEAD ranges, empty ones first.',
        },
        { label: 'One-time:', text: 'Once assigned, your library is ready for any listening mode.' },
      ],
    },
    {
      title: 'Listen Well',
      desc: 'A few tips before you press play. Then enjoy the music.',
      icon: <Headphones size={28} aria-hidden="true" />,
      lines: [
        { label: 'Headphones if possible:', text: 'The binaural layer needs each ear to hear its own signal.' },
        { label: 'No wrong way:', text: 'Background while you work, eyes closed, falling asleep, dancing — it adapts to you.' },
        // v16.4: the Guidebook is still classic's (More's last row switches to it). v16.5: "The Guide: More › Guide, …".
        { label: 'The Guidebook:', text: `In the classic layout for now: More › ${CLASSIC_ROW_TITLE}, then the book icon in the sidebar. Plain language or the technical view.` },
      ],
    },
    {
      title: 'Where things are',
      desc: desktop ? 'Five sections on the left.' : 'Five tabs at the bottom of the screen.',
      icon: <MapPin size={28} aria-hidden="true" />,
      lines: [
        { label: 'Now Playing:', text: 'the visuals, the crystal, Output and Walks.' },
        { label: 'Library:', text: 'your tracks and playlists. Import, scan and assign crystals.' },
        { label: 'Mixes:', text: 'walks, journeys and crystal sets.' },
        { label: 'Layers:', text: 'the tone, the beat and the drone.' },
        { label: 'More:', text: 'the visualizer, the guide, recording, safety and about.' },
      ],
    },
  ];
}

const Tour = ({ onClose, desktop = false }: { onClose: () => void; desktop?: boolean }) => {
  const [step, setStep] = useState(0);
  const panelRef: { current: HTMLDivElement | null } = useRef(null);
  const nextRef: { current: HTMLButtonElement | null } = useRef(null);
  useOverlay(true, panelRef, onClose);
  // The first focus (after the stack has saved what had it): Next, so Enter walks the cards.
  useEffect(() => {
    nextRef.current?.focus();
  }, []);
  // Next becomes Done on the last card (another button): the focus moves to it rather than dropping to the page.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) nextRef.current?.focus();
  }, [step]);
  const cards = tourCards(desktop);
  const card = cards[step];
  const last = step === cards.length - 1;
  const n = `${step + 1} of ${cards.length}`;
  return createPortal(
    <div className="fixed inset-0 z-tutorial flex items-center justify-center p-4" data-testid="tour">
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Tour, card ${n}`}
        tabIndex={-1}
        className="relative w-full max-w-md h-full max-h-[608px] flex flex-col rounded-sheet bg-surface-panel border border-line-strong shadow-overlay text-ink font-sans outline-none"
      >
        <div className="shrink-0 h-14 pl-5 pr-2 flex items-center justify-between border-b border-line">
          <span className="text-sm text-ink-muted tabular-nums" data-testid="tour-count">
            {n}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="w-touch h-touch flex items-center justify-center rounded-control text-ink-muted hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-5" data-testid="tour-card">
          <span aria-hidden="true" className="w-14 h-14 rounded-pill bg-surface-raised flex items-center justify-center text-ink-soft">
            {card.icon}
          </span>
          <h2 className="mt-4 text-2xl font-semibold text-ink-strong">{card.title}</h2>
          <p className="mt-1 text-sm text-ink-muted">{card.desc}</p>
          <ul className="mt-4 space-y-3 text-sm text-ink-soft">
            {card.lines.map((l) => (
              <li key={l.label}>
                <strong className="text-ink-strong font-semibold">{l.label}</strong> {l.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="shrink-0 px-3 py-3 border-t border-line flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="min-h-touch px-3 rounded-control border border-line-strong bg-surface-raised text-sm text-ink flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
          >
            <ChevronLeft size={16} aria-hidden="true" />
            Back
          </button>
          <span className="flex gap-2" aria-hidden="true">
            {cards.map((c, i) => (
              <span key={c.title} className={i === step ? 'h-2 rounded-pill w-6 bg-ink-soft' : 'h-2 rounded-pill w-2 bg-surface-control'} />
            ))}
          </span>
          {last ? (
            <button
              type="button"
              ref={nextRef}
              onClick={onClose}
              className="min-h-touch px-4 rounded-control bg-gold-500 hover:bg-gold-400 text-black text-sm font-bold flex items-center justify-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              ref={nextRef}
              onClick={() => setStep(Math.min(cards.length - 1, step + 1))}
              className="min-h-touch px-3 rounded-control border border-line-strong bg-surface-raised text-sm text-ink flex items-center justify-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
            >
              <ChevronRight size={16} aria-hidden="true" />
              Next
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default Tour;
