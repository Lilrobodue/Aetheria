/**
 * Fractal Frequency Analysis System
 * 
 * Advanced frequency detection using fractal mathematics and sacred geometry patterns
 * Implements 111 Hz pattern detection and infinite order harmonic analysis
 */

// Mathematical constants for fractal analysis
export const FRACTAL_CONSTANTS = {
  PHI: (1 + Math.sqrt(5)) / 2, // Golden ratio
  PI_PHI: Math.PI * ((1 + Math.sqrt(5)) / 2),
  SACRED_ANGLE: Math.PI * (3 - Math.sqrt(5)), // 137.5° in radians
  FIBONACCI_PRIME: 1.618033988749895,
  EULER_PHI: 0.618033988749895,
  PLANCK_RESONANCE: 6.62607015e-34 * 432e12, // Planck constant scaled to 432Hz
  SCHUMANN_BASE: 7.83, // Schumann resonance base frequency
  DNA_HELIX_ANGLE: 36, // DNA double helix angle
  GOLDEN_SPIRAL_RATIO: 1.272019649514069 // Fourth root of golden ratio
};

// 111 Hz pattern detection constants
export const PATTERN_111 = {
  BASE_FREQUENCY: 111,
  HARMONIC_SERIES: [111, 222, 333, 444, 555, 666, 777, 888, 999, 1110, 1221, 1332],
  DNA_RESONANCE_MULTIPLIERS: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24, 48, 96],
  FRACTAL_RATIOS: [
    111 * FRACTAL_CONSTANTS.PHI,
    111 * FRACTAL_CONSTANTS.EULER_PHI,
    111 * Math.sqrt(2),
    111 * Math.sqrt(3),
    111 * Math.sqrt(5)
  ]
};

// Extended Solfeggio frequencies including upper harmonics and higher orders
export const EXTENDED_SOLFEGGIO = {
  LOWER_OCTAVES: [87, 142.5, 174, 285, 396, 417, 528, 639, 741, 852, 963],
  BASE_FREQUENCIES: [174, 285, 396, 417, 528, 639, 741, 852, 963],
  HIGHER_OCTAVES: [1056, 1122, 1188, 1278, 1482, 1584, 1704, 1926],
  ULTRA_HIGH: [2112, 2244, 2376, 2556, 2964, 3168, 3408, 3852],
  
  // Higher Order Solfeggio Progressions
  FOURTH_ORDER: [1074, 1317, 1641], // 963 + (111, 243, 324)
  FIFTH_ORDER: [1752, 1995, 2319],  // Fourth + (111, 243, 324)
  SIXTH_ORDER: [2430, 2673, 2997],  // Fifth + (111, 243, 324)
  
  // Specialized Series
  DNA_ACTIVATION: [528, 1056, 2112, 4224], // 528Hz and its octaves
  CELLULAR_REPAIR: [285, 570, 1140, 2280], // 285Hz cellular regeneration series
  PINEAL_ACTIVATION: [963, 1926, 3852, 7704], // Crown chakra activation series
  CONSCIOUSNESS_EXPANSION: [1074, 1641, 1995, 2319], // Higher order consciousness frequencies
  DIMENSIONAL_ACCESS: [1317, 1752, 2430, 2673], // Interdimensional communication frequencies
  UNITY_CONSCIOUSNESS: [2997], // Ultimate unity frequency
};

// Safety frequency ranges with protection protocols
export const SAFETY_PROTOCOLS = {
  SAFE_RANGE: { min: 20, max: 1073 }, // General safe listening range
  CAUTION_RANGE: { min: 1074, max: 2000 }, // Requires subtle resonance mode
  EXPERT_RANGE: { min: 2001, max: 8000 }, // Advanced practitioners only
  RESEARCH_RANGE: { min: 8001, max: 20000 }, // Research/documentation only
  
  // Volume reduction curves for higher frequencies
  VOLUME_CURVES: {
    1074: 0.3, // 30% of normal volume
    1500: 0.2, // 20% of normal volume
    2000: 0.15, // 15% of normal volume
    3000: 0.1, // 10% of normal volume
    5000: 0.05, // 5% of normal volume
    8000: 0.02, // 2% of normal volume (barely perceptible)
  }
};

