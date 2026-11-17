// components/shell/more/linksData.ts (v16.4, More › Links)
//
// Classic's Links & Resources panel as data: its seven sections in classic's order, each link's title, sub-line and
// address in classic's words, and the panel's footer. The new layout's Links page renders it; classic's panel keeps
// its own markup until classic goes (safety-about.spec S7 keeps the two equal meanwhile).

export interface LinkItem {
  title: string;
  sub: string;
  href: string;
}

export interface LinkSection {
  section: string;
  items: LinkItem[];
}

export const LINK_SECTIONS: ReadonlyArray<LinkSection> = [
  {
    section: 'Apps & Tools',
    items: [
      { title: 'Aetheria RCT', sub: 'Muse 2 EEG neuro-adaptive coherence training', href: 'https://aetheriarct.com' },
      { title: 'Aetheria Coherence Lab', sub: 'Adaptive biofield coherence instrument — H10 + Muse + Woojer', href: 'https://aetheria-coherence-lab.org' },
      { title: 'Aetheria Session Tagger', sub: 'Add subjective context to your Coherence Lab sessions', href: 'https://aetheria-session-tagger.org' },
      { title: 'Aetheria Reader', sub: 'Read-aloud e-reader — your own books stay on your device', href: 'https://big-banana-studios.github.io/aetheria-reader/' },
      // v16.12.1 (the user, 15 Nov 2026): the Divination app, after Reader; classic's panel has the same row.
      { title: 'Aetheria Divination', sub: 'I Ching readings, each turned into three Aetheria tones', href: 'https://big-banana-studios.github.io/aetheria-divination/' },
      // v16.13.1 (the user, 15 Nov 2026): Titīrṣā (Instrument 04), after Divination; its public site (the repo is
      // private). Classic's panel has the same row.
      { title: 'Titīrṣā', sub: "Cymatic plate shaped by your goal regime, the Moon's mansion and your heart", href: 'https://big-banana-studios.github.io/titirsa/' },
      // v16.13.3 (the user, 15 Nov 2026): three more, in the user's order, after Titīrṣā; each its public site (the repos
      // are private), each named as the app names itself. Classic's panel has the same rows.
      { title: 'Chant Sculptor', sub: 'Chant along while your voice and heartbeat shape cymatic sand', href: 'https://big-banana-studios.github.io/Chant-Sculpture/' },
      { title: 'Operator', sub: 'Morning tune-up, resonance breathing, coherence, qigong and tai chi', href: 'https://big-banana-studios.github.io/operator/' },
      { title: 'Mode 3', sub: 'Neuro-adaptive binaural trainer — Muse S Athena + H10, with Aetheria tones', href: 'https://big-banana-studios.github.io/mode-3/' },
      { title: 'Controlled Burn', sub: 'Heart-rate flooding alerts — Gottman conflict de-escalation', href: 'https://big-banana-studios.github.io/Controlled-Burn/' },
    ],
  },
  {
    section: 'Sophia',
    items: [{ title: 'Sophia', sub: 'Your personal AI companion — runs locally, no cloud', href: 'https://aetheriasos.com' }],
  },
  {
    section: 'Books',
    items: [
      { title: 'Aetheria', sub: 'The foundational text of the frequency system', href: 'https://a.co/d/079tM297' },
      { title: 'Aetheria: The Science', sub: 'A research-driven deep dive — the ideas behind the system', href: 'https://www.amazon.com/dp/B0HF38MDJB' },
      { title: 'Cosmic Rhythms', sub: 'How sun, moon & earth shape your biology', href: 'https://a.co/d/0ckEN0Qs' },
      { title: 'SFB — A TBI Guide', sub: 'Navigating traumatic brain injury recovery', href: 'https://a.co/d/04Y1pUtE' },
    ],
  },
  {
    section: 'Music',
    items: [
      { title: 'Aetheria on Spotify', sub: 'Lyric-aligned music', href: 'https://open.spotify.com/artist/4CXB2ctrUCvInDQkKDhw4q' },
      // v16.14.1 (the user, 17 Nov 2026): the studio's music channel, where the transformed music is released, after
      // Spotify. Classic's panel has the same row.
      { title: 'Big Banana Studios Music', sub: "Aetheria's transformed music on YouTube", href: 'https://www.youtube.com/@BigBananaStudiosMusic' },
    ],
  },
  {
    section: 'Interactive Simulations',
    items: [
      { title: 'Resonance of the Spheres', sub: 'Voxel meditation PWA · Muse S, Athena & Polar H10', href: 'https://big-banana-studios.github.io/aetheria-voxel/' },
      { title: 'Lewis Vortex Model', sub: 'Formation Theory', href: 'https://lilrobodue.github.io/Lewis-Vortex-Model/' },
      { title: 'Unified Scale Navigator', sub: 'Quantum to cosmic', href: 'https://lilrobodue.github.io/Unified-Scale-Navigator/' },
      { title: 'HRV Coherence Visualizer', sub: 'Heart rate variability', href: 'https://lilrobodue.github.io/HRV-Coherence-Visualizer/' },
      { title: 'Schumann Biology Simulator', sub: "Earth's resonance", href: 'https://lilrobodue.github.io/Schumann-Biology-Simulator/' },
      { title: 'Cellular Voltage Model', sub: 'A model of cell voltage and frequency', href: 'https://lilrobodue.github.io/Cellular-Voltage-Frequency-Model/' },
      { title: 'Galactic Vortex Formation', sub: 'Cosmic scale structure', href: 'https://lilrobodue.github.io/Galactic-Scale-Vortex-Formation/' },
    ],
  },
  {
    section: 'Community & Social',
    items: [
      { title: 'Th3 L0unG3 — Discord', sub: '365+ frequency songs · community · resources', href: 'https://discord.gg/ddR3MfgCsM' },
      { title: 'YouTube', sub: 'Aetheria content, demos, and explorations', href: 'https://www.youtube.com/@Aetheria432' },
      { title: 'X / Twitter', sub: '@TheyCallmeJobo — thoughts, updates, frequencies', href: 'https://x.com/TheyCallmeJobo' },
    ],
  },
  {
    section: 'Contact',
    items: [{ title: 'Aetheria432@pm.me', sub: 'Questions, collaborations, research inquiries', href: 'mailto:Aetheria432@pm.me' }],
  },
];

/** The panel's footer lines (its 🙏 is classic's decoration, not carried). */
export const LINKS_FOOTER: ReadonlyArray<string> = ['Healing the world heART', '© 2026 Aetheria432.com', '27 frequencies · 432 Hz · 3-6-9', 'Built with love'];

/** The page's one new line. */
export const LINKS_HINT = 'They open in your browser; the music keeps playing here.';
