import React, { useRef, useEffect } from 'react';
import { VizSettings } from '../types';
import { frequencyToSpectrumColor, type FrequencyColorMode } from '../utils/spectrumColor';
import { LO_SHU_WALKS, type LoShuWalkMode } from '../constants';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  primaryColor: string; // Hex
  isPlaying: boolean;
  binauralDelta: number;
  selectedFrequency: number;
  settings: VizSettings;
  /** When 'spectrum', the Lo Shu cube tints sub-cubes by visible-light wavelength
   *  rather than the chakra palette. Defaults to 'chakra'. */
  frequencyColorMode?: FrequencyColorMode;
  /** When set, the cube layer draws a polyline tracing the walk's 27-frequency
   *  path through the sub-cubes. Segments up to the currently-playing cube glow
   *  brighter than the upcoming portion. */
  loShuWalkMode?: LoShuWalkMode | null;
}

// 27 Aetheria frequencies arranged into [GUT, HEART, HEAD] layers, ordered
// by Lo Shu position 1..9 (so index 0 == position 1).
const LO_SHU_CUBE_FREQS: number[][] = [
  [174, 285, 396, 417, 528, 639, 741, 852, 963],
  [1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150],
  [3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336],
];

// Standard Lo Shu position layout (visible grid order):
//   4 9 2
//   3 5 7
//   8 1 6
const LO_SHU_GRID_ORDER: number[] = [4, 9, 2, 3, 5, 7, 8, 1, 6];

// Chakra-palette fallback colours for each of the 27 frequencies, indexed
// [layer][position-1]. Mirrors the SOLFEGGIO_INFO chakra palette without
// importing the whole table into the Visualizer.
const LO_SHU_CUBE_CHAKRA_COLORS: string[][] = [
  // GUT
  ['#8B0000', '#FF0000', '#FF4500', '#FF8C00', '#FFD700', '#7BC74D', '#00B7EB', '#3B82F6', '#A78BFA'],
  // HEART
  ['#FB923C', '#FBBF24', '#A3E635', '#34D399', '#10B981', '#06B6D4', '#22D3EE', '#60A5FA', '#A855F7'],
  // HEAD
  ['#C084FC', '#E879F9', '#F472B6', '#FB7185', '#F43F5E', '#9333EA', '#7C3AED', '#A78BFA', '#FFFFFF'],
];

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

// Hard cap on simultaneously-active water ripples. Without this, the
// continuous "rain" pushes 1–3 ripple objects per frame at high audio
// energy, accumulating into hundreds of live entries within seconds — the
// per-hex inner loop becomes O(hexes × ripples) and the constant
// allocation/decay churn triggers GC pauses that look like the "smooth
// for a second then jerky" stutter the user reported.
const MAX_ACTIVE_RIPPLES = 80;

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

// === FOURTH ORDER SACRED GEOMETRY (Higher Consciousness Forms) ===

// 10. Hypercube/Tesseract (1074 Hz - 4D Transcendence)
const getHypercubePoints = (count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    // 4D cube projected into 3D space
    const w = 0.5; // 4th dimension parameter
    
    for (let i = 0; i < count; i++) {
        const t = (i / count) * Math.PI * 2 * 4; // Multiple rotations through 4D
        const x4 = Math.cos(t * 0.7) * w;
        const y4 = Math.sin(t * 0.7) * w;
        
        // Project 4D coordinates into 3D
        const perspective = 1 / (2 - x4);
        points.push({
            x: (Math.cos(t) + y4) * scale * perspective,
            y: (Math.sin(t) + x4) * scale * perspective,
            z: (Math.cos(t * 1.618) * Math.sin(t * 0.618)) * scale * perspective
        });
    }
    return points;
};

// 11. Complete Flower of Life (1317 Hz - Universal Template)
const getFlowerOfLifePoints = (count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    const numCircles = 19; // Complete flower has 19 circles
    const circleRadius = scale * 0.3;
    
    // Central circle
    const pointsPerCircle = Math.floor(count / numCircles);
    
    // Generate the complete 19-circle pattern
    const centers = [
        { x: 0, y: 0 }, // Center
        // Inner ring (6 circles)
        ...Array.from({ length: 6 }, (_, i) => ({
            x: circleRadius * Math.cos(i * Math.PI / 3),
            y: circleRadius * Math.sin(i * Math.PI / 3)
        })),
        // Outer ring (12 circles)
        ...Array.from({ length: 12 }, (_, i) => ({
            x: circleRadius * 2 * Math.cos(i * Math.PI / 6),
            y: circleRadius * 2 * Math.sin(i * Math.PI / 6)
        }))
    ];
    
    centers.forEach((center, circleIdx) => {
        for (let i = 0; i < pointsPerCircle; i++) {
            const angle = (i / pointsPerCircle) * Math.PI * 2;
            const r = circleRadius * 0.8;
            points.push({
                x: center.x + Math.cos(angle) * r,
                y: center.y + Math.sin(angle) * r,
                z: Math.sin(circleIdx * 0.3 + angle) * scale * 0.1 // Slight 3D depth
            });
        }
    });
    
    return points.slice(0, count);
};

// 12. Metatron's Cube (1641 Hz - Cosmic Order)
const getMetatronsCubePoints = (count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    
    // 13 circles arranged in Metatron's Cube pattern
    const centers = [
        { x: 0, y: 0 }, // Center
        // Inner hexagon
        ...Array.from({ length: 6 }, (_, i) => ({
            x: scale * 0.5 * Math.cos(i * Math.PI / 3),
            y: scale * 0.5 * Math.sin(i * Math.PI / 3)
        })),
        // Outer hexagon
        ...Array.from({ length: 6 }, (_, i) => ({
            x: scale * 0.866 * Math.cos(i * Math.PI / 3 + Math.PI / 6),
            y: scale * 0.866 * Math.sin(i * Math.PI / 3 + Math.PI / 6)
        }))
    ];
    
    // Create points along the connecting lines (the "cube" edges)
    const pointsPerConnection = Math.floor(count / 78); // 78 possible connections in Metatron's Cube
    
    centers.forEach((center1, i) => {
        centers.forEach((center2, j) => {
            if (i < j && points.length < count) { // Avoid duplicates
                for (let k = 0; k < pointsPerConnection && points.length < count; k++) {
                    const t = k / pointsPerConnection;
                    points.push({
                        x: center1.x + (center2.x - center1.x) * t,
                        y: center1.y + (center2.y - center1.y) * t,
                        z: Math.sin(t * Math.PI * 2 + i + j) * scale * 0.1
                    });
                }
            }
        });
    });
    
    return points.slice(0, count);
};

// === FIFTH ORDER SACRED GEOMETRY (Stellar & Galactic Forms) ===

// 13. Hyperdodecahedron (1752 Hz - Stellar Consciousness)
const getHyperdodecahedronPoints = (count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    const phi = PHI;
    
    // 4D dodecahedron projected to 3D with stellar pattern
    for (let i = 0; i < count; i++) {
        const t = (i / count) * Math.PI * 8; // Multiple stellar cycles
        const w = Math.sin(t * 0.1) * 0.5; // 4th dimension oscillation
        
        // Dodecahedral coordinates with 4D projection
        const angle1 = t;
        const angle2 = t * phi;
        const perspective = 1 / (2 - w);
        
        points.push({
            x: Math.cos(angle1) * Math.cos(angle2) * scale * perspective,
            y: Math.sin(angle1) * Math.cos(angle2) * scale * perspective,
            z: Math.sin(angle2) * scale * perspective
        });
    }
    return points;
};

// 14. Golden Spiral Galaxy (1995 Hz - Galactic Alignment)
const getGoldenSpiralGalaxyPoints = (count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    
    // Create a phi-based galactic spiral
    for (let i = 0; i < count; i++) {
        const t = (i / count) * Math.PI * 12; // Multiple spiral arms
        const r = scale * Math.pow(PHI, t / (Math.PI * 4)) * 0.1; // Phi-based radius expansion
        const armOffset = (i % 4) * Math.PI / 2; // 4 spiral arms
        
        points.push({
            x: Math.cos(t + armOffset) * r,
            y: Math.sin(t + armOffset) * r,
            z: Math.sin(t * 0.1) * scale * 0.2 // Galactic disk thickness
        });
    }
    return points;
};

// 15. Icosi-Dodecahedron (2319 Hz - Multidimensional Access)
const getIcosiDodecahedronPoints = (count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    const halfCount = Math.floor(count / 2);
    
    // Combine icosahedron and dodecahedron
    const icoPoints = getIcosahedronPoints(halfCount, scale * 0.8);
    const dodecaPoints = getDodecahedronPoints(count - halfCount, scale * 1.2);
    
    return [...icoPoints, ...dodecaPoints];
};

// === SIXTH ORDER SACRED GEOMETRY (Source Connection Forms) ===

// 16. Infinite Torus Field (2430 Hz - Universal Love Matrix)
const getInfiniteTorusFieldPoints = (count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    const numTori = 5; // Nested tori at different scales
    
    for (let torusIdx = 0; torusIdx < numTori; torusIdx++) {
        const torusScale = scale * (1 + torusIdx * 0.3);
        const pointsPerTorus = Math.floor(count / numTori);
        
        for (let i = 0; i < pointsPerTorus; i++) {
            const u = (i / pointsPerTorus) * Math.PI * 2;
            const v = ((i * 7) / pointsPerTorus) * Math.PI * 2; // Different frequency for variety
            
            const R = torusScale * 0.6; // Major radius
            const r = torusScale * 0.2; // Minor radius
            
            points.push({
                x: (R + r * Math.cos(v)) * Math.cos(u),
                y: (R + r * Math.cos(v)) * Math.sin(u),
                z: r * Math.sin(v) + Math.sin(torusIdx + u) * torusScale * 0.1
            });
        }
    }
    
    return points.slice(0, count);
};

