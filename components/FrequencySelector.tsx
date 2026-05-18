import React, { useState, useEffect, useRef } from 'react';
import { 
  AlertTriangle, 
  Zap, 
  Heart, 
  Brain, 
  Eye, 
  Shield, 
  Dna, 
  Activity,
  Volume2,
  VolumeX,
  Info,
  Search,
  Waves,
  Target,
  Sparkles,
  Crown,
  Flower2,
  Microscope,
  Settings,
  X,
  ChevronDown,
  ChevronUp,
  Play,
  Pause,
  Lock,
  Unlock
} from 'lucide-react';

import { 
  EXTENDED_SOLFEGGIO, 
  PATTERN_111, 
  DNA_FREQUENCY_MAP,
  SAFETY_PROTOCOLS,
  getFrequencyByIntention,
  generateSafetyWarning,
  assessFrequencySafety,
  type FractalAnalysisResult
} from '../utils/fractalFrequencyAnalysis';

interface FrequencySelectorProps {
  selectedFrequency: number;
  onFrequencyChange: (frequency: number) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  isPlaying: boolean;
  onPlayPause: () => void;
  fractalAnalysis?: FractalAnalysisResult;
  userExperienceLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  onExperienceLevelChange: (level: 'beginner' | 'intermediate' | 'advanced' | 'expert') => void;
  /** When true, GUT-band Solfeggio frequencies are displayed and selected as
   *  their Lo Shu Perfect counterparts (174→75, 285→186, 396→297, 417→408,
   *  528→519, 639→630). 741/852/963 are exact matches and unaffected. */
  loShuPerfectGUT?: boolean;
}

// Lo Shu Perfect GUT swap table — only the 6 GUT positions that differ from
// the Lo Shu Perfect 111-interval sequence. 741, 852, 963 are exact matches
// in both systems; HEART/HEAD frequencies are not in the GUT band at all.
const LO_SHU_PERFECT_GUT_MAP: Record<number, number> = {
  174: 75,
  285: 186,
  396: 297,
  417: 408,
  528: 519,
  639: 630,
};

interface FrequencyPreset {
  name: string;
  frequency: number;
  category: 'solfeggio' | 'dna' | 'chakra' | 'pattern_111' | 'custom' | 'schumann' | 'binaural';
  description: string;
  benefits: string[];
  safetyLevel: 'SAFE' | 'CAUTION' | 'EXPERT' | 'RESEARCH';
  icon: React.ReactNode;
  color: string;
  intention?: string;
  duration?: string;
  warnings?: string[];
}

