# Tone test

Does the heart behave differently while listening to an Aetheria tone (2178 Hz)
than while listening to a matched control one semitone away (2056 or 2308 Hz)?
Each session is 5 minutes of silence, then 30 minutes of one tone, picked by a
hidden coin flip.

- `PREREGISTRATION.md`: the plan, pushed to GitHub (commit 02a1a48, 14:18
  Mountain, 21 Nov 2026) before any tone session, and its **amendment 1**
  (commit bdf1264, 16:40 Mountain, 21 Nov 2026), also before any session
  counted. The amendment replaced 45-second blocks with 30-minute sessions,
  because the Aetheria duration protocol gives HEART tones 25 to 45 minutes.
- `design_check_v2.py`: the design check the amendment calls for. Writes
  `design_check_v2.json`.
- `design_check.py`, `design_check.json`: the design check for the original
  block design, kept for the record.

## Design check (amendment 1)

With no effect, the primary test calls a difference 4.4% of the time on real
resting hearts and 5.2% on simulated ones, as an honest 5% test should (1,000
experiments of 40 sessions).

Chance of catching a shift in heart rate in Aetheria sessions (500 experiments
each):

| Sessions | 1 bpm, real | 2 bpm, real | 3 bpm, real | 1 bpm, simulated | 2 bpm, simulated | 3 bpm, simulated |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | 22% | 63% | 95% | 13% | 43% | 73% |
| 40 | 40% | 93% | 100% | 25% | 68% | 96% |
| 80 | 71% | 100% | 100% | 45% | 96% | 100% |

"Real" is 35-minute windows of the seven good Fantasia resting recordings
(PhysioNet), resampled. "Simulated" is the Two Rooms heart fitted to BBS-P1's
whole baseline, dog and all, so it is the restless case. At the planned 40
sessions, a 3 bpm shift is caught almost every time and a 2 bpm shift two times
in three to nine times in ten. A 1 bpm shift would usually be missed.

## The app

[Tone Test](https://big-banana-studios.github.io/tone-test/) (Big Banana
Studios, Chrome on Android with a Polar H10) runs a session exactly as the plan
describes: it flips the hidden coins, seals the pick with a SHA-256 fingerprint
before the session, plays the tone on the audio clock, logs every beat on the
same clock and saves one file per session, with the pick sealed (base64) inside.
Nothing leaves the phone unless the participant sends the file. `?demo` runs it
with a pretend strap, and files from demo mode are marked and never counted.

Changes to the app:

- 1.0.1 (21 Nov 2026): on 1.0.0, tapping Done before Save threw a finished
  session away. Every session is now kept on the phone the moment it ends, a
  copy is kept every 30 seconds while it runs (a closed tab leaves the beats so
  far, marked interrupted, which never count), and session numbers never repeat.
  A Send button shares the session through Android's share list as a `.txt`
  holding the same JSON, because Chrome won't share `.json` files; shared copies
  are renamed to `.json` when they arrive.
- 1.0.2 (21 Nov 2026): a line under the seal button says what's left before it
  works.
- 2.0.0 (21 Nov 2026): amendment 1. One tone per session, 5 + 30 minutes, the
  pick sealed in the file. Files from version 1 don't count.

Sessions lost (they count toward the one-a-day rule but are never analysed):

- BBS-P1, 21 Nov 2026, session 1 (version 1.0.0, block design): finished, then
  lost to the 1.0.0 Done bug before it was saved. Its hidden order went with it,
  so nothing from it was ever compared. BBS-P1's next session is on a later day,
  as the plan requires.

## The analysis

- `python3 -I analyze.py --check DIR`: blind. Lists each session file, checks
  its fingerprint against its sealed pick without printing the pick, and applies
  the quality rules, without comparing tones. Safe to run as sessions come in.
- `python3 -I analyze.py DIR`: the pre-registered test. Refuses to run before
  40 sessions pass the quality rules.
- `tests/make_sessions.py`: testing only. Writes simulated sessions in the app's
  version 2 format. Over 30 simulated sets of 40 sessions with no effect, the
  test called a difference twice (7%, in line with 5% at this count); over 8
  sets with a 2 bpm effect it found it 5 times, as the simulated design check
  predicts, estimating 2.1 bpm on average. A file saved by the app in demo mode
  passes the reader: its fingerprint matches its sealed pick.
