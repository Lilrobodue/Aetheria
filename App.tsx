import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, 
  Upload, Settings, Info, Activity, Volume2, Maximize2, Minimize2, 
  Circle, Zap, X, Menu, Eye, EyeOff, ChevronDown, ChevronUp, Sparkles, Sliders, Wind, Activity as PulseIcon, Waves, Search, Video, Mic, Monitor, RefreshCw, Flame, Flower2, Layers, Heart, Smile, Moon, Droplets, FilePlus, RotateCw, ArrowUpCircle, Hexagon, AlertTriangle, CircleHelp, ChevronRight, ChevronLeft, BookOpen, User, Map, Box, Trash2, SortAsc
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
      URL.revokeObjectURL(audio.src);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(audio.src);
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
    
    const startOffset = Math.min(buffer.duration / 2, 30);
    source.start(0, startOffset, sampleDuration);
    
    await offlineCtx.startRendering();
    
    const data = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(data);
    
    let maxVal = -Infinity;
    let maxIndex = -1;
    
    const binSize = 44100 / analyser.fftSize;
    const startBin = Math.floor(60 / binSize);

    for (let i = startBin; i < data.length; i++) {
      let magnitude = data[i];
      const freq = i * binSize;

      if (freq < 100) magnitude -= 40; 
      else if (freq < 250) magnitude -= 20;
      else if (freq > 3000) magnitude -= 15; 
      else magnitude += 5; 

      if (magnitude > maxVal) {
        maxVal = magnitude;
        maxIndex = i;
      }
    }

    let freq = maxIndex * binSize;
    if (maxIndex > 0 && maxIndex < data.length - 1) {
       const alpha = data[maxIndex - 1];
       const beta = data[maxIndex];
       const gamma = data[maxIndex + 1];
       const delta = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma);
       freq = (maxIndex + delta) * binSize;
    }
    return freq;
  } catch (e) {
    return 0;
  }
};