const FrequencySelector: React.FC<FrequencySelectorProps> = ({
  selectedFrequency,
  onFrequencyChange,
  volume,
  onVolumeChange,
  isPlaying,
  onPlayPause,
  fractalAnalysis,
  userExperienceLevel,
  onExperienceLevelChange,
  loShuPerfectGUT = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customFrequency, setCustomFrequency] = useState('');
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [intentionMode, setIntentionMode] = useState(false);

  // The currently selected frequency's safety warning, if any. Surfaced
  // inline rather than as a blocking modal — selection always proceeds.
  const selectedWarning = generateSafetyWarning(selectedFrequency);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // Generate frequency presets
  const generatePresets = (): FrequencyPreset[] => {
    const presets: FrequencyPreset[] = [];

    // Solfeggio Frequencies — when Lo Shu Perfect mode is on, the GUT-band
    // entries are mapped to their perfect counterparts at both display and
    // selection time. The display value === the selection value, so the
    // app's audio-side mapper is a no-op for these (no double-swap risk).
    EXTENDED_SOLFEGGIO.BASE_FREQUENCIES.forEach((rawFreq, index) => {
      const solfeggioInfo = [
        { name: 'UT - Liberation', benefits: ['Release guilt', 'Clear fear', 'Ground energy'], color: '#8B0000' },
        { name: 'RE - Transformation', benefits: ['Heal trauma', 'Restore tissue', 'Cellular repair'], color: '#FF0000' },
        { name: 'MI - Miracle', benefits: ['Release guilt', 'Clear negativity', 'Root activation'], color: '#FF4500' },
        { name: 'FA - Resonance', benefits: ['Facilitate change', 'Clear subconscious', 'New beginnings'], color: '#FF8C00' },
        { name: 'SOL - Expression', benefits: ['DNA repair', 'Transformation', 'Love frequency'], color: '#FFD700' },
        { name: 'LA - Awakening', benefits: ['Connect relationships', 'Heal connections', 'Heart opening'], color: '#008000' },
        { name: 'TI - Intuition', benefits: ['Express truth', 'Clear toxins', 'Throat activation'], color: '#00BFFF' },
        { name: 'SI - Order', benefits: ['Awaken intuition', 'Third eye', 'Spiritual insight'], color: '#4B0082' },
        { name: 'NI - Unity', benefits: ['Crown activation', 'Divine connection', 'Perfect state'], color: '#EE82EE' }
      ][index];

      const freq = loShuPerfectGUT ? (LO_SHU_PERFECT_GUT_MAP[rawFreq] ?? rawFreq) : rawFreq;
      const swapped = freq !== rawFreq;

      presets.push({
        name: `${freq} Hz - ${solfeggioInfo.name}`,
        frequency: freq,
        category: 'solfeggio',
        description: swapped
          ? `Lo Shu Perfect counterpart of ${rawFreq} Hz — keeps the same digit root and chakra mapping at the perfect 111 Hz interval.`
          : `Ancient solfeggio frequency for healing and transformation`,
        benefits: solfeggioInfo.benefits,
        safetyLevel: 'SAFE',
        icon: <Heart className="w-5 h-5" />,
        color: solfeggioInfo.color,
        duration: '15-30 minutes',
        intention: 'healing'
      });
    });

    // 111 Hz Pattern
    PATTERN_111.HARMONIC_SERIES.slice(0, 8).forEach((freq, index) => {
      presets.push({
        name: `${freq} Hz - Cellular Communication`,
        frequency: freq,
        category: 'pattern_111',
        description: `111 Hz pattern harmonic for DNA activation and cellular resonance`,
        benefits: ['DNA activation', 'Cellular communication', 'Genetic repair'],
        safetyLevel: freq > 1000 ? 'CAUTION' : 'SAFE',
        icon: <Dna className="w-5 h-5" />,
        color: '#00CED1',
        duration: '10-20 minutes',
        intention: 'dna_repair'
      });
    });

    // Schumann Resonances
    const schumannFreqs = [7.83, 14.3, 20.8, 27.3, 33.8, 39.3, 45.9, 59.9];
    schumannFreqs.forEach(freq => {
      presets.push({
        name: `${freq} Hz - Schumann Resonance`,
        frequency: freq,
        category: 'schumann',
        description: `Earth's natural electromagnetic frequency for grounding and balance`,
        benefits: ['Earth connection', 'Natural grounding', 'Electromagnetic balance'],
        safetyLevel: 'SAFE',
        icon: <Shield className="w-5 h-5" />,
        color: '#228B22',
        duration: '20-60 minutes',
        intention: 'grounding'
      });
    });

    // High-Frequency Therapies (Expert Level)
    const highFreqs = [1074, 1152, 1244, 1337, 1456, 1584, 1728, 1888, 2000, 2222, 2500, 2880, 3168, 3456, 3840];
    highFreqs.forEach(freq => {
      const safetyAssessment = assessFrequencySafety(freq);
      presets.push({
        name: `${freq} Hz - High Resonance`,
        frequency: freq,
        category: 'custom',
        description: `High-frequency therapeutic tone for advanced practitioners`,
        benefits: ['Pineal activation', 'Crown resonance', 'Consciousness expansion'],
        safetyLevel: safetyAssessment.level,
        icon: <Crown className="w-5 h-5" />,
        color: freq > 2000 ? '#FF6B6B' : '#FFD93D',
        duration: '5-15 minutes max',
        intention: 'crown_activation',
        warnings: freq > 1500 ? ['Use only with experience', 'Keep volume very low', 'Limit exposure time'] : undefined
      });
    });

    return presets.sort((a, b) => a.frequency - b.frequency);
  };

  // Re-generate presets whenever the Lo Shu Perfect mode flips, so the
  // displayed Solfeggio entries swap to/from their perfect counterparts.
  const presets = React.useMemo(generatePresets, [loShuPerfectGUT]);

  // Filter presets based on search and category
  const filteredPresets = presets.filter(preset => {
    const matchesSearch = preset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         preset.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         preset.benefits.some(benefit => benefit.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesCategory = selectedCategory === 'all' || preset.category === selectedCategory;
    
    // Filter by experience level
    const experienceFilter = (() => {
      switch (userExperienceLevel) {
        case 'beginner':
          return preset.safetyLevel === 'SAFE' && preset.frequency <= 1000;
        case 'intermediate':
          return ['SAFE', 'CAUTION'].includes(preset.safetyLevel) && preset.frequency <= 2000;
        case 'advanced':
          return ['SAFE', 'CAUTION', 'EXPERT'].includes(preset.safetyLevel) && preset.frequency <= 5000;
        case 'expert':
          return true;
        default:
          return preset.safetyLevel === 'SAFE';
      }
    })();

    return matchesSearch && matchesCategory && experienceFilter;
  });

  // Handle frequency selection.
  // Previously this popped a blocking safety modal for non-expert users on any
  // frequency that produced a warning, which prevented playback. The warning
  // is now surfaced inline (see the "Selected" card and the per-preset card)
  // and selection always proceeds. The per-frequency volume safety net still
  // runs so high frequencies can't be played at unsafe levels.
  const handleFrequencySelect = (frequency: number) => {
    const safetyAssessment = assessFrequencySafety(frequency);

    onFrequencyChange(frequency);

    // Auto-adjust volume for safety
    if (safetyAssessment.volume < volume) {
      onVolumeChange(safetyAssessment.volume);
    }

    // If the player is currently paused, start playback so the user hears
    // the frequency they just picked instead of having to reach for play.
    if (!isPlaying) {
      onPlayPause();
    }
  };

  // Handle custom frequency input
  const handleCustomFrequency = () => {
    const freq = parseFloat(customFrequency);
    if (!isNaN(freq) && freq >= 0.1 && freq <= 20000) {
      handleFrequencySelect(freq);
      setCustomFrequency('');
    }
  };

  // Intention-based frequency selection
  const handleIntentionSelect = (intention: string) => {
    const frequencies = getFrequencyByIntention(intention);
    if (frequencies.length > 0) {
      handleFrequencySelect(frequencies[0]); // Use primary frequency
    }
  };

  // Octave-shift frequencies above 963Hz down to sub-bass range (20-60Hz)
  const toSubBass = (freq: number): number => {
    if (freq <= 963) return freq;
    let f = freq;
    while (f > 60) f /= 2;
    if (f < 20) f *= 2;
    return f;
  };

  // Generate tone for testing
  const generateTestTone = (frequency: number, duration: number = 3000) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const context = audioContextRef.current;

    // Stop any existing tone
    if (oscillatorRef.current) {
      oscillatorRef.current.stop();
      oscillatorRef.current.disconnect();
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
    }

    // Create new tone
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = toSubBass(frequency);
    
    const safetyAssessment = assessFrequencySafety(frequency);
    const testVolume = Math.min(0.1, safetyAssessment.volume * 0.3); // Very quiet for testing
    
    gainNode.gain.value = 0;
    gainNode.gain.linearRampToValueAtTime(testVolume, context.currentTime + 0.1);
    gainNode.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration / 1000);
    
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    
    oscillator.start();
    oscillator.stop(context.currentTime + duration / 1000);
    
    oscillatorRef.current = oscillator;
    gainNodeRef.current = gainNode;
  };

  const getSafetyIcon = (level: string) => {
    switch (level) {
      case 'SAFE': return <Shield className="w-4 h-4 text-green-500" />;
      case 'CAUTION': return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'EXPERT': return <Crown className="w-4 h-4 text-orange-500" />;
      case 'RESEARCH': return <Microscope className="w-4 h-4 text-red-500" />;
      default: return <Shield className="w-4 h-4 text-gray-500" />;
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'solfeggio': return <Heart className="w-4 h-4" />;
      case 'dna': return <Dna className="w-4 h-4" />;
      case 'pattern_111': return <Target className="w-4 h-4" />;
      case 'schumann': return <Shield className="w-4 h-4" />;
      case 'chakra': return <Flower2 className="w-4 h-4" />;
      case 'binaural': return <Brain className="w-4 h-4" />;
      default: return <Waves className="w-4 h-4" />;
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 shadow-2xl max-w-4xl mx-auto">
      
      {/* Header */}
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gold-400 flex items-center gap-2">
          <Target className="w-6 h-6" />
          Frequency Laboratory
          {loShuPerfectGUT && (
            <span
              className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 uppercase tracking-wider"
              title="Lo Shu Perfect mode is active. GUT-band Solfeggio entries are shown and selected as their perfect 111 Hz counterparts (174→75, 285→186, 396→297, 417→408, 528→519, 639→630). Toggle in the Guidebook → Lo Shu section."
            >
              Lo Shu Perfect
            </span>
          )}
        </h2>

        {/* Experience Level Selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">Experience:</label>
          <select
            value={userExperienceLevel}
            onChange={(e) => onExperienceLevelChange(e.target.value as any)}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white"
          >
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
            <option value="expert">Expert</option>
          </select>
        </div>
      </div>

      {/* Inline safety warning for the currently selected frequency.
          Replaces the old blocking modal — selection now always proceeds. */}
      {selectedWarning && (
        <div className="mb-4 flex items-start gap-3 p-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10">
          <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
          <pre className="text-xs text-yellow-200 whitespace-pre-wrap font-sans leading-relaxed">
            {selectedWarning}
          </pre>
        </div>
      )}

      {/* Current Selection */}
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-4 mb-6">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-lg font-bold text-white flex items-center gap-2">
              {selectedFrequency.toFixed(2)} Hz
              {getSafetyIcon(assessFrequencySafety(selectedFrequency).level)}
            </div>
            <div className="text-sm text-slate-400">
              Currently selected frequency
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => generateTestTone(selectedFrequency)}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white text-sm flex items-center gap-1"
            >
              <Play className="w-3 h-3" />
              Test
            </button>
            
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-slate-400" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                className="w-20 accent-gold-500"
              />
              <span className="text-xs text-slate-400 w-8">
                {Math.round(volume * 100)}%
              </span>
            </div>
          </div>
        </div>

        {/* Fractal Analysis Display */}
        {fractalAnalysis && (
          <div className="mt-3 pt-3 border-t border-slate-700">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="bg-slate-900 p-2 rounded">
                <div className="text-gold-400">Golden Ratio</div>
                <div className="text-white font-bold">
                  {Math.round(fractalAnalysis.goldenRatioAlignment * 100)}%
                </div>
              </div>
              <div className="bg-slate-900 p-2 rounded">
                <div className="text-blue-400">111 Pattern</div>
                <div className="text-white font-bold">
                  {Math.round(fractalAnalysis.pattern111Presence * 100)}%
                </div>
              </div>
              <div className="bg-slate-900 p-2 rounded">
                <div className="text-green-400">DNA Resonance</div>
                <div className="text-white font-bold">
                  {Math.round(fractalAnalysis.dnaResonanceScore * 100)}%
                </div>
              </div>
              <div className="bg-slate-900 p-2 rounded">
                <div className="text-purple-400">Fractal Dim</div>
                <div className="text-white font-bold">
                  {fractalAnalysis.fractalDimension.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Search and Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="frequency-search"
            name="frequency-search"
            type="text"
            placeholder="Search frequencies..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 rounded pl-10 pr-4 py-2 text-white"
          />
        </div>
        
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white"
        >
          <option value="all">All Categories</option>
          <option value="solfeggio">Solfeggio</option>
          <option value="pattern_111">111 Hz Pattern</option>
          <option value="schumann">Schumann</option>
          <option value="custom">High Frequency</option>
        </select>

        <button
          onClick={() => setIntentionMode(!intentionMode)}
          className={`px-3 py-2 rounded flex items-center gap-2 ${
            intentionMode ? 'bg-purple-600' : 'bg-slate-700'
          } text-white`}
        >
          <Brain className="w-4 h-4" />
          Intention Mode
        </button>
      </div>

      {/* Intention Mode */}
      {intentionMode && (
        <div className="bg-slate-800 border border-slate-600 rounded-lg p-4 mb-4">
          <h3 className="text-lg font-bold text-purple-400 mb-3">Select by Intention</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {[
              'dna_repair', 'cellular_healing', 'energy_boost', 'meditation',
              'focus', 'sleep', 'creativity', 'protection', 'manifestation',
              'grounding', 'third_eye', 'heart_opening', 'throat_chakra', 'crown_activation'
            ].map(intention => (
              <button
                key={intention}
                onClick={() => handleIntentionSelect(intention)}
                className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-sm capitalize"
              >
                {intention.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Custom Frequency Input */}
      <div className="flex gap-3 mb-6">
        <input
          id="custom-frequency"
          name="custom-frequency"
          type="number"
          placeholder="Custom frequency (Hz)"
          value={customFrequency}
          onChange={(e) => setCustomFrequency(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white"
          min="0.1"
          max="20000"
          step="0.1"
        />
        <button
          onClick={handleCustomFrequency}
          disabled={!customFrequency || isNaN(parseFloat(customFrequency))}
          className="px-4 py-2 bg-gold-600 hover:bg-gold-500 disabled:bg-slate-700 disabled:text-slate-400 rounded text-white font-medium"
        >
          Set
        </button>
      </div>

      {/* Frequency Presets */}
      <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
        {filteredPresets.map((preset, index) => (
          <div
            key={`${preset.frequency}-${index}`}
            className={`bg-slate-800 border ${
              selectedFrequency === preset.frequency ? 'border-gold-500' : 'border-slate-600'
            } rounded-lg overflow-hidden transition-all hover:border-slate-500`}
          >
            <div 
              className="p-4 cursor-pointer"
              onClick={() => setExpandedCard(expandedCard === preset.name ? null : preset.name)}
            >
              <div className="flex justify-between items-start">
                <div className="flex items-start gap-3">
                  <div style={{ color: preset.color }}>
                    {preset.icon}
                  </div>
                  <div>
                    <h3 className="font-bold text-white">{preset.name}</h3>
                    <p className="text-sm text-slate-400 mt-1">{preset.description}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {preset.benefits.slice(0, 3).map((benefit, i) => (
                        <span key={i} className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">
                          {benefit}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {getSafetyIcon(preset.safetyLevel)}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFrequencySelect(preset.frequency);
                    }}
                    className="px-3 py-1 bg-gold-600 hover:bg-gold-500 rounded text-white text-sm"
                  >
                    Select
                  </button>
                  {expandedCard === preset.name ? 
                    <ChevronUp className="w-4 h-4 text-slate-400" /> : 
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  }
                </div>
              </div>
            </div>

            {/* Expanded Details */}
            {expandedCard === preset.name && (
              <div className="border-t border-slate-700 p-4 bg-slate-900">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-bold text-gold-400 mb-2">Benefits</h4>
                    <ul className="text-sm text-slate-300 space-y-1">
                      {preset.benefits.map((benefit, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <Sparkles className="w-3 h-3 text-gold-500" />
                          {benefit}
                        </li>
                      ))}
                    </ul>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-bold text-blue-400 mb-2">Usage</h4>
                    <div className="text-sm text-slate-300 space-y-1">
                      <div>Duration: {preset.duration}</div>
                      <div>Safety: {preset.safetyLevel}</div>
                      {preset.warnings && (
                        <div className="mt-2">
                          <div className="text-yellow-400 text-xs font-bold">Warnings:</div>
                          {preset.warnings.map((warning, i) => (
                            <div key={i} className="text-xs text-yellow-300">• {warning}</div>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    <button
                      onClick={() => generateTestTone(preset.frequency)}
                      className="mt-3 px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white text-xs flex items-center gap-1"
                    >
                      <Play className="w-3 h-3" />
                      Test Tone
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredPresets.length === 0 && (
        <div className="text-center py-8 text-slate-400">
          <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No frequencies found matching your criteria</p>
          <p className="text-sm mt-1">Try adjusting your search or experience level</p>
        </div>
      )}

    </div>
  );
};

export default FrequencySelector;