# utils/soundV2 — Aetheria Sound v2 in the web app

The v2 layer engine behind the "Layer sound: v2 / classic" A/B switch (v14.9; the default since
v15.0, after the user's by-ear A/B on headphones; classic stays selectable). Three files here are a
vendored package; the rest is the web app's own code around it.

| File | What it is |
|---|---|
| `aetheria_sound_v2.ts`, `check_vectors.ts`, `test_vectors.json` | **Vendored**, byte for byte (below) |
| `layerSchedule.ts` | ParamTrack (a JS mirror of each AudioParam's automation), the player's clock, the drone duty in continuous time, the drone gate's points, the retune key |
| `layerPlayer.ts` | The v2 layer player: one Web Audio graph per context, built once, driven only through ParamTracks |
| `layerHost.ts` | What App needs around it: the persisted A/B choices, crystal resolution, output → render, sliders and dB, band hysteresis, the music level the layers follow |
| `soundLog.ts` | The sound log (localStorage, budgeted), exported from Harmonic Control |
| `keyFit.ts` | Key fit (v15.2): the fit of the canonical tone against the playing track's key data (v2's own `musicFit`), its cache and copy view, and `KeyFitDuck`, the gain the v2 layers play through |
| `*.check.ts` | Node checks, run by `npm run check:sound` |

## The vendored package

Source: `D:/Psi-Ops The Mindgate Conspiracy MajorGeeks`, folder `docs/aetheria-sound/`, commit
`832cb7e4ed9b01720176e98b23d91a49526c5dcb` (2026-10-18). The pins are SHA-256 of the
**LF-normalised** bytes (git stores LF; with `core.autocrlf=true` a checkout may be CRLF, which
Node, tsc and the pin check all accept):

| File | Bytes (LF) | Lines | git blob | SHA-256 (LF-normalised) |
|---|---|---|---|---|
| `aetheria_sound_v2.ts` | 21,597 | 522 | `0c9ca784ec30c4e572c32761babd5b0a3bc3c938` | `6e89330c6a2d908b1179cb41cb4bca279c652e6eb859f9a8904b165d9a6e8711` |
| `check_vectors.ts` | 8,252 | 147 | `77b392eaf47c11ac837162b587c05f825a5be2d2` | `aa75e9e7c93c7bb6c53f2dd2c10d10943c524f7a8ac0d8c014d2f465e32a3f95` |
| `test_vectors.json` | 361,416 | 1,084 | `9d4939ec1a5954b8f964734df0a08937a119b262` | `1a68687e4187023584930c8224d79ad0399666395f0f05cc13c61110bfc2cff4` |

- **Never edit, format or `lint --fix` these three files.** `check_vectors.ts` reads
  `test_vectors.json` from its own folder, so the three always sit together.
- **Re-vendor all three together**, from Git Bash only (PowerShell 5.1's `>` writes a BOM and CRLF,
  and the pin no longer matches), then update the pins in this README **and** in the checks that
  verify them (`layerSchedule.check.ts`, and `layerPlayer.check.ts`):

  ```bash
  R="D:/Psi-Ops The Mindgate Conspiracy MajorGeeks"
  for f in aetheria_sound_v2.ts check_vectors.ts test_vectors.json; do
    git -C "$R" show "<commit>:docs/aetheria-sound/$f" > "utils/soundV2/$f"
  done
  for f in utils/soundV2/aetheria_sound_v2.ts utils/soundV2/check_vectors.ts utils/soundV2/test_vectors.json; do
    printf '%s ' "$f"; tr -d '\r' < "$f" | sha256sum
  done
  node utils/soundV2/check_vectors.ts   # aetheria_sound_v2.ts: 8898 checks passed, 0 failed
  ```
- **Any mapping change happens first in the D: package**, in all three of its implementations —
  TypeScript (`docs/aetheria-sound/aetheria_sound_v2.ts`), Python
  (`docs/aetheria-sound/make_test_vectors.py`, which writes the vectors) and GDScript
  (`sandbox/audio/tone_layers.gd`, the game) — and is then re-vendored. Never patch it here.
- What app and player code may import from `aetheria_sound_v2.ts`: `plan`, `toneOf`, `carrierOf`,
  `frequencyOf`, `BANDS`, `BAND_ORDER`, `bandForIntensity`, `phiEnvelope`, `SOLFEGGIO`,
  `PERFECT_GUT`, `HEART`, `HEAD`, the `LEVEL_*`, `MOD_DEPTH`, `GATE_*` and `DRONE_*` constants,
  `VERSION`, `musicFit` and `DUCK_DB` (Key fit, v15.2: `keyFit.ts` only), and the types `Plan`, `Band`, `Output`,
  `Fit` (with `import type`). Not `PHI` / `INV_PHI` in
  App (it has its own, from `phiIntegration`). Rollup tree-shakes the rest out of the bundle;
  `test_vectors.json` is never imported by app code.
- **The vendored `LayerGraph` is not used**, and app and player code never import `LayerGraph`,
  `DroneDuty` or `signature` (checks may, as negative controls). Its fades rely on
  `cancelAndHoldAtTime` (LG-01, measured in Chrome 155 and Edge 155): a settled gate's 0.8 s
  fade-out stepped 1 → 0.0966 at once, and the vendored graph's retune dropped −19.5 dB in its
  first 25 ms. The player instead anchors every change on a mirror of what it scheduled
  (`layerSchedule.ts`: value first, cancel 1.5 frames later, never `cancelAndHoldAtTime`, never
  `AudioParam.value`). The production bundle must contain no `cancelAndHoldAtTime`, `LayerGraph`
  or `__aetheriaLayers`.

## Running the checks

`npm run check:sound` runs the vendored package's 8,898 vector checks and this folder's checks with
plain `node`, which needs **Node ≥ 22.18** (it runs `.ts` by stripping types). The deploy workflow
(Node 22 since v15.0.1) only builds, so the checks stay a local gate before every push. Everything Node runs here is
erasable TypeScript: no enums, namespaces, parameter properties or decorators; type-only imports
are separate `import type` lines; relative imports carry `.ts`; nothing imports `types.ts` or
`constants.ts` at run time (`types.ts` exports an enum).

`layerPlayer.check.ts` plays every scenario on three simulated engines written from the Web Audio
spec (E-blink applies each call on its own and re-times a task's past events to its render position;
E-gecko rounds times to frames and applies a task as one batch; E-ideal is exact), with ticks of 1 s,
60 s and none, and the engine 20 ms behind to 300 ms ahead of the player's clock: about 2,000 runs in
7 s. `--only=S13` runs the scenarios whose names start with S13; `--timing` prints each scenario's
time. Its engines are models: no real browser runs them (the dev page does, in Chrome and Edge). It also
runs Key fit's duck through E-blink and E-gecko at every lag, held to the same A1 bounds.

`keyFit.check.ts` (v15.2) checks Key fit: `keyFitFor` is `musicFit` bit for bit at the heard A4 (the
track's own A4 × the app's 0.981818 retune) and the canonical tone of the plan output, with pinned
literals on synthetic fixtures; no key data means no duck; the content-keyed cache; the view and the
copy; the duck's automation on a fake engine (anchors and glides only, never −0, a rise held for a
retune, `holdRise`, a fall in silence landing at once, unity always sent back exactly); its continuity
under an evaluator of its own; and no swell where a duck rise meets a fall (the real player and duck
driven the way App drives them: a host glide, a pause, a stop, leaving v2, a retune, a drone rest, a
layer faded to off by the user in either order, a rest where a held rise starts, a track change measured
from its commit), each scenario with a control that must swell, and no layer opening above the level it
settles at when a fall is sent in silence.

