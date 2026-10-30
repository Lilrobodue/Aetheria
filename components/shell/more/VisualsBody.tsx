// components/shell/more/VisualsBody.tsx (v16.4, the Visuals sheet's body; decision 1 A)
//
// Every classic visual setting (App's Visualization Engine) and the crystal palette (classic's Lo Shu popover "Colour
// Mode"), in five cards under Layers' sticky jump row (Look · Hexes · Overlays · Motion · Comfort), with classic's
// words in sentence case. Each control calls the setting classic's own control sets, with the same value
// (actions.setViz: setVizSettings(prev => ({ ...prev, ...patch })); actions.setPalette), so both layouts show one state.
// hexWander and frameRate are written only by their own tap (unset means On / Standard).
//
// One scroll, its own (the sheet's body holds still): the jump row stays on top. The cards are React.memo with plain
// props and every handler is stable, so a change re-renders its own card and control, never the other four, and nothing
// here reads the clock. Sliders write through VizSlider's throttle (the 30 fps cap).

import React, { useMemo, useRef } from 'react';
import { Activity as PulseIcon, ArrowUpCircle, RotateCw, Waves, Wind } from 'lucide-react';
import Toggle from '../../ui/Toggle';
import Select from '../../ui/Select';
import ChoiceGroup from '../../ui/ChoiceGroup';
import { useActions, useVisuals } from '../contexts';
import { countRender } from '../devRenders';
import JumpRow from '../layers/JumpRow';
import SectionCard from '../layers/SectionCard';
import VizSlider from './VizSlider';
import {
  COLOR_MODES,
  DENSITIES,
  FRAME_RATES,
  FRAME_RATE_HINT,
  HEX_MODES,
  PALETTES,
  PALETTE_DESCRIPTION,
  PATHS,
  PATH_ILLUMINATION,
  PATH_ILLUMINATION_LINE,
  PAUSE_VISUALS_LABEL,
  PAUSE_VISUALS_RECORDING,
  VISUALS_PREFIX,
  VISUALS_SECTIONS,
  comfortStatus,
  cubeLine,
  frameRateOf,
  hexesStatus,
  lookStatus,
  motionStatus,
  opacityText,
  overlaysStatus,
  pauseVisualsLine,
  positionText,
  reactivityText,
  rippleText,
  sacredGeometryLine,
  sizeText,
  speedText,
  wanderLine,
} from './visualsModel';
import type { ColorMode, Density, FrameRate, HexMode, Palette, PathKey } from './visualsModel';

const P = VISUALS_PREFIX;

// ---------------------------------------------------------------------------------------------------------------
// Look: the hex mode, the visualizer's colours, the crystal palette
// ---------------------------------------------------------------------------------------------------------------

const LookCard = React.memo(({ hexVisualMode, colorMode, palette }: { hexVisualMode: string; colorMode: string; palette: Palette }) => {
  countRender('VisualsLook');
  const actions = useActions();
  const colourOptions = useMemo(() => COLOR_MODES.map((m) => ({ id: m.id, label: m.label, pressed: colorMode === m.id, dashed: false })), [colorMode]);
  const paletteOptions = useMemo(() => PALETTES.map((m) => ({ id: m.id, label: m.label, pressed: palette === m.id, dashed: false })), [palette]);
  const colourTitle = (COLOR_MODES.find((m) => m.id === colorMode) ?? COLOR_MODES[0]).title;
  // The pressed colour's line, one element per colour (the group's children: a new element would re-render it).
  const colourNote = useMemo(
    () => (
      <p data-testid="visuals-colour-line" className="text-xs text-ink-muted leading-snug">
        {colourTitle}
      </p>
    ),
    [colourTitle]
  );
  const h = useMemo(
    () => ({
      hexMode: (v: HexMode) => actions.setViz({ hexVisualMode: v }),
      colour: (id: ColorMode) => actions.setViz({ colorMode: id }),
      palette: (id: Palette) => actions.setPalette(id),
    }),
    [actions]
  );
  return (
    <SectionCard prefix={P} section="look" title="Look" status={lookStatus({ hexVisualMode })}>
      <Select
        label="Hex visual mode"
        value={(HEX_MODES.some((m) => m.id === hexVisualMode) ? hexVisualMode : 'spectrum') as HexMode}
        options={HEX_MODES}
        onChange={h.hexMode}
        data-testid="visuals-hex-mode"
      />
      <ChoiceGroup<ColorMode>
        label="Visualizer colours"
        options={colourOptions}
        onChoose={h.colour}
        data-testid="visuals-colour-mode"
      >
        {colourNote}
      </ChoiceGroup>
      <div className="border-t border-line" />
      <ChoiceGroup<Palette>
        label="Crystal colours"
        description={PALETTE_DESCRIPTION}
        options={paletteOptions}
        onChoose={h.palette}
        data-testid="visuals-palette"
      />
    </SectionCard>
  );
});

