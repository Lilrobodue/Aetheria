/**
 * Phi (φ) Integration for Aetheria
 * Implements golden ratio relationships in audio layers
 * 
 * The golden ratio (φ = 1.618033988749...) creates natural harmonic relationships
 * that the human ear and consciousness process effortlessly.
 */

// Precise phi constants
export const PHI = 1.6180339887498948482;
export const PHI_SQUARED = 2.6180339887498948482;
export const INV_PHI = 0.6180339887498948482; // φ - 1 = 1/φ
export const INV_PHI_SQUARED = 0.3819660112501051518;
export const GOLDEN_ANGLE_DEG = 137.50776405003785;
export const GOLDEN_ANGLE_RAD = 2.3999632297286533;

/**
 * CHANGE 1: Calculate phi-based volume ratios for the three audio layers
 * Creates natural depth hierarchy that mirrors acoustic environments
 * 
 * @param musicLayerVolume - Reference volume for music layer (typically 1.0)
 * @returns Object with volume values for all three layers
 */
export function calculatePhiVolumeRatios(musicLayerVolume: number = 1.0) {
  return {
    music: musicLayerVolume,
    binaural: musicLayerVolume * INV_PHI,        // ≈ 0.618034
    solfeggio: musicLayerVolume * INV_PHI_SQUARED // ≈ 0.381966
  };
}

/**
 * CHANGE 2: Apply golden angle phase offset to binaural beat generation
 * Creates maximum energy distribution with minimum destructive interference
 * 
 * @param frequency - Base frequency in Hz
 * @param currentTime - Current audio context time
 * @param isLeftChannel - Whether this is the left channel oscillator
 * @returns Phase offset in radians
 */
export function getBinauralPhaseOffset(frequency: number, currentTime: number, isLeftChannel: boolean): number {
  // Left channel starts at 0°, right channel starts at golden angle (137.5°)
  return isLeftChannel ? 0 : GOLDEN_ANGLE_RAD;
}

/**
 * CHANGE 3: Calculate phi-proportioned timing markers for track progression
 * Creates natural build, peak, and resolution phases
 * 
 * @param totalDuration - Total track duration in seconds
 * @returns Object with timing markers in seconds
 */
export function getPhiTimingMarkers(totalDuration: number) {
  const buildPhaseEnd = totalDuration * INV_PHI_SQUARED;    // 38.2% mark
  const peakMoment = totalDuration * INV_PHI;               // 61.8% mark
  const resolutionPhaseStart = peakMoment;                  // Same as peak
  
  return {
    buildPhaseEnd,        // End of introduction/build phase
    peakMoment,          // Peak entrainment/convergence point
    resolutionPhaseStart, // Start of resolution/integration phase
    totalDuration,       // End of track
    
    // Additional useful markers
    goldenMomentTime: peakMoment,
    buildDuration: buildPhaseEnd,
    peakDuration: peakMoment - buildPhaseEnd,
    resolutionDuration: totalDuration - peakMoment
  };
}

/**
 * Calculate dynamic volume envelope based on phi timing
 * Provides smooth transitions between phases
 * 
 * @param currentTime - Current playback time in seconds
 * @param totalDuration - Total track duration in seconds
 * @param baseVolume - Base volume level
 * @returns Adjusted volume based on track position
 */
export function getPhiEnvelopeVolume(currentTime: number, totalDuration: number, baseVolume: number): number {
  const markers = getPhiTimingMarkers(totalDuration);
  const progress = currentTime / totalDuration;
  
  if (currentTime <= markers.buildPhaseEnd) {
    // Build phase: gradual increase from 70% to 100%
    const buildProgress = currentTime / markers.buildPhaseEnd;
    return baseVolume * (0.7 + 0.3 * buildProgress);
  } else if (currentTime <= markers.peakMoment) {
    // Peak phase: maintain full volume
    return baseVolume;
  } else {
    // Resolution phase: gradual decrease to 85%
    const resolutionProgress = (currentTime - markers.peakMoment) / markers.resolutionDuration;
    return baseVolume * (1.0 - 0.15 * resolutionProgress);
  }
}

/**
 * Get intensity multiplier for effects based on phi timing
 * Used for binaural beat intensity, visualization effects, etc.
 * 
 * @param currentTime - Current playback time in seconds
 * @param totalDuration - Total track duration in seconds
 * @returns Intensity multiplier (0.0 to 1.0)
 */
