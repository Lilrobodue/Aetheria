#!/usr/bin/env python3
"""
Two Rooms no-link simulation. Runs the plan in PREREGISTRATION.md and writes
results.json. No real data and no real link: every session here is two
independent simulated hearts.

    python3 two_rooms_sim.py            # full run, writes results.json
    python3 two_rooms_sim.py --quick    # small run, for checking the code

Needs Python 3.9+, numpy and scipy.
"""

import argparse
import json
import math

import numpy as np
from scipy import signal, stats

FS = 4.0                      # samples per second
SECONDS = 600                 # 10-minute sessions
N = int(FS * SECONDS)
T = np.arange(N) / FS
SCENARIOS = ["apart", "same_start", "guided_breathing", "same_soundtrack"]

# Design B: 60 s to settle, then 18 periods of 30 s, 9 send and 9 rest.
SETTLE_S, PERIOD_S, PERIODS = 60, 30, 18


# -- The simulated heart -------------------------------------------------------------

def ar1(rng, k, tau_s, sd):
    """k traces of a random drift with memory tau_s seconds and size sd."""
    phi = math.exp(-1.0 / (FS * tau_s))
    burn = int(6 * tau_s * FS)  # run in first, so the trace starts in its steady state
    e = rng.normal(0.0, sd * math.sqrt(1 - phi * phi), size=(k, N + burn))
    return signal.lfilter([1.0], [1.0, -phi], e, axis=1)[:, burn:]


def mayer(rng, k, sd, f0=0.1, r=0.995):
    """k traces of a random oscillation centred on f0 Hz, size sd."""
    w = 2 * math.pi * f0 / FS
    a = [1.0, -2 * r * math.cos(w), r * r]
    burn = 2000
    e = rng.normal(0.0, 1.0, size=(k, N + burn))
    x = signal.lfilter([1.0], a, e, axis=1)[:, burn:]
    return x / x.std(axis=1, keepdims=True) * sd


def soundtrack_dips(rng, k, size=1.5, every_s=60, tau=2.5):
    """A brief dip after each change of tone, same moments for everyone."""
    out = np.zeros((k, N))
    for t0 in np.arange(every_s, SECONDS, every_s):
        lat = t0 + rng.normal(0.0, 0.5, size=(k, 1))
        u = np.clip((T[None, :] - lat) / tau, 0.0, None)
        out -= size * u * np.exp(1.0 - u)  # peaks at tau seconds, gone by about 4 tau
    return out


def hearts(rng, k, scenario, drift_sd=2.0, mayer_sd=1.5, breath_amp=3.0):
    """k simulated heart-rate traces (bpm) for one side of k sessions. The
    sizes default to the pre-registered textbook values; real_hearts.py
    passes sizes fitted to real recordings."""
    level = rng.normal(70.0, 8.0, size=(k, 1))
    settle_size = np.clip(rng.normal(4.0, 1.5, size=(k, 1)), 0.0, None)
    if scenario == "apart":  # each person started sitting at their own time
        onset = -rng.uniform(0.0, SECONDS, size=(k, 1))
    else:
        onset = np.zeros((k, 1))
    settle = -settle_size * (1.0 - np.exp(-(T[None, :] - onset) / 90.0))
    drift = ar1(rng, k, 60.0, drift_sd)
    mw = mayer(rng, k, mayer_sd)
    if scenario == "guided_breathing":  # one guide, 6 breaths a minute, same start
        lag = rng.normal(0.0, 0.5, size=(k, 1))
        breath = 6.0 * np.sin(2 * math.pi * 0.1 * (T[None, :] - lag))
    else:
        rate = np.clip(rng.normal(0.25, 0.04, size=(k, 1)), 0.15, 0.40)
        wobble = ar1(rng, k, 20.0, 0.02)
        phase = 2 * math.pi * np.cumsum(rate + wobble, axis=1) / FS + rng.uniform(0, 2 * math.pi, size=(k, 1))
        breath = breath_amp * np.sin(phase)
    dips = soundtrack_dips(rng, k) if scenario == "same_soundtrack" else 0.0
    noise = rng.normal(0.0, 0.5, size=(k, N))
    return level + settle + drift + mw + breath + dips + noise


# -- Naive analyses ------------------------------------------------------------------

def zscore(x):
    return (x - x.mean(axis=1, keepdims=True)) / x.std(axis=1, keepdims=True)


def n1_correlation(x, y):
    r = np.mean(zscore(x) * zscore(y), axis=1)
    t = r * np.sqrt((N - 2) / (1 - r * r))
    p = 2 * stats.t.sf(np.abs(t), N - 2)
    return r, p < 0.05


