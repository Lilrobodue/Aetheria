# Two Rooms, real-heart check: pre-registration

Written and pushed before the data were downloaded. An addition to
`PREREGISTRATION.md`, which still governs everything not changed here.

## The question

The no-link simulation used made-up hearts. Here we use real ones: people who
were recorded separately, years ago, in a public study, and so can't share any
link. Pairing strangers gives real no-link pairs. We ask two things:

1. Do the easy checks still call a link between strangers, and do the two
   sound tests still hold near 5%?
2. Fitted to real hearts, how many sessions does the hidden-schedule test need?

## Data

The Fantasia Database on PhysioNet (Iyengar et al. 1996; Goldberger et al.
2000), under the Open Data Commons Attribution License: healthy adults lying
still for 120 minutes while watching the film Fantasia, beats sampled at 250 Hz
and every beat checked by eye. We use the beat-annotation files (`.ecg`) of the
young group, records f1y01 to f1y05 and f2y01 to f2y05 (ages 21 to 34), or
every one of those that we receive. Joe downloads them, because PhysioNet can't
be reached from the workspace.

## Processing

- Read the beat times from each `.ecg` file. Keep only normal beats.
- Beat-to-beat intervals outside 0.3 to 2.0 s, or more than 20% away from the
  median of the 11 around them, count as artefacts; they are dropped and the
  heart-rate trace bridges them in a straight line.
- Turn beats into a heart-rate trace in beats per minute, sampled 4 times a
  second.
- Skip each recording's first 10 minutes, then cut the rest into back-to-back
  10-minute sessions (up to 11 per person).

## Analyses

The same five as the simulation, unchanged:

- N1, N2, N3 on every pairing of two different people's sessions taken at the
  same place in their recordings (session j of one with session j of the
  other), so both had been lying still for the same time, like a shared start.
- S1, the swapped-partner test, and S2, the hidden random schedule, in 1,000
  experiments of 20 sessions each, drawn at random from the real sessions
  (seed 20261121).

## Refitting and power

From the real traces we measure the within-session spread of heart rate and
the shares of slow (below 0.04 Hz), 0.1 Hz band (0.04 to 0.15 Hz) and breathing
band (0.15 to 0.4 Hz) power. We scale the simulated heart's drift, 0.1 Hz wave
and breathing to match those, then rerun the S2 power table (0.25, 0.5 and
1 bpm; 5 to 80 sessions; 500 experiments each). We also run S2's power
directly on the real sessions, adding the shift to their send periods.

## Decision rules

As in `PREREGISTRATION.md`: a test is safe if its false-alarm rate is at most
6% here too. Everything is reported, including any failure of a sound test.
