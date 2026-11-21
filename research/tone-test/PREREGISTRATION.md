# Tone test: pre-registration

Written and pushed to GitHub before any tone session is recorded. If anything
here changes, the change is a new commit with its reason, made before the
first session.

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
