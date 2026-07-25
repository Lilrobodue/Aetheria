# Aetheria Player — Audio Signal Chain Audit

**Repo:** `Lilrobodue/Aetheria`
**Mode: READ-ONLY.** Produce a findings document. Do not modify source in this pass.
**Scope:** the audio signal path only. Ignore styling, unused imports, `any` types, React key warnings, and general lint. Those are real but not what this pass is for.

---

## Why this audit exists

A partial read of `App.tsx`, `constants.ts`, `types.ts`, `index.tsx`, and `index.html` surfaced four issues in the audio graph. All four need confirmation against the full repo, because seven `./utils/` modules, `./hooks/useMediaSession`, and eight `./components/` were not available to that read.

The immediate motivation is an experiment: determining what the app actually emits when the UI displays a given frequency, so a blind listening test can be run against known ground truth. Findings that change the emitted signal are high priority. Findings that only affect code tidiness are out of scope.

---

## Deliverable

A single markdown document, `AUDIO_AUDIT_FINDINGS.md`, with one section per task below. For each: **CONFIRMED / NOT CONFIRMED / PARTIALLY CONFIRMED**, the file and line numbers, what the code actually does, and a recommended fix with its blast radius. No code changes.

At the end, one section: **Signal Flow Diagram** — every node from source to `ctx.destination`, with gain values at each stage, for the default settings state.

---

## TASK 1 — Read `utils/phiIntegration.ts` and finish the amplitude math

`integratePhiVolumes(volume, binauralVolume, solfeggioVolume, true)` is called at App.tsx lines 2053, 2072, 2122, 2525. `enablePhiMode` defaults to `true` (line 1452), so this rescaling is active on every session by default. The function body has not been read.

Report:
- Exact transform applied to each of the three returned values (`music`, `binaural`, `solfeggio`).
- Resulting numeric gain for each layer at the documented defaults: `volume = 0.8` (1298), `solfeggioVolume = 0.01` (1299), `binauralVolume = 0.03` (1309).
- Whether `music` is actually applied anywhere. Trace it — `gainNodeRef` is hardcoded to `0.7` at line 1949, and `applyMusicElementVolume()` also touches element volume. Determine which one wins and whether the phi `music` value is used at all or silently discarded.
- Whether any returned value can exceed 1.0.

Also report what `createPhiOscillator`, `getPhiEnvelopeVolume`, and `getPhiIntensityMultiplier` do and whether they are on any live audio path or dead code.

---

## TASK 2 — Master chain: confirm the processing nodes are orphaned

App.tsx 1914–1968 creates `compressorRef.current`, `highShelfFilter`, `limiter`, `lowPassFilter`, `notchFilter`, `deEsserFilter`, `vocalFilter`. The `.connect()` calls at lines 1961, 1964, 1965 appear commented out, leaving the live path as:

```
mediaSource → gainNodeRef (0.7) → ctx.destination
```

Confirm:
- No other call site anywhere in the repo connects `limiter`, `compressorRef`, or `highShelfFilter` into the graph. Grep the whole repo, not just `App.tsx`.
- **There is no limiter on the output.** State plainly whether this is true.
- Sum the worst-case peak amplitude arriving at `ctx.destination` with all layers active at defaults: music + solfeggio osc + binaural + sub-bass drone. Report whether the total can exceed 1.0 and therefore hard-clip.
- Whether any component (`Visualizer`, `FrequencySelector`) assumes those filters are connected and reads from them.

Recommend the minimum change that restores clip protection without altering perceived tone. Note that reconnecting the compressor and high-shelf is a *tonal* change and should be a separate decision from reconnecting the limiter, which is a *safety* change.

---

## TASK 3 — Sub-bass drone bypasses the analyser and the recorder

**This is the highest-priority finding.** App.tsx ~2400: the drone's master gain connects straight to the destination:

```js
gain.connect(ctx.destination);   // bypasses gainNodeRef entirely
```

Meanwhile:
- analyser path is `gainNodeRef → visualizerGainRef → analyserRef` (1976–1977)
- recorder path is `gainNodeRef → destNodeRef` (1985)

Confirm both consequences:
1. The visualizer never receives the sub-bass layer.
2. **`MediaRecorder` captures do not contain the sub-bass drone.** Any recording exported from the app is missing the loudest synthesized layer.

