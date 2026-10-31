// utils/copy/crystalCopy.ts (v16.6, "How sure are we?": the copy pass with evidence tags)
//
// The words a crystal shows: a short name (no claim words, so it can stand alone in the Lo Shu cube and the technical
// guide's cards) and one association sentence that carries its evidence tag (check:copy's T2 rule: a claim word in a
// string passes only in an object that also has `tag`). The user's decision (2026-10-28): strong health words are
// rewritten as traditional associations with an evidence tag, never kept as effects and never dropped.
//   - crystals 1-9 (GUT) are the Solfeggio teaching's associations: "Traditionally associated with ...";
//   - crystals 10-27 (HEART, HEAD) are the Aetheria framework's own meanings: "In the Aetheria framework, ...".
// Both carry the Tradition tag (decision 2 A). SOLFEGGIO_INFO (constants.ts) stays untouched (memory: wrap data tables
// at the boundary): its benefit / description / anatomy fields are rendered nowhere, and check:copy fails if any file
// starts reading .benefit or .anatomy.
// Also here: the regimes' and transitions' lines (the technical guide), the beat bands (both layouts) and the 432 Hz
// words (the tutorial, the tour and the Guide). Pure, Node-checked (copy.check.ts), no React.
//
// tailwind.config.js scans utils/: no word in these comments is meant as a style name.

import type { Tier } from './evidence.ts';

export interface CrystalCopy {
  hz: number;
  /** Short and claim-free: the cube's cells, the technical guide's card titles, the meaning block's heading. */
  name: string;
  /** One sentence, framed as an association, tagged. */
  association: string;
  tag: Tier;
}

export const CRYSTAL_COPY: readonly CrystalCopy[] = [
  // GUT: the nine Solfeggio frequencies (a modern teaching; its associations, reframed)
  { hz: 174, name: 'Foundation', association: 'Traditionally associated with foundation, security and relief from pain.', tag: 'tradition' },
  { hz: 285, name: 'Renewal', association: 'Traditionally associated with tissue repair and quantum cognition.', tag: 'tradition' },
  { hz: 396, name: 'Liberation', association: 'Traditionally associated with liberating fear and guilt.', tag: 'tradition' },
  { hz: 417, name: 'Change', association: 'Traditionally associated with facilitating change and undoing situations.', tag: 'tradition' },
  { hz: 528, name: 'Transformation', association: 'Traditionally associated with transformation, miracles and DNA repair. In Solfeggio teaching it is called “the miracle tone”.', tag: 'tradition' },
  { hz: 639, name: 'Connection', association: 'Traditionally associated with connecting relationships and harmony.', tag: 'tradition' },
  { hz: 741, name: 'Intuition', association: 'Traditionally associated with awakening intuition and problem solving.', tag: 'tradition' },
  { hz: 852, name: 'Spiritual order', association: 'Traditionally associated with returning to spiritual order and inner strength.', tag: 'tradition' },
  { hz: 963, name: 'Divine consciousness', association: 'Traditionally associated with divine consciousness, unity and pineal activation.', tag: 'tradition' },
  // HEART: the Aetheria framework's fourth to sixth orders (963 + 243 steps)
  { hz: 1206, name: 'Gateway', association: 'In the Aetheria framework, the gateway between the physical and the emotional.', tag: 'tradition' },
  { hz: 1449, name: 'Harmonic bridge', association: 'In the Aetheria framework, a harmonic bridge between emotional states.', tag: 'tradition' },
  { hz: 1692, name: 'Heart completion', association: 'In the Aetheria framework, the completion of the heart cycle.', tag: 'tradition' },
  { hz: 1935, name: 'Stellar connection', association: 'In the Aetheria framework, alignment with stellar energies.', tag: 'tradition' },
  { hz: 2178, name: 'SOURCE · compassion', association: 'In the Aetheria framework, SOURCE: compassion, at the centre of the Lo Shu cube.', tag: 'tradition' },
  { hz: 2421, name: 'Dimensional awareness', association: 'In the Aetheria framework, awareness of many dimensions.', tag: 'tradition' },
  { hz: 2664, name: 'Universal love', association: 'In the Aetheria framework, universal love.', tag: 'tradition' },
  { hz: 2907, name: 'Divine source', association: 'In the Aetheria framework, connection with the divine source.', tag: 'tradition' },
  { hz: 3150, name: 'Unity bridge', association: 'In the Aetheria framework, a bridge into unity consciousness.', tag: 'tradition' },
  // HEAD: the seventh to ninth orders (3150 + 354 steps)
  { hz: 3504, name: 'Mental clarity', association: 'In the Aetheria framework, mental clarity.', tag: 'tradition' },
  { hz: 3858, name: 'Divine architecture', association: 'In the Aetheria framework, sacred geometry: divine architecture.', tag: 'tradition' },
  { hz: 4212, name: 'Consciousness mastery', association: 'In the Aetheria framework, mastery of consciousness.', tag: 'tradition' },
  { hz: 4566, name: 'Soul star', association: 'In the Aetheria framework, the first transpersonal gate: the soul star.', tag: 'tradition' },
  { hz: 4920, name: 'Spirit gate', association: 'In the Aetheria framework, the second transpersonal gate: spirit.', tag: 'tradition' },
  { hz: 5274, name: 'Universal mind', association: 'In the Aetheria framework, the third transpersonal gate: the universal mind.', tag: 'tradition' },
  { hz: 5628, name: 'Galactic centre', association: 'In the Aetheria framework, galactic consciousness.', tag: 'tradition' },
  { hz: 5982, name: 'Divine gateway', association: 'In the Aetheria framework, a portal to the divine source.', tag: 'tradition' },
  { hz: 6336, name: 'Completion', association: 'In the Aetheria framework, SOURCE embodiment and the completion of the ascent.', tag: 'tradition' },
];

