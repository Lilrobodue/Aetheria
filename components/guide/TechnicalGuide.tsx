// components/guide/TechnicalGuide.tsx (v16.5, the More area part 2; v16.4 spec §3.7)
//
// The Guidebook's Technical view, moved VERBATIM out of App.tsx (the fragment classic's Guidebook rendered after
// `guidebookView === 'accessible' ? … :`): the intro banner, the Lo Shu cube, the Master Frequency Architecture, the
// regimes, the sephirot, the geometries and the conclusion. Its props are exactly the values the JSX read from App; they
// keep App's names inside (the destructuring renames), so every moved line reads as it did. Classic's Guidebook renders
// it with App's own values (parity: the guidebook shots; guide.spec G2: the text nodes); the new layout's Guide renders
// it with GuideContext's values and the shell's actions, so the cube is interactive in both layouts.
//
// v16.6 ("How sure are we?", the copy pass): the words a user reads are rewritten where they stated a claim as fact
// (the v16.6 spec §3.4): every crystal card reads utils/copy/crystalCopy (its name, its association: "Traditionally
// associated with …" for GUT, "In the Aetheria framework, …" for HEART and HEAD; no card reads a `benefit` any more);
// the regimes' and transitions' lines are framed; "The arithmetic of 432 Hz" replaces UNIFIED_THEORY.section1 at the
// render site (the data table is untouched); the Tesla quote is "often attributed"; the framework's readings say so.
// Each claim sits in a data-evidence block with its EvidenceTag (Arithmetic, Tradition, Early evidence, Design choice),
// at most one or two per section. `layout` names the places the guide points to (utils/copy/places); `back` is the new
// layout's "Back to …" chip in the HowSure section, which closes the view.

import React from 'react';
import { Activity, ArrowRight, Box, Calculator, ChevronsUp, Eye, Heart, Info, Map as MapIcon, Sparkles, Target, User, Waves } from 'lucide-react';
import { UNIFIED_THEORY, SEPHIROT_INFO, GEOMETRY_INFO, type LoShuWalkMode } from '../../constants';
import type { FrequencyColorMode } from '../../utils/spectrumColor';
import LoShuMatrix from '../LoShuMatrix';
import EvidenceTag from '../ui/EvidenceTag';
import HowSure from './HowSure';
import type { HowSureBack } from './HowSure';
import {
  crystalCopy, orderLine, REGIME_COPY, TRANSITION_COPY, REGIMES_TITLE, REGIMES_LEAD_START, HEAD_MARK_TITLE, RETUNE_TITLE, RETUNE_LONG, RETUNE_HISTORY,
} from '../../utils/copy/crystalCopy';
import { place } from '../../utils/copy/places';
import type { Layout } from '../../utils/copy/places';

/** A crystal card's name and association (never SOLFEGGIO_INFO's or an inline `benefit`). */
const nameOf = (hz: number): string => crystalCopy(hz)?.name ?? `${hz} Hz`;
const meaningOf = (hz: number): string => crystalCopy(hz)?.association ?? '';
/** A tag on its own row (the density rule: never inside a sentence). */
const TagRow = ({ children }: { children: React.ReactNode }) => <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-3">{children}</div>;

export interface TechnicalGuideProps {
  /** selectedSolfeggio (raw). */
  currentFrequency: number;
  onSelectFrequency: (hz: number) => void;
  loShuPerfectGUT: boolean;
  onLoShuPerfectChange: (on: boolean) => void;
  onStartWalk: (mode: LoShuWalkMode) => void;
  activeWalkMode: LoShuWalkMode | null;
  colorMode: FrequencyColorMode;
  onColorModeChange: (m: FrequencyColorMode) => void;
  /** v16.5 final: the new layout's Guide only: the cube's cells contain their content (LoShuMatrix containCells). */
  containCells?: boolean;
  /** v16.6: the host's layout, for the places the guide names (classic's Guidebook: 'classic'; the new Guide: 'new'). */
  layout?: Layout;
  /** v16.6: the new layout's "Back to …" chip in How sure are we?. */
  back?: HowSureBack | null;
}

