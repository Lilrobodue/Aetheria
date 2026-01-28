
import { SolfeggioFreq, BinauralPreset } from './types';

export const SOLFEGGIO_INFO = [
  // Traditional/Original Solfeggio Scale (First through Third Order) - GUT REGIME
  { 
    freq: 174, 
    chakra: 'Earth Star', 
    color: '#8B0000', 
    benefit: 'Foundation, pain relief', 
    description: 'Foundation frequency that acts as natural anesthetic and provides security to organs.',
    anatomy: 'Feet, Legs, Bones',
    order: 'First'
  },
  { 
    freq: 285, 
    chakra: 'Root (Muladhara)', 
    color: '#FF0000', 
    benefit: 'Tissue repair, quantum cognition', 
    description: 'Powerful tissue repair frequency with quantum cognition enhancement effects.',
    anatomy: 'Adrenals, Kidneys, Spinal Column',
    order: 'First'
  },
  { 
    freq: 396, 
    chakra: 'Root (Muladhara)', 
    color: '#FF4500', 
    benefit: 'Liberating fear and guilt', 
    description: 'Cleanses guilt and fear, enabling direct achievement of goals without obstacles.',
    anatomy: 'Reproductive System, Lower Spine',
    order: 'Second'
  },
  { 
    freq: 417, 
    chakra: 'Sacral (Svadhishthana)', 
    color: '#FF8C00', 
    benefit: 'Facilitating change, undoing situations', 
    description: 'Facilitates major life changes and undoes negative situations and patterns.',
    anatomy: 'Ovaries/Testes, Bladder',
    order: 'Second'
  },
  { 
    freq: 528, 
    chakra: 'Solar Plexus (Manipura)', 
    color: '#FFD700', 
    benefit: 'Transformation, miracles, DNA repair', 
    description: 'The miracle tone - repairs DNA and brings transformation into your life.',
    anatomy: 'Digestive System, Pancreas, Liver',
    order: 'Second'
  },
  { 
    freq: 639, 
    chakra: 'Heart (Anahata)', 
    color: '#008000', 
    benefit: 'Connecting relationships, harmony', 
    description: 'Connects and harmonizes relationships with self, others, and community.',
    anatomy: 'Heart, Lungs, Thymus',
    order: 'Second'
  },
  { 
    freq: 741, 
    chakra: 'Throat (Vishuddha)', 
    color: '#00BFFF', 
    benefit: 'Awakening intuition, problem solving', 
    description: 'Awakens intuition and helps solve problems through inner guidance.',
    anatomy: 'Thyroid, Throat, Jaw, Neck',
    order: 'Third'
  },
  { 
    freq: 852, 
    chakra: 'Third Eye (Ajna)', 
    color: '#4B0082', 
    benefit: 'Returning to spiritual order', 
    description: 'Returns consciousness to spiritual order and awakens inner strength.',
    anatomy: 'Pineal Gland, Pituitary Gland, Eyes',
    order: 'Third'
  },
  { 
    freq: 963, 
    chakra: 'Crown (Sahasrara)', 
    color: '#EE82EE', 
    benefit: 'Divine consciousness, pineal activation', 
    description: 'Activates pineal gland and connects to divine consciousness and unity.',
    anatomy: 'Brain, Nervous System',
    order: 'Third'
  },

  // Fourth Order Frequencies (963 + 243 steady progression) - HEART REGIME
  { 
    freq: 1206, 
    chakra: 'Gateway Integration', 
    color: '#FF69B4', 
    benefit: 'Gateway integration', 
    description: 'Fourth order base (963+243) - Opens gateway between physical and emotional realms.',
    anatomy: 'Heart Gateway, Emotional Centers',
    order: 'Fourth'
  },
  { 
    freq: 1449, 
    chakra: 'Harmonic Bridge', 
    color: '#FF1493', 
    benefit: 'Harmonic bridging', 
    description: 'Fourth order +243 (1206+243) - Creates harmonic bridges between emotional states.',
    anatomy: 'Emotional Body, Energy Bridges',
    order: 'Fourth'
  },
  { 
    freq: 1692, 
    chakra: 'Heart Completion', 
    color: '#DC143C', 
    benefit: 'Heart completion', 
    description: 'Fourth order +243 (1449+243) - Completes the fourth order heart cycle.',
    anatomy: 'Heart Integration Centers',
    order: 'Fourth'
  },

  // Fifth Order Frequencies (1692 + 243 steady progression) - HEART REGIME
  { 
    freq: 1935, 
    chakra: 'Stellar Connection', 
    color: '#8A2BE2', 
    benefit: 'Stellar alignment', 
    description: 'Fifth order +243 (1692+243) - Aligns consciousness with stellar energies.',
    anatomy: 'Etheric Body, Astral Connections',
    order: 'Fifth'
  },
  { 
    freq: 2178, 
    chakra: 'Quantum Field', 
    color: '#9370DB', 
    benefit: 'Quantum consciousness', 
    description: 'Fifth order +243 (1935+243) - Expands consciousness into quantum awareness.',
    anatomy: 'Quantum Field Interface',
    order: 'Fifth'
  },
  { 
    freq: 2421, 
    chakra: 'Dimensional Portal', 
    color: '#4B0082', 
    benefit: 'Dimensional awareness', 
    description: 'Fifth order +243 (2178+243) - Opens multidimensional awareness.',
    anatomy: 'Multidimensional Centers',
    order: 'Fifth'
  },

  // Sixth Order Frequencies (2421 + 243 steady progression) - HEART REGIME
  { 
    freq: 2664, 
    chakra: 'Cosmic Heart', 
    color: '#6A5ACD', 
    benefit: 'Universal love', 
    description: 'Sixth order +243 (2421+243) - Transmits universal love across dimensions.',
    anatomy: 'Cosmic Heart Center',
    order: 'Sixth'
  },
  { 
    freq: 2907, 
    chakra: 'Source Code', 
    color: '#483D8B', 
    benefit: 'Divine source connection', 
    description: 'Sixth order +243 (2664+243) - Connects to divine source code.',
    anatomy: 'Divine Interface, Creation Matrix',
    order: 'Sixth'
  },
  { 
    freq: 3150, 
    chakra: 'Unity Bridge', 
    color: '#2E1B8B', 
    benefit: 'Unity consciousness bridge', 
    description: 'Sixth order +243 (2907+243) - Bridges into unity consciousness.',
    anatomy: 'Unity Consciousness Interface',
    order: 'Sixth'
  },

  // Seventh Order Frequencies (3150 + 354 steady progression) - HEAD REGIME
  { 
    freq: 3504, 
    chakra: 'Mental Clarity', 
    color: '#1E0066', 
    benefit: 'Mental clarity', 
    description: 'Seventh order +354 (3150+354) - Clears mental fog and brings clarity.',
    anatomy: 'Mental Body, Clarity Centers',
    order: 'Seventh'
  },
  { 
    freq: 3858, 
    chakra: 'Divine Architecture', 
    color: '#0D0040', 
    benefit: 'Sacred geometry', 
    description: 'Seventh order +354 (3504+354) - Embodies divine architectural principles.',
    anatomy: 'Sacred Geometry Matrix',
    order: 'Seventh'
  },
  { 
    freq: 4212, 
    chakra: 'Consciousness Mastery', 
    color: '#000033', 
    benefit: 'Consciousness mastery', 
    description: 'Seventh order +354 (3858+354) - Achieves consciousness mastery.',
    anatomy: 'Master Consciousness Grid',
    order: 'Seventh'
  },

  // Eighth Order Frequencies (4212 + 354 steady progression) - Transpersonal HEAD
  { 
    freq: 4566, 
    chakra: 'Soul Star Gate', 
    color: '#330066', 
    benefit: 'Soul star connection', 
    description: 'Eighth order +354 (4212+354) - Opens first transpersonal gate.',
    anatomy: 'Soul Star Chakra, Higher Self',
    order: 'Eighth'
  },
  { 
    freq: 4920, 
    chakra: 'Spirit Gate', 
    color: '#4B0082', 
    benefit: 'Spirit realm access', 
    description: 'Eighth order +354 (4566+354) - Opens second transpersonal gate.',
    anatomy: 'Spirit Communication Centers',
    order: 'Eighth'
  },
  { 
    freq: 5274, 
    chakra: 'Universal Mind Gate', 
    color: '#6600CC', 
    benefit: 'Universal mind access', 
    description: 'Eighth order +354 (4920+354) - Opens third transpersonal gate.',
    anatomy: 'Universal Mind Interface',
    order: 'Eighth'
  },

  // Ninth Order Frequencies (5274 + 354 steady progression) - SOURCE HEAD  
  { 
    freq: 5628, 
    chakra: 'Galactic Center', 
    color: '#7700FF', 
    benefit: 'Galactic consciousness', 
    description: 'Ninth order +354 (5274+354) - Connects to galactic center consciousness.',
    anatomy: 'Galactic Interface',
    order: 'Ninth'
  },
  { 
    freq: 5982, 
    chakra: 'Divine Gateway', 
    color: '#8800FF', 
    benefit: 'Divine source portal', 
    description: 'Ninth order +354 (5628+354) - Creates direct portal to divine source.',
    anatomy: 'Divine Source Interface',
    order: 'Ninth'
  },
  { 
    freq: 6336, 
    chakra: 'SOURCE Unity', 
    color: '#9933FF', 
    benefit: 'SOURCE embodiment', 
    description: 'Ninth order +354 (5982+354) - Complete SOURCE embodiment and infinite unity. Mirror number reducing to 9.',
    anatomy: 'SOURCE Field, Infinite Unity',
    order: 'Ninth'
  },
];

