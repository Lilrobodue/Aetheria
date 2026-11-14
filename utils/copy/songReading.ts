// utils/copy/songReading.ts (v16.9, "What it says": the song reading in Track info)
//
// What a crystal holds beyond its name and association (crystalCopy.ts): its script name, its hexagram with the
// Judgment in James Legge's translation (public domain), its place in the Lo Shu cube, and its Moon mansion's lore.
// The words come from the Aetheria Tone Codex (Joe and Alisha Lewis, 13 Nov 2026), the same canon the Aetheria
// Divination app reads (its data/frequencies.json, legge.json and tones.json): a song gets the same reading in both
// apps. Mansion lore: Wikipedia "Nakshatra" (after A. L. Basham, The Wonder That Was India); ruling planets from Brihat
// Parashara Hora Shastra 46.12. Every entry carries the Tradition tag (check:copy's T2 rule). Pure, Node-checked.
//
// One correction to the codex (the user, 14 Nov 2026): 16 Vishakha's deity is Indra and Agni together (Indragni), as
// Wikipedia's table gives it ("Indra ... and Agni, god of Fire"; the padas table "Indra Agni"). The codex had Indra
// alone, which is 18 Jyeshtha's. The Divination app's data/tones.json needs the same fix for the two apps to agree.

import type { Tier } from './evidence.ts';

export interface ToneReading {
  hz: number;
  /** The tone's script name (The Chorus), as the cube atlas and the Divination app name it. */
  script: string;
  hexagram: number;
  hexagramName: string;
  /** The hexagram's Judgment, in Legge's words. */
  judgment: string;
  /** Review round 1: the codex's geometry line where it shortened constants.ts's GEOMETRY_INFO desc to drop health
   *  words (1692, 5274; its _source says so); the other 25 are GEOMETRY_INFO's own, word for word. */
  geometryLine?: string;
  /** Layer and Lo Shu palace: "HEAD layer, palace 4, south-east, Wood, ☴ Xun". */
  palace: string;
  /** The Moon mansion with the tone's number: "22 Shravana". */
  mansion: string;
  mansionMeaning: string;
  deity: string;
  symbol: string;
  planet: string;
  tag: Tier;
}