// DNA frequency mapping based on molecular vibration research
export const DNA_FREQUENCY_MAP = {
  // Base pairs and their resonant frequencies
  ADENINE_THYMINE: [523.25, 659.25, 783.99], // A-T base pair resonance
  GUANINE_CYTOSINE: [587.33, 698.46, 830.61], // G-C base pair resonance
  
  // DNA structural frequencies
  DOUBLE_HELIX_ROTATION: 36, // Base frequency for helix twist
  MAJOR_GROOVE: 432, // Major groove resonance
  MINOR_GROOVE: 288, // Minor groove resonance
  
  // Chromosome frequencies (theoretical)
  TELOMERE_PROTECTION: [174, 285, 396], // Protective frequencies
  GENE_EXPRESSION: [528, 639, 741], // Expression enhancement
  DNA_REPAIR: [285, 528, 852], // Repair mechanism activation
  
  // Mitochondrial DNA frequencies
  MITOCHONDRIAL_BASE: 58.27, // Base mitochondrial frequency
  CELLULAR_ENERGY: [58.27, 116.54, 233.08, 466.16], // Energy production series
};

export interface FractalAnalysisResult {
  dominantFrequency: number;
  harmonicSeries: number[];
  fractalDimension: number;
  goldenRatioAlignment: number; // 0-1, how well aligned with golden ratio
  pattern111Presence: number; // 0-1, strength of 111Hz pattern
  dnaResonanceScore: number; // 0-1, DNA activation potential
  safetyLevel: 'SAFE' | 'CAUTION' | 'EXPERT' | 'RESEARCH';
  recommendedVolume: number; // 0-1, safe volume level
  infiniteOrderHarmonics: number[]; // Infinite series approximation
  sacredGeometryAlignment: number; // 0-1, alignment with sacred geometry
  schumannResonanceHarmony: number; // 0-1, harmony with Earth's frequency
}

export interface FrequencyPattern {
  frequency: number;
  amplitude: number;
  phase: number;
  harmonics: number[];
  fractalOrder: number;
  geometryType: 'fibonacci' | 'golden_spiral' | 'pentagram' | 'flower_of_life' | 'metatron';
}

/**
 * Advanced fractal frequency analysis using multiple detection algorithms
 * Now with yielding for better performance and interruptibility
 */
export const analyzeFractalFrequencies = async (audioBuffer: AudioBuffer): Promise<FractalAnalysisResult> => {
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const bufferLength = channelData.length;
  
  // Reduce FFT size for performance on large audio files
  const maxFFTSize = 32768; // Reduced from automatic calculation
  const fftSize = Math.min(maxFFTSize, Math.pow(2, Math.ceil(Math.log2(Math.min(bufferLength, 131072)))));
  
  console.log(`Starting fractal analysis: ${bufferLength} samples, FFT size: ${fftSize}`);
  
  // 1. Enhanced FFT Analysis with fractal windowing (with yielding)
  await new Promise(resolve => setTimeout(resolve, 10)); // Yield
  const frequencies = performFractalFFT(channelData, fftSize, sampleRate);
  
  // 2. Golden ratio harmonic detection (with yielding)
  await new Promise(resolve => setTimeout(resolve, 10));
  const goldenHarmonics = detectGoldenRatioHarmonics(frequencies);
  
  // 3. 111 Hz pattern analysis (with yielding)
  await new Promise(resolve => setTimeout(resolve, 10));
  const pattern111Analysis = analyze111Pattern(frequencies);
  
  // 4. DNA resonance scoring (with yielding)
  await new Promise(resolve => setTimeout(resolve, 10));
  const dnaScore = calculateDNAResonance(frequencies);
  
  // 5. Fractal dimension calculation (with yielding)
  await new Promise(resolve => setTimeout(resolve, 10));
  const fractalDim = calculateFractalDimension(frequencies);
  
  // 6. Infinite order harmonic series (with yielding)
  await new Promise(resolve => setTimeout(resolve, 10));
  const infiniteHarmonics = generateInfiniteOrderHarmonics(goldenHarmonics.dominantFreq);
  
  // 7. Safety assessment
  const safetyAssessment = assessFrequencySafety(goldenHarmonics.dominantFreq);
  
  // 8. Sacred geometry alignment (with yielding)
  await new Promise(resolve => setTimeout(resolve, 10));
  const geometryAlignment = calculateSacredGeometryAlignment(frequencies);
  
  // 9. Schumann resonance harmony (with yielding)
  await new Promise(resolve => setTimeout(resolve, 10));
  const schumannHarmony = calculateSchumannHarmony(frequencies);
  
  console.log(`Fractal analysis complete: ${goldenHarmonics.dominantFreq.toFixed(1)}Hz`);
  
  return {
    dominantFrequency: goldenHarmonics.dominantFreq,
    harmonicSeries: goldenHarmonics.harmonics,
    fractalDimension: fractalDim,
    goldenRatioAlignment: goldenHarmonics.alignment,
    pattern111Presence: pattern111Analysis.presence,
    dnaResonanceScore: dnaScore,
    safetyLevel: safetyAssessment.level,
    recommendedVolume: safetyAssessment.volume,
    infiniteOrderHarmonics: infiniteHarmonics,
    sacredGeometryAlignment: geometryAlignment,
    schumannResonanceHarmony: schumannHarmony
  };
};

