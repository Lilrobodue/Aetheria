# Tone test

Does the heart behave differently during an Aetheria tone (2178 Hz) than during
a matched control one semitone away (2056 or 2308 Hz, hidden and random)?

- `PREREGISTRATION.md`: the plan, pushed to GitHub (commit 02a1a48, 14:18
  Mountain, 21 Nov 2026) before any tone session.
- `design_check.py`: the design check the plan calls for, with simulated hearts
  fitted to BBS-P1's baseline. Writes `design_check.json`.

## Design check

With no effect, the primary test calls a difference 4.8% of the time (5.4% with
the quieter heart), as an honest 5% test should (1,000 experiments of 40
sessions).

Chance of catching a shift in heart rate during the Aetheria tone:

| Sessions | 0.5 bpm, whole baseline | 1 bpm, whole baseline | 0.5 bpm, quiet stretch | 1 bpm, quiet stretch |
| --- | --- | --- | --- | --- |
| 10 | 14% | 40% | 35% | 91% |
| 20 | 21% | 66% | 64% | 99% |
| 40 | 44% | 94% | 91% | 100% |

"Whole baseline" is BBS-P1's first session as recorded, including a dog
climbing into a lap; "quiet stretch" is its calm middle. Real sessions should
land between the two, which is why quiet sessions matter. At the planned 40
sessions, a 1 bpm shift is caught 94% to 100% of the time.

## Still to build

A small app that plays the tones in the hidden order, records the H10's beats
on the same clock, fingerprints the schedule before the session and reveals it
only in the export. No tone session counts until it exists.
