// components/shell/layers/SoundSection.tsx (v15.6, the Layers tab and the Sound sheet)
//
// The layer-sound controls in the Quiet look (mockups layers-phone-A-top, sheet-sound-phone): Music only, the
// "Layer sound: v2 / classic" A/B, Output with its four icons, the sub-bass drone, Ask me again and (the tab only, as
// Harmonic Control's panel variant) Export sound log. What shows, and each choice's look, is soundModel's view of
// App's one layerPanelProps object, the same object classic's LayerSoundPanel takes (which keeps its own markup);
// its handlers are the panel's. The words are layerCopy's. ARIA as classic's: a group named Output with aria-pressed
// buttons named by OUTPUT_LABELS, the engine group named by ENGINE_GROUP_LABEL, exactly one switch named "Music only".

import React, { useMemo } from 'react';
import { Car, Download, Headphones, Smartphone, Speaker } from 'lucide-react';
import Toggle from '../../ui/Toggle';
import Button from '../../ui/Button';
import ChoiceGroup from '../../ui/ChoiceGroup';
import type { ChoiceOption } from '../../ui/ChoiceGroup';
import { useSound } from '../contexts';
import { countRender } from '../devRenders';
import SectionCard from './SectionCard';
import EvidenceTag from '../../ui/EvidenceTag';
import { soundSectionView } from './soundModel';
import type { LayerOutput } from '../../../utils/soundV2/layerHost';

const OUTPUT_ICONS: Record<LayerOutput, (cls: string) => React.ReactNode> = {
  headphones: (cls) => <Headphones size={16} className={cls} aria-hidden="true" />,
  speakers: (cls) => <Speaker size={16} className={cls} aria-hidden="true" />,
  phone: (cls) => <Smartphone size={16} className={cls} aria-hidden="true" />,
  car: (cls) => <Car size={16} className={cls} aria-hidden="true" />,
};

/** The controls themselves: the tab's Sound card holds them; so does the Sound sheet (without Export). */
export const SoundControls = ({ withExport }: { withExport: boolean }) => {
  countRender(withExport ? 'LayersSound' : 'SheetSound');
  const s = useSound();
  const p = s.layerPanelProps;
  const v = useMemo(() => soundSectionView(p, withExport), [p, withExport]);
  const outputs: ChoiceOption<LayerOutput>[] | null = v.output ? v.output.choices.map((c) => ({ ...c, icon: OUTPUT_ICONS[c.id] })) : null;
  return (
    <>
      <Toggle label={v.musicOnly.label} description={v.musicOnly.description} checked={v.musicOnly.checked} onChange={() => p.onToggleMusicOnly()} data-testid="layers-music-only" />
      <div className="border-t border-line" />
      <ChoiceGroup label={v.engine.label} options={v.engine.choices} onChoose={p.onChooseEngine} data-testid="layers-engine">
        <p className="text-xs text-ink-faint leading-snug">{v.engine.note}</p>
      </ChoiceGroup>
      {v.classicNote ? (
        <p data-testid="layers-classic-note" className="text-xs text-ink-soft leading-snug">
          {v.classicNote}
        </p>
      ) : null}
      {v.v2Unavailable ? (
        <p data-testid="layers-v2-unavailable" className="text-xs text-ink-soft leading-snug">
          {v.v2Unavailable}
        </p>
      ) : null}
      {v.output && outputs ? (
        <ChoiceGroup label={v.output.label} badge={v.output.badge} options={outputs} onChoose={p.onChooseOutput} data-testid="layers-output">
          {v.output.notes.map((n, i) => (
            <p key={n} className={i === 0 ? 'text-xs text-ink-muted leading-snug' : 'text-xs text-ink-faint leading-snug'}>
              {n}
            </p>
          ))}
        </ChoiceGroup>
      ) : null}
      {v.headphonesHint ? <p className="text-xs text-ink-faint leading-snug">{v.headphonesHint}</p> : null}
      {v.drone ? (
        <div data-evidence={withExport ? 'design' : undefined} className="space-y-2">
          <Toggle
            label={v.drone.label}
            description={v.drone.description}
            checked={v.drone.checked}
            disabled={!v.drone.usable}
            onChange={() => p.onToggleDrone()}
            data-testid="layers-drone"
          />
          {withExport ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
              <EvidenceTag tier="design" />
            </div>
          ) : null}
        </div>
      ) : null}
      {v.askAgain ? (
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-xs text-ink-faint leading-snug">{v.askAgain.description}</p>
          <Button variant="secondary" onClick={p.onAskAgain} className="shrink-0" data-testid="layers-ask-again">
            {v.askAgain.label}
          </Button>
        </div>
      ) : null}
      {v.exportLog ? (
        <Button variant="secondary" onClick={p.onExportLog} className="w-full flex items-center justify-center gap-2" data-testid="layers-export-log">
          <Download size={16} className="text-ink-muted" aria-hidden="true" />
          {v.exportLog}
        </Button>
      ) : null}
    </>
  );
};

const MemoControls = React.memo(SoundControls);

/** The tab's Sound card: its status is the layers chip's text. */
const SoundSection = () => {
  const s = useSound();
  return (
    <SectionCard section="sound" title="Sound" status={s.layersText}>
      <MemoControls withExport />
    </SectionCard>
  );
};

export default React.memo(SoundSection);
