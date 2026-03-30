
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
  // GUT REGIME - First through Third Order Sacred Geometry
  { shape: 'Seed of Life', freq: '174Hz', benefit: 'Foundation Genesis', element: 'Earth', desc: 'The seven-circle pattern that forms the basis of all creation. The seed from which all geometric forms emerge.' },
  { shape: 'Flower of Life', freq: '285Hz', benefit: 'Universal Pattern', element: 'Creation', desc: 'The complete pattern of creation containing all platonic solids, the Tree of Life, and Metatron\'s Cube within it.' },
  { shape: 'Vesica Piscis', freq: '396Hz', benefit: 'Divine Portal', element: 'Union', desc: 'The sacred almond shape formed by two overlapping circles. Represents the feminine principle and the portal of birth.' },
  { shape: 'Icosahedron', freq: '417Hz', benefit: 'Fluidity & Change', element: 'Water', desc: 'The 20-faced polyhedron representing water, emotions, and the flow of change through life.' },
  { shape: 'Metatron\'s Cube', freq: '528Hz', benefit: 'Divine Blueprint', element: 'Light', desc: 'Contains all five Platonic solids and represents the map of creation itself. The architect\'s blueprint of the universe.' },
  { shape: 'Star Tetrahedron', freq: '639Hz', benefit: 'Merkaba Activation', element: 'Integration', desc: 'Two interlocking tetrahedrons creating the light body vehicle. Represents perfect balance of masculine and feminine.' },
  { shape: 'Dodecahedron', freq: '741Hz', benefit: 'Cosmic Consciousness', element: 'Ether', desc: 'The 12-faced form of spirit and universe. Plato said the cosmos itself is shaped like a dodecahedron.' },
  { shape: 'Octahedron', freq: '852Hz', benefit: 'Perfect Balance', element: 'Air', desc: 'The double pyramid representing air element, mental clarity, and the balance between above and below.' },
  { shape: 'Sri Yantra', freq: '963Hz', benefit: 'Divine Union', element: 'Void', desc: 'The supreme sacred geometry of Hindu tantra. Nine interlocking triangles forming 43 smaller triangles around a central point.' },

  // HEART REGIME - Fourth through Sixth Order Sacred Geometry
  { shape: 'Torus Knot', freq: '1206Hz', benefit: 'Infinite Loop', element: 'Flow', desc: 'A torus that passes through itself, representing the endless circulation of energy through dimensional gateways.' },
  { shape: 'Lemniscate', freq: '1449Hz', benefit: 'Infinity Bridge', element: 'Eternity', desc: 'The figure-eight symbol of infinity, representing eternal flow and balance between dual forces.' },
  { shape: 'Fibonacci Spiral', freq: '1692Hz', benefit: 'Golden Growth', element: 'Evolution', desc: 'The spiral of nature based on the Golden Ratio, found in galaxies, shells, and DNA itself.' },
  { shape: 'Vesica Matrix', freq: '1935Hz', benefit: 'Multi-Vesica Network', element: 'Networks', desc: 'Multiple overlapping Vesica Piscis creating a matrix of interconnected consciousness portals.' },
  { shape: 'Torus', freq: '2178Hz', benefit: 'Universal Flow', element: 'Energy', desc: 'The primary shape of energy flow in the universe, from atoms to galaxies to the human aura.' },
  { shape: 'Rose Curve', freq: '2421Hz', benefit: 'Sacred Petals', element: 'Beauty', desc: 'Mathematical rose patterns with petals based on sacred number ratios, representing divine beauty and harmony.' },
  { shape: 'Merkaba', freq: '2664Hz', benefit: 'Light Vehicle', element: 'Ascension', desc: 'The fully activated star tetrahedron spinning in opposite directions, creating the light body vehicle.' },
  { shape: 'Lissajous', freq: '2907Hz', benefit: 'Harmonic Patterns', element: 'Resonance', desc: 'Complex curved figures showing the visual representation of harmonic frequencies in motion.' },
  { shape: 'Penrose Tiling', freq: '3150Hz', benefit: 'Aperiodic Order', element: 'Paradox', desc: 'Non-repeating patterns that maintain perfect symmetry, representing order within chaos.' },

  // HEAD REGIME - Seventh through Ninth Order Sacred Geometry
  { shape: 'Chladni Star', freq: '3504Hz', benefit: 'Sound Visualization', element: 'Vibration', desc: 'The star patterns formed by sound vibrations on a plate, showing how frequency creates form.' },
  { shape: 'Wave Function', freq: '3858Hz', benefit: 'Quantum Probability', element: 'Potential', desc: 'The mathematical visualization of quantum probability waves, showing all possible states simultaneously.' },
  { shape: 'Antenna Array', freq: '4212Hz', benefit: 'Cosmic Reception', element: 'Reception', desc: 'Sacred geometric antenna patterns that receive and transmit consciousness across dimensions.' },
  { shape: 'Harmonic Web', freq: '4566Hz', benefit: 'Frequency Network', element: 'Connection', desc: 'The interconnected web of all harmonic relationships, visualizing the music of the spheres.' },
  { shape: 'Field Lines', freq: '4920Hz', benefit: 'Force Visualization', element: 'Force', desc: 'The visible patterns of invisible forces, from magnetic fields to consciousness fields.' },
  { shape: 'Healing Mandala', freq: '5274Hz', benefit: 'Wholeness Pattern', element: 'Healing', desc: 'Complex circular patterns representing the journey from fragmentation to wholeness and healing.' },
  { shape: 'Dream Lattice', freq: '5628Hz', benefit: 'Dream Architecture', element: 'Dreams', desc: 'The crystalline lattice structure of the dream realm and collective unconscious.' },
  { shape: 'Möbius Strip', freq: '5982Hz', benefit: 'One-Sided Unity', element: 'Paradox', desc: 'The twisted loop with only one surface, representing the unity of all apparent opposites.' },
  { shape: 'Unified Field', freq: '6336Hz', benefit: 'All-That-Is', element: 'SOURCE', desc: 'The geometric representation of the unified field of consciousness where all possibilities exist as ONE.' },

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
  { name: 'Ain Soph', title: 'The Limitless', meaning: 'The Infinite SOURCE, Beyond All Form.', correspondence: 'Trans-Crown Chakra / SOURCE Field', color: '#FFFFFF', desc: 'The 12th node completing the energy circuit. The SOURCE connection that enables the Tree of Life to function as a complete system. Pure infinite consciousness beyond all limitation.' },
];