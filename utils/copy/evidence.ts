// utils/copy/evidence.ts (v16.6, "How sure are we?": the copy pass with evidence tags)
//
// The evidence tags and the "How sure are we?" section's words (the Guide, both views, both layouts). Pure, Node-checked
// (copy.check.ts: npm run check:copy), no React. Every source below was checked on 2026-10-28 (the v16.6 spec, Appendix
// C); the technical view links them through the external-link guard. The user's decisions (2026-10-29): 1 A, plain
// words on the tag (the Guide's headings add the tier number); 2 A, a Tradition tag of its own.
//
// tailwind.config.js scans utils/: no word in these comments is meant as a style name.

export type Tier = 'arithmetic' | 'tier1' | 'tier2' | 'tier3' | 'open' | 'design' | 'tradition';
export const TIER_ORDER: readonly Tier[] = ['arithmetic', 'tier1', 'tier2', 'tier3', 'open', 'design', 'tradition'];

export function isTier(v: unknown): v is Tier {
  return typeof v === 'string' && (TIER_ORDER as readonly string[]).includes(v);
}

export interface TierCopy {
  id: Tier;
  /** The tag's text (decision 1 A: plain words). */
  label: string;
  /** Decision 1 B's text, kept so the choice is one constant (TAG_LABELS). */
  labelNumbered: string;
  /** The Guide's heading for the tier. */
  heading: string;
  /** lucide-react icon name (EvidenceTag maps it to the component). */
  icon: 'Sigma' | 'CircleCheck' | 'Contrast' | 'Sprout' | 'CircleHelp' | 'PencilRuler' | 'ScrollText';
  /** Dashed border: not a level of scientific support (Open, Tradition). Never colour alone. */
  dashed: boolean;
  plain: string;
  technical: string;
  /** "In Aetheria": the app's claims that carry this tag. */
  examples: readonly string[];
}

