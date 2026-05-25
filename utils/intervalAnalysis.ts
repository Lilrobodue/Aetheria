// Interval / Gap Analysis layer for the Aetheria FFT scanner.
//
// Augments existing peak detection by analyzing the *relationships* between
// detected frequency peaks. Produces a 0–100 harmonic coherence score, a
// fingerprint of interval structure, and a track classification.
//
// All functions are pure and have no Web Audio dependencies — they operate on
// the already-detected peaks array returned by analyzeExtendedOctaveRanges().

export interface Peak {
  frequency: number;
  score: number;
  octaveRange?: string;
}

export interface AetheriaIntervalMatch {
  match: boolean;
  base?: number;       // 111, 243, or 354
  multiplier?: number; // 1..10
  deviation?: number;  // signed Hz error
}

export interface HarmonicRatioMatch {
  match: boolean;
  name?: string;
  deviation?: number;
}

export interface IntervalRecord {
  fromHz: number;
  toHz: number;
  gap: number;
  ratio: number;
  gapDigitalRoot: number;
  isAetheriaInterval: AetheriaIntervalMatch;
  isHarmonicRatio: HarmonicRatioMatch;
  isDivisibleBy3: boolean;
}

export interface IntervalFingerprint {
  fingerprint: number[];     // digital roots of gaps, sorted ascending by gap
  ratio369: number;          // 0..1, share of gaps with digital root in {3,6,9}
  totalIntervals: number;
  aetheriaMatches: number;
  harmonicMatches: number;
}

export type TrackClassification =
  | 'aetheria_tuned'
  | 'harmonically_aligned'
  | 'partially_aligned'
  | 'unstructured';

export interface IntervalAnalysisResult {
  coherenceScore: number;        // 0..100
  intervals: IntervalRecord[];
  fingerprint: IntervalFingerprint;
  classification: TrackClassification;
}

// Canonical Aetheria interval steps (from the codebase frequency table).
// GUT progression is dominantly 111 Hz, HEART is 243 Hz, HEAD is 354 Hz.
const AETHERIA_INTERVALS = [111, 243, 354];

const HARMONIC_RATIOS: Array<{ name: string; value: number }> = [
  { name: 'unison',         value: 1.0 },
  { name: 'minor_third',    value: 1.2 },     // 6:5
  { name: 'major_third',    value: 1.25 },    // 5:4
  { name: 'perfect_fourth', value: 1.3333 },  // 4:3
  { name: 'perfect_fifth',  value: 1.5 },     // 3:2
  { name: 'phi',            value: 1.618 },   // golden ratio
  { name: 'octave',         value: 2.0 },
  { name: 'double_octave',  value: 4.0 },
  { name: 'triple_octave',  value: 8.0 },
];

// Repeated-digit-sum reduction (O(1) via mod-9). Returns 0 only for 0.
export function digitalRoot(n: number): number {
  const m = Math.round(Math.abs(n));
  if (m === 0) return 0;
  return 1 + ((m - 1) % 9);
}

// Fast rejection filter: returns false for any peak that can't be Aetheria.
// Every Aetheria frequency is divisible by 3 and lives within 150..6500 Hz.
export function couldBeAetheria(hzValue: number): boolean {
  const rounded = Math.round(hzValue);
  if (rounded < 150 || rounded > 6500) return false;
  if (rounded % 3 !== 0) return false;
  const dr = digitalRoot(rounded);
  return dr === 3 || dr === 6 || dr === 9;
}

export function isAetheriaInterval(gap: number, tolerance = 2): AetheriaIntervalMatch {
  for (const base of AETHERIA_INTERVALS) {
    for (let mult = 1; mult <= 10; mult++) {
      const target = base * mult;
      const dev = gap - target;
      if (Math.abs(dev) <= tolerance) {
        return { match: true, base, multiplier: mult, deviation: dev };
      }
    }
  }
  return { match: false };
}

