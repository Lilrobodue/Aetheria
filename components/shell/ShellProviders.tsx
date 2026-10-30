// components/shell/ShellProviders.tsx (v15.5, the new layout beta; v15.6 adds the tuning context; v15.7 the library's two;
// v16.0 the queue's; v16.1 the saved playlists'; v16.4 the Visuals sheet's and the More area's; v16.5 the Guide's and the
// Journal's)
//
// Nests the new layout's context providers around it. It re-renders with App (four times a second while playing);
// its children do not: App hands it one memo'd <AppShell /> with no props, and each view reads only the contexts it
// needs, so a provider whose value did not change reaches nothing.

import React from 'react';
import type { ReactNode } from 'react';
import {
  ActionsContext,
  ShellContext,
  PlayerContext,
  SoundContext,
  LevelsContext,
  TuningContext,
  LibrarySummaryContext,
  WalkContext,
  TimeContext,
  LibraryListContext,
  LibraryStatusContext,
  QueueContext,
  PlaylistsContext,
  VisualsContext,
  MoreContext,
  GuideContext,
  JournalContext,
  ExportContext,
  ExportActionsContext,
} from './contexts';
import type {
  ShellActions,
  ShellValue,
  PlayerValue,
  SoundValue,
  LevelsValue,
  TuningValue,
  LibrarySummaryValue,
  WalkValue,
  TimeValue,
  LibraryListValue,
  LibraryStatusValue,
  QueueValue,
  PlaylistsValue,
  VisualsValue,
  MoreValue,
  GuideValue,
  JournalValue,
  ExportValue,
  ExportActions,
} from './contexts';

interface ShellProvidersProps {
  actions: ShellActions;
  shell: ShellValue;
  player: PlayerValue;
  sound: SoundValue;
  levels: LevelsValue;
  tuning: TuningValue;
  library: LibrarySummaryValue;
  walk: WalkValue;
  time: TimeValue;
  libraryList: LibraryListValue;
  libraryStatus: LibraryStatusValue;
  queue: QueueValue;
  playlists: PlaylistsValue;
  visuals: VisualsValue;
  more: MoreValue;
  guide: GuideValue;
  journal: JournalValue;
  exportValue: ExportValue;
  exportActions: ExportActions;
  children: ReactNode;
}

const ShellProviders = ({ actions, shell, player, sound, levels, tuning, library, walk, time, libraryList, libraryStatus, queue, playlists, visuals, more, guide, journal, exportValue, exportActions, children }: ShellProvidersProps) => (
  <ActionsContext.Provider value={actions}>
    <ShellContext.Provider value={shell}>
      <PlayerContext.Provider value={player}>
        <SoundContext.Provider value={sound}>
          <LevelsContext.Provider value={levels}>
            <TuningContext.Provider value={tuning}>
              <LibrarySummaryContext.Provider value={library}>
                <WalkContext.Provider value={walk}>
                  <TimeContext.Provider value={time}>
                    <LibraryListContext.Provider value={libraryList}>
                      <LibraryStatusContext.Provider value={libraryStatus}>
                        <QueueContext.Provider value={queue}>
                          <PlaylistsContext.Provider value={playlists}>
                            <VisualsContext.Provider value={visuals}>
                              <MoreContext.Provider value={more}>
                                <GuideContext.Provider value={guide}>
                                  <JournalContext.Provider value={journal}>
                                    <ExportActionsContext.Provider value={exportActions}>
                                      <ExportContext.Provider value={exportValue}>{children}</ExportContext.Provider>
                                    </ExportActionsContext.Provider>
                                  </JournalContext.Provider>
                                </GuideContext.Provider>
                              </MoreContext.Provider>
                            </VisualsContext.Provider>
                          </PlaylistsContext.Provider>
                        </QueueContext.Provider>
                      </LibraryStatusContext.Provider>
                    </LibraryListContext.Provider>
                  </TimeContext.Provider>
                </WalkContext.Provider>
              </LibrarySummaryContext.Provider>
            </TuningContext.Provider>
          </LevelsContext.Provider>
        </SoundContext.Provider>
      </PlayerContext.Provider>
    </ShellContext.Provider>
  </ActionsContext.Provider>
);

export default ShellProviders;
