#!/usr/bin/env python3
"""
Aetheria chance test. Runs the plan in PREREGISTRATION.md and writes
results.json. Every number in the write-up comes from this file.

    python3 chance_test.py            # writes results.json
    python3 chance_test.py --check    # also re-derives Aetheria's own values

Needs Python 3.9+ and numpy.
"""

import argparse
import itertools
import json
import math

import numpy as np

# -- The frequencies under test --------------------------------------------------

SOLFEGGIO = [174, 285, 396, 417, 528, 639, 741, 852, 963]
GUT_STEP = 111
AETHERIA = (243, 354)  # (HEART interval a, HEAD interval b)
PERFECT_GUT = [75 + 111 * k for k in range(9)]

# Lo Shu: position n sits in the cell labelled n.
LOSHU = [[4, 9, 2],
         [3, 5, 7],
         [8, 1, 6]]
LINES = ([row for row in LOSHU]
         + [[LOSHU[r][c] for r in range(3)] for c in range(3)]
         + [[LOSHU[i][i] for i in range(3)], [LOSHU[i][2 - i] for i in range(3)]])
LINE_IDX = np.array([[p - 1 for p in line] for line in LINES])  # 8 lines x 3 positions

K = np.arange(1, 10)


# -- Small number tools (numpy, element-wise) -------------------------------------

def digit_root(n):
    n = np.asarray(n)
    return np.where(n == 0, 0, 1 + (n - 1) % 9)


def reverse_digits(n):
    n = np.asarray(n, dtype=np.int64).copy()
    out = np.zeros_like(n)
    while np.any(n > 0):
        live = n > 0  # only numbers with digits left take another digit
        out = np.where(live, out * 10 + n % 10, out)
        n //= 10
    return out


def is_palindrome(n):
    n = np.asarray(n, dtype=np.int64)
    return (n >= 10) & (reverse_digits(n) == n)


def is_repdigit(n):
    n = np.asarray(n, dtype=np.int64)
    length = np.floor(np.log10(np.maximum(n, 1))).astype(np.int64) + 1
    ones = (10 ** length - 1) // 9
    return (n >= 10) & (n % ones == 0)


def perfect_powers(limit):
    out = set()
    for base in range(2, int(math.isqrt(limit)) + 1):
        p = base * base
        while p <= limit:
            out.add(p)
            p *= base
    return out


def line_sums(seq):
    """seq: (..., 9) values at positions 1..9. Returns (..., 8) Lo Shu line sums."""
    return seq[..., LINE_IDX].sum(axis=-1)


def perfect_magic(seq):
    s = line_sums(seq)
    return np.all(s == s[..., :1], axis=-1)


def cycles_369(dr):
    """Digit roots run through 3, 6 and 9 with period three (any order)."""
    periodic = np.all(dr[..., :6] == dr[..., 3:], axis=-1)
    first3 = np.sort(dr[..., :3], axis=-1)
    return periodic & np.all(first3 == np.array([3, 6, 9]), axis=-1)


def one_root(dr):
    return np.all(dr == dr[..., :1], axis=-1)


# -- Family S: the extension, intervals free -------------------------------------

def family_s(lo, hi):
    a, b = np.meshgrid(np.arange(lo, hi + 1), np.arange(lo, hi + 1), indexing="ij")
    a, b = a.ravel().astype(np.int64), b.ravel().astype(np.int64)
    heart = 963 + a[:, None] * K
    heart_end = heart[:, -1]
    head = heart_end[:, None] + b[:, None] * K
    return a, b, heart, head


