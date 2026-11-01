// components/shell/shortcuts/feedback.ts (v16.7, desktop polish; decision 6 B)
//
// The key feedback's feed: a module emitter. DesktopKeys (a shortcut's key) and immersive.ts (full screen entered,
// left or refused) call showKeyFeedback; the mounted KeyFeedback shows the pill and the live line. No state here, no
// timer, no listener but KeyFeedback's own.

import type { FeedbackKind } from './keysModel';

const listeners = new Set<(kind: FeedbackKind) => void>();

export function showKeyFeedback(kind: FeedbackKind): void {
  for (const fn of Array.from(listeners)) fn(kind);
}

export function onKeyFeedback(fn: (kind: FeedbackKind) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
