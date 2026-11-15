// components/shell/sheets/SaveLine.tsx (v16.13 review round 1, U1: moved out of ImportSheet's ImportBody, unchanged)
//
// v16.8.5 fix round 1 (A1): on the phone, a big save's progress for offline use, in the Import sheet: the sheet is modal
// there (#root inert under it), so App's progress toast and its end line would run unseen and unheard behind it. The
// same words, throttle and end line as the toast (App's cacheSaveNote). App routes the save's voice to the sheet
// whenever the phone's Import sheet is open, whichever of its views shows, so both views draw this line: the Import
// view and (v16.13) Aetheria's music, where an add's saves happen.
// Fix round 2: the line comes from ImportSaveContext (C6); each end line and warning is a new element (its id: read
// once); and once a line has shown in this opening of the sheet, its space stays, the tallest so far, until the sheet
// closes (C5), so the controls don't move under a finger as the line changes or goes.

import React, { useLayoutEffect, useRef, useState } from 'react';
import { useImportSave } from '../contexts';

const SaveLine = () => {
  const save = useImportSave().note;
  // C5: the tallest save line shown in this opening of the sheet (it unmounts on close): the live region keeps that much
  // room once a line has shown. 0 before any, so the empty region takes none (no margin, no height) as before.
  const lineRef: { current: HTMLParagraphElement | null } = useRef(null);
  const [reserve, setReserve] = useState(0);
  useLayoutEffect(() => {
    const h = lineRef.current ? lineRef.current.getBoundingClientRect().height : 0;
    if (h > reserve) setReserve(h);
  });
  return (
    // The live region takes no room while empty (no margin from space-y, no height) until a line has shown, then it
    // keeps the tallest line's (C5). The start and each end line or warning are new elements (their keys), read once;
    // the updates change the start's in place with aria-live="off".
    <div role="status" aria-live="polite" aria-atomic="false" data-testid="import-save" style={reserve > 0 ? { minHeight: reserve } : save ? undefined : { marginTop: 0 }}>
      {save ? (
        <p
          key={save.phase === 'saving' ? 'saving' : `end-${save.id}`}
          ref={lineRef}
          data-testid="import-save-line"
          aria-atomic="true"
          aria-live={save.quiet ? 'off' : undefined}
          className="rounded-card border border-line-strong bg-surface-raised p-3 text-sm text-ink-strong leading-snug"
        >
          {save.text}
        </p>
      ) : null}
    </div>
  );
};

export default SaveLine;
