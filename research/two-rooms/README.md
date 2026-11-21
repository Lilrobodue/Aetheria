# Two Rooms no-link simulation

Before any real Two Rooms session is recorded: which ways of analysing two
heart traces get fooled when there is no link at all, and how many sessions an
honest test needs. Everything here is simulated; nothing in it is evidence for
or against a link.

- `PREREGISTRATION.md`: the plan, pushed to GitHub (commit 2f90c29, 11:31
  Mountain, 21 Nov 2026) before anything ran.
- `two_rooms_sim.py`: the simulation. Writes `results.json` (a few minutes).
- `crosscheck.py`: the main conclusions again, with a simpler heart model and
  analysis code written separately.

    python3 two_rooms_sim.py
    python3 crosscheck.py

## Results

**The easy analyses call a link most of the time when there is none.**

| No-link scenario | Correlation, textbook test | Best lag within 10 s | Rest first, send second |
| --- | --- | --- | --- |
| Apart | 70% | 100% | 86% |
| Same start | 78% | 100% | 87% |
| Guided breathing | 100% | 100% | 81% |
| Same soundtrack | 79% | 100% | 85% |

Two unlinked people following the same breathing guide correlate at r = 0.70
on average (0.76 in the cross-check's simpler heart).

**The two sound tests hold at about 5% in every scenario** (1,000 experiments
of 20 sessions each):

| No-link scenario | Swapped-partner test | Hidden random schedule |
| --- | --- | --- |
| Apart | 4.7% | 4.1% |
| Same start | 4.3% | 5.5% |
| Guided breathing | 5.3% | 5.3% |
| Same soundtrack | 5.3% | 4.7% |

The cross-check agrees: 66% false alarms for the textbook test, 3.5% and 4.5%
for the two sound tests.

**How many sessions.** Hidden random schedule, under guided breathing, chance
of detecting a real shift in the receiver's heart rate during send periods:

| Sessions | 0.25 bpm | 0.5 bpm | 1 bpm |
| --- | --- | --- | --- |
| 5 | 9% | 28% | 74% |
| 10 | 13% | 46% | 96% |
| 20 | 25% | 71% | 100% |
| 40 | 48% | 95% | 100% |
| 80 | 75% | 100% | 100% |

Swapped-partner test, when the receiver's trace truly carries a share of the
sender's (a correlation of about 0.05, 0.1 or 0.2): 10 sessions give 27%, 78%
and 100%; 20 give 52%, 97% and 100%; 40 give 80%, 100% and 100%.

## What the app must do

1. Use the hidden random schedule as the main test. The sender's app draws 9
   send and 9 rest periods of 30 s in random order, after 60 s to settle, and
   records a fingerprint of the schedule before the session starts.
2. Keep the receiver blind: no sound, light or vibration tied to the schedule
   can reach the receiver's room, and the receiver's app never shows it.
3. Log every heartbeat (RR interval) on both phones with network-synced time,
   and export both logs whole.
4. Fix the number of sessions before starting (40 detects a 0.5 bpm shift 95%
   of the time) and run the test once, at the end. Checking as you go and
   stopping when it looks good brings the false alarms back.
5. Never call one session's correlation a link, and never use a fixed
   rest-then-send order.
6. Publish every session, including the ones that show nothing.

## Real hearts (Fantasia study, seven strangers)

Plan: `PREREG_REAL_HEARTS.md` (pushed 12:21, before the data arrived; the
three files damaged in transfer were noted at 12:30, before any analysis).
Run: `python3 -I real_hearts.py DATA_DIR` writes `results_real.json`.

Seven healthy young adults from the public Fantasia recordings (Iyengar et al.
1996, PhysioNet), recorded separately, so every pairing is a real no-link pair:
75 ten-minute sessions, 220 stranger pairings.

| Analysis | Simulated hearts | Real strangers |
| --- | --- | --- |
| Correlation, textbook test | 70-100% | 69% |
| Best lag within 10 s | about 100% | 99% |
| Rest first, send second | 81-87% | 82% |
| Swapped-partner test | 4.3-5.3% | 1.2% |
| Hidden random schedule | 4.1-5.5% | 6.4%, then 4.7% |

The hidden-schedule test came out at 6.4% in the planned 1,000 experiments,
just over the plan's 6% line. A follow-up written afterwards
(`followup_s2.py`, not part of the plan) reran it with 5,000 experiments on a
fresh seed: 4.7%, with p-values spread evenly as they should be (1.0% below
0.01, 9.9% below 0.1, 50.1% below 0.5). A randomization test with truly random
labels can't exceed 5% by construction, so the 6.4% was chance.

Real hearts wander more on slow timescales than the textbook heart (56% of
their variation is slower than 0.04 Hz, against 22%), so an honest test needs
more sessions. Hidden random schedule, real sessions, chance of detecting a
shift during send periods:

| Sessions | 0.25 bpm | 0.5 bpm | 1 bpm |
| --- | --- | --- | --- |
| 5 | 9% | 18% | 42% |
| 10 | 11% | 24% | 67% |
| 20 | 15% | 41% | 92% |
| 40 | 21% | 65% | 100% |
| 80 | 37% | 92% | 100% |

The simulated heart refitted to these recordings gives nearly the same table
(63% and 92% at 40 and 80 sessions for 0.5 bpm). So: 40 sessions for a 1 bpm
shift, about 80 for a 0.5 bpm shift.
