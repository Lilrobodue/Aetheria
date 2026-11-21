#!/usr/bin/env python3
"""
Follow-up, NOT pre-registered. Written after results_real.json showed the
hidden-schedule test at 6.4% false alarms on real hearts, just over the plan's
6% line. A randomization test with truly random labels can't exceed 5% by
construction, so the question is whether 6.4% is chance. This reruns only that
check, five times as many experiments, on a fresh seed.

    python3 -I followup_s2.py DATA_DIR     # writes followup_s2.json
"""
import glob
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import two_rooms_sim as sim  # noqa: E402
import real_hearts as rh  # noqa: E402

data_dir = sys.argv[1]
rng = np.random.default_rng(20261122)
sessions = []
for path in sorted(glob.glob(os.path.join(data_dir, "*.ecg"))):
    name = os.path.basename(path)[:-4]
    if name in rh.EXCLUDED or rh.damaged(path):
        continue
    grid, hr, _ = rh.heart_rate_trace(*rh.read_annotations(path))
    sessions += rh.sessions_from(grid, hr)
pool = np.array(sessions)
experiments, k = 5000, 20
pvals = np.empty(experiments)
for e in range(experiments):
    yk = pool[rng.choice(len(pool), k, replace=False)]
    lab = sim.schedules(rng, k)
    pvals[e] = sim.s2_hidden_schedule(sim.period_means(yk, rng.normal(0, 1, k)), lab, rng, 1000)
rate = float(np.mean(pvals < 0.05))
out = {"experiments": experiments, "sessions_each": k, "seed": 20261122, "sessions_in_pool": len(pool),
       "S2_false_alarm_rate": rate, "binomial_se": float(np.sqrt(0.05 * 0.95 / experiments)),
       "share_p_below": {str(a): float(np.mean(pvals < a)) for a in (0.01, 0.05, 0.1, 0.25, 0.5)}}
json.dump(out, open("followup_s2.json", "w"), indent=1)
print(out)
