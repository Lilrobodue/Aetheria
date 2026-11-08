// components/shell/more/ComposePage.tsx (v16.8.3 "Track Tuning": More › Compose for a crystal, decision T9; A1)
//
// The composing guide: a crystal picker (the 27, grouped GUT / HEART / HEAD, a toggle button each), then that crystal's
// options from the static table (utils/tuning/composeTable.ts, generated from the survey's measurement): the keys at a
// plain DAW 440 first, then "<key> · Set A4 to 436.5 Hz in your DAW · −14 cents"; for the six crystals Lo Shu Perfect GUT
// swaps, the Lo Shu tone's own (amendment A1). Then the note (Standard, for a track tuned in the DAW) and the table's
// evidence line, tagged Design choice. It opens on the crystal the Crystal sheet's link asked for (moreModel
// requestComposeCrystal), else the playing track's. Nothing is computed on the device and nothing is stored but the
// session's pick. Its own region (more-compose).
// v16.8.3 fix round 1 (S2): under a set whose tone the phone's own speaker plays an octave up (174's, Lo Shu 75's and
// 186's: computed, compose.ts phoneOctaveUp), one line says the table was worked out for headphones, speakers and the car.
// Fix round 1 (N7): opened for a crystal (the Crystal sheet's link: moreModel takeComposeAsked), that crystal's options
// come first, the picker after them under "Another crystal" (a pick there brings the options into view); opened from
// More's row, the picker first, as before.

import React, { useEffect, useRef, useState } from 'react';
import EvidenceTag from '../../ui/EvidenceTag';
import { EvidenceOrigin } from '../../guide/evidenceLink';
import { useSound } from '../contexts';
import { countRender } from '../devRenders';
import { PERFECT_GUT_MAP } from '../shellModel';
import { composeCrystalNow, onComposeCrystal, requestComposeCrystal, takeComposeAsked } from './moreModel';
import { COMPOSE_ANOTHER, COMPOSE_EVIDENCE, COMPOSE_GROUPS, COMPOSE_LEAD, COMPOSE_NOTE, COMPOSE_PHONE_NOTE, composeEntry, composeHeading, composeLines, composeStart, crystalPhoneDiffers, loShuHeading, loShuPhoneDiffers } from '../../../utils/tuning/compose';

/** A Lo Shu Perfect tone (75 …) back to its crystal (174 …); any other value as it is. */
const perfectBack = (hz: number): number => {
  for (const [f, lo] of Object.entries(PERFECT_GUT_MAP)) if (lo === hz) return Number(f);
  return hz;
};

/** Its tag leads to the Guide; the Guide's Back returns here (Advanced's way). */
const ORIGIN = { tab: 'more', sheet: null, label: 'Compose', more: 'compose' } as const;

const PICK_ON =
  'min-h-touch min-w-[60px] px-3 rounded-control border border-ink-muted bg-surface-raised text-sm font-semibold text-ink-strong tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const PICK_OFF =
  'min-h-touch min-w-[60px] px-3 rounded-control border border-line-strong bg-surface-deep text-sm text-ink-soft tabular-nums hover:border-ink-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

const ComposePage = () => {
  countRender('ComposePage');
  const s = useSound();
  const [crystal, setCrystal] = useState<number>(() => composeStart(composeCrystalNow(), s.trackRawHz, s.crystalHz, perfectBack));
  // (Fix round 1, N7: asked for a crystal, its options first.)
  const [focused, setFocused] = useState<boolean>(() => takeComposeAsked());
  // The Crystal sheet's link while this page shows (the desktop panel): go to the crystal it asks for, its options first.
  useEffect(
    () =>
      onComposeCrystal((f) => {
        takeComposeAsked();
        setFocused(true);
        setCrystal(composeStart(f, null, null, perfectBack));
      }),
    []
  );
  const optionsRef = useRef<HTMLElement | null>(null);
  const pick = (f: number) => {
    setCrystal(f);
    requestComposeCrystal(f, false);
    // (The options are above the picker here: bring them into view.)
    if (focused) requestAnimationFrame(() => optionsRef.current?.scrollIntoView?.({ block: 'nearest' }));
  };
  const e = composeEntry(crystal);
  const Group = focused ? 'h3' : 'h2';
  const picker = (
    <div role="group" aria-label="Crystal" data-testid="compose-picker" className="space-y-3">
      {COMPOSE_GROUPS.map((g) => (
        <div key={g.id} data-testid={`compose-group-${g.id}`}>
          <Group className="text-xs font-semibold uppercase tracking-widest text-ink-soft mb-1">{g.label}</Group>
          <div className="flex flex-wrap gap-2">
            {g.crystals.map((f) => (
              <button key={f} type="button" aria-pressed={f === crystal} onClick={() => pick(f)} data-testid={`compose-crystal-${f}`} className={f === crystal ? PICK_ON : PICK_OFF}>
                {f}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
  const options = e ? (
    <section ref={optionsRef} aria-labelledby="compose-h-options" data-testid="compose-options" data-crystal={crystal} className="space-y-3">
      <h2 id="compose-h-options" className="text-base font-semibold text-ink-strong">
        {composeHeading(crystal)}
      </h2>
      <ul data-testid="compose-lines" className="space-y-1">
        {composeLines(e).map((line) => (
          <li key={line} className="text-sm text-ink-strong">
            {line}
          </li>
        ))}
      </ul>
      {crystalPhoneDiffers(crystal) ? (
        <p data-testid="compose-phone-note" className="text-xs text-ink-muted leading-snug">
          {COMPOSE_PHONE_NOTE}
        </p>
      ) : null}
      {e.loShu ? (
        <div data-testid="compose-loshu">
          <h3 className="text-sm font-semibold text-ink-soft">{loShuHeading(e.loShu.hz)}</h3>
          <ul data-testid="compose-loshu-lines" className="mt-1 space-y-1">
            {composeLines(e.loShu).map((line) => (
              <li key={line} className="text-sm text-ink-strong">
                {line}
              </li>
            ))}
          </ul>
          {loShuPhoneDiffers(crystal) ? (
            <p data-testid="compose-loshu-phone-note" className="mt-1 text-xs text-ink-muted leading-snug">
              {COMPOSE_PHONE_NOTE}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  ) : null;
  return (
    <div data-testid="more-compose" data-layout={focused ? 'crystal' : 'picker'} className="px-4 pt-3 pb-4 space-y-4">
      <p className="text-sm text-ink-soft leading-snug">{COMPOSE_LEAD}</p>
      {focused ? (
        <>
          {options}
          <section aria-labelledby="compose-h-another" data-testid="compose-another" className="space-y-2">
            <h2 id="compose-h-another" className="text-base font-semibold text-ink-strong">
              {COMPOSE_ANOTHER}
            </h2>
            {picker}
          </section>
        </>
      ) : (
        <>
          {picker}
          {options}
        </>
      )}
      <p data-testid="compose-note" className="text-sm text-ink-soft leading-snug">
        {COMPOSE_NOTE}
      </p>
      <EvidenceOrigin.Provider value={ORIGIN}>
        <div data-evidence="design" data-testid="compose-evidence" className="flex flex-wrap items-center gap-x-2 gap-y-3">
          <span className="text-xs text-ink-muted leading-snug">{COMPOSE_EVIDENCE}</span>
          <EvidenceTag tier="design" />
        </div>
      </EvidenceOrigin.Provider>
    </div>
  );
};

export default React.memo(ComposePage);
