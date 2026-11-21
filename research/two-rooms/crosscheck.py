#!/usr/bin/env python3
"""
A separate check of the main conclusions, written apart from two_rooms_sim.py
with a simpler heart of its own (slow drift, breathing, noise) and its own
analysis code, so a quirk of one heart model or one implementation can't carry
the result.

    python3 crosscheck.py

Checks: (1) two unlinked people on one breathing guide correlate strongly;
(2) the textbook correlation test calls a link most of the time; (3) the
swapped-partner and hidden-schedule tests keep false alarms near 5%.
"""
import numpy as np

FS, N = 4, 2400
rng = np.random.default_rng(7)


def simple_hearts(k, guided):
    t = np.arange(N) / FS
    drift = np.zeros((k, N))
    phi = np.exp(-1 / (FS * 45))
    d = rng.normal(0, 2, k)
    for i in range(N):  # a plain loop, unlike the main script's filter
        d = phi * d + rng.normal(0, 2 * np.sqrt(1 - phi ** 2), k)
        drift[:, i] = d
    if guided:
        breath = 5 * np.sin(2 * np.pi * 0.1 * t)[None, :]
    else:
        f = rng.uniform(0.18, 0.33, (k, 1))
        breath = 3 * np.sin(2 * np.pi * f * t[None, :] + rng.uniform(0, 2 * np.pi, (k, 1)))
    return 68 + drift + breath + rng.normal(0, 0.7, (k, N))


def corr_rows(a, b):
    a = a - a.mean(1, keepdims=True)
    b = b - b.mean(1, keepdims=True)
    return (a * b).sum(1) / np.sqrt((a * a).sum(1) * (b * b).sum(1))


def swapped_partner_p(x, y, perms=500):
    k = len(x)
    full = np.array([[np.corrcoef(x[i], y[j])[0, 1] for j in range(k)] for i in range(k)])
    obs = np.trace(full) / k
    centre = full.mean()
    count = 0
    for _ in range(perms):
        p = rng.permutation(k)
        count += abs(full[np.arange(k), p].mean() - centre) >= abs(obs - centre)
    return (1 + count) / (1 + perms)


def hidden_schedule_p(y, perms=500):
    k = len(y)
    means = np.array([[y[i, int((60 + 30 * j) * FS):int((90 + 30 * j) * FS)].mean() for j in range(18)]
                      for i in range(k)])
    labels = np.array([rng.permutation([1] * 9 + [0] * 9) for _ in range(k)])
    def score(lab):
        return sum(means[i][lab[i] == 1].mean() - means[i][lab[i] == 0].mean() for i in range(k))
    obs = score(labels)
    count = sum(abs(score(np.array([rng.permutation(l) for l in labels]))) >= abs(obs) for _ in range(perms))
    return (1 + count) / (1 + perms)


out = {}
x, y = simple_hearts(500, True), simple_hearts(500, True)
r = corr_rows(x, y)
out["guided_mean_r"] = float(r.mean())
x, y = simple_hearts(500, False), simple_hearts(500, False)
r = corr_rows(x, y)
tstat = r * np.sqrt((N - 2) / (1 - r * r))
out["textbook_test_false_alarms_apart"] = float(np.mean(np.abs(tstat) > 1.96))
fa1 = fa2 = 0
runs = 200
for _ in range(runs):
    x, y = simple_hearts(20, True), simple_hearts(20, True)
    fa1 += swapped_partner_p(x, y) < 0.05
    fa2 += hidden_schedule_p(y) < 0.05
out["swapped_partner_false_alarms_guided"] = fa1 / runs
out["hidden_schedule_false_alarms_guided"] = fa2 / runs
print(out)
