// components/shell/library/AssignCrystalsDialog.tsx (v15.7, the Library tab, stage B; v15.8 the new Assign)
//
// The health card's Assign asks first only when crystals tracks already have would change (v16.7.1: Assign spreads every
// track over the 27 crystals, so scanned tracks can move off Deep Scan's crystal, their reading kept). The words come
// from the plan the tap computed (utils/mix/distribution.ts planAssign(lib, 'spread')). A kit Dialog (alertdialog): Cancel takes the first focus,
// Assign runs the existing autoDistribute. New-layout UI only; classic's button is unchanged.

import React, { useRef } from 'react';
import Dialog from '../../ui/Dialog';
import Button from '../../ui/Button';
import { ASSIGN_CHANGED_LINE, assignConfirmText } from './libraryModel';
import type { AssignPlan } from '../../../utils/mix/distribution';

interface AssignCrystalsDialogProps {
  plan: AssignPlan;
  /** v16.8.2 fix round 3 (F1): asked again because the library changed while it was open (the plan with it). */
  changed?: boolean;
  onCancel: () => void;
  onAssign: () => void;
}

const AssignCrystalsDialog = ({ plan, changed = false, onCancel, onAssign }: AssignCrystalsDialogProps) => {
  const cancelRef: { current: HTMLButtonElement | null } = useRef(null);
  const words = assignConfirmText(plan);
  return (
    <Dialog
      open
      role="alertdialog"
      title={words.title}
      onClose={onCancel}
      initialFocusRef={cancelRef}
      data-testid="assign-dialog"
      actions={
        <>
          <Button variant="secondary" buttonRef={cancelRef} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onAssign}>
            Assign
          </Button>
        </>
      }
    >
      {changed ? (
        <span data-testid="assign-changed" className="block mb-2 font-medium text-ink-strong">
          {ASSIGN_CHANGED_LINE}
        </span>
      ) : null}
      <span data-testid="assign-counts">{words.body}</span>
    </Dialog>
  );
};

export default AssignCrystalsDialog;
