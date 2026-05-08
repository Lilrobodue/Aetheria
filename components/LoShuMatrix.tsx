import React, { useState, useMemo } from 'react';
import { Calculator, Sparkles, CheckCircle2, AlertCircle, Box, Volume2, ArrowUpCircle, Layers, Wind } from 'lucide-react';
import { LO_SHU_WALK_INFO, type LoShuWalkMode } from '../constants';
import { frequencyToSpectrumColor, type FrequencyColorMode } from '../utils/spectrumColor';

// Standard Lo Shu position layout:
//   4  9  2
//   3  5  7
//   8  1  6
// Every row, column, and diagonal sums to 15.
const LO_SHU_POSITIONS: number[] = [4, 9, 2, 3, 5, 7, 8, 1, 6];

// Digit root colors (per LoShu.md design guidelines)
const ROOT_COLOR: Record<number, string> = {
  3: '#50d480', // green — Structure
  6: '#d4a050', // gold — Harmony
  9: '#a050d4', // purple — Completion
};

const ROOT_LABEL: Record<number, string> = {
  3: 'Structure',
  6: 'Harmony',
  9: 'Completion',
};

const digitRoot = (n: number): number => {
  if (n === 0) return 0;
  const r = n % 9;
  return r === 0 ? 9 : r;
};

interface RegimeDef {
  key: 'GUT' | 'HEART' | 'HEAD';
  label: string;
  accent: string; // tailwind text class for headings
  border: string;
  glow: string;
  intervalNote: string;
  freqs: number[];
  names: string[];
}

const SOLFEGGIO_GUT: RegimeDef = {
  key: 'GUT',
  label: 'GUT — Solfeggio Scale',
  accent: 'text-red-400',
  border: 'border-red-500/30',
  glow: 'from-red-900/20 to-slate-900/30',
  intervalNote: 'Interval irregular (avg 99) — 7/8 lines = 1665',
  freqs: [174, 285, 396, 417, 528, 639, 741, 852, 963],
  names: [
    'Foundation', 'Tissue Repair', 'Liberating Fear',
    'Facilitating Change', 'Transformation', 'Connecting Relationships',
    'Awakening Intuition', 'Spiritual Order', 'Divine Consciousness',
  ],
};

const PERFECT_GUT: RegimeDef = {
  key: 'GUT',
  label: 'GUT — Lo Shu Perfect (theoretical)',
  accent: 'text-emerald-400',
  border: 'border-emerald-500/30',
  glow: 'from-emerald-900/20 to-slate-900/30',
  intervalNote: 'Interval 111 — 8/8 lines = 1557 (perfect magic square)',
  freqs: [75, 186, 297, 408, 519, 630, 741, 852, 963],
  names: [
    'Foundation+', 'Tissue Repair+', 'Liberating Fear+',
    'Facilitating Change+', 'Transformation+', 'Connecting Relationships+',
    'Awakening Intuition', 'Spiritual Order', 'Divine Consciousness',
  ],
};

const HEART: RegimeDef = {
  key: 'HEART',
  label: 'HEART — 243 Hz Steady',
  accent: 'text-amber-400',
  border: 'border-amber-500/30',
  glow: 'from-amber-900/20 to-slate-900/30',
  intervalNote: 'Interval 243 = 3⁵ — 8/8 lines = 6534 (perfect, all roots = 9)',
  freqs: [1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150],
  names: [
    'Gateway Integration', 'Harmonic Bridging', 'Unified Field Access',
    'Emotional Alchemy', 'Compassion Activation', 'Heart Coherence',
    'Relational Harmony', 'Soul Connection', 'Heart Completion',
  ],
};

const HEAD: RegimeDef = {
  key: 'HEAD',
  label: 'HEAD — 354 Hz Steady',
  accent: 'text-blue-400',
  border: 'border-blue-500/30',
  glow: 'from-blue-900/20 to-slate-900/30',
  intervalNote: 'Interval 354 — 8/8 lines = 14760 (perfect magic square)',
  freqs: [3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336],
  names: [
    'Mental Clarity', 'Sacred Geometry', 'Consciousness Mastery',
    'Soul Star Connection', 'Expressive Truth', 'Universal Mind Access',
    'Galactic Consciousness', 'Divine Source Portal', 'SOURCE Embodiment',
  ],
};

