#!/usr/bin/env python3
"""
Testing only: write simulated sessions in the Tone Test app's file format, so
analyze.py can be checked end to end. Every file is marked as simulated in its
notes, and none of them is data.

    python3 -I tests/make_sessions.py OUT_DIR --sessions 40 --shift 1.5 --seed 1
"""
import argparse
import hashlib
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "two-rooms"))
import two_rooms_sim as sim  # noqa: E402

sim.SECONDS = 720
sim.N = int(sim.FS * sim.SECONDS)
sim.T = np.arange(sim.N) / sim.FS
SIZES = {"drift_sd": 3.4, "mayer_sd": 2.96, "breath_amp": 3.03}  # fitted to BBS-P1's baseline


def to_beats(hr, rng):
    """Beats from a heart-rate trace, grouped into once-a-second notifications
    the way the strap sends them, intervals rounded to the strap's 1/1024 s."""
    phase = np.cumsum(hr / 60.0 / sim.FS)
    k = np.arange(1, int(phase[-1]))
    times = np.interp(k, phase, sim.T)
    rr = np.round(np.diff(times) * 1024) / 1024 * 1000
    ends = times[1:]
    beats = []
    for tick in np.arange(1, sim.SECONDS + 1):
        sel = (ends > tick - 1) & (ends <= tick)
        for v in rr[sel]:
            beats.append([float(tick + rng.uniform(0, 0.03)), float(v)])
    # same notification time for intervals that arrived together
    out, last = [], None
    for t, v in beats:
        if last is not None and abs(t - last) < 0.5:
            t = last
        out.append([round(t, 3), v])
        last = t
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--sessions", type=int, default=40)
    ap.add_argument("--shift", type=float, default=0.0, help="bpm added while the Aetheria tone plays")
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    os.makedirs(a.out, exist_ok=True)
    hearts = sim.hearts(rng, a.sessions, "same_start", **SIZES)
    for i in range(a.sessions):
        order = list(rng.permutation(["A"] * 5 + ["C"] * 5))
        control = int(rng.choice([2056, 2308]))
        salt = rng.bytes(16).hex()
        fp = hashlib.sha256(f"tone-test-v1|{''.join(order)}|{control}|{salt}".encode()).hexdigest()
        hr = hearts[i].copy()
        for j, o in enumerate(order):
            if o == "A":
                hr[(sim.T >= 120 + 60 * j) & (sim.T < 165 + 60 * j)] += a.shift
        s = {"app": "Tone Test, Big Banana Studios", "app_version": "test", "demo": False,
             "participant": "SIM", "date": f"2026-12-{i % 28 + 1:02d}", "completed": True,
             "tones": {"aetheria_hz": 2178, "control_hz": control, "level": 0.2, "fade_s": 2},
             "timing": {"settle_s": 120, "block_s": 60, "tone_s": 45, "blocks": 10, "total_s": 720},
             "schedule": {"order": order, "control": control, "salt": salt, "fingerprint": fp},
             "beats": to_beats(hr, rng), "strap_disconnects_s": [], "audio_state_changes_s": [],
             "notes": f"SIMULATED for testing analyze.py, shift {a.shift} bpm"}
        json.dump(s, open(os.path.join(a.out, f"sim_{i:02d}.json"), "w"))
    print(f"wrote {a.sessions} simulated sessions to {a.out} (shift {a.shift} bpm)")


if __name__ == "__main__":
    main()
