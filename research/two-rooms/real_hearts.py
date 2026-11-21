#!/usr/bin/env python3
"""
Two Rooms, real-heart check. Follows PREREG_REAL_HEARTS.md.

Reads Fantasia beat-annotation files (.ecg, WFDB format), pairs strangers as
real no-link pairs, reruns the five analyses, refits the simulated heart and
reruns the power table.

    python3 real_hearts.py DATA_DIR          # writes results_real.json

DATA_DIR holds the downloaded f1y01.ecg ... f2y05.ecg files. Needs numpy and
scipy (and two_rooms_sim.py beside it).
"""
import argparse
import glob
import json
import os
import struct

import numpy as np
from scipy import signal

import two_rooms_sim as sim

FS_ANN = 250.0      # Fantasia sampling rate, from the database description
NORMAL = 1          # WFDB code for a normal beat


# -- Reading WFDB annotation files ----------------------------------------------------

def read_annotations(path):
    """Beat sample numbers and codes from a WFDB (MIT format) annotation file.
    Each entry is a little-endian 16-bit word: the top 6 bits are the code, the
    low 10 bits the time since the last entry. Codes 59 to 63 are special."""
    data = open(path, "rb").read()
    pos, t = 0, 0
    samples, codes = [], []
    while pos + 1 < len(data):
        (word,) = struct.unpack_from("<H", data, pos)
        pos += 2
        code, val = word >> 10, word & 0x3FF
        if code == 0 and val == 0:
            break                                   # end of file
        if code == 59:                              # SKIP: a long time step follows
            hi, lo = struct.unpack_from("<HH", data, pos)
            pos += 4
            t += (hi << 16) | lo
            continue
        if code in (60, 61, 62):                    # NUM, SUB, CHN: no time step
            continue
        if code == 63:                              # AUX: a string of val bytes, padded to even
            pos += val + (val & 1)
            continue
        t += val
        samples.append(t)
        codes.append(code)
    return np.array(samples), np.array(codes)


# -- From beats to sessions -----------------------------------------------------------

def heart_rate_trace(samples, codes):
    """4-samples-a-second heart rate (bpm) from normal beats, with artefacts
    bridged, as the plan describes. Returns (trace, share of intervals dropped)."""
    t = samples[codes == NORMAL] / FS_ANN
    rr = np.diff(t)
    tm = t[1:]
    med = np.array([np.median(rr[max(0, i - 5):i + 6]) for i in range(len(rr))])
    ok = (rr >= 0.3) & (rr <= 2.0) & (np.abs(rr - med) <= 0.2 * med)
    grid = np.arange(np.ceil(tm[ok][0] * sim.FS), np.floor(tm[ok][-1] * sim.FS)) / sim.FS
    hr = np.interp(grid, tm[ok], 60.0 / rr[ok])
    return grid, hr, float(1 - ok.mean())


def sessions_from(grid, hr):
    """Skip the first 10 minutes, then back-to-back 10-minute sessions."""
    out = []
    start = grid[0] + 600.0
    while True:
        a = np.searchsorted(grid, start)
        if a + sim.N > len(hr):
            break
        out.append(hr[a:a + sim.N])
        start += sim.SECONDS
    return out


# -- The checks -----------------------------------------------------------------------

def stranger_pairs(people):
    """Session j of person p with session j of person q, for every p < q."""
    xs, ys = [], []
    names = sorted(people)
    for i, p in enumerate(names):
        for q in names[i + 1:]:
            for j in range(min(len(people[p]), len(people[q]))):
                xs.append(people[p][j])
                ys.append(people[q][j])
    return np.array(xs), np.array(ys)