def claims_s(a, b, heart, head):
    """Claims 1 to 11 for every member. Returns {claim: bool array}."""
    dr_heart, dr_head = digit_root(heart), digit_root(head)
    powers_of_3 = {3 ** k for k in range(1, 12)}
    centre = heart[:, 4]
    return {
        "1 HEART perfect magic square": perfect_magic(heart),
        "2 HEAD perfect magic square": perfect_magic(head),
        "3 any evenly spaced nine are a perfect magic square": perfect_magic(heart) & perfect_magic(head),
        "4 every HEART digit root is 9": np.all(dr_heart == 9, axis=1),
        "5 HEAD digit roots cycle 3,6,9 like GUT": np.all(dr_head == np.array([3, 6, 9] * 3), axis=1),
        "6 HEAD interval = GUT + HEART intervals": b == GUT_STEP + a,
        "7 interval digit roots sum to 15": (digit_root(GUT_STEP) + digit_root(a) + digit_root(b)) == 15,
        "8 HEART interval is a power of three": np.isin(a, list(powers_of_3)),
        "9 cube centre has digit root 9": digit_root(centre) == 9,
        "10 central axis digit roots 6,9,6": (digit_root(528) == 6) & (digit_root(centre) == 9)
                                             & (digit_root(head[:, 4]) == 6),
        "11 top frequency is a mirror number": is_palindrome(head[:, -1]),
    }


def catalogue_s(a, b, heart, head):
    """The fixed look-elsewhere catalogue. Returns {item: bool array}."""
    dr_heart, dr_head = digit_root(heart), digit_root(head)
    g = np.full_like(a, GUT_STEP)
    steps = [g, a, b]
    pp = perfect_powers(int(max(a.max(), b.max())))
    multiple = np.zeros(a.shape, dtype=bool)
    for x, y in itertools.permutations(range(3), 2):
        for k in range(2, 10):
            multiple |= steps[y] == k * steps[x]
    dr_sum = digit_root(g) + digit_root(a) + digit_root(b)
    heart_end, head_end = heart[:, -1], head[:, -1]
    centres = [heart[:, 4], head[:, 4]]
    consts = [3 * heart[:, 4], 3 * head[:, 4]]  # an evenly spaced square's line sum is 3 x its centre
    pal_or_rep = lambda n: is_palindrome(n) | is_repdigit(n)
    return {
        "1 HEART one digit root": one_root(dr_heart),
        "2 HEAD one digit root": one_root(dr_head),
        "3 HEART cycles 3,6,9": cycles_369(dr_heart),
        "4 HEAD cycles 3,6,9": cycles_369(dr_head),
        "5 one interval is the sum of the other two": (b == g + a) | (a == g + b) | (g == a + b),
        "6 one interval is a 2-9x multiple of another": multiple,
        "7 a or b is a perfect power": np.isin(a, list(pp)) | np.isin(b, list(pp)),
        "8 a or b is a palindrome or repdigit": pal_or_rep(a) | pal_or_rep(b),
        "9 a or b is a multiple of 111": (a % 111 == 0) | (b % 111 == 0),
        "10 interval digit roots sum to 9, 15, 18 or 27": np.isin(dr_sum, [9, 15, 18, 27]),
        "11 top frequency is a palindrome": is_palindrome(head_end),
        "12 end of HEART is a palindrome": is_palindrome(heart_end),
        "13 a regime centre is a palindrome or repdigit": pal_or_rep(centres[0]) | pal_or_rep(centres[1]),
        "14 a magic constant is a palindrome or repdigit": pal_or_rep(consts[0]) | pal_or_rep(consts[1]),
        "15 a regime end is a multiple of 432": (heart_end % 432 == 0) | (head_end % 432 == 0),
    }


def run_family_s(lo, hi):
    a, b, heart, head = family_s(lo, hi)
    me = np.flatnonzero((a == AETHERIA[0]) & (b == AETHERIA[1]))
    assert me.size == 1, "Aetheria must be in the range"
    me = int(me[0])
    claims = claims_s(a, b, heart, head)
    cat = catalogue_s(a, b, heart, head)
    score = np.sum(np.stack(list(cat.values())), axis=0)
    mine = int(score[me])
    hist = np.bincount(score, minlength=len(cat) + 1)
    return {
        "range": [lo, hi],
        "members": int(a.size),
        "claims": {name: {"aetheria": bool(v[me]), "share": float(v.mean()), "count": int(v.sum())}
                   for name, v in claims.items()},
        "catalogue": {name: {"aetheria": bool(v[me]), "share": float(v.mean())} for name, v in cat.items()},
        "aetheria_score": mine,
        "score_histogram": hist.tolist(),
        "share_scoring_at_least_aetheria": float((score >= mine).mean()),
        "count_scoring_at_least_aetheria": int((score >= mine).sum()),
        "top_scorers": [[int(a[i]), int(b[i]), int(score[i])] for i in np.argsort(-score, kind="stable")[:10]],
    }


