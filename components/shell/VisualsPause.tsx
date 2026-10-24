// components/shell/VisualsPause.tsx (v15.5, the heat guard)
//
// Pauses the visualizer while a solid screen of the new layout covers it, without touching Visualizer.tsx: React
// 19.2's <Activity mode="hidden"> keeps the component, its state, its refs and its <canvas> node, sets display:none on
// the canvas, and runs its effect cleanups, so the render loop's cleanup cancels its requestAnimationFrame and it draws
// nothing. Visible again, the effects run again and the loop restarts on the same canvas (measured: first draw 3.1 ms
// after the reveal); the particle cloud re-seeds (the particleDensity effect), the one visible difference.
//
// App wraps the visualizer's region in this in BOTH layouts, so its tree position never changes and a layout switch
// never remounts it; in classic `paused` is always false.
//
// THE ONLY FILE THAT IMPORTS React's Activity. App.tsx imports lucide's `Activity` icon under the same name: imported
// there, the icon rendered the Visualizer inside an <svg> and its canvas ref pointed at an SVG element (the probe).

import React, { Activity } from 'react';
import type { ReactNode } from 'react';

interface VisualsPauseProps {
  paused: boolean;
  children: ReactNode;
}

export default function VisualsPause({ paused, children }: VisualsPauseProps) {
  return <Activity mode={paused ? 'hidden' : 'visible'}>{children}</Activity>;
}
