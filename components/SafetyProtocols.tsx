import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  AlertTriangle,
  Clock,
  Volume2,
  VolumeX,
  Heart,
  Brain,
  Eye,
  Activity,
  Pause,
  Play,
  Timer,
  Thermometer,
  Zap,
  Bell,
  Settings,
  Save,
  RotateCcw,
  Info,
  CheckCircle,
  XCircle,
  AlertCircle
} from 'lucide-react';

import { 
  SAFETY_PROTOCOLS, 
  assessFrequencySafety, 
  generateSafetyWarning 
} from '../utils/fractalFrequencyAnalysis';

interface SafetyProtocolsProps {
  currentFrequency: number;
  currentVolume: number;
  sessionDuration: number; // in minutes
  isPlaying: boolean;
  onVolumeChange: (volume: number) => void;
  onPause: () => void;
  onResume: () => void;
  userExperienceLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
}

interface SafetyAlert {
  id: string;
  type: 'warning' | 'error' | 'info';
  title: string;
  message: string;
  timestamp: string;
  acknowledged?: boolean;
  frequency?: number;
}

interface SessionLimits {
  maxDuration: number; // in minutes
  maxVolume: number; // 0-1
  recommendedBreaks: number; // break duration in minutes
  breakInterval: number; // how often to take breaks, in minutes
}

interface BiometricData {
  heartRate?: number;
  stressLevel: number; // 1-10 subjective scale
  comfortLevel: number; // 1-10 scale
  alertness: number; // 1-10 scale
  timestamp: string;
}

