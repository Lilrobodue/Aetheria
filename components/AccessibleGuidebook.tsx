// components/AccessibleGuidebook.tsx: the Guide's Plain language view (classic's Guidebook and, from v16.5, the new
// layout's More › Guide render this one component).
//
// v16.6 ("How sure are we?", the copy pass; the v16.6 spec §3.4): the authors' structure, sources and voice are kept;
// only the sentences that went past the evidence are rewritten (decision 5 A: the opening section is "What research says
// about music", its four over-reaching sentences rewritten), and each claim carries its evidence tag inside a
// data-evidence block (Well studied, Open question, Design choice, Arithmetic, Early evidence, Tradition, Mixed
// evidence). The places it names follow its host's `layout` (utils/copy/places). It ends with the How sure are we?
// section; `back` is the new layout's "Back to …" chip there.

import React from 'react';
import { Heart, Music, Sparkles, Box, Headphones, Compass, Flag, AlertTriangle, BookOpen, Mountain, Columns3, Wind, Activity, ChevronRight } from 'lucide-react';
import EvidenceTag from './ui/EvidenceTag';
import { useEvidenceLink } from './guide/evidenceLink';
import { HOW_SURE_JUMP } from '../utils/copy/evidence';
import HowSure from './guide/HowSure';
import type { HowSureBack } from './guide/HowSure';
import { place } from '../utils/copy/places';
import type { Layout } from '../utils/copy/places';

/** A tag on its own row (the density rule: never inside a sentence). */
const TagRow = ({ children, className = 'mt-2' }: { children: React.ReactNode; className?: string }) => (
  <div className={`${className} flex flex-wrap items-center gap-x-2 gap-y-3`}>{children}</div>
);