Consequence 2 invalidates recording-based verification of what the app emits, which is exactly what the experiment needs. Confirm it, then recommend a fix. Consider whether routing the drone through `gainNodeRef` changes its level (it would pick up the 0.7 gain), and whether a parallel tap into `destNodeRef` and `visualizerGainRef` is the lower-risk option. State the tradeoff; do not pick for us.

---

## TASK 4 — Two oscillators land on the same frequency

For any `selectedSolfeggio > 639`, two independent oscillators resolve to the identical frequency:

- `updateSolfeggio()` (App.tsx ~2048): `toSubBass(2178)` → **34.03125 Hz**, gain ≈ 0.007 after the 0.7 stage
- sub-bass drone carrier (~2375): `feltCarrierHz(2178)` → **34.03125 Hz**, gain 0.08, AM-modulated at `thetaAlphaModHz(2178)` = **8.508 Hz**

`toSubBass` (2005) and `octaveInto` (116) both halve by 2:1, so collision is structural for every frequency above 639 Hz, not just 2178.

Because the two oscillators are `.start()`ed at unrelated times, their relative phase is arbitrary per session and fixed within it. Expected magnitude of interference is roughly ±9% of total felt amplitude — small, but it means the emitted signal is not bit-reproducible across sessions.

Report:
- Confirm both layers are simultaneously active in normal playback (check the `isPlaying` / `isSolfeggioActive` gating at 2042 — determine whether the solfeggio osc runs by default or only after an explicit frequency click).
- Verify the collision arithmetic for all 27 frequencies. Produce a table: frequency → `toSubBass()` → `feltCarrierHz()` → `thetaAlphaModHz()`. Flag every row where the first two columns match.
- Note the guard asymmetry: `toSubBass` uses `if (f < 20) f *= 2` (single conditional, App.tsx:2009) while `octaveInto` uses `while (f < min) f *= 2`. Determine whether any of the 27 frequencies produces a different result because of it.
- Recommend which layer should own the felt sub-bass band. Two oscillators at one frequency is almost certainly unintended.

---

## TASK 5 — 432 Hz retuning is disabled

Two sites set playback to source pitch:

- App.tsx:4529 — `mainAudioRef.current.playbackRate = 1.0; // was PITCH_SHIFT_FACTOR (0.981818)`
- App.tsx:4224 — `el.playbackRate = 1.0;` in the gapless swap

`PITCH_SHIFT_FACTOR` is still exported from `constants.ts` (line ~537).

Report:
- Every remaining consumer of `PITCH_SHIFT_FACTOR` across the repo. If the only references are the export and dead comments, say so.
- Whether any analysis code (`fractalFrequencyAnalysis`, `intervalAnalysis`, deep scan, `closestSolfeggio` assignment) assumes the audio has been shifted by 0.981818. If frequency detection was calibrated against shifted audio and playback is now unshifted, the analysis and the playback disagree — check for this specifically and report it as its own finding if present.
- Whether restoring `playbackRate = PITCH_SHIFT_FACTOR` reintroduces the distortion the comment says it was testing for. Note that the master chain bypass in Task 2 looks like part of the same debugging effort; if so, the distortion cause may have been the missing limiter rather than the pitch shift, and restoring the limiter might allow restoring the pitch shift.

This last point is the one to reason about carefully. Do not change anything — just report whether the two findings are plausibly the same root cause.

---

## Out of scope for this pass

- Reformatting, renaming, or refactoring `App.tsx`
- Lint, type-safety, unused imports, React warnings
- Anything in the Sophia / RCT monolith (separate codebase)
- UI, styling, layout
- The Lo Shu walk sequences themselves — the arithmetic is settled; only the *audio* consequences are in scope

---

## Verification hint

`Cmd+F` on line numbers is not enough — this file was written against a partial read and line numbers may have drifted. Grep by identifier: `toSubBass`, `feltCarrierHz`, `thetaAlphaModHz`, `octaveInto`, `SUB_BASS_DRONE_LEVEL`, `subBassDroneRef`, `integratePhiVolumes`, `gainNodeRef`, `destNodeRef`, `visualizerGainRef`, `PITCH_SHIFT_FACTOR`, `playbackRate`.
