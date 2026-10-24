// components/shell/sheets/CrystalSheet.tsx (v15.5, the new layout beta)
//
// The Crystal sheet (mockup sheet-crystal-phone): all 27 crystals whatever the experience level (plan decision 11), in
// three sections of nine (GUT 174–963, HEART 1206–3150, HEAD 3504–6336), each a 3 × 3 grid of 48 px cells, ascending,
// each cell's number with Perfect GUT applied. A 2 px regime bar per cell (the colour on the bar, never on the text);
// the playing cell ringed in gold with "Playing", the track's own with "Track". It says both ("Playing 528 Hz · this
// track's crystal is 396 Hz") and offers the way back while they differ. One neutral line for HEAD; the Lo Shu Perfect
// GUT switch at the end. A tap is the existing selectFrequency, then the sheet closes (2 taps from Now Playing).

import React, { useMemo } from 'react';
import { Undo2 } from 'lucide-react';
import Sheet from '../../ui/Sheet';
import Toggle from '../../ui/Toggle';
import Badge from '../../ui/Badge';
import { ViewBoundary } from '../../ErrorBoundary';
import { useActions, usePlayer, useSound } from '../contexts';
import { countRender } from '../devRenders';
import { crystalSections, REGIME_DOT, regimeOf } from '../shellModel';
import { sheetFallback } from './sheetFallback';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

const CrystalBody = () => {
  countRender('CrystalBody');
  const s = useSound();
  const p = usePlayer();
  const actions = useActions();
  const sections = useMemo(() => crystalSections(s.perfectGut), [s.perfectGut]);
  const sounding = p.isPlaying || p.toneOnly;
  const differs = s.trackHz !== null && s.trackHz !== s.crystalHz;
  return (
    <div data-testid="crystal-body" className="px-4 pb-4">
      {differs ? (
        <button
          type="button"
          onClick={() => {
            actions.backToTrackCrystal();
            actions.closeSheet();
          }}
          className={`w-full h-touch rounded-control border border-line-strong bg-surface-raised text-sm text-ink flex items-center justify-center gap-2 hover:border-ink-faint transition-colors duration-fast ${FOCUS}`}
        >
          <Undo2 size={16} className="text-ink-muted" aria-hidden="true" />
          Back to the track&#39;s crystal ({s.trackHz} Hz)
        </button>
      ) : null}
      <div className="pt-3 space-y-4">
        {sections.map((sec) => (
          <section key={sec.regime} aria-label={`${sec.name} ${sec.range}`}>
            <div className="mb-2 flex items-center gap-2">
              <span aria-hidden="true" className={`w-2 h-2 rounded-pill ${REGIME_DOT[sec.regime]}`} />
              <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">{sec.name}</h3>
              <span className="text-xs text-ink-faint">{sec.range}</span>
            </div>
            {sec.regime === 'head' ? (
              <p className="-mt-1 mb-2 text-xs text-ink-muted">High crystals sit near the top of hearing. Keep the tone level comfortable.</p>
            ) : null}
            <div className="grid grid-cols-3 gap-x-2 gap-y-3">
              {sec.cells.map((c) => {
                const on = c.hz === s.crystalHz;
                const track = !on && s.trackHz === c.hz;
                return (
                  <button
                    key={c.raw}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${c.hz} Hz${on ? (sounding ? ', playing' : ', selected') : ''}${track || (on && s.trackHz === c.hz) ? ", this track's crystal" : ''}`}
                    data-testid={`crystal-${c.hz}`}
                    onClick={() => {
                      actions.selectCrystal(c.raw);
                      actions.closeSheet();
                    }}
                    className={
                      on
                        ? `relative h-12 rounded-control border flex items-center justify-center gap-1 border-gold-400 bg-gold-500/15 ring-1 ring-gold-400 ${FOCUS}`
                        : `relative h-12 rounded-control border flex items-center justify-center gap-1 border-line bg-surface-raised hover:border-ink-faint transition-colors duration-fast ${FOCUS}`
                    }
                  >
                    <span aria-hidden="true" className={`absolute top-0 inset-x-4 h-0.5 rounded-pill ${REGIME_DOT[regimeOf(c.hz)]}`} />
                    <span className={on ? 'text-base font-semibold tabular-nums text-gold-100' : 'text-base font-semibold tabular-nums text-ink-strong'}>{c.hz}</span>
                    <span className={on ? 'text-caption text-gold-300' : 'text-caption text-ink-faint'}>Hz</span>
                    {on ? (
                      <Badge look="playing" className="absolute -bottom-2">
                        {sounding ? 'Playing' : 'Selected'}
                      </Badge>
                    ) : null}
                    {track ? (
                      <Badge look="track" className="absolute -bottom-2">
                        Track
                      </Badge>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        <div className="border-t border-line">
          <Toggle
            label="Lo Shu Perfect GUT"
            description="GUT crystals play their 111 Hz-family twins (174→75 …)"
            checked={s.perfectGut}
            onChange={actions.setPerfectGut}
            data-testid="perfect-gut"
          />
        </div>
      </div>
    </div>
  );
};

interface CrystalSheetProps {
  presentation: 'sheet' | 'panel';
}

const CrystalSheet = ({ presentation }: CrystalSheetProps) => {
  const s = useSound();
  const p = usePlayer();
  const actions = useActions();
  const verb = p.isPlaying || p.toneOnly ? 'Playing' : 'Selected';
  const subtitle =
    s.trackHz === null
      ? `${verb} ${s.crystalHz} Hz`
      : s.trackHz === s.crystalHz
        ? `${verb} ${s.crystalHz} Hz · this track's crystal`
        : `${verb} ${s.crystalHz} Hz · this track's crystal is ${s.trackHz} Hz`;
  return (
    <Sheet open title="Crystal" subtitle={subtitle} onClose={actions.closeSheet} presentation={presentation} data-testid="sheet-crystal">
      <ViewBoundary name="sheet-crystal" fallback={sheetFallback(actions.closeSheet)} render={() => <CrystalBody />} />
    </Sheet>
  );
};

export default React.memo(CrystalSheet);