/** I5's "How sure are we? ›": the section, through the Guide's own link (a scroll in place in both layouts). */
const HowSureLink = () => {
  const open = useEvidenceLink();
  if (!open) return null;
  return (
    <button
      type="button"
      onClick={() => open('section', null)}
      data-testid="guide-i5-how-sure"
      className="mt-1 min-h-touch inline-flex items-center gap-1 text-sm text-sky-300 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
    >
      {HOW_SURE_JUMP}
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
};

/** "Click "Deep Scan" — wait …": the part before the dash is bold, as the list always set it. */
const Place = ({ text }: { text: string }) => {
  const at = text.indexOf(' — ');
  if (at < 0) return <strong className="text-gold-200">{text}</strong>;
  return (
    <>
      <strong className="text-gold-200">{text.slice(0, at)}</strong>
      {text.slice(at)}
    </>
  );
};

const AccessibleGuidebook = ({ layout = 'classic', back = null }: { layout?: Layout; back?: HowSureBack | null }) => {
  // Shared style for outbound reference links in the "What research says about music" section.
  const linkCls = "text-sky-400 hover:text-sky-300 underline decoration-sky-500/40 hover:decoration-sky-300 transition-colors";
  return (
    <div className="px-8 pb-12 space-y-10" data-guide-root="plain">
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

      {/* What research says about music — grounding readers in established research (v16.6: decision 5 A) */}
      <section data-evidence="tier1">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Activity size={20} className="text-sky-400" />
          <h2 className="text-2xl font-serif text-sky-300">What research says about music</h2>
          <EvidenceTag tier="tier1" />
        </div>
        <p className="text-slate-300 leading-relaxed mb-4">
          Before anything specific to Aetheria, it's worth knowing what research has found about music itself.
          Music's effects on stress, anxiety, pain and mood are not fringe ideas: they are studied, replicated and
          used in some of the most respected hospitals in the world.
        </p>

        <div className="p-5 bg-sky-900/15 border border-sky-500/30 rounded-lg mb-3">
          <h3 className="text-sky-200 font-bold mb-2">Harvard Medical School</h3>
          <p className="text-sm text-slate-300 leading-relaxed">
            Researchers describe music as engaging more parts of the brain than almost any other human activity.
            Studies coming out of Harvard-affiliated hospitals show that music can lower heart rate, reduce blood
            pressure, decrease levels of stress hormones, and provide measurable relief to patients recovering
            from heart attacks, strokes, and surgery. A 2021 research review in <em>Psychiatry Research</em>{' '}
            concluded that music-based interventions provide important relief by reducing anxiety during medical
            treatment.
          </p>
          <p className="text-xs text-slate-500 mt-3">
            Sources:{' '}
            <a href="https://www.health.harvard.edu/mind-and-mood/music-as-medicine" target="_blank" rel="noopener noreferrer" className={linkCls}>Music as Medicine (Harvard Health)</a>
            {' · '}
            <a href="https://hms.harvard.edu/news-events/publications-archive/brain/music-brain" target="_blank" rel="noopener noreferrer" className={linkCls}>Music and the Brain (HMS)</a>
          </p>
        </div>

        <div className="p-5 bg-sky-900/15 border border-sky-500/30 rounded-lg mb-4">
          <h3 className="text-sky-200 font-bold mb-2">Johns Hopkins</h3>
          <p className="text-sm text-slate-300 leading-relaxed">
            The Center for Music and Medicine — an entire research center dedicated to this work — investigates
            how music affects Parkinson's disease, Alzheimer's disease, stroke recovery, and a range of other
            disorders. Johns Hopkins Medicine has run a music therapy program in its children's hospital since
            1993, with over 22,000 documented patient interactions. Its Department of Psychiatry and Behavioral
            Sciences describes music-based therapies as a recognized clinical approach for cognitive disorders,
            including Alzheimer's and memory disorders.
          </p>
          <p className="text-xs text-slate-500 mt-3">
            Sources:{' '}
            <a href="https://www.hopkinsmedicine.org/center-for-music-and-medicine/music-as-medicine" target="_blank" rel="noopener noreferrer" className={linkCls}>Music as Medicine</a>
            {' · '}
            <a href="https://www.hopkinsmedicine.org/center-for-music-and-medicine/research" target="_blank" rel="noopener noreferrer" className={linkCls}>Center for Music and Medicine (Research)</a>
            {' · '}
            <a href="https://www.hopkinsmedicine.org/all-childrens-hospital/services/music-therapy" target="_blank" rel="noopener noreferrer" className={linkCls}>All Children's Music Therapy</a>
          </p>
        </div>

        <p className="text-slate-300 leading-relaxed mb-3">
          The body of research is broad and growing. Studies have documented that music can:
        </p>
        <ul className="space-y-2 mb-4">
          {[
            <><strong className="text-slate-100">Lower cortisol</strong>, the body's primary stress hormone, particularly through individually-tailored listening interventions</>,
            <><strong className="text-slate-100">Reduce anxiety symptoms</strong> in clinical and non-clinical populations, with effects measurable through both subjective scales and physiological markers</>,
            <><strong className="text-slate-100">Ease depression</strong>, with most randomized controlled trials showing significant reduction in depressive symptoms after structured music therapy</>,
            <><strong className="text-slate-100">Decrease perceived pain</strong> in post-operative patients and people managing chronic conditions</>,
            <><strong className="text-slate-100">Lower blood pressure and heart rate</strong> in many studies</>,
            <><strong className="text-slate-100">Engage the brain's reward system</strong>, releasing dopamine in patterns similar to other pleasurable and life-supporting activities</>,
            <><strong className="text-slate-100">Support recovery from neurological injury</strong> through rhythm-based therapies that help retrain motor function</>,
          ].map((content, i) => (
            <li key={i} className="flex gap-3 p-3 bg-slate-900/40 border border-slate-800 rounded-lg">
              <span className="flex-shrink-0 text-sky-400 leading-relaxed">•</span>
              <span className="text-sm text-slate-300 leading-relaxed">{content}</span>
            </li>
          ))}
        </ul>

        <p className="text-slate-300 leading-relaxed mb-3">
          These findings are about music in general, often music the listener chose, and about music therapy led by
          trained therapists. They are not findings about any particular frequency or tuning.
        </p>
        <div data-evidence="open" className="mb-4 p-4 bg-slate-900/60 border-l-4 border-gold-500 rounded-r-lg">
          <p className="text-slate-300 leading-relaxed">
            Research has shown that music can help people relax and feel better. The question Aetheria explores is
            narrower, and still open: whether particular frequencies, combinations and patterns add anything of their
            own, and for whom. Very little research has tested that yet.
          </p>
          <TagRow>
            <EvidenceTag tier="open" />
          </TagRow>
          <HowSureLink />
        </div>
        <div className="p-4 bg-sky-900/10 border-l-4 border-sky-500/60 rounded-r-lg">
          <p className="text-sm text-slate-300 leading-relaxed">
            If you wonder whether sound can change how your body feels, you are not asking a strange question: for
            music, research has begun to answer it. Aetheria explores territory research hasn't mapped yet, and your
            own experience is the best guide there.
          </p>
        </div>

        <div className="mt-6 pt-5 border-t border-slate-800">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">Selected References</h3>
          <ul className="space-y-2">
            {[
              { cite: 'Harvard Health Publishing. (2024). Music as medicine. Harvard Medical School.', url: 'https://www.health.harvard.edu/mind-and-mood/music-as-medicine' },
              { cite: 'Harvard Medical School. (n.d.). Music and the brain.', url: 'https://hms.harvard.edu/news-events/publications-archive/brain/music-brain' },
              { cite: 'Johns Hopkins Medicine. (n.d.). Center for Music and Medicine — Research.', url: 'https://www.hopkinsmedicine.org/center-for-music-and-medicine/research' },
              { cite: 'Johns Hopkins Medicine. (n.d.). Music as Medicine.', url: 'https://www.hopkinsmedicine.org/center-for-music-and-medicine/music-as-medicine' },
              { cite: "Johns Hopkins All Children's Hospital. (n.d.). Music Therapy Program.", url: 'https://www.hopkinsmedicine.org/all-childrens-hospital/services/music-therapy' },
              { cite: 'Koelsch, S. (2014). Brain correlates of music-evoked emotions. Nature Reviews Neuroscience, 15(3), 170–180.' },
              { cite: 'de Witte, M., Spruit, A., van Hooren, S., Moonen, X., & Stams, G.-J. (2020). Effects of music interventions on stress-related outcomes: A systematic review and two meta-analyses. Health Psychology Review, 14(2), 294–324.' },
              { cite: 'JMIR Mental Health. (2025). Effects of sound interventions on the mental stress response in adults: Scoping review.', url: 'https://mental.jmir.org/2025/1/e69120' },
              { cite: 'Mojtabavi, H., et al. (2020). Music therapy for postoperative outcomes following coronary artery bypass grafting (Review).' },
              { cite: 'Pantelyat, A., et al. (2016). The use of group drumming for non-pharmacological treatment of Parkinson disease.' },
            ].map((r, i) => (
              <li key={i} className="text-xs text-slate-500 leading-relaxed">
                {r.cite}
                {r.url && (
                  <>
                    {' '}
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className={`${linkCls} whitespace-nowrap`}>↗ View</a>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="text-slate-600 text-[11px] italic mt-3">
            External links open in a new tab and lead to the cited institutions and journals.
          </p>
        </div>
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
          <li data-evidence="arithmetic" className="flex gap-3 p-4 bg-slate-900/50 border border-slate-800 rounded-lg">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gold-600/20 text-gold-300 text-sm font-bold flex items-center justify-center">1</span>
            <span className="min-w-0 text-slate-300 leading-relaxed">
              <strong className="text-gold-200">Retunes it to 432 Hz</strong> — every note about a third of a
              semitone lower than the standard 440 Hz used in most modern music. Some listeners find it warmer; the
              few small studies so far point both ways.
              <TagRow>
                <EvidenceTag tier="arithmetic" />
                <EvidenceTag tier="tier3" />
              </TagRow>
            </span>
          </li>
          <li data-evidence="design" className="flex gap-3 p-4 bg-slate-900/50 border border-slate-800 rounded-lg">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gold-600/20 text-gold-300 text-sm font-bold flex items-center justify-center">2</span>
            <span className="min-w-0 text-slate-300 leading-relaxed">
              <strong className="text-gold-200">Gives each song one of 27 crystals</strong>: an assignment that
              organises your library, not a measurement of the song's pitch
              <TagRow>
                <EvidenceTag tier="design" />
              </TagRow>
            </span>
          </li>
          <li className="flex gap-3 p-4 bg-slate-900/50 border border-slate-800 rounded-lg">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gold-600/20 text-gold-300 text-sm font-bold flex items-center justify-center">3</span>
            <span className="text-slate-300 leading-relaxed">
              <strong className="text-gold-200">Layers a tone and a binaural beat</strong> underneath your music,
              built on that crystal
            </span>
          </li>
        </ol>
        <p className="text-slate-300 leading-relaxed">
          The result is your favourite music with a quiet layer underneath, at the level you choose. What you
          experience while listening is personal and different for everyone.
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
            <Place text={place('deepScan', layout)} />,
            <Place text={place('assign', layout)} />,
            <Place text={place('modes', layout)} />,
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
            <h3 className="text-lg font-serif text-gold-200 mb-2">Crystal Sets</h3>
            <p className="text-slate-300 leading-relaxed text-sm mb-3">
              Five sets each play the tracks on a few crystals, one crystal after another:
            </p>
            <ul className="space-y-1.5 text-sm">
              <li className="text-slate-300"><strong className="text-gold-200">Grounding</strong> — 174, 285, 396 and 417 Hz</li>
              <li className="text-slate-300"><strong className="text-gold-200">Stillness</strong> — 174, 285 and 528 Hz</li>
              <li className="text-slate-300"><strong className="text-gold-200">Uplift</strong> — 396, 417 and 639 Hz</li>
              <li className="text-slate-300"><strong className="text-gold-200">Meditation</strong> — 741, 852 and 963 Hz</li>
              <li className="text-slate-300"><strong className="text-gold-200">Flow</strong> — 285, 417, 528, 639 and 741 Hz</li>
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
            <div data-evidence="tradition" className="mb-4">
              <p className="text-slate-300 leading-relaxed">
                Chinese legend tells of a turtle that rose from the Lo River more than 4,000 years ago, with a
                pattern on its shell: a grid of nine numbers arranged so that every row, every column, and every
                diagonal added up to the same total: 15.
              </p>
              <TagRow>
                <EvidenceTag tier="tradition" />
              </TagRow>
            </div>
            <div className="my-4 flex justify-center">
              <pre className="font-mono text-emerald-200 text-lg leading-relaxed bg-slate-900/70 border border-emerald-500/20 px-8 py-4 rounded-lg">
{`4  9  2
3  5  7
8  1  6`}
              </pre>
            </div>
            <div data-evidence="arithmetic">
              <p className="text-slate-300 leading-relaxed">
                This is called a "magic square", and the Lo Shu is one of the oldest known.
              </p>
              <TagRow>
                <EvidenceTag tier="arithmetic" />
              </TagRow>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-serif text-emerald-200 mb-2">The Aetheria Connection</h3>
            <div data-evidence="arithmetic">
              <p className="text-slate-300 leading-relaxed mb-3">
                Here's the interesting part: the 27 Aetheria frequencies, when arranged in groups of nine
                (one group per range), form their own magic squares. That follows from how they were built: any nine
                evenly spaced numbers make a magic square when placed in the Lo Shu's order, and HEART and HEAD rise
                in even steps (243 Hz and 354 Hz).
              </p>
              <p className="text-slate-300 leading-relaxed">
                The HEART and HEAD ranges form mathematically perfect magic squares. The GUT range comes
                within one line of perfection.
              </p>
              <TagRow>
                <EvidenceTag tier="arithmetic" />
              </TagRow>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-serif text-emerald-200 mb-2">What Does This Mean for Listening — and where to find it in the app?</h3>
            <p className="text-slate-300 leading-relaxed">
              When you listen to the frequencies in the Lo Shu order instead of the standard numerical order,
              you're hearing them in an arrangement that follows one of the oldest mathematical harmonies known
              to humanity. Whether this creates a different experience is something each listener discovers for
              themselves. {place('walks', layout)}, {place('cubeVisual', layout)} {place('walksFirst', layout)}
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
              This follows a path a Chinese tradition traces through the "nine palaces." It starts at the CENTER frequency of each range and spirals outward through all
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
        <div data-evidence="tradition" className="mb-3">
          <p className="text-slate-300 leading-relaxed">
            The GUT frequencies are the nine "Solfeggio frequencies": a modern set, popularised in the 1990s and
            named after the medieval singing syllables (ut, re, mi…). They are well known in sound-meditation
            circles, but they don't form a perfect magic square.
          </p>
          <TagRow>
            <EvidenceTag tier="tradition" />
          </TagRow>
        </div>
        <div data-evidence="arithmetic" className="mb-4">
          <p className="text-slate-300 leading-relaxed">
            Perfect GUT moves three crystals by 99 Hz (174 → 75, 285 → 186, 396 → 297) and three by 9 Hz, so the
            square becomes exact; the top three stay.
          </p>
          <TagRow>
            <EvidenceTag tier="arithmetic" />
          </TagRow>
        </div>
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
          Try both. You may hear the change on the low crystals.
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
        <div data-evidence="tier1" className="mb-3">
          <p className="text-slate-300 leading-relaxed">
            A binaural beat happens when your left ear hears one frequency and your right ear hears a slightly
            different one. Your brain processes the difference between the two tones, creating a perceived "beat"
            at that difference frequency. This is why headphones are recommended — the two ears need to receive
            slightly different signals for the effect to work.
          </p>
          <TagRow>
            <EvidenceTag tier="tier1" />
          </TagRow>
        </div>
        <p className="text-slate-300 leading-relaxed mb-4">
          Aetheria generates these binaural layers automatically based on which frequency position is currently
          playing. You don't need to configure anything — just use headphones for the best experience.
        </p>
        <div data-evidence="tier2" className="p-4 bg-amber-900/15 border-l-4 border-amber-500/60 rounded-r-lg">
          <p className="text-sm text-slate-300 leading-relaxed">
            <strong className="text-amber-300">Important:</strong> Whether binaural beats change brainwaves is still
            debated: a 2023 review of 14 studies with brain recordings (EEG) found 5 that support it, 8 that don't and
            1 mixed.
            Aetheria uses them as part of the listening experience, not as a treatment.
          </p>
          <TagRow>
            <EvidenceTag tier="tier2" />
          </TagRow>
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

      {/* v16.6: How sure are we? (the evidence tags' definitions and what research has found) */}
      <HowSure view="plain" layout={layout} back={back} />

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
