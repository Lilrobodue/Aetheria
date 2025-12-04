import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, 
  Upload, Settings, Info, Activity, Volume2, Maximize2, Minimize2, 
  Circle, Zap, X, Menu, Eye, EyeOff, ChevronDown, ChevronUp, BarChart3, Loader2, Sparkles, Sliders, Wind, Activity as PulseIcon, Waves, Wand2, Search, Video, Mic, Monitor, RefreshCw, Flame, Flower2, Layers, Heart, Smile, Moon, Droplets, FilePlus, RotateCw, ArrowUpCircle, Hexagon, AlertTriangle, CircleHelp, ChevronRight, ChevronLeft, BookOpen, User, Map, Box
} from 'lucide-react';
import { Song, SolfeggioFreq, BinauralPreset, VizSettings } from './types';
import { SOLFEGGIO_INFO, BINAURAL_PRESETS, PITCH_SHIFT_FACTOR, UNIFIED_THEORY, SEPHIROT_INFO, GEOMETRY_INFO } from './constants';
import Visualizer from './components/Visualizer';

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

const detectDominantFrequency = async (buffer: AudioBuffer): Promise<number> => {
  try {
    const sampleDuration = 3;
    const offlineCtx = new OfflineAudioContext(1, 44100 * sampleDuration, 44100); 
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    
    const analyser = offlineCtx.createAnalyser();
    analyser.fftSize = 32768; 
    analyser.smoothingTimeConstant = 0.1;
    
    source.connect(analyser);
    analyser.connect(offlineCtx.destination);
    
    // Sample from the middle of the track to avoid intro/outro silence
    const startOffset = Math.min(buffer.duration / 2, 30);
    source.start(0, startOffset, sampleDuration);
    
    await offlineCtx.startRendering();
    
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
      // This prevents most modern tracks from defaulting to 174Hz/285Hz just because the kick is loud
      if (freq < 150) {
          magnitude -= 25; 
      } else if (freq < 300) {
          magnitude -= 10;
      } else if (freq > 3000) {
          magnitude -= 10; // Penalize high hiss/air
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
    
    return freq;
  } catch (e) {
    console.error("Analysis failed", e);
    return 0;
  }
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
            <div className="bg-slate-900 border border-gold-500/30 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                
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


  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    const newSongs: Song[] = [];
    const fileList = (Array.from(files) as File[]).filter(f => f.type.includes('audio') || f.name.endsWith('.wav'));
    const totalFiles = fileList.length;
    const BATCH_SIZE = 20;

    for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
      const batch = fileList.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (file) => {
        const duration = await getAudioDuration(file);
        newSongs.push({
          file: file,
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name.replace(/\.[^/.]+$/, ""),
          duration: duration
        });
      }));
      setUploadProgress(Math.round(((i + batch.length) / totalFiles) * 100));
      await new Promise(r => setTimeout(r, 10));
    }

    setPlaylist(prev => {
        const updated = [...prev, ...newSongs];
        setOriginalPlaylist(updated); 
        return updated;
    });
    
    setIsUploading(false);
    setUploadProgress(0);
    event.target.value = ''; 
  };

  const scanLibrary = async () => {
    initAudio();
    if (!playlist.length || !audioCtxRef.current) return;
    setIsScanning(true);
    setScanProgress(0);

    const newPlaylist = [...playlist];
    
    for (let i = 0; i < newPlaylist.length; i++) {
        if (newPlaylist[i].harmonicFreq) continue; 

        try {
            const file = newPlaylist[i].file;
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);
            
            const freq = await detectDominantFrequency(audioBuffer);
            const solfeggio = getHarmonicSolfeggio(freq);
            const deviation = Math.abs(freq - solfeggio);
            
            newPlaylist[i] = {
                ...newPlaylist[i],
                harmonicFreq: freq,
                closestSolfeggio: solfeggio,
                harmonicDeviation: deviation
            };
            
        } catch (e) {
            console.warn("Could not analyze", newPlaylist[i].name, e);
        }
        
        setScanProgress(Math.round(((i + 1) / newPlaylist.length) * 100));
        await new Promise(r => setTimeout(r, 10));
    }
    
    setPlaylist(newPlaylist);
    setOriginalPlaylist(newPlaylist); 
    setIsScanning(false);
    setScanProgress(0);
  };

  const generateFilteredPlaylist = (filterFn: (song: Song) => boolean, name: string) => {
      const candidates = originalPlaylist.filter(filterFn);
      if (candidates.length > 0) {
          setPlaylist(candidates);
          setUseChakraOrder(true);
          setCurrentSongIndex(0);
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
              candidates.sort((a, b) => (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999));
              const bestMatch = candidates[0];
              journeyPlaylist.push(bestMatch);
              usedIds.add(bestMatch.id);
          }
      });
      
      if (journeyPlaylist.length > 0) {
          setPlaylist(journeyPlaylist);
          setUseChakraOrder(true);
          setCurrentSongIndex(0);
          setVizSettings(prev => ({ ...prev, showTreeOfLife: true }));
          playTrackRef.current(0, journeyPlaylist); 
          if(window.innerWidth < 768) setShowSidebar(false);
      } else {
          alert("Not enough analyzed songs. Try scanning library first.");
      }
  };

  const generateWellnessPlaylist = () => {
    generateFilteredPlaylist(
        s => [174, 285, 528].includes(s.closestSolfeggio || 0), 
        'Deep Healing'
    );
  };

  const generateMoodPlaylist = () => {
    generateFilteredPlaylist(
        s => [396, 417, 639].includes(s.closestSolfeggio || 0), 
        'Mood Elevation'
    );
  };

  const generateMeditationPlaylist = () => {
    generateFilteredPlaylist(
        s => [741, 852, 963].includes(s.closestSolfeggio || 0), 
        'Deep Meditation'
    );
  };

  const restoreLibrary = () => {
      if (originalPlaylist.length > 0) {
          setPlaylist(originalPlaylist);
          setUseChakraOrder(false);
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
    if (!freq) {
        freq = await detectDominantFrequency(audioBuffer);
    }
    
    const autoFreq = getHarmonicSolfeggio(freq || 0);
    setSelectedSolfeggio(autoFreq);
    setIsAnalyzing(false);

    playBuffer(audioBuffer, 0);
    setCurrentSongIndex(index);
  };

  useEffect(() => {
      playTrackRef.current = playTrack;
  }, [playTrack]);

  // Centralized Play Next Logic for Shuffle/Loop
  const playNext = useCallback(() => {
    const { playlist, currentSongIndex, isShuffle, isLoop, shuffledIndices, shufflePos } = stateRef.current;
    if (playlist.length === 0) return;

    if (isShuffle) {
        // Shuffle Mode Logic
        // Ensure we have a valid shuffle list
        let currentIndices = shuffledIndices;
        let currentPos = shufflePos;

        if (currentIndices.length !== playlist.length) {
             // Fallback if state drifted
             currentIndices = getShuffledIndices(playlist.length);
             const found = currentIndices.indexOf(currentSongIndex);
             currentPos = found !== -1 ? found : 0;
             setShuffledIndices(currentIndices);
        }

        const nextPos = currentPos + 1;

        if (nextPos >= currentIndices.length) {
            // End of shuffled list
            if (isLoop) {
                // Loop: Generate NEW random order and start from 0 (Carry the vibes refresh)
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
            setShufflePos(nextPos);
            playTrack(currentIndices[nextPos]);
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

  const getTotalDuration = () => {
    const totalSeconds = playlist.reduce((acc, song) => acc + (song.duration || 0), 0);
    return formatDuration(totalSeconds);
  };

  return (
    <div className={`relative min-h-screen bg-black text-slate-200 font-sans overflow-hidden ${isFullScreen ? 'h-screen' : ''}`}>
      
      {/* Disclaimer Modal */}
      {!disclaimerAccepted && (
        <div className="fixed inset-0 z-[150] bg-black/95 flex items-center justify-center p-6 backdrop-blur-md animate-in fade-in duration-500">
            <div className="max-w-md w-full bg-slate-900 border border-gold-500/30 p-8 rounded-2xl shadow-2xl text-center relative overflow-hidden">
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
            <h1 className="text-xl md:text-2xl font-serif text-gold-400 tracking-wider">AETHERIA <span className="text-[10px] text-slate-500 ml-2">v3.3</span></h1>
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
                    if (!showSettings) setShowSidebar(false);
                    setShowSettings(!showSettings);
                }} 
                className="p-1.5 sm:p-2 hover:text-gold-400 transition-colors bg-slate-900/50 rounded-full border border-slate-800"
            >
                <Settings size={20} />
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
                  <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
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
                  <div className="bg-slate-950 border border-gold-500/20 rounded-2xl max-w-4xl w-full shadow-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                      
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

                              {/* Section 1: The Body (Chakras/Solfeggio) */}
                              <section>
                                  <div className="flex items-center gap-3 mb-6">
                                    <div className="p-2 bg-blue-500/10 rounded-full"><User className="text-blue-400" size={24}/></div>
                                    <h3 className="text-2xl font-bold text-white">The Body: Solfeggio Frequencies</h3>
                                  </div>
                                  <p className="text-slate-400 mb-6 leading-relaxed max-w-2xl">{UNIFIED_THEORY.section2?.content || "Harmonic frequencies that resonate with specific energy centers in the human body."}</p>
                                  
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                      {SOLFEGGIO_INFO.map(s => (
                                          <div key={s.freq} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 hover:border-slate-600 transition-colors group">
                                              <div className="flex justify-between items-center mb-2">
                                                  <span className="text-xl font-bold font-mono" style={{color: s.color}}>{s.freq} Hz</span>
                                                  <span className="text-[10px] uppercase tracking-wider text-slate-500">{s.chakra}</span>
                                              </div>
                                              <h4 className="text-white font-medium mb-1">{s.benefit}</h4>
                                              <p className="text-xs text-slate-400 mb-3 leading-relaxed">{s.description}</p>
                                              <div className="text-[10px] text-slate-500 pt-3 border-t border-slate-800/50">
                                                  <strong className="text-slate-400">Anatomy:</strong> {s.anatomy}
                                              </div>
                                          </div>
                                      ))}
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
            flex flex-col transition-transform duration-300 backdrop-blur-lg shadow-2xl
            z-[60]
            ${showSidebar ? 'translate-x-0' : '-translate-x-full'}
            ${isFullScreen ? 'md:-ml-80' : ''}
          `}>
            <div className="p-4 border-b border-slate-800 shrink-0">
               
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
               
               {/* Tools Section */}
               <div className="grid grid-cols-2 gap-2">
                   <button 
                    onClick={scanLibrary}
                    className={`flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border transition-all active:scale-95 ${isScanning ? 'bg-blue-900/30 border-blue-500 text-blue-400 animate-pulse' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-600'}`}
                   >
                     <Search size={16} className="mb-1" />
                     {isScanning ? 'Scanning...' : 'Scan Library'}
                   </button>
                   
                   <button 
                    onClick={generateAlignmentJourney}
                    className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg font-medium border border-slate-800 bg-slate-900 text-slate-400 hover:text-gold-400 hover:border-gold-500 transition-all active:scale-95"
                   >
                     <Layers size={16} className="mb-1" />
                     Alignment
                   </button>
                   
                   <button 
                    onClick={() => generateFilteredPlaylist(s => [174, 285, 396, 417].includes(s.closestSolfeggio || 0), 'Qi Strengthening')}
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
               </div>

               <button 
                onClick={restoreLibrary}
                className={`mt-2 w-full flex items-center justify-center gap-2 text-xs py-2 rounded-lg font-medium tracking-wide transition-all active:scale-95 bg-slate-800 hover:bg-slate-700 text-slate-300`}
               >
                 <RefreshCw size={14} />
                 Restore Library
               </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar pb-24">
              {playlist.length === 0 && (
                <div className="flex flex-col items-center justify-center h-48 text-center text-slate-600 p-6">
                  <p>Library Empty</p>
                  <p className="text-xs mt-2">Upload a folder or add files to begin.</p>
                </div>
              )}
              {playlist.map((song, idx) => (
                <div 
                  key={song.id}
                  onClick={() => { playTrack(idx); if(window.innerWidth < 768) setShowSidebar(false); }}
                  className={`p-3 rounded-lg cursor-pointer truncate text-sm flex items-center gap-3 transition-all active:scale-95 ${
                    currentSongIndex === idx 
                      ? 'bg-gold-600/20 text-gold-400 border-l-4 border-gold-500 pl-2' 
                      : 'hover:bg-slate-800 text-slate-400'
                  }`}
                >
                  <span className="text-xs opacity-50 w-5 text-right">{idx + 1}</span>
                  <div className="flex flex-col truncate flex-1">
                      <div className="flex justify-between">
                          <span className="truncate font-medium">{song.name}</span>
                          {song.closestSolfeggio && <span className="text-[9px] px-1 rounded bg-slate-800 text-gold-500 ml-2 h-fit">{song.closestSolfeggio}Hz</span>}
                      </div>
                      <span className="text-[10px] text-slate-600">{formatDuration(song.duration || 0)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 bg-black/95 backdrop-blur text-center text-xs text-slate-500 border-t border-slate-900 flex justify-between px-6 shrink-0 z-20">
                <span>{playlist.length} Tracks</span>
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
                    <div className="grid grid-cols-3 gap-3">
                      {SOLFEGGIO_INFO.map((s) => (
                        <button
                          key={s.freq}
                          onClick={() => setSelectedSolfeggio(s.freq)}
                          className={`py-3 px-1 rounded-lg text-xs font-medium border transition-all active:scale-95 ${selectedSolfeggio === s.freq ? 'bg-gold-600 text-black border-gold-600 shadow-lg shadow-gold-500/20' : 'border-slate-800 bg-slate-900 hover:border-gold-500'}`}
                        >
                          {s.freq}
                        </button>
                      ))}
                    </div>
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
                             <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gold-500/10 text-gold-500 border border-gold-500/20">
                                <Activity size={8} /> {playlist[currentSongIndex]?.closestSolfeggio || selectedSolfeggio}Hz
                             </span>
                             <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                <Waves size={8} /> {selectedBinaural.name}
                             </span>
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