export const TIERS: Readonly<Record<Tier, TierCopy>> = {
  arithmetic: {
    id: 'arithmetic', label: 'Arithmetic', labelNumbered: 'Arithmetic', heading: 'Arithmetic', icon: 'Sigma', dashed: false,
    plain: 'True by calculation: you can check it yourself.',
    technical: 'Follows from definitions and arithmetic; no experiment is needed, and none could change it.',
    examples: [
      '432 Hz is 440 Hz × 0.98182: every note 31.8 cents lower, and a 4:00 track plays in 4:04.',
      'The Lo Shu’s rows, columns and diagonals each add up to 15.',
      'HEART and HEAD form magic squares because they rise in even steps (243 and 354 Hz): any nine evenly spaced numbers do, placed in the Lo Shu’s order.',
      'Lo Shu Perfect moves three GUT crystals by 99 Hz and three by 9 Hz.',
      'φ ≈ 1.618; 38.2 % and 61.8 % of a track; digit sums of 3, 6 and 9.',
    ],
  },
  tier1: {
    id: 'tier1', label: 'Well studied', labelNumbered: 'Tier 1', heading: 'Tier 1 · Well studied', icon: 'CircleCheck', dashed: false,
    plain: 'Many good studies agree, summed up in systematic reviews.',
    technical: 'Consistent findings across many controlled studies, pooled in systematic reviews or meta-analyses (or textbook psychoacoustics and physics).',
    examples: [
      'Music can lower stress and anxiety, and help some people sleep (findings about music in general, often chosen by the listener).',
      'A binaural beat is heard only when each ear gets its own tone: best with tones near 400–500 Hz, and up to about 30–35 Hz apart.',
      'The brain follows a steady pulsing sound: it shows in brain recordings (EEG).',
      'How much two tones “rub” (roughness): Key fit uses it.',
      'The bands of brain recordings (EEG), delta to gamma, are the usual names for the brain’s rhythms.',
    ],
  },
  tier2: {
    id: 'tier2', label: 'Mixed evidence', labelNumbered: 'Tier 2', heading: 'Tier 2 · Mixed evidence', icon: 'Contrast', dashed: false,
    plain: 'Controlled studies exist, but their results are small or disagree.',
    technical: 'Randomised or controlled studies exist; pooled effects are inconsistent, heterogeneous or small, or the mechanism is contested.',
    examples: [
      'Whether a binaural beat changes your brainwaves (“entrainment”).',
      'Binaural beats for anxiety, pain and attention.',
    ],
  },
  tier3: {
    id: 'tier3', label: 'Early evidence', labelNumbered: 'Tier 3', heading: 'Tier 3 · Early evidence', icon: 'Sprout', dashed: false,
    plain: 'A few small or early studies; not confirmed yet.',
    technical: 'A handful of small, often uncontrolled or single-group studies, or only cell or animal work; no review that settles it.',
    examples: [
      '432 Hz compared with 440 Hz.',
      'Pulsed (isochronic) beats; singing bowls and sound baths; low-frequency vibration.',
    ],
  },
  open: {
    id: 'open', label: 'Open question', labelNumbered: 'Open', heading: 'Open question', icon: 'CircleHelp', dashed: true,
    plain: 'No good evidence either way: untested, or only theory and personal reports.',
    technical: 'No adequate study found (searched October 2026); claims rest on theory, tradition or anecdote. Absence of evidence, stated as such.',
    examples: [
      'Whether any of the 27 crystals has an effect of its own.',
      'Golden-ratio tones; tones at the Schumann rate; feeling a drone you can’t hear.',
    ],
  },
  design: {
    id: 'design', label: 'Design choice', labelNumbered: 'Design choice', heading: 'Design choice', icon: 'PencilRuler', dashed: false,
    plain: 'Aetheria’s own choice, how it is built: not a claim about the world.',
    technical: 'A decision of the app’s design (values, names, structure). It can be judged by ear or by taste, not by evidence.',
    examples: [
      'The 27 crystals, the three ranges, and the crystal each track gets (an assignment, not a measured pitch).',
      'The layers’ levels under the music, Gamma as a manual choice, Key fit, the drone’s rests, φ timing.',
      'The crystal sets and their names; the experimental scan scores.',
    ],
  },
  tradition: {
    id: 'tradition', label: 'Tradition', labelNumbered: 'Tradition', heading: 'Tradition', icon: 'ScrollText', dashed: true,
    plain: 'What a tradition or teaching holds. Respected as meaning, not offered as a tested claim.',
    technical: 'The meanings a spiritual tradition or teaching gives (including the Aetheria framework’s own). Where science has looked at one, the topics below say what it found.',
    examples: [
      'Chakra and Solfeggio meanings (the Solfeggio numbers are a modern teaching, from the 1970s to the 1990s, named after medieval singing syllables).',
      'The Lo Shu legend, the Tree of Life, sacred geometry, the nadis.',
      'The Aetheria framework’s meanings for crystals 10–27.',
    ],
  },
};

/** Decision 1 (A, 2026-10-29): what the tags say. The one constant: 'plain' shows TIERS[t].label ("Mixed evidence"),
 *  'numbered' would show labelNumbered ("Tier 2"). The Guide's headings carry the number either way. */
export const TAG_LABELS: 'plain' | 'numbered' = 'plain';

export function tagLabel(t: Tier): string {
  return TAG_LABELS === 'numbered' ? TIERS[t].labelNumbered : TIERS[t].label;
}

/** A tag's accessible name: it contains the visible label (WCAG 2.5.3, Label in Name). */
export function tagName(t: Tier): string {
  return `Evidence: ${tagLabel(t)}. Opens How sure are we?`;
}

/** The anchors: the section and each tier's heading (both Guide views have every one). */
export const HOW_SURE_ID = 'how-sure';
export function tierAnchor(t: Tier): string {
  return `how-sure-${t}`;
}

export interface Ref { cite: string; url: string }
export interface Topic { id: string; title: string; tags: readonly Tier[]; plain: string; technical: string; refs: readonly Ref[] }