interface MagicAnalysis {
  rows: number[];
  cols: number[];
  diags: number[]; // [\, /]
  expected: number;
  perfect: boolean;
  perfectCount: number;
}

const analyze = (freqs: number[]): MagicAnalysis => {
  // Map by Lo Shu position (1..9). cell[row][col] = freqs[position - 1]
  const at = (pos: number) => freqs[pos - 1];
  // Layout:
  //   4 9 2
  //   3 5 7
  //   8 1 6
  const rows = [
    at(4) + at(9) + at(2),
    at(3) + at(5) + at(7),
    at(8) + at(1) + at(6),
  ];
  const cols = [
    at(4) + at(3) + at(8),
    at(9) + at(5) + at(1),
    at(2) + at(7) + at(6),
  ];
  const diags = [
    at(4) + at(5) + at(6), // top-left to bottom-right
    at(2) + at(5) + at(8), // top-right to bottom-left
  ];
  // The "expected" magic constant is the most common sum.
  const all = [...rows, ...cols, ...diags];
  const counts = new Map<number, number>();
  all.forEach(v => counts.set(v, (counts.get(v) ?? 0) + 1));
  let expected = all[0];
  let max = 0;
  counts.forEach((c, v) => { if (c > max) { max = c; expected = v; } });
  const perfectCount = all.filter(v => v === expected).length;
  return { rows, cols, diags, expected, perfect: perfectCount === 8, perfectCount };
};

interface CellProps {
  freq: number;
  position: number;
  name: string;
  selected?: boolean;
  onSelect?: (hz: number) => void;
  colorMode?: FrequencyColorMode;
}

const Cell: React.FC<CellProps> = ({ freq, position, name, selected, onSelect, colorMode }) => {
  const root = digitRoot(freq);
  const color = colorMode === 'spectrum'
    ? frequencyToSpectrumColor(freq)
    : (ROOT_COLOR[root] ?? '#888');
  const clickable = !!onSelect;
  const baseClasses =
    'relative aspect-square flex flex-col items-center justify-center rounded-lg border bg-black/40 transition-transform';
  const interactiveClasses = clickable
    ? 'cursor-pointer hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black'
    : '';
  const selectedRing = selected ? 'ring-2 ring-offset-2 ring-offset-black' : '';

  const handleClick = () => onSelect?.(freq);
  const handleKey = (e: React.KeyboardEvent) => {
    if (!clickable) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(freq);
    }
  };

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? handleClick : undefined}
      onKeyDown={clickable ? handleKey : undefined}
      title={
        clickable
          ? `Play ${freq} Hz — ${name} (root ${root})`
          : `${name} — root ${root} (${ROOT_LABEL[root]})`
      }
      className={`${baseClasses} ${interactiveClasses} ${selectedRing}`}
      style={{
        borderColor: selected ? color : `${color}55`,
        boxShadow: selected
          ? `inset 0 0 18px ${color}55, 0 0 12px ${color}66`
          : `inset 0 0 14px ${color}22`,
        // Use any-cast for custom property (TS doesn't model --tw-ring-color well via inline style)
        ['--tw-ring-color' as any]: color,
      }}
    >
      <span className="absolute top-1 left-1.5 text-[9px] text-slate-500 font-mono">{position}</span>
      <span
        className="absolute top-1 right-1.5 text-[9px] font-mono font-bold"
        style={{ color }}
      >
        {root}
      </span>
      <div className="text-base sm:text-lg font-bold font-mono" style={{ color }}>
        {freq}
      </div>
      <div className="text-[9px] text-slate-400 mt-0.5">Hz</div>
    </div>
  );
};

interface RegimeBlockProps {
  regime: RegimeDef;
  currentFrequency?: number;
  onSelectFrequency?: (hz: number) => void;
  colorMode?: FrequencyColorMode;
}

