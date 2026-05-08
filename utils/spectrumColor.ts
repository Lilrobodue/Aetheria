// Maps an audio frequency in Hz to the colour it would be if octave-shifted
// up into the visible-light spectrum. Used by the "spectrum" colour mode
// as an alternative to the chakra-based palette stored in SOLFEGGIO_INFO.
//
// Algorithm:
//   1. Multiply / divide by 2 until the frequency lands in the visible
//      light range (~405–790 THz).
//   2. Convert to wavelength λ = c / f, in nanometres.
//   3. Convert wavelength to RGB using a piecewise linear approximation of
//      the visible spectrum (a standard chart used by Bruton, Dan Bruton's
//      "Color Science" notes, and many physics-education sources).
//
// Returns a `#rrggbb` hex string so it slots into existing colour code that
// already accepts hex.

const SPEED_OF_LIGHT = 299_792_458; // m/s

const VISIBLE_MIN_THZ = 405; // ~740 nm — deep red
const VISIBLE_MAX_THZ = 790; // ~380 nm — violet

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// Octave-shift the audio frequency until it lands in the visible-light
// range (405–790 THz). Returns frequency in Hz — multiply by 1e-12 for THz.
const octaveShiftToVisible = (audioHz: number): number => {
  if (!Number.isFinite(audioHz) || audioHz <= 0) return 0;
  const minHz = VISIBLE_MIN_THZ * 1e12;
  const maxHz = VISIBLE_MAX_THZ * 1e12;
  let f = audioHz;
  while (f < minHz) f *= 2;
  while (f > maxHz) f /= 2;
  return f;
};

// Convert visible-light wavelength (in nm) to an RGB triple in 0..255.
// Standard piecewise approximation; gives a clean rainbow that matches what
// most physics textbooks print as "the visible spectrum."
const wavelengthToRgb = (wavelengthNm: number): { r: number; g: number; b: number } => {
  const wl = wavelengthNm;
  let r = 0;
  let g = 0;
  let b = 0;

  if (wl >= 380 && wl < 440) {
    r = -(wl - 440) / (440 - 380);
    g = 0;
    b = 1;
  } else if (wl >= 440 && wl < 490) {
    r = 0;
    g = (wl - 440) / (490 - 440);
    b = 1;
  } else if (wl >= 490 && wl < 510) {
    r = 0;
    g = 1;
    b = -(wl - 510) / (510 - 490);
  } else if (wl >= 510 && wl < 580) {
    r = (wl - 510) / (580 - 510);
    g = 1;
    b = 0;
  } else if (wl >= 580 && wl < 645) {
    r = 1;
    g = -(wl - 645) / (645 - 580);
    b = 0;
  } else if (wl >= 645 && wl <= 780) {
    r = 1;
    g = 0;
    b = 0;
  }

  // Intensity falls off near the edges of the visible spectrum.
  let factor = 1;
  if (wl >= 380 && wl < 420) factor = 0.3 + (0.7 * (wl - 380)) / (420 - 380);
  else if (wl >= 420 && wl <= 700) factor = 1;
  else if (wl > 700 && wl <= 780) factor = 0.3 + (0.7 * (780 - wl)) / (780 - 700);
  else factor = 0;

  // Apply a perceptual gamma so colours feel natural on a screen.
  const gamma = 0.8;
  const toByte = (c: number) => Math.round(255 * Math.pow(clamp01(c * factor), gamma));
  return { r: toByte(r), g: toByte(g), b: toByte(b) };
};

const toHex = (n: number) => {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return v.toString(16).padStart(2, '0');
};

export const frequencyToVisibleWavelength = (audioHz: number): number => {
  const f = octaveShiftToVisible(audioHz);
  if (f <= 0) return 0;
  return (SPEED_OF_LIGHT / f) * 1e9; // metres → nm
};

export const frequencyToSpectrumColor = (audioHz: number): string => {
  const wl = frequencyToVisibleWavelength(audioHz);
  if (wl <= 0) return '#888888';
  const { r, g, b } = wavelengthToRgb(wl);
  // If the colour came back fully black (frequency landed outside the
  // 380–780 nm window we map), fall back to a neutral grey so visuals
  // never go invisibly dark.
  if (r === 0 && g === 0 && b === 0) return '#444444';
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

// Convenience for callers that want both colour and a human-readable
// wavelength label (e.g. "528 Hz · ~516 nm green").
export const frequencyToSpectrumInfo = (audioHz: number): {
  hex: string;
  wavelengthNm: number;
  bandLabel: string;
} => {
  const wl = frequencyToVisibleWavelength(audioHz);
  const hex = frequencyToSpectrumColor(audioHz);
  let bandLabel = 'unknown';
  if (wl >= 380 && wl < 450) bandLabel = 'violet';
  else if (wl < 485) bandLabel = 'blue';
  else if (wl < 500) bandLabel = 'cyan';
  else if (wl < 565) bandLabel = 'green';
  else if (wl < 590) bandLabel = 'yellow';
  else if (wl < 625) bandLabel = 'orange';
  else if (wl <= 780) bandLabel = 'red';
  return { hex, wavelengthNm: wl, bandLabel };
};

export type FrequencyColorMode = 'chakra' | 'spectrum';