# -- Family T: Solfeggio-like sets from three digits ------------------------------

def family_t():
    sets = {}
    for x, y, z in itertools.product(range(1, 8), repeat=3):
        seeds = [100 * x + 10 * y + z, 100 * z + 10 * x + y, 100 * y + 10 * z + x]
        values = sorted({s + 111 * j for s in seeds for j in range(3)})
        if len(values) == 9:
            sets[tuple(values)] = (x, y, z)
    return np.array(sorted(sets), dtype=np.int64)


def solfeggio_claims(sets):
    """Claims 12 and 13 for an (N, 9) array of ascending sets."""
    s = line_sums(sets)
    # How many of the 8 lines share the most common line sum.
    most = np.array([np.bincount(np.unique(row, return_inverse=True)[1]).max() for row in s])
    seven_plus = most >= 7
    exactly_seven = most == 7
    # The odd line out, where exactly seven agree, and its gap.
    gap = np.zeros(len(sets), dtype=np.int64)
    for i in np.flatnonzero(exactly_seven):
        vals, inv = np.unique(s[i], return_inverse=True)
        common = vals[np.bincount(inv).argmax()]
        gap[i] = abs(int(s[i][s[i] != common][0]) - int(common))
    perfect_seq = sets[:, -1:] - 111 * (8 - np.arange(9))
    off = sets - perfect_seq
    triad_constant = np.all(off[:, [0, 3, 6]] == off[:, [1, 4, 7]], axis=1) & \
                     np.all(off[:, [0, 3, 6]] == off[:, [2, 5, 8]], axis=1)
    mult9 = np.all(off % 9 == 0, axis=1)
    falling_to_zero = (off[:, 0] >= off[:, 3]) & (off[:, 3] >= off[:, 6]) & (off[:, 6] == 0)
    digit_369 = np.all(digit_root(sets) == np.array([3, 6, 9] * 3), axis=1)
    return {
        "12a at least 7 of 8 lines equal": seven_plus,
        "12b exactly 7 equal, odd line off by a multiple of 9": exactly_seven & (gap % 9 == 0) & (gap > 0),
        "12c exactly 7 equal, odd line off by exactly 81": exactly_seven & (gap == 81),
        "13a one offset per triad": triad_constant,
        "13b all offsets multiples of 9": mult9,
        "13c offsets fall to zero": falling_to_zero,
        "13 all three together": triad_constant & mult9 & falling_to_zero,
        "digit roots cycle 3,6,9 (the Solfeggio's own pattern)": digit_369,
    }


def run_family_t():
    sets = family_t()
    me = np.flatnonzero(np.all(sets == np.array(SOLFEGGIO), axis=1))
    assert me.size == 1, "the Solfeggio must be in Family T"
    me = int(me[0])
    claims = solfeggio_claims(sets)
    # Among the sets whose digit roots cycle 3,6,9, as the Solfeggio's do.
    cyc = claims["digit roots cycle 3,6,9 (the Solfeggio's own pattern)"]
    return {
        "members": int(len(sets)),
        "claims": {name: {"aetheria": bool(v[me]), "share": float(v.mean()), "count": int(v.sum()),
                          "share_among_369_sets": float(v[cyc].mean()) if cyc.any() else None}
                   for name, v in claims.items()},
        "members_with_369_roots": int(cyc.sum()),
    }


# -- Family R: nine random numbers ---------------------------------------------------

