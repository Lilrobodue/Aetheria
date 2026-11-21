#!/usr/bin/env python3
"""Independent re-count of the main result in plain Python (strings, no numpy),
written separately from chance_test.py so the two can disagree if either is wrong."""
import json

def dr(n): return 0 if n == 0 else 1 + (n - 1) % 9
def pal(n): s = str(n); return len(s) > 1 and s == s[::-1]
def rep(n): s = str(n); return len(s) > 1 and len(set(s)) == 1
POW = {b ** k for b in range(2, 40) for k in range(2, 12) if b ** k <= 2000}

def score(a, b):
    heart = [963 + a * k for k in range(1, 10)]
    head = [heart[-1] + b * k for k in range(1, 10)]
    rh, rd = [dr(x) for x in heart], [dr(x) for x in head]
    cyc = lambda r: r[:3] == r[3:6] == r[6:] and sorted(r[:3]) == [3, 6, 9]
    st = [111, a, b]
    items = [
        len(set(rh)) == 1, len(set(rd)) == 1, cyc(rh), cyc(rd),
        any(st[i] == st[j] + st[k] for i, j, k in [(0, 1, 2), (1, 0, 2), (2, 0, 1)]),
        any(st[j] == m * st[i] for i in range(3) for j in range(3) if i != j for m in range(2, 10)),
        a in POW or b in POW,
        any(pal(x) or rep(x) for x in (a, b)),
        a % 111 == 0 or b % 111 == 0,
        dr(111) + dr(a) + dr(b) in (9, 15, 18, 27),
        pal(head[-1]), pal(heart[-1]),
        any(pal(x) or rep(x) for x in (heart[4], head[4])),
        any(pal(x) or rep(x) for x in (3 * heart[4], 3 * head[4])),
        heart[-1] % 432 == 0 or head[-1] % 432 == 0,
    ]
    return sum(items)

me = score(243, 354)
n = ge = 0
for a in range(100, 1000):
    for b in range(100, 1000):
        n += 1
        ge += score(a, b) >= me
mine = json.load(open("results.json"))["family_s"]["100-999"]
print("plain-Python: Aetheria scores", me, "|", ge, "of", n, "score at least that =", ge / n)
print("chance_test.py:", mine["aetheria_score"], "|", mine["count_scoring_at_least_aetheria"], "of", mine["members"])
assert me == mine["aetheria_score"] and ge == mine["count_scoring_at_least_aetheria"]
print("agree")
