

import { SolfeggioFreq, BinauralPreset } from './types';

export const SOLFEGGIO_INFO = [
  { freq: 174, chakra: 'Earth Star', color: '#8B0000', benefit: 'Relieves pain and stress.' },
  { freq: 285, chakra: 'Root', color: '#FF0000', benefit: 'Heals tissues and organs.' },
  { freq: 396, chakra: 'Root', color: '#FF4500', benefit: 'Liberates form guilt and fear.' },
  { freq: 417, chakra: 'Sacral', color: '#FF8C00', benefit: 'Undoing situations and facilitating change.' },
  { freq: 528, chakra: 'Solar Plexus', color: '#FFD700', benefit: 'Transformation and miracles (DNA Repair).' },
  { freq: 639, chakra: 'Heart', color: '#008000', benefit: 'Connecting/Relationships.' },
  { freq: 741, chakra: 'Throat', color: '#00BFFF', benefit: 'Expression/Solutions.' },
  { freq: 852, chakra: 'Third Eye', color: '#4B0082', benefit: 'Returning to spiritual order.' },
  { freq: 963, chakra: 'Crown', color: '#EE82EE', benefit: 'Connection to Cosmos/Oneness.' },
];

export const BINAURAL_PRESETS: BinauralPreset[] = [
  { name: 'Delta', delta: 2, description: 'Deep Sleep (0.5-4Hz)' },
  { name: 'Theta', delta: 6, description: 'Meditation/REM (4-8Hz)' },
  { name: 'Alpha', delta: 10, description: 'Relaxation (8-13Hz)' },
  { name: 'Beta', delta: 20, description: 'Focus/Activity (13-30Hz)' },
  { name: 'Gamma', delta: 40, description: 'High Processing (30Hz+)' },
];

// 432Hz Conversion Factor (432 / 440)
export const PITCH_SHIFT_FACTOR = 0.981818; 

export const UNIFIED_THEORY = {
  intro: `Aetheria is not just a music player; it is a harmonic alignment engine designed to synchronize three planes of existence: The Mathematical (Sound), The Biological (Body), and The Spiritual (Cosmos).`,
  
  section1: {
    title: "The Mathematical Foundation (432Hz)",
    content: `Standard music is tuned to A=440Hz, a frequency established in the mid-20th century that some theorists argue causes subconscious agitation. Aetheria mathematically retunes every audio signal to A=432Hz. This frequency is mathematically consistent with the patterns of the universe, often referred to as "Verdi's A" or the "Scientific Pitch." It is said to resonate with the Golden Ratio (Phi) found in nature, from the spiral of a nautilus shell to the orbital periods of planets.`
  },

  section2: {
    title: "The Biological Interface (Solfeggio & Chakras)",
    content: `Once the music is grounded in 432Hz, we layer specific Solfeggio Frequencies. These are distinct tones used in ancient Gregorian chants. In Aetheria, we map these tones directly to the human energy centers (Chakras).
    
    • Lower Frequencies (174-396Hz) target the dense physical body (pain relief, fear release), grounding you to the Earth.
    • Middle Frequencies (417-639Hz) target the emotional body (change, DNA repair, connection), opening the Heart and Solar Plexus.
    • Higher Frequencies (741-963Hz) target the etheric body (intuition, awakening), connecting the Pineal Gland to the Source.`
  },

  section3: {
    title: "The Cosmological Map (The Tree of Life)",
    content: `The visualizations you see are not random. They represent the Kabbalistic Tree of Life (Etz Chaim), a map of how divine energy flows into the physical world.

    • The Spheres (Sephirot): These glowing nodes represent attributes of the Divine (Wisdom, Understanding, Mercy, Severity). As music plays, you see energy traveling between them.
    • The Path of the Lightning Flash: Energy creates a zigzag pattern, moving from Keter (Crown/Source) down through the Sephirot to Malkuth (Kingdom/Physical Reality).
    • The Goal: By watching the flow, you are visually "entraining" your mind to the concept of descending light (manifestation) and ascending light (liberation).`
  },

  conclusion: `When you use Aetheria, you are creating a feedback loop: The 432Hz music calms the mind, the Solfeggio tones align the Chakras, and the Sacred Geometry visualizations guide the consciousness along the divine path of the Tree of Life. This integration aims to produce a state of coherence, where thought, feeling, and geometry become one.`
};

export const GEOMETRY_INFO = [
  { shape: 'Cube', freq: '174Hz', benefit: 'Stability, Grounding, Physical Safety', element: 'Earth' },
  { shape: 'Reiki Symbol', freq: '285Hz', benefit: 'Healing, Tissue Restoration', element: 'Aether' },
  { shape: 'Tetrahedron', freq: '396Hz', benefit: 'Liberation from Fear, Fire Energy', element: 'Fire' },
  { shape: 'Icosahedron', freq: '417Hz', benefit: 'Facilitating Change, Fluidity', element: 'Water' },
  { shape: 'Octahedron', freq: '528Hz', benefit: 'Transformation, Miracles, Air Energy', element: 'Air' },
  { shape: 'Merkaba', freq: '639Hz', benefit: 'Connection, Relationships, Spirit/Body Balance', element: 'Light' },
  { shape: 'Dodecahedron', freq: '741Hz', benefit: 'Expression, Solving Problems, Spirit', element: 'Ether' },
  { shape: 'Torus', freq: '852Hz', benefit: 'Intuition, Returning to Order', element: 'Cosmos' },
  { shape: 'Fibonacci Sphere', freq: '963Hz', benefit: 'Oneness, Connection to Source', element: 'Void' },
];

export const SEPHIROT_INFO = [
  { name: 'Malkuth', meaning: 'Kingdom', correspondence: 'The physical body, Earth, grounding, and final manifestation. (Root Chakra/Feet)', color: '#FF0000' },
  { name: 'Yesod', meaning: 'Foundation', correspondence: 'The subconscious, dreams, sexual energy, and connection. (Sacral Chakra)', color: '#FF8C00' },
  { name: 'Hod', meaning: 'Splendor', correspondence: 'Intellect, logic, language, and ritual magic. (Left Hip/Solar Plexus)', color: '#FFD700' },
  { name: 'Netzach', meaning: 'Victory', correspondence: 'Emotion, endurance, nature, and artistic drive. (Right Hip/Solar Plexus)', color: '#FFD700' },
  { name: 'Tiferet', meaning: 'Beauty', correspondence: 'Harmony, compassion, the self, and the heart center. (Heart Chakra)', color: '#008000' },
  { name: 'Gevurah', meaning: 'Severity', correspondence: 'Discipline, judgment, strength, and awe of God. (Left Shoulder)', color: '#00BFFF' },
  { name: 'Chesed', meaning: 'Mercy', correspondence: 'Unconditional love, benevolence, and infinite expansion. (Right Shoulder)', color: '#00BFFF' },
  { name: 'Daat', meaning: 'Knowledge', correspondence: 'The invisible Sephirot. The abyss, hidden wisdom, and the throat. (Throat Chakra)', color: '#4B0082' },
  { name: 'Binah', meaning: 'Understanding', correspondence: 'Intuition, contemplation, the Divine Mother, and form. (Left Brain/Third Eye)', color: '#4B0082' },
  { name: 'Chokhmah', meaning: 'Wisdom', correspondence: 'Flash of inspiration, pure creative force, the Divine Father. (Right Brain/Third Eye)', color: '#4B0082' },
  { name: 'Keter', meaning: 'Crown', correspondence: 'The Divine Source, pure consciousness, infinite light (Ain Soph Aur). (Crown Chakra)', color: '#EE82EE' },
];