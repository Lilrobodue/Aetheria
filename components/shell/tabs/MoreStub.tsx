// components/shell/tabs/MoreStub.tsx (v15.5, the new layout beta)
//
// More: Back to classic (saves the choice; the music keeps playing), Track info and Stop all sound, and one line on
// what the beta has (v15.6: Zen and the Layers tab). Settings, the Guidebook and Safety stay in the classic layout
// during the beta.

import React from 'react';
import { ArrowLeftRight, Circle, Info, OctagonX, X } from 'lucide-react';
import Badge from '../../ui/Badge';
import IconButton from '../../ui/IconButton';
import ListRow from '../../ui/ListRow';
import { useActions, usePlayer } from '../contexts';
import { countRender } from '../devRenders';

interface MoreStubProps {
  inPanel?: boolean;
}

const MoreStub = ({ inPanel = false }: MoreStubProps) => {
  countRender('MoreStub');
  const actions = useActions();
  const { isRecording } = usePlayer();
  return (
    <div
      data-testid="more"
      className={inPanel ? 'h-full flex flex-col bg-surface-panel border-r border-line-strong' : 'absolute inset-0 flex flex-col bg-surface-deep pointer-events-auto'}
    >
      <header className={inPanel ? 'shrink-0 h-14 pl-4 pr-2 flex items-center justify-between gap-2 border-b border-line bg-surface-deep' : 'shrink-0 h-14 px-4 flex items-center justify-between gap-2 border-b border-line bg-surface-deep'}>
        <h1 tabIndex={-1} data-view-heading="" className="text-lg font-semibold text-ink-strong outline-none">
          More
        </h1>
        <span className="flex items-center gap-1">
          <Badge>Beta</Badge>
          {inPanel ? <IconButton label="Close panel" icon={<X size={20} />} onClick={() => actions.setTab('now')} /> : null}
        </span>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ListRow
          title="Back to classic"
          subtitle="The classic layout; the music keeps playing"
          icon={<ArrowLeftRight size={20} />}
          onClick={() => actions.setLayout('classic')}
          data-testid="more-back-to-classic"
        />
        {isRecording ? (
          <ListRow
            title="Stop recording"
            subtitle="Saves the recording to your downloads"
            icon={<Circle size={20} className="stroke-status-error" />}
            onClick={actions.stopRecording}
            data-testid="more-stop-recording"
          />
        ) : null}
        <ListRow title="Track info" subtitle="Crystal, key and scan details for this track" icon={<Info size={20} />} onClick={actions.trackInfo} />
        <ListRow
          title="Stop all sound"
          subtitle="The music, the tone, the beat and the drone"
          icon={<OctagonX size={20} className="stroke-status-error" />}
          onClick={actions.stopAll}
        />
        <p className="px-4 py-4 text-sm text-ink-muted">
          This beta has Now Playing with Zen, the Layers tab, the Sound, Crystal and Walks sheets, and the Car screen.
          The library, the mixes, settings, the Guidebook and Safety are in the classic layout for now, one tap away.
        </p>
      </div>
    </div>
  );
};

export default React.memo(MoreStub);