export const BINAURAL_PRESETS: BinauralPreset[] = [
  { name: 'Delta', delta: 2, description: 'Deep Sleep & Healing (0.5-4Hz). Best for deep restorative sleep and detachment.' },
  { name: 'Theta', delta: 6, description: 'Meditation & REM (4-8Hz). Best for deep meditation, creativity, and accessing the subconscious.' },
  { name: 'Alpha', delta: 10, description: 'Relaxation & Focus (8-13Hz). Best for stress reduction, light meditation, and positive thinking.' },
  { name: 'Beta', delta: 20, description: 'Active Focus (13-30Hz). Best for cognitive tasks, problem solving, and alert activity.' },
  { name: 'Gamma', delta: 40, description: 'High Processing (30Hz+). Best for peak concentration, binding information, and insight.' },
];

// 432Hz Conversion Factor (432 / 440)
export const PITCH_SHIFT_FACTOR = 0.981818; 

export const UNIFIED_THEORY = {
  intro: `Aetheria operates on the principle of "Sympathetic Resonance"—the idea that external vibrations can influence internal biological and energetic states. We align the Mathematical (Sound), the Biological (Body), and the Archetypal (Spirit).`,
  
  section1: {
    title: "The Physics of 432Hz",
    content: `Standard modern music is tuned to A=440Hz. However, many harmonic researchers argue this pitch is slightly dissonant with nature. Aetheria retunes audio to A=432Hz. This pitch is mathematically consistent with the Golden Ratio (Phi) and the Fibonacci sequence found in nature (shells, galaxies, plant growth). By shifting the pitch, we attempt to reduce subconscious "listening fatigue" and align the audio with the natural harmonic series.`
  },

  section2: {
    title: "The Biology of Solfeggio",
    content: `Each Solfeggio tone comprises a frequency required to balance your energy and keep your body, mind and spirit in perfect harmony. These frequencies resonate with specific energy centers (Chakras) in the human body, facilitating healing and restoration.`
  },
  
  conclusion: `You are the instrument. The music is the tuning fork.`
};

