// utils/copy/songReading.ts (v16.9, "What it says": the song reading in Track info)
//
// v16.12 (the brief of 14 Nov 2026): each tone's "In words" paragraph, the codex's prose as Joe and Alisha approved it,
// word for word (Divination data/tones.json `prose`: cec439e as edited by Joe's answers on "The 27 Paragraphs",
// 02b0351), shown first in What it says.
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
  /** v16.12: the codex's "In words" paragraph for the tone, word for word (approved by Joe and Alisha, 14 Nov 2026,
   *  with Joe's answers 1 A, 3 A and 4 A on "The 27 Paragraphs": the Aetheria EEG player named, The Summit's place,
   *  the HEAD palaces' elements; Divination data/tones.json `prose`, 02b0351). Shown first in What it says. Its quotes
   *  are Legge's Judgments. */
  prose: string;
  /** The tone's script name (The Chorus), as the cube atlas and the Divination app name it. */
  script: string;
  hexagram: number;
  hexagramName: string;
  /** The hexagram's Judgment, in Legge's words. */
  judgment: string;
  /** Review round 1: the codex's geometry line where it shortened constants.ts's GEOMETRY_INFO desc to drop health
   *  words (5274; its _source says so; v16.10 shortened 1692's GEOMETRY_INFO desc itself); the others are
   *  GEOMETRY_INFO's own, word for word. */
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
    deity: 'the Ashvins, horse-headed twins, physicians to the gods', symbol: 'horse\'s head', planet: 'Ketu', prose: 'The Circle is where the climb begins, the first and lowest of the 27 tones. Its function name is Foundation. Its hexagram, 8 Holding Together, is water over the earth, water gathering into one body on the ground, and Legge\'s Judgment says "those who have not rest will then come to him." Its geometry, the Seed of Life, is seven circles from which every other form grows. It sits in the north palace, Water (☵ Kan), and its Moon mansion is Ashwini, "the horsemen", the twin Ashvins who open the zodiac. In the Aetheria framework, The Circle is the ground everything else stands on.',
    tag: 'tradition' },
  { hz: 285, script: 'The Mirror', hexagram: 22, hexagramName: 'Grace',
    judgment: 'Pî indicates that there should be free course (in what it denotes). There will be little advantage (however) if it be allowed to advance (and take the lead).',
    palace: 'GUT layer, palace 2, south-west, Earth, ☷ Kun', mansion: '2 Bharani', mansionMeaning: 'The Bearer',
    deity: 'Yama, god of death and dharma', symbol: 'yoni, the womb', planet: 'Venus', prose: 'The Mirror is the second step of the GUT layer. Its function name is Renewal, the Guide\'s word for it. Its hexagram, 22 Grace, is a mountain over fire, light at the mountain\'s foot that shows its shape, and Legge\'s Judgment says "there should be free course," with "little advantage" in pushing ahead. Its geometry, the Flower of Life, holds the whole pattern of creation inside its circles. It sits in the south-west palace, Earth (☷ Kun), and its Moon mansion is Bharani, "the bearer", held by Yama, lord of dharma, its symbol the womb. In the Aetheria framework, The Mirror is seeing yourself clearly enough to begin again.',
    tag: 'tradition' },
  { hz: 396, script: 'The Storm', hexagram: 51, hexagramName: 'The Arousing',
    judgment: 'Kăn gives the intimation of ease and development. When (the time of) movement (which it indicates) comes, (the subject of the hexagram) will be found looking out with apprehension, and yet smiling and talking cheerfully. When the movement (like a crash of thunder) terrifies all within a hundred lî, he will be (like the sincere worshipper) who is not (startled into) letting go his ladle and (cup of) sacrificial spirits.',
    palace: 'GUT layer, palace 3, east, Wood, ☳ Zhen', mansion: '3 Krittika', mansionMeaning: 'To Cut',
    deity: 'Agni, god of fire', symbol: 'knife or spear', planet: 'Sun', prose: 'The Storm closes the first order of the GUT layer. Its function name is Liberating Fear & Guilt. Its hexagram, 51 The Arousing, is thunder over thunder, a crash that "terrifies all within a hundred lî," and yet in Legge\'s Judgment its subject is found "smiling and talking cheerfully." Its geometry, the Vesica Piscis, is two circles overlapping into an almond, a doorway, the portal of birth. It sits in the east palace, Wood (☳ Zhen), and its Moon mansion is Krittika, "to cut", the Pleiades, held by Agni, god of fire, its symbol a blade. In the Aetheria framework, The Storm is fear met and passed through, so that what it held can go.',
    tag: 'tradition' },
  { hz: 417, script: 'The Gate', hexagram: 53, hexagramName: 'Development',
    judgment: 'Kien suggests to us the marriage of a young lady, and the good fortune (attending it). There will be advantage in being firm and correct.',
    palace: 'GUT layer, palace 4, south-east, Wood, ☴ Xun', mansion: '4 Rohini', mansionMeaning: 'Radiant Maiden',
    deity: 'Prajapati, the Creator', symbol: 'cart or chariot, temple, banyan tree', planet: 'Moon', prose: 'The Gate opens the second order of the GUT layer. Its function name is Facilitating Change. Its hexagram, 53 Development, is wind over a mountain, progress that comes gradually, and Legge\'s Judgment speaks of "the marriage of a young lady, and the good fortune" that attends it. Its geometry, the Icosahedron, is Plato\'s solid for water, the shape of change that flows. It sits in the south-east palace, Wood (☴ Xun), and its Moon mansion is Rohini, "radiant maiden", held by Prajapati, the Creator. In the Aetheria framework, The Gate is change that comes the way a bride crosses a threshold, step by chosen step.',
    tag: 'tradition' },
  { hz: 528, script: 'The Drift', hexagram: 2, hexagramName: 'The Receptive',
    judgment: 'Khwăn (represents) what is great and originating, penetrating, advantageous, correct and having the firmness of a mare. When the superior man (here intended) has to make any movement, if he take the initiative, he will go astray; if he follow, he will find his (proper) lord. The advantageousness will be seen in his getting friends in the south-west, and losing friends in the north-east. If he rest in correctness and firmness, there will be good fortune.',
    palace: 'GUT layer, palace 5, the center, Earth', mansion: '5 Mrigashira', mansionMeaning: 'The Deer\'s Head',
    deity: 'Soma, the moon god', symbol: 'deer\'s head', planet: 'Mars', prose: 'The Drift is the center of the GUT layer and the foot of the cube\'s central pillar, 528 → 2178 → 4920. Its function name is Transformation. Its hexagram, 2 The Receptive, is earth upon earth, all six lines open, and Legge\'s Judgment gives it "the firmness of a mare": "if he follow, he will find" his way. Its geometry, Metatron\'s Cube, holds all five Platonic solids, a blueprint of creation. It sits in the center palace, Earth, and its Moon mansion is Mrigashira, "the deer\'s head", held by Soma, the moon god. In the Aetheria framework, The Drift is change that comes by yielding, the ground that receives the seed.',
    tag: 'tradition' },
  { hz: 639, script: 'The Root', hexagram: 24, hexagramName: 'Return',
    judgment: 'Fû indicates that there will be free course and progress (in what it denotes). (The subject of it) finds no one to distress him in his exits and entrances; friends come to him, and no error is committed. He will return and repeat his (proper) course. In seven days comes his return. There will be advantage in whatever direction movement is made.',
    palace: 'GUT layer, palace 6, north-west, Metal, ☰ Qian', mansion: '6 Ardra', mansionMeaning: 'The Moist One',
    deity: 'Rudra, the fierce form of Shiva', symbol: 'teardrop, diamond, a human head', planet: 'Rahu', prose: 'The Root closes the second order of the GUT layer. Its function name is Connecting Relationships. Its hexagram, 24 Return, is the earth over thunder, one strong line coming back at the bottom after the dark, and Legge\'s Judgment says "friends come to him, and no error is committed," and "in seven days comes his return." Its geometry, the Star Tetrahedron, is two tetrahedra interlocked, the masculine and the feminine in balance. It sits in the north-west palace, Metal (☰ Qian), and its Moon mansion is Ardra, "the moist one", held by Rudra, the storm, its symbol a teardrop. In the Aetheria framework, The Root is coming home to the people you belong to.',
    tag: 'tradition' },
  { hz: 741, script: 'The Spark', hexagram: 30, hexagramName: 'Radiance',
    judgment: 'Lî indicates that, (in regard to what it denotes), it will be advantageous to be firm and correct, and that thus there will be free course and success. Let (its subject) also nourish (a docility like that of) the cow, and there will be good fortune.',
    palace: 'GUT layer, palace 7, west, Metal, ☱ Dui', mansion: '7 Punarvasu', mansionMeaning: 'Return of the Light',
    deity: 'Aditi, the infinite, mother of the Adityas', symbol: 'bow and quiver', planet: 'Jupiter', prose: 'The Spark opens the third and last order of the GUT layer. Its function name is Awakening; the Aetheria EEG player plays it when its reading shows alpha rising. Its hexagram, 30 Radiance, is fire upon fire, light that clings to what it lights, and Legge\'s Judgment promises "free course and success" to one who will "nourish" a docility like the cow\'s. Its geometry, the Dodecahedron, is the shape Plato gave the cosmos itself. It sits in the west palace, Metal (☱ Dui), and its Moon mansion is Punarvasu, "return of the light", held by Aditi, the infinite. In the Aetheria framework, The Spark is the first light of waking.',
    tag: 'tradition' },
  { hz: 852, script: 'The Still Point', hexagram: 52, hexagramName: 'Keeping Still',
    judgment: 'When one\'s resting is like that of the back, and he loses all consciousness of self; when he walks in his courtyard, and does not see any (of the persons) in it,--there will be no error.',
    palace: 'GUT layer, palace 8, north-east, Earth, ☶ Gen', mansion: '8 Pushya', mansionMeaning: 'The Nourisher',
    deity: 'Brihaspati, counsellor of the gods', symbol: 'cow\'s udder, lotus, arrow and circle', planet: 'Saturn', prose: 'The Still Point is the GUT layer at rest. Its function name is Intuition. Its hexagram, 52 Keeping Still, is mountain over mountain, and Legge\'s Judgment describes a rest "like that of the back," in which one "loses all consciousness of self." Its geometry, the Octahedron, is a double pyramid, balanced between above and below. It sits in the north-east palace, Earth (☶ Gen), and its Moon mansion is Pushya, "the nourisher", held by Brihaspati, counsellor of the gods. In the Aetheria framework, The Still Point is the knowing that arrives when the mind stops reaching; the Aetheria EEG player names it wu wei.',
    tag: 'tradition' },
  { hz: 963, script: 'The Tide', hexagram: 61, hexagramName: 'Inner Truth',
    judgment: 'Kung Fû (moves even) pigs and fish, and leads to good fortune. There will be advantage in crossing the great stream. There will be advantage in being firm and correct.',
    palace: 'GUT layer, palace 9, south, Fire, ☲ Li', mansion: '9 Ashlesha', mansionMeaning: 'The Embrace',
    deity: 'the Nagas, serpent beings', symbol: 'serpent', planet: 'Mercury', prose: 'The Tide is the top of the GUT layer and its turn: the Seed ends here, and the next step, 963 + 243, is the heart. Its function name is Divine Consciousness. Its hexagram, 61 Inner Truth, is wind over a lake, its center open like a heart, and Legge\'s Judgment says it moves even "pigs and fish" and "there will be advantage in crossing the great stream." Its geometry, the Sri Yantra, is nine interlocking triangles around one point. It sits in the south palace, Fire (☲ Li), and its Moon mansion is Ashlesha, "the embrace", held by the Nagas, the serpent beings. In the Aetheria framework, The Tide is the pull that turns the climb from the body toward the heart.',
    tag: 'tradition' },
  { hz: 1206, script: 'The River', hexagram: 29, hexagramName: 'The Abysmal',
    judgment: 'Khan, here repeated, shows the possession of sincerity, through which the mind is penetrating. Action (in accordance with this) will be of high value.',
    palace: 'HEART layer, palace 1, north, Water, ☵ Kan', mansion: '10 Magha', mansionMeaning: 'The Mighty',
    deity: 'the Pitrs, the ancestors', symbol: 'royal throne', planet: 'Ketu', prose: 'The River opens the HEART layer, the first step past the body (963 + 243). Its function name is Gateway Integration. Its hexagram, 29 The Abysmal, is water upon water, and in the north palace, Water (☵ Kan), the river runs three times over. Legge\'s Judgment finds in it "the possession of sincerity, through which the mind is penetrating." Its geometry, the Torus Knot, is a ring that passes through itself and keeps on circling. Its Moon mansion is Magha, "the mighty", held by the Pitrs, the ancestors, its symbol a royal throne. In the Aetheria framework, The River is feeling allowed to move, the gateway from body to heart.',
    tag: 'tradition' },
  { hz: 1449, script: 'The Fog', hexagram: 4, hexagramName: 'Youthful Folly',
    judgment: 'Măng (indicates that in the case which it presupposes) there will be progress and success. I do not (go and) seek the youthful and inexperienced, but he comes and seeks me. When he shows (the sincerity that marks) the first recourse to divination, I instruct him. If he apply a second and third time, that is troublesome; and I do not instruct the troublesome. There will be advantage in being firm and correct.',
    palace: 'HEART layer, palace 2, south-west, Earth, ☷ Kun', mansion: '11 Purva Phalguni', mansionMeaning: 'The Former Reddish One',
    deity: 'Bhaga, god of marital bliss and prosperity', symbol: 'front legs of a bed, hammock, fig tree', planet: 'Venus', prose: 'The Fog is learning before knowing. Its function name is Harmonic Bridging. Its hexagram, 4 Youthful Folly, is a mountain over water, a spring at the mountain\'s foot still finding its way, and in Legge\'s Judgment the teacher says, "I do not (go and) seek the youthful and inexperienced, but he comes and seeks me." Its geometry, the Lemniscate, is the figure-eight of infinity, a balance between two forces. It sits in the south-west palace, Earth (☷ Kun), and its Moon mansion is Purva Phalguni, "the former reddish one", held by Bhaga, god of marital bliss, its symbol the front legs of a bed. In the Aetheria framework, The Fog is sensing your way through what you can\'t yet see; the Aetheria EEG player calls it Sensing.',
    tag: 'tradition' },
  { hz: 1692, script: 'The Edge', hexagram: 34, hexagramName: 'Power of the Great',
    judgment: 'Tâ Kwang indicates that (under the conditions which it symbolises) it will be advantageous to be firm and correct.',
    palace: 'HEART layer, palace 3, east, Wood, ☳ Zhen', mansion: '12 Uttara Phalguni', mansionMeaning: 'The Latter Reddish One',
    deity: 'Aryaman, god of patronage and favours', symbol: 'four legs of a bed, hammock', planet: 'Sun', prose: 'The Edge closes the first order of the HEART layer, in the east palace, Wood (☳ Zhen), where growing things push out. Its function name is Unified Field Access. Its hexagram, 34 Power of the Great, is thunder over heaven, strength at its height, and Legge\'s Judgment gives that strength one condition: "it will be advantageous to be firm and correct." Its geometry, the Fibonacci Spiral, is the golden ratio\'s growth, found in galaxies and shells. Its Moon mansion is Uttara Phalguni, "the latter reddish one", held by Aryaman, god of patronage and favours. In the Aetheria framework, The Edge is the heart reaching past the body\'s boundary, its power held steady; the Aetheria EEG player calls it Extension.',
    tag: 'tradition' },
  { hz: 1935, script: 'The Lighthouse', hexagram: 20, hexagramName: 'Contemplation',
    judgment: 'Kwân shows (how he whom it represents should be like) the worshipper who has washed his hands, but not (yet) presented his offerings;--with sincerity and an appearance of dignity (commanding reverent regard).',
    palace: 'HEART layer, palace 4, south-east, Wood, ☴ Xun', mansion: '13 Hasta', mansionMeaning: 'The Hand',
    deity: 'Savitr, the sun god', symbol: 'hand or fist', planet: 'Moon', prose: 'The Lighthouse opens the fifth order. Its function name is Emotional Alchemy. Its hexagram, 20 Contemplation, is wind moving over the earth, looking and being looked at, and Legge\'s Judgment pictures "the worshipper who has washed his hands, but not (yet) presented his offerings," waiting "with sincerity and an appearance of dignity." Its geometry, the Vesica Matrix, is many vesicas overlapping into one network. It sits in the south-east palace, Wood (☴ Xun), and its Moon mansion is Hasta, "the hand", held by Savitr, the sun god, its symbol a hand. In the Aetheria framework, The Lighthouse is feeling turned into seeing: the clean hand, raised before the offering.',
    tag: 'tradition' },
  { hz: 2178, script: 'The Source', hexagram: 11, hexagramName: 'Peace',
    judgment: 'In Thâi (we see) the little gone and the great come. (It indicates that) there will be good fortune, with progress and success.',
    palace: 'HEART layer, palace 5, the center, Earth', mansion: '14 Chitra', mansionMeaning: 'The Bright One',
    deity: 'Tvashtar (Vishwakarma), the artisan god', symbol: 'bright jewel or pearl', planet: 'Mars', prose: 'The Source is the center of the whole cube, SOURCE, and the middle of its central pillar, 528 → 2178 → 4920. Its function name is Compassion Activation. Its hexagram, 11 Peace, is the earth above heaven, the light rising and the heavy settling until they meet, and Legge\'s Judgment sees "the little gone and the great come." Its geometry, the Torus, is the shape of flow from atoms to galaxies, circling back through its own center. It sits in the center palace, Earth, and its Moon mansion is Chitra, "the bright one", held by Tvashtar, the artisan god, its symbol a bright jewel. In the Aetheria framework, The Source is the still center every walk passes through.',
    tag: 'tradition' },
  { hz: 2421, script: 'The Autumn', hexagram: 23, hexagramName: 'Splitting Apart',
    judgment: 'Po indicates that (in the state which it symbolises) it will not be advantageous to make a movement in any direction whatever.',
    palace: 'HEART layer, palace 6, north-west, Metal, ☰ Qian', mansion: '15 Swati', mansionMeaning: 'The Independent One',
    deity: 'Vayu, the wind god', symbol: 'shoot of a plant, coral', planet: 'Rahu', prose: 'The Autumn is letting go. Its function name is Heart Coherence. Its hexagram, 23 Splitting Apart, is a mountain over the earth, worn away from below until one strong line is left at the top, and Legge\'s Judgment counsels stillness: "it will not be advantageous to make a movement in any direction whatever." Its geometry, the Rose Curve, opens into petals by sacred ratios. It sits in the north-west palace, Metal (☰ Qian), and its Moon mansion is Swati, "the independent one", held by Vayu, the wind god, its symbol a young shoot. In the Aetheria framework, The Autumn is the heart releasing what has run its course, so that something new can grow; the Aetheria EEG player calls it Release.',
    tag: 'tradition' },
  { hz: 2664, script: 'The Vessel', hexagram: 50, hexagramName: 'The Caldron',
    judgment: 'Ting gives the intimation of great progress and success.',
    palace: 'HEART layer, palace 7, west, Metal, ☱ Dui', mansion: '16 Vishakha', mansionMeaning: 'Branching Out',
    deity: 'Indra and Agni together (Indragni), gods of thunder and fire', symbol: 'triumphal arch, potter\'s wheel', planet: 'Jupiter', prose: 'The Vessel opens the sixth order. Its function name is Relational Harmony. Its hexagram, 50 The Caldron, is fire over wind, wood feeding the flame beneath the ritual cauldron, and Legge\'s Judgment is short: "great progress and success." Its geometry, the Merkaba, is the star tetrahedron set spinning. It sits in the west palace, Metal (☱ Dui), and its Moon mansion is Vishakha, "branching out", held by Indra and Agni together, its symbol a potter\'s wheel. In the Aetheria framework, The Vessel is what we hold together and cook into something shared.',
    tag: 'tradition' },
  { hz: 2907, script: 'The Dawn', hexagram: 49, hexagramName: 'Revolution',
    judgment: '(What takes place as indicated by) Ko is believed in only after it has been accomplished. There will be great progress and success. Advantage will come from being firm and correct. (In that case) occasion for repentance will disappear.',
    palace: 'HEART layer, palace 8, north-east, Earth, ☶ Gen', mansion: '17 Anuradha', mansionMeaning: 'Following Radha',
    deity: 'Mitra, god of friendship and partnership', symbol: 'triumphal archway, lotus, bamboo', planet: 'Saturn', prose: 'The Dawn is change that is seen to be true only once it has come. Its function name is Soul Connection. Its hexagram, 49 Revolution, is a lake over fire, and Legge\'s Judgment says it "is believed in only after it has been accomplished," with "great progress and success." Its geometry, the Lissajous figure, draws two vibrations moving together into one curve. It sits in the north-east palace, Earth (☶ Gen), and its Moon mansion is Anuradha, "following Radha", held by Mitra, god of friendship and partnership. In the Aetheria framework, The Dawn is a new day made with others; the Aetheria EEG player calls it Creation.',
    tag: 'tradition' },
  { hz: 3150, script: 'The Garden', hexagram: 46, hexagramName: 'Pushing Upward',
    judgment: 'Shăng indicates that (under its conditions) there will be great progress and success. Seeking by (the qualities implied in it) to meet with the great man, its subject need have no anxiety. Advance to the south will be fortunate.',
    palace: 'HEART layer, palace 9, south, Fire, ☲ Li', mansion: '18 Jyeshtha', mansionMeaning: 'The Eldest',
    deity: 'Indra, king of the gods', symbol: 'circular amulet, umbrella, earring', planet: 'Mercury', prose: 'The Garden completes the HEART layer; the next step, 3150 + 354, is the mind. Its function name is Heart Completion. Its hexagram, 46 Pushing Upward, is the earth over wind, wood rising through the soil, and Legge\'s Judgment promises "great progress and success" and says "advance to the south will be fortunate." The Garden sits in the south palace, Fire (☲ Li). Its geometry, the Penrose Tiling, never repeats, yet keeps a perfect order. Its Moon mansion is Jyeshtha, "the eldest", held by Indra, king of the gods. In the Aetheria framework, The Garden is the heart\'s work grown to its full height.',
    tag: 'tradition' },
  { hz: 3504, script: 'The Forge', hexagram: 21, hexagramName: 'Biting Through',
    judgment: 'Shih Ho indicates successful progress (in the condition of things which it supposes). It will be advantageous to use legal constraints.',
    palace: 'HEAD layer, palace 1, north, Water, ☵ Kan', mansion: '19 Mula', mansionMeaning: 'The Root',
    deity: 'Nirrti, goddess of decay and sorrow', symbol: 'bunch of roots tied together, elephant goad', planet: 'Ketu', prose: 'The Forge is where the HEAD layer begins, the first step past the heart (3150 + 354). Its function name is Mental Clarity. Its hexagram, 21 Biting Through, is fire over thunder: a bite that closes on what stands in the way. Legge\'s Judgment promises "successful progress" and says "it will be advantageous to use legal constraints." Its geometry, the Chladni Star, is sand on a sounding plate settling into a pattern, frequency giving form. It sits in the north palace, Water, and its Moon mansion is Mula, "the root". In the Aetheria framework, The Forge is clear thinking that keeps its roots.',
    tag: 'tradition' },
  { hz: 3858, script: 'The Receiver', hexagram: 48, hexagramName: 'The Well',
    judgment: '(Looking at) Žing, (we think of) how (the site of) a town may be changed, while (the fashion of) its wells undergoes no change. (The water of a well) never disappears and never receives (any great) increase, and those who come and those who go can draw and enjoy the benefit. If (the drawing) have nearly been accomplished, but, before the rope has quite reached the water, the bucket is broken, this is evil.',
    palace: 'HEAD layer, palace 2, south-west, Earth, ☷ Kun', mansion: '20 Purva Ashadha', mansionMeaning: 'The Former Unconquered',
    deity: 'Apah, the waters', symbol: 'elephant tusk, fan, winnowing basket', planet: 'Venus', prose: 'The Receiver is listening before speaking. Its function name is Sacred Geometry, the Guide\'s "divine architecture". Its hexagram, 48 The Well, is water over wood: a town may move, Legge says, but its well stays, and "those who come and those who go can draw and enjoy the benefit." Its geometry, the Wave Function, holds every possible state at once, before one is chosen. It sits in the south-west palace, the receptive Earth (☷ Kun), and its Moon mansion, Purva Ashadha, belongs to Apah, the waters. In the Aetheria framework, The Receiver is the mind emptied so it can be filled.',
    tag: 'tradition' },
  { hz: 4212, script: 'The Signal', hexagram: 58, hexagramName: 'The Joyous',
    judgment: 'Tui intimates that (under its conditions) there will be progress and attainment. (But) it will be advantageous to be firm and correct.',
    palace: 'HEAD layer, palace 3, east, Wood, ☳ Zhen', mansion: '21 Uttara Ashadha', mansionMeaning: 'The Latter Unconquered',
    deity: 'the Vishvedevas, all the gods gathered', symbol: 'elephant tusk, small bed', planet: 'Sun', prose: 'The Signal answers The Receiver: what was taken in is now sent out. Its function name is Consciousness Mastery. Its hexagram, 58 The Joyous, is lake over lake, two open surfaces mirroring each other, and Legge\'s Judgment says "there will be progress and attainment." Its geometry, the Antenna Array, both receives and transmits. It sits in the east palace, Wood, where Thunder (☳) wakes things, and its Moon mansion, Uttara Ashadha, belongs to all the gods gathered. In the Aetheria framework, The Signal is a clear mind speaking so that others can hear.',
    tag: 'tradition' },
  { hz: 4566, script: 'The Chorus', hexagram: 45, hexagramName: 'Gathering Together',
    judgment: 'In (the state denoted by) Žhui, the king will repair to his ancestral temple. It will be advantageous (also) to meet with the great man; and then there will be progress and success, though the advantage must come through firm correctness. The use of great victims will conduce to good fortune; and in whatever direction movement is made, it will be advantageous.',
    palace: 'HEAD layer, palace 4, south-east, Wood, ☴ Xun', mansion: '22 Shravana', mansionMeaning: 'To Hear',
    deity: 'Vishnu, preserver of the universe', symbol: 'ear, or three footprints', planet: 'Moon', prose: 'The Chorus is the first tone past the single self; the Guide calls it the first transpersonal gate, the soul star. Its hexagram, 45 Gathering Together, is a lake over the earth, water collecting where the ground is low. In Legge\'s Judgment "the king will repair to his ancestral temple," and "in whatever direction movement is made, it will be advantageous." Its geometry, the Harmonic Web, ties every harmonic to every other. It sits in the south-east palace, Wood (☴), and its Moon mansion is Shravana, "to hear", whose symbol is an ear. In the Aetheria framework, The Chorus is many voices heard as one.',
    tag: 'tradition' },
  { hz: 4920, script: 'The Vastness', hexagram: 57, hexagramName: 'The Gentle',
    judgment: 'Sun intimates that (under the conditions which it denotes) there will be some little attainment and progress. There will be advantage in movement onward in whatever direction. It will be advantageous (also) to see the great man.',
    palace: 'HEAD layer, palace 5, the center, Earth', mansion: '23 Dhanishta', mansionMeaning: 'Wealthiest',
    deity: 'the Vasus, eight gods of fire and light', symbol: 'drum or flute', planet: 'Mars', prose: 'The Vastness is the center of the HEAD layer and the top of the cube\'s central pillar, 528 → 2178 → 4920. Its function name is Expressive Truth. Its hexagram, 57 The Gentle, is wind upon wind, a soft force that reaches everywhere; Legge\'s Judgment promises "some little attainment and progress" and "advantage in movement onward in whatever direction." Its geometry, Field Lines, draws invisible forces so they can be seen. Its Moon mansion is Dhanishta, "wealthiest", held by the Vasus, and its symbol is a drum. In the Aetheria framework, The Vastness is awareness wide enough to hold the truth and gentle enough to say it.',
    tag: 'tradition' },
  { hz: 5274, script: 'The Temple', hexagram: 42, hexagramName: 'Increase',
    geometryLine: 'Complex circular patterns representing the journey from fragmentation to wholeness.',
    judgment: 'Yî indicates that (in the state which it denotes) there will be advantage in every movement which shall be undertaken, that it will be advantageous (even) to cross the great stream.',
    palace: 'HEAD layer, palace 6, north-west, Metal, ☰ Qian', mansion: '24 Shatabhisha', mansionMeaning: 'A Hundred Physicians',
    deity: 'Varuna, god of the celestial waters', symbol: 'empty circle, 1,000 flowers or stars', planet: 'Rahu', prose: 'The Temple is the third transpersonal gate, the universal mind, and it completes the line that runs from The Chorus through The Vastness (4566 + 4920 + 5274 = 14,760). Its hexagram, 42 Increase, is wind over thunder, and Legge\'s Judgment says it will be advantageous "to cross the great stream." Its geometry, the Healing Mandala, pictures the journey from scattered parts to a whole. It sits in the north-west palace, Metal (☰), and its Moon mansion, Shatabhisha, belongs to Varuna, god of the celestial waters. In the Aetheria framework, The Temple is the quiet room where the parts come together.',
    tag: 'tradition' },
  { hz: 5628, script: 'The Aurora', hexagram: 55, hexagramName: 'Abundance',
    judgment: 'Făng intimates progress and development. When a king has reached the point (which the name denotes) there is no occasion to be anxious (through fear of a change). Let him be as the sun at noon.',
    palace: 'HEAD layer, palace 7, west, Metal, ☱ Dui', mansion: '25 Purva Bhadrapada', mansionMeaning: 'The Former Blessed Feet',
    deity: 'Ajaikapada, the one-footed aspect of Shiva', symbol: 'swords, front legs of a funeral cot, a man with two faces', planet: 'Jupiter', prose: 'The Aurora opens the last order of the climb. Its function name is Galactic Consciousness, and the Aetheria EEG player\'s word for it is Vision. Its hexagram, 55 Abundance, is thunder over fire, a flash at full strength; Legge\'s Judgment says, "Let him be as the sun at noon." Its geometry, the Dream Lattice, is the crystal structure of the dream realm. It sits in the west palace, Metal (☱), and its Moon mansion, Purva Bhadrapada, belongs to Ajaikapada, the one-footed aspect of Shiva. In the Aetheria framework, The Aurora is seeing far, the way light at the poles shows the sky\'s hidden field.',
    tag: 'tradition' },
  { hz: 5982, script: 'The Presence', hexagram: 31, hexagramName: 'Influence',
    judgment: 'Hsien indicates that, (on the fulfilment of the conditions implied in it), there will be free course and success. Its advantageousness will depend on the being firm and correct, (as) in marrying a young lady. There will be good fortune.',
    palace: 'HEAD layer, palace 8, north-east, Earth, ☶ Gen', mansion: '26 Uttara Bhadrapada', mansionMeaning: 'The Latter Blessed Feet',
    deity: 'Ahirbudhnya, serpent of the deep', symbol: 'twins, back legs of a funeral cot, snake in the water', planet: 'Saturn', prose: 'The Presence is two becoming one surface. Its function name is Divine Source Portal; the Aetheria EEG player calls it Learning and plays it when its reading shows theta rising. Its hexagram, 31 Influence, is a lake resting on a mountain, each moving the other, and Legge\'s Judgment promises "free course and success." Its geometry, the Möbius Strip, has only one side, so inside and outside are the same path. It sits in the north-east palace, Earth (☶), and its Moon mansion, Uttara Bhadrapada, belongs to Ahirbudhnya, the serpent of the deep. In the Aetheria framework, The Presence is being fully here, with nothing left outside.',
    tag: 'tradition' },
  { hz: 6336, script: 'The Summit', hexagram: 1, hexagramName: 'The Creative',
    judgment: 'Khien (represents) what is great and originating, penetrating, advantageous, correct and firm.',
    palace: 'HEAD layer, palace 9, south, Fire, ☲ Li', mansion: '27 Revati', mansionMeaning: 'Prosperous',
    deity: 'Pushan, the nourisher, guide of souls', symbol: 'fish or a pair of fish, drum', planet: 'Mercury', prose: 'The Summit is the top of the climb. Its function name is SOURCE Embodiment: SOURCE itself is 2178 at the center, and The Summit is where the ascent turns for home. Its hexagram, 1 The Creative, is heaven upon heaven, all six lines unbroken; Legge\'s Judgment calls it "great and originating, penetrating, advantageous, correct and firm." Its geometry is the Unified Field. Its Moon mansion is Revati, the last of the 27, held by Pushan, the nourisher who guides souls on their way. In the Aetheria framework, The Summit is an arrival that already holds the way back.',
    tag: 'tradition' },
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
