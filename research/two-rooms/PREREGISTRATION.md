# Two Rooms no-link simulation: pre-registration

Written, committed and pushed to GitHub before any simulation ran. If the plan
changes, the change is a new commit with its reason, made before rerunning.

## The question

Two Rooms asks whether two people in separate rooms, with no way to see, hear
or signal each other, show a link in their heart rhythms. Before anyone records
a real session, we want to know which ways of analysing the data can be fooled
when there is no link at all, how badly, and how many sessions an honest test
would need to see a small real effect.

This simulation contains no real link and no real people. It cannot show that a
link exists or doesn't. It tells us which analysis to build into the app.

## Two designs

**Design A, "together."** Both people wear a strap and start a session at the
same time, in separate rooms. The question is whether their heart-rate traces
move together more than chance.

**Design B, "sending."** One person, the sender, is prompted by their own app at
random moments to send (focus on the other person) for 30 seconds, then rest
for 30 seconds. The order is random, balanced and hidden: the receiver never
knows when sending happens. The question is whether the receiver's heart rate
differs between send and rest periods.

## The simulated heart

Heart rate in beats per minute, sampled 4 times a second, for 10-minute
sessions (2,400 samples). Each person-session gets:

- a resting level drawn from 70 +/- 8 bpm;
- a settling curve: heart rate drifting down 4 +/- 1.5 bpm over the first few
  minutes of sitting still (time constant 90 s);
- slow wander: a random drift with a 60-second memory, size 2 bpm;
- the 0.1 Hz rhythm (Mayer waves): a random oscillation centred on 0.1 Hz,
  size 1.5 bpm;
- breathing (respiratory sinus arrhythmia): 3 bpm at the person's own
  breathing rate, 0.25 +/- 0.04 breaths a second with natural wobble;
- measurement noise, 0.5 bpm.

## No-link scenarios

Nothing passes between the two people in any of these. Each is something real
sessions could easily contain.

1. **Apart.** Sessions start at different times. Nothing is shared.
2. **Same start.** Both start at the same moment and sit still. Both settling
   curves happen together.
3. **Guided breathing.** Both follow the same breathing guide, 6 breaths a
   minute, started at the same moment. Breathing is then shared: 6 bpm of
   breathing swing at 0.1 Hz, in step to within half a second.
4. **Same soundtrack.** Both listen to the same session audio started at the
   same moment, with a change of tone every 60 seconds. Each change brings a
   brief dip of 1.5 bpm lasting about 5 seconds.

## Analyses

What an app might naturally do (naive):

- **N1. Correlation.** Pearson correlation of the two traces, with the textbook
  p-value that treats all 2,400 samples as independent. Link if p < 0.05.
- **N2. Best lag.** The highest cross-correlation within +/- 10 seconds of lag,
  compared with the same textbook threshold. Link if it beats it.
- **N3. Fixed-order sending (Design B done wrong).** Rest for the first half of
  the session, send for the second half. Link if the receiver's mean heart rate
  differs between halves by a t-test on the samples, p < 0.05.

What we expect to hold up (sound):

- **S1. Swapped-partner test (Design A).** Run K sessions. Score each true pair
  by its correlation. Compare the true pairs with every pairing of one person's
  session with the other person's session from a different day, which shares
  the protocol but not the moment. Permutation p-value from 1,000 random
  re-pairings. Link if p < 0.05.
- **S2. Hidden random schedule (Design B).** Each session: 60 s to settle, then
  18 periods of 30 s, 9 send and 9 rest in random order. Score: the receiver's
  mean heart rate in send periods minus rest periods, summed over K sessions.
  Permutation p-value from 1,000 relabellings of the periods within sessions.
  Link if p < 0.05. The two phones' clocks are allowed to disagree by up to a
  second or two (drawn from +/- 1 s).

## Runs

- False alarms: each analysis under each scenario. 2,000 sessions for N1 to N3;
  1,000 experiments of K = 20 sessions for S1 and S2.
- Power (only for S1 and S2, the sound tests):
  - S2: the receiver's heart rate shifts by 0.25, 0.5 or 1 bpm during send
    periods; K = 5, 10, 20, 40, 80 sessions; 500 experiments each, under the
    Guided breathing scenario.
  - S1: the receiver's trace takes in a share c = 0.05, 0.1 or 0.2 of the
    sender's own fluctuations, at zero lag; K = 10, 20, 40; 500 experiments
    each, under the Same start scenario.
- Random seed 20261121.

## Decision rules

- An analysis is **safe** if its false-alarm rate is at most 6% in every
  scenario (5% plus simulation noise), and **unsafe** otherwise.
- The recommended analysis for the app is the safe one that reaches 80% power
  with the fewest sessions at a 0.5 bpm effect.
- Every result is reported, including any where a sound test fails.

## Limits stated in advance

- The heart model is a reasonable sketch, not a fitted model of any person. Its
  sizes come from common textbook ranges, not from Joe and Alisha's data. Once
  real resting sessions exist, the simulation should be rerun with numbers
  fitted to them.
- A link, if real, could take forms this simulation doesn't model (a delay, a
  change in variability rather than level). The test chosen must be fixed before
  real data are seen; trying several and keeping the best would bring false
  alarms back.
