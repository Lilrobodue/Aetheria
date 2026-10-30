/**
 * Effects Documentation System
 * 
 * Comprehensive system for documenting, tracking, and analyzing frequency effects
 * Includes user experience tracking, scientific protocol documentation, and effect validation
 */

export interface FrequencyEffect {
  id: string;
  frequency: number;
  harmonics?: number[];
  
  // Basic Information
  name: string;
  category: 'physical' | 'emotional' | 'mental' | 'spiritual' | 'energetic' | 'cellular' | 'unknown';
  discoveryDate: string;
  discoveredBy?: string;
  
  // Effect Details
  description: string;
  onsetTime: string; // e.g., "2-5 minutes", "immediate", "15-30 minutes"
  duration: string; // e.g., "lasting", "temporary", "hours", "days"
  intensity: 'subtle' | 'moderate' | 'strong' | 'profound';
  
  // Conditions
  optimalVolume?: number; // 0-1 scale
  recommendedDuration: string;
  bestTimeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night' | 'anytime';
  requiredPreparation?: string[];
  contraindications?: string[];
  
  // User Reports
  userReports: UserReport[];
  scientificStudies?: StudyReference[];
  
  // Safety Information
  safetyLevel: 'SAFE' | 'CAUTION' | 'EXPERT' | 'RESEARCH';
  sideEffects?: string[];
  warnings?: string[];
  maximumExposure?: string;
  
  // Validation
  validationStatus: 'unverified' | 'reported' | 'multiple_reports' | 'studied' | 'validated';
  confidenceScore: number; // 0-10
  
  // Technical Data
  waveform?: 'sine' | 'square' | 'triangle' | 'sawtooth' | 'complex';
  modulation?: {
    type: 'amplitude' | 'frequency' | 'phase';
    rate: number;
    depth: number;
  };
  binaural?: {
    carrierFreq: number;
    beatFreq: number;
  };
  
  // Metadata
  tags: string[];
  relatedFrequencies: number[];
  createdAt: string;
  lastUpdated: string;
}

export interface UserReport {
  id: string;
  userId: string;
  timestamp: string;
  
  // Session Details
  frequency: number;
  volume: number;
  duration: number; // in minutes
  waveform: string;
  environment?: string; // e.g., "quiet room", "headphones", "speakers"
  
  // User State
  priorState: {
    mood: number; // 1-10 scale
    energy: number; // 1-10 scale
    stress: number; // 1-10 scale
    focus: number; // 1-10 scale
    pain?: number; // 1-10 scale
    other?: { [key: string]: number };
  };
  
  postState: {
    mood: number;
    energy: number;
    stress: number;
    focus: number;
    pain?: number;
    other?: { [key: string]: number };
  };
  
  // Experience Report
  effectsExperienced: string[];
  sensations: string[];
  emotionalChanges: string[];
  physicalSensations: string[];
  mentalChanges: string[];
  
  // Qualitative Data
  overallExperience: number; // 1-10 scale
  wouldRecommend: boolean;
  notes?: string;
  
  // Validation
  verified: boolean;
  credibility: number; // 1-10 scale (based on user history, detail quality, etc.)
}

export interface StudyReference {
  title: string;
  authors: string[];
  journal?: string;
  year: number;
  doi?: string;
  link?: string;
  summary: string;
  methodology: string;
  sampleSize?: number;
  findings: string[];
  limitations?: string[];
}

export interface EffectsDatabase {
  effects: FrequencyEffect[];
  lastUpdated: string;
  version: string;
  contributors: string[];
}