/**
 * Interruptible version of fractal analysis with timeout
 */
export const analyzeFractalFrequenciesWithTimeout = async (
  audioBuffer: AudioBuffer, 
  timeoutMs: number = 60000
): Promise<FractalAnalysisResult> => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Fractal analysis timeout'));
    }, timeoutMs);

    analyzeFractalFrequencies(audioBuffer)
      .then(result => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timeout);
        reject(error);
      });
  });
};

/**
 * Fractal-windowed FFT analysis (optimized for performance)
 */
const performFractalFFT = (channelData: Float32Array, fftSize: number, sampleRate: number): Float32Array => {
  // Use smaller sample from middle of audio for performance
  const sampleStart = Math.floor(channelData.length * 0.25); // Start at 25%
  const sampleEnd = Math.floor(channelData.length * 0.75);   // End at 75%
  const sampleLength = Math.min(fftSize, sampleEnd - sampleStart);
  
  // Apply golden ratio windowing for fractal analysis
  const windowedData = new Float32Array(fftSize);
  const phiWindow = generateGoldenRatioWindow(sampleLength);
  
  // Sample from the middle portion for better analysis
  const stride = Math.max(1, Math.floor((sampleEnd - sampleStart) / sampleLength));
  
  for (let i = 0; i < sampleLength; i++) {
    const sourceIndex = sampleStart + (i * stride);
    if (sourceIndex < channelData.length) {
      windowedData[i] = channelData[sourceIndex] * phiWindow[i];
    }
  }
  
  // Perform FFT (simplified but optimized)
  return performOptimizedFFT(windowedData, sampleLength);
};

/**
 * Optimized FFT implementation with reduced computation
 */
const performOptimizedFFT = (data: Float32Array, length: number): Float32Array => {
  // Simplified FFT that focuses on the frequency range we care about (20Hz - 4000Hz)
  const result = new Float32Array(length / 2);
  const sampleRate = 44100;
  const binSize = sampleRate / (length * 2);
  
  // Only analyze frequencies we care about (20Hz to 4000Hz)
  const startBin = Math.max(0, Math.floor(20 / binSize));
  const endBin = Math.min(result.length, Math.floor(4000 / binSize));
  
  // Reduced-complexity frequency analysis
  for (let i = startBin; i < endBin; i++) {
    let real = 0, imag = 0;
    const freq = i * binSize;
    
    // Use every 4th sample for speed while maintaining accuracy
    const step = Math.max(1, Math.floor(length / 1024));
    
    for (let j = 0; j < length; j += step) {
      const angle = -2 * Math.PI * i * j / length;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      
      real += data[j] * cos;
      imag += data[j] * sin;
    }
    
    result[i] = Math.sqrt(real * real + imag * imag) / length;
  }
  
  return result;
};

/**
 * Generate golden ratio window function
 */
const generateGoldenRatioWindow = (size: number): Float32Array => {
  const window = new Float32Array(size);
  const phi = FRACTAL_CONSTANTS.PHI;
  
  for (let i = 0; i < size; i++) {
    const t = i / size;
    // Golden ratio spiral window
    const angle = t * FRACTAL_CONSTANTS.SACRED_ANGLE;
    const radius = Math.pow(phi, t * 2 - 1);
    window[i] = Math.exp(-Math.pow((t - 0.5) * 2, 2)) * (1 + 0.618 * Math.cos(angle) * radius);
  }
  
  return window;
};

/**
 * Detect golden ratio harmonic relationships
 */
