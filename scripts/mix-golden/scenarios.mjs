// v15.8 golden harness: the generators and the scenario matrix (shared by capture.mjs and gate.mjs).
export const GENS = [
  'gut', 'heart', 'head', 'full', 'preset:qi', 'preset:healing', 'preset:mood', 'preset:meditation', 'preset:flow',
  'golden', 'seq111', 'source2178', 'ultimate', 'walk:A', 'walk:B', 'walk:C', 'walk:traditional', 'walk:combined',
  'walk:ouroboros', 'walk:cabi', 'restore', 'autoDistribute', 'filtered', 'aetheriaJourney', 'aetheriaOnly',
];
export function buildScenarios(H1) {
  const scenarios = [];
  for (const exp of ['beginner', 'intermediate', 'advanced', 'expert'])
    for (const [historyName, history] of [['none', null], ['H1', H1]])
      for (const seed of [1, 2, 3])
        for (const width of [411, 1280]) scenarios.push({ fixture: 'F160', exp, historyName, history, seed, width });
  for (const fixture of ['F160g', 'F160d', 'F26', 'FGUT', 'F3', 'F0', 'F160u', 'F111gap', 'FLEG'])
    for (const exp of ['beginner', 'expert']) scenarios.push({ fixture, exp, historyName: 'none', history: null, seed: 1, width: 411 });
  scenarios.push({ fixture: 'F160', exp: 'beginner', historyName: 'none', history: null, seed: 1, width: 1280, scanning: true, only: ['autoDistribute'] });
  return scenarios;
}