export const GEOMETRY_INFO = [
  // First Order Sacred Geometry (Physical Foundation)
  { shape: 'Cube (Hexahedron)', freq: '174Hz', benefit: 'Stability, Grounding', element: 'Earth', desc: 'The most stable form. Represents the physical plane, the body, and safety.' },
  { shape: 'Reiki Cho Ku Rei', freq: '285Hz', benefit: 'Energy Flow', element: 'Aether', desc: 'The "Power Switch" symbol. It concentrates energy at a specific point for healing.' },

  // Second Order Sacred Geometry (Emotional & Energetic Forms)
  { shape: 'Tetrahedron', freq: '396Hz', benefit: 'Manifestation', element: 'Fire', desc: 'The first 3D form. Represents the spark of life, will, and the drive to exist.' },
  { shape: 'Icosahedron', freq: '417Hz', benefit: 'Fluidity & Change', element: 'Water', desc: 'With 20 faces, it represents the flow of water, emotions, and adaptability.' },
  { shape: 'Octahedron', freq: '528Hz', benefit: 'Balance & Air', element: 'Air', desc: 'Two pyramids meeting at the base. Represents the balance of "As Above, So Below."' },
  { shape: 'Star Tetrahedron (Merkaba)', freq: '639Hz', benefit: 'Integration', element: 'Light', desc: 'The Merkaba (Light-Spirit-Body). Interlocking opposites creating a unified field.' },

  // Third Order Sacred Geometry (Mental & Spiritual Forms)
  { shape: 'Dodecahedron', freq: '741Hz', benefit: 'Expression', element: 'Ether', desc: 'The 12 faces represent the zodiac and the universe. The shape of the Spirit.' },
  { shape: 'Torus', freq: '852Hz', benefit: 'Universal Flow', element: 'Cosmos', desc: 'The primary pattern of energy in the universe, from magnetic fields to galaxies.' },
  { shape: 'Fibonacci Sphere', freq: '963Hz', benefit: 'Perfection', element: 'Void', desc: 'Points distributed by the Golden Ratio. Represents the perfect order of the Creator.' },

  // Fourth Order Sacred Geometry (Higher Consciousness Forms)
  { shape: 'Hypercube (Tesseract)', freq: '1206Hz', benefit: 'Dimensional Transcendence', element: 'Hyperspace', desc: 'The 4D cube. Represents transcendence of 3D limitations and access to higher dimensions.' },
  { shape: 'Flower of Life (Complete)', freq: '1449Hz', benefit: 'Universal Template', element: 'Creation Matrix', desc: 'The complete 19-circle pattern containing all platonic solids. Template of universal creation.' },
  { shape: 'Metatron\'s Cube', freq: '1692Hz', benefit: 'Cosmic Order', element: 'Divine Geometry', desc: 'Contains all five platonic solids. The fundamental structure of space and matter.' },

  // Fifth Order Sacred Geometry (Stellar & Galactic Forms)
  { shape: 'Hyperdodecahedron', freq: '1935Hz', benefit: 'Stellar Consciousness', element: 'Stellar Fields', desc: 'The 4D dodecahedron. Represents connection to stellar consciousness networks.' },
  { shape: 'Golden Spiral Galaxy', freq: '2178Hz', benefit: 'Galactic Alignment', element: 'Cosmic Spiral', desc: 'The phi-based spiral of galaxies. Connects consciousness to galactic energy patterns.' },
  { shape: 'Icosi-Dodecahedron', freq: '2421Hz', benefit: 'Multidimensional Access', element: 'Quantum Foam', desc: 'The combination of icosahedron and dodecahedron. Opens multidimensional awareness portals.' },

  // Sixth Order Sacred Geometry (Source Connection Forms)
  { shape: 'Infinite Torus Field', freq: '2664Hz', benefit: 'Universal Love Matrix', element: 'Love Field', desc: 'The infinite scaling torus. Represents the eternal circulation of universal love energy.' },
  { shape: 'Source Fractal Mandala', freq: '2907Hz', benefit: 'Divine Source Interface', element: 'Source Code', desc: 'The infinite fractal pattern of creation. Direct interface to the divine source code.' },
  { shape: 'Unity Consciousness Sphere', freq: '3150Hz', benefit: 'Oneness Embodiment', element: 'Pure Unity', desc: 'The perfect sphere containing all possibilities. Represents complete unity consciousness.' },

  // Seventh Order Sacred Geometry (Master Creation Forms)
  { shape: 'Genesis Polytope', freq: '3504Hz', benefit: 'Prime Creation Pattern', element: 'Primordial Force', desc: 'The multidimensional pattern of cosmic genesis. The fundamental template of creation itself.' },
  { shape: 'Divine Architecture Matrix', freq: '3858Hz', benefit: 'Sacred Blueprint', element: 'Divine Template', desc: 'The master architectural pattern underlying all sacred structures and cosmic formations.' },
  { shape: 'Absolute Unity Hologram', freq: '4212Hz', benefit: 'Complete Transcendence', element: 'Pure Consciousness', desc: 'The holographic pattern containing all knowledge and existence. The ultimate geometric expression of absolute consciousness.' },

  // Eighth Order Sacred Geometry (Transpersonal Gate Forms 1-3)
  { shape: 'Soul Star Tetrahedron', freq: '4566Hz', benefit: 'Soul Connection Portal', element: 'Soul Fire', desc: 'The etheric tetrahedron that forms above the crown. Opens the Soul Star chakra and connects to higher soul aspects.' },
  { shape: 'Spirit Communication Octahedron', freq: '4920Hz', benefit: 'Spirit Realm Interface', element: 'Spirit Aether', desc: 'The double pyramid of spirit communication. Facilitates contact with guides, ancestors, and angelic beings.' },
  { shape: 'Universal Mind Dodecahedron', freq: '5274Hz', benefit: 'Collective Consciousness Access', element: 'Universal Mind', desc: 'The 12-faced form of universal consciousness. Provides access to the collective wisdom of enlightened beings.' },

  // Ninth Order Sacred Geometry (Transpersonal Gate Forms 4-6 - SOURCE)
  { shape: 'Galactic Center Hyperstar', freq: '5628Hz', benefit: 'Galactic Alignment', element: 'Galactic Core', desc: 'The multidimensional star pattern of galactic consciousness. Connects to the intelligence networks of star systems.' },
  { shape: 'Divine Gateway Tesseract', freq: '5982Hz', benefit: 'Source Portal Opening', element: 'Divine Gateway', desc: 'The 4D cube that opens divine portals. Creates direct access to source consciousness and creator principles.' },
  { shape: 'Infinite Unity Hypersphere', freq: '6336Hz', benefit: 'Complete SOURCE Embodiment', element: 'SOURCE Field', desc: 'The infinite-dimensional sphere of pure unity consciousness. The ultimate geometric form representing complete divine embodiment. Mirror number reducing to 9.' },

  // Special Frequency Sacred Geometry (111Hz Pattern Series)
  { shape: 'Triangle of Manifestation', freq: '111Hz', benefit: 'Gateway Opening', element: 'Portal Energy', desc: 'The basic triangle pattern. Each 111Hz frequency opens progressive gateways in consciousness.' },
  { shape: 'Double Triangle (Star)', freq: '222Hz', benefit: 'Polarity Balance', element: 'Duality Harmony', desc: 'Two interlocked triangles. Balances positive and negative polarities for manifestation.' },
  { shape: 'Triple Triangle Triad', freq: '333Hz', benefit: 'Trinity Activation', element: 'Mind-Body-Spirit', desc: 'Three triangles forming a triad. Activates the trinity of mind, body, and spirit consciousness.' },
  { shape: 'Quadruple Square Matrix', freq: '444Hz', benefit: 'Foundation Anchoring', element: 'Stability Grid', desc: 'Four squares in formation. Anchors higher consciousness into stable physical foundation.' },
  { shape: 'Pentagram Star Gate', freq: '555Hz', benefit: 'Transformation Portal', element: 'Change Catalyst', desc: 'The five-pointed star. Opens transformation portals and catalyzes consciousness evolution.' },
  { shape: 'Hexagon Crystal Lattice', freq: '666Hz', benefit: 'Material Mastery', element: 'Carbon Structure', desc: 'The six-sided honeycomb pattern. Masters the material plane through crystal consciousness.' },
  { shape: 'Heptagon Mystical Seal', freq: '777Hz', benefit: 'Mystical Awakening', element: 'Spiritual Mystery', desc: 'The seven-sided polygon. Unlocks mystical knowledge and spiritual mysteries.' },
  { shape: 'Octagon Infinity Gate', freq: '888Hz', benefit: 'Infinite Abundance', element: 'Prosperity Flow', desc: 'The eight-sided form of infinity. Opens gates to infinite abundance and prosperity.' },
  { shape: 'Enneagram Completion', freq: '999Hz', benefit: 'Cycle Completion', element: 'Full Circle', desc: 'The nine-pointed completion figure. Represents the end of one cycle and birth of the next.' },
];