/** 111 Hz: the labelled non-canonical exception (v15.9's chip). Its words are the chip's own. */
export const CRYSTAL_111: CrystalCopy = { hz: 111, name: '111 Hz', association: 'Not one of the 27 crystals.', tag: 'design' };

/** Lo Shu Perfect counterparts (memory "Lo Shu integration": 174→75, 285→186, 396→297, 417→408, 528→519, 639→630). */
export const PERFECT_OF: Readonly<Record<number, number>> = { 75: 174, 186: 285, 297: 396, 408: 417, 519: 528, 630: 639 };

/** The words for any playable frequency: a crystal, a Lo Shu Perfect counterpart (its source crystal's words, with
 *  `perfectOf`), 111, or null for anything else. Total. */
export function crystalCopy(hz: number): (CrystalCopy & { perfectOf?: number }) | null {
  if (!Number.isFinite(hz)) return null;
  if (hz === 111) return CRYSTAL_111;
  const base = PERFECT_OF[hz];
  const c = CRYSTAL_COPY.find((x) => x.hz === (base ?? hz));
  if (!c) return null;
  return base ? { ...c, hz, perfectOf: base } : c;
}

/** The meaning block's line for a Perfect counterpart (an Arithmetic fact: the swap table). */
export function perfectLine(of: number): string {
  return `Lo Shu Perfect counterpart of ${of} Hz.`;
}

/** A Perfect counterpart's association, credited to its crystal (no tradition belongs to 75 Hz itself): "Its crystal,
 *  174 Hz, is traditionally associated with …". */
export function perfectAssociation(of: number): string {
  const c = CRYSTAL_COPY.find((x) => x.hz === of);
  if (!c) return '';
  return c.association.replace(/^Traditionally associated with /, `Its crystal, ${of} Hz, is traditionally associated with `);
}

/** GEOMETRY_INFO's shapes whose name or element holds a health word (decision 8, 2026-10-30: 5274 Hz's "Healing
 *  Mandala · Healing" is kept, the framework's own name, and shown with a Tradition tag wherever it shows: the meaning
 *  block, the technical guide's geometry section, classic's status pills). copy.check.ts holds this set equal to the
 *  table's flagged shapes, so a new one can't go untagged. */
export const TAGGED_SHAPES: ReadonlySet<string> = new Set(['Healing Mandala']);

/** The meaning block's shape line ("Shape: Metatron's Cube · Light"), from GEOMETRY_INFO's shape and element (read at
 *  the render site, so the data table stays untouched). */
export function shapeLine(shape: string, element: string): string {
  return `Shape: ${shape} · ${element}`;
}

/** The technical guide's regime cards, header lines reframed (A4). */
export const REGIME_COPY = [
  { regime: 'GUT', line: 'Traditionally associated with the digestive, nervous, skeletal and reproductive systems. Focus: grounding, healing, security.', tag: 'tradition' },
  { regime: 'HEART', line: 'In the Aetheria framework, associated with the heart, the breath and the immune system. Focus: love, compassion, connection, harmony.', tag: 'tradition' },
  { regime: 'HEAD', line: 'In the Aetheria framework, associated with the nervous and endocrine systems and the centres of consciousness. Focus: clarity, wisdom, transcendence.', tag: 'tradition' },
] as const;