// Pre-populated known effects database
export const KNOWN_EFFECTS: FrequencyEffect[] = [
  {
    id: "solfeggio_528_dna",
    frequency: 528,
    harmonics: [1056, 2112, 4224],
    name: "DNA Repair Resonance",
    category: "cellular",
    discoveryDate: "1999",
    discoveredBy: "Dr. Leonard Horowitz",
    description: "Frequency reported to repair DNA damage and promote cellular healing through resonance with the hexagonal structure of water molecules in DNA.",
    onsetTime: "15-30 minutes",
    duration: "hours to days",
    intensity: "profound",
    optimalVolume: 0.3,
    recommendedDuration: "20-40 minutes",
    bestTimeOfDay: "morning",
    userReports: [],
    safetyLevel: "SAFE",
    validationStatus: "multiple_reports",
    confidenceScore: 8,
    waveform: "sine",
    tags: ["healing", "dna", "cellular", "transformation"],
    relatedFrequencies: [396, 639, 741],
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  },
  {
    id: "pattern_111_cellular",
    frequency: 111,
    harmonics: [222, 333, 444, 555],
    name: "Cellular Communication Enhancement",
    category: "cellular",
    discoveryDate: "2010",
    description: "111 Hz pattern reported to enhance intercellular communication and synchronize cellular oscillations.",
    onsetTime: "5-10 minutes",
    duration: "temporary",
    intensity: "subtle",
    optimalVolume: 0.2,
    recommendedDuration: "15-25 minutes",
    userReports: [],
    safetyLevel: "SAFE",
    validationStatus: "reported",
    confidenceScore: 6,
    waveform: "sine",
    tags: ["cellular", "communication", "synchronization"],
    relatedFrequencies: [222, 333, 528],
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  },
  {
    id: "high_freq_1074_pineal",
    frequency: 1074,
    harmonics: [2148, 3222, 4296],
    name: "Pineal Gland Activation (Fourth Order)",
    category: "spiritual",
    discoveryDate: "2020",
    discoveredBy: "Higher Order Solfeggio Research",
    description: "Fourth order solfeggio frequency (963 + 111) reported to activate pineal gland and open channels to higher consciousness. Mathematical progression from crown chakra frequency.",
    onsetTime: "2-5 minutes",
    duration: "hours",
    intensity: "strong",
    optimalVolume: 0.05,
    recommendedDuration: "5-15 minutes maximum",
    bestTimeOfDay: "evening",
    requiredPreparation: ["Advanced meditation experience", "Quiet environment", "Grounded state"],
    contraindications: ["Headache", "High blood pressure", "Pregnancy", "Epilepsy"],
    userReports: [],
    safetyLevel: "EXPERT",
    sideEffects: ["Mild headache if too loud", "Temporary disorientation", "Vivid dreams"],
    warnings: ["Keep volume very low", "Limit exposure time", "Stop if uncomfortable"],
    maximumExposure: "15 minutes per day",
    validationStatus: "reported",
    confidenceScore: 5,
    waveform: "sine",
    tags: ["pineal", "fourth-order", "consciousness", "transcendental"],
    relatedFrequencies: [963, 1317, 1641],
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  },
  {
    id: "fifth_order_1995_quantum",
    frequency: 1995,
    harmonics: [3990, 7980, 15960],
    name: "Quantum Consciousness Expansion",
    category: "spiritual",
    discoveryDate: "2023",
    discoveredBy: "Quantum Frequency Researchers",
    description: "Fifth order solfeggio frequency (1752 + 243) that expands consciousness into quantum field awareness. Facilitates understanding of non-local consciousness phenomena and quantum entanglement effects.",
    onsetTime: "5-10 minutes",
    duration: "hours to days",
    intensity: "profound",
    optimalVolume: 0.03,
    recommendedDuration: "5-10 minutes maximum",
    bestTimeOfDay: "morning",
    requiredPreparation: ["Expert meditation practice", "Understanding of quantum concepts", "Stable mental state"],
    contraindications: ["Mental health conditions", "Pregnancy", "Heart conditions", "Seizure disorders"],
    userReports: [],
    safetyLevel: "RESEARCH",
    sideEffects: ["Altered perception", "Time distortion", "Synesthesia"],
    warnings: ["Research level frequency", "Extreme caution required", "Professional guidance recommended"],
    maximumExposure: "10 minutes per week",
    validationStatus: "unverified",
    confidenceScore: 2,
    waveform: "sine",
    tags: ["quantum", "fifth-order", "research", "consciousness", "non-local"],
    relatedFrequencies: [1752, 2319, 1317],
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  },
  {
    id: "sixth_order_2997_unity",
    frequency: 2997,
    harmonics: [5994, 11988, 23976],
    name: "Unity Consciousness Embodiment",
    category: "spiritual",
    discoveryDate: "2024",
    discoveredBy: "Transcendental Frequency Laboratory",
    description: "Sixth order solfeggio frequency (2673 + 324) representing the mathematical pinnacle of unity consciousness embodiment. Theoretical frequency for complete transcendence of individual awareness into infinite unity.",
    onsetTime: "immediate",
    duration: "permanent shifts reported",
    intensity: "profound",
    optimalVolume: 0.01,
    recommendedDuration: "2-5 minutes maximum",
    bestTimeOfDay: "morning",
    requiredPreparation: ["Years of advanced practice", "Spiritual teacher guidance", "Complete mental stability"],
    contraindications: ["Any medical conditions", "Pregnancy", "Under 25 years old", "Unstable life circumstances"],
    userReports: [],
    safetyLevel: "RESEARCH",
    sideEffects: ["Ego dissolution", "Reality distortion", "Permanent consciousness shifts"],
    warnings: ["EXTREME CAUTION", "Professional supervision required", "May cause permanent changes"],
    maximumExposure: "5 minutes per month",
    validationStatus: "unverified",
    confidenceScore: 1,
    waveform: "sine",
    tags: ["unity", "sixth-order", "transcendence", "infinity", "research-only"],
    relatedFrequencies: [2673, 2430, 2319],
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  }
];

