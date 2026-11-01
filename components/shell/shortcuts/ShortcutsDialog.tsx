// components/shell/shortcuts/ShortcutsDialog.tsx (v16.7, desktop polish; decision 3 A)
//
// "Keyboard shortcuts": the kit's modal Dialog (the overlay stack: focus trap, Escape, focus back to the opener, #root
// inert), wide, with the shortcuts in two columns of groups (Playback; Panels and View), each row its words and its
// keycaps, from keysModel.SHORTCUTS (the one list the tooltips and the tests read too). Under them, the switch that
// turns the single-key shortcuts off (WCAG 2.1.4; Esc always works), saved from its tap only.

import React from 'react';
import Dialog from '../../ui/Dialog';
import Kbd from '../../ui/Kbd';
import Toggle from '../../ui/Toggle';
import { countRender } from '../devRenders';
import { SHORTCUTS, SHORTCUTS_INTRO, SHORTCUTS_SWITCH_LABEL, SHORTCUTS_SWITCH_LINE, SHORTCUTS_TITLE } from './keysModel';
import type { ShortcutGroup } from './keysModel';
import { setKeysOn, useKeysOn } from './shortcutsStore';

const Group = ({ group, className }: { group: ShortcutGroup; className?: string }) => (
  <section className={className} data-testid={`shortcuts-group-${group.title.toLowerCase()}`}>
    <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-soft pt-1 pb-1">{group.title}</h3>
    <dl>
      {group.rows.map((row) => (
        <div key={row.id} data-testid="shortcut-row" data-shortcut={row.id} className="min-h-10 py-1.5 flex items-center justify-between gap-3 border-b border-line">
          <dt className="text-sm text-ink">{row.label}</dt>
          <dd className="flex items-center gap-1 shrink-0">
            {row.keys.map((combo, i) => (
              <React.Fragment key={combo.join('+')}>
                {i > 0 ? <span className="text-xs text-ink-muted">or</span> : null}
                {combo.map((cap, j) => (
                  <React.Fragment key={cap}>
                    {j > 0 ? <span className="text-xs text-ink-muted">+</span> : null}
                    <Kbd>{cap}</Kbd>
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  </section>
);

const ShortcutsDialog = ({ onClose }: { onClose: () => void }) => {
  countRender('ShortcutsDialog');
  const on = useKeysOn();
  const [playback, panels, view] = SHORTCUTS;
  return (
    <Dialog open title={SHORTCUTS_TITLE} onClose={onClose} size="wide" data-testid="shortcuts-dialog">
      <p className="text-xs text-ink-muted">{SHORTCUTS_INTRO}</p>
      <div className="mt-3 grid grid-cols-2 gap-x-8">
        <Group group={playback} />
        <div>
          <Group group={panels} />
          <Group group={view} className="mt-4" />
        </div>
      </div>
      <div className="mt-2 border-t border-line">
        <Toggle label={SHORTCUTS_SWITCH_LABEL} description={SHORTCUTS_SWITCH_LINE} checked={on} onChange={setKeysOn} describe data-testid="shortcuts-switch" />
      </div>
    </Dialog>
  );
};

export default React.memo(ShortcutsDialog);