export const TONE_READINGS: readonly ToneReading[] = [
  { hz: 174, script: 'The Circle', hexagram: 8, hexagramName: 'Holding Together',
    judgment: 'Pî indicates that (under the conditions which it supposes) there is good fortune. But let (the principal party intended in it) re-examine himself, (as if) by divination, whether his virtue be great, unintermitting, and firm. If it be so, there will be no error. Those who have not rest will then come to him; and with those who are (too) late in coming it will be ill.',
    palace: 'GUT layer, palace 1, north, Water, ☵ Kan', mansion: '1 Ashwini', mansionMeaning: 'The Horsemen',
    deity: 'the Ashvins, horse-headed twins, physicians to the gods', symbol: 'horse\'s head', planet: 'Ketu', tag: 'tradition' },
  { hz: 285, script: 'The Mirror', hexagram: 22, hexagramName: 'Grace',
    judgment: 'Pî indicates that there should be free course (in what it denotes). There will be little advantage (however) if it be allowed to advance (and take the lead).',
    palace: 'GUT layer, palace 2, south-west, Earth, ☷ Kun', mansion: '2 Bharani', mansionMeaning: 'The Bearer',
    deity: 'Yama, god of death and dharma', symbol: 'yoni, the womb', planet: 'Venus', tag: 'tradition' },
  { hz: 396, script: 'The Storm', hexagram: 51, hexagramName: 'The Arousing',
    judgment: 'Kăn gives the intimation of ease and development. When (the time of) movement (which it indicates) comes, (the subject of the hexagram) will be found looking out with apprehension, and yet smiling and talking cheerfully. When the movement (like a crash of thunder) terrifies all within a hundred lî, he will be (like the sincere worshipper) who is not (startled into) letting go his ladle and (cup of) sacrificial spirits.',
    palace: 'GUT layer, palace 3, east, Wood, ☳ Zhen', mansion: '3 Krittika', mansionMeaning: 'To Cut',
    deity: 'Agni, god of fire', symbol: 'knife or spear', planet: 'Sun', tag: 'tradition' },
  { hz: 417, script: 'The Gate', hexagram: 53, hexagramName: 'Development',
    judgment: 'Kien suggests to us the marriage of a young lady, and the good fortune (attending it). There will be advantage in being firm and correct.',
    palace: 'GUT layer, palace 4, south-east, Wood, ☴ Xun', mansion: '4 Rohini', mansionMeaning: 'Radiant Maiden',
    deity: 'Prajapati, the Creator', symbol: 'cart or chariot, temple, banyan tree', planet: 'Moon', tag: 'tradition' },
  { hz: 528, script: 'The Drift', hexagram: 2, hexagramName: 'The Receptive',
    judgment: 'Khwăn (represents) what is great and originating, penetrating, advantageous, correct and having the firmness of a mare. When the superior man (here intended) has to make any movement, if he take the initiative, he will go astray; if he follow, he will find his (proper) lord. The advantageousness will be seen in his getting friends in the south-west, and losing friends in the north-east. If he rest in correctness and firmness, there will be good fortune.',
    palace: 'GUT layer, palace 5, the center, Earth', mansion: '5 Mrigashira', mansionMeaning: 'The Deer\'s Head',
    deity: 'Soma, the moon god', symbol: 'deer\'s head', planet: 'Mars', tag: 'tradition' },
  { hz: 639, script: 'The Root', hexagram: 24, hexagramName: 'Return',
    judgment: 'Fû indicates that there will be free course and progress (in what it denotes). (The subject of it) finds no one to distress him in his exits and entrances; friends come to him, and no error is committed. He will return and repeat his (proper) course. In seven days comes his return. There will be advantage in whatever direction movement is made.',
    palace: 'GUT layer, palace 6, north-west, Metal, ☰ Qian', mansion: '6 Ardra', mansionMeaning: 'The Moist One',
    deity: 'Rudra, the fierce form of Shiva', symbol: 'teardrop, diamond, a human head', planet: 'Rahu', tag: 'tradition' },
  { hz: 741, script: 'The Spark', hexagram: 30, hexagramName: 'Radiance',
    judgment: 'Lî indicates that, (in regard to what it denotes), it will be advantageous to be firm and correct, and that thus there will be free course and success. Let (its subject) also nourish (a docility like that of) the cow, and there will be good fortune.',
    palace: 'GUT layer, palace 7, west, Metal, ☱ Dui', mansion: '7 Punarvasu', mansionMeaning: 'Return of the Light',
    deity: 'Aditi, the infinite, mother of the Adityas', symbol: 'bow and quiver', planet: 'Jupiter', tag: 'tradition' },
  { hz: 852, script: 'The Still Point', hexagram: 52, hexagramName: 'Keeping Still',
    judgment: 'When one\'s resting is like that of the back, and he loses all consciousness of self; when he walks in his courtyard, and does not see any (of the persons) in it,--there will be no error.',
    palace: 'GUT layer, palace 8, north-east, Earth, ☶ Gen', mansion: '8 Pushya', mansionMeaning: 'The Nourisher',
    deity: 'Brihaspati, counsellor of the gods', symbol: 'cow\'s udder, lotus, arrow and circle', planet: 'Saturn', tag: 'tradition' },
  { hz: 963, script: 'The Tide', hexagram: 61, hexagramName: 'Inner Truth',
    judgment: 'Kung Fû (moves even) pigs and fish, and leads to good fortune. There will be advantage in crossing the great stream. There will be advantage in being firm and correct.',
    palace: 'GUT layer, palace 9, south, Fire, ☲ Li', mansion: '9 Ashlesha', mansionMeaning: 'The Embrace',
    deity: 'the Nagas, serpent beings', symbol: 'serpent', planet: 'Mercury', tag: 'tradition' },
  { hz: 1206, script: 'The River', hexagram: 29, hexagramName: 'The Abysmal',
    judgment: 'Khan, here repeated, shows the possession of sincerity, through which the mind is penetrating. Action (in accordance with this) will be of high value.',
    palace: 'HEART layer, palace 1, north, Water, ☵ Kan', mansion: '10 Magha', mansionMeaning: 'The Mighty',
    deity: 'the Pitrs, the ancestors', symbol: 'royal throne', planet: 'Ketu', tag: 'tradition' },
  { hz: 1449, script: 'The Fog', hexagram: 4, hexagramName: 'Youthful Folly',
    judgment: 'Măng (indicates that in the case which it presupposes) there will be progress and success. I do not (go and) seek the youthful and inexperienced, but he comes and seeks me. When he shows (the sincerity that marks) the first recourse to divination, I instruct him. If he apply a second and third time, that is troublesome; and I do not instruct the troublesome. There will be advantage in being firm and correct.',
    palace: 'HEART layer, palace 2, south-west, Earth, ☷ Kun', mansion: '11 Purva Phalguni', mansionMeaning: 'The Former Reddish One',
    deity: 'Bhaga, god of marital bliss and prosperity', symbol: 'front legs of a bed, hammock, fig tree', planet: 'Venus', tag: 'tradition' },
  { hz: 1692, script: 'The Edge', hexagram: 34, hexagramName: 'Power of the Great',
    geometryLine: 'The spiral of nature based on the Golden Ratio, found in galaxies and shells.',
    judgment: 'Tâ Kwang indicates that (under the conditions which it symbolises) it will be advantageous to be firm and correct.',
    palace: 'HEART layer, palace 3, east, Wood, ☳ Zhen', mansion: '12 Uttara Phalguni', mansionMeaning: 'The Latter Reddish One',
    deity: 'Aryaman, god of patronage and favours', symbol: 'four legs of a bed, hammock', planet: 'Sun', tag: 'tradition' },
  { hz: 1935, script: 'The Lighthouse', hexagram: 20, hexagramName: 'Contemplation',
    judgment: 'Kwân shows (how he whom it represents should be like) the worshipper who has washed his hands, but not (yet) presented his offerings;--with sincerity and an appearance of dignity (commanding reverent regard).',
    palace: 'HEART layer, palace 4, south-east, Wood, ☴ Xun', mansion: '13 Hasta', mansionMeaning: 'The Hand',
    deity: 'Savitr, the sun god', symbol: 'hand or fist', planet: 'Moon', tag: 'tradition' },
  { hz: 2178, script: 'The Source', hexagram: 11, hexagramName: 'Peace',
    judgment: 'In Thâi (we see) the little gone and the great come. (It indicates that) there will be good fortune, with progress and success.',
    palace: 'HEART layer, palace 5, the center, Earth', mansion: '14 Chitra', mansionMeaning: 'The Bright One',
    deity: 'Tvashtar (Vishwakarma), the artisan god', symbol: 'bright jewel or pearl', planet: 'Mars', tag: 'tradition' },
  { hz: 2421, script: 'The Autumn', hexagram: 23, hexagramName: 'Splitting Apart',
    judgment: 'Po indicates that (in the state which it symbolises) it will not be advantageous to make a movement in any direction whatever.',
    palace: 'HEART layer, palace 6, north-west, Metal, ☰ Qian', mansion: '15 Swati', mansionMeaning: 'The Independent One',
    deity: 'Vayu, the wind god', symbol: 'shoot of a plant, coral', planet: 'Rahu', tag: 'tradition' },
  { hz: 2664, script: 'The Vessel', hexagram: 50, hexagramName: 'The Caldron',
    judgment: 'Ting gives the intimation of great progress and success.',
    palace: 'HEART layer, palace 7, west, Metal, ☱ Dui', mansion: '16 Vishakha', mansionMeaning: 'Branching Out',
    deity: 'Indra and Agni together (Indragni), gods of thunder and fire', symbol: 'triumphal arch, potter\'s wheel', planet: 'Jupiter', tag: 'tradition' },
  { hz: 2907, script: 'The Dawn', hexagram: 49, hexagramName: 'Revolution',
    judgment: '(What takes place as indicated by) Ko is believed in only after it has been accomplished. There will be great progress and success. Advantage will come from being firm and correct. (In that case) occasion for repentance will disappear.',
    palace: 'HEART layer, palace 8, north-east, Earth, ☶ Gen', mansion: '17 Anuradha', mansionMeaning: 'Following Radha',
    deity: 'Mitra, god of friendship and partnership', symbol: 'triumphal archway, lotus, bamboo', planet: 'Saturn', tag: 'tradition' },
  { hz: 3150, script: 'The Garden', hexagram: 46, hexagramName: 'Pushing Upward',
    judgment: 'Shăng indicates that (under its conditions) there will be great progress and success. Seeking by (the qualities implied in it) to meet with the great man, its subject need have no anxiety. Advance to the south will be fortunate.',
    palace: 'HEART layer, palace 9, south, Fire, ☲ Li', mansion: '18 Jyeshtha', mansionMeaning: 'The Eldest',
    deity: 'Indra, king of the gods', symbol: 'circular amulet, umbrella, earring', planet: 'Mercury', tag: 'tradition' },
  { hz: 3504, script: 'The Forge', hexagram: 21, hexagramName: 'Biting Through',
    judgment: 'Shih Ho indicates successful progress (in the condition of things which it supposes). It will be advantageous to use legal constraints.',
    palace: 'HEAD layer, palace 1, north, Water, ☵ Kan', mansion: '19 Mula', mansionMeaning: 'The Root',
    deity: 'Nirrti, goddess of decay and sorrow', symbol: 'bunch of roots tied together, elephant goad', planet: 'Ketu', tag: 'tradition' },
  { hz: 3858, script: 'The Receiver', hexagram: 48, hexagramName: 'The Well',
    judgment: '(Looking at) Žing, (we think of) how (the site of) a town may be changed, while (the fashion of) its wells undergoes no change. (The water of a well) never disappears and never receives (any great) increase, and those who come and those who go can draw and enjoy the benefit. If (the drawing) have nearly been accomplished, but, before the rope has quite reached the water, the bucket is broken, this is evil.',
    palace: 'HEAD layer, palace 2, south-west, Earth, ☷ Kun', mansion: '20 Purva Ashadha', mansionMeaning: 'The Former Unconquered',
    deity: 'Apah, the waters', symbol: 'elephant tusk, fan, winnowing basket', planet: 'Venus', tag: 'tradition' },
  { hz: 4212, script: 'The Signal', hexagram: 58, hexagramName: 'The Joyous',
    judgment: 'Tui intimates that (under its conditions) there will be progress and attainment. (But) it will be advantageous to be firm and correct.',
    palace: 'HEAD layer, palace 3, east, Wood, ☳ Zhen', mansion: '21 Uttara Ashadha', mansionMeaning: 'The Latter Unconquered',
    deity: 'the Vishvedevas, all the gods gathered', symbol: 'elephant tusk, small bed', planet: 'Sun', tag: 'tradition' },
  { hz: 4566, script: 'The Chorus', hexagram: 45, hexagramName: 'Gathering Together',
    judgment: 'In (the state denoted by) Žhui, the king will repair to his ancestral temple. It will be advantageous (also) to meet with the great man; and then there will be progress and success, though the advantage must come through firm correctness. The use of great victims will conduce to good fortune; and in whatever direction movement is made, it will be advantageous.',
    palace: 'HEAD layer, palace 4, south-east, Wood, ☴ Xun', mansion: '22 Shravana', mansionMeaning: 'To Hear',
    deity: 'Vishnu, preserver of the universe', symbol: 'ear, or three footprints', planet: 'Moon', tag: 'tradition' },
  { hz: 4920, script: 'The Vastness', hexagram: 57, hexagramName: 'The Gentle',
    judgment: 'Sun intimates that (under the conditions which it denotes) there will be some little attainment and progress. There will be advantage in movement onward in whatever direction. It will be advantageous (also) to see the great man.',
    palace: 'HEAD layer, palace 5, the center, Earth', mansion: '23 Dhanishta', mansionMeaning: 'Wealthiest',
    deity: 'the Vasus, eight gods of fire and light', symbol: 'drum or flute', planet: 'Mars', tag: 'tradition' },
  { hz: 5274, script: 'The Temple', hexagram: 42, hexagramName: 'Increase',
    geometryLine: 'Complex circular patterns representing the journey from fragmentation to wholeness.',
    judgment: 'Yî indicates that (in the state which it denotes) there will be advantage in every movement which shall be undertaken, that it will be advantageous (even) to cross the great stream.',
    palace: 'HEAD layer, palace 6, north-west, Metal, ☰ Qian', mansion: '24 Shatabhisha', mansionMeaning: 'A Hundred Physicians',
    deity: 'Varuna, god of the celestial waters', symbol: 'empty circle, 1,000 flowers or stars', planet: 'Rahu', tag: 'tradition' },
  { hz: 5628, script: 'The Aurora', hexagram: 55, hexagramName: 'Abundance',
    judgment: 'Făng intimates progress and development. When a king has reached the point (which the name denotes) there is no occasion to be anxious (through fear of a change). Let him be as the sun at noon.',
    palace: 'HEAD layer, palace 7, west, Metal, ☱ Dui', mansion: '25 Purva Bhadrapada', mansionMeaning: 'The Former Blessed Feet',
    deity: 'Ajaikapada, the one-footed aspect of Shiva', symbol: 'swords, front legs of a funeral cot, a man with two faces', planet: 'Jupiter', tag: 'tradition' },
  { hz: 5982, script: 'The Presence', hexagram: 31, hexagramName: 'Influence',
    judgment: 'Hsien indicates that, (on the fulfilment of the conditions implied in it), there will be free course and success. Its advantageousness will depend on the being firm and correct, (as) in marrying a young lady. There will be good fortune.',
    palace: 'HEAD layer, palace 8, north-east, Earth, ☶ Gen', mansion: '26 Uttara Bhadrapada', mansionMeaning: 'The Latter Blessed Feet',
    deity: 'Ahirbudhnya, serpent of the deep', symbol: 'twins, back legs of a funeral cot, snake in the water', planet: 'Saturn', tag: 'tradition' },
  { hz: 6336, script: 'The Summit', hexagram: 1, hexagramName: 'The Creative',
    judgment: 'Khien (represents) what is great and originating, penetrating, advantageous, correct and firm.',
    palace: 'HEAD layer, palace 9, south, Fire, ☲ Li', mansion: '27 Revati', mansionMeaning: 'Prosperous',
    deity: 'Pushan, the nourisher, guide of souls', symbol: 'fish or a pair of fish, drum', planet: 'Mercury', tag: 'tradition' },
];

/** The reading for one of the 27 crystals (null for anything else). */
export function toneReading(hz: number): ToneReading | null {
  return TONE_READINGS.find((t) => t.hz === hz) ?? null;
}

export const SONG_READING_TITLE = 'What it says';
/** How the crystal was found: the scan's assignment, not a measured pitch (Design choice). */
export const SONG_READING_HOW = { text: 'Deep Scan gives a song its crystal, and the reading follows that crystal. The scan places a song among the 27; it is not the song’s measured pitch. The Aetheria Divination app reads a song file the same way.', tag: 'design' } as const;
export const SONG_READING_UNSCANNED = 'Scan this track (Library › Deep Scan) to read what its crystal holds.';
/** Review round 1: a scan that couldn't read the track (its placeholder crystal): no queue scans it again, so no Scan line. */
export const SONG_READING_FAILED = 'Deep Scan couldn’t read this track, so it has no reading.';
export const LEGGE_CREDIT = 'The Judgment, in James Legge’s translation.';