export const TOPICS: readonly Topic[] = [
  {
    id: 'music', title: 'Music, stress and sleep', tags: ['tier1'],
    plain: 'Listening to music lowers stress and anxiety in many studies, and helps some people with poor sleep rate their sleep better. These are findings about music, not about any frequency or tuning.',
    technical: 'de Witte et al. 2020: 104 RCTs (n = 9,617), d = 0.38 physiological and 0.55 psychological stress. Bradt et al. 2013 (Cochrane): music before surgery, 26 trials, anxiety SMD −0.60. Jespersen et al. 2022 (Cochrane): insomnia, 13 RCTs, PSQI −2.79; objective sleep unchanged. Most trials can’t blind listeners.',
    refs: [
      { cite: 'de Witte M, et al. (2020). Effects of music interventions on stress-related outcomes: a systematic review and two meta-analyses. Health Psychology Review 14(2):294–324.', url: 'https://doi.org/10.1080/17437199.2019.1627897' },
      { cite: 'Bradt J, Dileo C, Shim M (2013). Music interventions for preoperative anxiety. Cochrane Database Syst Rev CD006908.', url: 'https://doi.org/10.1002/14651858.CD006908.pub2' },
      { cite: 'Jespersen KV, et al. (2022). Listening to music for insomnia in adults. Cochrane Database Syst Rev CD010459.', url: 'https://doi.org/10.1002/14651858.CD010459.pub3' },
    ],
  },
  {
    id: 'binaural', title: 'Binaural beats', tags: ['tier1', 'tier2'],
    plain: 'Hearing a binaural beat is well understood: each ear needs its own tone. Whether the beat changes your brainwaves, or helps anxiety, pain or focus, is mixed: some studies find effects, others don’t.',
    technical: 'Perception: Licklider et al. 1950, Perrott & Nelson 1969 (beats up to ~30–35 Hz apart, best near 400–500 Hz carriers, little above 1,500 Hz). EEG: Ingendoh et al. 2023, 14 studies: 5 for entrainment, 8 against, 1 mixed. Behaviour: Garcia-Argibay et al. 2019, 22 studies, g = 0.45 with wide variation; Mallik & Russo 2022, beats alone no better than pink noise for anxiety. Sleep: no meta-analysis found.',
    refs: [
      { cite: 'Licklider JCR, Webster JC, Hedlun JM (1950). On the frequency limits of binaural beats. JASA 22(4):468–473.', url: 'https://doi.org/10.1121/1.1906629' },
      { cite: 'Perrott DR, Nelson MA (1969). Limits for the detection of binaural beats. JASA 46(6B):1477–1481.', url: 'https://doi.org/10.1121/1.1911890' },
      { cite: 'Ingendoh RM, Posny ES, Heine A (2023). Binaural beats to entrain the brain? A systematic review. PLOS ONE 18(5):e0286023.', url: 'https://doi.org/10.1371/journal.pone.0286023' },
      { cite: 'Garcia-Argibay M, Santed MA, Reales JM (2019). Efficacy of binaural auditory beats in cognition, anxiety, and pain perception: a meta-analysis. Psychological Research 83(2):357–372.', url: 'https://doi.org/10.1007/s00426-018-1066-8' },
      { cite: 'Mallik A, Russo FA (2022). The effects of music & auditory beat stimulation on anxiety: a randomized clinical trial. PLOS ONE 17(3):e0259312.', url: 'https://doi.org/10.1371/journal.pone.0259312' },
    ],
  },
  {
    id: 'pulse', title: 'Pulsed beats and the brain’s following', tags: ['tier1', 'tier3'],
    plain: 'The brain follows a steady pulsing sound, and that shows in brain recordings (EEG; it is used to test hearing). That following is not, by itself, evidence of relaxation; studies of pulsed beats’ effects are few and small.',
    technical: 'The auditory steady-state response (Picton et al. 2003; Galambos et al. 1981, 40 Hz). No systematic review of isochronic tones; the few controlled trials found little or no difference.',
    refs: [
      { cite: 'Picton TW, et al. (2003). Human auditory steady-state responses. International Journal of Audiology 42(4):177–219.', url: 'https://doi.org/10.3109/14992020309101316' },
    ],
  },
  {
    id: 'tuning', title: '432 Hz and 440 Hz', tags: ['arithmetic', 'tier3'],
    plain: '432 Hz is 440 Hz × 0.98182, about a third of a semitone lower. Verdi argued for a lower pitch, and Italy’s army bands used A = 432 for a time; 440 Hz became the international standard. A few small studies have compared the two since 2019, with results that point both ways. 432 is a whole number (2⁴ × 3³): it isn’t tied to the golden ratio, which is irrational.',
    technical: 'Calamassi & Pomponi 2019: 33 people, heart rate −4.8 bpm with 432 Hz (p = 0.05), other measures not significant. Later trials are small, mostly from one group, often within-group only; two athlete trials (Jebabli et al. 2025) favoured 440 Hz.',
    refs: [
      { cite: 'Calamassi D, Pomponi GP (2019). Music tuned to 440 Hz versus 432 Hz and the health effects: a double-blind cross-over pilot study. Explore 15(4):283–290.', url: 'https://doi.org/10.1016/j.explore.2019.04.001' },
      { cite: 'Lockhart E (2025). Tuning sounds in Italy, 1750–1885. Nineteenth-Century Music Review 22(3):344–360.', url: 'https://doi.org/10.1017/S1479409824000375' },
    ],
  },
  {
    id: 'solfeggio', title: 'The Solfeggio frequencies', tags: ['tradition', 'open'],
    plain: 'The nine Solfeggio numbers are a modern teaching, from the 1970s to the 1990s, named after the medieval singing syllables. Their meanings are respected here as tradition. No study has tested 528 Hz repairing DNA in people: one lab study exposed cells in a dish. No study of 963 Hz and the pineal gland was found.',
    technical: 'Science Feedback (2022) on the origin. Akimoto et al. 2018: 9 adults, piano music labelled 528 Hz (tuned to A = 444): a small study that hasn’t been repeated. Babayi & Riazi 2017: cultured astrocytes only. No systematic review exists.',
    refs: [
      { cite: 'Science Feedback (2022). No evidence to support claim that solfeggio frequencies remove toxins from the body.', url: 'https://science.feedback.org/review/no-evidence-support-claim-solfeggio-frequencies-remove-toxins-from-body/' },
    ],
  },
  {
    id: 'schumann', title: 'The Schumann resonance', tags: ['tier1', 'open'],
    plain: 'The Schumann resonances are real: electromagnetic waves around the Earth, near 8, 14 and 20 Hz. They are not sound, and no study has tested listening to tones at that rate.',
    technical: 'Price 2016 (Atmosphere): ELF waves from lightning in the Earth–ionosphere cavity. Health links rest on hypothesis papers and a small observational study.',
    refs: [{ cite: 'Price C (2016). ELF electromagnetic waves from lightning: the Schumann resonances. Atmosphere 7(9):116.', url: 'https://doi.org/10.3390/atmos7090116' }],
  },
  {
    id: 'phi', title: 'The golden ratio', tags: ['arithmetic', 'open'],
    plain: 'The golden ratio (φ, about 1.618) is arithmetic. That music or tones in golden-ratio proportions sound better is untested; which notes sound pleasing together follows simple whole-number ratios.',
    technical: 'Markowsky 1992 on golden-ratio misconceptions; McDermott et al. 2010: consonance preference tracks harmonicity (n > 250).',
    refs: [
      { cite: 'Markowsky G (1992). Misconceptions about the golden ratio. College Mathematics Journal 23(1):2–19.', url: 'https://doi.org/10.1080/07468342.1992.11973428' },
      { cite: 'McDermott JH, Lehr AJ, Oxenham AJ (2010). Individual differences reveal the basis of consonance. Current Biology 20(11):1035–1041.', url: 'https://doi.org/10.1016/j.cub.2010.04.019' },
    ],
  },
  {
    id: 'drone', title: 'The drone and low sound', tags: ['design', 'tier3'],
    plain: 'The drone is a design choice: a quiet low tone for headphones, with rests. Vibration therapy uses body-contact speakers, not headphones, and its studies are few. A drone too quiet to hear is not felt either.',
    technical: 'Kantor et al. 2022 (BMJ Open), a scoping review of vibroacoustic therapy: 20 studies, too varied to say what helps. Møller & Pedersen 2004: below the hearing threshold, low sound is not felt.',
    refs: [
      { cite: 'Kantor J, et al. (2022). Exploring vibroacoustic therapy in adults experiencing pain: a scoping review. BMJ Open 12(4):e046591.', url: 'https://doi.org/10.1136/bmjopen-2020-046591' },
      { cite: 'Møller H, Pedersen CS (2004). Hearing at low and infrasonic frequencies. Noise & Health 6(23):37–57.', url: 'https://pubmed.ncbi.nlm.nih.gov/15273023/' },
    ],
  },
  {
    id: 'meditation', title: 'Meditation and sound baths', tags: ['tier1', 'tier3'],
    plain: 'Structured meditation programmes help anxiety and low mood a little, no more than other active treatments such as exercise. Sound baths and singing bowls have only a few small studies.',
    technical: 'Goyal et al. 2014 (JAMA Intern Med): 47 trials, anxiety 0.38, depression 0.30. Stanhope & Weinstein 2020: singing bowls, 4 studies.',
    refs: [
      { cite: 'Goyal M, et al. (2014). Meditation programs for psychological stress and well-being. JAMA Internal Medicine 174(3):357–368.', url: 'https://doi.org/10.1001/jamainternmed.2013.13018' },
      { cite: 'Stanhope J, Weinstein P (2020). The human health effects of singing bowls: a systematic review. Complementary Therapies in Medicine 51:102412.', url: 'https://doi.org/10.1016/j.ctim.2020.102412' },
    ],
  },
];