const RegimeBlock: React.FC<RegimeBlockProps> = ({ regime, currentFrequency, onSelectFrequency, colorMode }) => {
  const analysis = useMemo(() => analyze(regime.freqs), [regime.freqs]);
  const { rows, cols, diags, expected, perfect, perfectCount } = analysis;

  const isLine = (sum: number) => sum === expected;

  return (
    <div className={`bg-gradient-to-br ${regime.glow} border ${regime.border} rounded-xl p-5`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h4 className={`text-lg font-bold ${regime.accent}`}>{regime.label}</h4>
          <p className="text-xs text-slate-400 mt-1">{regime.intervalNote}</p>
        </div>
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono ${
          perfect
            ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
            : 'bg-orange-500/10 text-orange-300 border border-orange-500/30'
        }`}>
          {perfect ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
          {perfectCount}/8
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
        {/* 3x3 grid with column sums underneath */}
        <div>
          <div className="grid grid-cols-3 gap-1.5">
            {LO_SHU_POSITIONS.map((pos, i) => {
              const freq = regime.freqs[pos - 1];
              return (
                <Cell
                  key={i}
                  freq={freq}
                  position={pos}
                  name={regime.names[pos - 1]}
                  selected={currentFrequency === freq}
                  onSelect={onSelectFrequency}
                  colorMode={colorMode}
                />
              );
            })}
          </div>
          {/* Column sums */}
          <div className="grid grid-cols-3 gap-1.5 mt-1.5">
            {cols.map((s, i) => (
              <div
                key={i}
                className={`text-center text-[11px] font-mono py-1 rounded ${
                  isLine(s)
                    ? 'text-emerald-300 bg-emerald-500/5'
                    : 'text-orange-300 bg-orange-500/5'
                }`}
              >
                {s.toLocaleString()}
              </div>
            ))}
          </div>
        </div>

        {/* Row sums + diagonals beside the grid */}
        <div className="flex flex-col gap-1.5 pt-0">
          {rows.map((s, i) => (
            <div
              key={i}
              className={`aspect-square min-w-[56px] flex items-center justify-center text-[11px] font-mono rounded ${
                isLine(s)
                  ? 'text-emerald-300 bg-emerald-500/5'
                  : 'text-orange-300 bg-orange-500/5'
              }`}
            >
              {s.toLocaleString()}
            </div>
          ))}
        </div>
      </div>

      {/* Diagonals */}
      <div className="grid grid-cols-2 gap-2 mt-3 text-[11px] font-mono">
        <div className={`flex items-center justify-between px-2 py-1 rounded ${
          isLine(diags[0]) ? 'text-emerald-300 bg-emerald-500/5' : 'text-orange-300 bg-orange-500/5'
        }`}>
          <span className="text-slate-500">↘ diag</span>
          <span>{diags[0].toLocaleString()}</span>
        </div>
        <div className={`flex items-center justify-between px-2 py-1 rounded ${
          isLine(diags[1]) ? 'text-emerald-300 bg-emerald-500/5' : 'text-orange-300 bg-orange-500/5'
        }`}>
          <span className="text-slate-500">↙ diag</span>
          <span>{diags[1].toLocaleString()}</span>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-slate-500 font-mono text-center">
        magic constant = <span className="text-slate-300">{expected.toLocaleString()}</span>
        {!perfect && (
          <span className="text-orange-400/80">
            {' '}· deviation {Math.abs(diags[0] - expected) || Math.abs(diags[1] - expected)}
          </span>
        )}
      </div>
    </div>
  );
};

interface LoShuMatrixProps {
  /** When provided, clicking any cell calls this with the cell's frequency in Hz. */
  onSelectFrequency?: (hz: number) => void;
  /** Currently playing/selected frequency — highlights the matching cell if any. */
  currentFrequency?: number;
  /** Controlled value for the "Lo Shu Perfect GUT" toggle. If omitted, the component manages it internally. */
  loShuPerfectGUT?: boolean;
  /** Setter for the controlled toggle. Required when `loShuPerfectGUT` is provided to mean anything more than display. */
  onLoShuPerfectChange?: (enabled: boolean) => void;
  /** When provided, clicking a walk button starts that 27-track Lo Shu walk in the player. */
  onStartWalk?: (mode: LoShuWalkMode) => void;
  /** Currently active walk mode (if any). Highlights the matching button. */
  activeWalkMode?: LoShuWalkMode | null;
  /** Frequency colour palette: 'chakra' (Solfeggio) or 'spectrum' (visible-light). */
  colorMode?: FrequencyColorMode;
  /** Setter for the colour-mode toggle inside the matrix. Render an inline
   *  toggle when provided so the Guidebook can switch palettes in context. */
  onColorModeChange?: (mode: FrequencyColorMode) => void;
}

// The matrix only surfaces the three Lo Shu walks (A/B/C). The
// 'traditional' mode is rendered by the existing GUT Alignment button
// elsewhere, so we type these maps narrowly to the visible subset.
type MatrixWalkMode = Exclude<LoShuWalkMode, 'traditional'>;

const WALK_ICONS: Record<MatrixWalkMode, React.ComponentType<{ size?: number; className?: string }>> = {
  A: ArrowUpCircle,
  B: Layers,
  C: Wind,
};

const WALK_ACCENTS: Record<MatrixWalkMode, { active: string; idle: string; icon: string }> = {
  A: {
    active: 'bg-amber-500/20 border-amber-500/60 text-amber-200 shadow-lg shadow-amber-500/20',
    idle: 'bg-slate-900 border-slate-700 text-slate-300 hover:border-amber-500/40 hover:text-amber-300',
    icon: 'text-amber-400',
  },
  B: {
    active: 'bg-emerald-500/20 border-emerald-500/60 text-emerald-200 shadow-lg shadow-emerald-500/20',
    idle: 'bg-slate-900 border-slate-700 text-slate-300 hover:border-emerald-500/40 hover:text-emerald-300',
    icon: 'text-emerald-400',
  },
  C: {
    active: 'bg-purple-500/20 border-purple-500/60 text-purple-200 shadow-lg shadow-purple-500/20',
    idle: 'bg-slate-900 border-slate-700 text-slate-300 hover:border-purple-500/40 hover:text-purple-300',
    icon: 'text-purple-400',
  },
};

const LoShuMatrix: React.FC<LoShuMatrixProps> = ({
  onSelectFrequency,
  currentFrequency,
  loShuPerfectGUT,
  onLoShuPerfectChange,
  onStartWalk,
  activeWalkMode,
  colorMode,
  onColorModeChange,
}) => {
  const [internalShowPerfect, setInternalShowPerfect] = useState(false);
  const isControlled = loShuPerfectGUT !== undefined;
  const showPerfect = isControlled ? !!loShuPerfectGUT : internalShowPerfect;
  const setShowPerfect = (next: boolean) => {
    if (!isControlled) setInternalShowPerfect(next);
    onLoShuPerfectChange?.(next);
  };
  const gut = showPerfect ? PERFECT_GUT : SOLFEGGIO_GUT;
  const affectsPlayback = !!onLoShuPerfectChange; // toggle is wired to global state
  const cellsClickable = !!onSelectFrequency;

  return (
    <section className="bg-gradient-to-r from-slate-900/50 to-slate-800/30 border border-purple-500/30 rounded-2xl p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-purple-500/20 rounded-full border border-purple-500/30">
          <Box className="text-purple-400" size={28} />
        </div>
        <div>
          <h3 className="text-2xl sm:text-3xl font-bold text-purple-300 font-serif">
            The Lo Shu Cube — 洛書
          </h3>
          <p className="text-xs sm:text-sm text-purple-400/80 uppercase tracking-widest mt-1">
            Three magic squares stacked into a 3×3×3 architecture
          </p>
        </div>
      </div>

      {/* Intro */}
      <div className="mb-6 p-5 bg-slate-950/40 border border-slate-700 rounded-xl">
        <p className="text-sm text-slate-300 leading-relaxed">
          The 27 Aetheria frequencies map onto three Lo Shu magic squares — one per regime.
          The standard Lo Shu layout places nine numbers so every row, column, and diagonal
          sums to the same magic constant. Drop the nine frequencies of each regime into the
          same positional template and the geometry holds: HEART and HEAD form{' '}
          <span className="text-emerald-300 font-bold">perfect magic squares</span>;
          the traditional Solfeggio GUT comes within one diagonal of perfection,
          off by 81 (= 9²).
        </p>
      </div>

      {/* Position template + GUT toggle */}
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 mb-6 items-start">
        <div className="bg-black/40 border border-slate-700 rounded-xl p-4">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 text-center">
            Lo Shu Template
          </div>
          <div className="grid grid-cols-3 gap-1.5 w-[140px]">
            {LO_SHU_POSITIONS.map((pos, i) => (
              <div
                key={i}
                className="aspect-square flex items-center justify-center bg-slate-900 border border-slate-700 rounded-md text-purple-300 font-mono font-bold"
              >
                {pos}
              </div>
            ))}
          </div>
          <div className="text-[10px] text-slate-500 text-center mt-2 font-mono">
            every line = 15
          </div>
        </div>

        <div className="bg-slate-950/40 border border-slate-700 rounded-xl p-4 text-xs text-slate-300 leading-relaxed">
          <p>
            <span className="text-purple-300 font-bold">Reading the grids:</span>{' '}
            small number top-left is the Lo Shu position (1–9); colored digit top-right is
            the digit root of the frequency.
            {colorMode === 'spectrum' ? (
              <>
                {' '}Cells are tinted by the colour each frequency would have if octave-shifted into{' '}
                <span className="text-cyan-300 font-bold">visible light</span>{' '}
                (174 Hz → infrared edge, 528 Hz → green, 6336 Hz → violet).
              </>
            ) : (
              <>
                {' '}Cells are tinted by digit root —{' '}
                <span style={{ color: ROOT_COLOR[3] }}>green = 3 (Structure)</span>,{' '}
                <span style={{ color: ROOT_COLOR[6] }}>gold = 6 (Harmony)</span>,{' '}
                <span style={{ color: ROOT_COLOR[9] }}>purple = 9 (Completion)</span>.
              </>
            )}
            {' '}Sums in green match the regime's magic constant; orange flags a deviation.
          </p>

          {/* Frequency colour palette toggle — chakra digit-root vs visible-light spectrum. */}
          {onColorModeChange && (
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <span className="text-slate-500">Cell colours:</span>
              <button
                onClick={() => onColorModeChange('chakra')}
                className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                  colorMode !== 'spectrum'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
                title="Original chakra/digit-root palette"
              >
                Chakra (original)
              </button>
              <button
                onClick={() => onColorModeChange('spectrum')}
                className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                  colorMode === 'spectrum'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
                title="Tint cells by the colour each frequency would have as visible light"
              >
                Spectrum (visible light)
              </button>
            </div>
          )}
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <span className="text-slate-500">GUT regime:</span>
            <button
              onClick={() => setShowPerfect(false)}
              className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                !showPerfect
                  ? 'bg-red-500/20 text-red-300 border-red-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
            >
              Solfeggio (174–963)
            </button>
            <button
              onClick={() => setShowPerfect(true)}
              className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                showPerfect
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
            >
              Lo Shu Perfect (75–963)
            </button>
            {affectsPlayback && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border uppercase tracking-wider ${
                  showPerfect
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-900 text-slate-500 border-slate-700'
                }`}
                title="When ON, GUT-band frequencies (174,285,396,417,528,639) play at the Lo Shu Perfect counterparts (75,186,297,408,519,630). 741/852/963 are exact matches in both."
              >
                <Volume2 size={10} />
                {showPerfect ? 'affecting playback' : 'affects playback'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Lo Shu Walks — 27-track playlist orderings */}
      {onStartWalk && (
        <div className="mb-6 p-5 bg-gradient-to-br from-purple-900/15 via-slate-900/40 to-slate-900/40 border border-purple-500/30 rounded-xl">
          <div className="flex items-center gap-3 mb-3">
            <Sparkles className="text-purple-300" size={18} />
            <h4 className="text-base font-bold text-purple-200 uppercase tracking-wider">Lo Shu Walks</h4>
            {activeWalkMode && (
              <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-purple-500/20 text-purple-200 border border-purple-500/40 uppercase tracking-wider">
                Active · {LO_SHU_WALK_INFO[activeWalkMode].shortName}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-300 leading-relaxed mb-4">
            Three 27-track journeys built from the standard Lo Shu magic square. Each walk traces a distinct
            path through the GUT (174–963 Hz), HEART (1206–3150 Hz), and HEAD (3504–6336 Hz) regimes.
            Pick a walk and the player assembles a playlist by matching each frequency to the closest song
            in your library — positions with no match are skipped.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(['A', 'B', 'C'] as MatrixWalkMode[]).map(mode => {
              const info = LO_SHU_WALK_INFO[mode];
              const Icon = WALK_ICONS[mode];
              const accent = WALK_ACCENTS[mode];
              const isActive = activeWalkMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onStartWalk(mode)}
                  className={`text-left p-4 rounded-lg border transition-all active:scale-[0.98] ${
                    isActive ? accent.active : accent.idle
                  }`}
                  title={info.philosophy}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={18} className={accent.icon} />
                    <div className="font-bold text-sm">{info.fullName}</div>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mb-2">{info.tagline}</div>
                  <div className="text-[11px] text-slate-300/80 leading-relaxed">
                    {info.philosophy}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 text-[10px] text-slate-500 italic">
            Walks need analyzed songs across the regime ranges. Run Deep Scan first if your library is unprocessed.
          </div>
        </div>
      )}

      {/* Three regime grids */}
      {cellsClickable && (
        <div className="mb-3 flex items-center gap-2 text-[11px] text-slate-400">
          <Volume2 size={12} className="text-purple-300" />
          Click any cell to set the playing frequency.
        </div>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <RegimeBlock regime={gut} currentFrequency={currentFrequency} onSelectFrequency={onSelectFrequency} colorMode={colorMode} />
        <RegimeBlock regime={HEART} currentFrequency={currentFrequency} onSelectFrequency={onSelectFrequency} colorMode={colorMode} />
        <RegimeBlock regime={HEAD} currentFrequency={currentFrequency} onSelectFrequency={onSelectFrequency} colorMode={colorMode} />
      </div>

      {/* Interval architecture */}
      <div className="mt-8 p-6 bg-slate-950/50 border border-slate-700 rounded-xl">
        <h4 className="text-lg font-bold text-cyan-400 mb-4 flex items-center gap-2 uppercase tracking-wider">
          <Calculator className="text-cyan-500" size={20} />
          Interval Architecture
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
            <div className="text-xs text-red-300 uppercase tracking-wider mb-1">GUT</div>
            <div className="font-mono text-2xl text-red-200">111</div>
            <div className="text-[11px] text-slate-400 mt-1">root 3 · Structure</div>
          </div>
          <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-4">
            <div className="text-xs text-amber-300 uppercase tracking-wider mb-1">HEART</div>
            <div className="font-mono text-2xl text-amber-200">243 = 3⁵</div>
            <div className="text-[11px] text-slate-400 mt-1">root 9 · Completion</div>
          </div>
          <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
            <div className="text-xs text-blue-300 uppercase tracking-wider mb-1">HEAD</div>
            <div className="font-mono text-2xl text-blue-200">354</div>
            <div className="text-[11px] text-slate-400 mt-1">root 3 · Structure</div>
          </div>
        </div>

        <div className="bg-black/40 border border-slate-700 rounded-lg p-4 font-mono text-sm text-center text-slate-200">
          <div className="text-purple-300 mb-1">111 + 243 = 354</div>
          <div className="text-slate-500 text-xs">HEAD interval = GUT + HEART</div>
          <div className="mt-3 text-purple-300">root(3) + root(9) + root(3) = 15</div>
          <div className="text-slate-500 text-xs">= the Lo Shu magic constant itself</div>
        </div>
      </div>

      {/* Cube center axis */}
      <div className="mt-6 p-6 bg-gradient-to-r from-amber-900/10 via-purple-900/20 to-amber-900/10 border border-purple-500/30 rounded-xl">
        <h4 className="text-lg font-bold text-purple-300 mb-3 flex items-center gap-2 uppercase tracking-wider">
          <Sparkles className="text-purple-400" size={20} />
          The Cube Center
        </h4>
        <p className="text-sm text-slate-300 mb-4 leading-relaxed">
          Stack the three squares vertically and the center cells form an axis through the cube.
          Position 5 of HEART — <span className="text-purple-300 font-bold">2178 Hz Compassion Activation</span> —
          sits at the geometric center of the entire system.
        </p>
        <div className="flex items-center justify-center gap-3 sm:gap-6 font-mono">
          <div className="flex flex-col items-center">
            <div className="px-3 py-2 rounded-lg border border-blue-500/40 bg-blue-500/10 text-blue-200">4920</div>
            <div className="text-[10px] text-slate-500 mt-1">HEAD · root 6</div>
          </div>
          <div className="text-slate-600">↑</div>
          <div className="flex flex-col items-center">
            <div className="px-3 py-2 rounded-lg border border-purple-500/40 bg-purple-500/10 text-purple-200 font-bold text-lg">2178</div>
            <div className="text-[10px] text-slate-500 mt-1">HEART · root 9</div>
          </div>
          <div className="text-slate-600">↑</div>
          <div className="flex flex-col items-center">
            <div className="px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200">528</div>
            <div className="text-[10px] text-slate-500 mt-1">GUT · root 6</div>
          </div>
        </div>
        <div className="text-center text-xs text-slate-500 mt-3 italic">
          Harmony → Completion → Harmony
        </div>
      </div>

      {/* Solfeggio offset analysis */}
      <div className="mt-6 p-6 bg-slate-950/50 border border-slate-700 rounded-xl">
        <h4 className="text-lg font-bold text-emerald-400 mb-3 uppercase tracking-wider">
          Why the Solfeggio GUT isn't perfect
        </h4>
        <p className="text-sm text-slate-300 mb-4 leading-relaxed">
          The Solfeggio scale is the perfect 111-interval Lo Shu sequence with three structured
          offsets. Each offset is a multiple of 9 — preserving every digit root.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-slate-500 border-b border-slate-700">
              <tr>
                <th className="text-left py-2 pr-3">Position</th>
                <th className="text-left py-2 pr-3">Lo Shu Perfect</th>
                <th className="text-left py-2 pr-3">Solfeggio</th>
                <th className="text-left py-2 pr-3">Offset</th>
                <th className="text-left py-2">Note</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {[
                { pos: 1, perf: 75, sol: 174, offset: '+99', note: '9 × 11' },
                { pos: 2, perf: 186, sol: 285, offset: '+99', note: '9 × 11' },
                { pos: 3, perf: 297, sol: 396, offset: '+99', note: '9 × 11' },
                { pos: 4, perf: 408, sol: 417, offset: '+9', note: '9 × 1' },
                { pos: 5, perf: 519, sol: 528, offset: '+9', note: '9 × 1' },
                { pos: 6, perf: 630, sol: 639, offset: '+9', note: '9 × 1' },
                { pos: 7, perf: 741, sol: 741, offset: '0', note: 'exact match' },
                { pos: 8, perf: 852, sol: 852, offset: '0', note: 'exact match' },
                { pos: 9, perf: 963, sol: 963, offset: '0', note: 'exact match' },
              ].map(row => (
                <tr key={row.pos} className="border-b border-slate-800/50">
                  <td className="py-1.5 pr-3 text-slate-500">{row.pos}</td>
                  <td className="py-1.5 pr-3 text-emerald-300">{row.perf}</td>
                  <td className="py-1.5 pr-3 text-red-300">{row.sol}</td>
                  <td className="py-1.5 pr-3 text-slate-300">{row.offset}</td>
                  <td className="py-1.5 text-slate-500">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 text-[11px] text-slate-500 italic text-center border-t border-slate-800 pt-4">
        Lo Shu analysis by Claude (Anthropic) in collaboration with Joseph Lewis — 2026
      </div>
    </section>
  );
};

export default LoShuMatrix;
