
export interface Song {
  file: File;
  id: string;
  name: string;
  duration?: number;
  // Harmonic Analysis Data
  harmonicFreq?: number;       // The dominant frequency detected
  closestSolfeggio?: number;   // The calculated nearest Solfeggio tone
  harmonicDeviation?: number;  // How close it is to the target (lower is better)
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
  
  // Color Logic
  colorMode: 'chakra' | 'cycle' | 'static'; 
  
  // Motion Logic
  autoRotate: boolean; // New: Toggle rotation
  invertPerspective: boolean; // New: Flip Y/Z axis
  particleMotion: 'flow' | 'float' | 'pulse';
  morphEnabled: boolean; 
}
