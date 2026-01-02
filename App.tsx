import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, 
  Upload, Settings, Info, Activity, Volume2, Maximize2, Minimize2, 
  Circle, Zap, X, Menu, Eye, EyeOff, ChevronDown, ChevronUp, BarChart3, Loader2, Sparkles, Sliders, Wind, Activity as PulseIcon, Waves, Wand2, Search, Video, Mic, Monitor, RefreshCw, Flame, Flower2, Layers, Heart, Smile, Moon, Droplets, FilePlus, RotateCw, ArrowUpCircle, Hexagon, AlertTriangle, CircleHelp, ChevronRight, ChevronLeft, BookOpen, User, Map, Box, Trash2, Target, Shield
} from 'lucide-react';
import { Song, SolfeggioFreq, BinauralPreset, VizSettings } from './types';
import { SOLFEGGIO_INFO, BINAURAL_PRESETS, PITCH_SHIFT_FACTOR, UNIFIED_THEORY, SEPHIROT_INFO, GEOMETRY_INFO } from './constants';
import Visualizer from './components/Visualizer';
import FrequencySelector from './components/FrequencySelector';
import SafetyProtocols from './components/SafetyProtocols';
import ExperienceTracker from './components/ExperienceTracker';
import { 
  analyzeFractalFrequencies, 
  assessFrequencySafety, 
  type FractalAnalysisResult 
} from './utils/fractalFrequencyAnalysis';
import { 
  effectsManager, 
  experienceTracker, 
  type FrequencyEffect 
} from './utils/effectsDocumentation';

// --- Helpers ---
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

const getAudioDuration = (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.src = objectUrl;
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(0);
    };
  });
};

// Original frequency detection (moved outside App component)

const detectDominantFrequency = async (buffer: AudioBuffer): Promise<number> => {
  return new Promise((resolve, reject) => {
    // 5 second timeout for basic analysis
    const timeout = setTimeout(() => {
      reject(new Error('Basic frequency detection timeout'));
    }, 5000);

    try {
      const sampleDuration = Math.min(3, buffer.duration / 2); // Adaptive duration
      const offlineCtx = new OfflineAudioContext(1, 44100 * sampleDuration, 44100); 
      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;
      
      const analyser = offlineCtx.createAnalyser();
      analyser.fftSize = 16384; // Reduced FFT size for speed
      analyser.smoothingTimeConstant = 0.1;
      
      source.connect(analyser);
      analyser.connect(offlineCtx.destination);
      
      // Sample from the middle of the track to avoid intro/outro silence
      const startOffset = Math.min(buffer.duration / 2, 30);
      source.start(0, startOffset, sampleDuration);
      
      offlineCtx.startRendering().then(() => {
        clearTimeout(timeout);
        
        const data = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(data);
        
        let maxVal = -Infinity;
        let maxIndex = -1;
        
        const binSize = 44100 / analyser.fftSize;
        // Start analysis higher to skip sub-bass rumble
        const startBin = Math.floor(60 / binSize);

        for (let i = startBin; i < data.length; i++) {
          let magnitude = data[i];
          const freq = i * binSize;

          // Weighting to favor mid-range (melody/harmony) over heavy bass
          // Tuned: Aggressively penalize sub 250Hz to avoid 174/285 bias from kick drums
          if (freq < 100) {
              magnitude -= 40; 
          } else if (freq < 250) {
              magnitude -= 20;
          } else if (freq > 3000) {
              magnitude -= 15; // Penalize high hiss/air
          } else {
              magnitude += 5; // Slight boost to mid-range (vocals/synths)
          }

          if (magnitude > maxVal) {
            maxVal = magnitude;
            maxIndex = i;
          }
        }

        let freq = maxIndex * binSize;
        
        // Quadratic interpolation for better precision
        if (maxIndex > 0 && maxIndex < data.length - 1) {
           const alpha = data[maxIndex - 1];
           const beta = data[maxIndex];
           const gamma = data[maxIndex + 1];
           
           const delta = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma);
           freq = (maxIndex + delta) * binSize;
        }
        
        resolve(freq || 440); // Fallback to A440 if no freq detected
      }).catch(error => {
        clearTimeout(timeout);
        console.error("Analysis failed", error);
        resolve(440); // Fallback frequency
      });
      
    } catch (e) {
      clearTimeout(timeout);
      console.error("Analysis setup failed", e);
      resolve(440); // Fallback frequency
    }
  });
};

const getHarmonicSolfeggio = (detectedFreq: number): number => {
    if (detectedFreq <= 0) return 396; 

    let bestMatch = 396;
    let minScore = Infinity;

    SOLFEGGIO_INFO.forEach(s => {
        const sFreq = s.freq;
        const candidates = [
            sFreq, 
            sFreq / 2, sFreq * 2, 
            sFreq / 4, sFreq * 4
        ];
        
        candidates.forEach(c => {
            const diff = Math.abs(detectedFreq - c);
            if (diff < minScore) {
                minScore = diff;
                bestMatch = sFreq;
            }
        });
    });
    
    return bestMatch;
};

