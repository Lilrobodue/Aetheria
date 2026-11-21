# Resting baselines

Data acquired by Big Banana Studios. People are named by code only.

Each file is one resting session: every beat-to-beat interval from a Polar H10
chest strap, in milliseconds, in order. Nothing else from the session is kept:
no names, account ids or clock times, and none of the app's other streams.

| File | Participant | Date | Minutes | Beats | How |
| --- | --- | --- | --- | --- | --- |
| `BBS-P1_2026-11-21.csv` | BBS-P1 | 21 Nov 2026, early afternoon | 15.5 | 1,124 | Seated upright, still, breathing normally, not talking; recorded with Coherence Lab, phone volume at zero and screen face down |

`baseline.py` reads them with the same artefact rule as the Fantasia check,
skips the first 2 minutes, takes the next 10 minutes as the session, describes
the heart, refits the simulated heart to it and reruns the session-count table
(hidden random schedule, guided breathing, 500 experiments). It is descriptive:
a baseline, not a test of anything.

    python3 baseline.py baselines/BBS-P1_2026-11-21.csv    # writes baselines/BBS-P1_2026-11-21.json
