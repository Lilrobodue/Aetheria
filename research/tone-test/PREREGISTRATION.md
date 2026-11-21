# Tone test: pre-registration

Written and pushed to GitHub before any tone session is recorded. If anything
here changes, the change is a new commit with its reason, made before the
first session.

**Amendment 1 (21 November 2026), at the end of this file, replaces the session
design and the analysis below.** Nothing else changes.

## The question

While a person sits still and listens, does their heart behave differently
during an Aetheria tone than during a closely matched tone that isn't one?

This tests the tone, not a healing claim. A difference, if found, would mean
only that the heart responded differently to this tone in this setup.

## The tones

- **Aetheria tone: 2178 Hz,** the centre of the cube (HEART layer, position 5,
  "Compassion Activation"), chosen as the framework's central heart tone.
- **Control tone: 2056 Hz or 2308 Hz,** one semitone below or above 2178.
  Neither is one of the 27 and neither has a digit root of 3, 6 or 9 (both
  reduce to 4). Each session uses one of the two, picked at random and hidden,
  so the listener can't tell the Aetheria tone by being the higher or lower one.

Both are pure sine tones at the same playback level, with 2-second fades in and
out, at a fixed, comfortable volume the participant sets once and keeps.

## A session

1. Seated upright and still, Polar H10 on, the phone face down. Pets out of the
   room.
2. 2 minutes of silence to settle (not analysed).
3. 10 blocks of 60 seconds: 45 seconds of tone, then 15 seconds of silence.
   Five blocks use the Aetheria tone and five the control, in an order drawn at
   random by the app before the session starts.
4. The app records a fingerprint of the schedule (the tone order and which
   control) before the session starts and reveals the schedule only in the
   export, after the session ends.
5. The app logs every heartbeat (beat-to-beat interval) with the time, on the
   same clock as the tones, and exports the beats and the schedule together.

Total: 12 minutes. At most one session a day per person.

## Who and how many

Participants are named by code only (BBS-P1, BBS-P2 and so on). The test runs
when **40 sessions** are in, from one or both participants, and not before.
No one looks at any tone-versus-control comparison until then.

A session is left out only for a technical failure: more than 5% of beats
flagged as artefacts, or the strap or tones dropping out. Interruptions stay
in; the random order spreads them fairly. Every session, kept or left out, is
published with its reason.

## Analysis

The same processing as the Two Rooms real-heart check: normal beats, intervals
outside 0.3 to 2.0 s or more than 20% from the local median dropped and
bridged, heart rate in beats per minute at 4 samples a second.

- **Primary result:** for each block, the mean heart rate from second 5 to
  second 45 of the tone. Per session: Aetheria blocks' mean minus control
  blocks' mean. Summed over sessions. Two-sided permutation test, relabelling
  the blocks within each session (keeping five of each), 10,000 relabellings.
  A difference is called if p < 0.05. Reported with its size in bpm and a 95%
  interval from resampling sessions.
- **Secondary results, reported but not used for the verdict:** the same test
  on beat-to-beat variability (RMSSD) within the same windows, and on the
  first 15 seconds of silence after each tone (does anything linger?).

## What each outcome will mean

- **A difference (p < 0.05):** in this setup, the heart behaved differently
  during 2178 Hz than during a matched control. It would need repeating with
  new sessions, and ideally other people, before it means more.
- **No difference:** with 40 sessions this test would have caught a shift of
  the size stated in the design check below most of the time. A smaller effect
  can't be ruled out.

## Design check (to run after this plan is pushed, before any session)

With simulated hearts fitted to BBS-P1's baseline: the false-alarm rate of the
primary test with no effect (should be near 5%), and the chance of catching a
0.5 or 1 bpm shift at 10, 20 and 40 sessions, under two conditions: the whole
baseline session, and its quiet stretch. Seed 20261121.

## Limits stated in advance

- Pure tones through a phone speaker or earbuds, not music. Other ways of
  delivering the tones are other tests.
- One tone pair. Other Aetheria tones are other tests, each needing its own
  plan.
- The participants know the hypothesis. The hidden order and the random
  higher-or-lower control are there so that knowing it can't steer the result.

## Amendment 1 (21 November 2026, before any session counts)

**Why.** The Aetheria apps' own duration protocol (`DURATION_PROTOCOL` in
`interval-analysis.js`) gives HEART tones 25 to 45 minutes, 30 being optimal
(HEAD 15 to 30, GUT 40 to 60). 2178 Hz is a HEART tone. The block design above
plays it for 45 seconds at a time, far under that minimum, and switching tones
every minute would blur an effect that builds slowly. Joe raised this on
21 November. No session has counted: BBS-P1's only session, on 21 November,
was lost to an app bug before anything was compared (see README). So the
design changes now, before any data.

**A session.** Seated upright and still, Polar H10 on, the phone face down,
pets out of the room. 5 minutes of silence, then 30 minutes of one tone,
without a break: 35 minutes in all. At most one session a day per person, at
about the same time of day where possible.

**Which tone.** For each session the app draws Aetheria or control with a fair
coin (the browser's cryptographic random source), and the control (2056 or
2308 Hz) with a second coin. Before the session starts it shows a fingerprint
of the draw: SHA-256 of `tone-test-v2|<A or C>|<control Hz>|<salt>`, with a
random 16-byte salt. The draw is stored in the session file in a sealed
(base64) field, so it isn't seen at a glance when the file is sent; participants
are asked not to decode it. The tones, level, 2-second fades and the volume rule
are unchanged.

**How many.** 40 sessions that pass the quality rules above (unchanged).
Sessions stopped early don't count. Files from version 1 of the app don't count.

**Primary result.** For each session, the change in heart rate: mean heart rate
over tone minutes 10 to 30 (session seconds 900 to 2100) minus mean heart rate
over silence minutes 1 to 5 (session seconds 60 to 300). The first ten minutes
of tone give an effect time to build, as the protocol implies. The result is
the mean change in Aetheria sessions minus the mean change in control sessions.
Two-sided permutation test, relabelling sessions within each participant
(keeping each participant's numbers of Aetheria and control sessions), 10,000
relabellings; a difference is called if p < 0.05. Reported with its size in bpm
and a 95% interval from resampling sessions within each arm. Heart rate is
processed exactly as above.

**Secondary results**, reported but not used for the verdict: the same test on
RMSSD over the same windows, and on heart rate over all 30 tone minutes minus
the silence.

**Design check**, to run after this amendment is pushed and before any session:
the false-alarm rate with no effect, and the chance of catching a 1, 2 or 3 bpm
shift at 20, 40 and 80 sessions, using 35-minute windows of the public resting
hearts (the seven good Fantasia recordings) and simulated hearts fitted to
BBS-P1's baseline. Seed 20261121. A rough first look on those windows, made
while weighing this change: 40 sessions catch a 2 bpm shift about 9 times in
10, and a 1 bpm shift about 4 times in 10.

**What "no difference" will mean.** With 40 sessions this test is built to catch
a shift of about 2 bpm. A 1 bpm shift could easily be missed.

**Software.** The app becomes version 2.0.0, and `analyze.py` reads its files.
The block analysis it replaces is in commit 553c836.