def n2_best_lag(x, y, max_lag_s=10):
    zx, zy = zscore(x), zscore(y)
    best = np.zeros(len(x))
    for lag in range(-int(max_lag_s * FS), int(max_lag_s * FS) + 1):
        if lag >= 0:
            c = np.mean(zx[:, lag:] * zy[:, :N - lag], axis=1)
        else:
            c = np.mean(zx[:, :N + lag] * zy[:, -lag:], axis=1)
        best = np.maximum(best, np.abs(c))
    return best, best > 1.96 / math.sqrt(N)


def n3_fixed_order(y):
    a = int(SETTLE_S * FS)
    mid = a + (N - a) // 2
    rest, send = y[:, a:mid], y[:, mid:]
    t, p = stats.ttest_ind(send, rest, axis=1, equal_var=False)
    return send.mean(axis=1) - rest.mean(axis=1), p < 0.05


# -- Sound analyses ------------------------------------------------------------------

def s1_swapped_partner(x, y, rng, perms=1000):
    """x, y: (K, N) sender and receiver traces of K sessions. Two-sided
    permutation p-value of the mean true-pair correlation against random
    re-pairings of receivers with senders."""
    k = len(x)
    c = zscore(x) @ zscore(y).T / N  # c[i, j] = corr(sender i, receiver j)
    obs = np.mean(np.diag(c))
    idx = np.argsort(rng.random((perms, k)), axis=1)
    null = c[np.arange(k)[None, :], idx].mean(axis=1)
    centre = c.mean()  # what a random pairing averages
    return (1 + np.sum(np.abs(null - centre) >= abs(obs - centre))) / (1 + perms)


