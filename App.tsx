import React, { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import { 
  Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, 
  Upload, Settings, Info, Activity, Volume2, Maximize2, Minimize2,
  Circle, Zap, X, Menu, Eye, EyeOff, ChevronDown, ChevronUp, BarChart3, Loader2, Sparkles, Sliders, Wind, Activity as PulseIcon, Waves, Wand2, Search, Video, Mic, Monitor, RefreshCw, Flame, Flower2, Layers, Heart, Smile, Moon, Droplets, FilePlus, RotateCw, ArrowUpCircle, Hexagon, AlertTriangle, CircleHelp, ChevronRight, ChevronLeft, BookOpen, User, Map as MapIcon, Box, Trash2, Target, Shield, Calculator, ExternalLink, Music, Brain, BookMarked, MessageCircle, Mail, Globe, Headphones, CheckCircle2
} from 'lucide-react';
import { Song, SolfeggioFreq, BinauralPreset, VizSettings, BandEnvelope } from './types';
import { SOLFEGGIO_INFO, BINAURAL_PRESETS, PITCH_SHIFT_FACTOR, toHeardHz, UNIFIED_THEORY, SEPHIROT_INFO, GEOMETRY_INFO, LO_SHU_WALKS, LO_SHU_WALK_INFO, LO_SHU_WALK_COMBINED, LO_SHU_WALK_OUROBOROS, OUROBOROS_PHASES, SOURCE_FREQ, getLoShuPosition, type LoShuWalkMode } from './constants';
import Visualizer from './components/Visualizer';
import FrequencySelector from './components/FrequencySelector';
import SafetyProtocols from './components/SafetyProtocols';
import ExperienceTracker from './components/ExperienceTracker';
import OfflineIndicator from './components/OfflineIndicator';
import LoShuMatrix from './components/LoShuMatrix';
import AccessibleGuidebook from './components/AccessibleGuidebook';
import ClearPlaylistButton from './components/ClearPlaylistButton';
import {
  restorePlaylist,
  clearPlaylistCache,
  saveBlobsNow,
  debouncedSaveMeta,
} from './utils/playlistCache';
import {
  analyzeFractalFrequencies,
  assessFrequencySafety,
  type FractalAnalysisResult
} from './utils/fractalFrequencyAnalysis';
import {
  analyzeIntervals,
  classificationLabel,
  couldBeAetheria,
  type IntervalAnalysisResult,
  type Peak as IntervalPeak,
} from './utils/intervalAnalysis';
import { 
  effectsManager, 
  experienceTracker, 
  type FrequencyEffect 
} from './utils/effectsDocumentation';
import { useMediaSession, type Track } from './hooks/useMediaSession';
import { stabilityManager, wakeLockManager } from './utils/stabilityManager';
import { frequencyToSpectrumColor, type FrequencyColorMode } from './utils/spectrumColor';
// NOTE: getBinauralPhaseOffset, getPhiTimingMarkers, getPhiEnvelopeVolume and
// createPhiOscillator were imported here but never called — dropped. They remain
// exported from phiIntegration.ts. Careful with createPhiOscillator if it is ever
// adopted: it calls .start() internally, so a caller that also starts the
// oscillator will throw InvalidStateError.
import {
  calculatePhiVolumeRatios,
  getPhiIntensityMultiplier,
  logPhiRelationships,
  integratePhiVolumes,
  GOLDEN_ANGLE_RAD,
  PHI,
  INV_PHI,
  INV_PHI_SQUARED
} from './utils/phiIntegration';
import { feltCarrierHz, thetaAlphaModHz, solfeggioHz } from './utils/frequencyMapping';

// --- Helpers ---

// True on phones/tablets, where the lock-screen media card needs the silent
// audio anchor to survive background auto-advance. Desktop skips the anchor
// entirely (no lock-screen problem, and the anchor would only duck the music).
const IS_MOBILE_DEVICE = (() => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
  if (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true; // iPadOS
  return false;
})();

// On mobile the continuously-playing silent anchor (required to hold the media
// card across the auto-advance load gap) is a second active audio source, which
// makes Chrome DUCK the music — audibly lowering it. We can't avoid the anchor
// (the card needs it) so we compensate by boosting the music element's volume on
// mobile to offset the duck. Approximate and tunable; raise if still too quiet,
// lower if too loud. Desktop has no anchor and no duck, so it uses 1.0.
const MOBILE_MUSIC_DUCK_COMPENSATION = 1.6;

// TUNING KNOB — relative loudness of the binaural/solfeggio layers.
// With direct playback, music left the Web Audio bus, so `gainNodeRef` now
// carries ONLY the binaural + solfeggio layers. Previously those layers
// shared the bus with the music and loud music peaks clipped/masked them
// together; on their own clean path they sit forward in the mix. This factor
// pushes them back behind the music the way they used to sit. 1.0 = exposed
// (clean-path level), lower = more recessed. Music loudness is unaffected.
// NOTE: the *audible* layer level is set by the trims in phiIntegration.ts
// (BINAURAL_TRIM / SOLFEGGIO_TRIM) — tune there, not here. This factor also
// scales the bus, so changing it moves both layers together.
const LAYER_BALANCE_ATTEN = 0.5;

// The media-session anchor element is SILENT — its only job is to hold the
// lock-screen card. We do NOT put the audible drone on it: an <audio loop> isn't
// gapless (it drops out every loop) and a fixed audible tone beats against
// drone-like songs — both heard as the drone "cutting in and out". The audible
// vibration now lives on a Web Audio oscillator instead (SUB_BASS_DRONE_*).
const ANCHOR_TONE_HZ = 108;          // unused while amplitude is 0 (kept for reference)
const ANCHOR_TONE_AMPLITUDE = 0;     // 0 = silent anchor. >0 would put a tone back on the element (don't — it cuts).

// Continuous sub-bass "vibratory" drone, generated as Web Audio OSCILLATORS so it
// is perfectly gapless (no <audio>-loop seam) and — being Web Audio, not a second
// media element — adds NO extra ducking.
//
// HARMONICALLY LOCKED (v12.5): instead of a fixed pitch (the old 54 Hz, which beat
// against drone-like songs), the drone is octave-derived from the ACTIVE frequency,
// so it is always the same "note" as the solfeggio layer — no arbitrary pitch, no
// beating. Two octave-locked layers:
//   • CARRIER — active freq halved into the FELT sub-bass band (27–55 Hz). This is
//     what the body actually feels through speakers/subs.
//   • MODULATION — active freq halved into the THETA-ALPHA band (5–10 Hz). A raw
//     ~8 Hz sine is inaudible/unreproducible on ANY driver, so we don't play it
//     directly; we modulate the carrier's AMPLITUDE at this rate. The theta-alpha
//     rhythm is then FELT as a slow throb riding the carrier (the isochronic /
//     monaural-beat mechanism — the guide's 5–12 Hz target, made felt).
// Both glide smoothly on track change. Set LEVEL 0 to disable; MOD_DEPTH 0 = steady
// carrier only (no pulse). Mostly inaudible on phone speakers, felt on headphones/subs.
const SUB_BASS_DRONE_LEVEL = 0.10;   // master peak gain at full volume (felt, subtle)
const SUB_BASS_MOD_DEPTH = 0.3;      // 0 = steady carrier, 1 = full gate. 0.3 = subtle felt pulse
const SUB_BASS_GLIDE_S = 8;          // smooth pitch glide on track change (guide's transitionSubBass)

// The band constants and the octave-mapping helpers (octaveInto, feltCarrierHz,
// thetaAlphaModHz, toSubBass, solfeggioHz) now live in utils/frequencyMapping.ts
// — the single source of truth shared with FrequencySelector. They used to be
// duplicated there with a different threshold, so the preview tone and playback
// emitted different frequencies. Import, never re-inline.

// CLOSED EXPERIMENT — a MediaStream-fed <audio> element (Web Audio →
// MediaStreamDestination → element) was tested as a single-element media-session
// holder. On Android Chrome it does NOT hold the lock-screen card across an
// auto-transition gap (device-verified — the card dropped). So the single-element
// rebuild (music + layers through one stream element → card + no ducking +
// gapless) is NOT viable. We stay on the continuous unmuted anchor + duck
// compensation, with the anchor playing a soft harmonic drone (option A).

const formatDuration = (seconds: number) => {
  if (!seconds || isNaN(seconds)) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/** Extensions Chrome can actually decode. Used instead of trusting File.type,
 *  which Windows leaves empty for plenty of perfectly good audio files. */
const AUDIO_FILE_RE = /\.(mp3|wav|flac|m4a|mp4|aac|ogg|oga|opus|webm|aif|aiff)$/i;

/** MIME types that START with "audio/" but are NOT a decodable track, so the
 *  MIME backstop below can't quietly re-admit what the extension list rejects.
 *  Chrome hands .m3u "audio/x-mpegurl" and .wma "audio/x-ms-wma" — the first is
 *  a playlist, the second Chrome cannot decode. Both used to sail straight in. */
const AUDIO_MIME_DENY_RE = /(mpegurl|scpls|ms-wma|ms-wax|ms-asf|realaudio)/i;

/** The single source of truth for "is this an audio file we can play?". */
const isImportableAudio = (f: File): boolean => {
  if (AUDIO_FILE_RE.test(f.name)) return true;
  return f.type.startsWith('audio/') && !AUDIO_MIME_DENY_RE.test(f.type);
};

const getAudioDuration = (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    let settled = false;

    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.ondurationchange = null;
      audio.ontimeupdate = null;
      audio.onerror = null;
      try { URL.revokeObjectURL(objectUrl); } catch {}
      // Only accept a real, positive, finite duration; anything else → 0
      // (the UI renders 0 as "..." rather than "NaN"/"Infinity").
      resolve(Number.isFinite(value) && value > 0 ? value : 0);
    };

    // Hard timeout so a single unreadable file can't stall the whole
    // background duration queue. The batch awaits every file, so a
    // never-resolving promise would freeze duration analysis for every
    // later song (the bug that left tracks stuck on "...").
    const timer = setTimeout(() => finish(0), 15000);

    const onMeta = () => {
      // VBR MP3s (and some other encodings) report Infinity on
      // loadedmetadata because there's no duration header. Seeking past the
      // end forces the browser to compute the real duration, which then
      // arrives via durationchange / timeupdate.
      if (audio.duration === Infinity || Number.isNaN(audio.duration)) {
        const onResolved = () => {
          if (Number.isFinite(audio.duration)) finish(audio.duration);
        };
        audio.ondurationchange = onResolved;
        audio.ontimeupdate = onResolved;
        try {
          audio.currentTime = 24 * 60 * 60; // 24h — beyond any real track
        } catch {
          finish(0);
        }
      } else {
        finish(audio.duration);
      }
    };

    audio.preload = "metadata";
    audio.onloadedmetadata = onMeta;
    audio.onerror = () => finish(0);
    audio.src = objectUrl;
  });
};

// Enhanced frequency detection with extended octave range analysis
const detectDominantFrequency = async (buffer: AudioBuffer): Promise<number> => {
  return new Promise((resolve, reject) => {
    // 10 second timeout for enhanced analysis
    const timeout = setTimeout(() => {
      reject(new Error('Enhanced frequency detection timeout'));
    }, 10000);

    try {
      const sampleDuration = Math.min(5, buffer.duration / 2); // Longer sampling for better accuracy
      const offlineCtx = new OfflineAudioContext(1, 44100 * sampleDuration, 44100); 
      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;
      
      const analyser = offlineCtx.createAnalyser();
      analyser.fftSize = 32768; // Larger FFT for better frequency resolution
      analyser.smoothingTimeConstant = 0.1;
      
      source.connect(analyser);
      analyser.connect(offlineCtx.destination);
      
      // Sample from multiple points in the track for comprehensive analysis
      const startOffset = Math.min(buffer.duration / 3, 15); // Start at 1/3 position
      source.start(0, startOffset, sampleDuration);
      
      offlineCtx.startRendering().then(() => {
        clearTimeout(timeout);
        
        const data = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(data);
        
        // Enhanced frequency detection with extended octave range checking
        const detectedFrequencies = analyzeExtendedOctaveRanges(data, 44100 / analyser.fftSize);
        
        // Find the most prominent frequency across all octave ranges
        let bestFrequency = 440;
        let bestScore = 0;
        
        for (const detection of detectedFrequencies) {
          if (detection.score > bestScore) {
            bestScore = detection.score;
            bestFrequency = detection.frequency;
          }
        }
        
        console.log(`Enhanced detection found ${detectedFrequencies.length} frequency candidates, best: ${bestFrequency.toFixed(1)}Hz (score: ${bestScore.toFixed(3)})`);
        
        resolve(bestFrequency);
      }).catch(error => {
        clearTimeout(timeout);
        console.error("Enhanced analysis failed", error);
        resolve(440); // Fallback frequency
      });
      
    } catch (e) {
      clearTimeout(timeout);
      console.error("Enhanced analysis setup failed", e);
      resolve(440); // Fallback frequency
    }
  });
};

// Peak-extracting variant of detectDominantFrequency. Runs the same FFT but
// returns the full peak array (one peak per octave range) so the interval
// analysis layer can examine the gaps between peaks. Intentionally a sibling
// rather than a refactor — keeps the existing detector untouched.
const detectFrequencyPeaks = async (buffer: AudioBuffer): Promise<IntervalPeak[]> => {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve([]), 10000);
    try {
      const sampleDuration = Math.min(5, buffer.duration / 2);
      const offlineCtx = new OfflineAudioContext(1, 44100 * sampleDuration, 44100);
      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;

      const analyser = offlineCtx.createAnalyser();
      analyser.fftSize = 32768;
      analyser.smoothingTimeConstant = 0.1;

      source.connect(analyser);
      analyser.connect(offlineCtx.destination);

      const startOffset = Math.min(buffer.duration / 3, 15);
      source.start(0, startOffset, sampleDuration);

      offlineCtx.startRendering().then(() => {
        clearTimeout(timeout);
        const data = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(data);
        const detected = analyzeExtendedOctaveRanges(data, 44100 / analyser.fftSize);
        // Already shaped as {frequency, score, octaveRange} — compatible with IntervalPeak.
        resolve(detected as IntervalPeak[]);
      }).catch(() => {
        clearTimeout(timeout);
        resolve([]);
      });
    } catch {
      clearTimeout(timeout);
      resolve([]);
    }
  });
};

// Pre-compute a per-band energy envelope for the WHOLE track, offline, during
// the library scan. The visualizer later samples this at the live playback
// position so the visuals track the actual song — and because the entire file
// is scanned up front, every big bass drop is known in advance and none is ever
// missed. Cheap at playback time (a Uint8 lookup), and it needs NO live audio
// tap, so direct-to-OS playback stays untouched.
//
// Method: render the decoded buffer through a band filter in an
// OfflineAudioContext (downsampled to 8 kHz — well above the highest band), then
// take the RMS of the filtered PCM over short hops. One render per band. Each
// band is normalised to its own peak so quiet bands still read; truly silent
// bands stay at zero. Wrapped by the caller in try/catch — analysis failure
// must never break a scan (the visualizer falls back to a deterministic pulse).
const analyzeBandEnvelopes = async (buffer: AudioBuffer, fps = 20): Promise<BandEnvelope | undefined> => {
  const SR = 8000;                                   // Nyquist 4 kHz — covers sub/bass/mid and the ≥2 kHz "high" proxy
  const MAX_SECONDS = 1800;                           // cap absurdly long files so envelopes stay small
  const seconds = Math.min(buffer.duration || 0, MAX_SECONDS);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const length = Math.max(1, Math.ceil(seconds * SR));
  const hop = Math.max(1, Math.floor(SR / fps));

  const renderBand = async (
    wire: (ctx: OfflineAudioContext, src: AudioBufferSourceNode) => AudioNode
  ): Promise<Uint8Array> => {
    const ctx = new OfflineAudioContext(1, length, SR);
    const src = ctx.createBufferSource();
    src.buffer = buffer;                              // bufferSource resamples the input to the 8 kHz context
    const out = wire(ctx, src);
    out.connect(ctx.destination);
    src.start();
    const data = (await ctx.startRendering()).getChannelData(0);
    const n = Math.ceil(data.length / hop);
    const rms = new Float32Array(n);
    let max = 0;
    for (let k = 0; k < n; k++) {
      const start = k * hop;
      const end = Math.min(start + hop, data.length);
      let sum = 0;
      for (let j = start; j < end; j++) sum += data[j] * data[j];
      const v = Math.sqrt(sum / Math.max(1, end - start));
      rms[k] = v;
      if (v > max) max = v;
    }
    const u = new Uint8Array(n);
    if (max < 1e-4) return u;                          // effectively silent in this band → leave zeros
    for (let k = 0; k < n; k++) u[k] = Math.min(255, Math.round((rms[k] / max) * 255));
    return u;
  };

  const sub = await renderBand((ctx, src) => {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 60; f.Q.value = 0.7;
    src.connect(f); return f;
  });
  const bass = await renderBand((ctx, src) => {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 250;
    src.connect(hp); hp.connect(lp); return lp;
  });
  const mid = await renderBand((ctx, src) => {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.7;
    src.connect(f); return f;
  });
  const high = await renderBand((ctx, src) => {
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2000;
    src.connect(f); return f;
  });

  return { fps, sub, bass, mid, high };
};

// Extended octave range analysis function
const analyzeExtendedOctaveRanges = (frequencyData: Float32Array, binSize: number): Array<{frequency: number, score: number, octaveRange: string}> => {
  const detections: Array<{frequency: number, score: number, octaveRange: string}> = [];
  
  // Define extended frequency ranges for comprehensive scanning
  const frequencyRanges = [
    { name: 'Sub-Bass', min: 20, max: 60, weight: 0.3 },        // Very low frequencies
    { name: 'Bass', min: 60, max: 250, weight: 0.5 },           // Bass fundamentals
    { name: 'Low-Mid', min: 250, max: 500, weight: 1.0 },       // Important harmonic content
    { name: 'Mid', min: 500, max: 2000, weight: 1.5 },          // Primary musical content
    { name: 'High-Mid', min: 2000, max: 4000, weight: 1.2 },    // Harmonic richness
    { name: 'Treble', min: 4000, max: 8000, weight: 0.8 },      // Upper harmonics
    { name: 'Ultra-High', min: 8000, max: 20000, weight: 0.4 }  // Extended harmonics
  ];
  
  // Analyze each frequency range
  for (const range of frequencyRanges) {
    const startBin = Math.floor(range.min / binSize);
    const endBin = Math.min(frequencyData.length - 1, Math.floor(range.max / binSize));
    
    let maxMagnitude = -Infinity;
    let peakBin = -1;
    
    // Find peak in this range
    for (let bin = startBin; bin <= endBin; bin++) {
      if (frequencyData[bin] > maxMagnitude) {
        maxMagnitude = frequencyData[bin];
        peakBin = bin;
      }
    }
    
    if (peakBin > 0 && maxMagnitude > -60) { // Only consider significant peaks (above -60dB)
      const frequency = peakBin * binSize;
      
      // Enhanced scoring with harmonic analysis
      let harmonicScore = 0;
      
      // Check for harmonic series (fundamental + integer multiples)
      for (let harmonic = 2; harmonic <= 8; harmonic++) {
        const harmonicFreq = frequency * harmonic;
        const harmonicBin = Math.round(harmonicFreq / binSize);
        
        if (harmonicBin < frequencyData.length) {
          const harmonicMagnitude = frequencyData[harmonicBin];
          if (harmonicMagnitude > -80) { // Harmonic is present
            harmonicScore += harmonicMagnitude / harmonic; // Weight lower harmonics more
          }
        }
      }
      
      // Check for sub-harmonics (fundamental / integer divisors) 
      for (let divisor = 2; divisor <= 4; divisor++) {
        const subharmonicFreq = frequency / divisor;
        const subharmonicBin = Math.round(subharmonicFreq / binSize);
        
        if (subharmonicBin >= 0 && subharmonicBin < frequencyData.length) {
          const subharmonicMagnitude = frequencyData[subharmonicBin];
          if (subharmonicMagnitude > -80) { // Sub-harmonic is present
            harmonicScore += subharmonicMagnitude * 0.5; // Weight sub-harmonics less
          }
        }
      }
      
      // Check for octave relationships (powers of 2)
      for (let octave = 1; octave <= 6; octave++) {
        const octaveUpFreq = frequency * Math.pow(2, octave);
        const octaveDownFreq = frequency / Math.pow(2, octave);
        
        // Check octave up
        const octaveUpBin = Math.round(octaveUpFreq / binSize);
        if (octaveUpBin < frequencyData.length) {
          const octaveUpMagnitude = frequencyData[octaveUpBin];
          if (octaveUpMagnitude > -80) {
            harmonicScore += octaveUpMagnitude * 0.3; // Octave relationships are strong indicators
          }
        }
        
        // Check octave down
        const octaveDownBin = Math.round(octaveDownFreq / binSize);
        if (octaveDownBin >= 0 && octaveDownBin < frequencyData.length) {
          const octaveDownMagnitude = frequencyData[octaveDownBin];
          if (octaveDownMagnitude > -80) {
            harmonicScore += octaveDownMagnitude * 0.3;
          }
        }
      }
      
      // Enhanced interpolation for sub-bin precision
      let preciseFrequency = frequency;
      if (peakBin > 0 && peakBin < frequencyData.length - 1) {
        const leftMag = frequencyData[peakBin - 1];
        const centerMag = frequencyData[peakBin];
        const rightMag = frequencyData[peakBin + 1];
        
        // Parabolic interpolation for better frequency precision
        const delta = 0.5 * (leftMag - rightMag) / (leftMag - 2 * centerMag + rightMag);
        preciseFrequency = (peakBin + delta) * binSize;
      }
      
      // Calculate final score combining magnitude, harmonic content, and range weighting
      const finalScore = (maxMagnitude + 100) * range.weight * (1 + harmonicScore * 0.1); // Normalize dB range
      
      detections.push({
        frequency: preciseFrequency,
        score: finalScore,
        octaveRange: range.name
      });
      
      console.log(`${range.name} range: ${preciseFrequency.toFixed(1)}Hz, magnitude: ${maxMagnitude.toFixed(1)}dB, harmonicScore: ${harmonicScore.toFixed(2)}, finalScore: ${finalScore.toFixed(3)}`);
    }
  }
  
  // Sort by score and return top candidates
  return detections.sort((a, b) => b.score - a.score);
};


const getHarmonicSolfeggio = (detectedFreq: number): number => {
    if (detectedFreq <= 0) return 396; 

    // Define the 3-regime frequency sets for prioritized matching
    const gutFrequencies = [174, 285, 396, 417, 528, 639, 741, 852, 963];
    const heartFrequencies = [1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150]; // HEART regime with 243 steady progression
    const headFrequencies = [3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336]; // HEAD regime with 354 steady progression

    let bestMatch = 396;
    let minScore = Infinity;

    console.log(`Analyzing frequency: ${detectedFreq.toFixed(1)}Hz for solfeggio matching`);

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
            console.log(`Direct match found: ${detectedFreq.toFixed(1)}Hz ≈ ${sFreq}Hz (diff: ${directDiff.toFixed(1)}Hz)`);
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
                    console.log(`Harmonic match found: ${detectedFreq.toFixed(1)}Hz ≈ ${candidate.toFixed(1)}Hz (${sFreq}Hz harmonic, diff: ${harmonicDiff.toFixed(1)}Hz)`);
                }
            });
        }
    });

    // Special case: If detected frequency is very high and no match found, try to find the fundamental
    if (minScore > 100 && detectedFreq > 1000) {
        console.log(`High frequency detected (${detectedFreq.toFixed(1)}Hz), searching for fundamental...`);
        
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
                const recursiveMatch = getHarmonicSolfeggio(fundamental);
                // Check if this fundamental gives us a better match
                const fundamentalDiff = Math.abs(fundamental - recursiveMatch);
                if (fundamentalDiff < minScore * 0.5) { // Significantly better match
                    console.log(`Found fundamental: ${detectedFreq.toFixed(1)}Hz → ${fundamental.toFixed(1)}Hz → ${recursiveMatch}Hz`);
                    return recursiveMatch;
                }
            }
        }
    }

    console.log(`Final solfeggio match: ${detectedFreq.toFixed(1)}Hz → ${bestMatch}Hz (deviation: ${minScore.toFixed(1)}Hz)`);
    return bestMatch;
};

// Enhanced analysis reporting function
const getFrequencyAnalysisReport = (detectedFreq: number, solfeggioMatch: number, deviation: number): string => {
    const octaveRange = getOctaveRange(detectedFreq);
    const harmonicRelationship = getHarmonicRelationship(detectedFreq, solfeggioMatch);
    const regime = getFrequencyRegime(solfeggioMatch);
    
    let report = `🎵 FREQUENCY ANALYSIS REPORT\n\n`;
    report += `📊 Detected: ${detectedFreq.toFixed(1)}Hz (${octaveRange})\n`;
    report += `🎯 Matched: ${solfeggioMatch}Hz (${regime} regime)\n`;
    report += `📏 Deviation: ±${deviation.toFixed(1)}Hz\n`;
    report += `🔗 Relationship: ${harmonicRelationship}\n\n`;
    
    // Add accuracy assessment
    if (deviation < 5) {
        report += `✅ EXCELLENT match - Near perfect alignment\n`;
    } else if (deviation < 20) {
        report += `✅ GOOD match - Strong harmonic relationship\n`;
    } else if (deviation < 50) {
        report += `⚠️ FAIR match - Moderate alignment\n`;
    } else {
        report += `❌ WEAK match - Consider manual adjustment\n`;
    }
    
    return report;
};

const getOctaveRange = (frequency: number): string => {
    if (frequency < 60) return "Sub-Bass";
    if (frequency < 250) return "Bass";
    if (frequency < 500) return "Low-Mid";
    if (frequency < 2000) return "Mid";
    if (frequency < 4000) return "High-Mid";
    if (frequency < 8000) return "Treble";
    return "Ultra-High";
};

const getHarmonicRelationship = (detected: number, matched: number): string => {
    const ratio = detected / matched;
    
    if (Math.abs(ratio - 1) < 0.05) return "Fundamental";
    if (Math.abs(ratio - 2) < 0.1) return "Octave up";
    if (Math.abs(ratio - 0.5) < 0.1) return "Octave down";
    if (Math.abs(ratio - 3) < 0.15) return "Perfect fifth up (octave)";
    if (Math.abs(ratio - 1.5) < 0.1) return "Perfect fifth up";
    if (Math.abs(ratio - 4) < 0.2) return "Two octaves up";
    if (Math.abs(ratio - 0.25) < 0.05) return "Two octaves down";
    if (Math.abs(ratio - 1.333) < 0.1) return "Perfect fourth up";
    if (Math.abs(ratio - 0.75) < 0.1) return "Perfect fourth down";
    
    return `${ratio.toFixed(2)}:1 ratio`;
};

const getFrequencyRegime = (frequency: number): string => {
    if (frequency <= 963) return "GUT";
    if (frequency <= 3150) return "HEART";
    return "HEAD";
};

// Statistics functions for analysis reporting
const getOctaveRangeStatistics = (analyzedSongs: Song[]): string => {
    const ranges = {
        'Sub-Bass (20-60Hz)': 0,
        'Bass (60-250Hz)': 0,
        'Low-Mid (250-500Hz)': 0,
        'Mid (500-2kHz)': 0,
        'High-Mid (2-4kHz)': 0,
        'Treble (4-8kHz)': 0,
        'Ultra-High (8kHz+)': 0
    };
    
    analyzedSongs.forEach(song => {
        if (song.harmonicFreq) {
            const freq = song.harmonicFreq;
            if (freq < 60) ranges['Sub-Bass (20-60Hz)']++;
            else if (freq < 250) ranges['Bass (60-250Hz)']++;
            else if (freq < 500) ranges['Low-Mid (250-500Hz)']++;
            else if (freq < 2000) ranges['Mid (500-2kHz)']++;
            else if (freq < 4000) ranges['High-Mid (2-4kHz)']++;
            else if (freq < 8000) ranges['Treble (4-8kHz)']++;
            else ranges['Ultra-High (8kHz+)']++;
        }
    });
    
    return Object.entries(ranges)
        .filter(([_, count]) => count > 0)
        .map(([range, count]) => `  • ${range}: ${count} tracks`)
        .join('\n');
};

const getRegimeStatistics = (analyzedSongs: Song[]): string => {
    const regimes = {
        'GUT (174-963Hz)': 0,
        'HEART (1206-3150Hz)': 0,
        'HEAD (3504-6336Hz)': 0
    };
    
    analyzedSongs.forEach(song => {
        if (song.closestSolfeggio) {
            const freq = song.closestSolfeggio;
            if (freq <= 963) regimes['GUT (174-963Hz)']++;
            else if (freq <= 3150) regimes['HEART (1206-3150Hz)']++;
            else regimes['HEAD (3504-6336Hz)']++;
        }
    });
    
    const total = Object.values(regimes).reduce((sum, count) => sum + count, 0);
    
    return Object.entries(regimes)
        .map(([regime, count]) => `  • ${regime}: ${count} tracks (${total > 0 ? Math.round(count/total*100) : 0}%)`)
        .join('\n');
};

// Enhanced function to distribute songs evenly across frequencies using harmonic octave analysis
const distributeUsingHarmonicOctaves = (songs: Song[], targetFrequencies: number[]): Song[] => {
    // Step 1: Analyze all songs and calculate their harmonic compatibility with each frequency
    const songAnalysis = songs.map((song, index) => {
        let detectedFreq: number;
        
        // If song already has harmonic frequency from previous analysis, use it
        if (song.harmonicFreq) {
            detectedFreq = song.harmonicFreq;
        } else {
            // Enhanced heuristic analysis based on song characteristics
            const fileName = song.name.toLowerCase();
            const duration = song.duration || 180; // Default 3 minutes if unknown
            
            // Advanced frequency estimation based on multiple factors
            if (fileName.includes('bass') || fileName.includes('low') || fileName.includes('sub')) {
                detectedFreq = 60 + Math.random() * 140; // 60-200Hz range (bass fundamentals)
            } else if (fileName.includes('vocal') || fileName.includes('voice') || fileName.includes('sing')) {
                detectedFreq = 220 + Math.random() * 660; // 220-880Hz range (vocal fundamentals)
            } else if (fileName.includes('guitar') || fileName.includes('string')) {
                detectedFreq = 82 + Math.random() * 350; // 82-432Hz range (guitar fundamentals)
            } else if (fileName.includes('piano') || fileName.includes('key')) {
                detectedFreq = 131 + Math.random() * 400; // 131-531Hz range (piano middle range)
            } else if (fileName.includes('drum') || fileName.includes('kick') || fileName.includes('snare')) {
                detectedFreq = 50 + Math.random() * 200; // 50-250Hz range (drum fundamentals)
            } else if (fileName.includes('lead') || fileName.includes('melody')) {
                detectedFreq = 262 + Math.random() * 700; // 262-962Hz range (melodic content)
            } else if (fileName.includes('pad') || fileName.includes('atmosphere') || fileName.includes('ambient')) {
                detectedFreq = 100 + Math.random() * 600; // 100-700Hz range (atmospheric content)
            } else if (fileName.includes('high') || fileName.includes('treble') || fileName.includes('cymbal') || fileName.includes('hi-hat')) {
                detectedFreq = 1000 + Math.random() * 4000; // 1000-5000Hz range (high frequency content)
            } else {
                // General musical content - bias toward common musical frequencies
                const musicalFrequencies = [110, 146.83, 196, 220, 261.63, 293.66, 329.63, 369.99, 440, 523.25, 587.33, 659.25, 783.99];
                const baseFreq = musicalFrequencies[Math.floor(Math.random() * musicalFrequencies.length)];
                detectedFreq = baseFreq * (0.9 + Math.random() * 0.2); // ±10% variation
            }
            
            // Apply duration-based modulation
            if (duration > 300) detectedFreq *= 0.8; // Longer tracks → lower frequencies
            else if (duration < 120) detectedFreq *= 1.2; // Short tracks → higher frequencies
        }
        
        // Calculate harmonic compatibility score for each target frequency
        const bestMatch = getHarmonicSolfeggio(detectedFreq);
        const compatibilityScores: { [key: number]: number } = {};
        
        for (const freq of targetFrequencies) {
            let harmonicScore = Math.abs(bestMatch - freq);
            
            // Check for octave relationships (powers of 2) - strong preference
            for (let octave = -3; octave <= 3; octave++) {
                if (octave !== 0) {
                    const octaveFreq = freq * Math.pow(2, octave);
                    const octaveScore = Math.abs(bestMatch - octaveFreq);
                    if (octaveScore < harmonicScore) {
                        harmonicScore = octaveScore * 0.5; // Very strong preference for octaves
                    }
                }
            }
            
            // Check for perfect fifth relationships (3:2 ratio)
            const fifthUp = Math.abs(bestMatch - (freq * 1.5));
            const fifthDown = Math.abs(bestMatch - (freq / 1.5));
            if (fifthUp < harmonicScore) harmonicScore = fifthUp * 0.7;
            if (fifthDown < harmonicScore) harmonicScore = fifthDown * 0.7;
            
            // Check for perfect fourth relationships (4:3 ratio)
            const fourthUp = Math.abs(bestMatch - (freq * 4/3));
            const fourthDown = Math.abs(bestMatch - (freq * 3/4));
            if (fourthUp < harmonicScore) harmonicScore = fourthUp * 0.8;
            if (fourthDown < harmonicScore) harmonicScore = fourthDown * 0.8;
            
            // Lower score = better compatibility
            compatibilityScores[freq] = harmonicScore;
        }
        
        return {
            song,
            detectedFreq,
            bestMatch,
            compatibilityScores,
            originalIndex: index
        };
    });
    
    // Step 2: Multi-pass distribution that guarantees a CAB ride at 81+ songs.
    //
    // Each "pass" walks all 27 target frequencies and, for each one, picks the
    // single best remaining unassigned song. Run up to 3 passes so libraries
    // of 81+ end up with exactly 3 distinct songs per frequency (the count
    // the Combined Walk and other CAB-style journeys need to give three
    // unique tracks per cube position). Smaller libraries fill as far as
    // they can — 27-song libraries get 1 song per freq, 54-song libraries
    // get 2, etc.  Anything left over after pass 3 spills to whichever
    // frequency it best matches harmonically (no cap), so very large
    // libraries don't lose tracks.
    const assignments: Array<{song: Song, frequency: number, detectedFreq: number, deviation: number}> = [];
    const SONGS_PER_FREQ_TARGET = 3;
    const unassigned = new Set<number>(songAnalysis.map((_, i) => i));

    for (let pass = 0; pass < SONGS_PER_FREQ_TARGET; pass++) {
        if (unassigned.size === 0) break;
        for (const freq of targetFrequencies) {
            if (unassigned.size === 0) break;
            // Find the best remaining unassigned song for this frequency.
            let bestIdx = -1;
            let bestScore = Infinity;
            for (const idx of unassigned) {
                const score = songAnalysis[idx].compatibilityScores[freq];
                if (score < bestScore) {
                    bestScore = score;
                    bestIdx = idx;
                }
            }
            if (bestIdx === -1) continue;
            const songData = songAnalysis[bestIdx];
            assignments.push({
                song: songData.song,
                frequency: freq,
                detectedFreq: songData.detectedFreq,
                deviation: bestScore,
            });
            unassigned.delete(bestIdx);
            if (pass === 0) {
                console.log(`🎯 Pass 1 coverage: "${songData.song.name}" → ${freq}Hz`);
            } else {
                console.log(`🎵 Pass ${pass + 1}: "${songData.song.name}" → ${freq}Hz (CAB pick)`);
            }
        }
    }

    // Balanced spillover: anything beyond 81 (the 3-per-freq CAB pool)
    // gets routed to the frequency with the *lowest current count*, ties
    // broken by the song's compatibility score for that freq. Previously
    // each spillover song went to its single globally-best-match freq,
    // which dumped almost everything onto GUT/HEART — most music
    // fundamentals sit in 80–1000 Hz and naturally score best against
    // those regimes via direct or +1-octave matches. That left HEAD
    // (3504–6336 Hz) permanently stuck at 27 (the pass 1–3 count) even
    // for libraries with hundreds of tracks. Balancing by count instead
    // spreads spillover roughly evenly across all 27 freqs (~1/3 to each
    // regime), so HEAD frequencies are populated for browsing/filters
    // even when no song is a strong octave-down match to them.
    const counts: Record<number, number> = {};
    targetFrequencies.forEach(f => counts[f] = 0);
    assignments.forEach(a => counts[a.frequency]++);

    for (const idx of unassigned) {
        const songData = songAnalysis[idx];
        // Find the minimum count across all freqs.
        let minCount = Infinity;
        for (const freq of targetFrequencies) {
            if (counts[freq] < minCount) minCount = counts[freq];
        }
        // Among freqs at min count, route this song to the one it best
        // matches. Tie-break by score keeps assignments as harmonically
        // sensible as possible while still respecting the count balance.
        let bestFreq = targetFrequencies[0];
        let bestScore = Infinity;
        for (const freq of targetFrequencies) {
            if (counts[freq] !== minCount) continue;
            const score = songData.compatibilityScores[freq];
            if (score < bestScore) {
                bestScore = score;
                bestFreq = freq;
            }
        }
        assignments.push({
            song: songData.song,
            frequency: bestFreq,
            detectedFreq: songData.detectedFreq,
            deviation: bestScore,
        });
        counts[bestFreq]++;
        console.log(`⚖️ Balanced fill: "${songData.song.name}" → ${bestFreq}Hz (count ${counts[bestFreq]})`);
    }
    unassigned.clear();
    
    // Step 3: Create the final result array maintaining original order
    const result = songs.map(song => {
        const assignment = assignments.find(a => a.song.id === song.id);
        if (assignment) {
            return {
                ...song,
                harmonicFreq: assignment.detectedFreq,
                closestSolfeggio: assignment.frequency,
                harmonicDeviation: assignment.deviation
            };
        }
        
        // Fallback (shouldn't happen)
        return {
            ...song,
            harmonicFreq: 440,
            closestSolfeggio: 528,
            harmonicDeviation: 88
        };
    });
    
    return result;
};

// Consolidated harmonic distribution function with detailed logging
const distributeUsingHarmonicOctavesMaster = (songs: Song[], targetFrequencies: number[]): Song[] => {
    const result = distributeUsingHarmonicOctaves(songs, targetFrequencies);
    
    // Log distribution summary
    const distribution: { [key: number]: number } = {};
    targetFrequencies.forEach(freq => distribution[freq] = 0);
    
    result.forEach(song => {
        const freq = song.closestSolfeggio;
        if (freq) {
            distribution[freq] = (distribution[freq] || 0) + 1;
        }
    });
    
    console.log('=== HARMONIC DISTRIBUTION SUMMARY ===');
    const gutCount = targetFrequencies.slice(0, 9).reduce((sum, freq) => sum + (distribution[freq] || 0), 0);
    const heartCount = targetFrequencies.slice(9, 18).reduce((sum, freq) => sum + (distribution[freq] || 0), 0);
    const headCount = targetFrequencies.slice(18, 27).reduce((sum, freq) => sum + (distribution[freq] || 0), 0);
    
    console.log(`GUT Regime (174-963Hz): ${gutCount} songs`);
    console.log(`HEART Regime (1206-3150Hz): ${heartCount} songs`);
    console.log(`HEAD Regime (3504-6336Hz): ${headCount} songs`);
    console.log(`Total distributed: ${result.length} songs across ${targetFrequencies.length} frequencies`);
    
    // Show specific frequency assignments for verification
    console.log('Frequency assignments:');
    targetFrequencies.forEach(freq => {
        if (distribution[freq] > 0) {
            const assignedSongs = result.filter(s => s.closestSolfeggio === freq);
            console.log(`  ${freq}Hz: ${assignedSongs.map(s => s.name).join(', ')}`);
        } else if (freq === 4566) {
            console.warn(`🚨 4566 Hz has NO assignments! This is the missing frequency.`);
        }
    });
    
    // Additional debug for missing frequencies
    const missingFrequencies = targetFrequencies.filter(freq => distribution[freq] === 0);
    if (missingFrequencies.length > 0) {
        console.warn(`⚠️ MISSING FREQUENCIES:`, missingFrequencies);
    }
    
    console.log('✅ Songs distributed by harmonic affinity - consistent results guaranteed!');
    
    return result;
};

// LRU-weighted shuffle. Sort indices by [lastPlayed ASC, random tiebreaker]
// so never-played songs come first (in random order among themselves), then
// the longest-not-heard songs, and so on. Same call twice with the same
// history produces fresh tiebreaker permutations — variety is preserved
// while rotation guarantees every song eventually surfaces before any
// repeats. Used by shuffle playback so a long session doesn't loop the
// same favorites while back-catalogue tracks never play.
const getLruShuffledIndices = (songs: { id: string }[], history: Record<string, number>): number[] => {
    // Group indices into LRU tiers by play timestamp, then Fisher-Yates
    // shuffle WITHIN each tier, concatenating oldest tier first.
    //
    // The previous `arr.sort(() => Math.random() - 0.5)` approach is the
    // textbook example of a broken shuffle: V8's TimSort with a random
    // comparator produces a heavily non-uniform distribution. On a freshly
    // scanned library where every track has history[id] = 0 (one big tier
    // of equals), this clustered items near their original positions and
    // made shuffle pick the same alphabetical neighbourhood every time.
    // Fisher-Yates is the only O(n) algorithm that produces a uniformly
    // random permutation.
    const buckets = new Map<number, number[]>();
    for (let i = 0; i < songs.length; i++) {
        const t = history[songs[i].id] || 0;
        const arr = buckets.get(t);
        if (arr) arr.push(i);
        else buckets.set(t, [i]);
    }
    const orderedTimestamps = [...buckets.keys()].sort((a, b) => a - b);
    const result: number[] = [];
    for (const t of orderedTimestamps) {
        const group = buckets.get(t)!;
        for (let i = group.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [group[i], group[j]] = [group[j], group[i]];
        }
        result.push(...group);
    }
    return result;
};

// --- Tutorial Component ---
const TutorialModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [step, setStep] = useState(0);

    const steps = [
        {
            title: "Welcome to Aetheria",
            icon: <Activity className="text-gold-500 w-12 h-12" />,
            desc: "An advanced music player that takes the songs you already love and does three things.",
            content: (
                <ul className="text-sm text-slate-300 space-y-3 text-left bg-slate-800/50 p-5 rounded-lg border border-slate-700">
                    <li className="flex gap-2">🎵 <strong className="text-gold-200">Retunes to 432 Hz:</strong> A natural tuning many listeners find warmer than standard 440 Hz.</li>
                    <li className="flex gap-2">✨ <strong className="text-gold-200">Sorts into 27 frequencies:</strong> Each song is assigned to one of three ranges — GUT, HEART, or HEAD.</li>
                    <li className="flex gap-2">🎧 <strong className="text-gold-200">Layers binaural beats:</strong> A subtle layer underneath your music. Headphones recommended.</li>
                </ul>
            )
        },
        {
            title: "1. Add Your Music",
            icon: <Upload className="text-blue-400 w-12 h-12" />,
            desc: "Import the songs you already know and love. Aetheria enhances your library — it doesn't replace it.",
            content: (
                <ul className="text-sm text-slate-300 space-y-3 text-left bg-slate-800/50 p-5 rounded-lg border border-slate-700">
                    <li className="flex gap-2">📁 <strong className="text-gold-200">Folder Import:</strong> The fastest way to start. Click the folder icon in the sidebar to load a whole album.</li>
                    <li className="flex gap-2">📄 <strong className="text-gold-200">Add Files:</strong> Pick individual tracks instead.</li>
                    <li className="flex gap-2">💾 <strong className="text-gold-200">Stays on your device:</strong> Aetheria runs entirely in your browser. Nothing is uploaded.</li>
                </ul>
            )
        },
        {
            title: "2. Scan & Distribute",
            icon: <Search className="text-purple-400 w-12 h-12" />,
            desc: "Two clicks let the player understand your library and sort it into the 27 frequencies.",
            content: (
                <ul className="text-sm text-slate-300 space-y-3 text-left bg-slate-800/50 p-5 rounded-lg border border-slate-700">
                    <li className="flex gap-2">🔍 <strong className="text-gold-200">Deep Scan:</strong> Click this in the sidebar. The engine analyzes each song's frequency content.</li>
                    <li className="flex gap-2">🎯 <strong className="text-gold-200">Auto-Distribute Frequencies:</strong> Assigns every song to its closest Aetheria frequency across the GUT, HEART, and HEAD ranges.</li>
                    <li className="flex gap-2">⏳ <strong className="text-gold-200">One-time:</strong> Once assigned, your library is ready for any listening mode.</li>
                </ul>
            )
        },
        {
            title: "3. Pick a Listening Mode",
            icon: <Sliders className="text-emerald-400 w-12 h-12" />,
            desc: "Several ways to walk through your retuned library. There's no wrong way.",
            content: (
                <ul className="text-sm text-slate-300 space-y-3 text-left bg-slate-800/50 p-5 rounded-lg border border-slate-700">
                    <li className="flex gap-2">🌅 <strong className="text-gold-200">Full Alignment:</strong> All 27 frequencies played in order, low to high — the complete journey.</li>
                    <li className="flex gap-2">🎚️ <strong className="text-gold-200">Single Range:</strong> Focus on just GUT, HEART, or HEAD if you want one feeling.</li>
                    <li className="flex gap-2">🧩 <strong className="text-gold-200">Quick Presets:</strong> Curated combinations like Deep Healing, Mood Elevate, Meditation, Flow State, Qi Strength.</li>
                </ul>
            )
        },
        {
            title: "4. Lo Shu Walks (Optional)",
            icon: <Box className="text-emerald-400 w-12 h-12" />,
            desc: "An ancient pattern from a 4,000-year-old Chinese magic square — six different paths through the 27 frequencies.",
            content: (
                <ul className="text-sm text-slate-300 space-y-3 text-left bg-slate-800/50 p-5 rounded-lg border border-slate-700">
                    <li className="flex gap-2">🏔️ <strong className="text-emerald-300">Layer Ascent:</strong> 27 tracks. One range at a time, in Lo Shu order instead of numerical order.</li>
                    <li className="flex gap-2">🏛️ <strong className="text-emerald-300">Pillar Walk:</strong> 27 tracks. Each position played at all three ranges before moving on. Nine vertical pillars.</li>
                    <li className="flex gap-2">🌀 <strong className="text-emerald-300">Flying Star Vortex:</strong> 27 tracks. Spirals outward from center. The traditional Daoist "nine palaces" path.</li>
                    <li className="flex gap-2">🚖 <strong className="text-gold-300">Calling a CAB:</strong> 81 tracks. Vortex → Ascent → Pillar — the cube traced from every angle in one journey.</li>
                    <li className="flex gap-2">♾️ <strong className="text-cyan-300">Ouroboros:</strong> 29 tracks. Closed figure-8 through all 27 frequencies, crossing SOURCE three times. The dragon eats its tail.</li>
                    <li className="flex gap-2">⚛️ <strong className="text-gold-300">Calling a CABI:</strong> 110 tracks. CAB + Ouroboros — open every channel, then close the loop into infinity.</li>
                    <li className="flex gap-2">🎛️ <strong className="text-gold-200">Where to find it:</strong> Cube icon in the player controls (next to repeat). Music must be scanned and distributed first.</li>
                </ul>
            )
        },
        {
            title: "Listen Well",
            icon: <Headphones className="text-gold-500 w-12 h-12" />,
            desc: "A few tips before you press play. Then enjoy the music.",
            content: (
                <ul className="text-sm text-slate-300 space-y-3 text-left bg-slate-800/50 p-5 rounded-lg border border-slate-700">
                    <li className="flex gap-2">🎧 <strong className="text-gold-200">Headphones if possible:</strong> The binaural layer needs each ear to hear its own signal.</li>
                    <li className="flex gap-2">🛋️ <strong className="text-gold-200">No wrong way:</strong> Background while you work, eyes closed, falling asleep, dancing — it adapts to you.</li>
                    <li className="flex gap-2">📖 <strong className="text-gold-200">The Guidebook:</strong> Tap the book icon in the sidebar anytime for the plain-language guide (or switch to the technical view for the deeper math).</li>
                </ul>
            )
        }
    ];

    return (
        <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in zoom-in duration-300">
            <div className="bg-slate-900 border border-gold-500/30 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-120px)] my-auto">
                
                {/* Header */}
                <div className="p-6 bg-slate-950/50 border-b border-slate-800 flex justify-between items-center">
                    <h3 className="text-xl font-serif text-gold-400">Quick Guide</h3>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X size={24} /></button>
                </div>

                {/* Content */}
                <div className="p-8 flex-1 flex flex-col items-center text-center overflow-y-auto">
                    <div className="mb-6 p-4 bg-slate-800 rounded-full shadow-[0_0_20px_rgba(0,0,0,0.5)] text-gold-500">
                        {steps[step].icon}
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-2">{steps[step].title}</h2>
                    <p className="text-slate-400 mb-6 font-medium">{steps[step].desc}</p>
                    <div className="w-full">
                        {steps[step].content}
                    </div>
                </div>

                {/* Footer / Nav */}
                <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-between items-center">
                    <button 
                        onClick={() => setStep(Math.max(0, step - 1))}
                        disabled={step === 0}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronLeft size={16} /> Prev
                    </button>

                    <div className="flex gap-2">
                        {steps.map((_, i) => (
                            <div key={i} className={`h-2 rounded-full transition-all duration-300 ${i === step ? 'bg-gold-500 w-8' : 'bg-slate-700 w-2'}`}></div>
                        ))}
                    </div>

                    {step === steps.length - 1 ? (
                         <button 
                            onClick={onClose}
                            className="flex items-center gap-2 px-6 py-2 rounded-lg bg-gold-600 text-black font-bold hover:bg-gold-500 transition-colors shadow-lg shadow-gold-500/20"
                        >
                            Start <Zap size={16} />
                        </button>
                    ) : (
                        <button 
                            onClick={() => setStep(Math.min(steps.length - 1, step + 1))}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-white hover:text-gold-400 transition-colors bg-slate-800 hover:bg-slate-700"
                        >
                            Next <ChevronRight size={16} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

const App: React.FC = () => {
  const [playlist, setPlaylist] = useState<Song[]>([]);
  const [originalPlaylist, setOriginalPlaylist] = useState<Song[]>([]);
  // Playlist cache (IndexedDB) — persists the library across reloads.
  // `isRestoring` gates the auto-save effect so the act of restoring doesn't
  // immediately re-trigger a save of what we just read back.
  const [isRestoring, setIsRestoring] = useState(false);
  // Non-null only while a LARGE cached library is being read back off disk.
  const [restoreProgress, setRestoreProgress] = useState<{ loaded: number; total: number } | null>(null);
  const RESTORE_PROGRESS_MIN_TRACKS = 300;
  const [currentSongIndex, setCurrentSongIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isLoop, setIsLoop] = useState(false);
  
  // Search functionality. NOTE: `filteredPlaylist` is DERIVED further down (a
  // useMemo, not state) — see the comment there for why.
  const [searchTerm, setSearchTerm] = useState('');
  
  // Advanced Shuffle State
  const [shuffledIndices, setShuffledIndices] = useState<number[]>([]);
  const [shufflePos, setShufflePos] = useState<number>(0);

  // Play history — { songId: lastPlayedTimestamp(ms) }. Drives LRU shuffle
  // ordering and the rotation-aware sort in CAB/Ouroboros pickers so a
  // long listening session cycles through the whole library before
  // repeating favourites. In-memory only: song ids regenerate on every
  // upload (id = `${Date.now()}-${random}` at upload time), so persisting
  // across reloads wouldn't survive re-import anyway. Stale ids are
  // harmless — they just don't match anything.
  const playHistoryRef = useRef<Record<string, number>>({});
  const recordPlay = (songId: string) => {
    playHistoryRef.current[songId] = Date.now();
  };

  const [showInfo, setShowInfo] = useState(false);
  const [guidebookView, setGuidebookView] = useState<'accessible' | 'technical'>('accessible');
  const [showSettings, setShowSettings] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  
  // Zen Mode with Mouse Detect
  const [isZenMode, setIsZenMode] = useState(false);
  const [zenUiVisible, setZenUiVisible] = useState(true);
  const zenTimeoutRef = useRef<number | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [showRecordOptions, setShowRecordOptions] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showLinks, setShowLinks] = useState(false);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  
  const [currTime, setCurrTime] = useState(0);
  const [currDuration, setCurrDuration] = useState(0);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pendingDurationAnalysis, setPendingDurationAnalysis] = useState<string[]>([]);
  // How many times the duration analyzer has attempted each track this
  // session. This was a one-shot Set, but getAudioDuration returns 0 for ANY
  // failure — including transient ones, most notably a decode that lost the
  // main thread to a deep scan running alongside it. Since the analyzer marks
  // a track BEFORE awaiting the result, a single unlucky attempt blacklisted
  // it for the whole session and left it stuck on "..." with no way back
  // short of a reload. Counting attempts keeps the endless-loop protection
  // (a genuinely unreadable file still converges, just after N tries) while
  // letting a track that failed by accident recover.
  const MAX_DURATION_ATTEMPTS = 3;
  const durationAttemptsRef = useRef<Map<string, number>>(new Map());
  // Bumped when every track earns a fresh retry budget, to re-trigger the
  // auto-rescan effect below (clearing a ref can't do that on its own).
  const [durationRetryEpoch, setDurationRetryEpoch] = useState(0);
  // Bumped once each time the queue drains, so the auto-rescan below gets one
  // healing sweep per import without having to watch the playlist array itself.
  const [durationDrainEpoch, setDurationDrainEpoch] = useState(0);
  const durationQueueActiveRef = useRef(false);

  // How many duration probes run at once. Each one spins up a real <audio>
  // element, and mobile browsers cap concurrent media elements far lower than
  // desktop, so this stays conservative rather than maximal — the old value of
  // 5 (paired with a 100 ms inter-batch delay) capped the whole import at 50
  // tracks/second, which is what made a few thousand files take minutes.
  const DURATION_BATCH_SIZE = 12;
  const DURATION_BATCH_SIZE_SCANNING = 4;
  // Resolved durations are buffered here and written to state on a time budget
  // instead of once per batch — see flushDurationUpdates.
  const DURATION_FLUSH_MS = 500;
  const durationUpdatesRef = useRef<Map<string, number>>(new Map());
  const lastDurationFlushRef = useRef<number>(0);
  // Total queued for the current import, for the progress readout. 0 = idle.
  const durationQueueTotalRef = useRef<number>(0);
  
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  
  const [isVizPanelOpen, setIsVizPanelOpen] = useState(true);

  // Disclaimer & Tutorial State
  
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  // Disclaimer pop-up on every visit logic is handled by initial state being false
  const acceptDisclaimer = () => {
      setDisclaimerAccepted(true);
      // Show tutorial after first acceptance if not seen
      const tutorialSeen = localStorage.getItem('aetheria_v3_tutorial_seen');
      if (!tutorialSeen) {
          setShowTutorial(true);
      }
  };

  const closeTutorial = () => {
      setShowTutorial(false);
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
  };

  // Visual settings — persisted to localStorage so the user's tuning survives
  // reloads and new sessions. Bump VIZ_SETTINGS_VERSION if VizSettings shape
  // changes incompatibly; saved values from older versions will be discarded.
  const VIZ_SETTINGS_STORAGE_KEY = 'aetheria.vizSettings.v1';
  const VIZ_SETTINGS_DEFAULTS: VizSettings = {
    speed: 1.0,
    sensitivity: 1.0,
    particleDensity: 'medium',
    particleBaseSize: 3.5,
    coreSize: 1.0,
    showHexagons: true,
    hexOpacity: 0.6,
    hexVisualMode: 'spectrum',
    showWaterRipples: false,
    hydroIntensity: 50,
    showTreeOfLife: false,
    showLoShuCube: false,
    loShuCubeAutoRotate: true,
    loShuCubeRotation: 0,
    loShuShowVortex: false,
    loShuShowAscent: false,
    loShuShowPillar: false,
    loShuShowOuroboros: false,
    colorMode: 'chakra',
    autoRotate: true,
    invertPerspective: false,
    morphEnabled: true,
    enableFlow: true,
    enableFloat: false,
    enablePulse: false,
    enableTrails: false,
  };

  const [vizSettings, setVizSettings] = useState<VizSettings>(() => {
    try {
      const raw = typeof localStorage !== 'undefined'
        ? localStorage.getItem(VIZ_SETTINGS_STORAGE_KEY)
        : null;
      if (!raw) return VIZ_SETTINGS_DEFAULTS;
      const parsed = JSON.parse(raw);
      // Spread defaults first so any keys missing from older saves get filled in.
      return { ...VIZ_SETTINGS_DEFAULTS, ...parsed };
    } catch {
      return VIZ_SETTINGS_DEFAULTS;
    }
  });

  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(VIZ_SETTINGS_STORAGE_KEY, JSON.stringify(vizSettings));
      }
    } catch {
      // localStorage may be full, blocked by privacy mode, or unavailable —
      // persistence is best-effort, never fatal.
    }
  }, [vizSettings]);

  const [volume, setVolume] = useState(0.8);
  const [solfeggioVolume, setSolfeggioVolume] = useState(0.01);
  // Independent gate for the solfeggio oscillator so the user can hear a
  // selected tone without the music track also resuming. Set true by
  // selectFrequency, cleared when the user explicitly pauses via the main
  // play/pause button.
  const [isSolfeggioActive, setIsSolfeggioActive] = useState(false);
  // One-shot guard so we bump a near-zero solfeggio volume up to an audible
  // level the first time the user activates a tone — without overriding
  // intentional later adjustments.
  const hasBoostedSolfeggioVolumeRef = useRef(false);
  const [binauralVolume, setBinauralVolume] = useState(0.03); // Initialized to 3%
  const [selectedSolfeggio, setSelectedSolfeggio] = useState<number>(396);
  // Lo Shu Perfect GUT mode — when ON, the GUT-band Solfeggio frequencies
  // (174,285,396,417,528,639) play at their Lo Shu Perfect counterparts
  // (75,186,297,408,519,630). 741/852/963 are exact matches in both sets,
  // and HEART/HEAD frequencies are unaffected.
  // Persisted to localStorage so the user's chosen mode survives reloads.
  const LO_SHU_MODE_STORAGE_KEY = 'aetheria.loShuPerfectGUT.v1';
  const [loShuPerfectGUT, setLoShuPerfectGUT] = useState<boolean>(() => {
    try {
      const raw = typeof localStorage !== 'undefined'
        ? localStorage.getItem(LO_SHU_MODE_STORAGE_KEY)
        : null;
      return raw === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LO_SHU_MODE_STORAGE_KEY, String(loShuPerfectGUT));
      }
    } catch {
      // localStorage may be full or blocked — persistence is best-effort.
    }
  }, [loShuPerfectGUT]);

  // Frequency colour mode — 'chakra' (the chakra/order palette stored in
  // SOLFEGGIO_INFO) or 'spectrum' (the colour the frequency would actually
  // have if octave-shifted up into visible light). Persisted to localStorage
  // so the user's choice survives reloads.
  const FREQUENCY_COLOR_MODE_STORAGE_KEY = 'aetheria.frequencyColorMode.v1';
  const [frequencyColorMode, setFrequencyColorMode] = useState<FrequencyColorMode>(() => {
    try {
      const raw = typeof localStorage !== 'undefined'
        ? localStorage.getItem(FREQUENCY_COLOR_MODE_STORAGE_KEY)
        : null;
      return raw === 'spectrum' ? 'spectrum' : 'chakra';
    } catch {
      return 'chakra';
    }
  });
  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(FREQUENCY_COLOR_MODE_STORAGE_KEY, frequencyColorMode);
      }
    } catch {
      // localStorage may be full or blocked — persistence is best-effort.
    }
  }, [frequencyColorMode]);

  // Lo Shu Walk mode — null = off, otherwise indicates which 27-frequency
  // walk built the current playlist. Set by generateLoShuWalk(); cleared
  // automatically by the effect below when the playlist no longer matches
  // the walk snapshot (so any other journey generator implicitly clears it).
  const [loShuWalkMode, setLoShuWalkMode] = useState<LoShuWalkMode | null>(null);
  // Snapshot of song-ids that made up the walk playlist when we set the
  // mode — used to detect "this playlist isn't the walk anymore" without
  // having to instrument every other journey generator.
  const loShuWalkSnapshotRef = useRef<string>('');
  // For multi-segment walks (combined, ouroboros, cabi): per-segment track
  // counts in playback order. Used by the footer chip to show "Vortex 14/27"
  // and similar. Lengths can be < the theoretical segment length if some
  // frequencies in the library had zero matching songs. Schema by mode:
  //   combined  → [Vortex, Ascent, Pillar]                              (3)
  //   ouroboros → [Ouroboros]                                           (1)
  //   cabi      → [Vortex, Ascent, Pillar, Ouroboros]                   (4)
  // Null for single walks (A/B/C/traditional) — chip falls back to total.
  const [loShuWalkSegments, setLoShuWalkSegments] = useState<number[] | null>(null);
  // Parallel to the walk playlist: phase tokens (♾️, ✕) that surface at
  // notable positions like the Ouroboros SOURCE crossings. Empty string for
  // positions with no special phase. Null when the active walk has no
  // phase tokens to display.
  const [loShuWalkPhases, setLoShuWalkPhases] = useState<string[] | null>(null);
  // Local UI state — controls whether the toolbar walk popover is open.
  const [showLoShuWalkMenu, setShowLoShuWalkMenu] = useState(false);

  const [selectedBinaural, setSelectedBinaural] = useState<BinauralPreset>(BINAURAL_PRESETS[2]);
  // Auto-clear the Lo Shu walk badge whenever the playlist diverges from
  // the snapshot we took when the walk started. Any other journey/filter
  // generator that calls setPlaylist implicitly clears the badge this way,
  // without us having to instrument each one.
  useEffect(() => {
    if (!loShuWalkMode) return;
    const currentIds = playlist.map((s: Song) => s.id).join('|');
    if (currentIds !== loShuWalkSnapshotRef.current) {
      setLoShuWalkMode(null);
      setLoShuWalkSegments(null);
      setLoShuWalkPhases(null);
    }
  }, [playlist, loShuWalkMode]);
  const [useChakraOrder, setUseChakraOrder] = useState(false);
  const [isAdaptiveBinaural, setIsAdaptiveBinaural] = useState(true); // Default ON
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Advanced Features State
  const [fractalAnalysis, setFractalAnalysis] = useState<FractalAnalysisResult | null>(null);
  const [showFrequencySelector, setShowFrequencySelector] = useState(false);
  const [showSafetyProtocols, setShowSafetyProtocols] = useState(false);
  // Safety protocol / experience level — persisted to localStorage so the
  // user's chosen tier survives reloads. The level is also auto-bumped by
  // certain journeys (HEAD alignment, 111-pattern journey, etc.); when
  // that happens the bumped value is what gets saved, so refreshing after
  // an Expert-level walk keeps the user at Expert until they explicitly
  // step down via the shield-icon header or Harmonic Settings.
  const EXPERIENCE_LEVEL_STORAGE_KEY = 'aetheria.experienceLevel.v1';
  const isValidExperienceLevel = (v: unknown): v is 'beginner' | 'intermediate' | 'advanced' | 'expert' =>
    v === 'beginner' || v === 'intermediate' || v === 'advanced' || v === 'expert';
  const [userExperienceLevel, setUserExperienceLevel] = useState<'beginner' | 'intermediate' | 'advanced' | 'expert'>(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(EXPERIENCE_LEVEL_STORAGE_KEY);
        if (isValidExperienceLevel(raw)) return raw;
      }
    } catch {
      // localStorage may be unavailable (private mode / SSR) — fall through.
    }
    return 'beginner';
  });
  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(EXPERIENCE_LEVEL_STORAGE_KEY, userExperienceLevel);
      }
    } catch {
      // Best-effort persistence — silent failure is fine.
    }
  }, [userExperienceLevel]);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [isDocumentingEffects, setIsDocumentingEffects] = useState(false);
  const [currentEffectsSession, setCurrentEffectsSession] = useState<string | null>(null);
  const [subtleResonanceMode, setSubtleResonanceMode] = useState(false);
  const [analysisNotification, setAnalysisNotification] = useState<string | null>(null);
  // Offline-ready confirmation. Separate from analysisNotification so it can
  // persist until the user taps it away (analysis toasts auto-fade).
  const [offlineReadyNotice, setOfflineReadyNotice] = useState<string | null>(null);
  const [showExperienceHistory, setShowExperienceHistory] = useState(false);
  
  // Phi integration state
  const [enablePhiMode, setEnablePhiMode] = useState(true); // Enable phi mode by default
  const [phiTimingEnabled, setPhiTimingEnabled] = useState(true); // Enable phi timing by default

  // Session duration tracking
  useEffect(() => {
    let interval: number | null = null;
    
    if (isPlaying) {
      if (!sessionStartTime) {
        setSessionStartTime(new Date());
      }
      
      interval = window.setInterval(() => {
        if (sessionStartTime) {
          const now = new Date();
          const duration = (now.getTime() - sessionStartTime.getTime()) / (1000 * 60);
          setSessionDuration(duration);
        }
      }, 1000);
    } else {
      setSessionStartTime(null);
      setSessionDuration(0);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, sessionStartTime]);

  // Effects documentation tracking
  useEffect(() => {
    if (isDocumentingEffects && isPlaying && !currentEffectsSession) {
      const sessionId = experienceTracker.startSession(
        selectedSolfeggio,
        solfeggioVolume,
        'sine'
      );
      setCurrentEffectsSession(sessionId);
    }
    
    if (!isDocumentingEffects && currentEffectsSession) {
      const report = experienceTracker.completeSession(currentEffectsSession);
      if (report) {
        // Find matching effect and add report
        const effects = effectsManager.findEffectsByFrequency(selectedSolfeggio, 10);
        if (effects.length > 0) {
          effectsManager.addUserReport(effects[0].id, report);
        }
      }
      setCurrentEffectsSession(null);
    }
  }, [isDocumentingEffects, isPlaying, selectedSolfeggio, solfeggioVolume, currentEffectsSession]);

  // Enhanced frequency detection function
  const detectDominantFrequencyAdvanced = useCallback(async (buffer: AudioBuffer): Promise<number> => {
    try {
      setIsAnalyzing(true);
      
      // Perform advanced fractal analysis
      const result = await analyzeFractalFrequencies(buffer);

      setFractalAnalysis(result);
      setIsAnalyzing(false);

      // DETECTION BOUNDARY — analysis read the unshifted source buffer; playback
      // runs at PITCH_SHIFT_FACTOR. Convert here so the safety assessment and the
      // returned frequency both describe what is actually heard.
      const heardFreq = toHeardHz(result.dominantFrequency);

      // Update safety state based on analysis
      const safetyAssessment = assessFrequencySafety(heardFreq);
      if (heardFreq > 963) {
        setSubtleResonanceMode(true);
        setShowSafetyProtocols(true);
        
        // Auto-adjust volume for high frequencies
        if (safetyAssessment.volume < solfeggioVolume) {
          setSolfeggioVolume(safetyAssessment.volume);
        }
      } else {
        setSubtleResonanceMode(false);
      }
      
      console.log('Fractal Analysis Result:', result);

      return heardFreq;
    } catch (error) {
      console.error("Advanced analysis failed, falling back to basic detection", error);
      setIsAnalyzing(false);
      setFractalAnalysis(null);

      // Fallback to original detection method — same boundary conversion applies.
      return toHeardHz(await detectDominantFrequency(buffer));
    }
  }, [solfeggioVolume]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  // Live mirror of `volume` for use inside callbacks with empty dep arrays
  // (initAudio), which would otherwise close over the mount-time value.
  const volumeRef = useRef(volume);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  const gainNodeRef = useRef<GainNode | null>(null);
  // MASTER BUS — the single point where EVERY audible Web Audio source sums
  // before reaching the output. Unity gain, so it is level-transparent; its job
  // is to exist, not to attenuate. The analyser and BOTH recorder taps hang off
  // it, so anything connected here is automatically heard, visualised, AND
  // recorded. Previously the taps hung off `gainNodeRef` (the binaural/solfeggio
  // sub-mix) while the sub-bass drone connected straight to the destination —
  // so the drone, ~97% of the synthesized output amplitude, was missing from
  // every recording the app produced. Connect new sources HERE, not to
  // ctx.destination, or they will be inaudible to the recorder.
  const masterBusRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const visualizerGainRef = useRef<GainNode | null>(null);
  
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  // One persistent silent oscillator that keeps the AudioContext from
  // suspending. Previously we created a fresh oscillator + gain pair every
  // 20s and never .disconnect()'d them, leaking ~3,400 routed native nodes
  // over a 19-hour session. A single long-running pair serves the same
  // purpose with zero churn.
  const silentKeepAliveRef = useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null);
  // Continuous sub-bass vibratory drone (Web Audio oscillator → destination).
  const subBassDroneRef = useRef<{ osc: OscillatorNode; gain: GainNode; amGain: GainNode; lfo: OscillatorNode; lfoGain: GainNode } | null>(null);
  const blobUrlsRef = useRef<{ [key: string]: string }>({});

  const solfeggioOscRef = useRef<OscillatorNode | null>(null);
  const solfeggioGainRef = useRef<GainNode | null>(null);
  const binauralLeftOscRef = useRef<OscillatorNode | null>(null);
  const binauralRightOscRef = useRef<OscillatorNode | null>(null);
  const binauralMergerRef = useRef<ChannelMergerNode | null>(null);
  const binauralGainRef = useRef<GainNode | null>(null);
  // Phase-modulation nodes (ConstantSources used for golden-angle binaural
  // offset). Tracked here so updateBinaural's cleanup can stop+disconnect
  // them — otherwise every volume change orphans two ConstantSources on
  // the AudioContext graph.
  const binauralLeftPhaseRef = useRef<ConstantSourceNode | null>(null);
  const binauralRightPhaseRef = useRef<ConstantSourceNode | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const wavRecorderRef = useRef<{
    chunks: Float32Array[][];
    channels: number;
    sampleRate: number;
    stop: () => void;
  } | null>(null);
  const wavWorkletReadyRef = useRef<Promise<void> | null>(null);
  // Music tap for recordings. With direct playback the music no longer flows
  // through Web Audio, so we re-introduce it for capture ONLY via the element's
  // captureStream() (which doesn't interrupt direct-to-OS playback). These hold
  // the live tap node and its teardown so a recording mixes music + layers.
  const recordMusicSrcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const recordMusicDetachRef = useRef<(() => void) | null>(null);
  const mainAudioRef = useRef<HTMLAudioElement | null>(null);
  // SILENT MEDIA-SESSION ANCHOR. A persistent, looping, silent <audio> element
  // started on the user's first play gesture and never stopped during a playback
  // session. Because it never stops or changes source, it keeps the page's OS
  // media session continuously "playing" — so the brief load gap when the music
  // element swaps .src on auto-advance no longer tears the lock-screen card down
  // (a gesture-less rebuild of the card is not permitted, which is why the card
  // was dropping on every background auto-transition). The music keeps playing
  // direct-to-OS on mainAudioRef as before.
  const anchorAudioRef = useRef<HTMLAudioElement | null>(null);
  const silentWavUrlRef = useRef<string | null>(null);
  // NOTE: there is deliberately no MediaElementAudioSourceNode. The music plays
  // DIRECT from the <audio> element to the OS so the lock-screen media session
  // survives gesture-less auto-advance — routing it through Web Audio makes the
  // element silent to the OS and the card drops. See the DIRECT PLAYBACK note in
  // playTrack. Recording taps the element with captureStream() instead, which
  // does not reroute it. (A dead `mediaSourceRef` lived here for a long time,
  // never assigned, implying a music path through the graph that does not exist.)

  const stateRef = useRef({
    playlist,
    currentSongIndex,
    isShuffle,
    isLoop,
    shuffledIndices,
    shufflePos
  });

  useEffect(() => {
    stateRef.current = { playlist, currentSongIndex, isShuffle, isLoop, shuffledIndices, shufflePos };
  }, [playlist, currentSongIndex, isShuffle, isLoop, shuffledIndices, shufflePos]);

  // Search — DERIVED, not state. This used to be a useState + useEffect pair,
  // which cost two full App renders per keystroke (one for searchTerm, one for
  // setFilteredPlaylist) plus a third when the new array identity re-ran the
  // virtualization effect below. It also called searchTerm.toLowerCase() INSIDE
  // the predicate and song.name.toLowerCase() per track, so a single character
  // allocated 2n throwaway strings. At a few thousand tracks that was plainly
  // visible while typing.
  //
  // useDeferredValue keeps the input itself at high priority and lets React run
  // the filter behind it, so a fast typist never waits on the list. During the
  // brief lag the previous results stay on screen — which is also why the
  // "no results" branch can't flash: an in-flight query still reads as the old,
  // non-empty result.
  const deferredSearchTerm = useDeferredValue(searchTerm);

  // Lower-cased track names, computed once per playlist change rather than once
  // per track per keystroke.
  const nameLowerById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of playlist) m.set(s.id, s.name.toLowerCase());
    return m;
  }, [playlist]);

  const filteredPlaylist = useMemo(() => {
    const q = deferredSearchTerm.trim().toLowerCase();
    if (q === '') return playlist;
    return playlist.filter((song: Song) =>
      (nameLowerById.get(song.id) ?? song.name.toLowerCase()).includes(q)
    );
  }, [deferredSearchTerm, playlist, nameLowerById]);

  // Restore the cached playlist on mount, before any user interaction. If
  // IndexedDB holds a saved library, repopulate the in-memory state and flash a
  // brief "Restored N tracks" toast. Restored tracks already carry their
  // duration, analysis and bandEnvelope, so the background analyzers skip them.
  // Corrupt/empty cache falls through silently to the normal empty state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Reading a few thousand cached tracks back off disk isn't instant, and
      // until it lands the app looks like it lost the library. Only surface the
      // progress toast once we know the cache is big enough to be worth it —
      // a small library restores faster than the toast could be read.
      const cached = await restorePlaylist((loaded, total) => {
        if (!cancelled && total >= RESTORE_PROGRESS_MIN_TRACKS) {
          setRestoreProgress({ loaded, total });
        }
      });
      if (cancelled) return;
      setRestoreProgress(null);
      if (!cached) return;

      setIsRestoring(true);
      setPlaylist(cached.playlist);
      setOriginalPlaylist(cached.originalPlaylist);
      setCurrentSongIndex(cached.currentSongIndex);
      if (cached.loShuWalkMode) setLoShuWalkMode(cached.loShuWalkMode);
      setSelectedSolfeggio(cached.selectedSolfeggio);

      console.log(
        `[Aetheria] Playlist restored: ${cached.playlist.length} tracks ` +
          `from ${new Date(cached.savedAt).toLocaleString()}`
      );

      // Keep the auto-save gate closed briefly so the restore doesn't bounce
      // straight back into a redundant save, then drop the toast.
      setTimeout(() => { if (!cancelled) setIsRestoring(false); }, 2000);
    })();
    return () => { cancelled = true; };
  }, []); // mount-only

  // The set of cached track ids, as a stable string key. Audio blobs are heavy
  // but only need (re)writing when this set changes — i.e. on import or delete,
  // NOT when a scan streams metadata into existing tracks. Keying the blob-save
  // effect on this (instead of the playlist array identity) means a deep scan,
  // which mutates metadata ~once per track, triggers ZERO audio writes.
  //
  // The key is an order-independent DIGEST, not the id list itself. It used to
  // be Array.from(ids).sort().join(',') — O(n log n) plus a ~200 KB string, and
  // the background duration analyzer changes the playlist identity once per
  // batch, so an import re-paid that cost hundreds of times. Only equality ever
  // matters here, so a scalar over the id set does the same job for free.
  const songIdSetKey = useMemo(() => {
    let xor = 0;
    let sum = 0;
    let count = 0;
    const seen = new Set<string>();
    const fold = (list: Song[]) => {
      for (const s of list) {
        if (!s.file || seen.has(s.id)) continue;
        seen.add(s.id);
        count++;
        // FNV-1a over the id, combined both ways: XOR alone would cancel out
        // under some add/remove pairs, the running sum won't.
        let h = 0x811c9dc5;
        for (let i = 0; i < s.id.length; i++) {
          h ^= s.id.charCodeAt(i);
          h = Math.imul(h, 0x01000193);
        }
        xor ^= h;
        sum = (sum + h) | 0;
      }
    };
    fold(playlist);
    fold(originalPlaylist);
    return `${count}:${(xor >>> 0).toString(36)}:${(sum >>> 0).toString(36)}`;
  }, [playlist, originalPlaylist]);

  // Persist BLOBS incrementally when the id set changes (add new, drop removed;
  // existing audio is never rewritten). Runs even during analysis so a reload
  // mid-scan still restores the full library.
  useEffect(() => {
    if (isRestoring || playlist.length === 0) return;
    saveBlobsNow(playlist, originalPlaylist, (result) => {
      // A library that only partly persisted used to fail COMPLETELY silently
      // (console.warn and nothing else), so the user found out on the next
      // reload when half their tracks were gone. Say it out loud instead.
      if (!result.quotaExceeded && result.pending === 0) return;
      const cached = result.total - result.pending;
      setAnalysisNotification(
        `Offline cache: ${cached.toLocaleString()} of ${result.total.toLocaleString()} tracks saved. ` +
          (result.quotaExceeded
            ? 'The browser is out of storage for this site — the rest will not survive a reload. ' +
              'Free up disk space, or remove some tracks and re-import.'
            : 'The remainder will be retried automatically.')
      );
    });
    // playlist/originalPlaylist are read but intentionally NOT deps — songIdSetKey
    // captures the only change that should write audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songIdSetKey, isRestoring]);

  // Persist METADATA + session state (light — no audio). Debounced, and
  // suppressed while a deep scan is active so its hundreds of per-track updates
  // don't churn the cache and compete with the (CPU-bound) scan. When the scan
  // finishes, isScanning flips false and this fires once — the settle-save.
  useEffect(() => {
    if (isRestoring || playlist.length === 0 || isScanning) return;
    debouncedSaveMeta(
      playlist,
      originalPlaylist,
      currentSongIndex,
      loShuWalkMode,
      selectedSolfeggio
    );
  }, [playlist, originalPlaylist, currentSongIndex, loShuWalkMode, selectedSolfeggio, isRestoring, isScanning]);

  // Precompute song.id -> playlist index once per playlist change. The library
  // list render used to call playlist.findIndex() per row (O(n²) per render);
  // with large libraries that scan was a measurable contributor to the
  // "requestAnimationFrame handler took N ms" violations when the sidebar
  // was open. A Map lookup is O(1) per row.
  const playlistIndexById = useMemo(() => {
    const m = new Map<string, number>();
    playlist.forEach((s, i) => m.set(s.id, i));
    return m;
  }, [playlist]);

  // Same idea for the whole library, but exposed through a ref. The background
  // duration analyzer needs to look up songs by id, and it used to do that with
  // originalPlaylist.find() while ALSO listing originalPlaylist as a dependency
  // — so every batch both scanned the array and re-armed the effect that wrote
  // it. Reading through a ref keeps the lookup O(1) and breaks that self-
  // retriggering loop. Declared above the analyzer so React's in-order effect
  // flush has it current before the analyzer's timer ever fires.
  const originalSongById = useMemo(() => {
    const m = new Map<string, Song>();
    for (const s of originalPlaylist) m.set(s.id, s);
    return m;
  }, [originalPlaylist]);
  const originalSongByIdRef = useRef(originalSongById);
  useEffect(() => { originalSongByIdRef.current = originalSongById; }, [originalSongById]);

  // --- Library list virtualization ---
  // The library can hold hundreds of songs; rendering every row mounted a full
  // DOM subtree plus a lucide SVG icon each — that was the dominant heap cost in
  // the snapshot (the {ref,xmlns,viewBox,...} icon objects and the SVGAnimated*
  // arrays) and slowed every list re-render. We window the list: only rows
  // within the scroll viewport (plus a small overscan) are mounted; off-screen
  // rows are replaced by two spacer divs that preserve total scroll height, so
  // the scrollbar and scroll behavior are unchanged. Rows are a fixed height so
  // the scroll math stays exact. The sidebar remains a single shared scroll
  // container (header + list scroll together) exactly as before.
  const SONG_ROW_HEIGHT = 64; // px stride per row (60px row body + 4px gap)
  const sidebarScrollRef = useRef<HTMLElement>(null);
  const songListRef = useRef<HTMLDivElement>(null);
  const [songListRange, setSongListRange] = useState({ start: 0, end: 40 });

  const recomputeSongListRange = useCallback(() => {
    const scrollEl = sidebarScrollRef.current;
    const listEl = songListRef.current;
    if (!scrollEl || !listEl) return;
    const n = (searchTerm ? filteredPlaylist : playlist).length;
    if (n === 0) {
      setSongListRange(r => (r.start === 0 && r.end === 0) ? r : { start: 0, end: 0 });
      return;
    }
    const scrollRect = scrollEl.getBoundingClientRect();
    const listRect = listEl.getBoundingClientRect();
    const overscan = 6;
    // How far the top of the list has scrolled above the viewport top. The
    // list sits below a tall header inside the same scroll container, so this
    // is naturally 0 until the header scrolls away.
    const scrolledIntoList = Math.max(0, scrollRect.top - listRect.top);
    const start = Math.max(0, Math.floor(scrolledIntoList / SONG_ROW_HEIGHT) - overscan);
    const visibleCount = Math.ceil(scrollEl.clientHeight / SONG_ROW_HEIGHT);
    const end = Math.min(n, start + visibleCount + overscan * 2);
    setSongListRange(r => (r.start === start && r.end === end) ? r : { start, end });
  }, [searchTerm, filteredPlaylist, playlist]);

  // Recompute when the rendered list changes, the sidebar opens, or on resize.
  useEffect(() => {
    recomputeSongListRange();
    window.addEventListener('resize', recomputeSongListRange);
    return () => window.removeEventListener('resize', recomputeSongListRange);
  }, [recomputeSongListRange, showSidebar]);

  // Delete song function
  const deleteSong = useCallback((songId: string) => {
    const updatePlaylist = (prev: Song[]) => prev.filter(song => song.id !== songId);
    
    // Update both playlists
    setPlaylist(updatePlaylist);
    setOriginalPlaylist(updatePlaylist);
    
    // Handle currently playing song
    const deletingIndex = playlist.findIndex(song => song.id === songId);
    if (deletingIndex === currentSongIndex) {
      // If currently playing song is deleted, stop playback
      setIsPlaying(false);
      if (sourceNodeRef.current) {
        try { 
          sourceNodeRef.current.stop(); 
          sourceNodeRef.current.disconnect();
        } catch(e) {}
        sourceNodeRef.current = null;
      }
      setCurrentSongIndex(-1);
    } else if (deletingIndex < currentSongIndex) {
      // If deleted song was before current song, adjust index
      setCurrentSongIndex(prev => prev - 1);
    }
  }, [playlist, currentSongIndex]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Disconnect the persistent silent keep-alive oscillator so it
      // doesn't outlive the AudioContext.
      if (silentKeepAliveRef.current) {
        try {
          silentKeepAliveRef.current.osc.stop();
          silentKeepAliveRef.current.osc.disconnect();
          silentKeepAliveRef.current.gain.disconnect();
        } catch {
          // Already stopped/disconnected — safe to ignore.
        }
        silentKeepAliveRef.current = null;
      }
      // Disconnect the sub-bass drone oscillator too.
      if (subBassDroneRef.current) {
        try {
          subBassDroneRef.current.osc.stop();
          subBassDroneRef.current.lfo.stop();
          subBassDroneRef.current.osc.disconnect();
          subBassDroneRef.current.amGain.disconnect();
          subBassDroneRef.current.lfo.disconnect();
          subBassDroneRef.current.lfoGain.disconnect();
          subBassDroneRef.current.gain.disconnect();
        } catch {
          // Already stopped/disconnected — safe to ignore.
        }
        subBassDroneRef.current = null;
      }

      // Clean up blob URLs
      Object.values(blobUrlsRef.current).forEach((url) => {
        if (typeof url === 'string') {
          URL.revokeObjectURL(url);
        }
      });
      blobUrlsRef.current = {};
      
      // Clean up audio element
      if (mainAudioRef.current) {
        mainAudioRef.current.pause();
        mainAudioRef.current.src = '';
        mainAudioRef.current = null;
      }
      // Clean up the silent media-session anchor.
      if (anchorAudioRef.current) {
        anchorAudioRef.current.pause();
        anchorAudioRef.current.src = '';
        anchorAudioRef.current = null;
      }

      // Stop all oscillators
      [solfeggioOscRef, binauralLeftOscRef, binauralRightOscRef].forEach(ref => {
        if (ref.current) {
          try {
            ref.current.stop();
            ref.current.disconnect();
          } catch (e) {}
        }
      });
      
      // Close audio context
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
      
      // Clean up wake lock
      wakeLockManager.releaseWakeLock();
      
      // Clean up stability manager
      stabilityManager.cleanup();
    };
  }, []);

  // Handle Zen Mode Mouse tracking
  useEffect(() => {
    if (!isZenMode) {
      setZenUiVisible(true);
      return;
    }

    const handleMouseMove = () => {
      setZenUiVisible(true);
      if (zenTimeoutRef.current) clearTimeout(zenTimeoutRef.current);
      zenTimeoutRef.current = window.setTimeout(() => {
        setZenUiVisible(false);
      }, 3000); 
    };

    window.addEventListener('mousemove', handleMouseMove);
    // Initial trigger to show UI when entering mode
    handleMouseMove();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (zenTimeoutRef.current) clearTimeout(zenTimeoutRef.current);
    };
  }, [isZenMode]);

  // Handle Shuffle State Logic
  useEffect(() => {
    if (isShuffle && playlist.length > 0) {
        // If we just toggled shuffle or playlist changed size
        if (shuffledIndices.length !== playlist.length) {
            // LRU-weighted shuffle — never-played first, then longest-not-heard.
            // Replaces pure Fisher-Yates so a 6-hour shuffle session cycles
            // the whole library before any song repeats, instead of letting
            // chance favour the same handful of tracks.
            const newIndices = getLruShuffledIndices(playlist, playHistoryRef.current);
            setShuffledIndices(newIndices);
            // Try to keep the current song playing without jumping
            const currentIdxInShuffle = newIndices.indexOf(currentSongIndex);
            setShufflePos(currentIdxInShuffle !== -1 ? currentIdxInShuffle : 0);
        }
    } else if (!isShuffle) {
        // Clear shuffle state when disabled
        setShuffledIndices([]);
        setShufflePos(0);
    }
  }, [isShuffle, playlist.length]);

  const playTrackRef = useRef<(index: number, list?: Song[]) => Promise<void>>(async () => {});
  const playNextRef = useRef<() => void>(() => {});

  // Guards the pre-end auto-advance so it fires at most once per track. We swap
  // to the next track a hair BEFORE the element reaches its natural `ended`
  // state (see the 'timeupdate' listener in playTrack) — letting it actually
  // end tears down the OS media session, and rebuilding the lock-screen card
  // from the gesture-less `ended` handler is not permitted, so the card
  // vanished on every auto-transition (while a manual headphone skip, which
  // runs in a user-activation context, kept it). Reset to false in playTrack
  // each time a new src is armed.
  const autoAdvanceTriggeredRef = useRef(false);

  // --- Audio Initialization ---
  const initAudio = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        // Use device native sample rate. Forcing 192kHz just upsamples 44.1/48kHz source
        // files (no quality gain) and quadruples WAV file size.
        audioCtxRef.current = new AudioContextClass();
        console.log(`AudioContext sample rate: ${audioCtxRef.current.sampleRate} Hz`);
        
        // Register with stability manager
        stabilityManager.registerAudioContext(audioCtxRef.current);
        
        // SIMPLIFIED AUDIO CHAIN FOR PURE SOUND
        // Create minimal processing chain to eliminate distortion
        
        // Single, gentle compressor for dynamic control
        compressorRef.current = audioCtxRef.current.createDynamicsCompressor();
        compressorRef.current.threshold.value = -24; // Higher threshold, less compression
        compressorRef.current.knee.value = 30.0; // Very soft knee for transparent compression  
        compressorRef.current.ratio.value = 3.0; // Gentle 3:1 ratio
        compressorRef.current.attack.value = 0.003; // Slightly slower attack
        compressorRef.current.release.value = 0.1; // Moderate release
        
        // Single gentle high-frequency shelf to prevent harshness
        const highShelfFilter = audioCtxRef.current.createBiquadFilter();
        highShelfFilter.type = 'highshelf';
        highShelfFilter.frequency.value = 10000; // Only affect very high frequencies
        highShelfFilter.gain.value = -3; // Gentle 3dB reduction
        
        // Safety limiter only - should rarely engage
        const limiter = audioCtxRef.current.createDynamicsCompressor();
        limiter.threshold.value = -0.5; // Only catch true peaks
        limiter.knee.value = 0; // Hard knee for brick-wall limiting
        limiter.ratio.value = 20.0; // High ratio for limiting
        limiter.attack.value = 0.0; // Instant attack
        limiter.release.value = 0.01; // Very fast release
        
        // Create placeholder filters (disconnected) for compatibility
        const lowPassFilter = audioCtxRef.current.createBiquadFilter();
        const notchFilter = audioCtxRef.current.createBiquadFilter();
        const deEsserFilter = audioCtxRef.current.createBiquadFilter();
        const vocalFilter = audioCtxRef.current.createBiquadFilter();
        
        // Store references for cleanup
        (audioCtxRef.current as any).lowPassFilter = lowPassFilter;
        (audioCtxRef.current as any).highShelfFilter = highShelfFilter;
        (audioCtxRef.current as any).notchFilter = notchFilter;
        (audioCtxRef.current as any).deEsserFilter = deEsserFilter;
        (audioCtxRef.current as any).limiter = limiter;
        
        // MASTER BUS — unity gain, level-transparent. Every audible source sums
        // here, and the output / analyser / recorder taps all hang off it, so a
        // source connected to the bus is heard, visualised and recorded by
        // construction. See the masterBusRef declaration for why this exists.
        masterBusRef.current = audioCtxRef.current.createGain();
        masterBusRef.current.gain.value = 1.0;
        masterBusRef.current.connect(audioCtxRef.current.destination);

        // SAFETY LIMITER — deliberately NOT connected. With the clamp in
        // integratePhiVolumes the worst-case bus total is ~0.28 of full scale, so
        // a -0.5 dB limiter would never engage, and DynamicsCompressorNode adds
        // ~6 ms of lookahead latency that would skew A/V sync in video captures.
        // To enable it later, this is the only change needed:
        //   masterBusRef.current.disconnect(audioCtxRef.current.destination);
        //   masterBusRef.current.connect(limiter);
        //   limiter.connect(audioCtxRef.current.destination);
        // Reconnecting `compressorRef` / `highShelfFilter` is a TONAL change and
        // a separate decision — both are also inert at these levels.

        gainNodeRef.current = audioCtxRef.current.createGain();
        // Binaural / solfeggio sub-mix level. Initialised to the SAME steady-state
        // formula the volume effect applies, so the layers don't overshoot on the
        // first play. (This used to be a flat 0.7 — a ~9.7x overshoot for the half
        // second before the effect ramped it down.) Read through volumeRef because
        // initAudio has empty deps and would otherwise capture a stale `volume`.
        gainNodeRef.current.gain.value = volumeRef.current * 0.18 * LAYER_BALANCE_ATTEN;

        gainNodeRef.current.connect(masterBusRef.current);

        // Create separate gain for visualizer to boost signal without affecting audio
        visualizerGainRef.current = audioCtxRef.current.createGain();
        visualizerGainRef.current.gain.value = 2.0; // Moderate boost for smoother visuals

        analyserRef.current = audioCtxRef.current.createAnalyser();
        analyserRef.current.fftSize = 512; // Smallest practical FFT for best performance
        analyserRef.current.smoothingTimeConstant = 0.92; // More smoothing to reduce jitter

        // Bus -> visualizer gain -> analyser (separate path for visuals)
        masterBusRef.current.connect(visualizerGainRef.current);
        visualizerGainRef.current.connect(analyserRef.current);

        setAnalyserNode(analyserRef.current);

        destNodeRef.current = audioCtxRef.current.createMediaStreamDestination();
        // Tap the master bus into the recording destination so MediaRecorder
        // captures the FULL synthesized mix — layers AND sub-bass drone. Tapping
        // `gainNodeRef` here (the old wiring) silently dropped the drone from
        // every recording; tapping `limiter` before that produced pure silence,
        // since the limiter had no input.
        masterBusRef.current.connect(destNodeRef.current);
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(err => {
          console.error('Failed to resume audio context:', err);
        });
      }
    } catch (error) {
      console.error('Audio initialization failed:', error);
      alert('Audio initialization failed. Please reload the app.');
    }
  }, []);

  // Lo Shu Perfect GUT swap table. Only positions 1-6 differ; 7-9 are identical
  // in both sets, so they're absent here. Returns the input unchanged when the
  // mode is off or the frequency isn't a GUT-band Solfeggio.
  const LO_SHU_PERFECT_MAP: Record<number, number> = {
    174: 75,
    285: 186,
    396: 297,
    417: 408,
    528: 519,
    639: 630,
  };
  const applyLoShuPerfectMap = (freq: number): number =>
    loShuPerfectGUT ? (LO_SHU_PERFECT_MAP[freq] ?? freq) : freq;

  const updateSolfeggio = useCallback(() => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const now = ctx.currentTime;

    if (solfeggioOscRef.current) {
      try { solfeggioOscRef.current.stop(); } catch(e) {}
      solfeggioOscRef.current.disconnect();
    }
    if (solfeggioGainRef.current) solfeggioGainRef.current.disconnect();

    // Run the oscillator when EITHER the music is playing OR the user
    // activated a tone-only session by clicking a frequency. This decouples
    // the tone from the music transport so picking a frequency in any
    // selector plays the chosen tone without resuming a paused track.
    if (!isPlaying && !isSolfeggioActive) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // solfeggioHz(), not toSubBass() — above the threshold the raw octave-drop
    // lands exactly on the sub-bass drone's carrier (21 of 27 frequencies), which
    // put two oscillators on one pitch with arbitrary per-session relative phase.
    // The drone owns the felt band; this layer steps off it by φ.
    osc.frequency.setValueAtTime(solfeggioHz(applyLoShuPerfectMap(selectedSolfeggio)), now);
    
    gain.gain.setValueAtTime(0, now);
    // CHANGE 1: Apply phi-based volume relationship for solfeggio layer
    const phiVolumes = enablePhiMode 
      ? integratePhiVolumes(volume, binauralVolume, solfeggioVolume, true)
      : { music: volume, binaural: binauralVolume, solfeggio: solfeggioVolume };
    
    // Solfeggio volume with phi ratio applied
    gain.gain.linearRampToValueAtTime(phiVolumes.solfeggio, now + 1);

    osc.connect(gain);
    gain.connect(gainNodeRef.current!); 
    
    osc.start();

    solfeggioOscRef.current = osc;
    solfeggioGainRef.current = gain;
  }, [isPlaying, isSolfeggioActive, selectedSolfeggio, solfeggioVolume, enablePhiMode, volume, binauralVolume, loShuPerfectGUT]);

  useEffect(() => {
      if (binauralGainRef.current && audioCtxRef.current) {
          // CHANGE 1: Apply phi-based volume relationship for binaural layer
          const phiVolumes = enablePhiMode 
            ? integratePhiVolumes(volume, binauralVolume, solfeggioVolume, true)
            : { music: volume, binaural: binauralVolume, solfeggio: solfeggioVolume };
          
          binauralGainRef.current.gain.setTargetAtTime(phiVolumes.binaural, audioCtxRef.current.currentTime, 0.1);
      }
  }, [binauralVolume, volume, enablePhiMode, solfeggioVolume]);

  const updateBinaural = useCallback(() => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    
    [binauralLeftOscRef, binauralRightOscRef, binauralLeftPhaseRef, binauralRightPhaseRef].forEach(ref => {
      if (ref.current) { try { ref.current.stop(); } catch(e){} ref.current.disconnect(); ref.current = null; }
    });
    if (binauralGainRef.current) binauralGainRef.current.disconnect();
    if (binauralMergerRef.current) binauralMergerRef.current.disconnect();

    if (!isPlaying) return;

    const carrier = 200; 
    const diff = selectedBinaural.delta;

    const leftOsc = ctx.createOscillator();
    const rightOsc = ctx.createOscillator();
    const merger = ctx.createChannelMerger(2);
    const mainGain = ctx.createGain();

    // CHANGE 2: Apply golden angle phase offset for binaural beats
    leftOsc.frequency.value = carrier;
    rightOsc.frequency.value = carrier + diff;
    
    // Create constant sources for phase modulation
    const leftPhaseNode = ctx.createConstantSource();
    const rightPhaseNode = ctx.createConstantSource();
    
    // Set phase offsets: left at 0°, right at golden angle (137.5°)
    leftPhaseNode.offset.value = 0;
    rightPhaseNode.offset.value = enablePhiMode ? GOLDEN_ANGLE_RAD : 0;
    
    leftPhaseNode.start();
    rightPhaseNode.start();
    
    leftOsc.connect(merger, 0, 0); 
    rightOsc.connect(merger, 0, 1); 

    merger.connect(mainGain);
    mainGain.connect(gainNodeRef.current!);

    // Apply phi-based volume if enabled
    const phiVolumes = enablePhiMode 
      ? integratePhiVolumes(volume, binauralVolume, solfeggioVolume, true)
      : { music: volume, binaural: binauralVolume, solfeggio: solfeggioVolume };
      
    mainGain.gain.value = phiVolumes.binaural;

    // Start oscillators with phase offset timing
    const now = ctx.currentTime;
    leftOsc.start(now);
    // Right oscillator starts with golden angle phase offset
    const phaseOffsetTime = enablePhiMode ? GOLDEN_ANGLE_RAD / (2 * Math.PI * carrier) : 0;
    rightOsc.start(now + phaseOffsetTime);

    binauralLeftOscRef.current = leftOsc;
    binauralRightOscRef.current = rightOsc;
    binauralMergerRef.current = merger;
    binauralGainRef.current = mainGain;
    binauralLeftPhaseRef.current = leftPhaseNode;
    binauralRightPhaseRef.current = rightPhaseNode;
  }, [isPlaying, selectedBinaural, enablePhiMode, volume, binauralVolume, solfeggioVolume]); 

  useEffect(() => { updateSolfeggio(); }, [updateSolfeggio]);
  useEffect(() => { updateBinaural(); }, [updateBinaural]);

  // Apply the music volume directly on the <audio> element. With direct
  // playback the element is the music output (not the Web Audio gain node), so
  // its volume IS the music level. We keep the same * 0.18 scaling the old
  // Web Audio master used, so perceived music loudness is unchanged.
  const applyMusicElementVolume = useCallback(() => {
    const el = mainAudioRef.current;
    if (!el) return;
    const vols = enablePhiMode
      ? calculatePhiVolumeRatios(volume)
      : { music: volume };
    // On mobile, boost to offset Chrome's ducking caused by the silent anchor
    // (see MOBILE_MUSIC_DUCK_COMPENSATION). Clamp keeps it safe at the top.
    const duckComp = IS_MOBILE_DEVICE ? MOBILE_MUSIC_DUCK_COMPENSATION : 1;
    el.volume = Math.max(0, Math.min(1, vols.music * 0.18 * duckComp));
  }, [enablePhiMode, volume]);

  useEffect(() => {
    // Music level now lives on the audio element (direct playback).
    applyMusicElementVolume();

    // The gain node no longer carries the music — only the binaural / solfeggio
    // layers route through it — but it stays the master for THOSE layers, and
    // they were always scaled by this same music*0.18 master, so their balance
    // is unchanged.
    if(gainNodeRef.current && audioCtxRef.current) {
        // Apply phi relationships if enabled
        const volumes = enablePhiMode
          ? calculatePhiVolumeRatios(volume)
          : { music: volume, binaural: binauralVolume, solfeggio: solfeggioVolume };

        // Ultra-conservative volume scaling to prevent any distortion. The
        // extra LAYER_BALANCE_ATTEN factor recesses the binaural/solfeggio
        // layers (the only signals on this bus now) back behind the music.
        const safeVolume = volumes.music * 0.18 * LAYER_BALANCE_ATTEN; // Match the initial gain setting
        gainNodeRef.current.gain.setTargetAtTime(safeVolume, audioCtxRef.current.currentTime, 0.1);
    }

    // Keep the sub-bass drone tracking the master volume while playing.
    if (subBassDroneRef.current && audioCtxRef.current) {
        const target = isPlaying ? volume * SUB_BASS_DRONE_LEVEL : 0;
        subBassDroneRef.current.gain.gain.setTargetAtTime(target, audioCtxRef.current.currentTime, 0.2);
    }
  }, [volume, enablePhiMode, applyMusicElementVolume, isPlaying]);

  // Adaptive binaural: move the brain-wave band with the music's actual energy.
  //
  // We CANNOT read the song from the live analyser — the music plays direct-to-OS
  // through the <audio> element (deliberately not routed through Web Audio, so the
  // lock-screen card survives), so the analyser only ever sees the near-silent
  // synth layers and the old logic was pinned to Delta forever. Instead we read the
  // PRE-SCANNED per-track band envelope (the same data the visualizer uses) at the
  // live playback position — real per-song AND in-song energy, no audio-graph tap.
  useEffect(() => {
    if (!isAdaptiveBinaural || !isPlaying) return;
    const env = currentSongIndex >= 0 ? playlist[currentSongIndex]?.bandEnvelope : null;
    if (!env) return;   // scan failed / no envelope → leave the manual band untouched

    const interval = setInterval(() => {
      const el = mainAudioRef.current;
      if (!el) return;
      const fps = env.fps || 20;
      const frame = Math.floor((el.currentTime || 0) * fps);
      // Average spectral activity over a ~1.5s window so the reading is smooth,
      // not a single jittery frame. Each band is self-normalised, so this is a
      // "how much is happening across the spectrum right now" intensity (0..1).
      const win = Math.max(1, Math.round(fps * 1.5));
      let sum = 0, count = 0;
      for (let f = Math.max(0, frame - win); f <= frame; f++) {
        const s = env.sub[f] ?? 0, b = env.bass[f] ?? 0, m = env.mid[f] ?? 0, h = env.high[f] ?? 0;
        sum += (s + b + m + h) / 4;
        count++;
      }
      const intensity = count ? (sum / count) / 255 : 0;

      // Map intensity → target band (calm → Delta … intense → Gamma).
      let target = 0;
      if (intensity >= 0.75) target = 4;        // Gamma
      else if (intensity >= 0.55) target = 3;   // Beta
      else if (intensity >= 0.35) target = 2;   // Alpha
      else if (intensity >= 0.15) target = 1;   // Theta
      // else Delta (0)

      // Drift at most ONE band per tick toward the target — organic movement, and
      // it never retunes the binaural oscillators by more than a step at a time.
      const cur = BINAURAL_PRESETS.findIndex((p) => p.name === selectedBinaural.name);
      const curIdx = cur < 0 ? 2 : cur;
      if (curIdx !== target) {
        setSelectedBinaural(BINAURAL_PRESETS[curIdx + Math.sign(target - curIdx)]);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isAdaptiveBinaural, isPlaying, selectedBinaural, currentSongIndex, playlist]);

  // Log phi integration on mount
  useEffect(() => {
    if (enablePhiMode) {
      console.log('🌀 Aetheria Phi Integration Active');
      logPhiRelationships(1.0, 300); // Log example for 5 minute track
    }
  }, [enablePhiMode]);
  
  // Initialize stability management on mount
  useEffect(() => {
    // Register service worker for background audio
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(registration => {
        console.log('Service Worker ready for background audio');
        
        // Request periodic sync for keeping audio alive
        if ('periodicSync' in registration) {
          (registration as any).periodicSync.register('keep-audio-alive', {
            minInterval: 60 * 1000 // 1 minute
          }).catch((err: any) => console.log('Periodic sync not available:', err));
        }
      });
    }

    // Listen for stability manager messages
    const handleStabilityMessage = (event: MessageEvent) => {
      if (event.data.source !== 'stability-manager') return;
      
      switch (event.data.type) {
        case 'REDUCE_QUALITY':
          // Reduce visualizer quality to save memory
          setVizSettings(prev => ({
            ...prev,
            particleDensity: 'low',
            particleBaseSize: Math.min(prev.particleBaseSize, 2),
            showWaterRipples: false,
            showTreeOfLife: false
          }));
          break;
          
        case 'OPTIMIZE_BUFFERS':
          // Clear audio buffer cache if needed
          audioBufferRef.current = null;
          break;
          
        case 'REDUCE_MEMORY':
          // Reduce playlist display if too large
          if (playlist.length > 100) {
            console.log('Reducing playlist display for memory optimization');
          }
          break;
          
        case 'SUSPEND_HEAVY_OPS':
          // Pause heavy operations when app is backgrounded
          setVizSettings(prev => ({ ...prev, autoRotate: false }));
          break;
          
        case 'RESUME_OPS':
          // Resume operations when app is foregrounded
          break;
          
        case 'RESTORE_STATE':
          // Restore from checkpoint after crash
          const { state } = event.data;
          if (state && state.currentSongIndex !== undefined) {
            console.log('Restoring from checkpoint:', state);
            if (state.currentSongIndex >= 0 && state.currentSongIndex < playlist.length) {
              setCurrentSongIndex(state.currentSongIndex);
            }
          }
          break;
      }
    };
    
    window.addEventListener('message', handleStabilityMessage);
    
    // Save checkpoint periodically
    const checkpointInterval = setInterval(() => {
      if (isPlaying) {
        stabilityManager.saveCheckpoint({
          currentSongIndex,
          isPlaying,
          volume,
          selectedFrequency: selectedSolfeggio,
          playlist: playlist.slice(0, 10) // Save only first 10 songs to avoid storage issues
        });
      }
    }, 30000); // Every 30 seconds
    
    return () => {
      window.removeEventListener('message', handleStabilityMessage);
      clearInterval(checkpointInterval);
    };
  }, [currentSongIndex, isPlaying, volume, selectedSolfeggio, playlist]);

  // Wake lock + AudioContext keep-alive management for playback
  useEffect(() => {
    if (isPlaying) {
      wakeLockManager.requestWakeLock();

      // Lazily create a single long-running silent oscillator to keep the
      // AudioContext from suspending during gaps between tracks. Created
      // once for the whole session; never re-allocated. The gain is 0 so
      // it produces no audible output; an oscillator continuously feeding
      // the destination is the standard "keep context active" pattern.
      if (audioCtxRef.current && !silentKeepAliveRef.current) {
        const osc = audioCtxRef.current.createOscillator();
        const gain = audioCtxRef.current.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(audioCtxRef.current.destination);
        osc.start();
        silentKeepAliveRef.current = { osc, gain };
      }

      // Lazily create the continuous sub-bass drone (same once-and-keep pattern;
      // an oscillator can only be .start()'d once). It runs forever; its loudness
      // is controlled by the gain, faded in/out with playback below.
      if (audioCtxRef.current && SUB_BASS_DRONE_LEVEL > 0 && !subBassDroneRef.current && masterBusRef.current) {
        const ctx = audioCtxRef.current;
        // Source of truth = the SAME frequency the solfeggio layer uses, so the
        // drone is octave-locked to it (no beating). Updated on change below.
        const baseFreq = applyLoShuPerfectMap(selectedSolfeggio);

        // CARRIER — felt sub-bass, octave-locked to the active frequency.
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = feltCarrierHz(baseFreq);

        // AM stage — the carrier's amplitude swings around a midpoint at the
        // theta-alpha rate. Midpoint = 1 - depth/2, swing = ±depth/2, so it ranges
        // [1-depth, 1] — it SWELLS, never reaches zero. No gating, no "cutting".
        const amGain = ctx.createGain();
        amGain.gain.value = 1 - SUB_BASS_MOD_DEPTH / 2;

        // LFO — the theta-alpha modulator. Octave-locked into 5–10 Hz; felt as a
        // slow throb on the carrier, never heard as a pitch (the guide's target,
        // delivered the only way a sub-perceptual rate can be: as an envelope).
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = thetaAlphaModHz(baseFreq);
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = SUB_BASS_MOD_DEPTH / 2;   // ± swing depth
        lfo.connect(lfoGain);
        lfoGain.connect(amGain.gain);                  // a-rate amplitude modulation

        // MASTER gain — faded with play/pause + volume (unchanged contract).
        const gain = ctx.createGain();
        gain.gain.value = 0;                           // ramped up just below

        osc.connect(amGain);
        amGain.connect(gain);
        // Into the MASTER BUS, not ctx.destination. The bus is unity gain, so the
        // drone's audible level is unchanged — but it is now also seen by the
        // analyser and captured by BOTH recorders. Connecting straight to the
        // destination (the old wiring) left the drone out of every export.
        gain.connect(masterBusRef.current);
        osc.start();
        lfo.start();
        subBassDroneRef.current = { osc, gain, amGain, lfo, lfoGain };
      } else if (audioCtxRef.current && SUB_BASS_DRONE_LEVEL > 0 && !subBassDroneRef.current) {
        // Bus missing means initAudio() has not run yet. playTrack() calls it
        // synchronously before setIsPlaying(true), so this should be unreachable;
        // if it ever fires, the drone is silently absent — make that visible.
        console.warn('Sub-bass drone skipped: master bus not initialised. Check initAudio() ordering.');
      }
    } else {
      wakeLockManager.releaseWakeLock();
      // Leave the silent oscillator (and the sub-bass drone) running — fixed,
      // tiny cost; recreating would re-introduce the leak we're avoiding (an
      // oscillator can only be .start()'d once per the Web Audio spec).
    }

    // Fade the sub-bass drone in while playing, out while paused. A smooth ramp
    // (setTargetAtTime) is essential — an abrupt sub-bass start/stop is a thump.
    if (subBassDroneRef.current && audioCtxRef.current) {
      const target = isPlaying ? volume * SUB_BASS_DRONE_LEVEL : 0;
      subBassDroneRef.current.gain.gain.setTargetAtTime(target, audioCtxRef.current.currentTime, 0.25);
    }
  }, [isPlaying]);

  // Re-lock the sub-bass carrier + theta-alpha modulation to the active frequency
  // whenever it changes (track advance, frequency pick). Both GLIDE smoothly — a
  // hard jump, even at sub-bass, is a perceptible lurch (the guide's transitionSubBass).
  useEffect(() => {
    const node = subBassDroneRef.current;
    const ctx = audioCtxRef.current;
    if (!node || !ctx) return;
    const baseFreq = applyLoShuPerfectMap(selectedSolfeggio);
    const carrier = feltCarrierHz(baseFreq);
    const mod = thetaAlphaModHz(baseFreq);
    const t = ctx.currentTime;
    // Anchor at the current value, then exponential-ramp (perceptually smooth pitch
    // glide; both targets are > 0 so exponential is safe).
    node.osc.frequency.setValueAtTime(node.osc.frequency.value, t);
    node.osc.frequency.exponentialRampToValueAtTime(carrier, t + SUB_BASS_GLIDE_S);
    node.lfo.frequency.setValueAtTime(node.lfo.frequency.value, t);
    node.lfo.frequency.exponentialRampToValueAtTime(mod, t + SUB_BASS_GLIDE_S);
  }, [selectedSolfeggio]);

  // Background-playback watchdog.
  //
  // The music itself plays DIRECT through the <audio> element to the OS (it is
  // deliberately NOT routed through a MediaElementSource — see the DIRECT
  // PLAYBACK note in playTrack), so the element keeps playing even if the
  // AudioContext suspends. But the binaural / solfeggio layers DO run through
  // the AudioContext, so if the browser suspends a backgrounded tab's context —
  // OS audio-focus changes, energy saver, memory pressure — those layers go
  // silent and the analysis/position loop (which is driven off the context)
  // freezes. resume() was previously wired ONLY to user gestures (play/pause,
  // frequency select, track change), so once the context was suspended while
  // the tab sat in the background, nothing brought it back until the user
  // returned and interacted. The silent keep-alive oscillator prevents the
  // *idle* auto-suspend but not this externally-forced one.
  //
  // This watchdog runs only while we intend to be playing. It resumes the
  // context (and re-starts the element if it was paused but not finished)
  // whenever it finds them stopped — driven by the context's own statechange
  // event (immediate), a periodic check (throttled to ~once/min in the
  // background, which is an acceptable recovery latency), and the tab becoming
  // visible again (instant recovery on return). It never calls pause(), so it
  // cannot fight a deliberate user pause — that flips isPlaying false and tears
  // this down.
  useEffect(() => {
    if (!isPlaying) return;
    const ctx = audioCtxRef.current;

    const recover = () => {
      const c = audioCtxRef.current;
      if (c && (c.state === 'suspended' || (c.state as string) === 'interrupted')) {
        c.resume()
          .then(() => {
            // Visible confirmation the background watchdog actually had to step
            // in (the context was suspended while the tab sat in the
            // background). Reuses the existing notification toast.
            setAnalysisNotification('🔊 Audio reconnected after running in the background');
            window.setTimeout(() => setAnalysisNotification(null), 3500);
          })
          .catch(() => {});
      }
      const el = mainAudioRef.current;
      if (el && el.paused && !el.ended && el.src) {
        el.play().catch(() => {});
      }
    };

    ctx?.addEventListener('statechange', recover);
    const watchdog = setInterval(recover, 10000);
    const onVisible = () => { if (!document.hidden) recover(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      ctx?.removeEventListener('statechange', recover);
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isPlaying]);

  // "Ready offline" confirmation. The service worker posts OFFLINE_READY once
  // it finishes caching the full asset set (see sw.js CACHE_URLS handler). We
  // only surface the toast when something new was actually cached (added > 0),
  // so it appears on the first visit and after deploys that add files — not on
  // every steady-state load. Reuses the existing notification toast.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onSWMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'OFFLINE_READY' && event.data.added > 0) {
        // Persist until the user acknowledges it (no auto-fade).
        setOfflineReadyNotice('Aetheria is ready to use offline');
      }
    };
    navigator.serviceWorker.addEventListener('message', onSWMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onSWMessage);
  }, []);



  // Emitted-second gate for the clock below. See the note in updateTime.
  const lastEmittedSecondRef = useRef(-1);

  useEffect(() => {
    const updateTime = () => {
      if (isPlaying && mainAudioRef.current) {
        // Use the audio element's currentTime directly
        const actualTime = mainAudioRef.current.currentTime;
        // setCurrTime used to fire on EVERY animation frame, re-rendering the
        // whole App ~60x/sec. Nothing downstream has sub-second resolution:
        // the readout is formatDuration (whole seconds), the progress bar moves
        // ~0.33%/sec on a five-minute track, the phi phase indicator uses coarse
        // thresholds, and MediaSession would rather not be handed a position
        // update every frame anyway. So only publish when the displayed second
        // actually changes — ~60 renders/sec becomes ~1. The rAF loop itself
        // still runs at frame rate, because the phi volume ramps below need it.
        const second = Math.floor(actualTime);
        if (second !== lastEmittedSecondRef.current) {
          lastEmittedSecondRef.current = second;
          setCurrTime(actualTime);
        }

        // CHANGE 3: Apply phi-based temporal structure for dynamic volume
        if (enablePhiMode && phiTimingEnabled && currDuration > 0 && audioCtxRef.current) {
          const phiVolumes = integratePhiVolumes(volume, binauralVolume, solfeggioVolume, true);
          
          // Get phi-based intensity for current track position
          const phiIntensity = getPhiIntensityMultiplier(actualTime, currDuration);
          
          // Apply dynamic volume adjustments for binaural and solfeggio layers
          if (binauralGainRef.current) {
            binauralGainRef.current.gain.setTargetAtTime(
              phiVolumes.binaural * phiIntensity,
              audioCtxRef.current.currentTime,
              0.3
            );
          }
          
          if (solfeggioGainRef.current) {
            solfeggioGainRef.current.gain.setTargetAtTime(
              phiVolumes.solfeggio * phiIntensity,
              audioCtxRef.current.currentTime,
              0.3
            );
          }
        }
        
        rafRef.current = requestAnimationFrame(updateTime);
      }
    };
    if (isPlaying) rafRef.current = requestAnimationFrame(updateTime);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, enablePhiMode, phiTimingEnabled, currDuration, volume, binauralVolume, solfeggioVolume]);


  // BACKGROUND DURATION ANALYZER
  //
  // This was Θ(n²) over the library and was the single reason a large import
  // wedged the tab. Per batch of 5 it did an O(n) originalPlaylist.find() for
  // each track, then rebuilt BOTH full playlist arrays (n object spreads each,
  // with an inner updates.find() per element), and because `originalPlaylist`
  // sat in its own dependency array its own writes re-fired the effect — so an
  // import paid all of that n/5 times. A 5,000-track library meant ~10M object
  // spreads and 1,000 whole-App re-renders, on top of a hard 50-tracks/second
  // ceiling from batchSize 5 every 100 ms.
  //
  // Three changes: O(1) Map lookups instead of scans, ONE array rebuild per
  // time-boxed flush instead of one per batch, and the library is read through
  // a ref so the effect no longer retriggers itself.
  const flushDurationUpdates = useCallback(() => {
    const updates = durationUpdatesRef.current;
    if (updates.size === 0) return;
    durationUpdatesRef.current = new Map();

    // Returning `prev` unchanged when nothing matched keeps the array identity
    // stable, so a flush that touches only originalPlaylist doesn't needlessly
    // invalidate every memo keyed on playlist.
    const apply = (prev: Song[]) => {
      let changed = false;
      const next = prev.map(s => {
        const d = updates.get(s.id);
        if (d === undefined) return s;
        changed = true;
        return { ...s, duration: d };
      });
      return changed ? next : prev;
    };
    setPlaylist(apply);
    setOriginalPlaylist(apply);
  }, []);

  useEffect(() => {
    if (pendingDurationAnalysis.length === 0) {
      flushDurationUpdates(); // queue drained — land the last partial batch
      if (durationQueueActiveRef.current) {
        durationQueueActiveRef.current = false;
        // One healing sweep now that the queue is empty. Bounded: the rescan
        // only re-queues tracks under MAX_DURATION_ATTEMPTS, and every pass
        // increments the count, so a genuinely unreadable file converges.
        setDurationDrainEpoch(e => e + 1);
      }
      return;
    }
    durationQueueActiveRef.current = true;

    let cancelled = false;

    const processNextBatch = async () => {
       // A deep scan owns the main thread; probing hard alongside it just loses
       // the race and burns retry budget (hence the epoch reset further down).
       const batchSize = isScanning ? DURATION_BATCH_SIZE_SCANNING : DURATION_BATCH_SIZE;
       const processing = pendingDurationAnalysis.slice(0, batchSize);
       const remaining = pendingDurationAnalysis.slice(batchSize);
       const byId = originalSongByIdRef.current;

       await Promise.all(processing.map(async (id) => {
          // Count the attempt up front so the auto-rescan can't re-queue this
          // id in a tight loop even if it resolves to 0 (unreadable file).
          durationAttemptsRef.current.set(id, (durationAttemptsRef.current.get(id) || 0) + 1);
          const song = byId.get(id); // O(1) — was originalPlaylist.find()
          if (song && song.file) {
              const dur = await getAudioDuration(song.file);
              durationUpdatesRef.current.set(id, dur);
          }
       }));

       if (cancelled) return;

       // Flush on a time budget, not per batch: one pair of array rebuilds
       // every ~500 ms instead of one pair per 5 tracks.
       const now = Date.now();
       if (now - lastDurationFlushRef.current >= DURATION_FLUSH_MS || remaining.length === 0) {
         lastDurationFlushRef.current = now;
         flushDurationUpdates();
       }

       setPendingDurationAnalysis(remaining);
    };

    // No artificial gap when idle; keep one while scanning so the probes yield
    // to the (CPU-bound) analysis.
    const timer = setTimeout(processNextBatch, isScanning ? 100 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pendingDurationAnalysis, isScanning, flushDurationUpdates]);

  // AUTO RE-SCAN FOR MISSING DURATIONS
  // Whenever the library changes (import, restore, reorder), re-queue any track
  // still missing a duration — but only ones that have a file and haven't
  // exhausted their retry budget. This heals tracks left on "..." by an
  // unreadable file or (before the timeout fix) a stalled queue, without a
  // re-import. MAX_DURATION_ATTEMPTS bounds the retries, so a genuinely
  // unreadable file converges instead of looping. It runs over
  // originalPlaylist — the whole library — so every generated playlist is
  // covered, not just the one on screen.
  //
  // Deliberately keyed on the library SIZE plus the two epochs, not on the
  // originalPlaylist array identity. Keyed on identity it re-filtered the whole
  // library once per duration batch — another O(n) term inside the import's
  // quadratic loop, for a sweep that only has anything to do when tracks are
  // added/removed (length), when a scan hands back a fresh retry budget
  // (retry epoch), or when the queue has just drained (drain epoch).
  useEffect(() => {
    const stuck: string[] = [];
    for (const s of originalSongByIdRef.current.values()) {
      if ((!s.duration || s.duration === 0) && s.file &&
          (durationAttemptsRef.current.get(s.id) || 0) < MAX_DURATION_ATTEMPTS) {
        stuck.push(s.id);
      }
    }
    if (stuck.length === 0) return;

    setPendingDurationAnalysis(prev => {
      const merged = new Set(prev);
      stuck.forEach(id => merged.add(id));
      return merged.size === prev.length ? prev : Array.from(merged);
    });
  }, [originalPlaylist.length, durationRetryEpoch, durationDrainEpoch]);

  // A deep scan saturates the main thread for minutes at a time, and the
  // duration probes running alongside it are exactly what loses that race —
  // so a scan can burn the entire retry budget on tracks that are perfectly
  // readable. Hand every track a fresh budget once the scan finishes and
  // re-trigger the rescan above, which is when the probes can actually
  // succeed. This is the path that left whole playlists on "...".
  const wasScanningRef = useRef(false);
  useEffect(() => {
    if (wasScanningRef.current && !isScanning) {
      durationAttemptsRef.current.clear();
      setDurationRetryEpoch(e => e + 1);
    }
    wasScanningRef.current = isScanning;
  }, [isScanning]);

  // IMPORT PROGRESS
  // An import's wall-clock is spent in the duration queue, so that queue is
  // what the progress bar should track. Before this, isUploading flipped true
  // and false inside one synchronous tick and uploadProgress never left 0 —
  // a folder of a few thousand files gave the user a dead button and a list of
  // rows reading "..." with no indication anything was happening.
  useEffect(() => {
    let total = durationQueueTotalRef.current;
    const remaining = pendingDurationAnalysis.length;

    if (remaining === 0) {
      if (total !== 0) {
        durationQueueTotalRef.current = 0;
        setUploadProgress(100);
      }
      setIsUploading(false);
      return;
    }

    // The auto-rescan can add to a queue that's already being drained; widen
    // the denominator rather than letting progress run backwards.
    if (remaining > total) {
      total = remaining;
      durationQueueTotalRef.current = remaining;
    }
    // Held below 100 so the number only reads "done" when the queue is empty.
    setUploadProgress(Math.min(99, Math.round(((total - remaining) / total) * 100)));
  }, [pendingDurationAnalysis]);


  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    // Windows reports File.type from the shell registry rather than the file
    // itself, so .flac/.m4a/.ogg routinely arrive with an EMPTY type. The old
    // filter was `type.includes('audio')` with a filename fallback for .wav and
    // .mp3 ONLY — which meant whole formats vanished on import with no message.
    // See isImportableAudio: extension first, MIME as a narrowed backstop. WMA,
    // ALAC and .m3u/.pls playlists are excluded on purpose — Chrome can't decode
    // the first two, and the last aren't tracks at all.
    const fileArray = Array.from(files) as File[];
    const fileList = fileArray.filter(isImportableAudio);
    const skippedCount = fileArray.length - fileList.length;

    // 1. Create Song objects immediately with 0 duration to unblock UI
    const newSongs: Song[] = fileList.map(file => {
        let displayName = file.name.replace(/\.[^/.]+$/, "");
        
        // Clean up Aetheria/WezClarke track names
        if (file.name.includes('_Masterchannel_WezClarke_')) {
            displayName = displayName
                .replace(/_Masterchannel_WezClarke_\d{4}-\d{2}-\d{2}.*$/, '')
                .replace(/_Masterchannel_WezClarke_\d{8}.*$/, '')
                .replace(/\s*-\s*Copy$/, '')
                .trim();
        }
        
        return {
            file: file,
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: displayName,
            duration: 0 // Will be filled in background
        };
    });

    setPlaylist(prev => {
        const updated = [...prev, ...newSongs];
        setOriginalPlaylist(updated);
        return updated;
    });

    // 2. Queue for background analysis. The queue length is also what drives
    //    the import progress readout, so record the total here.
    setPendingDurationAnalysis(prev => {
        const next = [...prev, ...newSongs.map(s => s.id)];
        durationQueueTotalRef.current = next.length;
        return next;
    });

    // isUploading is NOT cleared here. It used to be — set true and false in
    // the same synchronous tick — so the percentage never moved and importing a
    // large folder looked like a frozen tab for minutes while durations filled
    // in behind it. The queue-watcher effect clears it when the work is done.
    if (skippedCount > 0) {
        setAnalysisNotification(
            `Importing ${fileList.length.toLocaleString()} tracks. ` +
            `Skipped ${skippedCount.toLocaleString()} file${skippedCount === 1 ? '' : 's'} ` +
            `that ${skippedCount === 1 ? 'is' : 'are'} not a supported audio format ` +
            `(Chrome can't decode WMA or Apple Lossless).`
        );
    }
    event.target.value = '';
  };

  const scanLibrary = async () => {
    initAudio();
    if (!playlist.length || !audioCtxRef.current) return;
    
    // Calculate time estimate (1-3 minutes per song for thorough analysis)
    const estimatedMinutes = Math.round(playlist.length * 2.5);
    const timeEstimate = estimatedMinutes > 60 
      ? `${Math.round(estimatedMinutes / 60)}h ${estimatedMinutes % 60}m`
      : `${estimatedMinutes}m`;
    
    const notificationMsg = `Starting deep fractal analysis of ${playlist.length} songs. Estimated time: ${timeEstimate}. This will be thorough but slow - you can cancel anytime.`;
    
    setAnalysisNotification(notificationMsg);
    setTimeout(() => setAnalysisNotification(null), 8000);
    
    setIsScanning(true);
    setScanProgress(0);

    const newPlaylist = [...playlist];
    let processedCount = 0;
    let shouldCancel = false;
    const startTime = Date.now();

    // Cancel function
    const cancelScan = () => {
      shouldCancel = true;
      setIsScanning(false);
      setScanProgress(0);
      console.log(`Analysis cancelled after processing ${processedCount}/${newPlaylist.length} files`);
    };

    // Store cancel function for emergency use
    (window as any).cancelAetheriaAnalysis = cancelScan;

    try {
      // Process ONE file at a time for maximum control and stability
      for (let i = 0; i < newPlaylist.length; i++) {
        if (shouldCancel) {
          console.log('Analysis cancelled by user');
          break;
        }

        // Skip already analyzed files
        if (newPlaylist[i].harmonicFreq) {
          processedCount++;
          setScanProgress(Math.round((processedCount / newPlaylist.length) * 100));
          continue;
        }

        console.log(`Analyzing ${i + 1}/${newPlaylist.length}: ${newPlaylist[i].name}`);

        try {
          const file = newPlaylist[i].file;
          
          // Show which file we're processing
          setAnalysisNotification(`Analyzing: ${newPlaylist[i].name} (${i + 1}/${newPlaylist.length})`);
          
          // Decode audio with yielding
          const arrayBuffer = await file.arrayBuffer();
          
          // Small yield after file read
          await new Promise(resolve => setTimeout(resolve, 10));
          
          const audioBuffer = await audioCtxRef.current!.decodeAudioData(arrayBuffer);
          
          // Another yield after decode
          await new Promise(resolve => setTimeout(resolve, 10));

          let freq: number;
          let fractalData: FractalAnalysisResult | null = null;
          
          try {
            // Use the interruptible fractal analysis
            fractalData = await analyzeFractalFrequenciesInterruptible(audioBuffer, () => shouldCancel);
            freq = fractalData.dominantFrequency;
            console.log(`Fractal analysis complete for ${newPlaylist[i].name}: ${freq.toFixed(1)}Hz`);
          } catch (e) {
            console.warn('Fractal analysis failed for', newPlaylist[i].name, 'using basic detection');
            // Yield before fallback
            await new Promise(resolve => setTimeout(resolve, 50));
            freq = await detectDominantFrequency(audioBuffer);
          }

          // DETECTION BOUNDARY — everything above measured the unshifted source
          // buffer; playback runs at PITCH_SHIFT_FACTOR. Convert once, here, so
          // the solfeggio assignment, the deviation, the stored harmonicFreq and
          // the Aetheria check all describe what the listener actually hears.
          // (fractalData's own internal harmonic fields stay source-referenced —
          // they are display detail and do not feed closestSolfeggio.)
          freq = toHeardHz(freq);

          const solfeggio = getHarmonicSolfeggio(freq);
          const deviation = Math.abs(freq - solfeggio);

          // Additive: interval/gap analysis on the FFT peak set. Failures here
          // must not break the primary scan, so we swallow errors and proceed.
          let intervalData: IntervalAnalysisResult | undefined;
          try {
            const peaks = await detectFrequencyPeaks(audioBuffer);
            if (peaks.length >= 2) {
              const full = analyzeIntervals(peaks);
              // Drop the per-interval records before storing on the song.
              // `full.intervals` is an O(n²) array of every frequency-pair
              // record; the app only ever reads coherenceScore, classification,
              // and fingerprint.* (see the INTERVAL/GAP ANALYSIS panel). Keeping
              // the records on every analyzed song was the bulk of the heap
              // growth seen in the snapshot — the fingerprint already carries
              // totalIntervals / aetheriaMatches / harmonicMatches.
              intervalData = { ...full, intervals: [] };
            }
          } catch (intervalErr) {
            console.warn('Interval analysis failed for', newPlaylist[i].name, intervalErr);
          }

          // Additive: pre-compute the per-band energy envelope so the
          // visualizer can track the real song (and never miss a bass drop) at
          // playback time. Failures here must not break the scan.
          let bandEnvelope: BandEnvelope | undefined;
          try {
            bandEnvelope = await analyzeBandEnvelopes(audioBuffer);
          } catch (envErr) {
            console.warn('Band envelope analysis failed for', newPlaylist[i].name, envErr);
          }
          // Yield so the heavy offline renders don't lock the scan UI.
          await new Promise(resolve => setTimeout(resolve, 10));

          newPlaylist[i] = {
            ...newPlaylist[i],
            harmonicFreq: freq,
            closestSolfeggio: solfeggio,
            harmonicDeviation: deviation,
            fractalAnalysis: fractalData,
            intervalAnalysis: intervalData,
            isAetheriaCandidate: couldBeAetheria(freq),
            bandEnvelope,
          };
          
        } catch (e) {
          console.warn("Could not analyze", newPlaylist[i].name, e);
          // Set basic fallback values
          newPlaylist[i] = {
            ...newPlaylist[i],
            harmonicFreq: 440,
            closestSolfeggio: 528,
            harmonicDeviation: 999
          };
        }

        processedCount++;
        
        // Update progress
        const progress = Math.round((processedCount / newPlaylist.length) * 100);
        setScanProgress(progress);
        
        // Calculate time remaining
        const elapsed = Date.now() - startTime;
        const avgTimePerFile = elapsed / processedCount;
        const remaining = (newPlaylist.length - processedCount) * avgTimePerFile;
        const remainingMinutes = Math.round(remaining / 60000);
        
        console.log(`Progress: ${progress}% (${processedCount}/${newPlaylist.length}), Est. remaining: ${remainingMinutes}m`);
        
        // Update playlist progressively so user sees results
        setPlaylist([...newPlaylist]);
        
        // Longer yield between files to prevent browser stress
        // Scale the delay based on library size (bigger libraries = longer breaks)
        const breakTime = Math.min(1000, Math.max(200, newPlaylist.length * 5));
        await new Promise(resolve => setTimeout(resolve, breakTime));
      }

    } catch (error) {
      console.error('Scan library error:', error);
      const elapsed = Math.round((Date.now() - startTime) / 60000);
      alert(`Analysis encountered an error after ${elapsed} minutes. Processed ${processedCount}/${newPlaylist.length} files. Partial results have been saved.`);
    } finally {
      // Clean up
      delete (window as any).cancelAetheriaAnalysis;
      setAnalysisNotification(null);
      
      setPlaylist(newPlaylist);
      setOriginalPlaylist(newPlaylist);
      setIsScanning(false);
      setScanProgress(0);
      
      const totalTime = Math.round((Date.now() - startTime) / 60000);
      console.log(`Analysis complete: ${processedCount}/${newPlaylist.length} files processed in ${totalTime} minutes`);
      
      if (processedCount > 0) {
        // Generate detailed analysis summary
        const analyzedSongs = newPlaylist.filter(s => s.harmonicFreq);
        const octaveRangeStats = getOctaveRangeStatistics(analyzedSongs);
        const regimeStats = getRegimeStatistics(analyzedSongs);
        
        const successMsg = `📊 Extended Octave Range Analysis Complete!\n\n` +
          `⏱️ Processed: ${processedCount}/${newPlaylist.length} files in ${totalTime} minutes\n` +
          `🎵 Frequency Distribution:\n${octaveRangeStats}\n\n` +
          `🧘 Regime Distribution:\n${regimeStats}\n\n` +
          `✨ Ready for harmonic alignment journeys!`;
          
        setAnalysisNotification(successMsg);
        setTimeout(() => setAnalysisNotification(null), 8000);
      }
    }
  };

  // New interruptible fractal analysis function
  const analyzeFractalFrequenciesInterruptible = async (
    audioBuffer: AudioBuffer, 
    shouldCancel: () => boolean
  ): Promise<FractalAnalysisResult> => {
    // Break the analysis into smaller, interruptible chunks
    
    if (shouldCancel()) throw new Error('Analysis cancelled');
    
    // Step 1: Basic frequency detection (fast)
    const basicFreq = await detectDominantFrequency(audioBuffer);
    await new Promise(resolve => setTimeout(resolve, 50)); // Yield
    
    if (shouldCancel()) throw new Error('Analysis cancelled');
    
    // Step 2: Try full fractal analysis with frequent yielding
    try {
      const result = await analyzeFractalFrequencies(audioBuffer);
      return result;
    } catch (e) {
      // If fractal analysis fails, return basic result with improved fallback data
      const safetyAssessment = assessFrequencySafety(basicFreq);
      
      // Provide more realistic fallback values based on frequency
      let goldenRatio = 0.25; // Default 25%
      let pattern111 = 0.15;   // Default 15%
      let dnaResonance = 0.2;  // Default 20%
      
      // Boost scores for common healing frequencies
      const healingFreqs = [174, 285, 396, 417, 528, 639, 741, 852, 963, 111, 222, 333, 444];
      if (healingFreqs.some(freq => Math.abs(basicFreq - freq) < 10)) {
        goldenRatio = Math.min(0.6, goldenRatio + 0.3); // Up to 60% for healing frequencies
        pattern111 = Math.min(0.5, pattern111 + 0.2);   // Up to 50% for healing frequencies  
        dnaResonance = Math.min(0.7, dnaResonance + 0.4); // Up to 70% for healing frequencies
      }
      
      // Special boost for 111Hz pattern frequencies
      if ([111, 222, 333, 444, 555, 666, 777, 888, 999].includes(Math.round(basicFreq))) {
        pattern111 = Math.min(0.8, pattern111 + 0.5); // Up to 80% for exact 111 pattern matches
      }
      
      console.log(`Fallback analysis for ${basicFreq.toFixed(1)}Hz: Golden=${(goldenRatio*100).toFixed(1)}%, 111=${(pattern111*100).toFixed(1)}%, DNA=${(dnaResonance*100).toFixed(1)}%`);
      
      return {
        dominantFrequency: basicFreq,
        harmonicSeries: [basicFreq, basicFreq * 2, basicFreq * 3],
        fractalDimension: 1.5,
        goldenRatioAlignment: goldenRatio,
        pattern111Presence: pattern111,
        dnaResonanceScore: dnaResonance,
        safetyLevel: safetyAssessment.level,
        recommendedVolume: safetyAssessment.volume,
        infiniteOrderHarmonics: [],
        sacredGeometryAlignment: 0.2,
        schumannResonanceHarmony: 0.1
      };
    }
  };

  const generateFilteredPlaylist = (filterFn: (song: Song) => boolean, name: string) => {
      const candidates = originalPlaylist.filter(filterFn);
      if (candidates.length > 0) {
          setPlaylist(candidates);
          setUseChakraOrder(true);
          setCurrentSongIndex(0);
          setSearchTerm(''); // Clear search when creating filtered playlist
          playTrackRef.current(0, candidates);
      } else {
          alert(`No songs found matching '${name}'. Try scanning your library first or add more variety.`);
      }
      if(window.innerWidth < 768) setShowSidebar(false);
  };

  const generateAlignmentJourney = () => {
      const journeyOrder = [174, 285, 396, 417, 528, 639, 741, 852, 963];
      const journeyPlaylist: Song[] = [];
      const usedIds = new Set<string>();

      journeyOrder.forEach(freq => {
          const candidates = originalPlaylist.filter(s => s.closestSolfeggio === freq && !usedIds.has(s.id));
          if (candidates.length > 0) {
              // Enhanced sorting with fractal analysis priority
              candidates.sort((a, b) => {
                  // Prioritize songs with high golden ratio alignment
                  const aGolden = a.fractalAnalysis?.goldenRatioAlignment || 0;
                  const bGolden = b.fractalAnalysis?.goldenRatioAlignment || 0;
                  
                  if (Math.abs(aGolden - bGolden) > 0.1) {
                      return bGolden - aGolden; // Higher golden ratio first
                  }
                  
                  // Then sort by harmonic deviation (accuracy)
                  return (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
              });
              
              const bestMatch = candidates[0];
              journeyPlaylist.push(bestMatch);
              usedIds.add(bestMatch.id);
          }
      });
      
      if (journeyPlaylist.length > 0) {
          setPlaylist(journeyPlaylist);
          // The traditional 9-frequency ascent reuses the walk-overlay
          // infrastructure so the cube draws its path too. Snapshot the
          // playlist ids so the auto-clear effect doesn't drop the badge
          // immediately.
          loShuWalkSnapshotRef.current = journeyPlaylist.map(s => s.id).join('|');
          setLoShuWalkMode('traditional');
          setUseChakraOrder(true);
          setCurrentSongIndex(0);
          setSearchTerm(''); // Clear search when creating aligned playlist
          setVizSettings(prev => ({ ...prev, showTreeOfLife: true }));
          playTrackRef.current(0, journeyPlaylist);
          if(window.innerWidth < 768) setShowSidebar(false);
      } else {
          alert("Not enough analyzed songs. Try scanning library first.");
      }
  };

  // HEART Alignment Journey
  const generateHeartAlignmentJourney = () => {
      // Get all HEART frequency ranges (1206-3150 Hz — Orders 4-6).
      // Upper bound is 3150 inclusive: it is HEART position 9, not a HEAD
      // frequency. A `< 3000` cutoff here previously dropped it into the
      // HEAD journey and left HEART with only 8 of its 9 frequencies.
      const heartFrequencies = SOLFEGGIO_INFO
          .filter(s => s.freq >= 1000 && s.freq <= 3150)
          .map(s => s.freq)
          .sort((a, b) => a - b);
      
      const heartPlaylist: Song[] = [];
      const usedIds = new Set<string>();

      heartFrequencies.forEach(freq => {
          const candidates = originalPlaylist.filter(s => s.closestSolfeggio === freq && !usedIds.has(s.id));
          if (candidates.length > 0) {
              candidates.sort((a, b) => {
                  const aGolden = a.fractalAnalysis?.goldenRatioAlignment || 0;
                  const bGolden = b.fractalAnalysis?.goldenRatioAlignment || 0;
                  
                  if (Math.abs(aGolden - bGolden) > 0.1) {
                      return bGolden - aGolden;
                  }
                  
                  return (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
              });
              
              const bestMatch = candidates[0];
              heartPlaylist.push(bestMatch);
              usedIds.add(bestMatch.id);
          }
      });
      
      if (heartPlaylist.length > 0) {
          setPlaylist(heartPlaylist);
          setUseChakraOrder(true);
          setCurrentSongIndex(0);
          setSearchTerm('');
          setVizSettings(prev => ({ ...prev, showTreeOfLife: true }));
          
          // Check if experience level is appropriate for HEART frequencies
          if (userExperienceLevel === 'beginner') {
              setUserExperienceLevel('intermediate');
              setAnalysisNotification(
                  `HEART Alignment activated. Experience level upgraded to 'Intermediate' for emotional frequency range (${heartFrequencies[0]}-${heartFrequencies[heartFrequencies.length-1]}Hz). Found ${heartPlaylist.length} tracks.`
              );
              setTimeout(() => setAnalysisNotification(null), 5000);
          }
          
          playTrackRef.current(0, heartPlaylist); 
          if(window.innerWidth < 768) setShowSidebar(false);
      } else {
          // Show diagnostic info for HEART frequencies
          const heartMatches = originalPlaylist.filter(s => (s.closestSolfeggio || 0) >= 1206 && (s.closestSolfeggio || 0) <= 3150);
          const foundFreqs = [...new Set(heartMatches.map(s => s.closestSolfeggio).filter(f => f !== undefined) as number[])].sort((a, b) => a - b);
          alert(`HEART Alignment: Found ${heartMatches.length} matching songs.\n\nHEART frequencies detected:\n${foundFreqs.map(f => `${f}Hz: ${originalPlaylist.filter(s => s.closestSolfeggio === f).length} songs`).join('\n')}\n\nTry scanning library first or use the test distribution mode.`);
      }
  };

  // HEAD Alignment Journey  
  const generateHeadAlignmentJourney = () => {
      // Get all HEAD frequency ranges (3504+ Hz — Orders 7-9).
      // Starts at 3504, the first Seventh-order frequency. 3150 belongs to
      // HEART (position 9) and is handled by the HEART journey.
      const headFrequencies = SOLFEGGIO_INFO
          .filter(s => s.freq >= 3504)
          .map(s => s.freq)
          .sort((a, b) => a - b);
      
      const headPlaylist: Song[] = [];
      const usedIds = new Set<string>();

      headFrequencies.forEach(freq => {
          const candidates = originalPlaylist.filter(s => s.closestSolfeggio === freq && !usedIds.has(s.id));
          if (candidates.length > 0) {
              candidates.sort((a, b) => {
                  const aGolden = a.fractalAnalysis?.goldenRatioAlignment || 0;
                  const bGolden = b.fractalAnalysis?.goldenRatioAlignment || 0;
                  
                  if (Math.abs(aGolden - bGolden) > 0.1) {
                      return bGolden - aGolden;
                  }
                  
                  return (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
              });
              
              const bestMatch = candidates[0];
              headPlaylist.push(bestMatch);
              usedIds.add(bestMatch.id);
          }
      });
      
      if (headPlaylist.length > 0) {
          setPlaylist(headPlaylist);
          setUseChakraOrder(true);
          setCurrentSongIndex(0);
          setSearchTerm('');
          setVizSettings(prev => ({ ...prev, showTreeOfLife: true }));
          
          // HEAD frequencies require expert level
          if (userExperienceLevel !== 'expert') {
              setUserExperienceLevel('expert');
              setAnalysisNotification(
                  `HEAD Alignment activated. Experience level upgraded to 'Expert' for transpersonal frequency range (${headFrequencies[0]}-${headFrequencies[headFrequencies.length-1]}Hz). Found ${headPlaylist.length} tracks. Use extreme caution.`
              );
              setTimeout(() => setAnalysisNotification(null), 8000);
          }
          
          playTrackRef.current(0, headPlaylist); 
          if(window.innerWidth < 768) setShowSidebar(false);
      } else {
          // Show diagnostic info for HEAD frequencies
          const headMatches = originalPlaylist.filter(s => (s.closestSolfeggio || 0) >= 3504);
          const foundFreqs = [...new Set(headMatches.map(s => s.closestSolfeggio).filter(f => f !== undefined) as number[])].sort((a, b) => a - b);
          alert(`HEAD Alignment: Found ${headMatches.length} matching songs.\n\nHEAD frequencies detected:\n${foundFreqs.map(f => `${f}Hz: ${originalPlaylist.filter(s => s.closestSolfeggio === f).length} songs`).join('\n')}\n\nTry scanning library first or use the test distribution mode.`);
      }
  };

  // Lo Shu Walk — build a journey playlist whose ordering follows one of
  // the Lo Shu walks. Picker behaviour by mode:
  //   A / B / C / traditional → best unused per freq, never repeats.
  //   combined (CAB, 81 steps) → top-K shuffle per freq, Pillar gets the
  //     deviation peak of each trio; CAB still builds to its peak even
  //     when balanced auto-distribute fills each freq with ~13 candidates.
  //   ouroboros (29 steps) → best unused per freq from the shared pool;
  //     SOURCE (visited 3×) repeats the best match when out of unused, so
  //     the figure-8 always closes. Emits ♾️/✕ phase tokens.
  //   cabi (110 steps) → CAB then Ouroboros, sharing usedIds across both
  //     so the closing Ouroboros doesn't replay songs heard in the CAB
  //     sweep. SOURCE may be visited up to 6 times total; up to 6 distinct
  //     songs play if the library has them, then repeats.
  const generateLoShuWalk = (mode: LoShuWalkMode) => {
      const sequence = LO_SHU_WALKS[mode];
      const info = LO_SHU_WALK_INFO[mode];
      const walkPlaylist: Song[] = [];

      const sortCandidates = (a: Song, b: Song) => {
          const aGolden = a.fractalAnalysis?.goldenRatioAlignment || 0;
          const bGolden = b.fractalAnalysis?.goldenRatioAlignment || 0;
          if (Math.abs(aGolden - bGolden) > 0.1) return bGolden - aGolden;
          const devDiff = (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
          if (Math.abs(devDiff) > 0.1) return devDiff;
          // Final tiebreaker: song id. Auto-distribute often produces many
          // ties at deviation 0 (perfect matches); without this the sort
          // falls back to insertion order and we end up playing songs
          // alphabetically by upload order. Song ids are timestamp+random
          // strings, so this spreads tied songs unpredictably.
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      };

      // Used song IDs accumulated across the whole walk. Shared between
      // pickers so cabi's Ouroboros tail avoids replaying songs heard in
      // its CAB head.
      const usedIds = new Set<string>();
      // Parallel to walkPlaylist — same length, '' for steps with no
      // special phase token. Ouroboros emits ♾️/✕ at the SOURCE visits.
      const walkPhases: string[] = [];

      // LRU comparator — sorts by [lastPlayed ASC, random tiebreaker].
      // Never-played songs (timestamp 0) always come first, in random order
      // among themselves; played songs follow with oldest first. Random
      // tiebreaker preserves the user's "click again for variety" feel
      // when the candidate pool is fresh (all timestamps zero).
      const lruCompare = (a: Song, b: Song): number => {
          const aLast = playHistoryRef.current[a.id] || 0;
          const bLast = playHistoryRef.current[b.id] || 0;
          if (aLast !== bLast) return aLast - bLast;
          return Math.random() - 0.5;
      };

      // Top-K candidate cap for CAB-style pickers. Balanced auto-distribute
      // can place ~13 candidates per freq; the cap keeps shuffle picks
      // among the strongest matches while still giving C(6,3) × 3! = 120
      // possible trio arrangements per freq for the user's "regen" variety.
      const CAB_POOL_SIZE = 6;

      // CAB picker — drives 'combined' and the first 81 steps of 'cabi'.
      // Returns the per-segment counts [Vortex, Ascent, Pillar] so the
      // footer chip can show "Vortex 14/27".
      const runCabPicker = (cabSequence: number[]): [number, number, number] => {
          const uniqueFreqs = Array.from(new Set(cabSequence));
          const passPicks = new Map<number, (Song | undefined)[]>();
          uniqueFreqs.forEach(freq => {
              const allCandidates = originalPlaylist.filter((s: Song) => s.closestSolfeggio === freq);
              if (allCandidates.length === 0) {
                  passPicks.set(freq, [undefined, undefined, undefined]);
                  return;
              }
              // Top-K by quality stays the same — the candidate pool is
              // still the 6 best-matching songs at this freq.
              const candidates = [...allCandidates]
                  .sort(sortCandidates)
                  .slice(0, Math.min(allCandidates.length, CAB_POOL_SIZE));
              const n = candidates.length;
              // Within the top-K pool, pick by LRU instead of pure random.
              // Never-played candidates surface first (random tiebreak keeps
              // the "click again for variety" feel when the pool is fresh);
              // once everyone in the pool has been heard at least once, the
              // 3 longest-not-heard win — guaranteeing rotation through all
              // 6 quality candidates over a few CAB sessions instead of
              // letting random chance favour the same 3 forever.
              const lruOrdered = [...candidates].sort(lruCompare);
              const trio: Song[] = [
                  lruOrdered[0 % n],
                  lruOrdered[1 % n],
                  lruOrdered[2 % n],
              ];
              const sortedTrio = [...trio].sort(sortCandidates);
              // sortedTrio[0] = best, [1] = mid, [2] = weakest
              // Pass 0 (Vortex / C) → mid
              // Pass 1 (Ascent / A) → weakest
              // Pass 2 (Pillar / B) → best
              passPicks.set(freq, [sortedTrio[1], sortedTrio[2], sortedTrio[0]]);
          });

          // cabSequence = C (0..26) + A (27..53) + B (54..80).
          //   Pass 0 = Vortex (C), Pass 1 = Ascent (A), Pass 2 = Pillar (B).
          const segmentCounts: [number, number, number] = [0, 0, 0];
          cabSequence.forEach((freq, i) => {
              const pass = Math.floor(i / 27);
              const pick = passPicks.get(freq)?.[pass];
              if (pick) {
                  walkPlaylist.push(pick);
                  walkPhases.push('');
                  usedIds.add(pick.id);
                  segmentCounts[pass]++;
              }
          });
          return segmentCounts;
      };

      // Ouroboros picker — best-unused-per-freq from the shared usedIds.
      // When a freq has no unused songs left (typical at the 2nd/3rd
      // SOURCE visit), it REPEATS the best match instead of skipping —
      // this is the spec's "do not deduplicate" rule made concrete. The
      // figure-8's three crossings at SOURCE always produce a playlist
      // entry. Emits ♾️/✕ tokens into walkPhases at SOURCE visits.
      const runOuroborosPicker = (ouroSequence: number[]): number => {
          let pushed = 0;
          let sourceVisit = 0;
          ouroSequence.forEach(freq => {
              const allCandidates = originalPlaylist.filter((s: Song) => s.closestSolfeggio === freq);
              if (allCandidates.length === 0) return; // no songs at all → skip
              // Unused-at-this-freq sorted LRU first, quality second.
              // Means the figure-8's traversal naturally cycles through
              // the user's library at each freq across sessions, instead
              // of always picking the same deviation-best song first.
              const unused = allCandidates
                  .filter((s: Song) => !usedIds.has(s.id))
                  .sort((a: Song, b: Song) => {
                      const cmp = lruCompare(a, b);
                      return cmp !== 0 ? cmp : sortCandidates(a, b);
                  });
              let pick: Song;
              if (unused.length > 0) {
                  pick = unused[0];
                  usedIds.add(pick.id);
              } else {
                  // Fresh pool exhausted at this freq — repeat the best
                  // match. Intentional at the three SOURCE visits when
                  // the library has fewer distinct SOURCE songs than the
                  // walk requires.
                  pick = [...allCandidates].sort(sortCandidates)[0];
              }
              walkPlaylist.push(pick);
              let phase = '';
              if (freq === SOURCE_FREQ) {
                  phase = OUROBOROS_PHASES[sourceVisit] ?? '';
                  sourceVisit++;
              }
              walkPhases.push(phase);
              pushed++;
          });
          return pushed;
      };

      if (mode === 'combined') {
          const cabCounts = runCabPicker(sequence);
          setLoShuWalkSegments([...cabCounts]);
          setLoShuWalkPhases(null);
      } else if (mode === 'ouroboros') {
          const oCount = runOuroborosPicker(sequence);
          setLoShuWalkSegments([oCount]);
          setLoShuWalkPhases([...walkPhases]);
      } else if (mode === 'cabi') {
          // CABI = CAB (81 steps) + Ouroboros (29 steps), shared usedIds
          // so the closing Ouroboros doesn't replay songs heard in CAB.
          const cabCounts = runCabPicker(LO_SHU_WALK_COMBINED);
          const oCount = runOuroborosPicker(LO_SHU_WALK_OUROBOROS);
          setLoShuWalkSegments([cabCounts[0], cabCounts[1], cabCounts[2], oCount]);
          setLoShuWalkPhases([...walkPhases]);
      } else {
          setLoShuWalkSegments(null);
          setLoShuWalkPhases(null);
          // Single walks (A / B / C / traditional): best unused per freq.
          sequence.forEach(freq => {
              const candidates = originalPlaylist
                  .filter((s: Song) => s.closestSolfeggio === freq && !usedIds.has(s.id))
                  .sort(sortCandidates);
              if (candidates.length > 0) {
                  const bestMatch = candidates[0];
                  walkPlaylist.push(bestMatch);
                  usedIds.add(bestMatch.id);
              }
          });
      }

      if (walkPlaylist.length > 0) {
          setPlaylist(walkPlaylist);
          loShuWalkSnapshotRef.current = walkPlaylist.map(s => s.id).join('|');
          setLoShuWalkMode(mode);
          setUseChakraOrder(true);
          setCurrentSongIndex(0);
          setSearchTerm('');
          setVizSettings(prev => ({ ...prev, showTreeOfLife: true }));
          setShowLoShuWalkMenu(false);

          // Walks reach into HEART/HEAD; nudge experience level the same way
          // the existing HEART/HEAD alignment journeys do so safety messaging
          // stays consistent.
          if (userExperienceLevel === 'beginner') setUserExperienceLevel('intermediate');

          setAnalysisNotification(
              `Lo Shu · ${info.fullName} — ${walkPlaylist.length}/${sequence.length} positions filled.` +
              ((mode === 'combined' || mode === 'cabi') ? ' Click again for a different shuffle.' : '')
          );
          setTimeout(() => setAnalysisNotification(null), 5000);

          playTrackRef.current(0, walkPlaylist);
          if (window.innerWidth < 768) setShowSidebar(false);
      } else {
          alert(
              `Lo Shu · ${info.fullName}: no matching songs in your library yet.\n\n` +
              `This walk needs songs whose closest Solfeggio frequency matches positions in the 27-frequency Aetheria set. ` +
              `Try running Deep Scan, or load tracks across the GUT/HEART/HEAD ranges.`
          );
      }
  };

  // Clear the active Lo Shu walk indicator without otherwise touching the
  // playlist. Called by other journey generators (alignment, mood, etc.) so
  // the walk badge doesn't linger after the user starts a different journey.
  const clearLoShuWalkMode = () => {
      setLoShuWalkMode(null);
      setLoShuWalkSegments(null);
      setLoShuWalkPhases(null);
  };

  // Single deliberate action behind the "Clear Playlist & Cache" button: stop
  // playback, tear down the current audio source + object URLs, wipe all
  // in-memory playlist state, and clear the IndexedDB cache so nothing is
  // restored on the next load.
  const clearEntirePlaylist = useCallback(async () => {
    // Stop playback.
    setIsPlaying(false);
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {}
      sourceNodeRef.current = null;
    }

    // Detach and revoke every cached object URL so blobs can be GC'd.
    if (mainAudioRef.current) {
      try { mainAudioRef.current.pause(); } catch {}
      mainAudioRef.current.src = '';
    }
    Object.values(blobUrlsRef.current).forEach((url: string) => {
      try { URL.revokeObjectURL(url); } catch {}
    });
    blobUrlsRef.current = {};

    // Wipe in-memory playlist state.
    setPlaylist([]);
    setOriginalPlaylist([]);
    // filteredPlaylist derives from playlist, so emptying that empties it too.
    setCurrentSongIndex(-1);
    clearLoShuWalkMode();

    // Wipe the on-disk cache.
    await clearPlaylistCache();

    console.log('[Aetheria] Playlist and cache cleared');
  }, []);

  // Generate full library alignment ordered by frequency
  const generateFullLibraryAlignment = () => {
      // Get all frequency values from SOLFEGGIO_INFO in order
      const frequencyOrder = SOLFEGGIO_INFO.map(info => info.freq);
      const alignedPlaylist: Song[] = [];
      
      // Sort songs by frequency order, then by harmonic deviation (quality)
      frequencyOrder.forEach(freq => {
          const songsForFreq = originalPlaylist
              .filter(s => s.closestSolfeggio === freq)
              .sort((a, b) => (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999));
          
          alignedPlaylist.push(...songsForFreq);
      });
      
      if (alignedPlaylist.length > 0) {
          setPlaylist(alignedPlaylist);
          setUseChakraOrder(true);
          setCurrentSongIndex(0);
          setSearchTerm(''); // Clear search when creating aligned playlist
          setVizSettings(prev => ({ ...prev, showTreeOfLife: true }));
          
          // Check if we have high frequency tracks and adjust settings accordingly
          const hasHighFrequencies = alignedPlaylist.some(s => (s.closestSolfeggio || 0) >= 1206);
          if (hasHighFrequencies && userExperienceLevel === 'beginner') {
              setUserExperienceLevel('intermediate');
              setAnalysisNotification(
                  `Full Alignment includes higher frequency tracks. Experience level temporarily set to 'Intermediate' for proper playback.`
              );
              setTimeout(() => setAnalysisNotification(null), 5000);
          }
          
          if(window.innerWidth < 768) setShowSidebar(false);
      } else {
          alert("No analyzed songs found. Please scan your library first.");
      }
  };

  // Generate specific frequency playlists
  const generateFrequencyPlaylist = (frequencies: number[], name: string) => {
      const filtered = originalPlaylist
          .filter(s => frequencies.includes(s.closestSolfeggio || 0))
          .sort((a, b) => {
              const freqIndexA = frequencies.indexOf(a.closestSolfeggio || 0);
              const freqIndexB = frequencies.indexOf(b.closestSolfeggio || 0);
              if (freqIndexA !== freqIndexB) return freqIndexA - freqIndexB;
              return (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
          });
      
      if (filtered.length > 0) {
          setPlaylist(filtered);
          setUseChakraOrder(true);
          setCurrentSongIndex(0);
          setSearchTerm(''); // Clear search when creating filtered playlist
          if(window.innerWidth < 768) setShowSidebar(false);
      } else {
          alert(`No songs found for ${name}. Try scanning your library first or add more variety.`);
      }
  };

  const generateWellnessPlaylist = () => {
    generateFrequencyPlaylist([174, 285, 528], 'Deep Healing');
  };

  const generateMoodPlaylist = () => {
    generateFrequencyPlaylist([396, 417, 639], 'Mood Elevation');
  };

  const generateMeditationPlaylist = () => {
    generateFrequencyPlaylist([741, 852, 963], 'Deep Meditation');
  };

  const generateGoldenRatioPlaylist = () => {
    // Debug: Log fractal analysis values for all tracks
    console.log('=== GOLDEN RATIO PLAYLIST DEBUG ===');
    originalPlaylist.forEach(song => {
      if (song.fractalAnalysis) {
        console.log(`${song.name}: Golden Ratio = ${(song.fractalAnalysis.goldenRatioAlignment * 100).toFixed(1)}%`);
      } else {
        console.log(`${song.name}: No fractal analysis data`);
      }
    });

    // Lowered threshold from 0.7 to 0.3 (30%) for more realistic filtering
    const goldenTracks = originalPlaylist
      .filter(s => s.fractalAnalysis && s.fractalAnalysis.goldenRatioAlignment > 0.3)
      .sort((a, b) => (b.fractalAnalysis?.goldenRatioAlignment || 0) - (a.fractalAnalysis?.goldenRatioAlignment || 0));
    
    console.log(`Found ${goldenTracks.length} tracks with golden ratio alignment > 30%`);
    
    if (goldenTracks.length > 0) {
      setPlaylist(goldenTracks);
      setUseChakraOrder(false);
      setCurrentSongIndex(0);
      setSearchTerm('');
      if(window.innerWidth < 768) setShowSidebar(false);
    } else {
      alert(`No tracks with golden ratio alignment > 30% found.\n\nActual analysis results:\n${originalPlaylist.slice(0, 5).map(s => `• ${s.name}: ${s.fractalAnalysis ? (s.fractalAnalysis.goldenRatioAlignment * 100).toFixed(1) : 'No analysis'}%`).join('\n')}\n\nTry scanning your library with fractal analysis first.`);
    }
  };

  const generate111PatternPlaylist = () => {
    // Composition of the first in sequence of each solfeggio order based on 111 Hz pattern presence
    console.log('=== 111 PATTERN SOLFEGGIO SEQUENCE COMPOSITION ===');
    
    // Define the solfeggio orders and their first frequencies - ALL 9 ORDERS
    const solfeggioOrders = [
      { order: 'First', frequencies: [174, 285] },
      { order: 'Second', frequencies: [396, 417, 528, 639] },
      { order: 'Third', frequencies: [741, 852, 963] },
      { order: 'Fourth', frequencies: [1206, 1449, 1692] },
      { order: 'Fifth', frequencies: [1935, 2178, 2421] },
      { order: 'Sixth', frequencies: [2664, 2907, 3150] },
      { order: 'Seventh', frequencies: [3504, 3858, 4212] },
      { order: 'Eighth', frequencies: [4566, 4920, 5274] },
      { order: 'Ninth', frequencies: [5628, 5982, 6336] }
    ];

    const compositionPlaylist: Song[] = [];
    const usedIds = new Set<string>();

    // For each order, find the best song with the highest 111 pattern presence from the first frequency
    solfeggioOrders.forEach(orderGroup => {
      const firstFrequency = orderGroup.frequencies[0]; // Get the first frequency of each order
      
      // Find songs that match this frequency and have 111 pattern presence
      const candidatesForOrder = originalPlaylist.filter(song => {
        if (!song.fractalAnalysis || usedIds.has(song.id)) return false;
        return song.closestSolfeggio === firstFrequency;
      });

      if (candidatesForOrder.length > 0) {
        // Sort by 111 pattern presence, then by DNA resonance, then by harmonic accuracy
        candidatesForOrder.sort((a, b) => {
          const a111 = a.fractalAnalysis?.pattern111Presence || 0;
          const b111 = b.fractalAnalysis?.pattern111Presence || 0;
          
          // Prioritize 111 pattern presence
          if (Math.abs(a111 - b111) > 0.05) {
            return b111 - a111;
          }
          
          // Then DNA resonance as a tiebreaker
          const aDNA = a.fractalAnalysis?.dnaResonanceScore || 0;
          const bDNA = b.fractalAnalysis?.dnaResonanceScore || 0;
          
          if (Math.abs(aDNA - bDNA) > 0.05) {
            return bDNA - aDNA;
          }
          
          // Finally by harmonic accuracy
          return (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
        });

        const bestTrack = candidatesForOrder[0];
        compositionPlaylist.push(bestTrack);
        usedIds.add(bestTrack.id);
        
        const pattern111Strength = (bestTrack.fractalAnalysis?.pattern111Presence || 0) * 100;
        console.log(`${orderGroup.order} Order (${firstFrequency}Hz): "${bestTrack.name}" - 111 Pattern: ${pattern111Strength.toFixed(1)}%`);
      } else {
        console.log(`${orderGroup.order} Order (${firstFrequency}Hz): No suitable tracks found`);
      }
    });

    console.log(`111 Pattern Composition: ${compositionPlaylist.length} tracks selected from ${solfeggioOrders.length} orders`);
    
    if (compositionPlaylist.length > 0) {
      setPlaylist(compositionPlaylist);
      setUseChakraOrder(true); // Maintain order sequence
      setCurrentSongIndex(0);
      setSearchTerm('');
      
      // Auto-set to 111Hz for resonant pattern alignment
      setSelectedSolfeggio(111);
      
      // Enable Tree of Life visualization for order progression
      setVizSettings(prev => ({ 
        ...prev, 
        showTreeOfLife: true,
        morphEnabled: true,
        colorMode: 'chakra',
        enableFlow: true,
        autoRotate: true
      }));
      
      // Check for transpersonal frequencies and adjust settings accordingly
      const hasTranspersonalFrequencies = compositionPlaylist.some(s => (s.closestSolfeggio || 0) >= 3786);
      if (hasTranspersonalFrequencies && userExperienceLevel !== 'expert') {
        setUserExperienceLevel('expert');
        setAnalysisNotification(
          `111 Pattern Sequence includes transpersonal frequencies (8th-9th Orders). Experience level set to 'Expert' for proper access. Use extreme caution with frequencies above 3675Hz.`
        );
        setTimeout(() => setAnalysisNotification(null), 8000);
      }
      
      // Provide detailed feedback about the composition
      const ordersCovered = compositionPlaylist.length;
      const avg111Pattern = compositionPlaylist.reduce((sum, song) => 
        sum + (song.fractalAnalysis?.pattern111Presence || 0), 0) / compositionPlaylist.length * 100;
      
      // Create frequency progression display
      const frequencyProgression = compositionPlaylist.map((s, i) => {
        const freq = solfeggioOrders[i]?.frequencies[0];
        if (freq && freq >= 3786) {
          return `${freq}Hz⚠️`; // Add warning symbol for transpersonal frequencies
        }
        return `${freq}Hz`;
      }).join('→');
      
      setTimeout(() => {
        const safetyNote = hasTranspersonalFrequencies ? ' ⚠️ CAUTION: Contains transpersonal frequencies - use minimal volume.' : '';
        setAnalysisNotification(
          `111 Pattern Complete Journey activated! ${ordersCovered}/9 orders represented (${frequencyProgression}). Average 111 pattern strength: ${avg111Pattern.toFixed(1)}%.${safetyNote}`
        );
        setTimeout(() => setAnalysisNotification(null), 10000);
      }, hasTranspersonalFrequencies ? 8500 : 500);
      
      if(window.innerWidth < 768) setShowSidebar(false);
    } else {
      // Show diagnostic information
      const analyzedTracks = originalPlaylist.filter(s => s.fractalAnalysis).length;
      const orderAvailability = solfeggioOrders.map(order => {
        const freq = order.frequencies[0];
        const count = originalPlaylist.filter(s => s.closestSolfeggio === freq).length;
        return `${order.order} (${freq}Hz): ${count} tracks`;
      }).join('\n');
      
      alert(`Unable to create 111 Pattern Solfeggio Sequence.\n\n` +
            `Requirements: At least one analyzed track from each order's first frequency:\n\n` +
            `${orderAvailability}\n\n` +
            `Total analyzed tracks: ${analyzedTracks}\n\n` +
            `Try scanning your library with fractal analysis to enable this composition feature.`);
    }
  };

  // SOURCE Field Filter — 2178 Hz, HEART position 5 and the geometric centre
  // of the Lo Shu cube. Every row, column, diagonal and the central vertical
  // axis (528 → 2178 → 4920) intersects here, so tracks are ranked by
  // sacredGeometryAlignment (φ, √2, √3, √5, π, e ratios) rather than by
  // dnaResonanceScore — the DNA metric weights 528 Hz at 3× and would rank
  // 2178 Hz tracks by their 528 Hz content.
  //
  // Ranking degrades gracefully: sacredGeometryAlignment only carries real
  // values for tracks analysed AFTER the normalisation fix in
  // calculateSacredGeometryAlignment, so goldenRatioAlignment (already
  // peak-normalised, and φ is the first sacred ratio) breaks the ties on
  // older cached analyses. Neither score gates membership.
  const generateSourceFieldPlaylist = () => {
    // Strict 2178Hz resonance filter - only the pure 2178Hz frequency
    console.log('=== STRICT 2178Hz SOURCE FIELD FILTER ===');
    originalPlaylist.forEach(song => {
      if (song.fractalAnalysis && song.closestSolfeggio === 2178) {
        const geometryScore = song.fractalAnalysis.sacredGeometryAlignment * 100;
        const goldenScore = song.fractalAnalysis.goldenRatioAlignment * 100;
        console.log(`${song.name}: Geometry=${geometryScore.toFixed(1)}% | Golden=${goldenScore.toFixed(1)}% | 2178Hz=true | Accuracy=${song.harmonicDeviation?.toFixed(1) || 'N/A'}Hz`);
      }
    });

    // STRICT filtering: ONLY 2178Hz tracks that carry fractal analysis.
    // Deliberately NOT gated on a score being > 0: sacredGeometryAlignment is
    // 0 for every track analysed before the normalisation fix in
    // calculateSacredGeometryAlignment, so gating on it emptied the playlist
    // even when 2178Hz matches existed. Frequency match + analysed is the real
    // requirement; the scores below decide ORDER, not membership.
    const pure2178Tracks = originalPlaylist
      .filter(song => {
        // Must be exactly 2178Hz frequency match
        if (song.closestSolfeggio !== 2178) return false;

        // Must have fractal analysis data
        return Boolean(song.fractalAnalysis);
      })
      .sort((a, b) => {
        // Sort by sacred geometry alignment (highest first)
        const aGeometry = a.fractalAnalysis?.sacredGeometryAlignment || 0;
        const bGeometry = b.fractalAnalysis?.sacredGeometryAlignment || 0;

        if (Math.abs(aGeometry - bGeometry) > 0.01) {
          return bGeometry - aGeometry;
        }

        // Fall back to golden ratio alignment — φ is the first of the sacred
        // ratios and this metric normalises against the spectrum's own peak,
        // so it yields real values on tracks analysed before the fix. Keeps
        // the ordering meaningful without forcing a full library re-scan.
        const aGolden = a.fractalAnalysis?.goldenRatioAlignment || 0;
        const bGolden = b.fractalAnalysis?.goldenRatioAlignment || 0;

        if (Math.abs(aGolden - bGolden) > 0.01) {
          return bGolden - aGolden;
        }

        // Then by harmonic accuracy (closest to pure 2178Hz)
        const aAccuracy = a.harmonicDeviation || 999;
        const bAccuracy = b.harmonicDeviation || 999;

        return aAccuracy - bAccuracy;
      });

    console.log(`Found ${pure2178Tracks.length} pure 2178Hz tracks for SOURCE field playlist`);

    if (pure2178Tracks.length > 0) {
      setPlaylist(pure2178Tracks);
      setUseChakraOrder(false);
      setCurrentSongIndex(0);
      setSearchTerm('');

      // Auto-set to 2178Hz for optimal SOURCE field resonance
      setSelectedSolfeggio(2178);

      // NOTE: missing track durations are no longer repaired here. That was a
      // stopgap scoped to this one filter; the retry budget in
      // MAX_DURATION_ATTEMPTS plus the post-scan reset now heals every
      // playlist from the auto-rescan effect, so this generator does not need
      // to special-case itself.

      // Enable visualization features optimized for 2178Hz SOURCE field work
      setVizSettings(prev => ({
        ...prev,
        morphEnabled: true,
        showTreeOfLife: true,
        colorMode: 'chakra',
        enableFlow: true,
        showHexagons: true,
        hexOpacity: 0.7
      }));

      // Calculate quality metrics for user feedback. Report whichever
      // alignment score actually carries data: sacredGeometryAlignment reads 0
      // across the board on pre-fix analyses, and quoting "0.0%" would look
      // like a broken playlist rather than a stale metric.
      const avgGeometryScore = pure2178Tracks.reduce((sum, song) =>
        sum + (song.fractalAnalysis?.sacredGeometryAlignment || 0), 0) / pure2178Tracks.length;

      const avgGoldenScore = pure2178Tracks.reduce((sum, song) =>
        sum + (song.fractalAnalysis?.goldenRatioAlignment || 0), 0) / pure2178Tracks.length;

      const usingGeometry = avgGeometryScore > 0;
      const rankedBy = usingGeometry ? 'sacred geometry' : 'golden ratio';
      const avgRankScore = usingGeometry ? avgGeometryScore : avgGoldenScore;

      const highQualityTracks = pure2178Tracks.filter(s =>
        ((usingGeometry ? s.fractalAnalysis?.sacredGeometryAlignment : s.fractalAnalysis?.goldenRatioAlignment) || 0) > 0.3).length;

      const avgAccuracy = pure2178Tracks.reduce((sum, song) =>
        sum + (song.harmonicDeviation || 0), 0) / pure2178Tracks.length;

      // 2178Hz is a HEART frequency, so apply the same experience-level
      // guard the HEART Alignment journey uses.
      if (userExperienceLevel === 'beginner') {
        setUserExperienceLevel('intermediate');
      }

      setTimeout(() => {
        setAnalysisNotification(
          `Pure 2178Hz SOURCE Field Filter activated! ${pure2178Tracks.length} tracks found. Average ${rankedBy} alignment: ${(avgRankScore * 100).toFixed(1)}%, ${highQualityTracks} high-alignment tracks, avg accuracy: ±${avgAccuracy.toFixed(1)}Hz from pure 2178Hz.${usingGeometry ? '' : ' (Re-scan to rank by sacred geometry.)'}`
        );
        setTimeout(() => setAnalysisNotification(null), 8000);
      }, 500);

      if(window.innerWidth < 768) setShowSidebar(false);
    } else {
      const tracksWith2178 = originalPlaylist.filter(s => s.closestSolfeggio === 2178).length;
      const analyzedTracks = originalPlaylist.filter(s => s.fractalAnalysis).length;
      const unanalyzedTracks = originalPlaylist.length - analyzedTracks;

      alert(`No pure 2178Hz tracks found for SOURCE field filter.\n\n` +
            `Current library status:\n` +
            `• Total tracks: ${originalPlaylist.length}\n` +
            `• Analyzed tracks: ${analyzedTracks}\n` +
            `• Unanalyzed tracks: ${unanalyzedTracks}\n` +
            `• 2178Hz frequency matches: ${tracksWith2178}\n\n` +
            `To use this filter:\n` +
            `1. Import music containing 2178Hz content\n` +
            `2. Run "Deep Scan" to analyze harmonic frequencies\n` +
            `3. This filter requires exact 2178Hz frequency matches\n\n` +
            `Note: This filter only shows tracks that are harmonically centered on pure 2178Hz — HEART position 5, the centre of the Lo Shu cube.`);
    }
  };

  // Show detailed frequency analysis for current track
  const showCurrentTrackAnalysis = () => {
    const currentSong = playlist[currentSongIndex];
    
    if (!currentSong) {
      alert('No track currently selected for analysis.');
      return;
    }
    
    let analysisInfo = `🎵 EXTENDED OCTAVE RANGE ANALYSIS\n\n`;
    analysisInfo += `📀 Track: "${currentSong.name}"\n\n`;
    
    if (currentSong.harmonicFreq) {
      const report = getFrequencyAnalysisReport(
        currentSong.harmonicFreq,
        currentSong.closestSolfeggio || 396,
        currentSong.harmonicDeviation || 0
      );
      analysisInfo += report;
      
      // Add fractal analysis if available
      if (currentSong.fractalAnalysis) {
        analysisInfo += `\n🧬 ADVANCED FRACTAL ANALYSIS:\n`;
        analysisInfo += `• Golden Ratio Alignment: ${Math.round(currentSong.fractalAnalysis.goldenRatioAlignment * 100)}%\n`;
        analysisInfo += `• 111Hz Pattern Presence: ${Math.round(currentSong.fractalAnalysis.pattern111Presence * 100)}%\n`;
        analysisInfo += `• DNA Resonance Score: ${Math.round(currentSong.fractalAnalysis.dnaResonanceScore * 100)}%\n`;
        analysisInfo += `• Safety Level: ${currentSong.fractalAnalysis.safetyLevel}\n`;
        analysisInfo += `• Recommended Volume: ${Math.round(currentSong.fractalAnalysis.recommendedVolume * 100)}%\n`;
        analysisInfo += `• Sacred Geometry Alignment: ${Math.round(currentSong.fractalAnalysis.sacredGeometryAlignment * 100)}%\n`;
        analysisInfo += `• Schumann Resonance Harmony: ${Math.round(currentSong.fractalAnalysis.schumannResonanceHarmony * 100)}%\n`;
        
        if (currentSong.fractalAnalysis.infiniteOrderHarmonics.length > 0) {
          analysisInfo += `\n🌀 DETECTED HARMONICS (first 10):\n`;
          const harmonics = currentSong.fractalAnalysis.infiniteOrderHarmonics.slice(0, 10);
          analysisInfo += harmonics.map(h => `${h.toFixed(1)}Hz`).join(', ') + '\n';
        }
      }

      if (currentSong.intervalAnalysis) {
        const ia = currentSong.intervalAnalysis;
        analysisInfo += `\n🌊 INTERVAL / GAP ANALYSIS:\n`;
        analysisInfo += `• Coherence Score: ${ia.coherenceScore}/100\n`;
        analysisInfo += `• Classification: ${classificationLabel(ia.classification)}\n`;
        analysisInfo += `• 3-6-9 Ratio: ${Math.round(ia.fingerprint.ratio369 * 100)}%\n`;
        analysisInfo += `• Aetheria Intervals: ${ia.fingerprint.aetheriaMatches}/${ia.fingerprint.totalIntervals}\n`;
        analysisInfo += `• Harmonic Ratios: ${ia.fingerprint.harmonicMatches}/${ia.fingerprint.totalIntervals}\n`;
      }

      if (currentSong.isAetheriaCandidate !== undefined) {
        analysisInfo += `\n🎯 AETHERIA CANDIDATE: ${currentSong.isAetheriaCandidate
          ? 'YES — dominant frequency is itself an Aetheria number'
          : 'No — matched via harmonic relationship'}\n`;
      }
      
      // Add recommendations
      analysisInfo += `\n💡 RECOMMENDATIONS:\n`;
      const regime = getFrequencyRegime(currentSong.closestSolfeggio || 396);
      
      if (regime === 'GUT') {
        analysisInfo += `• Safe for extended listening\n`;
        analysisInfo += `• Good for meditation and healing\n`;
        analysisInfo += `• Can be used at comfortable volume\n`;
      } else if (regime === 'HEART') {
        analysisInfo += `• Use subtle resonance mode\n`;
        analysisInfo += `• Keep volume low (feeling vs hearing)\n`;
        analysisInfo += `• Limit sessions to 20-30 minutes\n`;
        analysisInfo += `• Good for emotional and energetic work\n`;
      } else {
        analysisInfo += `⚠️ EXPERT LEVEL FREQUENCY\n`;
        analysisInfo += `• Requires advanced experience\n`;
        analysisInfo += `• Use minimal volume (5-10%)\n`;
        analysisInfo += `• Limit to 5-15 minute sessions\n`;
        analysisInfo += `• Stop if any discomfort occurs\n`;
      }
    } else {
      analysisInfo += `❌ This track has not been analyzed yet.\n\n`;
      analysisInfo += `To analyze this track:\n`;
      analysisInfo += `1. Use the "Deep Scan" button to analyze your library\n`;
      analysisInfo += `2. Or wait for background analysis to complete\n`;
    }
    
    alert(analysisInfo);
  };

  // Diagnostic function to show fractal analysis status
  const showPlaylistDiagnostics = () => {
    const totalTracks = originalPlaylist.length;
    const analyzedTracks = originalPlaylist.filter(s => s.closestSolfeggio).length;
    const unanalyzedTracks = totalTracks - analyzedTracks;
    
    // Count tracks by regime
    const gutTracks = originalPlaylist.filter(s => (s.closestSolfeggio || 0) >= 174 && (s.closestSolfeggio || 0) <= 963).length;
    const heartTracks = originalPlaylist.filter(s => (s.closestSolfeggio || 0) >= 1206 && (s.closestSolfeggio || 0) <= 3150).length;
    const headTracks = originalPlaylist.filter(s => (s.closestSolfeggio || 0) >= 3504).length;
    
    // Get frequency distribution
    const frequencies = originalPlaylist.map(s => s.closestSolfeggio).filter(f => typeof f === 'number') as number[];
    const frequencyDistribution = [...new Set(frequencies)].sort((a, b) => a - b);
    const frequencyCounts = frequencyDistribution.map(f => `${f}Hz: ${originalPlaylist.filter(s => s.closestSolfeggio === f).length} tracks`);
    
    const goldenTracks = originalPlaylist.filter(s => s.fractalAnalysis && s.fractalAnalysis.goldenRatioAlignment > 0.3).length;
    const pattern111Tracks = originalPlaylist.filter(s => s.fractalAnalysis && s.fractalAnalysis.pattern111Presence > 0.2).length;
    const dnaTracks = originalPlaylist.filter(s => s.fractalAnalysis && s.fractalAnalysis.dnaResonanceScore > 0.3).length;
    
    const diagnosticMessage = `🔬 PLAYLIST DIAGNOSTICS\n\n` +
      `📊 ANALYSIS STATUS:\n` +
      `• Total tracks: ${totalTracks}\n` +
      `• Analyzed tracks: ${analyzedTracks}\n` +
      `• Unanalyzed tracks: ${unanalyzedTracks}\n\n` +
      `🎯 REGIME DISTRIBUTION:\n` +
      `• GUT (174-963 Hz): ${gutTracks} tracks\n` +
      `• HEART (1206-3150 Hz): ${heartTracks} tracks\n` +
      `• HEAD (3504+ Hz): ${headTracks} tracks\n\n` +
      `🎵 FREQUENCY BREAKDOWN:\n` +
      `${frequencyCounts.slice(0, 15).join('\n')}\n` +
      `${frequencyCounts.length > 15 ? `\n...and ${frequencyCounts.length - 15} more frequencies` : ''}\n\n` +
      `🎵 ADVANCED ANALYSIS:\n` +
      `• Golden Ratio tracks (>30%): ${goldenTracks}\n` +
      `• 111 Pattern tracks (>20%): ${pattern111Tracks}\n` +
      `• DNA Resonance tracks (>30%): ${dnaTracks}\n\n` +
      `💡 RECOMMENDATIONS:\n` +
      `${unanalyzedTracks > 0 ? `• Scan ${unanalyzedTracks} remaining tracks\n` : ''}` +
      `${heartTracks === 0 ? '• No HEART frequencies - use Test Distribution for 27-track playlists\n' : ''}` +
      `${headTracks === 0 ? '• No HEAD frequencies - use Test Distribution for 27-track playlists\n' : ''}`;
      
    alert(diagnosticMessage);
  };

  const generateUltimateAlignmentPlaylist = () => {
    // Get all solfeggio frequencies in order from all Nine orders (1-9)
    const ultimateFrequencyOrder = SOLFEGGIO_INFO.map(info => info.freq);
    const ultimatePlaylist: Song[] = [];
    const usedIds = new Set<string>();

    // For each frequency, find the best matching track
    ultimateFrequencyOrder.forEach(freq => {
      const candidates = originalPlaylist.filter(s => s.closestSolfeggio === freq && !usedIds.has(s.id));
      if (candidates.length > 0) {
        // Enhanced sorting with multiple criteria
        candidates.sort((a, b) => {
          // 1. Prioritize songs with high golden ratio alignment
          const aGolden = a.fractalAnalysis?.goldenRatioAlignment || 0;
          const bGolden = b.fractalAnalysis?.goldenRatioAlignment || 0;
          
          if (Math.abs(aGolden - bGolden) > 0.1) {
            return bGolden - aGolden; // Higher golden ratio first
          }
          
          // 2. Then prioritize DNA resonance
          const aDNA = a.fractalAnalysis?.dnaResonanceScore || 0;
          const bDNA = b.fractalAnalysis?.dnaResonanceScore || 0;
          
          if (Math.abs(aDNA - bDNA) > 0.1) {
            return bDNA - aDNA;
          }
          
          // 3. Finally sort by harmonic deviation (accuracy)
          return (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
        });
        
        const bestMatch = candidates[0];
        ultimatePlaylist.push(bestMatch);
        usedIds.add(bestMatch.id);
      }
    });
    
    if (ultimatePlaylist.length > 0) {
      setPlaylist(ultimatePlaylist);
      setUseChakraOrder(true);
      setCurrentSongIndex(0);
      setSearchTerm('');
      
      // Enable Tree of Life visualization for this ultimate journey
      setVizSettings(prev => ({ 
        ...prev, 
        showTreeOfLife: true,
        morphEnabled: true,
        colorMode: 'chakra'
      }));
      
      // For higher frequencies, set appropriate experience level to prevent interruptions
      const hasHighFrequencies = ultimatePlaylist.some(s => (s.closestSolfeggio || 0) >= 1206);
      if (hasHighFrequencies && userExperienceLevel === 'beginner') {
        setUserExperienceLevel('advanced');
        setAnalysisNotification(
          `Ultimate Alignment includes higher frequencies. Experience level temporarily set to 'Advanced' for uninterrupted playback.`
        );
        setTimeout(() => setAnalysisNotification(null), 5000);
      }
      
      // Show notification about the ultimate alignment
      const ordersIncluded = new Set(ultimatePlaylist.map(s => 
        SOLFEGGIO_INFO.find(info => info.freq === s.closestSolfeggio)?.order
      )).size;
      
      setTimeout(() => {
        setAnalysisNotification(
          `Ultimate Alignment activated! Journey through ${ultimatePlaylist.length} frequencies across ${ordersIncluded} orders of consciousness.`
        );
        setTimeout(() => setAnalysisNotification(null), 7000);
      }, hasHighFrequencies ? 5500 : 0);
      
      playTrackRef.current(0, ultimatePlaylist);
      if(window.innerWidth < 768) setShowSidebar(false);
    } else {
      alert("Not enough analyzed songs for Ultimate Alignment. Please scan your library first.");
    }
  };

  // Generate Complete Aetheria Journey through all 9 Orders
  const generateAetheriaJourney = async () => {
    // First check if we have Aetheria tracks
    const aetheriaTracks = originalPlaylist.filter(song => 
      song.name.includes('WezClarke') || 
      song.file.name.includes('_Masterchannel_WezClarke_') ||
      ['Chaotic Confusion', 'Chasing Horizons', 'Choices', 'Coming Home', 'Constellations', 
       'Echoes of the Warden', 'Fractals', 'Garden of Eden', 'Golden Thread', 'Hands Out',
       'Invisible Scars', 'Invocation', 'Magic in the Air', 'Man Scourned', 'Phosphenes',
       'Red Alert', 'Safe to land', 'Simple Abundance', 'The Calling Within', 
       'The Instruction Manual', 'The Running Song', 'THE SYMPHONIC GRID', 
       'The Well Within', 'Up in Smoke', 'Waves', 'Wonder'].some(title => 
         song.name.toLowerCase().includes(title.toLowerCase())
       )
    );

    if (aetheriaTracks.length === 0) {
      alert('No Aetheria Collection tracks found! Please import the "Music for Aetheria" folder first using the Import button above.');
      return;
    }

    // All 9 Orders of Solfeggio frequencies in progression
    const allNineOrders = [
      174, 285, 396, 417, 528, 639, 741, 852, 963,
      1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150,
      3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336
    ];

    const journeyPlaylist: Song[] = [];
    const usedIds = new Set<string>();

    // For each frequency, find the best Aetheria track
    allNineOrders.forEach(freq => {
      const candidates = aetheriaTracks.filter(s => 
        s.closestSolfeggio === freq && !usedIds.has(s.id)
      );
      
      if (candidates.length > 0) {
        candidates.sort((a, b) => 
          (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999)
        );
        
        const bestMatch = candidates[0];
        journeyPlaylist.push(bestMatch);
        usedIds.add(bestMatch.id);
      }
    });

    if (journeyPlaylist.length > 0) {
      setPlaylist(journeyPlaylist);
      setUseChakraOrder(true);
      setCurrentSongIndex(0);
      setSearchTerm('');
      
      setVizSettings(prev => ({ 
        ...prev, 
        showTreeOfLife: true,
        morphEnabled: true,
        colorMode: 'chakra'
      }));

      const hasHighFreqs = journeyPlaylist.some(s => (s.closestSolfeggio || 0) >= 3786);
      if (hasHighFreqs && userExperienceLevel !== 'expert') {
        setUserExperienceLevel('expert');
      }

      setAnalysisNotification(
        `🌟 Aetheria Journey: ${journeyPlaylist.length} tracks across all 9 Orders! Complete progression 174Hz→5031Hz.`
      );
      setTimeout(() => setAnalysisNotification(null), 8000);

      playTrackRef.current(0, journeyPlaylist);
      if(window.innerWidth < 768) setShowSidebar(false);
    } else {
      alert('No analyzed Aetheria tracks found. Please scan your library first.');
    }
  };

  // Auto-import Aetheria tracks function
  const autoImportAetheriaCollection = useCallback(async () => {
    try {
      // Define the expected Aetheria track names
      const aetheriaTrackNames = [
        'Chaotic Confusion (Reggae)_Masterchannel_WezClarke_2025-12-13.wav',
        'Chasing Horizons_Masterchannel_WezClarke_2025-11-17.wav',
        'Choices_Masterchannel_WezClarke_2025-12-06.wav',
        'Coming Home (Reggae)_Masterchannel_WezClarke_2025-12-26.wav',
        'Coming Home!_Masterchannel_WezClarke_2025-12-25.wav',
        'Constellations_Masterchannel_WezClarke_2025-12-16.wav',
        'Echoes of the Warden_(Reggae)_Masterchannel_WezClarke_2025-12-26 - Copy.wav',
        'Fractals_(APCZEN)_Masterchannel_WezClarke_2025-12-27.wav',
        'Garden of Eden._Masterchannel_WezClarke_2025-12-20.wav',
        'Golden Thread_Masterchannel_WezClarke_2025-12-22.wav',
        'Hands Out_Masterchannel_WezClarke_2025-11-18.wav',
        'Invisible Scars. (Edit)_Masterchannel_WezClarke_2025-12-15.wav',
        'Invocation..._Masterchannel_WezClarke_2025-12-09.wav',
        'Magic in the Air_Masterchannel_WezClarke_2025-11-16.wav',
        'Man Scourned_Masterchannel_WezClarke_2025-12-03.wav',
        'Phosphenes_Masterchannel_WezClarke_2025-12-20.wav',
        'Red Alert_Masterchannel_WezClarke_2025-12-15.wav',
        'Safe to land (hypnotic)_Masterchannel_WezClarke_2025-12-18.wav',
        'Simple Abundance_Masterchannel_WezClarke_2025-11-19.wav',
        'The Calling Within_Masterchannel_WezClarke_20250510.wav',
        'The Instruction Manual._Masterchannel_WezClarke_2025-12-24.wav',
        'The Running Song_Masterchannel_WezClarke_2026-01-03.wav',
        'THE SYMPHONIC GRID_Masterchannel_WezClarke_2026-01-02.wav',
        'The Well Within_Masterchannel_WezClarke_2025-11-18.wav',
        'Up in Smoke_Masterchannel_WezClarke_2025-12-11.wav',
        'Waves_Masterchannel_WezClarke_2025-12-26 - Copy.wav',
        'Wonder_Masterchannel_WezClarke_2025-11-18.wav'
      ];

      // Check if we're running in a browser environment that supports File System Access API
      if ((window as any).showDirectoryPicker) {
        // Try to auto-import if we can access the file system
        try {
          // This won't work without user interaction, but we can prepare for it
          console.log('File System Access API available');
        } catch (e) {
          console.log('File System Access API not supported or user denied');
        }
      }

      // Check if files are already loaded to avoid re-importing
      const existingAetheriaTracks = playlist.filter(song => 
        song.file.name.includes('_Masterchannel_WezClarke_') ||
        aetheriaTrackNames.some(name => 
          song.file.name.toLowerCase().includes(name.toLowerCase().split('_')[0].toLowerCase())
        )
      );

      if (existingAetheriaTracks.length > 0) {
        console.log(`${existingAetheriaTracks.length} Aetheria tracks already loaded`);
        return;
      }

      // If no tracks are loaded, show a helpful message
      if (playlist.length === 0) {
        setAnalysisNotification(
          `Aetheria Collection Auto-Import: Please use the "Import Aetheria Tracks" button to load the 26 official tracks from the Music for Aetheria folder.`
        );
        setTimeout(() => setAnalysisNotification(null), 8000);
      }

    } catch (error) {
      console.error('Auto-import error:', error);
    }
  }, [playlist]);

  // Import the Aetheria Music Collection by prompting user to select the folder
  const importAetheriaCollection = () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.setAttribute('webkitdirectory', '');
    fileInput.setAttribute('directory', '');
    fileInput.multiple = true;
    fileInput.accept = 'audio/*';
    
    fileInput.onchange = (event) => {
      const target = event.target as HTMLInputElement;
      const files = target.files;
      if (files && files.length > 0) {
        // Check if this looks like the Aetheria collection
        const aetheriaFiles = Array.from(files).filter(file => 
          file.name.includes('_Masterchannel_WezClarke_') && 
          (file.name.endsWith('.wav') || file.name.endsWith('.mp3'))
        );
        
        if (aetheriaFiles.length > 0) {
          setAnalysisNotification(
            `Aetheria Collection detected! Found ${aetheriaFiles.length} tracks by WezClarke. Importing...`
          );
          setTimeout(() => setAnalysisNotification(null), 5000);
          
          // Use the existing file upload handler but with cleaned names
          handleFileUpload({ target: { files: aetheriaFiles } } as any);
          if(window.innerWidth < 768) setShowSidebar(false);
        } else {
          // If no Aetheria tracks found, import whatever was selected
          handleFileUpload(event as any);
          setAnalysisNotification(
            `Imported ${files.length} files. Note: This doesn't appear to be the official Aetheria Collection by WezClarke.`
          );
          setTimeout(() => setAnalysisNotification(null), 5000);
        }
      }
    };
    
    fileInput.click();
  };

  // Filter playlist to show only Aetheria collection tracks
  const showAetheriaTracksOnly = () => {
    const aetheriaTracks = originalPlaylist.filter(song => 
      song.name.includes('WezClarke') || 
      song.file.name.includes('_Masterchannel_WezClarke_') ||
      ['Chaotic Confusion', 'Chasing Horizons', 'Choices', 'Coming Home', 'Constellations', 
       'Echoes of the Warden', 'Fractals', 'Garden of Eden', 'Golden Thread', 'Hands Out',
       'Invisible Scars', 'Invocation', 'Magic in the Air', 'Man Scourned', 'Phosphenes',
       'Red Alert', 'Safe to land', 'Simple Abundance', 'The Calling Within', 
       'The Instruction Manual', 'The Running Song', 'THE SYMPHONIC GRID', 
       'The Well Within', 'Up in Smoke', 'Waves', 'Wonder'].some(title => 
         song.name.toLowerCase().includes(title.toLowerCase())
       )
    );

    if (aetheriaTracks.length > 0) {
      setPlaylist(aetheriaTracks);
      setCurrentSongIndex(0);
      setSearchTerm('');
      
      setAnalysisNotification(
        `Aetheria Collection playlist activated! ${aetheriaTracks.length} tracks by WezClarke ready for harmonic journey.`
      );
      setTimeout(() => setAnalysisNotification(null), 5000);
      
      if(window.innerWidth < 768) setShowSidebar(false);
    } else {
      alert('No Aetheria Collection tracks found in your library. Import the "Music for Aetheria" folder first.');
    }
  };



  const restoreLibrary = () => {
      if (originalPlaylist.length > 0) {
          setPlaylist(originalPlaylist);
          setUseChakraOrder(false);
          setSearchTerm(''); // Clear search when restoring library
      }
  };

  const getFrequencyRegime = (freq: number) => {
    if (freq <= 963) return 'GUT';
    if (freq <= 3150) return 'HEART';
    return 'HEAD';
  };

  // How far before a track's natural end we swap to the next one. We never let
  // the element reach `ended`: that terminal state tears down the OS media
  // session, and a gesture-less rebuild of the lock-screen card is not permitted.
  const AUTO_ADVANCE_LOOKAHEAD_S = 0.35;

  // --- SINGLE-ELEMENT GAPLESS ADVANCE ----------------------------------------
  // Per the platform guidance (web.dev / Chrome Media Session), the way to keep
  // the lock-screen notification alive across a playlist is to REUSE ONE audio
  // element: set .src, call play(), update metadata, assert playbackState. We
  // tried two alternating elements; it kept the card across the first auto-
  // advance but the OS dropped it on the second (switching the active element is
  // the documented anti-pattern). So: one element, clean swap, no pause().
  //
  // Resolve the index of the next track, mirroring playNext's shuffle / loop /
  // sequential logic. commit=false is a pure peek; commit=true applies the
  // shuffle bookkeeping (setShufflePos / setShuffledIndices). Returns null at the
  // terminal end of a non-looping playlist, on an empty playlist, or — when only
  // peeking — at a shuffle-list wrap (the regenerated order can't be peeked
  // without mutating, so that single transition falls back to non-gapless).
  const resolveNext = (commit: boolean): number | null => {
    const { playlist, currentSongIndex, isShuffle, isLoop, shuffledIndices } = stateRef.current;
    if (playlist.length === 0) return null;
    if (isShuffle) {
      let currentIndices = shuffledIndices;
      if (currentIndices.length !== playlist.length) {
        currentIndices = getLruShuffledIndices(playlist, playHistoryRef.current);
        if (commit) setShuffledIndices(currentIndices);
      }
      const pos = currentIndices.indexOf(currentSongIndex);
      const nextPos = pos + 1;
      if (nextPos >= currentIndices.length) {
        if (!commit) return null; // can't peek a not-yet-generated order
        const newIndices = getLruShuffledIndices(playlist, playHistoryRef.current);
        setShuffledIndices(newIndices);
        setShufflePos(0);
        return newIndices[0];
      }
      if (commit) setShufflePos(nextPos);
      return currentIndices[nextPos];
    }
    let nextIndex = currentSongIndex + 1;
    if (nextIndex >= playlist.length) {
      if (isLoop) nextIndex = 0;
      else return null; // terminal — end of a non-looping playlist
    }
    return nextIndex;
  };

  // The clean single-element advance. Returns true if it handled the advance,
  // false to fall back to the normal playNext path (terminal stop, shuffle wrap,
  // or an un-analyzed next track that would need a blocking decode).
  //
  // The whole point: do the MINIMUM on the one active, user-activated element —
  // set .src, play(), update metadata, assert playbackState='playing' — with NO
  // pause(), NO load(), and NO awaited work in between. A pause() or an async gap
  // is what signalled "stopped" to the OS and dropped the lock-screen card. This
  // is fired ~AUTO_ADVANCE_LOOKAHEAD_S BEFORE the natural end so the element never
  // reaches the terminal `ended` state (another teardown trigger).
  const tryGaplessAdvance = (): boolean => {
    const el = mainAudioRef.current;
    if (!el) return false;

    const peek = resolveNext(false);
    if (peek === null) return false;
    const nextSong = stateRef.current.playlist[peek];
    // Require a pre-assigned frequency (Deep-Scanned) so we don't have to decode
    // on the critical path (a multi-second await here would drop the card).
    if (!nextSong || !nextSong.closestSolfeggio) return false;

    // Commit the shuffle/index bookkeeping.
    resolveNext(true);
    const targetFreq = nextSong.closestSolfeggio;

    // Reuse the current song's blob URL or mint one (local file → instant).
    let url = blobUrlsRef.current[nextSong.id];
    if (!url) {
      url = URL.createObjectURL(nextSong.file);
      blobUrlsRef.current[nextSong.id] = url;
    }

    // THE SWAP — same element, no pause, no load, no await.
    el.src = url;
    // Re-assert after the src swap so the gapless path can never drift from a
    // normally-started track (rate AND pitch-preservation together).
    applyPlaybackRate(el);
    const p = el.play();
    if (p) p.catch((err: unknown) => console.error('Gapless swap play() failed:', err));
    applyMusicElementVolume();

    // Re-arm auto-advance for the new track.
    autoAdvanceTriggeredRef.current = false;

    // Assert the media session for the new track in the SAME synchronous turn as
    // play(), and force playbackState='playing' so the OS doesn't treat the brief
    // src reload as a stop.
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: nextSong.name || 'Unknown Track',
          artist: 'Aetheria Harmonic Player',
          album: `${targetFreq}Hz • ${getFrequencyRegime(targetFreq)} Regime`,
          artwork: [
            { src: '/images/icon-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/images/icon-512x512.png', sizes: '512x512', type: 'image/png' },
          ],
        });
        navigator.mediaSession.playbackState = 'playing';
      } catch {}
    }

    // Mirror playTrack's state updates for the new track. (currDuration follows
    // from the element's loadedmetadata listener once the new src loads.)
    setCurrTime(0);
    pausedAtRef.current = 0;
    setSelectedSolfeggio(targetFreq);
    setSubtleResonanceMode(targetFreq > 963);
    audioBufferRef.current = null;
    if (nextSong.fractalAnalysis) setFractalAnalysis(nextSong.fractalAnalysis);
    setCurrentSongIndex(peek);
    recordPlay(nextSong.id);

    // Drop every other song's blob URL (memory cap — one track's worth alive).
    Object.keys(blobUrlsRef.current).forEach(id => {
      if (id !== nextSong.id) {
        URL.revokeObjectURL(blobUrlsRef.current[id]);
        delete blobUrlsRef.current[id];
      }
    });

    return true;
  };

  // Called by the active element's end-of-track listeners. Clean single-element
  // swap if possible, else the normal advance (terminal stop / shuffle wrap /
  // un-analyzed track).
  const handleAutoAdvance = () => {
    if (!tryGaplessAdvance()) {
      playNextRef.current();
    }
  };
  const handleAutoAdvanceRef = useRef(handleAutoAdvance);
  useEffect(() => { handleAutoAdvanceRef.current = handleAutoAdvance; });

  // 432 Hz retuning is VARISPEED — pitch and tempo move together, exactly like
  // slowing a turntable. That is what a 440->432 retune physically IS, and it is
  // artifact-free because it is plain resampling.
  //
  // `preservesPitch` MUST therefore be false. Left at its browser default of
  // TRUE, setting playbackRate does not resample at all: it runs a WSOLA
  // time-stretcher that cross-fades overlapping ~25 ms windows to hold the
  // source pitch. That had two effects, both live in v13.1:
  //   1. Audible warble on sustained harmonic material (lo-fi, slow tracks).
  //      Dense transient material like ska masked it, which is what made the
  //      bug look track-dependent rather than global.
  //   2. NO RETUNING AT ALL — pitch preservation is the opposite of what we
  //      want, so the app paid the full artifact cost and delivered none of the
  //      432 shift. It also made toHeardHz() compensate for a shift that was
  //      not happening, putting frequency assignment 31.8 cents out.
  // Chrome only takes the artifact-free fast path at playbackRate === 1.0
  // exactly, so 0.981818 always goes through the stretcher.
  //
  // Keep these two properties set TOGETHER — that is why this helper exists
  // rather than a bare `el.playbackRate = ...` at each call site.
  const applyPlaybackRate = (el: HTMLAudioElement) => {
    el.preservesPitch = false;
    (el as any).webkitPreservesPitch = false;  // Safari 15–16.3
    (el as any).mozPreservesPitch = false;     // legacy Firefox
    el.playbackRate = PITCH_SHIFT_FACTOR;
  };

  // Attach the standard listeners to the audio element. The `el === mainAudioRef
  // .current` guards are belt-and-suspenders (there is a single element today)
  // so a stray event from a replaced element could never drive a second advance.
  const setupAudioElement = (el: HTMLAudioElement) => {
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    applyPlaybackRate(el);

    // PRE-END AUTO-ADVANCE — the primary path. Fires ~AUTO_ADVANCE_LOOKAHEAD_S
    // before the end, while still playing, so the swap happens before the element
    // reaches the terminal `ended` state (which would drop the card). timeupdate
    // keeps firing on a locked screen because this element owns the media session.
    el.addEventListener('timeupdate', () => {
      if (el !== mainAudioRef.current) return;
      if (el.paused || autoAdvanceTriggeredRef.current) return;
      const dur = el.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      // Auto-advance: clean single-element swap ~AUTO_ADVANCE_LOOKAHEAD_S before
      // the end. The continuously-playing silent anchor (mobile) bridges the load
      // gap so the lock-screen card survives.
      if (dur - el.currentTime <= AUTO_ADVANCE_LOOKAHEAD_S) {
        autoAdvanceTriggeredRef.current = true;
        handleAutoAdvanceRef.current();
      }
    });

    // FALLBACK — if timeupdate's ~4 Hz granularity overshoots the window the
    // track reaches its natural end; advance then (the once-guard prevents a
    // double-fire with the timeupdate path).
    el.addEventListener('ended', () => {
      if (el !== mainAudioRef.current) return;
      if (autoAdvanceTriggeredRef.current) return;
      autoAdvanceTriggeredRef.current = true;
      handleAutoAdvanceRef.current();
    });

    el.addEventListener('error', (e) => {
      const audio = e.target as HTMLAudioElement;
      console.error('Audio element error:', e);
      console.error('Error details:', {
        error: audio.error,
        code: audio.error?.code,
        message: audio.error?.message,
        networkState: audio.networkState,
        readyState: audio.readyState,
        currentSrc: audio.currentSrc,
      });
      if (el !== mainAudioRef.current) return; // ignore events from a replaced element
      setIsPlaying(false);
      // Auto-recovery for common blob errors — clear src so the next play reloads.
      if (audio.error?.code === 2 || audio.error?.code === 4) {
        (el as any).needsReload = true;
        el.src = '';
      }
    });

    el.addEventListener('loadedmetadata', () => {
      if (el !== mainAudioRef.current) return;
      // ELEMENT TIME, not wall-clock. `currTime` is read straight off
      // el.currentTime, which advances in MEDIA time (0 -> el.duration) no matter
      // what the playback rate is. Dividing duration by PITCH_SHIFT_FACTOR here
      // gave the true wall-clock length but put duration and position in
      // DIFFERENT units, so the progress bar stopped at 98.2% and handleSeek
      // aimed 1.85% past the end. Both units are defensible; the same one for
      // both is the only requirement. The OS scrubber is told the real rate
      // separately (see setPositionState), so it still extrapolates correctly.
      setCurrDuration(el.duration);
    });
  };

  const playTrack = async (index: number, playlistOverride?: Song[], preserveShuffleOrder = false) => {
    initAudio();

    const tracks = playlistOverride || (stateRef.current.playlist.length > 0 ? stateRef.current.playlist : playlist);

    if (index < 0 || index >= tracks.length) return;

    // Manual track pick under shuffle: regenerate the shuffle order so the
    // picked song sits at position 0 and the rest of the shuffle plays from
    // there. Previously this synced shufflePos to wherever the picked song
    // happened to land in the existing LRU shuffle order — if that was the
    // last position, playback dead-ended the moment the song finished
    // (looked like "shuffle is broken"). Auto-advance (playNext / Prev /
    // loop wrap) passes preserveShuffleOrder=true to keep the same order.
    if (stateRef.current.isShuffle && !playlistOverride && !preserveShuffleOrder) {
        const fresh = getLruShuffledIndices(stateRef.current.playlist, playHistoryRef.current);
        const newOrder = [index, ...fresh.filter(i => i !== index)];
        setShuffledIndices(newOrder);
        setShufflePos(0);
    }

    setCurrTime(0);
    pausedAtRef.current = 0;
    // Re-arm the pre-end auto-advance for this new track.
    autoAdvanceTriggeredRef.current = false;
    // Start the silent media-session anchor (continuous, muted). On a user-gesture
    // play this first start is permitted; on a gesture-less auto-advance fallback
    // it's already running so this is a no-op. It stays muted during steady
    // playback and is unmuted only for the bridge window (see the timeupdate
    // handler in setupAudioElement).
    startSilentAnchor();
    setIsAnalyzing(true);

    const song = tracks[index];
    if (!song) return;

    try {
      // Stop the current active element before reusing it for a manual /
      // initial play. NOTE: automatic end-of-track advance does NOT come through
      // here — it uses the gapless handoff (tryGaplessAdvance), which never
      // pauses the outgoing element until the incoming one is already playing,
      // so the media session stays continuous and the lock-screen card survives.
      // This pause() path is only hit by user-gesture plays (clicks, manual
      // next/prev, lock-screen skip), where a brief stop is fine.
      if (mainAudioRef.current) {
        mainAudioRef.current.pause();
        mainAudioRef.current.currentTime = 0;
      }

      // Create the single audio element once, with its listeners.
      if (!mainAudioRef.current) {
        mainAudioRef.current = new Audio();
        setupAudioElement(mainAudioRef.current);
      }

      // Revoke and drop blob URLs for any song we're not about to play.
      // URL.createObjectURL pins the underlying File until its URL is
      // revoked, so without this every track played in a long walk keeps
      // its MP3 (5–50 MB) alive for the rest of the session. At ~30 MB
      // × 110 tracks of a CABI walk that's ~3.3 GB of unfreeable memory,
      // which is what caused Chrome to freeze around the 6-hour mark on
      // shuffle. Keeping at most one blob URL alive at a time caps
      // session memory at one track's worth regardless of walk length.
      // (Previous code attempted a per-song revoke but checked the same
      // key twice in a row, making the revoke branch unreachable.)
      Object.keys(blobUrlsRef.current).forEach(id => {
        if (id !== song.id) {
          URL.revokeObjectURL(blobUrlsRef.current[id]);
          delete blobUrlsRef.current[id];
        }
      });

      // Create or reuse the current song's blob URL.
      let audioUrl = blobUrlsRef.current[song.id];
      if (!audioUrl) {
        audioUrl = URL.createObjectURL(song.file);
        blobUrlsRef.current[song.id] = audioUrl;
        console.log('Created new blob URL for:', song.name);
      } else {
        console.log('Reusing existing blob URL for:', song.name);
      }

      mainAudioRef.current.src = audioUrl;

      // DIRECT PLAYBACK: the music plays straight through the <audio> element to
      // the OS — we deliberately DO NOT route it through
      // createMediaElementSource. Redirecting it into Web Audio made the
      // element "silent to the OS", which is what made the lock-screen / car
      // media session fragile (the card vanished on gesture-less auto-advance).
      // Playing direct lets the OS own the media session, so background
      // auto-advance, the card, and the lock-screen controls all work reliably.
      // The binaural / solfeggio layers stay in Web Audio and mix with the
      // music at the device output, so the layered experience is unchanged.
      // Volume is applied on the element itself (see applyMusicElementVolume).
      applyMusicElementVolume();

      // Re-assert the OS media session SYNCHRONOUSLY, the instant the new src
      // is set — BEFORE we await play() below. On a locked mobile screen the OS
      // dismisses the Now-Playing card the moment the *previous* element fires
      // `ended`. We also re-assert AFTER play() resolves (further down), but by
      // then there's an idle window in which the OS has already torn the card
      // down — and once the card is gone the page loses media focus and the OS
      // FREEZES our JS, so the *next* track's `ended` never fires and the
      // playlist dead-ends after a single auto-advance (the "next song is the
      // last until you reopen the app" bug). Asserting here closes that window
      // so the card never drops and the page is never frozen. We use the
      // pre-assigned frequency (closestSolfeggio) when available — true for any
      // Deep-Scanned track — and fall back to the current selection otherwise;
      // the post-play assertion further down corrects it with the final value.
      if ('mediaSession' in navigator) {
        try {
          const earlyFreq = song.closestSolfeggio || selectedSolfeggio;
          navigator.mediaSession.metadata = new MediaMetadata({
            title: song.name || 'Unknown Track',
            artist: 'Aetheria Harmonic Player',
            album: `${earlyFreq}Hz • ${getFrequencyRegime(earlyFreq)} Regime`,
            artwork: [
              { src: '/images/icon-192x192.png', sizes: '192x192', type: 'image/png' },
              { src: '/images/icon-512x512.png', sizes: '512x512', type: 'image/png' },
            ],
          });
          navigator.mediaSession.playbackState = 'playing';
        } catch {}
      }

      // NOTE: no explicit load() here on purpose. Setting .src above already
      // starts the media resource load, and play() below waits for enough
      // data. Calling load() additionally does a HARD reset of the element to
      // its initial (empty) state, which on mobile tears down the OS
      // media-session notification — and because our audio is redirected
      // through Web Audio (the element is silent to the OS), the notification
      // did not reliably reappear on the next track. Dropping the redundant
      // reset is what keeps the lock-screen / car controls alive across an
      // auto-advance.

      let freq = song.harmonicFreq;
      let existingFractalAnalysis = song.fractalAnalysis;

      if (!freq) {
          // Need to decode in order to run frequency detection. Decoding a
          // 4-minute MP3 allocates ~80 MB of PCM, so we only pay that cost
          // when we actually have to analyse — songs assigned a frequency
          // by Auto-Distribute or Deep Scan skip this entirely. (Holding
          // those buffers per-track is what caused the freeze around
          // song 57 of a long playlist.)
          const arrayBuffer = await song.file.arrayBuffer();
          const audioBuffer = await audioCtxRef.current!.decodeAudioData(arrayBuffer);
          audioBufferRef.current = audioBuffer;
          freq = await detectDominantFrequencyAdvanced(audioBuffer);
      } else {
          // Release any prior decoded buffer so it can be GC'd while the
          // next track plays.
          audioBufferRef.current = null;
          if (existingFractalAnalysis) {
              setFractalAnalysis(existingFractalAnalysis);
              console.log('Using stored fractal analysis for:', song.name);
          }
      }
      
      // Use pre-assigned frequency from harmonic distribution if available
      let targetFreq: number;
      if (song.closestSolfeggio) {
          targetFreq = song.closestSolfeggio;
          console.log(`Using pre-assigned harmonic frequency: ${targetFreq}Hz for "${song.name}"`);
      } else {
          // Fallback to dynamic calculation for unprocessed songs
          targetFreq = getHarmonicSolfeggio(freq || 0);
          console.log(`Calculating harmonic frequency: ${targetFreq}Hz for "${song.name}"`);
      }
      
      setSelectedSolfeggio(targetFreq);
      
      // Check if this is a high frequency track but don't interrupt playback
      if (targetFreq > 963) {
          setSubtleResonanceMode(true);
          // Don't automatically show safety protocols during playlist playback
          // Only show if manually selected
      } else {
          setSubtleResonanceMode(false);
      }
      
      setIsAnalyzing(false);

      // Play the audio element (this will make Chrome show the speaker icon)
      // 432 Hz retuning: 440->432 is a 0.981818 varispeed rate. Frequency
      // detection runs on the UNSHIFTED source buffer, so it is compensated at
      // the detection boundary (toHeardHz) — keep the two in step or the app will
      // report frequencies 31.8 cents away from what is actually heard.
      applyPlaybackRate(mainAudioRef.current);
      // Set a conservative volume on the element itself as additional safety
      // Don't set volume on the element - we want pure Web Audio output only
      await mainAudioRef.current.play();

      // Re-assert the FULL media session synchronously on the new track —
      // metadata AND playing state — at the instant playback starts. The
      // React-effect path (useMediaSession) only updates after
      // setCurrentSongIndex re-renders, a tick later. That left a window where
      // the element had ended and restarted carrying song-1's stale session
      // info, and the OS dropped the lock-screen / car notification instead of
      // re-showing it. Setting it here, in the same turn as play(), gives the
      // OS complete, current session data the moment the new media begins.
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: song.name || 'Unknown Track',
            artist: 'Aetheria Harmonic Player',
            album: `${targetFreq}Hz • ${getFrequencyRegime(targetFreq)} Regime`,
            artwork: [
              { src: '/images/icon-192x192.png', sizes: '192x192', type: 'image/png' },
              { src: '/images/icon-512x512.png', sizes: '512x512', type: 'image/png' },
            ],
          });
          navigator.mediaSession.playbackState = 'playing';
        } catch {}
      }

      setIsPlaying(true);
      setCurrentSongIndex(index);

      // Record this play in the rotation history so subsequent LRU
      // shuffles and CAB/Ouroboros pickers deprioritize this song until
      // others have caught up. Same call covers all flows that route
      // through playTrack — shuffle next, walk progression, manual click.
      recordPlay(song.id);

      // Don't revoke blob URLs immediately - they need to stay valid
      // We'll clean them up when creating new ones or on unmount

    } catch (error) {
      // No alert() here. A blocking dialog fired from a backgrounded / locked
      // screen (e.g. a transient play() rejection during an auto-advance or a
      // lock-screen skip) is invisible and unmissable until the app is
      // foregrounded — it wedged the lock-screen controls. Log instead and let
      // the next user action or the background watchdog recover.
      console.error('Playback error:', error);
      setIsAnalyzing(false);
      setIsPlaying(false);
    }
  };

  useEffect(() => {
      playTrackRef.current = playTrack;
  }, [playTrack]);

  // Centralized Play Next Logic for Shuffle/Loop. Delegates the index/shuffle/
  // loop math to resolveNext (the SAME resolver the gapless preload + handoff
  // use, so the three never diverge). This is the non-gapless advance path —
  // used for the terminal stop, shuffle wraps, and un-analyzed tracks, and as
  // the fallback whenever a gapless handoff can't run.
  const playNext = useCallback(() => {
    const next = resolveNext(true); // commits shuffle bookkeeping, like before
    if (next === null) {
      // Empty playlist, or the terminal end of a non-looping playlist.
      setIsPlaying(false);
      return;
    }
    // Auto-advance preserves the existing shuffle order (resolveNext already
    // advanced/committed the shuffle position); sequential plays ignore it.
    playTrack(next, undefined, stateRef.current.isShuffle);
  }, [playTrack]);

  useEffect(() => {
      playNextRef.current = playNext;
  }, [playNext]);

  // The silent media-session anchor is only needed on MOBILE, where the screen
  // locks and the OS drops the media card on gesture-less auto-advance. Desktop
  // skips it (no lock-screen problem, and it would only duck the music). The
  // anchor plays CONTINUOUSLY and UNMUTED — the only configuration that reliably
  // holds the card across the load gap on Android Chrome (a muted or paused
  // anchor gets deprioritised and the card drops at the transition). Its ducking
  // of the music is offset on mobile by MOBILE_MUSIC_DUCK_COMPENSATION.
  const SILENT_ANCHOR_ENABLED = IS_MOBILE_DEVICE;

  // Build a tiny all-zero (truly silent) WAV as a data URL — generated in-code so
  // it works offline and ships no asset. 1 s @ 8 kHz 16-bit mono ≈ 16 KB.
  const buildAnchorWavDataUrl = (): string => {
    // A seamless-looping soft sine drone (or pure silence when amplitude is 0).
    // Sample rate is chosen as ANCHOR_TONE_HZ × an integer samples-per-cycle, and
    // the length is an integer number of cycles, so the loop seam closes at phase
    // zero with no click. ~6 s long to clear Chrome's "≥5 s = real media" focus
    // threshold (media under 5 s may not get a lock-screen notification).
    const samplesPerCycle = 80;
    const sampleRate = Math.round(ANCHOR_TONE_HZ * samplesPerCycle);
    const seconds = 6;
    const cycles = Math.max(1, Math.round(ANCHOR_TONE_HZ * seconds));
    const numChannels = 1, bitsPerSample = 16;
    const blockAlign = numChannels * (bitsPerSample / 8);
    const numSamples = cycles * samplesPerCycle;       // exact integer cycles
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);                 // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    const amp = Math.max(0, Math.min(1, ANCHOR_TONE_AMPLITUDE)) * 32767;
    for (let i = 0; i < numSamples; i++) {
      // One cycle == samplesPerCycle samples → phase wraps exactly at the seam.
      const sample = amp === 0 ? 0 : Math.round(amp * Math.sin((2 * Math.PI * i) / samplesPerCycle));
      view.setInt16(44 + i * blockAlign, sample, true);
    }
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return 'data:audio/wav;base64,' + btoa(binary);
  };

  // Create the anchor element lazily. It plays a soft harmonic drone (or silence)
  // continuously to hold the media session; volume stays 1 on the element (a
  // muted / zero-volume element can be ignored for media-session purposes) — the
  // drone's softness comes from its low sample amplitude, not the element volume.
  const ensureSilentAnchor = (): HTMLAudioElement | null => {
    if (!SILENT_ANCHOR_ENABLED) return null;
    if (!anchorAudioRef.current) {
      if (!silentWavUrlRef.current) silentWavUrlRef.current = buildAnchorWavDataUrl();
      const a = new Audio(silentWavUrlRef.current);
      a.loop = true;
      a.preload = 'auto';
      a.volume = 1;
      anchorAudioRef.current = a;
    }
    return anchorAudioRef.current;
  };
  // Start the anchor: CONTINUOUS, UNMUTED playback for the whole session. This is
  // the only configuration that reliably holds the lock-screen card across the
  // auto-advance load gap on Android Chrome — muting or pausing it between
  // transitions made the OS deprioritise it and the card dropped. The ducking
  // this causes is offset by MOBILE_MUSIC_DUCK_COMPENSATION. Must be called from a
  // user gesture the first time (autoplay); afterwards it just keeps running.
  const startSilentAnchor = () => {
    const a = ensureSilentAnchor();
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
  };
  const stopSilentAnchor = () => {
    const a = anchorAudioRef.current;
    if (a && !a.paused) { try { a.pause(); } catch {} }
  };

  // Safety net: whenever playback genuinely stops (user pause, playback error,
  // or the terminal end of a non-looping playlist → isPlaying=false), release the
  // anchor so it can't keep the media session pinned alive with no music. We only
  // STOP here — starting stays inside a user gesture (autoplay policy). Note
  // isPlaying stays true across a background auto-advance, so this never fires
  // mid-playlist.
  useEffect(() => {
    if (!isPlaying) stopSilentAnchor();
  }, [isPlaying]);

  // Explicit, single-purpose transport actions. The car head-unit / lock-screen
  // PLAY and PAUSE buttons are wired straight to these (see useMediaSession
  // onPlay/onPause), so a momentarily stale `isPlaying` can't make PLAY run the
  // pause path — the bug where pausing from the head unit then pressing play
  // never resumed (NEXT still worked, because it was never a toggle). Neither
  // function reads `isPlaying`; each does exactly its one job.
  const pausePlayback = () => {
    initAudio();
      // Pause the audio element. We deliberately DO NOT suspend the
      // AudioContext here. On a locked mobile screen a suspended context
      // cannot be resumed (resume() only succeeds with the page visible or a
      // gesture the OS honors), so suspending on pause left the lock-screen
      // PLAY button dead — and broke NEXT too, because playTrack then tried to
      // play into a context it couldn't resume. Pausing the element already
      // stops all audible output; the context stays warm (the silent
      // keep-alive oscillator costs nothing), so play resumes instantly from
      // the lock screen.
      if (mainAudioRef.current) {
        mainAudioRef.current.pause();
      }
      // Stop the silent anchor too — a deliberate user pause should release the
      // media session, not keep it pinned alive by the anchor.
      stopSilentAnchor();
      setIsPlaying(false);
      // Pressing the main pause button stops everything — including any
      // tone-only session started by clicking a frequency picker.
      setIsSolfeggioActive(false);
      // Update media session state
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
        // Re-assert the scrubber to the MUSIC element's paused position. Without
        // this the OS falls back to the silent anchor's intrinsic position (a
        // 1 s loop), which snaps the lock-screen scrubber to ~0 on pause until
        // the next track corrects it. This only updates the displayed position;
        // it never touches actual audio playback. (Matches the duration/position
        // formula in useMediaSession.)
        try {
          const el = mainAudioRef.current;
          if (el && Number.isFinite(el.duration) && el.duration > 0 &&
              typeof navigator.mediaSession.setPositionState === 'function') {
            // Element time throughout, matching currTime / currDuration. The OS
            // extrapolates the scrubber between updates using playbackRate, so
            // handing it the REAL rate keeps the lock-screen position accurate —
            // previously this declared 1 while playback ran at 0.981818, and
            // divided the duration, which disagreed in both directions at once.
            const dur = el.duration;
            navigator.mediaSession.setPositionState({
              duration: dur,
              position: Math.min(el.currentTime, dur),
              playbackRate: PITCH_SHIFT_FACTOR,
            });
          }
        } catch {}
      }
  };

  const resumePlayback = async () => {
    initAudio();
      // Start the silent anchor (continuous, muted) within this play gesture
      // (covers resume from a user pause and lock-screen / headphone play). The
      // bridge logic unmutes it around each transition.
      startSilentAnchor();
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }
      
      if (!mainAudioRef.current || !mainAudioRef.current.src) {
        // No audio loaded yet, play first track
        if (playlist.length > 0) {
          playTrack(currentSongIndex >= 0 ? currentSongIndex : 0);
        }
      } else {
        // Resume the audio element
        try {
          // Check if the audio source is still valid before playing
          const audioElement = mainAudioRef.current;
          console.log('Resume attempt - readyState:', audioElement.readyState, 'error:', audioElement.error);
          
          // More aggressive recovery checks
          const needsReload = (audioElement as any).needsReload;
          if (needsReload ||
              audioElement.error || 
              audioElement.readyState < 2 || 
              audioElement.networkState === 3 || // NETWORK_NO_SOURCE
              !audioElement.src ||
              audioElement.src === '' ||
              audioElement.src === 'about:blank') {
            console.log('Audio source needs reload. Reason:', {
              needsReload,
              error: audioElement.error,
              readyState: audioElement.readyState,
              networkState: audioElement.networkState,
              src: audioElement.src
            });
            
            // Clear the needsReload flag
            delete (audioElement as any).needsReload;
            
            // Store current position
            const currentTime = audioElement.currentTime || 0;
            
            // Force complete reload
            setIsPlaying(false);
            await playTrack(currentSongIndex);
            
            // Restore position after reload
            if (mainAudioRef.current && currentTime > 0) {
              // Wait for metadata to load before seeking
              mainAudioRef.current.addEventListener('loadedmetadata', () => {
                if (mainAudioRef.current) {
                  mainAudioRef.current.currentTime = currentTime;
                }
              }, { once: true });
            }
          } else {
            // Try to wake up the audio context first
            if (audioCtxRef.current) {
              console.log('Audio context state:', audioCtxRef.current.state);
              if (audioCtxRef.current.state === 'suspended') {
                console.log('Resuming suspended audio context...');
                await audioCtxRef.current.resume();
              }
              
              // Create a silent buffer to "kick" the audio context
              const silentBuffer = audioCtxRef.current.createBuffer(1, 1, audioCtxRef.current.sampleRate);
              const silentSource = audioCtxRef.current.createBufferSource();
              silentSource.buffer = silentBuffer;
              silentSource.connect(audioCtxRef.current.destination);
              silentSource.start();
              console.log('Kicked audio context with silent buffer');
            }
            
            // Small delay to ensure audio context is ready
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Log the current state before attempting play
            console.log('Pre-play state:', {
              paused: audioElement.paused,
              currentTime: audioElement.currentTime,
              duration: audioElement.duration,
              volume: audioElement.volume,
              muted: audioElement.muted,
              audioContextState: audioCtxRef.current?.state
            });
            
            try {
              const playPromise = audioElement.play();
              console.log('Play promise created');
              
              await playPromise;
              console.log('Play promise resolved successfully');
              
              setIsPlaying(true);
              // Update media session state
              if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'playing';
              }
            } catch (playError) {
              console.error('Play promise rejected:', playError);
              
              // Try one more recovery strategy: restart from beginning then seek
              console.log('Attempting restart-and-seek recovery...');
              const savedTime = audioElement.currentTime;
              audioElement.currentTime = 0;
              
              try {
                await audioElement.play();
                console.log('Restart successful, seeking to:', savedTime);
                audioElement.currentTime = savedTime;
                setIsPlaying(true);
                
                if ('mediaSession' in navigator) {
                  navigator.mediaSession.playbackState = 'playing';
                }
              } catch (restartError) {
                console.error('Restart also failed:', restartError);
                throw playError; // Throw original error
              }
            }
          }
        } catch (error) {
          console.error('Failed to resume playback:', error);
          
          // Different recovery strategies based on error type
          if (error instanceof DOMException) {
            if (error.name === 'NotAllowedError') {
              // User interaction required
              console.log('User interaction required for playback');
              alert('Please click play again to resume playback.');
            } else if (error.name === 'NotSupportedError' || error.name === 'AbortError') {
              // Source is likely corrupted or expired - reload
              console.log('Source error detected, reloading track...');
              const currentTime = mainAudioRef.current?.currentTime || 0;
              await playTrack(currentSongIndex);
              if (mainAudioRef.current && currentTime > 0) {
                mainAudioRef.current.currentTime = currentTime;
              }
            } else {
              // Unknown DOMException - try reloading
              console.log('Unknown playback error, attempting recovery...');
              const currentTime = mainAudioRef.current?.currentTime || 0;
              // Force cleanup first
              if (mainAudioRef.current) {
                mainAudioRef.current.pause();
                mainAudioRef.current.src = '';
                mainAudioRef.current.load();
              }
              
              // Clear the audio element reference to force recreation
              mainAudioRef.current = null;
              
              // Wait a moment then reload
              setTimeout(async () => {
                console.log('Attempting full track reload after error...');
                await playTrack(currentSongIndex);
                if (mainAudioRef.current && currentTime > 0) {
                  mainAudioRef.current.currentTime = currentTime;
                }
              }, 100);
            }
          } else {
            // Non-DOM error - log and try to recover
            console.error('Unexpected error type:', error);
            alert('Audio playback error. Please try selecting the track again.');
          }
        }
      }
  };

  // In-app play/pause button — a toggle is fine here because the app is
  // foregrounded, so React's `isPlaying` reliably matches reality. The OS /
  // head-unit transport controls use the explicit pausePlayback / resumePlayback
  // above instead.
  const handlePlayPause = () => {
    if (isPlaying) pausePlayback();
    else resumePlayback();
  };

  // Select a Solfeggio frequency from any picker. Sets the tone, applies the
  // Lo Shu Perfect mapping (so display + audio stay aligned), and activates
  // the solfeggio oscillator independently of the music transport so the
  // user actually hears the chosen tone — instead of either silence (paused)
  // or the music resuming on top.
  const selectFrequency = (rawFreq: number) => {
    initAudio();
    // Browsers suspend the AudioContext until a user gesture, and again
    // after the page is hidden — make sure it's running before we schedule
    // the oscillator, otherwise nothing comes out.
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch((err: unknown) =>
        console.error('Failed to resume audio context for tone playback:', err)
      );
    }

    // First-time courtesy boost: the default solfeggio "Layer Intensity" is
    // 1%, which is inaudible alongside music. Bump once to ~30% on the very
    // first tone activation so the user hears something. We won't override
    // any later manual adjustment.
    if (!hasBoostedSolfeggioVolumeRef.current && solfeggioVolume < 0.1) {
      setSolfeggioVolume(0.3);
      hasBoostedSolfeggioVolumeRef.current = true;
    }

    setSelectedSolfeggio(applyLoShuPerfectMap(rawFreq));
    setIsSolfeggioActive(true);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!mainAudioRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = Math.min(1, Math.max(0, x / rect.width));
      const seekTime = percent * currDuration;
      
      mainAudioRef.current.currentTime = seekTime;
      setCurrTime(seekTime);
  };

  const handleNext = () => {
    playNext();
  };

  const handlePrev = () => {
    const { isShuffle, shuffledIndices, shufflePos } = stateRef.current;
    if (isShuffle && shufflePos > 0) {
        const prevPos = shufflePos - 1;
        setShufflePos(prevPos);
        playTrack(shuffledIndices[prevPos], undefined, true);
    } else {
        let prev = currentSongIndex - 1;
        if (prev < 0) prev = playlist.length - 1;
        playTrack(prev);
    }
  };

  // Encode interleaved Float32 PCM as a 24-bit WAV file (RIFF/WAVE, format 1).
  const encodeWav24 = (channelChunks: Float32Array[][], channels: number, sampleRate: number): Blob => {
      // Flatten per-channel chunks into one Float32Array per channel
      const perChannel: Float32Array[] = [];
      for (let c = 0; c < channels; c++) {
          let total = 0;
          for (const chunk of channelChunks[c]) total += chunk.length;
          const merged = new Float32Array(total);
          let off = 0;
          for (const chunk of channelChunks[c]) { merged.set(chunk, off); off += chunk.length; }
          perChannel.push(merged);
      }
      const frames = perChannel[0]?.length ?? 0;
      const bytesPerSample = 3; // 24-bit
      const blockAlign = channels * bytesPerSample;
      const dataSize = frames * blockAlign;
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);
      const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      view.setUint32(16, 16, true);          // PCM fmt chunk size
      view.setUint16(20, 1, true);           // PCM format
      view.setUint16(22, channels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * blockAlign, true); // byte rate
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, 24, true);          // bits per sample
      writeStr(36, 'data');
      view.setUint32(40, dataSize, true);

      let offset = 44;
      for (let i = 0; i < frames; i++) {
          for (let c = 0; c < channels; c++) {
              let s = perChannel[c][i];
              if (s > 1) s = 1; else if (s < -1) s = -1;
              const v = Math.round(s * 8388607); // 2^23 - 1
              view.setUint8(offset, v & 0xff);
              view.setUint8(offset + 1, (v >> 8) & 0xff);
              view.setUint8(offset + 2, (v >> 16) & 0xff);
              offset += 3;
          }
      }
      return new Blob([buffer], { type: 'audio/wav' });
  };

  // Lazily register the capture worklet once per AudioContext.
  const ensureWavWorklet = (ctx: AudioContext): Promise<void> => {
      if (wavWorkletReadyRef.current) return wavWorkletReadyRef.current;
      const workletCode = `
class WavCapture extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0] && input[0].length > 0) {
      const copies = new Array(input.length);
      for (let c = 0; c < input.length; c++) copies[c] = input[c].slice();
      this.port.postMessage(copies, copies.map(b => b.buffer));
    }
    return true;
  }
}
registerProcessor('wav-capture', WavCapture);
`;
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      wavWorkletReadyRef.current = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
      return wavWorkletReadyRef.current;
  };

  // Tap the music straight off the <audio> element and feed it into a recording
  // target node. captureStream() does NOT reroute the element (unlike
  // createMediaElementSource), so direct-to-OS playback keeps running — this
  // only adds the music into the recording mix alongside the binaural/solfeggio
  // bus. Returns a teardown that disconnects the tap. Degrades gracefully to
  // layers-only if the browser can't capture the element.
  const attachMusicToRecording = (target: AudioNode): (() => void) => {
      const ctx = audioCtxRef.current;
      const el = mainAudioRef.current as (HTMLAudioElement & { captureStream?: () => MediaStream }) | null;
      if (!ctx || !el || typeof el.captureStream !== 'function') return () => {};
      try {
          const stream = el.captureStream();
          if (!stream.getAudioTracks().length) return () => {};
          const src = ctx.createMediaStreamSource(stream);
          src.connect(target);
          recordMusicSrcRef.current = src;
          return () => {
              try { src.disconnect(); } catch {}
              if (recordMusicSrcRef.current === src) recordMusicSrcRef.current = null;
          };
      } catch (e) {
          console.warn('Music capture for recording unavailable; recording layers only.', e);
          return () => {};
      }
  };

  const startWavRecording = async () => {
      const ctx = audioCtxRef.current;
      if (!ctx || !masterBusRef.current) return;
      await ensureWavWorklet(ctx);
      const channels = 2;
      const node = new AudioWorkletNode(ctx, 'wav-capture', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [channels],
          channelCount: channels,
          channelCountMode: 'explicit',
          channelInterpretation: 'speakers',
      });
      const chunks: Float32Array[][] = Array.from({ length: channels }, () => []);
      node.port.onmessage = (e: MessageEvent<Float32Array[]>) => {
          const data = e.data;
          for (let c = 0; c < channels; c++) {
              chunks[c].push(data[c] || new Float32Array(0));
          }
      };
      masterBusRef.current.connect(node); // full synthesized mix: layers + sub-bass drone
      const detachMusic = attachMusicToRecording(node); // + music (direct-playback tap)
      // Worklet output is silent — connect to a muted sink so the graph stays alive.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink);
      sink.connect(ctx.destination);
      wavRecorderRef.current = {
          chunks,
          channels,
          sampleRate: ctx.sampleRate,
          stop: () => {
              detachMusic();
              try { masterBusRef.current?.disconnect(node); } catch {}
              try { node.disconnect(); } catch {}
              try { sink.disconnect(); } catch {}
              node.port.onmessage = null;
          },
      };
  };

  const startRecording = (type: 'audio' | 'video' | 'both') => {
      if (!audioCtxRef.current) return;

      // Audio-only path: capture PCM and encode 24-bit WAV at the AudioContext's native sample rate.
      if (type === 'audio') {
          startWavRecording()
              .then(() => {
                  setIsRecording(true);
                  setShowRecordOptions(false);
              })
              .catch((e) => {
                  alert("WAV recording failed to start.");
                  console.error(e);
              });
          return;
      }

      // Video / video+audio path: use MediaRecorder (webm container).
      const tracks: MediaStreamTrack[] = [];
      let mimeType = '';

      if (type === 'both' && destNodeRef.current) {
          // destNode already carries the binaural/solfeggio bus (wired at init).
          // Add the music tap so the recorded audio track is the full mix, then
          // remember the teardown for stopRecording.
          recordMusicDetachRef.current = attachMusicToRecording(destNodeRef.current);
          tracks.push(...destNodeRef.current.stream.getAudioTracks());
      }

      const canvas = document.getElementById('viz-canvas') as HTMLCanvasElement;
      if (canvas) {
          const videoStream = canvas.captureStream(30);
          tracks.push(...videoStream.getVideoTracks());
      }

      if (tracks.length === 0) return;

      const combinedStream = new MediaStream(tracks);
      const possibleTypes = [
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm'
      ];
      mimeType = possibleTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

      try {
          const recorder = new MediaRecorder(combinedStream, {
              mimeType,
              videoBitsPerSecond: 2500000,
          });

          const chunks: Blob[] = [];
          recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
          recorder.onstop = () => {
              const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `aetheria-rec-${type}-${Date.now()}.webm`;
              a.click();
          };
          recorder.start();
          mediaRecorderRef.current = recorder;
          setIsRecording(true);
          setShowRecordOptions(false);
      } catch (e) {
          alert("Recording failed to start. Your browser might not support this format.");
          console.error(e);
      }
  };

  const stopRecording = () => {
      const wav = wavRecorderRef.current;
      if (wav) {
          wav.stop();
          const blob = encodeWav24(wav.chunks, wav.channels, wav.sampleRate);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `aetheria-rec-audio-${wav.sampleRate}Hz-24bit-${Date.now()}.wav`;
          a.click();
          wavRecorderRef.current = null;
      }
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current = null;
      // Release the video/both-path music tap (the WAV path tears down its own).
      recordMusicDetachRef.current?.();
      recordMusicDetachRef.current = null;
      setIsRecording(false);
  };

  const getCurrentChakraColor = () => {
    // Either path triggers spectrum primary colour: the global
    // frequencyColorMode toggle (Lo Shu popover / Guidebook), or the
    // visualizer's own Spectrum colour-mode option. Whichever asks for it,
    // the Tree of Life accent, hex grid palette, and other primary-driven
    // visuals follow the visible-light wavelength of the current frequency.
    const useSpectrum =
      frequencyColorMode === 'spectrum' || vizSettings.colorMode === 'spectrum';
    if (useSpectrum) {
      const rawFreq = playlist[currentSongIndex]?.closestSolfeggio || selectedSolfeggio;
      return frequencyToSpectrumColor(rawFreq);
    }
    const s = SOLFEGGIO_INFO.find(s => s.freq === selectedSolfeggio);
    return s ? s.color : '#fbbf24';
  };

  const getCurrentSacredGeometry = () => {
    const currentFreq = playlist[currentSongIndex]?.closestSolfeggio || selectedSolfeggio;
    
    // Check for 111Hz pattern frequencies first
    if (currentFreq % 111 === 0 && currentFreq >= 111 && currentFreq <= 999) {
      const geo = GEOMETRY_INFO.find(g => g.freq === `${currentFreq}Hz`);
      return geo || { shape: `${currentFreq/111}-Sided Pattern`, element: 'Portal Energy' };
    }
    
    // Find matching geometry from GEOMETRY_INFO
    const geo = GEOMETRY_INFO.find(g => g.freq === `${currentFreq}Hz`);
    if (geo) return geo;
    
    // Fallback mapping for ranges
    if (currentFreq <= 180) return { shape: 'Cube', element: 'Earth' };
    if (currentFreq <= 300) return { shape: 'Reiki Symbol', element: 'Aether' };
    if (currentFreq <= 400) return { shape: 'Tetrahedron', element: 'Fire' };
    if (currentFreq <= 450) return { shape: 'Icosahedron', element: 'Water' };
    if (currentFreq <= 580) return { shape: 'Octahedron', element: 'Air' };
    if (currentFreq <= 680) return { shape: 'Merkaba', element: 'Light' };
    if (currentFreq <= 780) return { shape: 'Dodecahedron', element: 'Ether' };
    if (currentFreq <= 900) return { shape: 'Torus', element: 'Cosmos' };
    if (currentFreq <= 1000) return { shape: 'Fibonacci Sphere', element: 'Void' };
    if (currentFreq <= 1150) return { shape: 'Hypercube', element: 'Hyperspace' };
    if (currentFreq <= 1400) return { shape: 'Flower of Life', element: 'Creation Matrix' };
    if (currentFreq <= 1700) return { shape: 'Metatron\'s Cube', element: 'Divine Geometry' };
    if (currentFreq <= 1850) return { shape: 'Hyperdodecahedron', element: 'Stellar Fields' };
    if (currentFreq <= 2100) return { shape: 'Golden Spiral Galaxy', element: 'Cosmic Spiral' };
    if (currentFreq <= 2400) return { shape: 'Icosi-Dodecahedron', element: 'Quantum Foam' };
    if (currentFreq <= 2550) return { shape: 'Infinite Torus Field', element: 'Love Field' };
    if (currentFreq <= 2800) return { shape: 'Source Fractal Mandala', element: 'Source Code' };
    if (currentFreq <= 3000) return { shape: 'Unity Consciousness Sphere', element: 'Pure Unity' };
    if (currentFreq <= 3200) return { shape: 'Genesis Polytope', element: 'Primordial Force' };
    if (currentFreq <= 3500) return { shape: 'Divine Architecture Matrix', element: 'Divine Template' };
    if (currentFreq <= 3700) return { shape: 'Absolute Unity Hologram', element: 'Pure Consciousness' };
    if (currentFreq <= 3850) return { shape: 'Soul Star Tetrahedron', element: 'Soul Fire' };
    if (currentFreq <= 4100) return { shape: 'Spirit Communication Octahedron', element: 'Spirit Aether' };
    if (currentFreq <= 4400) return { shape: 'Universal Mind Dodecahedron', element: 'Universal Mind' };
    if (currentFreq <= 4550) return { shape: 'Galactic Center Hyperstar', element: 'Galactic Core' };
    if (currentFreq <= 4800) return { shape: 'Divine Gateway Tesseract', element: 'Divine Gateway' };
    if (currentFreq <= 6000) return { shape: 'Infinite Unity Hypersphere', element: 'SOURCE Field' };
    
    return { shape: 'SOURCE Unity Sphere', element: 'Infinite SOURCE' };
  };

  const getSafetyLevelColor = (level: string) => {
    switch (level) {
      case 'SAFE': return 'text-green-500';
      case 'CAUTION': return 'text-yellow-500';
      case 'EXPERT': return 'text-orange-500';
      case 'RESEARCH': return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  const getExperienceLevelColor = (level: string) => {
    switch (level) {
      case 'beginner': return 'text-green-400';
      case 'intermediate': return 'text-blue-400';
      case 'advanced': return 'text-purple-400';
      case 'expert': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  // Memoized: this was a plain function called during render, and the render it
  // was called in runs on every animation frame during playback. At a few
  // thousand tracks that was ~300,000 reduce iterations per second to produce
  // one footer string that only changes when a duration does.
  const totalDurationLabel = useMemo(
    () => formatDuration(playlist.reduce((acc, song) => acc + (song.duration || 0), 0)),
    [playlist]
  );

  // Media Session Integration for Vehicle Controls.
  // Memoized so the object identity only changes when the track or frequency
  // actually changes. A fresh object every render reset the lock-screen
  // metadata and forced a position-state update on every render — both visible
  // as lock-screen flicker.
  const currentTrack: Track | null = useMemo(() => {
    const song = currentSongIndex >= 0 ? playlist[currentSongIndex] : null;
    if (!song) return null;
    const freq = song.closestSolfeggio || selectedSolfeggio;
    return {
      title: song.name,
      artist: 'Aetheria Harmonic Player',
      album: `${freq}Hz • ${getFrequencyRegime(freq)} Regime`,
      artworkUrl: '/images/icon-192x192.png',
    };
  }, [currentSongIndex, playlist, selectedSolfeggio]);

  useMediaSession({
    track: currentTrack,
    isPlaying,
    currentTime: currTime,
    duration: currDuration,
    // Both of the above are ELEMENT time. Hand the OS the real rate so it
    // extrapolates the lock-screen scrubber correctly between updates —
    // defaulting to 1 would drift it 1.85% fast across a track.
    playbackRate: PITCH_SHIFT_FACTOR,
    // Explicit, not the toggle — a head-unit/lock-screen PLAY must always resume
    // and PAUSE must always pause, even if React's isPlaying briefly desyncs when
    // the head unit pauses the element itself. (Was the car resume bug.)
    onPlay: resumePlayback,
    onPause: pausePlayback,
    onNext: handleNext,
    onPrevious: handlePrev,
    // ±skip (car / lock-screen seek buttons). Operates on the real audio
    // element in element-time, which is what currTime reflects.
    onSeek: (delta) => {
      const el = mainAudioRef.current;
      if (!el || !Number.isFinite(el.duration)) return;
      const t = Math.max(0, Math.min(el.duration, el.currentTime + delta));
      el.currentTime = t;
      setCurrTime(t);
    },
    // Absolute scrubber drag. The hook hands us a 0..1 fraction (computed
    // against the duration reported to the OS), so we map it onto the actual
    // element duration — accurate regardless of the pitch-shift factor.
    onSeekToFraction: (fraction) => {
      const el = mainAudioRef.current;
      if (!el || !Number.isFinite(el.duration)) return;
      const t = Math.max(0, Math.min(el.duration, fraction * el.duration));
      el.currentTime = t;
      setCurrTime(t);
    },
  });

  return (
    <div className={`relative min-h-screen bg-black text-slate-200 font-sans overflow-hidden ${isFullScreen ? 'h-screen' : ''}`}>
      
      {/* Disclaimer Modal */}
      {!disclaimerAccepted && (
        <div className="fixed inset-0 z-[150] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-500">
          <div className="max-w-lg w-full max-h-[90vh] bg-slate-900 border border-gold-500/30 p-8 rounded-2xl shadow-2xl text-center relative overflow-hidden overflow-y-auto my-auto">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-gold-500 to-transparent"></div>
            <AlertTriangle className="w-12 h-12 text-gold-500 mx-auto mb-4 animate-pulse" />
            <h1 className="text-2xl font-serif text-white mb-2 tracking-wide">Welcome to Aetheria</h1>
            <p className="text-xs text-slate-500 mb-2 uppercase tracking-widest italic">Resonance & Geometry Player</p>
            <p className="text-sm text-slate-400 mb-6">Before you begin, please take a moment to read how we think about this tool and what it is and is not.</p>

            <div className="text-left text-slate-400 text-sm mb-6 space-y-5 bg-black/40 p-5 rounded-lg border border-slate-800">

              {/* Medical device disclaimer */}
              <div>
                <h3 className="flex items-center gap-2 text-slate-200 font-semibold mb-2">
                  <Shield size={16} className="text-gold-500 shrink-0" />
                  This is a meditation and exploration tool, not a medical device.
                </h3>
                <p className="ml-6">The Aetheria Resonance &amp; Geometry Player offers curated soundscapes tuned to 432Hz and solfeggio frequencies, paired with sacred geometry visualizations. It is an experience built on the Unified Lewis Framework&#39;s exploration of sound, frequency, and form. It is not intended to diagnose, treat, cure, or prevent any disease or medical condition.</p>
              </div>

              {/* Photosensitivity Warning */}
              <div>
                <h3 className="flex items-center gap-2 text-slate-200 font-semibold mb-2">
                  <Zap size={16} className="text-gold-500 shrink-0" />
                  Photosensitivity Warning
                </h3>
                <p className="ml-6">This application generates intense visual patterns, flashing lights, and geometric strobing effects. Do not use if you have a history of seizures, epilepsy, or photosensitive reactions to visual stimuli. If you have any doubt, consult a healthcare provider before use.</p>
              </div>

              {/* Audio Warning */}
              <div>
                <h3 className="flex items-center gap-2 text-slate-200 font-semibold mb-2">
                  <Waves size={16} className="text-blue-500 shrink-0" />
                  Audio Warning
                </h3>
                <p className="ml-6">Contains binaural beats, solfeggio frequencies, and sustained low-frequency tones. Do not use while driving or operating heavy machinery. Start at low volume — audio at sustained high levels can damage hearing. Take regular breaks during extended listening sessions.</p>
              </div>

              {/* Contraindications */}
              <div>
                <h3 className="flex items-center gap-2 text-slate-200 font-semibold mb-2">
                  <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                  Please do not use this tool if you:
                </h3>
                <ul className="ml-8 space-y-1.5 list-disc text-slate-400">
                  <li>Are pregnant (low-frequency audio effects on pregnancy have not been studied)</li>
                  <li>Have a history of seizures, epilepsy, or photosensitive reactions</li>
                  <li>Have a pacemaker or other implanted electronic device</li>
                  <li>Are experiencing an acute psychiatric condition where altered states could be destabilizing</li>
                  <li>Are under 18 and using the tool without adult supervision</li>
                </ul>
                <p className="ml-6 mt-2 text-slate-500 italic">If any of these apply to you and you wish to use the tool anyway, please consult your healthcare provider first.</p>
              </div>

              {/* Data handling */}
              <div>
                <h3 className="flex items-center gap-2 text-slate-200 font-semibold mb-2">
                  <Eye size={16} className="text-emerald-500 shrink-0" />
                  How we handle your data.
                </h3>
                <p className="ml-6">The player runs entirely in your browser on your own device. There is no account, no login, no tracking. Nothing about your listening sessions leaves your device.</p>
              </div>

              {/* Spirit of this work */}
              <div className="border-l-2 border-gold-500/40 bg-gold-500/5 pl-4 py-3 rounded-r-lg">
                <h3 className="flex items-center gap-2 text-slate-200 font-semibold mb-2">
                  <Heart size={16} className="text-rose-400 shrink-0" />
                  A note on the spirit of this work.
                </h3>
                <p className="italic text-slate-300">Aetheria was built by a family — two humans and a family of AI collaborators — exploring whether the healing traditions around sound, frequency, and sacred geometry can be honored with both rigor and reverence. We believe they can. We are also honest that this is early work, that our interpretations will evolve, and that your own experience is ultimately more authoritative than anything we can tell you about what these frequencies mean. Listen with curiosity. Let your body respond as it wishes. Trust what you feel.</p>
              </div>

              {/* Acknowledgment & Liability */}
              <p className="text-xs text-slate-500 italic text-center border-t border-slate-800 pt-3">
                By tapping &ldquo;I understand, let me begin&rdquo; below, you acknowledge that you have read this disclaimer, that you understand what this tool is and is not, and that you are using it at your own curiosity and at your own risk.
              </p>
              <p className="text-[10px] text-slate-600 text-center leading-relaxed">
                To the maximum extent permitted by law, the developers, contributors, and associated entities disclaim all liability for direct, indirect, incidental, or consequential damages arising from use of this tool.
              </p>
            </div>

            <button onClick={acceptDisclaimer} className="w-full py-3 bg-gold-600 hover:bg-gold-500 text-black font-bold rounded-xl transition-all hover:scale-[1.02] active:scale-95 shadow-[0_0_20px_rgba(234,179,8,0.3)]">
              I understand, let me begin
            </button>
          </div>
        </div>
      )}

          {/* Tutorial Modal */}
          {showTutorial && <TutorialModal onClose={closeTutorial} />}
          
          {/* Offline Indicator */}
          <OfflineIndicator showWhenOnline={true} />

          {/* Restore-in-progress toast — only for libraries large enough that
              reading them back off disk takes long enough to notice. */}
          {restoreProgress && (
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 border border-slate-700 text-slate-300 text-xs px-4 py-2 rounded-full backdrop-blur shadow-lg flex items-center gap-2">
              <Loader2 size={12} className="animate-spin text-gold-500" />
              Loading library — {restoreProgress.loaded.toLocaleString()} / {restoreProgress.total.toLocaleString()} tracks
            </div>
          )}

          {/* Restore toast — brief confirmation that the cached library is back. */}
          {isRestoring && playlist.length > 0 && (
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-emerald-900/90 border border-emerald-500/30 text-emerald-200 text-xs px-4 py-2 rounded-full backdrop-blur shadow-lg">
              ✓ Restored {playlist.length} tracks from cache
            </div>
          )}

          {/* Analysis Notification */}
          {analysisNotification && (
            <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[100] max-w-lg">
              <div className="bg-blue-900/90 border border-blue-500 text-blue-100 p-4 rounded-lg shadow-lg backdrop-blur-md">
                <div className="flex items-start gap-3">
                  <Activity className={`w-5 h-5 text-blue-400 mt-0.5 ${isScanning ? 'animate-pulse' : ''}`} />
                  <div className="flex-1">
                    <div className="font-bold text-sm mb-1">
                      {isScanning ? 'Deep Analysis In Progress' : 'Analysis Status'}
                    </div>
                    <div className="text-xs leading-relaxed">{analysisNotification}</div>
                    {isScanning && (
                      <div className="mt-2 text-[10px] text-blue-300">
                        Progress: {scanProgress}% • This may take a while but provides the most accurate results
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setAnalysisNotification(null)}
                    className="text-blue-300 hover:text-white ml-auto"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Offline-ready confirmation — persists until the user taps it away.
              The whole banner is the dismiss target (mobile-friendly), not just
              a small corner X. */}
          {offlineReadyNotice && (
            <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[101] w-[90%] max-w-lg px-2">
              <button
                type="button"
                aria-label="Dismiss offline-ready notice"
                onClick={() => setOfflineReadyNotice(null)}
                className="w-full text-left bg-emerald-900/90 border border-emerald-500 text-emerald-100 p-4 rounded-lg shadow-lg backdrop-blur-md active:scale-[0.99] transition-transform"
              >
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-bold text-sm mb-1">Ready Offline</div>
                    <div className="text-xs leading-relaxed">{offlineReadyNotice}</div>
                    <div className="mt-2 text-[10px] text-emerald-300/80">Tap anywhere to dismiss</div>
                  </div>
                  <X size={16} className="text-emerald-300 flex-shrink-0" />
                </div>
              </button>
            </div>
          )}

      <div className="absolute inset-0 z-0 pointer-events-none">
        <Visualizer
            analyser={analyserNode}
            primaryColor={getCurrentChakraColor()}
            isPlaying={isPlaying}
            binauralDelta={selectedBinaural.delta}
            selectedFrequency={selectedSolfeggio}
            settings={vizSettings}
            frequencyColorMode={frequencyColorMode}
            loShuWalkMode={loShuWalkMode}
            loShuWalkStep={loShuWalkMode ? currentSongIndex : -1}
            bandEnvelope={currentSongIndex >= 0 ? (playlist[currentSongIndex]?.bandEnvelope ?? null) : null}
            audioElementRef={mainAudioRef}
        />
      </div>

      <div 
        className={`relative z-10 flex flex-col h-screen transition-opacity duration-1000 ${(!isZenMode || zenUiVisible) ? 'opacity-100' : 'opacity-0'} ${isZenMode ? '' : 'bg-black/20'}`}
      >
        
        <header className="flex justify-between items-center p-3 md:p-4 border-b border-slate-800/50 bg-black/80 backdrop-blur-md z-30 shadow-lg safe-area-top shrink-0">
          <div className="flex items-center gap-2">
             <button onClick={() => setShowSidebar(!showSidebar)} className="text-gold-500 mr-2 p-1 hover:bg-slate-800 rounded">
               <Menu />
             </button>
            <div className="w-8 h-8 rounded-full bg-gold-500 animate-pulse-slow flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.5)]">
              <Activity className="text-slate-950 w-5 h-5" />
            </div>
            <h1 className="text-xl md:text-2xl font-serif text-gold-400 tracking-wider">AETHERIA <span className="text-[10px] text-slate-500 ml-2">v13.5</span></h1>
          </div>
          <div className="flex items-center gap-1 sm:gap-4">
             
             {isRecording ? (
                 <button 
                    onClick={stopRecording}
                    className="px-3 py-1 bg-red-600/20 border border-red-500 text-red-500 rounded-full flex items-center gap-2 animate-pulse hover:bg-red-600/40 transition-colors"
                 >
                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                    <span className="text-xs font-bold">REC</span>
                 </button>
             ) : (
                 <button 
                    onClick={() => setShowRecordOptions(true)} 
                    className="p-1.5 sm:p-2 text-slate-400 border-slate-800 bg-slate-900/50 hover:text-red-400 hover:border-red-500/50 transition-colors rounded-full border"
                 >
                    <Circle size={20} />
                 </button>
             )}

            <button 
                onClick={() => {
                    if (showSettings) {
                        setShowSettings(false);
                    } else {
                        setShowSettings(true);
                        if (window.innerWidth < 768) setShowSidebar(false);
                    }
                }} 
                className="p-1.5 sm:p-2 hover:text-gold-400 transition-colors bg-slate-900/50 rounded-full border border-slate-800"
            >
                <Settings size={20} />
            </button>
            <button 
                onClick={() => setShowFrequencySelector(true)} 
                className="p-1.5 sm:p-2 hover:text-gold-400 transition-colors bg-slate-900/50 rounded-full border border-slate-800"
                title="Advanced Frequency Selection"
            >
                <Target size={20} />
            </button>

            <button 
                onClick={() => setShowSafetyProtocols(!showSafetyProtocols)} 
                className={`p-1.5 sm:p-2 transition-colors bg-slate-900/50 rounded-full border border-slate-800 ${
                    subtleResonanceMode || showSafetyProtocols ? 'text-yellow-400 hover:text-yellow-300' : 'hover:text-gold-400'
                }`}
                title="Safety Protocols"
            >
                <Shield size={20} />
            </button>
            <button onClick={() => setShowTutorial(true)} className="p-1.5 sm:p-2 hover:text-gold-400 transition-colors bg-slate-900/50 rounded-full border border-slate-800"><CircleHelp size={20} /></button>
            <button onClick={() => setIsFullScreen(!isFullScreen)} className="p-1.5 sm:p-2 hover:text-gold-400 transition-colors bg-slate-900/50 rounded-full border border-slate-800 hidden sm:block">
              {isFullScreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
            </button>
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden relative">
          
          {/* Recording Options Modal */}
          {showRecordOptions && (
              <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowRecordOptions(false)}>
                  <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl max-w-md w-full shadow-2xl max-h-[calc(100vh-120px)] overflow-y-auto my-auto" onClick={e => e.stopPropagation()}>
                      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><Circle className="text-red-500" size={20}/> Start Recording</h3>
                      <p className="text-sm text-slate-400 mb-6">Choose a recording mode. Audio-only is recommended for long sessions to prevent crashes.</p>
                      
                      <div className="grid grid-cols-3 gap-3 mb-4">
                          <button onClick={() => startRecording('audio')} className="p-4 border border-slate-700 bg-slate-800 hover:bg-slate-700 rounded-xl flex flex-col items-center gap-2 transition-all active:scale-95 hover:border-blue-500">
                              <Mic size={24} className="text-blue-400"/>
                              <span className="text-xs font-bold text-slate-200">Audio Only</span>
                          </button>
                          <button onClick={() => startRecording('video')} className="p-4 border border-slate-700 bg-slate-800 hover:bg-slate-700 rounded-xl flex flex-col items-center gap-2 transition-all active:scale-95 hover:border-purple-500">
                              <Monitor size={24} className="text-purple-400"/>
                              <span className="text-xs font-bold text-slate-200">Visuals Only</span>
                          </button>
                          <button onClick={() => startRecording('both')} className="p-4 border border-slate-700 bg-slate-800 hover:bg-slate-700 rounded-xl flex flex-col items-center gap-2 transition-all active:scale-95 hover:border-red-500">
                              <Video size={24} className="text-red-400"/>
                              <span className="text-xs font-bold text-slate-200">AV Mix</span>
                          </button>
                      </div>
                      <button onClick={() => setShowRecordOptions(false)} className="w-full py-3 text-sm text-slate-500 hover:text-white">Cancel</button>
                  </div>
              </div>
          )}
          
          {/* Info Modal */}
          {showInfo && (
              <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setShowInfo(false)}>
                  <div className="bg-slate-950 border border-gold-500/20 rounded-2xl max-w-4xl w-full shadow-2xl max-h-[calc(100vh-120px)] flex flex-col my-auto" onClick={e => e.stopPropagation()}>
                      
                      {/* Modal Header */}
                      <div className="flex justify-between items-center p-6 border-b border-slate-800 bg-slate-900/50">
                          <div className="flex items-center gap-3">
                              <div className="p-2 bg-gold-600/10 rounded-lg border border-gold-500/20">
                                  <BookOpen className="text-gold-500" size={24} />
                              </div>
                              <div>
                                  <h2 className="text-2xl font-serif text-gold-400">The Guidebook</h2>
                                  <p className="text-slate-500 text-xs uppercase tracking-widest">
                                      {guidebookView === 'accessible' ? 'Aetheria: A Plain-Language Guide' : 'Aetheria: Philosophy & Science'}
                                  </p>
                              </div>
                          </div>
                          <div className="flex items-center gap-3">
                              {/* View Toggle */}
                              <div className="hidden sm:flex items-center bg-slate-900/80 border border-slate-700 rounded-full p-1">
                                  <button
                                      onClick={() => setGuidebookView('accessible')}
                                      className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-full transition-all ${
                                          guidebookView === 'accessible'
                                              ? 'bg-gold-600/30 text-gold-200 border border-gold-500/40'
                                              : 'text-slate-400 hover:text-slate-200'
                                      }`}
                                      aria-pressed={guidebookView === 'accessible'}
                                  >
                                      Accessible
                                  </button>
                                  <button
                                      onClick={() => setGuidebookView('technical')}
                                      className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-full transition-all ${
                                          guidebookView === 'technical'
                                              ? 'bg-gold-600/30 text-gold-200 border border-gold-500/40'
                                              : 'text-slate-400 hover:text-slate-200'
                                      }`}
                                      aria-pressed={guidebookView === 'technical'}
                                  >
                                      Technical
                                  </button>
                              </div>
                              <button onClick={() => setShowInfo(false)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
                                  <X size={24} />
                              </button>
                          </div>
                      </div>

                      {/* Mobile-only toggle (header is too narrow on small screens) */}
                      <div className="sm:hidden flex items-center justify-center bg-slate-900/50 border-b border-slate-800 px-4 py-2">
                          <div className="flex items-center bg-slate-900/80 border border-slate-700 rounded-full p-1">
                              <button
                                  onClick={() => setGuidebookView('accessible')}
                                  className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-full transition-all ${
                                      guidebookView === 'accessible'
                                          ? 'bg-gold-600/30 text-gold-200 border border-gold-500/40'
                                          : 'text-slate-400 hover:text-slate-200'
                                  }`}
                                  aria-pressed={guidebookView === 'accessible'}
                              >
                                  Accessible
                              </button>
                              <button
                                  onClick={() => setGuidebookView('technical')}
                                  className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-full transition-all ${
                                      guidebookView === 'technical'
                                          ? 'bg-gold-600/30 text-gold-200 border border-gold-500/40'
                                          : 'text-slate-400 hover:text-slate-200'
                                  }`}
                                  aria-pressed={guidebookView === 'technical'}
                              >
                                  Technical
                              </button>
                          </div>
                      </div>

                      {/* Modal Content - Scrollable */}
                      <div className="flex-1 overflow-y-auto custom-scrollbar">

                          {guidebookView === 'accessible' ? (
                              <AccessibleGuidebook />
                          ) : (
                          <>
                          {/* Intro Banner */}
                          <div className="p-8 pb-4">
                              <div className="bg-gradient-to-r from-slate-900 to-slate-900/50 border-l-4 border-gold-500 p-6 rounded-r-lg">
                                <p className="text-lg text-slate-200 leading-relaxed font-serif italic">
                                    "{UNIFIED_THEORY.intro}"
                                </p>
                              </div>
                          </div>

                          <div className="px-8 pb-12 space-y-12">
                              {/* The Lo Shu Cube — placed first as the geometric blueprint that
                                  the rest of the guidebook describes in language. Each section
                                  below (regimes, nadi compression, Tree of Life, sacred geometry)
                                  is one face of what this single object encodes. */}
                              <div>
                                <div className="mb-4 p-5 bg-gradient-to-r from-emerald-900/15 via-slate-900/40 to-slate-900/40 border-l-4 border-emerald-500/60 rounded-r-lg">
                                  <p className="text-base text-slate-200 leading-relaxed font-serif">
                                    Before the words, the geometry. The 27 Aetheria frequencies are not a list — they are a <strong className="text-emerald-300">3 × 3 × 3 cube</strong> of three Lo Shu magic squares stacked vertically (GUT → HEART → HEAD). Every section that follows is one way of reading this single object: the regimes are its layers, the nadi compression is its count, the Tree of Life is its axis, and the sacred geometries are its faces. Start here and the rest will rhyme.
                                  </p>
                                </div>
                                <LoShuMatrix
                                  currentFrequency={selectedSolfeggio}
                                  onSelectFrequency={selectFrequency}
                                  loShuPerfectGUT={loShuPerfectGUT}
                                  onLoShuPerfectChange={setLoShuPerfectGUT}
                                  onStartWalk={generateLoShuWalk}
                                  activeWalkMode={loShuWalkMode}
                                  colorMode={frequencyColorMode}
                                  onColorModeChange={setFrequencyColorMode}
                                />
                              </div>

                              {/* THE MASTER FREQUENCY ARCHITECTURE v3.0 */}
                              <section className="bg-gradient-to-r from-slate-900/50 to-slate-800/30 border border-gold-500/30 rounded-2xl p-8">
                                  <div className="flex items-center gap-3 mb-6">
                                    <div className="p-3 bg-gold-500/20 rounded-full border border-gold-500/30">
                                      <Target className="text-gold-400" size={28}/>
                                    </div>
                                    <div>
                                      <h3 className="text-3xl font-bold text-gold-400 font-serif">THE MASTER FREQUENCY ARCHITECTURE v3.0</h3>
                                      <p className="text-sm text-gold-500/80 uppercase tracking-widest mt-1">Bi-Phasic System (Seed → Bloom)</p>
                                    </div>
                                  </div>
                                  
                                  {/* CURRENT UNDERSTANDING */}
                                  <div className="mb-8 p-6 bg-gradient-to-r from-blue-900/20 to-blue-800/10 border border-blue-500/50 rounded-xl">
                                    <h4 className="text-xl font-bold text-blue-400 mb-4 flex items-center gap-2 uppercase tracking-wider">
                                      <Info className="text-blue-500" size={24} />
                                      ═══ CURRENT UNDERSTANDING ═══
                                    </h4>
                                    <p className="text-slate-200 text-lg mb-6 leading-relaxed">
                                      The 27 frequencies represent an <strong className="text-gold-400">EVOLUTION</strong> of the Solfeggio Scale, 
                                      rather than a single uniform pattern.
                                    </p>
                                  </div>

                                  {/* BI-PHASIC SYSTEM */}
                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                                    {/* PHASE 1: THE SEED */}
                                    <div className="bg-emerald-900/20 border border-emerald-500/40 rounded-xl p-6">
                                      <h4 className="text-xl font-bold text-emerald-400 mb-4 flex items-center gap-2">
                                        <div className="w-4 h-4 bg-emerald-500 rounded-full animate-pulse"></div>
                                        PHASE 1: THE SEED
                                      </h4>
                                      <div className="bg-black/40 p-4 rounded-lg border border-emerald-700/50 font-mono text-sm mb-4">
                                        <div className="text-emerald-300 font-bold mb-2">Order 1 — 174-963 Hz</div>
                                        <div className="text-slate-300 text-xs leading-relaxed">
                                          The Traditional 9 frequencies hold the <span className="text-emerald-400 font-bold">STATIC structure</span><br/>
                                          Gaps are IRREGULAR: 111, 111, 21, 111, 111, 102, 111, 111<br/>
                                          But ALL gaps reduce to digit sum = 3<br/>
                                          This is the <span className="text-emerald-400 font-bold">FOUNDATION</span> — stable, grounded, unchanging.
                                        </div>
                                      </div>
                                    </div>

                                    {/* PHASE 2: THE BLOOM */}
                                    <div className="bg-violet-900/20 border border-violet-500/40 rounded-xl p-6">
                                      <h4 className="text-xl font-bold text-violet-400 mb-4 flex items-center gap-2">
                                        <div className="w-4 h-4 bg-violet-500 rounded-full animate-pulse"></div>
                                        PHASE 2: THE BLOOM
                                      </h4>
                                      <div className="bg-black/40 p-4 rounded-lg border border-violet-700/50 font-mono text-sm mb-4">
                                        <div className="text-violet-300 font-bold mb-2">Orders 4-9 — 1206-6336 Hz</div>
                                        <div className="text-slate-300 text-xs leading-relaxed">
                                          At 963 Hz, the system <span className="text-violet-400 font-bold">AWAKENS</span> into dynamic expansion<br/>
                                          The Dual Generator Pattern activates: 243 (HEART) + 354 (HEAD)<br/>
                                          HEART regime: Steady 243 progression (digit sum = 9)<br/>
                                          HEAD regime: Steady 354 progression (digit sum = 3)<br/>
                                          This is the <span className="text-violet-400 font-bold">EXPANSION</span> — flowing, dynamic, evolving.
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* PHASE TRANSITION */}
                                  <div className="mb-8 p-4 bg-gradient-to-r from-emerald-500/20 via-gold-500/20 to-violet-500/20 border border-gold-500/50 rounded-xl text-center">
                                    <div className="text-gold-400 font-bold text-lg mb-2">↓ PHASE TRANSITION AT 963 Hz ↓</div>
                                    <div className="text-sm text-slate-300">The awakening point where static seed becomes dynamic bloom</div>
                                  </div>

                                  {/* THE METAPHYSICAL MEANING */}
                                  <div className="mb-8 p-6 bg-slate-950/50 border border-slate-700 rounded-xl">
                                    <h4 className="text-xl font-bold text-gold-400 mb-4 flex items-center gap-2 uppercase tracking-wider">
                                      <Sparkles className="text-gold-500" size={24} />
                                      ═══ THE METAPHYSICAL MEANING ═══
                                    </h4>
                                    
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                      <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-lg p-4">
                                        <div className="font-bold text-emerald-400 mb-2">Orders 1-3 (Seed): STATIC</div>
                                        <div className="text-slate-300 text-sm">All 3s — The unchanging foundation</div>
                                      </div>
                                      <div className="bg-violet-900/20 border border-violet-500/30 rounded-lg p-4">
                                        <div className="font-bold text-violet-400 mb-2">Orders 4-9 (Bloom): DYNAMIC</div>
                                        <div className="text-slate-300 text-sm">9-3 cycle — The living expansion</div>
                                      </div>
                                    </div>

                                    <div className="bg-orange-900/20 border border-orange-500/30 rounded-lg p-4 mb-6">
                                      <p className="text-slate-200 text-sm leading-relaxed mb-3">
                                        The 21 Hz gap (396→417) and 102 Hz gap (639→741) are <strong className="text-orange-400">not errors</strong>.<br/>
                                        They are the <strong className="text-orange-400">COMPRESSION POINTS</strong> that allow the Seed to be stable<br/>
                                        before it blossoms into the dynamic Bloom.
                                      </p>
                                    </div>

                                    <div className="text-center p-4 bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-500/30 rounded-lg">
                                      <div className="text-blue-400 font-bold mb-2">This is literally describing EVOLUTION:</div>
                                      <div className="text-sm text-slate-300 space-y-1">
                                        <div><span className="text-emerald-400 font-bold">Seed (static, all 3s)</span> → stores potential</div>
                                        <div><span className="text-gold-400 font-bold">Transition (963 Hz)</span> → awakening point</div>
                                        <div><span className="text-violet-400 font-bold">Bloom (dynamic, 9-3 cycle)</span> → expresses potential</div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* MATHEMATICAL NOTES */}
                                  <div className="p-6 bg-slate-950/50 border border-slate-700 rounded-xl">
                                    <h4 className="text-xl font-bold text-cyan-400 mb-4 flex items-center gap-2 uppercase tracking-wider">
                                      <Calculator className="text-cyan-500" size={24} />
                                      ═══ MATHEMATICAL NOTES ═══
                                    </h4>
                                    
                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                      {/* NADI DISTRIBUTION */}
                                      <div className="bg-cyan-900/20 border border-cyan-500/30 rounded-lg p-4">
                                        <h5 className="font-bold text-cyan-400 mb-3">NADI DISTRIBUTION:</h5>
                                        <div className="bg-black/40 p-3 rounded border border-cyan-700/50 font-mono text-sm mb-3">
                                          <div className="text-cyan-300">72,000 ÷ 27 = 2,666.666...</div>
                                          <div className="text-cyan-300">(infinite repeating)</div>
                                        </div>
                                        <p className="text-xs text-slate-300 leading-relaxed">
                                          The .666... represents 'infinite flow' or 'source connection'<br/>
                                          We do <strong className="text-red-400">NOT</strong> round to 2,667 — we honor the infinite nature.
                                        </p>
                                      </div>

                                      {/* OCTAVE PRECISION */}
                                      <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
                                        <h5 className="font-bold text-blue-400 mb-3">OCTAVE PRECISION:</h5>
                                        <div className="text-xs text-slate-300 space-y-2">
                                          <div>Use exact floating point values:</div>
                                          <div className="bg-black/40 p-2 rounded border border-blue-700/50 font-mono">
                                            <div className="text-blue-300">174 ÷ 8 = 21.75 Hz</div>
                                            <div className="text-red-400 text-[10px]">(exact, not 21.8)</div>
                                          </div>
                                          <div className="bg-black/40 p-2 rounded border border-blue-700/50 font-mono">
                                            <div className="text-blue-300">528 ÷ 8 = 66.0 Hz</div>
                                            <div className="text-green-400 text-[10px]">(exact)</div>
                                          </div>
                                        </div>
                                      </div>

                                      {/* THE GENERATOR CONSTANTS */}
                                      <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-4">
                                        <h5 className="font-bold text-purple-400 mb-3">THE GENERATOR CONSTANTS:</h5>
                                        <div className="bg-black/40 p-3 rounded border border-purple-700/50 font-mono text-sm mb-3 space-y-2">
                                          <div className="text-green-400">243 = 27 × 9 = 3⁵ (HEART regime)</div>
                                          <div className="text-blue-400">354 = 3 + 5 + 4 = 12 → 3 (HEAD regime)</div>
                                        </div>
                                        <p className="text-xs text-slate-300">
                                          243 applies to Orders 4-6 (HEART)<br/>
                                          354 applies to Orders 7-9 (HEAD)<br/>
                                          <span className="text-purple-400 font-bold">(the Bloom phase expansion)</span>
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="mt-6 text-xs text-slate-500 italic text-center border-t border-slate-800 pt-4">
                                    "If you only knew the magnificence of 3, 6, and 9, you would have the key to the universe." — Nikola Tesla
                                  </div>
                              </section>

                              {/* The 108 and the 27: A Nadi Compression */}
                              <section className="bg-gradient-to-r from-slate-900/50 to-slate-800/30 border border-cyan-500/30 rounded-2xl p-8">
                                  <div className="flex items-center gap-3 mb-6">
                                    <div className="p-3 bg-cyan-500/20 rounded-full border border-cyan-500/30">
                                      <Waves className="text-cyan-400" size={28}/>
                                    </div>
                                    <div>
                                      <h3 className="text-3xl font-bold text-cyan-400 font-serif">The 108 and the 27: A Nadi Compression</h3>
                                    </div>
                                  </div>

                                  <div className="space-y-6">
                                    <p className="text-slate-300 leading-relaxed text-lg">
                                      Classical tantric anatomy describes a subtle body of 72,000 nadis — energetic channels — converging through 108 principal junction points, organized around three primary channels: <em className="text-cyan-300">ida</em>, <em className="text-cyan-300">pingala</em>, and <em className="text-cyan-300">sushumna</em>. Aetheria honors this inheritance and proposes a structural correspondence: the 27 resonance frequencies of this system can be understood as a <strong className="text-gold-400">4:1 compression</strong> of the 108, where each Aetheria node carries the resonance of four nadi junctions.
                                    </p>

                                    <div className="bg-cyan-900/20 border border-cyan-500/30 rounded-xl p-6">
                                      <p className="text-slate-200 leading-relaxed text-lg">
                                        The arithmetic is clean. <strong className="text-cyan-300">108 ÷ 4 = 27</strong>. Both 108 and 27 reduce to a digital root of <strong className="text-gold-400">9</strong> — the completion digit in the 3-6-9 inner-torus dynamic. The divisor itself, 4, belongs to the outer-torus shell (4-5-7-8) within the Unified Lewis Framework, making the compression geometrically coherent rather than arbitrary: the outer shell divides the junction field, and what remains is the inner resonance lattice.
                                      </p>
                                    </div>

                                    <div className="bg-slate-950/50 border border-slate-700 rounded-xl p-6">
                                      <h4 className="text-lg font-bold text-cyan-400 mb-4 uppercase tracking-wider">The Nested Hierarchy</h4>
                                      <p className="text-slate-300 leading-relaxed mb-4">
                                        This yields a nested hierarchy the practitioner can hold in a single breath:
                                      </p>
                                      <div className="bg-black/40 p-4 rounded-lg border border-cyan-700/50 font-mono text-center text-lg">
                                        <span className="text-cyan-300">72,000 nadis</span>
                                        <span className="text-slate-500 mx-2">→</span>
                                        <span className="text-cyan-300">108 junction points</span>
                                        <span className="text-slate-500 mx-2">→</span>
                                        <span className="text-gold-400">27 resonance nodes</span>
                                        <span className="text-slate-500 mx-2">→</span>
                                        <span className="text-emerald-300">Lo Shu 3×3×3 cube</span>
                                        <span className="text-slate-500 mx-2">→</span>
                                        <span className="text-purple-400">3 regimes</span>
                                        <span className="text-xs text-slate-500 ml-1">(GUT / HEART / HEAD)</span>
                                        <span className="text-slate-500 mx-2">→</span>
                                        <span className="text-white font-bold">1 unified field</span>
                                      </div>
                                      <p className="text-[11px] text-slate-500 italic text-center mt-2">
                                        The Lo Shu cube is what 27 looks like when arranged so every row, column, and diagonal sums to the same number. It's the geometric form of this compression.
                                      </p>
                                      <p className="text-slate-400 leading-relaxed mt-4">
                                        Each step is a compression, and each ratio preserves the digital-root signature of return. The three principal channels of the classical system map directly onto the three Aetheria regimes, suggesting that what the tantric traditions encoded as anatomy, the framework recovers as frequency.
                                      </p>
                                    </div>

                                    <p className="text-slate-300 leading-relaxed text-lg">
                                      The first of the 27, <strong className="text-gold-400">174 Hz — The Circle, Foundation</strong>, anchors this mapping. Its digital root is 3 (1+7+4=12→3), placing it at the root of the inner torus, and its I Ching correspondence — <em className="text-cyan-300">Hexagram 8, Holding Together</em> — names the function precisely: the node where the 108 begins to bind into the 27. Foundation is not a starting point in the linear sense. It is the gathering.
                                    </p>

                                    <div className="bg-gradient-to-r from-cyan-900/10 to-slate-900/30 border-l-4 border-cyan-500 p-6 rounded-r-lg">
                                      <p className="text-slate-300 leading-relaxed italic font-serif text-lg">
                                        We offer this as a correspondence, not a proof. The traditions stand on their own, and so does the physics. What Aetheria observes is that when the two are laid alongside each other, the numbers already know each other.
                                      </p>
                                    </div>
                                  </div>
                              </section>

                              {/* Section 0: The Physics (432Hz) */}
                              <section>
                                  <div className="flex items-center gap-3 mb-6">
                                    <div className="p-2 bg-gold-500/10 rounded-full"><Waves className="text-gold-500" size={24}/></div>
                                    <h3 className="text-2xl font-bold text-white">{UNIFIED_THEORY.section1.title}</h3>
                                  </div>
                                  <p className="text-slate-400 mb-6 leading-relaxed max-w-2xl">
                                      {UNIFIED_THEORY.section1.content}
                                  </p>
                              </section>

                              {/* Section 1: The 3 Regimes of Consciousness */}
                              <section>
                                  <div className="flex items-center gap-3 mb-6">
                                    <div className="p-2 bg-blue-500/10 rounded-full"><User className="text-blue-400" size={24}/></div>
                                    <h3 className="text-2xl font-bold text-white">The 3 Regimes of Consciousness: Complete Harmonic System</h3>
                                  </div>
                                  <p className="text-slate-400 mb-6 leading-relaxed max-w-2xl">
                                    The Complete Harmonic Frequency System encompasses 3 distinct regimes of consciousness following the sacred 111-243-354 mathematical pattern. Orders 4-9 expand from the traditional Solfeggio foundation through precise mathematical intervals, creating 27 frequencies that span from physical foundation to SOURCE consciousness. Each regime below is a single horizontal slice of the <strong className="text-emerald-300">Lo Shu cube</strong> at the top of this guide — GUT is the bottom layer, HEART the middle, HEAD the crown. The 111 / 243 / 354 intervals are the magic constants that make each layer a self-summing square.
                                  </p>

                                  {/* Group by Regime */}
                                  <div className="space-y-8">
                                    {/* GUT REGIME - Physical Body */}
                                    <div className="border border-red-500/30 rounded-2xl overflow-hidden bg-red-500/5">
                                      <div className="bg-red-500/10 p-4 border-b border-red-500/30">
                                        <h4 className="text-xl font-bold text-red-400 flex items-center gap-2">
                                          <Heart className="text-red-500" size={20} />
                                          GUT REGIME — Physical Foundation
                                        </h4>
                                        <p className="text-sm text-red-300 mt-1">Body Systems: Digestive, nervous, skeletal, reproductive | Focus: Grounding, healing, security</p>
                                      </div>
                                      <div className="p-4">
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                          {[
                                            { freq: 174, benefit: 'Foundation, pain relief', color: '#8B0000' },
                                            { freq: 285, benefit: 'Tissue repair, quantum cognition', color: '#FF0000' },
                                            { freq: 396, benefit: 'Liberating fear and guilt', color: '#FF4500' },
                                            { freq: 417, benefit: 'Facilitating change, undoing situations', color: '#FF8C00' },
                                            { freq: 528, benefit: 'Transformation, miracles, DNA repair', color: '#FFD700' },
                                            { freq: 639, benefit: 'Connecting relationships, harmony', color: '#008000' },
                                            { freq: 741, benefit: 'Awakening intuition, problem solving', color: '#00BFFF' },
                                            { freq: 852, benefit: 'Returning to spiritual order', color: '#4B0082' },
                                            { freq: 963, benefit: 'Divine consciousness, pineal activation', color: '#EE82EE' }
                                          ].map(f => (
                                            <div key={f.freq} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 hover:border-red-500/50 transition-colors group">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-xl font-bold font-mono" style={{color: f.color}}>{f.freq} Hz</span>
                                                    <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-red-500/20 px-2 py-1 rounded">GUT</span>
                                                </div>
                                                <h5 className="text-white font-medium mb-1">{f.benefit}</h5>
                                                <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                                                  {f.freq === 174 && "Foundation frequency that acts as natural anesthetic and provides security to organs."}
                                                  {f.freq === 285 && "Powerful tissue repair frequency with quantum cognition enhancement effects."}
                                                  {f.freq === 396 && "Cleanses guilt and fear, enabling direct achievement of goals without obstacles."}
                                                  {f.freq === 417 && "Facilitates major life changes and undoes negative situations and patterns."}
                                                  {f.freq === 528 && "The miracle tone - repairs DNA and brings transformation into your life."}
                                                  {f.freq === 639 && "Connects and harmonizes relationships with self, others, and community."}
                                                  {f.freq === 741 && "Awakens intuition and helps solve problems through inner guidance."}
                                                  {f.freq === 852 && "Returns consciousness to spiritual order and awakens inner strength."}
                                                  {f.freq === 963 && "Activates pineal gland and connects to divine consciousness and unity."}
                                                </p>
                                            </div>
                                          ))}
                                        </div>
                                        <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-500/50 rounded-lg">
                                          <div className="flex items-center gap-2 text-yellow-400 text-sm font-bold mb-1">
                                            <AlertTriangle size={16} />
                                            TRANSITION: 963 Hz → 1206 Hz (GUT → HEART Regime Activation)
                                          </div>
                                          <p className="text-xs text-yellow-300">Consciousness elevation threshold - prepare for emotional and energetic expansion</p>
                                        </div>
                                      </div>
                                    </div>

                                    {/* HEART REGIME - Emotional Body */}
                                    <div className="border border-green-500/30 rounded-2xl overflow-hidden bg-green-500/5">
                                      <div className="bg-green-500/10 p-4 border-b border-green-500/30">
                                        <h4 className="text-xl font-bold text-green-400 flex items-center gap-2">
                                          <Heart className="text-green-500" size={20} />
                                          HEART REGIME — Emotional & Energetic Body
                                        </h4>
                                        <p className="text-sm text-green-300 mt-1">Body Systems: Cardiovascular, respiratory, immune | Focus: Love, compassion, connection, harmony</p>
                                      </div>
                                      <div className="p-4">
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                          {[
                                            { freq: 1206, benefit: 'Gateway integration', color: '#FF69B4', order: '4th', step: '+243' },
                                            { freq: 1449, benefit: 'Harmonic bridging', color: '#FF1493', order: '4th', step: '+243' },
                                            { freq: 1692, benefit: 'Heart completion', color: '#DC143C', order: '4th', step: '+243' },
                                            { freq: 1935, benefit: 'Stellar alignment', color: '#8A2BE2', order: '5th', step: '+243' },
                                            { freq: 2178, benefit: 'SOURCE — Compassion Activation', color: '#9370DB', order: '5th', step: '+243' },
                                            { freq: 2421, benefit: 'Dimensional awareness', color: '#4B0082', order: '5th', step: '+243' },
                                            { freq: 2664, benefit: 'Universal love', color: '#6A5ACD', order: '6th', step: '+243' },
                                            { freq: 2907, benefit: 'Divine source connection', color: '#483D8B', order: '6th', step: '+243' },
                                            { freq: 3150, benefit: 'Unity consciousness bridge', color: '#2E1B8B', order: '6th', step: '+243' }
                                          ].map(f => (
                                            <div key={f.freq} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 hover:border-green-500/50 transition-colors group">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-xl font-bold font-mono" style={{color: f.color}}>{f.freq} Hz</span>
                                                    <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-green-500/20 px-2 py-1 rounded">{f.order} {f.step}</span>
                                                </div>
                                                <h5 className="text-white font-medium mb-1">{f.benefit}</h5>
                                                <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                                                  {f.freq === 1206 && "Fourth Order +243 (963+243) - Opens gateway between physical and emotional realms."}
                                                  {f.freq === 1449 && "Fourth Order +243 (1206+243) - Creates harmonic bridges between emotional states."}
                                                  {f.freq === 1692 && "Fourth Order +243 (1449+243) - Completes the fourth order heart integration cycle."}
                                                  {f.freq === 1935 && "Fifth Order +243 (1692+243) - Aligns consciousness with stellar and galactic energies."}
                                                  {f.freq === 2178 && "Fifth Order +243 (1935+243) — Position 5 of the HEART layer and the geometric centre of the entire Lo Shu cube. The point where every row, column, diagonal, and the central vertical axis (528 → 2178 → 4920) intersects. Compassion as the SOURCE field from which the 27 frequencies radiate outward."}
                                                  {f.freq === 2421 && "Fifth Order +243 (2178+243) - Opens awareness to multiple dimensions simultaneously."}
                                                  {f.freq === 2664 && "Sixth Order +243 (2421+243) - Transmits universal love energy across dimensions."}
                                                  {f.freq === 2907 && "Sixth Order +243 (2664+243) - Connects to divine source code of creation."}
                                                  {f.freq === 3150 && "Sixth Order +243 (2907+243) - Bridges into unity consciousness and mental clarity."}
                                                </p>
                                                {f.freq === 2178 && (
                                                  <div className="mt-2 p-2 bg-gold-500/20 border border-gold-500/50 rounded text-center">
                                                    <div className="text-[9px] text-gold-400 font-bold uppercase tracking-widest">SOURCE FREQUENCY · CUBE CENTRE</div>
                                                  </div>
                                                )}
                                            </div>
                                          ))}
                                        </div>
                                        <div className="mt-4 p-4 bg-gold-900/20 border border-gold-500/50 rounded-lg text-center">
                                          <div className="flex items-center justify-center gap-2 text-gold-400 text-lg font-bold mb-2">
                                            <Target size={20} />
                                            2178 Hz — SOURCE: The Centre of the Cube
                                          </div>
                                          <p className="text-sm text-gold-300">Compassion Activation. Position 5 of the HEART layer — the cell that simultaneously sits on every row, every column, both diagonals, and the central vertical pillar (528 → 2178 → 4920). All 27 frequencies radiate outward from this point. SOURCE is not the highest, it is the centre.</p>
                                        </div>
                                        <div className="mt-4 p-3 bg-blue-900/20 border border-blue-500/50 rounded-lg">
                                          <div className="flex items-center gap-2 text-blue-400 text-sm font-bold mb-1">
                                            <Calculator size={16} />
                                            MATHEMATICAL PATTERN: Orders 4-6 follow 243 steady progression
                                          </div>
                                          <p className="text-xs text-blue-300">Order 4: 1206→1449→1692 | Order 5: 1935→2178→2421 | Order 6: 2664→2907→3150</p>
                                        </div>
                                        <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-500/50 rounded-lg">
                                          <div className="flex items-center gap-2 text-yellow-400 text-sm font-bold mb-1">
                                            <AlertTriangle size={16} />
                                            TRANSITION: 3150 Hz → 3504 Hz (HEART → HEAD Regime Activation)
                                          </div>
                                          <p className="text-xs text-yellow-300">Mental body activation threshold - prepare for cognitive and consciousness expansion</p>
                                        </div>
                                      </div>
                                    </div>

                                    {/* HEAD REGIME - Mental & Spiritual Body */}
                                    <div className="border border-purple-500/30 rounded-2xl overflow-hidden bg-purple-500/5">
                                      <div className="bg-purple-500/10 p-4 border-b border-purple-500/30">
                                        <h4 className="text-xl font-bold text-purple-400 flex items-center gap-2">
                                          <Eye className="text-purple-500" size={20} />
                                          HEAD REGIME — Mental & Spiritual Body
                                        </h4>
                                        <p className="text-sm text-purple-300 mt-1">Body Systems: Neurological, endocrine, consciousness centers | Focus: Clarity, wisdom, transcendence</p>
                                      </div>
                                      <div className="p-4">
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                          {[
                                            { freq: 3504, benefit: 'Mental clarity', color: '#1E0066', order: '7th', step: '+354' },
                                            { freq: 3858, benefit: 'Sacred geometry', color: '#0D0040', order: '7th', step: '+354' },
                                            { freq: 4212, benefit: 'Consciousness mastery', color: '#000033', order: '7th', step: '+354' },
                                            { freq: 4566, benefit: 'Soul star connection', color: '#330066', order: '8th', step: '+354' },
                                            { freq: 4920, benefit: 'Spirit realm access', color: '#4B0082', order: '8th', step: '+354' },
                                            { freq: 5274, benefit: 'Universal mind access', color: '#6600CC', order: '8th', step: '+354' },
                                            { freq: 5628, benefit: 'Galactic consciousness', color: '#7700FF', order: '9th', step: '+354' },
                                            { freq: 5982, benefit: 'Divine source portal', color: '#8800FF', order: '9th', step: '+354' },
                                            { freq: 6336, benefit: 'Completion of the ascent', color: '#9933FF', order: '9th', step: '+354' }
                                          ].map(f => (
                                            <div key={f.freq} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 hover:border-purple-500/50 transition-colors group relative">
                                                <div className="absolute top-2 right-2">
                                                  <AlertTriangle size={12} className="text-red-400" title="Expert Level Required" />
                                                </div>
                                                <div className="flex justify-between items-center mb-2 pr-6">
                                                    <span className="text-xl font-bold font-mono" style={{color: f.color}}>{f.freq} Hz</span>
                                                    <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-purple-500/20 px-2 py-1 rounded">{f.order} {f.step}</span>
                                                </div>
                                                <h5 className="text-white font-medium mb-1">{f.benefit}</h5>
                                                <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                                                  {f.freq === 3504 && "Seventh Order +354 (3150+354) - Clears mental fog and brings crystalline clarity."}
                                                  {f.freq === 3858 && "Seventh Order +354 (3504+354) - Embodies divine architectural principles of creation."}
                                                  {f.freq === 4212 && "Seventh Order +354 (3858+354) - Achieves mastery of consciousness and awareness."}
                                                  {f.freq === 4566 && "Eighth Order +354 (4212+354) - Opens first transpersonal gate, soul star connection."}
                                                  {f.freq === 4920 && "Eighth Order +354 (4566+354) - Opens second transpersonal gate to spirit realm."}
                                                  {f.freq === 5274 && "Eighth Order +354 (4920+354) - Opens third transpersonal gate to universal mind."}
                                                  {f.freq === 5628 && "Ninth Order +354 (5274+354) - Connects to galactic center consciousness."}
                                                  {f.freq === 5982 && "Ninth Order +354 (5628+354) - Creates direct portal to divine source consciousness."}
                                                  {f.freq === 6336 && "Ninth Order +354 (5982+354) — completion of the ascent and the outermost vertex of the cube. Mirror number reducing to 9. The path that began at 174 Hz returns home through this corner; SOURCE itself sits one layer down at 2178 Hz, the cube's centre."}
                                                </p>
                                                {f.freq === 6336 && (
                                                  <div className="mt-2 p-2 bg-violet-500/20 border border-violet-500/50 rounded text-center">
                                                    <div className="text-[9px] text-violet-300 font-bold uppercase tracking-widest">COMPLETION · OUTERMOST VERTEX</div>
                                                  </div>
                                                )}
                                            </div>
                                          ))}
                                        </div>
                                        <div className="mt-4 p-3 bg-blue-900/20 border border-blue-500/50 rounded-lg">
                                          <div className="flex items-center gap-2 text-blue-400 text-sm font-bold mb-1">
                                            <Calculator size={16} />
                                            MATHEMATICAL PATTERN: Orders 7-9 follow 354 steady progression
                                          </div>
                                          <p className="text-xs text-blue-300">Order 7: 3504→3858→4212 | Order 8: 4566→4920→5274 | Order 9: 5628→5982→6336</p>
                                        </div>
                                        <div className="mt-4 p-4 bg-violet-900/20 border border-violet-500/50 rounded-lg text-center">
                                          <div className="flex items-center justify-center gap-2 text-violet-300 text-lg font-bold mb-2">
                                            <Target size={20} />
                                            6336 Hz — Completion of the Ascent
                                          </div>
                                          <p className="text-sm text-violet-200">The mathematically correct completion frequency (5982 + 354). Mirror number reducing to 9 — the corner of the cube farthest from centre. Walks that begin at 174 Hz arrive here, but they do not arrive at SOURCE: SOURCE is 2178 Hz, the geometric heart of the cube. 6336 is the journey's outer turning point, not its origin.</p>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                              </section>

                              {/* Section 2: The Map (Tree of Life) */}
                              <section>
                                  <div className="flex items-center gap-3 mb-6">
                                    <div className="p-2 bg-purple-500/10 rounded-full"><MapIcon className="text-purple-400" size={24}/></div>
                                    <h3 className="text-2xl font-bold text-white">The Map: Tree of Life (Complete 12-Node System)</h3>
                                  </div>
                                  <p className="text-slate-400 mb-4 leading-relaxed max-w-2xl">
                                    The complete blueprint of creation. A map of how the Divine manifests through the physical world via twelve distinct nodes,
                                    forming a complete energy circuit to SOURCE. The Tree's central pillar is the same axis that runs through the centre of the <strong className="text-emerald-300">Lo Shu cube</strong> — Position 5 of every layer (528 → 2178 → 4920) — connecting Earth-Star to Crown along a single vertical thread.
                                  </p>

                                  {/* Energy Circuit Explanation */}
                                  <div className="mb-6 p-4 bg-gradient-to-r from-purple-900/20 to-gold-900/20 border border-purple-500/30 rounded-xl">
                                    <h4 className="text-lg font-bold text-gold-400 mb-3 flex items-center gap-2">
                                      <Activity className="w-5 h-5" />
                                      Complete Energy Circuit to SOURCE
                                    </h4>
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm">
                                      <div>
                                        <div className="text-purple-400 font-bold mb-2">Traditional Tree (10 Sephirot)</div>
                                        <div className="text-slate-300 leading-relaxed">
                                          The classical Kabbalistic structure representing divine emanation through ten spheres of manifestation, 
                                          from Keter (Crown) down to Malkuth (Kingdom).
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-gold-400 font-bold mb-2">SOURCE Connection (12th Node)</div>
                                        <div className="text-slate-300 leading-relaxed">
                                          <strong>Ain Soph</strong> (The Limitless) completes the circuit, enabling energy to flow from 
                                          SOURCE → Crown → Tree → Kingdom → back to SOURCE in an eternal loop.
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* The Twelve Nodes */}
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                      {SEPHIROT_INFO.map((node, index) => (
                                          <div 
                                            key={node.name} 
                                            className={`flex gap-4 p-4 rounded-xl border border-slate-800/50 hover:bg-slate-900 transition-colors ${
                                              node.name === 'Ain Soph' 
                                                ? 'bg-gradient-to-r from-white/5 to-gold-900/20 border-gold-500/30' 
                                                : 'bg-slate-900/30'
                                            }`}
                                          >
                                              <div className="w-1 h-full rounded-full shrink-0" style={{background: node.color}}></div>
                                              <div className="flex-1">
                                                  <div className="flex items-baseline gap-2 mb-1">
                                                      <h4 className={`text-lg font-bold ${node.name === 'Ain Soph' ? 'text-white' : 'text-slate-200'}`}>
                                                        {node.name}
                                                        {node.name === 'Ain Soph' && (
                                                          <span className="ml-2 text-xs bg-gold-500/20 text-gold-400 px-2 py-1 rounded-full">SOURCE</span>
                                                        )}
                                                      </h4>
                                                      <span className={`text-xs font-serif italic ${node.name === 'Ain Soph' ? 'text-gold-400' : 'text-gold-500'}`}>
                                                        {node.title}
                                                      </span>
                                                  </div>
                                                  <p className="text-xs text-slate-400 mb-2">{node.meaning}</p>
                                                  <p className="text-xs text-slate-500 leading-relaxed italic">"{node.desc}"</p>
                                                  {node.name === 'Ain Soph' && (
                                                    <div className="mt-2 p-2 bg-gold-500/10 border border-gold-500/30 rounded text-xs">
                                                      <div className="text-gold-400 font-bold mb-1">Energy Connections:</div>
                                                      <div className="text-slate-300">
                                                        Receives from: Keter, Chokhmah, Binah, Daat<br/>
                                                        Completes the infinite SOURCE circuit
                                                      </div>
                                                    </div>
                                                  )}
                                              </div>
                                          </div>
                                      ))}
                                  </div>

                                  {/* Circuit Visualization Note */}
                                  <div className="mt-6 p-4 bg-slate-950/50 border border-slate-700 rounded-xl text-center">
                                    <div className="text-purple-400 font-bold mb-2">🌳 Enable "Tree of Life" in Visualization Engine</div>
                                    <div className="text-sm text-slate-300">
                                      Watch the complete 12-node energy circuit flow in real-time, with supercharged energy streams 
                                      connecting all levels of consciousness to the infinite SOURCE.
                                    </div>
                                  </div>
                              </section>

                              {/* Section 3: The Form (Geometry) */}
                              <section>
                                  <div className="flex items-center gap-3 mb-6">
                                    <div className="p-2 bg-red-500/10 rounded-full"><Box className="text-red-400" size={24}/></div>
                                    <h3 className="text-2xl font-bold text-white">The Form: Sacred Geometry</h3>
                                  </div>
                                  <p className="text-slate-400 mb-6 leading-relaxed max-w-2xl">
                                    Each frequency has a corresponding geometric form. Read together they spell out the faces of the <strong className="text-emerald-300">Lo Shu cube</strong> — the lower geometries (Circle, Vesica, Triangle) anchor the GUT layer, the middle forms (Flower of Life, Tube Torus) bridge HEART, and the higher geometries open HEAD.
                                  </p>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                      {GEOMETRY_INFO.map(geo => (
                                          <div key={geo.freq} className="p-4 bg-slate-900/40 rounded-xl border border-slate-800">
                                              <div className="flex justify-between items-start mb-2">
                                                  <span className="font-bold text-gold-400 text-sm">{geo.shape}</span>
                                                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-300 border border-slate-700">{geo.freq}</span>
                                              </div>
                                              <div className="text-xs text-blue-400 mb-2 font-medium">{geo.element} Element</div>
                                              <p className="text-xs text-slate-400 leading-relaxed">{geo.desc}</p>
                                          </div>
                                      ))}
                                  </div>
                              </section>

                              <div className="p-8 mt-4 bg-gradient-to-br from-slate-900 to-black border border-gold-500/20 rounded-2xl text-center relative overflow-hidden">
                                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-gold-500 to-transparent opacity-50"></div>
                                  <p className="text-xl font-serif text-gold-200 font-medium tracking-wide">"{UNIFIED_THEORY.conclusion}"</p>
                              </div>
                          </div>
                          </>
                          )}
                      </div>
                  </div>
              </div>
          )}

          <aside
            ref={sidebarScrollRef}
            onScroll={recomputeSongListRange}
            className={`
            absolute inset-y-0 left-0 w-[85%] sm:w-80 md:relative
            bg-black/90 md:bg-black/80 border-r border-slate-800
            transition-transform duration-300 backdrop-blur-lg shadow-2xl
            z-[60] overflow-y-auto custom-scrollbar
            ${showSidebar ? 'translate-x-0' : '-translate-x-full'}
            ${isFullScreen ? 'md:-ml-80' : ''}
          `}>
            <div className="p-4 border-b border-slate-800">
               
               {/* NEW GUIDEBOOK BUTTON */}
               <button 
                onClick={() => setShowInfo(true)}
                className="w-full flex items-center justify-center gap-2 mb-3 p-3 rounded-lg font-medium tracking-wide transition-all active:scale-95 bg-gold-600/10 hover:bg-gold-600/20 text-gold-500 border border-gold-500/30 hover:border-gold-500/50 group"
               >
                 <BookOpen size={16} className="group-hover:scale-110 transition-transform" />
                 <span className="text-xs font-bold uppercase tracking-wider">The Guidebook</span>
               </button>

               {/* AETHERIA COLLECTION BUTTONS - COMMENTED OUT FOR WEB DEPLOYMENT 
               <div className="grid grid-cols-2 gap-2 mb-3">
                 <button 
                  onClick={importAetheriaCollection}
                  disabled={isUploading}
                  title="Import the official Aetheria Music Collection by WezClarke (26 tracks)"
                  className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-blue-500/30 bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 hover:border-blue-500/50 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                   <Sparkles size={16} className={`mb-1 ${isUploading ? 'animate-spin' : ''}`} />
                   <span className="font-bold">
                     {isUploading ? `${uploadProgress}%` : 'Import'}
                   </span>
                   <span className="text-[8px] text-blue-300">Aetheria Tracks</span>
                 </button>
                 
                 <button 
                  onClick={showAetheriaTracksOnly}
                  title="Filter library to show only Aetheria Collection tracks by WezClarke"
                  className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-purple-500/30 bg-purple-600/10 text-purple-400 hover:bg-purple-600/20 hover:border-purple-500/50 transition-all active:scale-95"
                 >
                   <Wand2 size={16} className="mb-1" />
                   <span className="font-bold">Show Only</span>
                   <span className="text-[8px] text-purple-300">Aetheria Tracks</span>
                 </button>
               </div>
               */}

               <div className="grid grid-cols-2 gap-2 mb-3">
                   <label className={`flex items-center justify-center gap-2 p-3 border border-slate-700 rounded-lg cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all active:scale-95 group text-xs ${isUploading ? 'opacity-60 pointer-events-none' : ''}`}>
                      {isUploading
                        ? <Loader2 size={16} className="animate-spin text-gold-500" />
                        : <Upload size={16} className="group-hover:animate-bounce" />}
                      <span className="font-semibold">{isUploading ? `${uploadProgress}%` : 'Import Folder'}</span>
                      <input
                        type="file"
                        {...({ webkitdirectory: "", directory: "" } as any)}
                        multiple
                        disabled={isUploading}
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                   </label>

                   <label className={`flex items-center justify-center gap-2 p-3 border border-slate-700 rounded-lg cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all active:scale-95 text-xs ${isUploading ? 'opacity-60 pointer-events-none' : ''}`}>
                      {isUploading
                        ? <Loader2 size={16} className="animate-spin text-gold-500" />
                        : <FilePlus size={16} />}
                      <span className="font-semibold">{isUploading ? `${uploadProgress}%` : 'Add Files'}</span>
                      <input
                        type="file"
                        multiple
                        disabled={isUploading}
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                   </label>
               </div>

               {/* Import progress. A few thousand files take a while to read
                   track lengths from; without this the tab just looks stuck. */}
               {isUploading && (
                 <div className="mb-3">
                   <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                     <div
                       className="h-full bg-gold-500 transition-all duration-200"
                       style={{ width: `${uploadProgress}%` }}
                     />
                   </div>
                   <div className="mt-1 text-[10px] text-slate-500 text-center">
                     Reading track lengths — {pendingDurationAnalysis.length.toLocaleString()} to go
                   </div>
                 </div>
               )}
               
               {/* Search Section */}
               <div className="relative mb-3">
                   <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500" />
                   <input
                       type="text"
                       placeholder="Search songs..."
                       value={searchTerm}
                       onChange={(e) => setSearchTerm(e.target.value)}
                       className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-300 placeholder-slate-500 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500/20"
                   />
                   {searchTerm && (
                       <button
                           onClick={() => setSearchTerm('')}
                           className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-500 hover:text-white"
                       >
                           <X size={14} />
                       </button>
                   )}
               </div>
               
               {/* Diagnostic Buttons */}
               <div className="grid grid-cols-2 gap-2 mb-2">
                 <button 
                  onClick={showCurrentTrackAnalysis}
                  className={`flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border transition-all active:scale-95 bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-600`}
                 >
                   <BarChart3 size={14} className="mb-1" />
                   <span>Current Track</span>
                   <span className="text-[8px] text-slate-500">Analysis</span>
                 </button>
                 
                 <button 
                  onClick={showPlaylistDiagnostics}
                  className={`flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border transition-all active:scale-95 bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-600`}
                 >
                   <Activity size={14} className="mb-1" />
                   <span>Library</span>
                   <span className="text-[8px] text-slate-500">Diagnostics</span>
                 </button>
               </div>

               {/* Smart Harmonic Distribution - Single Reliable Method */}
               <button 
                onClick={() => {
                  if (playlist.length >= 27) {
                    // Use the proven smart harmonic distribution for all libraries 27+ songs
                    const gutFreqs = [174, 285, 396, 417, 528, 639, 741, 852, 963];
                    const heartFreqs = [1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150];
                    const headFreqs = [3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];
                    const allFreqs = [...gutFreqs, ...heartFreqs, ...headFreqs];
                    
                    const redistributed = distributeUsingHarmonicOctavesMaster(playlist, allFreqs);
                    
                    setPlaylist(redistributed);
                    setOriginalPlaylist(redistributed);
                    
                    const gutCount = redistributed.filter(s => gutFreqs.includes((s.closestSolfeggio as number) || 0)).length;
                    const heartCount = redistributed.filter(s => heartFreqs.includes((s.closestSolfeggio as number) || 0)).length;
                    const headCount = redistributed.filter(s => headFreqs.includes((s.closestSolfeggio as number) || 0)).length;
                    
                    // Debug: Check specifically for 4566 Hz
                    const freq4566Count = redistributed.filter(s => s.closestSolfeggio === 4566).length;
                    console.log(`🔍 DEBUG: 4566 Hz assignments: ${freq4566Count}`);
                    
                    // Log all frequency assignments for debugging
                    const frequencyDistribution: { [key: number]: number } = {};
                    allFreqs.forEach(freq => frequencyDistribution[freq] = 0);
                    redistributed.forEach(song => {
                      if (song.closestSolfeggio) {
                        frequencyDistribution[song.closestSolfeggio] = (frequencyDistribution[song.closestSolfeggio] || 0) + 1;
                      }
                    });
                    
                    const missingFreqs = allFreqs.filter(freq => frequencyDistribution[freq] === 0);
                    if (missingFreqs.length > 0) {
                      console.warn(`⚠️ Missing frequency assignments:`, missingFreqs);
                    }
                    
                    // CAB readiness: count frequencies that hit the 3-song
                    // target. Any freq with ≥3 songs gives the Combined Walk
                    // three distinct picks per cube position; the user can
                    // call a CAB as soon as all 27 are at 3+.
                    const cabReadyFreqs = allFreqs.filter(f => (frequencyDistribution[f] || 0) >= 3).length;
                    const cabStatus = cabReadyFreqs === 27
                      ? '🚖 CAB-ready: all 27 frequencies have 3+ songs.'
                      : `CAB readiness: ${cabReadyFreqs}/27 frequencies at 3+ songs.`;

                    // CABI readiness: CAB (81) + Ouroboros (29) share song
                    // pools, so each non-SOURCE freq needs 4 unique songs
                    // (3 CAB visits + 1 Ouroboros visit) and SOURCE/2178 Hz
                    // needs 6 (3 CAB visits + 3 Ouroboros crossings).
                    const cabiReadyFreqs = allFreqs.filter(f => {
                      const need = f === SOURCE_FREQ ? 6 : 4;
                      return (frequencyDistribution[f] || 0) >= need;
                    }).length;
                    const cabiStatus = cabiReadyFreqs === 27
                      ? ' ⚛️ CABI-ready: all 27 frequencies have enough unique songs to close the loop (SOURCE has 6+, others have 4+).'
                      : ` CABI readiness: ${cabiReadyFreqs}/27 frequencies meet the unique-song threshold (SOURCE needs 6, others need 4).`;

                    setAnalysisNotification(`Harmonic Distribution Complete: ${redistributed.length} songs distributed across all 27 frequencies. ${gutCount} GUT, ${heartCount} HEART, ${headCount} HEAD. ${missingFreqs.length > 0 ? `Missing: ${missingFreqs.join(', ')}Hz. ` : ''}${cabStatus}${cabiStatus}`);
                    setTimeout(() => setAnalysisNotification(null), 8000);
                  } else {
                    alert(`Harmonic Distribution requires at least 27 tracks for optimal frequency coverage. Current library has ${playlist.length} tracks. (A full CAB ride needs 81 tracks for 3 unique songs per frequency.)`);
                  }
                }}
                className={`mb-3 w-full flex items-center justify-center gap-2 text-xs py-2 rounded-lg font-medium tracking-wide transition-all active:scale-95 bg-gold-900/20 hover:bg-gold-800/30 border border-gold-500/30 hover:border-gold-500/50`}
               >
                 <Target size={14} className="text-gold-400" />
                 <span className="text-gold-400 font-bold">Auto-Distribute Frequencies</span>
               </button>

               {/* Tools Section */}
               <div className="grid grid-cols-2 gap-2">
                   <button 
                    onClick={isScanning ? () => {
                      if ((window as any).cancelAetheriaAnalysis) {
                        (window as any).cancelAetheriaAnalysis();
                      }
                    } : scanLibrary}
                    className={`flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border transition-all active:scale-95 ${
                      isScanning 
                        ? 'bg-blue-900/30 border-blue-500 text-blue-400 animate-pulse hover:bg-red-900/30 hover:border-red-500 hover:text-red-400' 
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-600'
                    }`}
                    title={isScanning ? 'Click to cancel deep analysis' : 'Start deep fractal analysis (slow but thorough)'}
                   >
                     <Search size={16} className="mb-1" />
                     {isScanning ? (
                       <>
                         <span>Deep Scan...</span>
                         <span className="text-[8px] text-blue-300">{scanProgress}%</span>
                         <span className="text-[7px] text-red-300 mt-1">Cancel</span>
                       </>
                     ) : (
                       <>
                         <span>Deep Scan</span>
                         <span className="text-[8px] text-slate-500">
                           Fractal Analysis
                         </span>
                         <span className="text-[7px] text-yellow-400">
                           ~{Math.round(playlist.length * 2.5)}min
                         </span>
                       </>
                     )}
                   </button>
                   
                   <button 
                    onClick={generateAlignmentJourney}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-gold-400 hover:border-gold-500 transition-all active:scale-95"
                   >
                     <Layers size={16} className="mb-1" />
                     GUT Alignment
                   </button>
                   
                   <button 
                    onClick={generateFullLibraryAlignment}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-purple-400 hover:border-purple-500 transition-all active:scale-95"
                   >
                     <Flower2 size={16} className="mb-1 text-purple-500" />
                     Full Alignment
                   </button>

                   <button 
                    onClick={generateHeartAlignmentJourney}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-green-400 hover:border-green-500 transition-all active:scale-95"
                   >
                     <Heart size={16} className="mb-1 text-green-500" />
                     HEART Alignment
                   </button>

                   <button 
                    onClick={generateHeadAlignmentJourney}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-blue-400 hover:border-blue-500 transition-all active:scale-95"
                   >
                     <Eye size={16} className="mb-1 text-blue-500" />
                     HEAD Alignment
                   </button>

                   <button 
                    onClick={() => generateFrequencyPlaylist([174, 285, 396, 417], 'Qi Strengthening')}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-red-400 hover:border-red-500 transition-all active:scale-95"
                   >
                     <Flame size={16} className="mb-1 text-red-500" />
                     Qi Strength
                   </button>

                   <button 
                    onClick={generateWellnessPlaylist}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-emerald-400 hover:border-emerald-500 transition-all active:scale-95"
                   >
                     <Heart size={16} className="mb-1 text-emerald-500" />
                     Deep Healing
                   </button>

                   <button 
                    onClick={generateMoodPlaylist}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-pink-400 hover:border-pink-500 transition-all active:scale-95"
                   >
                     <Smile size={16} className="mb-1 text-pink-500" />
                     Mood Elevate
                   </button>

                   <button 
                    onClick={generateMeditationPlaylist}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-purple-400 hover:border-purple-500 transition-all active:scale-95"
                   >
                     <Moon size={16} className="mb-1 text-purple-500" />
                     Meditation
                   </button>

                   <button 
                    onClick={() => generateFrequencyPlaylist([285, 417, 528, 639, 741], 'Flow State')}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-cyan-400 hover:border-cyan-500 transition-all active:scale-95"
                   >
                     <Waves size={16} className="mb-1 text-cyan-500" />
                     Flow State
                   </button>

                   <button 
                    onClick={generateGoldenRatioPlaylist}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-gold-400 hover:border-gold-500 transition-all active:scale-95"
                   >
                     <Target size={16} className="mb-1 text-gold-500" />
                     Golden Φ
                   </button>

                   <button 
                    onClick={generate111PatternPlaylist}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-blue-400 hover:border-blue-500 transition-all active:scale-95"
                   >
                     <Activity size={16} className="mb-1 text-blue-500" />
                     <span>111 Sequence</span>
                     <span className="text-[8px] text-blue-400">9 Orders Complete</span>
                   </button>

                   <button 
                    onClick={generateSourceFieldPlaylist}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-green-400 hover:border-green-500 transition-all active:scale-95"
                   >
                     <Hexagon size={16} className="mb-1 text-green-500" />
                     <span>2178Hz Filter</span>
                     <span className="text-[8px] text-green-400">SOURCE Centre</span>
                   </button>

                   <button 
                    onClick={generateUltimateAlignmentPlaylist}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-indigo-400 hover:border-indigo-500 transition-all active:scale-95"
                   >
                     <Layers size={16} className="mb-1 text-indigo-500" />
                     <span>Ultimate</span>
                     <span className="text-[8px] text-indigo-400">All Orders</span>
                   </button>
               </div>

               {/* Full-width Aetheria Journey button - COMMENTED OUT FOR WEB DEPLOYMENT 
               <button 
                onClick={generateAetheriaJourney}
                className="w-full flex items-center justify-center gap-2 mt-2 p-3 rounded-lg font-medium border border-blue-500/30 bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 hover:border-blue-500/50 transition-all active:scale-95"
               >
                 <Sparkles size={16} className="text-blue-500" />
                 <span className="font-bold text-xs uppercase tracking-wider">Aetheria Journey</span>
                 <span className="text-[10px] text-blue-300 ml-1">(All 9 Orders: 174Hz → 5031Hz)</span>
               </button>
               */}

               <button 
                onClick={restoreLibrary}
                className={`mt-2 w-full flex items-center justify-center gap-2 text-xs py-2 rounded-lg font-medium tracking-wide transition-all active:scale-95 bg-slate-800 hover:bg-slate-700 text-slate-300`}
               >
                 <RefreshCw size={14} />
                 Restore Library
               </button>
            </div>
            
            <div ref={songListRef} className="p-2 pb-32">
              {playlist.length === 0 && (
                <div className="flex flex-col items-center justify-center h-48 text-center text-slate-600 p-6">
                  <p>Library Empty</p>
                  <p className="text-xs mt-2">Upload a folder or add files to begin.</p>
                </div>
              )}
              {searchTerm && filteredPlaylist.length === 0 && playlist.length > 0 && (
                <div className="flex flex-col items-center justify-center h-32 text-center text-slate-600 p-6">
                  <p>No Results</p>
                  <p className="text-xs mt-2">Try a different search term.</p>
                </div>
              )}
              {(() => {
                const displayList = searchTerm ? filteredPlaylist : playlist;
                const safeStart = Math.min(Math.max(0, songListRange.start), displayList.length);
                const safeEnd = Math.min(Math.max(safeStart, songListRange.end), displayList.length);
                return (
                  <>
                    {/* Top spacer reserves the height of the rows scrolled above the viewport */}
                    {safeStart > 0 && (
                      <div aria-hidden style={{ height: safeStart * SONG_ROW_HEIGHT }} />
                    )}
                    {displayList.slice(safeStart, safeEnd).map((song, sliceIdx) => {
                      const displayIdx = safeStart + sliceIdx;
                      // Position in the full playlist. Generated walks (Lo Shu,
                      // Ultimate, 111 Sequence) repeat the SAME track at many
                      // positions, so song.id is NOT unique — an id-based lookup
                      // would collapse every duplicate to one index (every row
                      // showing the same number) and duplicate React keys would
                      // make the virtualized list reuse the wrong rows while
                      // scrolling. When not searching, the displayed list IS the
                      // playlist so the position maps directly; when searching we
                      // fall back to first-occurrence by id (any instance plays
                      // the same track).
                      const actualIdx = searchTerm
                        ? (playlistIndexById.get(song.id) ?? -1)
                        : displayIdx;
                      return (
                  <div
                    key={`${song.id}::${displayIdx}`}
                    style={{ height: SONG_ROW_HEIGHT - 4, marginBottom: 4 }}
                    className={`p-3 rounded-lg text-sm flex items-center gap-3 overflow-hidden transition-all group ${
                      currentSongIndex === actualIdx
                        ? 'bg-gold-600/20 text-gold-400 border-l-4 border-gold-500 pl-2'
                        : 'hover:bg-slate-800 text-slate-400'
                    }`}
                  >
                    <span className="text-xs opacity-50 w-5 text-right">{searchTerm ? displayIdx + 1 : actualIdx + 1}</span>
                    <div 
                      className="flex flex-col truncate flex-1 cursor-pointer"
                      onClick={() => { playTrack(actualIdx); if(window.innerWidth < 768) setShowSidebar(false); }}
                    >
                        <div className="flex justify-between">
                            <span className="truncate font-medium">{song.name}</span>
                            <div className="flex gap-1">
                              {song.closestSolfeggio && (
                                <span className="text-[9px] px-1 rounded bg-slate-800 text-gold-500 ml-2 h-fit">
                                  {song.closestSolfeggio}Hz
                                </span>
                              )}
                              {song.fractalAnalysis && song.fractalAnalysis.goldenRatioAlignment > 0.7 && (
                                <span className="text-[8px] px-1 rounded bg-purple-800 text-purple-300 h-fit" title="High Golden Ratio Alignment">
                                  Φ{Math.round(song.fractalAnalysis.goldenRatioAlignment * 100)}%
                                </span>
                              )}
                              {song.fractalAnalysis && song.fractalAnalysis.pattern111Presence > 0.5 && (
                                <span className="text-[8px] px-1 rounded bg-blue-800 text-blue-300 h-fit" title="111Hz Pattern Present">
                                  111
                                </span>
                              )}
                              {song.fractalAnalysis && song.fractalAnalysis.dnaResonanceScore > 0.6 && (
                                <span className="text-[8px] px-1 rounded bg-green-800 text-green-300 h-fit" title="DNA Resonance Detected">
                                  DNA
                                </span>
                              )}
                            </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-slate-600">{song.duration === 0 ? '...' : formatDuration(song.duration || 0)}</span>
                          {song.fractalAnalysis && (
                            <div className="flex gap-1 text-[8px]">
                              <span className={`${
                                song.fractalAnalysis.safetyLevel === 'SAFE' ? 'text-green-500' :
                                song.fractalAnalysis.safetyLevel === 'CAUTION' ? 'text-yellow-500' :
                                song.fractalAnalysis.safetyLevel === 'EXPERT' ? 'text-orange-500' : 'text-red-500'
                              }`}>
                                {song.fractalAnalysis.safetyLevel}
                              </span>
                            </div>
                          )}
                        </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Delete "${song.name}" from library?`)) {
                          deleteSong(song.id);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                      title="Delete song"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                      );
                    })}
                    {/* Bottom spacer reserves the height of the rows below the viewport */}
                    {safeEnd < displayList.length && (
                      <div aria-hidden style={{ height: (displayList.length - safeEnd) * SONG_ROW_HEIGHT }} />
                    )}
                  </>
                );
              })()}
            </div>
            <div className="p-3 bg-black/95 backdrop-blur text-center text-xs text-slate-500 border-t border-slate-900 flex justify-between px-6 shrink-0 z-20 mb-20">
                <span>
                  {searchTerm 
                    ? `${filteredPlaylist.length}/${playlist.length} Tracks` 
                    : `${playlist.length} Tracks`
                  }
                </span>
                <span className="text-gold-500/80">{totalDurationLabel} Total</span>
            </div>
            {/* Clear Playlist & Cache — deliberately below the footer (in the
                reserved bottom margin) so it needs a scroll-down-and-tap and is
                never hit by accident. Two-tap confirm handled in the component. */}
            {playlist.length > 0 && (
              <div className="px-6 pb-6 pt-2 bg-black/95 shrink-0 -mt-20 mb-0 z-10">
                <ClearPlaylistButton onClear={clearEntirePlaylist} trackCount={playlist.length} />
              </div>
            )}
          </aside>

          {showSettings && (
            <div className="absolute inset-y-0 right-0 z-30 w-full md:w-96 bg-black/95 backdrop-blur-xl border-l border-slate-800 flex flex-col shadow-2xl transform transition-transform animate-in slide-in-from-right duration-300">
                <div className="flex justify-between items-start p-6 border-b border-slate-800">
                  <h3 className="text-gold-500 font-serif text-xl">Harmonic Control</h3>
                  <button onClick={() => { setShowSettings(false); }} className="p-2 hover:bg-slate-800 rounded-full"><X className="text-slate-500 hover:text-white" /></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar pb-32">
                   
                   {/* Phi Integration Panel */}
                   <div className="border border-purple-500/30 rounded-xl overflow-hidden bg-slate-900/50 shadow-[0_0_15px_rgba(147,51,234,0.1)]">
                      <div className="p-4 bg-purple-900/20">
                          <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                  <Target className="text-purple-400 w-5 h-5" />
                                  <h4 className="text-purple-400 font-bold uppercase tracking-widest text-xs">
                                      PHI (φ) INTEGRATION
                                  </h4>
                              </div>
                              <button 
                                  onClick={() => setEnablePhiMode(!enablePhiMode)}
                                  className={`w-10 h-5 rounded-full relative transition-colors ${enablePhiMode ? 'bg-purple-500' : 'bg-slate-700'}`}
                              >
                                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${enablePhiMode ? 'left-6' : 'left-1'}`}></div>
                              </button>
                          </div>
                          {enablePhiMode && (
                              <div className="mt-3 space-y-2 text-xs text-purple-200">
                                  <div className="flex items-center gap-2">
                                      <div className="w-2 h-2 rounded-full bg-purple-400"></div>
                                      <span>Volume Ratios: 1.0 : {INV_PHI.toFixed(3)} : {INV_PHI_SQUARED.toFixed(3)}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                      <div className="w-2 h-2 rounded-full bg-purple-400"></div>
                                      <span>Binaural Phase: 137.5° golden angle offset</span>
                                  </div>
                                  <div className="flex items-center gap-2 justify-between">
                                      <div className="flex items-center gap-2">
                                          <div className="w-2 h-2 rounded-full bg-purple-400"></div>
                                          <span>Track Timing: Phi-proportioned</span>
                                      </div>
                                      <button 
                                          onClick={() => setPhiTimingEnabled(!phiTimingEnabled)}
                                          className={`w-8 h-4 rounded-full relative transition-colors ${phiTimingEnabled ? 'bg-purple-500' : 'bg-slate-700'}`}
                                      >
                                          <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${phiTimingEnabled ? 'left-4.5' : 'left-0.5'}`}></div>
                                      </button>
                                  </div>
                                  {phiTimingEnabled && currDuration > 0 && (
                                      <div className="mt-2 p-2 bg-purple-900/30 rounded border border-purple-700/30">
                                          <div className="text-[10px] text-purple-300">
                                              Track Peak: {formatDuration(currDuration * INV_PHI)} ({(INV_PHI * 100).toFixed(1)}%)
                                          </div>
                                      </div>
                                  )}
                              </div>
                          )}
                      </div>
                   </div>
                   
                   <div className="border border-gold-500/30 rounded-xl overflow-hidden bg-slate-900/50 shadow-[0_0_15px_rgba(234,179,8,0.1)]">
                      <button 
                          onClick={() => setIsVizPanelOpen(!isVizPanelOpen)}
                          className="w-full flex justify-between items-center p-4 bg-slate-800/80 hover:bg-slate-800 transition-colors"
                      >
                          <span className="text-gold-400 font-bold uppercase tracking-widest text-xs flex items-center gap-2">
                              <Sliders size={16} /> Visualization Engine
                          </span>
                          {isVizPanelOpen ? <ChevronUp size={16} className="text-gold-500"/> : <ChevronDown size={16} className="text-gold-500"/>}
                      </button>
                      
                      {isVizPanelOpen && (
                          <div className="p-5 space-y-5 bg-black/40">
                             
                             <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800">
                                <span className="text-xs text-slate-300 flex items-center gap-2">
                                  <Sparkles size={14} className="text-gold-500"/> Astral Trails
                                </span>
                                <button 
                                  onClick={() => setVizSettings({...vizSettings, enableTrails: !vizSettings.enableTrails})}
                                  className={`w-10 h-5 rounded-full relative transition-colors ${vizSettings.enableTrails ? 'bg-gold-500' : 'bg-slate-700'}`}
                                >
                                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${vizSettings.enableTrails ? 'left-6' : 'left-1'}`}></div>
                                </button>
                             </div>

                             <div className="space-y-4 pt-2">
                                <div>
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                        <span>SIMULATION SPEED</span>
                                        <span>{vizSettings.speed.toFixed(1)}x</span>
                                    </div>
                                    <input 
                                        type="range" min="0.1" max="3" step="0.1"
                                        value={vizSettings.speed}
                                        onChange={(e) => setVizSettings({...vizSettings, speed: parseFloat(e.target.value)})}
                                        className="w-full accent-gold-500 h-1.5 bg-slate-700 rounded-lg appearance-none touch-none"
                                    />
                                </div>
                                
                                <div>
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                        <span>PARTICLE SIZE</span>
                                        <span>{vizSettings.particleBaseSize.toFixed(1)}x</span>
                                    </div>
                                    <input 
                                        type="range" min="0.5" max="8.0" step="0.5"
                                        value={vizSettings.particleBaseSize}
                                        onChange={(e) => setVizSettings({...vizSettings, particleBaseSize: parseFloat(e.target.value)})}
                                        className="w-full accent-gold-500 h-1.5 bg-slate-700 rounded-lg appearance-none touch-none"
                                    />
                                </div>

                                <div>
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                        <span>AUDIO REACTIVITY</span>
                                        <span>{(vizSettings.sensitivity * 100).toFixed(0)}%</span>
                                    </div>
                                    <input 
                                        type="range" min="0.1" max="2" step="0.1"
                                        value={vizSettings.sensitivity}
                                        onChange={(e) => setVizSettings({...vizSettings, sensitivity: parseFloat(e.target.value)})}
                                        className="w-full accent-gold-500 h-1.5 bg-slate-700 rounded-lg appearance-none touch-none"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                   <button 
                                      onClick={() => setVizSettings({...vizSettings, autoRotate: !vizSettings.autoRotate})}
                                      className={`text-xs py-2 rounded border flex items-center justify-center gap-1 transition-all ${vizSettings.autoRotate ? 'bg-gold-500/20 border-gold-500 text-gold-400' : 'bg-slate-900 border-slate-700 text-slate-500'}`}
                                   >
                                      <RotateCw size={12} /> Rotate {vizSettings.autoRotate ? 'ON' : 'OFF'}
                                   </button>
                                   <button 
                                      onClick={() => setVizSettings({...vizSettings, invertPerspective: !vizSettings.invertPerspective})}
                                      className={`text-xs py-2 rounded border flex items-center justify-center gap-1 transition-all ${vizSettings.invertPerspective ? 'bg-purple-500/20 border-purple-500 text-purple-400' : 'bg-slate-900 border-slate-700 text-slate-500'}`}
                                   >
                                      <ArrowUpCircle size={12} /> Ascension {vizSettings.invertPerspective ? 'ON' : 'OFF'}
                                   </button>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-2">
                                   <button 
                                      onClick={() => setVizSettings({...vizSettings, showHexagons: !vizSettings.showHexagons})}
                                      className={`text-xs py-2 rounded border ${vizSettings.showHexagons ? 'bg-gold-500/20 border-gold-500 text-gold-400' : 'bg-slate-900 border-slate-700 text-slate-500'}`}
                                   >
                                      Hex Grid {vizSettings.showHexagons ? 'ON' : 'OFF'}
                                   </button>
                                   <div className="flex items-center">
                                      <input 
                                        type="range" min="0" max="1" step="0.1"
                                        title="Hex Opacity"
                                        value={vizSettings.hexOpacity}
                                        onChange={(e) => setVizSettings({...vizSettings, hexOpacity: parseFloat(e.target.value)})}
                                        className="w-full accent-gold-500 h-1.5 bg-slate-700 rounded-lg appearance-none touch-none"
                                      />
                                   </div>
                                </div>

                                <div>
                                    <div className="text-[10px] text-slate-400 mb-1 uppercase tracking-widest">Hex Visual Mode</div>
                                    <select 
                                        value={vizSettings.hexVisualMode}
                                        onChange={(e) => setVizSettings({...vizSettings, hexVisualMode: e.target.value as any})}
                                        className="w-full bg-slate-900 text-xs border border-slate-700 rounded px-2 py-1 text-slate-300"
                                    >
                                        <option value="pulse">Radial Pulse (Gentle)</option>
                                        <option value="spectrum">Spectrum Analyzer (Aggressive)</option>
                                        <option value="wave">Energy Wave (Flowing)</option>
                                    </select>
                                </div>
                                
                                <div className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border border-slate-800 flex-wrap">
                                    <div className="flex items-center justify-between w-full">
                                        <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider flex items-center gap-2"><Droplets size={12}/> Hydro-Acoustics</span>
                                        <button 
                                            onClick={() => setVizSettings({...vizSettings, showWaterRipples: !vizSettings.showWaterRipples})}
                                            className={`w-8 h-4 rounded-full relative transition-colors ${vizSettings.showWaterRipples ? 'bg-blue-500' : 'bg-slate-700'}`}
                                        >
                                            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${vizSettings.showWaterRipples ? 'left-4.5' : 'left-0.5'}`}></div>
                                        </button>
                                    </div>
                                    {vizSettings.showWaterRipples && (
                                        <div className="w-full mt-3 pt-3 border-t border-slate-800">
                                            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                                <span>RIPPLE INTENSITY</span>
                                                <span>{vizSettings.hydroIntensity.toFixed(0)}%</span>
                                            </div>
                                            <input 
                                                type="range" min="0" max="100" step="1"
                                                value={vizSettings.hydroIntensity}
                                                onChange={(e) => setVizSettings({...vizSettings, hydroIntensity: parseFloat(e.target.value)})}
                                                className="w-full accent-blue-500 h-1.5 bg-slate-700 rounded-lg appearance-none touch-none"
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border border-slate-800">
                                    <span className="text-[10px] text-gold-400 font-bold uppercase tracking-wider flex items-center gap-2"><Flower2 size={12}/> Tree of Life</span>
                                    <button
                                        onClick={() => setVizSettings({...vizSettings, showTreeOfLife: !vizSettings.showTreeOfLife})}
                                        className={`w-8 h-4 rounded-full relative transition-colors ${vizSettings.showTreeOfLife ? 'bg-gold-500' : 'bg-slate-700'}`}
                                    >
                                        <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${vizSettings.showTreeOfLife ? 'left-4.5' : 'left-0.5'}`}></div>
                                    </button>
                                </div>

                                <div className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] text-emerald-300 font-bold uppercase tracking-wider flex items-center gap-2"><Box size={12}/> Lo Shu Cube</span>
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, showLoShuCube: !vizSettings.showLoShuCube})}
                                            className={`w-8 h-4 rounded-full relative transition-colors ${vizSettings.showLoShuCube ? 'bg-emerald-500' : 'bg-slate-700'}`}
                                        >
                                            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${vizSettings.showLoShuCube ? 'left-4.5' : 'left-0.5'}`}></div>
                                        </button>
                                    </div>
                                    <p className="text-[9px] text-slate-500 mt-1">
                                        {vizSettings.showLoShuCube
                                            ? `27 sub-cubes (GUT/HEART/HEAD × Lo Shu 1–9), tinted by ${frequencyColorMode === 'spectrum' ? 'visible-light wavelength' : 'chakra palette'}.`
                                            : 'Render the 3×3×3 Lo Shu cube as a visualizer overlay.'}
                                    </p>

                                    {/* Rotation controls — only meaningful when the cube is on. */}
                                    {vizSettings.showLoShuCube && (
                                        <div className="mt-2 pt-2 border-t border-slate-800 space-y-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] text-emerald-300/80 uppercase tracking-wider flex items-center gap-2"><RotateCw size={10}/> Auto-Rotate</span>
                                                <button
                                                    onClick={() => setVizSettings({...vizSettings, loShuCubeAutoRotate: !vizSettings.loShuCubeAutoRotate})}
                                                    className={`w-8 h-4 rounded-full relative transition-colors ${vizSettings.loShuCubeAutoRotate ? 'bg-emerald-500' : 'bg-slate-700'}`}
                                                    title={vizSettings.loShuCubeAutoRotate ? 'Stop turntable rotation' : 'Resume turntable rotation'}
                                                >
                                                    <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${vizSettings.loShuCubeAutoRotate ? 'left-4.5' : 'left-0.5'}`}></div>
                                                </button>
                                            </div>
                                            <div className={`transition-opacity ${vizSettings.loShuCubeAutoRotate ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-[10px] text-emerald-300/80 uppercase tracking-wider">Position</span>
                                                    <span className="text-[10px] text-slate-400 font-mono">{Math.round(vizSettings.loShuCubeRotation)}°</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={360}
                                                    step={1}
                                                    value={vizSettings.loShuCubeRotation}
                                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVizSettings({...vizSettings, loShuCubeRotation: parseFloat(e.target.value)})}
                                                    className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                                    title="Hold the cube at this rotation when auto-rotate is off"
                                                    disabled={vizSettings.loShuCubeAutoRotate}
                                                />
                                            </div>

                                            {/* Path Illumination — toggle any of the three Lo Shu walks
                                             * to draw its 27-frequency path through the cube without
                                             * needing a playlist active. The shapes themselves
                                             * (vortex spiral / linear ascent / vertical pillars) are
                                             * the visual identifier. */}
                                            <div className="pt-2 border-t border-slate-800">
                                                <div className="text-[10px] text-emerald-300/80 uppercase tracking-wider mb-1.5">Path Illumination</div>
                                                <p className="text-[9px] text-slate-500 mb-2">
                                                    Light up walk paths without loading a playlist. Toggle individually or combine.
                                                </p>
                                                {([
                                                    { key: 'loShuShowVortex' as const, label: 'Vortex', sub: 'C · 5→6→7→8→9→1→2→3→4 spiral' },
                                                    { key: 'loShuShowAscent' as const, label: 'Ascent', sub: 'A · 1→9 per layer' },
                                                    { key: 'loShuShowPillar' as const, label: 'Pillar', sub: 'B · vertical GUT→HEART→HEAD' },
                                                    { key: 'loShuShowOuroboros' as const, label: 'Ouroboros', sub: 'I · figure-8 crossing SOURCE 3×' },
                                                ]).map(({ key, label, sub }) => {
                                                    const on = vizSettings[key];
                                                    return (
                                                        <div key={key} className="flex items-center justify-between py-1">
                                                            <div className="flex flex-col">
                                                                <span className="text-[10px] text-slate-200 font-medium">{label}</span>
                                                                <span className="text-[9px] text-slate-500 font-mono">{sub}</span>
                                                            </div>
                                                            <button
                                                                onClick={() => setVizSettings({ ...vizSettings, [key]: !on })}
                                                                className={`w-8 h-4 rounded-full relative transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-700'}`}
                                                                title={on ? `Hide the ${label} walk path overlay` : `Show the ${label} walk path overlay`}
                                                            >
                                                                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${on ? 'left-4.5' : 'left-0.5'}`}></div>
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Show Sacred Geometry</span>
                                        <button 
                                            onClick={() => setVizSettings({...vizSettings, morphEnabled: !vizSettings.morphEnabled})}
                                            className={`w-8 h-4 rounded-full relative transition-colors ${vizSettings.morphEnabled ? 'bg-gold-500' : 'bg-slate-700'}`}
                                        >
                                            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${vizSettings.morphEnabled ? 'left-4.5' : 'left-0.5'}`}></div>
                                        </button>
                                    </div>
                                    <p className="text-[9px] text-slate-500">
                                        {vizSettings.morphEnabled 
                                          ? "Sacred forms appear based on frequency." 
                                          : "Particles return to chaos/cloud state."}
                                    </p>
                                </div>

                                <div>
                                    <div className="text-[10px] text-slate-400 mb-1 uppercase tracking-widest">Particle Density</div>
                                    <div className="grid grid-cols-3 gap-1">
                                        {(['low', 'medium', 'high'] as const).map(d => (
                                            <button
                                                key={d}
                                                onClick={() => setVizSettings({...vizSettings, particleDensity: d})}
                                                className={`text-[10px] py-1 uppercase rounded border ${vizSettings.particleDensity === d ? 'bg-gold-500 text-black border-gold-500 font-bold' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
                                            >
                                                {d}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <div className="text-[10px] text-slate-400 mb-1 uppercase tracking-widest">Particle Physics (Mixable)</div>
                                    <div className="grid grid-cols-3 gap-1">
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, enableFlow: !vizSettings.enableFlow})}
                                            className={`text-[10px] py-1 rounded border flex items-center justify-center gap-1 transition-all ${vizSettings.enableFlow ? 'bg-blue-500/20 text-blue-400 border-blue-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
                                        >
                                            <Waves size={10} /> Flow
                                        </button>
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, enableFloat: !vizSettings.enableFloat})}
                                            className={`text-[10px] py-1 rounded border flex items-center justify-center gap-1 transition-all ${vizSettings.enableFloat ? 'bg-purple-500/20 text-purple-400 border-purple-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
                                        >
                                            <Wind size={10} /> Float
                                        </button>
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, enablePulse: !vizSettings.enablePulse})}
                                            className={`text-[10px] py-1 rounded border flex items-center justify-center gap-1 transition-all ${vizSettings.enablePulse ? 'bg-red-500/20 text-red-400 border-red-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
                                        >
                                            <PulseIcon size={10} /> Pulse
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <div className="text-[10px] text-slate-400 mb-1 uppercase tracking-widest">Color Mode</div>
                                    <div className="grid grid-cols-2 gap-1">
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, colorMode: 'chakra'})}
                                            className={`text-[10px] py-1 rounded border ${vizSettings.colorMode === 'chakra' ? 'bg-blue-500 text-white border-blue-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
                                            title="Chakra palette tied to the current Solfeggio frequency"
                                        >
                                            Chakra
                                        </button>
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, colorMode: 'cycle'})}
                                            className={`text-[10px] py-1 rounded border ${vizSettings.colorMode === 'cycle' ? 'bg-purple-500 text-white border-purple-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
                                            title="RGB cycle synced to audio energy"
                                        >
                                            Hypnotic
                                        </button>
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, colorMode: 'static'})}
                                            className={`text-[10px] py-1 rounded border ${vizSettings.colorMode === 'static' ? 'bg-gold-500 text-black border-gold-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
                                            title="Single colour locked to the current chakra/spectrum primary"
                                        >
                                            Static
                                        </button>
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, colorMode: 'spectrum'})}
                                            className={`text-[10px] py-1 rounded border ${vizSettings.colorMode === 'spectrum' ? 'bg-cyan-500 text-white border-cyan-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
                                            title="Visible-light wavelength of the active frequency, modulated by audio"
                                        >
                                            Spectrum
                                        </button>
                                    </div>
                                </div>

                             </div>
                          </div>
                      )}
                   </div>

                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <label className="text-xs uppercase tracking-widest text-slate-500 block font-bold">Solfeggio Frequency Layer</label>
                      {loShuPerfectGUT && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-medium border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 uppercase tracking-wider"
                          title="Lo Shu Perfect mode is active. GUT-band Solfeggio frequencies are shown and selected as their perfect 111 Hz counterparts (174→75, 285→186, 396→297, 417→408, 528→519, 639→630). Toggle from the Lo Shu button in the player toolbar, or in the Guidebook's Lo Shu Cube panel."
                        >
                          Lo Shu Perfect
                        </span>
                      )}
                    </div>

                    {/* Traditional Solfeggio (First-Third Order) — these are the
                        GUT band, so display values swap when Lo Shu Perfect is on. */}
                    <div className="mb-4">
                      <div className="text-[10px] text-slate-400 mb-2 uppercase tracking-widest">Traditional Scale (Safe)</div>
                      <div className="grid grid-cols-3 gap-2">
                        {SOLFEGGIO_INFO.filter(s => ['First', 'Second', 'Third'].includes(s.order)).map((s) => (
                          <button
                            key={s.freq}
                            onClick={() => selectFrequency(s.freq)}
                            className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all active:scale-95 ${selectedSolfeggio === applyLoShuPerfectMap(s.freq) ? 'bg-gold-600 text-black border-gold-600 shadow-lg shadow-gold-500/20' : 'border-slate-800 bg-slate-900 hover:border-gold-500'}`}
                          >
                            {applyLoShuPerfectMap(s.freq)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Higher Order Solfeggio - Experience Level Gated */}
                    {(userExperienceLevel === 'advanced' || userExperienceLevel === 'expert') && (
                      <div className="mb-4">
                        <div className="text-[10px] text-yellow-400 mb-2 uppercase tracking-widest flex items-center gap-1">
                          <AlertTriangle size={10} />
                          Fourth Order (Advanced)
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {SOLFEGGIO_INFO.filter(s => s.order === 'Fourth').map((s) => (
                            <button
                              key={s.freq}
                              onClick={() => selectFrequency(s.freq)}
                              className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all active:scale-95 ${selectedSolfeggio === applyLoShuPerfectMap(s.freq) ? 'bg-yellow-600 text-black border-yellow-600 shadow-lg shadow-yellow-500/20' : 'border-yellow-800 bg-yellow-900/20 hover:border-yellow-500 text-yellow-300'}`}
                            >
                              {s.freq}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {userExperienceLevel === 'expert' && (
                      <>
                        {/* Fifth Order */}
                        <div className="mb-4">
                          <div className="text-[10px] text-orange-400 mb-2 uppercase tracking-widest flex items-center gap-1">
                            <AlertTriangle size={10} />
                            Fifth Order (Expert Only)
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Fifth').map((s) => (
                              <button
                                key={s.freq}
                                onClick={() => selectFrequency(s.freq)}
                                className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all active:scale-95 ${selectedSolfeggio === applyLoShuPerfectMap(s.freq) ? 'bg-orange-600 text-black border-orange-600 shadow-lg shadow-orange-500/20' : 'border-orange-800 bg-orange-900/20 hover:border-orange-500 text-orange-300'}`}
                              >
                                {s.freq}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Sixth Order */}
                        <div className="mb-4">
                          <div className="text-[10px] text-red-400 mb-2 uppercase tracking-widest flex items-center gap-1">
                            <AlertTriangle size={10} />
                            Sixth Order (Research Level)
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Sixth').map((s) => (
                              <button
                                key={s.freq}
                                onClick={() => selectFrequency(s.freq)}
                                className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all active:scale-95 ${selectedSolfeggio === applyLoShuPerfectMap(s.freq) ? 'bg-red-600 text-white border-red-600 shadow-lg shadow-red-500/20' : 'border-red-800 bg-red-900/20 hover:border-red-500 text-red-300'}`}
                              >
                                {s.freq}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Seventh Order */}
                        <div className="mb-4">
                          <div className="text-[10px] text-violet-400 mb-2 uppercase tracking-widest flex items-center gap-1">
                            <AlertTriangle size={10} />
                            Seventh Order (Master Level)
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Seventh').map((s) => (
                              <button
                                key={s.freq}
                                onClick={() => selectFrequency(s.freq)}
                                className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all active:scale-95 ${selectedSolfeggio === applyLoShuPerfectMap(s.freq) ? 'bg-violet-600 text-white border-violet-600 shadow-lg shadow-violet-500/20' : 'border-violet-800 bg-violet-900/20 hover:border-violet-500 text-violet-300'}`}
                              >
                                {s.freq}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Eighth Order - Transpersonal Realm */}
                        <div className="mb-4">
                          <div className="text-[10px] text-cyan-400 mb-2 uppercase tracking-widest flex items-center gap-1">
                            <AlertTriangle size={10} />
                            Eighth Order (Transpersonal Gates 1-3)
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Eighth').map((s) => (
                              <button
                                key={s.freq}
                                onClick={() => selectFrequency(s.freq)}
                                className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all active:scale-95 ${selectedSolfeggio === applyLoShuPerfectMap(s.freq) ? 'bg-cyan-600 text-white border-cyan-600 shadow-lg shadow-cyan-500/20' : 'border-cyan-800 bg-cyan-900/20 hover:border-cyan-500 text-cyan-300'}`}
                              >
                                {s.freq}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Ninth Order - Ascension */}
                        <div className="mb-4">
                          <div className="text-[10px] text-pink-400 mb-2 uppercase tracking-widest flex items-center gap-1">
                            <AlertTriangle size={10} />
                            <Sparkles size={10} />
                            Ninth Order (Ascension - Gates 4-6)
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Ninth').map((s) => (
                              <button
                                key={s.freq}
                                onClick={() => selectFrequency(s.freq)}
                                className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all active:scale-95 relative ${selectedSolfeggio === applyLoShuPerfectMap(s.freq) ? 'bg-pink-600 text-white border-pink-600 shadow-lg shadow-pink-500/20' : 'border-pink-800 bg-pink-900/20 hover:border-pink-500 text-pink-300'}`}
                              >
                                {s.freq}
                                {s.freq === 5031 && (
                                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-gold-500 rounded-full border border-gold-400" title="SOURCE Frequency"></div>
                                )}
                              </button>
                            ))}
                          </div>
                          <div className="mt-2 text-[9px] text-pink-300 bg-pink-900/20 p-2 rounded border border-pink-800">
                            ⚠️ Maximum caution required. These are theoretical transpersonal frequencies. Use extremely low volumes and short sessions.
                          </div>
                        </div>
                      </>
                    )}
                    <div className="mt-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
                      <div className="flex justify-between text-xs text-slate-400 mb-2">
                         <span>Layer Intensity</span>
                         <span>{(solfeggioVolume * 100).toFixed(0)}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" max="1" step="0.01" 
                        value={solfeggioVolume}
                        onChange={(e) => setSolfeggioVolume(parseFloat(e.target.value))}
                        className="w-full accent-gold-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer touch-none"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-4">
                        <label className="text-xs uppercase tracking-widest text-slate-500 font-bold">Binaural Entrainment</label>
                         <button 
                            onClick={() => setIsAdaptiveBinaural(!isAdaptiveBinaural)}
                            className={`text-[10px] px-2 py-1 rounded border flex items-center gap-1 transition-colors ${isAdaptiveBinaural ? 'bg-blue-500/20 text-blue-400 border-blue-500' : 'border-slate-700 text-slate-500'}`}
                        >
                            <Sparkles size={10} /> {isAdaptiveBinaural ? 'Adaptive ON' : 'Adaptive OFF'}
                        </button>
                    </div>

                    <div className="space-y-3">
                       {BINAURAL_PRESETS.map((p) => (
                          <div 
                            key={p.name} 
                            onClick={() => { setSelectedBinaural(p); setIsAdaptiveBinaural(false); }}
                            className={`flex items-center p-3 rounded-lg cursor-pointer border transition-all ${selectedBinaural.name === p.name ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-600'}`}
                          >
                            <div className={`w-4 h-4 rounded-full border-2 mr-3 flex items-center justify-center ${selectedBinaural.name === p.name ? 'border-blue-500' : 'border-slate-600'}`}>
                               {selectedBinaural.name === p.name && <div className="w-2 h-2 rounded-full bg-blue-500"></div>}
                            </div>
                            <div className="flex-1">
                                <span className="block text-sm font-bold text-slate-200">{p.name} ({p.delta}Hz)</span>
                                <span className="text-[10px] text-slate-400">{p.description}</span>
                            </div>
                          </div>
                       ))}
                    </div>
                  </div>
                  
                  {/* Advanced Features Section */}
                  <div className="border-t border-slate-700 pt-6">
                    <h3 className="text-lg font-bold text-gold-400 mb-4 flex items-center gap-2">
                      <Target className="w-5 h-5" />
                      Advanced Features
                    </h3>
                    
                    {/* Experience Level */}
                    <div className="mb-4">
                      <label className="text-xs uppercase tracking-widest text-slate-500 mb-2 block font-bold">Experience Level</label>
                      <select
                        value={userExperienceLevel}
                        onChange={(e) => setUserExperienceLevel(e.target.value as any)}
                        className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm"
                      >
                        <option value="beginner">Beginner (Safe frequencies only)</option>
                        <option value="intermediate">Intermediate (Up to 2000 Hz)</option>
                        <option value="advanced">Advanced (Up to 5000 Hz)</option>
                        <option value="expert">Expert (All frequencies)</option>
                      </select>
                    </div>
                    
                    {/* Fractal Analysis Display */}
                    {fractalAnalysis && (
                      <div className="bg-slate-800 p-4 rounded-lg mb-4">
                        <h4 className="text-sm font-bold text-blue-400 mb-3">Fractal Analysis Results</h4>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="bg-slate-900 p-2 rounded">
                            <div className="text-gold-400 mb-1">Golden Ratio Alignment</div>
                            <div className="text-white font-bold text-lg">{Math.round(fractalAnalysis.goldenRatioAlignment * 100)}%</div>
                          </div>
                          <div className="bg-slate-900 p-2 rounded">
                            <div className="text-purple-400 mb-1">111 Hz Pattern</div>
                            <div className="text-white font-bold text-lg">{Math.round(fractalAnalysis.pattern111Presence * 100)}%</div>
                          </div>
                          <div className="bg-slate-900 p-2 rounded">
                            <div className="text-green-400 mb-1">DNA Resonance</div>
                            <div className="text-white font-bold text-lg">{Math.round(fractalAnalysis.dnaResonanceScore * 100)}%</div>
                          </div>
                          <div className="bg-slate-900 p-2 rounded">
                            <div className="text-red-400 mb-1">Safety Level</div>
                            <div className={`font-bold text-lg ${
                              fractalAnalysis.safetyLevel === 'SAFE' ? 'text-green-500' :
                              fractalAnalysis.safetyLevel === 'CAUTION' ? 'text-yellow-500' :
                              fractalAnalysis.safetyLevel === 'EXPERT' ? 'text-orange-500' : 'text-red-500'
                            }`}>
                              {fractalAnalysis.safetyLevel}
                            </div>
                          </div>
                        </div>
                        
                        {fractalAnalysis.infiniteOrderHarmonics.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-700">
                            <div className="text-xs text-slate-400 mb-2">Detected Harmonics (first 10):</div>
                            <div className="flex flex-wrap gap-1">
                              {fractalAnalysis.infiniteOrderHarmonics.slice(0, 10).map((freq, i) => (
                                <span key={i} className="text-xs bg-slate-700 text-gold-400 px-2 py-1 rounded">
                                  {freq.toFixed(1)}Hz
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Effects Documentation */}
                    <div className="mb-4">
                      <ExperienceTracker
                        isDocumenting={isDocumentingEffects}
                        onToggleDocumentation={() => setIsDocumentingEffects(!isDocumentingEffects)}
                        currentFrequency={selectedSolfeggio}
                        currentVolume={solfeggioVolume}
                        sessionDuration={sessionDuration}
                        isPlaying={isPlaying}
                        onSessionStart={(data) => {
                          console.log('Session started with data:', data);
                          // Start the experience tracking session
                          if (!currentEffectsSession) {
                            const sessionId = experienceTracker.startSession(
                              selectedSolfeggio,
                              solfeggioVolume,
                              'sine'
                            );
                            setCurrentEffectsSession(sessionId);
                          }
                        }}
                        onSessionEnd={(data) => {
                          console.log('Session ended with data:', data);
                          // Complete the session and save the user's experience
                          if (currentEffectsSession) {
                            // Create a user report from the collected data
                            const userReport = {
                              userId: 'user_' + Date.now(), // In real app, use proper user ID
                              frequency: selectedSolfeggio,
                              volume: solfeggioVolume,
                              duration: sessionDuration,
                              waveform: 'sine',
                              environment: data.environment || 'unknown',
                              priorState: data.priorState || { mood: 5, energy: 5, stress: 5, focus: 5 },
                              postState: data.postState,
                              effectsExperienced: data.effectsExperienced,
                              sensations: data.sensations,
                              emotionalChanges: data.emotionalChanges,
                              physicalSensations: data.physicalSensations,
                              mentalChanges: data.mentalChanges,
                              overallExperience: data.overallExperience,
                              wouldRecommend: data.wouldRecommend,
                              notes: data.notes,
                              verified: true,
                              credibility: 8 // Self-reported but detailed
                            };

                            // Find or create effect entry for this frequency
                            const existingEffects = effectsManager.findEffectsByFrequency(selectedSolfeggio, 10);
                            if (existingEffects.length > 0) {
                              // Add to existing effect
                              effectsManager.addUserReport(existingEffects[0].id, userReport);
                            } else {
                              // Create new effect entry
                              const newEffect = {
                                frequency: selectedSolfeggio,
                                name: `User-Documented ${selectedSolfeggio}Hz Effect`,
                                category: 'spiritual' as const,
                                discoveryDate: new Date().toISOString().split('T')[0],
                                description: `User-reported effects for ${selectedSolfeggio}Hz frequency.`,
                                onsetTime: '5-15 minutes',
                                duration: 'hours',
                                intensity: 'moderate' as const,
                                recommendedDuration: '15-30 minutes',
                                userReports: [],
                                safetyLevel: assessFrequencySafety(selectedSolfeggio).level,
                                validationStatus: 'reported' as const,
                                confidenceScore: 6,
                                tags: ['user-documented', 'experiential'],
                                relatedFrequencies: [528, 741, 852]
                              };
                              const effectId = effectsManager.addEffect(newEffect);
                              effectsManager.addUserReport(effectId, userReport);
                            }

                            experienceTracker.completeSession(currentEffectsSession);
                            setCurrentEffectsSession(null);
                            
                            // Show success message
                            setAnalysisNotification(`Experience documented! Your ${selectedSolfeggio}Hz session data has been saved for research.`);
                            setTimeout(() => setAnalysisNotification(null), 5000);
                          }
                        }}
                        onAddNote={(note) => {
                          console.log('Note added:', note);
                          // Add note to current session if active
                          if (currentEffectsSession) {
                            experienceTracker.addNote(currentEffectsSession, note);
                          }
                        }}
                      />
                    </div>
                    
                    {/* Subtle Resonance Mode Indicator */}
                    {subtleResonanceMode && (
                      <div className="bg-yellow-900/30 border border-yellow-500/50 rounded-lg p-3 mb-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Zap className="w-4 h-4 text-yellow-400" />
                          <span className="text-yellow-400 font-bold text-sm">Subtle Resonance Mode Active</span>
                        </div>
                        <div className="text-xs text-yellow-200">
                          High frequency detected ({selectedSolfeggio}Hz). Focus on feeling rather than hearing.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
            </div>
          )}
          
          {/* Advanced Frequency Selector Modal */}
          {showFrequencySelector && (
            <div 
              className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => setShowFrequencySelector(false)}
            >
              <div 
                className="w-full max-w-4xl max-h-[calc(100vh-120px)] overflow-auto bg-slate-900 rounded-2xl shadow-2xl border border-slate-700 my-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-between items-center p-4 border-b border-slate-700 bg-slate-800">
                  <h2 className="text-xl font-bold text-gold-400">Advanced Frequency Laboratory</h2>
                  <button
                    onClick={() => setShowFrequencySelector(false)}
                    className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-slate-700 rounded"
                  >
                    <X size={24} />
                  </button>
                </div>
                
                <div className="p-4">
                  <div className="text-white">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold">Frequency Selection</h3>
                      {loShuPerfectGUT && (
                        <span className="text-[10px] font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded uppercase tracking-wider">
                          Lo Shu Perfect
                        </span>
                      )}
                    </div>

                    {/* Traditional Solfeggio (First / Second / Third order — GUT band).
                        Labels swap to Lo Shu Perfect counterparts when Perfect GUT mode
                        is on, matching the inline selector's behaviour. Active state
                        highlights whichever frequency is currently playing. */}
                    <div className="mb-4">
                      <h4 className="text-sm font-bold text-slate-300 mb-2">Traditional Solfeggio</h4>
                      <div className="grid grid-cols-3 gap-2">
                        {SOLFEGGIO_INFO.filter(s => ['First', 'Second', 'Third'].includes(s.order)).map((s) => {
                          const isActive = selectedSolfeggio === applyLoShuPerfectMap(s.freq);
                          return (
                            <button
                              key={s.freq}
                              onClick={() => {
                                selectFrequency(s.freq);
                                setShowFrequencySelector(false);
                              }}
                              className={`py-2 px-2 rounded border transition-colors text-xs ${
                                isActive
                                  ? 'bg-gold-600 text-black border-gold-500 shadow-lg shadow-gold-500/30'
                                  : 'bg-slate-800 hover:bg-gold-600 text-white border-slate-600'
                              }`}
                            >
                              {applyLoShuPerfectMap(s.freq)}Hz
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Higher Order - Experience Level Gated */}
                    {(userExperienceLevel === 'advanced' || userExperienceLevel === 'expert') && (
                      <div className="mb-4">
                        <h4 className="text-sm font-bold text-yellow-400 mb-2 flex items-center gap-1">
                          <AlertTriangle size={14} />
                          Fourth Order (Advanced)
                        </h4>
                        <div className="grid grid-cols-3 gap-2">
                          {SOLFEGGIO_INFO.filter(s => s.order === 'Fourth').map((s) => {
                            const isActive = selectedSolfeggio === applyLoShuPerfectMap(s.freq);
                            return (
                              <button
                                key={s.freq}
                                onClick={() => {
                                  selectFrequency(s.freq);
                                  setShowFrequencySelector(false);
                                }}
                                className={`py-2 px-2 rounded border transition-colors text-xs ${
                                  isActive
                                    ? 'bg-yellow-600 text-black border-yellow-500 shadow-lg shadow-yellow-500/30'
                                    : 'bg-yellow-900/30 hover:bg-yellow-600 text-yellow-300 hover:text-black border-yellow-600'
                                }`}
                              >
                                {applyLoShuPerfectMap(s.freq)}Hz
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {userExperienceLevel === 'expert' && (
                      <>
                        <div className="mb-4">
                          <h4 className="text-sm font-bold text-orange-400 mb-2 flex items-center gap-1">
                            <AlertTriangle size={14} />
                            Fifth Order (Expert)
                          </h4>
                          <div className="grid grid-cols-3 gap-2">
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Fifth').map((s) => {
                              const isActive = selectedSolfeggio === applyLoShuPerfectMap(s.freq);
                              return (
                                <button
                                  key={s.freq}
                                  onClick={() => {
                                    selectFrequency(s.freq);
                                    setShowFrequencySelector(false);
                                  }}
                                  className={`py-2 px-2 rounded border transition-colors text-xs ${
                                    isActive
                                      ? 'bg-orange-600 text-black border-orange-500 shadow-lg shadow-orange-500/30'
                                      : 'bg-orange-900/30 hover:bg-orange-600 text-orange-300 hover:text-black border-orange-600'
                                  }`}
                                >
                                  {applyLoShuPerfectMap(s.freq)}Hz
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="mb-4">
                          <h4 className="text-sm font-bold text-red-400 mb-2 flex items-center gap-1">
                            <AlertTriangle size={14} />
                            Sixth Order (Research)
                          </h4>
                          <div className="grid grid-cols-3 gap-2">
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Sixth').map((s) => {
                              const isActive = selectedSolfeggio === applyLoShuPerfectMap(s.freq);
                              return (
                                <button
                                  key={s.freq}
                                  onClick={() => {
                                    selectFrequency(s.freq);
                                    setShowFrequencySelector(false);
                                  }}
                                  className={`py-2 px-2 rounded border transition-colors text-xs ${
                                    isActive
                                      ? 'bg-red-600 text-white border-red-500 shadow-lg shadow-red-500/30'
                                      : 'bg-red-900/30 hover:bg-red-600 text-red-300 hover:text-white border-red-600'
                                  }`}
                                >
                                  {applyLoShuPerfectMap(s.freq)}Hz
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="mb-4">
                          <h4 className="text-sm font-bold text-violet-400 mb-2 flex items-center gap-1">
                            <AlertTriangle size={14} />
                            Seventh Order (Master)
                          </h4>
                          <div className="grid grid-cols-3 gap-2">
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Seventh').map((s) => {
                              const isActive = selectedSolfeggio === applyLoShuPerfectMap(s.freq);
                              return (
                                <button
                                  key={s.freq}
                                  onClick={() => {
                                    selectFrequency(s.freq);
                                    setShowFrequencySelector(false);
                                  }}
                                  className={`py-2 px-2 rounded border transition-colors text-xs ${
                                    isActive
                                      ? 'bg-violet-600 text-white border-violet-500 shadow-lg shadow-violet-500/30'
                                      : 'bg-violet-900/30 hover:bg-violet-600 text-violet-300 hover:text-white border-violet-600'
                                  }`}
                                >
                                  {applyLoShuPerfectMap(s.freq)}Hz
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="mb-4">
                          <h4 className="text-sm font-bold text-cyan-400 mb-2 flex items-center gap-1">
                            <AlertTriangle size={14} />
                            Eighth Order (Transpersonal)
                          </h4>
                          <div className="grid grid-cols-3 gap-2">
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Eighth').map((s) => {
                              const isActive = selectedSolfeggio === applyLoShuPerfectMap(s.freq);
                              return (
                                <button
                                  key={s.freq}
                                  onClick={() => {
                                    selectFrequency(s.freq);
                                    setShowFrequencySelector(false);
                                  }}
                                  className={`py-2 px-2 rounded border transition-colors text-xs ${
                                    isActive
                                      ? 'bg-cyan-600 text-white border-cyan-500 shadow-lg shadow-cyan-500/30'
                                      : 'bg-cyan-900/30 hover:bg-cyan-600 text-cyan-300 hover:text-white border-cyan-600'
                                  }`}
                                >
                                  {applyLoShuPerfectMap(s.freq)}Hz
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="mb-4">
                          <h4 className="text-sm font-bold text-pink-400 mb-2 flex items-center gap-1">
                            <AlertTriangle size={14} />
                            <Sparkles size={14} />
                            Ninth Order (Ascension)
                          </h4>
                          <div className="grid grid-cols-3 gap-2">
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Ninth').map((s) => {
                              const isActive = selectedSolfeggio === applyLoShuPerfectMap(s.freq);
                              const isSourceMarker = s.freq === 5031;
                              return (
                                <button
                                  key={s.freq}
                                  onClick={() => {
                                    selectFrequency(s.freq);
                                    setShowFrequencySelector(false);
                                  }}
                                  className={`py-2 px-2 rounded border transition-colors text-xs relative ${
                                    isActive
                                      ? 'bg-pink-600 text-white border-pink-500 shadow-lg shadow-pink-500/30'
                                      : 'bg-pink-900/30 hover:bg-pink-600 text-pink-300 hover:text-white border-pink-600'
                                  } ${isSourceMarker ? 'ring-2 ring-gold-500/50' : ''}`}
                                >
                                  {applyLoShuPerfectMap(s.freq)}Hz
                                  {isSourceMarker && (
                                    <div className="absolute -top-1 -right-1 w-2 h-2 bg-gold-500 rounded-full"></div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                          <div className="mt-2 text-xs text-pink-300 bg-pink-900/20 p-2 rounded border border-pink-800">
                            ⚠️ Transpersonal frequencies - Use extreme caution
                          </div>
                        </div>
                      </>
                    )}
                    
                    <button
                      onClick={() => setShowFrequencySelector(false)}
                      className="w-full py-2 bg-gold-600 hover:bg-gold-500 text-black font-bold rounded"
                    >
                      Close
                    </button>
                  </div>
                  
                  {/*
                  <FrequencySelector
                    selectedFrequency={selectedSolfeggio}
                    onFrequencyChange={(freq) => {
                      setSelectedSolfeggio(freq);
                      setShowFrequencySelector(false);
                    }}
                    volume={solfeggioVolume}
                    onVolumeChange={setSolfeggioVolume}
                    isPlaying={isPlaying}
                    onPlayPause={handlePlayPause}
                    fractalAnalysis={fractalAnalysis}
                    userExperienceLevel={userExperienceLevel}
                    onExperienceLevelChange={setUserExperienceLevel}
                    loShuPerfectGUT={loShuPerfectGUT}
                  />
                  */}
                </div>
              </div>
            </div>
          )}
          
          {/* Safety Protocols Panel */}
          {showSafetyProtocols && (
            <div 
              className="fixed inset-0 z-40 flex items-center justify-center p-4 pb-32 pointer-events-none"
              onClick={() => setShowSafetyProtocols(false)}
            >
              <div 
                className="w-96 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-180px)] overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl shadow-2xl pointer-events-auto my-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-between items-center p-4 border-b border-slate-700">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Shield className="w-5 h-5 text-green-500" />
                    Safety Protocols
                  </h3>
                  <button
                    onClick={() => setShowSafetyProtocols(false)}
                    className="text-slate-400 hover:text-white hover:bg-slate-700 transition-colors p-2 rounded"
                    title="Close Safety Protocols"
                  >
                    <X size={18} />
                  </button>
                </div>
                
                <div className="p-4">
                  <div className="space-y-4">
                    {/* Current Safety Status */}
                    <div className="bg-slate-800 p-3 rounded-lg">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium text-slate-300">Current Frequency</span>
                        <span className="text-lg font-bold text-white">{selectedSolfeggio}Hz</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-400">Safety Level</span>
                        <span className={`text-sm font-bold ${getSafetyLevelColor(assessFrequencySafety(selectedSolfeggio).level)}`}>
                          {assessFrequencySafety(selectedSolfeggio).level}
                        </span>
                      </div>
                    </div>

                    {/* Experience Level */}
                    <div className="bg-slate-800 p-3 rounded-lg">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium text-slate-300">Your Level</span>
                        <span className={`text-sm font-bold ${getExperienceLevelColor(userExperienceLevel)}`}>
                          {userExperienceLevel.charAt(0).toUpperCase() + userExperienceLevel.slice(1)}
                        </span>
                      </div>
                      <select
                        value={userExperienceLevel}
                        onChange={(e) => setUserExperienceLevel(e.target.value as any)}
                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white text-xs"
                      >
                        <option value="beginner">Beginner</option>
                        <option value="intermediate">Intermediate</option>
                        <option value="advanced">Advanced</option>
                        <option value="expert">Expert</option>
                      </select>
                    </div>

                    {/* Session Info */}
                    <div className="bg-slate-800 p-3 rounded-lg">
                      <div className="text-sm font-medium text-slate-300 mb-2">Session Status</div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Duration</span>
                          <span className="text-white">{Math.floor(sessionDuration)}:{((sessionDuration % 1) * 60).toFixed(0).padStart(2, '0')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Volume</span>
                          <span className="text-white">{Math.round(solfeggioVolume * 100)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Mode</span>
                          <span className={subtleResonanceMode ? "text-yellow-400" : "text-green-400"}>
                            {subtleResonanceMode ? "Subtle Resonance" : "Normal"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Safety Recommendations */}
                    <div className="bg-slate-800 p-3 rounded-lg">
                      <div className="text-sm font-medium text-slate-300 mb-2">Recommendations</div>
                      <div className="space-y-1 text-xs text-slate-400">
                        {selectedSolfeggio > 963 ? (
                          <>
                            <div>• Keep volume low (feeling vs hearing)</div>
                            <div>• Focus on subtle body sensations</div>
                            <div>• Limit session to 15-30 minutes</div>
                            <div>• Take breaks between sessions</div>
                            <div>• Stop if you feel uncomfortable</div>
                          </>
                        ) : (
                          <>
                            <div>• Safe frequency for extended use</div>
                            <div>• Recommended for beginners</div>
                            <div>• Good for meditation and healing</div>
                            <div>• Can be used at comfortable volume</div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Emergency Controls */}
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setIsPlaying(false);
                            setShowSafetyProtocols(false);
                          }}
                          className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded"
                        >
                          Emergency Stop
                        </button>
                        <button
                          onClick={() => setSolfeggioVolume(0)}
                          className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded"
                        >
                          Mute
                        </button>
                      </div>
                      
                      {/* Close Button */}
                      <button
                        onClick={() => setShowSafetyProtocols(false)}
                        className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded"
                      >
                        Close Safety Panel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}


          {/* Links & Resources Pull-out Tab */}
          <button
            onClick={() => setShowLinks(!showLinks)}
            className={`fixed right-0 top-1/2 -translate-y-1/2 z-[55] flex items-center gap-1 px-1.5 py-4 rounded-l-lg border border-r-0 transition-all duration-300 ${
              showLinks
                ? 'bg-gold-500/20 border-gold-500/40 text-gold-400 right-[340px] sm:right-[380px]'
                : 'bg-black/80 border-slate-700 text-slate-400 hover:text-gold-400 hover:border-gold-500/30 hover:bg-black/90'
            } backdrop-blur-md`}
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
            title="Links & Resources"
          >
            <ExternalLink size={14} className="rotate-90" />
            <span className="text-[10px] font-bold tracking-widest uppercase">Links</span>
          </button>

          {/* Links & Resources Panel */}
          {/* Click delegation: when Aetheria is installed as a PWA and run
              in standalone mode, browsers ignore target="_blank" and
              navigate inside the PWA window — replacing the player with
              the linked site and killing playback. Explicitly calling
              window.open() forces the system browser to handle external
              HTTP(S) links. mailto: / tel: pass through untouched so
              they still hand off to the OS handler. */}
          <div
            onClick={(e: React.MouseEvent<HTMLDivElement>) => {
              const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
              if (!anchor) return;
              const href = anchor.getAttribute('href') || '';
              if (href.startsWith('http://') || href.startsWith('https://')) {
                e.preventDefault();
                window.open(href, '_blank', 'noopener,noreferrer');
              }
            }}
            className={`fixed inset-y-0 right-0 z-[54] w-[340px] sm:w-[380px] bg-black/95 backdrop-blur-xl border-l border-slate-800 flex flex-col shadow-2xl transition-transform duration-300 ${
            showLinks ? 'translate-x-0' : 'translate-x-full'
          }`}>
            <div className="flex justify-between items-center p-5 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full border border-gold-500/40 flex items-center justify-center">
                  <span className="text-gold-400 font-serif text-lg">A</span>
                </div>
                <div>
                  <h3 className="text-gold-400 font-serif text-lg tracking-wide">AETHERIA</h3>
                  <p className="text-[10px] text-slate-500 italic">Healing the world heART</p>
                </div>
              </div>
              <button onClick={() => setShowLinks(false)} className="p-2 hover:bg-slate-800 rounded-full">
                <X className="text-slate-500 hover:text-white" size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-5 pb-32">

              {/* Apps & Tools */}
              <div>
                <div className="text-[9px] text-slate-600 tracking-[.2em] uppercase text-center mb-3">Apps & Tools</div>
                <div className="space-y-2">
                  <a href="https://aetheriarct.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-purple-500/40 transition-all group">
                    <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                      <Brain size={16} className="text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-slate-200 group-hover:text-purple-400 transition-colors">Aetheria RCT</h4>
                      <p className="text-[10px] text-slate-500">Muse 2 EEG neuro-adaptive coherence training</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-700 group-hover:text-purple-500 transition-colors shrink-0" />
                  </a>
                  <a href="https://aetheria-coherence-lab.org" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-blue-500/40 transition-all group">
                    <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                      <Hexagon size={16} className="text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-slate-200 group-hover:text-blue-400 transition-colors">Aetheria Coherence Lab</h4>
                      <p className="text-[10px] text-slate-500">Adaptive biofield coherence instrument — H10 + Muse + Woojer</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-700 group-hover:text-blue-500 transition-colors shrink-0" />
                  </a>
                  <a href="https://aetheria-session-tagger.org" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-emerald-500/40 transition-all group">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                      <BarChart3 size={16} className="text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-slate-200 group-hover:text-emerald-400 transition-colors">Aetheria Session Tagger</h4>
                      <p className="text-[10px] text-slate-500">Add subjective context to your Coherence Lab sessions</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-700 group-hover:text-emerald-500 transition-colors shrink-0" />
                  </a>
                </div>
              </div>

              {/* Sophia */}
              <div>
                <div className="text-[9px] text-slate-600 tracking-[.2em] uppercase text-center mb-3">Sophia</div>
                <a href="https://aetheriasos.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-pink-500/40 transition-all group">
                  <div className="w-9 h-9 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center shrink-0">
                    <Sparkles size={16} className="text-pink-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-slate-200 group-hover:text-pink-400 transition-colors">Sophia</h4>
                    <p className="text-[10px] text-slate-500">Your personal AI companion — runs locally, no cloud</p>
                  </div>
                  <ChevronRight size={14} className="text-slate-700 group-hover:text-pink-500 transition-colors shrink-0" />
                </a>
              </div>

              {/* Books */}
              <div>
                <div className="text-[9px] text-slate-600 tracking-[.2em] uppercase text-center mb-3">Books</div>
                <div className="space-y-2">
                  <a href="https://a.co/d/079tM297" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-pink-500/40 transition-all group">
                    <div className="w-9 h-9 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center shrink-0">
                      <BookMarked size={16} className="text-pink-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-slate-200 group-hover:text-pink-400 transition-colors">Aetheria</h4>
                      <p className="text-[10px] text-slate-500">The frequency healing system — foundational text</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-700 group-hover:text-pink-500 transition-colors shrink-0" />
                  </a>
                  <div className="flex items-center gap-3 p-3 bg-slate-900/40 border border-slate-800/60 rounded-lg opacity-70 cursor-default">
                    <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                      <BookOpen size={16} className="text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-slate-200">Aetheria: The Science</h4>
                      <p className="text-[10px] text-slate-500">A research-driven deep dive — currently in editing</p>
                    </div>
                    <span className="text-[9px] text-slate-500 tracking-[.15em] uppercase shrink-0">Coming soon</span>
                  </div>
                  <a href="https://a.co/d/0ckEN0Qs" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-orange-500/40 transition-all group">
                    <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                      <Globe size={16} className="text-orange-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-slate-200 group-hover:text-orange-400 transition-colors">Cosmic Rhythms</h4>
                      <p className="text-[10px] text-slate-500">How sun, moon & earth shape your biology</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-700 group-hover:text-orange-500 transition-colors shrink-0" />
                  </a>
                  <a href="https://a.co/d/04Y1pUtE" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-red-500/40 transition-all group">
                    <div className="w-9 h-9 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                      <Heart size={16} className="text-red-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-slate-200 group-hover:text-red-400 transition-colors">SFB — A TBI Guide</h4>
                      <p className="text-[10px] text-slate-500">Navigating traumatic brain injury recovery</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-700 group-hover:text-red-500 transition-colors shrink-0" />
                  </a>
                </div>
              </div>

              {/* Music */}
              <div>
                <div className="text-[9px] text-slate-600 tracking-[.2em] uppercase text-center mb-3">Music</div>
                <a href="https://open.spotify.com/artist/4CXB2ctrUCvInDQkKDhw4q" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-green-500/40 transition-all group">
                  <div className="w-9 h-9 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
                    <Music size={16} className="text-green-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-slate-200 group-hover:text-green-400 transition-colors">Aetheria on Spotify</h4>
                    <p className="text-[10px] text-slate-500">Lyric-aligned healing music</p>
                  </div>
                  <ChevronRight size={14} className="text-slate-700 group-hover:text-green-500 transition-colors shrink-0" />
                </a>
              </div>

              {/* Simulations */}
              <div>
                <div className="text-[9px] text-slate-600 tracking-[.2em] uppercase text-center mb-3">Interactive Simulations</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { href: 'https://big-banana-studios.github.io/aetheria-voxel/', icon: '🧊', title: 'Resonance of the Spheres', sub: 'Voxel meditation PWA · Muse S, Athena & Polar H10' },
                    { href: 'https://lilrobodue.github.io/Lewis-Vortex-Model/', icon: '🌀', title: 'Lewis Vortex Model', sub: 'Formation Theory' },
                    { href: 'https://lilrobodue.github.io/Unified-Scale-Navigator/', icon: '🔬', title: 'Unified Scale Navigator', sub: 'Quantum to cosmic' },
                    { href: 'https://lilrobodue.github.io/HRV-Coherence-Visualizer/', icon: '💓', title: 'HRV Coherence Visualizer', sub: 'Heart rate variability' },
                    { href: 'https://lilrobodue.github.io/Schumann-Biology-Simulator/', icon: '🌍', title: 'Schumann Biology Simulator', sub: "Earth's resonance" },
                    { href: 'https://lilrobodue.github.io/Cellular-Voltage-Frequency-Model/', icon: '⚡', title: 'Cellular Voltage Model', sub: 'Frequency & cell health' },
                    { href: 'https://lilrobodue.github.io/Galactic-Scale-Vortex-Formation/', icon: '🌌', title: 'Galactic Vortex Formation', sub: 'Cosmic scale structure' },
                  ].map((sim) => (
                    <a key={sim.href} href={sim.href} target="_blank" rel="noopener noreferrer" className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-blue-500/30 transition-all text-center group">
                      <div className="text-xl mb-1">{sim.icon}</div>
                      <h4 className="text-[11px] font-medium text-slate-300 group-hover:text-blue-400 transition-colors leading-tight">{sim.title}</h4>
                      <p className="text-[9px] text-slate-600 mt-1">{sim.sub}</p>
                    </a>
                  ))}
                </div>
              </div>

              {/* Community & Social */}
              <div>
                <div className="text-[9px] text-slate-600 tracking-[.2em] uppercase text-center mb-3">Community & Social</div>
                <div className="space-y-2">
                  <a href="https://discord.gg/ddR3MfgCsM" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-indigo-500/40 transition-all group">
                    <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
                      <MessageCircle size={16} className="text-indigo-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-slate-200 group-hover:text-indigo-400 transition-colors">Th3 L0unG3 — Discord</h4>
                      <p className="text-[10px] text-slate-500">365+ healing frequency songs · community · resources</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-700 group-hover:text-indigo-500 transition-colors shrink-0" />
                  </a>
                  <a href="https://www.youtube.com/@Aetheria432" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-red-500/40 transition-all group">
                    <div className="w-9 h-9 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                      <Play size={16} className="text-red-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-slate-200 group-hover:text-red-400 transition-colors">YouTube</h4>
                      <p className="text-[10px] text-slate-500">Aetheria content, demos, and explorations</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-700 group-hover:text-red-500 transition-colors shrink-0" />
                  </a>
                  <a href="https://x.com/TheyCallmeJobo" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-orange-500/40 transition-all group">
                    <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                      <ExternalLink size={16} className="text-orange-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-slate-200 group-hover:text-orange-400 transition-colors">X / Twitter</h4>
                      <p className="text-[10px] text-slate-500">@TheyCallmeJobo — thoughts, updates, frequencies</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-700 group-hover:text-orange-500 transition-colors shrink-0" />
                  </a>
                </div>
              </div>

              {/* Contact */}
              <div>
                <div className="text-[9px] text-slate-600 tracking-[.2em] uppercase text-center mb-3">Contact</div>
                <a href="mailto:Aetheria432@pm.me" className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-gold-500/40 transition-all group">
                  <div className="w-9 h-9 rounded-lg bg-gold-500/10 border border-gold-500/20 flex items-center justify-center shrink-0">
                    <Mail size={16} className="text-gold-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-slate-200 group-hover:text-gold-400 transition-colors">Aetheria432@pm.me</h4>
                    <p className="text-[10px] text-slate-500">Questions, collaborations, research inquiries</p>
                  </div>
                  <ChevronRight size={14} className="text-slate-700 group-hover:text-gold-500 transition-colors shrink-0" />
                </a>
              </div>

              {/* Footer */}
              <div className="text-center pt-4 pb-6 space-y-1">
                <div className="text-sm">🙏</div>
                <div className="text-[10px] text-slate-600 italic">Healing the world heART</div>
                <div className="text-[9px] text-slate-700">© 2026 Aetheria432.com</div>
                <div className="text-[8px] text-slate-700">27 frequencies · 432 Hz · 3-6-9</div>
                <div className="text-[8px] text-slate-700">Built with love</div>
              </div>
            </div>
          </div>

          {/* NEW FOOTER - SNAPPED TO BOTTOM */}
          <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none flex justify-center">
             <div className="pointer-events-auto w-full bg-black/90 backdrop-blur-xl border-t border-slate-800 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] transition-all duration-300 group">
                
                {/* Seek Bar with Phi Timing Markers */}
                <div 
                    className="w-full h-1 hover:h-2 bg-slate-800/50 cursor-pointer relative transition-all group-hover:h-2"
                    onClick={handleSeek}
                >
                    <div className="absolute inset-y-0 left-0 bg-gold-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]" style={{width: `${(currTime / (currDuration || 1)) * 100}%`}}></div>
                    
                    {/* Phi timing markers */}
                    {enablePhiMode && phiTimingEnabled && currDuration > 0 && (
                      <>
                        {/* Build phase end marker (38.2%) */}
                        <div 
                          className="absolute top-0 bottom-0 w-0.5 bg-purple-400/50"
                          style={{left: `${INV_PHI_SQUARED * 100}%`}}
                          title="Build Phase End (38.2%)"
                        />
                        
                        {/* Peak moment marker (61.8%) */}
                        <div 
                          className="absolute top-0 bottom-0 w-1 bg-purple-400"
                          style={{left: `${INV_PHI * 100}%`}}
                          title="Golden Moment Peak (61.8%)"
                        >
                          <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
                        </div>
                      </>
                    )}
                </div>

                <div className="px-3 py-3 flex flex-col items-center gap-2">
                    
                    {/* Top Row: Info */}
                    <div className="flex flex-wrap justify-center items-center gap-x-3 gap-y-1 text-[10px] font-medium text-slate-400">
                        <span className="text-slate-200 truncate max-w-[150px] sm:max-w-[300px] font-bold">
                            {playlist[currentSongIndex]?.name || "Aetheria Harmonic Player"}
                        </span>
                        
                        <div className="flex items-center gap-2">
                         {(() => {
                           // Footer Hz pill — reflects Lo Shu Perfect mode by displaying
                           // the swapped GUT counterpart and tinting the pill emerald, so
                           // the badge always tells the truth about what's playing.
                           const rawFreq = playlist[currentSongIndex]?.closestSolfeggio || selectedSolfeggio;
                           const displayFreq = applyLoShuPerfectMap(rawFreq);
                           const isLoShuSwap = loShuPerfectGUT && displayFreq !== rawFreq;
                           const pillClass = isLoShuSwap
                             ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                             : subtleResonanceMode
                               ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                               : 'bg-gold-500/10 text-gold-500 border-gold-500/20';
                           return (
                             <span
                               className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${pillClass}`}
                               title={
                                 isLoShuSwap
                                   ? `Lo Shu Perfect: playing ${displayFreq} Hz (Solfeggio ${rawFreq} Hz mapped to its perfect 111 Hz counterpart). Sacred Geometry: ${getCurrentSacredGeometry().shape}.`
                                   : `Sacred Geometry: ${getCurrentSacredGeometry().shape} (${getCurrentSacredGeometry().element} Element)`
                               }
                             >
                               <Activity size={8} />
                               {displayFreq}Hz
                               {subtleResonanceMode && <Zap size={8} />}
                             </span>
                           );
                         })()}
                         {loShuPerfectGUT && (
                           <span
                             className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-[10px] font-medium uppercase tracking-wider"
                             title="Lo Shu Perfect mode is active. Toggle from the Lo Shu button in the player toolbar, or in the Guidebook's Lo Shu Cube panel."
                           >
                             Lo Shu
                           </span>
                         )}
                         {loShuWalkMode && (() => {
                           // Walk indicator pill — surfaces the current walk mode and
                           // (when the current song's closestSolfeggio is one of the
                           // 27 walk frequencies) the Lo Shu position + compass dir.
                           const rawFreq = playlist[currentSongIndex]?.closestSolfeggio;
                           const pos = rawFreq ? getLoShuPosition(rawFreq) : null;
                           const info = LO_SHU_WALK_INFO[loShuWalkMode];
                           return (
                             <span
                               className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-[10px] font-medium uppercase tracking-wider"
                               title={`Lo Shu Walk · ${info.fullName} — ${info.philosophy}`}
                             >
                               <Box size={8} />
                               <span className="hidden sm:inline">Lo Shu · </span>
                               {info.shortName}
                               {pos && (
                                 <span className="ml-1 text-emerald-400/80 normal-case font-mono">
                                   · {pos.regime} {pos.position} ({pos.direction})
                                 </span>
                               )}
                             </span>
                           );
                         })()}
                         {loShuWalkMode && currentSongIndex >= 0 && playlist.length > 0 && (() => {
                           // Walk-progress chip — shows position within the current
                           // walk segment + overall step. Segment names by mode:
                           //   combined  → Vortex / Ascent / Pillar          (3 segs)
                           //   ouroboros → Ouroboros                          (1 seg)
                           //   cabi      → Vortex / Ascent / Pillar / Ouroboros (4 segs)
                           // Single walks fall back to a plain "M/total" counter.
                           // For Ouroboros/CABI we also surface ♾️/✕ phase tokens
                           // at the SOURCE crossings via loShuWalkPhases.
                           const stepIdx = currentSongIndex + 1;
                           const total = playlist.length;
                           const SEGMENT_NAMES: Partial<Record<LoShuWalkMode, string[]>> = {
                             combined: ['Vortex', 'Ascent', 'Pillar'],
                             ouroboros: ['Ouroboros'],
                             cabi: ['Vortex', 'Ascent', 'Pillar', 'Ouroboros'],
                           };
                           const segments = SEGMENT_NAMES[loShuWalkMode];
                           const phaseToken = loShuWalkPhases?.[currentSongIndex] || '';
                           if (segments && loShuWalkSegments && loShuWalkSegments.length === segments.length) {
                             let accumulated = 0;
                             let segIdx = 0;
                             for (let i = 0; i < loShuWalkSegments.length; i++) {
                               if (currentSongIndex < accumulated + loShuWalkSegments[i]) {
                                 segIdx = i;
                                 break;
                               }
                               accumulated += loShuWalkSegments[i];
                             }
                             const segName = segments[segIdx];
                             const segLen = loShuWalkSegments[segIdx];
                             const segPos = currentSongIndex - accumulated + 1;
                             return (
                               <span
                                 className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-emerald-500/5 text-emerald-300/90 border-emerald-500/20 text-[10px] font-mono"
                                 title={`Currently in the ${segName} segment. Overall step ${stepIdx} of ${total}.${phaseToken ? ` Phase: ${phaseToken}` : ''}`}
                               >
                                 {phaseToken && <span className="text-emerald-200">{phaseToken}</span>}
                                 {segName} {segPos}/{segLen}
                                 <span className="text-emerald-400/60">· {stepIdx}/{total}</span>
                               </span>
                             );
                           }
                           return (
                             <span
                               className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-emerald-500/5 text-emerald-300/90 border-emerald-500/20 text-[10px] font-mono"
                               title={`Step ${stepIdx} of ${total} in this walk.`}
                             >
                               {stepIdx}/{total}
                             </span>
                           );
                         })()}
                         <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            <Waves size={8} /> {selectedBinaural.name}
                         </span>
                         
                         {/* Sacred Geometry Status */}
                         <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20"
                           title={`${getCurrentSacredGeometry().shape} manifesting`}>
                           <Box size={8} /> 
                           {getCurrentSacredGeometry().element}
                         </span>

                         {/* Advanced Features Status */}
                         {fractalAnalysis && (
                           <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                             <Target size={8} /> 
                             Φ{Math.round(fractalAnalysis.goldenRatioAlignment * 100)}%
                           </span>
                         )}
                         
                         {isDocumentingEffects && (
                           <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                             <BookOpen size={8} /> 
                             Recording
                           </span>
                         )}
                         
                         {isScanning && (
                           <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                             <Activity size={8} className="animate-pulse" />
                             Analyzing {scanProgress}%
                           </span>
                         )}
                         
                         <span className="font-mono text-slate-600 ml-1">
                            {formatDuration(currTime)} / {formatDuration(currDuration)}
                         </span>
                         
                         {/* Phi timing phase indicator */}
                         {enablePhiMode && phiTimingEnabled && currDuration > 0 && (
                           <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 ml-2">
                             <Sparkles size={8} />
                             {(() => {
                               const progress = currTime / currDuration;
                               if (progress <= INV_PHI_SQUARED) return "Build";
                               else if (progress <= INV_PHI) return "Peak";
                               else return "Resolve";
                             })()}
                           </span>
                         )}
                        </div>
                    </div>

                    {/* Bottom Row: Controls */}
                    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 w-full">
                        
                        {/* Playback Controls */}
                        <div className="flex items-center gap-3 relative">
                            <button onClick={() => setIsShuffle(!isShuffle)} className={`${isShuffle ? 'text-gold-500' : 'text-slate-600'} hover:text-white transition-colors`}><Shuffle size={14}/></button>
                            <button onClick={handlePrev} className="text-slate-300 hover:text-white transition-colors"><SkipBack size={16}/></button>

                            <button
                                onClick={handlePlayPause}
                                className="w-8 h-8 rounded-full bg-gold-500 hover:bg-gold-400 flex items-center justify-center text-black shadow-lg shadow-gold-500/20 transition-all hover:scale-105 active:scale-95"
                            >
                                {isPlaying ? <Pause size={16} fill="black" /> : <Play size={16} fill="black" className="ml-0.5" />}
                            </button>

                            <button onClick={handleNext} className="text-slate-300 hover:text-white transition-colors"><SkipForward size={16}/></button>
                            <button onClick={() => setIsLoop(!isLoop)} className={`${isLoop ? 'text-gold-500' : 'text-slate-600'} hover:text-white transition-colors`}><Repeat size={14}/></button>

                            {/* Lo Shu Walk shortcut — opens a popover with the three walks. */}
                            <button
                                onClick={() => setShowLoShuWalkMenu((v: boolean) => !v)}
                                className={`${(loShuWalkMode || loShuPerfectGUT) ? 'text-emerald-400' : 'text-slate-600'} hover:text-white transition-colors`}
                                title={
                                    loShuWalkMode
                                        ? `Lo Shu Walk active: ${LO_SHU_WALK_INFO[loShuWalkMode].fullName}${loShuPerfectGUT ? ' · Perfect GUT mapping ON' : ''}`
                                        : loShuPerfectGUT
                                            ? 'Lo Shu Perfect GUT mapping ON · click to open Lo Shu controls'
                                            : 'Lo Shu controls — Perfect GUT toggle + 27-track walks'
                                }
                                aria-haspopup="menu"
                                aria-expanded={showLoShuWalkMenu}
                            >
                                <Box size={14}/>
                            </button>
                            {showLoShuWalkMenu && createPortal(
                                <>
                                    {/* Click-away catcher */}
                                    <div
                                        className="fixed inset-0 z-40"
                                        onClick={() => setShowLoShuWalkMenu(false)}
                                        aria-hidden="true"
                                    />
                                    <div
                                        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-80 max-h-[85vh] overflow-y-auto z-50 p-3 rounded-xl bg-slate-950/95 backdrop-blur-md border border-emerald-500/40 shadow-2xl shadow-emerald-900/40"
                                        role="menu"
                                    >
                                        <div className="flex items-center gap-2 mb-2">
                                            <Box size={14} className="text-emerald-300" />
                                            <div className="text-xs font-bold text-emerald-200 uppercase tracking-wider">Lo Shu Controls</div>
                                            {loShuWalkMode && (
                                                <span className="ml-auto text-[10px] text-emerald-300 font-mono">
                                                    {LO_SHU_WALK_INFO[loShuWalkMode].shortName}
                                                </span>
                                            )}
                                        </div>

                                        {/* Frequency colour mode — chakra palette vs visible-light spectrum. */}
                                        <div className="mb-3 p-2.5 rounded-lg border border-cyan-500/30 bg-cyan-500/5">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <Sparkles size={12} className="text-cyan-300" />
                                                <div className="text-[11px] font-bold text-cyan-200 uppercase tracking-wider">Colour Mode</div>
                                                <span
                                                    className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                                                        frequencyColorMode === 'spectrum'
                                                            ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40'
                                                            : 'bg-slate-800 text-slate-400 border-slate-700'
                                                    }`}
                                                >
                                                    {frequencyColorMode === 'spectrum' ? 'SPECTRUM' : 'CHAKRA'}
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-slate-400 leading-snug mb-2">
                                                Chakra: the traditional Solfeggio palette. Spectrum: the colour each frequency would have if octave-shifted into visible light. Affects the visualizer, the Lo&nbsp;Shu cube, and grid cells.
                                            </p>
                                            <div className="grid grid-cols-2 gap-1.5">
                                                <button
                                                    onClick={() => setFrequencyColorMode('chakra')}
                                                    className={`text-[11px] py-1.5 rounded-md border font-medium transition-colors ${
                                                        frequencyColorMode === 'chakra'
                                                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-100'
                                                            : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-amber-500/40 hover:text-amber-200'
                                                    }`}
                                                >
                                                    Chakra
                                                </button>
                                                <button
                                                    onClick={() => setFrequencyColorMode('spectrum')}
                                                    className={`text-[11px] py-1.5 rounded-md border font-medium transition-colors ${
                                                        frequencyColorMode === 'spectrum'
                                                            ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-100'
                                                            : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-200'
                                                    }`}
                                                >
                                                    Spectrum
                                                </button>
                                            </div>
                                        </div>

                                        {/* Perfect-GUT audio-mapping toggle (was buried in the Guidebook). */}
                                        <div className="mb-3 p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <Volume2 size={12} className="text-emerald-300" />
                                                <div className="text-[11px] font-bold text-emerald-200 uppercase tracking-wider">Perfect GUT</div>
                                                <span
                                                    className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                                                        loShuPerfectGUT
                                                            ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40'
                                                            : 'bg-slate-800 text-slate-500 border-slate-700'
                                                    }`}
                                                >
                                                    {loShuPerfectGUT ? 'ON' : 'OFF'}
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-slate-400 leading-snug mb-2">
                                                Plays GUT-band Solfeggio frequencies at their perfect 111&nbsp;Hz Lo&nbsp;Shu counterparts (174→75, 285→186, 396→297, 417→408, 528→519, 639→630). 741/852/963 are exact matches.
                                            </p>
                                            <button
                                                onClick={() => setLoShuPerfectGUT(!loShuPerfectGUT)}
                                                className={`w-full text-[11px] py-1.5 rounded-md border font-medium transition-colors ${
                                                    loShuPerfectGUT
                                                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-100 hover:bg-emerald-500/30'
                                                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-emerald-500/40 hover:text-emerald-200'
                                                }`}
                                            >
                                                {loShuPerfectGUT ? 'Switch to Solfeggio' : 'Switch to Lo Shu Perfect'}
                                            </button>
                                        </div>

                                        <div className="border-t border-slate-800 pt-3">
                                            <div className="text-[11px] font-bold text-emerald-200 uppercase tracking-wider mb-1">Lo Shu Walks</div>
                                            <p className="text-[10px] text-slate-400 leading-snug mb-2">
                                                Six paths through the cube — three 27-track walks, the 81-step CAB, the 29-step Ouroboros figure-8, and the 110-step CABI that closes the loop.
                                            </p>
                                            {/* 3x2 grid — short walks (A/B/C) on top row, deeper journeys
                                                (CAB/Ouroboros/CABI) on bottom row. Compact form keeps the
                                                whole card on-screen; tooltips carry the longer descriptions. */}
                                            <div className="grid grid-cols-3 gap-1.5">
                                                {([
                                                    { mode: 'A' as LoShuWalkMode, steps: '27', activeClass: 'bg-amber-500/20 border-amber-500/60 text-amber-100', idleClass: 'bg-slate-900 border-slate-700 text-slate-300 hover:border-amber-500/40 hover:text-amber-200', stepColor: 'text-amber-400/80' },
                                                    { mode: 'B' as LoShuWalkMode, steps: '27', activeClass: 'bg-emerald-500/20 border-emerald-500/60 text-emerald-100', idleClass: 'bg-slate-900 border-slate-700 text-slate-300 hover:border-emerald-500/40 hover:text-emerald-200', stepColor: 'text-emerald-400/80' },
                                                    { mode: 'C' as LoShuWalkMode, steps: '27', activeClass: 'bg-purple-500/20 border-purple-500/60 text-purple-100', idleClass: 'bg-slate-900 border-slate-700 text-slate-300 hover:border-purple-500/40 hover:text-purple-200', stepColor: 'text-purple-400/80' },
                                                    { mode: 'combined' as LoShuWalkMode, steps: '81', activeClass: 'bg-gradient-to-br from-amber-500/15 via-emerald-500/15 to-purple-500/20 border-gold-500/60 text-gold-100', idleClass: 'bg-slate-900 border-slate-700 text-slate-300 hover:border-gold-500/40 hover:text-gold-200', stepColor: 'text-gold-400/80' },
                                                    { mode: 'ouroboros' as LoShuWalkMode, steps: '29', activeClass: 'bg-gradient-to-br from-cyan-500/15 to-cyan-700/20 border-cyan-500/60 text-cyan-100', idleClass: 'bg-slate-900 border-slate-700 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-200', stepColor: 'text-cyan-300/80' },
                                                    { mode: 'cabi' as LoShuWalkMode, steps: '110', activeClass: 'bg-gradient-to-br from-gold-500/15 via-cyan-500/15 to-purple-500/20 border-gold-500/60 text-gold-100', idleClass: 'bg-slate-900 border-slate-700 text-slate-300 hover:border-gold-500/40 hover:text-gold-200', stepColor: 'text-gold-400/80' },
                                                ]).map(cfg => {
                                                    const info = LO_SHU_WALK_INFO[cfg.mode];
                                                    const isActive = loShuWalkMode === cfg.mode;
                                                    return (
                                                        <button
                                                            key={cfg.mode}
                                                            onClick={() => generateLoShuWalk(cfg.mode)}
                                                            title={`${info.fullName} — ${info.tagline}`}
                                                            className={`flex flex-col items-center justify-center gap-0.5 p-2 rounded-lg border text-xs transition-colors min-h-[58px] ${
                                                                isActive ? cfg.activeClass : cfg.idleClass
                                                            }`}
                                                        >
                                                            <span className="font-bold text-[11px] leading-tight text-center">{info.shortName}</span>
                                                            <span className={`text-[9px] font-mono uppercase tracking-wider ${cfg.stepColor}`}>{cfg.steps}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        {loShuWalkMode && (
                                            <button
                                                onClick={() => { clearLoShuWalkMode(); setShowLoShuWalkMenu(false); }}
                                                className="mt-3 w-full text-[10px] uppercase tracking-wider py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
                                            >
                                                Clear walk badge
                                            </button>
                                        )}
                                    </div>
                                </>,
                                document.body
                            )}
                        </div>

                        {/* Divider (Hidden on very small screens) */}
                        <div className="w-px h-6 bg-slate-800 hidden sm:block"></div>

                        {/* Volumes */}
                        <div className="flex items-center gap-4">
                            {/* Master */}
                            <div className="flex items-center gap-2 group/vol">
                                <Volume2 size={14} className="text-slate-500 group-hover/vol:text-gold-400 transition-colors" />
                                <input 
                                    type="range" min="0" max="1" step="0.01" 
                                    value={volume} onChange={e => setVolume(parseFloat(e.target.value))} 
                                    className="w-16 sm:w-20 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-gold-500 hover:h-1.5 transition-all" 
                                    title={`Master Volume: ${Math.round(volume*100)}%`}
                                />
                            </div>
                            
                            {/* Binaural */}
                            <div className="flex items-center gap-2 group/bin">
                                <Zap size={14} className="text-slate-500 group-hover/bin:text-blue-400 transition-colors" />
                                <input 
                                    type="range" min="0" max="0.2" step="0.001" 
                                    value={binauralVolume} onChange={e => setBinauralVolume(parseFloat(e.target.value))} 
                                    className="w-16 sm:w-20 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:h-1.5 transition-all" 
                                    title={`Binaural Volume: ${Math.round(binauralVolume/0.2*100)}%`}
                                />
                            </div>

                             {/* Zen Mode Button */}
                             <div className="w-px h-6 bg-slate-800 hidden sm:block ml-2"></div>
                             <button 
                                onClick={() => setIsZenMode(!isZenMode)} 
                                className={`flex items-center justify-center p-1.5 rounded-full transition-colors ${isZenMode ? 'text-gold-500 bg-gold-500/10' : 'text-slate-500 hover:text-white'}`}
                                title={isZenMode ? "Show UI" : "Zen Mode (Hide UI)"}
                             >
                                {isZenMode ? <Eye size={16} /> : <EyeOff size={16} />}
                            </button>
                        </div>

                    </div>
                </div>
             </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