export function isHarmonicRatio(ratio: number, tolerance = 0.02): HarmonicRatioMatch {
  for (const h of HARMONIC_RATIOS) {
    if (h.value < 1.0) continue;
    const dev = ratio - h.value;
    if (Math.abs(dev) <= tolerance) {
      return { match: true, name: h.name, deviation: dev };
    }
  }
  return { match: false };
}

function computeIntervals(peaks: Peak[]): IntervalRecord[] {
  const out: IntervalRecord[] = [];
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < peaks.length; j++) {
      const a = peaks[i].frequency;
      const b = peaks[j].frequency;
      if (a <= 0 || b <= 0) continue;
      const gap = Math.abs(a - b);
      const hi = Math.max(a, b);
      const lo = Math.min(a, b);
      const ratio = lo > 0 ? hi / lo : 0;
      out.push({
        fromHz: a,
        toHz: b,
        gap,
        ratio,
        gapDigitalRoot: digitalRoot(gap),
        isAetheriaInterval: isAetheriaInterval(gap),
        isHarmonicRatio: isHarmonicRatio(ratio),
        isDivisibleBy3: Math.round(gap) % 3 === 0,
      });
    }
  }
  return out;
}

export function computeCoherenceScore(intervals: IntervalRecord[]): number {
  if (intervals.length === 0) return 0;
  let score = 0;
  let maxPossible = 0;
  for (const it of intervals) {
    maxPossible += 30; // 10 + 10 + 5 + 5

    if (it.isAetheriaInterval.match) {
      const dev = Math.abs(it.isAetheriaInterval.deviation ?? 0);
      score += 10 - Math.min(10, dev);
    }
    if (it.isHarmonicRatio.match) {
      const dev = Math.abs(it.isHarmonicRatio.deviation ?? 0);
      score += 10 - Math.min(10, dev * 100);
    }
    if (it.gapDigitalRoot === 3 || it.gapDigitalRoot === 6 || it.gapDigitalRoot === 9) {
      score += 5;
    }
    if (it.isDivisibleBy3) {
      score += 5;
    }
  }
  return Math.round((score / maxPossible) * 100);
}

export function intervalFingerprint(intervals: IntervalRecord[]): IntervalFingerprint {
  const sorted = [...intervals].sort((a, b) => a.gap - b.gap);
  const fingerprint = sorted.map(i => i.gapDigitalRoot);
  const count369 = fingerprint.filter(d => d === 3 || d === 6 || d === 9).length;
  const ratio369 = fingerprint.length > 0 ? count369 / fingerprint.length : 0;
  return {
    fingerprint,
    ratio369,
    totalIntervals: intervals.length,
    aetheriaMatches: intervals.filter(i => i.isAetheriaInterval.match).length,
    harmonicMatches: intervals.filter(i => i.isHarmonicRatio.match).length,
  };
}

export function classifyTrack(
  coherenceScore: number,
  fingerprint: IntervalFingerprint
): TrackClassification {
  if (coherenceScore >= 75 && fingerprint.ratio369 >= 0.7) return 'aetheria_tuned';
  if (coherenceScore >= 50 && fingerprint.ratio369 >= 0.5) return 'harmonically_aligned';
  if (coherenceScore >= 25) return 'partially_aligned';
  return 'unstructured';
}

// Main entry: analyze a peak set and produce the full interval result.
// `peaks` is the array returned by the existing FFT peak detector.
export function analyzeIntervals(peaks: Peak[]): IntervalAnalysisResult {
  const intervals = computeIntervals(peaks);
  const coherenceScore = computeCoherenceScore(intervals);
  const fingerprint = intervalFingerprint(intervals);
  const classification = classifyTrack(coherenceScore, fingerprint);
  return { coherenceScore, intervals, fingerprint, classification };
}

// Human-readable label for the four classifications.
export function classificationLabel(c: TrackClassification): string {
  switch (c) {
    case 'aetheria_tuned':       return 'Aetheria Tuned';
    case 'harmonically_aligned': return 'Harmonically Aligned';
    case 'partially_aligned':    return 'Partially Aligned';
    case 'unstructured':         return 'Unstructured';
  }
}
