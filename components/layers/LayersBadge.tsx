// components/layers/LayersBadge.tsx
//
// The status-row chip that says which engine plays the layers and, in v2,
// for which output ("Layers v2 · Headphones (assumed)"). Tapping it opens the
// transport's layer quick switch. App builds the text and tooltip from the
// player's transitions (layerCopy), never from state() during a render.
// Shown only once an engine has been chosen (or v2 is the engine). The ::after
// box gives the small chip a 44 px tap target without growing the row.

import React from 'react';
import { Layers } from 'lucide-react';

interface Props {
  text: string;
  tooltip: string;
  onOpen: () => void;
}

const LayersBadge: React.FC<Props> = ({ text, tooltip, onOpen }) => (
  <button
    type="button"
    data-testid="layers-badge"
    aria-label={text}
    title={tooltip}
    onClick={onOpen}
    className="relative flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 hover:border-indigo-400/50 transition-colors after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-['']"
  >
    <Layers size={8} /> {text}
  </button>
);

export default React.memo(LayersBadge);