// Fisher-Yates Shuffle
const getShuffledIndices = (count: number) => {
    const indices = Array.from({length: count}, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices;
};

// --- Tutorial Component ---
const TutorialModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [step, setStep] = useState(0);

    const steps = [
        {
            title: "Welcome to Aetheria",
            icon: <Activity className="text-gold-500 w-12 h-12" />,
            desc: "Aetheria is a harmonic resonance engine that retunes your music to 432Hz and aligns it with sacred geometry.",
            content: (
                <ul className="text-sm text-slate-400 space-y-3 text-left bg-slate-800/50 p-5 rounded-lg border border-slate-700">
                    <li className="flex gap-2">✨ <strong>Automatic 432Hz:</strong> All imported music is instantly pitch-shifted from standard 440Hz to the harmonic 432Hz.</li>
                    <li className="flex gap-2">💠 <strong>Living Visuals:</strong> The geometry engine reacts to the harmonic content of your audio in real-time.</li>
                    <li className="flex gap-2">🎧 <strong>Best Experience:</strong> Use headphones to fully experience the binaural beats and spatial audio.</li>
                </ul>
            )
        },
        {
            title: "1. Import Your Music",
            icon: <Upload className="text-blue-400 w-12 h-12" />,
            desc: "Aetheria runs entirely in your browser. Your files stay on your device.",
            content: (
                <ul className="text-sm text-slate-400 space-y-3 text-left bg-slate-800/50 p-5 rounded-lg border border-slate-700">
                    <li className="flex gap-2">📁 <strong>Folder Import:</strong> The best way to start. Click the folder icon in the sidebar to load an entire album.</li>
                    <li className="flex gap-2">📄 <strong>File Select:</strong> Use the 'Add Files' button for individual tracks.</li>
                    <li className="flex gap-2">💾 <strong>Privacy:</strong> No data is uploaded to any server. It is safe to use with your private collection.</li>
                </ul>
            )
        },
        {
            title: "2. Scan Harmonics",
            icon: <Search className="text-purple-400 w-12 h-12" />,
            desc: "Unlock the hidden potential of your library by analyzing its musical key.",
            content: (
                <ul className="text-sm text-slate-400 space-y-3 text-left bg-slate-800/50 p-5 rounded-lg border border-slate-700">
                    <li className="flex gap-2">🔍 <strong>Scan Library:</strong> Click this in the sidebar. The engine analyzes the frequency spectrum of every song.</li>
                    <li className="flex gap-2">🔗 <strong>Solfeggio Match:</strong> We automatically assign the mathematically closest healing frequency (e.g., 528Hz) to each track.</li>
                    <li className="flex gap-2">🧘 <strong>Alignment Playlist:</strong> Use the 'Alignment' button to sort your music from Root (174Hz) to Crown (963Hz).</li>
                </ul>
            )
        },
        {
            title: "3. Harmonic Layers",
            icon: <Sliders className="text-green-400 w-12 h-12" />,
            desc: "Open the Settings panel (gear icon) to customize your sonic environment.",
            content: (
                <ul className="text-sm text-slate-400 space-y-3 text-left bg-slate-800/50 p-5 rounded-lg border border-slate-700">
                    <li className="flex gap-2">🎚️ <strong>Solfeggio Layer:</strong> Adds a pure sine wave tone. Keep volume low (5-10%) for a subtle subconscious effect.</li>
                    <li className="flex gap-2">🧠 <strong>Binaural Beats:</strong> Generates a frequency difference between ears to entrain brainwaves (Alpha, Theta).</li>
                    <li className="flex gap-2">⚡ <strong>Adaptive Mode:</strong> If enabled, the beat frequency changes dynamically based on the song's energy.</li>
                </ul>
            )
        },
        {
            title: "4. Visual Engine",
            icon: <Hexagon className="text-red-400 w-12 h-12" />,
            desc: "Control how the sacred geometry manifests.",
            content: (
                <ul className="text-sm text-slate-400 space-y-3 text-left bg-slate-800/50 p-5 rounded-lg border border-slate-700">
                    <li className="flex gap-2">🌳 <strong>Tree of Life:</strong> Enable in 'Visualization Engine'. Observe the energy flowing through the 3D Sephirot nodes.</li>
                    <li className="flex gap-2">💧 <strong>Hydro-Acoustics:</strong> Enable water ripples to visualize bass impact. Use the 0-100% slider to control storm intensity.</li>
                    <li className="flex gap-2">👁️ <strong>Zen Mode:</strong> Click the Eye icon in the footer to hide all controls for pure visual immersion.</li>
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

  const [showInfo, setShowInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  
  // Zen Mode with Mouse Detect
  const [isZenMode, setIsZenMode] = useState(false);
  const [zenUiVisible, setZenUiVisible] = useState(true);
  const zenTimeoutRef = useRef<number | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [showRecordOptions, setShowRecordOptions] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true); 
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  
  const [currTime, setCurrTime] = useState(0);
  const [currDuration, setCurrDuration] = useState(0);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pendingDurationAnalysis, setPendingDurationAnalysis] = useState<string[]>([]);
  
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

  const [vizSettings, setVizSettings] = useState<VizSettings>({
    speed: 1.0,
    sensitivity: 1.0,
    particleDensity: 'medium',
    particleBaseSize: 3.5, 
    coreSize: 1.0,
    showHexagons: true,
    hexOpacity: 0.6,
    hexVisualMode: 'spectrum', 
    showWaterRipples: false,
    hydroIntensity: 50, // 0-100 scale
    showTreeOfLife: false,
    colorMode: 'chakra',
    autoRotate: true,
    invertPerspective: false,
    morphEnabled: true,
    enableFlow: true,
    enableFloat: false,
    enablePulse: false,
    enableTrails: false,
  });

  const [volume, setVolume] = useState(0.8);
  const [solfeggioVolume, setSolfeggioVolume] = useState(0.05); 
  const [binauralVolume, setBinauralVolume] = useState(0.03); // Initialized to 3%
  const [selectedSolfeggio, setSelectedSolfeggio] = useState<number>(396);
  const [selectedBinaural, setSelectedBinaural] = useState<BinauralPreset>(BINAURAL_PRESETS[2]); 
  const [useChakraOrder, setUseChakraOrder] = useState(false);
  const [isAdaptiveBinaural, setIsAdaptiveBinaural] = useState(true); // Default ON
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Advanced Features State
  const [fractalAnalysis, setFractalAnalysis] = useState<FractalAnalysisResult | null>(null);
  const [showFrequencySelector, setShowFrequencySelector] = useState(false);
  const [showSafetyProtocols, setShowSafetyProtocols] = useState(false);
  const [userExperienceLevel, setUserExperienceLevel] = useState<'beginner' | 'intermediate' | 'advanced' | 'expert'>('beginner');
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [isDocumentingEffects, setIsDocumentingEffects] = useState(false);
  const [currentEffectsSession, setCurrentEffectsSession] = useState<string | null>(null);
  const [subtleResonanceMode, setSubtleResonanceMode] = useState(false);
  const [analysisNotification, setAnalysisNotification] = useState<string | null>(null);
  const [showExperienceHistory, setShowExperienceHistory] = useState(false);

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
      
      // Update safety state based on analysis
      const safetyAssessment = assessFrequencySafety(result.dominantFrequency);
      if (result.dominantFrequency >= 1074) {
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
      
      return result.dominantFrequency;
    } catch (error) {
      console.error("Advanced analysis failed, falling back to basic detection", error);
      setIsAnalyzing(false);
      setFractalAnalysis(null);
      
      // Fallback to original detection method
      return detectDominantFrequency(buffer);
    }
  }, [solfeggioVolume]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const audioBufferRef = useRef<AudioBuffer | null>(null);

  const solfeggioOscRef = useRef<OscillatorNode | null>(null);
  const solfeggioGainRef = useRef<GainNode | null>(null);
  const binauralLeftOscRef = useRef<OscillatorNode | null>(null);
  const binauralRightOscRef = useRef<OscillatorNode | null>(null);
  const binauralMergerRef = useRef<ChannelMergerNode | null>(null);
  const binauralGainRef = useRef<GainNode | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);

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

  // Search functionality effect
  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredPlaylist(playlist);
    } else {
      const filtered = playlist.filter(song => 
        song.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredPlaylist(filtered);
    }
  }, [searchTerm, playlist]);

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
            const newIndices = getShuffledIndices(playlist.length);
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

  // --- Audio Initialization ---
  const initAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioContextClass();
      
      gainNodeRef.current = audioCtxRef.current.createGain();
      gainNodeRef.current.connect(audioCtxRef.current.destination);

      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 16384; 
      analyserRef.current.smoothingTimeConstant = 0.85; 
      
      gainNodeRef.current.connect(analyserRef.current);
      
      setAnalyserNode(analyserRef.current);
      
      destNodeRef.current = audioCtxRef.current.createMediaStreamDestination();
      gainNodeRef.current.connect(destNodeRef.current);
    }
    if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
    }
  }, []);

  const updateSolfeggio = useCallback(() => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const now = ctx.currentTime;

    if (solfeggioOscRef.current) {
      try { solfeggioOscRef.current.stop(); } catch(e) {}
      solfeggioOscRef.current.disconnect();
    }
    if (solfeggioGainRef.current) solfeggioGainRef.current.disconnect();

    if (!isPlaying) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(selectedSolfeggio, now);
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(solfeggioVolume * 0.05, now + 1);

    osc.connect(gain);
    gain.connect(gainNodeRef.current!); 
    
    osc.start();

    solfeggioOscRef.current = osc;
    solfeggioGainRef.current = gain;
  }, [isPlaying, selectedSolfeggio, solfeggioVolume]);

  useEffect(() => {
      if (binauralGainRef.current && audioCtxRef.current) {
          binauralGainRef.current.gain.setTargetAtTime(binauralVolume, audioCtxRef.current.currentTime, 0.1);
      }
  }, [binauralVolume]);

  const updateBinaural = useCallback(() => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    
    [binauralLeftOscRef, binauralRightOscRef].forEach(ref => {
      if (ref.current) { try { ref.current.stop(); } catch(e){} ref.current.disconnect(); }
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

    leftOsc.frequency.value = carrier;
    rightOsc.frequency.value = carrier + diff;

    leftOsc.connect(merger, 0, 0); 
    rightOsc.connect(merger, 0, 1); 

    merger.connect(mainGain);
    mainGain.connect(gainNodeRef.current!);

    mainGain.gain.value = binauralVolume;

    leftOsc.start();
    rightOsc.start();

    binauralLeftOscRef.current = leftOsc;
    binauralRightOscRef.current = rightOsc;
    binauralMergerRef.current = merger;
    binauralGainRef.current = mainGain;
  }, [isPlaying, selectedBinaural]); 

  useEffect(() => { updateSolfeggio(); }, [updateSolfeggio]);
  useEffect(() => { updateBinaural(); }, [updateBinaural]);

  useEffect(() => {
    if(gainNodeRef.current && audioCtxRef.current) {
        gainNodeRef.current.gain.setTargetAtTime(volume, audioCtxRef.current.currentTime, 0.1);
    }
  }, [volume]);

  useEffect(() => {
    if (!isAdaptiveBinaural || !isPlaying || !analyserNode) return;

    const interval = setInterval(() => {
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserNode.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for(let i=0; i<bufferLength; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength) / 255;
        
        let targetPreset = BINAURAL_PRESETS[2]; 
        if (rms < 0.1) targetPreset = BINAURAL_PRESETS[0];
        else if (rms < 0.25) targetPreset = BINAURAL_PRESETS[1];
        else if (rms > 0.6) targetPreset = BINAURAL_PRESETS[4]; 
        else if (rms > 0.4) targetPreset = BINAURAL_PRESETS[3]; 
        
        if (targetPreset.name !== selectedBinaural.name) {
            setSelectedBinaural(targetPreset);
        }

    }, 3000); 

    return () => clearInterval(interval);
  }, [isAdaptiveBinaural, isPlaying, analyserNode, selectedBinaural]);


  useEffect(() => {
    const updateTime = () => {
      if (isPlaying && audioCtxRef.current) {
        const elapsed = audioCtxRef.current.currentTime - startTimeRef.current;
        let actualTime = pausedAtRef.current + (elapsed * PITCH_SHIFT_FACTOR);
        if (actualTime > currDuration) actualTime = currDuration;
        setCurrTime(actualTime);
        rafRef.current = requestAnimationFrame(updateTime);
      }
    };
    if (isPlaying) rafRef.current = requestAnimationFrame(updateTime);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, currDuration]);


  // BACKGROUND DURATION ANALYZER
  useEffect(() => {
    if (pendingDurationAnalysis.length === 0) return;

    const processNextBatch = async () => {
       const batchSize = 5;
       const processing = pendingDurationAnalysis.slice(0, batchSize);
       const remaining = pendingDurationAnalysis.slice(batchSize);
       
       const updates: {id: string, duration: number}[] = [];
       
       // Process batch
       await Promise.all(processing.map(async (id) => {
          // Find song object in current playlist state (via ref or effect dependence) - using functional update below
          const song = originalPlaylist.find(s => s.id === id); 
          if (song) {
              const dur = await getAudioDuration(song.file);
              updates.push({ id, duration: dur });
          }
       }));
       
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
       
       setPendingDurationAnalysis(remaining);
    };

    const timer = setTimeout(processNextBatch, 100);
    return () => clearTimeout(timer);
  }, [pendingDurationAnalysis, originalPlaylist]);


  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    const fileList = (Array.from(files) as File[]).filter(f => f.type.includes('audio') || f.name.endsWith('.wav') || f.name.endsWith('.mp3'));
    
    // 1. Create Song objects immediately with 0 duration to unblock UI
    const newSongs: Song[] = fileList.map(file => ({
        file: file,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name.replace(/\.[^/.]+$/, ""),
        duration: 0 // Will be filled in background
    }));

    setPlaylist(prev => {
        const updated = [...prev, ...newSongs];
        setOriginalPlaylist(updated); 
        return updated;
    });

    // 2. Queue for background analysis
    setPendingDurationAnalysis(prev => [...prev, ...newSongs.map(s => s.id)]);
    
    setIsUploading(false);
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
          
          const solfeggio = getHarmonicSolfeggio(freq);
          const deviation = Math.abs(freq - solfeggio);
          
          newPlaylist[i] = {
            ...newPlaylist[i],
            harmonicFreq: freq,
            closestSolfeggio: solfeggio,
            harmonicDeviation: deviation,
            fractalAnalysis: fractalData
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
        const successMsg = `Analysis complete! Processed ${processedCount}/${newPlaylist.length} files in ${totalTime} minutes.`;
        setAnalysisNotification(successMsg);
        setTimeout(() => setAnalysisNotification(null), 5000);
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
          const hasHighFrequencies = alignedPlaylist.some(s => (s.closestSolfeggio || 0) >= 1074);
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
      { order: 'Fourth', frequencies: [1074, 1317, 1641] },
      { order: 'Fifth', frequencies: [1752, 1995, 2319] },
      { order: 'Sixth', frequencies: [2430, 2673, 2997] },
      { order: 'Seventh', frequencies: [3108, 3351, 3675] },
      { order: 'Eighth', frequencies: [3786, 4029, 4353] },
      { order: 'Ninth', frequencies: [4464, 4707, 5031] }
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

  const generateDNAResonancePlaylist = () => {
    // Strict 528Hz resonance filter - only the pure 528Hz frequency
    console.log('=== STRICT 528Hz DNA RESONANCE FILTER ===');
    originalPlaylist.forEach(song => {
      if (song.fractalAnalysis && song.closestSolfeggio === 528) {
        const dnaScore = song.fractalAnalysis.dnaResonanceScore * 100;
        console.log(`${song.name}: DNA=${dnaScore.toFixed(1)}% | 528Hz=true | Accuracy=${song.harmonicDeviation?.toFixed(1) || 'N/A'}Hz`);
      }
    });

    // STRICT filtering: ONLY 528Hz tracks with any level of DNA resonance
    const pure528Tracks = originalPlaylist
      .filter(song => {
        // Must be exactly 528Hz frequency match
        if (song.closestSolfeggio !== 528) return false;
        
        // Must have fractal analysis data
        if (!song.fractalAnalysis) return false;
        
        // Accept any level of DNA resonance (even minimal) for 528Hz tracks
        return song.fractalAnalysis.dnaResonanceScore > 0;
      })
      .sort((a, b) => {
        // Sort by DNA resonance score (highest first)
        const aDNA = a.fractalAnalysis?.dnaResonanceScore || 0;
        const bDNA = b.fractalAnalysis?.dnaResonanceScore || 0;
        
        if (Math.abs(aDNA - bDNA) > 0.01) {
          return bDNA - aDNA;
        }
        
        // Then by harmonic accuracy (closest to pure 528Hz)
        const aAccuracy = a.harmonicDeviation || 999;
        const bAccuracy = b.harmonicDeviation || 999;
        
        return aAccuracy - bAccuracy;
      });
    
    console.log(`Found ${pure528Tracks.length} pure 528Hz tracks for DNA resonance playlist`);
    
    if (pure528Tracks.length > 0) {
      setPlaylist(pure528Tracks);
      setUseChakraOrder(false);
      setCurrentSongIndex(0);
      setSearchTerm('');
      
      // Auto-set to 528Hz for optimal DNA resonance
      setSelectedSolfeggio(528);
      
      // Enable visualization features optimized for 528Hz DNA work
      setVizSettings(prev => ({ 
        ...prev, 
        morphEnabled: true,
        showTreeOfLife: true,
        colorMode: 'chakra',
        enableFlow: true,
        showHexagons: true,
        hexOpacity: 0.7
      }));
      
      // Calculate quality metrics for user feedback
      const avgDNAScore = pure528Tracks.reduce((sum, song) => 
        sum + (song.fractalAnalysis?.dnaResonanceScore || 0), 0) / pure528Tracks.length;
      
      const highQualityTracks = pure528Tracks.filter(s => 
        (s.fractalAnalysis?.dnaResonanceScore || 0) > 0.3).length;
      
      const avgAccuracy = pure528Tracks.reduce((sum, song) => 
        sum + (song.harmonicDeviation || 0), 0) / pure528Tracks.length;
      
      setTimeout(() => {
        setAnalysisNotification(
          `Pure 528Hz DNA Resonance Filter activated! ${pure528Tracks.length} tracks found. Average DNA resonance: ${(avgDNAScore * 100).toFixed(1)}%, ${highQualityTracks} high-quality tracks, avg accuracy: ±${avgAccuracy.toFixed(1)}Hz from pure 528Hz.`
        );
        setTimeout(() => setAnalysisNotification(null), 8000);
      }, 500);
      
      if(window.innerWidth < 768) setShowSidebar(false);
    } else {
      const tracksWith528 = originalPlaylist.filter(s => s.closestSolfeggio === 528).length;
      const analyzedTracks = originalPlaylist.filter(s => s.fractalAnalysis).length;
      const unanalyzedTracks = originalPlaylist.length - analyzedTracks;
      
      alert(`No pure 528Hz tracks found for DNA resonance filter.\n\n` +
            `Current library status:\n` +
            `• Total tracks: ${originalPlaylist.length}\n` +
            `• Analyzed tracks: ${analyzedTracks}\n` +
            `• Unanalyzed tracks: ${unanalyzedTracks}\n` +
            `• 528Hz frequency matches: ${tracksWith528}\n\n` +
            `To use this filter:\n` +
            `1. Import music containing 528Hz content\n` +
            `2. Run "Deep Scan" to analyze harmonic frequencies\n` +
            `3. This filter requires exact 528Hz frequency matches\n\n` +
            `Note: This filter only shows tracks that are harmonically centered on pure 528Hz.`);
    }
  };

  // Diagnostic function to show fractal analysis status
  const showPlaylistDiagnostics = () => {
    const totalTracks = originalPlaylist.length;
    const analyzedTracks = originalPlaylist.filter(s => s.fractalAnalysis).length;
    const unanalyzedTracks = totalTracks - analyzedTracks;
    
    const goldenTracks = originalPlaylist.filter(s => s.fractalAnalysis && s.fractalAnalysis.goldenRatioAlignment > 0.3).length;
    const pattern111Tracks = originalPlaylist.filter(s => s.fractalAnalysis && s.fractalAnalysis.pattern111Presence > 0.2).length;
    const dnaTracks = originalPlaylist.filter(s => s.fractalAnalysis && s.fractalAnalysis.dnaResonanceScore > 0.3).length;
    
    const diagnosticMessage = `🔬 PLAYLIST DIAGNOSTICS\n\n` +
      `📊 ANALYSIS STATUS:\n` +
      `• Total tracks: ${totalTracks}\n` +
      `• Analyzed tracks: ${analyzedTracks}\n` +
      `• Unanalyzed tracks: ${unanalyzedTracks}\n\n` +
      `🎵 PLAYLIST RESULTS:\n` +
      `• Golden Ratio tracks (>30%): ${goldenTracks}\n` +
      `• 111 Pattern tracks (>20%): ${pattern111Tracks}\n` +
      `• DNA Resonance tracks (>30%): ${dnaTracks}\n\n` +
      `💡 RECOMMENDATIONS:\n` +
      `${unanalyzedTracks > 0 ? `• Scan ${unanalyzedTracks} remaining tracks\n` : ''}` +
      `${goldenTracks === 0 ? '• Golden Ratio: Try lowering threshold or rescan\n' : ''}` +
      `${pattern111Tracks === 0 ? '• 111 Pattern: Try scanning more tracks\n' : ''}` +
      `${dnaTracks === 0 ? '• DNA Resonance: Try scanning healing frequencies\n' : ''}` +
      `\n🔄 Use "Scan All Remaining" to analyze unscanned tracks.`;
      
    alert(diagnosticMessage);
  };

  const generateUltimateAlignmentPlaylist = () => {
    // Get all solfeggio frequencies in order from First through Sixth order
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
      const hasHighFrequencies = ultimatePlaylist.some(s => (s.closestSolfeggio || 0) >= 1074);
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

  const restoreLibrary = () => {
      if (originalPlaylist.length > 0) {
          setPlaylist(originalPlaylist);
          setUseChakraOrder(false);
          setSearchTerm(''); // Clear search when restoring library
      }
  };

  const playBuffer = (buffer: AudioBuffer, offset: number = 0) => {
      if (!audioCtxRef.current) return;
      
      if (sourceNodeRef.current) {
        sourceNodeRef.current.onended = null;
        try { sourceNodeRef.current.stop(); } catch(e) {}
        sourceNodeRef.current.disconnect();
      }

      const source = audioCtxRef.current.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = PITCH_SHIFT_FACTOR; 
      source.connect(gainNodeRef.current!);
      
      source.onended = () => {
          setIsPlaying(false);
          const expectedWallDuration = buffer.duration / PITCH_SHIFT_FACTOR;
          if (audioCtxRef.current && Math.abs(audioCtxRef.current.currentTime - startTimeRef.current - expectedWallDuration) < 0.5) {
             playNextRef.current();
          }
      };

      source.start(0, offset);
      startTimeRef.current = audioCtxRef.current.currentTime;
      pausedAtRef.current = offset; 
      
      sourceNodeRef.current = source;
      setIsPlaying(true);
  };

  const playTrack = async (index: number, playlistOverride?: Song[]) => {
    initAudio();
    
    const tracks = playlistOverride || (stateRef.current.playlist.length > 0 ? stateRef.current.playlist : playlist);
    
    if (index < 0 || index >= tracks.length) return;
    
    // Sync Shuffle Position if we are jumping to a specific track manually
    if (stateRef.current.isShuffle && !playlistOverride) {
        const shuffleIdx = stateRef.current.shuffledIndices.indexOf(index);
        if (shuffleIdx !== -1) {
             setShufflePos(shuffleIdx);
        }
    }

    setCurrTime(0);
    pausedAtRef.current = 0;
    setIsAnalyzing(true);
    
    const song = tracks[index];
    if (!song) return;

    const arrayBuffer = await song.file.arrayBuffer();
    const audioBuffer = await audioCtxRef.current!.decodeAudioData(arrayBuffer);
    audioBufferRef.current = audioBuffer;
    setCurrDuration(audioBuffer.duration / PITCH_SHIFT_FACTOR);

    let freq = song.harmonicFreq;
    let existingFractalAnalysis = song.fractalAnalysis;
    
    if (!freq) {
        // Try advanced analysis first, fallback to basic if needed
        freq = await detectDominantFrequencyAdvanced(audioBuffer);
    } else if (existingFractalAnalysis) {
        // Use stored fractal analysis
        setFractalAnalysis(existingFractalAnalysis);
        console.log('Using stored fractal analysis for:', song.name);
    }
    
    const autoFreq = getHarmonicSolfeggio(freq || 0);
    setSelectedSolfeggio(autoFreq);
    
    // Check if this is a high frequency track but don't interrupt playback
    if (autoFreq >= 1074) {
        setSubtleResonanceMode(true);
        // Don't automatically show safety protocols during playlist playback
        // Only show if manually selected
    } else {
        setSubtleResonanceMode(false);
    }
    
    setIsAnalyzing(false);

    playBuffer(audioBuffer, 0);
    setCurrentSongIndex(index);
  };

  useEffect(() => {
      playTrackRef.current = playTrack;
  }, [playTrack]);

  // Centralized Play Next Logic for Shuffle/Loop
  const playNext = useCallback(() => {
    const { playlist, currentSongIndex, isShuffle, isLoop, shuffledIndices } = stateRef.current;
    if (playlist.length === 0) return;

    if (isShuffle) {
        // Robust Shuffle Logic: Always find current position dynamically
        let currentIndices = shuffledIndices;

        // Ensure indices match playlist length (Sync check)
        if (currentIndices.length !== playlist.length) {
             currentIndices = getShuffledIndices(playlist.length);
             setShuffledIndices(currentIndices);
        }

        // Determine where we are in the shuffle list
        let currentShufflePos = currentIndices.indexOf(currentSongIndex);
        
        // If track is not found or invalid, reset
        if (currentShufflePos === -1) currentShufflePos = -1;

        const nextShufflePos = currentShufflePos + 1;

        if (nextShufflePos >= currentIndices.length) {
            // End of Shuffle List
            if (isLoop) {
                // Loop: Generate NEW random order and start from 0
                const newIndices = getShuffledIndices(playlist.length);
                setShuffledIndices(newIndices);
                setShufflePos(0);
                playTrack(newIndices[0]);
            } else {
                // No Loop: Stop
                setIsPlaying(false);
            }
        } else {
            // Next in shuffled list
            setShufflePos(nextShufflePos);
            playTrack(currentIndices[nextShufflePos]);
        }
    } else {
        // Normal Sequential Logic
        let nextIndex = currentSongIndex + 1;
        if (nextIndex >= playlist.length) {
            if (isLoop) nextIndex = 0;
            else {
                setIsPlaying(false);
                return;
            }
        }
        playTrack(nextIndex);
    }
  }, [playTrack]);

  useEffect(() => {
      playNextRef.current = playNext;
  }, [playNext]);

  const handlePlayPause = () => {
    initAudio();
    if (isPlaying) {
      if (audioCtxRef.current) audioCtxRef.current.suspend();
      setIsPlaying(false);
    } else {
      if (audioCtxRef.current) audioCtxRef.current.resume();
      if (!sourceNodeRef.current && playlist.length > 0) {
        playTrack(currentSongIndex >= 0 ? currentSongIndex : 0);
      } else {
        setIsPlaying(true);
      }
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!audioBufferRef.current || !audioCtxRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = Math.min(1, Math.max(0, x / rect.width));
      const seekTime = percent * currDuration;
      
      setCurrTime(seekTime);
      playBuffer(audioBufferRef.current, seekTime);
  };

  const handleNext = () => {
    playNext();
  };

  const handlePrev = () => {
    const { isShuffle, shuffledIndices, shufflePos } = stateRef.current;
    if (isShuffle && shufflePos > 0) {
        const prevPos = shufflePos - 1;
        setShufflePos(prevPos);
        playTrack(shuffledIndices[prevPos]);
    } else {
        let prev = currentSongIndex - 1;
        if (prev < 0) prev = playlist.length - 1;
        playTrack(prev);
    }
  };

  const startRecording = (type: 'audio' | 'video' | 'both') => {
      if (!audioCtxRef.current) return;
      
      const tracks: MediaStreamTrack[] = [];
      let mimeType = '';

      if (type === 'audio' || type === 'both') {
          if (destNodeRef.current) {
              tracks.push(...destNodeRef.current.stream.getAudioTracks());
          }
      }

      if (type === 'video' || type === 'both') {
          const canvas = document.getElementById('viz-canvas') as HTMLCanvasElement;
          if (canvas) {
              const videoStream = canvas.captureStream(30); 
              tracks.push(...videoStream.getVideoTracks());
          }
      }

      if (tracks.length === 0) return;

      const combinedStream = new MediaStream(tracks);

      if (type === 'audio') {
          mimeType = 'audio/webm;codecs=opus';
      } else {
          const possibleTypes = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm'
          ];
          mimeType = possibleTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
      }

      const bits = type === 'audio' ? 128000 : 2500000; 

      try {
          const recorder = new MediaRecorder(combinedStream, { 
              mimeType, 
              videoBitsPerSecond: bits 
          });
          
          const chunks: Blob[] = [];
          recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
          recorder.onstop = () => {
              const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              const ext = type === 'audio' ? 'webm' : 'webm'; 
              a.download = `aetheria-rec-${type}-${Date.now()}.${ext}`;
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
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
  };

  const getCurrentChakraColor = () => {
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

  return (
    <div className={`relative min-h-screen bg-black text-slate-200 font-sans overflow-hidden ${isFullScreen ? 'h-screen' : ''}`}>
      
      {/* Disclaimer Modal */}
      {!disclaimerAccepted && (
        <div className="fixed inset-0 z-[150] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-500">
            <div className="max-w-md w-full max-h-[calc(100vh-120px)] bg-slate-900 border border-gold-500/30 p-8 rounded-2xl shadow-2xl text-center relative overflow-hidden overflow-y-auto my-auto">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-gold-500 to-transparent"></div>
                 <AlertTriangle className="w-12 h-12 text-gold-500 mx-auto mb-4 animate-pulse" />
                 <h2 className="text-2xl font-serif text-white mb-2 tracking-wide">Welcome to Aetheria</h2>
                 <p className="text-xs text-slate-500 mb-6 uppercase tracking-widest">Resonance & Geometry Player</p>
                 
                 <div className="text-left text-slate-400 text-sm mb-6 space-y-4 bg-black/40 p-5 rounded-lg border border-slate-800">
                    <p className="flex gap-2">
                        <Zap size={16} className="text-gold-500 shrink-0 mt-0.5" />
                        <span><strong className="text-slate-200">Photosensitivity Warning:</strong> This application generates intense visual patterns, flashing lights, and geometric strobing effects.</span>
                    </p>
                    <p className="flex gap-2">
                        <Waves size={16} className="text-blue-500 shrink-0 mt-0.5" />
                        <span><strong className="text-slate-200">Audio Disclaimer:</strong> Contains binaural beats and solfeggio frequencies. Do not use while driving or operating heavy machinery.</span>
                    </p>
                    <p className="text-xs text-slate-500 italic mt-2 text-center border-t border-slate-800 pt-2">
                        By proceeding, you acknowledge this is for entertainment and meditation purposes only.
                    </p>
                 </div>
                 
                 <button onClick={acceptDisclaimer} className="w-full py-3 bg-gold-600 hover:bg-gold-500 text-black font-bold rounded-xl transition-all hover:scale-[1.02] active:scale-95 shadow-[0_0_20px_rgba(234,179,8,0.3)]">
                    I Understand & Accept
                 </button>
            </div>
        </div>
      )}

          {/* Tutorial Modal */}
          {showTutorial && <TutorialModal onClose={closeTutorial} />}

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

      <div className="absolute inset-0 z-0 pointer-events-none">
        <Visualizer 
            analyser={analyserNode} 
            primaryColor={getCurrentChakraColor()} 
            isPlaying={isPlaying}
            binauralDelta={selectedBinaural.delta}
            selectedFrequency={selectedSolfeggio}
            settings={vizSettings}
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
            <h1 className="text-xl md:text-2xl font-serif text-gold-400 tracking-wider">AETHERIA <span className="text-[10px] text-slate-500 ml-2">v5.5</span></h1>
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
                                  <p className="text-slate-500 text-xs uppercase tracking-widest">Aetheria: Philosophy & Science</p>
                              </div>
                          </div>
                          <button onClick={() => setShowInfo(false)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
                              <X size={24} />
                          </button>
                      </div>
                      
                      {/* Modal Content - Scrollable */}
                      <div className="flex-1 overflow-y-auto custom-scrollbar">
                          
                          {/* Intro Banner */}
                          <div className="p-8 pb-4">
                              <div className="bg-gradient-to-r from-slate-900 to-slate-900/50 border-l-4 border-gold-500 p-6 rounded-r-lg">
                                <p className="text-lg text-slate-200 leading-relaxed font-serif italic">
                                    "{UNIFIED_THEORY.intro}"
                                </p>
                              </div>
                          </div>

                          <div className="px-8 pb-12 space-y-12">
                              {/* Complete Harmonic Frequency System Overview */}
                              <section className="bg-gradient-to-r from-slate-900/50 to-slate-800/30 border border-gold-500/30 rounded-2xl p-8">
                                  <div className="flex items-center gap-3 mb-6">
                                    <div className="p-3 bg-gold-500/20 rounded-full border border-gold-500/30">
                                      <Target className="text-gold-400" size={28}/>
                                    </div>
                                    <div>
                                      <h3 className="text-3xl font-bold text-gold-400 font-serif">The Complete Harmonic Frequency System</h3>
                                      <p className="text-sm text-gold-500/80 uppercase tracking-widest mt-1">9 Orders • 27 Frequencies • 114 Chakra Points</p>
                                    </div>
                                  </div>
                                  
                                  <div className="mb-8 p-6 bg-slate-950/50 border border-slate-700 rounded-xl">
                                    <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                      <Activity className="text-blue-400" size={20} />
                                      The Sacred Step Pattern
                                    </h4>
                                    <p className="text-slate-300 mb-4">
                                      The frequencies within each order follow a precise mathematical progression:
                                    </p>
                                    <div className="bg-black/50 p-4 rounded-lg border border-slate-800 font-mono text-sm">
                                      <div className="text-gold-400">Frequency 1 → +111 Hz → Frequency 2 → +243 Hz → Frequency 3 → +324 Hz → Next Order</div>
                                      <div className="text-blue-400 mt-2">Total step per order: 111 + 243 + 324 = 678 Hz (digital root: 3)</div>
                                      <div className="text-purple-400 mt-2">Digital roots of steps: 111 → 3 | 243 → 9 | 324 → 9</div>
                                      <div className="text-green-400 mt-2">The pattern 3-9-9 sums to 21, which reduces to 3. Three is the engine of progression.</div>
                                    </div>
                                    <div className="mt-4 text-xs text-slate-500 italic text-center border-t border-slate-800 pt-4">
                                      "If you only knew the magnificence of 3, 6, and 9, you would have the key to the universe." — Nikola Tesla
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    {/* Digital Root Pattern */}
                                    <div className="bg-slate-800/30 border border-purple-500/30 rounded-xl p-5">
                                      <h4 className="text-lg font-bold text-purple-400 mb-3 flex items-center gap-2">
                                        <Hexagon size={18} />
                                        Digital Root Pattern
                                      </h4>
                                      <div className="space-y-3 text-sm">
                                        <div className="flex justify-between">
                                          <span className="text-slate-300">Orders 1-3 (Physical)</span>
                                          <span className="text-blue-400 font-mono">3-6-9 (cycling)</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-300">Order 4 (Heart Entry)</span>
                                          <span className="text-red-400 font-mono">3-3-3 (pure)</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-300">Order 5 (Heart Expansion)</span>
                                          <span className="text-orange-400 font-mono">6-6-6 (pure)</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-300">Order 6 (Head Entry)</span>
                                          <span className="text-yellow-400 font-mono">9-9-9 (pure)</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-300">Order 7 (Head Crown)</span>
                                          <span className="text-green-400 font-mono">3-3-3 (new foundation)</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-300">Order 8 (Transpersonal)</span>
                                          <span className="text-cyan-400 font-mono">6-6-6 (divine harmony)</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-300">Order 9 (SOURCE)</span>
                                          <span className="text-violet-400 font-mono">9-9-9 (infinite completion)</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Numerical Summary */}
                                    <div className="bg-slate-800/30 border border-green-500/30 rounded-xl p-5">
                                      <h4 className="text-lg font-bold text-green-400 mb-3 flex items-center gap-2">
                                        <BarChart3 size={18} />
                                        Numerical Summary
                                      </h4>
                                      <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                          <span className="text-slate-300">Total Orders</span>
                                          <span className="text-gold-400 font-mono">9 (digital root: 9)</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-300">Total Frequencies</span>
                                          <span className="text-gold-400 font-mono">27 (digital root: 9) = 3³</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-300">Physical Chakras</span>
                                          <span className="text-blue-400 font-mono">108 (digital root: 9)</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-300">Transpersonal Gates</span>
                                          <span className="text-purple-400 font-mono">6 (digital root: 6)</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-300">Total Focal Points</span>
                                          <span className="text-green-400 font-mono">114 (digital root: 6)</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-300">Minor Chakras</span>
                                          <span className="text-orange-400 font-mono">21 (digital root: 3) = 7 × 3</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-300">Step Pattern Sum</span>
                                          <span className="text-red-400 font-mono">678 Hz (digital root: 3)</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-300">Frequency Range</span>
                                          <span className="text-cyan-400 font-mono">174 Hz → 5031 Hz</span>
                                        </div>
                                      </div>
                                      <div className="mt-4 p-3 bg-gold-500/10 border border-gold-500/30 rounded-lg text-center">
                                        <div className="text-xs text-gold-400 font-bold uppercase tracking-widest mb-1">Sacred Truth</div>
                                        <div className="text-sm text-white font-bold">ALL NUMBERS REDUCE TO 3, 6, OR 9</div>
                                      </div>
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

                              {/* Section 1: The 9 Orders of Consciousness (Complete Solfeggio) */}
                              <section>
                                  <div className="flex items-center gap-3 mb-6">
                                    <div className="p-2 bg-blue-500/10 rounded-full"><User className="text-blue-400" size={24}/></div>
                                    <h3 className="text-2xl font-bold text-white">The 9 Orders of Consciousness: Complete Solfeggio Scale</h3>
                                  </div>
                                  <p className="text-slate-400 mb-6 leading-relaxed max-w-2xl">
                                    The Complete Harmonic Frequency System encompasses 9 Orders of consciousness, each containing 3 precisely tuned frequencies that follow the sacred 111Hz step pattern. This creates a total of 27 frequencies spanning from quantum foam to Source consciousness.
                                  </p>

                                  {/* Group by Order/Regime */}
                                  <div className="space-y-8">
                                    {/* GUT REGIME - Physical Body (Orders 1-3) */}
                                    <div className="border border-red-500/30 rounded-2xl overflow-hidden bg-red-500/5">
                                      <div className="bg-red-500/10 p-4 border-b border-red-500/30">
                                        <h4 className="text-xl font-bold text-red-400 flex items-center gap-2">
                                          <Heart className="text-red-500" size={20} />
                                          GUT REGIME — Physical Body — Orders 1-3
                                        </h4>
                                        <p className="text-sm text-red-300 mt-1">Chakras: Root, Sacral, Solar Plexus | Body: Gut, lower organs, physical foundation</p>
                                      </div>
                                      <div className="p-4">
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                          {SOLFEGGIO_INFO.filter(s => ['First', 'Second', 'Third'].includes(s.order)).map(s => (
                                            <div key={s.freq} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 hover:border-red-500/50 transition-colors group">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-xl font-bold font-mono" style={{color: s.color}}>{s.freq} Hz</span>
                                                    <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-red-500/20 px-2 py-1 rounded">{s.order} Order</span>
                                                </div>
                                                <h5 className="text-white font-medium mb-1">{s.benefit}</h5>
                                                <p className="text-xs text-slate-400 mb-3 leading-relaxed">{s.description}</p>
                                                <div className="text-[10px] text-slate-500 pt-3 border-t border-slate-800/50">
                                                    <strong className="text-slate-400">Chakra:</strong> {s.chakra}<br />
                                                    <strong className="text-slate-400">Anatomy:</strong> {s.anatomy}
                                                </div>
                                            </div>
                                          ))}
                                        </div>
                                        <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-500/50 rounded-lg">
                                          <div className="flex items-center gap-2 text-yellow-400 text-sm font-bold mb-1">
                                            <AlertTriangle size={16} />
                                            TRANSITION ZONE: 963 Hz → 1074 Hz (GUT → HEART)
                                          </div>
                                          <p className="text-xs text-yellow-300">Phase shift region - Prepare for consciousness elevation</p>
                                        </div>
                                      </div>
                                    </div>

                                    {/* HEART REGIME - Emotional Body (Orders 4-5) */}
                                    <div className="border border-green-500/30 rounded-2xl overflow-hidden bg-green-500/5">
                                      <div className="bg-green-500/10 p-4 border-b border-green-500/30">
                                        <h4 className="text-xl font-bold text-green-400 flex items-center gap-2">
                                          <Heart className="text-green-500" size={20} />
                                          HEART REGIME — Emotional Body — Orders 4-5
                                        </h4>
                                        <p className="text-sm text-green-300 mt-1">Chakras: Heart, Throat | Body: Heart, lungs, thymus, vocal expression</p>
                                      </div>
                                      <div className="p-4">
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                          {SOLFEGGIO_INFO.filter(s => ['Fourth', 'Fifth'].includes(s.order)).map(s => (
                                            <div key={s.freq} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 hover:border-green-500/50 transition-colors group">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-xl font-bold font-mono" style={{color: s.color}}>{s.freq} Hz</span>
                                                    <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-green-500/20 px-2 py-1 rounded">{s.order} Order</span>
                                                </div>
                                                <h5 className="text-white font-medium mb-1">{s.benefit}</h5>
                                                <p className="text-xs text-slate-400 mb-3 leading-relaxed">{s.description}</p>
                                                <div className="text-[10px] text-slate-500 pt-3 border-t border-slate-800/50">
                                                    <strong className="text-slate-400">Chakra:</strong> {s.chakra}<br />
                                                    <strong className="text-slate-400">Anatomy:</strong> {s.anatomy}
                                                </div>
                                            </div>
                                          ))}
                                        </div>
                                        <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-500/50 rounded-lg">
                                          <div className="flex items-center gap-2 text-yellow-400 text-sm font-bold mb-1">
                                            <AlertTriangle size={16} />
                                            TRANSITION ZONE: 2319 Hz → 2430 Hz (HEART → HEAD)
                                          </div>
                                          <p className="text-xs text-yellow-300">Phase shift region - Mental body activation begins</p>
                                        </div>
                                      </div>
                                    </div>

                                    {/* HEAD REGIME - Mental Body (Orders 6-7) */}
                                    <div className="border border-purple-500/30 rounded-2xl overflow-hidden bg-purple-500/5">
                                      <div className="bg-purple-500/10 p-4 border-b border-purple-500/30">
                                        <h4 className="text-xl font-bold text-purple-400 flex items-center gap-2">
                                          <Eye className="text-purple-500" size={20} />
                                          HEAD REGIME — Mental Body — Orders 6-7
                                        </h4>
                                        <p className="text-sm text-purple-300 mt-1">Chakras: Third Eye, Crown | Body: Pineal, pituitary, brain, higher consciousness</p>
                                      </div>
                                      <div className="p-4">
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                          {SOLFEGGIO_INFO.filter(s => ['Sixth', 'Seventh'].includes(s.order)).map(s => (
                                            <div key={s.freq} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 hover:border-purple-500/50 transition-colors group">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-xl font-bold font-mono" style={{color: s.color}}>{s.freq} Hz</span>
                                                    <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-purple-500/20 px-2 py-1 rounded">{s.order} Order</span>
                                                </div>
                                                <h5 className="text-white font-medium mb-1">{s.benefit}</h5>
                                                <p className="text-xs text-slate-400 mb-3 leading-relaxed">{s.description}</p>
                                                <div className="text-[10px] text-slate-500 pt-3 border-t border-slate-800/50">
                                                    <strong className="text-slate-400">Chakra:</strong> {s.chakra}<br />
                                                    <strong className="text-slate-400">Anatomy:</strong> {s.anatomy}
                                                </div>
                                            </div>
                                          ))}
                                        </div>
                                        <div className="mt-4 p-3 bg-gold-900/20 border border-gold-500/50 rounded-lg">
                                          <div className="flex items-center gap-2 text-gold-400 text-sm font-bold mb-1">
                                            <Sparkles size={16} />
                                            TRANSCENDENCE THRESHOLD: 3675 Hz → 3786 Hz (Physical → Transpersonal)
                                          </div>
                                          <p className="text-xs text-gold-300">The great transition beyond physical form - Transpersonal realm entry</p>
                                        </div>
                                      </div>
                                    </div>

                                    {/* TRANSPERSONAL REALM - Beyond Physical Form (Orders 8-9) */}
                                    <div className="border border-violet-500/30 rounded-2xl overflow-hidden bg-violet-500/5">
                                      <div className="bg-violet-500/10 p-4 border-b border-violet-500/30">
                                        <h4 className="text-xl font-bold text-violet-400 flex items-center gap-2">
                                          <Sparkles className="text-violet-500" size={20} />
                                          TRANSPERSONAL REALM — Beyond Physical Form — Orders 8-9
                                        </h4>
                                        <p className="text-sm text-violet-300 mt-1">Gates: 6 Transpersonal Chakras above Crown | Body: Etheric, Astral, Causal bodies</p>
                                      </div>
                                      <div className="p-4">
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                          {SOLFEGGIO_INFO.filter(s => ['Eighth', 'Ninth'].includes(s.order)).map(s => (
                                            <div key={s.freq} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 hover:border-violet-500/50 transition-colors group relative">
                                                <div className="absolute top-2 right-2">
                                                  <AlertTriangle size={12} className="text-red-400" title="Expert Level Required" />
                                                </div>
                                                <div className="flex justify-between items-center mb-2 pr-6">
                                                    <span className="text-xl font-bold font-mono" style={{color: s.color}}>{s.freq} Hz</span>
                                                    <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-violet-500/20 px-2 py-1 rounded">{s.order} Order</span>
                                                </div>
                                                <h5 className="text-white font-medium mb-1">{s.benefit}</h5>
                                                <p className="text-xs text-slate-400 mb-3 leading-relaxed">{s.description}</p>
                                                <div className="text-[10px] text-slate-500 pt-3 border-t border-slate-800/50">
                                                    <strong className="text-slate-400">Gate:</strong> {s.chakra}<br />
                                                    <strong className="text-slate-400">Body:</strong> {s.anatomy}
                                                </div>
                                                {s.freq === 5031 && (
                                                  <div className="mt-2 p-2 bg-gold-500/20 border border-gold-500/50 rounded text-center">
                                                    <div className="text-[9px] text-gold-400 font-bold uppercase tracking-widest">SOURCE FREQUENCY</div>
                                                  </div>
                                                )}
                                            </div>
                                          ))}
                                        </div>
                                        <div className="mt-4 p-4 bg-gold-900/20 border border-gold-500/50 rounded-lg text-center">
                                          <div className="flex items-center justify-center gap-2 text-gold-400 text-lg font-bold mb-2">
                                            <Target size={20} />
                                            5031 Hz - Theoretical Frequency of Source/Infinite Unity
                                          </div>
                                          <p className="text-sm text-gold-300">The completion of the 9-Order journey and the ultimate frequency of divine consciousness</p>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                              </section>

                              {/* Section 2: The Map (Tree of Life) */}
                              <section>
                                  <div className="flex items-center gap-3 mb-6">
                                    <div className="p-2 bg-purple-500/10 rounded-full"><Map className="text-purple-400" size={24}/></div>
                                    <h3 className="text-2xl font-bold text-white">The Map: Tree of Life (Sephirot)</h3>
                                  </div>
                                  <p className="text-slate-400 mb-6 leading-relaxed max-w-2xl">The blueprint of creation. A map of how the Divine manifests into the physical world through ten distinct attributes (Sephirot).</p>
                                  
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                      {SEPHIROT_INFO.map(node => (
                                          <div key={node.name} className="flex gap-4 p-4 bg-slate-900/30 rounded-xl border border-slate-800/50 hover:bg-slate-900 transition-colors">
                                              <div className="w-1 h-full rounded-full shrink-0" style={{background: node.color}}></div>
                                              <div>
                                                  <div className="flex items-baseline gap-2 mb-1">
                                                      <h4 className="text-lg font-bold text-slate-200">{node.name}</h4>
                                                      <span className="text-xs text-gold-500 font-serif italic">{node.title}</span>
                                                  </div>
                                                  <p className="text-xs text-slate-400 mb-2">{node.meaning}</p>
                                                  <p className="text-xs text-slate-500 leading-relaxed italic">"{node.desc}"</p>
                                              </div>
                                          </div>
                                      ))}
                                  </div>
                              </section>

                              {/* Section 3: The Form (Geometry) */}
                              <section>
                                  <div className="flex items-center gap-3 mb-6">
                                    <div className="p-2 bg-red-500/10 rounded-full"><Box className="text-red-400" size={24}/></div>
                                    <h3 className="text-2xl font-bold text-white">The Form: Sacred Geometry</h3>
                                  </div>
                                  
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
                      </div>
                  </div>
              </div>
          )}

          <aside className={`
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

               <div className="grid grid-cols-2 gap-2 mb-3">
                   <label className="flex items-center justify-center gap-2 p-3 border border-slate-700 rounded-lg cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all active:scale-95 group text-xs">
                      <Upload size={16} className="group-hover:animate-bounce" />
                      <span className="font-semibold">Import Folder</span>
                      <input 
                        type="file" 
                        {...({ webkitdirectory: "", directory: "" } as any)}
                        multiple 
                        className="hidden" 
                        onChange={(e) => { handleFileUpload(e); if(window.innerWidth < 768) setShowSidebar(false); }} 
                      />
                   </label>
                   
                   <label className="flex items-center justify-center gap-2 p-3 border border-slate-700 rounded-lg cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all active:scale-95 text-xs">
                      <FilePlus size={16} />
                      <span className="font-semibold">Add Files</span>
                      <input 
                        type="file" 
                        multiple 
                        className="hidden" 
                        onChange={(e) => { handleFileUpload(e); if(window.innerWidth < 768) setShowSidebar(false); }} 
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
                           className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-500 hover:text-white"
                       >
                           <X size={14} />
                       </button>
                   )}
               </div>
               
               {/* Diagnostic Button */}
               <button 
                onClick={showPlaylistDiagnostics}
                className={`mb-3 w-full flex items-center justify-center gap-2 text-xs py-2 rounded-lg font-medium tracking-wide transition-all active:scale-95 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 hover:border-slate-600`}
               >
                 <Activity size={14} />
                 Playlist Diagnostics
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
                     Beginner Alignment
                   </button>
                   
                   <button 
                    onClick={generateFullLibraryAlignment}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-purple-400 hover:border-purple-500 transition-all active:scale-95"
                   >
                     <Flower2 size={16} className="mb-1 text-purple-500" />
                     Full Alignment
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
                    onClick={generateDNAResonancePlaylist}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-green-400 hover:border-green-500 transition-all active:scale-95"
                   >
                     <Hexagon size={16} className="mb-1 text-green-500" />
                     <span>528Hz Filter</span>
                     <span className="text-[8px] text-green-400">DNA Harmonic</span>
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

               <button 
                onClick={restoreLibrary}
                className={`mt-2 w-full flex items-center justify-center gap-2 text-xs py-2 rounded-lg font-medium tracking-wide transition-all active:scale-95 bg-slate-800 hover:bg-slate-700 text-slate-300`}
               >
                 <RefreshCw size={14} />
                 Restore Library
               </button>
            </div>
            
            <div className="p-2 space-y-1 pb-32">
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
              {(searchTerm ? filteredPlaylist : playlist).map((song, displayIdx) => {
                // Find the actual index in the full playlist
                const actualIdx = playlist.findIndex(s => s.id === song.id);
                return (
                  <div 
                    key={song.id}
                    className={`p-3 rounded-lg text-sm flex items-center gap-3 transition-all group ${
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
          </aside>

          {showSettings && (
            <div className="absolute inset-y-0 right-0 z-30 w-full md:w-96 bg-black/95 backdrop-blur-xl border-l border-slate-800 flex flex-col shadow-2xl transform transition-transform animate-in slide-in-from-right duration-300">
                <div className="flex justify-between items-start p-6 border-b border-slate-800">
                  <h3 className="text-gold-500 font-serif text-xl">Harmonic Control</h3>
                  <button onClick={() => { setShowSettings(false); }} className="p-2 hover:bg-slate-800 rounded-full"><X className="text-slate-500 hover:text-white" /></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar pb-32">
                   
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
                                    <div className="grid grid-cols-3 gap-1">
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, colorMode: 'chakra'})}
                                            className={`text-[10px] py-1 rounded border ${vizSettings.colorMode === 'chakra' ? 'bg-blue-500 text-white border-blue-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
                                            title="Chakra Colors"
                                        >
                                            Chakra
                                        </button>
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, colorMode: 'cycle'})}
                                            className={`text-[10px] py-1 rounded border ${vizSettings.colorMode === 'cycle' ? 'bg-purple-500 text-white border-purple-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
                                            title="RGB Cycle Sync"
                                        >
                                            Hypnotic
                                        </button>
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, colorMode: 'static'})}
                                            className={`text-[10px] py-1 rounded border ${vizSettings.colorMode === 'static' ? 'bg-gold-500 text-black border-gold-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
                                            title="Single Color"
                                        >
                                            Static
                                        </button>
                                    </div>
                                </div>

                             </div>
                          </div>
                      )}
                   </div>

                  <div>
                    <label className="text-xs uppercase tracking-widest text-slate-500 mb-4 block font-bold">Solfeggio Frequency Layer</label>
                    
                    {/* Traditional Solfeggio (First-Third Order) */}
                    <div className="mb-4">
                      <div className="text-[10px] text-slate-400 mb-2 uppercase tracking-widest">Traditional Scale (Safe)</div>
                      <div className="grid grid-cols-3 gap-2">
                        {SOLFEGGIO_INFO.filter(s => ['First', 'Second', 'Third'].includes(s.order)).map((s) => (
                          <button
                            key={s.freq}
                            onClick={() => setSelectedSolfeggio(s.freq)}
                            className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all active:scale-95 ${selectedSolfeggio === s.freq ? 'bg-gold-600 text-black border-gold-600 shadow-lg shadow-gold-500/20' : 'border-slate-800 bg-slate-900 hover:border-gold-500'}`}
                          >
                            {s.freq}
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
                              onClick={() => setSelectedSolfeggio(s.freq)}
                              className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all active:scale-95 ${selectedSolfeggio === s.freq ? 'bg-yellow-600 text-black border-yellow-600 shadow-lg shadow-yellow-500/20' : 'border-yellow-800 bg-yellow-900/20 hover:border-yellow-500 text-yellow-300'}`}
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
                                onClick={() => setSelectedSolfeggio(s.freq)}
                                className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all active:scale-95 ${selectedSolfeggio === s.freq ? 'bg-orange-600 text-black border-orange-600 shadow-lg shadow-orange-500/20' : 'border-orange-800 bg-orange-900/20 hover:border-orange-500 text-orange-300'}`}
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
                                onClick={() => setSelectedSolfeggio(s.freq)}
                                className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all active:scale-95 ${selectedSolfeggio === s.freq ? 'bg-red-600 text-white border-red-600 shadow-lg shadow-red-500/20' : 'border-red-800 bg-red-900/20 hover:border-red-500 text-red-300'}`}
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
                                onClick={() => setSelectedSolfeggio(s.freq)}
                                className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all active:scale-95 ${selectedSolfeggio === s.freq ? 'bg-violet-600 text-white border-violet-600 shadow-lg shadow-violet-500/20' : 'border-violet-800 bg-violet-900/20 hover:border-violet-500 text-violet-300'}`}
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
                                onClick={() => setSelectedSolfeggio(s.freq)}
                                className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all active:scale-95 ${selectedSolfeggio === s.freq ? 'bg-cyan-600 text-white border-cyan-600 shadow-lg shadow-cyan-500/20' : 'border-cyan-800 bg-cyan-900/20 hover:border-cyan-500 text-cyan-300'}`}
                              >
                                {s.freq}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Ninth Order - SOURCE */}
                        <div className="mb-4">
                          <div className="text-[10px] text-pink-400 mb-2 uppercase tracking-widest flex items-center gap-1">
                            <AlertTriangle size={10} />
                            <Sparkles size={10} />
                            Ninth Order (SOURCE - Gates 4-6)
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Ninth').map((s) => (
                              <button
                                key={s.freq}
                                onClick={() => setSelectedSolfeggio(s.freq)}
                                className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all active:scale-95 relative ${selectedSolfeggio === s.freq ? 'bg-pink-600 text-white border-pink-600 shadow-lg shadow-pink-500/20' : 'border-pink-800 bg-pink-900/20 hover:border-pink-500 text-pink-300'}`}
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
                  {/* Temporary fallback content for testing */}
                  <div className="text-white">
                    <h3 className="text-lg font-bold mb-4">Frequency Selection</h3>
                    <p className="mb-4">Advanced frequency selector loading...</p>
                    
                    {/* Traditional Solfeggio */}
                    <div className="mb-4">
                      <h4 className="text-sm font-bold text-slate-300 mb-2">Traditional Solfeggio</h4>
                      <div className="grid grid-cols-3 gap-2">
                        {SOLFEGGIO_INFO.filter(s => ['First', 'Second', 'Third'].includes(s.order)).map((s) => (
                          <button
                            key={s.freq}
                            onClick={() => {
                              setSelectedSolfeggio(s.freq);
                              setShowFrequencySelector(false);
                            }}
                            className="py-2 px-2 bg-slate-800 hover:bg-gold-600 text-white rounded border border-slate-600 transition-colors text-xs"
                          >
                            {s.freq}Hz
                          </button>
                        ))}
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
                          {SOLFEGGIO_INFO.filter(s => s.order === 'Fourth').map((s) => (
                            <button
                              key={s.freq}
                              onClick={() => {
                                setSelectedSolfeggio(s.freq);
                                setShowFrequencySelector(false);
                              }}
                              className="py-2 px-2 bg-yellow-900/30 hover:bg-yellow-600 text-yellow-300 hover:text-black rounded border border-yellow-600 transition-colors text-xs"
                            >
                              {s.freq}Hz
                            </button>
                          ))}
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
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Fifth').map((s) => (
                              <button
                                key={s.freq}
                                onClick={() => {
                                  setSelectedSolfeggio(s.freq);
                                  setShowFrequencySelector(false);
                                }}
                                className="py-2 px-2 bg-orange-900/30 hover:bg-orange-600 text-orange-300 hover:text-black rounded border border-orange-600 transition-colors text-xs"
                              >
                                {s.freq}Hz
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="mb-4">
                          <h4 className="text-sm font-bold text-red-400 mb-2 flex items-center gap-1">
                            <AlertTriangle size={14} />
                            Sixth Order (Research)
                          </h4>
                          <div className="grid grid-cols-3 gap-2">
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Sixth').map((s) => (
                              <button
                                key={s.freq}
                                onClick={() => {
                                  setSelectedSolfeggio(s.freq);
                                  setShowFrequencySelector(false);
                                }}
                                className="py-2 px-2 bg-red-900/30 hover:bg-red-600 text-red-300 hover:text-white rounded border border-red-600 transition-colors text-xs"
                              >
                                {s.freq}Hz
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="mb-4">
                          <h4 className="text-sm font-bold text-violet-400 mb-2 flex items-center gap-1">
                            <AlertTriangle size={14} />
                            Seventh Order (Master)
                          </h4>
                          <div className="grid grid-cols-3 gap-2">
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Seventh').map((s) => (
                              <button
                                key={s.freq}
                                onClick={() => {
                                  setSelectedSolfeggio(s.freq);
                                  setShowFrequencySelector(false);
                                }}
                                className="py-2 px-2 bg-violet-900/30 hover:bg-violet-600 text-violet-300 hover:text-white rounded border border-violet-600 transition-colors text-xs"
                              >
                                {s.freq}Hz
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="mb-4">
                          <h4 className="text-sm font-bold text-cyan-400 mb-2 flex items-center gap-1">
                            <AlertTriangle size={14} />
                            Eighth Order (Transpersonal)
                          </h4>
                          <div className="grid grid-cols-3 gap-2">
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Eighth').map((s) => (
                              <button
                                key={s.freq}
                                onClick={() => {
                                  setSelectedSolfeggio(s.freq);
                                  setShowFrequencySelector(false);
                                }}
                                className="py-2 px-2 bg-cyan-900/30 hover:bg-cyan-600 text-cyan-300 hover:text-white rounded border border-cyan-600 transition-colors text-xs"
                              >
                                {s.freq}Hz
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="mb-4">
                          <h4 className="text-sm font-bold text-pink-400 mb-2 flex items-center gap-1">
                            <AlertTriangle size={14} />
                            <Sparkles size={14} />
                            Ninth Order (SOURCE)
                          </h4>
                          <div className="grid grid-cols-3 gap-2">
                            {SOLFEGGIO_INFO.filter(s => s.order === 'Ninth').map((s) => (
                              <button
                                key={s.freq}
                                onClick={() => {
                                  setSelectedSolfeggio(s.freq);
                                  setShowFrequencySelector(false);
                                }}
                                className={`py-2 px-2 bg-pink-900/30 hover:bg-pink-600 text-pink-300 hover:text-white rounded border border-pink-600 transition-colors text-xs relative ${s.freq === 5031 ? 'ring-2 ring-gold-500/50' : ''}`}
                              >
                                {s.freq}Hz
                                {s.freq === 5031 && (
                                  <div className="absolute -top-1 -right-1 w-2 h-2 bg-gold-500 rounded-full"></div>
                                )}
                              </button>
                            ))}
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
                        {selectedSolfeggio >= 1074 ? (
                          <>
                            <div>• Keep volume low (feeling vs hearing)</div>
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
          
          {/* NEW FOOTER - SNAPPED TO BOTTOM */}
          <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none flex justify-center">
             <div className="pointer-events-auto w-full bg-black/90 backdrop-blur-xl border-t border-slate-800 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] transition-all duration-300 group">
                
                {/* Seek Bar */}
                <div 
                    className="w-full h-1 hover:h-2 bg-slate-800/50 cursor-pointer relative transition-all group-hover:h-2"
                    onClick={handleSeek}
                >
                    <div className="absolute inset-y-0 left-0 bg-gold-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]" style={{width: `${(currTime / (currDuration || 1)) * 100}%`}}></div>
                </div>

                <div className="px-3 py-3 flex flex-col items-center gap-2">
                    
                    {/* Top Row: Info */}
                    <div className="flex flex-wrap justify-center items-center gap-x-3 gap-y-1 text-[10px] font-medium text-slate-400">
                        <span className="text-slate-200 truncate max-w-[150px] sm:max-w-[300px] font-bold">
                            {playlist[currentSongIndex]?.name || "Aetheria Harmonic Player"}
                        </span>
                        
                        <div className="flex items-center gap-2">
                         <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                           subtleResonanceMode 
                             ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' 
                             : 'bg-gold-500/10 text-gold-500 border-gold-500/20'
                         }`}
                         title={`Sacred Geometry: ${getCurrentSacredGeometry().shape} (${getCurrentSacredGeometry().element} Element)`}>
                            <Activity size={8} /> 
                            {playlist[currentSongIndex]?.closestSolfeggio || selectedSolfeggio}Hz
                            {subtleResonanceMode && <Zap size={8} />}
                         </span>
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
                        </div>
                    </div>

                    {/* Bottom Row: Controls */}
                    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 w-full">
                        
                        {/* Playback Controls */}
                        <div className="flex items-center gap-3">
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