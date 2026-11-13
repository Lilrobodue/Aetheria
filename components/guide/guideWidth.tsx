// components/guide/guideWidth.tsx (v16.8.6)
//
// The Guide's two views (TechnicalGuide with its LoShuMatrix, AccessibleGuidebook) were written for classic's
// Guidebook, which fills the window: their columns step up with the window (md:grid-cols-2, xl:grid-cols-3, ...).
// The new layout shows them in More › Guide, which on a desktop is the 420 px panel beside the nav, in a window of any
// width: there every step fired at once and the panel held three columns of cards and the cube's three squares side
// by side, each a few dozen pixels wide, spilling over one another and past the panel's edge. On a phone the window is
// the panel, which is why it read well there.
//
// So in the new layout the views step up with their own width instead: GuidePage wraps them in GuideWidthContainer
// (a CSS size container named `guide`), and each step class goes through useGuideStep, which gives its twin under
// tailwind.config.js's guide-* variants (the same sizes, asked of that container). In a 420 px panel nothing steps
// up, as on a phone; a wide phone shell steps up as before. Classic's Guidebook has no container and gets every class
// as written, so it renders byte for byte as it did.
// The cube's three squares are the exception: they stand one above another in both layouts (LoShuMatrix: no host has
// room for three legible squares side by side; in classic's 896 px Guidebook their tones ran under the corner numbers).

import React, { createContext, useCallback, useContext } from 'react';

/** Every window-width step class the Guide's views use, and its twin against the Guide's own width. Complete literals
 *  on both sides, for the build (tailwind.config.js: a class must appear whole in a scanned file). */
const OWN_WIDTH = {
  'sm:text-sm': 'guide-sm:text-sm',
  'sm:text-lg': 'guide-sm:text-lg',
  'sm:text-3xl': 'guide-sm:text-3xl',
  'sm:gap-6': 'guide-sm:gap-6',
  'sm:grid-cols-2': 'guide-sm:grid-cols-2',
  'sm:grid-cols-3': 'guide-sm:grid-cols-3',
  'md:text-lg': 'guide-md:text-lg',
  'md:text-4xl': 'guide-md:text-4xl',
  'md:grid-cols-2': 'guide-md:grid-cols-2',
  'md:grid-cols-3': 'guide-md:grid-cols-3',
  'lg:grid-cols-2': 'guide-lg:grid-cols-2',
  'lg:grid-cols-3': 'guide-lg:grid-cols-3',
  'lg:grid-cols-[auto_1fr]': 'guide-lg:grid-cols-[auto_1fr]',
} as const;

export type GuideStep = keyof typeof OWN_WIDTH;

const OwnWidth = createContext(false);

/** The new layout's Guide: its content steps up with its own width. The container and the switch come together, so a
 *  view never asks a container it isn't in. */
export const GuideWidthContainer = ({ children }: { children: React.ReactNode }) => (
  <div data-guide-width="own" style={{ containerType: 'inline-size', containerName: 'guide' }}>
    <OwnWidth.Provider value={true}>{children}</OwnWidth.Provider>
  </div>
);

/** step('md:grid-cols-2'): the class as written (classic's Guidebook: the window's width), or inside
 *  GuideWidthContainer its guide-* twin (the Guide's own width). */
export const useGuideStep = (): ((cls: GuideStep) => string) => {
  const own = useContext(OwnWidth);
  return useCallback((cls: GuideStep) => (own ? OWN_WIDTH[cls] : cls), [own]);
};
