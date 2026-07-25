# Aetheria Player — Audio Signal Chain Audit: Findings

> ## ⚠ STATUS: SUPERSEDED IN PART — remediation applied
>
> This document records the state of the code **as audited**, before any fix. The
> findings below were subsequently addressed. Do not read the measurements here as
> current; they describe the pre-fix instrument.
>
> | Finding | Status |
> |---|---|
> | #1 Drone absent from both recording paths | **FIXED** — `masterBusRef` added; drone, analyser and both recorder taps now share one unity-gain bus |
> | #2 `FrequencySelector` threshold 963 vs 639 | **FIXED** — single `utils/frequencyMapping.ts`, duplicate deleted |
> | #3 21/27 two-oscillator collision | **FIXED** — `solfeggioHz()` steps the layer off the drone carrier by φ; guarded by `utils/frequencyMapping.smoke.ts` |
> | #4 `PITCH_SHIFT_FACTOR` inflating duration | **RESOLVED** — 432 Hz playback restored, so the existing division is correct again |
> | #5 432 restoration desyncs analysis | **FIXED** — `toHeardHz()` applied at the detection boundary |
> | #6 `gainNodeRef` startup transient (0.7) | **FIXED** — initialised from the steady-state formula via `volumeRef` |
> | #7 No clamp in `integratePhiVolumes` | **FIXED** — clamped to [0,1]; now load-bearing, see below |
> | #8 Orphaned filter nodes | **PARTLY** — `mediaSourceRef` deleted; the four placeholder filters left in place |
> | #9 Unreachable `if (f < 20)` guard | **FIXED** — removed, with a sweep test proving unreachability |
>
> **Two numbers here are now stale by design.** Layer levels were deliberately
> raised: binaural −38 dB → **−23 dB** under the music, solfeggio −47 dB → **−26 dB**,
> via named trims in `phiIntegration.ts`. Web Audio total peak is now **0.097** at
> defaults (was 0.083) and **0.28** worst-case across all slider positions — which is
> why the limiter remains disconnected. The Task 4 conclusion that the collision was
> inaudible at −41 dB **no longer holds at these levels**, which is why it was fixed
> rather than documented.