const SafetyProtocols: React.FC<SafetyProtocolsProps> = ({
  currentFrequency,
  currentVolume,
  sessionDuration,
  isPlaying,
  onVolumeChange,
  onPause,
  onResume,
  userExperienceLevel
}) => {
  const [alerts, setAlerts] = useState<SafetyAlert[]>([]);
  const [sessionLimits, setSessionLimits] = useState<SessionLimits | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [showBreakReminder, setShowBreakReminder] = useState(false);
  const [biometricData, setBiometricData] = useState<BiometricData[]>([]);
  const [subtleResonanceMode, setSubtleResonanceMode] = useState(false);
  const [emergencyStop, setEmergencyStop] = useState(false);
  const [currentBiometrics, setCurrentBiometrics] = useState<BiometricData>({
    stressLevel: 1,
    comfortLevel: 10,
    alertness: 5,
    timestamp: new Date().toISOString()
  });
  
  // Safety monitoring intervals
  const alertCheckInterval = useRef<number | null>(null);
  const biometricCheckInterval = useRef<number | null>(null);
  const sessionStartTime = useRef<Date>(new Date());

  // Initialize safety protocols when frequency changes
  useEffect(() => {
    const safetyAssessment = assessFrequencySafety(currentFrequency);
    updateSessionLimits();
    checkFrequencySafety();
    
    // Reset session start time when frequency changes significantly
    sessionStartTime.current = new Date();
    
    // Enable subtle resonance mode for high frequencies
    if (currentFrequency >= SAFETY_PROTOCOLS.CAUTION_RANGE.min) {
      setSubtleResonanceMode(true);
      addAlert({
        type: 'warning',
        title: 'Subtle Resonance Mode Enabled',
        message: 'High frequency detected. Focus on feeling rather than hearing. Keep volume low.',
        frequency: currentFrequency
      });
    } else {
      setSubtleResonanceMode(false);
    }

    // Auto-adjust volume for safety
    if (safetyAssessment.volume < currentVolume) {
      onVolumeChange(safetyAssessment.volume);
      addAlert({
        type: 'info',
        title: 'Volume Auto-Adjusted',
        message: `Volume automatically reduced to ${Math.round(safetyAssessment.volume * 100)}% for safety.`
      });
    }
  }, [currentFrequency]);

  // Safety monitoring loop
  useEffect(() => {
    if (isPlaying) {
      startSafetyMonitoring();
    } else {
      stopSafetyMonitoring();
    }

    return () => {
      stopSafetyMonitoring();
    };
  }, [isPlaying, currentFrequency, currentVolume]);

  const updateSessionLimits = () => {
    const safetyLevel = assessFrequencySafety(currentFrequency).level;
    
    let limits: SessionLimits;
    
    switch (userExperienceLevel) {
      case 'beginner':
        limits = {
          maxDuration: safetyLevel === 'SAFE' ? 30 : 15,
          maxVolume: safetyLevel === 'SAFE' ? 0.6 : 0.3,
          recommendedBreaks: 10,
          breakInterval: 20
        };
        break;
      case 'intermediate':
        limits = {
          maxDuration: safetyLevel === 'SAFE' ? 45 : safetyLevel === 'CAUTION' ? 25 : 15,
          maxVolume: safetyLevel === 'SAFE' ? 0.8 : safetyLevel === 'CAUTION' ? 0.4 : 0.2,
          recommendedBreaks: 10,
          breakInterval: 30
        };
        break;
      case 'advanced':
        limits = {
          maxDuration: safetyLevel === 'SAFE' ? 60 : safetyLevel === 'CAUTION' ? 40 : 20,
          maxVolume: safetyLevel === 'SAFE' ? 1.0 : safetyLevel === 'CAUTION' ? 0.5 : 0.25,
          recommendedBreaks: 15,
          breakInterval: 45
        };
        break;
      case 'expert':
        limits = {
          maxDuration: safetyLevel === 'RESEARCH' ? 10 : safetyLevel === 'EXPERT' ? 30 : 90,
          maxVolume: safetyLevel === 'RESEARCH' ? 0.1 : safetyLevel === 'EXPERT' ? 0.3 : 1.0,
          recommendedBreaks: 20,
          breakInterval: 60
        };
        break;
      default:
        limits = {
          maxDuration: 20,
          maxVolume: 0.5,
          recommendedBreaks: 10,
          breakInterval: 20
        };
    }

    // Apply high-frequency restrictions
    if (currentFrequency >= SAFETY_PROTOCOLS.EXPERT_RANGE.min) {
      limits.maxDuration = Math.min(limits.maxDuration, 15);
      limits.maxVolume = Math.min(limits.maxVolume, 0.15);
    } else if (currentFrequency >= SAFETY_PROTOCOLS.CAUTION_RANGE.min) {
      limits.maxDuration = Math.min(limits.maxDuration, 30);
      limits.maxVolume = Math.min(limits.maxVolume, 0.3);
    }

    setSessionLimits(limits);
    setTimeRemaining(limits.maxDuration);
  };

  const startSafetyMonitoring = () => {
    // Check alerts every 30 seconds
    alertCheckInterval.current = window.setInterval(() => {
      checkFrequencySafety();
      updateSessionTimer();
      checkForBreakReminder();
    }, 30000);

    // Prompt for biometric check every 5 minutes
    biometricCheckInterval.current = window.setInterval(() => {
      promptBiometricCheck();
    }, 300000);
  };

  const stopSafetyMonitoring = () => {
    if (alertCheckInterval.current) {
      clearInterval(alertCheckInterval.current);
      alertCheckInterval.current = null;
    }
    if (biometricCheckInterval.current) {
      clearInterval(biometricCheckInterval.current);
      biometricCheckInterval.current = null;
    }
  };

  const checkFrequencySafety = () => {
    const warning = generateSafetyWarning(currentFrequency);
    
    // Check volume safety
    if (sessionLimits && currentVolume > sessionLimits.maxVolume) {
      addAlert({
        type: 'error',
        title: 'Volume Too High',
        message: `Current volume (${Math.round(currentVolume * 100)}%) exceeds safe limit of ${Math.round(sessionLimits.maxVolume * 100)}% for this frequency.`
      });
    }

    // Check if frequency is in danger zone for user level
    const safetyLevel = assessFrequencySafety(currentFrequency).level;
    if (userExperienceLevel === 'beginner' && ['EXPERT', 'RESEARCH'].includes(safetyLevel)) {
      addAlert({
        type: 'error',
        title: 'Frequency Not Recommended',
        message: 'This frequency requires more experience. Consider starting with lower frequencies.'
      });
    }

    // Check for prolonged high-frequency exposure
    if (currentFrequency >= 2000 && sessionDuration > 10) {
      addAlert({
        type: 'warning',
        title: 'Extended High-Frequency Exposure',
        message: 'Consider taking a break from high frequencies to prevent overstimulation.'
      });
    }
  };

  const updateSessionTimer = () => {
    if (!sessionLimits) return;
    
    const elapsed = sessionDuration;
    const remaining = Math.max(0, sessionLimits.maxDuration - elapsed);
    
    setTimeRemaining(remaining);
    
    if (remaining <= 2 && remaining > 0) {
      addAlert({
        type: 'warning',
        title: 'Session Ending Soon',
        message: `Only ${remaining.toFixed(1)} minutes remaining in safe exposure time.`
      });
    } else if (remaining <= 0) {
      addAlert({
        type: 'error',
        title: 'Maximum Exposure Reached',
        message: 'Please take a break for your safety.'
      });
      
      if (userExperienceLevel !== 'expert') {
        triggerEmergencyStop();
      }
    }
  };

  const checkForBreakReminder = () => {
    if (!sessionLimits) return;
    
    if (sessionDuration > 0 && sessionDuration % sessionLimits.breakInterval === 0) {
      setShowBreakReminder(true);
    }
  };

  const promptBiometricCheck = () => {
    // In a real implementation, this could integrate with actual biometric devices
    // For now, prompt user for subjective assessment
    addAlert({
      type: 'info',
      title: 'Wellness Check',
      message: 'Please take a moment to assess how you\'re feeling and update your comfort levels.'
    });
  };

  const triggerEmergencyStop = () => {
    setEmergencyStop(true);
    onPause();
    addAlert({
      type: 'error',
      title: 'Emergency Stop Activated',
      message: 'Session paused for safety. Please take a break before continuing.'
    });
  };

  const addAlert = (alertData: Omit<SafetyAlert, 'id' | 'timestamp'>) => {
    const newAlert: SafetyAlert = {
      ...alertData,
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString()
    };
    
    setAlerts(prev => [newAlert, ...prev].slice(0, 10)); // Keep last 10 alerts
  };

  const acknowledgeAlert = (alertId: string) => {
    setAlerts(prev => prev.map(alert => 
      alert.id === alertId ? { ...alert, acknowledged: true } : alert
    ));
  };

  const clearAllAlerts = () => {
    setAlerts([]);
  };

  const updateBiometrics = (data: Partial<BiometricData>) => {
    const newData: BiometricData = {
      ...currentBiometrics,
      ...data,
      timestamp: new Date().toISOString()
    };
    
    setCurrentBiometrics(newData);
    setBiometricData(prev => [...prev, newData].slice(-20)); // Keep last 20 readings
    
    // Check for concerning trends
    if (newData.stressLevel >= 8) {
      addAlert({
        type: 'warning',
        title: 'High Stress Detected',
        message: 'Consider reducing volume or taking a break.'
      });
    }
    
    if (newData.comfortLevel <= 3) {
      addAlert({
        type: 'error',
        title: 'Low Comfort Level',
        message: 'Please stop the session if you feel uncomfortable.'
      });
    }
  };

  const getAlertIcon = (type: SafetyAlert['type']) => {
    switch (type) {
      case 'error': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'info': return <Info className="w-5 h-5 text-blue-500" />;
      default: return <AlertCircle className="w-5 h-5 text-gray-500" />;
    }
  };

  const getSafetyLevelColor = () => {
    const level = assessFrequencySafety(currentFrequency).level;
    switch (level) {
      case 'SAFE': return 'text-green-500';
      case 'CAUTION': return 'text-yellow-500';
      case 'EXPERT': return 'text-orange-500';
      case 'RESEARCH': return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 space-y-6">
      
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Shield className="w-6 h-6 text-green-500" />
          Safety Protocols
        </h2>
        
        <div className={`px-3 py-1 rounded-full text-sm font-bold ${getSafetyLevelColor()} bg-black/30`}>
          {assessFrequencySafety(currentFrequency).level}
        </div>
      </div>

      {/* Emergency Stop */}
      {emergencyStop && (
        <div className="bg-red-900/50 border border-red-500 rounded-lg p-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <XCircle className="w-6 h-6 text-red-500" />
              <div>
                <h3 className="text-red-400 font-bold">Emergency Stop Active</h3>
                <p className="text-red-300 text-sm">Session paused for safety reasons</p>
              </div>
            </div>
            <button
              onClick={() => setEmergencyStop(false)}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded text-white font-bold"
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Session Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-800 p-4 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-medium text-blue-400">Time Remaining</span>
          </div>
          <div className="text-2xl font-bold text-white">
            {Math.floor(timeRemaining)}:{((timeRemaining % 1) * 60).toFixed(0).padStart(2, '0')}
          </div>
          <div className="text-xs text-slate-400">
            / {sessionLimits?.maxDuration}min max
          </div>
        </div>

        <div className="bg-slate-800 p-4 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Volume2 className="w-4 h-4 text-green-400" />
            <span className="text-sm font-medium text-green-400">Safe Volume</span>
          </div>
          <div className="text-2xl font-bold text-white">
            {Math.round(currentVolume * 100)}%
          </div>
          <div className="text-xs text-slate-400">
            / {Math.round((sessionLimits?.maxVolume || 1) * 100)}% max
          </div>
        </div>

        <div className="bg-slate-800 p-4 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Heart className="w-4 h-4 text-red-400" />
            <span className="text-sm font-medium text-red-400">Comfort</span>
          </div>
          <div className="text-2xl font-bold text-white">
            {currentBiometrics.comfortLevel}/10
          </div>
          <div className="text-xs text-slate-400">
            Current level
          </div>
        </div>
      </div>

      {/* Subtle Resonance Mode */}
      {subtleResonanceMode && (
        <div className="bg-purple-900/30 border border-purple-500/50 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-3">
            <Zap className="w-5 h-5 text-purple-400" />
            <h3 className="text-purple-400 font-bold">Subtle Resonance Mode</h3>
          </div>
          <div className="text-sm text-purple-200 space-y-2">
            <p>• Focus on FEELING the frequency rather than hearing it loudly</p>
            <p>• Keep volume at the lowest perceptible level</p>
            <p>• Pay attention to subtle sensations and energy shifts</p>
            <p>• Take frequent breaks to process the effects</p>
          </div>
        </div>
      )}

      {/* Biometric Monitoring */}
      <div className="bg-slate-800 rounded-lg p-4">
        <h3 className="text-white font-bold mb-3 flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-400" />
          Wellness Monitor
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm text-slate-400 block mb-1">Stress Level</label>
            <input
              type="range"
              min="1"
              max="10"
              value={currentBiometrics.stressLevel}
              onChange={(e) => updateBiometrics({ stressLevel: parseInt(e.target.value) })}
              className="w-full accent-red-500"
            />
            <div className="text-xs text-slate-500 flex justify-between">
              <span>Calm</span>
              <span>{currentBiometrics.stressLevel}</span>
              <span>Stressed</span>
            </div>
          </div>
          
          <div>
            <label className="text-sm text-slate-400 block mb-1">Comfort Level</label>
            <input
              type="range"
              min="1"
              max="10"
              value={currentBiometrics.comfortLevel}
              onChange={(e) => updateBiometrics({ comfortLevel: parseInt(e.target.value) })}
              className="w-full accent-green-500"
            />
            <div className="text-xs text-slate-500 flex justify-between">
              <span>Poor</span>
              <span>{currentBiometrics.comfortLevel}</span>
              <span>Great</span>
            </div>
          </div>
          
          <div>
            <label className="text-sm text-slate-400 block mb-1">Alertness</label>
            <input
              type="range"
              min="1"
              max="10"
              value={currentBiometrics.alertness}
              onChange={(e) => updateBiometrics({ alertness: parseInt(e.target.value) })}
              className="w-full accent-blue-500"
            />
            <div className="text-xs text-slate-500 flex justify-between">
              <span>Drowsy</span>
              <span>{currentBiometrics.alertness}</span>
              <span>Alert</span>
            </div>
          </div>
        </div>
      </div>

      {/* Active Alerts */}
      {alerts.filter(a => !a.acknowledged).length > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <h3 className="text-white font-bold">Active Alerts</h3>
            <button
              onClick={clearAllAlerts}
              className="text-xs text-slate-400 hover:text-white"
            >
              Clear All
            </button>
          </div>
          
          {alerts.filter(a => !a.acknowledged).map(alert => (
            <div key={alert.id} className={`p-3 rounded-lg border ${
              alert.type === 'error' ? 'bg-red-900/30 border-red-500/50' :
              alert.type === 'warning' ? 'bg-yellow-900/30 border-yellow-500/50' :
              'bg-blue-900/30 border-blue-500/50'
            }`}>
              <div className="flex justify-between items-start">
                <div className="flex items-start gap-3">
                  {getAlertIcon(alert.type)}
                  <div>
                    <h4 className="font-bold text-white text-sm">{alert.title}</h4>
                    <p className="text-sm text-slate-300">{alert.message}</p>
                    {alert.frequency && (
                      <p className="text-xs text-slate-400 mt-1">
                        Frequency: {alert.frequency}Hz
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => acknowledgeAlert(alert.id)}
                  className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-white"
                >
                  OK
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Break Reminder Modal */}
      {showBreakReminder && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-blue-500 rounded-xl p-6 max-w-md w-full max-h-[calc(100vh-120px)] overflow-y-auto my-auto">
            <div className="text-center">
              <Bell className="w-12 h-12 text-blue-500 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Break Time</h3>
              <p className="text-slate-400 mb-4">
                Take a {sessionLimits?.recommendedBreaks}-minute break to rest and process the effects.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowBreakReminder(false)}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white"
                >
                  Continue Session
                </button>
                <button
                  onClick={() => {
                    onPause();
                    setShowBreakReminder(false);
                  }}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white font-bold"
                >
                  Take Break
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Emergency Controls */}
      <div className="flex gap-3">
        <button
          onClick={triggerEmergencyStop}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded text-white font-bold flex items-center gap-2"
        >
          <Pause className="w-4 h-4" />
          Emergency Stop
        </button>
        
        <button
          onClick={() => onVolumeChange(0)}
          className="px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded text-white font-bold flex items-center gap-2"
        >
          <VolumeX className="w-4 h-4" />
          Mute
        </button>
        
        <button
          onClick={() => updateBiometrics({ 
            stressLevel: 1, 
            comfortLevel: 10, 
            alertness: 5 
          })}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white flex items-center gap-2"
        >
          <RotateCcw className="w-4 h-4" />
          Reset Monitoring
        </button>
      </div>
    </div>
  );
};

export default SafetyProtocols;