const detectGoldenRatioHarmonics = (frequencies: Float32Array): { dominantFreq: number, harmonics: number[], alignment: number } => {
  const phi = FRACTAL_CONSTANTS.PHI;
  let maxMagnitude = 0;
  let dominantFreq = 0;
  let dominantIndex = 0;
  
  // Find dominant frequency
  for (let i = 0; i < frequencies.length; i++) {
    if (frequencies[i] > maxMagnitude) {
      maxMagnitude = frequencies[i];
      dominantFreq = i * (44100 / frequencies.length); // Convert bin to Hz
      dominantIndex = i;
    }
  }
  
  // Calculate golden ratio harmonics
  const harmonics: number[] = [];
  let alignment = 0;
  
  // Generate harmonics based on golden ratio
  for (let n = 1; n <= 12; n++) {
    const harmonic = dominantFreq * Math.pow(phi, n - 6); // Center around fundamental
    if (harmonic > 20 && harmonic < 20000) {
      harmonics.push(harmonic);
      
      // Check alignment with actual frequency content
      const binIndex = Math.round(harmonic / (44100 / frequencies.length));
      if (binIndex < frequencies.length) {
        alignment += frequencies[binIndex] / maxMagnitude;
      }
    }
  }
  
  alignment /= harmonics.length;
  
  return { dominantFreq, harmonics, alignment };
};

/**
 * Analyze 111 Hz pattern presence and strength
 */
const analyze111Pattern = (frequencies: Float32Array): { presence: number, resonancePoints: number[] } => {
  const binSize = 44100 / frequencies.length;
  let totalPresence = 0;
  const resonancePoints: number[] = [];
  
  // Check each 111 Hz harmonic
  PATTERN_111.HARMONIC_SERIES.forEach(freq => {
    const binIndex = Math.round(freq / binSize);
    if (binIndex < frequencies.length) {
      const magnitude = frequencies[binIndex];
      totalPresence += magnitude;
      
      if (magnitude > 0.1) { // Threshold for significant presence
        resonancePoints.push(freq);
      }
    }
  });
  
  // Check DNA resonance multipliers
  DNA_FREQUENCY_MAP.CELLULAR_ENERGY.forEach(freq => {
    const binIndex = Math.round(freq / binSize);
    if (binIndex < frequencies.length) {
      totalPresence += frequencies[binIndex] * 1.5; // Weight DNA frequencies higher
    }
  });
  
  // Normalize presence score
  const presence = Math.min(1, totalPresence / PATTERN_111.HARMONIC_SERIES.length);
  
  return { presence, resonancePoints };
};

/**
 * Calculate DNA resonance activation potential
 */
const calculateDNAResonance = (frequencies: Float32Array): number => {
  const binSize = 44100 / frequencies.length;
  let dnaScore = 0;
  let totalWeights = 0;
  
  // Check DNA activation frequencies
  Object.values(DNA_FREQUENCY_MAP).flat().forEach((freq, index) => {
    if (typeof freq === 'number') {
      const binIndex = Math.round(freq / binSize);
      if (binIndex < frequencies.length) {
        const weight = freq === 528 ? 3 : freq === 285 ? 2 : 1; // Weight healing frequencies
        dnaScore += frequencies[binIndex] * weight;
        totalWeights += weight;
      }
    }
  });
  
  return totalWeights > 0 ? Math.min(1, dnaScore / totalWeights) : 0;
};

/**
 * Calculate fractal dimension of frequency spectrum
 */
const calculateFractalDimension = (frequencies: Float32Array): number => {
  // Box-counting method for fractal dimension
  const logFreqs = frequencies.map(f => Math.log(Math.max(f, 1e-10)));
  
  let dimension = 0;
  const scales = [2, 4, 8, 16, 32];
  
  scales.forEach(scale => {
    let count = 0;
    for (let i = 0; i < logFreqs.length - scale; i += scale) {
      let hasSignificantVariation = false;
      for (let j = i; j < i + scale; j++) {
        if (Math.abs(logFreqs[j] - logFreqs[i]) > 0.1) {
          hasSignificantVariation = true;
          break;
        }
      }
      if (hasSignificantVariation) count++;
    }
    dimension += Math.log(count) / Math.log(1 / scale);
  });
  
  return Math.max(1, Math.min(3, dimension / scales.length));
};

/**
 * Generate infinite order harmonic series
 */
