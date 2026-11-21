#!/usr/bin/env python3
"""
Tone test analysis, exactly as PREREGISTRATION.md lays it out.

    python3 -I analyze.py --check SESSIONS_DIR    # blind: quality of each session, no tone comparison
    python3 -I analyze.py SESSIONS_DIR            # the test, once 40 sessions are in

SESSIONS_DIR holds the files the Tone Test app saves (tone-test_*.json). The
test refuses to run before 40 sessions pass the quality rules; --force exists
only for testing this script on simulated sessions.
"""
import argparse
import glob
import hashlib
import json
import os
import sys

import numpy as np

FS = 4.0
CONTROLS = (2056, 2308)
AETHERIA = 2178
SESSIONS_NEEDED = 40
PERMS = 10_000
SEED = 20261121


# -- Reading a session ------------------------------------------------------------------

def load_session(path):
    s = json.load(open(path))
    problems = []
    if s.get("app") != "Tone Test, Big Banana Studios":
        problems.append("not a Tone Test file")
    if s.get("demo"):
        problems.append("demo mode")
    if not s.get("completed"):
        problems.append("stopped early")
    sch = s.get("schedule", {})
    order, control, salt = sch.get("order", []), sch.get("control"), sch.get("salt", "")
    expected = hashlib.sha256(f"tone-test-v1|{''.join(order)}|{control}|{salt}".encode()).hexdigest()
    if expected != sch.get("fingerprint"):
        problems.append("fingerprint does not match the order")
    if sorted(order) != ["A"] * 5 + ["C"] * 5 or control not in CONTROLS:
        problems.append("schedule is not 5 + 5 with a listed control")
    if s.get("tones", {}).get("aetheria_hz") != AETHERIA:
        problems.append("Aetheria tone is not 2178 Hz")
    return s, problems


def beat_times(beats):
    """Beat times from (notification time, interval) pairs. Intervals that
    arrive together end at the notification time, the last one latest."""
    t = np.array([b[0] for b in beats], dtype=float)
    rr = np.array([b[1] for b in beats], dtype=float) / 1000.0
    ends = np.empty_like(t)
    i = 0
    while i < len(t):
        j = i
        while j + 1 < len(t) and t[j + 1] == t[i]:
            j += 1
        group = rr[i:j + 1]
        ends[i:j + 1] = t[i] - (np.cumsum(group[::-1])[::-1] - group)
        i = j + 1
    return ends, rr


def heart_trace(s):
    """Heart rate (bpm) at 4 samples a second over the session, plus quality."""
    ends, rr = beat_times(s["beats"])
    med = np.array([np.median(rr[max(0, i - 5):i + 6]) for i in range(len(rr))])
    ok = (rr >= 0.3) & (rr <= 2.0) & (np.abs(rr - med) <= 0.2 * med)
    total = s["timing"]["total_s"]
    inside = (ends >= 0) & (ends <= total)
    grid = np.arange(0, total, 1 / FS)
    hr = np.interp(grid, ends[ok], 60.0 / rr[ok], left=np.nan, right=np.nan)
    span = ends[inside][-1] - ends[inside][0] if inside.sum() > 1 else 0.0
    coverage = float(rr[inside][1:].sum() / span) if span > 0 else 0.0
    return grid, hr, ends, rr, ok, {
        "beats": int(inside.sum()),
        "artefact_share": float(1 - ok[inside].mean()) if inside.any() else 1.0,
        "coverage": coverage,
        "strap_disconnects": len(s.get("strap_disconnects_s", [])),
        "audio_interruptions": sum(1 for e in s.get("audio_state_changes_s", []) if e[1] != "running"),
    }


def quality_ok(q):
    return (q["artefact_share"] <= 0.05 and q["coverage"] >= 0.95 and q["strap_disconnects"] == 0
            and q["audio_interruptions"] == 0)


# -- Per-block measures -----------------------------------------------------------------

def windows(s, lo, hi):
    tm = s["timing"]
    return [(tm["settle_s"] + j * tm["block_s"] + lo, tm["settle_s"] + j * tm["block_s"] + hi)
            for j in range(tm["blocks"])]


def block_hr(grid, hr, wins):
    return np.array([np.nanmean(hr[(grid >= a) & (grid < b)]) for a, b in wins])


def block_rmssd(ends, rr, ok, wins):
    out = []
    for a, b in wins:
        sel = ok & (ends >= a) & (ends < b)
        d = np.diff(rr[sel] * 1000)
        out.append(np.sqrt(np.mean(d ** 2)) if len(d) else np.nan)
    return np.array(out)