## In the app

- **v2 is the default (v15.0); classic, once chosen, plays exactly as v14.8**: in classic App never
  creates the player and makes no player calls. Nothing below is written until the user taps; a tap
  on the already-pressed default is not a choice (nothing is saved, so the profile keeps following
  the release default). An unset profile asks for its output when the v2 layers are first wanted (a
  play or a tone with Music only off), in a sheet between the header and the player bar.
- The choices: `aetheria.layerEngine.v1` (`classic` | `v2`), `aetheria.layerOutput.v1` (asked once, in
  v2), `aetheria.droneEnabled.v1`; the sound log `aetheria.soundSessions.v1` runs only once an engine
  has been chosen (Harmonic Control → Export sound log).
- "Ask me again" (v15.0) keeps `aetheria.layerOutput.v1` in effect and sets
  `aetheria.layerOutputAskAgain.v1` = `1` until a new answer, across restarts, so a saved Car never
  falls back to headphones while the question waits.
- The tone level, per engine (v15.0): `aetheria.toneLevelV2.v1` and `aetheria.toneLevelClassic.v1`,
  each written only when the user moves that engine's slider; unset, v2 starts at the lowest step
  before off (0.0005: −26.0 dB, −52.0 dB re music) and classic at its 1 %. 0 dB on the v2 slider
  stays 0.01, the validated −26 dB under the music.
- App drives the player from effects after each commit (never from the pinned playback paths): `play()`
  on plan changes, `setBeat()` on band steps, `setLayerGains()` from the sliders, `setHostLevel()` from
  a 250 ms tick while layers are wanted. Leaving v2 fades the layers at once and disposes the player 3 s
  later; the next player resumes the drone duty.
- **Key fit (v15.2, v2 only, off by default; `aetheria.keyFit.v1`, written only from its switch):** the
  player plays into one `KeyFitDuck` per context, which lowers the tone, beat and drone together by 0 to
  6 dB where the canonical tone would rub against the playing track's key data (none without key data, for
  an unclear key, or for the tone alone), gliding with τ 2 s, or 0.05 s when the switch flips; the music
  never passes through it, and classic never makes it. It is driven only by ParamTrack anchors and glides
  and sends nothing while the layers aren't wanted. A duck rise waits for the falls App knows of: a
  retune's silence, a resting drone's close, a drone rest about to start (checked again where a held rise
  starts), a layer the user fades to off (the drone switch, a slider to 0), a track change until the level
  tick has seen it, and for the switch a host glide in progress; a rise in flight stops when a pause, a
  stop, leaving v2, a retune, a seek, a track change or a fade to off begins. A fall sent while both gates
  are shut lands at once, so the layers never open above their ducked level. Not covered: a volume drag
  or a slider lowered (not to 0) while a switch's rise is in flight, a level change rather than a close.
