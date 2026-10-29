// utils/crystalData.ts (v15.8)
//
// The crystal vocabulary the mix recipes and their checks share, importable by Node (type stripping) as well as the
// app. The 27 crystals and the walk sequences stay defined in constants.ts (re-exported here; constants.ts's type-only
// import makes it Node-importable). getHarmonicSolfeggio moved here from App.tsx VERBATIM (Deep Scan, playTrack and
// Auto-Distribute call it by the same name). The presets are the classic drawer's literals, as data.

import { SOLFEGGIO_INFO } from '../constants.ts';
export {
  SOLFEGGIO_INFO, LO_SHU_WALKS, LO_SHU_WALK_INFO, LO_SHU_WALK_COMBINED, LO_SHU_WALK_OUROBOROS, OUROBOROS_PHASES, SOURCE_FREQ,
} from '../constants.ts';
export type { LoShuWalkMode } from '../constants.ts';

/** The three regimes' crystals, ascending (the lists Auto-Distribute and getHarmonicSolfeggio spell out inline). */
export const GUT_CRYSTALS: readonly number[] = [174, 285, 396, 417, 528, 639, 741, 852, 963];
export const HEART_CRYSTALS: readonly number[] = [1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150];
export const HEAD_CRYSTALS: readonly number[] = [3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];

/** The five crystal-set presets (the classic drawer's literals: name as in the "No songs found for …" toast, label as
 *  the button's first line). v15.9: the neutral names the user confirmed on 2026-10-26, in both layouts (decision 12;
 *  they were Qi Strengthening, Deep Healing, Mood Elevation, Deep Meditation and Flow State). The ids stay. */
export type PresetId = 'qi' | 'healing' | 'mood' | 'meditation' | 'flow';
export interface PresetDef { id: PresetId; name: string; label: string; crystals: readonly number[] }
export const PRESETS: readonly PresetDef[] = [
  { id: 'qi', name: 'Grounding', label: 'Grounding', crystals: [174, 285, 396, 417] },
  { id: 'healing', name: 'Stillness', label: 'Stillness', crystals: [174, 285, 528] },
  { id: 'mood', name: 'Uplift', label: 'Uplift', crystals: [396, 417, 639] },
  { id: 'meditation', name: 'Meditation', label: 'Meditation', crystals: [741, 852, 963] },
  { id: 'flow', name: 'Flow', label: 'Flow', crystals: [285, 417, 528, 639, 741] },
];
/** A preset's recipe as its sub-line: "174 · 285 · 396 · 417 Hz" (the Mixes tab); classic's drawer shows "174·285·396·417". */
export const presetRecipe = (p: { crystals: readonly number[] }, sep: string = ' · ', unit: string = ' Hz'): string => p.crystals.join(sep) + unit;

