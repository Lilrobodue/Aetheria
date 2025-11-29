
import React, { useRef, useEffect } from 'react';
import { VizSettings } from '../types';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  primaryColor: string; // Hex
  isPlaying: boolean;
  binauralDelta: number;
  selectedFrequency: number;
  settings: VizSettings;
}

// --- Types ---
interface Point3D { x: number; y: number; z: number; }
interface Particle {
  x: number; y: number; z: number; // Current Pos
  tx: number; ty: number; tz: number; // Target Pos (Geometry)
  vx: number; vy: number; vz: number; // Velocity
  basePhase: number; 
  color: string; // Dynamic RGB string
  size: number;
  noise: { x: number, y: number, z: number }; // Per-particle noise offset
}

interface HexCell {
  col: number;
  row: number;
  x: number;
  y: number;
  size: number;
  dist: number; // Distance from center for radial pulse
  activeLevel: number; 
  pulseSpeed: number;
  freqIndex: number;
  colorType: 'primary' | 'shade1' | 'shade2'; 
  phaseOffset: number;
}

interface TreeNode {
    x: number; y: number; z: number;
    name: string;
    colorHex: string; // Chakra color mapping
    freqRange: [number, number]; // [MinHz, MaxHz]
    currentEnergy: number; // 0 to 1
}

interface Ripple {
    x: number;
    y: number;
    radius: number;
    maxRadius: number;
    alpha: number;
    speed: number;
    color: string;
    type: 'bass' | 'rain';
}

// --- Helpers ---
const PHI = (1 + Math.sqrt(5)) / 2; // 1.618...
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~2.399 rad

// Convert Hex to HSL for color math
const hexToHSL = (hex: string): { h: number; s: number; l: number } => {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt("0x" + hex[1] + hex[1]);
    g = parseInt("0x" + hex[2] + hex[2]);
    b = parseInt("0x" + hex[3] + hex[3]);
  } else if (hex.length === 7) {
    r = parseInt("0x" + hex[1] + hex[2]);
    g = parseInt("0x" + hex[3] + hex[4]);
    b = parseInt("0x" + hex[5] + hex[6]);
  }
  r /= 255; g /= 255; b /= 255;
  const cmin = Math.min(r,g,b), cmax = Math.max(r,g,b), delta = cmax - cmin;
  let h = 0, s = 0, l = 0;

  if (delta === 0) h = 0;
  else if (cmax === r) h = ((g - b) / delta) % 6;
  else if (cmax === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;

  h = Math.round(h * 60);
  if (h < 0) h += 360;

  l = (cmax + cmin) / 2;
  s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  s = +(s * 100).toFixed(1);
  l = +(l * 100).toFixed(1);

  return { h, s, l };
}

// --- GEOMETRY GENERATORS ---

// Generic Helper for Edge-based Shapes
const getWireframePoints = (vertices: Point3D[], edges: number[][], count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    const pointsPerEdge = Math.ceil(count / edges.length);
    
    edges.forEach(edge => {
        const p1 = vertices[edge[0]];
        const p2 = vertices[edge[1]];
        for (let i = 0; i < pointsPerEdge; i++) {
             // Add jitter for "energy cloud" look
             const t = Math.random(); 
             const jitter = 0.05 * scale;
             points.push({
                 x: (p1.x + (p2.x - p1.x) * t) * scale + (Math.random()-0.5)*jitter,
                 y: (p1.y + (p2.y - p1.y) * t) * scale + (Math.random()-0.5)*jitter,
                 z: (p1.z + (p2.z - p1.z) * t) * scale + (Math.random()-0.5)*jitter
             });
        }
    });

    // Trim or fill
    return points.slice(0, count);
};

// 1. Cube (174 Hz - Earth/Stability)
const getCubePoints = (count: number, scale: number): Point3D[] => {
    const v = [
        {x:-1,y:-1,z:-1}, {x:1,y:-1,z:-1}, {x:1,y:1,z:-1}, {x:-1,y:1,z:-1},
        {x:-1,y:-1,z:1},  {x:1,y:-1,z:1},  {x:1,y:1,z:1},  {x:-1,y:1,z:1}
    ];
    const edges = [
        [0,1], [1,2], [2,3], [3,0], // Back face
        [4,5], [5,6], [6,7], [7,4], // Front face
        [0,4], [1,5], [2,6], [3,7]  // Connecting
    ];
    return getWireframePoints(v, edges, count, scale);
};

