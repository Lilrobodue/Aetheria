#!/usr/bin/env python3
"""
Exploratory follow-ups, NOT pre-registered. Written after seeing results.json,
to help read it. Nothing here changes a pre-registered verdict.

    python3 exploratory.py      # writes exploratory.json
"""
import json
import numpy as np
from chance_test import family_s, catalogue_s, claims_s, digit_root

out = {}
a, b, heart, head = family_s(100, 999)
cat = catalogue_s(a, b, heart, head)
names = list(cat)
score = np.sum(np.stack([cat[n] for n in names]), axis=0)

# 1. Suppose 243 was chosen on purpose (as 3^5). How unusual is 354 then?
sel = a == 243
out["a_fixed_243"] = {
    "members": int(sel.sum()),
    "aetheria_score": int(score[(a == 243) & (b == 354)][0]),
    "share_b_scoring_at_least_6": float((score[sel] >= 6).mean()),
    "count": int((score[sel] >= 6).sum()),
    "b_values_scoring_at_least_6": b[sel & (score >= 6)].tolist(),
}

# 2. What the highest scorers would have had to celebrate.
def patterns(i):
    return [n for n in names if cat[n][i]]
best = np.argsort(-score, kind="stable")[:5]
out["top_scorers"] = [{"a": int(a[i]), "b": int(b[i]), "score": int(score[i]),
                       "heart": heart[i].tolist(), "head": head[i].tolist(), "patterns": patterns(i)}
                      for i in best]
me = int(np.flatnonzero((a == 243) & (b == 354))[0])
out["aetheria_patterns"] = patterns(me)

# 3. Joe's answer (21 Nov 2026): 354 was made by adding the first two intervals,
#    so HEAD = 111 + HEART by design. Rescore with that rule built in: only the
#    HEART interval a is free, and b = 111 + a.
from chance_test import K
ra = np.arange(100, 1000, dtype=np.int64)
rb = ra + 111
rheart = 963 + ra[:, None] * K
rhead = rheart[:, -1][:, None] + rb[:, None] * K
rcat = catalogue_s(ra, rb, rheart, rhead)
rclaims = claims_s(ra, rb, rheart, rhead)
rscore = np.sum(np.stack([rcat[n] for n in names]), axis=0)
rme = int(np.flatnonzero(ra == 243)[0])
mult9 = ra % 9 == 0  # HEART interval a multiple of 9, as 243 is
out["rule_head_is_gut_plus_heart"] = {
    "members": int(ra.size),
    "aetheria_score": int(rscore[rme]),
    "share_scoring_at_least_aetheria": float((rscore >= rscore[rme]).mean()),
    "a_values_scoring_at_least_aetheria": ra[rscore >= rscore[rme]].tolist(),
    "claims": {k: {"share": float(v.mean()), "count": int(v.sum()),
                   "share_when_a_is_multiple_of_9": float(v[mult9].mean())}
               for k, v in rclaims.items()},
    "palindromic_tops_when_a_is_multiple_of_9": [[int(x), int(t)] for x, t in
        zip(ra[mult9 & rclaims["11 top frequency is a mirror number"]],
            rhead[mult9 & rclaims["11 top frequency is a mirror number"], -1])],
}

# 4. Joe's second answer (21 Nov 2026): 243 is the Solfeggio's own gap between
#    its first two triads (417 - 174 = 528 - 285 = 639 - 396 = 243), found by
#    reading the Solfeggio on a calculator keypad, whose columns are 1-4-7,
#    2-5-8 and 3-6-9.
from chance_test import family_t, SOLFEGGIO
columns = [{1, 4, 7}, {2, 5, 8}, {3, 6, 9}]
tsets = family_t()
triad_shaped = np.all(tsets[:, [1, 2, 4, 5, 7, 8]] - tsets[:, [0, 1, 3, 4, 6, 7]] == 111, axis=1)
first_gap = tsets[:, 3] - tsets[:, 0]
powers_of_3 = [3 ** k for k in range(1, 9)]
out["heart_interval_from_solfeggio"] = {
    "triad_gaps": [SOLFEGGIO[i + 3] - SOLFEGGIO[i] for i in range(6)],
    "each_solfeggio_number_is_one_keypad_column": all(set(map(int, str(n))) in columns for n in SOLFEGGIO),
    "keypad_column_sums": [sum(c) for c in columns],
    # A gap between rotations xyz -> zxy is 9 x (11z - 10x - y), so always a multiple of 9.
    "rotation_gap_174_to_417": "9 x (11*4 - 10*1 - 7) = 9 x 27 = 243",
    "triad_shaped_sets_in_family_t": int(triad_shaped.sum()),
    "their_first_gaps": sorted(set(first_gap[triad_shaped].tolist())),
    "first_gap_multiple_of_9": int((first_gap[triad_shaped] % 9 == 0).sum()),
    "first_gap_power_of_3": int(np.isin(first_gap[triad_shaped], powers_of_3).sum()),
}

# 5. Joe's third answer (21 Nov 2026): he stopped HEAD at 6336 because it is a
#    mirror number. So the palindrome is design; the coincidence is that the
#    first mirror number in HEART and HEAD falls exactly on HEAD's ninth tone,
#    closing the 27. How often, over HEART intervals that keep the pattern?
def pal(n):
    s = str(int(n))
    return len(s) > 1 and s == s[::-1]
landing = {}
for step in range(108, 1000, 9):  # multiples of 9, with HEAD = 111 + HEART
    tones = [963 + step * k for k in range(1, 10)]
    tones += [tones[-1] + (step + 111) * k for k in range(1, 40)]
    landing[step] = next((i + 1 for i, t in enumerate(tones) if pal(t)), None)
out["first_mirror_number"] = {
    "aetheria_position": landing[243],  # 18 = HEAD's ninth tone
    "intervals_checked": len(landing),
    "first_mirror_on_head_ninth_tone": [s for s, i in landing.items() if i == 18],
}

# 6. A well-known curiosity nobody claimed: 2178 x 4 = 8712, its own reverse.
out["unclaimed_curiosity"] = {"2178x4": 2178 * 4, "reverse_of_2178": int(str(2178)[::-1])}

json.dump(out, open("exploratory.json", "w"), indent=1)
print(json.dumps(out, indent=1)[:3000])
