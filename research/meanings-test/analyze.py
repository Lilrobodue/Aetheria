#!/usr/bin/env python3
"""
Meanings test analysis, exactly as PREREGISTRATION.md lays it out.

    python3 -I analyze.py --check SITTINGS_DIR    # blind: which files count, no hits
    python3 -I analyze.py SITTINGS_DIR            # the test, once 54 sittings are in

SITTINGS_DIR holds the files the Meanings Test app saves. The test refuses to
run before 54 sittings count; --force exists only for testing this script on
simulated sittings. The check confirms each fingerprint against its sealed draw
but never prints the tone or whether the answer was right.
"""
import argparse
import base64
import glob
import hashlib
import json
import os
import sys

from scipy.stats import beta, binom

SITTINGS_NEEDED = 54
CHANCE = 0.25
LAYERS = {
    "GUT": [174, 285, 396, 417, 528, 639, 741, 852, 963],
    "HEART": [1206 + 243 * k for k in range(9)],
    "HEAD": [3504 + 354 * k for k in range(9)],
}
MINUTES = {"GUT": 45, "HEART": 30, "HEAD": 20}
THIRDS = {"low": (1, 2, 3), "middle": (4, 5, 6), "high": (7, 8, 9)}


def layer_of(hz):
    return next((name for name, tones in LAYERS.items() if hz in tones), None)


def position(hz):
    return LAYERS[layer_of(hz)].index(hz) + 1


def unseal(s):
    try:
        return json.loads(base64.b64decode(s.get("schedule", {}).get("sealed", "")).decode())
    except Exception:
        return None


def load_sitting(path):
    s = json.load(open(path))
    problems = []
    if s.get("app") != "Meanings Test, Big Banana Studios":
        problems.append("not a Meanings Test file")
    if s.get("demo"):
        problems.append("demo mode")
    if s.get("interrupted"):
        problems.append("interrupted")
    elif not s.get("completed") or not s.get("answer"):
        problems.append("stopped early or not answered")
    if any(e[1] != "running" for e in s.get("audio_state_changes_s", [])):
        problems.append("audio interruption")
    draw = unseal(s)
    if draw is None:
        problems.append("sealed draw unreadable")
        return s, None, problems
    hz, options, salt = draw.get("hz"), draw.get("options", []), draw.get("salt")
    expected = hashlib.sha256(f"meanings-test-v1|{hz}|{','.join(str(o) for o in options)}|{salt}".encode()).hexdigest()
    if expected != s.get("schedule", {}).get("fingerprint"):
        problems.append("fingerprint does not match the sealed draw")
    layer = layer_of(hz)
    if (layer is None or len(set(options)) != 4 or hz not in options
            or any(layer_of(o) != layer for o in options)):
        problems.append("draw is not one tone and three others from its layer")
    elif s.get("minutes") != MINUTES[layer]:
        problems.append("listening time is not the layer's protocol length")
    return s, draw, problems


def height_only(draw, height):
    """Expected hits (0 to 1) of a guess that uses only the listener's own
    low / middle / high answer, as the plan defines it."""
    fits = [o for o in draw["options"] if position(o) in THIRDS.get(height, ())]
    if not fits:
        return 1 / len(draw["options"])
    return (1 / len(fits)) if draw["hz"] in fits else 0.0


def clopper_pearson(k, n, level=0.95):
    a = (1 - level) / 2
    lo = 0.0 if k == 0 else float(beta.ppf(a, k, n - k + 1))
    hi = 1.0 if k == n else float(beta.ppf(1 - a, k + 1, n - k))
    return [lo, hi]


def summary(rows):
    n = len(rows)
    k = sum(r["hit"] for r in rows)
    return {"sittings": n, "hits": k, "hit_rate": k / n if n else None,
            "ci95": clopper_pearson(k, n) if n else None,
            "p_one_sided": float(binom.sf(k - 1, n, CHANCE)) if n else None}


def main():
    ap = argparse.ArgumentParser(description="Meanings test analysis")
    ap.add_argument("sittings_dir")
    ap.add_argument("--check", action="store_true", help="which files count; no hits")
    ap.add_argument("--force", action="store_true", help="testing only: run before 54 sittings")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    listing, counted = [], []
    for path in sorted(glob.glob(os.path.join(args.sittings_dir, "*.json"))):
        s, draw, problems = load_sitting(path)
        listing.append({"file": os.path.basename(path), "participant": s.get("participant"),
                        "date": s.get("date"), "layer": s.get("layer"), "counted": not problems,
                        "reasons": problems})
        if not problems:
            chosen = draw["options"][s["answer"]["choice"]]
            counted.append({"participant": s.get("participant"), "layer": layer_of(draw["hz"]),
                            "hit": chosen == draw["hz"], "recognised": s["answer"].get("recognised"),
                            "height_only": height_only(draw, s["answer"].get("height"))})

    print(f"{len(listing)} files, {len(counted)} count (the test needs {SITTINGS_NEEDED}).")
    for r in listing:
        print(f"  {r['file']}: {r['layer'] or '?'}, {'counts' if r['counted'] else 'left out: ' + '; '.join(r['reasons'])}")
    result = {"files": listing, "counted": len(counted)}
    if args.check:
        return
    if len(counted) < SITTINGS_NEEDED and not args.force:
        sys.exit(f"Not running the test: {len(counted)} of {SITTINGS_NEEDED} sittings so far. Use --check meanwhile.")

    primary = summary(counted)
    primary["verdict"] = "above chance" if primary["p_one_sided"] < 0.05 else "not above chance"
    out = {
        "primary": primary,
        "height_only_expected_hits": sum(r["height_only"] for r in counted),
        "without_recognised_yes": summary([r for r in counted if r["recognised"] != "yes"]),
        "without_recognised_yes_or_not_sure": summary([r for r in counted if r["recognised"] == "no"]),
        "by_layer": {L: summary([r for r in counted if r["layer"] == L]) for L in LAYERS},
        "by_participant": {p: summary([r for r in counted if r["participant"] == p])
                           for p in sorted({r["participant"] for r in counted})},
    }
    result["results"] = out
    result["forced_before_54"] = len(counted) < SITTINGS_NEEDED
    print(json.dumps(out, indent=1))
    if args.out:
        json.dump(result, open(args.out, "w"), indent=1)


if __name__ == "__main__":
    main()