// 17. Source Fractal Mandala (2673 Hz - Divine Source Interface)
const getSourceFractalMandalaPoints = (count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    
    // Create a fractal mandala pattern
    for (let i = 0; i < count; i++) {
        const t = (i / count) * Math.PI * 16; // High frequency pattern
        const r1 = scale * 0.5 * Math.sin(t * 3) * Math.sin(t * 5);
        const r2 = scale * 0.3 * Math.cos(t * 7) * Math.cos(t * 11);
        const fractalR = Math.abs(r1 + r2);
        
        points.push({
            x: Math.cos(t) * fractalR,
            y: Math.sin(t) * fractalR,
            z: Math.sin(t * PHI) * scale * 0.2
        });
    }
    return points;
};

// 18. Unity Consciousness Sphere (2997 Hz - Oneness Embodiment)
const getUnityConsciousnessSpherePoints = (count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    
    // Perfect sphere with unity consciousness pattern
    for (let i = 0; i < count; i++) {
        const theta = Math.acos(1 - 2 * (i / count)); // Uniform sphere distribution
        const phi = Math.PI * (3 - Math.sqrt(5)) * i; // Golden angle
        
        const x = Math.sin(theta) * Math.cos(phi);
        const y = Math.sin(theta) * Math.sin(phi);
        const z = Math.cos(theta);
        
        // Add unity consciousness pulsing
        const unityPulse = 1 + 0.1 * Math.sin(i * PHI);
        
        points.push({
            x: x * scale * unityPulse,
            y: y * scale * unityPulse,
            z: z * scale * unityPulse
        });
    }
    return points;
};

// === SEVENTH ORDER SACRED GEOMETRY (Master Creation Forms) ===

// 19. Genesis Polytope (3108 Hz - Prime Creation Pattern)
const getGenesisPolytopePoints = (count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    
    // Multidimensional creation pattern
    for (let i = 0; i < count; i++) {
        const t = (i / count) * Math.PI * 21; // 21 = 3*7, sacred numbers
        const r = scale * Math.pow(Math.E, t / (Math.PI * 7)) * 0.05; // Natural exponential growth
        
        // Genesis spiral with multiple dimensions
        const x4 = Math.cos(t * PHI);
        const y4 = Math.sin(t * PHI);
        
        points.push({
            x: Math.cos(t) * r * (1 + x4 * 0.5),
            y: Math.sin(t) * r * (1 + y4 * 0.5),
            z: Math.sin(t * 0.618) * scale * 0.3
        });
    }
    return points;
};

// 20. Divine Architecture Matrix (3351 Hz - Sacred Blueprint)
const getDivineArchitectureMatrixPoints = (count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    
    // Sacred architectural pattern combining all previous geometries
    const geometryTypes = 7; // Use 7 different base geometries
    const pointsPerType = Math.floor(count / geometryTypes);
    
    // Combine multiple sacred forms in architectural harmony
    const smallScale = scale * 0.3;
    
    for (let type = 0; type < geometryTypes; type++) {
        const offset = type * Math.PI * 2 / geometryTypes;
        const radius = scale * (0.5 + type * 0.1);
        
        for (let i = 0; i < pointsPerType; i++) {
            const t = (i / pointsPerType) * Math.PI * 2;
            points.push({
                x: Math.cos(t + offset) * radius + Math.cos(t * 3) * smallScale,
                y: Math.sin(t + offset) * radius + Math.sin(t * 3) * smallScale,
                z: Math.sin(t * PHI + offset) * scale * 0.2
            });
        }
    }
    
    return points.slice(0, count);
};

// 21. Absolute Unity Hologram (3675 Hz - Complete Transcendence)
const getAbsoluteUnityHologramPoints = (count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    
    // The ultimate holographic pattern containing all possibilities
    for (let i = 0; i < count; i++) {
        const t = (i / count) * Math.PI * 24; // 24 = cosmic completion number
        
        // Holographic interference pattern
        const wave1 = Math.sin(t * PHI);
        const wave2 = Math.cos(t * Math.E);
        const wave3 = Math.sin(t * Math.sqrt(5));
        
        const interference = (wave1 + wave2 + wave3) / 3;
        const r = scale * (0.8 + interference * 0.4);
        
        points.push({
            x: Math.cos(t) * r,
            y: Math.sin(t) * r,
            z: interference * scale * 0.5
        });
    }
    return points;
};

// === 111Hz PATTERN SACRED GEOMETRY ===

// Triangle-based patterns for 111Hz series
const get111PatternPoints = (frequency: number, count: number, scale: number): Point3D[] => {
    const points: Point3D[] = [];
    const patternNumber = Math.round(frequency / 111);
    
    // Create pattern based on the 111Hz multiple
    for (let i = 0; i < count; i++) {
        const t = (i / count) * Math.PI * 2 * patternNumber;
        const sides = Math.min(patternNumber, 12); // Max 12 sides
        
        // Polygonal pattern
        const sideT = Math.floor(t / (Math.PI * 2 / sides)) % sides;
        const localT = (t % (Math.PI * 2 / sides)) / (Math.PI * 2 / sides);
        
        const angle1 = sideT * Math.PI * 2 / sides;
        const angle2 = (sideT + 1) * Math.PI * 2 / sides;
        
        points.push({
            x: Math.cos(angle1 + (angle2 - angle1) * localT) * scale,
            y: Math.sin(angle1 + (angle2 - angle1) * localT) * scale,
            z: Math.sin(t * 0.1) * scale * 0.2
        });
    }
    return points;
};

// Tree of Life Data - Enhanced 12-Node Configuration for Complete Energy Circuit
const getTreeOfLife = (scale: number = 1): { nodes: TreeNode[], edges: [number, number][] } => {
    const rawNodes: TreeNode[] = [
        // Traditional 10 Sephirot - Recentered for 12-node symmetry
        { x: 0 * scale, y: -3.5 * scale, z: 0 * scale, name: 'Malkuth', colorHex: '#FF0000', freqRange: [20, 80], currentEnergy: 0 }, 
        { x: 0 * scale, y: -0.5 * scale, z: 0 * scale, name: 'Yesod', colorHex: '#FF8C00', freqRange: [80, 200], currentEnergy: 0 },   
        { x: 0 * scale, y: 2.0 * scale, z: 0 * scale, name: 'Tiferet', colorHex: '#008000', freqRange: [200, 500], currentEnergy: 0 }, 
        { x: 0 * scale, y: 4.5 * scale, z: 0 * scale, name: 'Daat', colorHex: '#4B0082', freqRange: [2000, 4000], currentEnergy: 0 },    
        { x: 0 * scale, y: 6.5 * scale, z: 0 * scale, name: 'Keter', colorHex: '#EE82EE', freqRange: [8000, 20000], currentEnergy: 0 }, 
        { x: 2.0 * scale, y: -1.5 * scale, z: 0 * scale, name: 'Netzach', colorHex: '#FFD700', freqRange: [150, 300], currentEnergy: 0 }, 
        { x: 2.0 * scale, y: 1.0 * scale, z: 0 * scale, name: 'Chesed', colorHex: '#00BFFF', freqRange: [500, 1000], currentEnergy: 0 },  
        { x: 2.0 * scale, y: 5.0 * scale, z: 0 * scale, name: 'Chokhmah', colorHex: '#4B0082', freqRange: [4000, 8000], currentEnergy: 0 }, 
        { x: -2.0 * scale, y: -1.5 * scale, z: 0 * scale, name: 'Hod', colorHex: '#FFD700', freqRange: [150, 300], currentEnergy: 0 },
        { x: -2.0 * scale, y: 1.0 * scale, z: 0 * scale, name: 'Gevurah', colorHex: '#00BFFF', freqRange: [500, 1000], currentEnergy: 0 },
        { x: -2.0 * scale, y: 5.0 * scale, z: 0 * scale, name: 'Binah', colorHex: '#4B0082', freqRange: [2000, 4000], currentEnergy: 0 },
        
        // Additional 12th Node - SOURCE Connection (completing the energy circuit) - Perfectly positioned
        { x: 0 * scale, y: 8.0 * scale, z: 0 * scale, name: 'Ain Soph', colorHex: '#FFFFFF', freqRange: [12000, 22000], currentEnergy: 0 }
    ];

    // Enhanced edge connections for complete 12-node energy circuit
    const edges: [number, number][] = [
        // Original Tree connections
        [0, 1], [1, 5], [1, 8], [1, 2], [8, 5], [8, 2], [8, 9], [5, 2], [5, 6], 
        [2, 9], [2, 6], [2, 3], [9, 6], [9, 3], [9, 10], [6, 3], [6, 7], 
        [10, 7], [10, 3], [10, 4], [7, 3], [7, 4], [3, 4],
        
        // Additional SOURCE connections to complete the circuit
        [4, 11], // Keter to Ain Soph
        [7, 11], // Chokhmah to Ain Soph  
        [10, 11], // Binah to Ain Soph
        [3, 11]   // Daat to Ain Soph (hidden bridge completion)
    ];

    return { nodes: rawNodes, edges };
};

