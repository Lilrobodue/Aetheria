# Meanings test: pre-registration

Written and pushed to GitHub before any sitting is recorded. If anything here
changes, the change is a new commit with its reason, made before the first
sitting.

## The question

When someone listens to one of the 27 Aetheria tones for as long as the
Aetheria protocol gives its layer, without knowing which tone it is, does the
meaning they pick out of four match the tone's own meaning more often than
chance, 1 in 4?

This tests whether the tones carry their meanings as felt, not any health
claim.

## The meanings

The meanings are worded as the Aetheria Tone Codex (the Reader's copy,
November 2026) words them: each tone's function name and its "In the Aetheria
framework" line. The codex gives no function name for 4566 and 5274 in its
prose, so those two use the Lo Shu canon's names, Soul Star Connection and
Universal Mind Access. Script names (The Circle, The Storm and so on) are not
shown: they name images, not meanings. Clauses about the EEG player are left
out of the lines. A different wording would be a different test.

| Tone | Layer | Position | Meaning shown |
| --- | --- | --- | --- |
| 174 Hz | GUT | 1 | **Foundation**: The ground everything else stands on. |
| 285 Hz | GUT | 2 | **Renewal**: Seeing yourself clearly enough to begin again. |
| 396 Hz | GUT | 3 | **Liberating Fear & Guilt**: Fear met and passed through, so that what it held can go. |
| 417 Hz | GUT | 4 | **Facilitating Change**: Change that comes the way a bride crosses a threshold, step by chosen step. |
| 528 Hz | GUT | 5 | **Transformation**: Change that comes by yielding, the ground that receives the seed. |
| 639 Hz | GUT | 6 | **Connecting Relationships**: Coming home to the people you belong to. |
| 741 Hz | GUT | 7 | **Awakening**: The first light of waking. |
| 852 Hz | GUT | 8 | **Intuition**: The knowing that arrives when the mind stops reaching. |
| 963 Hz | GUT | 9 | **Divine Consciousness**: The pull that turns the climb from the body toward the heart. |
| 1206 Hz | HEART | 1 | **Gateway Integration**: Feeling allowed to move, the gateway from body to heart. |
| 1449 Hz | HEART | 2 | **Harmonic Bridging**: Sensing your way through what you can't yet see. |
| 1692 Hz | HEART | 3 | **Unified Field Access**: The heart reaching past the body's boundary, its power held steady. |
| 1935 Hz | HEART | 4 | **Emotional Alchemy**: Feeling turned into seeing: the clean hand, raised before the offering. |
| 2178 Hz | HEART | 5 | **Compassion Activation**: The still center every walk passes through. |
| 2421 Hz | HEART | 6 | **Heart Coherence**: The heart releasing what has run its course, so that something new can grow. |
| 2664 Hz | HEART | 7 | **Relational Harmony**: What we hold together and cook into something shared. |
| 2907 Hz | HEART | 8 | **Soul Connection**: A new day made with others. |
| 3150 Hz | HEART | 9 | **Heart Completion**: The heart's work grown to its full height. |
| 3504 Hz | HEAD | 1 | **Mental Clarity**: Clear thinking that keeps its roots. |
| 3858 Hz | HEAD | 2 | **Sacred Geometry**: The mind emptied so it can be filled. |
| 4212 Hz | HEAD | 3 | **Consciousness Mastery**: A clear mind speaking so that others can hear. |
| 4566 Hz | HEAD | 4 | **Soul Star Connection**: Many voices heard as one. |
| 4920 Hz | HEAD | 5 | **Expressive Truth**: Awareness wide enough to hold the truth and gentle enough to say it. |
| 5274 Hz | HEAD | 6 | **Universal Mind Access**: The quiet room where the parts come together. |
| 5628 Hz | HEAD | 7 | **Galactic Consciousness**: Seeing far, the way light at the poles shows the sky's hidden field. |
| 5982 Hz | HEAD | 8 | **Divine Source Portal**: Being fully here, with nothing left outside. |
| 6336 Hz | HEAD | 9 | **SOURCE Embodiment**: An arrival that already holds the way back. |

