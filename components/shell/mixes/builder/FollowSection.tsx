// components/shell/mixes/builder/FollowSection.tsx (v16.3, Create a mix; mockups builder-A-top-phone, -walk-phone,
// -custom-phone)
//
// Follow: what the mix follows, in four kinds (a radiogroup of 2 × 2): a Lo Shu walk, a crystal set, any crystal, or an
// experimental ranking. Then that kind's choices, each with its live count from the pool (the source through the
// filters): the six walks ("Vortex · 26 of 27"); the crystal sets as chips (the five presets, GUT, HEART, HEAD, All 27,
// Custom…) and what a set's crystals are ("the crystals Deep Scan or Assign crystals gave each track, not a measured
// pitch"); Custom's 27 crystals by regime, all always shown, each a toggle with its count; any crystal's one line; the
// experimental three with the Mixes tab's note (and the 111 Sequence's pointer to the 111 Hz chip). React.memo; plain
// values and stable callbacks as props.
// v16.3 review: each radiogroup (the kinds, the walks, the sets, the experimental three) is one Tab stop, and the arrow
// keys move within it and pick (parts.tsx onRadioKeys).

import React from 'react';
import { ChoiceTile, CHIP_WRAP, LINE, PickChip, SectionHead, onRadioKeys, rovingTabIndex } from './parts';
import { REGIME_DOT, regimeOf } from '../../shellModel';
import { EXPERIMENTAL_NOTE, SEQ111_LINE } from '../mixesModel';
import {
  ANY_LINE,
  CUSTOM_CHIP,
  CUSTOM_LEAD,
  CUSTOM_NONE,
  FOLLOW_KINDS,
  SECTION,
  crystalChipName,
  setChipName,
  setLine,
  walkChoiceSub,
} from './builderViewModel';

export type FollowKind = 'walk' | 'set' | 'any' | 'exp';

export interface WalkChoice { mode: string; name: string; count: number; size: number }
export interface SetChoice { id: string; name: string; count: number }
export interface ExpChoice { id: 'golden' | 'seq111' | 'source2178'; name: string; sub: string }
export interface RegimeGroup { id: string; name: string; range: string; crystals: readonly number[] }

interface FollowSectionProps {
  kind: FollowKind;
  /** The chosen walk's mode, set id or experimental id (null: none of this kind). */
  walkMode: string | null;
  setId: string | null;
  expId: string | null;
  walks: readonly WalkChoice[];
  sets: readonly SetChoice[];
  /** The chosen set's crystals (for its line). */
  setCrystals: readonly number[];
  /** Custom: the picked crystals, the regimes' groups, each crystal's count in the pool. */
  custom: readonly number[];
  regimes: readonly RegimeGroup[];
  crystalCounts: Readonly<Record<number, number>>;
  exps: readonly ExpChoice[];
  onKind: (k: FollowKind) => void;
  onWalk: (mode: string) => void;
  onSet: (id: string) => void;
  onCustom: (hz: number) => void;
  onExp: (id: 'golden' | 'seq111' | 'source2178') => void;
  onOpenCrystal: () => void;
}

