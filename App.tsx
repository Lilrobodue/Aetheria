import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, 
  Upload, Settings, Info, Activity, Volume2, Maximize2, Minimize2,
  Circle, Zap, X, Menu, Eye, EyeOff, ChevronDown, ChevronUp, BarChart3, Loader2, Sparkles, Sliders, Wind, Activity as PulseIcon, Waves, Wand2, Search, Video, Mic, Monitor, RefreshCw, Flame, Flower2, Layers, Heart, Smile, Moon, Droplets, FilePlus, RotateCw, ArrowUpCircle, Hexagon, AlertTriangle, CircleHelp, ChevronRight, ChevronLeft, BookOpen, User, Map as MapIcon, Box, Trash2, Target, Shield, Calculator, ExternalLink, Music, Brain, BookMarked, MessageCircle, Mail, Globe, Headphones, CheckCircle2, Library, VolumeX
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
  deleteTracksFromCache,
  saveBlobsNow,
  debouncedSaveMeta,
  saveBlobs,
  saveMetaAndState,
  cancelPendingSaves,
  waitForBlobSaves,
  storedTrackIds,
  cacheGeneration,
} from './utils/playlistCache';
import {
  dedupeById,
  sameIdOrder,
  patchById,
  removeIdsWithCursor,
  appendToLibrary,
  splitOrphans,
  refreshById,
} from './utils/library/listOps';
import { countCommit, reportPassWork } from './utils/perfHud';
// v15.8: the mix recipes (pure; selection copied verbatim from here) and the crystal data they share.
import { gutAlignment, heartAlignment, headAlignment, fullAlignment, crystalSetMix, goldenRatioMix, sequence111, sourceField, ultimateAlignment, loShuWalk } from './utils/mix/recipes';
import type { MixInput, MixResult } from './utils/mix/recipes';
import { planAssign, assignDoneText, assignNothingText, deepScanQueue, crystalOrigin } from './utils/mix/distribution';
import { getHarmonicSolfeggio, PRESETS } from './utils/crystalData';
// v15.9: the mix catalogue (names, sub-lines, counts) and the Undo toast's words.
import { mixStartText } from './utils/mix/catalog';
import type { MixId } from './utils/mix/catalog';
import { walkToSave } from './utils/library/walkRecord';
// v16.0: the queue. Its pure model (every write returns the new state and a remap App applies in ONE batch) and its words.
import {
  insertEntries,
  removeEntriesRemap,
  moveWaitingAfter,
  editableWaiting,
  settleMarks,
  gatherShuffled,
  gatherSequentialRemap,
  reconcileMarks,
  rebuildMarks,
  waitingIndices,
  anchorFor,
  shuffleValid,
  queueInPlace,
  queueToSave,
  upcoming,
  upcomingRuns,
  peekNext,
  baseIndex,
  baseCount,
  baseIds,
  queueRun,
  nextBaseAhead,
  walkProgress,
  cubeStep,
  SAME,
  BASE,
} from './utils/queue/queueModel';
import type { Mark, PlayState, Remap, StartState, Anchor } from './utils/queue/queueModel';
import { queuedToast, removedToast, clearedToast, STILL_STARTING_TEXT, QUEUE_CHANGED_TEXT, undoStartedText, carryText, editMissedText } from './components/shell/queue/queueViewModel';
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
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion';
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
// Layer sound v2 (v14.9). LayerPlayer is a STATIC import so it is in the offline
// precache (src/serviceWorker.ts collects the module graph; sw.js serves app
// source network-first).
import { LayerPlayer } from './utils/soundV2/layerPlayer';
import type { LayerPlayerState } from './utils/soundV2/layerPlayer';
import { plan as v2Plan, toneOf, BANDS, BAND_ORDER, bandForIntensity, phiEnvelope, LEVEL_TONE, LEVEL_BEAT, LEVEL_DRONE_SUB } from './utils/soundV2/aetheria_sound_v2';
import type { Band } from './utils/soundV2/aetheria_sound_v2';
import { canonicalLayerHz, renderForOutput, planOutputFor, bandOfPresetName, capBand, sliderGain, gainToDb, readIntensity, BandHysteresis, musicGainFactor, parseLayerEngine, parseLayerOutput, parseOutputAskAgain, parseDroneEnabled, DEFAULT_LAYER_ENGINE, DEFAULT_DRONE_ENABLED, KEY_LAYER_ENGINE, KEY_LAYER_OUTPUT, KEY_LAYER_OUTPUT_ASK_AGAIN, KEY_DRONE_ENABLED, TONE_SLIDER_DEFAULT, BEAT_SLIDER_DEFAULT, V2_TONE_SLIDER_MAX, V2_TONE_SLIDER_STEP, V2_BEAT_SLIDER_MAX, toneLevelKey, defaultToneLevel, parseToneLevel } from './utils/soundV2/layerHost';
import type { LayerEngine, LayerOutput, CanonicalLayer, BeatRender } from './utils/soundV2/layerHost';
import { createSoundLog } from './utils/soundV2/soundLog';
import type { SoundLog, SoundLogFields, StorageLike } from './utils/soundV2/soundLog';
// Analyse tracks (v15.1): key analysis and visual sync. Static imports, so they are in the offline precache.
import { createDecodeContext, analyseKeyOf, needsKey } from './utils/soundV2/keyAnalysis';
import { startPass, capsFor, countAnalysable, upcomingIds, passStartText, passEndText, passButtonText, passEtaMinutes, PASS_IDLE, DEFAULT_TUNING, ANALYSE_INFLIGHT_KEY } from './utils/library/analysePass';
import type { PassHandle, PassProgress, PassTuning, PassSummary, PassPlan, StepRecord } from './utils/library/analysePass';
// Key fit (v15.2): the duck on the v2 layers, from the playing track's key data. Static imports, so they are in the
// offline precache.
import { KeyFitDuck, keyFitFor, keyFitView as keyFitViewOf, keyFitLogFields, riseHold, trackHold, hostGlideHold, laterHold, userFallEnd, gatesSilent, parseKeyFit, KEY_FIT_STORAGE_KEY, DEFAULT_KEY_FIT, DUCK_TAU_S, DUCK_FLIP_TAU_S } from './utils/soundV2/keyFit';
import type { KeyFit, KeyFitView } from './utils/soundV2/keyFit';
import KeyFitRow from './components/layers/KeyFitRow';
import KeyFitChip from './components/layers/KeyFitChip';
import LayerSoundPanel from './components/layers/LayerSoundPanel';
import OutputSheet from './components/layers/OutputSheet';
import OutputQuickSwitch from './components/layers/OutputQuickSwitch';
// v15.4 UI kit and isolation.
import Dialog, { ReadoutActions } from './components/ui/Dialog';
import Button from './components/ui/Button';
import { ViewBoundary, PanelFallback, SafeTransport, VisualsStoppedPill, modalFallback, panelFallback } from './components/ErrorBoundary';
import LayersBadge from './components/layers/LayersBadge';
import DbReadout from './components/layers/DbReadout';
import {
  mergeLayerStatus,
  layersBadgeText,
  layersTooltip,
  bandChipText,
  toneReadout,
  beatReadout,
  feltLineV2,
  TONE_LEVEL_LABEL,
  BEAT_LEVEL_LABEL,
  HEADPHONES_HINT,
  PRESETS_NOTE_V2,
  PRESETS_NOTE_CAR_V2,
  GAMMA_DESCRIPTION_V2,
  PHI_LEVELS_V2,
  PHI_BINAURAL_V2,
  PHI_ENVELOPE_V2,
  KEEP_COMFORTABLE_V2,
  SOUND_LOG_SAVE_FAILED,
  BEAT_OFF_CAR_FALLBACK,
  V2_UNAVAILABLE_CAR_TONE,
  V2_UNAVAILABLE_CAR_RECORDING,
  keyFitChipText,
  keyFitChipTitle,
  keyFitChipTone,
  keyFitRowText,
} from './components/layers/layerCopy';
import type { LayerStatus } from './components/layers/layerCopy';
// v15.5: the new layout (beta), opt-in. React's Activity (the heat guard) is imported ONLY in VisualsPause.tsx: here
// `Activity` is lucide's icon.
import ShellProviders from './components/shell/ShellProviders';
import AppShell from './components/shell/AppShell';
import VisualsPause from './components/shell/VisualsPause';
import PeekPill from './components/shell/PeekPill';
import { useMediaQuery } from './components/shell/useMediaQuery';
import { LAYOUT_KEY, parseLayoutPref, sourceLine, walkSegment, newLayoutNotice, queueSourceLine, queueThen, queueSourceShort } from './components/shell/shellModel';
import type { LayoutPref, ShellTab, ShellSheet, PeekPanel } from './components/shell/shellModel';
import { zenActive } from './components/shell/zenModel';
import { useShellZen } from './components/shell/useShellZen';
import { CRYSTAL_FILTER_KEY, parseCrystalFilter, toneLoweredText } from './components/shell/layers/layersModel';
import type { LayersSection } from './components/shell/layers/layersModel';
// v15.7: the Library tab (new layout). The row tap's pure rules; App's renders are counted in dev builds only.
import { libraryOrderFor, rebuildOrder, stillTapOrder, sameIdSet, sameIds, libraryTapText, UNDO_CHANGED_TEXT, TAP_GONE_TEXT } from './components/shell/library/libraryModel';
import type { LastImport } from './components/shell/library/libraryModel';
import type { LibraryViewState, QueueEdit } from './components/shell/contexts';
import { countRender } from './components/shell/devRenders';

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

// MASTER OUTPUT LEVEL — how loud the music element and the layer bus run.
//
// This was a hard-coded 0.18 (~-15 dB) in every gain formula, described as
// "ultra-conservative volume scaling to prevent any distortion". It predates
// direct playback, when the music still ran through the Web Audio bus and could
// sum with the layers into clipping. With the music now on the <audio> element
// (its own path straight to the OS mixer) that headroom bought nothing — it just
// made every track ~15 dB quieter than the same file on YouTube, so listeners
// had to push the system volume up and lost body and richness on the way.
//
// 1.0 = play the file at its native level, which is what every other player
// does. The layer bus is scaled by this SAME constant at all three call sites,
// so the music : binaural : solfeggio balance is exactly what it was — only the
// overall level moved. To restore the old headroom, set this back to 0.18.
const MUSIC_OUTPUT_LEVEL = 1.0;

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
// "Music only" (v14.6): when it flips, the layer bus and the drone glide to 0
// or back with this time constant: about 1 s to -35 dB, so no click.
const MUSIC_ONLY_FADE_TAU_S = 0.25;
// Dev builds only (npm run dev, the e2e server): tests read the v2 player's
// state. Vite strips this in production.
const IS_DEV_BUILD = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
// Inputs no one types in (v15.4 Zen): a focused slider or button does not hold the hidden UI open.
const ZEN_NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);
// The v2 layer frequency while classic plays: nothing resolved, nothing planned.
const NO_LAYER: CanonicalLayer = { f: 0, id: null, canonical: false };
// Analyse tracks (v15.1) treats a phone as a phone even with "Desktop site" on, which hides it from
// IS_MOBILE_DEVICE's user-agent test: a coarse primary pointer counts too. Used only by the pass and by
// Deep Scan's key step.
const ANALYSE_MOBILE = IS_MOBILE_DEVICE ||
  (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);
// Its length and size caps, tiered by device memory: decoding peaks at about the file's bytes plus twice its
// full-rate PCM (utils/library/analysePass.ts capsFor).
const ANALYSE_CAPS = capsFor(ANALYSE_MOBILE, typeof navigator !== 'undefined' ? (navigator as any).deviceMemory : undefined);
// The key analysis's yield between slices, for the pass and for Deep Scan's key step: a MessageChannel round trip.
// Never a timer: a hidden, silent desktop page throttles chained timers to one wake-up a second, then one a
// minute (spec D17); a message is never throttled.
const yieldToTask = (): Promise<void> =>
  new Promise<void>(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); r(); }; ch.port2.postMessage(0); });

/** localStorage, or null where reading it throws (blocked storage). */
const safeLocalStorage = (): StorageLike | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

/** An engine's saved tone level (v15.0), else its release default; unreadable storage reads as unset. */
const storedToneLevel = (engine: LayerEngine): number => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(toneLevelKey(engine)) : null;
    return parseToneLevel(raw, engine) ?? defaultToneLevel(engine);
  } catch {
    return defaultToneLevel(engine);
  }
};

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

/** Extensions Chrome can actually decode. Checked FIRST, so an audio file still
 *  imports on the rare occasion the browser hands us a blank File.type (a file
 *  off a network share, an odd content provider). In practice Chromium fills
 *  the type in from its own extension table, so this is a safety net rather
 *  than the main path — the MIME check below does most of the work. */
const AUDIO_FILE_RE = /\.(mp3|wav|flac|m4a|mp4|aac|ogg|oga|opus|webm|aif|aiff)$/i;