const getHarmonicSolfeggio = (detectedFreq: number): number => {
    if (detectedFreq <= 0) return 396; 
    let bestMatch = 396;
    let minScore = Infinity;
    SOLFEGGIO_INFO.forEach(s => {
        const sFreq = s.freq;
        const candidates = [sFreq, sFreq / 2, sFreq * 2, sFreq / 4, sFreq * 4];
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

const getShuffledIndices = (count: number) => {
    const indices = Array.from({length: count}, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices;
};

const TutorialModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [step, setStep] = useState(0);
    const steps = [
        {
            title: "Welcome to Aetheria",
            icon: <Activity className="text-gold-500 w-12 h-12" />,
            desc: "Aetheria is a harmonic resonance engine that retunes your music to 432Hz and aligns it with sacred geometry.",
            content: (
                <ul className="text-sm text-slate-400 space-y-3 text-left bg-slate-800/50 p-5 rounded-lg border border-slate-700">
                    <li className="flex gap-2">✨ <strong>Automatic 432Hz:</strong> All music is instantly retuned to the natural harmonic 432Hz.</li>
                    <li className="flex gap-2">💠 <strong>Living Visuals:</strong> Sacred geometry reacts to your audio's harmonic content.</li>
                    <li className="flex gap-2">🎧 <strong>Best Experience:</strong> Use headphones to experience binaural beats and spatial resonance.</li>
                </ul>
            )
        },
        {
            title: "1. Manage Your Library",
            icon: <Upload className="text-blue-400 w-12 h-12" />,
            desc: "Add files or folders. Search and sort your collection effortlessly.",
            content: (
                <ul className="text-sm text-slate-400 space-y-3 text-left bg-slate-800/50 p-5 rounded-lg border border-slate-700">
                    <li className="flex gap-2">🔍 <strong>Search:</strong> Use the search bar to find tracks instantly in large playlists.</li>
                    <li className="flex gap-2">🗑️ <strong>Delete:</strong> Hover over any track in the sidebar to remove it from the session.</li>
                    <li className="flex gap-2">💾 <strong>Privacy:</strong> No files are ever uploaded. Everything stays in your browser.</li>
                </ul>
            )
        },
        {
            title: "2. Harmonic Journeys",
            icon: <SortAsc className="text-purple-400 w-12 h-12" />,
            desc: "Order your music by frequency to experience an ascending energy journey.",
            content: (
                <ul className="text-sm text-slate-400 space-y-3 text-left bg-slate-800/50 p-5 rounded-lg border border-slate-700">
                    <li className="flex gap-2">📶 <strong>Harmonic Sort:</strong> Organizes your entire library from Root (174Hz) to Crown (963Hz).</li>
                    <li className="flex gap-2">🌊 <strong>Alignment Path:</strong> Creates a curated sequence touching every major Solfeggio tone.</li>
                    <li className="flex gap-2">🧘 <strong>Presets:</strong> Quick buttons for Deep Healing, Mood elevation, or Meditation.</li>
                </ul>
            )
        }
    ];

    return (
        <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-gold-500/30 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-6 bg-slate-950/50 border-b border-slate-800 flex justify-between items-center">
                    <h3 className="text-xl font-serif text-gold-400">Harmonic Guide</h3>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X size={24} /></button>
                </div>
                <div className="p-8 flex-1 flex flex-col items-center text-center overflow-y-auto">
                    <div className="mb-6 p-4 bg-slate-800 rounded-full shadow-lg text-gold-500">{steps[step].icon}</div>
                    <h2 className="text-2xl font-bold text-white mb-2">{steps[step].title}</h2>
                    <p className="text-slate-400 mb-6 font-medium">{steps[step].desc}</p>
                    <div className="w-full">{steps[step].content}</div>
                </div>
                <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-between items-center">
                    <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} className="flex items-center gap-2 px-4 py-2 rounded-lg text-slate-400 hover:text-white disabled:opacity-30">
                        <ChevronLeft size={16} /> Prev
                    </button>
                    <div className="flex gap-2">
                        {steps.map((_, i) => (
                            <div key={i} className={`h-2 rounded-full transition-all duration-300 ${i === step ? 'bg-gold-500 w-8' : 'bg-slate-700 w-2'}`}></div>
                        ))}
                    </div>
                    <button onClick={() => step === steps.length - 1 ? onClose() : setStep(step + 1)} className="flex items-center gap-2 px-6 py-2 rounded-lg bg-gold-600 text-black font-bold hover:bg-gold-500 shadow-lg shadow-gold-500/20">
                        {step === steps.length - 1 ? 'Start' : 'Next'} {step !== steps.length - 1 && <ChevronRight size={16} />}
                    </button>
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
  const [searchTerm, setSearchTerm] = useState('');
  const [shuffledIndices, setShuffledIndices] = useState<number[]>([]);
  const [shufflePos, setShufflePos] = useState<number>(0);
  const [showInfo, setShowInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
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
  const [pendingDurationAnalysis, setPendingDurationAnalysis] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [isVizPanelOpen, setIsVizPanelOpen] = useState(true);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  const [vizSettings, setVizSettings] = useState<VizSettings>({
    speed: 1.0, sensitivity: 1.0, particleDensity: 'medium', particleBaseSize: 3.5, 
    coreSize: 1.0, showHexagons: true, hexOpacity: 0.6, hexVisualMode: 'spectrum', 
    showWaterRipples: false, hydroIntensity: 50, showTreeOfLife: false,
    colorMode: 'chakra', autoRotate: true, invertPerspective: false,
    morphEnabled: true, enableFlow: true, enableFloat: false, enablePulse: false, enableTrails: false,
  });

  const [volume, setVolume] = useState(0.8);
  const [solfeggioVolume, setSolfeggioVolume] = useState(0.05); 
  const [binauralVolume, setBinauralVolume] = useState(0.03); 
  const [selectedSolfeggio, setSelectedSolfeggio] = useState<number>(396);
  const [selectedBinaural, setSelectedBinaural] = useState<BinauralPreset>(BINAURAL_PRESETS[2]); 
  const [isAdaptiveBinaural, setIsAdaptiveBinaural] = useState(true); 
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

  const stateRef = useRef({ playlist, currentSongIndex, isShuffle, isLoop, shuffledIndices, shufflePos });
  useEffect(() => {
    stateRef.current = { playlist, currentSongIndex, isShuffle, isLoop, shuffledIndices, shufflePos };
  }, [playlist, currentSongIndex, isShuffle, isLoop, shuffledIndices, shufflePos]);

  useEffect(() => {
    if (!isZenMode) { setZenUiVisible(true); return; }
    const handleMouseMove = () => {
      setZenUiVisible(true);
      if (zenTimeoutRef.current) clearTimeout(zenTimeoutRef.current);
      zenTimeoutRef.current = window.setTimeout(() => setZenUiVisible(false), 3000); 
    };
    window.addEventListener('mousemove', handleMouseMove);
    handleMouseMove();
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (zenTimeoutRef.current) clearTimeout(zenTimeoutRef.current);
    };
  }, [isZenMode]);

  useEffect(() => {
    if (isShuffle && playlist.length > 0) {
        if (shuffledIndices.length !== playlist.length) {
            const newIndices = getShuffledIndices(playlist.length);
            setShuffledIndices(newIndices);
            const currentIdxInShuffle = newIndices.indexOf(currentSongIndex);
            setShufflePos(currentIdxInShuffle !== -1 ? currentIdxInShuffle : 0);
        }
    } else if (!isShuffle) {
        setShuffledIndices([]);
        setShufflePos(0);
    }
  }, [isShuffle, playlist.length]);

  const playTrackRef = useRef<(index: number, list?: Song[]) => Promise<void>>(async () => {});
  const playNextRef = useRef<() => void>(() => {});

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
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
  }, []);

  const updateSolfeggio = useCallback(() => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const now = ctx.currentTime;
    if (solfeggioOscRef.current) { try { solfeggioOscRef.current.stop(); } catch(e) {} solfeggioOscRef.current.disconnect(); }
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

  useEffect(() => { if (binauralGainRef.current && audioCtxRef.current) binauralGainRef.current.gain.setTargetAtTime(binauralVolume, audioCtxRef.current.currentTime, 0.1); }, [binauralVolume]);
  const updateBinaural = useCallback(() => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    [binauralLeftOscRef, binauralRightOscRef].forEach(ref => { if (ref.current) { try { ref.current.stop(); } catch(e){} ref.current.disconnect(); } });
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
  useEffect(() => { if(gainNodeRef.current && audioCtxRef.current) gainNodeRef.current.gain.setTargetAtTime(volume, audioCtxRef.current.currentTime, 0.1); }, [volume]);

  useEffect(() => {
    if (!isAdaptiveBinaural || !isPlaying || !analyserNode) return;
    const interval = setInterval(() => {
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserNode.getByteFrequencyData(dataArray);
        let sum = 0;
        for(let i=0; i<bufferLength; i++) sum += dataArray[i] * dataArray[i];
        const rms = Math.sqrt(sum / bufferLength) / 255;
        let targetPreset = BINAURAL_PRESETS[2]; 
        if (rms < 0.1) targetPreset = BINAURAL_PRESETS[0];
        else if (rms < 0.25) targetPreset = BINAURAL_PRESETS[1];
        else if (rms > 0.6) targetPreset = BINAURAL_PRESETS[4]; 
        else if (rms > 0.4) targetPreset = BINAURAL_PRESETS[3]; 
        if (targetPreset.name !== selectedBinaural.name) setSelectedBinaural(targetPreset);
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

  useEffect(() => {
    if (pendingDurationAnalysis.length === 0) return;
    const processNextBatch = async () => {
       const batchSize = 5;
       const processing = pendingDurationAnalysis.slice(0, batchSize);
       const remaining = pendingDurationAnalysis.slice(batchSize);
       const updates: {id: string, duration: number}[] = [];
       await Promise.all(processing.map(async (id) => {
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
    const fileList = (Array.from(files) as File[]).filter(f => f.type.includes('audio') || f.name.endsWith('.wav') || f.name.endsWith('.mp3'));
    const newSongs: Song[] = fileList.map(file => ({
        file: file, id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name.replace(/\.[^/.]+$/, ""), duration: 0 
    }));
    setPlaylist(prev => { const updated = [...prev, ...newSongs]; setOriginalPlaylist(updated); return updated; });
    setPendingDurationAnalysis(prev => [...prev, ...newSongs.map(s => s.id)]);
    setIsUploading(false);
    event.target.value = ''; 
  };

  const handleRemoveSong = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newOriginal = originalPlaylist.filter(s => s.id !== id);
    const newActive = playlist.filter(s => s.id !== id);
    setOriginalPlaylist(newOriginal);
    setPlaylist(newActive);
    if (stateRef.current.currentSongIndex >= 0 && playlist[stateRef.current.currentSongIndex]?.id === id) {
        setIsPlaying(false);
        if (sourceNodeRef.current) sourceNodeRef.current.stop();
        setCurrentSongIndex(-1);
    }
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
            const arrayBuffer = await newPlaylist[i].file.arrayBuffer();
            const audioBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);
            const freq = await detectDominantFrequency(audioBuffer);
            const solfeggio = getHarmonicSolfeggio(freq);
            newPlaylist[i] = { ...newPlaylist[i], harmonicFreq: freq, closestSolfeggio: solfeggio, harmonicDeviation: Math.abs(freq - solfeggio) };
        } catch (e) {}
        setScanProgress(Math.round(((i + 1) / newPlaylist.length) * 100));
        await new Promise(r => setTimeout(r, 10));
    }
    setPlaylist(newPlaylist);
    setOriginalPlaylist(newPlaylist); 
    setIsScanning(false);
    setScanProgress(0);
  };

  const handleSortByFrequency = () => {
    const analyzed = originalPlaylist.filter(s => !!s.closestSolfeggio);
    if (analyzed.length === 0) { alert("Please 'Scan Library' first to sort by frequency."); return; }
    const sorted = [...originalPlaylist].sort((a, b) => (a.closestSolfeggio || 1000) - (b.closestSolfeggio || 1000));
    setPlaylist(sorted);
    setCurrentSongIndex(0);
    playTrackRef.current(0, sorted);
    if (window.innerWidth < 768) setShowSidebar(false);
  };

  const generateFilteredPlaylist = (filterFn: (song: Song) => boolean, name: string) => {
      const candidates = originalPlaylist.filter(filterFn);
      if (candidates.length > 0) {
          setPlaylist(candidates);
          setCurrentSongIndex(0);
          playTrackRef.current(0, candidates);
      } else { alert(`No songs found matching '${name}'. Try scanning library first.`); }
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
              journeyPlaylist.push(candidates[0]);
              usedIds.add(candidates[0].id);
          }
      });
      if (journeyPlaylist.length > 0) {
          setPlaylist(journeyPlaylist);
          setCurrentSongIndex(0);
          setVizSettings(prev => ({ ...prev, showTreeOfLife: true }));
          playTrackRef.current(0, journeyPlaylist); 
          if(window.innerWidth < 768) setShowSidebar(false);
      } else { alert("Not enough analyzed songs. Try scanning library first."); }
  };

  const restoreLibrary = () => { if (originalPlaylist.length > 0) setPlaylist(originalPlaylist); };

  const playBuffer = (buffer: AudioBuffer, offset: number = 0) => {
      if (!audioCtxRef.current) return;
      if (sourceNodeRef.current) { sourceNodeRef.current.onended = null; try { sourceNodeRef.current.stop(); } catch(e) {} sourceNodeRef.current.disconnect(); }
      const source = audioCtxRef.current.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = PITCH_SHIFT_FACTOR; 
      source.connect(gainNodeRef.current!);
      source.onended = () => {
          setIsPlaying(false);
          if (audioCtxRef.current && Math.abs(audioCtxRef.current.currentTime - startTimeRef.current - (buffer.duration / PITCH_SHIFT_FACTOR)) < 0.5) playNextRef.current();
      };
      source.start(0, offset);
      startTimeRef.current = audioCtxRef.current.currentTime;
      pausedAtRef.current = offset; 
      sourceNodeRef.current = source;
      setIsPlaying(true);
  };

  const playTrack = async (index: number, playlistOverride?: Song[]) => {
    initAudio();
    const tracks = playlistOverride || stateRef.current.playlist;
    if (index < 0 || index >= tracks.length) return;
    if (stateRef.current.isShuffle && !playlistOverride) {
        const shuffleIdx = stateRef.current.shuffledIndices.indexOf(index);
        if (shuffleIdx !== -1) setShufflePos(shuffleIdx);
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
    let freq = song.harmonicFreq || await detectDominantFrequency(audioBuffer);
    setSelectedSolfeggio(getHarmonicSolfeggio(freq));
    setIsAnalyzing(false);
    playBuffer(audioBuffer, 0);
    setCurrentSongIndex(index);
  };

  useEffect(() => { playTrackRef.current = playTrack; }, [playTrack]);

  const playNext = useCallback(() => {
    const { playlist, currentSongIndex, isShuffle, isLoop, shuffledIndices } = stateRef.current;
    if (playlist.length === 0) return;
    if (isShuffle) {
        let currentIndices = shuffledIndices;
        if (currentIndices.length !== playlist.length) { currentIndices = getShuffledIndices(playlist.length); setShuffledIndices(currentIndices); }
        let currentShufflePos = currentIndices.indexOf(currentSongIndex);
        const nextShufflePos = currentShufflePos + 1;
        if (nextShufflePos >= currentIndices.length) {
            if (isLoop) { const newIndices = getShuffledIndices(playlist.length); setShuffledIndices(newIndices); setShufflePos(0); playTrack(newIndices[0]); }
            else setIsPlaying(false);
        } else { setShufflePos(nextShufflePos); playTrack(currentIndices[nextShufflePos]); }
    } else {
        let nextIndex = currentSongIndex + 1;
        if (nextIndex >= playlist.length) { if (isLoop) nextIndex = 0; else { setIsPlaying(false); return; } }
        playTrack(nextIndex);
    }
  }, [playTrack]);

  useEffect(() => { playNextRef.current = playNext; }, [playNext]);

  const handlePlayPause = () => {
    initAudio();
    if (isPlaying) { if (audioCtxRef.current) audioCtxRef.current.suspend(); setIsPlaying(false); }
    else { if (audioCtxRef.current) audioCtxRef.current.resume(); if (!sourceNodeRef.current && playlist.length > 0) playTrack(currentSongIndex >= 0 ? currentSongIndex : 0); else setIsPlaying(true); }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!audioBufferRef.current || !audioCtxRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const percent = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const seekTime = percent * currDuration;
      setCurrTime(seekTime);
      playBuffer(audioBufferRef.current, seekTime);
  };

  const stopRecording = () => { mediaRecorderRef.current?.stop(); setIsRecording(false); };

  const filteredVisiblePlaylist = useMemo(() => {
    if (!searchTerm.trim()) return playlist;
    return playlist.filter(song => song.name.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [playlist, searchTerm]);

  return (
    <div className={`relative min-h-screen bg-black text-slate-200 font-sans overflow-hidden ${isFullScreen ? 'h-screen' : ''}`}>
      {!disclaimerAccepted && (
        <div className="fixed inset-0 z-[150] bg-black/95 flex items-center justify-center p-6 backdrop-blur-md">
            <div className="max-w-md w-full bg-slate-900 border border-gold-500/30 p-8 rounded-2xl shadow-2xl text-center relative overflow-hidden">
                 <AlertTriangle className="w-12 h-12 text-gold-500 mx-auto mb-4 animate-pulse" />
                 <h2 className="text-2xl font-serif text-white mb-2 tracking-wide">Aetheria v3.4</h2>
                 <p className="text-xs text-slate-500 mb-6 uppercase tracking-widest">Resonance & Geometry Player</p>
                 <div className="text-left text-slate-400 text-sm mb-6 space-y-4 bg-black/40 p-5 rounded-lg border border-slate-800">
                    <p className="flex gap-2"><Zap size={16} className="text-gold-500 shrink-0 mt-0.5" /><span><strong>Photosensitivity Warning:</strong> Visual strobing and geometric flickering ahead.</span></p>
                    <p className="flex gap-2"><Waves size={16} className="text-blue-500 shrink-0 mt-0.5" /><span><strong>Audio Caution:</strong> High-resonance tones and binaural beats. Do not use while driving.</span></p>
                 </div>
                 <button onClick={() => { setDisclaimerAccepted(true); if (!localStorage.getItem('aetheria_v3_tutorial_seen')) setShowTutorial(true); }} className="w-full py-3 bg-gold-600 hover:bg-gold-500 text-black font-bold rounded-xl shadow-[0_0_20px_rgba(234,179,8,0.3)] transition-all">I Understand & Accept</button>
            </div>
        </div>
      )}
      {showTutorial && <TutorialModal onClose={() => { setShowTutorial(false); localStorage.setItem('aetheria_v3_tutorial_seen', 'true'); }} />}

      <Visualizer analyser={analyserNode} primaryColor={SOLFEGGIO_INFO.find(s => s.freq === selectedSolfeggio)?.color || '#fbbf24'} isPlaying={isPlaying} binauralDelta={selectedBinaural.delta} selectedFrequency={selectedSolfeggio} settings={vizSettings} />

      <div className={`relative z-10 flex flex-col h-screen transition-opacity duration-1000 ${(!isZenMode || zenUiVisible) ? 'opacity-100' : 'opacity-0'} ${isZenMode ? '' : 'bg-black/20'}`}>
        <header className="flex justify-between items-center p-3 md:p-4 border-b border-slate-800/50 bg-black/80 backdrop-blur-md z-30 shadow-lg">
          <div className="flex items-center gap-2">
             <button onClick={() => setShowSidebar(!showSidebar)} className="text-gold-500 mr-2 p-1 hover:bg-slate-800 rounded"><Menu /></button>
             <div className="w-8 h-8 rounded-full bg-gold-500 flex items-center justify-center shadow-lg"><Activity className="text-slate-950 w-5 h-5" /></div>
             <h1 className="text-xl md:text-2xl font-serif text-gold-400 tracking-wider">AETHERIA <span className="text-[10px] text-slate-500 ml-2">v3.4</span></h1>
          </div>
          <div className="flex items-center gap-1 sm:gap-4">
             {isRecording ? <button onClick={stopRecording} className="px-3 py-1 bg-red-600/20 border border-red-500 text-red-500 rounded-full animate-pulse text-xs font-bold">REC</button> : <button onClick={() => setShowRecordOptions(true)} className="p-2 text-slate-400 bg-slate-900/50 hover:text-red-400 rounded-full border border-slate-800"><Circle size={20} /></button>}
             <button onClick={() => setShowSettings(!showSettings)} className="p-2 hover:text-gold-400 bg-slate-900/50 rounded-full border border-slate-800"><Settings size={20} /></button>
             <button onClick={() => setShowTutorial(true)} className="p-2 hover:text-gold-400 bg-slate-900/50 rounded-full border border-slate-800"><CircleHelp size={20} /></button>
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden relative">
          <aside className={`absolute inset-y-0 left-0 w-[85%] sm:w-80 md:relative bg-black/90 md:bg-black/80 border-r border-slate-800 flex flex-col transition-transform duration-300 backdrop-blur-lg z-[60] ${showSidebar ? 'translate-x-0' : '-translate-x-full'}`}>
            <div className="p-4 border-b border-slate-800 shrink-0 space-y-3">
               <button onClick={() => setShowInfo(true)} className="w-full flex items-center justify-center gap-2 p-2.5 rounded-lg bg-gold-600/10 hover:bg-gold-600/20 text-gold-500 border border-gold-500/30 text-xs font-bold uppercase tracking-wider"><BookOpen size={16} /> The Guidebook</button>
               <div className="grid grid-cols-2 gap-2">
                   <label className="flex items-center justify-center gap-2 p-2 border border-slate-700 rounded-lg cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"><Upload size={14} /> Folder<input type="file" {...({ webkitdirectory: "", directory: "" } as any)} multiple className="hidden" onChange={handleFileUpload} /></label>
                   <label className="flex items-center justify-center gap-2 p-2 border border-slate-700 rounded-lg cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"><FilePlus size={14} /> Files<input type="file" multiple className="hidden" onChange={handleFileUpload} /></label>
               </div>
               <div className="relative group">
                   <Search size={14} className="absolute left-3 top-2.5 text-slate-500 group-focus-within:text-gold-500" />
                   <input type="text" placeholder="Search library..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-900/50 border border-slate-800 rounded-lg py-2 pl-9 pr-3 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-gold-500/50 focus:bg-slate-900 transition-all" />
                   {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-3 top-2.5 text-slate-600 hover:text-white"><X size={12} /></button>}
               </div>
               <div className="grid grid-cols-2 gap-2">
                   <button onClick={scanLibrary} className={`flex flex-col items-center justify-center p-2 text-[10px] rounded-lg border bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-600 transition-all ${isScanning ? 'animate-pulse border-blue-500' : ''}`}><Search size={14} className="mb-1" />{isScanning ? 'Scanning...' : 'Scan Harmonics'}</button>
                   <button onClick={handleSortByFrequency} className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-gold-400 hover:border-gold-500 transition-all"><SortAsc size={14} className="mb-1" />Harmonic Sort</button>
                   <button onClick={generateAlignmentJourney} className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-gold-400 hover:border-gold-500 transition-all"><Layers size={14} className="mb-1" />Solfeggio Path</button>
                   <button onClick={() => generateFilteredPlaylist(s => [174, 285, 528].includes(s.closestSolfeggio || 0), 'Healing')} className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-emerald-400 hover:border-emerald-500 transition-all"><Heart size={14} className="mb-1 text-emerald-500" />Deep Healing</button>
                   <button onClick={() => generateFilteredPlaylist(s => [396, 417, 639].includes(s.closestSolfeggio || 0), 'Mood')} className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-pink-400 hover:border-pink-500 transition-all"><Smile size={14} className="mb-1 text-pink-500" />Mood Elevate</button>
                   <button onClick={() => generateFilteredPlaylist(s => [741, 852, 963].includes(s.closestSolfeggio || 0), 'Meditation')} className="flex flex-col items-center justify-center p-2 text-[10px] rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-purple-400 hover:border-purple-500 transition-all"><Moon size={14} className="mb-1 text-purple-500" />Meditation</button>
               </div>
               <button onClick={restoreLibrary} className="w-full flex items-center justify-center gap-2 text-[10px] py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400"><RefreshCw size={12} /> Restore Original Library</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar pb-24">
              {filteredVisiblePlaylist.length === 0 && <div className="flex flex-col items-center justify-center h-48 text-center text-slate-600 p-6 text-sm"><p>{searchTerm ? 'No results found' : 'Library Empty'}</p></div>}
              {filteredVisiblePlaylist.map((song, idx) => (
                <div key={song.id} onClick={() => playTrack(idx, filteredVisiblePlaylist)} className={`group/item p-3 rounded-lg cursor-pointer truncate text-sm flex items-center gap-3 transition-all ${currentSongIndex >= 0 && playlist[currentSongIndex]?.id === song.id ? 'bg-gold-600/20 text-gold-400 border-l-4 border-gold-500 pl-2' : 'hover:bg-slate-800 text-slate-400'}`}>
                  <span className="text-xs opacity-50 w-5 text-right shrink-0">{idx + 1}</span>
                  <div className="flex flex-col truncate flex-1">
                      <div className="flex justify-between items-center overflow-hidden"><span className="truncate font-medium">{song.name}</span>{song.closestSolfeggio && <span className="text-[9px] px-1 rounded bg-slate-800 text-gold-500 ml-2 h-fit shrink-0">{song.closestSolfeggio}Hz</span>}</div>
                      <span className="text-[10px] text-slate-600">{song.duration === 0 ? '...' : formatDuration(song.duration || 0)}</span>
                  </div>
                  <button onClick={(e) => handleRemoveSong(song.id, e)} className="opacity-0 group-hover/item:opacity-100 p-1.5 text-slate-600 hover:text-red-500 transition-all rounded" title="Remove track"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            <div className="p-3 bg-black/95 text-center text-[10px] text-slate-500 border-t border-slate-900 flex justify-between px-6 shrink-0 z-20"><span>{filteredVisiblePlaylist.length} Tracks</span><span className="text-gold-500/80">{formatDuration(playlist.reduce((acc, s) => acc + (s.duration || 0), 0))} Total</span></div>
          </aside>

          {showSettings && (
            <div className="absolute inset-y-0 right-0 z-[70] w-full md:w-96 bg-black/95 backdrop-blur-xl border-l border-slate-800 flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
                <div className="flex justify-between items-start p-6 border-b border-slate-800">
                  <h3 className="text-gold-500 font-serif text-xl">Harmonic Control</h3>
                  <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-slate-800 rounded-full"><X className="text-slate-500 hover:text-white" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar pb-32">
                   <div className="border border-gold-500/30 rounded-xl overflow-hidden bg-slate-900/50">
                      <button onClick={() => setIsVizPanelOpen(!isVizPanelOpen)} className="w-full flex justify-between items-center p-4 bg-slate-800/80 hover:bg-slate-800"><span className="text-gold-400 font-bold uppercase tracking-widest text-xs flex items-center gap-2"><Sliders size={16} /> Visualization Engine</span>{isVizPanelOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                      {isVizPanelOpen && (
                          <div className="p-5 space-y-5 bg-black/40">
                             <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800"><span className="text-xs text-slate-300 flex items-center gap-2"><Sparkles size={14} className="text-gold-500"/> Astral Trails</span><button onClick={() => setVizSettings({...vizSettings, enableTrails: !vizSettings.enableTrails})} className={`w-10 h-5 rounded-full relative transition-colors ${vizSettings.enableTrails ? 'bg-gold-500' : 'bg-slate-700'}`}><div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${vizSettings.enableTrails ? 'left-6' : 'left-1'}`}></div></button></div>
                             <div className="space-y-4 pt-2">
                                <div><div className="flex justify-between text-[10px] text-slate-400 mb-1"><span>SIMULATION SPEED</span><span>{vizSettings.speed.toFixed(1)}x</span></div><input type="range" min="0.1" max="3" step="0.1" value={vizSettings.speed} onChange={(e) => setVizSettings({...vizSettings, speed: parseFloat(e.target.value)})} className="w-full accent-gold-500 h-1.5 bg-slate-700 rounded-lg appearance-none" /></div>
                                <div><div className="flex justify-between text-[10px] text-slate-400 mb-1"><span>PARTICLE SIZE</span><span>{vizSettings.particleBaseSize.toFixed(1)}x</span></div><input type="range" min="0.5" max="8.0" step="0.5" value={vizSettings.particleBaseSize} onChange={(e) => setVizSettings({...vizSettings, particleBaseSize: parseFloat(e.target.value)})} className="w-full accent-gold-500 h-1.5 bg-slate-700 rounded-lg appearance-none" /></div>
                                <div><div className="flex justify-between text-[10px] text-slate-400 mb-1"><span>AUDIO REACTIVITY</span><span>{(vizSettings.sensitivity * 100).toFixed(0)}%</span></div><input type="range" min="0.1" max="2" step="0.1" value={vizSettings.sensitivity} onChange={(e) => setVizSettings({...vizSettings, sensitivity: parseFloat(e.target.value)})} className="w-full accent-gold-500 h-1.5 bg-slate-700 rounded-lg appearance-none" /></div>
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => setVizSettings({...vizSettings, showHexagons: !vizSettings.showHexagons})} className={`text-xs py-2 rounded border ${vizSettings.showHexagons ? 'bg-gold-500/20 border-gold-500 text-gold-400' : 'bg-slate-900 border-slate-700 text-slate-500'}`}>Hex Grid {vizSettings.showHexagons ? 'ON' : 'OFF'}</button>
                                    <button onClick={() => setVizSettings({...vizSettings, showTreeOfLife: !vizSettings.showTreeOfLife})} className={`text-xs py-2 rounded border ${vizSettings.showTreeOfLife ? 'bg-gold-500/20 border-gold-500 text-gold-400' : 'bg-slate-900 border-slate-700 text-slate-500'}`}>Tree of Life {vizSettings.showTreeOfLife ? 'ON' : 'OFF'}</button>
                                </div>
                                <div className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border border-slate-800 w-full"><span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider flex items-center gap-2"><Droplets size={12}/> Hydro-Acoustics</span><button onClick={() => setVizSettings({...vizSettings, showWaterRipples: !vizSettings.showWaterRipples})} className={`w-8 h-4 rounded-full relative transition-colors ${vizSettings.showWaterRipples ? 'bg-blue-500' : 'bg-slate-700'}`}><div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${vizSettings.showWaterRipples ? 'left-4.5' : 'left-0.5'}`}></div></button></div>
                             </div>
                          </div>
                      )}
                   </div>
                   <div>
                    <label className="text-xs uppercase tracking-widest text-slate-500 mb-4 block font-bold">Pure Solfeggio Layer</label>
                    <div className="grid grid-cols-3 gap-2">
                      {SOLFEGGIO_INFO.map((s) => (<button key={s.freq} onClick={() => setSelectedSolfeggio(s.freq)} className={`py-2 px-1 rounded-lg text-[10px] font-medium border transition-all ${selectedSolfeggio === s.freq ? 'bg-gold-600 text-black border-gold-600 shadow-lg' : 'border-slate-800 bg-slate-900 hover:border-gold-500'}`}>{s.freq}Hz</button>))}
                    </div>
                    <div className="mt-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
                      <div className="flex justify-between text-xs text-slate-400 mb-2"><span>Layer Mix</span><span>{(solfeggioVolume * 100).toFixed(0)}%</span></div>
                      <input type="range" min="0" max="1" step="0.01" value={solfeggioVolume} onChange={(e) => setSolfeggioVolume(parseFloat(e.target.value))} className="w-full accent-gold-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer" />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-4"><label className="text-xs uppercase tracking-widest text-slate-500 font-bold">Binaural Entrainment</label></div>
                    <div className="space-y-2">
                       {BINAURAL_PRESETS.map((p) => (
                          <div key={p.name} onClick={() => setSelectedBinaural(p)} className={`flex items-center p-3 rounded-lg cursor-pointer border transition-all ${selectedBinaural.name === p.name ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-600'}`}>
                            <div className={`w-4 h-4 rounded-full border-2 mr-3 flex items-center justify-center ${selectedBinaural.name === p.name ? 'border-blue-500' : 'border-slate-600'}`}>{selectedBinaural.name === p.name && <div className="w-2 h-2 rounded-full bg-blue-500"></div>}</div>
                            <div className="flex-1"><span className="block text-xs font-bold text-slate-200">{p.name} ({p.delta}Hz)</span><span className="text-[9px] text-slate-400">{p.description}</span></div>
                          </div>
                       ))}
                    </div>
                  </div>
                </div>
            </div>
          )}
          
          <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none flex justify-center">
             <div className="pointer-events-auto w-full bg-black/90 backdrop-blur-xl border-t border-slate-800 shadow-2xl transition-all duration-300">
                <div className="w-full h-1 bg-slate-800/50 cursor-pointer group/seek" onClick={handleSeek}><div className="h-full bg-gold-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]" style={{width: `${(currTime / (currDuration || 1)) * 100}%`}}></div></div>
                <div className="px-3 py-3 flex flex-col items-center gap-2">
                    <div className="flex flex-wrap justify-center items-center gap-x-3 gap-y-1 text-[10px] font-medium text-slate-400">
                        <span className="text-slate-200 truncate max-w-[200px] font-bold">{playlist[currentSongIndex]?.name || "Aetheria Harmonic Player"}</span>
                        <div className="flex items-center gap-2"><span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gold-500/10 text-gold-500 border border-gold-500/20">{playlist[currentSongIndex]?.closestSolfeggio || selectedSolfeggio}Hz</span><span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">{selectedBinaural.name}</span><span className="font-mono text-slate-600 ml-1">{formatDuration(currTime)} / {formatDuration(currDuration)}</span></div>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 w-full">
                        <div className="flex items-center gap-3">
                            <button onClick={() => setIsShuffle(!isShuffle)} className={`${isShuffle ? 'text-gold-500' : 'text-slate-600'} hover:text-white`} title="Shuffle Library"><Shuffle size={14}/></button>
                            <button onClick={() => playTrack(currentSongIndex - 1)} className="text-slate-300 hover:text-white"><SkipBack size={16}/></button>
                            <button onClick={handlePlayPause} className="w-10 h-10 rounded-full bg-gold-500 hover:bg-gold-400 flex items-center justify-center text-black shadow-lg transition-all hover:scale-105 active:scale-95">{isPlaying ? <Pause size={18} fill="black" /> : <Play size={18} fill="black" className="ml-0.5" />}</button>
                            <button onClick={playNext} className="text-slate-300 hover:text-white"><SkipForward size={16}/></button>
                            <button onClick={() => setIsLoop(!isLoop)} className={`${isLoop ? 'text-gold-500' : 'text-slate-600'} hover:text-white`} title="Loop Library"><Repeat size={14}/></button>
                        </div>
                        <div className="w-px h-6 bg-slate-800 hidden sm:block"></div>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2 group/vol"><Volume2 size={14} className="text-slate-500 group-hover/vol:text-gold-400" /><input type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(parseFloat(e.target.value))} className="w-16 sm:w-20 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-gold-500" /></div>
                            <div className="flex items-center gap-2 group/bin"><Zap size={14} className="text-slate-500 group-hover/bin:text-blue-400" /><input type="range" min="0" max="0.2" step="0.001" value={binauralVolume} onChange={e => setBinauralVolume(parseFloat(e.target.value))} className="w-16 sm:w-20 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500" /></div>
                            <button onClick={() => setIsZenMode(!isZenMode)} className={`p-1.5 rounded-full ${isZenMode ? 'text-gold-500 bg-gold-500/10' : 'text-slate-500 hover:text-white'}`} title="Zen Mode">{isZenMode ? <Eye size={16} /> : <EyeOff size={16} />}</button>
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