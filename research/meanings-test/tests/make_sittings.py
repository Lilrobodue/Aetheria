#!/usr/bin/env python3
"""
Testing only: write simulated sittings in the Meanings Test app's file format,
so analyze.py can be checked end to end. Every file is marked as simulated in
its notes, and none of them is data.

A simulated listener knows the tone's meaning with probability --knows and
otherwise picks one of the four at random. Their low / middle / high answer is
the tone's true third of its layer with probability --height-right, otherwise
another third at random.

    python3 -I tests/make_sittings.py OUT_DIR --sittings 54 --knows 0.0 --seed 1
"""
import argparse
import base64
import hashlib
import json
import os

import numpy as np

LAYERS = {
    "GUT": [174, 285, 396, 417, 528, 639, 741, 852, 963],
    "HEART": [1206 + 243 * k for k in range(9)],
    "HEAD": [3504 + 354 * k for k in range(9)],
}
MINUTES = {"GUT": 45, "HEART": 30, "HEAD": 20}
THIRDS = ["low", "middle", "high"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--sittings", type=int, default=54)
    ap.add_argument("--knows", type=float, default=0.0, help="chance the listener truly picks out the meaning")
    ap.add_argument("--height-right", type=float, default=0.7)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    os.makedirs(a.out, exist_ok=True)
    tones = [(L, hz) for L, hzs in LAYERS.items() for hz in hzs]
    for i in range(a.sittings):
        layer, hz = tones[rng.integers(len(tones))]
        others = [int(o) for o in rng.permutation([t for t in LAYERS[layer] if t != hz])[:3]]
        options = [int(o) for o in rng.permutation([hz] + others)]
        salt = rng.bytes(16).hex()
        fp = hashlib.sha256(f"meanings-test-v1|{hz}|{','.join(map(str, options))}|{salt}".encode()).hexdigest()
        sealed = base64.b64encode(json.dumps({"hz": int(hz), "options": options, "salt": salt}).encode()).decode()
        choice = options.index(hz) if rng.random() < a.knows else int(rng.integers(4))
        third = (LAYERS[layer].index(hz)) // 3
        if rng.random() >= a.height_right:
            third = int(rng.choice([t for t in range(3) if t != third]))
        s = {"app": "Meanings Test, Big Banana Studios", "app_version": "1.test", "demo": False,
             "participant": "SIM", "date": f"2026-12-{i % 28 + 1:02d}", "sitting_number": i + 1,
             "completed": True, "layer": layer, "minutes": MINUTES[layer],
             "answer": {"choice": choice, "recognised": str(rng.choice(["no", "not sure", "yes"])),
                        "height": THIRDS[third]},
             "audio_state_changes_s": [],
             "schedule": {"fingerprint": fp, "sealed": sealed},
             "notes": f"SIMULATED for testing analyze.py, knows {a.knows}"}
        json.dump(s, open(os.path.join(a.out, f"sim_{i:02d}.json"), "w"))
    print(f"wrote {a.sittings} simulated sittings to {a.out} (knows {a.knows})")


if __name__ == "__main__":
    main()