- The UI lives in `components/layers/` (prop-driven, copy in `layerCopy.ts`, checked by
  `layerHost.check.ts` and `keyFit.check.ts`). Dev builds expose `window.__aetheriaLayers` (`state()`,
  `created()`, `mobile`, and since v15.2 `keyFit()`, the duck's state, and `glideUntil()`, the level
  tick's host-glide window end in `performance.now()` ms) for the e2e suite; production builds strip it.

## Where v2 deliberately differs from the GDScript reference

- Pause closes the gates (tone and beat 0.8 s, drone 3 s); GDScript fades a τ 1 s gain.
- The beat snaps to its target at a retune (it glides, τ 3 s, only between equal voices).
- The drone duty counts intended drone time (20 min on, then a 10 min rest; 10 min of quiet starts
  it again).
- The host's 1.5 s linear jump shortens the drone's 3 s out-fade at same-crystal track changes and
  seeks.
- v2's build phase is 1.94 dB below classic's (classic uses 0.8·(p/0.382)^φ), so "equal to classic at
  volume 0.8" holds only after 38.2 % of a track.
- The drone follows the φ envelope like every v2 layer, so it is nearly absent in each track's
  first third.
- On a phone with music playing, v2's tone and beat sit 2.15 dB below classic's at volume 0.8:
  classic's layer bus has no mobile factor, while v2 follows the music's assumed duck under the
  silent anchor (1/1.6, unmeasured). They match near volume 0.71, where the phone's music is
  unchanged (its element is already at full volume above 0.625).
- Tone only (no music) plays at volume × the validated level on every device: no music and no
  anchor, so no duck to follow (the v14.6 first-tap level, 0.0501 × 0.8 = 0.0401 peak).
- Leaving v2 for more than 3 s disposes the player, and the next one resumes its drone duty, so an
  engine flip counts as quiet time, like a pause.

## The dev page (`tools/sound-check.html`, never built)

Renders the player offline in the browser and checks clicks, silence, levels, frequencies and the
drone duty against the designed curves, with Listen buttons for by-ear checks on headphones.

- **Users:** `npm run dev`, then open `/tools/sound-check.html` **in a private window**. The app's
  service worker stores every navigation response as the offline shell `/`
  (`public/sw.js`, navigation handler), so opening the page in a window the worker controls makes
  it the cached app shell. The page warns when a worker controls it.
- **Agents:** never the default Vite config or cache in a shared checkout. Start your own server
  on a port in 3201–3209 — `createServer({ configFile: false, root: '<repo>', cacheDir:
  '<scratch>/vite-cache', server: { port: 3201, strictPort: true } })` — and drive it with
  `chromium.launch({ channel: 'chrome' | 'msedge' })` from `e2e/node_modules/@playwright/test`. The
  e2e suite also runs it (Chrome and Edge, desktop only). Firefox is not installed on this PC.
- **What it ends with:** `ALL PASS (46)` in Chrome and Edge (22 rows per mode, virtual clock and
  suspend, plus C14b, which runs on the virtual clock only, and the LayerGraph control), in about 18 s;
  an engine without `OfflineAudioContext.suspend` (Firefox) runs the 23 virtual-clock rows only. Key fit
  (v15.2) adds C14 (the duck alone: its render is its gain curve), C14b (the duck on the layers, and the
  same session with no duck bit-identical to a duck never sent anything), C15 / C15b (no swell where
  a duck rise meets a host glide, a pause, leaving v2, a stop or a drone rest, including a rise held to
  a glide's end that falls inside a rest) and C15c (a layer the user fades to off with the switch inside
  the fade, in both orders). C13c pauses right
  after a seek's 1.5 s host jump, with App's resends left pending: the jump must stop there (a
  player that let it run on swelled the closing drone +3.4 dB in both browsers).
- **What it found** (Chrome 155 and Edge 155): the renders follow the designed curves to within
  0.01 % of each layer's level. Both engines compute `setTargetAtTime` as a float32 recurrence
  unrolled by 4, which stalls short of its target: a beat glide's partner (329.5 → 325.5 Hz,
  τ 3 s) holds 326.049 Hz from about 6 s in until 10 τ (30 s), then snaps to 325.5 Hz — so for
  ~24 s after each beat change the binaural beat is ~0.55 Hz off (no click: an oscillator's phase
  stays continuous). C8 checks the glide's τ over its first 3 s and reports the stall; C3 and C4
  take the two glided oscillators' phases from the render.
- **What C14 found** (v15.2, Chrome 156 and Edge 155, both modes): Key fit's duck follows its designed
  exponentials to within 3.1e-5 over each glide's first 3 τ; the same recurrence leaves a τ 2 s rise
  7.15e-4 short of unity (0.006 dB) until 10 τ, where it snaps there (no click: 0.72 of C14's step bound).
