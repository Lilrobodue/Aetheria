// components/ui/Kbd.tsx (v16.7 UI kit)
//
// A keycap: one key's name in a small raised box (decision 5 A's tooltips, the "?" dialog's rows, the labelled side
// nav's L and ?). Display only; a <kbd>, so a screen reader that reads it reads the key's name.

import React from 'react';

const Kbd = ({ children }: { children: string }) => (
  <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded border border-line-strong bg-surface-panel text-label font-sans text-ink-soft">
    {children}
  </kbd>
);

export default React.memo(Kbd);
