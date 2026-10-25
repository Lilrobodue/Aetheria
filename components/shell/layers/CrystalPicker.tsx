// components/shell/layers/CrystalPicker.tsx (v15.6, the Layers tab and the Crystal sheet)
//
// v15.5's Crystal sheet body, extracted unchanged so the sheet and the tab's Crystal section are one component: the way
// back to the track's crystal while they differ, then the crystals by regime (GUT 174–963, HEART 1206–3150, HEAD
// 3504–6336), each a 3 × 3 grid of 48 px cells, ascending, each number with Perfect GUT applied, a 2 px regime bar per
// cell, the playing cell ringed in gold with "Playing", the track's own with "Track". v15.6 adds, after the grid:
//   - the 111 Hz chip ("111 Hz · non-canonical", dashed, a Perfect-family dot): not one of the 27, played as itself by
//     v2 (NON_CANONICAL_EXCEPTIONS); no cell is ringed while it plays;
//   - the comfort line, true of what each engine plays, in place of v15.5's HEAD line ("near the top of hearing" was
//     not what plays: v2 folds every crystal into 150–1,000 Hz, classic plays the high ones as a low hum);
//   - with the experience filter on (Advanced), only the crystals up to the level's ceiling, plus the playing and the
//     track's own, and a note with Show all.
// A tap is the existing selectFrequency; in the sheet it then closes (2 taps from Now Playing).

import React, { useMemo } from 'react';
import { Undo2 } from 'lucide-react';
import Toggle from '../../ui/Toggle';
import Badge from '../../ui/Badge';
import Button from '../../ui/Button';
import Chip from '../../ui/Chip';
import { useActions, usePlayer, useSound, useTuning } from '../contexts';
import { countRender } from '../devRenders';
import { crystalSections, REGIME_DOT, regimeOf } from '../shellModel';
import { crystalComfortLine, filterCrystals, filterNote } from './layersModel';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

interface CrystalPickerProps {
  /** 'sheet': a pick closes the Crystal sheet; 'section': the Layers tab's Crystal card. */
  host: 'sheet' | 'section';
}

const CrystalPicker = ({ host }: CrystalPickerProps) => {
  countRender('CrystalPicker');
  const s = useSound();
  const p = usePlayer();
  const t = useTuning();
  const actions = useActions();
  const all = useMemo(() => crystalSections(s.perfectGut), [s.perfectGut]);
  const shown = useMemo(() => filterCrystals(all, t.crystalFilter, t.level, [s.crystalHz, s.trackHz]), [all, t.crystalFilter, t.level, s.crystalHz, s.trackHz]);
  const sounding = p.isPlaying || p.toneOnly;
  const differs = s.trackHz !== null && s.trackHz !== s.crystalHz;
  const pick = (raw: number) => {
    actions.selectCrystal(raw);
    if (host === 'sheet') actions.closeSheet();
  };
  return (
    <>
      {differs ? (
        <button
          type="button"
          onClick={() => {
            actions.backToTrackCrystal();
            if (host === 'sheet') actions.closeSheet();
          }}
          data-testid="crystal-back-to-track"
          className={`w-full h-touch rounded-control border border-line-strong bg-surface-raised text-sm text-ink flex items-center justify-center gap-2 hover:border-ink-faint transition-colors duration-fast ${FOCUS}`}
        >
          <Undo2 size={16} className="text-ink-muted" aria-hidden="true" />
          Back to the track&#39;s crystal ({s.trackHz} Hz)
        </button>
      ) : null}
      <div className={host === 'sheet' ? 'pt-3 space-y-4' : 'space-y-4'}>
        {t.crystalFilter ? (
          <div data-testid="crystal-filter-note" className="flex items-center justify-between gap-2">
            <p className="min-w-0 text-xs text-ink-muted">{filterNote(shown.shown, shown.total, t.level)}</p>
            <Button variant="ghost" onClick={() => actions.setCrystalFilter(false)} className="shrink-0" data-testid="crystal-show-all">
              Show all
            </Button>
          </div>
        ) : null}
        {shown.sections.map((sec) => (
          <section key={sec.regime} aria-label={`${sec.name} ${sec.range}`}>
            <div className="mb-2 flex items-center gap-2">
              <span aria-hidden="true" className={`w-2 h-2 rounded-pill ${REGIME_DOT[sec.regime]}`} />
              <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">{sec.name}</h3>
              <span className="text-xs text-ink-faint">{sec.range}</span>
            </div>
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
                    onClick={() => pick(c.raw)}
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
        <div className="flex items-center gap-3 flex-wrap">
          <Chip label="111 Hz, non-canonical" tone="dashed" dotClass="bg-regime-perfect" onClick={() => pick(111)} data-testid="crystal-111">
            111 Hz · non-canonical
          </Chip>
          <span className="text-xs text-ink-faint">Not one of the 27 crystals.</span>
        </div>
        <div className="border-t border-line">
          <Toggle
            label="Lo Shu Perfect GUT"
            description="GUT crystals play their 111 Hz-family twins (174→75 …)"
            checked={s.perfectGut}
            onChange={actions.setPerfectGut}
            data-testid="perfect-gut"
          />
        </div>
        <p data-testid="crystal-comfort" className="text-xs text-ink-faint leading-snug">
          {crystalComfortLine(s.v2Active)}
        </p>
      </div>
    </>
  );
};

export default React.memo(CrystalPicker);
