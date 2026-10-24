// components/shell/ShellProviders.tsx (v15.5, the new layout beta)
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
  LibrarySummaryContext,
  WalkContext,
  TimeContext,
} from './contexts';
import type {
  ShellActions,
  ShellValue,
  PlayerValue,
  SoundValue,
  LevelsValue,
  LibrarySummaryValue,
  WalkValue,
  TimeValue,
} from './contexts';

interface ShellProvidersProps {
  actions: ShellActions;
  shell: ShellValue;
  player: PlayerValue;
  sound: SoundValue;
  levels: LevelsValue;
  library: LibrarySummaryValue;
  walk: WalkValue;
  time: TimeValue;
  children: ReactNode;
}

const ShellProviders = ({ actions, shell, player, sound, levels, library, walk, time, children }: ShellProvidersProps) => (
  <ActionsContext.Provider value={actions}>
    <ShellContext.Provider value={shell}>
      <PlayerContext.Provider value={player}>
        <SoundContext.Provider value={sound}>
          <LevelsContext.Provider value={levels}>
            <LibrarySummaryContext.Provider value={library}>
              <WalkContext.Provider value={walk}>
                <TimeContext.Provider value={time}>{children}</TimeContext.Provider>
              </WalkContext.Provider>
            </LibrarySummaryContext.Provider>
          </LevelsContext.Provider>
        </SoundContext.Provider>
      </PlayerContext.Provider>
    </ShellContext.Provider>
  </ActionsContext.Provider>
);

export default ShellProviders;
