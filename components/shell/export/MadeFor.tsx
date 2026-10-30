// components/shell/export/MadeFor.tsx (v16.5, Export with layers; decision 1 B)
//
// "Made for": Headphones · Speakers · Tone only, starting from the user's Output ("Your Output: Headphones"), each with
// its own line. The choice is the sheet's (session only, never saved): the next sheet starts from the Output again.

import React from 'react';
import { AudioLines, Headphones, Speaker } from 'lucide-react';
import ChoiceGroup from '../../ui/ChoiceGroup';
import type { ChoiceOption } from '../../ui/ChoiceGroup';
import { MADE_FOR_LABEL, MADE_FOR_WORDS, yourOutput } from '../../../utils/export/exportWords';
import type { MadeFor as MadeForValue } from '../../../utils/export/exportPlan';

const ICON: Record<MadeForValue, (cls: string) => React.ReactNode> = {
  headphones: (cls) => <Headphones size={16} className={cls} aria-hidden="true" />,
  speakers: (cls) => <Speaker size={16} className={cls} aria-hidden="true" />,
  tone: (cls) => <AudioLines size={16} className={cls} aria-hidden="true" />,
};

interface MadeForProps {
  value: MadeForValue;
  fromOutput: MadeForValue;
  onChoose: (m: MadeForValue) => void;
}

const MadeFor = ({ value, fromOutput, onChoose }: MadeForProps) => {
  const options: ChoiceOption<MadeForValue>[] = (['headphones', 'speakers', 'tone'] as const).map((id) => ({
    id,
    label: MADE_FOR_WORDS[id].title,
    icon: ICON[id],
    pressed: value === id,
    dashed: false,
  }));
  return (
    <div data-testid="export-made-for">
      <ChoiceGroup label={MADE_FOR_LABEL} badge={yourOutput(fromOutput)} options={options} onChoose={onChoose} columns={3} check={false}>
        <p data-testid="export-made-for-line" className="text-xs text-ink-muted leading-snug">
          {MADE_FOR_WORDS[value].line}
        </p>
      </ChoiceGroup>
    </div>
  );
};

export default React.memo(MadeFor);
