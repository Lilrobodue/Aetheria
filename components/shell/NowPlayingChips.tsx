// components/shell/NowPlayingChips.tsx (v15.5, the new layout beta)
//
// Now Playing's chips, in their existing words (layerCopy): the crystal (a regime dot, the Hz and the regime name),
// the layers, the beat, Key fit (while on and the layers are wanted; a gold border while it ducks) and Music only
// (while on). They wrap onto a second row when needed (decision 2), gap-y-3 so the 44 px hit boxes never overlap.
// The crystal chip names the crystal the layers PLAY (selectedSolfeggio), not the track's: classic's pill keeps the
// track's after a pick (spec §2.8). The crystal chip opens the Crystal sheet; the others the Sound sheet.

import React from 'react';
import { Music2, VolumeX, Waves } from 'lucide-react';
import Chip from '../ui/Chip';
import { useActions, useSound } from './contexts';
import { countRender } from './devRenders';
import { outputIcon } from './outputIcon';
import { REGIME_DOT, regimeName, regimeOf } from './shellModel';

const NowPlayingChips = () => {
  countRender('NowPlayingChips');
  const s = useSound();
  const actions = useActions();
  const regime = regimeOf(s.crystalHz);
  const openSound = () => actions.openSheet('sound');
  return (
    <div data-testid="np-chips" className="mt-3 flex flex-wrap gap-x-2 gap-y-3">
      <Chip
        label={`Crystal ${s.crystalHz} Hz, ${regimeName(regime)}`}
        dotClass={REGIME_DOT[regime]}
        onClick={() => actions.openSheet('crystal')}
        data-testid="chip-crystal"
      >
        {s.crystalHz} Hz<span className="text-ink-faint">{regimeName(regime)}</span>
      </Chip>
      {s.layersShown ? (
        <Chip label={s.layersText} title={s.layersTip} icon={outputIcon(s, 14, 'text-ink-muted')} onClick={openSound} data-testid="chip-layers">
          {s.layersText}
        </Chip>
      ) : null}
      <Chip label={`Beat ${s.beatText}`} icon={<Waves size={14} className="text-ink-muted" aria-hidden="true" />} onClick={openSound} data-testid="chip-beat">
        {s.beatText}
      </Chip>
      {s.keyFitShown ? (
        <Chip
          label={s.keyFitText}
          title={s.keyFitHint}
          tone={s.keyFitLook === 'duck' ? 'accent' : s.keyFitLook === 'none' ? 'dashed' : 'plain'}
          icon={<Music2 size={14} className="text-ink-muted" aria-hidden="true" />}
          onClick={openSound}
          data-testid="chip-keyfit"
        >
          {s.keyFitText}
        </Chip>
      ) : null}
      {s.musicOnly ? (
        <Chip label="Music only" icon={<VolumeX size={14} className="text-ink-muted" aria-hidden="true" />} onClick={openSound} data-testid="chip-music-only">
          Music only
        </Chip>
      ) : null}
    </div>
  );
};

export default React.memo(NowPlayingChips);