const generateInfiniteOrderHarmonics = (fundamental: number): number[] => {
  const harmonics: number[] = [];
  const phi = FRACTAL_CONSTANTS.PHI;
  
  // Generate harmonics based on various mathematical series
  for (let n = 1; n <= 24; n++) {
    // Harmonic series
    harmonics.push(fundamental * n);
    
    // Golden ratio series
    harmonics.push(fundamental * Math.pow(phi, n / 12));
    
    // Fibonacci series (scaled)
    const fib = fibonacci(n) / 100;
    harmonics.push(fundamental * fib);
    
    // Sacred geometry ratios
    harmonics.push(fundamental * Math.sqrt(n));
    harmonics.push(fundamental * Math.pow(2, n / 12)); // Equal temperament
  }
  
  // Filter to audible range and remove duplicates
  return [...new Set(harmonics)]
    .filter(f => f >= 20 && f <= 20000)
    .sort((a, b) => a - b)
    .slice(0, 50); // Limit to 50 harmonics for performance
};

/**
 * Assess frequency safety level
 */
export const assessFrequencySafety = (frequency: number): { level: 'SAFE' | 'CAUTION' | 'EXPERT' | 'RESEARCH', volume: number } => {
  if (frequency <= SAFETY_PROTOCOLS.SAFE_RANGE.max) {
    return { level: 'SAFE', volume: 1.0 };
  } else if (frequency <= SAFETY_PROTOCOLS.CAUTION_RANGE.max) {
    const volume = interpolateVolume(frequency, SAFETY_PROTOCOLS.VOLUME_CURVES);
    return { level: 'CAUTION', volume };
  } else if (frequency <= SAFETY_PROTOCOLS.EXPERT_RANGE.max) {
    const volume = interpolateVolume(frequency, SAFETY_PROTOCOLS.VOLUME_CURVES);
    return { level: 'EXPERT', volume };
  } else {
    return { level: 'RESEARCH', volume: 0.01 };
  }
};

/**
 * Calculate sacred geometry alignment
 */
const calculateSacredGeometryAlignment = (frequencies: Float32Array): number => {
  const sacredRatios = [
    FRACTAL_CONSTANTS.PHI,
    Math.sqrt(2),
    Math.sqrt(3),
    Math.sqrt(5),
    Math.PI,
    Math.E,
    FRACTAL_CONSTANTS.GOLDEN_SPIRAL_RATIO
  ];
  
  let alignment = 0;
  const binSize = 44100 / frequencies.length;
  
  // Check how well frequency content aligns with sacred ratios
  for (let i = 1; i < frequencies.length; i++) {
    if (frequencies[i] > 0.1) { // Significant frequency
      const currentFreq = i * binSize;
      
      sacredRatios.forEach(ratio => {
        const expectedFreq = currentFreq * ratio;
        const expectedBin = Math.round(expectedFreq / binSize);
        
        if (expectedBin < frequencies.length && frequencies[expectedBin] > 0.05) {
          alignment += frequencies[i] * frequencies[expectedBin];
        }
      });
    }
  }
  
  return Math.min(1, alignment / frequencies.length);
};

/**
 * Calculate Schumann resonance harmony
 */
const calculateSchumannHarmony = (frequencies: Float32Array): number => {
  const schumannHarmonics = [7.83, 14.3, 20.8, 27.3, 33.8, 39.3, 45.9, 59.9, 66.8];
  const binSize = 44100 / frequencies.length;
  let harmony = 0;
  
  schumannHarmonics.forEach(freq => {
    const binIndex = Math.round(freq / binSize);
    if (binIndex < frequencies.length) {
      harmony += frequencies[binIndex];
    }
    
    // Check octaves
    let octave = freq * 2;
    while (octave < 20000) {
      const octaveBin = Math.round(octave / binSize);
      if (octaveBin < frequencies.length) {
        harmony += frequencies[octaveBin] * 0.5; // Weight octaves less
      }
      octave *= 2;
    }
  });
  
  return Math.min(1, harmony / schumannHarmonics.length);
};

// Helper functions
const fibonacci = (n: number): number => {
  if (n <= 1) return n;
  let a = 0, b = 1, temp;
  for (let i = 2; i <= n; i++) {
    temp = a + b;
    a = b;
    b = temp;
  }
  return b;
};

