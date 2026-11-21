#!/usr/bin/env python3
"""
Tone test design check, as described in PREREGISTRATION.md: simulated hearts
fitted to BBS-P1's baseline, the primary test's false-alarm rate with no
effect, and its chance of catching a 0.5 or 1 bpm shift.

    python3 design_check.py        # writes design_check.json

Uses the simulated heart from ../two-rooms. Permutations are 1,000 per test
here to keep the run short; the real analysis uses 10,000.
"""
import csv
import json
import os
import sys

import numpy as np
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "two-rooms"))
import two_rooms_sim as sim  # noqa: E402
from real_hearts import fitted_sizes  # noqa: E402

# A tone session is 12 minutes: 2 to settle, then 10 blocks of 60 s.
sim.SECONDS = 720
sim.N = int(sim.FS * sim.SECONDS)
sim.T = np.arange(sim.N) / sim.FS
SETTLE, BLOCK, BLOCKS = 120, 60, 10
WINDOW = (5, 45)  # seconds of each tone that are analysed


def baseline_facts(lo_s, hi_s):
    """Heart facts from BBS-P1's baseline between lo_s and hi_s seconds."""
    path = os.path.join(HERE, "..", "two-rooms", "baselines", "BBS-P1_2026-11-21.csv")
    rr = np.array([float(r["rr_ms"]) for r in csv.DictReader(open(path))]) / 1000.0
    t = np.cumsum(rr)
    med = np.array([np.median(rr[max(0, i - 5):i + 6]) for i in range(len(rr))])
    ok = (rr >= 0.3) & (rr <= 2.0) & (np.abs(rr - med) <= 0.2 * med)
    grid = np.arange(np.ceil(t[ok][0] * sim.FS), np.floor(t[ok][-1] * sim.FS)) / sim.FS
    hr = np.interp(grid, t[ok], 60.0 / rr[ok])
    seg = hr[int(lo_s * sim.FS):int(hi_s * sim.FS)]
    f, p = signal.welch(seg - seg.mean(), fs=sim.FS, nperseg=1024)
    tot = p[(f >= 0.003) & (f < 0.5)].sum()
    band = lambda a, b: float(p[(f >= a) & (f < b)].sum() / tot)
    return {"sd_within_session": float(seg.std()), "share_vlf": band(0.003, 0.04),
            "share_lf": band(0.04, 0.15), "share_hf": band(0.15, 0.4)}


def block_means(y):
    """(k, 10) mean heart rate over each tone's analysed window."""
    out = np.empty((len(y), BLOCKS))
    for j in range(BLOCKS):
        a = int((SETTLE + j * BLOCK + WINDOW[0]) * sim.FS)
        b = int((SETTLE + j * BLOCK + WINDOW[1]) * sim.FS)
        out[:, j] = y[:, a:b].mean(axis=1)
    return out


def orders(rng, k):
    lab = np.tile(np.r_[np.ones(BLOCKS // 2), np.zeros(BLOCKS // 2)], (k, 1))
    return np.take_along_axis(lab, np.argsort(rng.random((k, BLOCKS)), axis=1), axis=1)


def p_value(means, lab, rng, perms=1000):
    def score(l):
        a = (means * l).sum(-1) / l.sum(-1)
        b = (means * (1 - l)).sum(-1) / (1 - l).sum(-1)
        return (a - b).sum(-1)
    obs = score(lab)
    k = len(means)
    shuffled = np.take_along_axis(np.broadcast_to(lab, (perms, k, BLOCKS)),
                                  np.argsort(rng.random((perms, k, BLOCKS)), axis=2), axis=2)
    return (1 + np.sum(np.abs(score(shuffled)) >= abs(obs))) / (1 + perms)


def run(rng, sizes, k, experiments, deltas):
    hits = {d: 0 for d in deltas}
    for _ in range(experiments):
        m = block_means(sim.hearts(rng, k, "same_start", **sizes))
        lab = orders(rng, k)
        for d in deltas:
            hits[d] += p_value(m + d * lab, lab, rng) < 0.05
    return {str(d): hits[d] / experiments for d in deltas}


def main():
    rng = np.random.default_rng(20261121)
    conditions = {"whole_session": baseline_facts(120, 720), "quiet_stretch": baseline_facts(300, 780)}
    out = {"conditions": {}, "settings": {"sessions_for_false_alarms": 40, "permutations": 1000,
                                          "seed": 20261121}}
    for name, facts in conditions.items():
        sizes = fitted_sizes(facts)
        res = {"facts": facts, "sizes": sizes,
               "false_alarms_40_sessions": run(rng, sizes, 40, 1000, [0.0])["0.0"],
               "power": {str(k): run(rng, sizes, k, 500, [0.5, 1.0]) for k in (10, 20, 40)}}
        out["conditions"][name] = res
        print(name, json.dumps({"false_alarms": res["false_alarms_40_sessions"], "power": res["power"]}))
    with open(os.path.join(HERE, "design_check.json"), "w") as fh:
        json.dump(out, fh, indent=1)


if __name__ == "__main__":
    main()
