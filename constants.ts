
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

export const CHAKRA_INFO_TEXT = `
The ancient Solfeggio frequencies are believed to penetrate deep into the conscious and subconscious mind, 
drawing forth emotional reactions that we sometimes cannot completely control. These frequencies trace back to ancient history 
and are said to be the fundamental sounds used in Western Christianity and Eastern Indian religions, 
chanted by the Gregorian Monks and in ancient Indian Sanskrit chants. 

Qi (Chi) is the life force energy that flows through all living things. 
By aligning the frequencies of the music to the natural geometry of the universe (432Hz) and your body's energy centers (Chakras), 
this player attempts to restore harmonic balance.
`;

export const TREE_OF_LIFE_EXPLANATION = `
The Tree of Life (Etz Chaim) is the central mystical symbol of Kabbalah, representing the blueprint of the cosmos and the soul's journey toward the Divine. It is composed of ten emanations called Sephirot, connected by 22 paths, arranged into three columns:

The Right Pillar (Force/Mercy): Active, expansive energy. It represents the urge to give and flow.
The Left Pillar (Form/Severity): Passive, restrictive energy. It creates boundaries, structure, and discipline.
The Middle Pillar (Balance/Mildness): The harmonizing path that integrates Force and Form, allowing for direct ascent to the Divine.

Energetically, the Tree maps perfectly to the human body and the Chakra system. As music plays, observe how the frequencies stimulate the corresponding nodes, moving from the dense physical vibration of Malkuth up to the spiritual purity of Keter.
`;

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