// 2. Reiki Symbol (285 Hz - Healing) - Cho Ku Rei
const getReikiPoints = (count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    const spiralCount = Math.floor(count * 0.75);
    const lineCount = count - spiralCount;

    // Spiral part (Counter-clockwise inward)
    for (let i = 0; i < spiralCount; i++) {
        const t = (i / spiralCount) * Math.PI * 6; // 3 full turns
        const r = scale * (1 - i / spiralCount); // Radius shrinks
        points.push({
            x: Math.cos(t) * r,
            y: Math.sin(t) * r,
            z: (Math.random() - 0.5) * 20 // Slight depth
        });
    }

    // Vertical Line part
    for (let i = 0; i < lineCount; i++) {
        points.push({
            x: 0,
            y: scale - (i / lineCount) * (scale * 2), // Top to bottom
            z: 0
        });
    }
    return points;
};

// 3. Tetrahedron (396 Hz - Fire/Liberation)
const getTetrahedronPoints = (count: number, scale: number): Point3D[] => {
    const v = [
        {x:1,y:1,z:1}, {x:1,y:-1,z:-1}, {x:-1,y:1,z:-1}, {x:-1,y:-1,z:1}
    ];
    const edges = [[0,1], [0,2], [0,3], [1,2], [2,3], [3,1]];
    return getWireframePoints(v, edges, count, scale);
};

// 4. Icosahedron (417 Hz - Water/Change)
const getIcosahedronPoints = (count: number, scale: number): Point3D[] => {
    const t = PHI;
    const v = [
        {x:-1,y:t,z:0}, {x:1,y:t,z:0}, {x:-1,y:-t,z:0}, {x:1,y:-t,z:0},
        {x:0,y:-1,z:t}, {x:0,y:1,z:t}, {x:0,y:-1,z:-t}, {x:0,y:1,z:-t},
        {x:t,y:0,z:-1}, {x:t,y:0,z:1}, {x:-t,y:0,z:-1}, {x:-t,y:0,z:1}
    ];
    const edges = [ // 30 edges
       [0,11], [0,5], [0,1], [0,7], [0,10], [1,0], [1,5], [1,9], [1,8], [1,7],
       [2,3], [2,10], [2,4], [2,6], [2,11], [3,2], [3,6], [3,8], [3,9], [3,4],
       [4,2], [4,3], [4,9], [4,5], [4,11], [5,0], [5,1], [5,9], [5,4], [5,11],
       [6,2], [6,3], [6,8], [6,7], [6,10], [7,0], [7,1], [7,8], [7,6], [7,10],
       [8,1], [8,3], [8,6], [8,7], [8,9], [9,1], [9,3], [9,4], [9,5], [9,8],
       [10,0], [10,2], [10,6], [10,7], [10,11], [11,0], [11,2], [11,4], [11,5], [11,10]
    ];
    // Filter duplicates loosely or just draw plenty
    return getWireframePoints(v, edges, count, scale);
};

// 5. Octahedron (528 Hz - Air/Transformation)
const getOctahedronPoints = (count: number, scale: number): Point3D[] => {
    const v = [
        {x:1,y:0,z:0}, {x:-1,y:0,z:0}, {x:0,y:1,z:0}, 
        {x:0,y:-1,z:0}, {x:0,y:0,z:1}, {x:0,y:0,z:-1}
    ];
    const edges = [
        [0,2], [0,3], [0,4], [0,5], [1,2], [1,3], [1,4], [1,5],
        [2,4], [2,5], [3,4], [3,5]
    ];
    return getWireframePoints(v, edges, count, scale);
};

// 6. Merkaba (639 Hz - Connection)
const getMerkabaPoints = (count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    const v = [
        {x:1,y:1,z:1}, {x:1,y:-1,z:-1}, {x:-1,y:1,z:-1}, {x:-1,y:-1,z:1}, // Tet 1
        {x:-1,y:-1,z:-1}, {x:-1,y:1,z:1}, {x:1,y:-1,z:1}, {x:1,y:1,z:-1}   // Tet 2
    ];
    const edges1 = [[0,1], [0,2], [0,3], [1,2], [2,3], [3,1]];
    const edges2 = [[4,5], [4,6], [4,7], [5,6], [6,7], [7,5]];
    const allEdges = [...edges1, ...edges2];
    
    return getWireframePoints(v, allEdges, count, scale);
};

