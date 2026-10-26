// components/shell/library/AssignCrystalsDialog.tsx (v15.7, the Library tab, stage B; v15.8 the new Assign)
//
// The health card's Assign asks first only when crystals tracks already have would change (v15.8: Deep Scan's crystals
// stay; one an older Auto-Distribute replaced is put back, and assigned crystals may move once). The words come from the
// plan the tap computed (utils/mix/distribution.ts planAssign). A kit Dialog (alertdialog): Cancel takes the first focus,
// Assign runs the existing autoDistribute. New-layout UI only; classic's button is unchanged.

import React, { useRef } from 'react';
import Dialog from '../../ui/Dialog';
import Button from '../../ui/Button';
import { assignConfirmText } from './libraryModel';
import type { AssignPlan } from '../../../utils/mix/distribution';

interface AssignCrystalsDialogProps {
  plan: AssignPlan;
  onCancel: () => void;
  onAssign: () => void;
}

const AssignCrystalsDialog = ({ plan, onCancel, onAssign }: AssignCrystalsDialogProps) => {
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
      {words.body}
    </Dialog>
  );
};

export default AssignCrystalsDialog;