const FollowSection = (p: FollowSectionProps) => {
  const custom = p.kind === 'set' && p.setId === 'custom';
  const anyKind = FOLLOW_KINDS.some((k) => k.id === p.kind);
  const anyWalk = p.walks.some((w) => w.mode === p.walkMode);
  const anySet = custom || p.sets.some((s) => s.id === p.setId);
  const anyExp = p.exps.some((x) => x.id === p.expId);
  return (
    <section aria-labelledby="mix-builder-h-follow" data-testid="builder-follow">
      <SectionHead id="mix-builder-h-follow">{SECTION.follow}</SectionHead>
      <div role="radiogroup" aria-labelledby="mix-builder-h-follow" onKeyDown={onRadioKeys} className="grid grid-cols-2 gap-2 pb-3">
        {FOLLOW_KINDS.map((k, i) => (
          <ChoiceTile key={k.id} label={k.label} checked={p.kind === k.id} tabIndex={rovingTabIndex(p.kind === k.id, i === 0, anyKind)} onPick={() => p.onKind(k.id)} data-testid={`builder-follow-${k.id}`} />
        ))}
      </div>

      {p.kind === 'walk' ? (
        <div role="radiogroup" aria-label="Lo Shu walks" onKeyDown={onRadioKeys} className="grid grid-cols-3 gap-2" data-testid="builder-walks">
          {p.walks.map((w, i) => (
            <ChoiceTile key={w.mode} label={w.name} sub={walkChoiceSub(w.count, w.size)} checked={p.walkMode === w.mode} tabIndex={rovingTabIndex(p.walkMode === w.mode, i === 0, anyWalk)} onPick={() => p.onWalk(w.mode)} data-testid={`builder-walk-${w.mode}`} />
          ))}
        </div>
      ) : null}

      {p.kind === 'set' ? (
        <div data-testid="builder-sets">
          <div role="radiogroup" aria-label="Crystal sets" onKeyDown={onRadioKeys}>
            <div className={CHIP_WRAP}>
              {p.sets.slice(0, 5).map((s, i) => (
                <PickChip key={s.id} kind="radio" label={s.name} count={s.count} name={setChipName(s.name, s.count)} picked={p.setId === s.id} tabIndex={rovingTabIndex(p.setId === s.id, i === 0, anySet)} onPick={() => p.onSet(s.id)} data-testid={`builder-set-${s.id}`} />
              ))}
            </div>
            <div className={`mt-3 ${CHIP_WRAP}`}>
              {p.sets.slice(5).map((s) => (
                <PickChip key={s.id} kind="radio" label={s.name} count={s.count} name={setChipName(s.name, s.count)} picked={p.setId === s.id} tabIndex={rovingTabIndex(p.setId === s.id, false, anySet)} onPick={() => p.onSet(s.id)} data-testid={`builder-set-${s.id}`} />
              ))}
              <PickChip kind="radio" label={CUSTOM_CHIP} count={null} name={setChipName(CUSTOM_CHIP, null)} picked={custom} tabIndex={rovingTabIndex(custom, false, anySet)} onPick={() => p.onSet('custom')} data-testid="builder-set-custom" />
            </div>
          </div>
          {custom ? (
            <div data-testid="builder-custom">
              <p className={`mt-3 ${LINE}`}>{CUSTOM_LEAD}</p>
              {p.regimes.map((r) => (
                <div key={r.id} role="group" aria-labelledby={`mix-builder-custom-${r.id}`} className="pt-3">
                  <p id={`mix-builder-custom-${r.id}`} className="pb-2 text-sm text-ink-strong">
                    {r.name} <span className="text-xs text-ink-faint">{r.range}</span>
                  </p>
                  <div className={CHIP_WRAP}>
                    {r.crystals.map((hz) => {
                      const n = p.crystalCounts[hz] ?? 0;
                      return (
                        <PickChip
                          key={hz}
                          kind="toggle"
                          label={`${hz} Hz`}
                          count={n}
                          name={crystalChipName(hz, n)}
                          picked={p.custom.includes(hz)}
                          dotClass={REGIME_DOT[regimeOf(hz)]}
                          onPick={() => p.onCustom(hz)}
                          data-testid={`builder-crystal-${hz}`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
              {p.custom.length === 0 ? <p className="pt-3 text-xs text-ink-soft">{CUSTOM_NONE}</p> : null}
            </div>
          ) : (
            <p data-testid="builder-set-line" className={`mt-3 ${LINE}`}>
              {setLine(p.setCrystals)}
            </p>
          )}
        </div>
      ) : null}

      {p.kind === 'any' ? <p className="text-sm text-ink-muted">{ANY_LINE}</p> : null}

      {p.kind === 'exp' ? (
        <div data-testid="builder-exps">
          <div role="radiogroup" aria-label="Experimental" onKeyDown={onRadioKeys} className="grid grid-cols-3 gap-2">
            {p.exps.map((x, i) => (
              <ChoiceTile key={x.id} label={x.name} sub={x.sub} checked={p.expId === x.id} tabIndex={rovingTabIndex(p.expId === x.id, i === 0, anyExp)} onPick={() => p.onExp(x.id)} data-testid={`builder-exp-${x.id}`} />
            ))}
          </div>
          <p className={`mt-3 ${LINE}`}>{EXPERIMENTAL_NOTE}</p>
          {p.expId === 'seq111' ? (
            <div className="mt-1 flex items-center gap-2">
              <p className={`flex-1 min-w-0 ${LINE}`}>{SEQ111_LINE}</p>
              <button
                type="button"
                aria-label="Open Layers › Crystal"
                onClick={p.onOpenCrystal}
                className="shrink-0 min-h-touch px-3 rounded-control text-sm text-ink-muted underline underline-offset-2 hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
              >
                Open
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

export default React.memo(FollowSection);