export function getPhiIntensityMultiplier(currentTime: number, totalDuration: number): number {
  const markers = getPhiTimingMarkers(totalDuration);
  const progress = currentTime / totalDuration;
  
  if (currentTime <= markers.buildPhaseEnd) {
    // Build phase: exponential increase
    const buildProgress = currentTime / markers.buildPhaseEnd;
    return Math.pow(buildProgress, PHI);
  } else if (currentTime <= markers.peakMoment) {
    // Approach to peak: reach maximum
    const peakProgress = (currentTime - markers.buildPhaseEnd) / (markers.peakMoment - markers.buildPhaseEnd);
    return 0.8 + 0.2 * peakProgress; // 80% to 100%
  } else {
    // Resolution phase: gentle decrease following inverse phi
    const resolutionProgress = (currentTime - markers.peakMoment) / markers.resolutionDuration;
    return Math.pow(1 - resolutionProgress * 0.3, INV_PHI); // Decrease to ~70%
  }
}

/**
 * Create phi-based oscillator with golden angle phase offset
 * Used for enhanced binaural beat generation
 * 
 * @param audioContext - Web Audio API context
 * @param frequency - Oscillator frequency in Hz
 * @param phaseOffset - Phase offset in radians (use GOLDEN_ANGLE_RAD for right channel)
 * @param startTime - When to start the oscillator
 * @returns Configured oscillator node
 */
export function createPhiOscillator(
  audioContext: AudioContext,
  frequency: number,
  phaseOffset: number = 0,
  startTime: number = 0
): OscillatorNode {
  const oscillator = audioContext.createOscillator();
  oscillator.frequency.value = frequency;
  oscillator.type = 'sine';
  
  // Apply phase offset using a delay (phase shift in time domain)
  // Phase offset in radians converted to time offset
  const timeOffset = phaseOffset / (2 * Math.PI * frequency);
  
  // Start with the calculated phase offset
  oscillator.start(startTime + timeOffset);
  
  return oscillator;
}

/**
 * Debug helper to log phi relationships
 */
export function logPhiRelationships(musicVolume: number = 1.0, trackDuration: number = 300) {
  const volumes = calculatePhiVolumeRatios(musicVolume);
  const timing = getPhiTimingMarkers(trackDuration);
  
  console.log('=== PHI INTEGRATION DEBUG ===');
  console.log('Volume Ratios:', {
    music: volumes.music.toFixed(3),
    binaural: volumes.binaural.toFixed(3),
    solfeggio: volumes.solfeggio.toFixed(3)
  });
  console.log('Timing Markers (for 5min track):', {
    buildEnd: `${Math.floor(timing.buildPhaseEnd / 60)}:${Math.round(timing.buildPhaseEnd % 60).toString().padStart(2, '0')}`,
    peak: `${Math.floor(timing.peakMoment / 60)}:${Math.round(timing.peakMoment % 60).toString().padStart(2, '0')}`,
    resolutionStart: `${Math.floor(timing.resolutionPhaseStart / 60)}:${Math.round(timing.resolutionPhaseStart % 60).toString().padStart(2, '0')}`
  });
  console.log('Golden Angle:', {
    degrees: GOLDEN_ANGLE_DEG.toFixed(1) + '°',
    radians: GOLDEN_ANGLE_RAD.toFixed(6) + ' rad'
  });
  console.log('===========================');
}

/**
 * Integration helper for Aetheria's existing volume system
 * Maintains backwards compatibility while adding phi relationships
 * 
 * @param currentMusicVolume - Current music/master volume
 * @param currentBinauralVolume - Current binaural volume
 * @param currentSolfeggioVolume - Current solfeggio volume
 * @param enablePhiMode - Whether to apply phi ratios
 * @returns Adjusted volumes
 */
export function integratePhiVolumes(
  currentMusicVolume: number,
  currentBinauralVolume: number,
  currentSolfeggioVolume: number,
  enablePhiMode: boolean = true
): { music: number, binaural: number, solfeggio: number } {
  if (!enablePhiMode) {
    // Return current values unchanged
    return {
      music: currentMusicVolume,
      binaural: currentBinauralVolume,
      solfeggio: currentSolfeggioVolume
    };
  }
  
  // Apply phi ratios while respecting user adjustments
  const phiRatios = calculatePhiVolumeRatios(currentMusicVolume);
  
  // Scale the phi ratios by the user's current settings
  // This preserves user intent while applying golden ratio relationships
  const binauralScale = currentBinauralVolume / 0.03; // Current default is 3%
  const solfeggioScale = currentSolfeggioVolume / 0.01; // Current default is 1%
  
  return {
    music: currentMusicVolume,
    binaural: phiRatios.binaural * binauralScale * 0.05, // Scale down to reasonable levels
    solfeggio: phiRatios.solfeggio * solfeggioScale * 0.03 // Scale down to reasonable levels
  };
}