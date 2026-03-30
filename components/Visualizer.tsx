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
  selectedFrequency
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

    // Pre-calculate Color Palette
    const baseHSL = hexToHSL(primaryColor);
    const primaryStr = `hsla(${baseHSL.h}, ${baseHSL.s}%, ${baseHSL.l}%,`; 
    const shade1Str = `hsla(${baseHSL.h}, ${Math.min(100, baseHSL.s + 15)}%, ${Math.max(10, baseHSL.l - 25)}%,`;
    const shade2Str = `hsla(${baseHSL.h}, ${Math.max(0, baseHSL.s - 15)}%, ${Math.min(95, baseHSL.l + 30)}%,`;

    const render = (timestamp?: number) => {
      // Initialize dynamic speed variable
      let dynamicSpeed = settings.speed;
      
      // Performance optimization: Stable frame rate limiting
      if (timestamp) {
        const deltaTime = timestamp - lastFrameTimeRef.current;
        
        // Fixed 30 FPS for smoother performance (33.33ms per frame)
        const targetFrameTime = 33.33;
        
        // Skip frame if we're running too fast
        if (deltaTime < targetFrameTime) {
          rafRef.current = requestAnimationFrame(render);
          return;
        }
        
        // Account for multiple frames if we're running slow
        const framesToCatch = Math.floor(deltaTime / targetFrameTime);
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
      const dataArray = new Uint8Array(bufferLength);
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
           
           if ((bassIncreased && aboveThreshold && cooldownMet) || (subBassHit && cooldownMet)) {
              (window as any).lastBassRipple = now;
              
              // Create expanding wave ripple with frequency-based characteristics
              const rippleStrength = subBassHit ? subBassEnergy : bassEnergy;
              const rippleSize = subBassHit ? 0.9 : 0.7;
              
              ripplesRef.current.push({ 
                  x: cx + (subBassHit ? 0 : (Math.random() - 0.5) * 100), // Sub-bass always center
                  y: cy + (subBassHit ? 0 : (Math.random() - 0.5) * 100), 
                  radius: 20 * (1 + rippleStrength), 
                  maxRadius: Math.max(w, h) * rippleSize, 
                  alpha: 0.5 + rippleStrength * 0.3, 
                  speed: 8.75 * settings.speed * (1 + rippleStrength * 0.5), // 3.5 * 2.5 = 8.75
                  color: subBassHit ? shade1Str : primaryStr, 
                  type: 'bass' 
              });
              
              // Add inner ripple for more impact
              setTimeout(() => {
                  ripplesRef.current.push({ 
                      x: cx, 
                      y: cy, 
                      radius: 10, 
                      maxRadius: Math.max(w, h) * 0.5, 
                      alpha: 0.3 + rippleStrength * 0.2, 
                      speed: 7.5 * settings.speed, // 3 * 2.5 = 7.5
                      color: primaryStr, 
                      type: 'bass' 
                  });
              }, 50);
           }
           
           // Mid-frequency ripples at random positions
           if (midEnergy > 0.5 && Math.random() < midEnergy * normalizedLinear) {
              ripplesRef.current.push({ 
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
                  ripplesRef.current.push({ 
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
          
          // Performance optimization: Only render visible hexagons
          const visibleHexagons = hexGridRef.current.filter(hex => {
              const screenX = cx + hex.x;
              const screenY = cy + hex.y;
              return screenX > -hex.size && screenX < w + hex.size && 
                     screenY > -hex.size && screenY < h + hex.size;
          });
          
          visibleHexagons.forEach(hex => {
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
              // Different fade rates for different ripple types
              if (r.type === 'bass') {
                  r.alpha -= 0.006; // Moderate fade for proper wave effect
              } else {
                  r.alpha -= 0.004; // Slower fade for rain ripples
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
        const availableHeight = h - 160; // Reduced margin for better fit
        const treeHeight = 11.5; // Total height span from Malkuth (-3.5) to Ain Soph (8.0) 
        const scaleUnit = Math.min(35, availableHeight / treeHeight); // Proper scaling for 12 nodes
        const breathing = Math.sin(timeRef.current * 0.5) * 3; // Reduced breathing for better visibility
        
        // Adjust tree position - move center down to ensure top node is visible
        const treeOffsetY = cy + (scaleUnit * 1.5); // Move tree center down by 1.5 scale units
        ctx.translate(cx, treeOffsetY);
        
        // Use additive blending for energy feel
        ctx.globalCompositeOperation = 'lighter';

        // 1. Edges with Supercharged Energy Flow
        treeRef.current.edges.forEach(([startIdx, endIdx], i) => {
            const sn = treeRef.current.nodes[startIdx];
            const en = treeRef.current.nodes[endIdx];
            const sx = sn.x * scaleUnit, sy = -sn.y * scaleUnit + breathing; 
            const ex = en.x * scaleUnit, ey = -en.y * scaleUnit + breathing;

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
        treeRef.current.nodes.forEach(node => {
            const nx = node.x * scaleUnit, ny = -node.y * scaleUnit + breathing;
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