# -- The test ---------------------------------------------------------------------------

def perm_test(values, labels, rng, perms=PERMS):
    """values, labels: (K, 10). Score: sum over sessions of mean(A) - mean(C).
    Two-sided p from relabelling blocks within each session."""
    def score(lab):
        a = np.nansum(values * lab, -1) / np.sum(~np.isnan(values) * lab, -1)
        c = np.nansum(values * (1 - lab), -1) / np.sum(~np.isnan(values) * (1 - lab), -1)
        return (a - c).sum(-1)
    obs = score(labels)
    k = len(values)
    shuffled = np.take_along_axis(np.broadcast_to(labels, (perms, k, labels.shape[1])),
                                  np.argsort(rng.random((perms, k, labels.shape[1])), axis=2), axis=2)
    null = score(shuffled)
    p = (1 + np.sum(np.abs(null) >= abs(obs))) / (1 + perms)
    return float(obs), float(p)


def per_session_diff(values, labels):
    a = np.nansum(values * labels, 1) / np.sum(~np.isnan(values) * labels, 1)
    c = np.nansum(values * (1 - labels), 1) / np.sum(~np.isnan(values) * (1 - labels), 1)
    return a - c


def bootstrap_ci(diffs, rng, n=10_000):
    idx = rng.integers(0, len(diffs), size=(n, len(diffs)))
    means = diffs[idx].mean(axis=1)
    return [float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))]


def main():
    ap = argparse.ArgumentParser(description="Tone test analysis")
    ap.add_argument("sessions_dir")
    ap.add_argument("--check", action="store_true", help="quality only, no tone comparison")
    ap.add_argument("--force", action="store_true", help="testing only: run before 40 sessions")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    rows, kept = [], []
    for path in sorted(glob.glob(os.path.join(args.sessions_dir, "*.json"))):
        s, problems = load_session(path)
        row = {"file": os.path.basename(path), "participant": s.get("participant"), "date": s.get("date")}
        if not problems:
            grid, hr, ends, rr, ok, q = heart_trace(s)
            row.update(q)
            if not quality_ok(q):
                problems.append("technical failure (artefacts, gaps, strap or audio dropout)")
            else:
                kept.append((s, grid, hr, ends, rr, ok))
        row["included"] = not problems
        row["reasons"] = problems
        rows.append(row)

    print(f"{len(rows)} files, {len(kept)} pass the quality rules (the test needs {SESSIONS_NEEDED}).")
    for r in rows:
        extra = "" if "beats" not in r else (f"  beats {r['beats']}, artefacts {100 * r['artefact_share']:.1f}%,"
                                             f" coverage {100 * r['coverage']:.1f}%")
        print(f"  {r['file']}: {'kept' if r['included'] else 'left out: ' + '; '.join(r['reasons'])}{extra}")
    result = {"sessions": rows, "kept": len(kept)}
    if args.check:
        return
    if len(kept) < SESSIONS_NEEDED and not args.force:
        sys.exit(f"Not running the test: {len(kept)} of {SESSIONS_NEEDED} sessions so far. Use --check meanwhile.")

    rng = np.random.default_rng(SEED)
    labels = np.array([[1.0 if o == "A" else 0.0 for o in s["schedule"]["order"]] for s, *_ in kept])
    measures = {
        "heart_rate_during_tone": np.array([block_hr(g, h, windows(s, 5, 45)) for s, g, h, *_ in kept]),
        "rmssd_during_tone": np.array([block_rmssd(e, r, o, windows(s, 5, 45)) for s, g, h, e, r, o in kept]),
        "heart_rate_after_tone": np.array([block_hr(g, h, windows(s, 45, 60)) for s, g, h, *_ in kept]),
    }
    out = {}
    for name, vals in measures.items():
        total, p = perm_test(vals, labels, rng)
        diffs = per_session_diff(vals, labels)
        out[name] = {"sum_of_differences": total, "mean_difference": float(diffs.mean()),
                     "ci95": bootstrap_ci(diffs, rng), "p": p,
                     "role": "primary" if name == "heart_rate_during_tone" else "secondary"}
    prim = out["heart_rate_during_tone"]
    out["verdict"] = ("difference" if prim["p"] < 0.05 else "no difference detected")
    result["results"] = out
    result["forced_before_40"] = len(kept) < SESSIONS_NEEDED
    print(json.dumps(out, indent=1))
    if args.out:
        json.dump(result, open(args.out, "w"), indent=1)


if __name__ == "__main__":
    main()
