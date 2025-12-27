
import { SolfeggioFreq, BinauralPreset } from './types';

export const SOLFEGGIO_INFO = [
  // Traditional Solfeggio Scale (First through Third Order)
  { 
    freq: 174, 
    chakra: 'Earth Star', 
    color: '#8B0000', 
    benefit: 'Pain Relief & Security', 
    description: 'The lowest of the tones, 174 Hz acts like a natural anaesthetic. It tends to reduce pain physically and energetically, giving your organs a sense of security, safety, and love, encouraging them to do their best.',
    anatomy: 'Feet, Legs, Bones',
    order: 'First'
  },
  { 
    freq: 285, 
    chakra: 'Root (Muladhara)', 
    color: '#FF0000', 
    benefit: 'Tissue Repair & restoration', 
    description: 'This frequency helps return tissue into its original form. 285 Hz influences energy fields, sending a message to restructure damaged organs. It also leaves your body rejuvenated and energized.',
    anatomy: 'Adrenals, Kidneys, Spinal Column',
    order: 'First'
  },
  { 
    freq: 396, 
    chakra: 'Root (Muladhara)', 
    color: '#FF4500', 
    benefit: 'Liberating Guilt and Fear', 
    description: 'Cleanses the feeling of guilt, which often represents one of the basic obstacles to realization, enabling achievement of goals in the most direct way. It releases you from subconscious fear and grounding issues.',
    anatomy: 'Reproductive System, Lower Spine',
    order: 'Second'
  },
  { 
    freq: 417, 
    chakra: 'Sacral (Svadhishthana)', 
    color: '#FF8C00', 
    benefit: 'Undoing Situations & Facilitating Change', 
    description: 'This frequency marks the start of new beginnings. It is so powerful that it can reverse and undo negative happenings. It produces energy to bring about change and cleanses traumatic experiences.',
    anatomy: 'Ovaries/Testes, Bladder',
    order: 'Second'
  },
  { 
    freq: 528, 
    chakra: 'Solar Plexus (Manipura)', 
    color: '#FFD700', 
    benefit: 'Transformation & Miracles (DNA Repair)', 
    description: 'Known as the "Miracle Tone," 528 Hz returns human DNA to its original, perfect state. It brings transformation and miracles into your life. It is also the frequency of the sun (chlorophyll vibrates at 528 Hz).',
    anatomy: 'Digestive System, Pancreas, Liver',
    order: 'Second'
  },
  { 
    freq: 639, 
    chakra: 'Heart (Anahata)', 
    color: '#008000', 
    benefit: 'Connecting & Relationships', 
    description: 'This frequency enables creation of harmonious community and harmonious interpersonal relationships. Tone "Fa" can be used for dealing with relationships problems – those in family, between partners, friends or social problems.',
    anatomy: 'Heart, Lungs, Thymus',
    order: 'Second'
  },
  { 
    freq: 741, 
    chakra: 'Throat (Vishuddha)', 
    color: '#00BFFF', 
    benefit: 'Expression & Solutions', 
    description: 'Cleanses the body of toxins (viral, bacterial, and electromagnetic). It leads you to the power of self-expression, which results in a pure and stable life. It helps in solving problems and awakening intuition.',
    anatomy: 'Thyroid, Throat, Jaw, Neck',
    order: 'Third'
  },
  { 
    freq: 852, 
    chakra: 'Third Eye (Ajna)', 
    color: '#4B0082', 
    benefit: 'Returning to Spiritual Order', 
    description: 'Linked to the Third Eye Chakra. It is used for raising awareness and returning to spiritual order. It awakens intuition and inner strength, helping you see through illusions and discover the light behind the veil.',
    anatomy: 'Pineal Gland, Pituitary Gland, Eyes',
    order: 'Third'
  },
  { 
    freq: 963, 
    chakra: 'Crown (Sahasrara)', 
    color: '#EE82EE', 
    benefit: 'Awakening Perfect State', 
    description: 'This tone awakens any system to its original, perfect state. It is connected with the Light and all-embracing Spirit, and enables direct experience, the return to Oneness.',
    anatomy: 'Brain, Nervous System',
    order: 'Third'
  },

  // Fourth Order Solfeggio Frequencies (963 + 111, +243, +324)
  { 
    freq: 1074, 
    chakra: 'Transcendental Crown', 
    color: '#FF69B4', 
    benefit: 'Pineal Activation & Higher Consciousness', 
    description: 'Fourth order frequency (963 + 111) that activates the pineal gland and opens channels to higher dimensional consciousness. Requires subtle resonance approach - focus on feeling rather than hearing.',
    anatomy: 'Pineal Gland, Higher Brain Centers',
    order: 'Fourth'
  },
  { 
    freq: 1317, 
    chakra: 'Cosmic Gateway', 
    color: '#FF1493', 
    benefit: 'Interdimensional Communication', 
    description: 'Fourth order frequency (1074 + 243) that facilitates communication with higher dimensional beings and cosmic intelligence. Use with extreme caution and proper preparation.',
    anatomy: 'Entire Nervous System, Light Body',
    order: 'Fourth'
  },
  { 
    freq: 1641, 
    chakra: 'Universal Mind', 
    color: '#DC143C', 
    benefit: 'Collective Consciousness Access', 
    description: 'Fourth order frequency (1317 + 324) that connects individual consciousness to the universal mind matrix. Advanced practitioners only.',
    anatomy: 'Neural Networks, Consciousness Centers',
    order: 'Fourth'
  },

  // Fifth Order Solfeggio Frequencies 
  { 
    freq: 1752, 
    chakra: 'Stellar Connection', 
    color: '#8A2BE2', 
    benefit: 'Stellar & Galactic Alignment', 
    description: 'Fifth order frequency (1641 + 111) that aligns consciousness with stellar and galactic energies. Creates resonance with cosmic cycles and star systems.',
    anatomy: 'Etheric Body, Astral Connections',
    order: 'Fifth'
  },
  { 
    freq: 1995, 
    chakra: 'Quantum Field', 
    color: '#9370DB', 
    benefit: 'Quantum Consciousness Expansion', 
    description: 'Fifth order frequency (1752 + 243) that expands consciousness into quantum field awareness. Facilitates understanding of non-local consciousness phenomena.',
    anatomy: 'Quantum Field Interface, Consciousness Matrix',
    order: 'Fifth'
  },
  { 
    freq: 2319, 
    chakra: 'Dimensional Portal', 
    color: '#4B0082', 
    benefit: 'Multidimensional Awareness', 
    description: 'Fifth order frequency (1995 + 324) that opens awareness to multiple dimensions simultaneously. Extreme caution required - research level frequency.',
    anatomy: 'Multidimensional Consciousness Centers',
    order: 'Fifth'
  },

  // Sixth Order Solfeggio Frequencies
  { 
    freq: 2430, 
    chakra: 'Cosmic Heart', 
    color: '#6A5ACD', 
    benefit: 'Universal Love Transmission', 
    description: 'Sixth order frequency (2319 + 111) that transmits and receives universal love energy across all dimensions. Creates heart-centered cosmic awareness.',
    anatomy: 'Cosmic Heart Center, Universal Love Matrix',
    order: 'Sixth'
  },
  { 
    freq: 2673, 
    chakra: 'Source Code', 
    color: '#483D8B', 
    benefit: 'Divine Source Connection', 
    description: 'Sixth order frequency (2430 + 243) that connects directly to the divine source code of creation. Access to fundamental creation frequencies.',
    anatomy: 'Divine Interface, Creation Matrix',
    order: 'Sixth'
  },
  { 
    freq: 2997, 
    chakra: 'Infinite Unity', 
    color: '#2E1B8B', 
    benefit: 'Unity Consciousness Embodiment', 
    description: 'Sixth order frequency (2673 + 324) representing the embodiment of infinite unity consciousness. The highest documented solfeggio frequency for complete transcendence.',
    anatomy: 'Unified Field, Infinite Consciousness',
    order: 'Sixth'
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
  { shape: 'Cube (Hexahedron)', freq: '174Hz', benefit: 'Stability, Grounding', element: 'Earth', desc: 'The most stable form. Represents the physical plane, the body, and safety.' },
  { shape: 'Reiki Cho Ku Rei', freq: '285Hz', benefit: 'Energy Flow', element: 'Aether', desc: 'The "Power Switch" symbol. It concentrates energy at a specific point for healing.' },
  { shape: 'Tetrahedron', freq: '396Hz', benefit: 'Manifestation', element: 'Fire', desc: 'The first 3D form. Represents the spark of life, will, and the drive to exist.' },
  { shape: 'Icosahedron', freq: '417Hz', benefit: 'Fluidity & Change', element: 'Water', desc: 'With 20 faces, it represents the flow of water, emotions, and adaptability.' },
  { shape: 'Octahedron', freq: '528Hz', benefit: 'Balance & Air', element: 'Air', desc: 'Two pyramids meeting at the base. Represents the balance of "As Above, So Below."' },
  { shape: 'Star Tetrahedron', freq: '639Hz', benefit: 'Integration', element: 'Light', desc: 'The Merkaba (Light-Spirit-Body). Interlocking opposites creating a unified field.' },
  { shape: 'Dodecahedron', freq: '741Hz', benefit: 'Expression', element: 'Ether', desc: 'The 12 faces represent the zodiac and the universe. The shape of the Spirit.' },
  { shape: 'Torus', freq: '852Hz', benefit: 'Universal Flow', element: 'Cosmos', desc: 'The primary pattern of energy in the universe, from magnetic fields to galaxies.' },
  { shape: 'Fibonacci Sphere', freq: '963Hz', benefit: 'Perfection', element: 'Void', desc: 'Points distributed by the Golden Ratio. Represents the perfect order of the Creator.' },
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