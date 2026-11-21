#!/usr/bin/env python3
"""
Design check for amendment 1 (30-minute sessions), as PREREGISTRATION.md
describes it: the primary test's false-alarm rate with no effect, and its
chance of catching a 1, 2 or 3 bpm shift at 20, 40 and 80 sessions.

Two kinds of heart:
- real: 35-minute windows of the seven good Fantasia resting recordings
  (PhysioNet; not committed here), skipping each recording's first 10 minutes;
- simulated: the Two Rooms heart, fitted to BBS-P1's whole baseline.

    python3 -I design_check_v2.py FANTASIA_DIR      # writes design_check_v2.json

An effect is added to Aetheria sessions as a ramp from the tone's start to its
full size at tone minute 10, then held. Permutations are 2,000 per test here to
keep the run short; the real analysis uses 10,000.
"""
import glob
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # works under python3 -I too
sys.path.insert(0, os.path.join(HERE, "..", "two-rooms"))
import two_rooms_sim as sim  # noqa: E402
import real_hearts as rh  # noqa: E402
from design_check import baseline_facts  # noqa: E402

FS = 4
SILENCE, TONE = 300, 1800
TOTAL = SILENCE + TONE
SEED = 20261121
PERMS = 2000
EXPERIMENTS = 1000

sim.SECONDS = TOTAL
sim.N = int(sim.FS * sim.SECONDS)
sim.T = np.arange(sim.N) / sim.FS
T = np.arange(TOTAL * FS) / FS
RAMP = np.clip((T - SILENCE) / 600.0, 0, 1)          # 0 before the tone, 1 from tone minute 10
BASE = (T >= 60) & (T < 300)                           # silence minutes 1-5
LATE = (T >= 900) & (T < 2100)                         # tone minutes 10-30


def fantasia_windows(data_dir):
    out = []
    for path in sorted(glob.glob(os.path.join(data_dir, "*.ecg"))):
        name = os.path.basename(path)[:-4]
        if name in rh.EXCLUDED or rh.damaged(path):
            continue
        s, c = rh.read_annotations(path)
        grid, hr, _ = rh.heart_rate_trace(s, c)
        start = grid[0] + 600
        while True:
            a = np.searchsorted(grid, start)
            if a + len(T) > len(hr):
                break
            out.append(hr[a:a + len(T)])
            start += TOTAL
    return np.array(out)


def labels_for(rng, k):
    while True:
        lab = rng.random(k) < 0.5
        if 0 < lab.sum() < k:
            return lab


def test(change, lab, rng, perms=PERMS):
    """Two-sided permutation test of mean(A) - mean(C), keeping the counts."""
    def stat(L):
        return (change * L).sum(-1) / L.sum(-1) - (change * ~L).sum(-1) / (~L).sum(-1)
    obs = stat(lab)
    shuffled = lab[np.argsort(rng.random((perms, len(lab))), axis=1)]
    null = stat(shuffled)
    return (1 + np.sum(np.abs(null) >= abs(obs))) / (1 + perms)


def run(source, rng, k, delta, experiments=EXPERIMENTS):
    calls = 0
    for _ in range(experiments):
        hr = source(rng, k)
        lab = labels_for(rng, k)
        hr = hr + delta * lab[:, None] * RAMP[None, :]
        change = hr[:, LATE].mean(1) - hr[:, BASE].mean(1)
        calls += test(change, lab, rng) < 0.05
    return calls / experiments


def main():
    rng = np.random.default_rng(SEED)
    windows = fantasia_windows(sys.argv[1])
    facts = baseline_facts(0, 15.5 * 60)
    sizes = rh.fitted_sizes(facts)
    sources = {
        "real (Fantasia windows, resampled)": lambda r, k: windows[r.integers(0, len(windows), k)],
        "simulated (fitted to BBS-P1)": lambda r, k: sim.hearts(r, k, "same_start", **sizes),
    }
    out = {"seed": SEED, "perms_per_test": PERMS, "experiments": EXPERIMENTS,
           "fantasia_windows": int(len(windows)), "sim_sizes": sizes, "results": {}}
    print(f"{len(windows)} real 35-minute windows; simulated sizes {sizes}")
    for name, src in sources.items():
        res = {"false_alarms_at_40": run(src, rng, 40, 0.0)}
        print(f"{name}: false alarms at 40 sessions {100 * res['false_alarms_at_40']:.1f}%")
        for delta in (1.0, 2.0, 3.0):
            for k in (20, 40, 80):
                p = run(src, rng, k, delta, experiments=500)
                res[f"power_{delta:g}bpm_{k}"] = p
                print(f"   {delta:g} bpm, {k} sessions: {100 * p:.0f}%")
        out["results"][name] = res
    json.dump(out, open(os.path.join(HERE, "design_check_v2.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