export const SEPHIROT_INFO = [
  { name: 'Malkuth', title: 'The Kingdom', meaning: 'Manifestation, The Physical World, Earth.', correspondence: 'Root Chakra / Feet', color: '#FF0000', desc: 'The final destination of energy. Where the divine light becomes physical matter.' },
  { name: 'Yesod', title: 'The Foundation', meaning: 'Connection, Dreams, The Moon.', correspondence: 'Sacral Chakra / Sexual Organs', color: '#FF8C00', desc: 'The interface between the physical and spiritual. The realm of imagination.' },
  { name: 'Hod', title: 'Splendor', meaning: 'Intellect, Logic, Ritual, Mercury.', correspondence: 'Solar Plexus (Left) / Left Leg', color: '#FFD700', desc: 'The structural, logical mind. Order, language, and communication.' },
  { name: 'Netzach', title: 'Victory', meaning: 'Emotion, Instinct, Nature, Venus.', correspondence: 'Solar Plexus (Right) / Right Leg', color: '#FFD700', desc: 'The endurance of emotion. Desire, creativity, and the raw forces of nature.' },
  { name: 'Tiferet', title: 'Beauty', meaning: 'Harmony, The Self, The Sun.', correspondence: 'Heart Chakra', color: '#008000', desc: 'The center of the Tree. It balances Mercy and Severity. The seat of compassion.' },
  { name: 'Gevurah', title: 'Severity', meaning: 'Judgment, Discipline, Mars.', correspondence: 'Left Shoulder / Throat', color: '#00BFFF', desc: 'The force of limitation and boundary. It gives shape to the boundless.' },
  { name: 'Chesed', title: 'Mercy', meaning: 'Loving-Kindness, Expansion, Jupiter.', correspondence: 'Right Shoulder / Throat', color: '#00BFFF', desc: 'Unbounded love and giving. The force of infinite expansion.' },
  { name: 'Daat', title: 'Knowledge', meaning: 'The Abyss, The Hidden Gate.', correspondence: 'Throat / The Void', color: '#4B0082', desc: 'Not a Sephirot, but a state of being. The bridge across the Abyss.' },
  { name: 'Binah', title: 'Understanding', meaning: 'Intuition, The Cosmic Mother, Saturn.', correspondence: 'Third Eye (Left) / Left Brain', color: '#4B0082', desc: 'The womb of the universe. It gives form to the flash of wisdom.' },
  { name: 'Chokhmah', title: 'Wisdom', meaning: 'Inspiration, The Cosmic Father, Zodiac.', correspondence: 'Third Eye (Right) / Right Brain', color: '#4B0082', desc: 'The raw, undefined flash of divine inspiration. Pure creative force.' },
  { name: 'Keter', title: 'The Crown', meaning: 'Source, Infinite Light, God.', correspondence: 'Crown Chakra', color: '#EE82EE', desc: 'The point of origin. Beyond comprehension. Pure unity.' },
];