/** The refs a tier rests on (the technical view's "Sources" under each tier): those of the topics carrying it. */
export function refsForTier(t: Tier): Ref[] {
  const seen = new Set<string>();
  const out: Ref[] = [];
  for (const topic of TOPICS) {
    if (!topic.tags.includes(t)) continue;
    for (const r of topic.refs) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      out.push(r);
    }
  }
  return out;
}

/** The section's fixed words. HOW_SURE_WORDS explains the copy rule, so it names the words it rules out; check:copy
 *  allows it by its allow-list entry (kind 'guide'). */
export const HOW_SURE_TITLE = 'How sure are we?';
export const HOW_SURE_INTRO = 'Aetheria brings together music, mathematics and old traditions. Some of what it says is arithmetic you can check, some is well studied, and some is tradition or an open question. Claims in the Guide and the app’s panels carry one of these tags; tap a tag to come here.';
export const HOW_SURE_TECH_INTRO = 'Technical view: each tier lists the reviews and studies it rests on, with links. We use systematic reviews and meta-analyses where they exist, and say so where they don’t.';
export const HOW_SURE_IN_AETHERIA = 'In Aetheria';
export const HOW_SURE_SOURCES = 'Sources';
export const HOW_SURE_RESEARCH = 'What research says';
export const HOW_SURE_WORDS_TITLE = 'The words we use';
export const HOW_SURE_WORDS = 'We don’t say a sound heals, cures, repairs DNA or activates the pineal gland. Where a tradition teaches that, we write “Traditionally associated with …” and tag it Tradition. Nothing in Aetheria is a treatment; for a health concern, see a qualified professional.';
export const HOW_SURE_FOOTER = 'Reviewed October 2026. Know a good study we missed? Aetheria432@pm.me';
/** The text button at the top of each Guide view (and classic's Guidebook header). */
export const HOW_SURE_JUMP = 'How sure are we?';
/** Classic's Safety panel button; the new layout's Safety & comfort row and its line. */
export const HOW_SURE_SAFETY_BUTTON = 'How sure are we? What the evidence says';
export const HOW_SURE_ROW_LINE = 'What’s arithmetic, what’s studied, what’s tradition';
/** The new layout's chip above the section after a tag's tap: "Back to Crystal". */
export function backToLabel(origin: string): string {
  return `Back to ${origin}`;
}
