// components/shell/sheets/MenuSheet.tsx (v15.5, the new layout beta)
//
// The ⋯ menu (mockup menu-phone): Stop all sound, Track info, Stop recording (while one runs), Back to classic, and
// Cancel. 64 px rows. v15.6: "Hide the controls (Zen)" / "Leave Zen" first (mockup zen-menu-phone). Always a modal sheet, on the desktop shell too. Track info closes the menu first, so the readout
// Dialog never sits on a Sheet.
// v16.1 (mockup np-menu-phone): "Add to playlist…" (the playing track; hidden with none) and "Save as a playlist…" (what's
// playing; hidden with nothing), after Track info. Each closes the menu first (the Add sheet, the name Dialog).
// v16.4: "Visuals" after Stop all sound: the Visuals sheet takes the menu's place (one sheet at a time).

import React from 'react';
import { ArrowLeftRight, Circle, Eye, EyeOff, Info, ListPlus, OctagonX, Save, SlidersHorizontal } from 'lucide-react';
import Sheet from '../../ui/Sheet';
import ListRow from '../../ui/ListRow';
import { ViewBoundary } from '../../ErrorBoundary';
import { useActions, usePlayer, useShell } from '../contexts';
import { zenMenuRow } from '../zenModel';
import { addRowLine, saveRowLine } from '../playlists/playlistsViewModel';
import { countRender } from '../devRenders';
import { sheetFallback } from './sheetFallback';

const MenuBody = () => {
  countRender('MenuBody');
  const actions = useActions();
  const { isRecording, hasTrack, trackId, title } = usePlayer();
  const { zen } = useShell();
  const zenRow = zenMenuRow(zen.on);
  const saving = actions.saveSourceInfo(); // v16.1: what Save as a playlist would save (read as the menu opens)
  return (
    <div data-testid="menu-body" className="pb-2">
      {/* v15.6: Zen first (decision 1). The menu closes; with Zen on, the controls hide 3 s later. */}
      <ListRow
        title={zenRow.title}
        subtitle={zenRow.subtitle}
        icon={zen.on ? <Eye size={20} /> : <EyeOff size={20} />}
        onClick={() => {
          actions.closeSheet();
          actions.setZen(!zen.on);
        }}
        data-testid="menu-zen"
      />
      <ListRow
        title="Stop all sound"
        subtitle="The music, the tone, the beat and the drone"
        icon={<OctagonX size={20} className="stroke-status-error" />}
        onClick={() => {
          actions.closeSheet();
          actions.stopAll();
        }}
        data-testid="menu-stop-all"
      />
      <ListRow
        title="Visuals"
        subtitle="Every visual setting, with the visuals showing"
        icon={<SlidersHorizontal size={20} />}
        onClick={actions.openVisuals}
        data-testid="menu-visuals"
      />
      <ListRow title="Track info" subtitle="Crystal, key and scan details for this track" icon={<Info size={20} />} onClick={actions.trackInfo} data-testid="menu-track-info" />
      {hasTrack && trackId ? (
        <ListRow
          title="Add to playlist…"
          subtitle={addRowLine(title)}
          icon={<ListPlus size={20} />}
          onClick={() => {
            actions.closeSheet();
            actions.addToPlaylist([trackId]);
          }}
          data-testid="menu-add-to-playlist"
        />
      ) : null}
      {saving ? (
        <ListRow
          title="Save as a playlist…"
          subtitle={saveRowLine(saving.label, saving.count)}
          icon={<Save size={20} />}
          onClick={() => actions.savePlaylist('playing')}
          data-testid="menu-save-playlist"
        />
      ) : null}
      {isRecording ? (
        <ListRow
          title="Stop recording"
          subtitle="Saves the recording to your downloads"
          icon={<Circle size={20} className="stroke-status-error" />}
          onClick={() => {
            actions.closeSheet();
            actions.stopRecording();
          }}
        />
      ) : null}
      <ListRow
        title="Back to classic"
        subtitle="The classic layout; the music keeps playing"
        icon={<ArrowLeftRight size={20} />}
        onClick={() => actions.setLayout('classic')}
        data-testid="menu-back-to-classic"
      />
      <button
        type="button"
        onClick={actions.closeSheet}
        className="mt-3 mx-4 w-[calc(100%-2rem)] h-touch rounded-control text-sm text-ink-muted hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        Cancel
      </button>
    </div>
  );
};

const MenuSheet = () => {
  const actions = useActions();
  return (
    <Sheet open title="More options" headerless onClose={actions.closeSheet} data-testid="sheet-menu">
      <ViewBoundary name="menu" fallback={sheetFallback(actions.closeSheet)} render={() => <MenuBody />} />
    </Sheet>
  );
};

export default React.memo(MenuSheet);