// ---------------------------------------------------------------------------------------------------------------
// Hexes: the grid, its opacity, Wandering hexes (dimmed, not disabled, while the grid is off)
// ---------------------------------------------------------------------------------------------------------------

const HexesCard = React.memo(
  ({ showHexagons, hexOpacity, wander, reducedMotion }: { showHexagons: boolean; hexOpacity: number; wander: boolean; reducedMotion: boolean }) => {
    countRender('VisualsHexes');
    const actions = useActions();
    const h = useMemo(
      () => ({
        grid: (on: boolean) => actions.setViz({ showHexagons: on }),
        wander: (on: boolean) => actions.setViz({ hexWander: on }),
      }),
      [actions]
    );
    return (
      <SectionCard prefix={P} section="hexes" title="Hexes" status={hexesStatus({ showHexagons, hexWander: wander }, reducedMotion)}>
        <Toggle label="Hex grid" checked={showHexagons} onChange={h.grid} data-testid="visuals-hex-grid" />
        <VizSlider label="Hex opacity" vizKey="hexOpacity" value={hexOpacity} min={0} max={1} step={0.1} format={opacityText} data-testid="visuals-hex-opacity" />
        <div className={showHexagons ? 'transition-opacity duration-fast' : 'opacity-50 transition-opacity duration-fast'} data-testid="visuals-wander-row">
          <Toggle label="Wandering hexes" description={wanderLine(wander, reducedMotion)} checked={wander} onChange={h.wander} data-testid="visuals-wander" />
        </div>
      </SectionCard>
    );
  }
);

// ---------------------------------------------------------------------------------------------------------------
// Overlays: Tree of Life, Sacred Geometry, Astral Trails, Hydro-Acoustics (+ Ripple intensity), the Lo Shu cube (+ its
// rotation and Path Illumination while it is on)
// ---------------------------------------------------------------------------------------------------------------

interface OverlaysProps {
  tree: boolean;
  morph: boolean;
  trails: boolean;
  ripples: boolean;
  hydro: number;
  cube: boolean;
  cubeAuto: boolean;
  cubeRotation: number;
  vortex: boolean;
  ascent: boolean;
  pillar: boolean;
  ouroboros: boolean;
  palette: Palette;
}

const OverlaysCard = React.memo((p: OverlaysProps) => {
  countRender('VisualsOverlays');
  const actions = useActions();
  const h = useMemo(
    () => ({
      tree: (on: boolean) => actions.setViz({ showTreeOfLife: on }),
      morph: (on: boolean) => actions.setViz({ morphEnabled: on }),
      trails: (on: boolean) => actions.setViz({ enableTrails: on }),
      ripples: (on: boolean) => actions.setViz({ showWaterRipples: on }),
      cube: (on: boolean) => actions.setViz({ showLoShuCube: on }),
      cubeAuto: (on: boolean) => actions.setViz({ loShuCubeAutoRotate: on }),
      loShuShowVortex: (on: boolean) => actions.setViz({ loShuShowVortex: on }),
      loShuShowAscent: (on: boolean) => actions.setViz({ loShuShowAscent: on }),
      loShuShowPillar: (on: boolean) => actions.setViz({ loShuShowPillar: on }),
      loShuShowOuroboros: (on: boolean) => actions.setViz({ loShuShowOuroboros: on }),
    }),
    [actions]
  );
  const pathOn: Record<PathKey, boolean> = { loShuShowVortex: p.vortex, loShuShowAscent: p.ascent, loShuShowPillar: p.pillar, loShuShowOuroboros: p.ouroboros };
  return (
    <SectionCard
      prefix={P}
      section="overlays"
      title="Overlays"
      status={overlaysStatus({ showTreeOfLife: p.tree, morphEnabled: p.morph, enableTrails: p.trails, showWaterRipples: p.ripples, showLoShuCube: p.cube })}
    >
      <Toggle label="Tree of Life" checked={p.tree} onChange={h.tree} data-testid="visuals-tree" />
      <Toggle label="Show Sacred Geometry" description={sacredGeometryLine(p.morph)} checked={p.morph} onChange={h.morph} data-testid="visuals-morph" />
      <Toggle label="Astral Trails" checked={p.trails} onChange={h.trails} data-testid="visuals-trails" />
      <Toggle label="Hydro-Acoustics" checked={p.ripples} onChange={h.ripples} data-testid="visuals-hydro" />
      {p.ripples ? (
        <VizSlider label="Ripple intensity" vizKey="hydroIntensity" value={p.hydro} min={0} max={100} step={1} format={rippleText} data-testid="visuals-ripple" />
      ) : null}
      <div className="border-t border-line" />
      <Toggle label="Lo Shu Cube" description={cubeLine(p.cube, p.palette)} checked={p.cube} onChange={h.cube} data-testid="visuals-cube" />
      {p.cube ? (
        <div className="pl-3 border-l border-line space-y-2" data-testid="visuals-cube-rows">
          <Toggle label="Auto-Rotate" checked={p.cubeAuto} onChange={h.cubeAuto} data-testid="visuals-cube-auto" />
          <VizSlider
            label="Position"
            vizKey="loShuCubeRotation"
            value={p.cubeRotation}
            min={0}
            max={360}
            step={1}
            format={positionText}
            disabled={p.cubeAuto}
            data-testid="visuals-cube-position"
          />
          <div className="text-sm text-ink-strong">{PATH_ILLUMINATION}</div>
          <p className="text-xs text-ink-muted leading-snug">{PATH_ILLUMINATION_LINE}</p>
          {PATHS.map((path) => (
            <React.Fragment key={path.key}>
              <Toggle label={path.label} description={path.sub} checked={pathOn[path.key]} onChange={h[path.key]} data-testid={`visuals-path-${path.label.toLowerCase()}`} />
            </React.Fragment>
          ))}
        </div>
      ) : null}
    </SectionCard>
  );
});

