#!/usr/bin/env python3
"""
Testing only: write simulated sessions in the Tone Test app's file format
(version 2, amendment 1: 5 minutes of silence, then 30 minutes of one tone), so
analyze.py can be checked end to end. Every file is marked as simulated in its
notes, and none of them is data.

    python3 -I tests/make_sessions.py OUT_DIR --sessions 40 --shift 1.5 --seed 1
"""
import argparse
import base64
import hashlib
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "two-rooms"))
import two_rooms_sim as sim  # noqa: E402

sim.SECONDS = 2100
sim.N = int(sim.FS * sim.SECONDS)
sim.T = np.arange(sim.N) / sim.FS
SIZES = {"drift_sd": 3.4, "mayer_sd": 2.96, "breath_amp": 3.03}  # fitted to BBS-P1's baseline


def to_beats(hr, rng):
    """Beats from a heart-rate trace, grouped into once-a-second notifications
    the way the strap sends them, intervals rounded to the strap's 1/1024 s.
    Intervals that arrive together share their notification time."""
    phase = np.cumsum(hr / 60.0 / sim.FS)
    k = np.arange(1, int(phase[-1]))
    times = np.interp(k, phase, sim.T)
    rr = np.round(np.diff(times) * 1024) / 1024 * 1000
    ends = times[1:]
    ticks = np.ceil(ends).astype(int)
    keep = (ticks >= 1) & (ticks <= sim.SECONDS)
    jitter = rng.uniform(0, 0.03, size=sim.SECONDS + 2)
    t = ticks[keep] + jitter[ticks[keep]]
    return [[round(float(a), 3), float(b)] for a, b in zip(t, rr[keep])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--sessions", type=int, default=40)
    ap.add_argument("--shift", type=float, default=0.0,
                    help="bpm added in Aetheria sessions, ramping up over the tone's first 10 minutes")
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    os.makedirs(a.out, exist_ok=True)
    hearts = sim.hearts(rng, a.sessions, "same_start", **SIZES)
    for i in range(a.sessions):
        tone = "A" if rng.random() < 0.5 else "C"
        control = int(rng.choice([2056, 2308]))
        salt = rng.bytes(16).hex()
        fp = hashlib.sha256(f"tone-test-v2|{tone}|{control}|{salt}".encode()).hexdigest()
        sealed = base64.b64encode(json.dumps({"tone": tone, "control": control, "salt": salt}).encode()).decode()
        hr = hearts[i].copy()
        if tone == "A":
            hr += a.shift * np.clip((sim.T - 300) / 600.0, 0, 1)
        s = {"app": "Tone Test, Big Banana Studios", "app_version": "2.test", "demo": False,
             "participant": "SIM", "date": f"2026-12-{i % 28 + 1:02d}", "completed": True,
             "tones": {"aetheria_hz": 2178, "controls_hz": [2056, 2308], "level": 0.2, "fade_s": 2},
             "timing": {"silence_s": 300, "tone_s": 1800, "total_s": 2100},
             "schedule": {"fingerprint": fp, "sealed": sealed},
             "beats": to_beats(hr, rng), "strap_disconnects_s": [], "audio_state_changes_s": [],
             "notes": f"SIMULATED for testing analyze.py, shift {a.shift} bpm"}
        json.dump(s, open(os.path.join(a.out, f"sim_{i:02d}.json"), "w"))
    print(f"wrote {a.sessions} simulated sessions to {a.out} (shift {a.shift} bpm)")


if __name__ == "__main__":
    main()