def sound_false_alarms(people, rng, experiments=1000, k=20, perms=1000):
    names = sorted(people)
    all_sessions = [(p, s) for p in names for s in people[p]]
    a1 = a2 = 0
    for _ in range(experiments):
        # S1: k pairs of different people; each person's sessions drawn without reuse
        x, y = [], []
        for _ in range(k):
            p, q = rng.choice(len(names), 2, replace=False)
            x.append(people[names[p]][rng.integers(len(people[names[p]]))])
            y.append(people[names[q]][rng.integers(len(people[names[q]]))])
        a1 += sim.s1_swapped_partner(np.array(x), np.array(y), rng, perms) < 0.05
        # S2: k receiver sessions with random hidden schedules
        idx = rng.choice(len(all_sessions), k, replace=False)
        yk = np.array([all_sessions[i][1] for i in idx])
        lab = sim.schedules(rng, k)
        a2 += sim.s2_hidden_schedule(sim.period_means(yk, rng.normal(0, 1, k)), lab, rng, perms) < 0.05
    return {"experiments": experiments, "sessions_each": k,
            "S1_swapped_partner": a1 / experiments, "S2_hidden_schedule": a2 / experiments}


def spectrum_facts(sessions):
    y = np.array(sessions)
    f, p = signal.welch(y - y.mean(axis=1, keepdims=True), fs=sim.FS, nperseg=1024, axis=1)
    p = p.mean(axis=0)
    total = p[(f >= 0.003) & (f < 0.5)].sum()
    band = lambda lo, hi: float(p[(f >= lo) & (f < hi)].sum() / total)
    hf = (f > 0.15) & (f < 0.4)
    return {"sessions": len(sessions), "mean_hr": float(y.mean()),
            "sd_within_session": float(y.std(axis=1).mean()),
            "share_vlf": band(0.003, 0.04), "share_lf": band(0.04, 0.15), "share_hf": band(0.15, 0.4),
            "peak_hf_hz": float(f[hf][np.argmax(p[hf])])}


def real_power_s2(sessions, rng, ks, deltas, experiments=500, perms=1000):
    """S2 power on the real sessions, the shift added to their send periods."""
    out = {}
    pool = np.array(sessions)
    for k in ks:
        hits = {d: 0 for d in deltas}
        for _ in range(experiments):
            yk = pool[rng.choice(len(pool), k, replace=len(pool) < k)]
            lab = sim.schedules(rng, k)
            off = rng.normal(0, 1, k)
            base = sim.period_means(yk, off)
            ind = sim.period_means(sim.send_indicator(lab), off)
            for d in deltas:
                hits[d] += sim.s2_hidden_schedule(base + d * ind, lab, rng, perms) < 0.05
        out[str(k)] = {str(d): hits[d] / experiments for d in deltas}
    return out


def main():
    ap = argparse.ArgumentParser(description="Two Rooms real-heart check")
    ap.add_argument("data_dir")
    ap.add_argument("--out", default="results_real.json")
    ap.add_argument("--experiments", type=int, default=1000)
    args = ap.parse_args()
    rng = np.random.default_rng(20261121)
    people, info = {}, {}
    for path in sorted(glob.glob(os.path.join(args.data_dir, "*.ecg"))):
        name = os.path.basename(path)[:-4]
        samples, codes = read_annotations(path)
        grid, hr, dropped = heart_rate_trace(samples, codes)
        people[name] = sessions_from(grid, hr)
        info[name] = {"beats": int((codes == NORMAL).sum()), "other_annotations": int((codes != NORMAL).sum()),
                      "minutes": float((grid[-1] - grid[0]) / 60), "intervals_dropped": dropped,
                      "sessions": len(people[name]), "mean_hr": float(hr.mean())}
    res = {"records": info}
    sessions = [s for p in sorted(people) for s in people[p]]
    res["real_heart"] = spectrum_facts(sessions)
    x, y = stranger_pairs(people)
    r, h1 = sim.n1_correlation(x, y)
    _, h2 = sim.n2_best_lag(x, y)
    _, h3 = sim.n3_fixed_order(y)
    res["naive_false_alarms"] = {"pairs": int(len(x)), "N1_correlation": float(h1.mean()),
                                 "N2_best_lag": float(h2.mean()), "N3_fixed_order": float(h3.mean()),
                                 "mean_r": float(r.mean()), "sd_r": float(r.std())}
    res["sound_false_alarms"] = sound_false_alarms(people, rng, args.experiments)
    res["power_S2_real_sessions"] = real_power_s2(sessions, rng, [5, 10, 20, 40, 80], [0.25, 0.5, 1.0],
                                                  experiments=args.experiments // 2)
    with open(args.out, "w") as fh:
        json.dump(res, fh, indent=1)
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