// ---------------------------------------------------------------------------------------------------------------
// Motion: speed, reactivity, Rotate · Ascension, the particles' physics, density and size
// ---------------------------------------------------------------------------------------------------------------

interface MotionProps {
  speed: number;
  sensitivity: number;
  autoRotate: boolean;
  ascension: boolean;
  flow: boolean;
  float: boolean;
  pulse: boolean;
  density: string;
  size: number;
}

type RotationId = 'rotate' | 'ascension';
type PhysicsId = 'flow' | 'float' | 'pulse';

const MotionCard = React.memo((p: MotionProps) => {
  countRender('VisualsMotion');
  const actions = useActions();
  const rotation = useMemo(
    () => [
      { id: 'rotate' as RotationId, label: 'Rotate', pressed: p.autoRotate, dashed: false, icon: (cls: string) => <RotateCw size={16} className={cls} aria-hidden="true" /> },
      { id: 'ascension' as RotationId, label: 'Ascension', pressed: p.ascension, dashed: false, icon: (cls: string) => <ArrowUpCircle size={16} className={cls} aria-hidden="true" /> },
    ],
    [p.autoRotate, p.ascension]
  );
  const physics = useMemo(
    () => [
      { id: 'flow' as PhysicsId, label: 'Flow', pressed: p.flow, dashed: false, icon: (cls: string) => <Waves size={16} className={cls} aria-hidden="true" /> },
      { id: 'float' as PhysicsId, label: 'Float', pressed: p.float, dashed: false, icon: (cls: string) => <Wind size={16} className={cls} aria-hidden="true" /> },
      { id: 'pulse' as PhysicsId, label: 'Pulse', pressed: p.pulse, dashed: false, icon: (cls: string) => <PulseIcon size={16} className={cls} aria-hidden="true" /> },
    ],
    [p.flow, p.float, p.pulse]
  );
  const densities = useMemo(() => DENSITIES.map((d) => ({ id: d.id, label: d.label, pressed: p.density === d.id, dashed: false })), [p.density]);
  // Each choice is its own switch (classic's toggles), flipping the value this card last rendered (a ref, so the
  // handlers stay the same functions and the memoised groups skip a render that changed nothing of theirs).
  const latest: { current: MotionProps } = useRef(p);
  latest.current = p;
  const h = useMemo(
    () => ({
      rotation: (id: RotationId) =>
        id === 'rotate' ? actions.setViz({ autoRotate: !latest.current.autoRotate }) : actions.setViz({ invertPerspective: !latest.current.ascension }),
      physics: (id: PhysicsId) =>
        id === 'flow'
          ? actions.setViz({ enableFlow: !latest.current.flow })
          : id === 'float'
            ? actions.setViz({ enableFloat: !latest.current.float })
            : actions.setViz({ enablePulse: !latest.current.pulse }),
      density: (id: Density) => actions.setViz({ particleDensity: id }),
    }),
    [actions]
  );
  return (
    <SectionCard prefix={P} section="motion" title="Motion" status={motionStatus({ speed: p.speed, particleDensity: p.density })}>
      <VizSlider label="Simulation speed" vizKey="speed" value={p.speed} min={0.1} max={3} step={0.1} format={speedText} data-testid="visuals-speed" />
      <VizSlider label="Audio reactivity" vizKey="sensitivity" value={p.sensitivity} min={0.1} max={2} step={0.1} format={reactivityText} data-testid="visuals-reactivity" />
      <ChoiceGroup<RotationId> label="Rotation" options={rotation} onChoose={h.rotation} data-testid="visuals-rotation" />
      <ChoiceGroup<PhysicsId> label="Particle physics (mixable)" options={physics} onChoose={h.physics} columns={3} data-testid="visuals-physics" />
      <ChoiceGroup<Density> label="Particle density" options={densities} onChoose={h.density} columns={3} data-testid="visuals-density" />
      <VizSlider label="Particle size" vizKey="particleBaseSize" value={p.size} min={0.5} max={8} step={0.5} format={sizeText} data-testid="visuals-size" />
    </SectionCard>
  );
});

