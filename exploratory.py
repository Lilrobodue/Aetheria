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

# 3. A well-known curiosity nobody claimed: 2178 x 4 = 8712, its own reverse.
out["unclaimed_curiosity"] = {"2178x4": 2178 * 4, "reverse_of_2178": int(str(2178)[::-1])}

json.dump(out, open("exploratory.json", "w"), indent=1)
print(json.dumps(out, indent=1)[:3000])
