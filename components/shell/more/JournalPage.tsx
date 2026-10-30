// components/shell/more/JournalPage.tsx (v16.5, More › Journal; v16.4 spec §3.9; mockup journal-phone)
//
// The Journal (Experimental): two new lines, then classic's ExperienceTracker, unchanged, with its own look and its
// own modals. Its handlers are classic's, moved verbatim into App functions (journalStart, journalEnd, journalNote,
// toggleJournal) that classic's JSX now passes by reference: both layouts run the same code and write the same keys
// (aetheria_sessions, aetheria_effects_db). Its values are JournalContext's, which changes once a second while playing
// (App's session timer, the tracker's duration): the one More page that re-renders at 1 Hz, and only while it is open.

import React from 'react';
import ExperienceTracker from '../../ExperienceTracker';
import { useActions, useJournal } from '../contexts';
import { countRender } from '../devRenders';
import { JOURNAL_EXPERIMENTAL_LINE, JOURNAL_LINE } from './moreModel';

const JournalPage = () => {
  countRender('JournalPage');
  const actions = useActions();
  const j = useJournal();
  return (
    <div data-testid="more-journal" className="px-4 py-3 space-y-3">
      <p className="text-base text-ink leading-snug">{JOURNAL_LINE}</p>
      <p className="text-xs text-ink-muted leading-snug">{JOURNAL_EXPERIMENTAL_LINE}</p>
      <div data-testid="journal-tracker">
        <ExperienceTracker
          isDocumenting={j.documenting}
          onToggleDocumentation={actions.toggleJournal}
          currentFrequency={j.frequency}
          currentVolume={j.volume}
          currentVolumeText={j.volumeText}
          sessionDuration={j.minutes}
          isPlaying={j.playing}
          onSessionStart={actions.journalStart}
          onSessionEnd={actions.journalEnd}
          onAddNote={actions.journalNote}
        />
      </div>
    </div>
  );
};

export default React.memo(JournalPage);
