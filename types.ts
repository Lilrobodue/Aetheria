
export interface Song {
  file: File;
  id: string;
  name: string;
  duration?: number;
  // Harmonic Analysis Data
  harmonicFreq?: number;       // The dominant frequency detected
  closestSolfeggio?: number;   // The calculated nearest Solfeggio tone
  harmonicDeviation?: number;  // How close it is to the target (lower is better)
  fractalAnalysis?: import('./utils/fractalFrequencyAnalysis').FractalAnalysisResult; // Complete fractal analysis
}

export enum SolfeggioFreq {
  PAIN_RELIEF = 174,
  TISSUE_REPAIR = 285,
  LIBERATION = 396,
  CHANGE = 417,
  MIRACLE = 528,
  RELATIONSHIPS = 639,
  EXPRESSION = 741,
  INTUITION = 852,
  ONENESS = 963
}

export interface BinauralPreset {
  name: string;
  delta: number; // The difference in Hz
  description: string;
}

export interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number; // Defaults to ~0.98 for 440->432 conversion
}

export interface VizSettings {
  // Global Physics
  speed: number;        // 0.1 to 3.0
  sensitivity: number;  // 0.1 to 2.0 (Audio reactivity)
  
  // Appearance
  particleDensity: 'low' | 'medium' | 'high'; 
  particleBaseSize: number; // New: 0.5 to 5.0
  coreSize: number;     // 0.5 to 2.0 (Acts as Scale)
  
  // Background
  showHexagons: boolean;
  hexOpacity: number;   // 0 to 1
  hexVisualMode: 'pulse' | 'spectrum' | 'wave'; 
  
  // Water Effect
  showWaterRipples: boolean; 
  hydroIntensity: number; // 0.1 to 2.0
  
  // Overlays
  showTreeOfLife: boolean;
  showLoShuCube: boolean; // Render the 3x3x3 Lo Shu cube overlay (27 sub-cubes by frequency)
  loShuCubeAutoRotate: boolean; // When true, the cube turntables; when false, holds at loShuCubeRotation
  loShuCubeRotation: number; // Manual rotation angle in degrees (0–360), used when auto-rotate is off
  // Walk-path illumination — when on, the cube draws a faint polyline along
  // that walk's 27-frequency path even when no walk playlist is active. Lets
  // the user preview each walk's shape without loading songs. Multiple paths
  // can be on at once; the shapes themselves are the visual identifier.
  loShuShowVortex: boolean; // Walk C — Flying Star Vortex (5→6→7→8→9→1→2→3→4 per layer)
  loShuShowAscent: boolean; // Walk A — Layer Ascent (1→9 per layer, GUT→HEART→HEAD)
  loShuShowPillar: boolean; // Walk B — Pillar Walk (GUT→HEART→HEAD per Lo Shu position)
  
  // Color Logic — 'spectrum' is the 4th mode: visible-light wavelength of
  // the active frequency (still audio-reactive via HSL modulation).
  colorMode: 'chakra' | 'cycle' | 'static' | 'spectrum';
  
  // Motion Logic
  autoRotate: boolean; 
  invertPerspective: boolean; // Ascension Mode
  morphEnabled: boolean; 
  enableTrails: boolean; // New: Astral Trails
  
  // Physics Toggles (Independent)
  enableFlow: boolean;
  enableFloat: boolean;
  enablePulse: boolean;
}