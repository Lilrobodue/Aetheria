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

## The app

[Tone Test](https://big-banana-studios.github.io/tone-test/) (Big Banana
Studios, Chrome on Android with a Polar H10) runs a session exactly as the plan
describes: it seals a random order and control tone with a SHA-256 fingerprint
before the session, plays the tones on the audio clock, logs every beat on the
same clock and saves one file per session. Nothing leaves the phone unless the
participant sends the file. `?demo` runs it with a pretend strap, and files from
demo mode are marked and never counted.

## The analysis

- `python3 -I analyze.py --check DIR`: blind. Lists each session file, checks
  its fingerprint against its order, and applies the quality rules, without
  comparing tones. Safe to run as sessions come in.
- `python3 -I analyze.py DIR`: the pre-registered test. Refuses to run before
  40 sessions pass the quality rules.
- `tests/make_sessions.py`: testing only. Writes simulated sessions in the app's
  file format. Over 30 simulated sets with no effect, the test called a
  difference once (3%); over 8 sets with a 1.5 bpm effect it found it every
  time, estimating 1.51 bpm on average, with the 95% interval covering 1.5 in
  all 8. A file saved by the app in demo mode also passes the reader: its
  fingerprint checks out and its 840 beats cover 99.9% of the session.