const interpolateVolume = (frequency: number, volumeCurve: { [key: number]: number }): number => {
  const keys = Object.keys(volumeCurve).map(Number).sort((a, b) => a - b);
  
  for (let i = 0; i < keys.length - 1; i++) {
    if (frequency >= keys[i] && frequency <= keys[i + 1]) {
      const t = (frequency - keys[i]) / (keys[i + 1] - keys[i]);
      return volumeCurve[keys[i]] * (1 - t) + volumeCurve[keys[i + 1]] * t;
    }
  }
  
  // If beyond range, use minimum volume
  return keys.length > 0 ? volumeCurve[keys[keys.length - 1]] : 0.01;
};

// Simplified FFT implementation (placeholder - use proper FFT library in production)
const performFFT = (data: Float32Array): Float32Array => {
  // This is a placeholder. In a real implementation, use:
  // - Web Audio API AnalyserNode.getFloatFrequencyData()
  // - Or a proper FFT library like fft.js
  const result = new Float32Array(data.length / 2);
  
  for (let i = 0; i < result.length; i++) {
    let real = 0, imag = 0;
    for (let j = 0; j < data.length; j++) {
      const angle = -2 * Math.PI * i * j / data.length;
      real += data[j] * Math.cos(angle);
      imag += data[j] * Math.sin(angle);
    }
    result[i] = Math.sqrt(real * real + imag * imag) / data.length;
  }
  
  return result;
};

/**
 * User-friendly frequency suggestions based on intention
 */
export const getFrequencyByIntention = (intention: string): number[] => {
  const intentionMap: { [key: string]: number[] } = {
    'dna_repair': DNA_FREQUENCY_MAP.DNA_REPAIR,
    'cellular_healing': EXTENDED_SOLFEGGIO.CELLULAR_REPAIR,
    'energy_boost': DNA_FREQUENCY_MAP.CELLULAR_ENERGY,
    'meditation': [7.83, 14.3, 40, 100, 528, 741, 852],
    'focus': [40, 100, 528, 741],
    'sleep': [0.5, 1, 2, 3, 174, 285],
    'creativity': [8, 10, 40, 528, 639],
    'protection': EXTENDED_SOLFEGGIO.LOWER_OCTAVES,
    'manifestation': [111, 222, 333, 528, 639],
    'grounding': [7.83, 14.3, 174, 285, 396],
    'third_eye': [852, 963, 1074, 1752],
    'heart_opening': [341.3, 528, 639, 1278],
    'throat_chakra': [384, 417, 741, 852],
    'crown_activation': [963, 1074, 1926, 3852],
    
    // Higher Order Intentions
    'consciousness_expansion': EXTENDED_SOLFEGGIO.CONSCIOUSNESS_EXPANSION,
    'dimensional_access': EXTENDED_SOLFEGGIO.DIMENSIONAL_ACCESS,
    'unity_consciousness': EXTENDED_SOLFEGGIO.UNITY_CONSCIOUSNESS,
    'pineal_activation': [963, 1074, 1641, 1995],
    'quantum_awareness': [1995, 2319, 2673],
    'transcendence': [2997],
    'interdimensional': [1317, 1752, 2430],
    'cosmic_alignment': [1641, 1995, 2319, 2673],
    'source_connection': [2673, 2997],
    'galactic_resonance': [1752, 2430, 2997]
  };
  
  return intentionMap[intention.toLowerCase()] || [528, 741, 852];
};

/**
 * Generate safety warning for high frequencies
 */
export const generateSafetyWarning = (frequency: number): string | null => {
  if (frequency >= SAFETY_PROTOCOLS.EXPERT_RANGE.min) {
    return `⚠️ EXPERT LEVEL FREQUENCY (${frequency.toFixed(0)}Hz)\n\nThis frequency operates beyond normal therapeutic ranges. Use only with:\n• Deep meditation experience\n• Sound healing training\n• Short exposure periods (5-15 minutes)\n• Volume kept at ${Math.round(assessFrequencySafety(frequency).volume * 100)}% or lower\n\nStop immediately if you experience discomfort.`;
  } else if (frequency >= SAFETY_PROTOCOLS.CAUTION_RANGE.min) {
    return `⚠️ CAUTION: High Frequency (${frequency.toFixed(0)}Hz)\n\nThis frequency requires subtle resonance mode:\n• Keep volume low (${Math.round(assessFrequencySafety(frequency).volume * 100)}% recommended)\n• Focus on feeling rather than hearing\n• Limit sessions to 20-30 minutes\n• Take breaks between sessions`;
  }
  
  return null;
};