const Visualizer: React.FC<VisualizerProps> = ({
  analyser,
  primaryColor,
  isPlaying,
  settings,
  selectedFrequency,
  frequencyColorMode = 'chakra',
  loShuWalkMode = null,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const hexGridRef = useRef<HexCell[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const treeRef = useRef(getTreeOfLife(1));
  
  const timeRef = useRef(0);
  const prevFreqRef = useRef(0);
  
  // Audio History
  const prevBassRef = useRef(0);
  const prevHighRef = useRef(0);
  
  // Tempo Detection
  const beatHistoryRef = useRef<number[]>([]);
  const lastBeatTimeRef = useRef(0);
  const detectedBPMRef = useRef(120); // Default 120 BPM
  const smoothedBPMRef = useRef(120);
  
  // Performance optimization: Frame timing
  const lastFrameTimeRef = useRef(0);
  const frameCountRef = useRef(0);
  const targetFPSRef = useRef(60);
  
  // Initialize Particles - Reduced counts for better performance
  useEffect(() => {
    const pCount = settings.particleDensity === 'low' ? 200 : settings.particleDensity === 'medium' ? 400 : 800;
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

    // Initialize Hex Grid - Reduced for better performance
    const hexCells: HexCell[] = [];
    const size = 50; // Larger cells = fewer to render
    const cols = 20; // Reduced from 30
    const rows = 15; // Reduced from 20
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

    // COMPREHENSIVE SACRED GEOMETRY FREQUENCY MAPPING
    
    // Check for 111Hz pattern frequencies first
    if (selectedFrequency % 111 === 0 && selectedFrequency >= 111 && selectedFrequency <= 999) {
        newTargets = get111PatternPoints(selectedFrequency, pCount, scale);
    }
    // First Order (Physical Foundation)
    else if (selectedFrequency <= 180) {
        newTargets = getCubePoints(pCount, scale); // 174Hz - Earth/Stability
    } else if (selectedFrequency <= 300) {
        newTargets = getReikiPoints(pCount, scale); // 285Hz - Healing Energy
    }
    // Second Order (Emotional & Energetic)
    else if (selectedFrequency <= 400) {
        newTargets = getTetrahedronPoints(pCount, scale); // 396Hz - Fire/Liberation
    } else if (selectedFrequency <= 450) {
        newTargets = getIcosahedronPoints(pCount, scale); // 417Hz - Water/Change
    } else if (selectedFrequency <= 580) {
        newTargets = getOctahedronPoints(pCount, scale); // 528Hz - Air/DNA Transformation
    } else if (selectedFrequency <= 680) {
        newTargets = getMerkabaPoints(pCount, scale); // 639Hz - Connection/Integration
    }
    // Third Order (Mental & Spiritual)
    else if (selectedFrequency <= 780) {
        newTargets = getDodecahedronPoints(pCount, scale); // 741Hz - Expression/Ether
    } else if (selectedFrequency <= 900) {
        newTargets = getTorusPoints(pCount, scale); // 852Hz - Universal Flow
    } else if (selectedFrequency <= 1000) {
        newTargets = getFibonacciSpherePoints(pCount, scale); // 963Hz - Perfection/Completion
    }
    // Fourth Order (Higher Consciousness)
    else if (selectedFrequency <= 1150) {
        newTargets = getHypercubePoints(pCount, scale); // 1074Hz - 4D Transcendence
    } else if (selectedFrequency <= 1400) {
        newTargets = getFlowerOfLifePoints(pCount, scale); // 1317Hz - Universal Template
    } else if (selectedFrequency <= 1700) {
        newTargets = getMetatronsCubePoints(pCount, scale); // 1641Hz - Cosmic Order
    }
    // Fifth Order (Stellar & Galactic)
    else if (selectedFrequency <= 1850) {
        newTargets = getHyperdodecahedronPoints(pCount, scale); // 1752Hz - Stellar Consciousness
    } else if (selectedFrequency <= 2100) {
        newTargets = getGoldenSpiralGalaxyPoints(pCount, scale); // 1995Hz - Galactic Alignment
    } else if (selectedFrequency <= 2400) {
        newTargets = getIcosiDodecahedronPoints(pCount, scale); // 2319Hz - Multidimensional Access
    }
    // Sixth Order (Source Connection)
    else if (selectedFrequency <= 2550) {
        newTargets = getInfiniteTorusFieldPoints(pCount, scale); // 2430Hz - Universal Love Matrix
    } else if (selectedFrequency <= 2800) {
        newTargets = getSourceFractalMandalaPoints(pCount, scale); // 2673Hz - Divine Source Interface
    } else if (selectedFrequency <= 3000) {
        newTargets = getUnityConsciousnessSpherePoints(pCount, scale); // 2997Hz - Oneness Embodiment
    }
    // Seventh Order (Master Creation)
    else if (selectedFrequency <= 3200) {
        newTargets = getGenesisPolytopePoints(pCount, scale); // 3108Hz - Prime Creation
    } else if (selectedFrequency <= 3500) {
        newTargets = getDivineArchitectureMatrixPoints(pCount, scale); // 3351Hz - Sacred Blueprint
    } else if (selectedFrequency <= 4000) {
        newTargets = getAbsoluteUnityHologramPoints(pCount, scale); // 3675Hz - Complete Transcendence
    }
    // Beyond Seventh Order - return to Unity Sphere for ultra-high frequencies
    else {
        newTargets = getUnityConsciousnessSpherePoints(pCount, scale);
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

    // Reset on (re)mount so the first-frame guard below seeds a fresh baseline.
    // Without this, an effect re-run could leave lastFrameTimeRef holding a
    // very old timestamp, producing a time-jump on the first new frame.
    lastFrameTimeRef.current = 0;

    // Pre-calculate Color Palette
    const baseHSL = hexToHSL(primaryColor);
    const primaryStr = `hsla(${baseHSL.h}, ${baseHSL.s}%, ${baseHSL.l}%,`;
    const shade1Str = `hsla(${baseHSL.h}, ${Math.min(100, baseHSL.s + 15)}%, ${Math.max(10, baseHSL.l - 25)}%,`;
    const shade2Str = `hsla(${baseHSL.h}, ${Math.max(0, baseHSL.s - 15)}%, ${Math.min(95, baseHSL.l + 30)}%,`;

    // Reusable audio buffer — allocated once, resized only when bufferLength changes.
    // Allocating per-frame caused GC churn that visibly stuttered the loop.
    let dataArray = new Uint8Array(analyser ? analyser.frequencyBinCount : 0);

    const render = (timestamp?: number) => {
      // Initialize dynamic speed variable
      let dynamicSpeed = settings.speed;

      // Performance optimization: Stable frame rate limiting
      if (timestamp) {
        // First frame after mount/restart: seed lastFrameTime to avoid a
        // huge initial deltaTime that causes a time-jump on resume.
        if (lastFrameTimeRef.current === 0) {
          lastFrameTimeRef.current = timestamp;
          rafRef.current = requestAnimationFrame(render);
          return;
        }

        const deltaTime = timestamp - lastFrameTimeRef.current;

        // 30 FPS cap (~33.33ms/frame). This roughly halves the per-frame work
        // (trails fillRect, ripple draws, hex iterations, particle projection)
        // compared to 60 FPS — the right call once a scene is heavy enough
        // that 60 FPS produces GC hitches. Tradeoff: on a 60 Hz display each
        // rendered frame holds for two vsyncs, so motion looks slightly less
        // continuous than at 60 FPS, but there are no GC stutters to break it.
        const targetFrameTime = 33.33;

        // Skip frame if we're running too fast
        if (deltaTime < targetFrameTime) {
          rafRef.current = requestAnimationFrame(render);
          return;
        }

        // Account for multiple frames if we're running slow, but cap at 3
        // so that returning from a backgrounded tab (or an effect re-mount)
        // doesn't cause a huge time-jump in the animation.
        const framesToCatch = Math.min(3, Math.floor(deltaTime / targetFrameTime));
        lastFrameTimeRef.current = timestamp - (deltaTime % targetFrameTime);

        // Increment time based on actual frames rendered and music tempo
        // Base speed scaled up by 2.5x so that 1.0 = old 2.5
        const tempoSpeed = isPlaying ? dynamicSpeed : settings.speed;
        timeRef.current += (0.025 * tempoSpeed) * framesToCatch; // Changed from 0.01 to 0.025 (2.5x)
      }

      // 1. Resize Handling
      if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;

      // 2. Audio Data Analysis - Enhanced for Musical Responsiveness
      const bufferLength = analyser ? analyser.frequencyBinCount : 0;
      if (dataArray.length !== bufferLength) {
        dataArray = new Uint8Array(bufferLength);
      }
      if (analyser) analyser.getByteFrequencyData(dataArray);

      // More detailed frequency band analysis
      let bassEnergy = 0, midEnergy = 0, highEnergy = 0, subBassEnergy = 0;
      let peakFreqIndex = 0, peakValue = 0;
      
      if (bufferLength > 0 && isPlaying) {
          // Enhanced frequency band calculations
          const nyquist = 22050; // Half of 44.1kHz sample rate
          const binSize = nyquist / bufferLength;
          
          // Sub-bass: 20-60Hz (feel more than hear)
          const subBassStart = Math.floor(20 / binSize);
          const subBassEnd = Math.floor(60 / binSize);
          
          // Bass: 60-250Hz (kick drums, bass lines)
          const bassStart = Math.floor(60 / binSize);
          const bassEnd = Math.floor(250 / binSize);
          
          // Mid: 250-2000Hz (most melodic content, vocals)
          const midStart = Math.floor(250 / binSize);
          const midEnd = Math.floor(2000 / binSize);
          
          // High: 2000-8000Hz (harmonics, cymbals, clarity)
          const highStart = Math.floor(2000 / binSize);
          const highEnd = Math.floor(8000 / binSize);
          
          // Calculate energies with better averaging
          let subBassSum = 0, subBassCount = 0;
          for(let i = subBassStart; i < subBassEnd && i < bufferLength; i++) {
              subBassSum += dataArray[i];
              subBassCount++;
          }
          subBassEnergy = subBassCount > 0 ? (subBassSum / subBassCount) / 255 : 0;
          
          let bassSum = 0, bassCount = 0, peakBass = 0;
          for(let i = bassStart; i < bassEnd && i < bufferLength; i++) {
              const value = dataArray[i];
              bassSum += value;
              bassCount++;
              if (value > peakBass) peakBass = value;
          }
          // Combine average and peak for punch
          const avgBass = bassCount > 0 ? (bassSum / bassCount) / 255 : 0;
          bassEnergy = (peakBass / 255) * 0.7 + avgBass * 0.3;
          
          let midSum = 0, midCount = 0;
          for(let i = midStart; i < midEnd && i < bufferLength; i++) {
              const value = dataArray[i];
              midSum += value;
              midCount++;
              // Track overall peak frequency
              if (value > peakValue) {
                  peakValue = value;
                  peakFreqIndex = i;
              }
          }
          midEnergy = midCount > 0 ? (midSum / midCount) / 255 : 0;
          
          let highSum = 0, highCount = 0;
          for(let i = highStart; i < highEnd && i < bufferLength; i++) {
              highSum += dataArray[i];
              highCount++;
          }
          highEnergy = highCount > 0 ? (highSum / highCount) / 255 : 0;
          
          // Apply sensitivity multipliers
          bassEnergy *= settings.sensitivity * 1.2;
          midEnergy *= settings.sensitivity;
          highEnergy *= settings.sensitivity * 0.8;
          subBassEnergy *= settings.sensitivity * 1.5;
          
          // Clamp values
          bassEnergy = Math.min(1, bassEnergy);
          midEnergy = Math.min(1, midEnergy);
          highEnergy = Math.min(1, highEnergy);
          subBassEnergy = Math.min(1, subBassEnergy);
      }
      
      // Calculate spectral centroid for brightness detection
      let spectralCentroid = 0;
      if (bufferLength > 0 && isPlaying) {
          let weightedSum = 0, magnitudeSum = 0;
          for (let i = 0; i < bufferLength; i++) {
              const magnitude = dataArray[i];
              weightedSum += i * magnitude;
              magnitudeSum += magnitude;
          }
          if (magnitudeSum > 0) {
              spectralCentroid = (weightedSum / magnitudeSum) / bufferLength;
          }
      }

      // 3. Tree of Life Energy Updates - Enhanced frequency analysis
      let activeNodeColor: string | null = null;
      let highestNodeEnergy = 0;
      
      treeRef.current.nodes.forEach(node => {
         let nodeEnergy = 0;
         if (analyser && bufferLength > 0) {
            const nyquist = 22050;
            const binSize = nyquist / bufferLength;
            const startBin = Math.floor(node.freqRange[0] / binSize);
            const endBin = Math.ceil(node.freqRange[1] / binSize);
            
            // Enhanced energy calculation with peak detection
            let sum = 0, peakValue = 0, count = 0;
            for(let b = startBin; b < endBin && b < bufferLength; b++) { 
                const value = dataArray[b];
                sum += value; 
                if (value > peakValue) peakValue = value;
                count++; 
            }
            
            // Combine average and peak for better responsiveness
            const avgEnergy = count > 0 ? (sum / count) / 255 : 0;
            const peakEnergy = peakValue / 255;
            nodeEnergy = (avgEnergy * 0.4 + peakEnergy * 0.6); // Favor peaks
            
            // Apply different boosts based on frequency range
            if (node.freqRange[1] < 200) {
                nodeEnergy *= 3.0; // More boost for bass frequencies (harder to detect)
            } else if (node.freqRange[1] < 1000) {
                nodeEnergy *= 2.5; // Good boost for mids
            } else if (node.freqRange[1] < 4000) {
                nodeEnergy *= 2.0; // Moderate boost for high-mids
            } else {
                nodeEnergy *= 1.5; // Less boost for highs (already prominent)
            }
         }
         
         // More responsive decay with frequency-based rates
         const decayRate = node.freqRange[1] < 500 ? 0.85 : 0.92; // Bass decays faster
         node.currentEnergy = Math.max(0, (node.currentEnergy || 0) * decayRate + nodeEnergy * (1 - decayRate));

         // Lower threshold for activation to make nodes more responsive
         if (node.currentEnergy > 0.25 && node.currentEnergy > highestNodeEnergy) {
             highestNodeEnergy = node.currentEnergy;
             activeNodeColor = node.colorHex;
         }
      });

      // 5. Water Ripples Logic - Highly sensitive for 50% intensity
      if (settings.showWaterRipples && isPlaying) {
           const rawInput = settings.hydroIntensity || 0;
           // Linear scaling for predictable behavior
           const normalizedLinear = rawInput / 100; // 0 to 1 linear
           
           // Bass ripples - Responsive wave effect on bass hits
           // Dynamic threshold based on intensity (lower = more sensitive)
           const bassThreshold = 0.3 - (normalizedLinear * 0.25); // At 50%: 0.175
           
           // Peak detection - looking for sudden increases
           const bassDelta = 0.08; // Clear jump required
           
           // Cooldown between ripples
           const now = Date.now();
           const lastBassRipple = (window as any).lastBassRipple || 0;
           const cooldown = 250 - (normalizedLinear * 100); // At 50%: 200ms
           
           // Enhanced ripple triggering with multiple frequency responses
           const bassIncreased = bassEnergy > prevBassRef.current + bassDelta;
           const subBassHit = subBassEnergy > 0.6; // Deep bass creates center ripples
           const aboveThreshold = bassEnergy > bassThreshold;
           const cooldownMet = (now - lastBassRipple) > cooldown;
           
           // Cap-respecting push so we never let the ripple pool grow unbounded.
           const pushRipple = (r: Ripple) => {
              if (ripplesRef.current.length < MAX_ACTIVE_RIPPLES) {
                  ripplesRef.current.push(r);
              }
           };

           if ((bassIncreased && aboveThreshold && cooldownMet) || (subBassHit && cooldownMet)) {
              (window as any).lastBassRipple = now;

              // Create expanding wave ripple with frequency-based characteristics
              const rippleStrength = subBassHit ? subBassEnergy : bassEnergy;
              const rippleSize = subBassHit ? 0.9 : 0.7;

              pushRipple({
                  x: cx + (subBassHit ? 0 : (Math.random() - 0.5) * 100), // Sub-bass always center
                  y: cy + (subBassHit ? 0 : (Math.random() - 0.5) * 100),
                  radius: 20 * (1 + rippleStrength),
                  maxRadius: Math.max(w, h) * rippleSize,
                  alpha: 0.5 + rippleStrength * 0.3,
                  speed: 8.75 * settings.speed * (1 + rippleStrength * 0.5), // 3.5 * 2.5 = 8.75
                  color: subBassHit ? shade1Str : primaryStr,
                  type: 'bass'
              });

              // Inner impact ripple — pushed inline rather than via a 50ms
              // setTimeout. The previous setTimeout-per-beat pattern fired
              // ~60 times/sec at heavy bass, each allocating a closure that
              // outlived the frame, contributing to GC pauses.
              pushRipple({
                  x: cx,
                  y: cy,
                  radius: 10,
                  maxRadius: Math.max(w, h) * 0.5,
                  alpha: 0.3 + rippleStrength * 0.2,
                  speed: 7.5 * settings.speed, // 3 * 2.5 = 7.5
                  color: primaryStr,
                  type: 'bass'
              });
           }

           // Mid-frequency ripples at random positions
           if (midEnergy > 0.5 && Math.random() < midEnergy * normalizedLinear) {
              pushRipple({
                  x: cx + (Math.random() - 0.5) * w * 0.6,
                  y: cy + (Math.random() - 0.5) * h * 0.6,
                  radius: 5,
                  maxRadius: 150 + midEnergy * 100,
                  alpha: 0.4 + midEnergy * 0.3,
                  speed: 6.25 * settings.speed, // 2.5 * 2.5 = 6.25
                  color: shade2Str,
                  type: 'rain'
              });
           }

           // Rain ripples - continuous at 50% and above
           const rainThreshold = 0.3 - normalizedLinear * 0.25; // Very low threshold

           // At 50%, create rain effect continuously
           if (normalizedLinear >= 0.5 || (highEnergy > rainThreshold && Math.random() < normalizedLinear)) {
              const numDrops = 1 + Math.floor(normalizedLinear * 2); // 1-3 drops
              for (let i = 0; i < numDrops; i++) {
                  pushRipple({
                      x: Math.random() * w,
                      y: Math.random() * h,
                      radius: 0,
                      maxRadius: 80 + (normalizedLinear * 120),
                      alpha: 0.3 + (normalizedLinear * 0.4),
                      speed: 5 * settings.speed, // 2 * 2.5 = 5
                      color: Math.random() > 0.5 ? shade2Str : shade1Str,
                      type: 'rain'
                  });
              }
           }
      }
      // Tempo Detection - Beat tracking
      const currentTime = performance.now();
      
      // Detect beats based on bass energy peaks
      const beatThreshold = 0.6;
      const beatDetected = bassEnergy > beatThreshold && bassEnergy > prevBassRef.current + 0.1;
      
      if (beatDetected && currentTime - lastBeatTimeRef.current > 200) { // Min 200ms between beats
        const timeSinceLastBeat = currentTime - lastBeatTimeRef.current;
        lastBeatTimeRef.current = currentTime;
        
        if (timeSinceLastBeat < 2000) { // Only consider beats within 2 seconds
          beatHistoryRef.current.push(timeSinceLastBeat);
          
          // Keep only last 8 beats
          if (beatHistoryRef.current.length > 8) {
            beatHistoryRef.current.shift();
          }
          
          // Calculate BPM from beat intervals
          if (beatHistoryRef.current.length >= 4) {
            const avgInterval = beatHistoryRef.current.reduce((a, b) => a + b) / beatHistoryRef.current.length;
            const bpm = 60000 / avgInterval; // Convert ms interval to BPM
            
            // Clamp BPM to reasonable range
            if (bpm >= 60 && bpm <= 200) {
              detectedBPMRef.current = bpm;
            }
          }
        }
      }
      
      // Smooth BPM changes
      smoothedBPMRef.current = smoothedBPMRef.current * 0.9 + detectedBPMRef.current * 0.1;
      
      // Calculate tempo-based speed multiplier
      const tempoMultiplier = smoothedBPMRef.current / 120; // Normalized to 120 BPM baseline
      dynamicSpeed = settings.speed * tempoMultiplier; // Update the existing variable
      
      prevBassRef.current = bassEnergy;
      prevHighRef.current = highEnergy;

      // CLEAR SCREEN
      ctx.globalCompositeOperation = 'source-over';
      // Astral Trails Logic: Don't fully clear if trails are enabled
      ctx.fillStyle = settings.enableTrails ? 'rgba(0, 0, 0, 0.15)' : '#000000';
      ctx.fillRect(0, 0, w, h);

      // --- LAYER 1: HEX GRID ---
      if (settings.showHexagons) {
          ctx.save();
          ctx.translate(cx, cy);

          // Cull off-screen hexagons in-place. The previous .filter() built
          // a fresh ~600-entry array every frame (~36k objects/sec at 60fps)
          // — major GC pressure during music playback. We now skip hidden
          // cells inside the forEach with no allocation.
          hexGridRef.current.forEach((hex: HexCell) => {
              const screenX = cx + hex.x;
              const screenY = cy + hex.y;
              if (
                  screenX < -hex.size || screenX > w + hex.size ||
                  screenY < -hex.size || screenY > h + hex.size
              ) {
                  return;
              }
              let active = 0;
              if (isPlaying && bufferLength > 0) {
                  if (settings.hexVisualMode === 'spectrum') {
                      // Enhanced spectrum mode with frequency mapping
                      const freqBin = Math.min(hex.freqIndex % bufferLength, bufferLength - 1);
                      const rawValue = dataArray[freqBin] / 255;
                      // Apply spectral weighting based on position
                      const distanceFactor = 1 - (hex.dist / 1000);
                      active = rawValue * 1.5 * distanceFactor;
                  }
                  else if (settings.hexVisualMode === 'pulse') {
                      // Enhanced pulse mode responding to multiple frequency bands
                      const radialWave = Math.sin(timeRef.current * 2 - hex.dist * 0.01);
                      if (radialWave > 0.7) {
                          // Different rings respond to different frequencies
                          const ringZone = hex.dist / 200; // Which ring zone
                          if (ringZone < 1) active = subBassEnergy; // Inner ring: sub-bass
                          else if (ringZone < 2) active = bassEnergy; // Second ring: bass
                          else if (ringZone < 3) active = midEnergy; // Third ring: mids
                          else active = highEnergy; // Outer rings: highs
                      }
                  }
                  else { // Wave mode
                      // Enhanced wave with frequency-reactive flow
                      const waveX = Math.sin(hex.x * 0.01 + timeRef.current * (1 + bassEnergy));
                      const waveY = Math.cos(hex.y * 0.01 + timeRef.current * (1 + midEnergy));
                      active = Math.max(0, waveX * waveY * (bassEnergy * 0.5 + midEnergy * 0.3 + highEnergy * 0.2));
                  }
              }
              if (hex.colorType !== 'primary' && isPlaying) active = Math.max(0, Math.min(1, active + (Math.random() - 0.5) * 0.3 * settings.sensitivity));
              
              let waveLift = 0;
              if (settings.showWaterRipples && isPlaying) {
                  // Hot path: this runs O(visibleHexes × activeRipples) per frame
                  // (~600 × up to 80 = ~48k iterations/sec at 60fps). Reject far
                  // ripples with a cheap bounding-box test before the sqrt — most
                  // hex/ripple pairs are far apart and this short-circuits the
                  // expensive distance math, which was a major contributor to the
                  // jank you were seeing with ripples + trails active.
                  const ripples = ripplesRef.current;
                  for (let ri = 0; ri < ripples.length; ri++) {
                      const r = ripples[ri];
                      const dx = hex.x - (r.x - cx);
                      const dy = hex.y - (r.y - cy);
                      const waveWidth = r.type === 'bass' ? 50 : 30;
                      const maxReach = r.radius + waveWidth;
                      // Square-bounds rejection — no sqrt, no Math.abs, just two compares.
                      if (dx > maxReach || dx < -maxReach || dy > maxReach || dy < -maxReach) continue;
                      const distToWaveFront = Math.abs(Math.sqrt(dx * dx + dy * dy) - r.radius);
                      if (distToWaveFront < waveWidth) {
                          waveLift += (1 - (distToWaveFront / waveWidth)) * r.alpha;
                      }
                  }
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
              // Different fade rates for different ripple types. Bumped from
              // 0.006/0.004 — slightly faster decay shrinks the average live
              // ripple pool by ~30%, which directly reduces work in the
              // O(visibleHexes × ripples) wave-lift loop above. Still slow
              // enough to read as a wave, just less long-tailed buildup.
              if (r.type === 'bass') {
                  r.alpha -= 0.008;
              } else {
                  r.alpha -= 0.006;
              }
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

      // --- LAYER 3: TREE OF LIFE (3D Sephirot + High-Vis SUPERCHARGED Flow) ---
      if (settings.showTreeOfLife) {
        ctx.save();
        const breathing = Math.sin(timeRef.current * 0.5) * 3;

        // Per-node absolute screen positions. Two modes:
        //   - cube-aligned: each tree node maps into the matching cube layer
        //     (GUT / HEART / HEAD) so the tree reads as the cube's internal
        //     scaffolding rather than a separate diagram floating beside it.
        //   - default: original centred tree layout.
        let nodePositions: { sx: number; sy: number }[];
        let scaleUnit: number;

        if (settings.showLoShuCube) {
          // Mirror the cube's layout math so the tree fills the cube's
          // volume — every node is anchored to a specific sub-cube grid
          // position and rotates with the cube via the same project()
          // transform used in LAYER 3.5.
          const STEP = 2;
          const TOTAL_EXTENT = 3 * STEP - 1; // 5
          const CUBE_CENTRE_GRID = TOTAL_EXTENT / 2; // 2.5
          const cellSize = Math.min(22, Math.min(w, h) / 22) * 1.5625;
          const COS30 = Math.cos(Math.PI / 6);
          const SIN30 = Math.sin(Math.PI / 6);
          const isoX = cellSize * COS30;
          const isoY = cellSize * SIN30;
          const heightUnit = cellSize;
          const centreScreenY = (CUBE_CENTRE_GRID + CUBE_CENTRE_GRID) * isoY - CUBE_CENTRE_GRID * heightUnit;
          const turn = settings.loShuCubeAutoRotate
            ? timeRef.current * 0.18
            : (settings.loShuCubeRotation * Math.PI) / 180;

          // Project (gridX, gridY, gridZ) → absolute screen coords. Same
          // rotation and translation as the cube layer below, so the tree
          // and cube share one coordinate system.
          const project = (gxg: number, gyg: number, gzg: number) => {
            const rx = gxg - CUBE_CENTRE_GRID;
            const rz = gzg - CUBE_CENTRE_GRID;
            const cosT = Math.cos(turn);
            const sinT = Math.sin(turn);
            const xr = rx * cosT - rz * sinT + CUBE_CENTRE_GRID;
            const zr = rx * sinT + rz * cosT + CUBE_CENTRE_GRID;
            return {
              sx: cx + (xr - zr) * isoX,
              sy: (cy - centreScreenY) + (xr + zr) * isoY - gyg * heightUnit,
            };
          };

          // Each tree node anchored to a specific sub-cube centre (or
          // beyond the cube for the extreme nodes Ain Soph / Malkuth / Daat).
          // Grid coords: x and z use the centre of each sub-cube column
          // (0.5 = left, 2.5 = centre, 4.5 = right). y uses the layer
          // centres (GUT=0.5, HEART=2.5, HEAD=4.5).
          const TREE_TO_GRID: Record<string, [number, number, number]> = {
            'Ain Soph': [2.5, 6.0, 2.5],   // above HEAD center
            'Keter':    [2.5, 4.5, 2.5],   // HEAD center cube
            'Daat':     [2.5, 3.5, 2.5],   // between HEART and HEAD layers
            'Tiferet':  [2.5, 2.5, 2.5],   // HEART center cube (SOURCE)
            'Yesod':    [2.5, 0.5, 2.5],   // GUT center cube
            'Malkuth':  [2.5, -1.0, 2.5],  // below GUT
            'Binah':    [0.5, 4.5, 2.5],   // HEAD left column (gx=0)
            'Chokhmah': [4.5, 4.5, 2.5],   // HEAD right column (gx=2)
            'Gevurah':  [0.5, 2.5, 2.5],   // HEART left column
            'Chesed':   [4.5, 2.5, 2.5],   // HEART right column
            'Hod':      [0.5, 0.5, 2.5],   // GUT left column
            'Netzach':  [4.5, 0.5, 2.5],   // GUT right column
          };

          scaleUnit = cellSize * 0.55; // drives node radius + label offsets
          nodePositions = treeRef.current.nodes.map((node: TreeNode) => {
            const anchor = TREE_TO_GRID[node.name];
            if (!anchor) {
              // Fallback: project from raw node coords (should not happen
              // for the 12 named nodes).
              const p = project(node.x + CUBE_CENTRE_GRID, node.y, CUBE_CENTRE_GRID);
              return { sx: p.sx, sy: p.sy + breathing };
            }
            const [gxg, gyg, gzg] = anchor;
            const p = project(gxg, gyg, gzg);
            return { sx: p.sx, sy: p.sy + breathing };
          });
        } else {
          // Default centred layout — the original tree positioning.
          const availableHeight = h - 160;
          const treeHeight = 11.5;
          scaleUnit = Math.min(35, availableHeight / treeHeight);
          const treeOffsetY = cy + (scaleUnit * 1.5);
          nodePositions = treeRef.current.nodes.map((node: TreeNode) => ({
            sx: cx + node.x * scaleUnit,
            sy: treeOffsetY + (-node.y * scaleUnit + breathing),
          }));
        }

        // Use additive blending for energy feel
        ctx.globalCompositeOperation = 'lighter';

        // 1. Edges with Supercharged Energy Flow
        treeRef.current.edges.forEach(([startIdx, endIdx], i) => {
            const sn = treeRef.current.nodes[startIdx];
            const en = treeRef.current.nodes[endIdx];
            const { sx, sy } = nodePositions[startIdx];
            const { sx: ex, sy: ey } = nodePositions[endIdx];

            // Average energy of the connection
            const connectionEnergy = (sn.currentEnergy + en.currentEnergy) / 2;
            const boost = connectionEnergy * 2; // Multiplier for intense moments

            // Background Line (Pulsing)
            const grad = ctx.createLinearGradient(sx, sy, ex, ey);
            grad.addColorStop(0, sn.colorHex); 
            grad.addColorStop(1, en.colorHex);
            
            ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
            ctx.strokeStyle = grad; 
            ctx.globalAlpha = 0.2 + (boost * 0.1); 
            ctx.lineWidth = 2 + boost; 
            ctx.stroke();

            // Supercharged Comet - Calmer flow
            const baseIntensity = 0.2;
            // Total intensity determines visibility
            const flowIntensity = baseIntensity + (boost * 1.5);
            
            if (flowIntensity > 0.1) {
                // PHYSICS: Flow speed responds to music tempo but stays relatively calm
                const flowSpeed = 0.0003 * dynamicSpeed; // Tempo-based but still meditative (0.00012 * 2.5 = 0.0003)
                const steadyTime = Date.now() * flowSpeed; 
                const phase = ((steadyTime + (i * 0.7)) % 1);
                
                const px = sx + (ex - sx) * phase;
                const py = sy + (ey - sy) * phase;

                const tailLength = 0.4 + (boost * 0.2); // Tail grows with energy
                
                // Color Logic: Responds to frequency content
                const isSupercharged = boost > 0.8;
                const isHighFreq = highEnergy > 0.5;
                const headColor = isSupercharged ? '#ffffff' : (isHighFreq ? en.colorHex : sn.colorHex);

                const cometGrad = ctx.createLinearGradient(
                    sx + (ex-sx) * (phase - tailLength), 
                    sy + (ey-sy) * (phase - tailLength),
                    px, py
                );
                cometGrad.addColorStop(0, 'rgba(0,0,0,0)');
                cometGrad.addColorStop(0.5, sn.colorHex); // Mid body is color
                cometGrad.addColorStop(1, headColor); // Head is bright

                // Draw Comet Tail
                const t0 = Math.max(0, phase - tailLength);
                if (phase > 0) {
                    ctx.beginPath();
                    ctx.moveTo(sx + (ex-sx)*t0, sy + (ey-sy)*t0);
                    ctx.lineTo(px, py);
                    ctx.strokeStyle = cometGrad;
                    // Thickness responds to energy but more subtly
                    const thickness = 4 + (boost * 8); // Simpler calculation
                    ctx.lineWidth = thickness;
                    ctx.lineCap = 'round';
                    // Glow effect varies with energy
                    ctx.shadowBlur = 10 + (boost * 25);
                    ctx.shadowColor = isSupercharged ? headColor : sn.colorHex;
                    ctx.stroke();
                }

                // Draw Comet Head (The "Spark")
                ctx.beginPath();
                // Size responds to energy but more subtly
                const headSize = 3 + (boost * 5);
                ctx.arc(px, py, headSize, 0, Math.PI * 2);
                ctx.fillStyle = headColor;
                ctx.shadowBlur = 20 + (boost * 30);
                ctx.shadowColor = isSupercharged ? '#ffffff' : headColor;
                ctx.fill();
                
                // Reset shadow
                ctx.shadowBlur = 0;
            }
        });

        ctx.globalCompositeOperation = 'source-over';

        // 2. 3D Spherical Nodes (Sephirot)
        treeRef.current.nodes.forEach((node: TreeNode, idx: number) => {
            const { sx: nx, sy: ny } = nodePositions[idx];
            // Reduced base radius for less crowding on small screens (0.35 -> 0.20)
            const baseRadius = scaleUnit * 0.20;
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
            
            // B. 3D Sphere Rendering
            const lightOffsetX = nx - r * 0.3;
            const lightOffsetY = ny - r * 0.3;
            
            const sphereGrad = ctx.createRadialGradient(
                lightOffsetX, lightOffsetY, r * 0.1, 
                nx, ny, r                            
            );
            
            sphereGrad.addColorStop(0, '#ffffff'); 
            sphereGrad.addColorStop(0.2, node.colorHex); 
            sphereGrad.addColorStop(0.5, node.colorHex); 
            sphereGrad.addColorStop(0.85, '#000000'); 
            sphereGrad.addColorStop(1, 'rgba(0,0,0,0)');

            ctx.beginPath();
            ctx.arc(nx, ny, r, 0, Math.PI * 2);
            ctx.fillStyle = sphereGrad;
            ctx.fill();

            // C. Rim Light
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

      // --- LAYER 3.5: LO SHU CUBE (translucent 3x3x3 rubix-style) ---
      if (settings.showLoShuCube) {
        ctx.save();

        // Cube layout: each sub-cube is 1 grid unit, separated by a 1-unit
        // gap so the walk-path lines have room to thread between them.
        // Total grid extent = 3 cubes × 1 + 2 gaps × 1 = 5 units. Cube i
        // occupies [i*step, i*step + 1] along each axis.
        const STEP = 2;
        const TOTAL_EXTENT = 3 * STEP - 1; // = 5 (last cube extends to gx*step+1)
        const CUBE_CENTRE_GRID = TOTAL_EXTENT / 2; // = 2.5

        // Find the active sub-cube (if the current frequency lands on one
        // of the 27 positions). gx, gy, gz are 0..2 grid coordinates.
        let activeGx = -1, activeGy = -1, activeGz = -1;
        outer: for (let gy = 0; gy < 3; gy++) {
          for (let gz = 0; gz < 3; gz++) {
            for (let gx = 0; gx < 3; gx++) {
              const gridIndex = gz * 3 + gx;
              const position = LO_SHU_GRID_ORDER[gridIndex];
              if (LO_SHU_CUBE_FREQS[gy][position - 1] === selectedFrequency) {
                activeGx = gx; activeGy = gy; activeGz = gz;
                break outer;
              }
            }
          }
        }
        const hasActive = activeGx !== -1;
        const pulse = Math.sin(timeRef.current * 1.6) * 0.5 + 0.5;
        // Cube rotation: auto-rotate (slow turntable) or hold at the user's
        // manual angle. The manual value is in degrees for the UI; convert
        // to radians for the projection. Default 0 = front-on iso view.
        const turn = settings.loShuCubeAutoRotate
          ? timeRef.current * 0.18
          : (settings.loShuCubeRotation * Math.PI) / 180;

        // True isometric angles — 30° from horizontal — so all three faces
        // of every sub-cube render as identical rhombuses (symmetrical).
        const cellSize = Math.min(22, Math.min(w, h) / 22) * 1.5625;
        const COS30 = Math.cos(Math.PI / 6); // ≈ 0.866
        const SIN30 = Math.sin(Math.PI / 6); // 0.5
        const isoX = cellSize * COS30;       // horizontal step per grid unit
        const isoY = cellSize * SIN30;       // vertical step per grid unit
        const heightUnit = cellSize;         // vertical step per layer (gy)

        // Centre the cube on screen. Iso projection of the cube centre at
        // grid (2.5, 2.5, 2.5), accounting for height.
        const centreScreenY = (CUBE_CENTRE_GRID + CUBE_CENTRE_GRID) * isoY - CUBE_CENTRE_GRID * heightUnit;
        // When both Tree of Life and Lo Shu cube are on, layer them centered
        // (cube renders on top of the tree via the painter's algorithm and the
        // 'lighter' blend mode, so the two visuals stack rather than fight for
        // space).
        ctx.translate(cx, cy - centreScreenY);

        // Project a (rotated) 3D grid point onto screen.
        const project = (x: number, y: number, z: number) => {
          // Rotate around the vertical axis through the cube's geometric centre.
          const rx = x - CUBE_CENTRE_GRID, rz = z - CUBE_CENTRE_GRID;
          const cosT = Math.cos(turn), sinT = Math.sin(turn);
          const xr = rx * cosT - rz * sinT + CUBE_CENTRE_GRID;
          const zr = rx * sinT + rz * cosT + CUBE_CENTRE_GRID;
          return {
            sx: (xr - zr) * isoX,
            sy: (xr + zr) * isoY - y * heightUnit,
            depth: xr + zr + y * 0.5, // higher = closer to viewer
          };
        };

        // Helper: parse "#rrggbb" into r/g/b ints so we can build rgba()
        // strings with arbitrary alpha for translucent fills.
        const hexToRgb = (hex: string) => {
          const s = hex.replace('#', '');
          if (s.length !== 6) return { r: 200, g: 200, b: 200 };
          return {
            r: parseInt(s.slice(0, 2), 16),
            g: parseInt(s.slice(2, 4), 16),
            b: parseInt(s.slice(4, 6), 16),
          };
        };
        const rgba = (hex: string, a: number) => {
          const { r, g, b } = hexToRgb(hex);
          return `rgba(${r},${g},${b},${a.toFixed(3)})`;
        };

        // Build the 27 sub-cubes with their colour + active flag. We also
        // index by frequency so the walk-path renderer below can look up
        // each cube's screen position.
        type Sub = { gx: number; gy: number; gz: number; freq: number; color: string; active: boolean; depth: number };
        const subs: Sub[] = [];
        const cubeByFreq = new Map<number, Sub>();
        for (let gy = 0; gy < 3; gy++) {
          for (let gz = 0; gz < 3; gz++) {
            for (let gx = 0; gx < 3; gx++) {
              const gridIndex = gz * 3 + gx;
              const position = LO_SHU_GRID_ORDER[gridIndex];
              const freq = LO_SHU_CUBE_FREQS[gy][position - 1];
              const color = frequencyColorMode === 'spectrum'
                ? frequencyToSpectrumColor(freq)
                : LO_SHU_CUBE_CHAKRA_COLORS[gy][position - 1];
              // Use the centre of each cube for depth sorting.
              const c = project(gx * STEP + 0.5, gy * STEP + 0.5, gz * STEP + 0.5);
              const sub: Sub = { gx, gy, gz, freq, color, active: gx === activeGx && gy === activeGy && gz === activeGz, depth: c.depth };
              subs.push(sub);
              cubeByFreq.set(freq, sub);
            }
          }
        }
        // Painter's algorithm: draw far cubes first so closer translucent
        // cubes layer correctly on top.
        subs.sort((a, b) => a.depth - b.depth);

        const drawFace = (
          v0: { sx: number; sy: number },
          v1: { sx: number; sy: number },
          v2: { sx: number; sy: number },
          v3: { sx: number; sy: number },
          color: string,
          fillAlpha: number,
          edgeAlpha: number,
          edgeWidth: number,
        ) => {
          ctx.beginPath();
          ctx.moveTo(v0.sx, v0.sy);
          ctx.lineTo(v1.sx, v1.sy);
          ctx.lineTo(v2.sx, v2.sy);
          ctx.lineTo(v3.sx, v3.sy);
          ctx.closePath();
          ctx.fillStyle = rgba(color, fillAlpha);
          ctx.fill();
          ctx.lineWidth = edgeWidth;
          ctx.strokeStyle = rgba(color, edgeAlpha);
          ctx.stroke();
        };

        // Soft contact shadow under the cube — the wide blurry oval grounds
        // it visually, like the reflection in the reference image.
        ctx.save();
        const shadowCx = 0;
        const shadowCy = (1.5 + 1.5) * isoY + heightUnit * 0.4;
        const grad = ctx.createRadialGradient(shadowCx, shadowCy, 0, shadowCx, shadowCy, isoX * 4);
        grad.addColorStop(0, 'rgba(80,80,140,0.35)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(shadowCx, shadowCy, isoX * 3.6, isoY * 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // We defer rendering the active sub-cube's Hz label until after the
        // entire cube has been drawn — otherwise sub-cubes that get painted
        // later (closer to the viewer) can sit on top of it. This is the
        // "lift to top of z-order" the label needs to stay readable.
        let activeLabel: { sx: number; sy: number; freq: number; color: string } | null = null;

        for (const sub of subs) {
          const { gx, gy, gz, color, active, freq } = sub;
          // Cube origin in grid space (with gaps applied).
          const ox = gx * STEP, oy = gy * STEP, oz = gz * STEP;

          // 7 visible corners (the back-bottom-back v000 isn't part of any
          // visible face in our standard iso view, so we skip it).
          const v100 = project(ox + 1, oy,     oz);
          const v110 = project(ox + 1, oy + 1, oz);
          const v010 = project(ox,     oy + 1, oz);
          const v001 = project(ox,     oy,     oz + 1);
          const v101 = project(ox + 1, oy,     oz + 1);
          const v111 = project(ox + 1, oy + 1, oz + 1);
          const v011 = project(ox,     oy + 1, oz + 1);

          // Translucency depth — outer cubes lighter, with the active one
          // popping. Each face has a slightly different alpha so the cube
          // reads as 3D rather than flat.
          const baseFill = active ? 0.55 + 0.30 * pulse : (hasActive ? 0.18 : 0.32);
          const baseEdge = active ? 0.95 : 0.55;

          // Top (y+1) face — visible from above.
          drawFace(v010, v110, v111, v011, color, baseFill * 1.15, baseEdge, active ? 1.6 : 0.9);
          // Right (x+1) face.
          drawFace(v100, v110, v111, v101, color, baseFill * 0.85, baseEdge * 0.85, active ? 1.5 : 0.8);
          // Front (z+1) face.
          drawFace(v001, v101, v111, v011, color, baseFill * 1.0, baseEdge, active ? 1.6 : 0.9);

          // Highlight the active cube with an extra glow halo around all
          // three visible faces, plus the freq label in the centre.
          if (active) {
            ctx.save();
            ctx.shadowColor = color;
            ctx.shadowBlur = 22 + 14 * pulse;
            ctx.strokeStyle = rgba(color, 0.95);
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(v010.sx, v010.sy);
            ctx.lineTo(v110.sx, v110.sy);
            ctx.lineTo(v111.sx, v111.sy);
            ctx.lineTo(v011.sx, v011.sy);
            ctx.closePath();
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(v100.sx, v100.sy);
            ctx.lineTo(v110.sx, v110.sy);
            ctx.lineTo(v111.sx, v111.sy);
            ctx.lineTo(v101.sx, v101.sy);
            ctx.closePath();
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(v001.sx, v001.sy);
            ctx.lineTo(v101.sx, v101.sy);
            ctx.lineTo(v111.sx, v111.sy);
            ctx.lineTo(v011.sx, v011.sy);
            ctx.closePath();
            ctx.stroke();
            ctx.restore();

            // Record the Hz label's screen position — actual drawing
            // happens after the loop so nothing paints over it.
            activeLabel = {
              sx: (v001.sx + v101.sx + v111.sx + v011.sx) / 4,
              sy: (v001.sy + v101.sy + v111.sy + v011.sy) / 4,
              freq,
              color,
            };
          }
        }

        // Walk-path overlay helper. Used for the active walk (with
        // played/leading/upcoming highlighting) AND for preview paths
        // toggled from the Lo Shu card (currentStep = -1 → a traveling
        // glow walks each path on a continuous loop, showing direction
        // and order without a playlist). Drawn after all cubes so the
        // line reads as light passing through the (translucent) cube.
        //
        // Preview-glow timing: phase advances ~1.35 segments/sec at
        // default tempo (timeRef.current rises ~0.75/sec). A 27-step
        // walk loops every ~20 seconds. Three preview walks share the
        // same phase so the user can see all three walks' "position N"
        // light up simultaneously when multiple toggles are on.
        const PREVIEW_GLOW_WINDOW = 2.5; // segments either side of phase to glow
        const drawWalkPath = (walkFreqs: number[], currentStep: number) => {
          type Pt = { sx: number; sy: number; depth: number; freq: number };
          const points: Pt[] = walkFreqs
            .map((freq: number) => {
              const c = cubeByFreq.get(freq);
              if (!c) return null;
              const p = project(c.gx * STEP + 0.5, c.gy * STEP + 0.5, c.gz * STEP + 0.5);
              return { sx: p.sx, sy: p.sy, depth: p.depth, freq } as Pt;
            })
            .filter((x: Pt | null): x is Pt => x !== null);

          const isPreview = currentStep < 0;
          const previewPhase = isPreview
            ? (timeRef.current * 1.8) % walkFreqs.length
            : -1;
          // Glow strength for segment index i — gaussian-ish falloff from
          // the traveling phase. Returns 0..1.
          const glowAt = (i: number): number => {
            if (!isPreview) return 0;
            const dist = Math.abs(i - previewPhase);
            return Math.max(0, 1 - dist / PREVIEW_GLOW_WINDOW);
          };

          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (let i = 0; i < points.length - 1; i++) {
            const a = points[i];
            const b = points[i + 1];
            const isPlayed = currentStep >= 0 && i < currentStep;
            const isLeading = currentStep >= 0 && i === currentStep - 1;
            const aColor = cubeByFreq.get(a.freq)!.color;
            const bColor = cubeByFreq.get(b.freq)!.color;
            const grad = ctx.createLinearGradient(a.sx, a.sy, b.sx, b.sy);
            let alpha: number;
            let width: number;
            if (isPreview) {
              // Static dim base so the whole shape is visible, plus a
              // traveling glow boost near previewPhase.
              const glow = glowAt(i);
              alpha = 0.38 + 0.55 * glow;
              width = 1.6 + 1.6 * glow;
            } else {
              alpha = isLeading ? 0.95 : isPlayed ? 0.7 : 0.22;
              width = isLeading ? 3 : isPlayed ? 2 : 1;
            }
            grad.addColorStop(0, `rgba(${hexToRgb(aColor).r},${hexToRgb(aColor).g},${hexToRgb(aColor).b},${alpha})`);
            grad.addColorStop(1, `rgba(${hexToRgb(bColor).r},${hexToRgb(bColor).g},${hexToRgb(bColor).b},${alpha})`);
            ctx.strokeStyle = grad;
            ctx.lineWidth = width;
            if (isPreview) {
              const glow = glowAt(i);
              if (glow > 0.2) {
                ctx.shadowColor = bColor;
                ctx.shadowBlur = 10 * glow;
              } else {
                ctx.shadowBlur = 0;
              }
            } else if (isPlayed || isLeading) {
              ctx.shadowColor = bColor;
              ctx.shadowBlur = isLeading ? 14 + 6 * pulse : 8;
            } else {
              ctx.shadowBlur = 0;
            }
            ctx.beginPath();
            ctx.moveTo(a.sx, a.sy);
            ctx.lineTo(b.sx, b.sy);
            ctx.stroke();
          }
          ctx.shadowBlur = 0;

          // Small dots at each cube centre — like beads on the thread.
          // Preview mode swells/brightens the dot under the traveling phase;
          // active mode highlights played and current positions.
          for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const isPlayed = currentStep >= 0 && i <= currentStep;
            const isCurrent = i === currentStep;
            const col = cubeByFreq.get(p.freq)!.color;
            let dotR: number;
            let dotFill: string;
            if (isPreview) {
              const glow = glowAt(i);
              dotR = 1.4 + 2.4 * glow;
              dotFill = rgba(col, 0.5 + 0.45 * glow);
            } else {
              dotR = isCurrent ? 4 : isPlayed ? 2.4 : 1.4;
              dotFill = isCurrent ? '#ffffff' : rgba(col, isPlayed ? 0.85 : 0.35);
            }
            ctx.beginPath();
            ctx.arc(p.sx, p.sy, dotR, 0, Math.PI * 2);
            ctx.fillStyle = dotFill;
            ctx.fill();
          }
          ctx.restore();
        };

        // Active walk path — drawn first so preview overlays layer above
        // it (dim alpha keeps them from drowning out the active walk).
        // The path persists through pause and after the walk's last track
        // ends — only clearing when the walk mode itself is turned off.
        if (loShuWalkMode) {
          const walk = LO_SHU_WALKS[loShuWalkMode];
          drawWalkPath(walk, walk.indexOf(selectedFrequency));
        }

        // Preview paths — illuminated independent of any active walk so
        // users can see each walk's shape without loading a playlist.
        // Skip a preview that would duplicate the currently-active walk.
        if (settings.loShuShowVortex && loShuWalkMode !== 'C') drawWalkPath(LO_SHU_WALKS.C, -1);
        if (settings.loShuShowAscent && loShuWalkMode !== 'A') drawWalkPath(LO_SHU_WALKS.A, -1);
        if (settings.loShuShowPillar && loShuWalkMode !== 'B') drawWalkPath(LO_SHU_WALKS.B, -1);

        // Active Hz label — drawn last so it sits on top of every sub-cube
        // and the walk-path overlay, no matter which cube is in front of it
        // in the painter's order.
        if (activeLabel) {
          ctx.save();
          const text = `${activeLabel.freq} Hz`;
          ctx.font = 'bold 11px monospace';
          const metrics = ctx.measureText(text);
          const padX = 6, padY = 3;
          const w0 = metrics.width + padX * 2;
          const h0 = 13 + padY * 2;
          const bx = activeLabel.sx - w0 / 2;
          const by = activeLabel.sy - h0 / 2;
          // Soft dark pill so the text stays legible over bright faces.
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.beginPath();
          if (typeof (ctx as any).roundRect === 'function') {
            (ctx as any).roundRect(bx, by, w0, h0, 4);
          } else {
            ctx.rect(bx, by, w0, h0);
          }
          ctx.fill();
          ctx.strokeStyle = rgba(activeLabel.color, 0.85);
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = 'black';
          ctx.shadowBlur = 3;
          ctx.fillText(text, activeLabel.sx, activeLabel.sy + 1);
          ctx.restore();
        }

        ctx.restore();
      }

      // --- LAYER 4: SACRED GEOMETRY PARTICLES ---
      if (settings.particleDensity !== 'off') {
        ctx.save();
        ctx.translate(cx, cy);
        
        if (settings.invertPerspective) ctx.scale(1, -1);
        if (settings.autoRotate) ctx.rotate(timeRef.current * 0.1);
        
        ctx.globalCompositeOperation = 'lighter';

        const morphSpeed = 0.375 * dynamicSpeed; // Use tempo-based speed (0.15 * 2.5 = 0.375)
        const particleBaseSize = settings.particleBaseSize || 2.5;
        
      // Update dynamic speed based on tempo
      if (isPlaying) {
        const tempoMultiplier = smoothedBPMRef.current / 120; // Normalized to 120 BPM baseline
        dynamicSpeed = settings.speed * tempoMultiplier;
      }
      
      // Performance optimization based on FPS
      let skipFactor = 1;
      if (targetFPSRef.current < 30) skipFactor = 4;
      else if (targetFPSRef.current < 40) skipFactor = 3;
      else if (targetFPSRef.current < 50) skipFactor = 2;

        particlesRef.current.forEach((p, index) => {
            // Skip particles based on performance
            if (skipFactor > 1 && index % skipFactor !== 0) return;
            
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
                const flowSpeed = 200 * dynamicSpeed; // Tempo-based flow (80 * 2.5 = 200)
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
                // Multi-frequency pulsing
                const bassPulse = 1 + Math.sin(timeRef.current * 3 + index * 0.1) * 0.4 * bassEnergy;
                const midPulse = 1 + Math.cos(timeRef.current * 5 + index * 0.15) * 0.2 * midEnergy;
                const highPulse = 1 + Math.sin(timeRef.current * 8 + index * 0.2) * 0.1 * highEnergy;
                const combinedPulse = (bassPulse * 0.5 + midPulse * 0.3 + highPulse * 0.2);
                
                mx += p.x * (combinedPulse - 1);
                my += p.y * (combinedPulse - 1);
                mz += p.z * (combinedPulse - 1);
            }

            // 3. Enhanced Color Logic with frequency response
            if (settings.colorMode === 'cycle') {
                const cycleSpeed = 50 * settings.speed;
                const baseHue = (timeRef.current * cycleSpeed + (index / particlesRef.current.length) * 360) % 360;
                // Color shifts based on spectral content
                const hueShift = bassEnergy * 30 + midEnergy * 20 + highEnergy * 10;
                const hue = (baseHue + hueShift + spectralCentroid * 60) % 360;
                const sat = 70 + midEnergy * 20 + highEnergy * 10;
                const lit = 50 + bassEnergy * 10 + midEnergy * 15 + highEnergy * 25; 
                p.color = `hsl(${hue}, ${sat}%, ${lit}%)`;
            } else if (settings.colorMode === 'chakra') {
                const phiResidue = (index * PHI) % 1;
                if (activeNodeColor && isPlaying) {
                    // More particles react to active tree nodes based on energy
                    const energyThreshold = 0.2 - (highestNodeEnergy * 0.15);
                    if (phiResidue < energyThreshold) {
                        p.color = activeNodeColor;
                    } else {
                        // Blend between primary and active color based on energy
                        const blend = highestNodeEnergy * 0.3;
                        if (Math.random() < blend) {
                            p.color = activeNodeColor;
                        } else {
                            p.color = primaryColor;
                        }
                    }
                } else {
                    p.color = primaryColor;
                }
            } else if (settings.colorMode === 'spectrum') {
                // Spectrum mode: base hue from the visible-light wavelength of
                // the active frequency, modulated by audio so the field stays
                // captivating instead of looking flat. Per-particle hue jitter
                // (PHI-distributed) gives the cloud a sense of depth.
                const specHex = selectedFrequency
                  ? frequencyToSpectrumColor(selectedFrequency)
                  : primaryColor;
                const specHSL = hexToHSL(specHex);
                const hueJitter = (((index * PHI) % 1) - 0.5) * 12; // ±6°
                const hue = (specHSL.h + hueJitter + spectralCentroid * 8 + 360) % 360;
                const sat = Math.min(100, Math.max(45, specHSL.s + midEnergy * 25 + highEnergy * 15));
                const lit = Math.min(75, Math.max(35, specHSL.l + bassEnergy * 12 + midEnergy * 15 + highEnergy * 18));
                p.color = `hsl(${hue}, ${sat}%, ${lit}%)`;
            } else {
                p.color = primaryColor;
            }

            // 3D Projection with audio-reactive depth
            const fov = 400 - spectralCentroid * 100; // FOV changes with brightness
            const finalX = p.x + mx;
            const finalY = p.y + my;
            const finalZ = p.z + mz + (subBassEnergy * 100); // Sub-bass pushes particles forward
            
            const scale = fov / (fov + finalZ + 200);
            
            if (scale > 0 && scale < 20) {
                const px = finalX * scale;
                const py = finalY * scale;
                
                // Size responds to frequency content
                const audioSizeBoost = 1 + (bassEnergy * 0.3 + midEnergy * 0.2 + highEnergy * 0.1);
                const size = Math.max(0.5, p.size * particleBaseSize * scale * audioSizeBoost);
                
                // Depth alpha with audio brightness
                const depthAlpha = Math.min(1, Math.max(0, (finalZ + 800) / 1000));
                const audioAlpha = 0.4 + (midEnergy * 0.3 + highEnergy * 0.3);
                
                // Draw particles with glow effect for bright sounds
                if (highEnergy > 0.5) {
                    // Add glow for high frequencies
                    ctx.beginPath();
                    ctx.arc(px, py, size * 2, 0, Math.PI * 2);
                    ctx.fillStyle = p.color;
                    ctx.globalAlpha = depthAlpha * audioAlpha * 0.2;
                    ctx.fill();
                }
                
                // Main particle
                ctx.beginPath();
                ctx.arc(px, py, size, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.globalAlpha = depthAlpha * audioAlpha;
                ctx.fill();
            }
        });
        ctx.restore();
      }

      // Time increment is now handled above based on actual frame timing
      // Draw BPM indicator when music is playing
      if (isPlaying && settings.speed > 0) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(smoothedBPMRef.current)} BPM`, w - 10, h - 10);
        ctx.restore();
      }
      
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