// 7. Dodecahedron (741 Hz - Ether/Expression)
const getDodecahedronPoints = (count: number, scale: number): Point3D[] => {
    const phi = PHI;
    const invPhi = 1/phi;
    const v: Point3D[] = [];
    
    // Standard vertices
    const v2 = [
        // (±1, ±1, ±1)
        {x:1,y:1,z:1}, {x:1,y:1,z:-1}, {x:1,y:-1,z:1}, {x:1,y:-1,z:-1},
        {x:-1,y:1,z:1}, {x:-1,y:1,z:-1}, {x:-1,y:-1,z:1}, {x:-1,y:-1,z:-1},
        // (0, ±1/φ, ±φ)
        {x:0,y:invPhi,z:phi}, {x:0,y:invPhi,z:-phi}, {x:0,y:-invPhi,z:phi}, {x:0,y:-invPhi,z:-phi},
        // (±1/φ, ±φ, 0)
        {x:invPhi,y:phi,z:0}, {x:invPhi,y:-phi,z:0}, {x:-invPhi,y:phi,z:0}, {x:-invPhi,y:-phi,z:0},
        // (±φ, 0, ±1/φ)
        {x:phi,y:0,z:invPhi}, {x:phi,y:0,z:-invPhi}, {x:-phi,y:0,z:invPhi}, {x:-phi,y:0,z:-invPhi}
    ];

    const points: Point3D[] = [];
    for(let i=0; i<count; i++) {
        const vA = v2[Math.floor(Math.random()*v2.length)];
        let vB = v2[Math.floor(Math.random()*v2.length)];
        const dist = Math.sqrt((vA.x-vB.x)**2 + (vA.y-vB.y)**2 + (vA.z-vB.z)**2);
        
        if (dist > 0 && dist < 1.3) {
            const t = Math.random();
            points.push({
                x: (vA.x + (vB.x - vA.x)*t) * scale,
                y: (vA.y + (vB.y - vA.y)*t) * scale,
                z: (vA.z + (vB.z - vA.z)*t) * scale
            });
        } else {
             points.push({x:vA.x*scale, y:vA.y*scale, z:vA.z*scale});
        }
    }
    return points;
};

// 8. Torus (852 Hz - Intuition)
const getTorusPoints = (count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    const R = scale; // Major radius
    const r = scale * 0.4; // Minor radius
    for (let i = 0; i < count; i++) {
        const u = Math.random() * Math.PI * 2;
        const v = Math.random() * Math.PI * 2;
        points.push({
            x: (R + r * Math.cos(v)) * Math.cos(u),
            y: (R + r * Math.cos(v)) * Math.sin(u),
            z: r * Math.sin(v)
        });
    }
    return points;
};

// 9. Fibonacci Sphere (963 Hz - Crown/Oneness)
const getFibonacciSpherePoints = (count: number, radius: number): Point3D[] => {
    const points: Point3D[] = [];
    for (let i = 0; i < count; i++) {
        const y = 1 - (i / (count - 1)) * 2; // y goes from 1 to -1
        const r = Math.sqrt(1 - y * y); // Radius at y
        const theta = GOLDEN_ANGLE * i;
        points.push({
            x: Math.cos(theta) * r * radius,
            y: y * radius,
            z: Math.sin(theta) * r * radius
        });
    }
    return points;
};

// Tree of Life Data
const getTreeOfLife = (): { nodes: TreeNode[], edges: [number, number][] } => {
    const rawNodes: TreeNode[] = [
        { x: 0, y: -4.5, z: 0, name: 'Malkuth', colorHex: '#FF0000', freqRange: [20, 80], currentEnergy: 0 }, 
        { x: 0, y: -1.5, z: 0, name: 'Yesod', colorHex: '#FF8C00', freqRange: [80, 200], currentEnergy: 0 },   
        { x: 0, y: 1.0, z: 0, name: 'Tiferet', colorHex: '#008000', freqRange: [200, 500], currentEnergy: 0 }, 
        { x: 0, y: 3.5, z: 0, name: 'Daat', colorHex: '#4B0082', freqRange: [2000, 4000], currentEnergy: 0 },    
        { x: 0, y: 5.5, z: 0, name: 'Keter', colorHex: '#EE82EE', freqRange: [8000, 20000], currentEnergy: 0 }, 
        { x: 2.0, y: -2.5, z: 0, name: 'Netzach', colorHex: '#FFD700', freqRange: [150, 300], currentEnergy: 0 }, 
        { x: 2.0, y: 0.0, z: 0, name: 'Chesed', colorHex: '#00BFFF', freqRange: [500, 1000], currentEnergy: 0 },  
        { x: 2.0, y: 4.0, z: 0, name: 'Chokhmah', colorHex: '#4B0082', freqRange: [4000, 8000], currentEnergy: 0 }, 
        { x: -2.0, y: -2.5, z: 0, name: 'Hod', colorHex: '#FFD700', freqRange: [150, 300], currentEnergy: 0 },
        { x: -2.0, y: 0.0, z: 0, name: 'Gevurah', colorHex: '#00BFFF', freqRange: [500, 1000], currentEnergy: 0 },
        { x: -2.0, y: 4.0, z: 0, name: 'Binah', colorHex: '#4B0082', freqRange: [2000, 4000], currentEnergy: 0 },
    ];

    const edges: [number, number][] = [
        [0, 1], [1, 5], [1, 8], [1, 2], [8, 5], [8, 2], [8, 9], [5, 2], [5, 6], 
        [2, 9], [2, 6], [2, 3], [9, 6], [9, 3], [9, 10], [6, 3], [6, 7], 
        [10, 7], [10, 3], [10, 4], [7, 3], [7, 4], [3, 4]
    ];

    return { nodes: rawNodes, edges };
};