## A sitting

1. The participant picks their code (BBS-P1, BBS-P2 and so on), chooses
   earbuds or the phone speaker and sets a comfortable volume with a 1000 Hz
   check tone, keeping the same way of listening and the same volume every
   sitting.
2. The app draws one of the 27 tones at random (the browser's cryptographic
   random source, each tone 1 in 27), then three other meanings at random from
   the same layer, and shuffles the four. Given the four shown, each is equally
   likely to be the tone's own, so chance is exactly 1 in 4 whatever the
   listener knows about the meanings.
3. Before listening, the app shows a fingerprint of the draw: SHA-256 of
   `meanings-test-v1|<tone Hz>|<option Hz in the order shown, comma-separated>|<salt>`,
   with a random 16-byte salt. The draw is kept in the sitting's file in a
   sealed (base64) field. The app never shows which tone it was, and
   participants are asked not to decode the file.
4. The tone plays for its layer's optimal length in the Aetheria duration
   protocol (`DURATION_PROTOCOL` in `interval-analysis.js`): GUT 45 minutes,
   HEART 30, HEAD 20. A pure sine at a fixed level, with 2-second fades. The
   length tells the listener the layer, which doesn't help: all four meanings
   come from that layer.
5. Afterwards, before seeing any meanings, the participant answers two
   questions: did the tone feel low, middle or high, and did they recognise
   which tone it was (no, not sure, yes).
6. Then the four meanings appear and the participant picks the one that fits
   what they heard, and may add a note.

At most one sitting a day per person, and not within two hours of a Tone Test
session.

## Who and how many

Participants are named by code only. The test runs when **54 sittings** are
in, from any participants, and not before. No one looks at hits until then.

A sitting counts only if the tone played to the end without an audio
interruption and the participant answered. Sittings stopped early, interrupted
or from demo mode don't count. Every file, counted or not, is published with
its reason.

## Analysis

- **Primary result:** the number of sittings whose chosen meaning is the
  tone's own. One-sided exact binomial test against 1 in 4, since the
  framework predicts more than chance; above chance is called if p < 0.05. At
  54 sittings that takes 20 or more hits (37%). Reported as a hit rate with a
  95% Clopper-Pearson interval. A result below chance is reported, not called.
- **Secondary results,** reported but not used for the verdict:
  - **Height.** The meanings climb with pitch, from the body to spirit, so a
    listener could match some of them only by hearing how high a tone is. A
    height-only guess takes the listener's own low, middle or high answer,
    treats it as positions 1 to 3, 4 to 6 or 7 to 9 of the layer, and picks
    among the four shown the meanings in that third (sharing the guess equally
    when several are, and among all four when none is). Its expected hits are
    reported next to the actual hits. Hits above chance but not above the
    height-only guess would be explained by height.
  - **Recognition.** The hit rate leaving out sittings where the listener said
    they recognised the tone, and leaving out "not sure" as well.
  - **By layer and by participant,** each with its interval. With about two
    sittings per tone, single tones can't be read.

## What each outcome will mean

- **Above chance:** listeners picked the tones' own meanings more often than
  luck allows, in this setup. The height check says how much of that hearing
  how high a tone is explains. It would need repeating with new sittings and
  other people.
- **Not above chance:** in this setup, the meanings could not be told from the
  tones better than luck. At 54 sittings the test catches a true hit rate of
  40% about 7 times in 10, 45% about 9 times in 10 and 50% almost always; a
  weaker match can't be ruled out.

## Limits stated in advance

- Pure tones through a phone speaker or earbuds, not music.
- The meanings as worded above.
- The first participants know the framework and the meanings well. The random
  draw keeps chance at exactly 1 in 4 for them too, but nothing can stop a
  listener from recognising a familiar tone's pitch; the recognition question
  and the height check report how much that happened.
- Tones are drawn independently, so some get more sittings than others.