/** The regime transitions (A5): the arithmetic as the heading, the framework's meaning as the line. */
export const TRANSITION_COPY = [
  { from: 963, to: 1206, heading: '963 Hz → 1206 Hz: from GUT to HEART', line: 'In the Aetheria framework, the threshold from the physical into the emotional and energetic.', tag: 'tradition' },
  { from: 3150, to: 3504, heading: '3150 Hz → 3504 Hz: from HEART to HEAD', line: 'In the Aetheria framework, the threshold from the emotional into the mental and spiritual.', tag: 'tradition' },
] as const;

/** The technical guide's regimes section: its title and lead (the lead's first sentence reframed; the rest verbatim). */
export const REGIMES_TITLE = 'The 3 Regimes: GUT, HEART and HEAD';
export const REGIMES_LEAD_START = 'Aetheria’s 27 crystals in three regimes, following the 111-243-354 pattern. Orders 4-9 expand from the traditional Solfeggio foundation through precise mathematical intervals, creating 27 frequencies that span from physical foundation to SOURCE consciousness. Each regime below is a single horizontal slice of the';
/** HEAD's card mark (A6): it was "Expert Level Required". */
export const HEAD_MARK_TITLE = 'HEAD: the highest crystals';

const ORDER_WORD: Readonly<Record<number, string>> = { 4: 'Fourth', 5: 'Fifth', 6: 'Sixth', 7: 'Seventh', 8: 'Eighth', 9: 'Ninth' };
/** A HEART or HEAD card's first line, the arithmetic (A3): "Fifth Order · 1692 + 243". */
export function orderLine(order: number, prev: number, step: number): string {
  return `${ORDER_WORD[order] ?? `${order}th`} Order · ${prev} + ${step}`;
}

/** The beat bands (both layouts: classic's presets, the new layout's Beat section): the EEG band names, no "best for". */
export const BAND_LINES: Readonly<Record<'Delta' | 'Theta' | 'Alpha' | 'Beta' | 'Gamma', string>> = {
  Delta: 'The 0.5–4 Hz band: deep sleep’s rhythm',
  Theta: 'The 4–8 Hz band: drowsiness and deep meditation',
  Alpha: 'The 8–13 Hz band: relaxed and awake, eyes closed',
  Beta: 'The 13–30 Hz band: alert, active thinking',
  Gamma: 'The band above 30 Hz',
};
/** The band line for a preset's name (classic's BINAURAL_PRESETS and the new layout's bands share these names). */
export function bandLine(name: string): string | null {
  return (BAND_LINES as Record<string, string>)[name] ?? null;
}
/** The one tagged line over the bands (Tier 2: Ingendoh et al. 2023; Garcia-Argibay et al. 2019). */
export const BEAT_EVIDENCE = { line: 'The bands are the usual names for the brain’s rhythms. The evidence on whether a beat moves your own brainwaves is mixed.', tag: 'tier2' } as const;
/** Classic's beat section heading (C2: it was "Binaural Entrainment"). */
export const BEAT_HEADING = 'Binaural Beat';

/** 432 Hz, short (the tour's and the tutorial's first card) and long (the Guide's technical view, B3). */
export const RETUNE_SHORT = 'Every note about a third of a semitone lower than standard 440 Hz. Some listeners find it warmer.';
export const RETUNE_TITLE = 'The arithmetic of 432 Hz';
export const RETUNE_LONG = [
  { text: 'Aetheria plays your music at 432/440 of its speed (× 0.98182): every pitch 31.8 cents lower, so A = 440 Hz becomes A = 432 Hz, and a 4:00 track plays in 4:04. 432 is a whole number (2⁴ × 3³), so it isn’t tied to the golden ratio, which is irrational.', tag: 'arithmetic' },
  { text: 'Some listeners find 432 Hz warmer. A handful of small studies have compared the two tunings since 2019; their results point both ways.', tag: 'tier3' },
] as const;
/** 432's history (a sourced fact, Lockhart 2025; How sure are we?'s "432 Hz and 440 Hz" topic carries it under that
 *  topic's own tags, Arithmetic and Early evidence): no claim, so no tag of its own. */
export const RETUNE_HISTORY = 'Verdi argued for a lower pitch, and Italy’s army bands used A = 432 for a time; 440 Hz later became the international standard.';