**Mode:** READ-ONLY. No source was modified.
**Audited against:** working tree at commit `99f03e9` ("update v13.0"), `App.tsx` 8678 lines.
**Line numbers below are verified against the current file**, not the brief (the brief's numbers had drifted by roughly +20 to +30 lines).

---

## Executive summary — read this first

**The brief's central architectural premise is out of date, and it changes the answer to three of the five tasks.**

The brief assumes the live path is:

```
mediaSource → gainNodeRef (0.7) → ctx.destination
```

It is not. **The music does not pass through Web Audio at all.** `createMediaElementSource` is never called anywhere in the repo — `mediaSourceRef` (App.tsx:1604) is declared, disconnected in two cleanup paths, and never assigned. The music plays direct from the `<audio>` element to the OS mixer, a deliberate change documented at App.tsx:4453–4462 to keep the lock-screen media session alive. `gainNodeRef` now carries **only** the binaural and solfeggio layers (App.tsx:2170–2177 says so explicitly).

Three consequences that reshape the audit:

1. **There is no clipping risk.** Total Web Audio peak at `ctx.destination` is ≈ **0.083**, not ≈ 1.0. Task 2's worst-case sum premise does not hold, because the loudest layer (music) was never on that bus. The missing limiter is real but it is guarding a bus that peaks at 8% of full scale.
2. **`gainNodeRef` is not 0.7 in steady state.** It is initialised to 0.7 (App.tsx:1975) but an effect overwrites it with `volume * 0.18 * 0.5` = **0.072** (App.tsx:2212–2213). The 0.7 is a startup transient only.
3. **Task 3's premise is confirmed but the reasoning inverts.** The sub-bass drone bypasses the recorder — that is true and it is the highest-priority finding. But it bypasses it in *both* recording paths, not just `MediaRecorder`, and the visualizer consequence is immaterial because the visualizer no longer reads the analyser at all.

**Two findings the brief did not anticipate, both of which directly affect the planned listening experiment:**

- **F-A (HIGH): `FrequencySelector` uses a different sub-bass threshold than playback** — 963 vs 639. The preview tone for 741 / 852 / 963 Hz plays at full audible pitch; the same frequency during playback plays at 46.3 / 53.3 / 30.1 Hz. **Preview and playback emit different signals for three of the nine GUT-band frequencies.** For a blind listening test calibrated against the selector's preview, this is a ground-truth error. See [Additional Finding A](#additional-finding-a--frequencyselector-emits-a-different-frequency-than-playback-high).
- **F-B (MEDIUM): `PITCH_SHIFT_FACTOR` is still applied to duration while playback runs unshifted.** Every reported duration is inflated by 1.85%, which also skews the phi timing markers. See [Additional Finding B](#additional-finding-b--pitch_shift_factor-still-divides-duration-medium).

Task-by-task verdicts:

| Task | Verdict |
|---|---|
| 1 — phi amplitude math | **CONFIRMED**, with the `music` value confirmed discarded at all 4 sites |
| 2 — orphaned master chain | **PARTIALLY CONFIRMED** — nodes are orphaned; the clipping consequence is **NOT CONFIRMED** |
| 3 — drone bypasses analyser + recorder | **CONFIRMED**, and worse than stated (both recording paths) |
| 4 — two oscillators on one frequency | **CONFIRMED** — 21 of 27 frequencies collide exactly |
| 5 — 432 Hz retuning disabled | **CONFIRMED**; the shared-root-cause hypothesis is **NOT CONFIRMED** |

---

## TASK 1 — `utils/phiIntegration.ts` amplitude math

**Verdict: CONFIRMED.** The rescaling is active by default and the `music` return value is dead at every call site.

### Exact transform

`integratePhiVolumes` (phiIntegration.ts:191–219) with `enablePhiMode = true`:

```js
const phiRatios     = calculatePhiVolumeRatios(currentMusicVolume);  // {music: v, binaural: v*0.618034, solfeggio: v*0.381966}
const binauralScale  = currentBinauralVolume  / 0.03;
const solfeggioScale = currentSolfeggioVolume / 0.01;

return {
  music:     currentMusicVolume,                                  // ← IDENTITY. Unmodified.
  binaural:  phiRatios.binaural  * binauralScale  * 0.05,
  solfeggio: phiRatios.solfeggio * solfeggioScale * 0.03,
};
```

Reduced to closed form:

- `music     = volume`
- `binaural  = volume × 0.6180340 × (binauralVolume / 0.03) × 0.05  = volume × binauralVolume × 1.0300566`
- `solfeggio = volume × 0.3819660 × (solfeggioVolume / 0.01) × 0.03 = volume × solfeggioVolume × 1.1458980`

Note the two scale divisions (`/0.03`, `/0.01`) very nearly cancel the two attenuations (`×0.05`, `×0.03`). The net effect on the binaural layer is `volume × binauralVolume × 1.03` — i.e. **phi mode changes the binaural gain by +3% and the solfeggio gain by +14.6% versus a plain `volume × sliderValue` product.** The golden ratio is arithmetically present but its influence has been scaled to near-nothing by the two hardcoded correction factors. This is worth knowing before anyone attributes a perceptual effect to phi weighting.

### Numeric gain at documented defaults

Defaults verified: `volume = 0.8` (App.tsx:1299), `solfeggioVolume = 0.01` (App.tsx:1300), `binauralVolume = 0.03` (App.tsx:1310), `enablePhiMode = true` (App.tsx:1453), `phiTimingEnabled = true` (App.tsx:1454).

| Layer | `integratePhiVolumes` returns | × master `gainNodeRef` (0.072) | Peak at `ctx.destination` |
|---|---|---|---|
| `music` | 0.8 | — (never applied) | n/a — not on this bus |
| `binaural` | 0.0247214 | 0.072 | **0.00178** |
| `solfeggio` | 0.0091672 | 0.072 | **0.00066** |

Both synth layers arrive at the destination at **under 0.2% of full scale**. They are, numerically, almost inaudible relative to the music (element volume 0.144 desktop / 0.230 mobile). This matches the `LAYER_BALANCE_ATTEN = 0.5` comment at App.tsx:2177 describing a deliberate recession — but the combined attenuation is far deeper than that comment implies.

### Is `music` actually applied anywhere?

**No. The `music` field is read at zero of the four call sites.** Traced individually:

| Call site | Uses `.music`? |
|---|---|
| App.tsx:2078 (`updateSolfeggio`) | No — only `.solfeggio` at :2082 |
| App.tsx:2097 (binaural volume effect) | No — only `.binaural` at :2100 |
| App.tsx:2147 (`updateBinaural`) | No — only `.binaural` at :2150 |
| App.tsx:2550 (phi timing tick) | No — only `.binaural` :2558 and `.solfeggio` :2566 |

The `music` value is **silently discarded at every site.** Since the function returns it unchanged (`music: currentMusicVolume`), nothing is lost — but the field is pure dead weight and its presence invites the false inference that phi scales the music.

**Which volume actually wins for the music?** Neither `integratePhiVolumes` nor `gainNodeRef`. The music level is set exclusively by `applyMusicElementVolume` (App.tsx:2183–2193), which calls the *other* function, `calculatePhiVolumeRatios(volume)`, and takes `.music` from that (also an identity — `calculatePhiVolumeRatios` returns `music: musicLayerVolume` verbatim). Final:

```js
el.volume = clamp(volume × 0.18 × duckComp)     // duckComp = 1.6 on mobile, 1 on desktop
          = 0.144 (desktop) / 0.2304 (mobile)
```

**`gainNodeRef`'s 0.7 does not win, and neither does phi's `music`.** The music never touches `gainNodeRef` at all.

### Can any returned value exceed 1.0?

**Yes — `music` trivially, and both others under user slider movement.**

- `music = currentMusicVolume`, bounded only by the volume slider (max 1.0). Cannot exceed 1.0 but is never used.
- `binaural = volume × binauralVolume × 1.0300566` → exceeds 1.0 when `volume × binauralVolume > 0.9708`. Reachable only if both sliders approach maximum. Whether the binaural slider's UI range permits this is a UI question outside this pass's scope, but **the function itself applies no clamp.**
- `solfeggio = volume × solfeggioVolume × 1.1458980` → exceeds 1.0 when `volume × solfeggioVolume > 0.8727`.

More immediately: at App.tsx:2558 and :2566 the returned values are further multiplied by `getPhiIntensityMultiplier`, which is bounded to ≤ 1.0, so that path cannot push them higher. There is **no clamp anywhere in `integratePhiVolumes`**. Given the master gain of 0.072 downstream, an out-of-range value would not clip the output — it would just make the layer loud. Low practical risk, but the missing clamp is real.

### The other phi exports — live or dead?

| Export | Status |
|---|---|
| `createPhiOscillator` | **DEAD.** Imported at App.tsx:50, never called. Also note it has a latent bug: it calls `oscillator.start()` internally (phiIntegration.ts:151), so any caller that also calls `.start()` would throw `InvalidStateError`. Its "phase offset" is implemented as a start-time delay, which for a continuous sine is equivalent to a phase offset only if nothing else is time-aligned to it. |
| `getPhiEnvelopeVolume` | **DEAD.** Imported at App.tsx:48, never called. |
| `getPhiIntensityMultiplier` | **LIVE.** Called at App.tsx:2553, on a per-tick interval during playback, gated by `enablePhiMode && phiTimingEnabled` — both default `true`. It multiplies both the binaural and solfeggio gains, so it **is on the live audio path** and makes both layers time-varying over the track (0 → 1.0 → ~0.7 across build/peak/resolution). Relevant to the experiment: the emitted layer amplitude depends on playback position. |
| `getBinauralPhaseOffset` | **DEAD.** Imported at App.tsx:46, never called. `updateBinaural` reimplements the same golden-angle offset inline at App.tsx:2156. |
| `getPhiTimingMarkers` | **Not called from App.tsx** (imported at :47, unused there). Live only as an internal helper of the two functions above. |
| `logPhiRelationships` | Called once at App.tsx:2277 — console output only, no audio effect. |
| `calculatePhiVolumeRatios` | **LIVE.** App.tsx:2187 and :2206. |

**Caveat on `getPhiIntensityMultiplier`:** it is fed `currDuration`, which is inflated 1.85% by Additional Finding B. Its phase boundaries are therefore slightly late relative to true track position.

---

## TASK 2 — Master chain: are the processing nodes orphaned?

**Verdict: PARTIALLY CONFIRMED.** The nodes are orphaned — confirmed unambiguously. The clipping consequence the brief infers from that is **NOT CONFIRMED**, because the premise about what is on the bus is wrong.

### Are the nodes orphaned?

**Yes. Confirmed by whole-repo grep, not just `App.tsx`.** Searched `.ts`/`.tsx` across the repo excluding `node_modules` and `dist`:

- `limiter` — created App.tsx:1953–1958, stashed on the context as an expando at :1971, referenced only in **commented-out** `.connect()` calls at :1985, :1986, :1990, and in a comment at :2008. **Zero live connections.**
- `compressorRef` — created App.tsx:1939–1944; its only `.connect()` is commented out at :1989. **Zero live connections.** No input, no output.
- `highShelfFilter` — created App.tsx:1947–1950, expando at :1968; only appears in commented lines :1989, :1990. **Zero live connections.**
- `lowPassFilter`, `notchFilter`, `deEsserFilter`, `vocalFilter` — created App.tsx:1961–1964, explicitly labelled "placeholder filters (disconnected) for compatibility". Only `lowPassFilter`, `notchFilter`, `deEsserFilter` are even stashed; `vocalFilter` is created and immediately unreachable. **Zero connections of any kind.**

The only live master-bus wiring in `initAudio` is:

```
App.tsx:1982  gainNodeRef → ctx.destination
App.tsx:2001  gainNodeRef → visualizerGainRef
App.tsx:2010  gainNodeRef → destNodeRef
```

### Is there a limiter on the output?

**Plainly: no. There is no limiter, no compressor, and no filter of any kind on the output path.** The Web Audio output is `gainNodeRef → ctx.destination`, unprocessed. Additionally, two sources bypass even `gainNodeRef` and connect straight to `ctx.destination`: the sub-bass drone (App.tsx:2425) and the silent keep-alive oscillator (App.tsx:2383).

### Worst-case peak at `ctx.destination`

**This is where the brief's premise fails.** The music is not on this bus. Summing what actually arrives, at defaults, all layers active:

| Source | Path | Peak amplitude |
|---|---|---|
| Music | `<audio>` element → **OS mixer** | not in the AudioContext |
| Solfeggio osc | → `gainNodeRef` (0.072) → dest | 0.00066 |
| Binaural (L+R merged) | → `gainNodeRef` (0.072) → dest | 0.00178 |
| Sub-bass drone | **direct → dest** (bypasses master) | 0.08000 |
| Silent keep-alive | direct → dest, `gain = 0` | 0.00000 |
| **Total (worst case, coherent sum)** | | **≈ 0.0824** |

Sub-bass drone derivation: master gain `volume × SUB_BASS_DRONE_LEVEL` = `0.8 × 0.10` = 0.08 (App.tsx:2218, :2440). The AM stage centres at `1 − depth/2` = 0.85 and swings ±0.15, so it ranges [0.70, 1.00] and peaks at unity — hence 0.08 × 1.0 = 0.08.

**The total cannot exceed 1.0 and cannot hard-clip.** It reaches roughly 8% of full scale. The drone alone is **97% of the entire Web Audio output** — the two "layers" the master bus was designed around are numerically negligible beside it.

The music, separately, arrives at the OS mixer at 0.144 (desktop) or 0.230 (mobile). Even a coherent sum of that with the Web Audio bus at the OS level is ≈ 0.31. **No clipping anywhere at default settings.**

*The one caveat:* `volume` is user-controllable to 1.0, and `applyMusicElementVolume` clamps the element to [0,1] — but the mobile `duckComp = 1.6` means the clamp is actually reachable (`volume × 0.18 × 1.6 > 1.0` requires `volume > 3.47`, so no — not reachable). Nothing clips.

### Startup transient (not in the brief)

`gainNodeRef.gain.value = 0.7` is set at App.tsx:1975 inside `initAudio`. The effect that overwrites it with 0.072 (App.tsx:2203–2213) has deps `[volume, enablePhiMode, applyMusicElementVolume, isPlaying]` and skips when `gainNodeRef.current` is null. On first play, `initAudio()` runs before `setIsPlaying(true)`, so there is a brief window — one React commit — where the layers run at **0.7 instead of 0.072, a 9.7× overshoot**. `setTargetAtTime` with a 0.1 s time constant then ramps it down. Audible as a short swell on the binaural/solfeggio layers at session start. Peak during that window is still only ≈ 0.017 for the layers, so it is a cosmetic artefact, not a safety issue.

### Do any components assume the filters are connected?

**No.** Grep for `limiter|compressor|highShelf|lowPass|notchFilter|deEsser|vocalFilter` across `components/`, `hooks/`, and `utils/` returns **zero matches**. Neither `Visualizer` nor `FrequencySelector` reads from them. Removing them entirely would break nothing.

`Visualizer` receives `analyser` as a prop but — see Task 3 — its live-FFT branch is disabled by a literal `false` (Visualizer.tsx:1214), so it does not read the analyser for band energy either.

### Recommended minimum change

The brief asks for "the minimum change that restores clip protection without altering perceived tone," and correctly separates the *safety* change from the *tonal* change. Given the measured 0.083 peak, my finding is:

**There is nothing to protect against on the current bus, so the minimum safety change is: none.** Reconnecting a limiter at `threshold = −0.5 dB` would never engage at 8% of full scale. It would be inert code.

If a limiter is nonetheless wanted as a guard against future routing changes or user-slider extremes, the minimal safe insertion is:

```js
// replaces App.tsx:1982
gainNodeRef.current.connect(limiter);
limiter.connect(audioCtxRef.current.destination);
```

Blast radius: **low, but incomplete.** Note the visualizer tap (:2001) and recorder tap (:2010) are taken *pre*-limiter, so they would be unaffected — which is correct behaviour. **But this does not protect the loudest source:** the sub-bass drone bypasses `gainNodeRef` entirely, so it would remain unlimited. Any limiter that matters must sit where the drone also passes through it, which is a Task 3 routing decision.

Reconnecting the compressor and high-shelf (`ratio 3:1 @ −24 dB`, `−3 dB @ 10 kHz`) is a **tonal** change and, per the brief, a separate decision. My note on it: at 0.083 peak the compressor's −24 dB threshold sits *above* the signal and would also never engage, so it too would be inert. The high-shelf would apply a genuine −3 dB above 10 kHz — but there is essentially no content above 10 kHz on this bus (a 34 Hz drone, a 200 Hz binaural pair, a sub-60 Hz solfeggio tone). **All three nodes are inert given what is actually on the bus.** They were designed for a signal path that no longer exists — the one that carried the music.

---

## TASK 3 — Sub-bass drone bypasses the analyser and the recorder

**Verdict: CONFIRMED, and the recording consequence is broader than the brief states.**

### The bypass

App.tsx:2425, inside the lazy drone creation block:

```js
osc.connect(amGain);
amGain.connect(gain);
gain.connect(ctx.destination);   // ← direct to destination
```

Full drone subgraph (App.tsx:2391–2428):

```
osc (sine @ feltCarrierHz)  → amGain (0.85 ±0.15) → gain (0.08) → ctx.destination
lfo (sine @ thetaAlphaModHz) → lfoGain (0.15) ────↗ (a-rate AM on amGain.gain)
```

`gainNodeRef` appears nowhere in this subgraph. Confirmed against all 17 `subBassDroneRef` references — none connect it to the master bus, the analyser path, or the recorder path.

### Consequence 1 — visualizer never receives the sub-bass

**CONFIRMED as stated, but immaterial in practice.**

The analyser path is `gainNodeRef → visualizerGainRef (2.0) → analyserRef` (App.tsx:2001–2002), so the drone is genuinely absent from it. However, the visualizer no longer uses the analyser for band energy at all:

- Visualizer.tsx:1214 — `if (false && analyser && bufferLength > 0) {` — the live-FFT branch is **disabled by a literal `false`**, annotated "Legacy live-FFT path retained but disabled (no music in analyser now)."
- Visualizer.tsx:1122–1131 — band energies are driven from `bandEnvelopeRef`, the pre-scanned per-track envelope.

So the visualizer misses the sub-bass *and* the music *and* the binaural *and* the solfeggio — it is not reading the analyser at all. **Routing the drone into the analyser would not change the visuals.** This consequence should be dropped from the priority list; it is true but has no observable effect.

### Consequence 2 — recordings do not contain the sub-bass drone

**CONFIRMED. And it affects both recording paths, not just `MediaRecorder`.**

**Path A — `MediaRecorder` (video / "both"), App.tsx:5185–5190:**
```
destNodeRef ← gainNodeRef        (App.tsx:2010)  → binaural + solfeggio only
destNodeRef ← music captureStream (App.tsx:5189) → music
```
The drone is on neither input. **Recording contains music + binaural + solfeggio. No sub-bass.**

**Path B — WAV recording (audio-only), App.tsx:5123–5162 — the brief does not mention this one:**
```
worklet ← gainNodeRef             (App.tsx:5143)  → binaural + solfeggio only
worklet ← music captureStream     (App.tsx:5144)  → music
```
Identical omission. **The 24-bit WAV export — the highest-fidelity output the app produces, and the obvious choice for verification — is also missing the sub-bass drone.**

This is the finding that matters most for the stated purpose of the audit. **Every export from this app is missing the layer that constitutes ~97% of its synthesized output amplitude.** Recording-based verification of what the app emits is invalid until this is fixed, on either path.

### Recommended fix — the tradeoff, stated not decided

**Option 1 — route the drone through `gainNodeRef`.**
Replace `gain.connect(ctx.destination)` with `gain.connect(gainNodeRef.current)`.

- *Pro:* one line; the drone automatically joins the analyser tap, both recorder taps, and any future master processing (e.g. a limiter) in one move.
- *Con — this is a real level change, not a theoretical one:* the drone would pick up the master gain of **0.072**, taking it from 0.08 to **0.00576 — a 13.9× attenuation, about −22.8 dB.** The felt sub-bass would effectively vanish. Compensating means raising `SUB_BASS_DRONE_LEVEL` from 0.10 to ≈ 1.39, which is a strange value to leave in the source and would break if `LAYER_BALANCE_ATTEN` or the `× 0.18` scaling is ever retuned. It also couples the drone to `LAYER_BALANCE_ATTEN`, whose stated purpose (App.tsx:2170–2177) is specifically to recess the *binaural/solfeggio* layers — a purpose that does not apply to the drone.

**Option 2 — parallel taps into `destNodeRef` and `visualizerGainRef`, keep the direct output.**
Add `gain.connect(destNodeRef.current)` (and optionally `gain.connect(visualizerGainRef.current)`) alongside the existing `gain.connect(ctx.destination)`.

- *Pro:* **audible output is bit-identical to today.** Zero risk of changing what users hear — which matters given that a listening experiment is about to be run against this build. Fixes both recording paths at once, since `destNodeRef` feeds `MediaRecorder`; the WAV path needs its own tap because it connects to a per-recording worklet node.
- *Con:* three connection points to maintain instead of one; the drone stays outside any future master processing; the WAV path's tap must be added inside `startWavRecording` and torn down in its `stop()`, so it is genuinely more code than Option 1.

**The tradeoff in one line:** Option 1 is architecturally correct and changes the sound; Option 2 preserves the sound exactly and duplicates routing. **Given that the immediate goal is to characterise what the app currently emits, Option 2 has the property you need — it makes the recording match the output without changing the output.** Option 1 is the better long-term shape once the experiment is done. I am not choosing; both are viable and the decision depends on whether the current sound is being treated as fixed ground truth.

*Implementation note for either option:* the drone is created lazily inside an effect keyed on `isPlaying` (App.tsx:2369, :2391), which can run before or after `initAudio`. Any new `.connect()` there must null-check `destNodeRef.current` / `visualizerGainRef.current`, or it will throw on the first play.

---

## TASK 4 — Two oscillators land on the same frequency

**Verdict: CONFIRMED. 21 of 27 frequencies collide exactly — every frequency above 639 Hz.**

### Are both layers simultaneously active in normal playback?

**Yes.** Verified gating:

- Solfeggio osc (App.tsx:2067): `if (!isPlaying && !isSolfeggioActive) return;` — runs when **either** is true. `isSolfeggioActive` defaults `false` (App.tsx:1305), but `isPlaying` is true during playback, so **the solfeggio oscillator runs by default during normal playback — no explicit frequency click required.** The brief asked specifically about this; the answer is that the click is not needed.
- Sub-bass drone (App.tsx:2391): created whenever `isPlaying` becomes true and `SUB_BASS_DRONE_LEVEL > 0` (it is 0.10). Once created it **runs forever** — the comment at :2432 confirms it is deliberately never stopped, only faded to 0 on pause.

**Both are active simultaneously in ordinary playback of any track.** Confirmed.

### Collision table — all 27 frequencies

Computed by executing the three functions verbatim (`toSubBass` App.tsx:2030, `feltCarrierHz` App.tsx:124, `thetaAlphaModHz` App.tsx:126) against the 27 `UNIFIED_THEORY` frequencies in `constants.ts`.

| Hz | `toSubBass()` | `feltCarrierHz()` | `thetaAlphaModHz()` | Collision |
|---|---|---|---|---|
| 174 | 174 | 43.5 | 5.4375 | no |
| 285 | 285 | 35.625 | 8.90625 | no |
| 396 | 396 | 49.5 | 6.1875 | no |
| 417 | 417 | 52.125 | 6.51563 | no |
| 528 | 528 | 33 | 8.25 | no |
| 639 | 639 | 39.9375 | 9.98438 | no |
| 741 | 46.3125 | 46.3125 | 5.78906 | **YES** |
| 852 | 53.25 | 53.25 | 6.65625 | **YES** |
| 963 | 30.09375 | 30.09375 | 7.52344 | **YES** |
| 1206 | 37.6875 | 37.6875 | 9.42188 | **YES** |
| 1449 | 45.28125 | 45.28125 | 5.66016 | **YES** |
| 1692 | 52.875 | 52.875 | 6.60938 | **YES** |
| 1935 | 30.23438 | 30.23438 | 7.55859 | **YES** |
| 2178 | 34.03125 | 34.03125 | 8.50781 | **YES** |
| 2421 | 37.82813 | 37.82813 | 9.45703 | **YES** |
| 2664 | 41.625 | 41.625 | 5.20313 | **YES** |
| 2907 | 45.42188 | 45.42188 | 5.67773 | **YES** |
| 3150 | 49.21875 | 49.21875 | 6.15234 | **YES** |
| 3504 | 54.75 | 54.75 | 6.84375 | **YES** |
| 3858 | 30.14063 | 30.14063 | 7.53516 | **YES** |
| 4212 | 32.90625 | 32.90625 | 8.22656 | **YES** |
| 4566 | 35.67188 | 35.67188 | 8.91797 | **YES** |
| 4920 | 38.4375 | 38.4375 | 9.60938 | **YES** |
| 5274 | 41.20313 | 41.20313 | 5.15039 | **YES** |
| 5628 | 43.96875 | 43.96875 | 5.49609 | **YES** |
| 5982 | 46.73438 | 46.73438 | 5.8418 | **YES** |
| 6336 | 49.5 | 49.5 | 6.1875 | **YES** |

**21 of 27 collide — every frequency above the 639 Hz threshold, exactly as the brief predicted.** The brief's specific claim for 2178 Hz → 34.03125 Hz on both layers is arithmetically confirmed.

The 2178 Hz case the brief cites is representative: solfeggio osc at 34.03125 Hz (gain 0.00066) against drone carrier at 34.03125 Hz (gain 0.08, AM-modulated at 8.50781 Hz).

**One correction to the brief's magnitude estimate.** The brief states "roughly ±9% of total felt amplitude." Using the measured post-master gains, the solfeggio contribution is 0.00066 against the drone's 0.08 — a ratio of **0.83%**, so worst-case coherent interference is **±0.83%, not ±9%.** The brief's estimate appears to assume the solfeggio layer sits at 0.007 after a 0.7 master stage; the actual master is 0.072, an order of magnitude lower. **The phase-dependent variation is about −41 dB relative to the drone — inaudible, and well below the noise floor of any listening test.**

The brief's *structural* conclusion still stands, however: the emitted signal is not bit-reproducible across sessions, because the two oscillators are `.start()`ed at unrelated times (solfeggio at :2087, drone at :2426) and their relative phase is arbitrary per session. For bit-exact reproducibility this matters. For audibility it does not.

### Also note: 6336 Hz and 396 Hz produce the same carrier

Not asked, but visible in the table: `feltCarrierHz(396)` and `feltCarrierHz(6336)` are both **49.5 Hz**, as are `toSubBass(6336)` and `feltCarrierHz(396)`. Several frequencies are octave-equivalent and therefore indistinguishable in the felt band (e.g. 741/1449/2907/5628 all cluster near 45–47 Hz). **For a blind listening test, frequencies that map to the same or near-identical sub-bass carrier are not discriminable by the felt layer** — a design constraint worth knowing before the experiment is built.

### The guard asymmetry — `if` vs `while`

**Confirmed present, but it affects zero of the 27 frequencies — and the guard is unreachable dead code.**

`toSubBass` (App.tsx:2034) uses `if (f < 20) f *= 2`; `octaveInto` (App.tsx:121) uses `while (f < min) f *= 2`. I ran both variants across all 27: **0 differences.**

The reason is stronger than "no difference in practice" — the branch **can never be taken at all.** After `while (f > 60) f /= 2` terminates, the loop's final halving took a value `> 60` to `≤ 60`, so the result is necessarily in `(30, 60]`. It can never be `< 20`. `if (f < 20) f *= 2` at App.tsx:2034 is **unreachable for every possible input**, not just these 27. The same is true in the `FrequencySelector` copy (FrequencySelector.tsx:283).

So the asymmetry is a latent inconsistency with no current effect. If the `> 60` band ceiling were ever lowered below 40, `if` and `while` would begin to diverge.

### Which layer should own the felt sub-bass band?

The brief asks for a recommendation. **The drone should own it; the solfeggio oscillator's `toSubBass` mapping should not exist.** Reasoning:

1. **Amplitude.** The drone is at 0.08, the solfeggio tone at 0.00066 — 121× quieter. The drone is already, in practice, the sole audible occupant of the band. The solfeggio contribution is not "a second voice," it is an inaudible artefact.
2. **Purpose.** The drone was purpose-built for this band, with a documented design (App.tsx:95–111): a carrier clamped to the still-felt 27–55 Hz window plus theta-alpha AM. `toSubBass` is a *safety* transform, not a design one — its comment (App.tsx:2023–2029) says it exists to keep high frequencies "out of the harsh upper range," i.e. it is protective, not generative.
3. **Correctness of the band.** `toSubBass` targets 20–60 Hz; `feltCarrierHz` targets 27–55 Hz with a `clampUp` that guarantees the result stays felt. `toSubBass` has no such guarantee (its own clamp is unreachable, per above) and can in principle emit below the felt floor. The drone's mapping is the better-specified one.
4. **The collision is structural, not incidental.** Both use pure 2:1 halving from the same source frequency, so any frequency high enough to trigger both mappings will always collide. This cannot be tuned away; only one layer can own the band.

The narrow question this leaves open — and it *is* a design decision, not a bug fix — is what the solfeggio oscillator should do with frequencies above 639 Hz if it stops octave-dropping them. Playing 6336 Hz at full pitch is what the threshold was introduced to prevent. Muting the solfeggio layer above the threshold, rather than relocating it, is the option most consistent with the drone owning the band. **I am flagging this as the decision to make, not making it.**

---

## TASK 5 — 432 Hz retuning is disabled

**Verdict: CONFIRMED for the disabling. The shared-root-cause hypothesis is NOT CONFIRMED. And a new inconsistency was found — see Additional Finding B.**

### Both disabling sites confirmed

- **App.tsx:4554** — `mainAudioRef.current.playbackRate = 1.0; // was PITCH_SHIFT_FACTOR (0.981818)`, preceded at :4553 by `// TEST: Temporarily disable pitch shifting to isolate distortion source`.
- **App.tsx:4249** — `el.playbackRate = 1.0;` in the gapless swap.

`PITCH_SHIFT_FACTOR = 0.981818` is still exported from `constants.ts:272`.

### Every remaining consumer of `PITCH_SHIFT_FACTOR`

The brief hypothesises that "the only references are the export and dead comments." **That is not the case.** Whole-repo grep:

| Location | Kind | Live? |
|---|---|---|
| `constants.ts:272` | the export | — |
| `App.tsx:9` | import | — |
| `App.tsx:4554` | **comment only** (`// was PITCH_SHIFT_FACTOR`) | dead |
| **`App.tsx:4365`** | `setCurrDuration(el.duration / PITCH_SHIFT_FACTOR)` | **LIVE** |
| **`App.tsx:4766`** | `const dur = el.duration / PITCH_SHIFT_FACTOR` | **LIVE** |

**Two live consumers remain, both dividing duration by the factor while playback runs unshifted.** This is a genuine inconsistency and is written up as [Additional Finding B](#additional-finding-b--pitch_shift_factor-still-divides-duration-medium).

### Does any analysis code assume shifted audio?

**No — and this inverts the brief's concern.** Searched `utils/fractalFrequencyAnalysis.ts` and `utils/intervalAnalysis.ts` for `pitch|shift|0.98|432|440|playbackRate|detune`. The only hits are two unrelated constants (`PLANCK_RESONANCE` at :15 and `MAJOR_GROOVE: 432` at :89) — both numerology, neither a pitch correction.

More decisively, the analysis operates on the **decoded source buffer**, never on the playing element:

- App.tsx:2750 — `audioCtxRef.current.decodeAudioData(arrayBuffer)` — decodes the raw file.
- App.tsx:213, :274, :330 — analysis renders through `OfflineAudioContext` instances at 44100 Hz and 8 kHz.
- `playbackRate` appears **nowhere** in any analysis path (grep for `playbackRate` in `App.tsx` returns only :4249, :4554, :4770 — all playback/media-session, none analysis).

So detection has **always** run on unshifted source audio and applies no compensation.

**Finding: analysis and playback currently AGREE.** Both operate at source pitch. This is the desirable state and it is the state the code is in.

**The important inversion:** the brief worries that disabling the shift may have desynchronised analysis from playback. The opposite is true. **Restoring `playbackRate = PITCH_SHIFT_FACTOR` would *introduce* the disagreement**, because analysis has no compensating factor and would continue to report source-pitch frequencies while playback ran 1.85% flat (≈ 31.8 cents). Any future restoration of the pitch shift must add compensation to the analysis path, or accept a 31.8-cent mismatch between what is detected and what is heard. **This is a precondition on restoring 432 Hz tuning that does not currently exist in the code.**

### Are Task 2 and Task 5 the same root cause?

The brief asks me to reason carefully about this and not to change anything. **My finding: NOT CONFIRMED — they are almost certainly not the same root cause, and the reasoning in the brief does not survive the measured numbers.**

Evidence *for* the shared-cause hypothesis (the brief's case, which is not unreasonable on its face):

- Both are explicitly framed as debugging experiments in the source. App.tsx:4553 says "TEST: Temporarily disable pitch shifting to isolate distortion source"; App.tsx:1935–1936 says "SIMPLIFIED AUDIO CHAIN FOR PURE SOUND / Create minimal processing chain to eliminate distortion." Both invoke "distortion." They read as two prongs of one investigation.
- Neither was reverted, which is consistent with the investigation being abandoned rather than concluded.

Evidence *against*, which I find decisive:

1. **The missing limiter cannot have caused the distortion, because the bus it would have protected peaks at ≈ 0.083.** A limiter at −0.5 dB never engages at 8% of full scale. Removing an inert node cannot cause distortion, and restoring it cannot fix any.
2. **At the time the chain was bypassed, the music may well have been on the bus** — but that is precisely the point: the architecture has since changed underneath both comments. The direct-playback migration (App.tsx:4453–4462) removed the music from Web Audio entirely. Whatever the original distortion was, **the signal path that produced it no longer exists.** Both comments are archaeology describing a graph that has been dismantled.
3. **`playbackRate` resampling and master-bus clipping are different mechanisms with different signatures.** `playbackRate = 0.981818` invokes the browser's resampler on the element — its artefacts are interpolation-related and independent of level. Clipping is level-dependent and vanishes when you turn down. If the investigator had A/B'd level, they would have separated these immediately; the fact that both were disabled in the same push suggests they did not, which is weak evidence for confusion between them, not for a shared cause.
4. **The music never passed through the limiter even in the old wiring.** Per the comment at App.tsx:2007–2009, the previous wiring fed `limiter` into `destNode` but `limiter had no input`. So the limiter was orphaned on the *input* side before this bypass too. It has apparently never been in the live path in any recent revision.

**Conclusion: restoring the limiter would not enable restoring the pitch shift, because the limiter is inert on the current bus and the music does not traverse it.** If the 432 Hz retuning is wanted back, it should be tested on its own merits — set `playbackRate = PITCH_SHIFT_FACTOR` at both sites and listen — with the understanding from the section above that doing so **desynchronises playback from frequency analysis by 31.8 cents** unless the analysis path is compensated. That analysis mismatch, not the limiter, is the real blocker on restoring 432 Hz tuning.

---

## Additional Finding A — `FrequencySelector` emits a different frequency than playback (HIGH)

**Not in the brief. This directly compromises the planned listening experiment.**

`components/FrequencySelector.tsx:277–284` defines its own `toSubBass` with a **different threshold**:

```js
// Octave-shift frequencies above 963Hz down to sub-bass range (20-60Hz)
const toSubBass = (freq: number): number => {
  if (freq <= 963) return freq;      // ← 963, not 639
  ...
};
```

`App.tsx:2031` uses `if (freq <= 639) return freq;`. The App comment at :2023–2025 documents the change explicitly: *"Threshold was 963 originally; lowered to 639 so the GUT band's upper three positions (741/852/963) also drop to sub-bass during playback."* **The lowering was applied to `App.tsx` and not propagated to `FrequencySelector.tsx`.**

Divergent frequencies:

| UI shows | `FrequencySelector` preview emits | Playback emits | Divergence |
|---|---|---|---|
| 741 Hz | **741 Hz** | 46.3125 Hz | 4 octaves |
| 852 Hz | **852 Hz** | 53.25 Hz | 4 octaves |
| 963 Hz | **963 Hz** | 30.09375 Hz | 5 octaves |

All other frequencies agree (≤ 639 passes through both unchanged; > 963 maps identically under both).

**Why this matters for the experiment:** the brief's stated purpose is *"determining what the app actually emits when the UI displays a given frequency, so a blind listening test can be run against known ground truth."* For three of the nine GUT-band frequencies, the app emits **two different signals depending on which UI surface triggered it** — a full-pitch tone from the selector preview, a sub-bass tone during playback. Any ground truth established via the selector is wrong for 741/852/963.

Two further differences on the preview path, both relevant to calibration:

- **`FrequencySelector` creates its own `AudioContext`** (FrequencySelector.tsx:288–292) and connects `gainNode → context.destination` (:322), entirely outside the App's graph. The preview tone bypasses the master gain, the analyser, and both recorders. It is not capturable by any recording the app can make.
- **Its level is unrelated to playback's.** `testVolume = Math.min(0.1, safetyAssessment.volume * 0.3)` (FrequencySelector.tsx:310) — up to **0.1**, against the playback solfeggio layer's **0.00066**. The preview is up to **151× louder** than the same frequency during playback.

**Recommendation:** align the threshold to 639 in `FrequencySelector.tsx:279`, or better, export the single `toSubBass` from a shared module so the two cannot drift again. Blast radius: **low** — it changes only the preview tone for 741/852/963, bringing it into agreement with playback. It is a one-constant change. Note this *does* change what users hear when previewing those three frequencies, so it is a perceptible change, not a silent refactor.

---

## Additional Finding B — `PITCH_SHIFT_FACTOR` still divides duration (MEDIUM)

**Not in the brief.** Surfaced by the Task 5 grep.

Playback runs at `playbackRate = 1.0`, so wall-clock duration equals `el.duration` exactly. But two live sites still divide by the retuning factor:

- **App.tsx:4365** — `setCurrDuration(el.duration / PITCH_SHIFT_FACTOR);` in the `loadedmetadata` handler.
- **App.tsx:4766** — `const dur = el.duration / PITCH_SHIFT_FACTOR;` feeding `navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(el.currentTime, dur), playbackRate: 1 })`.

Dividing by 0.981818 inflates by a factor of 1.018519. **Every duration the app reports is 1.85% too long** — about 5.6 s on a 5-minute track. These were correct when playback ran at 0.981818; they were not updated when it was set to 1.0.

Three consequences:

1. **Displayed track length is wrong**, and `currTime` (taken raw from `el.currentTime` at App.tsx:2545) is correct — so the progress bar never reaches its own end. The track ends at ~98.2% of the displayed duration.
2. **The lock-screen / car scrubber is wrong** by the same margin (App.tsx:4766–4771). Note the internal inconsistency at :4770: it declares `playbackRate: 1` to the OS while having just divided the duration as though the rate were 0.981818.
3. **It perturbs the phi timing markers, which are on the live audio path.** `currDuration` feeds `getPhiIntensityMultiplier(actualTime, currDuration)` at App.tsx:2553, whose output multiplies both the binaural and solfeggio gains (:2558, :2566). An inflated duration shifts the build/peak/resolution boundaries 1.85% later than intended, so **the emitted layer amplitudes are slightly wrong throughout every track.** Small, but it is a real effect on emitted signal, which puts it inside this audit's priority criterion.

**Recommendation:** while `playbackRate` is 1.0, both sites should use `el.duration` directly. If the pitch shift is ever restored, both should return to dividing — so the cleanest fix is a single `effectiveDuration(el)` helper reading the same rate constant that playback uses, ensuring the two can never disagree again. Blast radius: **low** for the display sites; note that changing `currDuration` also nudges the phi timing boundaries back to their intended positions, which is a (correct) change to emitted audio.

---

## Signal Flow Diagram

Every node from source to output, at **default settings** (`volume = 0.8`, `binauralVolume = 0.03`, `solfeggioVolume = 0.01`, `enablePhiMode = true`, `phiTimingEnabled = true`, `isPlaying = true`, `loShuPerfectGUT` off, `selectedSolfeggio = 396`, desktop).

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║ MUSIC — DIRECT PLAYBACK, NOT IN THE AUDIOCONTEXT                                 ║
╚══════════════════════════════════════════════════════════════════════════════════╝

  <audio> mainAudioRef
    │  src = blob: URL                                     App.tsx:4451
    │  playbackRate = 1.0        (was PITCH_SHIFT_FACTOR)  App.tsx:4554, :4249
    │  volume = volume × 0.18 × duckComp                   App.tsx:2192
    │         = 0.8 × 0.18 × 1.0 = 0.144   (desktop)
    │         = 0.8 × 0.18 × 1.6 = 0.2304  (mobile)
    ▼
  ══► OS MIXER / DEVICE OUTPUT          ← never enters Web Audio
                                          (createMediaElementSource is never called)

╔══════════════════════════════════════════════════════════════════════════════════╗
║ WEB AUDIO GRAPH                                                                  ║
╚══════════════════════════════════════════════════════════════════════════════════╝

  ┌─ SOLFEGGIO LAYER ────────────────────────────────────  App.tsx:2052–2090
  │
  │  OscillatorNode  sine @ toSubBass(applyLoShuPerfectMap(396)) = 396 Hz   :2073
  │    │                                        [> 639 Hz inputs → 30–55 Hz]
  │    ▼
  │  GainNode  ramp → phiVolumes.solfeggio = 0.0091672                      :2082
  │    │       then × getPhiIntensityMultiplier(t) ∈ [0, 1.0]               :2566
  │    │
  └────┼──────────────┐
                      │
  ┌─ BINAURAL LAYER ──┼───────────────────────────────────  App.tsx:2104–2164
  │                   │
  │  OscL sine 200 Hz ─┐                                                    :2125
  │  OscR sine 200+δ ──┤  (R delayed GOLDEN_ANGLE_RAD/(2π·200) = 1.909 ms)  :2157
  │                    ▼
  │              ChannelMerger(2)  L→ch0, R→ch1                             :2139–2140
  │                    │
  │                    ▼
  │  GainNode  = phiVolumes.binaural = 0.0247214                            :2150
  │    │       then × getPhiIntensityMultiplier(t) ∈ [0, 1.0]               :2558
  │    │
  └────┼──────────────┐
                      │
                      ▼
         ┌──────────────────────────┐
         │  gainNodeRef  (MASTER)   │   init 0.7                     :1975
         │  steady state = 0.072    │   = volume × 0.18 × 0.5        :2212
         └───┬───────────┬──────┬───┘   ⚠ 0.7 for one commit at startup
             │           │      │
             │           │      └──────────────► destNodeRef  (MediaStreamDestination)
             │           │                          │                       :2010
             │           │                          │  + music captureStream tap  :5189
             │           │                          ▼
             │           │                       MediaRecorder (video / "both")
             │           │                       ⚠ NO SUB-BASS DRONE
             │           │
             │           └──► visualizerGainRef (2.0) ──► analyserRef       :2001–2002
             │                                              fftSize 512     :1997
             │                                              smoothing 0.92  :1998
             │                                                 │
             │                                                 ▼
             │                                            Visualizer
             │                                            ⚠ live-FFT branch disabled
             │                                              by `if (false && …)`
             │                                              Visualizer.tsx:1214
             │                                              → uses pre-scanned
             │                                                bandEnvelope instead
             │
             │  [WAV recording, only while recording]                       :5143
             ├──────────────► AudioWorkletNode 'wav-capture' ──► sink(0) ──► destination
             │                   ▲  + music captureStream tap  :5144
             │                   ⚠ NO SUB-BASS DRONE
             │
             ▼
      ┌─────────────────┐
      │ ctx.destination │  ◄── peak from master bus: 0.00244
      └─────────────────┘
             ▲   ▲
             │   │
             │   └─── SILENT KEEP-ALIVE ────────────────────  App.tsx:2378–2385
             │          Osc sine → Gain (0.0) ──┘   contributes 0.0
             │
             └─── SUB-BASS DRONE ───────────────────────────  App.tsx:2391–2428
                    ⚠ BYPASSES gainNodeRef ENTIRELY  (:2425)

                    Osc sine @ feltCarrierHz(396) = 49.5 Hz            :2400
                      │                          [glides 8 s on change :2459]
                      ▼
                    amGain  center 0.85, swing ±0.15 → range [0.70, 1.00]  :2406
                      ▲                                    peak 1.00
                      │  a-rate AM
                    lfoGain (0.15) ◄── Lfo sine @ thetaAlphaModHz(396)     :2413
                                          = 6.1875 Hz
                      │
                      ▼
                    gain = volume × SUB_BASS_DRONE_LEVEL                   :2440
                         = 0.8 × 0.10 = 0.08
                      │
                      └──────────────► ctx.destination                     :2425

╔══════════════════════════════════════════════════════════════════════════════════╗
║ ORPHANED — CREATED, NEVER CONNECTED (zero live .connect() repo-wide)             ║
╚══════════════════════════════════════════════════════════════════════════════════╝
   compressorRef   −24 dB, 3:1, knee 30, atk 3 ms, rel 100 ms       :1939–1944
   highShelfFilter −3 dB @ 10 kHz                                   :1947–1950
   limiter         −0.5 dB, 20:1, knee 0, atk 0, rel 10 ms          :1953–1958
   lowPassFilter / notchFilter / deEsserFilter / vocalFilter        :1961–1964
   mediaSourceRef  declared :1604, never assigned  (no createMediaElementSource)

╔══════════════════════════════════════════════════════════════════════════════════╗
║ SEPARATE AUDIOCONTEXT — FrequencySelector preview  (Additional Finding A)        ║
╚══════════════════════════════════════════════════════════════════════════════════╝
   Osc sine @ toSubBass_963(freq) ──► Gain (≤ 0.1) ──► its own ctx.destination
                    ▲                                  FrequencySelector.tsx:288–322
                    └── threshold 963, NOT 639 → 741/852/963 preview at FULL PITCH
```

### Amplitude budget at `ctx.destination`

| Source | Gain chain | Peak |
|---|---|---|
| Solfeggio osc | 0.0091672 × 0.072 | 0.00066 |
| Binaural (merged) | 0.0247214 × 0.072 | 0.00178 |
| Sub-bass drone | 0.08 × 1.00 (AM peak), **direct** | 0.08000 |
| Silent keep-alive | 0.0 | 0.00000 |
| **Web Audio total (coherent worst case)** | | **0.08244** |
| Music (separate, at OS mixer) | 0.8 × 0.18 × duckComp | 0.144 / 0.230 |

**Headroom: ~21.7 dB on the Web Audio bus. No clipping at defaults. The sub-bass drone is 97.0% of the Web Audio output and is absent from every recording the app produces.**

---

## Priority order

| # | Finding | Task | Severity | Fix size |
|---|---|---|---|---|
| 1 | Sub-bass drone absent from **both** recording paths — all exports omit 97% of synthesized output | 3 | **HIGH** | 1–4 lines |
| 2 | `FrequencySelector` preview emits a different frequency than playback for 741/852/963 | F-A | **HIGH** | 1 constant |
| 3 | 21/27 frequencies put two oscillators on one frequency; signal not bit-reproducible across sessions | 4 | MEDIUM | design decision |
| 4 | `PITCH_SHIFT_FACTOR` still inflates duration by 1.85%, perturbing phi timing markers | F-B | MEDIUM | 2 lines |
| 5 | Restoring 432 Hz tuning would desync playback from analysis by 31.8 cents (no compensation exists) | 5 | MEDIUM | precondition, not a bug |
| 6 | `gainNodeRef` startup transient — layers at 0.7 for one commit before dropping to 0.072 | 2 | LOW | 1 line |
| 7 | No clamp in `integratePhiVolumes`; `music` return value dead at all 4 sites | 1 | LOW | cosmetic |
| 8 | Orphaned filter nodes — all inert given what is actually on the bus | 2 | LOW | cleanup only |
| 9 | Unreachable `if (f < 20)` guard in both `toSubBass` copies | 4 | LOW | cosmetic |

**For the listening experiment specifically, #1 and #2 are blocking.** #1 means no recording made by the app is a valid record of what it emits; #2 means the frequency shown in the selector is not the frequency played back for three of the nine GUT-band positions. Everything else can be characterised around.
