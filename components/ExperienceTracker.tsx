import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Heart,
  Zap,
  Brain,
  Frown,
  Meh,
  Smile,
  Plus,
  X,
  Save,
  Clock,
  Activity,
  MessageCircle,
  Star,
  AlertCircle,
  CheckCircle,
  User,
  Target,
  Sparkles
} from 'lucide-react';

interface ExperienceTrackerProps {
  isDocumenting: boolean;
  onToggleDocumentation: () => void;
  currentFrequency: number;
  currentVolume: number;
  sessionDuration: number;
  isPlaying: boolean;
  onSessionStart?: (sessionData: SessionStartData) => void;
  onSessionEnd?: (sessionData: SessionEndData) => void;
  onAddNote?: (note: string) => void;
}

interface SessionStartData {
  priorState: {
    mood: number;
    energy: number;
    stress: number;
    focus: number;
    pain?: number;
    other?: { [key: string]: number };
  };
  intention: string;
  environment: string;
  preparation: string[];
}

interface SessionEndData {
  postState: {
    mood: number;
    energy: number;
    stress: number;
    focus: number;
    pain?: number;
    other?: { [key: string]: number };
  };
  effectsExperienced: string[];
  sensations: string[];
  emotionalChanges: string[];
  physicalSensations: string[];
  mentalChanges: string[];
  overallExperience: number;
  wouldRecommend: boolean;
  notes: string;
}