const Visualizer: React.FC<VisualizerProps> = ({ 
  analyser, 
  primaryColor, 
  isPlaying, 
  settings,
  selectedFrequency
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>();
  const particlesRef = useRef<Particle[]>([]);
  const hexGridRef = useRef<HexCell[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const treeRef = useRef(getTreeOfLife());
  
  const timeRef = useRef(0);
  const prevFreqRef = useRef(0);
  
  // Audio History
  const prevBassRef = useRef(0);
  const prevHighRef = useRef(0);
  
  // Initialize Particles
  useEffect(() => {
    const pCount = settings.particleDensity === 'low' ? 400 : settings.particleDensity === 'medium' ? 800 : 1600;
    const newParticles: Particle[] = [];
    
    // Initial: Fibonacci Sphere
    const targets = getFibonacciSpherePoints(pCount, 250);

    for (let i = 0; i < pCount; i++) {
        newParticles.push({
            x: (Math.random() - 0.5) * 800,
            y: (Math.random() - 0.5) * 800,
            z: (Math.random() - 0.5) * 800,
            tx: targets[i] ? targets[i].x : 0,
            ty: targets[i] ? targets[i].y : 0,
            tz: targets[i] ? targets[i].z : 0,
            vx: 0, vy: 0, vz: 0,
            basePhase: Math.random() * Math.PI * 2,
            color: primaryColor,
            size: Math.random() * 2 + 1.0,
            noise: { x: Math.random(), y: Math.random(), z: Math.random() }
        });
    }
    particlesRef.current = newParticles;

    // Initialize Hex Grid
    const hexCells: HexCell[] = [];
    const size = 40;
    const cols = 30; 
    const rows = 20;
    const hexWidth = Math.sqrt(3) * size;
    const hexHeight = 2 * size;
    const xOffset = hexWidth;
    const yOffset = hexHeight * 0.75;

    let index = 0;
    for (let r = -rows; r < rows; r++) {
        for (let c = -cols; c < cols; c++) {
             const x = (c * xOffset) + ((r % 2) * xOffset / 2);
             const y = r * yOffset;
             const dist = Math.sqrt(x*x + y*y);
             const normalizedDist = Math.min(1, dist / 800);
             const freqIndex = Math.floor(normalizedDist * 64);
             // Golden Ratio distribution
             const mathType = (Math.abs((c * r * PHI) + index) * PHI) % 1;
             let colorType: 'primary' | 'shade1' | 'shade2' = 'primary';
             if (mathType > 0.69) { colorType = mathType > 0.85 ? 'shade2' : 'shade1'; }
             hexCells.push({ col: c, row: r, x, y, size, dist, activeLevel: 0, pulseSpeed: 0.02 + Math.random() * 0.05, freqIndex, colorType, phaseOffset: Math.random() * Math.PI * 2 });
             index++;
        }
    }
    hexGridRef.current = hexCells;

  }, [settings.particleDensity]);

  // Handle Geometry Morphing based on Frequency
  useEffect(() => {
    if (Math.abs(selectedFrequency - prevFreqRef.current) < 5) return;
    prevFreqRef.current = selectedFrequency;

    const pCount = particlesRef.current.length;
    const scale = 250; 
    let newTargets: Point3D[] = [];

    // SACRED GEOMETRY EQ MAPPING
    if (selectedFrequency <= 180) {
        newTargets = getCubePoints(pCount, scale);
    } else if (selectedFrequency <= 300) {
        newTargets = getReikiPoints(pCount, scale);
    } else if (selectedFrequency <= 400) {
        newTargets = getTetrahedronPoints(pCount, scale);
    } else if (selectedFrequency <= 450) {
        newTargets = getIcosahedronPoints(pCount, scale);
    } else if (selectedFrequency <= 580) {
        newTargets = getOctahedronPoints(pCount, scale);
    } else if (selectedFrequency <= 680) {
        newTargets = getMerkabaPoints(pCount, scale);
    } else if (selectedFrequency <= 780) {
        newTargets = getDodecahedronPoints(pCount, scale);
    } else if (selectedFrequency <= 900) {
        newTargets = getTorusPoints(pCount, scale);
    } else {
        newTargets = getFibonacciSpherePoints(pCount, scale);
    }

    // Assign new targets smoothly
    particlesRef.current.forEach((p, i) => {
        if (newTargets[i]) {
            p.tx = newTargets[i].x;
            p.ty = newTargets[i].y;
            p.tz = newTargets[i].z;
        } else {
            const backup = newTargets[i % newTargets.length];
            p.tx = backup.x; p.ty = backup.y; p.tz = backup.z;
        }
    });

  }, [selectedFrequency]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Pre-calculate Color Palette
    const baseHSL = hexToHSL(primaryColor);
    const primaryStr = `hsla(${baseHSL.h}, ${baseHSL.s}%, ${baseHSL.l}%,`; 
    const shade1Str = `hsla(${baseHSL.h}, ${Math.min(100, baseHSL.s + 15)}%, ${Math.max(10, baseHSL.l - 25)}%,`;
    const shade2Str = `hsla(${baseHSL.h}, ${Math.max(0, baseHSL.s - 15)}%, ${Math.min(95, baseHSL.l + 30)}%,`;

    const render = () => {
      // 1. Resize Handling
      if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;

      // 2. Audio Data Analysis
      const bufferLength = analyser ? analyser.frequencyBinCount : 0;
      const dataArray = new Uint8Array(bufferLength);
      if (analyser) analyser.getByteFrequencyData(dataArray);

      let bassEnergy = 0, highEnergy = 0;
      if (bufferLength > 0) {
          for(let i=0; i<10; i++) bassEnergy += dataArray[i];
          bassEnergy = Math.min(1, (bassEnergy / 10) / 255 * 2.5);
          const highStart = Math.min(100, bufferLength - 20);
          for(let i=highStart; i<highStart+20; i++) highEnergy += dataArray[i];
          highEnergy = Math.min(1, (highEnergy / 20) / 255 * 2.5);
      }

      // 3. Tree of Life Energy Updates
      let activeNodeColor: string | null = null;
      let highestNodeEnergy = 0;
      
      treeRef.current.nodes.forEach(node => {
         let nodeEnergy = 0;
         if (analyser && bufferLength > 0) {
            const nyquist = 22050;
            const binSize = nyquist / bufferLength;
            const startBin = Math.floor(node.freqRange[0] / binSize);
            const endBin = Math.ceil(node.freqRange[1] / binSize);
            let sum = 0, count = 0;
            for(let b = startBin; b < endBin && b < bufferLength; b++) { sum += dataArray[b]; count++; }
            nodeEnergy = count > 0 ? (sum / count) / 255 : 0;
            nodeEnergy *= 2.5; // Boost
         }
         // Smooth decay
         node.currentEnergy = Math.max(0, (node.currentEnergy || 0) * 0.9 + nodeEnergy * 0.1);

         if (node.currentEnergy > 0.4 && node.currentEnergy > highestNodeEnergy) {
             highestNodeEnergy = node.currentEnergy;
             activeNodeColor = node.colorHex;
         }
      });

      // 5. Water Ripples Logic with Natural Scaling (0-100 Non-Linear)
      if (settings.showWaterRipples && isPlaying) {
           // Apply a power curve so the effect ramps up naturally. 
           // 0-40 is very subtle, 50-80 is moderate, 80-100 is storm-like.
           const rawInput = settings.hydroIntensity || 0;
           const normalizedCurve = Math.pow(rawInput / 100, 1.5); // 0 to 1 curved
           const physicalIntensity = normalizedCurve * 2.5; // Scale up for visual impact
           
           if ((bassEnergy * physicalIntensity) > 0.3 && bassEnergy > prevBassRef.current + 0.05) {
              ripplesRef.current.push({ x: cx, y: cy, radius: 10, maxRadius: Math.max(w, h) * 0.9, alpha: 1.0, speed: 6 * settings.speed, color: primaryStr, type: 'bass' });
           }
           
           // Rain Probability increases with intensity
           const rainThreshold = 0.9 - (normalizedCurve * 0.7); // High intensity lowers threshold drastically
           
           if (highEnergy > rainThreshold && Math.random() < normalizedCurve * 0.6) {
              ripplesRef.current.push({ x: Math.random() * w, y: Math.random() * h, radius: 0, maxRadius: 150 + (normalizedCurve * 200), alpha: 0.6 + (normalizedCurve * 0.4), speed: 3 * settings.speed, color: Math.random() > 0.5 ? shade2Str : shade1Str, type: 'rain' });
           }
      }
      prevBassRef.current = bassEnergy;
      prevHighRef.current = highEnergy;

      // CLEAR SCREEN
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);

      // --- LAYER 1: HEX GRID ---
      if (settings.showHexagons) {
          ctx.save();
          ctx.translate(cx, cy);
          hexGridRef.current.forEach(hex => {
              let active = 0;
              if (isPlaying && bufferLength > 0) {
                  if (settings.hexVisualMode === 'spectrum') active = (dataArray[hex.freqIndex % bufferLength] / 255) * 1.5;
                  else if (settings.hexVisualMode === 'pulse') active = (Math.sin(timeRef.current * 2 - hex.dist * 0.01) > 0.8) ? bassEnergy : 0;
                  else active = Math.max(0, Math.sin(hex.x * 0.01 + timeRef.current) * Math.cos(hex.y * 0.01 + timeRef.current) * bassEnergy);
              }
              if (hex.colorType !== 'primary' && isPlaying) active = Math.max(0, Math.min(1, active + (Math.random() - 0.5) * 0.3 * settings.sensitivity));
              
              let waveLift = 0;
              if (settings.showWaterRipples && isPlaying) {
                  ripplesRef.current.forEach(r => {
                      const distToWaveFront = Math.abs(Math.sqrt((hex.x - (r.x - cx))**2 + (hex.y - (r.y - cy))**2) - r.radius);
                      const waveWidth = r.type === 'bass' ? 50 : 30;
                      if (distToWaveFront < waveWidth) waveLift += (1 - (distToWaveFront / waveWidth)) * r.alpha;
                  });
              }
              active = Math.min(1.5, active + waveLift * 0.8);
              hex.activeLevel = hex.activeLevel * 0.9 + active * 0.1;
              let opacity = Math.min(1, hex.activeLevel * settings.hexOpacity);

              if (opacity > 0.05) {
                ctx.beginPath();
                const liftScale = 1 + (waveLift * 0.4); 
                const drawSize = hex.size * 0.95 * liftScale;
                for (let i = 0; i < 6; i++) {
                    const angle = (Math.PI / 3) * i;
                    ctx[i===0?'moveTo':'lineTo'](hex.x + drawSize * Math.cos(angle), hex.y + drawSize * Math.sin(angle));
                }
                ctx.closePath();
                
                let strokeStr = primaryStr;
                let fillStr = primaryStr;
                if (hex.colorType === 'shade1') { strokeStr = fillStr = shade1Str; opacity *= 1.5; } 
                else if (hex.colorType === 'shade2') { strokeStr = fillStr = shade2Str; opacity *= 1.2; }
                if (waveLift > 0.2) opacity = Math.min(1, opacity + 0.3);

                ctx.strokeStyle = strokeStr + opacity + ')';
                ctx.lineWidth = hex.colorType === 'primary' ? 1 : 2;
                ctx.stroke();
                ctx.fillStyle = fillStr + (opacity * 0.2) + ')';
                ctx.fill();
              }
          });
          ctx.restore();
      }

      // --- LAYER 2: RIPPLES ---
      if (settings.showWaterRipples) {
          ctx.save();
          for (let i = ripplesRef.current.length - 1; i >= 0; i--) {
              const r = ripplesRef.current[i];
              r.radius += r.speed;
              r.alpha -= 0.005; 
              if (r.alpha <= 0 || r.radius > r.maxRadius) { ripplesRef.current.splice(i, 1); continue; }
              ctx.strokeStyle = r.color + r.alpha + ')';
              ctx.lineWidth = r.type === 'bass' ? 4 : 2; 
              ctx.beginPath(); ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2); ctx.stroke();
              if (r.radius > 25) {
                  ctx.beginPath(); ctx.strokeStyle = r.color + (r.alpha * 0.4) + ')'; ctx.lineWidth = 1;
                  ctx.arc(r.x, r.y, r.radius - 20, 0, Math.PI * 2); ctx.stroke();
              }
          }
          ctx.restore();
      }

      // --- LAYER 3: TREE OF LIFE (3D Sephirot + High-Vis Flow) ---
      if (settings.showTreeOfLife) {
        ctx.save();
        ctx.translate(cx, cy);
        const availableHeight = h - 180;
        const scaleUnit = Math.min(50, availableHeight / 11); 
        const breathing = Math.sin(timeRef.current * 0.5) * 5;
        
        // 1. Edges with "Comet" Energy Flow
        treeRef.current.edges.forEach(([startIdx, endIdx], i) => {
            const sn = treeRef.current.nodes[startIdx];
            const en = treeRef.current.nodes[endIdx];
            const sx = sn.x * scaleUnit, sy = -sn.y * scaleUnit + breathing; 
            const ex = en.x * scaleUnit, ey = -en.y * scaleUnit + breathing;

            // Background Line (Subtle)
            const grad = ctx.createLinearGradient(sx, sy, ex, ey);
            grad.addColorStop(0, sn.colorHex); grad.addColorStop(1, en.colorHex);
            ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
            ctx.strokeStyle = grad; ctx.globalAlpha = 0.2; ctx.lineWidth = 2; ctx.stroke();

            // High Visibility Comet
            const sourceEnergy = sn.currentEnergy || 0;
            // Always show a faint flow, boost with energy
            const flowIntensity = 0.2 + (sourceEnergy * 0.8);
            
            if (flowIntensity > 0.05) {
                const flowSpeed = 0.6 * settings.speed;
                const phase = (timeRef.current * flowSpeed + (i * 0.7)) % 1;
                
                // Current position
                const px = sx + (ex - sx) * phase;
                const py = sy + (ey - sy) * phase;

                // Comet Tail (Linear fade behind the head)
                const tailLength = 0.4; 
                // We draw the tail by iterating backwards slightly or just a gradient line
                const tailStartX = px - (ex-sx)*tailLength;
                const tailStartY = py - (ey-sy)*tailLength;

                // Ensure tail doesn't draw before start node logic (simplified via gradient clamp)
                // Use lighter composite for "glowing energy" look
                ctx.globalCompositeOperation = 'lighter';
                
                const cometGrad = ctx.createLinearGradient(
                    sx + (ex-sx) * (phase - tailLength), 
                    sy + (ey-sy) * (phase - tailLength),
                    px, py
                );
                cometGrad.addColorStop(0, 'rgba(0,0,0,0)');
                cometGrad.addColorStop(1, sn.colorHex);

                ctx.beginPath();
                // Clamp drawing to the segment
                const t0 = Math.max(0, phase - tailLength);
                const t1 = phase;
                if (t1 > 0) {
                    ctx.moveTo(sx + (ex-sx)*t0, sy + (ey-sy)*t0);
                    ctx.lineTo(px, py);
                    ctx.strokeStyle = cometGrad;
                    ctx.lineWidth = 4 + (sourceEnergy * 6);
                    ctx.lineCap = 'round';
                    ctx.stroke();
                }

                // Head Glow
                ctx.beginPath();
                ctx.arc(px, py, 3 + (sourceEnergy * 4), 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.shadowColor = sn.colorHex;
                ctx.shadowBlur = 15;
                ctx.fill();
                ctx.shadowBlur = 0;
                
                ctx.globalCompositeOperation = 'source-over';
            }
        });

        // 2. 3D Spherical Nodes (Sephirot)
        treeRef.current.nodes.forEach(node => {
            const nx = node.x * scaleUnit, ny = -node.y * scaleUnit + breathing;
            const baseRadius = scaleUnit * 0.6; 
            const energyPulse = (node.currentEnergy || 0) * 10;
            const r = baseRadius + energyPulse;
            
            // A. Outer Aura (Glow)
            if (node.currentEnergy > 0.05) {
                const aura = ctx.createRadialGradient(nx, ny, r, nx, ny, r * 2.5);
                aura.addColorStop(0, node.colorHex); 
                aura.addColorStop(1, 'transparent');
                ctx.fillStyle = aura; 
                ctx.globalAlpha = 0.4 * settings.sensitivity;
                ctx.beginPath(); ctx.arc(nx, ny, r * 2.5, 0, Math.PI * 2); ctx.fill();
            }

            ctx.globalAlpha = 1.0;
            
            // B. 3D Sphere Rendering (Radial Gradient)
            // Offset the center of the gradient to create a "lit from top-left" effect
            const lightOffsetX = nx - r * 0.3;
            const lightOffsetY = ny - r * 0.3;
            
            const sphereGrad = ctx.createRadialGradient(
                lightOffsetX, lightOffsetY, r * 0.1, // Inner light point
                nx, ny, r                            // Outer sphere boundary
            );
            
            // 1. Specular Highlight (White hotspot)
            sphereGrad.addColorStop(0, '#ffffff'); 
            // 2. Inner Glow (Bright version of color)
            sphereGrad.addColorStop(0.2, node.colorHex); 
            // 3. Main Body (The color)
            sphereGrad.addColorStop(0.5, node.colorHex); 
            // 4. Shadow Edge (Darker version for 3D curvature)
            sphereGrad.addColorStop(0.85, '#000000'); 
            // 5. Smooth edge
            sphereGrad.addColorStop(1, 'rgba(0,0,0,0)');

            ctx.beginPath();
            ctx.arc(nx, ny, r, 0, Math.PI * 2);
            ctx.fillStyle = sphereGrad;
            ctx.fill();

            // C. Rim Light (Reflection from bottom-right)
            ctx.beginPath();
            ctx.arc(nx, ny, r * 0.9, 0.25 * Math.PI, 0.75 * Math.PI);
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Label
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.shadowColor = 'black'; ctx.shadowBlur = 4;
            ctx.fillText(node.name, nx, ny + r + 14);
            ctx.shadowBlur = 0;
        });
        ctx.restore();
      }

      // --- LAYER 4: SACRED GEOMETRY PARTICLES ---
      if (settings.particleDensity !== 'low') {
        ctx.save();
        ctx.translate(cx, cy);
        
        // Invert Perspective (Ascension Mode)
        if (settings.invertPerspective) {
            ctx.scale(1, -1);
        }

        // Auto Rotation
        if (settings.autoRotate) {
             const rotSpeed = timeRef.current * 0.1;
             ctx.rotate(rotSpeed);
        }
        
        // Use Additive Blending for Glow Effect
        ctx.globalCompositeOperation = 'lighter';

        const morphSpeed = 0.15 * settings.speed; 
        const particleBaseSize = settings.particleBaseSize || 2.5;

        particlesRef.current.forEach((p, index) => {
            
            // 1. Target Position Logic
            let targetX = p.tx;
            let targetY = p.ty;
            let targetZ = p.tz;

            if (!settings.morphEnabled) {
                const r = 400 + Math.sin(timeRef.current + index) * 50;
                targetX = Math.cos(p.basePhase + timeRef.current * 0.1) * Math.sin(index) * r;
                targetY = Math.sin(p.basePhase + timeRef.current * 0.1) * Math.sin(index) * r;
                targetZ = Math.cos(index) * r;
            }

            p.x += (targetX - p.x) * morphSpeed;
            p.y += (targetY - p.y) * morphSpeed;
            p.z += (targetZ - p.z) * morphSpeed;

            // 2. Motion Logic 
            let mx = 0, my = 0, mz = 0;
            
            if (settings.enableFlow) {
                const direction = settings.invertPerspective ? -1 : 1;
                const zRange = 2000;
                const flowSpeed = 80 * settings.speed;
                const timeOffset = (timeRef.current * flowSpeed * direction) + (p.noise.z * zRange);
                let flowZ = (timeOffset % zRange);
                if (flowZ < 0) flowZ += zRange;
                mz += flowZ - (zRange / 2);
            } 
            
            if (settings.enableFloat) {
                mx += Math.sin(timeRef.current * 0.5 + p.noise.x * 10) * 30;
                my += Math.cos(timeRef.current * 0.3 + p.noise.y * 10) * 30;
                mz += Math.sin(timeRef.current * 0.2 + p.noise.z * 10) * 30;
            } 
            
            if (settings.enablePulse) {
                const pulse = 1 + Math.sin(timeRef.current * 3 + index * 0.1) * 0.4 * bassEnergy;
                mx += p.x * (pulse - 1);
                my += p.y * (pulse - 1);
                mz += p.z * (pulse - 1);
            }

            // 3. Color Logic
            if (settings.colorMode === 'cycle') {
                const cycleSpeed = 50 * settings.speed;
                const baseHue = (timeRef.current * cycleSpeed + (index / particlesRef.current.length) * 360) % 360;
                const hue = (baseHue + bassEnergy * 60) % 360;
                const sat = 80;
                const lit = 60 + highEnergy * 20; 
                p.color = `hsl(${hue}, ${sat}%, ${lit}%)`;
            } else if (settings.colorMode === 'chakra') {
                 const phiResidue = (index * PHI) % 1;
                 if (activeNodeColor && isPlaying && phiResidue < 0.2) {
                     p.color = activeNodeColor;
                 } else {
                     p.color = primaryColor;
                 }
            } else {
                p.color = primaryColor;
            }

            // 3D Projection
            const fov = 400; 
            const finalX = p.x + mx;
            const finalY = p.y + my;
            const finalZ = p.z + mz;

            const scale = fov / (fov + finalZ + 200);
            
            if (scale > 0 && scale < 20) {
                const px = finalX * scale;
                const py = finalY * scale;
                const size = Math.max(0.5, p.size * particleBaseSize * scale);
                const depthAlpha = Math.min(1, Math.max(0, (finalZ + 800) / 1000));
                
                ctx.beginPath();
                ctx.arc(px, py, size, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.globalAlpha = depthAlpha * 0.6; 
                ctx.fill();
            }
        });
        ctx.restore();
      }

      timeRef.current += 0.01 * settings.speed;
      rafRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [settings, isPlaying, analyser, primaryColor]);

  return <canvas id="viz-canvas" ref={canvasRef} className="fixed inset-0 w-full h-full" />;
};

export default Visualizer;
