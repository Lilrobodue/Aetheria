import React from 'react';
import { Heart, Music, Sparkles, Box, Headphones, Compass, Flag, AlertTriangle, BookOpen, Mountain, Columns3, Wind } from 'lucide-react';

const AccessibleGuidebook: React.FC = () => {
  return (
    <div className="px-8 pb-12 space-y-10">
      {/* Title block */}
      <div className="text-center pt-2">
        <h1 className="text-3xl md:text-4xl font-serif text-gold-300 tracking-wide">The Aetheria Guidebook</h1>
        <p className="text-slate-300 mt-2 text-base md:text-lg">Your Guide to the Aetheria 432Hz Harmonic Player</p>
        <p className="text-slate-500 text-sm italic mt-3">By the Lewis Family</p>
      </div>

      {/* About this guide */}
      <section className="bg-gradient-to-r from-slate-900 to-slate-900/50 border-l-4 border-gold-500 p-6 rounded-r-lg">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={18} className="text-gold-400" />
          <h2 className="text-xl font-serif text-gold-200">About This Guide</h2>
        </div>
        <p className="text-slate-300 leading-relaxed">
          This guidebook tells you <strong className="text-gold-200">what</strong> Aetheria is and{' '}
          <strong className="text-gold-200">how</strong> to use it — in plain, simple language. There's also a
          deeper companion guide called <em>The Aetheria Technical Guide</em> that explores the math and
          history behind the system, whenever you're curious. But you don't need it to enjoy the music.
        </p>
      </section>

      {/* What is Aetheria */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Music size={20} className="text-gold-400" />
          <h2 className="text-2xl font-serif text-gold-300">What Is Aetheria?</h2>
        </div>
        <p className="text-slate-300 leading-relaxed mb-4">
          Aetheria is an advanced music player. It takes your existing music — songs you already know and
          love — and does three things:
        </p>
        <ol className="space-y-3 mb-4">
          <li className="flex gap-3 p-4 bg-slate-900/50 border border-slate-800 rounded-lg">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gold-600/20 text-gold-300 text-sm font-bold flex items-center justify-center">1</span>
            <span className="text-slate-300 leading-relaxed">
              <strong className="text-gold-200">Retunes it to 432 Hz</strong> — a natural tuning that many
              listeners find warmer and more relaxing than the standard 440 Hz tuning used in most modern music
            </span>
          </li>
          <li className="flex gap-3 p-4 bg-slate-900/50 border border-slate-800 rounded-lg">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gold-600/20 text-gold-300 text-sm font-bold flex items-center justify-center">2</span>
            <span className="text-slate-300 leading-relaxed">
              <strong className="text-gold-200">Analyzes each song's frequency content</strong> and assigns
              it to one of 27 specific frequencies
            </span>
          </li>
          <li className="flex gap-3 p-4 bg-slate-900/50 border border-slate-800 rounded-lg">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gold-600/20 text-gold-300 text-sm font-bold flex items-center justify-center">3</span>
            <span className="text-slate-300 leading-relaxed">
              <strong className="text-gold-200">Layers binaural beats</strong> underneath your music, tuned
              to match the assigned frequency
            </span>
          </li>
        </ol>
        <p className="text-slate-300 leading-relaxed">
          The result is your favorite music, enhanced with precise frequency layering that you can feel but
          might not consciously hear. What you experience while listening is personal and different for everyone.
        </p>
      </section>

      {/* The 27 Frequencies */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={20} className="text-gold-400" />
          <h2 className="text-2xl font-serif text-gold-300">The 27 Frequencies</h2>
        </div>
        <p className="text-slate-300 leading-relaxed mb-4">
          Aetheria organizes its 27 frequencies into three ranges:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="p-4 bg-red-900/15 border border-red-500/30 rounded-lg">
            <h3 className="text-red-300 font-bold mb-1">GUT (1–9)</h3>
            <p className="text-xs text-slate-400 mb-2">174 Hz – 963 Hz</p>
            <p className="text-sm text-slate-300 leading-relaxed">The lowest range. Deep, grounding tones.</p>
          </div>
          <div className="p-4 bg-emerald-900/15 border border-emerald-500/30 rounded-lg">
            <h3 className="text-emerald-300 font-bold mb-1">HEART (10–18)</h3>
            <p className="text-xs text-slate-400 mb-2">1,206 Hz – 3,150 Hz</p>
            <p className="text-sm text-slate-300 leading-relaxed">The middle range. Warm, mid-range tones.</p>
          </div>
          <div className="p-4 bg-violet-900/15 border border-violet-500/30 rounded-lg">
            <h3 className="text-violet-300 font-bold mb-1">HEAD (19–27)</h3>
            <p className="text-xs text-slate-400 mb-2">3,504 Hz – 6,336 Hz</p>
            <p className="text-sm text-slate-300 leading-relaxed">The highest range. Bright, expansive tones.</p>
          </div>
        </div>
        <p className="text-slate-300 leading-relaxed">
          Each frequency has a name inspired by sacred geometry (like "Seed of Life," "Torus," or
          "Unified Field") and a number that places it in the system. The names are part of the Aetheria
          framework — they give each frequency a character and a place in the journey.
        </p>
      </section>

      {/* How to Get Started */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Flag size={20} className="text-gold-400" />
          <h2 className="text-2xl font-serif text-gold-300">How to Get Started</h2>
        </div>
        <ol className="space-y-2 mb-3">
          {[
            <><strong className="text-gold-200">Open the Aetheria 432Hz Player</strong> at aetheria432.com</>,
            <><strong className="text-gold-200">Add your music</strong> — import songs or folders from your device</>,
            <><strong className="text-gold-200">Click "Deep Scan"</strong> — wait for your music to be processed</>,
            <><strong className="text-gold-200">Click "Auto-Distribute Frequencies"</strong> — the player analyzes your music and assigns each song to its closest Aetheria frequency</>,
            <><strong className="text-gold-200">Pick a listening mode</strong> — try "Full Alignment" to hear your library played across all 27 frequencies in order, or choose just the GUT, HEART, HEAD range, or all regimes by selecting the Ultimate all orders playlist.</>,
            <><strong className="text-gold-200">Press play and enjoy your music</strong></>
          ].map((content, i) => (
            <li key={i} className="flex gap-3 p-3 bg-slate-900/40 border border-slate-800 rounded-lg">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gold-600/20 text-gold-300 text-sm font-bold flex items-center justify-center">{i + 1}</span>
              <span className="text-slate-300 leading-relaxed">{content}</span>
            </li>
          ))}
        </ol>
        <p className="text-slate-400 italic text-sm">That's it. The player handles the rest.</p>
      </section>

      {/* Listening Modes */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Compass size={20} className="text-gold-400" />
          <h2 className="text-2xl font-serif text-gold-300">Listening Modes</h2>
        </div>
        <p className="text-slate-300 leading-relaxed mb-4">
          The Aetheria Player offers several ways to organize your listening:
        </p>

        <div className="space-y-4">
          <div className="p-5 bg-slate-900/50 border-l-4 border-gold-500/60 rounded-r-lg">
            <h3 className="text-lg font-serif text-gold-200 mb-2">Full Alignment</h3>
            <p className="text-slate-300 leading-relaxed text-sm">
              Plays through all 27 frequencies in order — low to high. Your music is arranged so each song
              plays at its assigned frequency position. This is the complete 27-frequency journey.
            </p>
          </div>
          <div className="p-5 bg-slate-900/50 border-l-4 border-gold-500/60 rounded-r-lg">
            <h3 className="text-lg font-serif text-gold-200 mb-2">Single Range</h3>
            <p className="text-slate-300 leading-relaxed text-sm">
              Choose just GUT, HEART, or HEAD to focus your listening on one frequency range.
            </p>
          </div>
          <div className="p-5 bg-slate-900/50 border-l-4 border-gold-500/60 rounded-r-lg">
            <h3 className="text-lg font-serif text-gold-200 mb-2">Quick Presets</h3>
            <p className="text-slate-300 leading-relaxed text-sm mb-3">
              The player includes presets that select specific combinations of frequencies:
            </p>
            <ul className="space-y-1.5 text-sm">
              <li className="text-slate-300"><strong className="text-gold-200">Deep Healing</strong> — a curated selection from across the ranges</li>
              <li className="text-slate-300"><strong className="text-gold-200">Mood Elevate</strong> — frequencies often associated with uplifting energy</li>
              <li className="text-slate-300"><strong className="text-gold-200">Meditation</strong> — frequencies often used in contemplative practices</li>
              <li className="text-slate-300"><strong className="text-gold-200">Flow State</strong> — a combination designed for focused listening</li>
              <li className="text-slate-300"><strong className="text-gold-200">Qi Strength</strong> — frequencies drawn from traditional energy practices</li>
            </ul>
            <p className="text-slate-400 italic text-sm mt-3">
              These presets are starting points. Try different ones and find what you enjoy.
            </p>
          </div>
        </div>
      </section>

      {/* The Lo Shu */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Box size={20} className="text-emerald-400" />
          <h2 className="text-2xl font-serif text-emerald-300">The Lo Shu — An Ancient Pattern</h2>
        </div>
        <p className="text-slate-300 leading-relaxed mb-5">
          This is one of Aetheria's most interesting features.
        </p>

        <div className="space-y-5">
          <div>
            <h3 className="text-lg font-serif text-emerald-200 mb-2">What Is the Lo Shu?</h3>
            <p className="text-slate-300 leading-relaxed mb-4">
              Over 4,000 years ago in China, someone noticed a pattern on the back of a turtle emerging from
              the Lo River. The pattern was a grid of nine numbers arranged so that every row, every column,
              and every diagonal added up to the same total: 15.
            </p>
            <div className="my-4 flex justify-center">
              <pre className="font-mono text-emerald-200 text-lg leading-relaxed bg-slate-900/70 border border-emerald-500/20 px-8 py-4 rounded-lg">
{`4  9  2
3  5  7
8  1  6`}
              </pre>
            </div>
            <p className="text-slate-300 leading-relaxed">
              This is called a "magic square." It's one of the oldest mathematical discoveries in human history.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-serif text-emerald-200 mb-2">The Aetheria Connection</h3>
            <p className="text-slate-300 leading-relaxed mb-3">
              Here's the interesting part: the 27 Aetheria frequencies, when arranged in groups of nine
              (one group per range), naturally form their own magic squares. This wasn't designed on purpose —
              the frequencies were built using a consistent musical interval pattern, and the magic square
              structure emerged on its own.
            </p>
            <p className="text-slate-300 leading-relaxed">
              The HEART and HEAD ranges form mathematically perfect magic squares. The GUT range comes
              within one line of perfection.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-serif text-emerald-200 mb-2">What Does This Mean for Listening — and where to find it in the app?</h3>
            <p className="text-slate-300 leading-relaxed">
              When you listen to the frequencies in the Lo Shu order instead of the standard numerical order,
              you're hearing them in an arrangement that follows one of the oldest mathematical harmonies known
              to humanity. Whether this creates a different experience is something each listener discovers for
              themselves. You can find the Lo Shu quick settings in the media player controls as a cube icon
              next to the repeat button, and the Lo Shu Visual settings card can be found in the Visual settings
              by clicking the gear icon in the app header. Music must first be added/imported, scanned, and
              assigned, to select one of the Lo Shu Walks.
            </p>
          </div>
        </div>
      </section>

      {/* The Three Lo Shu Walks */}
      <section>
        <h2 className="text-2xl font-serif text-emerald-300 mb-4">The Three Lo Shu Walks</h2>
        <p className="text-slate-300 leading-relaxed mb-5">
          The player offers three ways to walk through the Lo Shu pattern:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 bg-emerald-900/15 border border-emerald-500/30 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Mountain size={18} className="text-emerald-300" />
              <h3 className="text-emerald-200 font-bold">Layer Ascent</h3>
            </div>
            <p className="text-emerald-300/80 italic text-xs mb-3">"One range at a time"</p>
            <p className="text-sm text-slate-300 leading-relaxed">
              Goes through positions 1 through 9 in the GUT range first, then HEART, then HEAD. Similar to
              the standard Full Alignment, but with frequencies in their Lo Shu order instead of numerical order.
            </p>
          </div>
          <div className="p-5 bg-emerald-900/15 border border-emerald-500/30 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Columns3 size={18} className="text-emerald-300" />
              <h3 className="text-emerald-200 font-bold">Pillar Walk</h3>
            </div>
            <p className="text-emerald-300/80 italic text-xs mb-3">"Go deep before you go wide"</p>
            <p className="text-sm text-slate-300 leading-relaxed">
              Takes each Lo Shu position and goes through it at ALL three ranges (GUT, HEART, HEAD) before
              moving to the next position. Nine vertical pillars, each spanning the full frequency spectrum.
            </p>
          </div>
          <div className="p-5 bg-emerald-900/15 border border-emerald-500/30 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Wind size={18} className="text-emerald-300" />
              <h3 className="text-emerald-200 font-bold">Flying Star Vortex</h3>
            </div>
            <p className="text-emerald-300/80 italic text-xs mb-3">"Start in the center, spiral outward"</p>
            <p className="text-sm text-slate-300 leading-relaxed">
              This follows the traditional path that Daoist practitioners used when walking through the
              "nine palaces." It starts at the CENTER frequency of each range and spirals outward through all
              nine positions. This is a non-linear path — the frequencies don't climb or descend in a straight
              line, they spiral.
            </p>
          </div>
        </div>
      </section>

      {/* Perfect GUT Mode */}
      <section>
        <h2 className="text-2xl font-serif text-red-300 mb-4">Perfect GUT Mode</h2>
        <p className="text-slate-300 leading-relaxed mb-3">
          The player has a toggle called "Perfect GUT." Here's what it does:
        </p>
        <p className="text-slate-300 leading-relaxed mb-3">
          The original GUT frequencies come from an ancient musical scale called the Solfeggio. These frequencies
          are well-known in music and sound traditions, but they don't form a mathematically perfect magic square.
        </p>
        <p className="text-slate-300 leading-relaxed mb-4">
          "Perfect GUT" mode shifts the lower frequencies by small amounts so the magic square becomes
          mathematically exact. The change is subtle — most listeners can't hear the difference.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-lg">
            <h3 className="text-gold-200 font-bold mb-1">Solfeggio mode</h3>
            <p className="text-sm text-slate-400">The traditional frequencies.</p>
          </div>
          <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-lg">
            <h3 className="text-gold-200 font-bold mb-1">Perfect GUT mode</h3>
            <p className="text-sm text-slate-400">The mathematically balanced version.</p>
          </div>
        </div>
        <p className="text-slate-400 italic text-sm">
          Try both and see if you notice a difference. Many people don't, and that's fine.
        </p>
      </section>

      {/* The Binaural Beats */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Headphones size={20} className="text-gold-400" />
          <h2 className="text-2xl font-serif text-gold-300">The Binaural Beats</h2>
        </div>
        <p className="text-slate-300 leading-relaxed mb-3">
          One of Aetheria's key features is the binaural beat layer underneath your music.
        </p>
        <p className="text-slate-300 leading-relaxed mb-3">
          A binaural beat happens when your left ear hears one frequency and your right ear hears a slightly
          different one. Your brain processes the difference between the two tones, creating a perceived "beat"
          at that difference frequency. This is why headphones are recommended — the two ears need to receive
          slightly different signals for the effect to work.
        </p>
        <p className="text-slate-300 leading-relaxed mb-4">
          Aetheria generates these binaural layers automatically based on which frequency position is currently
          playing. You don't need to configure anything — just use headphones for the best experience.
        </p>
        <div className="p-4 bg-amber-900/15 border-l-4 border-amber-500/60 rounded-r-lg">
          <p className="text-sm text-slate-300 leading-relaxed">
            <strong className="text-amber-300">Important:</strong> Binaural beats are an area of active research.
            Some studies suggest they may influence brainwave patterns, while others show mixed results. Aetheria
            uses them as part of the listening experience, not as a medical treatment.
          </p>
        </div>
      </section>

      {/* Tips for Listening */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Heart size={20} className="text-gold-400" />
          <h2 className="text-2xl font-serif text-gold-300">Tips for Listening</h2>
        </div>
        <div className="space-y-3">
          <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-lg">
            <p className="text-slate-300 leading-relaxed text-sm">
              <strong className="text-gold-200">Use headphones when possible.</strong> The binaural beat layer
              works best when each ear receives its own signal. Speakers work fine for the music, but headphones
              give you the full experience.
            </p>
          </div>
          <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-lg">
            <p className="text-slate-300 leading-relaxed text-sm">
              <strong className="text-gold-200">Find a comfortable spot.</strong> The music sounds great
              anywhere, but if you want to really focus on the experience, find a quiet place where you can relax.
            </p>
          </div>
          <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-lg">
            <p className="text-slate-300 leading-relaxed text-sm">
              <strong className="text-gold-200">Start with what you know.</strong> Import music you already
              love. Aetheria enhances your existing library — it doesn't replace it.
            </p>
          </div>
          <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-lg">
            <p className="text-slate-300 leading-relaxed text-sm">
              <strong className="text-gold-200">There's no wrong way to listen.</strong> Play it in the
              background while you work. Put on headphones and close your eyes. Fall asleep to it. Dance to it.
              The player adapts to you, not the other way around.
            </p>
          </div>
          <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-lg">
            <p className="text-slate-300 leading-relaxed text-sm">
              <strong className="text-gold-200">Try the different modes.</strong> Layer Ascent feels different
              from Flying Star Vortex. GUT range feels different from HEAD range. Explore and find what you enjoy.
            </p>
          </div>
        </div>
      </section>

      {/* What Aetheria Is NOT */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={20} className="text-amber-400" />
          <h2 className="text-2xl font-serif text-amber-300">What Aetheria Is NOT</h2>
        </div>
        <div className="p-5 bg-amber-900/10 border border-amber-500/30 rounded-lg space-y-3">
          <p className="text-slate-300 leading-relaxed">
            Aetheria is a music player and listening experience. It is <strong className="text-amber-300">not</strong>{' '}
            a medical device, a diagnostic tool, or a substitute for professional healthcare. The frequencies,
            binaural beats, and listening modes are provided for personal enjoyment and exploration.
          </p>
          <p className="text-slate-300 leading-relaxed">
            If you're dealing with a health concern, please consult a qualified healthcare provider. Aetheria
            is music. Beautiful, mathematically interesting, carefully structured music — but music.
          </p>
        </div>
      </section>

      {/* The Deeper Guide */}
      <section className="bg-gradient-to-r from-slate-900 to-slate-900/50 border-l-4 border-gold-500 p-6 rounded-r-lg">
        <h2 className="text-xl font-serif text-gold-200 mb-3">The Deeper Guide</h2>
        <p className="text-slate-300 leading-relaxed mb-3">
          Everything in this guidebook has a story behind it. The frequencies follow mathematical patterns
          that connect to ancient number theory and sacred geometry. The Lo Shu magic squares, the 3-6-9
          patterns, the interval architecture — it's all documented in the companion{' '}
          <em className="text-gold-200">Aetheria Technical Guide</em>.
        </p>
        <p className="text-slate-400 italic">
          The deeper guide is there when you're curious. The music is here right now.
        </p>
      </section>

      {/* Important Disclaimer */}
      <section>
        <h2 className="text-base font-bold text-slate-400 uppercase tracking-widest mb-3">Important Disclaimer</h2>
        <p className="text-slate-500 text-sm leading-relaxed">
          The Aetheria 432Hz Harmonic Player is provided for entertainment, personal enjoyment, and exploration
          purposes only. It is not a medical device and makes no claims to diagnose, treat, cure, or prevent any
          condition. The frequency system, binaural beats, and Lo Shu modes are features of the music player
          experience. Individual experiences while listening vary and are personal. If you have health concerns,
          consult a qualified healthcare professional.
        </p>
        <p className="text-slate-600 text-xs mt-4 text-center">
          © 2026 aetheria432.com. All rights reserved.
        </p>
      </section>
    </div>
  );
};

export default AccessibleGuidebook;
