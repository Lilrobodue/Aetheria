// components/ui/EmptyState.tsx (v15.5 UI kit)
//
// What a screen says when it has nothing to show: a title, one or two sentences, and at most one action.

import React from 'react';
import Button from './Button';

interface EmptyStateProps {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  'data-testid'?: string;
}

const EmptyState = ({ title, body, actionLabel, onAction, 'data-testid': testId }: EmptyStateProps) => (
  <div data-testid={testId} className="p-4 rounded-card border border-dashed border-line-strong">
    <div className="text-sm font-semibold text-ink-strong">{title}</div>
    <p className="mt-1 text-sm text-ink-muted">{body}</p>
    {actionLabel && onAction ? (
      <Button variant="primary" onClick={onAction} className="mt-3 w-full">
        {actionLabel}
      </Button>
    ) : null}
  </div>
);

export default EmptyState;