const ExperienceTracker: React.FC<ExperienceTrackerProps> = ({
  isDocumenting,
  onToggleDocumentation,
  currentFrequency,
  currentVolume,
  sessionDuration,
  isPlaying,
  onSessionStart,
  onSessionEnd,
  onAddNote
}) => {
  const [showStartModal, setShowStartModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [sessionNotes, setSessionNotes] = useState<string[]>([]);
  const [currentNote, setCurrentNote] = useState('');
  
  // Pre-session state
  const [priorState, setPriorState] = useState({
    mood: 5,
    energy: 5,
    stress: 5,
    focus: 5,
    pain: 0
  });
  const [intention, setIntention] = useState('');
  const [environment, setEnvironment] = useState('');
  const [preparation, setPreparation] = useState<string[]>([]);
  
  // Post-session state
  const [postState, setPostState] = useState({
    mood: 5,
    energy: 5,
    stress: 5,
    focus: 5,
    pain: 0
  });
  const [effectsExperienced, setEffectsExperienced] = useState<string[]>([]);
  const [sensations, setSensations] = useState<string[]>([]);
  const [emotionalChanges, setEmotionalChanges] = useState<string[]>([]);
  const [physicalSensations, setPhysicalSensations] = useState<string[]>([]);
  const [mentalChanges, setMentalChanges] = useState<string[]>([]);
  const [overallExperience, setOverallExperience] = useState(5);
  const [wouldRecommend, setWouldRecommend] = useState(true);
  const [finalNotes, setFinalNotes] = useState('');

  // Handle documentation toggle
  useEffect(() => {
    if (isDocumenting && !showStartModal && !showEndModal) {
      // Starting documentation - show pre-session modal
      setShowStartModal(true);
    } else if (!isDocumenting && sessionNotes.length > 0) {
      // Ending documentation - show post-session modal
      setShowEndModal(true);
    }
  }, [isDocumenting]);

  const handleStartSession = () => {
    const sessionData: SessionStartData = {
      priorState: { ...priorState },
      intention,
      environment,
      preparation
    };
    
    onSessionStart?.(sessionData);
    setShowStartModal(false);
  };

  const handleEndSession = () => {
    const sessionData: SessionEndData = {
      postState: { ...postState },
      effectsExperienced,
      sensations,
      emotionalChanges,
      physicalSensations,
      mentalChanges,
      overallExperience,
      wouldRecommend,
      notes: [...sessionNotes, finalNotes].filter(n => n.trim()).join('\n\n')
    };
    
    onSessionEnd?.(sessionData);
    setShowEndModal(false);
    
    // Reset all state for next session
    resetAllState();
  };

  const resetAllState = () => {
    setSessionNotes([]);
    setCurrentNote('');
    setPriorState({ mood: 5, energy: 5, stress: 5, focus: 5, pain: 0 });
    setPostState({ mood: 5, energy: 5, stress: 5, focus: 5, pain: 0 });
    setIntention('');
    setEnvironment('');
    setPreparation([]);
    setEffectsExperienced([]);
    setSensations([]);
    setEmotionalChanges([]);
    setPhysicalSensations([]);
    setMentalChanges([]);
    setOverallExperience(5);
    setWouldRecommend(true);
    setFinalNotes('');
  };

  const addNote = () => {
    if (currentNote.trim()) {
      const timestampedNote = `[${Math.floor(sessionDuration)}:${((sessionDuration % 1) * 60).toFixed(0).padStart(2, '0')}] ${currentNote.trim()}`;
      setSessionNotes(prev => [...prev, timestampedNote]);
      onAddNote?.(timestampedNote);
      setCurrentNote('');
    }
  };

  const getSliderColor = (value: number, type: 'positive' | 'negative') => {
    if (type === 'positive') {
      if (value >= 8) return 'text-green-400';
      if (value >= 6) return 'text-blue-400';
      if (value >= 4) return 'text-yellow-400';
      return 'text-red-400';
    } else {
      if (value >= 8) return 'text-red-400';
      if (value >= 6) return 'text-yellow-400';
      if (value >= 4) return 'text-blue-400';
      return 'text-green-400';
    }
  };

  const commonEffects = [
    'Relaxation', 'Energy boost', 'Mental clarity', 'Emotional release', 'Physical tingling',
    'Deeper breathing', 'Improved focus', 'Stress relief', 'Spiritual connection', 'Pain relief',
    'Enhanced creativity', 'Better mood', 'Increased awareness', 'Sense of peace', 'Healing sensation'
  ];

  const preparationOptions = [
    'Meditation', 'Deep breathing', 'Quiet environment', 'Headphones', 'Comfortable position',
    'Set intention', 'Hydrated well', 'Empty stomach', 'Relaxed state', 'No distractions'
  ];

  if (!isDocumenting && !showStartModal && !showEndModal) {
    return (
      <button
        onClick={onToggleDocumentation}
        className="w-full p-3 rounded-lg font-medium transition-colors bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 hover:border-purple-500 group"
      >
        <div className="flex items-center justify-center gap-2">
          <BookOpen className="w-4 h-4 group-hover:text-purple-400 transition-colors" />
          Start Experience Documentation
        </div>
      </button>
    );
  }

  return (
    <>
      {/* Active Documentation Panel */}
      {isDocumenting && !showStartModal && !showEndModal && (
        <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-purple-400 font-bold flex items-center gap-2">
              <Activity className="w-4 h-4 animate-pulse" />
              Session Active
            </h3>
            <button
              onClick={onToggleDocumentation}
              className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-bold"
            >
              End Session
            </button>
          </div>
          
          <div className="text-xs text-purple-200 mb-3 space-y-1">
            <div>📊 <strong>Frequency:</strong> {currentFrequency}Hz</div>
            <div>🔊 <strong>Volume:</strong> {Math.round(currentVolume * 100)}%</div>
            <div>⏱️ <strong>Duration:</strong> {Math.floor(sessionDuration)}:{((sessionDuration % 1) * 60).toFixed(0).padStart(2, '0')}</div>
            <div>📝 <strong>Notes:</strong> {sessionNotes.length}</div>
          </div>
          
          {/* Add note during session */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add observation or note..."
                value={currentNote}
                onChange={(e) => setCurrentNote(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addNote()}
                className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-xs"
              />
              <button
                onClick={addNote}
                disabled={!currentNote.trim()}
                className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white rounded text-xs"
              >
                <Plus size={12} />
              </button>
            </div>
            
            {/* Show recent notes */}
            {sessionNotes.length > 0 && (
              <div className="max-h-20 overflow-y-auto">
                {sessionNotes.slice(-3).map((note, index) => (
                  <div key={index} className="text-[10px] text-purple-300 bg-slate-800/50 p-1 rounded mb-1">
                    {note}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pre-Session Modal */}
      {showStartModal && (
        <div 
          className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center isolate"
          onClick={() => {
            setShowStartModal(false);
            onToggleDocumentation();
          }}
          style={{ 
            zIndex: 9999,
            padding: '16px',
            paddingTop: '80px',
            paddingBottom: '200px' // Extra space for mobile media player
          }}
        >
          <div 
            className="bg-slate-900 border border-purple-500/50 rounded-2xl max-w-lg w-full flex flex-col shadow-2xl shadow-purple-500/20 relative"
            onClick={(e) => e.stopPropagation()}
            style={{ 
              zIndex: 10000, 
              isolation: 'isolate',
              maxHeight: 'calc(100vh - 280px)' // Leave more room for mobile
            }}
          >
            {/* Fixed Header */}
            <div className="p-6 border-b border-slate-700 shrink-0">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-purple-400 flex items-center gap-2">
                    <User className="w-5 h-5" />
                    Pre-Session Assessment
                  </h2>
                  <p className="text-slate-400 text-sm mt-1">How are you feeling right now?</p>
                  <div className="text-xs text-purple-300 mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Scroll down to see all options and continue
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowStartModal(false);
                    onToggleDocumentation();
                  }}
                  className="text-slate-400 hover:text-white hover:bg-slate-700 transition-colors p-2 rounded ml-4 flex-shrink-0"
                  title="Close"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto">
              <div className="p-6 space-y-6">
                {/* Current State Sliders */}
                <div className="space-y-4">
                  <h3 className="font-bold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Current State (1-10)
                  </h3>
                  
                  {[
                    { key: 'mood', label: 'Mood', icon: Heart, type: 'positive' as const },
                    { key: 'energy', label: 'Energy Level', icon: Zap, type: 'positive' as const },
                    { key: 'stress', label: 'Stress Level', icon: AlertCircle, type: 'negative' as const },
                    { key: 'focus', label: 'Mental Focus', icon: Brain, type: 'positive' as const },
                    { key: 'pain', label: 'Physical Pain', icon: Activity, type: 'negative' as const }
                  ].map(({ key, label, icon: Icon, type }) => (
                    <div key={key} className="bg-slate-800/30 p-3 rounded-lg">
                      <div className="flex justify-between text-sm mb-2">
                        <span className="flex items-center gap-2 text-slate-300">
                          <Icon size={14} />
                          {label}
                        </span>
                        <span className={`font-bold ${getSliderColor(priorState[key as keyof typeof priorState], type)}`}>
                          {priorState[key as keyof typeof priorState]}/10
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="10"
                        value={priorState[key as keyof typeof priorState]}
                        onChange={(e) => setPriorState(prev => ({ ...prev, [key]: parseInt(e.target.value) }))}
                        className="w-full accent-purple-500"
                      />
                    </div>
                  ))}
                </div>

                {/* Intention */}
                <div className="bg-slate-800/30 p-4 rounded-lg">
                  <label className="block text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    What's your intention for this session?
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., relaxation, healing, spiritual connection..."
                    value={intention}
                    onChange={(e) => setIntention(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white placeholder-slate-500"
                  />
                </div>

                {/* Environment */}
                <div className="bg-slate-800/30 p-4 rounded-lg">
                  <label className="block text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Environment
                  </label>
                  <select
                    value={environment}
                    onChange={(e) => setEnvironment(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white"
                  >
                    <option value="">Select environment...</option>
                    <option value="quiet room">Quiet room</option>
                    <option value="headphones">Headphones</option>
                    <option value="speakers">Speakers</option>
                    <option value="meditation space">Meditation space</option>
                    <option value="nature">Outdoors/Nature</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                {/* Preparation */}
                <div className="bg-slate-800/30 p-4 rounded-lg">
                  <label className="block text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Preparation (select all that apply)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {preparationOptions.map(prep => (
                      <label key={prep} className="flex items-center gap-2 text-sm p-2 hover:bg-slate-700/50 rounded transition-colors">
                        <input
                          type="checkbox"
                          checked={preparation.includes(prep)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPreparation(prev => [...prev, prep]);
                            } else {
                              setPreparation(prev => prev.filter(p => p !== prep));
                            }
                          }}
                          className="accent-purple-500"
                        />
                        <span className="text-slate-300">{prep}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Bottom spacing */}
                <div className="py-2"></div>
              </div>
            </div>
            
            {/* Fixed Footer - Always Visible */}
            <div 
              className="p-4 border-t border-slate-700 bg-slate-900 shrink-0 flex items-center relative shadow-lg shadow-slate-900/50"
              style={{ 
                zIndex: 10001,
                position: 'sticky',
                bottom: 0
              }}
            >
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => {
                    setShowStartModal(false);
                    onToggleDocumentation();
                  }}
                  className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded font-bold transition-colors"
                  style={{ position: 'relative', zIndex: 10002 }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleStartSession}
                  className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded font-bold shadow-lg shadow-purple-500/20 transition-colors"
                  style={{ position: 'relative', zIndex: 10002 }}
                >
                  Start Documenting
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Post-Session Modal */}
      {showEndModal && (
        <div 
          className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center isolate"
          onClick={() => {
            setShowEndModal(false);
            resetAllState();
          }}
          style={{ 
            zIndex: 9999,
            padding: '16px',
            paddingTop: '80px',
            paddingBottom: '200px' // Extra space for mobile media player
          }}
        >
          <div 
            className="bg-slate-900 border border-purple-500/50 rounded-2xl max-w-2xl w-full flex flex-col shadow-2xl shadow-purple-500/20 relative"
            onClick={(e) => e.stopPropagation()}
            style={{ 
              zIndex: 10000, 
              isolation: 'isolate',
              maxHeight: 'calc(100vh - 280px)' // Leave more room for mobile
            }}
          >
            {/* Fixed Header */}
            <div className="p-6 border-b border-slate-700 shrink-0">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-purple-400 flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    Post-Session Assessment
                  </h2>
                  <p className="text-slate-400 text-sm mt-1">How do you feel after the session?</p>
                  <div className="text-xs text-purple-300 mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Scroll down to see all options and save your experience
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowEndModal(false);
                    resetAllState();
                  }}
                  className="text-slate-400 hover:text-white hover:bg-slate-700 transition-colors p-2 rounded ml-4 flex-shrink-0"
                  title="Close"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto">
              <div className="p-6 space-y-6">
                {/* Post State Sliders */}
                <div className="space-y-4">
                  <h3 className="font-bold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Current State (1-10)
                  </h3>
                  
                  {[
                    { key: 'mood', label: 'Mood', icon: Heart, type: 'positive' as const },
                    { key: 'energy', label: 'Energy Level', icon: Zap, type: 'positive' as const },
                    { key: 'stress', label: 'Stress Level', icon: AlertCircle, type: 'negative' as const },
                    { key: 'focus', label: 'Mental Focus', icon: Brain, type: 'positive' as const },
                    { key: 'pain', label: 'Physical Pain', icon: Activity, type: 'negative' as const }
                  ].map(({ key, label, icon: Icon, type }) => (
                    <div key={key} className="bg-slate-800/30 p-3 rounded-lg">
                      <div className="flex justify-between text-sm mb-2">
                        <span className="flex items-center gap-2 text-slate-300">
                          <Icon size={14} />
                          {label}
                        </span>
                        <div className="flex gap-3">
                          <span className="text-slate-500 text-xs">
                            Before: {priorState[key as keyof typeof priorState]}
                          </span>
                          <span className={`font-bold ${getSliderColor(postState[key as keyof typeof postState], type)}`}>
                            Now: {postState[key as keyof typeof postState]}/10
                          </span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="10"
                        value={postState[key as keyof typeof postState]}
                        onChange={(e) => setPostState(prev => ({ ...prev, [key]: parseInt(e.target.value) }))}
                        className="w-full accent-purple-500"
                      />
                    </div>
                  ))}
                </div>

                {/* Effects Experienced */}
                <div className="bg-slate-800/30 p-4 rounded-lg">
                  <label className="block text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Effects Experienced (select all that apply)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto border border-slate-700 rounded p-2">
                    {commonEffects.map(effect => (
                      <label key={effect} className="flex items-center gap-2 text-sm p-2 hover:bg-slate-700/50 rounded transition-colors">
                        <input
                          type="checkbox"
                          checked={effectsExperienced.includes(effect)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEffectsExperienced(prev => [...prev, effect]);
                            } else {
                              setEffectsExperienced(prev => prev.filter(p => p !== effect));
                            }
                          }}
                          className="accent-purple-500"
                        />
                        <span className="text-slate-300">{effect}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Overall Experience */}
                <div className="bg-slate-800/30 p-4 rounded-lg">
                  <div className="flex justify-between text-sm mb-3">
                    <span className="font-bold text-white flex items-center gap-2">
                      <Star className="w-4 h-4" />
                      Overall Experience
                    </span>
                    <span className="flex items-center gap-1">
                      {[...Array(overallExperience)].map((_, i) => (
                        <Star key={i} size={12} className="text-yellow-400 fill-current" />
                      ))}
                      <span className="text-slate-400 ml-1">{overallExperience}/10</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={overallExperience}
                    onChange={(e) => setOverallExperience(parseInt(e.target.value))}
                    className="w-full accent-yellow-500"
                  />
                </div>

                {/* Would Recommend */}
                <div className="bg-slate-800/30 p-4 rounded-lg">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={wouldRecommend}
                      onChange={(e) => setWouldRecommend(e.target.checked)}
                      className="accent-green-500"
                    />
                    <span className="text-white flex items-center gap-2">
                      <CheckCircle className="w-4 h-4" />
                      I would recommend this frequency to others
                    </span>
                  </label>
                </div>

                {/* Final Notes */}
                <div className="bg-slate-800/30 p-4 rounded-lg">
                  <label className="block text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <MessageCircle className="w-4 h-4" />
                    Additional Notes
                  </label>
                  <textarea
                    placeholder="Describe any other observations, insights, or experiences..."
                    value={finalNotes}
                    onChange={(e) => setFinalNotes(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white placeholder-slate-500 h-24 resize-none"
                  />
                </div>

                {/* Session Notes Summary */}
                {sessionNotes.length > 0 && (
                  <div className="bg-slate-800/30 p-4 rounded-lg">
                    <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Session Notes
                    </h4>
                    <div className="bg-slate-800 p-3 rounded max-h-32 overflow-y-auto border border-slate-700 text-xs text-slate-300">
                      {sessionNotes.map((note, index) => (
                        <div key={index} className="mb-1 py-1">{note}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bottom spacing */}
                <div className="py-2"></div>
              </div>
            </div>
            
            {/* Fixed Footer - Always Visible */}
            <div 
              className="p-4 border-t border-slate-700 bg-slate-900 shrink-0 flex items-center relative shadow-lg shadow-slate-900/50"
              style={{ 
                zIndex: 10001,
                position: 'sticky',
                bottom: 0
              }}
            >
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => {
                    setShowEndModal(false);
                    resetAllState();
                  }}
                  className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded font-bold transition-colors"
                  style={{ position: 'relative', zIndex: 10002 }}
                >
                  Discard
                </button>
                <button
                  onClick={handleEndSession}
                  className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded font-bold flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20 transition-colors"
                  style={{ position: 'relative', zIndex: 10002 }}
                >
                  <Save size={16} />
                  Save Experience
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ExperienceTracker;