def schedules(rng, k):
    """Balanced random send(1)/rest(0) labels for k sessions."""
    lab = np.tile(np.r_[np.ones(PERIODS // 2), np.zeros(PERIODS // 2)], (k, 1))
    return np.take_along_axis(lab, np.argsort(rng.random((k, PERIODS)), axis=1), axis=1)


def period_means(y, offset_s):
    """Mean of each receiver trace over the 18 periods, with the period
    boundaries read off the sender's clock, offset_s seconds out."""
    k = len(y)
    starts = SETTLE_S + PERIOD_S * np.arange(PERIODS)[None, :] + np.asarray(offset_s)[:, None]
    a = np.clip(np.round(starts * FS).astype(int), 0, N)
    b = np.clip(np.round((starts + PERIOD_S) * FS).astype(int), 0, N)
    cs = np.concatenate([np.zeros((k, 1)), np.cumsum(y, axis=1)], axis=1)
    rows = np.arange(k)[:, None]
    return (cs[rows, b] - cs[rows, a]) / (b - a)


def send_indicator(labels):
    """(k, N) array: 1 while the sender is truly sending."""
    k = len(labels)
    ind = np.zeros((k, N))
    for j in range(PERIODS):
        a = int((SETTLE_S + j * PERIOD_S) * FS)
        ind[:, a:a + int(PERIOD_S * FS)] = labels[:, j:j + 1]
    return ind


def s2_hidden_schedule(means, labels, rng, perms=1000):
    """means, labels: (K, 18). Two-sided permutation p-value of the summed
    send-minus-rest difference, relabelling periods within each session."""
    def score(lab):
        send = (means * lab).sum(axis=-1) / lab.sum(axis=-1)
        rest = (means * (1 - lab)).sum(axis=-1) / (1 - lab).sum(axis=-1)
        return (send - rest).sum(axis=-1)
    obs = score(labels)
    k = len(means)
    shuffled = np.take_along_axis(np.broadcast_to(labels, (perms, k, PERIODS)),
                                  np.argsort(rng.random((perms, k, PERIODS)), axis=2), axis=2)
    null = score(shuffled)
    return (1 + np.sum(np.abs(null) >= abs(obs))) / (1 + perms)


# -- Runs ----------------------------------------------------------------------------

def false_alarms_naive(rng, sessions, chunk=500):
    out = {}
    for sc in SCENARIOS:
        hits = np.zeros(3)
        rs = []
        done = 0
        while done < sessions:
            k = min(chunk, sessions - done)
            x, y = hearts(rng, k, sc), hearts(rng, k, sc)
            r, h1 = n1_correlation(x, y)
            _, h2 = n2_best_lag(x, y)
            _, h3 = n3_fixed_order(y)
            hits += [h1.sum(), h2.sum(), h3.sum()]
            rs.append(r)
            done += k
        rs = np.concatenate(rs)
        out[sc] = {"sessions": sessions,
                   "N1_correlation": hits[0] / sessions,
                   "N2_best_lag": hits[1] / sessions,
                   "N3_fixed_order": hits[2] / sessions,
                   "mean_r": float(rs.mean()), "sd_r": float(rs.std()),
                   "share_abs_r_over_0.2": float(np.mean(np.abs(rs) > 0.2))}
    return out


def false_alarms_sound(rng, experiments, k=20, perms=1000):
    out = {}
    for sc in SCENARIOS:
        a1 = a2 = 0
        for _ in range(experiments):
            x, y = hearts(rng, k, sc), hearts(rng, k, sc)
            a1 += s1_swapped_partner(x, y, rng, perms) < 0.05
            lab = schedules(rng, k)
            means = period_means(y, rng.normal(0.0, 1.0, size=k))
            a2 += s2_hidden_schedule(means, lab, rng, perms) < 0.05
        out[sc] = {"experiments": experiments, "sessions_each": k,
                   "S1_swapped_partner": a1 / experiments, "S2_hidden_schedule": a2 / experiments}
    return out


def power_s2(rng, experiments, ks, deltas, perms=1000, scenario="guided_breathing", sizes=None):
    out = {}
    for k in ks:
        hits = {d: 0 for d in deltas}
        for _ in range(experiments):
            y = hearts(rng, k, scenario, **(sizes or {}))
            lab = schedules(rng, k)
            offset = rng.normal(0.0, 1.0, size=k)
            base = period_means(y, offset)
            ind = period_means(send_indicator(lab), offset)  # share of each analysed period truly sent
            for d in deltas:
                hits[d] += s2_hidden_schedule(base + d * ind, lab, rng, perms) < 0.05
        out[str(k)] = {str(d): hits[d] / experiments for d in deltas}
    return {"scenario": scenario, "experiments": experiments, "power": out}


def power_s1(rng, experiments, ks, couplings, perms=1000, scenario="same_start"):
    out = {}
    for k in ks:
        hits = {c: 0 for c in couplings}
        for _ in range(experiments):
            x, own = hearts(rng, k, scenario), hearts(rng, k, scenario)
            for c in couplings:
                y = own + c * (x - x.mean(axis=1, keepdims=True))
                hits[c] += s1_swapped_partner(x, y, rng, perms) < 0.05
        out[str(k)] = {str(c): hits[c] / experiments for c in couplings}
    return {"scenario": scenario, "experiments": experiments, "power": out}


def describe_heart(rng, k=2000):
    """Plain facts about the simulated heart, to check it looks like a heart."""
    y = hearts(rng, k, "apart")
    f, p = signal.welch(y - y.mean(axis=1, keepdims=True), fs=FS, nperseg=1024, axis=1)
    p = p.mean(axis=0)
    band = lambda lo, hi: float(p[(f >= lo) & (f < hi)].sum() / p[(f >= 0.003) & (f < 0.5)].sum())
    return {"mean_hr": float(y.mean()), "sd_within_session": float(y.std(axis=1).mean()),
            "peak_lf_hz": float(f[(f > 0.04) & (f < 0.15)][np.argmax(p[(f > 0.04) & (f < 0.15)])]),
            "peak_hf_hz": float(f[(f > 0.15) & (f < 0.4)][np.argmax(p[(f > 0.15) & (f < 0.4)])]),
            "share_vlf": band(0.003, 0.04), "share_lf": band(0.04, 0.15), "share_hf": band(0.15, 0.4)}


def main():
    ap = argparse.ArgumentParser(description="Two Rooms no-link simulation")
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--out", default="results.json")
    args = ap.parse_args()
    rng = np.random.default_rng(20261121)
    q = args.quick
    res = {"settings": {"fs": FS, "seconds": SECONDS, "seed": 20261121, "quick": q}}
    res["heart"] = describe_heart(rng, 200 if q else 2000)
    res["naive_false_alarms"] = false_alarms_naive(rng, 200 if q else 2000)
    res["sound_false_alarms"] = false_alarms_sound(rng, 20 if q else 1000)
    res["power_S2"] = power_s2(rng, 20 if q else 500, [5, 10, 20, 40, 80], [0.25, 0.5, 1.0])
    res["power_S1"] = power_s1(rng, 20 if q else 500, [10, 20, 40], [0.05, 0.1, 0.2])
    with open(args.out, "w") as fh:
        json.dump(res, fh, indent=1)
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