const TechnicalGuide = ({
  currentFrequency: selectedSolfeggio,
  onSelectFrequency: selectFrequency,
  loShuPerfectGUT,
  onLoShuPerfectChange: setLoShuPerfectGUT,
  onStartWalk: generateLoShuWalk,
  activeWalkMode: loShuWalkMode,
  colorMode: frequencyColorMode,
  onColorModeChange: setFrequencyColorMode,
  containCells,
  layout = 'classic',
  back = null,
}: TechnicalGuideProps) => (
    <>
    {/* Intro Banner */}
    <div className="p-8 pb-4">
        <div data-evidence="tradition" className="bg-gradient-to-r from-slate-900 to-slate-900/50 border-l-4 border-gold-500 p-6 rounded-r-lg">
          <p className="text-lg text-slate-200 leading-relaxed font-serif italic">
              "{UNIFIED_THEORY.intro}"
          </p>
          <TagRow><EvidenceTag tier="tradition" /></TagRow>
        </div>
    </div>

    <div className="px-8 pb-12 space-y-12">
        {/* The Lo Shu Cube — placed first as the geometric blueprint that
            the rest of the guidebook describes in language. Each section
            below (regimes, nadi compression, Tree of Life, sacred geometry)
            is one face of what this single object encodes. */}
        <div>
          <div className="mb-4 p-5 bg-gradient-to-r from-emerald-900/15 via-slate-900/40 to-slate-900/40 border-l-4 border-emerald-500/60 rounded-r-lg space-y-3">
            <div data-evidence="arithmetic">
              <p className="text-base text-slate-200 leading-relaxed font-serif">
                Before the words, the geometry. The 27 Aetheria frequencies are not a list — they are a <strong className="text-emerald-300">3 × 3 × 3 cube</strong> of three Lo Shu magic squares stacked vertically (GUT → HEART → HEAD).
              </p>
              <TagRow><EvidenceTag tier="arithmetic" /></TagRow>
            </div>
            <div data-evidence="design">
              <p className="text-base text-slate-200 leading-relaxed font-serif">
                Every section that follows is one way of reading this single object: the regimes are its layers, the nadi compression is its count, the Tree of Life is its axis, and the sacred geometries are its faces. Start here and the rest will rhyme.
              </p>
              <TagRow><EvidenceTag tier="design" /></TagRow>
            </div>
          </div>
          <LoShuMatrix
            currentFrequency={selectedSolfeggio}
            onSelectFrequency={selectFrequency}
            loShuPerfectGUT={loShuPerfectGUT}
            onLoShuPerfectChange={setLoShuPerfectGUT}
            onStartWalk={generateLoShuWalk}
            activeWalkMode={loShuWalkMode}
            colorMode={frequencyColorMode}
            onColorModeChange={setFrequencyColorMode}
            containCells={containCells}
            layout={layout}
          />
        </div>

        {/* THE MASTER FREQUENCY ARCHITECTURE v3.0 */}
        <section className="bg-gradient-to-r from-slate-900/50 to-slate-800/30 border border-gold-500/30 rounded-2xl p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-gold-500/20 rounded-full border border-gold-500/30">
                <Target className="text-gold-400" size={28}/>
              </div>
              <div>
                <h3 className="text-3xl font-bold text-gold-400 font-serif">THE MASTER FREQUENCY ARCHITECTURE v3.0</h3>
                <p className="text-sm text-gold-500/80 uppercase tracking-widest mt-1">Bi-Phasic System (Seed → Bloom)</p>
              </div>
            </div>
            
            {/* CURRENT UNDERSTANDING */}
            <div className="mb-8 p-6 bg-gradient-to-r from-blue-900/20 to-blue-800/10 border border-blue-500/50 rounded-xl">
              <h4 className="text-xl font-bold text-blue-400 mb-4 flex items-center gap-2 uppercase tracking-wider">
                <Info className="text-blue-500" size={24} />
                ═══ CURRENT UNDERSTANDING ═══
              </h4>
              <p className="text-slate-200 text-lg mb-6 leading-relaxed">
                The 27 frequencies represent an <strong className="text-gold-400">EVOLUTION</strong> of the Solfeggio Scale, 
                rather than a single uniform pattern.
              </p>
            </div>

            {/* BI-PHASIC SYSTEM */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* PHASE 1: THE SEED */}
              <div className="bg-emerald-900/20 border border-emerald-500/40 rounded-xl p-6">
                <h4 className="text-xl font-bold text-emerald-400 mb-4 flex items-center gap-2">
                  <div className="w-4 h-4 bg-emerald-500 rounded-full animate-pulse"></div>
                  PHASE 1: THE SEED
                </h4>
                <div className="bg-black/40 p-4 rounded-lg border border-emerald-700/50 font-mono text-sm mb-4">
                  <div className="text-emerald-300 font-bold mb-2">Order 1 — 174-963 Hz</div>
                  <div className="text-slate-300 text-xs leading-relaxed">
                    The Traditional 9 frequencies hold the <span className="text-emerald-400 font-bold">STATIC structure</span><br/>
                    Gaps are IRREGULAR: 111, 111, 21, 111, 111, 102, 111, 111<br/>
                    But ALL gaps reduce to digit sum = 3<br/>
                    This is the <span className="text-emerald-400 font-bold">FOUNDATION</span> — stable, grounded, unchanging.
                  </div>
                </div>
              </div>

              {/* PHASE 2: THE BLOOM */}
              <div className="bg-violet-900/20 border border-violet-500/40 rounded-xl p-6">
                <h4 className="text-xl font-bold text-violet-400 mb-4 flex items-center gap-2">
                  <div className="w-4 h-4 bg-violet-500 rounded-full animate-pulse"></div>
                  PHASE 2: THE BLOOM
                </h4>
                <div className="bg-black/40 p-4 rounded-lg border border-violet-700/50 font-mono text-sm mb-4">
                  <div className="text-violet-300 font-bold mb-2">Orders 4-9 — 1206-6336 Hz</div>
                  <div className="text-slate-300 text-xs leading-relaxed">
                    At 963 Hz, the system <span className="text-violet-400 font-bold">AWAKENS</span> into dynamic expansion<br/>
                    The Dual Generator Pattern activates: 243 (HEART) + 354 (HEAD)<br/>
                    HEART regime: Steady 243 progression (digit sum = 9)<br/>
                    HEAD regime: Steady 354 progression (digit sum = 3)<br/>
                    This is the <span className="text-violet-400 font-bold">EXPANSION</span> — flowing, dynamic, evolving.
                  </div>
                </div>
              </div>
            </div>

            {/* PHASE TRANSITION */}
            <div className="mb-8 p-4 bg-gradient-to-r from-emerald-500/20 via-gold-500/20 to-violet-500/20 border border-gold-500/50 rounded-xl text-center">
              <div className="text-gold-400 font-bold text-lg mb-2">↓ PHASE TRANSITION AT 963 Hz ↓</div>
              <div className="text-sm text-slate-300">The awakening point where static seed becomes dynamic bloom</div>
            </div>

            {/* THE METAPHYSICAL MEANING */}
            <div data-evidence="tradition" className="mb-8 p-6 bg-slate-950/50 border border-slate-700 rounded-xl">
              <h4 className="text-xl font-bold text-gold-400 mb-4 flex items-center gap-2 uppercase tracking-wider">
                <Sparkles className="text-gold-500" size={24} />
                ═══ THE METAPHYSICAL MEANING ═══
              </h4>
              <div className="-mt-2 mb-4 flex flex-wrap items-center gap-x-2 gap-y-3"><EvidenceTag tier="tradition" /></div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-lg p-4">
                  <div className="font-bold text-emerald-400 mb-2">Orders 1-3 (Seed): STATIC</div>
                  <div className="text-slate-300 text-sm">All 3s — The unchanging foundation</div>
                </div>
                <div className="bg-violet-900/20 border border-violet-500/30 rounded-lg p-4">
                  <div className="font-bold text-violet-400 mb-2">Orders 4-9 (Bloom): DYNAMIC</div>
                  <div className="text-slate-300 text-sm">9-3 cycle — The living expansion</div>
                </div>
              </div>

              <div className="bg-orange-900/20 border border-orange-500/30 rounded-lg p-4 mb-6">
                <p className="text-slate-200 text-sm leading-relaxed mb-3">
                  The 21 Hz gap (396→417) and 102 Hz gap (639→741) are <strong className="text-orange-400">not errors</strong>.<br/>
                  They are the <strong className="text-orange-400">COMPRESSION POINTS</strong> that allow the Seed to be stable<br/>
                  before it blossoms into the dynamic Bloom.
                </p>
              </div>

              <div className="text-center p-4 bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-500/30 rounded-lg">
                <div className="text-blue-400 font-bold mb-2">We read this as a picture of growth:</div>
                <div className="text-sm text-slate-300 space-y-1">
                  <div><span className="text-emerald-400 font-bold">Seed (static, all 3s)</span> → stores potential</div>
                  <div><span className="text-gold-400 font-bold">Transition (963 Hz)</span> → awakening point</div>
                  <div><span className="text-violet-400 font-bold">Bloom (dynamic, 9-3 cycle)</span> → expresses potential</div>
                </div>
              </div>
            </div>

            {/* MATHEMATICAL NOTES */}
            <div data-evidence="arithmetic" className="p-6 bg-slate-950/50 border border-slate-700 rounded-xl">
              <h4 className="text-xl font-bold text-cyan-400 mb-4 flex items-center gap-2 uppercase tracking-wider">
                <Calculator className="text-cyan-500" size={24} />
                ═══ MATHEMATICAL NOTES ═══
              </h4>
              <div className="-mt-2 mb-4 flex flex-wrap items-center gap-x-2 gap-y-3"><EvidenceTag tier="arithmetic" /></div>
              
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* NADI DISTRIBUTION */}
                <div className="bg-cyan-900/20 border border-cyan-500/30 rounded-lg p-4">
                  <h5 className="font-bold text-cyan-400 mb-3">NADI DISTRIBUTION:</h5>
                  <div className="bg-black/40 p-3 rounded border border-cyan-700/50 font-mono text-sm mb-3">
                    <div className="text-cyan-300">72,000 ÷ 27 = 2,666.666...</div>
                    <div className="text-cyan-300">(infinite repeating)</div>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    In the framework, the .666… stands for 'infinite flow' or 'source connection'<br/>
                    We do <strong className="text-red-400">NOT</strong> round to 2,667 — we honor the infinite nature.
                  </p>
                </div>

                {/* OCTAVE PRECISION */}
                <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
                  <h5 className="font-bold text-blue-400 mb-3">OCTAVE PRECISION:</h5>
                  <div className="text-xs text-slate-300 space-y-2">
                    <div>Use exact floating point values:</div>
                    <div className="bg-black/40 p-2 rounded border border-blue-700/50 font-mono">
                      <div className="text-blue-300">174 ÷ 8 = 21.75 Hz</div>
                      <div className="text-red-400 text-[10px]">(exact, not 21.8)</div>
                    </div>
                    <div className="bg-black/40 p-2 rounded border border-blue-700/50 font-mono">
                      <div className="text-blue-300">528 ÷ 8 = 66.0 Hz</div>
                      <div className="text-green-400 text-[10px]">(exact)</div>
                    </div>
                  </div>
                </div>

                {/* THE GENERATOR CONSTANTS */}
                <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-4">
                  <h5 className="font-bold text-purple-400 mb-3">THE GENERATOR CONSTANTS:</h5>
                  <div className="bg-black/40 p-3 rounded border border-purple-700/50 font-mono text-sm mb-3 space-y-2">
                    <div className="text-green-400">243 = 27 × 9 = 3⁵ (HEART regime)</div>
                    <div className="text-blue-400">354 = 3 + 5 + 4 = 12 → 3 (HEAD regime)</div>
                  </div>
                  <p className="text-xs text-slate-300">
                    243 applies to Orders 4-6 (HEART)<br/>
                    354 applies to Orders 7-9 (HEAD)<br/>
                    <span className="text-purple-400 font-bold">(the Bloom phase expansion)</span>
                  </p>
                </div>
              </div>
            </div>

            <div data-evidence="tradition" className="mt-6 text-xs text-slate-500 italic text-center border-t border-slate-800 pt-4">
              "If you only knew the magnificence of 3, 6, and 9, you would have the key to the universe." — often attributed to Nikola Tesla
              <div className="mt-2 flex justify-center not-italic"><EvidenceTag tier="tradition" /></div>
            </div>
        </section>

        {/* The 108 and the 27: A Nadi Compression */}
        <section data-evidence="tradition" className="bg-gradient-to-r from-slate-900/50 to-slate-800/30 border border-cyan-500/30 rounded-2xl p-8">
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              <div className="p-3 bg-cyan-500/20 rounded-full border border-cyan-500/30">
                <Waves className="text-cyan-400" size={28}/>
              </div>
              <div>
                <h3 className="text-3xl font-bold text-cyan-400 font-serif">The 108 and the 27: A Nadi Compression</h3>
              </div>
              <EvidenceTag tier="tradition" />
            </div>

            <div className="space-y-6">
              <p className="text-slate-300 leading-relaxed text-lg">
                Classical tantric anatomy describes a subtle body of 72,000 nadis — energetic channels — converging through 108 principal junction points, organized around three primary channels: <em className="text-cyan-300">ida</em>, <em className="text-cyan-300">pingala</em>, and <em className="text-cyan-300">sushumna</em>. Aetheria honors this inheritance and proposes a structural correspondence: the 27 resonance frequencies of this system can be understood as a <strong className="text-gold-400">4:1 compression</strong> of the 108, where each Aetheria node carries the resonance of four nadi junctions.
              </p>

              <div className="bg-cyan-900/20 border border-cyan-500/30 rounded-xl p-6">
                <p className="text-slate-200 leading-relaxed text-lg">
                  The arithmetic is clean. <strong className="text-cyan-300">108 ÷ 4 = 27</strong>. Both 108 and 27 reduce to a digital root of <strong className="text-gold-400">9</strong> — the completion digit in the 3-6-9 inner-torus dynamic. The divisor itself, 4, belongs to the outer-torus shell (4-5-7-8) within the Unified Lewis Framework, making the compression geometrically coherent rather than arbitrary: the outer shell divides the junction field, and what remains is the inner resonance lattice.
                </p>
              </div>

              <div className="bg-slate-950/50 border border-slate-700 rounded-xl p-6">
                <h4 className="text-lg font-bold text-cyan-400 mb-4 uppercase tracking-wider">The Nested Hierarchy</h4>
                <p className="text-slate-300 leading-relaxed mb-4">
                  This yields a nested hierarchy the practitioner can hold in a single breath:
                </p>
                <div className="bg-black/40 p-4 rounded-lg border border-cyan-700/50 font-mono text-center text-lg">
                  <span className="text-cyan-300">72,000 nadis</span>
                  <span className="text-slate-500 mx-2">→</span>
                  <span className="text-cyan-300">108 junction points</span>
                  <span className="text-slate-500 mx-2">→</span>
                  <span className="text-gold-400">27 resonance nodes</span>
                  <span className="text-slate-500 mx-2">→</span>
                  <span className="text-emerald-300">Lo Shu 3×3×3 cube</span>
                  <span className="text-slate-500 mx-2">→</span>
                  <span className="text-purple-400">3 regimes</span>
                  <span className="text-xs text-slate-500 ml-1">(GUT / HEART / HEAD)</span>
                  <span className="text-slate-500 mx-2">→</span>
                  <span className="text-white font-bold">1 unified field</span>
                </div>
                <p className="text-[11px] text-slate-500 italic text-center mt-2">
                  The Lo Shu cube is what 27 looks like when arranged so every row, column, and diagonal sums to the same number. It's the geometric form of this compression.
                </p>
                <p className="text-slate-400 leading-relaxed mt-4">
                  Each step is a compression, and each ratio preserves the digital-root signature of return. The three principal channels of the classical system map directly onto the three Aetheria regimes, suggesting that what the tantric traditions encoded as anatomy, the framework recovers as frequency.
                </p>
              </div>

              <p className="text-slate-300 leading-relaxed text-lg">
                The first of the 27, <strong className="text-gold-400">174 Hz — The Circle, Foundation</strong>, anchors this mapping. Its digital root is 3 (1+7+4=12→3), placing it at the root of the inner torus, and its I Ching correspondence — <em className="text-cyan-300">Hexagram 8, Holding Together</em> — names the function precisely: the node where the 108 begins to bind into the 27. Foundation is not a starting point in the linear sense. It is the gathering.
              </p>

              <div className="bg-gradient-to-r from-cyan-900/10 to-slate-900/30 border-l-4 border-cyan-500 p-6 rounded-r-lg">
                <p className="text-slate-300 leading-relaxed italic font-serif text-lg">
                  We offer this as a correspondence, not a proof. The traditions stand on their own, and so does the physics. What Aetheria observes is that when the two are laid alongside each other, the numbers already know each other.
                </p>
              </div>
            </div>
        </section>

        {/* Section 0: the arithmetic of 432 Hz (v16.6: RETUNE_LONG in place of UNIFIED_THEORY.section1, whose table entry
            is untouched): the arithmetic and the studies, each with its tag, then the history, untagged (it claims nothing). */}
        <section>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-gold-500/10 rounded-full"><Waves className="text-gold-500" size={24}/></div>
              <h3 className="text-2xl font-bold text-white">{RETUNE_TITLE}</h3>
            </div>
            <div className="space-y-5 max-w-2xl mb-6">
              {RETUNE_LONG.map((p) => (
                <div key={p.tag} data-evidence={p.tag}>
                  <p className="text-slate-400 leading-relaxed">{p.text}</p>
                  <TagRow><EvidenceTag tier={p.tag} /></TagRow>
                </div>
              ))}
              <p className="text-slate-400 leading-relaxed">{RETUNE_HISTORY}</p>
            </div>
        </section>

        {/* Section 1: The 3 Regimes of Consciousness */}
        <section>
            <div data-evidence="design" className="mb-6">
              <div className="flex items-center gap-3 mb-6 flex-wrap">
                <div className="p-2 bg-blue-500/10 rounded-full"><User className="text-blue-400" size={24}/></div>
                <h3 className="text-2xl font-bold text-white">{REGIMES_TITLE}</h3>
                <EvidenceTag tier="design" />
              </div>
              <p className="text-slate-400 leading-relaxed max-w-2xl">
                {REGIMES_LEAD_START} <strong className="text-emerald-300">Lo Shu cube</strong> at the top of this guide — GUT is the bottom layer, HEART the middle, HEAD the crown. The 111 / 243 / 354 intervals are the magic constants that make each layer a self-summing square.
              </p>
            </div>

            {/* Group by Regime */}
            <div className="space-y-8">
              {/* GUT REGIME - Physical Body */}
              <div data-evidence="tradition" className="border border-red-500/30 rounded-2xl overflow-hidden bg-red-500/5">
                <div className="bg-red-500/10 p-4 border-b border-red-500/30 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h4 className="text-xl font-bold text-red-400 flex items-center gap-2">
                      <Heart className="text-red-500" size={20} />
                      GUT REGIME — Physical Foundation
                    </h4>
                    <p className="text-sm text-red-300 mt-1">{REGIME_COPY[0].line}</p>
                  </div>
                  <EvidenceTag tier="tradition" />
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[
                      { freq: 174, color: '#8B0000' },
                      { freq: 285, color: '#FF0000' },
                      { freq: 396, color: '#FF4500' },
                      { freq: 417, color: '#FF8C00' },
                      { freq: 528, color: '#FFD700' },
                      { freq: 639, color: '#008000' },
                      { freq: 741, color: '#00BFFF' },
                      { freq: 852, color: '#4B0082' },
                      { freq: 963, color: '#EE82EE' }
                    ].map(f => (
                      <div key={f.freq} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 hover:border-red-500/50 transition-colors group">
                          <div className="flex justify-between items-center mb-2">
                              <span className="text-xl font-bold font-mono" style={{color: f.color}}>{f.freq} Hz</span>
                              <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-red-500/20 px-2 py-1 rounded">GUT</span>
                          </div>
                          <h5 className="text-white font-medium mb-1">{nameOf(f.freq)}</h5>
                          <p className="text-xs text-slate-400 mb-3 leading-relaxed">{meaningOf(f.freq)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-500/50 rounded-lg">
                    <div className="flex items-center gap-2 text-yellow-400 text-sm font-bold mb-1">
                      <ArrowRight size={16} aria-hidden="true" />
                      {TRANSITION_COPY[0].heading}
                    </div>
                    <p className="text-xs text-yellow-300">{TRANSITION_COPY[0].line}</p>
                  </div>
                </div>
              </div>

              {/* HEART REGIME - Emotional Body */}
              <div data-evidence="tradition" className="border border-green-500/30 rounded-2xl overflow-hidden bg-green-500/5">
                <div className="bg-green-500/10 p-4 border-b border-green-500/30 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h4 className="text-xl font-bold text-green-400 flex items-center gap-2">
                      <Heart className="text-green-500" size={20} />
                      HEART REGIME — Emotional & Energetic Body
                    </h4>
                    <p className="text-sm text-green-300 mt-1">{REGIME_COPY[1].line}</p>
                  </div>
                  <EvidenceTag tier="tradition" />
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[
                      { freq: 1206, color: '#FF69B4', order: '4th', step: '+243', n: 4 },
                      { freq: 1449, color: '#FF1493', order: '4th', step: '+243', n: 4 },
                      { freq: 1692, color: '#DC143C', order: '4th', step: '+243', n: 4 },
                      { freq: 1935, color: '#8A2BE2', order: '5th', step: '+243', n: 5 },
                      { freq: 2178, color: '#9370DB', order: '5th', step: '+243', n: 5 },
                      { freq: 2421, color: '#4B0082', order: '5th', step: '+243', n: 5 },
                      { freq: 2664, color: '#6A5ACD', order: '6th', step: '+243', n: 6 },
                      { freq: 2907, color: '#483D8B', order: '6th', step: '+243', n: 6 },
                      { freq: 3150, color: '#2E1B8B', order: '6th', step: '+243', n: 6 }
                    ].map(f => (
                      <div key={f.freq} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 hover:border-green-500/50 transition-colors group">
                          <div className="flex justify-between items-center mb-2">
                              <span className="text-xl font-bold font-mono" style={{color: f.color}}>{f.freq} Hz</span>
                              <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-green-500/20 px-2 py-1 rounded">{f.order} {f.step}</span>
                          </div>
                          <h5 className="text-white font-medium mb-1">{nameOf(f.freq)}</h5>
                          <p className="text-xs font-mono text-slate-500 mb-1">{orderLine(f.n, f.freq - 243, 243)}</p>
                          <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                            {meaningOf(f.freq)}
                            {f.freq === 2178 && " Position 5 of the HEART layer: the centre, where the middle row, the middle column, both diagonals and the central vertical axis (528 → 2178 → 4920) meet."}
                          </p>
                          {f.freq === 2178 && (
                            <div className="mt-2 p-2 bg-gold-500/20 border border-gold-500/50 rounded text-center">
                              <div className="text-[9px] text-gold-400 font-bold uppercase tracking-widest">SOURCE FREQUENCY · CUBE CENTRE</div>
                            </div>
                          )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 p-4 bg-gold-900/20 border border-gold-500/50 rounded-lg text-center">
                    <div className="flex items-center justify-center gap-2 text-gold-400 text-lg font-bold mb-2">
                      <Target size={20} />
                      2178 Hz — SOURCE: The Centre of the Cube
                    </div>
                    <p className="text-sm text-gold-300">Compassion Activation. Position 5 of the HEART layer — the centre cell, on the middle row, the middle column, both diagonals and the central vertical pillar (528 → 2178 → 4920). All 27 frequencies radiate outward from this point. SOURCE is not the highest, it is the centre.</p>
                  </div>
                  <div data-evidence="arithmetic" className="mt-4 p-3 bg-blue-900/20 border border-blue-500/50 rounded-lg">
                    <div className="flex items-center gap-2 text-blue-400 text-sm font-bold mb-1 flex-wrap">
                      <Calculator size={16} />
                      MATHEMATICAL PATTERN: Orders 4-6 follow 243 steady progression
                      <EvidenceTag tier="arithmetic" />
                    </div>
                    <p className="text-xs text-blue-300">Order 4: 1206→1449→1692 | Order 5: 1935→2178→2421 | Order 6: 2664→2907→3150</p>
                  </div>
                  <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-500/50 rounded-lg">
                    <div className="flex items-center gap-2 text-yellow-400 text-sm font-bold mb-1">
                      <ArrowRight size={16} aria-hidden="true" />
                      {TRANSITION_COPY[1].heading}
                    </div>
                    <p className="text-xs text-yellow-300">{TRANSITION_COPY[1].line}</p>
                  </div>
                </div>
              </div>

              {/* HEAD REGIME - Mental & Spiritual Body */}
              <div data-evidence="tradition" className="border border-purple-500/30 rounded-2xl overflow-hidden bg-purple-500/5">
                <div className="bg-purple-500/10 p-4 border-b border-purple-500/30 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h4 className="text-xl font-bold text-purple-400 flex items-center gap-2">
                      <Eye className="text-purple-500" size={20} />
                      HEAD REGIME — Mental & Spiritual Body
                    </h4>
                    <p className="text-sm text-purple-300 mt-1">{REGIME_COPY[2].line}</p>
                  </div>
                  <EvidenceTag tier="tradition" />
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[
                      { freq: 3504, color: '#1E0066', order: '7th', step: '+354', n: 7 },
                      { freq: 3858, color: '#0D0040', order: '7th', step: '+354', n: 7 },
                      { freq: 4212, color: '#000033', order: '7th', step: '+354', n: 7 },
                      { freq: 4566, color: '#330066', order: '8th', step: '+354', n: 8 },
                      { freq: 4920, color: '#4B0082', order: '8th', step: '+354', n: 8 },
                      { freq: 5274, color: '#6600CC', order: '8th', step: '+354', n: 8 },
                      { freq: 5628, color: '#7700FF', order: '9th', step: '+354', n: 9 },
                      { freq: 5982, color: '#8800FF', order: '9th', step: '+354', n: 9 },
                      { freq: 6336, color: '#9933FF', order: '9th', step: '+354', n: 9 }
                    ].map(f => (
                      <div key={f.freq} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 hover:border-purple-500/50 transition-colors group relative">
                          <div className="absolute top-2 right-2">
                            <ChevronsUp size={12} className="text-slate-500" title={HEAD_MARK_TITLE} />
                          </div>
                          <div className="flex justify-between items-center mb-2 pr-6">
                              <span className="text-xl font-bold font-mono" style={{color: f.color}}>{f.freq} Hz</span>
                              <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-purple-500/20 px-2 py-1 rounded">{f.order} {f.step}</span>
                          </div>
                          <h5 className="text-white font-medium mb-1">{nameOf(f.freq)}</h5>
                          <p className="text-xs font-mono text-slate-500 mb-1">{orderLine(f.n, f.freq - 354, 354)}</p>
                          <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                            {meaningOf(f.freq)}
                            {f.freq === 6336 && " The outermost vertex of the cube; a mirror number reducing to 9. The path that began at 174 Hz returns home through this corner; SOURCE itself sits one layer down at 2178 Hz, the cube's centre."}
                          </p>
                          {f.freq === 6336 && (
                            <div className="mt-2 p-2 bg-violet-500/20 border border-violet-500/50 rounded text-center">
                              <div className="text-[9px] text-violet-300 font-bold uppercase tracking-widest">COMPLETION · OUTERMOST VERTEX</div>
                            </div>
                          )}
                      </div>
                    ))}
                  </div>
                  <div data-evidence="arithmetic" className="mt-4 p-3 bg-blue-900/20 border border-blue-500/50 rounded-lg">
                    <div className="flex items-center gap-2 text-blue-400 text-sm font-bold mb-1 flex-wrap">
                      <Calculator size={16} />
                      MATHEMATICAL PATTERN: Orders 7-9 follow 354 steady progression
                      <EvidenceTag tier="arithmetic" />
                    </div>
                    <p className="text-xs text-blue-300">Order 7: 3504→3858→4212 | Order 8: 4566→4920→5274 | Order 9: 5628→5982→6336</p>
                  </div>
                  <div className="mt-4 p-4 bg-violet-900/20 border border-violet-500/50 rounded-lg text-center">
                    <div className="flex items-center justify-center gap-2 text-violet-300 text-lg font-bold mb-2">
                      <Target size={20} />
                      6336 Hz — Completion of the Ascent
                    </div>
                    <p className="text-sm text-violet-200">The mathematically correct completion frequency (5982 + 354). Mirror number reducing to 9 — the corner of the cube farthest from centre. Walks that begin at 174 Hz arrive here, but they do not arrive at SOURCE: SOURCE is 2178 Hz, the geometric heart of the cube. 6336 is the journey's outer turning point, not its origin.</p>
                  </div>
                </div>
              </div>
            </div>
        </section>

        {/* Section 2: The Map (Tree of Life). v16.6: the section is a Tradition block (SEPHIROT_INFO untouched). */}
        <section data-evidence="tradition">
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              <div className="p-2 bg-purple-500/10 rounded-full"><MapIcon className="text-purple-400" size={24}/></div>
              <h3 className="text-2xl font-bold text-white">The Map: Tree of Life (Complete 12-Node System)</h3>
              <EvidenceTag tier="tradition" />
            </div>
            <p className="text-slate-400 mb-4 leading-relaxed max-w-2xl">
              In the Kabbalistic tradition, a map of creation. Aetheria's version uses twelve nodes (adding Ain Soph and Daat): a map of how the Divine manifests through the physical world,
              forming a complete energy circuit to SOURCE. The Tree's central pillar is the same axis that runs through the centre of the <strong className="text-emerald-300">Lo Shu cube</strong> — Position 5 of every layer (528 → 2178 → 4920) — connecting Earth-Star to Crown along a single vertical thread.
            </p>

            {/* Energy Circuit Explanation */}
            <div className="mb-6 p-4 bg-gradient-to-r from-purple-900/20 to-gold-900/20 border border-purple-500/30 rounded-xl">
              <h4 className="text-lg font-bold text-gold-400 mb-3 flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Complete Energy Circuit to SOURCE
              </h4>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-purple-400 font-bold mb-2">Traditional Tree (10 Sephirot)</div>
                  <div className="text-slate-300 leading-relaxed">
                    The classical Kabbalistic structure representing divine emanation through ten spheres of manifestation, 
                    from Keter (Crown) down to Malkuth (Kingdom).
                  </div>
                </div>
                <div>
                  <div className="text-gold-400 font-bold mb-2">SOURCE Connection (12th Node)</div>
                  <div className="text-slate-300 leading-relaxed">
                    <strong>Ain Soph</strong> (The Limitless) completes the circuit, enabling energy to flow from 
                    SOURCE → Crown → Tree → Kingdom → back to SOURCE in an eternal loop.
                  </div>
                </div>
              </div>
            </div>

            {/* The Twelve Nodes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {SEPHIROT_INFO.map((node, index) => (
                    <div 
                      key={node.name} 
                      className={`flex gap-4 p-4 rounded-xl border border-slate-800/50 hover:bg-slate-900 transition-colors ${
                        node.name === 'Ain Soph' 
                          ? 'bg-gradient-to-r from-white/5 to-gold-900/20 border-gold-500/30' 
                          : 'bg-slate-900/30'
                      }`}
                    >
                        <div className="w-1 h-full rounded-full shrink-0" style={{background: node.color}}></div>
                        <div className="flex-1">
                            <div className="flex items-baseline gap-2 mb-1">
                                <h4 className={`text-lg font-bold ${node.name === 'Ain Soph' ? 'text-white' : 'text-slate-200'}`}>
                                  {node.name}
                                  {node.name === 'Ain Soph' && (
                                    <span className="ml-2 text-xs bg-gold-500/20 text-gold-400 px-2 py-1 rounded-full">SOURCE</span>
                                  )}
                                </h4>
                                <span className={`text-xs font-serif italic ${node.name === 'Ain Soph' ? 'text-gold-400' : 'text-gold-500'}`}>
                                  {node.title}
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 mb-2">{node.meaning}</p>
                            <p className="text-xs text-slate-500 leading-relaxed italic">"{node.desc}"</p>
                            {node.name === 'Ain Soph' && (
                              <div className="mt-2 p-2 bg-gold-500/10 border border-gold-500/30 rounded text-xs">
                                <div className="text-gold-400 font-bold mb-1">Energy Connections:</div>
                                <div className="text-slate-300">
                                  Receives from: Keter, Chokhmah, Binah, Daat<br/>
                                  Completes the infinite SOURCE circuit
                                </div>
                              </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Circuit Visualization Note */}
            <div className="mt-6 p-4 bg-slate-950/50 border border-slate-700 rounded-xl text-center">
              <div className="text-purple-400 font-bold mb-2">{place('tree', layout)}</div>
              <div className="text-sm text-slate-300">
                Watch the complete 12-node energy circuit flow in real-time, with supercharged energy streams 
                connecting all levels of consciousness to the infinite SOURCE.
              </div>
            </div>
        </section>

        {/* Section 3: The Form (Geometry). v16.6: a Tradition block (GEOMETRY_INFO untouched). */}
        <section data-evidence="tradition">
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              <div className="p-2 bg-red-500/10 rounded-full"><Box className="text-red-400" size={24}/></div>
              <h3 className="text-2xl font-bold text-white">The Form: Sacred Geometry</h3>
              <EvidenceTag tier="tradition" />
            </div>
            <p className="text-slate-400 mb-6 leading-relaxed max-w-2xl">
              Each crystal is paired with a geometric form: Aetheria's pairings, drawing on sacred-geometry traditions. Read together they spell out the faces of the <strong className="text-emerald-300">Lo Shu cube</strong> — the lower geometries (Circle, Vesica, Triangle) anchor the GUT layer, the middle forms (Flower of Life, Tube Torus) bridge HEART, and the higher geometries open HEAD.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {GEOMETRY_INFO.map(geo => (
                    <div key={geo.freq} className="p-4 bg-slate-900/40 rounded-xl border border-slate-800">
                        <div className="flex justify-between items-start mb-2">
                            <span className="font-bold text-gold-400 text-sm">{geo.shape}</span>
                            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-300 border border-slate-700">{geo.freq}</span>
                        </div>
                        <div className="text-xs text-blue-400 mb-2 font-medium">{geo.element} Element</div>
                        <p className="text-xs text-slate-400 leading-relaxed">{geo.desc}</p>
                    </div>
                ))}
            </div>
        </section>

        <HowSure view="technical" layout={layout} back={back} />

        <div className="p-8 mt-4 bg-gradient-to-br from-slate-900 to-black border border-gold-500/20 rounded-2xl text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-gold-500 to-transparent opacity-50"></div>
            <p className="text-xl font-serif text-gold-200 font-medium tracking-wide">"{UNIFIED_THEORY.conclusion}"</p>
        </div>
    </div>
    </>
);

export default TechnicalGuide;