def run_family_r(n=1_000_000, seed=20261121, batch=200_000):
    rng = np.random.default_rng(seed)
    seven = mult = zero = done = 0
    while done < n:
        m = min(batch, n - done)
        draws = rng.integers(150, 1001, size=(m, 9))
        draws.sort(axis=1)
        while True:  # redraw any row with a repeated value, so all nine are distinct
            bad = np.flatnonzero(np.any(draws[:, 1:] == draws[:, :-1], axis=1))
            if bad.size == 0:
                break
            draws[bad] = np.sort(rng.integers(150, 1001, size=(bad.size, 9)), axis=1)
        s = line_sums(draws)
        srt = np.sort(s, axis=1)
        # at least 7 equal of 8 sorted values: the first 7 or the last 7 agree
        seven += int(np.sum((srt[:, 0] == srt[:, 6]) | (srt[:, 1] == srt[:, 7])))
        perfect_seq = draws[:, -1:] - 111 * (8 - np.arange(9))
        off = draws - perfect_seq
        trip = np.all(off[:, [0, 3, 6]] == off[:, [1, 4, 7]], axis=1) & \
               np.all(off[:, [0, 3, 6]] == off[:, [2, 5, 8]], axis=1)
        mult += int(np.sum(trip & np.all(off % 9 == 0, axis=1)))
        done += m
    return {"draws": n, "seed": seed, "range": [150, 1000],
            "share_7_of_8_lines_equal": seven / n, "count_7_of_8": seven,
            "share_offsets_one_per_triad_and_multiples_of_9": mult / n, "count_offsets": mult}


# -- Checks against the framework's own stated values --------------------------------

def check_tools():
    """The number tools on values whose answers are known, mixed lengths together."""
    n = np.array([6336, 3150, 12321, 7, 444, 1111, 4920, 252, 10, 99, 1000001])
    assert reverse_digits(n).tolist() == [6336, 513, 12321, 7, 444, 1111, 294, 252, 1, 99, 1000001]
    assert is_palindrome(n).tolist() == [True, False, True, False, True, True, False, True, False, True, True]
    assert is_repdigit(n).tolist() == [False, False, False, False, True, True, False, False, False, True, False]
    assert digit_root(np.array([0, 9, 18, 174, 6336, 2178])).tolist() == [0, 9, 9, 3, 9, 9]
    assert {243, 729, 256, 343, 900} <= perfect_powers(1000) and 354 not in perfect_powers(1000)
    d = np.array([[3, 6, 9] * 3, [6, 3, 9] * 3, [9] * 9, [3, 6, 9, 3, 6, 9, 3, 6, 3]])
    assert cycles_369(d).tolist() == [True, True, False, False]
    assert one_root(d).tolist() == [False, False, True, False]


def check_aetheria():
    check_tools()
    heart = np.array([963 + 243 * k for k in K])
    head = np.array([3150 + 354 * k for k in K])
    assert heart.tolist() == [1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150]
    assert head.tolist() == [3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336]
    assert set(line_sums(heart).tolist()) == {6534}
    assert set(line_sums(head).tolist()) == {14760}
    assert set(line_sums(np.array(PERFECT_GUT)).tolist()) == {1557}
    sol = line_sums(np.array(SOLFEGGIO)).tolist()
    assert sorted(sol) == [1584] + [1665] * 7, sol
    off = (np.array(SOLFEGGIO) - np.array(PERFECT_GUT)).tolist()
    assert off == [99, 99, 99, 9, 9, 9, 0, 0, 0], off
    assert digit_root(heart).tolist() == [9] * 9
    assert digit_root(head).tolist() == [3, 6, 9] * 3
    assert digit_root(np.array(SOLFEGGIO)).tolist() == [3, 6, 9] * 3
    return {"heart": heart.tolist(), "head": head.tolist(), "solfeggio_line_sums": sol,
            "solfeggio_offsets": off}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--out", default="results.json")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    results = {"aetheria_values": check_aetheria()}
    results["family_s"] = {f"{lo}-{hi}": run_family_s(lo, hi) for lo, hi in [(100, 999), (50, 1500), (100, 500)]}
    results["family_t"] = run_family_t()
    results["family_r"] = run_family_r()
    with open(args.out, "w") as fh:
        json.dump(results, fh, indent=1)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
