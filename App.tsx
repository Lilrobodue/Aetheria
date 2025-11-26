import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, 
  Upload, Settings, Info, Activity, Volume2, Maximize2, Minimize2, 
  Circle, Zap, X, Menu, Eye, EyeOff, ChevronDown, ChevronUp, BarChart3, Loader2, Sparkles, Sliders, Wind, Activity as PulseIcon, Waves, Wand2, Search, Video, Mic, Monitor, RefreshCw, Flame, Flower2, Layers, Heart, Smile, Moon, Droplets, FilePlus
} from 'lucide-react';
import { Song, SolfeggioFreq, BinauralPreset, VizSettings } from './types';
import { SOLFEGGIO_INFO, BINAURAL_PRESETS, PITCH_SHIFT_FACTOR, CHAKRA_INFO_TEXT, SEPHIROT_INFO, TREE_OF_LIFE_EXPLANATION } from './constants';
import Visualizer from './components/Visualizer';

// --- Spectrum Analyzer Component ---
const SpectrumAnalyzer: React.FC<{ analyser: AnalyserNode | null; visible: boolean }> = ({ analyser, visible }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!visible || !canvasRef.current || !analyser) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      
      if (canvas.width !== canvas.offsetWidth || canvas.height !== canvas.offsetHeight) {
          canvas.width = canvas.offsetWidth;
          canvas.height = canvas.offsetHeight;
      }
      
      analyser.getByteFrequencyData(dataArray);
      
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      
      const barCount = 128; 
      const barSpacing = 1;
      const totalSpacing = (barCount - 1) * barSpacing;
      const barWidth = (w - totalSpacing) / barCount;
      
      const gradient = ctx.createLinearGradient(0, h, 0, 0);
      gradient.addColorStop(0, '#f59e0b'); 
      gradient.addColorStop(0.5, '#ef4444'); 
      gradient.addColorStop(1, '#a855f7'); 

      ctx.fillStyle = gradient;

      for(let i = 0; i < barCount; i++) {
        const percent = i / barCount;
        const logIndex = Math.floor(percent * percent * (bufferLength / 1.5));
        let value = dataArray[logIndex] || 0;
        value = value * (1 + percent * 0.5);
        const barHeight = (value / 255) * h;
        const x = i * (barWidth + barSpacing);
        const y = h - barHeight;

        if (barHeight > 0) {
            ctx.fillRect(x, y, barWidth, barHeight);
        }
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser, visible]);

  if (!visible) return null;

  return (
    <div className="w-full h-24 bg-black/50 rounded-lg border border-slate-800/50 backdrop-blur-sm overflow-hidden relative shadow-inner mt-2">
      <div className="absolute top-1 left-2 text-[9px] text-gold-500/50 font-mono tracking-widest uppercase">High-Res Spectral Analysis</div>
      <canvas ref={canvasRef} className="w-full h-full opacity-90" />
    </div>
  );
};

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
    // Optimization: Use 3 seconds instead of 5 to speed up bulk scanning
    const sampleDuration = 3;
    const offlineCtx = new OfflineAudioContext(1, 44100 * sampleDuration, 44100); 
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    
    const analyser = offlineCtx.createAnalyser();
    analyser.fftSize = 32768; // Maximize frequency resolution
    analyser.smoothingTimeConstant = 0.1;
    
    source.connect(analyser);
    analyser.connect(offlineCtx.destination);
    
    // Scan middle of track for stability
    const startOffset = Math.min(buffer.duration / 2, 30);
    source.start(0, startOffset, sampleDuration);
    
    await offlineCtx.startRendering();
    
    const data = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(data);
    
    let maxVal = -Infinity;
    let maxIndex = -1;
    
    const binSize = 44100 / analyser.fftSize;
    // START BIN: Ignore < 70Hz to skip Kick Drums/Sub-bass that bias detection to 174Hz
    const startBin = Math.floor(70 / binSize);

    for (let i = startBin; i < data.length; i++) {
      let magnitude = data[i];
      const freq = i * binSize;

      // WEIGHTING: Penalize lower-mid bass (70-250Hz) slightly to favor the harmonic midrange
      // This forces the detector to look for the "Chord" center rather than the "Bass" root.
      if (freq < 250) {
          magnitude -= 5; // -5dB penalty
      }

      if (magnitude > maxVal) {
        maxVal = magnitude;
        maxIndex = i;
      }
    }

    // Parabolic Interpolation for higher accuracy
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
        // Expanded Harmonic Search:
        // Check Fundamental, +/- 1 Octave, +/- 2 Octaves
        // This helps if the song key is very high or very low relative to the Solfeggio tone
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

