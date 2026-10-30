// components/shell/more/RecordElapsed.tsx (v16.5, Record; v16.4 spec §3.8)
//
// A recording's elapsed time ("3:12"), from its start (MoreContext's recording.since). The only thing in Record that
// ticks: its own 1 s interval, so the sheet, the More card and the More row around it never re-render for the time
// (R7: RecordElapsed alone renders while recording). aria-live is off: a screen reader is not told every second.

import React, { useEffect, useState } from 'react';
import { countRender } from '../devRenders';
import { elapsedText } from './moreModel';

interface RecordElapsedProps {
  since: number;
  className?: string;
  'data-testid'?: string;
}

const RecordElapsed = ({ since, className, 'data-testid': testId }: RecordElapsedProps) => {
  countRender('RecordElapsed');
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span aria-live="off" data-record-elapsed="" data-testid={testId} className={className}>
      {elapsedText(since, now)}
    </span>
  );
};

export default React.memo(RecordElapsed);