// v16.3: `quiet` skips the per-call console lines (Assign crystals asks once per placed track); the answer is the same.
export const getHarmonicSolfeggio = (detectedFreq: number, quiet: boolean = false): number => {
    if (detectedFreq <= 0) return 396; 

    // Define the 3-regime frequency sets for prioritized matching
    const gutFrequencies = [174, 285, 396, 417, 528, 639, 741, 852, 963];
    const heartFrequencies = [1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150]; // HEART regime with 243 steady progression
    const headFrequencies = [3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336]; // HEAD regime with 354 steady progression

    let bestMatch = 396;
    let minScore = Infinity;

    if (!quiet) console.log(`Analyzing frequency: ${detectedFreq.toFixed(1)}Hz for solfeggio matching`);

    // Enhanced harmonic matching with extended octave range checking
    SOLFEGGIO_INFO.forEach(s => {
        const sFreq = s.freq;
        
        // Determine tolerance and harmonic checking strategy based on regime
        let tolerance = 50; // Default for GUT
        let useExtendedHarmonics = false;
        
        if (headFrequencies.includes(sFreq)) {
            tolerance = 400; // Very wide tolerance for HEAD frequencies
            useExtendedHarmonics = false; // Direct matching only for high frequencies
        } else if (heartFrequencies.includes(sFreq)) {
            tolerance = 200; // Wide tolerance for HEART frequencies  
            useExtendedHarmonics = true; // Limited harmonic checking
        } else if (gutFrequencies.includes(sFreq)) {
            tolerance = 50; // Tighter tolerance for GUT frequencies
            useExtendedHarmonics = true; // Full harmonic analysis
        }
        
        // Direct frequency matching
        const directDiff = Math.abs(detectedFreq - sFreq);
        if (directDiff <= tolerance && directDiff < minScore) {
            minScore = directDiff;
            bestMatch = sFreq;
            if (!quiet) console.log(`Direct match found: ${detectedFreq.toFixed(1)}Hz ≈ ${sFreq}Hz (diff: ${directDiff.toFixed(1)}Hz)`);
        }

        // Extended harmonic matching with comprehensive octave checking
        if (useExtendedHarmonics && minScore > 10) { // Only if no close direct match
            const harmonicCandidates: number[] = [];
            
            // Traditional octave relationships (powers of 2)
            for (let octave = -4; octave <= 6; octave++) {
                if (octave !== 0) {
                    const octaveFreq = sFreq * Math.pow(2, octave);
                    if (octaveFreq >= 10 && octaveFreq <= 25000) {
                        harmonicCandidates.push(octaveFreq);
                    }
                }
            }
            
            // Integer harmonic series (for GUT frequencies only)
            if (gutFrequencies.includes(sFreq)) {
                // Fundamental and its harmonics
                for (let harmonic = 1; harmonic <= 12; harmonic++) {
                    harmonicCandidates.push(sFreq * harmonic);
                }
                
                // Sub-harmonics (fundamental divided by integers)
                for (let divisor = 2; divisor <= 8; divisor++) {
                    const subharmonic = sFreq / divisor;
                    if (subharmonic >= 10) {
                        harmonicCandidates.push(subharmonic);
                    }
                }
                
                // Perfect fifth (3:2 ratio) and perfect fourth (4:3 ratio)
                harmonicCandidates.push(sFreq * 1.5); // Perfect fifth up
                harmonicCandidates.push(sFreq / 1.5); // Perfect fifth down
                harmonicCandidates.push(sFreq * 4/3); // Perfect fourth up
                harmonicCandidates.push(sFreq * 3/4); // Perfect fourth down
            }
            
            // Check all harmonic candidates
            harmonicCandidates.forEach(candidate => {
                const harmonicDiff = Math.abs(detectedFreq - candidate);
                if (harmonicDiff < minScore) {
                    minScore = harmonicDiff;
                    bestMatch = sFreq;
                    if (!quiet) console.log(`Harmonic match found: ${detectedFreq.toFixed(1)}Hz ≈ ${candidate.toFixed(1)}Hz (${sFreq}Hz harmonic, diff: ${harmonicDiff.toFixed(1)}Hz)`);
                }
            });
        }
    });

    // Special case: If detected frequency is very high and no match found, try to find the fundamental
    if (minScore > 100 && detectedFreq > 1000) {
        if (!quiet) console.log(`High frequency detected (${detectedFreq.toFixed(1)}Hz), searching for fundamental...`);
        
        // Try to find the fundamental by dividing by common harmonic ratios
        const possibleFundamentals = [
            detectedFreq / 2,   // Octave down
            detectedFreq / 3,   // Third harmonic
            detectedFreq / 4,   // Fourth harmonic (two octaves down)
            detectedFreq / 5,   // Fifth harmonic
            detectedFreq / 6,   // Sixth harmonic
            detectedFreq / 8,   // Eighth harmonic (three octaves down)
            detectedFreq * 2/3, // Perfect fifth down
            detectedFreq * 3/4, // Perfect fourth down
        ];
        
        for (const fundamental of possibleFundamentals) {
            if (fundamental >= 50 && fundamental <= 1000) {
                const recursiveMatch = getHarmonicSolfeggio(fundamental, quiet);
                // Check if this fundamental gives us a better match
                const fundamentalDiff = Math.abs(fundamental - recursiveMatch);
                if (fundamentalDiff < minScore * 0.5) { // Significantly better match
                    if (!quiet) console.log(`Found fundamental: ${detectedFreq.toFixed(1)}Hz → ${fundamental.toFixed(1)}Hz → ${recursiveMatch}Hz`);
                    return recursiveMatch;
                }
            }
        }
    }

    if (!quiet) console.log(`Final solfeggio match: ${detectedFreq.toFixed(1)}Hz → ${bestMatch}Hz (deviation: ${minScore.toFixed(1)}Hz)`);
    return bestMatch;
};