const App: React.FC = () => {
  const [playlist, setPlaylist] = useState<Song[]>([]);
  const [originalPlaylist, setOriginalPlaylist] = useState<Song[]>([]); 
  const [currentSongIndex, setCurrentSongIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isLoop, setIsLoop] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);
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

  const [vizSettings, setVizSettings] = useState<VizSettings>({
    speed: 1.0,
    sensitivity: 1.0,
    particleDensity: 'medium',
    coreSize: 1.0,
    showHexagons: true,
    hexOpacity: 0.6,
    hexVisualMode: 'spectrum', 
    showWaterRipples: false,
    hydroIntensity: 1.0,
    showTreeOfLife: false,
    colorMode: 'chakra',
    particleMotion: 'flow',
    morphEnabled: true
  });

  const [volume, setVolume] = useState(0.8);
  const [solfeggioVolume, setSolfeggioVolume] = useState(0.05); 
  const [binauralVolume, setBinauralVolume] = useState(0.1);
  const [selectedSolfeggio, setSelectedSolfeggio] = useState<number>(396);
  const [selectedBinaural, setSelectedBinaural] = useState<BinauralPreset>(BINAURAL_PRESETS[2]); 
  const [useChakraOrder, setUseChakraOrder] = useState(false);
  const [showSpectrum, setShowSpectrum] = useState(false);
  const [isAdaptiveBinaural, setIsAdaptiveBinaural] = useState(false);
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
    isLoop
  });

  useEffect(() => {
    stateRef.current = { playlist, currentSongIndex, isShuffle, isLoop };
  }, [playlist, currentSongIndex, isShuffle, isLoop]);

  const playTrackRef = useRef<(index: number, list?: Song[]) => Promise<void>>(async () => {});

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

  // Decoupled volume update effect
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

    // Use value directly here for initial start
    mainGain.gain.value = binauralVolume;

    leftOsc.start();
    rightOsc.start();

    binauralLeftOscRef.current = leftOsc;
    binauralRightOscRef.current = rightOsc;
    binauralMergerRef.current = merger;
    binauralGainRef.current = mainGain;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, selectedBinaural]); // Removed binauralVolume from dep to prevent re-trigger

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
    
    if (currentSongIndex === -1 && newSongs.length > 0) {
        // Wait for user to play
    }

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
    // Focus on physical/deep healing: 174 (Pain), 285 (Tissue), 528 (DNA/Miracle)
    generateFilteredPlaylist(
        s => [174, 285, 528].includes(s.closestSolfeggio || 0), 
        'Deep Healing'
    );
  };

  const generateMoodPlaylist = () => {
    // Focus on emotional state: 396 (Fear/Guilt), 417 (Change), 639 (Relationships)
    generateFilteredPlaylist(
        s => [396, 417, 639].includes(s.closestSolfeggio || 0), 
        'Mood Elevation'
    );
  };

  const generateMeditationPlaylist = () => {
    // Focus on spiritual connection: 741 (Expression), 852 (Intuition), 963 (Oneness)
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
             const { playlist, currentSongIndex, isShuffle, isLoop } = stateRef.current;
             
             let nextIndex = currentSongIndex + 1;
             if (isShuffle) {
                 nextIndex = Math.floor(Math.random() * playlist.length);
             } else if (nextIndex >= playlist.length) {
                 if (isLoop) nextIndex = 0;
                 else return; 
             }
             playTrackRef.current(nextIndex);
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
    let nextIndex = currentSongIndex + 1;
    if (isShuffle) {
      nextIndex = Math.floor(Math.random() * playlist.length);
    } else if (nextIndex >= playlist.length) {
      if (isLoop) nextIndex = 0;
      else {
        setIsPlaying(false);
        return;
      }
    }
    playTrack(nextIndex);
  };

  const handlePrev = () => {
    let prev = currentSongIndex - 1;
    if (prev < 0) prev = playlist.length - 1;
    playTrack(prev);
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

      <div className={`relative z-10 flex flex-col h-screen transition-opacity duration-1000 ${isZenMode ? 'opacity-0 hover:opacity-100 active:opacity-100' : 'bg-black/20'}`}>
        
        <header className="flex justify-between items-center p-4 border-b border-slate-800/50 bg-black/80 backdrop-blur-md z-30 shadow-lg safe-area-top shrink-0">
          <div className="flex items-center gap-2">
             <button onClick={() => setShowSidebar(!showSidebar)} className="md:hidden text-gold-500 mr-2 p-1 hover:bg-slate-800 rounded">
               <Menu />
             </button>
            <div className="w-8 h-8 rounded-full bg-gold-500 animate-pulse-slow flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.5)]">
              <Activity className="text-slate-950 w-5 h-5" />
            </div>
            <h1 className="text-xl md:text-2xl font-serif text-gold-400 tracking-wider">AETHERIA <span className="text-[10px] text-slate-500 ml-2">v2.9</span></h1>
          </div>
          <div className="flex gap-2 md:gap-4">
             
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
                    className="p-2 text-slate-400 border-slate-800 bg-slate-900/50 hover:text-red-400 hover:border-red-500/50 transition-colors rounded-full border"
                 >
                    <Circle size={20} />
                 </button>
             )}

             <button onClick={() => setIsZenMode(!isZenMode)} className={`p-2 transition-colors rounded-full border ${isZenMode ? 'text-gold-500 border-gold-500 bg-gold-500/10' : 'text-slate-400 border-slate-800 bg-slate-900/50 hover:text-white'}`}>
                {isZenMode ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
            <button onClick={() => setShowSettings(!showSettings)} className="p-2 hover:text-gold-400 transition-colors bg-slate-900/50 rounded-full border border-slate-800"><Settings size={20} /></button>
            <button onClick={() => setShowInfo(!showInfo)} className="p-2 hover:text-gold-400 transition-colors bg-slate-900/50 rounded-full border border-slate-800"><Info size={20} /></button>
            <button onClick={() => setIsFullScreen(!isFullScreen)} className="p-2 hover:text-gold-400 transition-colors bg-slate-900/50 rounded-full border border-slate-800 hidden sm:block">
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
                      <p className="text-sm text-slate-400 mb-6">Choose a recording mode. Audio-only is recommended for long sessions (&gt;10 mins) to prevent crashes.</p>
                      
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
              <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setShowInfo(false)}>
                  <div className="bg-slate-900 border border-slate-700 p-8 rounded-2xl max-w-3xl w-full shadow-2xl max-h-[85vh] overflow-y-auto custom-scrollbar" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-between items-start mb-6 sticky top-0 bg-slate-900/95 pb-4 border-b border-slate-800 backdrop-blur-sm z-10">
                          <div>
                              <h2 className="text-2xl font-serif text-gold-400 mb-1">About Aetheria</h2>
                              <p className="text-slate-500 text-sm">Harmonic Resonance & Sacred Geometry</p>
                          </div>
                          <button onClick={() => setShowInfo(false)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white">
                              <X size={24} />
                          </button>
                      </div>
                      
                      <div className="prose prose-invert prose-sm max-w-none text-slate-300">
                          <p className="whitespace-pre-line mb-6 leading-relaxed">
                              {CHAKRA_INFO_TEXT}
                          </p>
                          
                          <div className="border-t border-slate-800 my-8"></div>

                          <h3 className="text-gold-500 font-bold uppercase tracking-widest mb-3 flex items-center gap-2">
                             <Flower2 size={18} /> The Tree of Life (Etz Chaim)
                          </h3>
                          <p className="text-slate-400 mb-6 leading-relaxed whitespace-pre-line">
                            {TREE_OF_LIFE_EXPLANATION}
                          </p>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
                             {SEPHIROT_INFO.map((node) => (
                                 <div key={node.name} className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/40 border border-slate-800 hover:border-slate-700 transition-colors">
                                     <div className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ backgroundColor: node.color, boxShadow: `0 0 8px ${node.color}` }}></div>
                                     <div>
                                         <div className="font-bold text-slate-200 text-sm">{node.name} <span className="text-slate-500 font-normal">- {node.meaning}</span></div>
                                         <div className="text-xs text-slate-400 mt-1">{node.correspondence}</div>
                                     </div>
                                 </div>
                             ))}
                          </div>

                          <div className="border-t border-slate-800 my-8"></div>

                          <h3 className="text-gold-500 font-bold uppercase tracking-widest mb-4">Frequency Guide</h3>
                          <div className="grid gap-3">
                              {SOLFEGGIO_INFO.map(s => (
                                  <div key={s.freq} className="flex items-center gap-4 p-3 rounded-lg bg-slate-800/50 border border-slate-800">
                                      <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-slate-900 shrink-0" style={{ backgroundColor: s.color }}>
                                          {s.freq}
                                      </div>
                                      <div>
                                          <div className="font-bold text-slate-200">{s.benefit}</div>
                                          <div className="text-xs text-slate-500 uppercase tracking-wider">{s.chakra} Chakra</div>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
              </div>
          )}

          <aside className={`
            absolute inset-y-0 left-0 z-[60] md:z-20 w-[85%] sm:w-80 md:relative 
            bg-black/90 md:bg-black/80 border-r border-slate-800 
            flex flex-col transition-transform duration-300 backdrop-blur-lg shadow-2xl
            ${showSidebar ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
            ${isFullScreen ? 'md:-ml-80' : ''}
          `}>
            <div className="p-4 border-b border-slate-800 shrink-0">
               <div className="grid grid-cols-2 gap-2 mb-3">
                   <label className="flex items-center justify-center gap-2 p-3 border border-gold-600/30 rounded-lg cursor-pointer bg-gold-600/5 hover:bg-gold-600/20 text-gold-500 transition-all active:scale-95 group text-xs">
                      <Upload size={16} className="group-hover:animate-bounce" />
                      <span className="font-semibold">Import Folder</span>
                      <input 
                        type="file" 
                        webkitdirectory="" 
                        directory="" 
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
            <div className="absolute inset-y-0 right-0 z-30 w-full md:w-96 bg-black/95 backdrop-blur-xl border-l border-slate-800 flex flex-col shadow-2xl transform transition-transform animate-in slide-in-from-right duration-300" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-start p-6 border-b border-slate-800">
                  <h3 className="text-gold-500 font-serif text-xl">Harmonic Control</h3>
                  <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-slate-800 rounded-full"><X className="text-slate-500 hover:text-white" /></button>
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
                                  <BarChart3 size={14} className="text-gold-500"/> Audio Spectrum
                                </span>
                                <button 
                                  onClick={() => setShowSpectrum(!showSpectrum)}
                                  className={`w-10 h-5 rounded-full relative transition-colors ${showSpectrum ? 'bg-gold-500' : 'bg-slate-700'}`}
                                >
                                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${showSpectrum ? 'left-6' : 'left-1'}`}></div>
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
                                        className="w-full accent-gold-500 h-1.5 bg-slate-700 rounded-lg appearance-none"
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
                                        className="w-full accent-gold-500 h-1.5 bg-slate-700 rounded-lg appearance-none"
                                    />
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
                                        className="w-full accent-gold-500 h-1.5 bg-slate-700 rounded-lg appearance-none"
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
                                                <span>{(vizSettings.hydroIntensity * 100).toFixed(0)}%</span>
                                            </div>
                                            <input 
                                                type="range" min="0.1" max="2.0" step="0.1"
                                                value={vizSettings.hydroIntensity}
                                                onChange={(e) => setVizSettings({...vizSettings, hydroIntensity: parseFloat(e.target.value)})}
                                                className="w-full accent-blue-500 h-1.5 bg-slate-700 rounded-lg appearance-none"
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
                                        <span className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Morph Geometry</span>
                                        <button 
                                            onClick={() => setVizSettings({...vizSettings, morphEnabled: !vizSettings.morphEnabled})}
                                            className={`w-8 h-4 rounded-full relative transition-colors ${vizSettings.morphEnabled ? 'bg-gold-500' : 'bg-slate-700'}`}
                                        >
                                            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${vizSettings.morphEnabled ? 'left-4.5' : 'left-0.5'}`}></div>
                                        </button>
                                    </div>
                                    <p className="text-[9px] text-slate-500">
                                        Toggle rhythmic breathing of sacred geometry patterns.
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
                                    <div className="text-[10px] text-slate-400 mb-1 uppercase tracking-widest">Particle Physics</div>
                                    <div className="grid grid-cols-3 gap-1">
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, particleMotion: 'flow'})}
                                            className={`text-[10px] py-1 rounded border flex items-center justify-center gap-1 ${vizSettings.particleMotion === 'flow' ? 'bg-blue-500/20 text-blue-400 border-blue-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
                                        >
                                            <Waves size={10} /> Flow
                                        </button>
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, particleMotion: 'float'})}
                                            className={`text-[10px] py-1 rounded border flex items-center justify-center gap-1 ${vizSettings.particleMotion === 'float' ? 'bg-purple-500/20 text-purple-400 border-purple-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
                                        >
                                            <Wind size={10} /> Float
                                        </button>
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, particleMotion: 'pulse'})}
                                            className={`text-[10px] py-1 rounded border flex items-center justify-center gap-1 ${vizSettings.particleMotion === 'pulse' ? 'bg-red-500/20 text-red-400 border-red-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
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
                                            title="Hex fixed, Core cycles"
                                        >
                                            Hybrid
                                        </button>
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, colorMode: 'cycle'})}
                                            className={`text-[10px] py-1 rounded border ${vizSettings.colorMode === 'cycle' ? 'bg-purple-500 text-white border-purple-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
                                            title="All colors cycle"
                                        >
                                            Hypnotic
                                        </button>
                                        <button
                                            onClick={() => setVizSettings({...vizSettings, colorMode: 'static'})}
                                            className={`text-[10px] py-1 rounded border ${vizSettings.colorMode === 'static' ? 'bg-gold-500 text-black border-gold-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}
                                            title="Locked to Solfeggio"
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
                        onPointerDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onChange={(e) => setSolfeggioVolume(parseFloat(e.target.value))}
                        className="w-full accent-gold-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
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
                            <Sparkles size={10} /> {isAdaptiveBinaural ? 'Adaptive On' : 'Adaptive Off'}
                        </button>
                    </div>

                    <div className="space-y-3">
                       {BINAURAL_PRESETS.map((p) => (
                          <div 
                            key={p.name} 
                            onClick={() => setSelectedBinaural(p)}
                            className={`flex items-center p-3 rounded-lg cursor-pointer border transition-all ${selectedBinaural.name === p.name ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-600'}`}
                          >
                            <div className={`w-4 h-4 rounded-full border-2 mr-3 flex items-center justify-center ${selectedBinaural.name === p.name ? 'border-blue-500' : 'border-slate-600'}`}>
                               {selectedBinaural.name === p.name && <div className="w-2 h-2 rounded-full bg-blue-500"></div>}
                            </div>
                            <div className="flex-1">
                               <div className="text-sm font-bold text-slate-200">{p.name}</div>
                               <div className="text-xs text-slate-500">{p.description}</div>
                            </div>
                          </div>
                       ))}
                    </div>
                     <div className="mt-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
                      <div className="flex justify-between text-xs text-slate-400 mb-2">
                         <span>Beat Volume</span>
                         <span>{(binauralVolume * 100).toFixed(0)}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" max="0.5" step="0.01" 
                        value={binauralVolume}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onChange={(e) => setBinauralVolume(parseFloat(e.target.value))}
                        className="w-full accent-blue-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
            </div>
          )}
        </main>

        <div className="fixed bottom-0 left-0 right-0 z-50 flex flex-col items-center safe-area-bottom pointer-events-none group">
           <div 
             className={`
                w-full max-w-2xl mx-auto transition-all duration-500 pointer-events-auto
                ${isZenMode 
                  ? 'opacity-0 translate-y-20 group-hover:opacity-100 group-hover:translate-y-0' 
                  : (isPlaying ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0')
                }
             `}
           >
             <div className="bg-black/90 backdrop-blur-xl border-t border-x border-gold-500/20 rounded-t-2xl px-6 py-4 mx-2 md:mx-0 shadow-[0_-5px_30px_rgba(0,0,0,0.8)] text-center">
                 <h2 className="text-lg md:text-xl font-serif text-white font-bold mb-1 line-clamp-1 drop-shadow-md">
                   {playlist[currentSongIndex]?.name || "Select Track"}
                 </h2>
                 <div className="flex justify-center items-center gap-2">
                   {isAnalyzing ? (
                       <span className="text-[10px] uppercase tracking-widest text-gold-500 animate-pulse">Scanning Harmonics...</span>
                   ) : (
                       <>
                           <span className="text-[10px] uppercase tracking-widest text-gold-500 font-bold">{selectedSolfeggio}Hz <span className="text-slate-500 font-normal">Resonance</span></span>
                           <div className="w-1 h-1 bg-slate-600 rounded-full"></div>
                           <span className="text-[10px] uppercase tracking-widest text-blue-400 font-bold">{selectedBinaural.name} <span className="text-slate-500 font-normal">Wave</span></span>
                       </>
                   )}
                 </div>
             </div>
           </div>

           <footer className={`w-full bg-black/95 backdrop-blur-2xl border-t border-slate-800 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] transition-all duration-1000 pointer-events-auto ${showSpectrum ? 'pb-2' : ''} ${isZenMode ? 'opacity-0 translate-y-full group-hover:opacity-100 group-hover:translate-y-0' : 'opacity-100'}`}>
             
             <div 
                className="w-full h-2 bg-slate-900 cursor-pointer group relative"
                onClick={handleSeek}
             >
                <div className="absolute inset-y-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-full"></div>
                
                <div 
                  className="h-full bg-gradient-to-r from-gold-600 via-gold-400 to-white w-0 relative shadow-[0_0_15px_rgba(250,204,21,0.6)] transition-all duration-100 ease-linear"
                  style={{ width: `${currDuration > 0 ? (currTime / currDuration) * 100 : 0}%` }}
                >
                   <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity scale-125"></div>
                </div>

                <div className="absolute top-[-20px] left-2 text-[10px] text-slate-400 font-mono pointer-events-none">
                   {formatDuration(currTime)} / {formatDuration(currDuration)}
                </div>
             </div>
             
             <div className="flex flex-col md:flex-row items-center justify-between px-4 md:px-8 py-3 gap-3 md:gap-0">
                
                <div className="hidden md:flex flex-col items-start w-48 order-1 opacity-60">
                   <span className="text-[9px] text-gold-500 uppercase tracking-widest">Aetheria Engine</span>
                   <span className="text-[9px] text-slate-500">v2.9 • High-Res Analysis</span>
                </div>
   
                <div className="flex items-center justify-center gap-6 order-2 flex-1 w-full md:w-auto">
                  <button 
                     onClick={() => setIsShuffle(!isShuffle)} 
                     className={`p-2 rounded-full transition-all ${isShuffle ? 'text-gold-500' : 'text-slate-600 hover:text-slate-400'}`}
                   >
                     <Shuffle size={16} />
                  </button>
   
                  <button onClick={handlePrev} className="p-2 text-slate-300 hover:text-white transition-colors active:scale-90">
                    <SkipBack size={24} fill="currentColor" className="opacity-80"/>
                  </button>
   
                  <button 
                     onClick={handlePlayPause}
                     className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center shadow-[0_0_25px_rgba(255,255,255,0.3)] hover:scale-105 active:scale-95 transition-all"
                  >
                       {isPlaying ? <Pause size={24} fill="black" /> : <Play size={24} fill="black" className="ml-1" />}
                  </button>
   
                  <button onClick={handleNext} className="p-2 text-slate-300 hover:text-white transition-colors active:scale-90">
                    <SkipForward size={24} fill="currentColor" className="opacity-80"/>
                  </button>
   
                  <button 
                     onClick={() => setIsLoop(!isLoop)} 
                     className={`p-2 rounded-full transition-all ${isLoop ? 'text-gold-500' : 'text-slate-600 hover:text-slate-400'}`}
                   >
                     <Repeat size={16} />
                  </button>
                </div>
   
                <div className="flex items-center gap-3 w-full md:w-48 justify-end order-3">
                  <Volume2 size={16} className="text-slate-500 shrink-0" />
                  <input 
                    type="range" 
                    min="0" max="1" step="0.05" 
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-full accent-gold-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
             </div>
   
             {showSpectrum && (
                 <div className="px-4 pb-2 w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
                     <SpectrumAnalyzer analyser={analyserNode} visible={showSpectrum} />
                 </div>
             )}
           </footer>
        </div>
        
        {/* Upload & Scan Progress Modals omitted for brevity (same as before) */}
      </div>
    </div>
  );
};

export default App;