#!/usr/bin/env python3
"""
Tone test analysis, exactly as PREREGISTRATION.md (amendment 1) lays it out:
30-minute sessions, one hidden tone each.

    python3 -I analyze.py --check SESSIONS_DIR    # blind: quality of each session, no tone comparison
    python3 -I analyze.py SESSIONS_DIR            # the test, once 80 sessions are in

SESSIONS_DIR holds the files the Tone Test app (version 2) saves. The test
refuses to run before 80 sessions (amendment 2) pass the quality rules; --force exists only
for testing this script on simulated sessions. The check never opens the
sealed pick; it only confirms the fingerprint matches it.
"""
import argparse
import base64
import glob
import hashlib
import json
import os
import sys

import numpy as np

FS = 4.0
CONTROLS = (2056, 2308)
AETHERIA = 2178
SESSIONS_NEEDED = 80          # amendment 2
PERMS = 10_000
SEED = 20261121
BASE = (60, 300)        # silence minutes 1-5, session seconds
LATE = (900, 2100)      # tone minutes 10-30
WHOLE = (300, 2100)     # all 30 tone minutes


# -- Reading a session ------------------------------------------------------------------

def unseal(s):
    sch = s.get("schedule", {})
    try:
        pick = json.loads(base64.b64decode(sch.get("sealed", "")).decode())
    except Exception:
        return None
    return pick


def load_session(path):
    s = json.load(open(path))
    problems = []
    if s.get("app") != "Tone Test, Big Banana Studios":
        problems.append("not a Tone Test file")
    if not str(s.get("app_version", "")).startswith("2."):
        problems.append("not from version 2 of the app (amendment 1)")
    if s.get("demo"):
        problems.append("demo mode")
    if not s.get("completed"):
        problems.append("stopped early")
    pick = unseal(s)
    if pick is None:
        problems.append("sealed pick unreadable")
    else:
        expected = hashlib.sha256(f"tone-test-v2|{pick.get('tone')}|{pick.get('control')}|{pick.get('salt')}".encode()).hexdigest()
        if expected != s.get("schedule", {}).get("fingerprint"):
            problems.append("fingerprint does not match the sealed pick")
        if pick.get("tone") not in ("A", "C") or pick.get("control") not in CONTROLS:
            problems.append("pick is not A or C with a listed control")
    if s.get("tones", {}).get("aetheria_hz") != AETHERIA:
        problems.append("Aetheria tone is not 2178 Hz")
    tm = s.get("timing", {})
    if (tm.get("silence_s"), tm.get("tone_s")) != (300, 1800):
        problems.append("timing is not 5 + 30 minutes")
    return s, pick, problems


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


# -- Per-session measures -----------------------------------------------------------------

def mean_hr(grid, hr, win):
    return float(np.nanmean(hr[(grid >= win[0]) & (grid < win[1])]))


def rmssd(ends, rr, ok, win):
    sel = ok & (ends >= win[0]) & (ends < win[1])
    d = np.diff(rr[sel] * 1000)
    return float(np.sqrt(np.mean(d ** 2))) if len(d) else float("nan")


# -- The test ---------------------------------------------------------------------------

def perm_test(values, is_a, groups, rng, perms=PERMS):
    """Two-sided permutation test of mean(A) - mean(C), relabelling sessions
    within each participant (keeping each one's numbers of A and C)."""
    def stat(L):
        return (values * L).sum(-1) / L.sum(-1) - (values * ~L).sum(-1) / (~L).sum(-1)
    obs = stat(is_a)
    shuffled = np.broadcast_to(is_a, (perms, len(is_a))).copy()
    for g in np.unique(groups):
        idx = np.flatnonzero(groups == g)
        order = np.argsort(rng.random((perms, len(idx))), axis=1)
        shuffled[:, idx] = is_a[idx][order]
    null = stat(shuffled)
    p = (1 + np.sum(np.abs(null) >= abs(obs))) / (1 + perms)
    return float(obs), float(p)


def bootstrap_ci(values, is_a, rng, n=10_000):
    a, c = values[is_a], values[~is_a]
    da = a[rng.integers(0, len(a), size=(n, len(a)))].mean(1)
    dc = c[rng.integers(0, len(c), size=(n, len(c)))].mean(1)
    d = da - dc
    return [float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))]


def main():
    ap = argparse.ArgumentParser(description="Tone test analysis (amendment 1)")
    ap.add_argument("sessions_dir")
    ap.add_argument("--check", action="store_true", help="quality only, no tone comparison")
    ap.add_argument("--force", action="store_true", help="testing only: run before 80 sessions")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    rows, kept = [], []
    for path in sorted(glob.glob(os.path.join(args.sessions_dir, "*.json"))):
        s, pick, problems = load_session(path)
        row = {"file": os.path.basename(path), "participant": s.get("participant"), "date": s.get("date")}
        if not problems:
            grid, hr, ends, rr, ok, q = heart_trace(s)
            row.update(q)
            if not quality_ok(q):
                problems.append("technical failure (artefacts, gaps, strap or audio dropout)")
            else:
                kept.append((s, pick, grid, hr, ends, rr, ok))
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
    is_a = np.array([pick["tone"] == "A" for _, pick, *_ in kept])
    groups = np.array([s.get("participant") for s, *_ in kept])
    if is_a.all() or not is_a.any():
        sys.exit("All kept sessions used the same tone; the test can't run.")
    measures = {
        "heart_rate_change": np.array([mean_hr(g, h, LATE) - mean_hr(g, h, BASE) for _, _, g, h, *_ in kept]),
        "rmssd_change": np.array([rmssd(e, r, o, LATE) - rmssd(e, r, o, BASE) for *_, e, r, o in kept]),
        "heart_rate_change_whole_tone": np.array([mean_hr(g, h, WHOLE) - mean_hr(g, h, BASE)
                                                  for _, _, g, h, *_ in kept]),
    }
    out = {"sessions_aetheria": int(is_a.sum()), "sessions_control": int((~is_a).sum())}
    for name, vals in measures.items():
        diff, p = perm_test(vals, is_a, groups, rng)
        out[name] = {"aetheria_minus_control": diff, "ci95": bootstrap_ci(vals, is_a, rng), "p": p,
                     "mean_aetheria": float(vals[is_a].mean()), "mean_control": float(vals[~is_a].mean()),
                     "role": "primary" if name == "heart_rate_change" else "secondary"}
    out["verdict"] = "difference" if out["heart_rate_change"]["p"] < 0.05 else "no difference detected"
    result["results"] = out
    result["forced_early"] = len(kept) < SESSIONS_NEEDED
    print(json.dumps(out, indent=1))
    if args.out:
        json.dump(result, open(args.out, "w"), indent=1)


if __name__ == "__main__":
    main()