// ---------------------------------------------------------------------------------------------------------------
// Comfort: Pause visuals, the frame rate
// ---------------------------------------------------------------------------------------------------------------

/** The frame rate's hint, one element for the app's life (a group's children: a new one would re-render it). */
const RATE_HINT = <p className="text-xs text-ink-muted leading-snug">{FRAME_RATE_HINT}</p>;

const ComfortCard = React.memo(
  ({ frameRate, userPaused, pausedNow, visualRecording }: { frameRate: FrameRate; userPaused: boolean; pausedNow: boolean; visualRecording: boolean }) => {
    countRender('VisualsComfort');
    const actions = useActions();
    const rates = useMemo(() => FRAME_RATES.map((r) => ({ id: r.id, label: r.label, pressed: frameRate === r.id, dashed: false })), [frameRate]);
    const chooseRate = useMemo(() => (id: FrameRate) => actions.setViz({ frameRate: id }), [actions]);
    return (
      <SectionCard prefix={P} section="comfort" title="Comfort" status={comfortStatus(frameRate, userPaused && pausedNow)}>
        <Toggle
          label={PAUSE_VISUALS_LABEL}
          description={pauseVisualsLine(userPaused)}
          note={userPaused && visualRecording ? PAUSE_VISUALS_RECORDING : null}
          checked={userPaused}
          onChange={actions.setVisualsPaused}
          data-testid="visuals-pause"
        />
        <ChoiceGroup<FrameRate> label="Frame rate" options={rates} onChoose={chooseRate} data-testid="visuals-frame-rate">
          {RATE_HINT}
        </ChoiceGroup>
      </SectionCard>
    );
  }
);

// ---------------------------------------------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------------------------------------------

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const VisualsBody = ({ inPanel }: { inPanel: boolean }) => {
  countRender('VisualsBody');
  const v = useVisuals();
  const s = v.settings;
  const scrollRef: { current: HTMLDivElement | null } = useRef(null);
  return (
    <div data-testid="visuals-body" className="h-full flex flex-col">
      <JumpRow scrollRef={scrollRef} inPanel={inPanel} sections={VISUALS_SECTIONS} prefix={P} />
      <div ref={scrollRef} data-testid="visuals-scroll" className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-surface-deep">
        <div className="px-4 py-3 space-y-3">
          <LookCard hexVisualMode={s.hexVisualMode} colorMode={s.colorMode} palette={v.palette} />
          <HexesCard showHexagons={s.showHexagons !== false} hexOpacity={num(s.hexOpacity, 0.6)} wander={s.hexWander !== false} reducedMotion={v.reducedMotion} />
          <OverlaysCard
            tree={!!s.showTreeOfLife}
            morph={s.morphEnabled !== false}
            trails={!!s.enableTrails}
            ripples={!!s.showWaterRipples}
            hydro={num(s.hydroIntensity, 50)}
            cube={!!s.showLoShuCube}
            cubeAuto={s.loShuCubeAutoRotate !== false}
            cubeRotation={num(s.loShuCubeRotation, 0)}
            vortex={!!s.loShuShowVortex}
            ascent={!!s.loShuShowAscent}
            pillar={!!s.loShuShowPillar}
            ouroboros={!!s.loShuShowOuroboros}
            palette={v.palette}
          />
          <MotionCard
            speed={num(s.speed, 1)}
            sensitivity={num(s.sensitivity, 1)}
            autoRotate={s.autoRotate !== false}
            ascension={!!s.invertPerspective}
            flow={s.enableFlow !== false}
            float={!!s.enableFloat}
            pulse={!!s.enablePulse}
            density={s.particleDensity}
            size={num(s.particleBaseSize, 3.5)}
          />
          <ComfortCard frameRate={frameRateOf(s.frameRate)} userPaused={v.userPaused} pausedNow={v.pausedNow} visualRecording={v.visualRecording} />
        </div>
      </div>
    </div>
  );
};

export default React.memo(VisualsBody);
