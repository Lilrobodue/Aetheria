// scripts/copy-words.mjs (v16.6): the copy gate's word list, its tiers and its retired phrases, in ONE place.
// Read by scripts/check-copy.mjs (the static gate), utils/copy/copy.check.ts (the copy modules' own check) and
// e2e/tests/copy-dom.spec.ts (the DOM gate on rendered screens), so the three can never disagree.

/** The evidence tiers (utils/copy/evidence.ts's Tier). */
export const TIERS = ['arithmetic', 'tier1', 'tier2', 'tier3', 'open', 'design', 'tradition'];

/** The plan's six words (heal, repair, DNA, pineal, cure, "safe for") and their relatives (the v16.6 spec §5.2). */
export const WORDS = [
  ['heal', /\bheal(?:s|ed|ing|er|ers)?\b/i],
  ['repair', /\brepair(?:s|ed|ing)?\b/i],
  ['DNA', /\bdna\b/i],
  ['pineal', /\bpineal\b/i],
  ['cure', /\bcur(?:e|es|ed|ing|ative)\b/i],
  ['safe for', /\bsafe\s+(?:for|frequenc\w*)\b|\(safe\)/i],
  ['therapy', /\btherap(?:y|ies|eutic|eutics|eutically|ist|ists)\b/i],
  ['treat', /\btreat(?:s|ed|ing|ment|ments)?\b/i],
  ['medical', /\bmedic(?:al|ally|ine|ines|inal|ation|ations)\b/i],
  ['detox', /\bdetox\w*/i],
  ['miracle', /\bmiracle\w*/i],
  ['cellular', /\bcellular\b/i],
  ['immune', /\bimmun\w*/i],
  ['proven', /\b(?:proven|scientifically)\b/i],
  ['frequency of love', /\b(?:frequenc(?:y|ies) of love|love frequenc(?:y|ies))\b/i],
];

/** The words a text carries ([] when none). */
export function wordsIn(text) {
  return WORDS.filter(([, re]) => re.test(text)).map(([w]) => w);
}

/** Exact phrases the copy pass retired (spec §3.4.11): they fail anywhere but in a unit a `dead` or `data` entry allows. */
export const RETIRED = [
  'The miracle tone - repairs DNA',
  'Activates pineal gland',
  'natural anesthetic',
  'Powerful tissue repair',
  'Safe frequency for extended use',
  'Safe for extended listening',
  'Good for meditation and healing',
  'Deep Sleep & Healing',
  'Focus on feeling rather than hearing',
  'feeling vs hearing',
  'you can feel but might not consciously hear',
  'mathematically consistent with the Golden Ratio',
  'slightly dissonant with nature',
  'EXCELLENT match',
  'Near perfect alignment',
  'most accurate results',
  'frequency content',
  'closest song in your library',
  'Deep Scan measure',
  'Music Is Medicine',
  'that question has been answered',
  'saved for research',
  'to prevent crashes',
  'Maximum caution required',
  'Use extreme caution',
  'Expert Level Required',
];

/** The retired phrases a text carries. */
export function retiredIn(text) {
  return RETIRED.filter((p) => text.includes(p));
}

/** The allow-list kinds (spec §5.3, plus `work-title`: another work's own title, kept by decision 3 / K6). */
export const KINDS = ['negation', 'statement-tradition', 'brand', 'self-report', 'guide', 'score-name', 'work-title', 'data', 'dead'];