/** MIME types that START with "audio/" but are NOT a decodable track, so the
 *  MIME backstop below can't quietly re-admit what the extension list rejects.
 *  Chrome hands .m3u "audio/x-mpegurl" and .wma "audio/x-ms-wma" — the first is
 *  a playlist, the second Chrome cannot decode. */
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
// `beforeBand` (Analyse tracks) runs before each band's render and may throw to abandon the envelope.
const analyzeBandEnvelopes = async (buffer: AudioBuffer, fps = 20, beforeBand?: (band: number) => Promise<void>): Promise<BandEnvelope | undefined> => {
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

  if (beforeBand) await beforeBand(0);
  const sub = await renderBand((ctx, src) => {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 60; f.Q.value = 0.7;
    src.connect(f); return f;
  });
  if (beforeBand) await beforeBand(1);
  const bass = await renderBand((ctx, src) => {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 250;
    src.connect(hp); hp.connect(lp); return lp;
  });
  if (beforeBand) await beforeBand(2);
  const mid = await renderBand((ctx, src) => {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.7;
    src.connect(f); return f;
  });
  if (beforeBand) await beforeBand(3);
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

// v15.8: getHarmonicSolfeggio moved VERBATIM to utils/crystalData.ts (imported above, same name).

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
                    <li className="flex gap-2">🎯 <strong className="text-gold-200">Auto-Distribute Frequencies:</strong> Keeps the frequencies Deep Scan found and gives every other song one of the 27 across the GUT, HEART, and HEAD ranges, empty ones first.</li>
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
                    <li className="flex gap-2">🧩 <strong className="text-gold-200">Crystal Sets:</strong> Grounding, Stillness, Uplift, Meditation and Flow, each a few crystals from the GUT range.</li>
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
                    <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-white transition-colors"><X size={24} /></button>
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

// --- Launch disclaimer ---
// Acceptance is saved per wording version (v14.6): the disclaimer shows on
// first launch, and once more whenever DISCLAIMER_VERSION changes. Change it
// with ANY change to the disclaimer's wording (App's "Disclaimer Modal" JSX),
// and only then: restyling or moving the text must not re-show it. The value is
// the date of the current wording: v15.0's driving line, with the old line's
// heavy-machinery caution kept as its own sentence (2026-10-21; before it,
// '2026-04-16' from update 7.7, 632f266). Never derive it from the app version.
// (The e2e suite pins the wording: disclaimer.spec.ts fails when it changes.)
const DISCLAIMER_VERSION = '2026-10-21';
// Holds the accepted DISCLAIMER_VERSION. '.v1' is the storage format, like the
// other aetheria.*.v1 keys. The Nov 2025 key 'aetheria_v3_disclaimer' accepted
// an older text and is ignored.
const DISCLAIMER_STORAGE_KEY = 'aetheria.disclaimer.v1';

/** v15.9: how long the Mixes tab waits for the saved library to be read back before it shows what it has. */
const LIBRARY_LOADING_MAX_MS = 15_000;

/** v15.7: what a Library row's tap replaced, for its Undo (App's startPlayOrder / undoPlayOrder). Ids only, never
 *  Song objects: the Undo rebuilds the order from the library as it is then. */
interface PlayOrderSnapshot {
  ids: string[];
  cursor: number;
  shuffled: number[];
  shufflePos: number;
  walk: { mode: LoShuWalkMode; segments: number[] | null; phases: string[] | null; steps: number[] | null } | null;
  trackId: string | null;
  position: number;
  wasPlaying: boolean;
  /** v15.9: the tone as it was (the crystal, and whether it sounded on its own: tone-only), so the Undo puts it back. */
  tone: { hz: number; active: boolean };
  /** cacheGeneration() at the tap: a Clear since makes the Undo a no-op. */
  generation: number;
  /** The order the tap started: any other play order since makes the Undo refuse. */
  newIds: string[];
  /** Only the latest tap's Undo acts. */
  token: number;
  /** When the latest tap of a chain was made (its toast's 10 s run from here). */
  at: number;
  /** The chain's toast (the first tap's words: what it stopped). */
  toast: string;
  /** statusToastSeqRef once this tap's toast showed (-1: none showed): another toast since ends the chain. */
  toastSeq: number;
  /** v15.9: a mix started it (else a Library row). Only taps of one kind chain: a row tapped while a mix's toast shows
   *  gets its own Undo, back to the mix (and the reverse). */
  mix: boolean;
  /** v16.0: the queue's marks over `ids` (null: none), so the Undo brings the earlier order back with its queue. */
  marks: Mark[] | null;
}

/** v16.0: a queue write, applied once the play state is settled (the anchor rule), else retried every 150 ms for 15 s. */
type QueueOp =
  | { kind: 'add'; ids: string[]; mode: 'next' | 'queue' }
  | { kind: 'remove'; index: number; id: string }
  | { kind: 'move'; index: number; id: string; to: number }
  | { kind: 'clear' }
  | { kind: 'undo'; token: number }
  | { kind: 'gather' };

/** v16.0: what the latest queue toast's Undo reverses. `after`: the waiting tracks' ids just after the write (the
 *  ones a later edit may touch, in queue order): the Undo acts only while the queue is still that, less what has played
 *  from its front since. */
type QueueUndo =
  | { token: number; kind: 'add'; after: string[]; mine: number[]; names: string[] }
  | { token: number; kind: 'remove'; after: string[]; id: string; pos: number }
  | { token: number; kind: 'clear'; after: string[]; ids: string[] };

const App: React.FC = () => {
  countRender('App');
  const [playlist, setPlaylist] = useState<Song[]>([]);
  const [originalPlaylist, setOriginalPlaylist] = useState<Song[]>([]);
  // Playlist cache (IndexedDB) — persists the library across reloads.
  // `isRestoring` gates the auto-save effect so the act of restoring doesn't
  // immediately re-trigger a save of what we just read back.
  const [isRestoring, setIsRestoring] = useState(false);
  // How many library tracks the restore brought back, for its toast.
  const [restoredCount, setRestoredCount] = useState(0);
  // v15.9: the saved library has not been read back yet (the first restore is in flight): the Mixes tab says
  // "Loading your library…" and waits, rather than offering an empty library's Import music.
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [currentSongIndex, setCurrentSongIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isLoop, setIsLoop] = useState(false);
  
  // Search functionality
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredPlaylist, setFilteredPlaylist] = useState<Song[]>([]);
  
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
    // v16.0: a play recorded before its cursor commits (both callers set the cursor in the same batch): until the commit
    // that holds it acknowledges it (queuePlayAck), the queue's anchor knows a start is landing. A request that had not
    // started yet is a playTrack's last step; else the gapless swap.
    const wasPending = startedRequestRef.current !== playRequestSeqRef.current;
    queueLandingRef.current = { seq: queueLandingRef.current.seq + 1, kind: wasPending ? 'start' : 'swap' };
    setQueuePlayAck(queueLandingRef.current.seq);
    // v15.9: the play request that has started (playTrack and the gapless swap call this once the track plays):
    // Restore Library tells a start still in flight from one that has landed by it.
    startedRequestRef.current = playRequestSeqRef.current;
  };

  const [showInfo, setShowInfo] = useState(false);
  const [guidebookView, setGuidebookView] = useState<'accessible' | 'technical'>('accessible');
  const [showSettings, setShowSettings] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  
  // Zen Mode with Mouse Detect
  const [isZenMode, setIsZenMode] = useState(false);
  const [zenUiVisible, setZenUiVisible] = useState(true);
  const zenTimeoutRef = useRef<number | null>(null);
  // v15.4: Zen's reveal (the effect's handler) for the root's tap and the "Show controls" button, and whether the UI
  // shows now (taps while it shows keep it showing).
  const zenRevealRef: { current: (() => void) | null } = useRef(null);
  const zenShownRef: { current: boolean } = useRef(true);
  // The UI layer Zen hides (its inert wrapper): a field focused inside it keeps the UI showing.
  const zenLayerRef: { current: HTMLDivElement | null } = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [showRecordOptions, setShowRecordOptions] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showLinks, setShowLinks] = useState(false);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  
  const [currTime, setCurrTime] = useState(0);
  // v15.5: the new layout (beta), opt-in (Harmonic Control's "Try the new layout"); classic is the default. Read once,
  // synchronously, in this initialiser, so the first frame is already the right layout (no flash of classic). A missing
  // or invalid value means classic. Written only by a tap (setLayout, below) or by ?layout= (the effect below).
  const [layout, setLayoutState] = useState<LayoutPref>(() => {
    try {
      return parseLayoutPref(
        typeof localStorage !== 'undefined' ? localStorage.getItem(LAYOUT_KEY) : null,
        new URLSearchParams(window.location.search).get('layout')
      );
    } catch {
      return 'classic';
    }
  });
  // The new layout's tab and open sheet (memory only: a reload opens Now Playing), and a stub's "peek" into classic
  // (decision 4: classic shows with `layout` still 'new', and a pill comes back).
  const [shellTab, setShellTab] = useState<ShellTab>('now');
  const [shellSheet, setShellSheet] = useState<ShellSheet | null>(null);
  const [sheetFocus, setSheetFocus] = useState<'output' | 'recover' | null>(null);
  const [classicPeek, setClassicPeek] = useState<PeekPanel | null>(null);
  // The desktop shell from 1024 × 600 (a laptop, a landscape iPad); anything smaller gets the phone shell.
  const desktopShell = useMediaQuery('(min-width: 1024px) and (min-height: 600px)');
  // v15.6: Zen in the new layout, its own switch (classic's Zen is isZenMode, untouched). Never saved (decision 2): each
  // launch starts with the controls showing. useShellZen (before the insets effect) owns whether they show now.
  const [shellZen, setShellZen] = useState(false);
  // The shell's root (Zen: a field being typed in keeps it shown), where the Layers tab was left, the notices' slot
  // while Zen hides the bars, and whether the new layout shows, for callbacks (the high-frequency check).
  const shellRootRef: { current: HTMLDivElement | null } = useRef(null);
  const layersScrollRef: { current: { top: number; jump: LayersSection | null } } = useRef({ top: 0, jump: null });
  const noticeInsetsRef: { current: { top: number; bottom: number } } = useRef({ top: 0, bottom: 0 });
  const shellOnRef: { current: boolean } = useRef(false);
  // v15.7, the Library tab: where it was left (its query, its scroll and the health card's fold; session only, the
  // query never saved), the last import (the Import sheet's summary), the latest row tap's Undo, and the list element
  // that takes the focus when a deleted row's ⋯ is gone.
  const libraryViewRef: { current: LibraryViewState } = useRef({ query: '', top: 0, healthOpen: null });
  const [lastImport, setLastImport] = useState<LastImport | null>(null);
  const lastPlayOrderRef: { current: PlayOrderSnapshot | null } = useRef(null);
  // v15.9: the latest classic notice a mix showed (in classic, or a classic peek). The new layout never routes it to its
  // one toast slot: there the mix's Undo toast is the message, and a notice still up when a peek ends would replace it.
  const mixNoticeRef: { current: string | null } = useRef(null);
  const playOrderSeqRef: { current: number } = useRef(0);
  const libraryFocusTargetRef: { current: HTMLElement | null } = useRef(null);
  // v15.6: the Layers tab's optional experience filter on the crystals (plan decision 11): off unless the user turns it
  // on; saved from its switch (and Show all) only, never from an effect.
  const [crystalFilter, setCrystalFilter] = useState<boolean>(() => {
    try { return parseCrystalFilter(typeof localStorage !== 'undefined' ? localStorage.getItem(CRYSTAL_FILTER_KEY) : null); }
    catch { return false; }
  });
  const chooseCrystalFilter = useCallback((on: boolean) => {
    setCrystalFilter(on);
    try { localStorage.setItem(CRYSTAL_FILTER_KEY, String(on)); } catch {}
  }, []);
  // ?layout=new / ?layout=classic set the choice and save it (for tests, and an escape hatch on a desktop). Then the
  // param leaves the address, so a reload follows the saved choice (a later Back to classic, say), not a stale URL.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams.get('layout');
      if (q === null) return;
      if (q === 'new' || q === 'classic') localStorage.setItem(LAYOUT_KEY, q);
      url.searchParams.delete('layout');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {}
  }, []);
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
  
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  
  const [isVizPanelOpen, setIsVizPanelOpen] = useState(true);

  // Disclaimer & Tutorial State
  
  // Shown until this device accepts the current wording (DISCLAIMER_VERSION).
  // Read once, lazily, so an accepted disclaimer never flashes; unreadable
  // storage means it shows.
  const [disclaimerAccepted, setDisclaimerAccepted] = useState<boolean>(() => {
    try {
      return typeof localStorage !== 'undefined'
        && localStorage.getItem(DISCLAIMER_STORAGE_KEY) === DISCLAIMER_VERSION;
    } catch {
      return false;
    }
  });
  const [showTutorial, setShowTutorial] = useState(false);
  // Set by Safety Protocols' "Read the disclaimer", so accepting it again
  // doesn't start the first-run tutorial in the middle of a session.
  const rereadingDisclaimerRef = useRef(false);

  const acceptDisclaimer = () => {
      setDisclaimerAccepted(true);
      try {
        localStorage.setItem(DISCLAIMER_STORAGE_KEY, DISCLAIMER_VERSION);
      } catch {
        // Full or blocked storage: accepted for this session only.
      }
      // Show tutorial after first acceptance if not seen — not when the
      // disclaimer was reopened to read it (Safety Protocols).
      if (rereadingDisclaimerRef.current) {
        rereadingDisclaimerRef.current = false;
        return;
      }
      let tutorialSeen: string | null = 'true'; // storage unreadable: don't nag
      try {
        tutorialSeen = localStorage.getItem('aetheria_v3_tutorial_seen');
      } catch {}
      if (!tutorialSeen) {
          setShowTutorial(true);
      }
  };

  const closeTutorial = () => {
      setShowTutorial(false);
      try {
        localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      } catch {}
  };

  // Visual settings — persisted to localStorage so the user's tuning survives
  // reloads and new sessions. If VizSettings changes incompatibly, bump the
  // key's version suffix; values saved under the old key are then ignored.
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
    // hexWander and frameRate stay unset until the user taps them (every reader
    // treats unset as ON / Standard), so their defaults can still change after
    // the soak. The wander is ON meanwhile: OFF is the exact v14.6 path and the rollback.
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

  // Reduced motion holds the wandering hexes still (the Visualizer reads the
  // same hook); here it picks the "Wandering hexes" row's status line.
  const prefersReducedMotion = usePrefersReducedMotion();

  const [volume, setVolume] = useState(0.8);
  // The tone level, one per engine (v15.0): saved only when the user moves that
  // engine's slider (chooseToneLevel), so an untouched device keeps each
  // engine's release default: v2 the lowest step before off, classic its 1 %.
  // solfeggioVolume (after v2Active, below) is the playing engine's.
  const [toneLevelV2, setToneLevelV2] = useState<number>(() => storedToneLevel('v2'));
  const [toneLevelClassic, setToneLevelClassic] = useState<number>(() => storedToneLevel('classic'));
  // Independent gate for the solfeggio oscillator so the user can hear a
  // selected tone without the music track also resuming. Set true by
  // selectFrequency; cleared by every stop (v14.6): pausePlayback (Pause, the
  // OS pause/stop, Emergency Stop, deleting the playing track, Next on the
  // last track), Clear, playback errors and the end of the list.
  const [isSolfeggioActive, setIsSolfeggioActive] = useState(false);
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

  // "Music only" (v14.6): the tone, the binaural beat and the sub-bass drone
  // are off and the music plays on untouched. Saved. It is one multiplier,
  // classicLayerGain, on the layer bus (gainNodeRef) and on the drone's gain;
  // the oscillators keep running behind it, so turning it off restores the
  // exact levels. The Safety panel's Mute turns it on.
  const MUSIC_ONLY_STORAGE_KEY = 'aetheria.musicOnly.v1';
  const [musicOnly, setMusicOnly] = useState<boolean>(() => {
    try {
      const raw = typeof localStorage !== 'undefined'
        ? localStorage.getItem(MUSIC_ONLY_STORAGE_KEY)
        : null;
      return raw === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(MUSIC_ONLY_STORAGE_KEY, String(musicOnly));
      }
    } catch {
      // localStorage may be full or blocked — persistence is best-effort.
    }
  }, [musicOnly]);

  // Layer sound A/B (v14.9). Unset = the release default (v2 since v15.0;
  // classic before), so the default can still flip: nothing is saved until the
  // user taps a choice (the v14.7 hexWander lesson). The tap handlers are the
  // only writers.
  const [layerEngineChoice, setLayerEngineChoice] = useState<LayerEngine | null>(() => {
    try { return parseLayerEngine(typeof localStorage !== 'undefined' ? localStorage.getItem(KEY_LAYER_ENGINE) : null); }
    catch { return null; }
  });
  const layerEngine: LayerEngine = layerEngineChoice ?? DEFAULT_LAYER_ENGINE;
  // v2 output, asked once per device; null = not answered yet, played as headphones.
  const [layerOutput, setLayerOutput] = useState<LayerOutput | null>(() => {
    try { return parseLayerOutput(typeof localStorage !== 'undefined' ? localStorage.getItem(KEY_LAYER_OUTPUT) : null); }
    catch { return null; }
  });
  // "Ask me again" until an answer: the question is pending. It is saved, and the answer stays saved beside it, so
  // layerOutput stays the output in effect (Car stays tone only) across restarts too, and the sheet asks again when
  // the layers next play. Read once, at load; only meaningful while an output is saved. Blocked storage keeps it for
  // the session.
  const [outputAskedAgain, setOutputAskedAgain] = useState<boolean>(() => {
    try { return parseOutputAskAgain(typeof localStorage !== 'undefined' ? localStorage.getItem(KEY_LAYER_OUTPUT_ASK_AGAIN) : null); }
    catch { return false; }
  });
  // The v2 sub-bass drone switch (headphones only). Unset = on; saved when tapped.
  const [droneChoice, setDroneChoice] = useState<boolean | null>(() => {
    try { return parseDroneEnabled(typeof localStorage !== 'undefined' ? localStorage.getItem(KEY_DRONE_ENABLED) : null); }
    catch { return null; }
  });
  const droneEnabled: boolean = droneChoice ?? DEFAULT_DRONE_ENABLED;
  // Key fit (v15.2), v2 only: saved only from the tap, so a tapped Off stays off and a tapped On stays on; unset
  // follows the release default (DEFAULT_KEY_FIT: on since v15.2.1, off in v15.2).
  const [keyFitChoice, setKeyFitChoice] = useState<boolean | null>(() => {
    try { return parseKeyFit(typeof localStorage !== 'undefined' ? localStorage.getItem(KEY_FIT_STORAGE_KEY) : null); }
    catch { return null; }
  });
  const keyFitOn: boolean = keyFitChoice ?? DEFAULT_KEY_FIT;
  // Session only: the duck could not be made (ensureLayerPlayer), so the layers play without it and Key fit changes
  // nothing: the chip, the card and the log say so (review B6). Set once, from that failure.
  const [keyFitFailed, setKeyFitFailed] = useState(false);
  // Session only: v2 could not start or failed; classic plays (no layers at all for Car: v2CarFallback), and the
  // panel says so.
  const [v2Failed, setV2Failed] = useState(false);
  const v2Active = layerEngine === 'v2' && !v2Failed;

  // The tone level of the engine playing the layers: v2's while v2 plays,
  // classic's in classic (and after a v2 failure). An engine flip switches
  // levels in the same render as the engines, so classic rebuilds once. The
  // safety check may lower it for the session (setSolfeggioVolume); only the
  // sliders save it.
  const solfeggioVolume = v2Active ? toneLevelV2 : toneLevelClassic;
  const setSolfeggioVolume = v2Active ? setToneLevelV2 : setToneLevelClassic;
  // v15.6 (the user's decision): the high-crystal check's tone lowering is for the track it was made on, in both
  // layouts. Remembered: the engine, the level in effect then, the lowered level, and the track (the music element's
  // source: playTrack sets it before the decode the check runs on, while React still shows the previous track). At the
  // next track, by any route, the level comes back if it is still the lowered one; a slider move or Undo since is the
  // user's choice and stays. Never across engines. Session only: nothing is saved (the sliders alone save).
  const toneLoweringRef: { current: { engine: LayerEngine; before: number; after: number; src: string } | null } = useRef(null);
  // The levels in effect now, for the check, which resumes after an await (its Undo restores the level the user had
  // when the tone was lowered, not one its callback closed over).
  const toneLevelsRef: { current: { engine: LayerEngine; v2: number; classic: number } } = useRef({ engine: 'v2', v2: toneLevelV2, classic: toneLevelClassic });
  toneLevelsRef.current = { engine: v2Active ? 'v2' : 'classic', v2: toneLevelV2, classic: toneLevelClassic };
  /** A track change (or a new track's own check): a lowering made on another track ends, its level back if untouched
   *  since. Returns the tone level in effect afterwards for the engine playing. */
  const settleToneLowering = useCallback((src: string): number => {
    const t = toneLevelsRef.current;
    const m = toneLoweringRef.current;
    if (m && m.src !== src) {
      toneLoweringRef.current = null;
      if (m.engine === t.engine && t[m.engine] === m.after) {
        (m.engine === 'v2' ? setToneLevelV2 : setToneLevelClassic)(m.before);
        t[m.engine] = m.before;
      }
    }
    return t[t.engine];
  }, []);
  // The two tone sliders' handler: the slider's own engine's level, saved under
  // that engine's key. The only writer of those keys (a user's move, never an
  // effect), so a device that never moves a slider follows the release defaults.
  const chooseToneLevel = useCallback((engine: LayerEngine, v: number) => {
    (engine === 'v2' ? setToneLevelV2 : setToneLevelClassic)(v);
    try { if (Number.isFinite(v)) localStorage.setItem(toneLevelKey(engine), String(v)); } catch {}
  }, []);

  // v2's failure fallback (never a choice of classic) with Car in effect: classic has no Car render (it always plays
  // its beat and drone), so its layers stay off, as under Music only, and a driver hears only the music.
  const v2CarFallback = layerEngine === 'v2' && v2Failed && layerOutput === 'car';
  // 0 under Music only (and the Car fallback), and while v2 plays the layers: an engine flip reuses the Music-only
  // fade (τ 0.25 s).
  const classicLayerGain = (musicOnly || v2Active || v2CarFallback) ? 0 : 1;
  // The tone level actually heard, for the effects documentation's records.
  const heardToneVolume = (musicOnly || v2CarFallback) ? 0 : solfeggioVolume;
  // initAudio has empty deps, so it reads the multiplier through this ref
  // (the volumeRef pattern).
  const classicLayerGainRef = useRef(classicLayerGain);
  useEffect(() => { classicLayerGainRef.current = classicLayerGain; }, [classicLayerGain]);

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
  // v15.8: parallel to the walk's play order: the position in LO_SHU_WALKS[mode] each entry fills (a crystal with no
  // track is skipped), so the cube's step follows the track, not the cursor. Null: the cursor (no walk, or an older one).
  const [loShuWalkSteps, setLoShuWalkSteps] = useState<number[] | null>(null);
  // v16.0: the queue's marks (utils/queue/queueModel.ts: 0 the play order's own entry, 1 waiting, 2 played), with the
  // play order they were written for. Queued tracks are real entries of the play order (and of the shuffle order, and of
  // a walk with step -1), so the pinned advance code plays them with no change; the marks only label them. Another
  // writer changing the play order (a delete, an import, the by-id refresh) leaves them one commit behind: `queueMarks`
  // below is always aligned with `playlist` (reconcileMarks), and the reconcile effect stores that.
  const [queueState, setQueueState] = useState<{ order: Song[]; marks: Mark[] } | null>(null);
  const queueMarks: Mark[] | null = useMemo(() => {
    if (!queueState) return null;
    if (queueState.order === playlist) return queueState.marks;
    return reconcileMarks(queueState.order.map((s: Song) => s.id), queueState.marks, playlist.map((s: Song) => s.id));
  }, [queueState, playlist]);
  // The last shuffle order the queue itself wrote or accepted (the gather effect leaves those alone).
  const queueShuffledRef: { current: number[] | null } = useRef(null);
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
      setLoShuWalkSteps(null);
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

  // Non-blocking notices. They replace alert()/confirm() on every path a
  // locked phone or the car can reach (media-session handlers, element events,
  // timers) — a modal dialog freezes JavaScript, so auto-advance and the
  // lock-screen card stall until someone dismisses it.
  //   statusToast   messages. A sticky one (an error the user must see) is kept
  //                 in stickyToastRef, so a timed toast that covers it reveals
  //                 it again when it ends instead of wiping it. Its `kind`
  //                 lets the code that raised it withdraw it once it stops
  //                 being true (withdrawStickyToast).
  //   updateReady   a new deploy is ready — its own banner, never evicted.
  //   orphanOffer   stored tracks the library no longer lists — its own banner.
  type StatusToast = {
    message: string;
    actionLabel?: string;
    onAction?: () => void;
    sticky: boolean;
    kind?: 'cache-tracks' | 'cache-state';
  };
  const [statusToast, setStatusToast] = useState<StatusToast | null>(null);
  // v15.4: the readout dialog (Current Track Analysis, Library Diagnostics, and the long notices' Details) and the
  // row Delete's confirmation, in the kit's Dialog instead of alert()/confirm().
  const [infoDialog, setInfoDialog] = useState<{ title: string; body: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const statusToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stickyToastRef = useRef<StatusToast | null>(null);
  // v15.7: counts every toast shown or dismissed, so a Library tap's Undo chain knows its toast is still the one up.
  const statusToastSeqRef: { current: number } = useRef(0);
  const showStatusToast = useCallback((
    message: string,
    opts?: {
      actionLabel?: string;
      onAction?: () => void;
      sticky?: boolean;
      durationMs?: number;
      kind?: StatusToast['kind'];
    }
  ) => {
    if (statusToastTimerRef.current) clearTimeout(statusToastTimerRef.current);
    statusToastTimerRef.current = null;
    statusToastSeqRef.current++;
    const toast: StatusToast = {
      message,
      actionLabel: opts?.actionLabel,
      onAction: opts?.onAction,
      sticky: !!opts?.sticky,
      kind: opts?.kind,
    };
    if (toast.sticky) stickyToastRef.current = toast;
    setStatusToast(toast);
    if (!toast.sticky) {
      statusToastTimerRef.current = setTimeout(() => {
        statusToastTimerRef.current = null;
        setStatusToast(stickyToastRef.current); // reveal a sticky one it covered
      }, opts?.durationMs ?? 6000);
    }
  }, []);
  // The metadata-save warning's failure spell (see the cache listeners below):
  // active from a failed save until one that started after it succeeds.
  const stateSpellRef = useRef({ active: false, shown: false, dismissed: false, full: false });
  const dismissStatusToast = useCallback(() => {
    if (statusToastTimerRef.current) clearTimeout(statusToastTimerRef.current);
    statusToastTimerRef.current = null;
    statusToastSeqRef.current++;
    setStatusToast((prev: StatusToast | null) => {
      if (!prev || prev.sticky) {
        // The user has seen the metadata warning: not again this spell.
        if (prev?.kind === 'cache-state') stateSpellRef.current.dismissed = true;
        stickyToastRef.current = null;
        return null;
      }
      return stickyToastRef.current; // dismissing a timed toast reveals the sticky one
    });
  }, []);
  /** Take down the sticky toast of this kind, whether showing or covered. */
  const withdrawStickyToast = useCallback((kind: NonNullable<StatusToast['kind']>) => {
    if (stickyToastRef.current?.kind !== kind) return;
    stickyToastRef.current = null;
    setStatusToast((prev: StatusToast | null) => (prev?.kind === kind ? null : prev));
  }, []);

  // A new deploy was detected (index.tsx). Offer the reload; never force it.
  const [updateReady, setUpdateReady] = useState<boolean>(() => !!(window as any).__aetheriaUpdateReady);
  useEffect(() => {
    const onUpdateReady = () => setUpdateReady(true);
    window.addEventListener('aetheria:update-ready', onUpdateReady);
    return () => window.removeEventListener('aetheria:update-ready', onUpdateReady);
  }, []);

  // What the cache could not store (utils/playlistCache): say so, rather than
  // letting it vanish silently on the next reload. Sticky, until dismissed or
  // until a save that STARTED after the latest failure of that kind stores
  // everything ('aetheria:cache-ok' with a higher seq) — the warning is no
  // longer true then, and is withdrawn.
  // The metadata (state) kind fails on every track change while storage stays
  // full, so it is one warning per failure spell, which a confirmed success
  // (or Clear) ends. It never covers the tracks warning, which says more; when
  // that one is withdrawn while a spell is still on, the state warning takes
  // its place — unless the user already dismissed it this spell.
  const cacheErrorSeqRef = useRef({ tracks: -1, state: -1 });
  useEffect(() => {
    const showStateWarning = () => {
      const spell = stateSpellRef.current;
      spell.shown = true;
      showStatusToast(
        `Your latest library changes could not be saved${spell.full ? ": this device's storage is full" : ''}. ` +
          `Recent analysis and list changes may be missing after a reload.`,
        { sticky: true, kind: 'cache-state' }
      );
    };
    const onCacheError = (e: Event) => {
      const { count = 0, reason = 'write-failed', what = 'tracks', seq = 0 } = (e as CustomEvent).detail || {};
      const kind: 'tracks' | 'state' = what === 'state' ? 'state' : 'tracks';
      // Every failure counts, shown or not: only a save that started after the
      // LATEST one may withdraw the warning.
      cacheErrorSeqRef.current[kind] = Math.max(cacheErrorSeqRef.current[kind], seq);
      const full = reason === 'storage-full';
      if (kind === 'state') {
        const spell = stateSpellRef.current;
        if (!spell.active) Object.assign(spell, { active: true, shown: false, dismissed: false });
        spell.full = full;
        if (spell.shown || spell.dismissed || stickyToastRef.current?.kind === 'cache-tracks') return;
        showStateWarning();
        return;
      }
      const tracks = `${count} track${count === 1 ? '' : 's'}`;
      showStatusToast(
        `${tracks} could not be saved for offline use${full ? ": this device's storage is full" : ''}. ` +
          `${count === 1 ? 'It plays' : 'They play'} now but won't be here after a reload.`,
        { sticky: true, kind: 'cache-tracks' }
      );
    };
    const onCacheOk = (e: Event) => {
      const { what = 'tracks', seq = 0 } = (e as CustomEvent).detail || {};
      if (what === 'state') {
        if (seq > cacheErrorSeqRef.current.state) {
          // The spell is over: the next failure warns again.
          Object.assign(stateSpellRef.current, { active: false, shown: false, dismissed: false });
          withdrawStickyToast('cache-state');
        }
      } else if (seq > cacheErrorSeqRef.current.tracks && stickyToastRef.current?.kind === 'cache-tracks') {
        withdrawStickyToast('cache-tracks');
        // A metadata failure it kept off the screen may still stand.
        const spell = stateSpellRef.current;
        if (spell.active && !spell.dismissed) showStateWarning();
      }
    };
    window.addEventListener('aetheria:cache-error', onCacheError);
    window.addEventListener('aetheria:cache-ok', onCacheOk);
    return () => {
      window.removeEventListener('aetheria:cache-error', onCacheError);
      window.removeEventListener('aetheria:cache-ok', onCacheOk);
    };
  }, [showStatusToast, withdrawStickyToast]);

  // Stored tracks found at restore that the saved library doesn't list. The
  // banner words them (splitOrphans) against the library as it is NOW; Recover
  // and Discard decide against what is actually stored. 'Not now' only hides
  // the banner: the tracks stay counted for Clear, which deletes them too.
  const [orphanOffer, setOrphanOffer] = useState<Song[] | null>(null);
  const orphanOfferRef: { current: Song[] | null } = useRef<Song[] | null>(null);
  useEffect(() => {
    orphanOfferRef.current = orphanOffer;
  }, [orphanOffer]);
  const [orphanBannerHidden, setOrphanBannerHidden] = useState(false);
  const [orphanBusy, setOrphanBusy] = useState(false);
  const [discardArmed, setDiscardArmed] = useState(false);
  const orphanSplit = useMemo(
    () => (orphanOffer ? splitOrphans<Song>(orphanOffer, originalPlaylist) : null),
    [orphanOffer, originalPlaylist]
  );
  // What Clear deletes, for its confirmation: the library's tracks plus stored
  // tracks still waiting on the Recover banner.
  const storedTrackCount = useMemo(
    () => new Set([...originalPlaylist, ...(orphanOffer ?? [])].map((s: Song) => s.id)).size,
    [originalPlaylist, orphanOffer]
  );

  // Perf HUD commit counter (a no-op unless ?perf=1). No deps: once per commit.
  useEffect(() => { countCommit(); });
  const [showExperienceHistory, setShowExperienceHistory] = useState(false);
  
  // Phi integration state
  const [enablePhiMode, setEnablePhiMode] = useState(true); // Enable phi mode by default
  const [phiTimingEnabled, setPhiTimingEnabled] = useState(true); // Enable phi timing by default

  // Layers v2 (v14.9): what the v2 layers should do now. Classic ignores all of this.
  const outputEffective: LayerOutput = layerOutput ?? 'headphones';
  const toneOnly = !isPlaying && isSolfeggioActive;
  const render: BeatRender = toneOnly ? 'off' : renderForOutput(outputEffective);
  const planOutput = planOutputFor(outputEffective);
  // Resolved only under v2: canonicalLayerHz warns once per non-crystal value, and classic's console stays v14.7's.
  const layer: CanonicalLayer = useMemo(
    () => (v2Active ? canonicalLayerHz(selectedSolfeggio, loShuPerfectGUT) : NO_LAYER),
    [v2Active, selectedSolfeggio, loShuPerfectGUT]
  );
  const presetBand: Band = bandOfPresetName(selectedBinaural.name);
  const planBand: Band = render === 'pulse' ? capBand(presetBand, 'alpha') : presetBand;
  const isGammaPlan = render === 'binaural' && planBand === 'gamma';
  const v2Wanted = v2Active && !musicOnly && layer.f > 0 && (isPlaying || isSolfeggioActive);
  // Key fit (v15.2): the playing track's fit, from plain values (never the pinned currentTrack). Recomputed only when
  // the track, its key data, the crystal or the output changes (keyFit.ts caches by content behind this).
  const fitSong = currentSongIndex >= 0 ? playlist[currentSongIndex] : undefined;
  const fitHasTrack = !!fitSong;
  const fitChroma = fitSong?.chroma, fitA4 = fitSong?.chromaA4Hz, fitConf = fitSong?.keyConfidence, fitKeyName = fitSong?.musicKey;
  // Analysed by this CHROMA_VERSION's Analyse tracks: a track it stored no key for (empty, too short) is never retried.
  const fitAnalysed = fitHasTrack && !needsKey({ chromaVersion: fitSong?.chromaVersion });
  const fitTrackId: string | null = fitSong ? fitSong.id : null;
  const keyFit: KeyFit | null = useMemo(
    () => (v2Active && fitHasTrack
      ? keyFitFor({ chroma: fitChroma, chromaA4Hz: fitA4, keyConfidence: fitConf, musicKey: fitKeyName }, layer.f, planOutput, PITCH_SHIFT_FACTOR)
      : null),
    [v2Active, fitHasTrack, fitChroma, fitA4, fitConf, fitKeyName, layer.f, planOutput]
  );
  const keyFitView: KeyFitView = useMemo(
    () => keyFitViewOf({ on: keyFitOn, fit: keyFit, hasTrack: fitHasTrack, musicPlaying: isPlaying, layersOn: v2Wanted, available: !keyFitFailed, analysed: fitAnalysed }),
    [keyFitOn, keyFit, fitHasTrack, isPlaying, v2Wanted, keyFitFailed, fitAnalysed]
  );

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
        heardToneVolume,
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
  }, [isDocumentingEffects, isPlaying, selectedSolfeggio, heardToneVolume, currentEffectsSession]);

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
      // v15.6: this check runs on a track that has just started (playTrack set its source before the decode): a lowering
      // made on another track ends first, so this one is judged from the level the user had.
      const toneSrc = mainAudioRef.current?.src ?? '';
      const levelNow = settleToneLowering(toneSrc);
      if (heardFreq > 963) {
        setSubtleResonanceMode(true);
        // v15.6: classic's Safety panel opens by itself in classic only. The new layout shows neutral comfort lines
        // where the controls are instead, and never sets classic's panel state (it leaked into a later peek).
        if (!shellOnRef.current) setShowSafetyProtocols(true);

        // Auto-adjust volume for high frequencies. v15.6: from the level in effect now (the slider may have moved during
        // the analysis), for this track only (toneLoweringRef: it comes back at the next track), in both layouts.
        if (safetyAssessment.volume < levelNow) {
          const engine = toneLevelsRef.current.engine;
          const setLevel = engine === 'v2' ? setToneLevelV2 : setToneLevelClassic;
          const before = levelNow;
          const after = safetyAssessment.volume;
          setLevel(after);
          const lowering = { engine, before, after, src: toneSrc };
          toneLoweringRef.current = lowering;
          // v15.6: announced in the new layout, with Undo. The words name no frequency: the trigger is an unreliable
          // reading. Nothing is saved, by the lowering, its Undo or the restore.
          if (shellOnRef.current) {
            showStatusToast(toneLoweredText(engine === 'v2', before, after), {
              actionLabel: 'Undo',
              onAction: () => {
                setLevel(before);
                if (toneLoweringRef.current === lowering) toneLoweringRef.current = null;
                dismissStatusToast();
              },
              durationMs: 10000,
            });
          }
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
    // v15.6: the tone level and the engine are read when the check ends (toneLevelsRef, settleToneLowering), not
    // closed over: an engine flip or a slider move during the analysis counts.
  }, [settleToneLowering, showStatusToast, dismissStatusToast]);

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
  // Layers v2 (v14.9): the player (made on the first v2 play, never in classic),
  // the delayed dispose after leaving v2, and the drone duty carried across it.
  const layerPlayerRef: { current: LayerPlayer | null } = useRef(null);
  const layerDisposeTimerRef: { current: number | null } = useRef(null);
  const layerDutyCarryRef: { current: { ctx: BaseAudioContext; duty: { on_s: number; quiet_s: number; rest_ends_at: number | null; t: number } } | null } = useRef(null);
  // Key fit (v15.2): the duck the v2 player plays into (one per AudioContext, made with the first v2 player and kept
  // across disposals; never in classic), the switch state at the last send, when the last layer faded to off ends
  // (review A1) and when the playing track last changed (review A3), both on the duck's clock.
  const keyFitDuckRef: { current: KeyFitDuck | null } = useRef(null);
  const keyFitSentOnRef: { current: boolean | null } = useRef(null);
  const keyFitUserFallRef: { current: number | null } = useRef(null);
  const keyFitTrackAtRef: { current: number | null } = useRef(null);

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
  // Whether the last attachMusicToRecording could tap the music. Without it a
  // recording holds only the layers — silence under Music only.
  const recordMusicAttachedRef = useRef(false);
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
  // v16.0: the queue's half of the play state, synced in the same commit as stateRef (this effect runs right after the
  // pinned one): a queue write reads the six pinned fields from stateRef (what the swap reads) and the marks and the
  // walk's arrays from here, and checks the two belong to the same play order.
  const queueMirrorRef: { current: { playlist: Song[]; marks: Mark[] | null; walk: LoShuWalkMode | null; steps: number[] | null; phases: string[] | null } } =
    useRef({ playlist, marks: null, walk: null, steps: null, phases: null });
  useEffect(() => {
    queueMirrorRef.current = { playlist, marks: queueMarks, walk: loShuWalkMode, steps: loShuWalkSteps, phases: loShuWalkPhases };
  }, [playlist, queueMarks, loShuWalkMode, loShuWalkSteps, loShuWalkPhases]);
  // The last queue write whose commit has run its effects (so stateRef and the mirror above hold it): each write sets
  // its number in its own batch (commitQueue), and this effect, after the two syncs, acknowledges it in that commit. A
  // queue write waits until the queue's previous write is acknowledged, or it would compute from the play state before
  // it and undo it. Any other commit (the clock's, an unrelated one flushed first) acknowledges nothing.
  const [queueAck, setQueueAck] = useState<number>(0);
  const queueAckRef: { current: number } = useRef(0);
  useEffect(() => {
    queueAckRef.current = queueAck;
  }, [queueAck]);
  // The same for a recorded play (recordPlay): the play and its cursor write are one batch, so until this commit's
  // effect has run, the element plays a start whose cursor stateRef doesn't hold yet (the swap's ~31 ms).
  const queueLandingRef: { current: { seq: number; kind: 'swap' | 'start' } } = useRef({ seq: 0, kind: 'swap' });
  const [queuePlayAck, setQueuePlayAck] = useState<number>(0);
  const queuePlayAckRef: { current: number } = useRef(0);
  useEffect(() => {
    queuePlayAckRef.current = queuePlayAck;
  }, [queuePlayAck]);

  // The latest library, for async loops (Deep Scan) and handlers that must not
  // read a stale render's originalPlaylist. (Annotated: this project has no
  // @types/react, so useRef itself returns any.)
  const libraryRef: { current: Song[] } = useRef<Song[]>(originalPlaylist);
  useEffect(() => {
    libraryRef.current = originalPlaylist;
  }, [originalPlaylist]);
  // v15.7: the play order's entries are the library's own objects, by id (listOps.refreshById). An order built from a
  // library one commit old (a Library tap racing a patch) or a patch that reached only the library would otherwise
  // leave an older copy of a track in the play order, which the metadata save prefers. Same ids, order and length, the
  // cursor untouched, and no update when nothing is stale. O(n), after a change of either list only (never on the clock).
  useEffect(() => {
    if (refreshById(playlist, originalPlaylist) !== playlist) setPlaylist((prev: Song[]) => refreshById(prev, originalPlaylist));
  }, [playlist, originalPlaylist]);

  // Analyse tracks (v15.1): true from a run's start until its loop has exited (a stop flips the UI at once while
  // the loop finishes its current step); the running pass, for Clear, Reload and Stop.
  const passLoopActiveRef: { current: boolean } = useRef(false);
  const analysePassRef: { current: PassHandle | null } = useRef(null);
  // True while playTrack decodes a track that has no crystal (its isAnalyzing), so the pass never decodes at the
  // same time. Mirrored in a layout effect: playTrack is pinned and stays untouched.
  const playStartBusyRef: { current: boolean } = useRef(false);
  useLayoutEffect(() => { playStartBusyRef.current = isAnalyzing; }, [isAnalyzing]);

  // v15.9: the walk as it is saved with the play order (walks survive a reload): a new object only when the walk changes.
  const savedWalk = useMemo(
    () => walkToSave(loShuWalkMode, loShuWalkSegments, loShuWalkPhases, loShuWalkSteps),
    [loShuWalkMode, loShuWalkSegments, loShuWalkPhases, loShuWalkSteps]
  );
  // v16.0: the queue as it is saved with the play order (the waiting and played entries' indices): a new object only when
  // the marks change.
  const savedQueue = useMemo(() => queueToSave(queueMarks), [queueMarks]);
  // Session values for handlers created once (the update banner's Reload).
  const sessionRef = useRef({ loShuWalkMode, walk: savedWalk, queue: savedQueue, selectedSolfeggio, isScanning });
  useEffect(() => {
    sessionRef.current = { loShuWalkMode, walk: savedWalk, queue: savedQueue, selectedSolfeggio, isScanning };
  }, [loShuWalkMode, savedWalk, savedQueue, selectedSolfeggio, isScanning]);

  // Reload for a new version without losing in-memory work. Saves are
  // debounced (metadata is held back while Deep Scan runs), and a reload
  // aborts an IndexedDB write mid-way — an import still being stored would not
  // come back. So: stop any scan, let a blob write in progress finish, store
  // what isn't stored yet, write the current lists, and only then reload. If
  // anything could not be stored (or the saving outlasts a minute), hold the
  // reload and say so: reloading would lose it, and its warning with the page.
  const reloadingRef = useRef(false);
  const flushAndReload = useCallback(async () => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    showStatusToast('Saving your library before reloading…', { sticky: true });
    // (Fields, not `let`s: TypeScript doesn't see the listeners assign them.)
    const outcome: { failed: boolean; failedWhat: 'tracks' | 'state' | null; timedOut: boolean; stoppedScan: boolean; stoppedPass: boolean } =
      { failed: false, failedWhat: null, timedOut: false, stoppedScan: false, stoppedPass: false };
    // Analyse tracks' results (every result of the run: stop('reload') applies nothing itself), merged into what this reload saves.
    const passHold: { results: ReadonlyMap<string, Partial<Song>> | null } = { results: null };
    // What the saves report while flushing, by kind: a failure counts only if
    // no save that STARTED after it succeeded (the rule the warnings use) — a
    // save already running when Reload was tapped may fail, and the flush's
    // own later save store everything after all.
    const latest = { tracks: { error: -1, ok: -1 }, state: { error: -1, ok: -1 } };
    const onSaveReport = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const kind: 'tracks' | 'state' = detail.what === 'state' ? 'state' : 'tracks';
      const field: 'error' | 'ok' = e.type === 'aetheria:cache-ok' ? 'ok' : 'error';
      latest[kind][field] = Math.max(latest[kind][field], detail.seq ?? 0);
    };
    window.addEventListener('aetheria:cache-error', onSaveReport);
    window.addEventListener('aetheria:cache-ok', onSaveReport);
    const flush = async () => {
      if (sessionRef.current.isScanning) {
        outcome.stoppedScan = true;
        (window as any).cancelAetheriaAnalysis?.({ quiet: true });
      }
      if (analysePassRef.current) {
        outcome.stoppedPass = true;
        passHold.results = analysePassRef.current.stop('reload') as ReadonlyMap<string, Partial<Song>>;
      }
      cancelPendingSaves();
      await waitForBlobSaves();
      const playOrder = stateRef.current.playlist;
      const library = libraryRef.current;
      if (playOrder.length || library.length) await saveBlobs(playOrder, library);
      // The lists as they are NOW, not as they were before the audio was
      // stored: if this outlasts the minute below, the page stays open, and
      // changes made meanwhile (or a Clear) must not be rolled back by an old
      // snapshot.
      const { playlist: nowOrder, currentSongIndex: cursor } = stateRef.current;
      const nowLibrary = libraryRef.current;
      const merged = passHold.results;
      const saveOrder = merged && merged.size ? patchById(nowOrder, merged) : nowOrder;
      const saveLibrary = merged && merged.size ? patchById(nowLibrary, merged) : nowLibrary;
      if (saveOrder.length || saveLibrary.length) {
        await saveMetaAndState(
          saveOrder,
          saveLibrary,
          cursor,
          sessionRef.current.walk,
          sessionRef.current.selectedSolfeggio,
          undefined,
          sessionRef.current.queue // v16.0: the queue, with the order it indexes
        );
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // A big import can take a while to store; a write that never settles
      // must not leave Reload waiting for ever.
      await Promise.race([
        flush(),
        new Promise<void>(resolve => {
          timer = setTimeout(() => { outcome.timedOut = true; resolve(); }, 60_000);
        }),
      ]);
    } catch (err) {
      outcome.failed = true;
      console.warn('[Aetheria] Could not save before reloading:', err);
    } finally {
      clearTimeout(timer);
      window.removeEventListener('aetheria:cache-error', onSaveReport);
      window.removeEventListener('aetheria:cache-ok', onSaveReport);
    }
    const tracksFailed = latest.tracks.error > latest.tracks.ok;
    const stateFailed = latest.state.error > latest.state.ok;
    if (tracksFailed || stateFailed) {
      outcome.failed = true;
      outcome.failedWhat = tracksFailed ? 'tracks' : 'state'; // tracks outranks state
    }
    if (outcome.failed || outcome.timedOut) {
      reloadingRef.current = false;
      const scanNote = outcome.stoppedScan
        ? ' Deep Scan was stopped; start it again to finish (tracks already scanned are kept).'
        : '';
      // The page stays, so the pass's results stay in memory too (re-applying is harmless: patchById is per field).
      const held = passHold.results;
      if (held?.size) {
        setOriginalPlaylist(prev => patchById(prev, held));
        setPlaylist(prev => patchById(prev, held));
      }
      const passNote = outcome.stoppedPass ? ' Analyse tracks was stopped; tap it again to finish (tracks already analysed are kept).' : '';
      showStatusToast(
        outcome.timedOut
          ? `Your library is still being saved, so the update is waiting. Tap Reload again in a moment.${scanNote}${passNote}`
          : `Some of your library couldn't be saved, so the update is waiting: reloading now would lose it.${scanNote}${passNote}`,
        {
          sticky: true,
          actionLabel: 'Reload anyway',
          onAction: () => window.location.reload(),
          // Tagged like the warning it stands in for, so the save that later
          // stores everything withdraws it too.
          kind: outcome.timedOut
            ? undefined
            : outcome.failedWhat === 'tracks' ? 'cache-tracks' : outcome.failedWhat === 'state' ? 'cache-state' : undefined,
        }
      );
      return;
    }
    window.location.reload();
  }, [showStatusToast]);

  // Recover: add the stored tracks the library lost, and remove stored copies
  // of tracks it already has. The play order takes the recovered tracks too
  // when it IS the library, or shows the library again when it is empty.
  // Discard (two taps): delete them from the device.
  // Both decide against what is STORED, not only what the library lists: a
  // copy is removed only when its library twin's audio is on disk. A re-import
  // whose save failed (a full device) or hasn't run yet leaves the orphan as
  // the only stored copy, so that one is kept and offered again next launch.
  const orphanActionRef = useRef(false);
  const settleOrphans = async (mode: 'recover' | 'discard') => {
    const offer = orphanOfferRef.current;
    if (!offer || orphanActionRef.current) return;
    orphanActionRef.current = true;
    setOrphanBusy(true);
    const generation = cacheGeneration();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // What is stored, once the saves in progress have finished. A slow or
      // stuck save must not leave the banner busy for ever: after 30 s, do
      // nothing and say so — the banner stays, to try again.
      const stored: Set<string> | null = await Promise.race([
        waitForBlobSaves().then(() => storedTrackIds()),
        new Promise<null>(resolve => {
          timer = setTimeout(() => resolve(null), 30_000);
        }),
      ]);
      // A Clear while waiting took these orphans with everything else. (The
      // generation changes the moment Clear starts, re-rendered or not.)
      if (orphanOfferRef.current !== offer || cacheGeneration() !== generation) return;
      if (!stored) {
        setDiscardArmed(false);
        showStatusToast(
          "A save is still running, so Aetheria can't check your stored tracks yet. Try again in a moment.",
          { durationMs: 8000 }
        );
        return;
      }
      const library = libraryRef.current;
      const { fresh, duplicates, unconfirmed } = splitOrphans<Song>(offer, library, stored);
      if (mode === 'recover' && fresh.length) {
        const playOrder = stateRef.current.playlist;
        const playIsLibrary = sameIdOrder(playOrder, library);
        setOriginalPlaylist(prev => appendToLibrary(prev, fresh));
        if (playIsLibrary) setPlaylist(prev => appendToLibrary(prev, fresh));
        else if (playOrder.length === 0) setPlaylist(appendToLibrary(library, fresh));
      }
      const toDelete = mode === 'discard' ? [...fresh, ...duplicates] : duplicates;
      if (toDelete.length) {
        // The space freed may now fit what didn't fit before: try the audio
        // AND the lists again (no list changes here, so nothing else would
        // re-save the state) — unless a Clear came meanwhile, as these lists
        // would be from before it.
        deleteTracksFromCache(toDelete.map(s => s.id)).then(() => {
          if (cacheGeneration() !== generation) return;
          const { playlist: order, currentSongIndex: cursor } = stateRef.current;
          const lib = libraryRef.current;
          if (!order.length && !lib.length) return;
          saveBlobsNow(order, lib, 0);
          debouncedSaveMeta(order, lib, cursor, sessionRef.current.walk, sessionRef.current.selectedSolfeggio, 0, sessionRef.current.queue);
        });
      }
      setOrphanOffer(unconfirmed.length ? unconfirmed : null);
      setOrphanBannerHidden(unconfirmed.length > 0);
      setDiscardArmed(false);
      if (unconfirmed.length) {
        const one = unconfirmed.length === 1;
        showStatusToast(
          `Kept ${unconfirmed.length} stored track${one ? '' : 's'}: ` +
            `${one ? 'it matches a track' : 'they match tracks'} you just imported, ` +
            `which ${one ? "isn't" : "aren't"} saved yet. ` +
            `${one ? "It'll" : "They'll"} be offered again next time Aetheria opens.`,
          { durationMs: 10000 }
        );
      }
    } finally {
      clearTimeout(timer);
      orphanActionRef.current = false;
      setOrphanBusy(false);
    }
  };
  const recoverOrphans = () => settleOrphans('recover');
  // v15.7: the second tap counts only 600 ms or more after the first, so a double tap is never both (the banner and the
  // Import sheet share this).
  const discardArmedAtRef: { current: number } = useRef(0);
  const discardOrphans = () => {
    if (!orphanOfferRef.current || orphanActionRef.current) return;
    if (!discardArmed) {
      discardArmedAtRef.current = Date.now();
      setDiscardArmed(true);
      setTimeout(() => setDiscardArmed(false), 4000);
      return;
    }
    if (Date.now() - discardArmedAtRef.current < 600) return;
    settleOrphans('discard');
  };

  // Search functionality effect
  // v16.0: only while classic shows (its drawer is the only list that reads it): in the new layout a play-order change
  // (a queue edit, a Library tap) is then one App commit, not two. A peek or the switch back runs it (a dependency).
  const classicListShown = !(layout === 'new' && !classicPeek);
  useEffect(() => {
    if (!classicListShown) return;
    if (searchTerm.trim() === '') {
      setFilteredPlaylist(playlist);
    } else {
      const filtered = playlist.filter(song => 
        song.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredPlaylist(filtered);
    }
  }, [searchTerm, playlist, classicListShown]);

  // Restore the cached playlist on mount, before any user interaction. If
  // IndexedDB holds a saved library, repopulate the in-memory state and flash a
  // brief "Restored N tracks" toast. Restored tracks already carry their
  // duration, analysis and bandEnvelope, so the background analyzers skip them.
  // Corrupt/empty cache falls through silently to the normal empty state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await restorePlaylist();
      if (cancelled) return;
      setLibraryLoading(false); // v15.9: in the same batch as the restored lists (none: nothing was saved)
      if (!cached) return;

      const hasLists = cached.playlist.length > 0 || cached.originalPlaylist.length > 0;
      if (hasLists) {
        setIsRestoring(true);
        setRestoredCount(cached.originalPlaylist.length);
        // A metadata save scheduled before the restore landed holds only what
        // was imported meanwhile; it would write that over the saved lists.
        // The gate reopening below saves the merged lists instead.
        cancelPendingSaves('meta');
        const importedMeanwhile = libraryRef.current.length > 0;
        if (importedMeanwhile) {
          // A large library restores slowly, and an import can land first.
          // Keep it, and what the user is doing: the restored library goes
          // AFTER it, so the play order's indices and the cursor still hold.
          const playIsLibrary = sameIdOrder(stateRef.current.playlist, libraryRef.current);
          setOriginalPlaylist(prev => appendToLibrary(prev, cached.originalPlaylist));
          if (playIsLibrary) setPlaylist(prev => appendToLibrary(prev, cached.originalPlaylist));
        } else {
          setPlaylist(cached.playlist);
          // v16.0: the queue comes back with its play order, only when that came back exactly (restoredQueue).
          setQueueState(cached.queue ? { order: cached.playlist, marks: cached.queue } : null);
          setOriginalPlaylist(cached.originalPlaylist);
          setCurrentSongIndex(cached.currentSongIndex);
          // v15.9: walks survive a reload. The walk comes back only when it matches the restored order exactly
          // (restoredWalk), with its segments, phases and steps; the snapshot first, so the snapshot effect keeps it.
          // (Before, the mode was set with no snapshot, and the effect ended the walk in the same commit.)
          const walk = cached.walk;
          if (walk) {
            loShuWalkSnapshotRef.current = cached.playlist.map((s: Song) => s.id).join('|');
            setLoShuWalkMode(walk.mode);
            setLoShuWalkSegments(walk.segments);
            setLoShuWalkPhases(walk.phases);
            setLoShuWalkSteps(walk.steps);
          }
          if (cached.selectedSolfeggio != null) setSelectedSolfeggio(cached.selectedSolfeggio);
        }

        console.log(
          `[Aetheria] Playlist restored: ${cached.originalPlaylist.length} library tracks, ` +
            `${cached.playlist.length} in the play order, from ${new Date(cached.savedAt).toLocaleString()}` +
            (importedMeanwhile ? ' (merged after tracks imported while it loaded)' : '')
        );
      }

      // Stored audio the saved library no longer lists — what a v14.4
      // library-shrink left behind. Offer it back; never add it silently.
      // (The banner tells copies of library tracks apart: splitOrphans.)
      if (cached.orphans.length > 0) {
        setOrphanOffer(cached.orphans);
        setOrphanBannerHidden(false);
      }

      // Keep the auto-save gate closed briefly so the restore doesn't bounce
      // straight back into a redundant save, then drop the toast.
      if (hasLists) setTimeout(() => { if (!cancelled) setIsRestoring(false); }, 2000);
    })();
    return () => { cancelled = true; };
  }, []); // mount-only

  // v15.9: the Mixes tab waits for the saved library only while it can come: a library that arrives another way (an
  // import) ends the wait, and so do LIBRARY_LOADING_MAX_MS (an IndexedDB open that never fires must not leave the tab
  // waiting for the session).
  useEffect(() => {
    if (!libraryLoading) return;
    if (originalPlaylist.length > 0) {
      setLibraryLoading(false);
      return;
    }
    const id = window.setTimeout(() => setLibraryLoading(false), LIBRARY_LOADING_MAX_MS);
    return () => window.clearTimeout(id);
  }, [libraryLoading, originalPlaylist.length > 0]);

  // The set of cached track ids, as a stable string key. Audio blobs are heavy
  // but only need (re)writing when this set changes — i.e. on import or delete,
  // NOT when a scan streams metadata into existing tracks. Keying the blob-save
  // effect on this (instead of the playlist array identity) means a deep scan,
  // which mutates metadata ~once per track, triggers ZERO audio writes.
  const songIdSetKey = useMemo(() => {
    const ids = new Set<string>();
    for (const s of playlist) if (s.file) ids.add(s.id);
    for (const s of originalPlaylist) if (s.file) ids.add(s.id);
    return Array.from(ids).sort().join(',');
  }, [playlist, originalPlaylist]);

  // Persist new BLOBS when the id set changes (add-only since v14.5: existing
  // audio is never rewritten, and nothing is deleted here — only the explicit
  // Delete and Clear remove audio). Runs even during analysis so a reload
  // mid-scan still restores the full library. Gated on BOTH lists being empty,
  // not on the play order alone: an emptied mix with a full library must still
  // save (e.g. an import after deleting every track of a mix).
  useEffect(() => {
    if (isRestoring || (playlist.length === 0 && originalPlaylist.length === 0)) return;
    saveBlobsNow(playlist, originalPlaylist);
    // playlist/originalPlaylist are read but intentionally NOT deps — songIdSetKey
    // captures the only change that should write audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songIdSetKey, isRestoring]);

  // Persist METADATA + session state (light — no audio). Debounced, and
  // suppressed while a deep scan is active so its hundreds of per-track updates
  // don't churn the cache and compete with the (CPU-bound) scan. When the scan
  // finishes, isScanning flips false and this fires once — the settle-save.
  // (Gated on both lists being empty, like the blob save above.)
  useEffect(() => {
    if (isRestoring || (playlist.length === 0 && originalPlaylist.length === 0) || isScanning) return;
    debouncedSaveMeta(
      playlist,
      originalPlaylist,
      currentSongIndex,
      savedWalk,
      selectedSolfeggio,
      undefined,
      savedQueue
    );
  }, [playlist, originalPlaylist, currentSongIndex, savedWalk, savedQueue, selectedSolfeggio, isRestoring, isScanning]);

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

    // Where the play order's cursor lands. Every entry of the track before the
    // cursor counts (a walk can hold a track more than once), and a track that
    // is not in the play order — deleted from the library while a mix plays —
    // leaves the cursor alone. (findIndex returned -1 for that case, and
    // -1 < cursor decremented it, so the wrong song was shown and Next was off
    // by one.)
    const { cursor: nextCursor, removedCurrent } =
      removeIdsWithCursor(playlist, new Set([songId]), currentSongIndex);

    // Update both playlists
    setPlaylist(updatePlaylist);
    setOriginalPlaylist(updatePlaylist);

    if (removedCurrent) {
      // The highlighted track was deleted. If it is sounding, stop the way
      // Pause does (music, anchor, tone, media session); if it isn't, leave a
      // tone-only session alone, as before. Either way unload the element and
      // revoke its URL so Play can't resume the deleted file. removeAttribute +
      // load() empties the element without the 'error' that `src = ''` raises.
      // (pausePlayback is declared further down: call it here, never list it
      // in this callback's deps.)
      const el = mainAudioRef.current;
      if (el && !el.paused) pausePlayback();
      else setIsPlaying(false);
      if (el) {
        el.removeAttribute('src');
        try { el.load(); } catch {}
      }
      const url = blobUrlsRef.current[songId];
      if (url) {
        try { URL.revokeObjectURL(url); } catch {}
        delete blobUrlsRef.current[songId];
      }
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.stop();
          sourceNodeRef.current.disconnect();
        } catch(e) {}
        sourceNodeRef.current = null;
      }
      setCurrentSongIndex(-1);
    } else if (nextCursor !== currentSongIndex) {
      setCurrentSongIndex(nextCursor);
    }

    // The explicit delete is the only path that removes stored audio; the
    // blob sync no longer infers deletions from the lists.
    deleteTracksFromCache([songId]);
  }, [playlist, currentSongIndex]);

  // The row Delete's confirmation (v15.4): delete exactly as before, unless the track is no longer in the library
  // (a Clear while the dialog was open). The cancel button takes the first focus, so a stray Enter keeps the track.
  const deleteCancelRef: { current: HTMLButtonElement | null } = useRef(null);
  const confirmPendingDelete = () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (target && libraryRef.current.some((s) => s.id === target.id)) deleteSong(target.id);
  };

  // Layers v2 (v14.9): dispose the layer player when App unmounts. Declared
  // above the pinned teardown so it runs first.
  useEffect(() => () => {
    if (layerDisposeTimerRef.current !== null) window.clearTimeout(layerDisposeTimerRef.current);
    try { layerPlayerRef.current?.dispose(); } catch {}
    layerPlayerRef.current = null;
    try { keyFitDuckRef.current?.dispose(); } catch {}
    keyFitDuckRef.current = null;
  }, []);

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

    // v15.4: never hide (and so make inert) the UI under a field someone is typing in: the field would lose its focus,
    // and a phone its keyboard. Text-like inputs, textareas, selects and contenteditable, inside the UI.
    const editingInUi = () => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || !zenLayerRef.current?.contains(active)) return false;
      if (active.isContentEditable || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return true;
      return active instanceof HTMLInputElement && !ZEN_NON_TEXT_INPUTS.has(active.type);
    };

    const handleMouseMove = () => {
      setZenUiVisible(true);
      if (zenTimeoutRef.current) clearTimeout(zenTimeoutRef.current);
      zenTimeoutRef.current = window.setTimeout(() => {
        if (editingInUi()) { handleMouseMove(); return; }
        setZenUiVisible(false);
      }, 3000);
    };

    // v15.4: a MOUSE moving reveals, as before. A touch never does through its compatibility mousemove: the hidden UI
    // is inert, so a tap on it lands on the root, whose click reveals and does nothing else (until v15.3 the same tap
    // also pressed the invisible control under the finger). Taps, keys and focus moves while the UI shows keep it
    // showing for 3 s more (a keyboard or screen-reader user can reach the Zen toggle, at the end of the player bar).
    const onPointerMove = (e: PointerEvent) => { if (e.pointerType === 'mouse') handleMouseMove(); };
    const onShownActivity = () => { if (zenShownRef.current) handleMouseMove(); };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerdown', onShownActivity, true);
    window.addEventListener('keydown', onShownActivity, true);
    document.addEventListener('focusin', onShownActivity);
    zenRevealRef.current = handleMouseMove;
    // Initial trigger to show UI when entering mode
    handleMouseMove();

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onShownActivity, true);
      window.removeEventListener('keydown', onShownActivity, true);
      document.removeEventListener('focusin', onShownActivity);
      zenRevealRef.current = null;
      if (zenTimeoutRef.current) clearTimeout(zenTimeoutRef.current);
    };
  }, [isZenMode]);

  // What the header and the player bar cover of the visualizer (px from the top
  // and the bottom edge): the Spectrum lens fits between them instead of sliding
  // behind the player bar. Measured, so a rotation, a resize or a wrapping info
  // row is followed; Zen Mode's hidden UI covers nothing. Set only on a change.
  const headerRef = useRef<HTMLElement | null>(null);
  const playerBarRef = useRef<HTMLDivElement | null>(null);
  const [uiInsets, setUiInsets] = useState({ top: 0, bottom: 0 });
  // v15.4: bumped when the header or the transport region swaps between its JSX and its fallback, so the observer
  // below watches the elements now on screen.
  const [insetsEpoch, setInsetsEpoch] = useState(0);
  const bumpInsets = useCallback(() => setInsetsEpoch((n: number) => n + 1), []);
  // v2's output question (its effect is with the other v2 code, below). Declared here since v15.6: the new layout's
  // Zen, just below, stays dormant while it shows.
  const [showOutputSheet, setShowOutputSheet] = useState(false);
  // v15.6: Zen in the new layout (components/shell/zenModel.ts, useShellZen.ts). It hides the shell only on the phone's
  // Now Playing (never the Car screen) and the desktop with no panel open; never in classic, whose Zen is above.
  const shellZenState = useShellZen({
    active: zenActive({
      on: shellZen,
      shellOn: layout === 'new' && !classicPeek,
      tab: shellTab,
      sheet: shellSheet,
      car: layout === 'new' && !desktopShell && layerOutput === 'car',
      outputQuestion: showOutputSheet,
    }),
    rootRef: shellRootRef,
  });
  const shellZenHidden = shellZenState.hidden;
  const uiHidden = isZenMode && !zenUiVisible;
  useEffect(() => {
    zenShownRef.current = !uiHidden;
  }, [uiHidden]);
  useEffect(() => {
    const apply = (top: number, bottom: number) =>
      setUiInsets((prev: { top: number; bottom: number }) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
    // (v15.5: classic's Zen hides classic's UI only. v15.6: the new layout's own Zen hides its bars, which then cover
    // nothing; in classic shellZenHidden is always false.)
    if ((uiHidden && !(layout === 'new' && !classicPeek)) || shellZenHidden) {
      apply(0, 0);
      return;
    }
    const measure = () => {
      const header = headerRef.current;
      const bar = playerBarRef.current;
      apply(
        header ? Math.max(0, Math.ceil(header.getBoundingClientRect().bottom)) : 0,
        bar ? Math.max(0, Math.ceil(window.innerHeight - bar.getBoundingClientRect().top)) : 0
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (observer && headerRef.current) observer.observe(headerRef.current);
    if (observer && playerBarRef.current) observer.observe(playerBarRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
    // v15.5: the new layout's top bar and bottom stack take these refs (Now Playing's panel, or the mini-player and
    // the tab bar, or the desktop transport), so a switch, a tab change or the Car screen re-measures.
  }, [uiHidden, insetsEpoch, layout, classicPeek, desktopShell, shellTab, layerOutput, shellZenHidden]);

  // Handle Shuffle State Logic
  // v16.0: with tracks waiting in the queue, a shuffle order made afresh (the switch, or a length change from a delete or
  // an import) puts them straight after the current track, in queue order (gatherShuffled): the queue stays next with no
  // window. The switch turned off moves them physically straight after it (gatherSequential, through the queue's writer,
  // a no-op in the usual case). With no queue, exactly as before.
  const shuffleWasOnRef: { current: boolean } = useRef(isShuffle);
  useEffect(() => {
    const wasOn = shuffleWasOnRef.current;
    shuffleWasOnRef.current = isShuffle;
    if (isShuffle && playlist.length > 0) {
        // If we just toggled shuffle or playlist changed size
        if (shuffledIndices.length !== playlist.length) {
            // LRU-weighted shuffle — never-played first, then longest-not-heard.
            // Replaces pure Fisher-Yates so a 6-hour shuffle session cycles
            // the whole library before any song repeats, instead of letting
            // chance favour the same handful of tracks.
            const newIndices = getLruShuffledIndices(playlist, playHistoryRef.current);
            const waiting = waitingIndices({ marks: queueMarks });
            if (waiting.length > 0) {
              const g = gatherShuffled(newIndices, currentSongIndex, waiting);
              queueShuffledRef.current = g.shuffled;
              setShuffledIndices(g.shuffled);
              setShufflePos(g.shufflePos);
              return;
            }
            queueShuffledRef.current = newIndices; // this effect's own order (the gather effect is for the pinned code's)
            setShuffledIndices(newIndices);
            // Try to keep the current song playing without jumping
            const currentIdxInShuffle = newIndices.indexOf(currentSongIndex);
            setShufflePos(currentIdxInShuffle !== -1 ? currentIdxInShuffle : 0);
        }
    } else if (!isShuffle) {
        // Clear shuffle state when disabled
        setShuffledIndices([]);
        setShufflePos(0);
        if (wasOn && waitingIndices({ marks: queueMarks }).length > 0) queueApiRef.current?.run({ kind: 'gather' });
    }
  }, [isShuffle, playlist.length]);

  // v16.0: the queue's marks follow another writer's change of the play order (a delete filters them, an import appends,
  // the by-id refresh keeps them; anything else is a new play order and drops them): queueMarks is that already, stored
  // here so it is not worked out again. The marks never drive playback.
  useEffect(() => {
    if (queueState && queueState.order !== playlist) setQueueState(queueMarks ? { order: playlist, marks: queueMarks } : null);
  }, [queueState, playlist, queueMarks]);
  // v16.0: a waiting entry at or behind the cursor in play sequence has played (or was passed): it is marked so (2), and
  // the current one too (a queued track that starts is consumed). Only when the cursor moves or the marks change.
  useEffect(() => {
    if (!queueMarks) return;
    const settled = settleMarks({ order: playlist, cursor: currentSongIndex, shuffle: isShuffle, shuffled: shuffledIndices, shufflePos, marks: queueMarks, walk: null });
    if (settled !== queueMarks) setQueueState(settled ? { order: playlist, marks: settled } : null);
  }, [currentSongIndex, queueMarks]);
  // v16.0: the pinned code makes a shuffle order afresh at a track start (playTrack's rule for a pick, handlePrev at the
  // first position, resolveNext's wrap): once that start has landed, the waiting entries go back straight after the
  // current track. The queue's own writes, an order it accepted, and any start in flight are left alone; so is a
  // Previous (it moves the cursor back, not the order: the queue stays after the track it came back from).
  useEffect(() => {
    if (!isShuffle || !queueMarks || shuffledIndices === queueShuffledRef.current) return;
    if (shuffledIndices.length !== playlist.length || queueStartInFlight()) return;
    const st: PlayState<Song> = { order: playlist, cursor: currentSongIndex, shuffle: true, shuffled: shuffledIndices, shufflePos, marks: queueMarks, walk: null };
    if (queueInPlace(st)) {
      queueShuffledRef.current = shuffledIndices;
      return;
    }
    const g = gatherShuffled(shuffledIndices, currentSongIndex, waitingIndices(st));
    queueShuffledRef.current = g.shuffled;
    setShuffledIndices(g.shuffled);
    setShufflePos(g.shufflePos);
  }, [shuffledIndices, currentSongIndex, isShuffle, queueMarks]);

  const playTrackRef = useRef<(index: number, list?: Song[]) => Promise<void>>(async () => {});
  const playNextRef = useRef<() => void>(() => {});
  // v15.7: playTrack's request number. A newer playTrack supersedes an older one still awaiting a decode or play(): the
  // older returns at its next await, before it writes the tone, the card, the cursor or plays anything (a Library tap,
  // its Undo, or a tap during a pending Next on an unscanned track would otherwise land its index in another order).
  const playRequestSeqRef: { current: number } = useRef(0);
  // v15.9: the last request that started playing (recordPlay). Any other value of playRequestSeqRef: a start in flight.
  const startedRequestRef: { current: number } = useRef(0);
  // v16.0: the entry a start issued outside the pinned advance code plays (a Library row, a mix, Undo, Restore Library,
  // classic's list), with its request number and the order it indexes: a queue write during its decode or play()
  // anchors on it (queueModel.anchorFor). playTrack takes its request number synchronously, before any await, so the
  // number after the call is that start's (unchanged: it returned at once and started nothing).
  const queueStartTargetRef: { current: { seq: number; index: number; order: Song[] } | null } = useRef(null);
  const noteQueueStart = (before: number, index: number, order: Song[]) => {
    if (playRequestSeqRef.current !== before) queueStartTargetRef.current = { seq: playRequestSeqRef.current, index, order };
  };

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

        // SAFETY LIMITER — still NOT connected, but the headroom margin is now
        // much thinner than it was. The old worst-case bus total was ~0.28 of
        // full scale (2.0 clamped layer input * volume * 0.18 * 0.5, plus the
        // 0.10 drone). With MUSIC_OUTPUT_LEVEL at 1.0 that becomes volume * 1.1,
        // i.e. ~0.88 at the default volume of 0.8 but ~1.1 — clipping — with the
        // volume AND the solfeggio/binaural sliders all pushed to maximum. The
        // music itself is unaffected either way: it plays on the <audio> element
        // and never touches this bus. DynamicsCompressorNode adds ~6 ms of
        // lookahead latency, which is why this is not simply switched on.
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
        // × classicLayerGainRef (0 under Music only), through a ref for the same
        // reason, so a saved Music only holds from the very first tap.
        gainNodeRef.current.gain.value = volumeRef.current * MUSIC_OUTPUT_LEVEL * LAYER_BALANCE_ATTEN * classicLayerGainRef.current;

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
      // Non-blocking: initAudio runs on play paths the lock screen can reach.
      showStatusToast('Audio could not start. Please reload the app.', { sticky: true });
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
    // v2 plays the layers: leave classic's tone as it is (BEFORE the teardown:
    // stopping it here would click while the bus fades). See the I6 teardown.
    if (v2Active) return;

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
  }, [isPlaying, isSolfeggioActive, selectedSolfeggio, solfeggioVolume, enablePhiMode, volume, binauralVolume, loShuPerfectGUT, v2Active]);

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
    // v2 plays the layers: leave classic's beat as it is, before its teardown (as updateSolfeggio).
    if (v2Active) return;
    
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
  }, [isPlaying, selectedBinaural, enablePhiMode, volume, binauralVolume, solfeggioVolume, v2Active]); 

  useEffect(() => { updateSolfeggio(); }, [updateSolfeggio]);
  useEffect(() => { updateBinaural(); }, [updateBinaural]);

  // Apply the music volume directly on the <audio> element. With direct
  // playback the element is the music output (not the Web Audio gain node), so
  // its volume IS the music level. Scaled by MUSIC_OUTPUT_LEVEL — the single
  // knob for overall playback loudness (was a hard-coded 0.18).
  const applyMusicElementVolume = useCallback(() => {
    const el = mainAudioRef.current;
    if (!el) return;
    const vols = enablePhiMode
      ? calculatePhiVolumeRatios(volume)
      : { music: volume };
    // On mobile, boost to offset Chrome's ducking caused by the silent anchor
    // (see MOBILE_MUSIC_DUCK_COMPENSATION). Clamp keeps it safe at the top.
    // NOTE since MUSIC_OUTPUT_LEVEL went to 1.0: HTMLMediaElement.volume cannot
    // exceed 1.0, so on mobile this compensation now runs out of room — the
    // slider reaches full output at ~0.63 and the top of its travel is flat.
    // That is a ceiling, not a loss: mobile is still far louder than it was.
    const duckComp = IS_MOBILE_DEVICE ? MOBILE_MUSIC_DUCK_COMPENSATION : 1;
    el.volume = Math.max(0, Math.min(1, vols.music * MUSIC_OUTPUT_LEVEL * duckComp));
  }, [enablePhiMode, volume]);

  // The Music-only multiplier this effect last applied. A change is a flip,
  // which fades the bus and the drone over MUSIC_ONLY_FADE_TAU_S; volume and
  // play/pause changes keep their 0.1 s / 0.2 s.
  const appliedClassicLayerGainRef = useRef(classicLayerGain);
  useEffect(() => {
    // Music level now lives on the audio element (direct playback).
    applyMusicElementVolume();
    const musicOnlyFlip = appliedClassicLayerGainRef.current !== classicLayerGain;
    appliedClassicLayerGainRef.current = classicLayerGain;

    // The gain node no longer carries the music — only the binaural / solfeggio
    // layers route through it — but it stays the master for THOSE layers, and
    // they were always scaled by this same MUSIC_OUTPUT_LEVEL master, so their balance
    // is unchanged.
    if(gainNodeRef.current && audioCtxRef.current) {
        // Apply phi relationships if enabled
        const volumes = enablePhiMode
          ? calculatePhiVolumeRatios(volume)
          : { music: volume, binaural: binauralVolume, solfeggio: solfeggioVolume };

        // Ultra-conservative volume scaling to prevent any distortion. The
        // extra LAYER_BALANCE_ATTEN factor recesses the binaural/solfeggio
        // layers (the only signals on this bus now) back behind the music.
        const safeVolume = volumes.music * MUSIC_OUTPUT_LEVEL * LAYER_BALANCE_ATTEN * classicLayerGain; // Match the initial gain setting
        gainNodeRef.current.gain.setTargetAtTime(safeVolume, audioCtxRef.current.currentTime, musicOnlyFlip ? MUSIC_ONLY_FADE_TAU_S : 0.1);
    }

    // Keep the sub-bass drone tracking the master volume while playing.
    if (subBassDroneRef.current && audioCtxRef.current) {
        const target = isPlaying ? volume * SUB_BASS_DRONE_LEVEL * classicLayerGain : 0;
        subBassDroneRef.current.gain.gain.setTargetAtTime(target, audioCtxRef.current.currentTime, musicOnlyFlip ? MUSIC_ONLY_FADE_TAU_S : 0.2);
    }
  }, [volume, enablePhiMode, applyMusicElementVolume, isPlaying, classicLayerGain]);

  // Adaptive binaural: move the brain-wave band with the music's actual energy.
  //
  // We CANNOT read the song from the live analyser — the music plays direct-to-OS
  // through the <audio> element (deliberately not routed through Web Audio, so the
  // lock-screen card survives), so the analyser only ever sees the near-silent
  // synth layers and the old logic was pinned to Delta forever. Instead we read the
  // PRE-SCANNED per-track band envelope (the same data the visualizer uses) at the
  // live playback position — real per-song AND in-song energy, no audio-graph tap.
  // Under v2 its own adaptive effect (with hysteresis and caps) moves the band;
  // under v2's Car fallback no beat plays, so nothing moves it (v15.0.1).
  useEffect(() => {
    if (v2Active || v2CarFallback || !isAdaptiveBinaural || !isPlaying) return;
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
  }, [isAdaptiveBinaural, isPlaying, selectedBinaural, currentSongIndex, playlist, v2Active, v2CarFallback]);

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
          // v15.4: the checkpoint can lag the playing track (it is written every 30 s): never move the cursor mid-play.
          if (state && state.currentSongIndex !== undefined && currentSongIndex < 0) {
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
      const target = isPlaying ? volume * SUB_BASS_DRONE_LEVEL * classicLayerGain : 0; // 0 under Music only
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

  // ---------------------------------------------------------------------------
  // Layers v2 host (v14.9). Classic sessions never create the player; every
  // call is isolated, so a v2 failure can never unmount the app (no error
  // boundary yet) — classic plays instead. Nothing here sets React state from a
  // timer or a tick (heat): the player reports phase and drone-rest
  // transitions only, and the level tick only talks to the player.
  const [layerStatus, setLayerStatus] = useState<LayerStatus | null>(null);   // transitions only
  const onLayerState = useCallback((s: LayerPlayerState) => setLayerStatus((prev: LayerStatus | null) => mergeLayerStatus(prev, s)), []);
  const onLayerError = useCallback((err: unknown, where: string) => {
    console.error(`Layers v2 failed in ${where}; classic is playing.`, err);
    setV2Failed(true);
  }, []);
  const ensureLayerPlayer = useCallback((): LayerPlayer | null => {
    const p = layerPlayerRef.current;
    if (p && !p.disposed) return p;
    const ctx = audioCtxRef.current, bus = masterBusRef.current;
    if (!ctx || !bus || ctx.state === 'closed') return null;
    const carry = layerDutyCarryRef.current;
    // Key fit (v15.2): the layers play into the duck and the duck into the bus. One per context. If it can't be made,
    // the layers play straight into the bus, as in v15.1, and Key fit has no effect this session.
    let dest: AudioNode = bus;
    const old = keyFitDuckRef.current;
    if (old && old.ctx === ctx && !old.disposed) dest = old.input;
    else {
      if (old) { try { old.dispose(); } catch {} }
      try { const nd = new KeyFitDuck(ctx, bus); keyFitDuckRef.current = nd; dest = nd.input; setKeyFitFailed(false); }
      catch (err) { keyFitDuckRef.current = null; setKeyFitFailed(true); console.error('Key fit unavailable; the v2 layers play without it.', err); }
    }
    try {
      const np = LayerPlayer.for(ctx, dest, { onState: onLayerState, onError: onLayerError, resumeDuty: carry && carry.ctx === ctx ? carry.duty : null });
      layerPlayerRef.current = np;
      setLayerStatus(null);   // a new player: forget the last one's status (its own first transition follows)
      return np;
    } catch (err) {
      console.error('Layers v2 unavailable; classic is playing.', err);
      setV2Failed(true);
      return null;
    }
  }, [onLayerState, onLayerError]);
  // Leaving v2 (I1): the fade happens at once (stopLayersNow); 3 s later the
  // player is disposed — its oscillators, gains and tick must not outlive the
  // visit in classic — unless v2 came back meanwhile (a quick re-flip, S24).
  const cancelLayerDispose = useCallback(() => {
    if (layerDisposeTimerRef.current !== null) {
      window.clearTimeout(layerDisposeTimerRef.current);
      layerDisposeTimerRef.current = null;
    }
  }, []);
  const scheduleLayerDispose = useCallback(() => {
    cancelLayerDispose();
    layerDisposeTimerRef.current = window.setTimeout(() => {
      layerDisposeTimerRef.current = null;
      const p = layerPlayerRef.current;
      layerPlayerRef.current = null;
      if (!p) return;
      // The next player on this context resumes the drone duty, so a flip counts as quiet time.
      try { const s = p.state(); layerDutyCarryRef.current = { ctx: p.ctx, duty: { ...s.drone, t: s.t } }; } catch {}
      try { p.dispose(); } catch {}
    }, 3000);
  }, [cancelLayerDispose]);
  const callPlayer = useCallback((fn: (p: LayerPlayer) => void) => {
    const p = layerPlayerRef.current;
    if (!p || p.disposed) return;
    try {
      fn(p);
    } catch (err) {
      console.error('Layers v2 failed; classic is playing.', err);
      try { p.dispose(); } catch {}
      layerPlayerRef.current = null;
      setV2Failed(true);
    }
  }, []);
  // Key fit (v15.2, critique M2): a fall is starting (a pause, a stop, leaving v2, a retune, a seek's host glide), so a
  // duck rise in flight stops where it is: it must never run on through the fall (a swell). With resumeAt the rest of
  // the rise waits until then; without, the next wanted send carries on from the held value. No React state.
  const holdKeyFitRise = useCallback((resumeAt?: number | null) => {
    const d = keyFitDuckRef.current;
    if (!d || d.disposed) return;
    try { d.holdRise(resumeAt ?? null); } catch {}
  }, []);
  // When a duck rise may start (keyFit.ts riseHold): the player's own holds (a retune's silence, a drone rest), a layer
  // fading to off (review A1), a track change the level tick has not seen yet or the host glide it started for it
  // (review A3) and `extra`, moved past a drone rest that start would run into (review A2). Null when nothing holds.
  const keyFitHold = useCallback((...extra: Array<number | null>): number | null => {
    const d = keyFitDuckRef.current;
    const track = d && !d.disposed
      ? trackHold(d.state().t, keyFitTrackAtRef.current, (v2LoopRef.current.glideUntil - performance.now()) / 1000)
      : null;
    return riseHold(layerPlayerRef.current?.state() ?? null, keyFitUserFallRef.current, track, ...extra);
  }, []);
  // Stop-class actions (Emergency Stop, Music only on, Safety Mute, leaving v2): a fast host fall, then silence.
  const stopLayersNow = useCallback((glideS: number) => {
    holdKeyFitRise();
    callPlayer((p) => { p.setHostLevel(0, { glideS }); p.play(null); });
  }, [callPlayer, holdKeyFitRise]);
  // A failed v2 is done for the session: dispose at once; classicLayerGain brings classic back.
  useEffect(() => {
    if (!v2Failed) return;
    cancelLayerDispose();
    try { layerPlayerRef.current?.dispose(); } catch {}
    layerPlayerRef.current = null;
  }, [v2Failed, cancelLayerDispose]);

  // The A/B choices are written only here, from taps (no write effects).
  const chooseLayerEngine = useCallback((e: LayerEngine) => {
    // A tap on the pressed default before any choice is not a choice: nothing is saved, so the profile keeps
    // following the release default (I9; v2 since v15.0). Keeping v2 whatever a later default means Classic, then v2.
    if (layerEngineChoice === null && e === layerEngine) return;
    setLayerEngineChoice(e);
    try { localStorage.setItem(KEY_LAYER_ENGINE, e); } catch {}
  }, [layerEngineChoice, layerEngine]);
  // An answer (the sheet or the panel's Output group): applied and saved; it ends an "Ask me again", whose saved
  // question goes only once the answer is saved (a failed save leaves it for the next session to ask).
  const chooseLayerOutput = useCallback((o: LayerOutput) => {
    setLayerOutput(o);
    setOutputAskedAgain(false);
    try { localStorage.setItem(KEY_LAYER_OUTPUT, o); localStorage.removeItem(KEY_LAYER_OUTPUT_ASK_AGAIN); } catch {}
  }, []);
  const toggleDrone = useCallback(() => {
    const next = !droneEnabled;
    setDroneChoice(next);
    try { localStorage.setItem(KEY_DRONE_ENABLED, String(next)); } catch {}
  }, [droneEnabled]);
  const toggleKeyFit = useCallback(() => {
    const next = !keyFitOn;
    setKeyFitChoice(next);
    try { localStorage.setItem(KEY_FIT_STORAGE_KEY, String(next)); } catch {}
  }, [keyFitOn]);
  const toggleMusicOnly = useCallback(() => setMusicOnly((v: boolean) => !v), []);

  // Live inputs for the stable callbacks below (the level tick reads them 4×/s).
  const v2InRef: { current: { volume: number; isPlaying: boolean; phiOn: boolean } } = useRef({ volume, isPlaying, phiOn: enablePhiMode && phiTimingEnabled });
  useEffect(() => { v2InRef.current = { volume, isPlaying, phiOn: enablePhiMode && phiTimingEnabled }; }, [volume, isPlaying, enablePhiMode, phiTimingEnabled]);
  const v2EnvRef: { current: number } = useRef(1);
  // The host level the v2 layers sit under: the music's own level × the φ envelope. No presence or Music-only
  // factor, no LAYER_BALANCE_ATTEN. Reads the element itself, never currTime / currDuration (stale after a swap;
  // the RAF stops in hidden tabs). Tone-only (no music) is volume × MUSIC_OUTPUT_LEVEL on every device.
  const hostLevelNow = useCallback((): number => {
    const s = v2InRef.current, el = mainAudioRef.current;
    let env = v2EnvRef.current;
    if (!s.isPlaying || !s.phiOn) env = 1;                                    // tone-only and φ timing off: no envelope
    else if (el && Number.isFinite(el.duration) && el.duration > 0) env = phiEnvelope(el.currentTime || 0, el.duration);
    // else hold the last value: NaN right after a swap, Infinity for recorder WebMs (phiEnvelope(·, ∞) = 0 would silence a track)
    v2EnvRef.current = env;
    const expected = Math.max(0, Math.min(1, s.volume * MUSIC_OUTPUT_LEVEL * (IS_MOBILE_DEVICE ? MOBILE_MUSIC_DUCK_COMPENSATION : 1)));
    const takes = !el || Math.abs(el.volume - expected) < 0.02;               // iOS: el.volume reads 1 whatever is set
    return musicGainFactor(s.volume, { musicPlaying: s.isPlaying, mobile: IS_MOBILE_DEVICE, elementVolumeTakes: takes, duckCompensation: MOBILE_MUSIC_DUCK_COMPENSATION }) * MUSIC_OUTPUT_LEVEL * env;
  }, []);
  const v2Gains = () => ({ tone: sliderGain(solfeggioVolume, TONE_SLIDER_DEFAULT), beat: sliderGain(binauralVolume, BEAT_SLIDER_DEFAULT), drone: droneEnabled ? 1 : 0 });
  // The sliders' gains into the player. Key fit (v15.2, review A1): a layer faded to off (the drone switch, a slider to
  // 0) is a fall, so a duck rise in flight waits for the fade's end and the fit effect holds the next one until then.
  const setV2Gains = (p: LayerPlayer): void => {
    const g = v2Gains();
    let end: number | null = null;
    try { end = userFallEnd(p.state(), g); } catch {}
    p.setLayerGains(g);
    if (end !== null) {
      keyFitUserFallRef.current = laterHold(keyFitUserFallRef.current, end);
      try { holdKeyFitRise(keyFitHold()); } catch {}
    }
  };

  // The plan, in one task per change (the player batches nothing across tasks). planBand is read but only
  // isGammaPlan is a dependency: within delta…beta the carrier never moves, so band steps reach the player
  // through the beat effect alone.
  const prevV2ActiveRef: { current: boolean } = useRef(false);
  const prevMusicOnlyRef: { current: boolean } = useRef(musicOnly);
  useEffect(() => {
    const wasActive = prevV2ActiveRef.current; prevV2ActiveRef.current = v2Active;
    const musicOnlyOn = !prevMusicOnlyRef.current && musicOnly; prevMusicOnlyRef.current = musicOnly;
    if (!v2Active) { if (wasActive) { stopLayersNow(0.25); scheduleLayerDispose(); } return; }   // classic: no player calls (none at all once disposed, 3 s on)
    cancelLayerDispose();                                                   // back within 3 s: keep the player (S24)
    if (!v2Wanted) { if (musicOnlyOn) stopLayersNow(0.1); else { holdKeyFitRise(); callPlayer((p) => p.play(null)); } return; }  // pause = designed fades
    if (!ensureLayerPlayer()) return;
    const p2 = v2Plan(layer.f, planOutput, render === 'binaural' ? 'binaural' : 'monaural', BANDS[planBand]);
    callPlayer((p) => { p.setHostLevel(hostLevelNow()); setV2Gains(p); p.play(p2, render, !toneOnly); });
    // Key fit (v15.2, critique M2): a retune closes the gates, so a duck rise in flight waits for its silence.
    try { const st = layerPlayerRef.current?.state() ?? null; if (st && st.phase === 'retuning') holdKeyFitRise(keyFitHold()); } catch {}
  }, [v2Active, v2Wanted, layer.f, planOutput, render, toneOnly, isGammaPlan, musicOnly, ensureLayerPlayer, callPlayer, stopLayersNow, hostLevelNow, scheduleLayerDispose, cancelLayerDispose, holdKeyFitRise, keyFitHold]);

  // Slider gains and the beat (band steps glide, τ 3 s, in the player).
  useEffect(() => { if (v2Active) callPlayer((p) => setV2Gains(p)); }, [v2Active, solfeggioVolume, binauralVolume, droneEnabled, callPlayer]);
  useEffect(() => { if (v2Active) callPlayer((p) => p.setBeat(BANDS[planBand])); }, [v2Active, planBand, callPlayer]);

  // The host follows the music 4×/s while v2 is wanted. A seek or a track change (the scrubber, the lock screen,
  // the car's ±10 s, a gapless swap) or a φ toggle glides it over 1.5 s for 2 s; the player ignores a resend
  // within 0.1 dB of the ramp in flight. Stops never come through here (stopLayersNow). No React state.
  const v2LoopRef: { current: { pos: number; wall: number; src: string; glideUntil: number; phiKey: string } } = useRef({ pos: 0, wall: 0, src: '', glideUntil: 0, phiKey: '' });
  useEffect(() => {
    if (!v2Active || !v2Wanted) return;                                      // nothing wanted: the host is held, never resent
    // Key fit (v15.2, critique M2, review A3): the host glides for the next 2 s, so a duck rise in flight or waiting (a
    // switch's, or a new track's held for this tick to see the change) waits for that window's end.
    const holdGlideRise = () => {
      const d = keyFitDuckRef.current;
      if (!d || d.disposed) return;
      try { holdKeyFitRise(keyFitHold(d.state().t + 2)); } catch {}
    };
    const tick = () => {
      const L = v2LoopRef.current, el = mainAudioRef.current, now = performance.now();
      if (el) {
        const pos = el.currentTime || 0, src = el.currentSrc || el.src || '';
        if (L.wall > 0) {
          const expected = L.pos + (el.paused ? 0 : ((now - L.wall) / 1000) * (el.playbackRate || 1));
          if (src !== L.src || Math.abs(pos - expected) > 1) { L.glideUntil = now + 2000; holdGlideRise(); }   // seek / track change
        }
        L.pos = pos; L.wall = now; L.src = src;
      }
      const s = v2InRef.current, phiKey = `${s.phiOn}|${s.isPlaying}`;
      if (L.phiKey && phiKey !== L.phiKey) { L.glideUntil = now + 2000; holdGlideRise(); }   // φ toggles, play after tone-only
      L.phiKey = phiKey;
      const level = hostLevelNow();
      callPlayer((p) => p.setHostLevel(level, now < L.glideUntil ? { glideS: 1.5 } : undefined));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => { window.clearInterval(id); v2LoopRef.current.wall = 0; };
  }, [v2Active, v2Wanted, callPlayer, hostLevelNow, holdKeyFitRise, keyFitHold]);

  // Key fit (v15.2, review A3): when the playing track changes, the time on the duck's clock. The fit effect below (same
  // commit, declared after) holds a rise for DUCK_TRACK_HOLD_S from it, so a new track's rise never starts before the
  // level tick has seen the new source; the tick's glide hold then takes over.
  useEffect(() => {
    const d = keyFitDuckRef.current;
    try { keyFitTrackAtRef.current = d && !d.disposed ? d.state().t : null; } catch { keyFitTrackAtRef.current = null; }
  }, [fitTrackId]);

  // Key fit (v15.2): retarget the duck when the applied duck changes (a track, its key data, the crystal, the output,
  // tone alone, the switch). Never from a timer; nothing is sent while the layers aren't wanted, so they come back at
  // the duck they left. A rise waits for a retune's silence, a resting drone's close or a drone rest about to start
  // (keyFit.ts riseHoldFrom: the player's A8 rule, applied to the duck), a layer's fade to off and a new track the
  // level tick has not seen yet (keyFitHold); the switch's rise also waits out a host glide (a seek or a track change:
  // critique M2). A fall sent while the gates are both shut lands at once (review A4). The switch lands in ~0.15 s
  // (τ 0.05 s); everything else glides, τ 2 s.
  useEffect(() => {
    if (!v2Active || !v2Wanted) return;
    const duck = keyFitDuckRef.current;
    if (!duck || duck.disposed) return;
    const flip = keyFitSentOnRef.current !== null && keyFitSentOnRef.current !== keyFitOn;
    let hold: number | null = null, silent = false;
    try {
      hold = keyFitHold(flip ? hostGlideHold(duck.state().t, (v2LoopRef.current.glideUntil - performance.now()) / 1000) : null);
      silent = gatesSilent(layerPlayerRef.current?.state() ?? null);
    } catch {}
    duck.setTarget(keyFitView.appliedDb, { tauS: flip ? DUCK_FLIP_TAU_S : DUCK_TAU_S, holdRiseUntil: hold, silent });
    keyFitSentOnRef.current = keyFitOn;
  }, [v2Active, v2Wanted, keyFitOn, keyFitView.appliedDb, keyFitHold]);

  // I6: 2 s after v2 takes over (classic's bus is at −69.5 dB by then), stop classic's tone and beat nodes behind
  // it, so they don't run (and get automated by the φ loop) for the whole visit. Every reader of these refs is
  // null-safe, and a flip back rebuilds them. The classic drone is pinned (keep-alive): it stays, silent at
  // classicLayerGain 0.
  useEffect(() => {
    if (!v2Active) return;
    const id = window.setTimeout(() => {
      for (const ref of [solfeggioOscRef, binauralLeftOscRef, binauralRightOscRef, binauralLeftPhaseRef, binauralRightPhaseRef] as { current: AudioScheduledSourceNode | null }[]) {
        const n = ref.current;
        if (!n) continue;
        try { n.stop(); } catch {}
        try { n.disconnect(); } catch {}
        ref.current = null;
      }
      for (const ref of [solfeggioGainRef, binauralGainRef, binauralMergerRef] as { current: AudioNode | null }[]) {
        const n = ref.current;
        if (!n) continue;
        try { n.disconnect(); } catch {}
        ref.current = null;
      }
    }, 2000);
    return () => window.clearTimeout(id);
  }, [v2Active]);

  // v2 adaptive band: direction hysteresis (two agreeing 3 s ticks per step) and caps (beta on headphones, alpha
  // for the pulse); off for the car and tone-only. Keyed on the playing song's envelope object, so a band step or a
  // Deep Scan patch of another song doesn't re-arm it. The preset it writes is UI-only under v2 (updateBinaural is
  // guarded); the beat effect above hands the band to the player.
  const selectedBinauralRef: { current: BinauralPreset } = useRef(selectedBinaural);
  useEffect(() => { selectedBinauralRef.current = selectedBinaural; }, [selectedBinaural]);
  const currentBandEnvelope = currentSongIndex >= 0 ? (playlist[currentSongIndex]?.bandEnvelope ?? null) : null;   // not named currentTrack (pinned)
  useEffect(() => {
    if (!v2Active || !isAdaptiveBinaural || !isPlaying || render === 'off' || !currentBandEnvelope) return;
    const env = currentBandEnvelope, hyst = new BandHysteresis(), cap: Band = render === 'pulse' ? 'alpha' : 'beta';
    const id = window.setInterval(() => {
      const el = mainAudioRef.current;
      if (!el) return;
      const target = capBand(bandForIntensity(readIntensity(env, el.currentTime || 0)), cap);
      const next = hyst.tick(target, bandOfPresetName(selectedBinauralRef.current.name));
      if (next) setSelectedBinaural(BINAURAL_PRESETS[BAND_ORDER.indexOf(next)]);
    }, 3000);
    return () => window.clearInterval(id);
  }, [v2Active, isAdaptiveBinaural, isPlaying, render, currentBandEnvelope]);

  // The output question (v2 only), opened here and never from playTrack, once the v2 layers are wanted (a play or a
  // tone with Music only off: a saved Music only, v14.6's, keeps it away until the layers can be heard). The music
  // keeps playing and the layers act as headphones until it is answered; "Ask me later" waits for the next session
  // (page load). "Ask me again" asks the same way (now if the layers are wanted, else when they next are: under
  // Music only, not before it is off), but the output in effect stays until the answer, across restarts: it keeps
  // the saved answer and saves the question, so "Ask me later" (or a restart) leaves both for the next session.
  // (showOutputSheet is declared above, before the new layout's Zen, since v15.6.)
  const outputSheetLaterRef: { current: boolean } = useRef(false);
  useEffect(() => {
    if (!v2Active || (layerOutput !== null && !outputAskedAgain)) { setShowOutputSheet(false); return; }
    if (v2Wanted && !outputSheetLaterRef.current) setShowOutputSheet(true);
  }, [v2Active, layerOutput, outputAskedAgain, v2Wanted]);
  const outputSheetLater = useCallback(() => {
    outputSheetLaterRef.current = true;
    setShowOutputSheet(false);
  }, []);
  const askOutputAgain = useCallback(() => {
    setOutputAskedAgain(true);
    try { localStorage.setItem(KEY_LAYER_OUTPUT_ASK_AGAIN, '1'); } catch {}
    outputSheetLaterRef.current = false;
  }, []);

  // Tests read the v2 player through this hook (dev builds only; production strips it).
  useEffect(() => {
    if (!IS_DEV_BUILD) return;
    const w = window as unknown as { __aetheriaLayers?: unknown };
    w.__aetheriaLayers = {
      state: () => layerPlayerRef.current?.state() ?? null, created: () => layerPlayerRef.current !== null, mobile: IS_MOBILE_DEVICE,
      keyFit: () => keyFitDuckRef.current?.state() ?? null, glideUntil: () => v2LoopRef.current.glideUntil,
    };
    return () => { delete w.__aetheriaLayers; };
  }, []);

  // The sound log (Q10): what the layers played in each listening session, for the by-ear A/B, in both engines —
  // but only once an engine has been chosen. A session opens when layers are wanted or the music starts, and closes
  // 60 s after neither (or on pagehide). One entry per change of what is heard; levels ride along but never trigger
  // one. Saved at most every 5 s and whenever the page hides; a failed save says so once per page load.
  const soundLogOn = layerEngineChoice !== null;
  const soundLogRef: { current: SoundLog | null } = useRef(null);
  const soundSessionRef: { current: { open: boolean; closeTimer: number | null; saveTimer: number | null; warned: boolean } } =
    useRef({ open: false, closeTimer: null, saveTimer: null, warned: false });
  const flushSoundLog = useCallback(() => {
    const S = soundSessionRef.current, log = soundLogRef.current;
    if (S.saveTimer !== null) { window.clearTimeout(S.saveTimer); S.saveTimer = null; }
    if (!log || log.flush() || S.warned) return;
    S.warned = true;
    showStatusToast(SOUND_LOG_SAVE_FAILED);
  }, [showStatusToast]);
  const saveSoundLogSoon = useCallback(() => {
    const S = soundSessionRef.current;
    if (S.saveTimer !== null) return;
    S.saveTimer = window.setTimeout(() => { S.saveTimer = null; flushSoundLog(); }, 5000);
  }, [flushSoundLog]);
  useEffect(() => {
    if (!soundLogOn || soundLogRef.current) return;
    const log = createSoundLog(safeLocalStorage());
    log.load();                                                               // the load gate: nothing is written before it
    soundLogRef.current = log;
  }, [soundLogOn]);
  const layersOnNow = v2Active ? v2Wanted : (!musicOnly && !v2CarFallback && (isPlaying || isSolfeggioActive));
  const listeningNow = soundLogOn && (layersOnNow || isPlaying);
  const logRender: SoundLogFields['render'] = !layersOnNow
    ? 'none'
    : v2Active
      ? (layerStatus?.mono && render === 'binaural' ? 'pulse' : render)
      : isPlaying ? 'binaural' : 'off';
  const logF = v2Active ? layer.f : applyLoShuPerfectMap(selectedSolfeggio);
  const statusKey = layerStatus?.key ?? '', statusResting = layerStatus?.resting ?? false;
  // What is heard now, as a log entry. v2: Hz from the player's last transition, dB = the validated level × the
  // slider gain. Classic: its own formulas without the φ timing multiplier (−26 / −23 / −20 dB at the defaults).
  const soundLogEntry = (): SoundLogFields => {
    const on = layersOnNow;
    if (v2Active) {
      const st = layerStatus, g = v2Gains();
      const beatOn = on && !!st && render !== 'off', droneOn = on && !!st && st.drone > 0;
      return {
        engine: 'v2', sound_version: 2, output: layerOutput ?? 'assumed', render: logRender, f: layer.f,
        tone_hz: on && st ? st.tone : 0, carrier_hz: beatOn && st ? st.carrier : 0, partner_hz: beatOn && st ? st.partner : 0,
        beat_hz: beatOn && st ? st.beat : 0, drone_hz: droneOn && st ? st.drone : 0, pulse_hz: droneOn && st ? st.pulse : 0,
        tone_db: on ? gainToDb(LEVEL_TONE * g.tone) : null,
        beat_db: beatOn ? gainToDb(LEVEL_BEAT * g.beat) : null,
        drone_db: droneOn ? gainToDb(LEVEL_DRONE_SUB * g.drone) : null,
        drone_resting: !!st && st.resting, music_only: musicOnly, v2_failed: v2Failed,
        ...keyFitLogFields(keyFitView),
      };
    }
    const mapped = applyLoShuPerfectMap(selectedSolfeggio), music = on && isPlaying;
    const phi = enablePhiMode
      ? integratePhiVolumes(volume, binauralVolume, solfeggioVolume, true)
      : { music: volume, binaural: binauralVolume, solfeggio: solfeggioVolume };
    const bus = volume * MUSIC_OUTPUT_LEVEL * LAYER_BALANCE_ATTEN * classicLayerGain;
    const reMusic = (x: number): number | null => (volume > 0 ? gainToDb((x * bus) / volume) : null);
    return {
      engine: 'classic', sound_version: 1, output: layerOutput ?? 'assumed', render: logRender, f: mapped,
      tone_hz: on ? solfeggioHz(mapped) : 0, carrier_hz: music ? 200 : 0, partner_hz: music ? 200 + selectedBinaural.delta : 0,
      beat_hz: music ? selectedBinaural.delta : 0, drone_hz: music ? feltCarrierHz(mapped) : 0, pulse_hz: music ? thetaAlphaModHz(mapped) : 0,
      tone_db: on ? reMusic(phi.solfeggio) : null, beat_db: music ? reMusic(phi.binaural) : null,
      drone_db: music ? gainToDb(SUB_BASS_DRONE_LEVEL * classicLayerGain) : null,
      drone_resting: false, music_only: musicOnly, v2_failed: v2Failed,
    };
  };
  // Key fit (v15.2): with it on, a change of the duck that applies is a change of what is heard (one entry); off, the
  // fit fields ride along on other entries only.
  const fitLogKey = keyFitOn ? `on|${keyFitView.appliedDb.toFixed(1)}` : 'off';
  useEffect(() => {
    const log = soundLogRef.current;
    if (!log) return;
    const S = soundSessionRef.current, now = Date.now();
    if (listeningNow) {
      if (S.closeTimer !== null) { window.clearTimeout(S.closeTimer); S.closeTimer = null; }
      log.open(now);
      S.open = true;
    } else if (S.open && S.closeTimer === null) {
      S.closeTimer = window.setTimeout(() => {
        S.closeTimer = null;
        S.open = false;
        log.close(Date.now());
        flushSoundLog();
      }, 60000);
    }
    if (!S.open || (v2Active && layersOnNow && !layerStatus)) return;   // v2: wait for the player's first transition
    if (log.note(soundLogEntry(), now)) saveSoundLogSoon();
  }, [listeningNow, v2Active, v2Failed, musicOnly, layersOnNow, layerOutput, logRender, logF, droneEnabled, statusKey, statusResting, flushSoundLog, saveSoundLogSoon, fitLogKey]);
  // Band steps, retunes and drone rests are counted into the open session.
  const prevBandNameRef: { current: string } = useRef(selectedBinaural.name);
  useEffect(() => {
    if (prevBandNameRef.current === selectedBinaural.name) return;
    prevBandNameRef.current = selectedBinaural.name;
    const log = soundLogRef.current;
    if (!log || !soundSessionRef.current.open) return;
    log.count('band');
    saveSoundLogSoon();
  }, [selectedBinaural, saveSoundLogSoon]);
  const prevLayerStatusRef: { current: LayerStatus | null } = useRef(null);
  useEffect(() => {
    const prev = prevLayerStatusRef.current;
    prevLayerStatusRef.current = layerStatus;
    const log = soundLogRef.current;
    if (!layerStatus || !log || !soundSessionRef.current.open) return;
    let counted = false;
    if (layerStatus.phase === 'retuning' && prev?.phase !== 'retuning') { log.count('retune'); counted = true; }
    if (layerStatus.resting && !prev?.resting) { log.count('rest'); counted = true; }
    if (counted) saveSoundLogSoon();
  }, [layerStatus, saveSoundLogSoon]);
  useEffect(() => {
    if (!soundLogOn) return;
    const onPageHide = () => {
      const log = soundLogRef.current, S = soundSessionRef.current;
      if (!log) return;
      if (S.closeTimer !== null) { window.clearTimeout(S.closeTimer); S.closeTimer = null; }
      if (S.open) { log.close(Date.now()); S.open = false; }
      flushSoundLog();
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushSoundLog(); };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [soundLogOn, flushSoundLog]);
  const exportSoundLog = useCallback(() => {
    const log = soundLogRef.current;
    if (!log) return;
    try {
      const d = new Date(), p2 = (n: number) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
      const url = URL.createObjectURL(new Blob([log.exportJson()], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `aetheria-sound-log-${stamp}.json`;
      a.click();
      // Revoked once the download has started (an immediate revoke can cancel it in some browsers).
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      console.error('Sound log export failed:', err);
      showStatusToast('The sound log could not be exported.');
    }
  }, [showStatusToast]);

  // The A/B chrome. Harmonic Control's panel is always there; the status-row badge and the transport's quick
  // switch appear once an engine has been chosen, or while v2 is the engine (Q8). One memoised props object and
  // memoised strings, so App's renders while playing (a few a second since v14.8's quarter-second clock) never
  // reach the memo'd pieces.
  const showLayerChrome = layerEngineChoice !== null || layerEngine === 'v2';
  const layerPanelProps = useMemo(() => ({
    engine: layerEngine,
    engineChosen: layerEngineChoice !== null,
    v2Failed,
    output: layerOutput,
    askedAgain: outputAskedAgain,
    droneEnabled,
    musicOnly,
    canExportLog: soundLogOn,
    onChooseEngine: chooseLayerEngine,
    onChooseOutput: chooseLayerOutput,
    onAskAgain: askOutputAgain,
    onToggleDrone: toggleDrone,
    onToggleMusicOnly: toggleMusicOnly,
    onExportLog: exportSoundLog,
  }), [layerEngine, layerEngineChoice, v2Failed, layerOutput, outputAskedAgain, droneEnabled, musicOnly, soundLogOn, chooseLayerEngine, chooseLayerOutput, askOutputAgain, toggleDrone, toggleMusicOnly, exportSoundLog]);
  const [layerSwitchOpen, setLayerSwitchOpen] = useState(false);
  const openLayerSwitch = useCallback(() => setLayerSwitchOpen(true), []);
  const layersBadgeLabel = useMemo(() => layersBadgeText(layerEngine, v2Failed, layerOutput, layer.f), [layerEngine, v2Failed, layerOutput, layer.f]);
  const layersBadgeTooltip = useMemo(() => layersTooltip(layerEngine, v2Failed, layerStatus, layerOutput), [layerEngine, v2Failed, layerStatus, layerOutput]);
  // The Car fallback reads as v2's Car (render 'off': 'Beat off'), not as classic's preset: it plays no beat.
  const bandChipLabel = useMemo(
    () => bandChipText(v2Active || v2CarFallback, selectedBinaural.name, render, presetBand, planBand),
    [v2Active, v2CarFallback, selectedBinaural.name, render, presetBand, planBand]
  );
  // Key fit (v15.2): the chip while on and the layers are wanted; the card's line always (v2).
  const keyFitChipShown = v2Active && keyFitOn && v2Wanted;
  const keyFitChipLabel = useMemo(() => keyFitChipText(keyFitView), [keyFitView]);
  const keyFitChipHint = useMemo(() => keyFitChipTitle(keyFitView), [keyFitView]);
  const keyFitChipLook = keyFitChipTone(keyFitView);
  const keyFitRowLine = useMemo(() => keyFitRowText(keyFitView), [keyFitView]);
  // The v2 sliders' dB readouts. The beat slider follows the output (the car has no beat), not tone-only; under the Car
  // fallback (v15.0.1) it is v2's Car slider, off, and its title says why.
  const toneLevelText = useMemo(() => toneReadout(sliderGain(solfeggioVolume, TONE_SLIDER_DEFAULT)), [solfeggioVolume]);
  const outputRender = renderForOutput(outputEffective);
  const beatLevelText = useMemo(
    () => (v2CarFallback ? BEAT_OFF_CAR_FALLBACK : beatReadout(sliderGain(binauralVolume, BEAT_SLIDER_DEFAULT), outputRender)),
    [v2CarFallback, binauralVolume, outputRender]
  );

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



  // A pause sets the element's exact time in the same render as isPlaying, so
  // the commit that hands useMediaSession the paused state hands the lock
  // screen the paused position too. Set only from the time effect's cleanup
  // below, it came a render later: useMediaSession had often sent the older
  // quarter-second time by then, and its 1 Hz throttle kept that one.
  const [clockPlaying, setClockPlaying] = useState(isPlaying);
  if (clockPlaying !== isPlaying) {
    setClockPlaying(isPlaying);
    if (!isPlaying && mainAudioRef.current) setCurrTime(mainAudioRef.current.currentTime);
  }

  // False once App unmounts. Declared before the time effect below, so on
  // unmount its cleanup runs first and the time effect's cleanup sets no state.
  const appMountedRef = useRef(false);
  useEffect(() => {
    appMountedRef.current = true;
    return () => { appMountedRef.current = false; };
  }, []);

  useEffect(() => {
    // currTime feeds the clock text, the seek bar, the φ phase badge and the
    // lock screen's position (itself throttled to 1 Hz in useMediaSession), so
    // it is set only as the element crosses a quarter second, moves back (a
    // seek, a new track) or on this run's first frame. Setting it every frame
    // re-rendered the whole App ~60 times a second while playing: most of the
    // renderer's CPU, the phone's main heat. The φ gains below still follow
    // every frame. On the quarter-second grid the clock turns with the music,
    // and when the run stops (a pause) the time is set once more, to the
    // element's own, so a paused clock and seek bar show where it stopped.
    let lastSetTime = -1;
    const updateTime = () => {
      if (isPlaying && mainAudioRef.current) {
        // Use the audio element's currentTime directly
        const actualTime = mainAudioRef.current.currentTime;
        if (lastSetTime < 0 || actualTime < lastSetTime || Math.floor(actualTime * 4) !== Math.floor(lastSetTime * 4)) {
          lastSetTime = actualTime;
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
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (isPlaying && appMountedRef.current && mainAudioRef.current) setCurrTime(mainAudioRef.current.currentTime);
    };
  }, [isPlaying, enablePhiMode, phiTimingEnabled, currDuration, volume, binauralVolume, solfeggioVolume]);


  // BACKGROUND DURATION ANALYZER
  // One batch at a time: a running batch must not be started again when the
  // library changes under it (Deep Scan now patches the library once per
  // track). The library is read through libraryRef for the same reason, and
  // the queue update is functional so ids queued during a batch survive.
  const durationBatchInFlightRef = useRef(false);
  useEffect(() => {
    if (pendingDurationAnalysis.length === 0 || durationBatchInFlightRef.current) return;

    const processNextBatch = async () => {
       durationBatchInFlightRef.current = true;
       const batchSize = 5;
       const processing = pendingDurationAnalysis.slice(0, batchSize);
       const batchIds = new Set(processing);
       
       const updates: {id: string, duration: number}[] = [];
       
       // Process batch
       try {
         await Promise.all(processing.map(async (id) => {
            // Count the attempt up front so the auto-rescan can't re-queue this
            // id in a tight loop even if it resolves to 0 (unreadable file).
            durationAttemptsRef.current.set(id, (durationAttemptsRef.current.get(id) || 0) + 1);
            const song = libraryRef.current.find(s => s.id === id);
            if (song && song.file) {
                const dur = await getAudioDuration(song.file);
                updates.push({ id, duration: dur });
            }
         }));
       } finally {
         durationBatchInFlightRef.current = false;
       }
       
       if (updates.length > 0) {
           setPlaylist(prev => prev.map(s => {
               const update = updates.find(u => u.id === s.id);
               return update ? { ...s, duration: update.duration } : s;
           }));
           setOriginalPlaylist(prev => prev.map(s => {
               const update = updates.find(u => u.id === s.id);
               return update ? { ...s, duration: update.duration } : s;
           }));
       }
       
       setPendingDurationAnalysis(prev => prev.filter(id => !batchIds.has(id)));
    };

    const timer = setTimeout(processNextBatch, 100);
    return () => clearTimeout(timer);
  }, [pendingDurationAnalysis]);

  // AUTO RE-SCAN FOR MISSING DURATIONS
  // Whenever the library changes (import, restore, reorder), re-queue any track
  // still missing a duration — but only ones that have a file and haven't
  // exhausted their retry budget. This heals tracks left on "..." by an
  // unreadable file or (before the timeout fix) a stalled queue, without a
  // re-import. MAX_DURATION_ATTEMPTS bounds the retries, so a genuinely
  // unreadable file converges instead of looping. It runs over
  // originalPlaylist — the whole library — so every generated playlist is
  // covered, not just the one on screen.
  useEffect(() => {
    const stuck = originalPlaylist
      .filter(s => (!s.duration || s.duration === 0) && s.file &&
                   (durationAttemptsRef.current.get(s.id) || 0) < MAX_DURATION_ATTEMPTS)
      .map(s => s.id);
    if (stuck.length === 0) return;

    setPendingDurationAnalysis(prev => {
      const merged = new Set(prev);
      stuck.forEach(id => merged.add(id));
      return merged.size === prev.length ? prev : Array.from(merged);
    });
  }, [originalPlaylist, durationRetryEpoch]);

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


  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    // The filter used to be `type.includes('audio')` with a filename fallback
    // for .wav and .mp3 only. The substring test was too loose: Chrome reports
    // .m3u as "audio/x-mpegurl" and .wma as "audio/x-ms-wma", so playlists and
    // files Chrome cannot decode were both imported as if they were tracks —
    // they sat in the library showing "..." and failed on play. See
    // isImportableAudio. Anything skipped is now reported rather than
    // disappearing without a word.
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

    // The LIBRARY grows by the import. The play order grows with it only when
    // it IS the library; while a mix or walk is playing it stays as it is. (This
    // used to copy the play order plus the new files into the library, so an
    // import during a mix shrank the library to that mix — and the blob sync
    // then deleted every other track's stored audio.) An emptied list (every
    // track of a mix deleted) shows the library again, with the import.
    const playOrderIsLibrary = sameIdOrder(playlist, originalPlaylist);
    const playOrderIsEmpty = playlist.length === 0;
    setOriginalPlaylist(prev => appendToLibrary(prev, newSongs));
    if (playOrderIsLibrary) setPlaylist(prev => appendToLibrary(prev, newSongs));
    else if (playOrderIsEmpty) setPlaylist(appendToLibrary(originalPlaylist, newSongs));

    // 2. Queue for background analysis
    setPendingDurationAnalysis(prev => [...prev, ...newSongs.map(s => s.id)]);

    setIsUploading(false);
    if (!playOrderIsLibrary && !playOrderIsEmpty && newSongs.length > 0) {
        showStatusToast(
            `Added ${newSongs.length.toLocaleString()} track${newSongs.length === 1 ? '' : 's'} to your library. ` +
            `The list that's playing is unchanged.`
        );
    }
    if (skippedCount > 0) {
        setAnalysisNotification(
            `Added ${fileList.length.toLocaleString()} tracks. ` +
            `Skipped ${skippedCount.toLocaleString()} file${skippedCount === 1 ? '' : 's'} ` +
            `that ${skippedCount === 1 ? 'is' : 'are'} not a playable audio format ` +
            `(Chrome can't decode WMA or Apple Lossless).`
        );
    }
    setLastImport({ added: newSongs.length, skipped: skippedCount, joinedPlayOrder: playOrderIsLibrary || playOrderIsEmpty, at: Date.now() });
    event.target.value = '';
  };

  // True from the start of a Deep Scan run until its finally block. Cancel
  // flips isScanning off at once (so the button resets) while the run is still
  // inside its current track; a second run must wait for this one to exit.
  const scanLoopActiveRef = useRef(false);

  const scanLibrary = async (opts?: { includeAssigned?: boolean }) => {
    if (scanLoopActiveRef.current) {
      showStatusToast('The previous scan is still finishing. Try again in a moment.');
      return;
    }
    if (passLoopActiveRef.current) {
      showStatusToast('Deep Scan is unavailable while Analyse tracks runs. Stop it first, or wait for it to finish.');
      return;
    }
    initAudio();
    // Deep Scan analyses the LIBRARY, whatever the play order shows. It used to
    // scan the play order and write that list back over the library when it
    // finished — so a scan started from a mix or walk shrank the library to the
    // mix, and the blob sync then deleted every other track's stored audio. Each
    // track is now read fresh from the library and its results are patched in
    // BY ID, so imports and deletes made during a long scan survive as well.
    const libraryAtStart = dedupeById(libraryRef.current);
    if (!libraryAtStart.length || !audioCtxRef.current) return;
    // v15.8 (decision 6): the tracks never measured and with no assigned crystal (v15.7's scope); the scan stops after
    // them. The health card's explicit "Also scan the N assigned tracks" adds the assigned ones after them (classic's
    // button passes its click event, never { includeAssigned: true }).
    const includeAssigned = opts?.includeAssigned === true;
    const queueIds = deepScanQueue(libraryAtStart, { assigned: includeAssigned }).map(s => s.id);
    const total = queueIds.length;
    if (total === 0) {
      const assignedLeft = deepScanQueue(libraryAtStart, { assigned: true }).length;
      setAnalysisNotification(
        assignedLeft > 0
          ? `Every track without a crystal is scanned. ${assignedLeft.toLocaleString()} ${assignedLeft === 1 ? 'track has' : 'tracks have'} an assigned crystal, not a scan; the new layout's Library tab can scan them too.`
          : `Every track in your library is already scanned (${libraryAtStart.length.toLocaleString()} tracks).`
      );
      setTimeout(() => setAnalysisNotification(null), 6000);
      return;
    }

    // Calculate time estimate (1-3 minutes per song for thorough analysis)
    const estimatedMinutes = Math.round(total * 2.5);
    const timeEstimate = estimatedMinutes > 60
      ? `${Math.round(estimatedMinutes / 60)}h ${estimatedMinutes % 60}m`
      : `${estimatedMinutes}m`;

    const notificationMsg = `Starting deep fractal analysis of ${total} unscanned songs. Estimated time: ${timeEstimate}. This will be thorough but slow - you can cancel anytime.`;

    setAnalysisNotification(notificationMsg);
    setTimeout(() => setAnalysisNotification(null), 8000);

    setIsScanning(true);
    setScanProgress(0);
    scanLoopActiveRef.current = true;

    const results = new Map<string, Partial<Song>>();
    let processedCount = 0;
    let shouldCancel = false;
    let keyDecodeCtx: OfflineAudioContext | null = null;
    const startTime = Date.now();

    // One track's results, applied by id to the library and the play order
    // (every repeat of the track in a walk included).
    const applyResult = (id: string, patch: Partial<Song>) => {
      results.set(id, { ...results.get(id), ...patch });
      const patches = new Map([[id, patch]]);
      setOriginalPlaylist(prev => patchById(prev, patches));
      setPlaylist(prev => patchById(prev, patches));
    };

    // Cancel function. `quiet`: the library is going away (Clear, reload), so
    // skip the end-of-scan summary.
    let quietCancel = false;
    const cancelScan = (opts?: { quiet?: boolean }) => {
      shouldCancel = true;
      if (opts?.quiet) quietCancel = true;
      setIsScanning(false);
      setScanProgress(0);
      console.log(`Analysis cancelled after processing ${processedCount}/${total} files`);
    };

    // Store cancel function for emergency use
    (window as any).cancelAetheriaAnalysis = cancelScan;

    try {
      // Process ONE file at a time for maximum control and stability
      for (let qi = 0; qi < queueIds.length; qi++) {
        if (shouldCancel) {
          console.log('Analysis cancelled by user');
          break;
        }

        // Re-read the track: it may have been deleted since the scan began.
        // (Only deletion skips it. A crystal Assign gives it meanwhile must not
        // stop the real analysis; the scan's results replace it.)
        const song = libraryRef.current.find(s => s.id === queueIds[qi]);
        if (!song) {
          processedCount++;
          setScanProgress(Math.round((processedCount / total) * 100));
          continue;
        }

        console.log(`Analyzing ${qi + 1}/${total}: ${song.name}`);

        let decodedSeconds = 0;
        try {
          const file = song.file;

          // Show which file we're processing
          setAnalysisNotification(`Analyzing: ${song.name} (${qi + 1}/${total})`);
          
          // Decode audio with yielding
          const arrayBuffer = await file.arrayBuffer();
          
          // Small yield after file read
          await new Promise(resolve => setTimeout(resolve, 10));
          
          const audioBuffer = await audioCtxRef.current!.decodeAudioData(arrayBuffer);
          decodedSeconds = audioBuffer.duration;

          // Another yield after decode
          await new Promise(resolve => setTimeout(resolve, 10));

          let freq: number;
          let fractalData: FractalAnalysisResult | null = null;
          
          try {
            // Use the interruptible fractal analysis
            fractalData = await analyzeFractalFrequenciesInterruptible(audioBuffer, () => shouldCancel);
            freq = fractalData.dominantFrequency;
            console.log(`Fractal analysis complete for ${song.name}: ${freq.toFixed(1)}Hz`);
          } catch (e) {
            // A cancel surfaces here as a thrown 'Analysis cancelled': stop,
            // without running the fallback or recording placeholder values.
            if (shouldCancel) break;
            console.warn('Fractal analysis failed for', song.name, 'using basic detection');
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
            console.warn('Interval analysis failed for', song.name, intervalErr);
          }

          // Additive: pre-compute the per-band energy envelope so the
          // visualizer can track the real song (and never miss a bass drop) at
          // playback time. Failures here must not break the scan.
          let bandEnvelope: BandEnvelope | undefined;
          try {
            bandEnvelope = await analyzeBandEnvelopes(audioBuffer);
          } catch (envErr) {
            console.warn('Band envelope analysis failed for', song.name, envErr);
          }
          // Yield so the heavy offline renders don't lock the scan UI.
          await new Promise(resolve => setTimeout(resolve, 10));
          if (shouldCancel) break;

          applyResult(song.id, {
            harmonicFreq: freq,
            closestSolfeggio: solfeggio,
            harmonicDeviation: deviation,
            fractalAnalysis: fractalData,
            intervalAnalysis: intervalData,
            isAetheriaCandidate: couldBeAetheria(freq),
            bandEnvelope,
            crystalSource: 'scan',
          });

        } catch (e) {
          console.warn("Could not analyze", song.name, e);
          // Set basic fallback values
          applyResult(song.id, {
            harmonicFreq: 440,
            closestSolfeggio: 528,
            harmonicDeviation: 999,
            crystalSource: 'scan',
          });
        }

        // Key data (v15.1), desktop only: a second, 22050 Hz decode. Phones leave it to Analyse tracks (one decode).
        if (!ANALYSE_MOBILE && !shouldCancel && decodedSeconds > 0 && decodedSeconds <= ANALYSE_CAPS.seconds) {
          const fresh = libraryRef.current.find(s => s.id === song.id);
          if (fresh && needsKey({ ...fresh, ...results.get(song.id) })) {
            try {
              keyDecodeCtx = keyDecodeCtx ?? createDecodeContext();
              if (keyDecodeCtx) {
                const buf = await keyDecodeCtx.decodeAudioData(await fresh.file.arrayBuffer());
                const fields = await analyseKeyOf(buf, {
                  sliceMs: 8,
                  yieldFn: yieldToTask,
                  shouldCancel: () => shouldCancel,
                });
                if (fields && !shouldCancel) applyResult(song.id, fields);
              }
            } catch (keyErr) {
              console.warn('Key analysis failed for', song.name, keyErr);
            }
          }
        }

        processedCount++;

        // Update progress
        const progress = Math.round((processedCount / total) * 100);
        setScanProgress(progress);

        // Calculate time remaining
        const elapsed = Date.now() - startTime;
        const avgTimePerFile = elapsed / processedCount;
        const remaining = (total - processedCount) * avgTimePerFile;
        const remainingMinutes = Math.round(remaining / 60000);

        console.log(`Progress: ${progress}% (${processedCount}/${total}), Est. remaining: ${remainingMinutes}m`);

        // Longer yield between files to prevent browser stress
        // Scale the delay based on library size (bigger libraries = longer breaks)
        const breakTime = Math.min(1000, Math.max(200, libraryAtStart.length * 5));
        await new Promise(resolve => setTimeout(resolve, breakTime));
      }

    } catch (error) {
      console.error('Scan library error:', error);
      const elapsed = Math.round((Date.now() - startTime) / 60000);
      // A toast, not alert(): the scan runs for hours, often with the phone
      // locked, and a modal dialog would freeze playback until dismissed.
      showStatusToast(
        `Analysis stopped with an error after ${elapsed} min. ${processedCount} of ${total} tracks ` +
        `were processed, and their results are kept.`,
        { durationMs: 12000 }
      );
    } finally {
      // Clean up
      scanLoopActiveRef.current = false;
      if ((window as any).cancelAetheriaAnalysis === cancelScan) delete (window as any).cancelAetheriaAnalysis;
      setAnalysisNotification(null);

      // No wholesale list writes here: each track's results were patched in by
      // id as it finished (applyResult).
      setIsScanning(false);
      setScanProgress(0);

      const totalTime = Math.round((Date.now() - startTime) / 60000);
      console.log(`Analysis complete: ${processedCount}/${total} files processed in ${totalTime} minutes`);

      if (processedCount > 0 && !quietCancel) {
        // Generate detailed analysis summary from the library as it was when
        // the scan began, with this run's results applied.
        const analyzedSongs = libraryAtStart
          .map(s => {
            const r = results.get(s.id);
            return r ? { ...s, ...r } : s;
          })
          .filter(s => s.harmonicFreq && crystalOrigin(s) !== 'assigned');
        const octaveRangeStats = getOctaveRangeStatistics(analyzedSongs);
        const regimeStats = getRegimeStatistics(analyzedSongs);

        const successMsg = `📊 Extended Octave Range Analysis Complete!\n\n` +
          `⏱️ Processed: ${processedCount}/${total} files in ${totalTime} minutes\n` +
          `🎵 Frequency Distribution:\n${octaveRangeStats}\n\n` +
          `🧘 Regime Distribution:\n${regimeStats}\n\n` +
          `✨ Ready for harmonic alignment journeys!`;
          
        setAnalysisNotification(successMsg);
        setTimeout(() => setAnalysisNotification(null), 8000);
      }
    }
  };

  // ── Analyse tracks (v15.1): key data and visual sync, one user-started pass (utils/library/analysePass.ts) ──
  const [pass, setPass] = useState<PassProgress>(PASS_IDLE);
  const passStateRef: { current: PassProgress } = useRef(PASS_IDLE);
  const passTuningRef: { current: PassTuning } = useRef({ ...DEFAULT_TUNING });
  const passLogRef: { current: StepRecord[] } = useRef([]);
  const passLastRef: { current: PassSummary | null } = useRef(null);   // the last run's summary, for the dev hook
  const passRunsRef: { current: number } = useRef(0);                  // finished runs, for the dev hook
  const passPlanRef: { current: PassPlan | null } = useRef(null);      // the last run's plan, for the dev hook
  const passPhaseLogRef: { current: { t: number; phase: PassProgress['phase']; hold: PassProgress['hold'] }[] } = useRef([]);  // dev builds only
  const analyseCounts = useMemo(() => countAnalysable(dedupeById(originalPlaylist), ANALYSE_CAPS), [originalPlaylist]);

  const startAnalysePass = () => {
    if (passLoopActiveRef.current) { showStatusToast('The previous analysis is still stopping. Try again in a moment.'); return; }
    if (scanLoopActiveRef.current) { showStatusToast('Analyse tracks is unavailable while Deep Scan runs.'); return; }
    if (isRestoring) { showStatusToast('Your library is still loading. Try again in a moment.'); return; }
    const retryFailed = analyseCounts.todo === 0 && analyseCounts.failed > 0;
    if (analyseCounts.todo === 0 && !retryFailed) {
      showStatusToast(analyseCounts.tooLong > 0 ? 'Every track this device can analyse is analysed.' : 'Every track is analysed.');
      return;
    }
    const decodeCtx = createDecodeContext();
    if (!decodeCtx) { showStatusToast("This browser can't analyse tracks."); return; }
    const gen = cacheGeneration();
    passLogRef.current = [];
    passPhaseLogRef.current = [];
    const handle = startPass<AudioBuffer>({
      mobile: ANALYSE_MOBILE, caps: ANALYSE_CAPS, tuning: { ...passTuningRef.current }, retryFailed,
      now: () => performance.now(),
      sleep: (ms) => new Promise<void>(r => setTimeout(r, ms)),
      yieldNow: yieldToTask,
      isHidden: () => document.hidden,
      onVisible: (cb) => { const on = () => { if (!document.hidden) cb(); }; document.addEventListener('visibilitychange', on); return () => document.removeEventListener('visibilitychange', on); },
      // A reload, a navigation or a closed tab clears the crash marker (a renderer killed for memory fires nothing).
      onPageHide: (cb) => { window.addEventListener('pagehide', cb); return () => window.removeEventListener('pagehide', cb); },
      playback: () => {
        const el = mainAudioRef.current, starting = playStartBusyRef.current;
        if (!el) return starting ? { paused: true, duration: NaN, currentTime: 0, playbackRate: 1, starting } : null;
        return { paused: el.paused, duration: el.duration, currentTime: el.currentTime, playbackRate: el.playbackRate, starting };
      },
      // performance.memory: precise only where the renderer is locked to a site (desktop Chrome); Android's is
      // bucketized and cached for 20 minutes. The pass trusts it only once it has seen it move across a decode.
      heap: () => { const m = (performance as any).memory; return m && m.jsHeapSizeLimit > 0 ? { used: m.usedJSHeapSize, limit: m.jsHeapSizeLimit } : null; },
      marker: {
        read: () => { try { return localStorage.getItem(ANALYSE_INFLIGHT_KEY); } catch { return null; } },
        write: (v) => { try { if (v === null) localStorage.removeItem(ANALYSE_INFLIGHT_KEY); else localStorage.setItem(ANALYSE_INFLIGHT_KEY, v); } catch {} },
      },
      library: () => libraryRef.current,
      playOrder: () => stateRef.current.playlist,
      playingId: () => { const s = stateRef.current; return s.currentSongIndex >= 0 ? (s.playlist[s.currentSongIndex]?.id ?? null) : null; },
      upcomingIds: () => upcomingIds(stateRef.current),
      alive: () => appMountedRef.current && cacheGeneration() === gen,
      probeDuration: (s) => getAudioDuration((s as Song).file),
      readFile: (s) => (s as Song).file.arrayBuffer(),
      decode: (bytes) => decodeCtx.decodeAudioData(bytes),
      envelope: (buf, beforeBand) => analyzeBandEnvelopes(buf, 20, beforeBand),
      key: (buf, o) => analyseKeyOf(buf, o),
      apply: (patches) => {
        const p = patches as ReadonlyMap<string, Partial<Song>>;
        setOriginalPlaylist(prev => patchById(prev, p));
        setPlaylist(prev => patchById(prev, p));
      },
      progress: (p) => {
        passStateRef.current = p;
        setPass(p);
        if (IS_DEV_BUILD) { passPhaseLogRef.current.push({ t: performance.now(), phase: p.phase, hold: p.hold }); if (passPhaseLogRef.current.length > 4000) passPhaseLogRef.current.shift(); }
      },
      onStep: (r) => {
        if (r.kind !== 'flush') reportPassWork(r.kind === 'slice' ? 'main' : 'native', r.ms);
        if (IS_DEV_BUILD) { passLogRef.current.push(r); if (passLogRef.current.length > 4000) passLogRef.current.shift(); }
      },
    });
    passLoopActiveRef.current = true;
    analysePassRef.current = handle;
    passPlanRef.current = handle.plan;
    showStatusToast(passStartText(handle.plan, passEtaMinutes(handle.plan.seconds, ANALYSE_MOBILE), ANALYSE_MOBILE));
    handle.done
      .then((summary) => { passLastRef.current = summary; const msg = passEndText(summary); if (msg) showStatusToast(msg, { durationMs: 10_000 }); })
      .catch((err) => console.warn('[Analyse] ended with an error', err))   // done never rejects; belt and braces
      .finally(() => {
        passLoopActiveRef.current = false;
        if (analysePassRef.current === handle) analysePassRef.current = null;
        passRunsRef.current++;
        passStateRef.current = PASS_IDLE;
        setPass(PASS_IDLE);
      });
  };

  // The button: Stop while a run is going (not while it is stopping), otherwise Start (its refusals included).
  const onAnalyseTap = () => {
    const running = analysePassRef.current;
    if (running && passStateRef.current.phase !== 'stopping') { running.stop('user'); return; }
    startAnalysePass();
  };

  // Tests read and pace Analyse tracks through this hook (dev builds only; production strips it).
  useEffect(() => {
    if (!IS_DEV_BUILD) return;
    const w = window as unknown as { __aetheriaAnalyse?: unknown };
    w.__aetheriaAnalyse = {
      state: () => passStateRef.current,        // PASS_IDLE again once a run ends
      last: () => passLastRef.current,          // the last run's PassSummary (null before the first)
      runs: () => passRunsRef.current,          // finished runs: wait for it to grow, then read last()
      log: () => passLogRef.current.slice(),    // this run's StepRecords (cleared at each start)
      plan: () => passPlanRef.current,          // the last run's plan (null before the first)
      phases: () => passPhaseLogRef.current.slice(),   // this run's progress phases and holds, on the page clock
      playing: () => {
        const s = stateRef.current;
        const t = s.currentSongIndex >= 0 ? s.playlist[s.currentSongIndex] : undefined;
        if (!t) return null;
        const env = t.bandEnvelope ?? t.visualEnvelope;
        return { id: t.id, name: t.name, envelope: env?.bass.length ?? 0, source: t.bandEnvelope ? 'scan' : t.visualEnvelope ? 'analyse' : null, key: t.musicKey ?? null };
      },
      tune: (o: Partial<PassTuning>) => { Object.assign(passTuningRef.current, o); },   // read at the next start
      mobile: ANALYSE_MOBILE,
    };
    return () => { delete w.__aetheriaAnalyse; };
  }, []);

  // Analyse tracks ends with App (a run parked on a hidden page would otherwise wait for ever).
  useEffect(() => () => { analysePassRef.current?.stop('unmount'); }, []);

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

  // v15.8: what every mix recipe reads (utils/mix/recipes.ts): the library and the experience level as this render sees
  // them (as the generators read them), the play history, and Math.random.
  const mixInput = (): MixInput => ({ library: originalPlaylist, experience: userExperienceLevel, history: playHistoryRef.current, rng: Math.random });
  // v15.8: the ONE place a mix's result reaches App's state. It never writes the library (check:writers: a play-order
  // function). v15.9 (the plan's v14.17): every found mix STARTS PLAYING through startPlayOrder, as a Library row does:
  // the eager cursor (the title and the lock-screen card name what plays), the explicit shuffle order, the walk with its
  // snapshot, segments, phases and steps, and an Undo for 10 s. This ends the list swap, where nine mixes replaced the
  // list under the playing track and the next advance skipped the mix's first track. A mix never changes the visual
  // settings (decision 2), the tone or the experience level. `name` is the toast's; `positions`: a Lo Shu walk (its
  // toast counts positions; GUT Alignment's 'traditional' walk counts tracks).
  const applyMix = (r: MixResult, name: string, positions: boolean = false) => {
    if (!r.order) {
      const t = r.toast;
      if (t) {
        const details = t.details;
        showStatusToast(t.text, details
          ? { durationMs: t.durationMs, actionLabel: 'Details', onAction: () => { dismissStatusToast(); setInfoDialog(details); } }
          : { durationMs: t.durationMs });
      }
      return;
    }
    const order = r.order;
    const sp = r.segmentsAndPhases;
    const walk = r.walk ? { mode: r.walk.mode, segments: sp ? sp.segments : null, phases: sp ? sp.phases : null, steps: r.walk.steps } : null;
    startPlayOrder(order, 0, mixStartText(name, order.length, positions && r.walk ? r.walk.mode : null), { walk, mix: true });
    setUseChakraOrder(r.chakraOrder);
    setSearchTerm('');
    if (r.closeWalkMenu) setShowLoShuWalkMenu(false);
    // Classic's Analysis Status notices. In the new layout they would be routed to the one toast slot and push the
    // Undo toast out, so there the Undo toast's own words are the message.
    if (!shellOnRef.current) {
      for (const n of r.notices) {
        const show = () => {
          // A classic peek may have ended meanwhile (111's and 2178's notices wait 500 ms): nothing lands in the new
          // layout. And the routing effect leaves this one to classic.
          if (shellOnRef.current) return;
          mixNoticeRef.current = n.text;
          setAnalysisNotification(n.text);
          setTimeout(() => setAnalysisNotification(null), n.clearAfterMs);
        };
        if (n.delayMs === null) show();
        else setTimeout(show, n.delayMs);
      }
    }
    if (r.closeDrawerOnPhone && window.innerWidth < 768) setShowSidebar(false);
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
          showStatusToast(`No songs found matching '${name}'. Try scanning your library first or add more variety.`, { durationMs: 8000 });
      }
      if(window.innerWidth < 768) setShowSidebar(false);
  };

  const generateAlignmentJourney = () => applyMix(gutAlignment(mixInput()), 'GUT Alignment');

  // HEART Alignment Journey
  const generateHeartAlignmentJourney = () => applyMix(heartAlignment(mixInput()), 'HEART Alignment');

  // HEAD Alignment Journey  
  const generateHeadAlignmentJourney = () => applyMix(headAlignment(mixInput()), 'HEAD Alignment');

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
  const generateLoShuWalk = (mode: LoShuWalkMode) => applyMix(loShuWalk(mixInput(), mode), LO_SHU_WALK_INFO[mode]?.fullName ?? 'Lo Shu walk', true);

  // Clear the active Lo Shu walk indicator without otherwise touching the
  // playlist. Called by other journey generators (alignment, mood, etc.) so
  // the walk badge doesn't linger after the user starts a different journey.
  const clearLoShuWalkMode = () => {
      setLoShuWalkMode(null);
      setLoShuWalkSegments(null);
      setLoShuWalkPhases(null);
      setLoShuWalkSteps(null);
  };

  // Single deliberate action behind the "Clear Playlist & Cache" button: stop
  // playback, tear down the current audio source + object URLs, wipe all
  // in-memory playlist state, and clear the IndexedDB cache so nothing is
  // restored on the next load.
  const clearEntirePlaylist = useCallback(async () => {
    // Stop a running Deep Scan: it would go on analysing the cleared tracks
    // (quietly: no end-of-scan summary for a library that is gone).
    (window as any).cancelAetheriaAnalysis?.({ quiet: true });
    // And Analyse tracks: what it holds belongs to the library being cleared.
    analysePassRef.current?.stop('clear');

    // Stop playback, a tone-only session included.
    setIsPlaying(false);
    setIsSolfeggioActive(false);
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
    setFilteredPlaylist([]);
    setCurrentSongIndex(-1);
    clearLoShuWalkMode();

    // Notices about the old library go too: a Recover tapped after Clear would
    // write the cleared tracks straight back.
    setOrphanOffer(null);
    setOrphanBannerHidden(false);
    setDiscardArmed(false);
    Object.assign(stateSpellRef.current, { active: false, shown: false, dismissed: false });
    stickyToastRef.current = null;
    if (statusToastTimerRef.current) clearTimeout(statusToastTimerRef.current);
    statusToastTimerRef.current = null;
    setStatusToast(null);

    // Wipe the on-disk cache.
    await clearPlaylistCache();

    console.log('[Aetheria] Playlist and cache cleared');
  }, []);

  // Generate full library alignment ordered by frequency
  const generateFullLibraryAlignment = () => applyMix(fullAlignment(mixInput()), 'Full Alignment');

  // Generate specific frequency playlists
  const generateFrequencyPlaylist = (frequencies: number[], name: string) => applyMix(crystalSetMix(mixInput(), frequencies, name), name);

  const generateWellnessPlaylist = () => {
    generateFrequencyPlaylist([174, 285, 528], 'Stillness');
  };

  const generateMoodPlaylist = () => {
    generateFrequencyPlaylist([396, 417, 639], 'Uplift');
  };

  const generateMeditationPlaylist = () => {
    generateFrequencyPlaylist([741, 852, 963], 'Meditation');
  };

  const generateGoldenRatioPlaylist = () => applyMix(goldenRatioMix(mixInput()), 'Golden Φ');

  const generate111PatternPlaylist = () => applyMix(sequence111(mixInput()), '111 Sequence');

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
  const generateSourceFieldPlaylist = () => applyMix(sourceField(mixInput()), '2178 Hz · SOURCE');

  // Show detailed frequency analysis for current track
  const showCurrentTrackAnalysis = () => {
    const currentSong = playlist[currentSongIndex];
    
    if (!currentSong) {
      showStatusToast('No track currently selected for analysis.', { durationMs: 8000 });
      return;
    }
    
    let analysisInfo = `🎵 EXTENDED OCTAVE RANGE ANALYSIS\n\n`;
    analysisInfo += `📀 Track: "${currentSong.name}"\n\n`;
    
    if (currentSong.harmonicFreq && crystalOrigin(currentSong) === 'assigned') {
      // v15.8: an assigned crystal is not a detection; say so instead of a "Detected" report.
      analysisInfo += `🎯 Crystal: ${currentSong.closestSolfeggio} Hz, assigned (not scanned).

Run Deep Scan to analyse this track.
`;
    } else if (currentSong.harmonicFreq) {
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
        analysisInfo += v2Active ? `${KEEP_COMFORTABLE_V2}\n` : `• Keep volume low (feeling vs hearing)\n`;
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
    
    // v15.4: a readout to read and scroll, in a dialog that stays until closed (never a page-freezing alert).
    setInfoDialog({ title: 'Current track analysis', body: analysisInfo });
  };

  // Diagnostic function to show fractal analysis status
  const showPlaylistDiagnostics = () => {
    const totalTracks = originalPlaylist.length;
    // v15.8: analysed = measured by Deep Scan (an assigned crystal is not a scan); "Scan N remaining" names what the
    // Deep Scan button does (deepScanQueue's default scope).
    const analyzedTracks = originalPlaylist.filter(s => { const o = crystalOrigin(s); return o === 'scan' || o === 'scan-replaced'; }).length;
    const unanalyzedTracks = totalTracks - analyzedTracks;
    const assignedTracks = originalPlaylist.filter(s => crystalOrigin(s) === 'assigned').length;
    const scanQueueTracks = deepScanQueue(originalPlaylist).length;
    
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
      `• Unanalyzed tracks: ${unanalyzedTracks}${assignedTracks > 0 ? ` (${assignedTracks} with an assigned crystal)` : ''}\n\n` +
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
      `${scanQueueTracks > 0 ? `• Scan ${scanQueueTracks} remaining tracks\n` : ''}` +
      `${heartTracks === 0 ? '• No HEART frequencies - use Test Distribution for 27-track playlists\n' : ''}` +
      `${headTracks === 0 ? '• No HEAD frequencies - use Test Distribution for 27-track playlists\n' : ''}`;
      
    // v15.4: in the readout dialog, as Current Track Analysis.
    setInfoDialog({ title: 'Library diagnostics', body: diagnosticMessage });
  };

  const generateUltimateAlignmentPlaylist = () => applyMix(ultimateAlignment(mixInput()), 'Ultimate');

  // v15.9: the Mixes tab's tap (utils/mix/catalog.ts ids): the very generator classic's drawer, its Lo Shu menu and the
  // Guidebook run, so every way into a mix is one code path (startPlayOrder, with its Undo). The presets by PRESETS,
  // which the golden holds equal to the drawer's own literals. A play-order function (check:writers): no library write.
  const startMix = (id: MixId) => {
    if (id.startsWith('walk:')) {
      generateLoShuWalk(id.slice(5) as LoShuWalkMode);
      return;
    }
    if (id.startsWith('preset:')) {
      const p = PRESETS.find((x) => `preset:${x.id}` === id);
      if (p) generateFrequencyPlaylist([...p.crystals], p.name);
      return;
    }
    const run: Partial<Record<MixId, () => void>> = {
      gut: generateAlignmentJourney,
      heart: generateHeartAlignmentJourney,
      head: generateHeadAlignmentJourney,
      ultimate: generateUltimateAlignmentPlaylist,
      full: generateFullLibraryAlignment,
      golden: generateGoldenRatioPlaylist,
      seq111: generate111PatternPlaylist,
      source2178: generateSourceFieldPlaylist,
    };
    run[id]?.();
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
      showStatusToast('No Aetheria Collection tracks found! Please import the "Music for Aetheria" folder first using the Import button above.', { durationMs: 8000 });
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
      showStatusToast('No analyzed Aetheria tracks found. Please scan your library first.', { durationMs: 8000 });
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
      showStatusToast('No Aetheria Collection tracks found in your library. Import the "Music for Aetheria" folder first.', { durationMs: 8000 });
    }
  };



  // v15.9: Restore Library / Show library (classic). The library becomes the play order around the track that is
  // playing (or loaded): the cursor moves to that track's place in the library, so the title, the lock-screen card and
  // Next follow the music, which never restarts (no playTrack). Before, the cursor kept its number, so the title named
  // another track and Next jumped. A walk ends. Under shuffle the shuffle order starts again from that track. Nothing
  // current: no cursor. Never writes the library (check:writers: a play-order function).
  const restoreLibrary = () => {
      if (originalPlaylist.length > 0) {
          const st = stateRef.current;
          if (!sameIdOrder(st.playlist, originalPlaylist)) {
              // A track still starting (a mix tapped a moment ago: its playTrack is awaiting a decode or play()) would
              // land its index in the mix into this library order once it starts. Its track is the element's source.
              const el = mainAudioRef.current;
              const starting = el && startedRequestRef.current !== playRequestSeqRef.current && (playStartBusyRef.current || (!el.paused && el.currentTime < 1))
                ? (Object.keys(blobUrlsRef.current).find((id: string) => blobUrlsRef.current[id] === el.getAttribute('src')) ?? null)
                : null;
              const currentId = starting ?? (st.currentSongIndex >= 0 ? (st.playlist[st.currentSongIndex]?.id ?? null) : null);
              const at = currentId === null ? -1 : originalPlaylist.findIndex((s: Song) => s.id === currentId);
              setPlaylist(originalPlaylist);
              clearLoShuWalkMode();
              loShuWalkSnapshotRef.current = '';
              setCurrentSongIndex(at);
              if (st.isShuffle && at >= 0) {
                  const fresh = getLruShuffledIndices(originalPlaylist, playHistoryRef.current);
                  setShuffledIndices([at, ...fresh.filter((i: number) => i !== at)]);
                  setShufflePos(0);
              }
              // That track starts again at its library place, through the normal path: the new request supersedes the
              // one in flight (it returns at its next await, writing nothing), and its cursor is the library's.
              if (starting && at >= 0) {
                const before = playRequestSeqRef.current;
                playTrackRef.current(at, originalPlaylist);
                noteQueueStart(before, at, originalPlaylist); // v16.0: the queue's anchor knows where it lands
              }
          }
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
      setIsSolfeggioActive(false); // a failed track stops every layer, the tone included
      // Auto-recovery for common blob errors — clear src so the next play reloads.
      // Not for the empty src this sets: Chrome answers `src = ''` with a code-4
      // error of its own, and answering that again looped forever (v14.6).
      if ((audio.error?.code === 2 || audio.error?.code === 4) && el.getAttribute('src')) {
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
    const playRequest = ++playRequestSeqRef.current; // v15.7: superseded by any later playTrack (checked after each await)

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
          if (playRequest !== playRequestSeqRef.current) return;
          const audioBuffer = await audioCtxRef.current!.decodeAudioData(arrayBuffer);
          if (playRequest !== playRequestSeqRef.current) return;
          audioBufferRef.current = audioBuffer;
          freq = await detectDominantFrequencyAdvanced(audioBuffer);
          if (playRequest !== playRequestSeqRef.current) return;
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
      if (playRequest !== playRequestSeqRef.current) return;

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
      if (playRequest !== playRequestSeqRef.current) return;
      // No alert() here. A blocking dialog fired from a backgrounded / locked
      // screen (e.g. a transient play() rejection during an auto-advance or a
      // lock-screen skip) is invisible and unmissable until the app is
      // foregrounded — it wedged the lock-screen controls. Log instead and let
      // the next user action or the background watchdog recover.
      console.error('Playback error:', error);
      setIsAnalyzing(false);
      setIsPlaying(false);
      // A failed play stops every layer. Deliberately not pausePlayback(): when
      // a second pick aborts this play(), the new track is already starting.
      setIsSolfeggioActive(false);
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
      // A Next with more than 1 s left (in-app, lock screen, car) is a stop:
      // pause the music too. Auto-advance arrives with <= 0.35 s left
      // (AUTO_ADVANCE_LOOKAHEAD_S) or at 'ended', and lets that tail play out.
      // An unknown length (NaN, or Infinity for a recorder WebM) is not a tail.
      const el = mainAudioRef.current;
      if (el && !el.ended && !(el.duration - el.currentTime <= 1)) {
        pausePlayback();
        return;
      }
      setIsPlaying(false);
      setIsSolfeggioActive(false);
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
              // User interaction required. A toast, not alert(): this path is
              // reachable from the lock screen and the car (media-session play),
              // where a modal dialog would freeze the page until dismissed.
              console.log('User interaction required for playback');
              showStatusToast('The browser blocked playback. Tap play to resume.', { durationMs: 8000 });
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
            showStatusToast('Playback error. Try selecting the track again.', { durationMs: 8000 });
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

    // No first-tap boost (removed in v14.6: it jumped Layer Intensity to 30%,
    // +20 dB, until reload, and undid Mute). The tone plays at the slider's
    // level: at the default 1%, volume 0.8 and phi mode on, its gain ramps to
    // 0.100228 on a 0.4 bus = 0.0401 peak, -26 dB under the music (the tone
    // alone). While music plays, phi timing scales it by
    // getPhiIntensityMultiplier: 0 at each track start, full at 38.2% / 61.8%.
    setSelectedSolfeggio(applyLoShuPerfectMap(rawFreq));
    setIsSolfeggioActive(true);
    if (musicOnly) {
      showStatusToast(`Music only is on, so the tone is silent. Turn it off in ${layout === 'new' && !classicPeek ? 'the Sound sheet' : 'Harmonic Control'}.`);
    } else if (v2CarFallback) {
      showStatusToast(V2_UNAVAILABLE_CAR_TONE);
    }
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
      recordMusicAttachedRef.current = false;
      const ctx = audioCtxRef.current;
      const el = mainAudioRef.current as (HTMLAudioElement & { captureStream?: () => MediaStream }) | null;
      if (!ctx || !el || typeof el.captureStream !== 'function') return () => {};
      try {
          const stream = el.captureStream();
          if (!stream.getAudioTracks().length) return () => {};
          const src = ctx.createMediaStreamSource(stream);
          src.connect(target);
          recordMusicSrcRef.current = src;
          recordMusicAttachedRef.current = true;
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

  // Under Music only (and v2's Car fallback, v15.0.1) the layers are silent, so
  // a recording that couldn't tap the music (a browser without captureStream,
  // or no track loaded yet) would be silence. Say so; don't block it.
  const warnIfRecordingSilent = () => {
      if ((musicOnly || v2CarFallback) && !recordMusicAttachedRef.current) {
          showStatusToast(musicOnly ? "Music only is on and the music can't be recorded here, so this recording will be silent." : V2_UNAVAILABLE_CAR_RECORDING, { durationMs: 8000 });
      }
  };

  const startRecording = (type: 'audio' | 'video' | 'both') => {
      if (!audioCtxRef.current) return;

      // Audio-only path: capture PCM and encode 24-bit WAV at the AudioContext's native sample rate.
      if (type === 'audio') {
          startWavRecording()
              .then(() => {
                  setIsRecording(true);
                  setShowRecordOptions(false);
                  warnIfRecordingSilent();
              })
              .catch((e) => {
                  showStatusToast("WAV recording failed to start.", { durationMs: 8000 });
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
          warnIfRecordingSilent();
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
          showStatusToast("Recording failed to start. Your browser might not support this format.", { durationMs: 8000 });
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

  const getTotalDuration = () => {
    const totalSeconds = playlist.reduce((acc, song) => acc + (song.duration || 0), 0);
    return formatDuration(totalSeconds);
  };

  // Media Session Integration for Vehicle Controls.
  // Memoized so the object identity only changes when the track or frequency
  // actually changes. A fresh object every render reset the lock-screen
  // metadata and forced a position-state update on every render — both visible
  // as lock-screen flicker.
  // The playing song's plain values for the media-session memo: a by-id patch (Deep Scan, Analyse tracks)
  // makes new song objects without changing these, and must not re-send the lock-screen card.
  const nowPlaying = currentSongIndex >= 0 ? playlist[currentSongIndex] : undefined;
  const nowPlayingId = nowPlaying?.id;
  const nowPlayingName = nowPlaying?.name;
  const nowPlayingCrystal = nowPlaying?.closestSolfeggio;
  const currentTrack: Track | null = useMemo(() => {
    if (nowPlayingId === undefined) return null;
    const freq = nowPlayingCrystal || selectedSolfeggio;
    return {
      title: nowPlayingName as string,
      artist: 'Aetheria Harmonic Player',
      album: `${freq}Hz • ${getFrequencyRegime(freq)} Regime`,
      artworkUrl: '/images/icon-192x192.png',
    };
  }, [currentSongIndex, nowPlayingId, nowPlayingName, nowPlayingCrystal, selectedSolfeggio]);

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

  // ---------------------------------------------------------------------------------------------------------------
  // v15.5: the new layout (beta). After the pinned useMediaSession call, never inside it. App stays the only owner of
  // state: the new views read these slices (components/shell/contexts.ts), each memoised on its own values, so the
  // 4 Hz clock re-renders only the time readers; every handler goes through one stable actions object. Nothing here
  // reaches the media element, the anchor, the AudioContext or the media session except through the pinned handlers.
  // ---------------------------------------------------------------------------------------------------------------
  const shellOn = layout === 'new' && !classicPeek;
  // Zen is classic's: the new layout never runs it. A Zen turned on during a peek ends as the new layout comes back.
  useEffect(() => {
    if (shellOn && isZenMode) setIsZenMode(false);
  }, [shellOn, isZenMode]);
  // v15.6: callbacks that run outside a render (the high-frequency check) read the layout through this.
  useEffect(() => {
    shellOnRef.current = shellOn;
  }, [shellOn]);
  // v15.6: whenever the current track changes, by any route (Next, Previous, a gapless advance on a locked phone, a
  // tap in the list, a walk step), a tone lowering made on another track ends, its level back if untouched since
  // (settleToneLowering). It only reads the music element's source; the playback path is not touched.
  useEffect(() => {
    settleToneLowering(mainAudioRef.current?.src ?? '');
  }, [nowPlayingId, settleToneLowering]);
  // The phone shell's Car screen (Output = Car); the desktop has none (its layers chip says Car).
  const carLayout = layout === 'new' && !desktopShell && layerOutput === 'car';
  // v15.6: the Car screen is never Zen: choosing Car ends the new layout's Zen (as v15.5's effect above ends classic's).
  useEffect(() => {
    if (carLayout && shellZen) setShellZen(false);
  }, [carLayout, shellZen]);
  // The heat guard: a solid screen of the phone shell (a tab other than Now Playing, or the Car screen) covers the
  // visualizer, so it stops drawing (VisualsPause). Never in classic or the desktop shell, never while recording (a
  // video recording captures the canvas).
  const visualsPaused = shellOn && !desktopShell && (shellTab !== 'now' || carLayout) && !isRecording;
  // Where the shared notices (the status toasts, the update and recovery banners, the restore toast) sit in the new
  // layout, clear of every control: under Now Playing's top bar or the Car header (the top of the screen there is
  // the visualizer or text), above the mini-player and the tab bar on the other tabs, and on the desktop at the right,
  // above the transport and beside the panel. Classic keeps its own places, byte for byte.
  // v15.6: while Zen hides the bars (uiInsets 0/0 then), and until the first measure after the reveal (one more commit
  // at 0/0), a notice stays in the slot it had while they showed. Shown, the new layout's bars always cover something
  // (the top bar or Now Playing, the tab bar, the transport), so 0/0 there only means "not measured yet".
  const insetsUnmeasured = uiInsets.top === 0 && uiInsets.bottom === 0;
  if (!shellZenHidden && !insetsUnmeasured) noticeInsetsRef.current = uiInsets;
  const noticeInsets = shellZenHidden || insetsUnmeasured ? noticeInsetsRef.current : uiInsets;
  const shellNoticeStyle = desktopShell
    ? { bottom: noticeInsets.bottom + 16 }
    : shellTab === 'now'
      ? { top: noticeInsets.top + 8 }
      : { bottom: noticeInsets.bottom + 8 };

  // v15.7: AUTO-DISTRIBUTE (lifted verbatim from the classic button's onClick, which now calls it; the Library tab's
  // health card calls it too).
  const autoDistribute = () => {
    // Not during a Deep Scan: the scan is writing real analysis into these tracks.
    if (isScanning) {
      showStatusToast('Auto-Distribute is unavailable while Deep Scan runs.');
      return;
    }
    // v15.8: Assign crystals. Deep Scan's crystals stay (one an older Auto-Distribute replaced is put back); every other
    // track gets a crystal, empty crystals first, the same one on every press (utils/mix/distribution.ts planAssign).
    // Only the crystal fields change, by id, in the library and the play order; assigned tracks stay unscanned.
    const plan = planAssign(originalPlaylist);
    if (plan.patches.size === 0) {
      showStatusToast(assignNothingText(plan));
      return;
    }
    setOriginalPlaylist(prev => patchById<Song>(prev, plan.patches));
    setPlaylist(prev => patchById<Song>(prev, plan.patches));
    setAnalysisNotification(assignDoneText(plan));
    setTimeout(() => setAnalysisNotification(null), 8000);
  };

  // v15.7: the new layout's one way to replace the play order (a Library row now; v14.17's generators and v14.18's
  // queue later): `order` starts at `index`. It writes the play order, the cursor, the shuffle order and the walk state,
  // NEVER the library (originalPlaylist): every order comes from libraryRef's own tracks (libraryModel), so the id set
  // the blob save keys on can't change, and nothing is deleted (scripts/check-library-writers.mjs pins this). The
  // cursor is set eagerly, before playTrack's decode and await (as generateLoShuWalk does), so the media-session hook
  // never names the old cursor's track in the new order. Under shuffle the shuffle order is set here, with the track
  // first: playTrack skips its own rule when it gets an order. Leaves an Undo for 10 s (undoPlayOrder).
  // v15.9: every mix starts through here too (applyMix). opts.walk: the walk the order is (its snapshot first, then the
  // mode, segments, phases and steps, so the snapshot effect keeps it); opts.mix: a mix started it, so only taps of one
  // kind chain, and a chained mix's toast says what it started (a Library row's chain keeps the first tap's words).
  // v16.0 (decision 2 A): a new play order CARRIES the queue: the started track, then the tracks waiting in the queue, in
  // queue order (a walk gives them step -1 and phase ''; under shuffle the explicit order puts them right after it), then
  // the rest; the toast says so. "The same play order" is the play order's own entries (its marks 0), so a tap on the
  // playing row still resumes rather than restarts, queue or not; with queue entries in the order every other tap
  // rebuilds it (the old same-order path replays an index of the order as it is). The Undo's snapshot keeps the marks.
  const startPlayOrder = (orderIn: Song[], index: number, toastIn: string, opts?: { walk?: PlayOrderSnapshot['walk']; mix?: boolean }) => {
    const st = stateRef.current;                       // the latest commit (the pinned sync effect)
    const el = mainAudioRef.current;
    if (index < 0 || index >= orderIn.length) return;
    const walkIn = opts?.walk ?? null;
    const mix = !!opts?.mix;
    // The queue's marks over the play order as it is (the mirror of the same commit), and the tracks waiting in it.
    const qm = queueMirrorRef.current.playlist === st.playlist ? queueMirrorRef.current.marks : null;
    // Picking a queued track plays it (as a pick does under shuffle: gatherShuffled): its first waiting copy is not
    // carried, or it would play twice in a row.
    const waitingAll = qm ? waitingIndices({ marks: qm }).filter((i: number) => i !== st.currentSongIndex) : [];
    const pickedCopy = waitingAll.findIndex((i: number) => st.playlist[i]?.id === orderIn[index].id);
    const waitingSongs = waitingAll.filter((_: number, j: number) => j !== pickedCopy).map((i: number) => st.playlist[i]);
    const carried = waitingSongs.length
      ? insertEntries({ order: orderIn, cursor: index, shuffle: false, shuffled: [], shufflePos: 0, marks: null, walk: walkIn ? { steps: walkIn.steps, phases: walkIn.phases } : null }, waitingSongs, 'next').state
      : null;
    const order = carried ? carried.order : orderIn;
    const walk = carried && walkIn && carried.walk ? { ...walkIn, steps: carried.walk.steps, phases: carried.walk.phases } : walkIn;
    const toast = carried ? `${toastIn} ${carryText(waitingSongs.length)}` : toastIn;
    const setWalk = (w: NonNullable<PlayOrderSnapshot['walk']>) => {
      loShuWalkSnapshotRef.current = order.map((s: Song) => s.id).join('|');   // before the mode: the effect keeps it
      setLoShuWalkMode(w.mode);
      setLoShuWalkSegments(w.segments);
      setLoShuWalkPhases(w.phases);
      setLoShuWalkSteps(w.steps);
    };
    // With no queue entry in the order, exactly v15.9's rules.
    const same = !qm && sameIdOrder(st.playlist, orderIn);
    const baseSame = qm ? sameIds(orderIn, baseIds(st.playlist, qm)) : same;
    const onTrack = qm
      ? baseIndex(qm, st.currentSongIndex) === index ||
        (st.currentSongIndex >= 0 && qm[st.currentSongIndex] !== BASE && st.playlist[st.currentSongIndex]?.id === orderIn[index].id)
      : st.currentSongIndex === index;
    if (baseSame && onTrack && (!qm || !walkIn || loShuWalkMode === walkIn.mode)) { // the current track: resume it if paused, never restart it
      if (walk && !qm) setWalk(walk);
      if (!isPlaying) resumePlayback();
      return;
    }
    // A tap while the previous tap's toast still shows (no other toast since, within its 10 s, and nothing else changed
    // the play order) continues its chain: the Undo goes back to the state before the FIRST tap, as it was then
    // (playing or paused).
    const prev = lastPlayOrderRef.current;
    const chained = prev !== null && prev.toastSeq === statusToastSeqRef.current && Date.now() - prev.at < 10_000 &&
      prev.generation === cacheGeneration() && stillTapOrder(st.playlist, prev.newIds, libraryRef.current) && prev.mix === mix;
    const snap: PlayOrderSnapshot = chained ? {
      ...prev, newIds: order.map((s: Song) => s.id), token: ++playOrderSeqRef.current, at: Date.now(), toast: mix ? toast : prev.toast,
    } : {
      ids: st.playlist.map((s: Song) => s.id),
      cursor: st.currentSongIndex,
      shuffled: st.shuffledIndices.slice(),
      shufflePos: st.shufflePos,
      walk: loShuWalkMode ? { mode: loShuWalkMode, segments: loShuWalkSegments, phases: loShuWalkPhases, steps: loShuWalkSteps } : null,
      trackId: st.currentSongIndex >= 0 ? (st.playlist[st.currentSongIndex]?.id ?? null) : null,
      position: el && Number.isFinite(el.currentTime) ? el.currentTime : 0,
      wasPlaying: isPlaying,
      tone: { hz: selectedSolfeggio, active: isSolfeggioActive },
      generation: cacheGeneration(),
      newIds: order.map((s: Song) => s.id),
      token: ++playOrderSeqRef.current,
      at: Date.now(),
      toast,
      toastSeq: -1,
      mix,
      marks: qm,
    };
    const before = playRequestSeqRef.current;
    if (same) {
      if (walk) setWalk(walk);
      playTrackRef.current(index);                     // playTrack's own shuffle rule: this track first, position 0
      noteQueueStart(before, index, st.playlist);
    } else {
      setPlaylist(order);
      setQueueState(carried && carried.marks ? { order, marks: carried.marks } : null); // v16.0: the carried queue
      clearLoShuWalkMode();
      loShuWalkSnapshotRef.current = '';
      if (walk) setWalk(walk);                         // after the clear (one batch: the walk is what commits)
      setCurrentSongIndex(index);                      // eagerly (spec §2.3: the card never names the wrong track)
      if (st.isShuffle) {
        const fresh = getLruShuffledIndices(order, playHistoryRef.current);
        // v16.0: the carried queue (right after the track, physically) stays right after it in the shuffle order.
        const k = waitingSongs.length;
        const sh = k
          ? [index, ...Array.from({ length: k }, (_, j) => index + 1 + j), ...fresh.filter((i: number) => i !== index && !(i > index && i <= index + k))]
          : [index, ...fresh.filter((i: number) => i !== index)];
        if (k) queueShuffledRef.current = sh;
        setShuffledIndices(sh);
        setShufflePos(0);                              // set here: playTrack skips its shuffle rule with an order
      }
      playTrackRef.current(index, order);
      noteQueueStart(before, index, order);
    }
    lastPlayOrderRef.current = snap;
    if (snap.trackId !== null || !same || chained) {
      const token = snap.token;
      showStatusToast(snap.toast, { actionLabel: 'Undo', onAction: () => shellActionsRef.current?.undoPlayOrder(token), durationMs: 10_000 });
      snap.toastSeq = statusToastSeqRef.current;
    } else {
      snap.toastSeq = -1;
    }
  };

  /** A Library row: the whole library (in the list's order when one is given) from that track. Never a search's
   *  subset (the plan's "always the whole library"). */
  const playFromLibrary = (id: string, orderIds: readonly string[] | null) => {
    const order = libraryOrderFor(libraryRef.current, orderIds);
    const index = order.findIndex((s: Song) => s.id === id);
    if (index < 0) {
      showStatusToast(TAP_GONE_TEXT);
      return;
    }
    const walkName = loShuWalkMode ? (LO_SHU_WALK_INFO[loShuWalkMode]?.shortName ?? 'Lo Shu') : null;
    // v16.0: "from the library" judges the play order's own entries (a queue's entries are not what it was playing from).
    const st = stateRef.current;
    const qm = queueMirrorRef.current.playlist === st.playlist ? queueMirrorRef.current.marks : null;
    const playingFrom = qm ? st.playlist.filter((_: Song, i: number) => qm[i] === BASE) : st.playlist;
    startPlayOrder(order, index, libraryTapText(walkName, sameIdSet(playingFrom, order)));
  };

  /**
   * The row tap's Undo: the earlier play order, cursor, shuffle order and walk, and the earlier track from where it was
   * when it was playing. Rebuilt by id from the library as it is NOW (rebuildOrder): a track deleted since is left out
   * (a walk with a step gone ends, as the snapshot effect ends it today), and no stale metadata comes back. It writes
   * what startPlayOrder writes, never the library. Only the latest tap's Undo acts; after a Clear it does nothing; after
   * another play order it refuses and says so.
   * Known limits: an earlier track that was paused comes back unloaded, so Play starts it from 0 (the pinned
   * resumePlayback has no seek); the play history keeps the tapped track's play; another toast can replace this one.
   */
  const undoPlayOrder = (token?: number) => {
    const snap = lastPlayOrderRef.current;
    if (!snap || (token !== undefined && token !== snap.token)) return;
    lastPlayOrderRef.current = null;
    dismissStatusToast();
    if (cacheGeneration() !== snap.generation) return;                                  // a Clear since
    if (!stillTapOrder(stateRef.current.playlist, snap.newIds, libraryRef.current)) {  // another play order since
      showStatusToast(UNDO_CHANGED_TEXT, { durationMs: 6000 });
      return;
    }
    const { order, cursor, dropped, removedCurrent } = rebuildOrder(snap.ids, snap.cursor, libraryRef.current);
    setPlaylist(order);
    // v16.0: the earlier order comes back with its queue (the marks rebuilt exactly as the order is).
    const marks = rebuildMarks(snap.ids, snap.marks, libraryRef.current);
    setQueueState(marks ? { order, marks } : null);
    if (snap.walk && !dropped) {
      loShuWalkSnapshotRef.current = order.map((s: Song) => s.id).join('|');
      setLoShuWalkMode(snap.walk.mode);
      setLoShuWalkSegments(snap.walk.segments);
      setLoShuWalkPhases(snap.walk.phases);
      setLoShuWalkSteps(snap.walk.steps);
    }
    setCurrentSongIndex(cursor);
    if (stateRef.current.isShuffle && !dropped && snap.shuffled.length === order.length) {
      if (marks) queueShuffledRef.current = snap.shuffled; // v16.0: the queue's place in it is as it was
      setShuffledIndices(snap.shuffled);
      setShufflePos(snap.shufflePos);
    } else if (stateRef.current.isShuffle && marks) {
      // v16.0: shuffle switched on since the tap (or a track gone): the shuffle order on now was made for the other
      // play order. A fresh one for this order, its queue straight after the current track, in the same batch: the
      // queue's settle would otherwise judge the queue by the other order's sequence and mark it played.
      const g = gatherShuffled(getLruShuffledIndices(order, playHistoryRef.current), cursor, waitingIndices({ marks }));
      queueShuffledRef.current = g.shuffled;
      setShuffledIndices(g.shuffled);
      setShufflePos(g.shufflePos);
    }
    if (snap.wasPlaying && cursor >= 0 && !removedCurrent) {
      const wantId = order[cursor].id;
      const at = snap.position;
      const before = playRequestSeqRef.current;
      const started = playTrackRef.current(cursor, order);
      noteQueueStart(before, cursor, order);
      Promise.resolve(started).then(() => {
        const a = mainAudioRef.current;
        const now = stateRef.current;
        if (a && at > 1 && now.playlist[now.currentSongIndex]?.id === wantId && Number.isFinite(a.duration) && at < a.duration - 1) {
          a.currentTime = at;                                                           // seekTo's body
          setCurrTime(at);
        }
        // v15.9: the tone as it was (playTrack set the track's crystal; a crystal picked by hand comes back).
        if (now.playlist[now.currentSongIndex]?.id === wantId) {
          setSelectedSolfeggio(snap.tone.hz);
          setIsSolfeggioActive(snap.tone.active);
        }
      });
    } else {
      // It was paused (or its track is gone): stop the tapped track and unload, as deleteSong does, so Play starts
      // the restored cursor's track. A tapped track still decoding (unscanned) must not start after this either:
      // the request number supersedes its playTrack, which returns at its next await.
      playRequestSeqRef.current++;
      const a = mainAudioRef.current;
      if (a && !a.paused) pausePlayback();
      else setIsPlaying(false);
      if (a) {
        a.removeAttribute('src');
        try { a.load(); } catch {}
      }
      // v15.9: the tone as it was (pausePlayback stops every layer): a tone-only session comes back at its crystal.
      setSelectedSolfeggio(snap.tone.hz);
      setIsSolfeggioActive(snap.tone.active);
    }
  };

  /** A Library row's Delete: v15.4's confirmation Dialog, which deletes through confirmPendingDelete → deleteSong. */
  const requestDelete = (id: string) => {
    const s = libraryRef.current.find((x: Song) => x.id === id);
    if (s) setPendingDelete({ id: s.id, name: s.name });
  };

  // ---------------------------------------------------------------------------------------------------------------
  // v16.0: the queue (spec §3.3). Queued tracks are INSERTED into the playing list: real entries of the play order, of
  // the shuffle order (insert and shift, never regenerated) and of a walk (step -1, phase ''), so resolveNext,
  // tryGaplessAdvance, playNext, handlePrev, the lock-screen and car Next and the gapless swap (all pinned, untouched)
  // play them as the next entry. One writer, commitQueue, used by every queue write (queueTracks, editQueue, undoQueue,
  // the switch-off gather): it writes the play order and its companions in ONE batch, never the library.
  //   The anchor (queueModel.anchorFor): a write goes after the entry the music element plays when a start has not
  //   landed yet (the swap before its commit, ~31 ms; a Next still decoding), else after the cursor; a start that would
  //   write its index later under shuffle, or any other start (Previous, a pick), makes it wait. A waiting write is
  //   retried every 150 ms; after 15 s it is dropped with a toast. A start that failed counts as settled after 1 s.
  //   The batch: the walk's snapshot FIRST (the snapshot effect keeps the walk: survey E5), the order, the marks, the
  //   walk's arrays, the shuffle order under shuffle (with the order, or the shuffle effect regenerates it: E3), then the
  //   cursor and shufflePos as FUNCTIONAL shifts, so the swap's pending write lands first and is shifted (E1).
  // ---------------------------------------------------------------------------------------------------------------
  /** What the music element plays (its src through blobUrlsRef: set synchronously by every start, the swap included),
   *  whether a start is in flight, and that start's entry in the play order as it is, when it was recorded. */
  const queueStart = (): StartState => {
    const el = mainAudioRef.current;
    const src = el ? el.getAttribute('src') : null;
    const urls = blobUrlsRef.current;
    const playingId = src ? (Object.keys(urls).find((id: string) => urls[id] === src) ?? null) : null;
    const t = queueStartTargetRef.current;
    const target = t && t.seq === playRequestSeqRef.current && t.order === stateRef.current.playlist ? t.index : null;
    const s = stateRef.current;
    const curId = s.currentSongIndex >= 0 ? (s.playlist[s.currentSongIndex]?.id ?? null) : null;
    // A start whose play() was refused never records its play; when Play then resumes the element directly (the pinned
    // resumePlayback), the cursor's track plays on and nothing is starting: past half a second of it, with no decode
    // under way, the start is over.
    const resumed = !!el && !el.paused && el.currentTime > 0.5 && !playStartBusyRef.current && playingId !== null && playingId === curId;
    const startPending = startedRequestRef.current !== playRequestSeqRef.current && !resumed;
    const landing = queueLandingRef.current.seq > queuePlayAckRef.current ? queueLandingRef.current.kind : null;
    return { playingId, startPending, target, landing };
  };
  /** A start has not landed yet: the element plays another track than the cursor's. */
  const queueStartInFlight = (): boolean => {
    const { playingId } = queueStart();
    const s = stateRef.current;
    const curId = s.currentSongIndex >= 0 ? (s.playlist[s.currentSongIndex]?.id ?? null) : null;
    return playingId !== null && playingId !== curId;
  };
  /** The play state a queue write starts from: the pinned stateRef (what the swap reads) and the queue's mirror, when
   *  both are the same commit's (else null: the write waits). */
  const queuePlayState = (): PlayState<Song> | null => {
    const s = stateRef.current;
    const q = queueMirrorRef.current;
    if (q.playlist !== s.playlist) return null;
    return {
      order: s.playlist,
      cursor: s.currentSongIndex,
      shuffle: s.isShuffle,
      shuffled: s.shuffledIndices,
      shufflePos: s.shufflePos,
      marks: q.marks,
      walk: q.walk ? { steps: q.steps, phases: q.phases } : null,
    };
  };
  const queueFailedSinceRef: { current: number } = useRef(0);
  const queueAnchor = (st: PlayState<Song>): Anchor => {
    const start = queueStart();
    const a = anchorFor(st, stateRef.current.isLoop, start);
    if (!('wait' in a) || !shuffleValid(st)) {
      queueFailedSinceRef.current = 0;
      return a;
    }
    // A start that failed (play() refused, nothing decoding) never lands: after 1 s it counts as settled.
    const el = mainAudioRef.current;
    if (!(start.startPending && el && el.paused && !playStartBusyRef.current)) {
      queueFailedSinceRef.current = 0;
      return a;
    }
    const now = Date.now();
    if (!queueFailedSinceRef.current) queueFailedSinceRef.current = now;
    return now - queueFailedSinceRef.current > 1000 ? { at: st.cursor, inFlight: false } : a;
  };
  /** The one batch (spec §3.3). Never the library: only the play order and its companions. */
  const commitQueue = (prev: PlayState<Song>, next: PlayState<Song>, remap: Remap) => {
    // The next write waits for this one: until the commit that holds it has run its effects (stateRef synced), which
    // that commit's own effect acknowledges (queueAckRef), never any other commit's.
    const seq = ++queueWriteSeqRef.current;
    queueWriteRef.current = { seq, at: performance.now() };
    setQueueAck(seq);
    // A recorded start in flight keeps its entry (sequential writes never move it; the remap says so).
    const t = queueStartTargetRef.current;
    if (t && t.order === prev.order) queueStartTargetRef.current = { ...t, index: remap.index(t.index), order: next.order };
    if (next.walk) loShuWalkSnapshotRef.current = next.order.map((s: Song) => s.id).join('|'); // first: the walk stays
    setPlaylist(next.order);
    setQueueState(next.marks ? { order: next.order, marks: next.marks } : null);
    if (next.walk) {
      setLoShuWalkSteps(next.walk.steps);
      setLoShuWalkPhases(next.walk.phases);
    }
    if (prev.shuffle) {
      queueShuffledRef.current = next.shuffled;
      setShuffledIndices(next.shuffled);
    }
    setCurrentSongIndex((c: number) => remap.index(c)); // FUNCTIONAL: a pending swap's write lands first, then the shift
    if (prev.shuffle) setShufflePos((k: number) => remap.pos(k));
  };
  const queueUndoRef: { current: QueueUndo | null } = useRef(null);
  const queueTokenRef: { current: number } = useRef(0);
  const queuePendingRef: { current: { op: QueueOp; since: number }[] } = useRef([]);
  const queueWriteRef: { current: { seq: number; at: number } | null } = useRef(null);
  const queueWriteSeqRef: { current: number } = useRef(0);
  const queueWaitShortRef: { current: boolean } = useRef(false);
  const queueTimerRef: { current: ReturnType<typeof setTimeout> | null } = useRef(null);
  useEffect(() => () => {
    if (queueTimerRef.current) clearTimeout(queueTimerRef.current);
  }, []);
  /** The toast of a queue write, with its Undo for 10 s (only the latest write's acts). */
  const queueToast = (text: string, undo: QueueUndo) => {
    queueUndoRef.current = undo;
    const token = undo.token;
    showStatusToast(text, { actionLabel: 'Undo', onAction: () => queueApiRef.current?.run({ kind: 'undo', token }), durationMs: 10_000 });
  };
  const libraryById = (): Map<string, Song> => {
    const m = new Map<string, Song>();
    for (const s of libraryRef.current) if (!m.has(s.id)) m.set(s.id, s);
    return m;
  };
  /** Apply a queue write now, if the play state is settled: true when it is done (or has nothing to do). */
  const applyQueueOp = (op: QueueOp): boolean => {
    // The queue's previous write not in stateRef yet (its commit's effects have not run): wait a moment, or this write
    // would start from the play state before it and undo it (two writes in one task, or two pending ones in one retry).
    const w = queueWriteRef.current;
    queueWaitShortRef.current = !!w && queueAckRef.current < w.seq && performance.now() - w.at < 1000;
    if (queueWaitShortRef.current) return false;
    const st = queuePlayState();
    if (!st) return false;
    const a = queueAnchor(st);
    if ('wait' in a) return false;
    const anchor = a.at;
    if (op.kind === 'add') {
      const byId = libraryById();
      const songs = op.ids.map((id: string) => byId.get(id)).filter((s: Song | undefined): s is Song => !!s);
      if (!songs.length) {
        showStatusToast(TAP_GONE_TEXT);
        return true;
      }
      const r = insertEntries(st, songs, op.mode, anchor);
      commitQueue(st, r.state, r.remap);
      const ed = editableWaiting(r.state, r.remap.index(anchor));
      const mine = ed.map((i: number, q: number) => (i >= r.at && i < r.at + r.count ? q : -1)).filter((q: number) => q >= 0);
      const text = queuedToast({
        name: songs.length === 1 ? songs[0].name : `${songs.length} tracks`,
        mode: op.mode,
        position: (mine[0] ?? 0) + 1,
        noCrystal: songs.some((s: Song) => !s.closestSolfeggio),
        nothingCurrent: st.cursor < 0 && anchor < 0,
      });
      queueToast(text, { token: ++queueTokenRef.current, kind: 'add', after: ed.map((i: number) => r.state.order[i].id), mine, names: songs.map((s: Song) => s.name) });
      return true;
    }
    if (op.kind === 'remove' || op.kind === 'move') {
      const ed = editableWaiting(st, anchor);
      const from = ed.indexOf(op.index);
      if (from < 0 || st.order[op.index]?.id !== op.id) {
        // Gone, moved by another write, or started meanwhile: nothing to do, and said so (never silently).
        showStatusToast(editMissedText(op.kind), { durationMs: 6000 });
        return true;
      }
      if (op.kind === 'move') {
        // `to` is a place in the sheet's list: the waiting entries ahead of the cursor, where a start in flight can lead
        // (it is not editable). The entry at that place, then its place among the editable ones.
        const shown = editableWaiting(st, st.cursor);
        const toEntry = shown.length ? shown[Math.max(0, Math.min(op.to, shown.length - 1))] : -1;
        const to = toEntry >= 0 ? Math.max(0, ed.indexOf(toEntry)) : Math.max(0, Math.min(op.to, ed.length - 1));
        if (to !== from) commitQueue(st, moveWaitingAfter(st, anchor, from, to), SAME); // its own undo: no toast
        return true;
      }
      const song = st.order[op.index];
      const r = removeEntriesRemap(st, [op.index]);
      commitQueue(st, r.state, r.remap);
      const after = editableWaiting(r.state, r.remap.index(anchor)).map((i: number) => r.state.order[i].id);
      queueToast(removedToast(song.name), { token: ++queueTokenRef.current, kind: 'remove', after, id: song.id, pos: from });
      return true;
    }
    if (op.kind === 'clear') {
      const ed = editableWaiting(st, anchor);
      if (!ed.length) return true;
      const ids = ed.map((i: number) => st.order[i].id);
      const r = removeEntriesRemap(st, ed);
      commitQueue(st, r.state, r.remap);
      queueToast(clearedToast(ed.length), { token: ++queueTokenRef.current, kind: 'clear', after: [], ids });
      return true;
    }
    if (op.kind === 'gather') {
      if (st.shuffle) return true; // switched on again meanwhile: the shuffle effect gathers
      // It moves the waiting entries to after the cursor: a start in flight (its index captured, written later) or one
      // landing would then name another track. It waits for that start, and gathers after the track it lands on.
      // (A start that failed, settled by queueAnchor's 1 s rule, writes nothing later: it does not hold the gather.)
      const sNow = queueStart();
      const failedSettled = queueFailedSinceRef.current > 0 && Date.now() - queueFailedSinceRef.current > 1000;
      if (a.inFlight || a.at !== st.cursor || sNow.landing || (sNow.startPending && !failedSettled)) return false;
      const r = gatherSequentialRemap(st);
      if (r.state.order !== st.order) commitQueue(st, r.state, r.remap);
      return true;
    }
    // Undo: only the latest write's, and only while the queue is as that write left it (less what played since).
    const u = queueUndoRef.current;
    if (!u || u.token !== op.token) return true;
    queueUndoRef.current = null;
    dismissStatusToast();
    const ed = editableWaiting(st, anchor);
    const played = u.after.length - ed.length;
    if (played < 0 || u.after.slice(played).some((id: string, j: number) => id !== st.order[ed[j]].id)) {
      showStatusToast(QUEUE_CHANGED_TEXT, { durationMs: 6000 });
      return true;
    }
    if (u.kind === 'add') {
      // Its entries still waiting go; one that has started stays, and the toast says so.
      const still = u.mine.filter((q: number) => q >= played).map((q: number) => ed[q - played]);
      if (still.length) {
        const r = removeEntriesRemap(st, still);
        commitQueue(st, r.state, r.remap);
      }
      if (still.length < u.mine.length) showStatusToast(undoStartedText(u.names[0]), { durationMs: 6000 });
      return true;
    }
    const byId = libraryById();
    if (u.kind === 'remove') {
      // Back at its place in the queue: in at the end, then moved there (a move shifts nothing).
      const song = byId.get(u.id);
      if (!song) {
        showStatusToast(QUEUE_CHANGED_TEXT, { durationMs: 6000 });
        return true;
      }
      const r = insertEntries(st, [song], 'queue', anchor);
      const na = r.remap.index(anchor);
      const n = editableWaiting(r.state, na).length;
      commitQueue(st, moveWaitingAfter(r.state, na, n - 1, Math.max(0, Math.min(u.pos - played, n - 1))), r.remap);
      return true;
    }
    // Clear: the tracks back in their order, right after the current track.
    const songs = u.ids.map((id: string) => byId.get(id)).filter((s: Song | undefined): s is Song => !!s);
    if (songs.length) {
      const r = insertEntries(st, songs, 'next', anchor);
      commitQueue(st, r.state, r.remap);
    }
    return true;
  };
  /** applyQueueOp, never throwing: it runs inside effects (the switch-off gather) and timers, where a throw would take
   *  the app down. A write the model refuses is dropped (logged), and the play state stays as it was. */
  const applyQueueOpSafe = (op: QueueOp): boolean => {
    try {
      return applyQueueOp(op);
    } catch (e) {
      console.error('Queue: a write was dropped', e);
      return true;
    }
  };
  /** Run a queue write: now if nothing waits before it and the play state is settled, else in turn, retried. */
  const runQueueOp = (op: QueueOp) => {
    const pending = queuePendingRef.current;
    if (pending.length === 0 && applyQueueOpSafe(op)) return;
    pending.push({ op, since: Date.now() });
    if (!queueTimerRef.current) queueTimerRef.current = setTimeout(() => queueApiRef.current?.tick(), queueWaitShortRef.current ? 16 : 150);
  };
  const queueRetryTick = () => {
    queueTimerRef.current = null;
    const pending = queuePendingRef.current;
    while (pending.length) {
      const p = pending[0];
      if (applyQueueOpSafe(p.op)) {
        pending.shift();
        continue;
      }
      if (Date.now() - p.since > 15_000) {
        pending.shift();
        if (p.op.kind !== 'gather') showStatusToast(STILL_STARTING_TEXT, { durationMs: 6000 });
        continue;
      }
      break;
    }
    if (pending.length) queueTimerRef.current = setTimeout(() => queueApiRef.current?.tick(), queueWaitShortRef.current ? 16 : 150);
  };
  /** Play next / Add to queue: library tracks by id (the library's own objects, as playFromLibrary). */
  const queueTracks = (ids: readonly string[], mode: 'next' | 'queue') => runQueueOp({ kind: 'add', ids: ids.slice(), mode });
  /** The Up next sheet's edits: a queued entry (its index in the play order and its id, checked when it applies) removed,
   *  moved to a place in the queue, or to its top (the row's Play next), and Clear. */
  const editQueue = (
    op: { remove: { index: number; id: string } } | { move: { index: number; id: string; to: number } } | { toTop: { index: number; id: string } } | { clear: true }
  ) => {
    if ('remove' in op) runQueueOp({ kind: 'remove', index: op.remove.index, id: op.remove.id });
    else if ('move' in op) runQueueOp({ kind: 'move', index: op.move.index, id: op.move.id, to: op.move.to });
    else if ('toTop' in op) runQueueOp({ kind: 'move', index: op.toTop.index, id: op.toTop.id, to: 0 });
    else runQueueOp({ kind: 'clear' });
  };
  /** The latest queue toast's Undo (its button passes its token; with none, the latest). */
  const undoQueue = (token?: number) => {
    const t = token ?? queueUndoRef.current?.token;
    if (t !== undefined) runQueueOp({ kind: 'undo', token: t });
  };
  const queueApiRef: { current: { run: (op: QueueOp) => void; tick: () => void; queueTracks: typeof queueTracks; editQueue: typeof editQueue; undoQueue: typeof undoQueue } | null } = useRef(null);
  useLayoutEffect(() => {
    queueApiRef.current = { run: runQueueOp, tick: queueRetryTick, queueTracks, editQueue, undoQueue };
  });

  /** The layout switch: saved from a tap only. The music, the visualizer and the lock-screen card carry over. */
  const setLayout = (next: LayoutPref) => {
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {}
    setLayoutState(next);
    setClassicPeek(null);
    setShellTab('now');
    setShellSheet(null);
    setSheetFocus(null);
    // v15.6: the new layout's Zen ends with any switch (Back to classic, the shell fallback's Use the classic layout).
    setShellZen(false);
    if (next === 'new') {
      // Zen is classic's in v15.5, and these popovers' portals belong to the classic transport. Harmonic Control
      // (where the opt-in sits) closes; the other classic panels stay as they are for a return.
      setIsZenMode(false);
      setLayerSwitchOpen(false);
      setShowLoShuWalkMenu(false);
      setShowSettings(false);
    }
  };
  /** A stub's "Open the classic …": classic at the right place, with "Back to the new layout"; the choice stays new. */
  const peekClassic = (panel: PeekPanel) => {
    setShellSheet(null);
    setSheetFocus(null);
    setShellZen(false); // v15.6: a peek ends the new layout's Zen (classic's own Zen is classic's).
    if (panel === 'sound') setShowSettings(true);
    else setShowSidebar(true);
    setClassicPeek(panel);
  };
  // The new seek: handleSeek's body, from a fraction of the track or a step in seconds (element time).
  const seekTo = (fraction: number) => {
    const el = mainAudioRef.current;
    if (!el) return;
    const d = currDuration > 0 ? currDuration : Number.isFinite(el.duration) ? el.duration : 0;
    if (!(d > 0)) return;
    const t = Math.min(1, Math.max(0, fraction)) * d;
    el.currentTime = t;
    setCurrTime(t);
  };
  const seekBy = (delta: number) => {
    const el = mainAudioRef.current;
    if (!el) return;
    const d = currDuration > 0 ? currDuration : Number.isFinite(el.duration) ? el.duration : 0;
    if (!(d > 0)) return;
    const t = Math.min(d, Math.max(0, el.currentTime + delta));
    el.currentTime = t;
    setCurrTime(t);
  };

  // The contexts' values. The O(n) ones (the library's total and order) only while the new layout shows.
  // Optional lookups: this runs in App's own render, above every boundary, so a walk mode the table doesn't know (a
  // restored state from another version) must not throw here, in either layout.
  const shellWalkName = loShuWalkMode ? (LO_SHU_WALK_INFO[loShuWalkMode]?.shortName ?? null) : null;
  const shellWalkFullName = loShuWalkMode ? (LO_SHU_WALK_INFO[loShuWalkMode]?.fullName ?? null) : null;
  // v15.7: "the library" is the same ids, as many times each, in any order (decision 2 A: a library started from a
  // sorted list still reads "Library · 12 of 440"). The import rule in handleFileUpload keeps sameIdOrder.
  // v16.0: the play order's OWN entries (marks 0): a queue's entries never make it "a play order" (Library · 13 of 440).
  const shellBaseOrder = useMemo(
    () => (shellOn && queueMarks ? playlist.filter((_: Song, i: number) => queueMarks[i] === BASE) : playlist),
    [shellOn, playlist, queueMarks]
  );
  const playOrderIsLibrary = useMemo(
    () => (shellOn ? sameIdOrder(shellBaseOrder, originalPlaylist) || sameIdSet(shellBaseOrder, originalPlaylist) : true),
    [shellOn, shellBaseOrder, originalPlaylist]
  );
  // v16.0: the queue's slice (QueueContext): the sequence ahead in the order of play (queued and own runs), the waiting
  // count, what plays next, and each waiting track's first place (the Library's marks). O(n) on a change of the play
  // order, its marks, the cursor, the shuffle order or the walk, never on the clock; only while the new layout shows.
  const shellQueue = useMemo(() => {
    const st: PlayState<Song> = { order: playlist, cursor: currentSongIndex, shuffle: isShuffle, shuffled: shuffledIndices, shufflePos: 0, marks: shellOn ? queueMarks : null, walk: null };
    const u = shellOn ? upcomingRuns(st, isLoop) : { runs: [], more: 0, moreQueued: 0, end: 'stop' as const };
    const seen = new Map<string, number>();
    const positions = new Map<string, number>();
    let waiting = 0;
    const runs = u.runs.map((r: { queued: boolean; rows: number[] }) => ({
      queued: r.queued,
      rows: r.rows.map((i: number) => {
        const s = playlist[i];
        const k = (seen.get(s.id) ?? 0) + 1;
        seen.set(s.id, k);
        if (r.queued) {
          waiting++;
          if (!positions.has(s.id)) positions.set(s.id, waiting);
        }
        return { key: `${s.id}#${k}`, index: i, song: s };
      }),
    }));
    const next = shellOn && shuffleValid(st) ? peekNext(st, isLoop) : null;
    return {
      runs,
      waiting: waiting + u.moreQueued,
      more: u.more,
      end: u.end,
      nextTitle: next !== null ? (playlist[next]?.name ?? null) : null,
      source: shellWalkName ? { kind: 'walk' as const, name: shellWalkName } : playOrderIsLibrary ? { kind: 'library' as const } : { kind: 'order' as const },
      nothingCurrent: currentSongIndex < 0,
      loop: isLoop,
      shuffle: isShuffle,
      positions,
    };
  }, [shellOn, playlist, currentSongIndex, isShuffle, shuffledIndices, isLoop, queueMarks, shellWalkName, playOrderIsLibrary]);
  const libraryTotalSeconds = useMemo(
    () => (shellOn ? originalPlaylist.reduce((sum: number, s: Song) => sum + (s.duration || 0), 0) : 0),
    [shellOn, originalPlaylist]
  );
  // v16.0: with a queue, a walk's step counts its walk entries (steps >= 0) and the library line the play order's own
  // entries; on a queued track: "Your queue · 1 of 3 · then Library" (queueSourceLine). With no queue, the numbers are
  // v15.9's. O(n) only when the order, the marks, the walk or the cursor change (never on the clock), and only while the
  // new layout shows.
  const { shellSource, shellSourceShort } = useMemo(() => {
    if (!shellOn) return { shellSource: '', shellSourceShort: '' };
    const n = playlist.length;
    const cur = currentSongIndex;
    const st: PlayState<Song> = { order: playlist, cursor: cur, shuffle: isShuffle, shuffled: shuffledIndices, shufflePos, marks: queueMarks, walk: null };
    const run = queueRun(st);
    const wp = loShuWalkMode && loShuWalkSteps ? walkProgress(loShuWalkSteps, loShuWalkSegments, cur) : null;
    if (run) {
      const after = nextBaseAhead(st);
      const afterWalk = after !== null && loShuWalkMode && loShuWalkSteps ? walkProgress(loShuWalkSteps, loShuWalkSegments, after) : null;
      const then = queueThen(shellWalkName, playOrderIsLibrary, afterWalk ? afterWalk.at : after !== null ? after + 1 : 0, afterWalk ? afterWalk.count : n, after !== null);
      return { shellSource: queueSourceLine(run.at, run.of, then), shellSourceShort: queueSourceShort(run.at, run.of) };
    }
    // The walk's own position, or the play order's own (both the plain cursor without a queue).
    const at = wp && !wp.queued ? wp.at - 1 : queueMarks ? baseIndex(queueMarks, cur) : cur;
    const count = wp && Number.isFinite(wp.count) ? wp.count : queueMarks ? baseCount(queueMarks, n) : n;
    return {
      shellSource: sourceLine(
        shellWalkName,
        playOrderIsLibrary,
        at,
        count,
        walkSegment(loShuWalkMode, loShuWalkSegments, at),
        loShuWalkMode ? loShuWalkPhases?.[cur] || null : null
      ),
      shellSourceShort: cur >= 0 ? `${shellWalkName ?? (playOrderIsLibrary ? 'Library' : 'Play order')} ${at + 1}/${count}` : `${count} tracks`,
    };
  }, [shellOn, playlist, currentSongIndex, isShuffle, shuffledIndices, shufflePos, queueMarks, loShuWalkMode, loShuWalkSteps, loShuWalkSegments, loShuWalkPhases, shellWalkName, playOrderIsLibrary]);
  const shellPlayer = useMemo(
    () => ({
      isPlaying,
      hasTrack: nowPlayingId !== undefined,
      trackId: nowPlayingId ?? null,
      title: nowPlayingName ?? '',
      index: currentSongIndex,
      count: playlist.length,
      shuffle: isShuffle,
      loop: isLoop,
      toneOnly,
      isRecording,
      source: shellSource,
      sourceShort: shellSourceShort,
    }),
    [isPlaying, nowPlayingId, nowPlayingName, currentSongIndex, playlist.length, isShuffle, isLoop, toneOnly, isRecording, shellSource, shellSourceShort]
  );
  // The crystal the layers actually play: under v2 its plan's frequency (canonicalLayerHz follows Perfect GUT as it
  // is now, whatever mapping selectedSolfeggio was stored with); classic plays applyLoShuPerfectMap(selectedSolfeggio).
  const shellCrystalHz = v2Active && layer.f > 0 ? layer.f : applyLoShuPerfectMap(selectedSolfeggio);
  const shellTrackRawHz = nowPlayingCrystal || null;
  const shellTrackHz = shellTrackRawHz ? applyLoShuPerfectMap(shellTrackRawHz) : null;
  const shellBeatText = v2Active || v2CarFallback ? bandChipLabel : selectedBinaural.name;
  const shellPhi = enablePhiMode && phiTimingEnabled;
  const shellSound = useMemo(
    () => ({
      crystalHz: shellCrystalHz,
      trackHz: shellTrackHz,
      trackRawHz: shellTrackRawHz,
      perfectGut: loShuPerfectGUT,
      engine: layerEngine,
      v2Active,
      v2Failed,
      v2CarFallback,
      output: layerOutput,
      outputEffective,
      layersShown: showLayerChrome,
      layersText: layersBadgeLabel,
      layersTip: layersBadgeTooltip,
      beatText: shellBeatText,
      keyFitShown: keyFitChipShown,
      keyFitText: keyFitChipLabel,
      keyFitHint: keyFitChipHint,
      keyFitLook: keyFitChipLook,
      keyFitOn,
      keyFitRowLine,
      musicOnly,
      layerPanelProps,
      phi: shellPhi,
    }),
    [shellCrystalHz, shellTrackHz, shellTrackRawHz, loShuPerfectGUT, layerEngine, v2Active, v2Failed, v2CarFallback, layerOutput, outputEffective, showLayerChrome, layersBadgeLabel, layersBadgeTooltip, shellBeatText, keyFitChipShown, keyFitChipLabel, keyFitChipHint, keyFitChipLook, keyFitOn, keyFitRowLine, musicOnly, layerPanelProps, shellPhi]
  );
  const shellLevels = useMemo(
    () => ({ volume, toneLevel: solfeggioVolume, beatLevel: binauralVolume, toneText: toneLevelText, beatText: beatLevelText, outputRender, v2Active, v2CarFallback }),
    [volume, solfeggioVolume, binauralVolume, toneLevelText, beatLevelText, outputRender, v2Active, v2CarFallback]
  );
  // v15.6, the Layers tab's slow settings (TuningContext). What the layers play for the crystal: v2's tone is its plan's
  // (toneOf, the player's own fold for the output), classic's its solfeggioHz; none while the layers are off.
  const shellLayersOff = musicOnly || v2CarFallback;
  const shellHeardHz = shellLayersOff
    ? null
    : v2Active
      ? (layer.f > 0 ? toneOf(layer.f, planOutput) : null)
      : solfeggioHz(applyLoShuPerfectMap(selectedSolfeggio));
  // The band the beat delivers now, for the Beat card's "now", by the Beat chip's own logic: v2's `render` is 'off'
  // under Car and while the tone plays alone, its pulse plays planBand (capped at Alpha); classic's beat plays only with
  // the music, so not while the tone plays alone either.
  const shellNowBandId: Band | null = shellLayersOff || toneOnly ? null : v2Active ? (render === 'off' ? null : planBand) : presetBand;
  const shellNowBand = shellNowBandId ? `${shellNowBandId.charAt(0).toUpperCase()}${shellNowBandId.slice(1)}` : null;
  const shellTrackPeakS = currDuration > 0 ? currDuration * INV_PHI : null;
  const shellTuning = useMemo(
    () => ({
      adaptive: isAdaptiveBinaural,
      presetName: selectedBinaural.name,
      nowBand: shellNowBand,
      render: outputRender,
      v2Beat: v2Active || v2CarFallback,
      phiMode: enablePhiMode,
      phiTiming: phiTimingEnabled,
      level: userExperienceLevel,
      crystalFilter,
      trackPeakS: shellTrackPeakS,
      heardHz: shellHeardHz,
      canExportLog: soundLogOn,
    }),
    [isAdaptiveBinaural, selectedBinaural.name, shellNowBand, outputRender, v2Active, v2CarFallback, enablePhiMode, phiTimingEnabled, userExperienceLevel, crystalFilter, shellTrackPeakS, shellHeardHz, soundLogOn]
  );
  // v16.0: the play order's count is its own entries' (a queue's are counted by the queue).
  const shellLibrary = useMemo(
    () => ({ count: originalPlaylist.length, totalSeconds: libraryTotalSeconds, playOrderIsLibrary, playOrderCount: shellBaseOrder.length, isScanning }),
    [originalPlaylist.length, libraryTotalSeconds, playOrderIsLibrary, shellBaseOrder.length, isScanning]
  );
  const shellWalk = useMemo(
    () => ({ mode: loShuWalkMode, name: shellWalkName, fullName: shellWalkFullName, index: currentSongIndex, count: playlist.length }),
    [loShuWalkMode, shellWalkName, shellWalkFullName, currentSongIndex, playlist.length]
  );
  const shellTime = useMemo(() => ({ t: currTime, d: currDuration }), [currTime, currDuration]);
  // v15.7, the Library tab: the library itself (the same array, no copy: it changes with an import, a delete or a
  // patch, never on the clock), and the passes' and imports' state, which only the health card and the Import sheet
  // read (it changes on their progress ticks, so the list never reads it).
  const shellLibraryList = useMemo(() => ({ songs: originalPlaylist, loading: libraryLoading }), [originalPlaylist, libraryLoading]);
  const shellOrphans = useMemo(
    () => (orphanSplit ? { fresh: orphanSplit.fresh.length, duplicates: orphanSplit.duplicates.length } : null),
    [orphanSplit]
  );
  const shellLibraryStatus = useMemo(
    () => ({
      isScanning,
      scanProgress,
      pass,
      analyseCounts,
      restoring: isRestoring,
      durationsLeft: pendingDurationAnalysis.length,
      orphans: shellOrphans,
      orphanBusy,
      discardArmed,
      lastImport,
      analyseMobile: ANALYSE_MOBILE,
    }),
    [isScanning, scanProgress, pass, analyseCounts, isRestoring, pendingDurationAnalysis.length, shellOrphans, orphanBusy, discardArmed, lastImport]
  );
  // v15.7: classic's blue "Analysis Status" notice is not shown in the new layout: an import's summary is the Import
  // sheet's and Deep Scan's progress the health card's (newLayoutNotice: 'mute'); any other message goes to the status
  // toast, once per message.
  const routedNoticeRef: { current: string | null } = useRef(null);
  useEffect(() => {
    if (!analysisNotification) {
      routedNoticeRef.current = null;
      return;
    }
    if (!shellOn || analysisNotification === routedNoticeRef.current) return;
    routedNoticeRef.current = analysisNotification;
    if (analysisNotification === mixNoticeRef.current) return; // v15.9: a mix's notice is classic's (its Undo toast stays)
    if (newLayoutNotice(analysisNotification) === 'toast') showStatusToast(analysisNotification);
  }, [shellOn, analysisNotification]);
  // v15.7: the delete confirmation's one new-layout sentence. Classic's text stays byte for byte ('' there).
  const deleteNote = !shellOn || !pendingDelete
    ? ''
    : pendingDelete.id === nowPlayingId && isPlaying
      ? ' It is playing now, so the music stops.'
      : (loShuWalkMode || !playOrderIsLibrary) && playlist.some((s: Song) => s.id === pendingDelete.id)
        ? " It also comes out of the list that's playing."
        : '';
  // v15.7: the Library tab's tests read the play order's exact state through this hook (dev builds only; production
  // strips it, as it does __aetheriaAnalyse).
  const libraryHookRef: { current: { walk: LoShuWalkMode | null; segments: number[] | null; phases: string[] | null; steps: number[] | null; playing: boolean } } =
    useRef({ walk: null, segments: null, phases: null, steps: null, playing: false });
  if (IS_DEV_BUILD) libraryHookRef.current = { walk: loShuWalkMode, segments: loShuWalkSegments, phases: loShuWalkPhases, steps: loShuWalkSteps, playing: isPlaying };
  useEffect(() => {
    if (!IS_DEV_BUILD) return;
    const w = window as unknown as { __aetheriaLibrary?: unknown };
    w.__aetheriaLibrary = {
      state: () => {
        const s = stateRef.current;
        const h = libraryHookRef.current;
        const el = mainAudioRef.current;
        return {
          ids: s.playlist.map((x: Song) => x.id),
          names: s.playlist.map((x: Song) => x.name),
          cursor: s.currentSongIndex,
          current: s.currentSongIndex >= 0 ? (s.playlist[s.currentSongIndex]?.name ?? null) : null,
          shuffle: s.isShuffle,
          shuffled: s.shuffledIndices.slice(),
          shufflePos: s.shufflePos,
          walk: h.walk,
          segments: h.segments,
          phases: h.phases,
          steps: h.steps,
          libraryIds: libraryRef.current.map((x: Song) => x.id),
          libraryNames: libraryRef.current.map((x: Song) => x.name),
          playing: h.playing,
          t: el && Number.isFinite(el.currentTime) ? el.currentTime : null,
          src: el ? el.getAttribute('src') : null,
          undo: lastPlayOrderRef.current ? lastPlayOrderRef.current.token : null,
          crystals: libraryRef.current.map((x: Song) => x.closestSolfeggio ?? null),
          scanned: libraryRef.current.map((x: Song) => !!x.harmonicFreq),
          origins: libraryRef.current.map((x: Song) => crystalOrigin(x)),
          durations: s.playlist.map((x: Song) => (typeof x.duration === 'number' ? x.duration : null)),
          libraryDurations: libraryRef.current.map((x: Song) => (typeof x.duration === 'number' ? x.duration : null)),
        };
      },
      /** The latest tap's Undo, as its toast's button does (for the negative halves once the toast is gone). */
      undo: () => shellActionsRef.current?.undoPlayOrder(),
    };
    return () => { delete w.__aetheriaLibrary; };
  }, []);
  // v16.0: the queue's tests drive it and read it through this hook (dev builds only; production strips it).
  useEffect(() => {
    if (!IS_DEV_BUILD) return;
    const w = window as unknown as { __aetheriaQueue?: unknown };
    w.__aetheriaQueue = {
      add: (ids: string[], mode: 'next' | 'queue') => queueApiRef.current?.queueTracks(ids, mode),
      edit: (op: unknown) => queueApiRef.current?.editQueue(op as any),
      undo: () => queueApiRef.current?.undoQueue(),
      state: () => {
        const s = stateRef.current;
        const q = queueMirrorRef.current;
        const st = queuePlayState();
        const marks = q.playlist === s.playlist ? q.marks : null;
        const name = (i: number) => s.playlist[i]?.name ?? null;
        const up = st && shuffleValid(st) ? upcoming(st, s.isLoop) : null;
        const a = st ? anchorFor(st, s.isLoop, queueStart()) : null;
        return {
          marks,
          waiting: waitingIndices({ marks }),
          waitingNames: waitingIndices({ marks }).map(name),
          upcoming: up ? { queued: up.queued.map(name), more: up.more, next: up.next.map(name), end: up.end } : null,
          anchor: a ? ('wait' in a ? 'wait' : a) : null,
          pending: queuePendingRef.current.length,
          undo: queueUndoRef.current ? queueUndoRef.current.token : null,
          playingId: queueStart().playingId,
          aligned: q.playlist === s.playlist,
        };
      },
    };
    return () => { delete w.__aetheriaQueue; };
  }, []);
  const shellValue = useMemo(
    () => ({
      tab: shellTab,
      sheet: shellSheet,
      sheetFocus,
      peek: classicPeek,
      car: carLayout,
      phoneShell: !desktopShell,
      headerRef,
      barRef: playerBarRef,
      zen: { on: shellZen, hidden: shellZenHidden },
      rootRef: shellRootRef,
      layersScrollRef,
      libraryViewRef,
    }),
    [shellTab, shellSheet, sheetFocus, classicPeek, carLayout, desktopShell, shellZen, shellZenHidden]
  );
  // The stable actions: App's latest functions, refreshed after every commit; references, never re-implementations
  // (the pinned handlers stay the only path to the music).
  const shellActionsRef: { current: any } = useRef(null);
  useLayoutEffect(() => {
    shellActionsRef.current = {
      handlePlayPause,
      handleNext,
      handlePrev,
      pausePlayback,
      stopLayersNow,
      selectFrequency,
      generateLoShuWalk,
      startMix,
      clearLoShuWalkMode,
      chooseLayerOutput,
      toggleMusicOnly,
      toggleKeyFit,
      chooseToneLevel,
      showCurrentTrackAnalysis,
      stopRecording,
      setLayout,
      peekClassic,
      seekTo,
      seekBy,
      trackRawHz: shellTrackRawHz,
      v2Active,
      chooseCrystalFilter,
      revealZen: shellZenState.reveal,
      // v15.7, the Library tab.
      playFromLibrary,
      undoPlayOrder,
      requestDelete,
      autoDistribute,
      onAnalyseTap,
      scanLibrary,
      handleFileUpload,
      recoverOrphans,
      discardOrphans,
      // v16.0, the queue.
      queueTracks,
      editQueue,
      undoQueue,
    };
  });
  const shellActions = useMemo(() => {
    const A = () => shellActionsRef.current;
    return {
      playPause: () => A().handlePlayPause(),
      next: () => A().handleNext(),
      prev: () => A().handlePrev(),
      seekTo: (f: number) => A().seekTo(f),
      seekBy: (s: number) => A().seekBy(s),
      toggleShuffle: () => setIsShuffle((v: boolean) => !v),
      toggleRepeat: () => setIsLoop((v: boolean) => !v),
      selectCrystal: (raw: number) => A().selectFrequency(raw),
      backToTrackCrystal: () => {
        const raw = A().trackRawHz;
        if (raw) A().selectFrequency(raw);
      },
      setPerfectGut: (on: boolean) => setLoShuPerfectGUT(on),
      startWalk: (mode: LoShuWalkMode) => A().generateLoShuWalk(mode),
      // v15.9, the Mixes tab.
      startMix: (id: MixId) => A().startMix(id),
      clearWalk: () => A().clearLoShuWalkMode(),
      chooseOutput: (o: LayerOutput) => A().chooseLayerOutput(o),
      toggleMusicOnly: () => A().toggleMusicOnly(),
      toggleKeyFit: () => A().toggleKeyFit(),
      setVolume: (v: number) => setVolume(v),
      setToneLevel: (v: number) => A().chooseToneLevel(A().v2Active ? 'v2' : 'classic', v),
      setBeatLevel: (v: number) => setBinauralVolume(v),
      // Emergency Stop's body: under v2 the layers fall in 0.1 s, then the music, the anchor and the tone stop.
      stopAll: () => {
        A().stopLayersNow(0.1);
        A().pausePlayback();
      },
      // The menu closes first, so the readout Dialog never sits on a Sheet.
      trackInfo: () => {
        setShellSheet(null);
        setSheetFocus(null);
        A().showCurrentTrackAnalysis();
      },
      stopRecording: () => A().stopRecording(),
      setTab: (t: ShellTab) => {
        setShellTab(t);
        setShellSheet(null);
        setSheetFocus(null);
      },
      openSheet: (s: ShellSheet, focus?: 'output' | null) => {
        setSheetFocus(focus ?? null);
        setShellSheet(s);
      },
      closeSheet: () => {
        setShellSheet(null);
        setSheetFocus(null);
      },
      setLayout: (l: LayoutPref) => A().setLayout(l),
      peekClassic: (p: PeekPanel) => A().peekClassic(p),
      // v15.6, the Layers tab: App's own setters.
      setAdaptive: (on: boolean) => setIsAdaptiveBinaural(on),
      // Classic's band row: the preset, and Adaptive off.
      choosePreset: (name: string) => {
        const preset = BINAURAL_PRESETS.find((p) => p.name === name);
        if (!preset) return;
        setSelectedBinaural(preset);
        setIsAdaptiveBinaural(false);
      },
      setPhiMode: (on: boolean) => setEnablePhiMode(on),
      setPhiTiming: (on: boolean) => setPhiTimingEnabled(on),
      setExperienceLevel: (l: 'beginner' | 'intermediate' | 'advanced' | 'expert') => setUserExperienceLevel(l),
      setCrystalFilter: (on: boolean) => A().chooseCrystalFilter(on),
      openLayers: (section?: LayersSection) => {
        layersScrollRef.current = { top: 0, jump: section ?? 'sound' };
        setShellTab('layers');
        setShellSheet(null);
        setSheetFocus(null);
      },
      // v15.6, Zen in the new layout.
      setZen: (on: boolean) => setShellZen(on),
      revealZen: () => A().revealZen(),
      // v15.7, the Library tab: references to App's functions (the row tap and its Undo, the existing delete, Auto-
      // Distribute, Analyse tracks, Deep Scan, the import handler and the orphan offer). None writes the library itself
      // but the existing paths that already do.
      playFromLibrary: (id: string, orderIds: readonly string[] | null) => A().playFromLibrary(id, orderIds),
      undoPlayOrder: () => A().undoPlayOrder(),
      requestDelete: (id: string) => A().requestDelete(id),
      assignCrystals: () => A().autoDistribute(),
      analyse: () => A().onAnalyseTap(),
      scan: () => A().scanLibrary(),
      scanAssigned: () => A().scanLibrary({ includeAssigned: true }),
      stopScan: () => (window as any).cancelAetheriaAnalysis?.(),
      importFiles: (event: React.ChangeEvent<HTMLInputElement>) => A().handleFileUpload(event),
      recoverOrphans: () => A().recoverOrphans(),
      discardOrphans: () => A().discardOrphans(),
      openImport: (focus?: 'recover' | null) => {
        setSheetFocus(focus ?? null);
        setShellSheet('import');
      },
      setLibraryFocusTarget: (el: HTMLElement | null) => {
        libraryFocusTargetRef.current = el;
      },
      // v16.0, the queue: references to App's queue functions (its one writer, commitQueue; never the library).
      queueTracks: (ids: readonly string[], mode: 'next' | 'queue') => A().queueTracks(ids, mode),
      editQueue: (op: QueueEdit) => A().editQueue(op),
      undoQueue: () => A().undoQueue(),
      toggleQueue: () => {
        setSheetFocus(null);
        setShellSheet((s: ShellSheet | null) => (s === 'queue' ? null : 'queue'));
      },
    };
  }, []);

  return (
    <div
      onClick={uiHidden ? (e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) zenRevealRef.current?.(); } : undefined}
      className={`relative min-h-screen bg-black text-slate-200 font-sans overflow-hidden ${isFullScreen ? 'h-screen' : ''}`}
    >
      {/* Zen Mode, UI hidden (v15.4): the hidden UI is inert, so this is what a keyboard or a screen reader finds. */}
      {uiHidden && (
        <button
          type="button"
          onClick={() => zenRevealRef.current?.()}
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-toast focus:px-4 focus:min-h-touch focus:rounded-control focus:bg-surface-panel focus:text-ink"
        >
          Show controls
        </button>
      )}
      
      {/* Disclaimer Modal. Its wording is versioned: change DISCLAIMER_VERSION
          (above App) with any wording change, or it won't show again. */}
      {!disclaimerAccepted && (
        <div data-testid="disclaimer" className="fixed inset-0 z-[150] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-500">
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
                <p className="ml-6">Contains binaural beats, solfeggio frequencies, and sustained low-frequency tones. Beats and the drone are for when you can relax. While driving, use Car output (only the music and a quiet tone) and your car&#39;s own controls. Do not use while operating heavy machinery. Start at low volume — audio at sustained high levels can damage hearing. Take regular breaks during extended listening sessions.</p>
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
          {/* v15.4 isolation: each region of the layout renders under its own error boundary (components/
              ErrorBoundary.tsx), its JSX deferred into `render` so every expression in it runs under that boundary
              (App's own inline JSX would be evaluated above it). A crash shows the region's fallback; the music,
              owned by App's refs, plays on. The disclaimer has none: it is a gate, and the root covers it. */}
          <ViewBoundary
            name="tutorial"
            fallback={modalFallback(showTutorial, closeTutorial, 'fixed inset-0 z-tutorial flex items-center justify-center p-4')}
            render={() => showTutorial && <TutorialModal onClose={closeTutorial} />}
          />
          
          <ViewBoundary
            name="notices"
            fallback={(api) => (
              <>
                <div role="status" aria-live="polite" aria-atomic="false" />
                {panelFallback('fixed bottom-40 left-1/2 -translate-x-1/2 z-toast w-[calc(100%-2rem)] max-w-md', 'Notices hit a problem.')(api)}
              </>
            )}
            render={() => (
          <>
          {/* Offline Indicator */}
          <OfflineIndicator showWhenOnline={true} />

          {/* Restore toast — brief confirmation that the cached library is back. */}
          {isRestoring && restoredCount > 0 && (
            <div
              className={
                !shellOn
                  ? "fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-emerald-900/90 border border-emerald-500/30 text-emerald-200 text-xs px-4 py-2 rounded-full backdrop-blur shadow-lg"
                  : desktopShell
                    ? 'fixed right-4 z-50 bg-emerald-900/90 border border-emerald-500/30 text-emerald-200 text-xs px-4 py-2 rounded-full shadow-lg'
                    : 'fixed left-1/2 -translate-x-1/2 z-50 bg-emerald-900/90 border border-emerald-500/30 text-emerald-200 text-xs px-4 py-2 rounded-full shadow-lg'
              }
              style={shellOn ? shellNoticeStyle : undefined}
            >
              ✓ Restored {restoredCount} tracks from cache
            </div>
          )}

          {/* Non-blocking notices — the replacement for alert()/confirm() on
              paths the lock screen or the car can reach. Three independent
              slots so none evicts another: the update banner, the recovery
              offer, and the status toast. Sits above the restore toast.
              The container is the live region and is ALWAYS mounted (empty, it
              takes no space): screen readers often skip a live region that is
              inserted together with its text, but announce what is added to
              one that is already there. Not atomic (role=status alone would
              make it so, re-reading every notice on each change); each card
              is atomic, so a change reads just that card. */}
          <div
            role="status"
            aria-live="polite"
            aria-atomic="false"
            className={
              !shellOn
                ? "fixed bottom-40 left-1/2 -translate-x-1/2 z-[70] w-[calc(100%-2rem)] max-w-md flex flex-col gap-2"
                : desktopShell
                  ? 'fixed right-4 z-[70] w-[calc(100%-2rem)] max-w-md flex flex-col gap-2'
                  : 'fixed left-1/2 -translate-x-1/2 z-[70] w-[calc(100%-2rem)] max-w-md flex flex-col gap-2'
            }
            style={shellOn ? shellNoticeStyle : undefined}
            data-testid={shellOn ? 'notices' : undefined}
          >
              {updateReady && (
                <div aria-atomic="true" className="flex items-center gap-3 bg-slate-900/95 border border-gold-500/40 text-slate-100 text-sm px-4 py-3 rounded-xl shadow-lg">
                  <span className="flex-1 leading-snug">{(isPlaying || isSolfeggioActive) ? 'A new version of Aetheria is ready. Reloading stops the music.' : 'A new version of Aetheria is ready.'}</span>
                  <button
                    onClick={flushAndReload}
                    className="shrink-0 min-h-[44px] px-3 rounded-lg bg-gold-500 hover:bg-gold-400 text-black text-xs font-bold transition-colors"
                  >
                    Reload
                  </button>
                  <button
                    onClick={() => setUpdateReady(false)}
                    aria-label="Dismiss update notice"
                    className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              {!orphanBannerHidden && orphanSplit && orphanSplit.fresh.length + orphanSplit.duplicates.length > 0 && (
                <div aria-atomic="true" className="flex flex-col gap-2 bg-slate-900/95 border border-emerald-500/40 text-slate-100 text-sm px-4 py-3 rounded-xl shadow-lg">
                  <span className="leading-snug">
                    {orphanSplit.fresh.length > 0
                      ? `Found ${orphanSplit.fresh.length} stored track${orphanSplit.fresh.length === 1 ? '' : 's'} that ${orphanSplit.fresh.length === 1 ? 'is' : 'are'} not in your library.`
                      : `Found ${orphanSplit.duplicates.length} stored cop${orphanSplit.duplicates.length === 1 ? 'y' : 'ies'} of tracks already in your library.`}
                    {orphanSplit.fresh.length > 0 && orphanSplit.duplicates.length > 0 &&
                      ` ${orphanSplit.duplicates.length} more ${orphanSplit.duplicates.length === 1 ? 'is a copy' : 'are copies'} of tracks you have and will be removed.`}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={recoverOrphans}
                      aria-disabled={orphanBusy}
                      className={`min-h-[44px] px-3 rounded-lg bg-emerald-500 text-black text-xs font-bold transition-colors ${orphanBusy ? 'opacity-60' : 'hover:bg-emerald-400'}`}
                    >
                      {orphanBusy
                        ? 'One moment…'
                        : orphanSplit.fresh.length > 0 ? `Recover ${orphanSplit.fresh.length}` : 'Remove copies'}
                    </button>
                    {orphanSplit.fresh.length > 0 && (
                      <button
                        onClick={discardOrphans}
                        aria-disabled={orphanBusy}
                        className={`min-h-[44px] px-3 rounded-lg border text-xs font-bold transition-colors ${discardArmed ? 'border-red-500/60 text-red-300 bg-red-900/30' : 'border-slate-600 text-slate-300 hover:border-slate-400'} ${orphanBusy ? 'opacity-60' : ''}`}
                      >
                        {discardArmed ? 'Tap again to delete them' : 'Discard'}
                      </button>
                    )}
                    <button
                      onClick={() => { setOrphanBannerHidden(true); setDiscardArmed(false); }}
                      aria-label="Not now"
                      className="ml-auto min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              )}
              {statusToast && (
                <div aria-atomic="true" className="flex items-center gap-3 bg-slate-900/95 border border-slate-600 text-slate-100 text-sm px-4 py-3 rounded-xl shadow-lg">
                  <span className="flex-1 leading-snug">{statusToast.message}</span>
                  {statusToast.actionLabel && statusToast.onAction && (
                    <button
                      onClick={statusToast.onAction}
                      className="shrink-0 min-h-[44px] px-3 rounded-lg bg-gold-500 hover:bg-gold-400 text-black text-xs font-bold transition-colors"
                    >
                      {statusToast.actionLabel}
                    </button>
                  )}
                  <button
                    onClick={dismissStatusToast}
                    aria-label="Dismiss"
                    className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
          </div>

          {/* v15.4: the readouts (and the long notices' Details), and the row Delete's confirmation. Modal, in a
              portal on <body>; #root is inert while one is open (components/ui/overlayStack.ts). */}
          <Dialog
            open={!!infoDialog}
            title={infoDialog?.title ?? ''}
            preformatted
            onClose={() => setInfoDialog(null)}
            actions={<ReadoutActions body={infoDialog?.body ?? ''} onClose={() => setInfoDialog(null)} />}
            data-testid="readout-dialog"
          >
            {infoDialog?.body}
          </Dialog>
          <Dialog
            open={!!pendingDelete}
            role="alertdialog"
            title="Delete this track?"
            onClose={() => setPendingDelete(null)}
            initialFocusRef={deleteCancelRef}
            returnFocusFallback={shellOn ? libraryFocusTargetRef.current : undefined}
            data-testid="delete-dialog"
            actions={
              <>
                <Button variant="secondary" buttonRef={deleteCancelRef} onClick={() => setPendingDelete(null)}>Cancel</Button>
                <Button variant="danger" onClick={confirmPendingDelete}>Delete</Button>
              </>
            }
          >
            {`"${pendingDelete?.name ?? ''}" will be removed from your library, and the copy stored on this device deleted. The original file is not touched.${deleteNote}`}
          </Dialog>

          {/* v2's output question (v14.9): a non-blocking sheet, v2 only, between the header and the player bar
              (uiInsets, as the Spectrum lens), so the transport stays usable while it is open (v15.0). */}
          <OutputSheet open={showOutputSheet} insets={uiInsets} onChoose={chooseLayerOutput} onLater={outputSheetLater} />

          {/* Analysis Notification (v15.7: classic only; the new layout routes it, below) */}
          {analysisNotification && !shellOn && (
            <div className={shellOn && desktopShell ? 'fixed top-4 right-4 z-[100] max-w-lg' : "fixed top-20 left-1/2 transform -translate-x-1/2 z-[100] max-w-lg"}>
              <div className={shellOn ? 'bg-blue-900/90 border border-blue-500 text-blue-100 p-4 rounded-lg shadow-lg' : "bg-blue-900/90 border border-blue-500 text-blue-100 p-4 rounded-lg shadow-lg backdrop-blur-md"}>
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
                    aria-label="Dismiss"
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
            <div className={shellOn && desktopShell ? 'fixed top-4 right-4 z-[101] w-[90%] max-w-lg px-2' : "fixed top-20 left-1/2 transform -translate-x-1/2 z-[101] w-[90%] max-w-lg px-2"}>
              <button
                type="button"
                aria-label="Dismiss offline-ready notice"
                onClick={() => setOfflineReadyNotice(null)}
                className={shellOn ? 'w-full text-left bg-emerald-900/90 border border-emerald-500 text-emerald-100 p-4 rounded-lg shadow-lg active:scale-[0.99] transition-transform' : "w-full text-left bg-emerald-900/90 border border-emerald-500 text-emerald-100 p-4 rounded-lg shadow-lg backdrop-blur-md active:scale-[0.99] transition-transform"}
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
          </>
            )}
          />

      <div className="absolute inset-0 z-0 pointer-events-none">
        {/* v15.5's heat guard, in both layouts so the Visualizer's place in the tree (and so the Visualizer) never
            changes: paused only while a solid screen of the new layout's phone shell covers it. */}
        <VisualsPause paused={visualsPaused}>
        <ViewBoundary
          name="visualizer"
          fallback={(api) => (
            <VisualsStoppedPill onRetry={api.retry} onClose={api.dismiss} buttonRef={api.buttonRef} switchedOff={api.switchedOff} />
          )}
          render={() => (
        <Visualizer
            analyser={analyserNode}
            primaryColor={getCurrentChakraColor()}
            isPlaying={isPlaying}
            binauralDelta={selectedBinaural.delta}
            selectedFrequency={selectedSolfeggio}
            settings={vizSettings}
            frequencyColorMode={frequencyColorMode}
            loShuWalkMode={loShuWalkMode}
            loShuWalkStep={loShuWalkMode ? cubeStep(loShuWalkSteps, currentSongIndex) : -1}
            bandEnvelope={currentSongIndex >= 0 ? (playlist[currentSongIndex]?.bandEnvelope ?? playlist[currentSongIndex]?.visualEnvelope ?? null) : null}
            audioElementRef={mainAudioRef}
            uiInsets={uiInsets}
        />
          )}
        />
        </VisualsPause>
      </div>

      {/* v15.5: the layout branch. The new layout (opt-in beta) or, by default and during a stub's peek, the classic UI
          below, byte for byte. Only this subtree swaps: the Visualizer above, the shared regions and every audio ref
          stay, so a switch never pauses the music or remounts the canvas. */}
      {shellOn ? (
        <ShellProviders
          actions={shellActions}
          shell={shellValue}
          player={shellPlayer}
          sound={shellSound}
          levels={shellLevels}
          tuning={shellTuning}
          library={shellLibrary}
          walk={shellWalk}
          time={shellTime}
          libraryList={shellLibraryList}
          libraryStatus={shellLibraryStatus}
          queue={shellQueue}
        >
          <AppShell />
        </ShellProviders>
      ) : (
      <div
        inert={uiHidden}
        ref={zenLayerRef}
        className={`relative z-10 flex flex-col h-screen transition-opacity duration-1000 ${(!isZenMode || zenUiVisible) ? 'opacity-100' : 'opacity-0'} ${isZenMode ? '' : 'bg-black/20'}`}
      >
        
        <ViewBoundary
          name="header"
          onReset={bumpInsets}
          fallback={panelFallback(null, 'The top bar hit a problem.', 'bar')}
          render={() => (
        <header ref={headerRef} className="flex justify-between items-center p-3 md:p-4 border-b border-slate-800/50 bg-black/80 backdrop-blur-md z-30 shadow-lg safe-area-top shrink-0">
          <div className="flex items-center gap-2">
             <button onClick={() => setShowSidebar(!showSidebar)} aria-label="Library" className="text-gold-500 mr-2 p-1 hover:bg-slate-800 rounded">
               <Menu />
             </button>
            <div className="w-8 h-8 rounded-full bg-gold-500 animate-pulse-slow flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.5)]">
              <Activity className="text-slate-950 w-5 h-5" />
            </div>
            <h1 className="text-xl md:text-2xl font-serif text-gold-400 tracking-wider">AETHERIA <span className="text-[10px] text-slate-500 ml-2">v16.0</span></h1>
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
                    aria-label="Record"
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
                title="Harmonic Control"
                aria-label="Harmonic Control"
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
            <button onClick={() => setShowTutorial(true)} aria-label="Quick guide" className="p-1.5 sm:p-2 hover:text-gold-400 transition-colors bg-slate-900/50 rounded-full border border-slate-800"><CircleHelp size={20} /></button>
            <button onClick={() => setIsFullScreen(!isFullScreen)} aria-label={isFullScreen ? 'Show library' : 'Hide library'} className="p-1.5 sm:p-2 hover:text-gold-400 transition-colors bg-slate-900/50 rounded-full border border-slate-800 hidden sm:block">
              {isFullScreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
            </button>
          </div>
        </header>
          )}
        />

        <main className="flex-1 flex overflow-hidden relative">
          
          {/* Recording Options Modal */}
          <ViewBoundary
            name="record"
            fallback={modalFallback(showRecordOptions, () => setShowRecordOptions(false), 'fixed inset-0 z-modal flex items-center justify-center p-4')}
            render={() => showRecordOptions && (
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
          />
          
          {/* Info Modal */}
          <ViewBoundary
            name="guidebook"
            fallback={modalFallback(showInfo, () => setShowInfo(false), 'fixed inset-0 z-notice flex items-center justify-center p-4')}
            render={() => showInfo && (
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
                              <button onClick={() => setShowInfo(false)} aria-label="Close" className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
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
          />

          <ViewBoundary
            name="library"
            // A reloaded list starts at the top: recompute the rows it draws (its range was the old scroll's).
            onReset={recomputeSongListRange}
            fallback={panelFallback(
              `absolute inset-y-0 left-0 w-[85%] sm:w-80 md:relative z-[60] p-4 transition-transform duration-300 ${showSidebar ? 'translate-x-0' : '-translate-x-full'} ${isFullScreen ? 'md:-ml-80' : ''}`,
              'Your library list hit a problem. Your tracks and their stored audio are safe.'
            )}
            render={() => (
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
                   <label className="flex items-center justify-center gap-2 p-3 border border-slate-700 rounded-lg cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all active:scale-95 group text-xs">
                      <Upload size={16} className="group-hover:animate-bounce" />
                      <span className="font-semibold">Import Folder</span>
                      <input
                        type="file"
                        aria-label="Import folder"
                        {...({ webkitdirectory: "", directory: "" } as any)}
                        multiple
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                   </label>
                   
                   <label className="flex items-center justify-center gap-2 p-3 border border-slate-700 rounded-lg cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all active:scale-95 text-xs">
                      <FilePlus size={16} />
                      <span className="font-semibold">Add Files</span>
                      <input
                        type="file"
                        aria-label="Add files"
                        multiple
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                   </label>
               </div>
               
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
                           aria-label="Clear search"
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
               {/* v15.3: no gold fill. Its gold 900 and 800 background classes rendered nothing until the full gold scale
                   (tailwind.config.js) arrived, and the button stays exactly as it always looked (the user's decision). */}
               <button
                aria-disabled={isScanning}
                title={isScanning ? 'Unavailable while Deep Scan runs' : undefined}
                onClick={autoDistribute}
                className={`mb-3 w-full flex items-center justify-center gap-2 text-xs py-2 rounded-lg font-medium tracking-wide transition-all border border-gold-500/30 ${isScanning ? 'opacity-40 cursor-not-allowed' : 'active:scale-95 hover:border-gold-500/50'}`}
               >
                 <Target size={14} className="text-gold-400" />
                 <span className="text-gold-400 font-bold">Auto-Distribute Frequencies</span>
               </button>

               {/* Analyse tracks (v15.1): key data and visual sync, for both engines. Its refusals all live in
                   startAnalysePass, so a tap on a blocked button explains itself (aria-disabled, not disabled). */}
               {originalPlaylist.length > 0 && (() => {
                 const t = passButtonText(pass, analyseCounts, { deepScan: isScanning, restoring: isRestoring, mobile: ANALYSE_MOBILE });
                 const running = pass.phase !== 'idle';
                 return (
                   <button
                     data-testid="analyse-tracks"
                     aria-disabled={t.blocked || undefined}
                     title={t.blocked ? t.sub : undefined}
                     onClick={onAnalyseTap}
                     className={`mb-3 w-full flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg border text-xs font-medium tracking-wide transition-all ${
                       t.blocked ? 'opacity-40 cursor-not-allowed bg-slate-900 border-slate-800 text-slate-400'
                       : running ? 'bg-sky-900/20 border-sky-500/40 text-sky-300 active:scale-95'
                       : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600 active:scale-95'}`}
                   >
                     <span className="flex items-center gap-2"><Music size={14} /><span className="font-bold">{t.title}</span></span>
                     <span className="text-[10px] text-slate-400">{t.sub}</span>
                   </button>
                 );
               })()}

               {/* Tools Section */}
               <div className="grid grid-cols-2 gap-2">
                   <button
                    aria-disabled={pass.phase !== 'idle' || undefined}
                    onClick={isScanning ? () => {
                      if ((window as any).cancelAetheriaAnalysis) {
                        (window as any).cancelAetheriaAnalysis();
                      }
                    } : scanLibrary}
                    className={`flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border transition-all active:scale-95 ${
                      isScanning
                        ? 'bg-blue-900/30 border-blue-500 text-blue-400 animate-pulse hover:bg-red-900/30 hover:border-red-500 hover:text-red-400'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-600'
                    }${pass.phase !== 'idle' ? ' opacity-40' : ''}`}
                    title={pass.phase !== 'idle' ? 'Unavailable while Analyse tracks runs' : isScanning ? 'Click to cancel deep analysis' : 'Start deep fractal analysis (slow but thorough)'}
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
                    onClick={() => generateFrequencyPlaylist([174, 285, 396, 417], 'Grounding')}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-red-400 hover:border-red-500 transition-all active:scale-95"
                   >
                     <Flame size={16} className="mb-1 text-red-500" />
                     <span>Grounding</span>
                     <span className="text-[8px] text-slate-500">174·285·396·417</span>
                   </button>

                   <button 
                    onClick={generateWellnessPlaylist}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-emerald-400 hover:border-emerald-500 transition-all active:scale-95"
                   >
                     <Heart size={16} className="mb-1 text-emerald-500" />
                     <span>Stillness</span>
                     <span className="text-[8px] text-slate-500">174·285·528</span>
                   </button>

                   <button 
                    onClick={generateMoodPlaylist}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-pink-400 hover:border-pink-500 transition-all active:scale-95"
                   >
                     <Smile size={16} className="mb-1 text-pink-500" />
                     <span>Uplift</span>
                     <span className="text-[8px] text-slate-500">396·417·639</span>
                   </button>

                   <button 
                    onClick={generateMeditationPlaylist}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-purple-400 hover:border-purple-500 transition-all active:scale-95"
                   >
                     <Moon size={16} className="mb-1 text-purple-500" />
                     <span>Meditation</span>
                     <span className="text-[8px] text-slate-500">741·852·963</span>
                   </button>

                   <button 
                    onClick={() => generateFrequencyPlaylist([285, 417, 528, 639, 741], 'Flow')}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-cyan-400 hover:border-cyan-500 transition-all active:scale-95"
                   >
                     <Waves size={16} className="mb-1 text-cyan-500" />
                     <span>Flow</span>
                     <span className="text-[8px] text-slate-500">285·417·528·639·741</span>
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
              {playlist.length === 0 && originalPlaylist.length === 0 && (
                <div className="flex flex-col items-center justify-center h-48 text-center text-slate-600 p-6">
                  <p>Library Empty</p>
                  <p className="text-xs mt-2">Upload a folder or add files to begin.</p>
                </div>
              )}
              {playlist.length === 0 && originalPlaylist.length > 0 && (
                <div className="flex flex-col items-center justify-center h-48 text-center text-slate-500 p-6">
                  <p>This list is empty</p>
                  <p className="text-xs mt-2">
                    Your library still has {new Set(originalPlaylist.map(s => s.id)).size} tracks.
                  </p>
                  <button
                    onClick={restoreLibrary}
                    className="mt-3 min-h-[44px] px-4 rounded-lg border border-gold-500/40 text-gold-400 hover:bg-gold-500/10 text-xs font-bold"
                  >
                    Show library
                  </button>
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
                      onClick={() => { const before = playRequestSeqRef.current; playTrack(actualIdx); noteQueueStart(before, actualIdx, stateRef.current.playlist); if(window.innerWidth < 768) setShowSidebar(false); }}
                    >
                        <div className="flex justify-between">
                            <span className="truncate font-medium">{song.name}</span>
                            <div className="flex gap-1">
                              {song.closestSolfeggio && (
                                <span className="text-[9px] px-1 rounded bg-slate-800 text-gold-500 ml-2 h-fit">
                                  {song.closestSolfeggio}Hz
                                </span>
                              )}
                              {song.musicKey ? (
                                <span className="text-[8px] px-1 rounded bg-slate-800 text-slate-300 h-fit" title={`Key ${song.musicKey} (confidence ${(song.keyConfidence ?? 0).toFixed(2)})`}>
                                  {song.musicKey}
                                </span>
                              ) : null}
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
                        // v15.4: the app's own confirmation (decision 1), never a page-freezing confirm().
                        setPendingDelete({ id: song.id, name: song.name });
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                      title="Delete song"
                      aria-label="Delete track"
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
                <span className="text-gold-500/80">{getTotalDuration()} Total</span>
            </div>
            {/* Clear Playlist & Cache — deliberately below the footer (in the
                reserved bottom margin) so it needs a scroll-down-and-tap and is
                never hit by accident. Two-tap confirm handled in the component. */}
            {storedTrackCount > 0 && (
              <div className="px-6 pb-6 pt-2 bg-black/95 shrink-0 -mt-20 mb-0 z-10">
                <ClearPlaylistButton
                  onClear={clearEntirePlaylist}
                  libraryCount={storedTrackCount}
                />
              </div>
            )}
          </aside>
            )}
          />

          <ViewBoundary
            name="harmonic"
            fallback={modalFallback(showSettings, () => setShowSettings(false), 'absolute inset-y-0 right-0 z-header w-full md:w-96 p-4')}
            render={() => showSettings && (
            <div className="absolute inset-y-0 right-0 z-30 w-full md:w-96 bg-black/95 backdrop-blur-xl border-l border-slate-800 flex flex-col shadow-2xl transform transition-transform animate-in slide-in-from-right duration-300">
                <div className="flex justify-between items-start p-6 border-b border-slate-800">
                  <h3 className="text-gold-500 font-serif text-xl">Harmonic Control</h3>
                  {/* v15.5: the new layout's opt-in (decision 3, option A): a 40 px pill beside Close (a 44 px target
                      through its ::after box); the header row keeps its 89 px. "New layout" under 380 px wide. */}
                  <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setLayout('new')}
                    data-testid="try-new-layout"
                    className="relative h-10 px-3 rounded-pill border border-gold-500/40 bg-gold-500/10 hover:bg-gold-500/20 text-xs font-semibold text-gold-300 whitespace-nowrap transition-colors after:absolute after:-inset-y-0.5 after:inset-x-0 after:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
                  >
                    <span className="hidden min-[380px]:inline">Try the new layout</span>
                    <span className="min-[380px]:hidden">New layout</span>
                  </button>
                  <button onClick={() => { setShowSettings(false); }} aria-label="Close" className="p-2 hover:bg-slate-800 rounded-full"><X className="text-slate-500 hover:text-white" /></button>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar pb-32">

                   {/* Music only (v14.6, the same switch) and the layer sound A/B (v14.9). */}
                   <LayerSoundPanel variant="panel" {...layerPanelProps} />
                   {/* Key fit (v15.2), v2 only. */}
                   {v2Active && <KeyFitRow on={keyFitOn} status={keyFitRowLine} onToggle={toggleKeyFit} />}

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
                                      <span>{v2Active ? PHI_LEVELS_V2 : <>Volume Ratios: 1.0 : {INV_PHI.toFixed(3)} : {INV_PHI_SQUARED.toFixed(3)}</>}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                      <div className="w-2 h-2 rounded-full bg-purple-400"></div>
                                      <span>{v2Active ? PHI_BINAURAL_V2 : 'Binaural Phase: 137.5° golden angle offset'}</span>
                                  </div>
                                  <div className="flex items-center gap-2 justify-between">
                                      <div className="flex items-center gap-2">
                                          <div className="w-2 h-2 rounded-full bg-purple-400"></div>
                                          <span>Track Timing: Phi-proportioned</span>
                                      </div>
                                      <button 
                                          onClick={() => setPhiTimingEnabled(!phiTimingEnabled)}
                                          role="switch"
                                          aria-checked={phiTimingEnabled}
                                          aria-label="Track Timing: Phi-proportioned"
                                          className={`w-8 h-4 rounded-full relative transition-colors ${phiTimingEnabled ? 'bg-purple-500' : 'bg-slate-700'}`}
                                      >
                                          <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${phiTimingEnabled ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                      </button>
                                  </div>
                                  {v2Active && (
                                      <div className="pl-4 text-[10px] text-purple-300 leading-snug">{PHI_ENVELOPE_V2}</div>
                                  )}
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
                                        aria-label="Simulation speed"
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
                                        aria-label="Particle size"
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
                                        aria-label="Audio reactivity"
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
                                        aria-label="Hex visual mode"
                                        onChange={(e) => setVizSettings({...vizSettings, hexVisualMode: e.target.value as any})}
                                        className="w-full bg-slate-900 text-xs border border-slate-700 rounded px-2 py-1 text-slate-300"
                                    >
                                        <option value="pulse">Radial Pulse (Gentle)</option>
                                        <option value="spectrum">Spectrum Lens (Epic)</option>
                                        <option value="wave">Energy Wave (Flowing)</option>
                                    </select>
                                </div>

                                {/* Wandering hexes (v14.7): the off-colour hexes glide between cells. Saved.
                                  * The whole row is the switch (a 44 px tap target); dimmed, not
                                  * disabled, while the Hex Grid is off. */}
                                {(() => {
                                    const on = vizSettings.hexWander !== false;
                                    const status = prefersReducedMotion
                                        ? 'Held still: this device asks for reduced motion.'
                                        : !on
                                            ? 'Off-colour hexes stay in their original places.'
                                            : 'Off-colour hexes glide to a neighbouring cell every few seconds, faster when the music is busy.';
                                    return (
                                        <div className={`p-3 bg-slate-900 rounded-lg border border-slate-800 transition-opacity ${vizSettings.showHexagons ? '' : 'opacity-50'}`}>
                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={on}
                                                aria-labelledby="hex-wander-label"
                                                aria-describedby="hex-wander-status"
                                                onClick={() => setVizSettings({...vizSettings, hexWander: !on})}
                                                className="w-full min-h-11 flex items-center justify-between gap-3 text-left"
                                            >
                                                <span id="hex-wander-label" className="text-[10px] text-gold-400 font-bold uppercase tracking-wider flex items-center gap-2"><Hexagon size={12}/> Wandering hexes</span>
                                                <span aria-hidden="true" className={`w-8 h-4 shrink-0 rounded-full relative transition-colors ${on ? 'bg-gold-500' : 'bg-slate-700'}`}>
                                                    <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${on ? 'left-[18px]' : 'left-0.5'}`}></span>
                                                </span>
                                            </button>
                                            <p id="hex-wander-status" className="text-[11px] text-slate-400 mt-1">{status}</p>
                                        </div>
                                    );
                                })()}

                                {/* Frame rate (v14.7): Cooler caps the visualizer at ~20 fps. Saved. */}
                                <div>
                                    <div id="frame-rate-label" className="text-[10px] text-slate-400 mb-1 uppercase tracking-widest">Frame rate</div>
                                    <div role="group" aria-labelledby="frame-rate-label" className="grid grid-cols-2 gap-2">
                                        {([
                                            { rate: 'standard' as const, label: 'Standard · 30 fps' },
                                            { rate: 'cooler' as const, label: 'Cooler · ~20 fps' },
                                        ]).map(({ rate, label }) => {
                                            const on = (vizSettings.frameRate === 'cooler' ? 'cooler' : 'standard') === rate;
                                            return (
                                                <button
                                                    key={rate}
                                                    type="button"
                                                    aria-pressed={on}
                                                    aria-describedby="frame-rate-hint"
                                                    onClick={() => setVizSettings({...vizSettings, frameRate: rate})}
                                                    className={`text-xs py-2 min-h-11 rounded border transition-all ${on ? 'bg-gold-500/20 border-gold-500 text-gold-400' : 'bg-slate-900 border-slate-700 text-slate-400'}`}
                                                >
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <p id="frame-rate-hint" className="text-[11px] text-slate-400 mt-1">Cooler draws the visualizer at ~20 fps instead of 30: a little less smooth.</p>
                                </div>
                                
                                <div className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border border-slate-800 flex-wrap">
                                    <div className="flex items-center justify-between w-full">
                                        <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider flex items-center gap-2"><Droplets size={12}/> Hydro-Acoustics</span>
                                        <button 
                                            onClick={() => setVizSettings({...vizSettings, showWaterRipples: !vizSettings.showWaterRipples})}
                                            role="switch"
                                            aria-checked={vizSettings.showWaterRipples}
                                            aria-label="Hydro-Acoustics"
                                            className={`w-8 h-4 rounded-full relative transition-colors ${vizSettings.showWaterRipples ? 'bg-blue-500' : 'bg-slate-700'}`}
                                        >
                                            <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${vizSettings.showWaterRipples ? 'translate-x-4' : 'translate-x-0'}`}></div>
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
                                                aria-label="Ripple intensity"
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
                                        role="switch"
                                        aria-checked={vizSettings.showTreeOfLife}
                                        aria-label="Tree of Life"
                                        className={`w-8 h-4 rounded-full relative transition-colors ${vizSettings.showTreeOfLife ? 'bg-gold-500' : 'bg-slate-700'}`}
                                    >
                                        <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${vizSettings.showTreeOfLife ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                    </button>
                                </div>

                                <div className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] text-emerald-300 font-bold uppercase tracking-wider flex items-center gap-2"><Box size={12}/> Lo Shu Cube</span>
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, showLoShuCube: !vizSettings.showLoShuCube})}
                                            role="switch"
                                            aria-checked={vizSettings.showLoShuCube}
                                            aria-label="Lo Shu Cube"
                                            className={`w-8 h-4 rounded-full relative transition-colors ${vizSettings.showLoShuCube ? 'bg-emerald-500' : 'bg-slate-700'}`}
                                        >
                                            <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${vizSettings.showLoShuCube ? 'translate-x-4' : 'translate-x-0'}`}></div>
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
                                                    role="switch"
                                                    aria-checked={vizSettings.loShuCubeAutoRotate}
                                                    aria-label="Auto-Rotate"
                                                    className={`w-8 h-4 rounded-full relative transition-colors ${vizSettings.loShuCubeAutoRotate ? 'bg-emerald-500' : 'bg-slate-700'}`}
                                                    title={vizSettings.loShuCubeAutoRotate ? 'Stop turntable rotation' : 'Resume turntable rotation'}
                                                >
                                                    <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${vizSettings.loShuCubeAutoRotate ? 'translate-x-4' : 'translate-x-0'}`}></div>
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
                                                    aria-label="Lo Shu cube position"
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
                                                                role="switch"
                                                                aria-checked={on}
                                                                aria-label={label}
                                                                className={`w-8 h-4 rounded-full relative transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-700'}`}
                                                                title={on ? `Hide the ${label} walk path overlay` : `Show the ${label} walk path overlay`}
                                                            >
                                                                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`}></div>
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
                                            role="switch"
                                            aria-checked={vizSettings.morphEnabled}
                                            aria-label="Show Sacred Geometry"
                                            className={`w-8 h-4 rounded-full relative transition-colors ${vizSettings.morphEnabled ? 'bg-gold-500' : 'bg-slate-700'}`}
                                        >
                                            <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${vizSettings.morphEnabled ? 'translate-x-4' : 'translate-x-0'}`}></div>
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
                      {/* v15.9: 111 Hz, the labelled non-canonical exception (the plan's chip; the new layout has had it
                          since v15.6). The 111 Sequence no longer sets this tone, so this is where 111 Hz is reached. */}
                      <div className="mt-2 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => selectFrequency(111)}
                          aria-pressed={selectedSolfeggio === 111}
                          data-testid="classic-crystal-111"
                          className={`min-h-[44px] px-3 rounded-lg text-xs font-medium border border-dashed transition-all active:scale-95 ${selectedSolfeggio === 111 ? 'bg-gold-600 text-black border-gold-600' : 'border-slate-600 bg-slate-900 text-slate-300 hover:border-gold-500'}`}
                        >
                          111 Hz · non-canonical
                        </button>
                        <span className="text-[10px] text-slate-500">Not one of the 27 crystals.</span>
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
                    {v2Active ? (
                    // v2: the tone's level in dB re the validated −26 dB (v2's own level since v15.0; the slider stops at the cap).
                    <div className="mt-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
                      <div className="flex justify-between text-xs text-slate-400 mb-2">
                         <span id="v2-tone-level-label">{TONE_LEVEL_LABEL}</span>
                         <DbReadout id="v2-tone-level-readout" text={toneLevelText} />
                      </div>
                      <input
                        type="range"
                        min="0" max={V2_TONE_SLIDER_MAX} step={V2_TONE_SLIDER_STEP}
                        value={Math.min(solfeggioVolume, V2_TONE_SLIDER_MAX)}
                        onChange={(e) => chooseToneLevel('v2', parseFloat(e.target.value))}
                        aria-labelledby="v2-tone-level-label"
                        aria-valuetext={toneLevelText}
                        className="w-full accent-gold-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer touch-none"
                      />
                    </div>
                    ) : (
                    <div className="mt-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
                      <div className="flex justify-between text-xs text-slate-400 mb-2">
                         <span>Layer Intensity</span>
                         <span>{(solfeggioVolume * 100).toFixed(0)}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" max="1" step="0.01" 
                        value={solfeggioVolume}
                        aria-label="Layer intensity"
                        onChange={(e) => chooseToneLevel('classic', parseFloat(e.target.value))}
                        className="w-full accent-gold-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer touch-none"
                      />
                    </div>
                    )}
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
                    {v2Active && <p className="-mt-2 mb-3 text-[10px] text-slate-500 leading-snug">{HEADPHONES_HINT}</p>}

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
                                <span className="text-[10px] text-slate-400">{v2Active && p.name === 'Gamma' ? GAMMA_DESCRIPTION_V2 : p.description}</span>
                            </div>
                          </div>
                       ))}
                    </div>
                    {/* Car renders off (no beat, no pulse, no adaptive band), so it gets its own line. */}
                    {v2Active && <p className="mt-3 text-[10px] text-slate-400 leading-snug">{outputRender === 'off' ? PRESETS_NOTE_CAR_V2 : PRESETS_NOTE_V2}</p>}
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
                        aria-label="Experience level"
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
                        currentVolume={heardToneVolume}
                        // v2 reads its tone level in dB here too (its v15.0 default, 0.05 %, would print "0%"); classic keeps its percent.
                        currentVolumeText={v2Active && !musicOnly ? toneLevelText : undefined}
                        sessionDuration={sessionDuration}
                        isPlaying={isPlaying}
                        onSessionStart={(data) => {
                          console.log('Session started with data:', data);
                          // Start the experience tracking session
                          if (!currentEffectsSession) {
                            const sessionId = experienceTracker.startSession(
                              selectedSolfeggio,
                              heardToneVolume,
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
                              volume: heardToneVolume,
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
                          {v2Active && layer.f > 0
                            ? feltLineV2(selectedSolfeggio, toneOf(layer.f, planOutput))
                            : <>High frequency detected ({selectedSolfeggio}Hz). Focus on feeling rather than hearing.</>}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
            </div>
          )}
          />
          
          {/* Advanced Frequency Selector Modal */}
          <ViewBoundary
            name="frequency-lab"
            fallback={modalFallback(showFrequencySelector, () => setShowFrequencySelector(false), 'fixed inset-0 z-dialog flex items-center justify-center p-4')}
            render={() => showFrequencySelector && (
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
                    aria-label="Close"
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
          />
          
          {/* Safety Protocols Panel */}
          <ViewBoundary
            name="safety"
            fallback={modalFallback(showSafetyProtocols, () => setShowSafetyProtocols(false), 'fixed inset-0 z-scrim flex items-center justify-center p-4 pb-32')}
            render={() => showSafetyProtocols && (
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
                        aria-label="Your level"
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
                          {/* v2 reads its tone level in dB (its v15.0 default, 0.05 %, would round to "0%"); the Car fallback plays no layers. */}
                          <span className="text-white">{musicOnly || v2CarFallback ? 'Layers off' : v2Active ? toneLevelText : `${Math.round(solfeggioVolume * 100)}%`}</span>
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
                            <div>{v2Active ? KEEP_COMFORTABLE_V2 : '• Keep volume low (feeling vs hearing)'}</div>
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
                            // The same stop as Pause and the lock-screen pause:
                            // the music, the anchor and every layer (v14.6).
                            // Under v2 the layers fall in 0.1 s first (classic: no player, no call).
                            stopLayersNow(0.1);
                            pausePlayback();
                            setShowSafetyProtocols(false);
                          }}
                          className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded"
                        >
                          Emergency Stop
                        </button>
                        <button
                          onClick={() => {
                            setMusicOnly(true);
                            // Saved, unlike v14.5's one-session Mute: say so where touch users see it.
                            showStatusToast('Layers muted. They stay off until you turn off Music only in Harmonic Control.', {
                              actionLabel: 'Undo',
                              onAction: () => { setMusicOnly(false); dismissStatusToast(); },
                              durationMs: 8000,
                            });
                          }}
                          title="Turns on Music only: the tone, beat and drone fade out and stay off. Turn it off in Harmonic Control."
                          className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded"
                        >
                          {musicOnly ? 'Layers muted' : 'Mute layers'}
                        </button>
                      </div>
                      
                      {/* The launch disclaimer, readable any time: since v14.6 it
                          shows by itself only on first launch and when its wording
                          changes. More › Safety replaces this in v14.22. */}
                      <button
                        onClick={() => {
                          rereadingDisclaimerRef.current = true;
                          setShowSafetyProtocols(false);
                          setDisclaimerAccepted(false);
                        }}
                        className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded border border-slate-600"
                      >
                        Read the disclaimer
                      </button>

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
          />


          <ViewBoundary
            name="links"
            fallback={(api) => (
              <div className="fixed right-0 top-1/2 -translate-y-1/2 z-[55] w-full max-w-sm p-4 pointer-events-none">
                <PanelFallback
                  className="pointer-events-auto"
                  switchedOff={api.switchedOff}
                  copyDetails={api.copyDetails}
                  buttonRef={api.buttonRef}
                  onRetry={api.retry}
                  onClose={() => {
                    setShowLinks(false);
                    if (api.switchedOff) api.dismiss();
                    else api.retry();
                  }}
                />
              </div>
            )}
            render={() => (
          <>
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
                  <a href="https://big-banana-studios.github.io/aetheria-reader/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-cyan-500/40 transition-all group">
                    <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                      <Library size={16} className="text-cyan-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-slate-200 group-hover:text-cyan-400 transition-colors">Aetheria Reader</h4>
                      <p className="text-[10px] text-slate-500">Read-aloud e-reader — your own books stay on your device</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-700 group-hover:text-cyan-500 transition-colors shrink-0" />
                  </a>
                  <a href="https://big-banana-studios.github.io/Controlled-Burn/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-orange-500/40 transition-all group">
                    <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                      <Flame size={16} className="text-orange-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-slate-200 group-hover:text-orange-400 transition-colors">Controlled Burn</h4>
                      <p className="text-[10px] text-slate-500">Heart-rate flooding alerts — Gottman conflict de-escalation</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-700 group-hover:text-orange-500 transition-colors shrink-0" />
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
                  <a href="https://www.amazon.com/dp/B0HF38MDJB" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg hover:border-blue-500/40 transition-all group">
                    <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                      <BookOpen size={16} className="text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-slate-200 group-hover:text-blue-400 transition-colors">Aetheria: The Science</h4>
                      <p className="text-[10px] text-slate-500">A research-driven deep dive — the evidence behind the system</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-700 group-hover:text-blue-500 transition-colors shrink-0" />
                  </a>
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
          </>
            )}
          />

          {/* NEW FOOTER - SNAPPED TO BOTTOM */}
          <ViewBoundary
            name="transport"
            onReset={bumpInsets}
            fallback={(api) => (
              <SafeTransport
                isPlaying={isPlaying}
                onPrev={handlePrev}
                onPlayPause={handlePlayPause}
                onNext={handleNext}
                onRetry={api.retry}
                barRef={playerBarRef}
                buttonRef={api.buttonRef}
                switchedOff={api.switchedOff}
                zenMode={isZenMode}
                onLeaveZen={() => setIsZenMode(false)}
              />
            )}
            render={() => (
          <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none flex justify-center">
             <div ref={playerBarRef} data-testid="player-bar" className="pointer-events-auto w-full bg-black/90 backdrop-blur-xl border-t border-slate-800 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] transition-all duration-300 group">
                
                {/* Seek Bar with Phi Timing Markers */}
                <div 
                    className="w-full h-1 hover:h-2 bg-slate-800/50 cursor-pointer relative transition-all group-hover:h-2"
                    onClick={handleSeek}
                >
                    <div data-testid="seek-progress" className="absolute inset-y-0 left-0 bg-gold-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]" style={{width: `${(currTime / (currDuration || 1)) * 100}%`}}></div>
                    
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
                        <span data-testid="now-playing-title" className="text-slate-200 truncate max-w-[150px] sm:max-w-[300px] font-bold">
                            {playlist[currentSongIndex]?.name || "Aetheria Harmonic Player"}
                        </span>
                        
                        {/* Key fit (v15.2, review B2): with its chip shown the chips wrap whole onto a second line on a
                            phone (the chip never breaks mid-label); without it, the row is exactly v15.1's. */}
                        <div className={keyFitChipShown ? 'flex flex-wrap justify-center items-center gap-x-2 gap-y-1' : 'flex items-center gap-2'}>
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
                           // v16.0: counted over the walk's own entries (a queued track inside the walk has step -1 and
                           // is not a step: the chip hides while one plays). With no queue, the cursor and the length.
                           const wp = walkProgress(loShuWalkSteps, loShuWalkSegments, currentSongIndex);
                           if (wp?.queued) return null;
                           const walkIdx = wp && loShuWalkSteps ? wp.at - 1 : currentSongIndex;
                           const stepIdx = walkIdx + 1;
                           const total = wp && loShuWalkSteps ? wp.count : playlist.length;
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
                               if (walkIdx < accumulated + loShuWalkSegments[i]) {
                                 segIdx = i;
                                 break;
                               }
                               accumulated += loShuWalkSegments[i];
                             }
                             const segName = segments[segIdx];
                             const segLen = loShuWalkSegments[segIdx];
                             const segPos = walkIdx - accumulated + 1;
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
                            <Waves size={8} /> {v2Active || v2CarFallback ? bandChipLabel : selectedBinaural.name}
                         </span>
                         {showLayerChrome && (
                           <LayersBadge text={layersBadgeLabel} tooltip={layersBadgeTooltip} onOpen={openLayerSwitch} />
                         )}
                         {keyFitChipShown && (
                           <KeyFitChip text={keyFitChipLabel} title={keyFitChipHint} tone={keyFitChipLook} />
                         )}
                         {musicOnly && (
                           <span
                             data-testid="music-only-chip"
                             className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-300 border border-orange-500/30"
                             title="Music only is on: the tone, beat and drone are off. Turn it off in Harmonic Control."
                           >
                             <VolumeX size={8} /> Music only
                           </span>
                         )}

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

                         {pass.phase !== 'idle' && (
                           <span data-testid="analyse-chip" title="Analyse tracks is running. Its button in the library panel stops it."
                                 className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20">
                             <Music size={8} /> Analysing {pass.done}/{pass.total}
                           </span>
                         )}

                         <span data-testid="transport-time" className="font-mono text-slate-600 ml-1">
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
                            <button onClick={() => setIsShuffle(!isShuffle)} aria-label="Shuffle" aria-pressed={isShuffle} className={`${isShuffle ? 'text-gold-500' : 'text-slate-600'} hover:text-white transition-colors`}><Shuffle size={14}/></button>
                            <button onClick={handlePrev} aria-label="Previous track" className="text-slate-300 hover:text-white transition-colors"><SkipBack size={16}/></button>

                            <button
                                onClick={handlePlayPause}
                                aria-label={isPlaying ? 'Pause' : 'Play'}
                                className="w-8 h-8 rounded-full bg-gold-500 hover:bg-gold-400 flex items-center justify-center text-black shadow-lg shadow-gold-500/20 transition-all hover:scale-105 active:scale-95"
                            >
                                {isPlaying ? <Pause size={16} fill="black" /> : <Play size={16} fill="black" className="ml-0.5" />}
                            </button>

                            <button onClick={handleNext} aria-label="Next track" className="text-slate-300 hover:text-white transition-colors"><SkipForward size={16}/></button>
                            <button onClick={() => setIsLoop(!isLoop)} aria-label="Repeat" aria-pressed={isLoop} className={`${isLoop ? 'text-gold-500' : 'text-slate-600'} hover:text-white transition-colors`}><Repeat size={14}/></button>

                            {/* Layer sound and output (v14.9): shown once an engine has been chosen, or under v2. */}
                            {showLayerChrome && (
                                <OutputQuickSwitch
                                    engine={layerEngine}
                                    v2Failed={v2Failed}
                                    output={layerOutput}
                                    musicOnly={musicOnly}
                                    sheetOpen={showOutputSheet}
                                    open={layerSwitchOpen}
                                    onOpenChange={setLayerSwitchOpen}
                                    panelProps={layerPanelProps}
                                />
                            )}

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
                            {v2Active || v2CarFallback ? (
                            // v2: the beat's level in dB re the validated −23 dB per ear; the car has no beat (nor its fallback: no layers).
                            <div className="flex items-center gap-2 group/bin">
                                <Zap size={14} className={`transition-colors ${outputRender === 'off' ? 'text-slate-700' : 'text-slate-500 group-hover/bin:text-blue-400'}`} />
                                <input
                                    type="range" min="0" max={V2_BEAT_SLIDER_MAX} step="0.001"
                                    value={Math.min(binauralVolume, V2_BEAT_SLIDER_MAX)} onChange={e => setBinauralVolume(parseFloat(e.target.value))}
                                    disabled={outputRender === 'off'}
                                    aria-label={BEAT_LEVEL_LABEL}
                                    aria-valuetext={beatLevelText}
                                    className={`w-16 sm:w-20 h-1 bg-slate-700 rounded-lg appearance-none accent-blue-500 transition-all ${outputRender === 'off' ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:h-1.5'}`}
                                    title={beatLevelText}
                                />
                            </div>
                            ) : (
                            <div className="flex items-center gap-2 group/bin">
                                <Zap size={14} className="text-slate-500 group-hover/bin:text-blue-400 transition-colors" />
                                <input 
                                    type="range" min="0" max="0.2" step="0.001" 
                                    value={binauralVolume} onChange={e => setBinauralVolume(parseFloat(e.target.value))} 
                                    className="w-16 sm:w-20 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:h-1.5 transition-all" 
                                    title={`Binaural Volume: ${Math.round(binauralVolume/0.2*100)}%`}
                                />
                            </div>
                            )}

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
            )}
          />
        </main>
      </div>
      )}
      {classicPeek && <PeekPill onBack={() => setClassicPeek(null)} bottom={uiInsets.bottom} />}
    </div>
  );
};

export default App;
