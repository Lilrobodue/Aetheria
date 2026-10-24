// components/shell/outputIcon.tsx (v15.5, the new layout beta)
//
// The icon that says what the layers do, as the classic quick switch picks it (OutputQuickSwitch): VolumeX when no
// layers play (Music only, or v2's failure with Car), Layers under classic, else the v2 output.

import React from 'react';
import { Car, Headphones, Layers, Smartphone, Speaker, VolumeX } from 'lucide-react';
import type { LayerOutput } from '../../utils/soundV2/layerHost';

export function outputIcon(
  o: { engine: string; v2Failed: boolean; output: LayerOutput | null; musicOnly: boolean },
  size: number,
  className?: string
) {
  const layersOff = o.musicOnly || (o.engine === 'v2' && o.v2Failed && o.output === 'car');
  const v2 = o.engine === 'v2' && !o.v2Failed;
  const Icon = layersOff
    ? VolumeX
    : !v2
      ? Layers
      : o.output === 'speakers'
        ? Speaker
        : o.output === 'phone'
          ? Smartphone
          : o.output === 'car'
            ? Car
            : Headphones;
  return <Icon size={size} className={className} aria-hidden="true" />;
}
