// components/shell/sheets/sheetFallback.tsx (v15.5, the new layout beta)
//
// A sheet body's fallback: inside the Sheet (its Close button and Escape still work), a PanelFallback with Reload
// panel and Close.

import React from 'react';
import { PanelFallback } from '../../ErrorBoundary';
import type { FallbackApi } from '../../ErrorBoundary';

export function sheetFallback(close: () => void) {
  return (api: FallbackApi) => (
    <div className="p-4">
      <PanelFallback
        text="This sheet hit a problem."
        switchedOff={api.switchedOff}
        copyDetails={api.copyDetails}
        buttonRef={api.buttonRef}
        onRetry={api.retry}
        onClose={close}
      />
    </div>
  );
}
