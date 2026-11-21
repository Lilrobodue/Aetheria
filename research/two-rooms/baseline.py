#!/usr/bin/env python3
"""
Describe one resting baseline and rerun the session-count table for a heart
like it. Descriptive only.

    python3 baseline.py baselines/BBS-P1_2026-11-21.csv

Reads a CSV of beat-to-beat intervals (columns beat, rr_ms), applies the same
artefact rule as real_hearts.py, skips the first 2 minutes, takes the next 10
as the session, and writes <file>.json beside the CSV.
"""
import csv
import json
import os
import sys

import numpy as np
from scipy import signal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import two_rooms_sim as sim  # noqa: E402
from real_hearts import fitted_sizes  # noqa: E402

SKIP_S = 120.0


def main(path):
    with open(path) as fh:
        rr = np.array([float(row["rr_ms"]) for row in csv.DictReader(fh)]) / 1000.0
    t = np.cumsum(rr)
    med = np.array([np.median(rr[max(0, i - 5):i + 6]) for i in range(len(rr))])
    ok = (rr >= 0.3) & (rr <= 2.0) & (np.abs(rr - med) <= 0.2 * med)
    grid = np.arange(np.ceil(t[ok][0] * sim.FS), np.floor(t[ok][-1] * sim.FS)) / sim.FS
    hr = np.interp(grid, t[ok], 60.0 / rr[ok])
    a = np.searchsorted(grid, grid[0] + SKIP_S)
    sess = hr[a:a + sim.N]
    if len(sess) < sim.N:
        raise SystemExit("needs at least 12 minutes of beats")
    f, p = signal.welch(sess - sess.mean(), fs=sim.FS, nperseg=1024)
    tot = p[(f >= 0.003) & (f < 0.5)].sum()
    band = lambda lo, hi: float(p[(f >= lo) & (f < hi)].sum() / tot)
    hf, lf = (f > 0.15) & (f < 0.4), (f > 0.04) & (f < 0.15)
    in_sess = ok & (t >= t[ok][0] + SKIP_S) & (t < t[ok][0] + SKIP_S + sim.SECONDS)
    facts = {
        "beats": int(len(rr)), "minutes": float(t[-1] / 60), "artefact_share": float(1 - ok.mean()),
        "mean_hr": float(sess.mean()), "sd_within_session": float(sess.std()),
        "share_vlf": band(0.003, 0.04), "share_lf": band(0.04, 0.15), "share_hf": band(0.15, 0.4),
        "peak_lf_hz": float(f[lf][np.argmax(p[lf])]), "peak_hf_hz": float(f[hf][np.argmax(p[hf])]),
        "rmssd_ms": float(np.sqrt(np.mean(np.diff(rr[in_sess] * 1000) ** 2))),
        "mean_hr_first_2_min": float(hr[:a].mean()),
        "mean_hr_minutes_2_to_7": float(sess[:sim.N // 2].mean()),
        "mean_hr_minutes_7_to_12": float(sess[sim.N // 2:].mean()),
    }
    sizes = fitted_sizes(facts)
    rng = np.random.default_rng(20261121)
    power = sim.power_s2(rng, 500, [5, 10, 20, 40, 80], [0.25, 0.5, 1.0], sizes=sizes)
    out = {"file": os.path.basename(path), "facts": facts, "fitted_sizes": sizes, "power_S2": power}
    dest = os.path.splitext(path)[0] + ".json"
    with open(dest, "w") as fh:
        json.dump(out, fh, indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