/**
 * Effects Documentation Manager
 */
export class EffectsDocumentationManager {
  private effects: FrequencyEffect[] = [];
  
  constructor(initialEffects: FrequencyEffect[] = KNOWN_EFFECTS) {
    this.effects = [...initialEffects];
    this.loadFromStorage();
  }
  
  /**
   * Add a new frequency effect
   */
  addEffect(effect: Omit<FrequencyEffect, 'id' | 'createdAt' | 'lastUpdated'>): string {
    const newEffect: FrequencyEffect = {
      ...effect,
      id: this.generateId(),
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
    
    this.effects.push(newEffect);
    this.saveToStorage();
    return newEffect.id;
  }
  
  /**
   * Update an existing effect
   */
  updateEffect(id: string, updates: Partial<FrequencyEffect>): boolean {
    const index = this.effects.findIndex(e => e.id === id);
    if (index === -1) return false;
    
    this.effects[index] = {
      ...this.effects[index],
      ...updates,
      lastUpdated: new Date().toISOString()
    };
    
    this.saveToStorage();
    return true;
  }
  
  /**
   * Add a user report to an effect
   */
  addUserReport(effectId: string, report: Omit<UserReport, 'id' | 'timestamp'>): boolean {
    const effect = this.effects.find(e => e.id === effectId);
    if (!effect) return false;
    
    const newReport: UserReport = {
      ...report,
      id: this.generateId(),
      timestamp: new Date().toISOString()
    };
    
    effect.userReports.push(newReport);
    effect.lastUpdated = new Date().toISOString();
    
    // Update validation status based on number of reports
    this.updateValidationStatus(effect);
    
    this.saveToStorage();
    return true;
  }
  
  /**
   * Find effects by frequency
   */
  findEffectsByFrequency(frequency: number, tolerance: number = 5): FrequencyEffect[] {
    return this.effects.filter(effect => 
      Math.abs(effect.frequency - frequency) <= tolerance
    );
  }
  
  /**
   * Find effects by category
   */
  findEffectsByCategory(category: FrequencyEffect['category']): FrequencyEffect[] {
    return this.effects.filter(effect => effect.category === category);
  }
  
  /**
   * Search effects by tags or description
   */
  searchEffects(query: string): FrequencyEffect[] {
    const lowerQuery = query.toLowerCase();
    return this.effects.filter(effect => 
      effect.name.toLowerCase().includes(lowerQuery) ||
      effect.description.toLowerCase().includes(lowerQuery) ||
      effect.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }
  
  /**
   * Get effects by safety level
   */
  getEffectsBySafety(safetyLevel: FrequencyEffect['safetyLevel']): FrequencyEffect[] {
    return this.effects.filter(effect => effect.safetyLevel === safetyLevel);
  }
  
  /**
   * Get highly validated effects
   */
  getValidatedEffects(minConfidenceScore: number = 7): FrequencyEffect[] {
    return this.effects.filter(effect => 
      effect.confidenceScore >= minConfidenceScore &&
      ['studied', 'validated'].includes(effect.validationStatus)
    );
  }
  
  /**
   * Generate documentation report
   */
  generateReport(frequency: number): EffectReport {
    const effects = this.findEffectsByFrequency(frequency);
    const totalReports = effects.reduce((sum, effect) => sum + effect.userReports.length, 0);
    const averageConfidence = effects.length > 0 
      ? effects.reduce((sum, effect) => sum + effect.confidenceScore, 0) / effects.length 
      : 0;
    
    return {
      frequency,
      effectsFound: effects.length,
      totalUserReports: totalReports,
      averageConfidenceScore: averageConfidence,
      effects: effects.map(effect => ({
        name: effect.name,
        category: effect.category,
        description: effect.description,
        intensity: effect.intensity,
        safetyLevel: effect.safetyLevel,
        userReports: effect.userReports.length,
        confidenceScore: effect.confidenceScore,
        tags: effect.tags
      })),
      recommendations: this.generateRecommendations(effects),
      warnings: this.generateWarnings(effects)
    };
  }
  
  /**
   * Export database for backup
   */
  exportDatabase(): EffectsDatabase {
    return {
      effects: this.effects,
      lastUpdated: new Date().toISOString(),
      version: "1.0.0",
      contributors: this.getContributors()
    };
  }
  
  /**
   * Import database from backup
   */
  importDatabase(database: EffectsDatabase): void {
    this.effects = database.effects;
    this.saveToStorage();
  }
  
  private generateId(): string {
    return `effect_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private updateValidationStatus(effect: FrequencyEffect): void {
    const reportCount = effect.userReports.length;
    
    if (reportCount === 0) {
      effect.validationStatus = 'unverified';
    } else if (reportCount === 1) {
      effect.validationStatus = 'reported';
    } else if (reportCount < 10) {
      effect.validationStatus = 'multiple_reports';
    } else {
      effect.validationStatus = 'studied';
    }
    
    // Update confidence score based on reports
    if (reportCount > 0) {
      const averageCredibility = effect.userReports.reduce((sum, report) => 
        sum + (report.credibility || 5), 0
      ) / reportCount;
      
      effect.confidenceScore = Math.min(10, Math.max(1, 
        (effect.confidenceScore + averageCredibility) / 2
      ));
    }
  }
  
  private generateRecommendations(effects: FrequencyEffect[]): string[] {
    const recommendations: string[] = [];
    
    if (effects.length === 0) {
      recommendations.push("No documented effects for this frequency. Consider documenting your experience.");
      return recommendations;
    }
    
    const safeEffects = effects.filter(e => e.safetyLevel === 'SAFE');
    const highConfidence = effects.filter(e => e.confidenceScore >= 7);
    
    if (safeEffects.length > 0) {
      recommendations.push("Safe frequency with documented effects. Good for beginners.");
    }
    
    if (highConfidence.length > 0) {
      const topEffect = highConfidence.sort((a, b) => b.confidenceScore - a.confidenceScore)[0];
      recommendations.push(`Most validated effect: ${topEffect.name} (confidence: ${topEffect.confidenceScore}/10)`);
    }
    
    const commonVolume = this.getCommonVolume(effects);
    if (commonVolume) {
      recommendations.push(`Recommended volume: ${Math.round(commonVolume * 100)}%`);
    }
    
    const commonDuration = this.getCommonDuration(effects);
    if (commonDuration) {
      recommendations.push(`Typical duration: ${commonDuration}`);
    }
    
    return recommendations;
  }
  
  private generateWarnings(effects: FrequencyEffect[]): string[] {
    const warnings: string[] = [];
    
    const expertLevel = effects.filter(e => ['EXPERT', 'RESEARCH'].includes(e.safetyLevel));
    if (expertLevel.length > 0) {
      warnings.push("Expert-level frequency. Requires experience and caution.");
    }
    
    const sideEffects = effects.flatMap(e => e.sideEffects || []);
    if (sideEffects.length > 0) {
      warnings.push(`Potential side effects: ${[...new Set(sideEffects)].join(', ')}`);
    }
    
    const maxExposure = effects.find(e => e.maximumExposure);
    if (maxExposure) {
      warnings.push(`Maximum exposure: ${maxExposure.maximumExposure}`);
    }
    
    return warnings;
  }
  
  private getCommonVolume(effects: FrequencyEffect[]): number | null {
    const volumes = effects
      .map(e => e.optimalVolume)
      .filter((v): v is number => v !== undefined);
    
    if (volumes.length === 0) return null;
    
    return volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
  }
  
  private getCommonDuration(effects: FrequencyEffect[]): string | null {
    const durations = effects.map(e => e.recommendedDuration);
    const durationCounts: { [key: string]: number } = {};
    
    durations.forEach(duration => {
      durationCounts[duration] = (durationCounts[duration] || 0) + 1;
    });
    
    const mostCommon = Object.entries(durationCounts)
      .sort(([,a], [,b]) => b - a)[0];
    
    return mostCommon ? mostCommon[0] : null;
  }
  
  private getContributors(): string[] {
    const contributors = new Set<string>();
    
    this.effects.forEach(effect => {
      if (effect.discoveredBy) {
        contributors.add(effect.discoveredBy);
      }
      effect.userReports.forEach(report => {
        contributors.add(report.userId);
      });
    });
    
    return Array.from(contributors);
  }
  
  private saveToStorage(): void {
    try {
      localStorage.setItem('aetheria_effects_db', JSON.stringify(this.effects));
    } catch (e) {
      console.warn('Could not save effects database to localStorage:', e);
    }
  }
  
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('aetheria_effects_db');
      if (stored) {
        const effects = JSON.parse(stored) as FrequencyEffect[];
        this.effects = [...KNOWN_EFFECTS, ...effects.filter(e => 
          !KNOWN_EFFECTS.some(known => known.id === e.id)
        )];
      }
    } catch (e) {
      console.warn('Could not load effects database from localStorage:', e);
    }
  }
  
  getAllEffects(): FrequencyEffect[] {
    return [...this.effects];
  }
}

export interface EffectReport {
  frequency: number;
  effectsFound: number;
  totalUserReports: number;
  averageConfidenceScore: number;
  effects: Array<{
    name: string;
    category: string;
    description: string;
    intensity: string;
    safetyLevel: string;
    userReports: number;
    confidenceScore: number;
    tags: string[];
  }>;
  recommendations: string[];
  warnings: string[];
}

/**
 * User Experience Tracker for documenting personal effects
 */
export class ExperienceTracker {
  private sessions: ExperienceSession[] = [];
  /**
   * v16.5 review (A6): everything aetheria_sessions held when it was read, in order: the sessions (the same objects
   * as `sessions`, so a note or an end is written back) and anything that isn't one, kept as it was. Before this,
   * nothing was read: the first session after a reload overwrote every earlier one.
   */
  private records: unknown[] = [];
  /**
   * v16.5 re-review (A6 across windows): the sessions this page started, by id. Another window (the installed app
   * beside a tab) writes the same list: every save reads it again just before it writes and merges into what it holds
   * then, by id, so neither window overwrites the other's sessions. A session of this page's that a save finds gone
   * (an older version's tab wrote over the list) is put back.
   */
  private own = new Map<string, ExperienceSession>();
  private loaded = false;
  /** The stored text when it couldn't be read as a list: it is never overwritten (saves wait). */
  private unreadable: string | null = null;

  /** What aetheria_sessions holds now: its entries, or null when it can't be read as a list (`unreadable` keeps it). */
  private readStored(): unknown[] | null {
    let raw: string | null = null;
    try {
      raw = typeof localStorage !== 'undefined' ? localStorage.getItem('aetheria_sessions') : null;
    } catch {
      raw = null;
    }
    this.unreadable = null;
    if (raw === null || raw === '') return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // below
    }
    this.unreadable = raw;
    return null;
  }

  /**
   * The stored list, read once (before the first change): its sessions to work with, the rest kept as it is. Each
   * save reads it again (saveToStorage), and what this page holds is then the list as that save wrote it.
   * Unreadable: this page's own sessions only (nothing is written).
   */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const stored = this.readStored() ?? [];
    const records: unknown[] = [];
    const sessions: ExperienceSession[] = [];
    const seen = new Set<string>();
    for (const r of stored) {
      records.push(r);
      if (isSession(r) && !seen.has(r.id)) {
        seen.add(r.id);
        sessions.push(r);
      }
    }
    for (const s of this.own.values()) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      records.push(s);
      sessions.push(s);
    }
    this.records = records;
    this.sessions = sessions;
  }
  
  startSession(frequency: number, volume: number, waveform: string = 'sine'): string {
    const session: ExperienceSession = {
      id: this.generateSessionId(),
      frequency,
      volume,
      waveform,
      startTime: new Date().toISOString(),
      priorState: this.getCurrentState(),
      notes: []
    };
    
    this.load();
    this.own.set(session.id, session);
    this.sessions.push(session);
    this.records.push(session);
    this.saveToStorage(session);
    return session.id;
  }
  
  addNote(sessionId: string, note: string): boolean {
    this.load();
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session || session.completed) return false;
    
    session.notes.push({
      timestamp: new Date().toISOString(),
      content: note
    });
    if (this.own.has(session.id)) this.own.set(session.id, session);
    
    this.saveToStorage(session);
    return true;
  }
  
  completeSession(sessionId: string): UserReport | null {
    this.load();
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session || session.completed) return null;
    
    const endTime = new Date();
    const startTime = new Date(session.startTime);
    const durationMinutes = (endTime.getTime() - startTime.getTime()) / (1000 * 60);
    
    session.completed = true;
    session.endTime = endTime.toISOString();
    session.postState = this.getCurrentState();
    if (this.own.has(session.id)) this.own.set(session.id, session);
    
    const report: UserReport = {
      id: this.generateSessionId(),
      userId: this.getUserId(),
      timestamp: session.startTime,
      frequency: session.frequency,
      volume: session.volume,
      duration: durationMinutes,
      waveform: session.waveform,
      priorState: session.priorState,
      postState: session.postState,
      effectsExperienced: [],
      sensations: [],
      emotionalChanges: [],
      physicalSensations: [],
      mentalChanges: [],
      overallExperience: 5,
      wouldRecommend: true,
      notes: session.notes.map(n => n.content).join(' '),
      verified: true,
      credibility: 7
    };
    
    this.saveToStorage(session);
    return report;
  }
  
  private getCurrentState() {
    // In a real implementation, this could prompt the user for current state
    // For now, return default values
    return {
      mood: 5,
      energy: 5,
      stress: 5,
      focus: 5
    };
  }
  
  private getUserId(): string {
    let userId = localStorage.getItem('aetheria_user_id');
    if (!userId) {
      userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('aetheria_user_id', userId);
    }
    return userId;
  }
  
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * v16.5 re-review (A6 across windows): the list is read again just before the write, and `changed` merged into what
   * it holds then, by id (another window's sessions written since stay, entries this can't read stay as they are);
   * this page's own sessions it no longer holds go back at the end.
   */
  private saveToStorage(changed: ExperienceSession): void {
    const stored = this.readStored();
    // v16.5 review (A6): what couldn't be read is never written over (this session stays in memory only).
    if (stored === null || this.unreadable !== null) {
      console.warn('Saved sessions could not be read, so they are left as they are; this session is not saved.');
      return;
    }
    const merged: unknown[] = [];
    const seen = new Set<string>();
    for (const r of stored) {
      if (isSession(r) && !seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r.id === changed.id ? changed : r);
      } else merged.push(r);
    }
    for (const s of [changed, ...this.own.values()]) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      merged.push(s);
    }
    this.records = merged;
    this.sessions = merged.filter((r, i): r is ExperienceSession => isSession(r) && merged.findIndex((x) => isSession(x) && x.id === r.id) === i);
    try {
      localStorage.setItem('aetheria_sessions', JSON.stringify(merged));
    } catch (e) {
      console.warn('Could not save sessions to localStorage:', e);
    }
  }
  
  getSessions(): ExperienceSession[] {
    this.load();
    return [...this.sessions];
  }
}

/** v16.5 review (A6): a stored session this tracker can work with (an id, a start, a notes list); anything else is kept
 *  as it is and left alone. */
function isSession(r: unknown): r is ExperienceSession {
  if (!r || typeof r !== 'object') return false;
  const s = r as Partial<ExperienceSession>;
  return typeof s.id === 'string' && s.id !== '' && typeof s.startTime === 'string' && Array.isArray(s.notes);
}

interface ExperienceSession {
  id: string;
  frequency: number;
  volume: number;
  waveform: string;
  startTime: string;
  endTime?: string;
  completed?: boolean;
  priorState: {
    mood: number;
    energy: number;
    stress: number;
    focus: number;
  };
  postState?: {
    mood: number;
    energy: number;
    stress: number;
    focus: number;
  };
  notes: Array<{
    timestamp: string;
    content: string;
  }>;
}

// Global instances
export const effectsManager = new EffectsDocumentationManager();
export const experienceTracker = new ExperienceTracker();