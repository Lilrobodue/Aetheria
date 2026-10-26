// components/shell/library/AssignCrystalsDialog.tsx (v15.7, the Library tab, stage B)
//
// The health card's Assign asks first whenever a track already has a crystal: Auto-Distribute gives EVERY library
// track one of the 27 (spec §2.6), so a Deep Scan's choices may change. A kit Dialog (alertdialog): Cancel takes the
// first focus, Assign runs the existing autoDistribute. New-layout UI only; classic's button is unchanged.

import React, { useRef } from 'react';
import Dialog from '../../ui/Dialog';
import Button from '../../ui/Button';
import { assignConfirmText } from './libraryModel';

interface AssignCrystalsDialogProps {
  total: number;
  withCrystal: number;
  onCancel: () => void;
  onAssign: () => void;
}

const AssignCrystalsDialog = ({ total, withCrystal, onCancel, onAssign }: AssignCrystalsDialogProps) => {
  const cancelRef: { current: HTMLButtonElement | null } = useRef(null);
  const words = assignConfirmText(total, withCrystal);
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
