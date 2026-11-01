// components/shell/shortcuts/DesktopKeys.tsx (v16.7, desktop polish)
//
// A leaf of the desktop shell (in its own `desktop-keys` region): it owns the keyboard shortcuts' one listener
// (useDesktopKeys), the "?" dialog's open state (? itself, the rail's Shortcuts button and the ⋯ menu's row open it,
// through shortcutsStore's requestShortcuts) and where L was pressed (the focus goes back there when L closes Layers;
// "/" never closes: decision 7). It renders nothing with the dialog shut. It reads the actions, the shell, the player and
// the sound, so it renders on a play/pause, a track change, a tab or a setting: never on the 4 Hz clock. While Zen is
// turned off by hand, full screen forgets that it turned Zen on (immersive.ts).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useActions, usePlayer, useShell, useSound } from '../contexts';
import { countRender } from '../devRenders';
import ShortcutsDialog from './ShortcutsDialog';
import { useDesktopKeys } from './useDesktopKeys';
import type { KeysState, OpenedFrom } from './useDesktopKeys';
import { onShortcutsRequest } from './shortcutsStore';
import { zenTurnedOff } from './immersive';

const DesktopKeys = () => {
  countRender('DesktopKeys');
  const actions = useActions();
  const { tab, sheet, zen, libraryViewRef } = useShell();
  const { isPlaying, hasTrack, count: playerCount } = usePlayer();
  const { musicOnly } = useSound();
  const [helpOpen, setHelpOpen] = useState(false);
  const stateRef: { current: KeysState } = useRef({ tab, sheet, zenOn: zen.on, isPlaying, hasTrack, musicOnly, playerCount });
  stateRef.current = { tab, sheet, zenOn: zen.on, isPlaying, hasTrack, musicOnly, playerCount };
  const openedFromRef: { current: OpenedFrom } = useRef(null);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  useDesktopKeys({ actions, openedFromRef, stateRef, libraryViewRef, openHelp });
  useEffect(() => onShortcutsRequest(openHelp), []);

  // Layers left another way (Escape, the rail, its Close): the next L opens it afresh.
  useEffect(() => {
    if (openedFromRef.current && tab !== 'layers') openedFromRef.current = null;
  }, [tab]);

  // Zen off by hand (or by leaving full screen): it is no longer full screen's to turn off.
  useEffect(() => {
    if (!zen.on) zenTurnedOff();
  }, [zen.on]);

  return helpOpen ? <ShortcutsDialog onClose={closeHelp} /> : null;
};

export default React.memo(DesktopKeys);
