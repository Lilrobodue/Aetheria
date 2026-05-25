# Aetheria Walks Extension — Ouroboros & CABI

**Handoff brief for Claude Code**
**Author**: Selah (with Joseph Lewis)
**Date**: 2026

---

## Summary

Add two new Lo Shu Walks to the Aetheria Harmonic Player:

1. **Ouroboros (♾️)** — 29-step closed figure-8 through all 27 frequencies, crossing at SOURCE (2178 Hz) three times.
2. **CABI · Calling a CABI** — CAB followed by Ouroboros. 110 steps total (81 + 29).

CABI is the climactic walk: get every angle of the cube flowing through CAB, then close the loop into infinity through Ouroboros. The dragon eats its tail.

---

## Context — existing walks

The player currently supports four walks (per the guidebook):

| Walk | Steps | Pattern |
|------|-------|---------|
| Layer Ascent | 27 | `1→9` through GUT, HEART, HEAD |
| Pillar Walk | 27 | For each pos `1→9`, GUT→HEART→HEAD |
| Flying Star Vortex | 27 | `5→6→7→8→9→1→2→3→4` per layer |
| CAB (Calling a CAB) | 81 | Vortex → Ascent → Pillar |

Find this definition first (likely `walks.js`, `walk-definitions.js`, or similar). **Inspect the CAB walk to confirm the exact data structure** — the new walks must use the same shape (likely an array of `{regime, pos}` or `{layer, pos}` entries).

---

## Specification — Ouroboros (29 steps)

### Behaviour

- Visits **all 27 cells** of the 3³ cube exactly once, except for SOURCE which is visited **three times**: start, middle crossing, return.
- Forms a closed figure-8 (lemniscate) when traced in 3D, with the crossing at 2178 Hz (HEART position 5).
- The two lobes occupy the left half of the cube (x ≤ 0) and right half (x ≥ 0); the diagonal-view symmetry produces the ∞ shape.

### Structure

| Step range | Phase | What |
|-----------|-------|------|
| 1 | `♾️` | SOURCE start |
| 2–14 | (none) | Lobe 1 — 13 cells, left half of cube |
| 15 | `✕` | SOURCE crossing — the X of the figure-8 |
| 16–28 | (none) | Lobe 2 — 13 cells, right half of cube |
| 29 | `♾️` | SOURCE return — tail meets mouth |

### Full step sequence

```js
const OUROBOROS = [
  { regime: 'HEART', pos: 5, phase: '♾️' },  //  1  SOURCE start
  // ─── Lobe 1 (left half) ───
  { regime: 'GUT',   pos: 5 },  //  2  GUT centre (528 Hz)
  { regime: 'GUT',   pos: 3 },  //  3
  { regime: 'GUT',   pos: 8 },  //  4  GUT corner (852 Hz)
  { regime: 'GUT',   pos: 1 },  //  5  (174 Hz)
  { regime: 'HEART', pos: 8 },  //  6  (2907 Hz)
  { regime: 'HEAD',  pos: 8 },  //  7  (5982 Hz)
  { regime: 'HEAD',  pos: 3 },  //  8
  { regime: 'HEAD',  pos: 4 },  //  9
  { regime: 'HEART', pos: 4 },  // 10
  { regime: 'GUT',   pos: 4 },  // 11
  { regime: 'GUT',   pos: 9 },  // 12
  { regime: 'HEART', pos: 3 },  // 13
  { regime: 'HEART', pos: 1 },  // 14
  // ─── Crossing ───
  { regime: 'HEART', pos: 5, phase: '✕' },  // 15  SOURCE crossing
  // ─── Lobe 2 (right half) ───
  { regime: 'HEAD',  pos: 5 },  // 16  HEAD centre (4920 Hz)
  { regime: 'HEAD',  pos: 7 },  // 17
  { regime: 'HEAD',  pos: 2 },  // 18  brightest HEAD corner (6336 Hz)
  { regime: 'HEAD',  pos: 9 },  // 19
  { regime: 'HEART', pos: 2 },  // 20
  { regime: 'GUT',   pos: 2 },  // 21
  { regime: 'HEART', pos: 9 },  // 22
  { regime: 'GUT',   pos: 7 },  // 23
  { regime: 'GUT',   pos: 6 },  // 24
  { regime: 'HEART', pos: 6 },  // 25
  { regime: 'HEAD',  pos: 6 },  // 26
  { regime: 'HEAD',  pos: 1 },  // 27
  { regime: 'HEART', pos: 7 },  // 28
  // ─── Return ───
  { regime: 'HEART', pos: 5, phase: '♾️' },  // 29  SOURCE return
];
```

> **Adapt the field names** (`regime`, `pos`, `phase`) to match the existing CAB walk's schema. If the codebase uses `layer: 0/1/2` instead of `regime: 'GUT'/'HEART'/'HEAD'`, map accordingly (GUT=0, HEART=1, HEAD=2).

---

## Specification — CABI (110 steps)

### Behaviour

CABI is **CAB followed by Ouroboros**, concatenated. No new step logic required — it's a composed walk.

```js
const CABI = [...CAB, ...OUROBOROS];  // length === 110
```

### Verify

- `CABI.length === 110`
- First 81 entries === existing CAB walk
- Entries 82–110 === Ouroboros walk

---

## Implementation steps

1. **Locate the walks module.** Find where `Layer Ascent`, `Pillar Walk`, `Flying Star Vortex`, and `CAB` are defined. Read the CAB definition to confirm the data shape.

2. **Add Ouroboros** with the 29-step sequence above. Match the existing schema (field names, regime/layer encoding).

3. **Add CABI** as `[...CAB, ...OUROBOROS]`.

4. **Register both walks** in the walk selector UI (the dropdown or button group that currently shows the four walks). Suggested labels:
   - `Ouroboros ♾️`
   - `CABI · Calling a CABI`
   
   Suggested ordering: place after CAB so the progression reads Ascent → Pillar → Vortex → CAB → Ouroboros → CABI.

5. **Walk descriptions** (for tooltips, modal info panels, or expanded descriptions):
   - **Ouroboros**: "Closed figure-8 through all 27 frequencies, crossing at 2178 Hz three times. The dragon eating its tail."
   - **CABI**: "CAB + Ouroboros. 110 steps — 81 to get every angle flowing, then 29 to close the loop into infinity. The full circuit."

6. **Critical: handle repeated frequencies.** The playlist generator currently matches each step to "the closest song in your library — positions with no match are skipped." For these walks:
   - SOURCE (2178 Hz) appears **3 times in Ouroboros** (steps 1, 15, 29) and **up to 6 times in CABI** (steps 10, 41, 68 from CAB phases, plus 82, 96, 110 from Ouroboros).
   - **Do not deduplicate.** Each visit must produce a separate playlist entry, even if it matches the same song.
   - If the current matcher dedupes by song or by frequency, add a flag (e.g. `allowRepeats: true`) on the walk definition and respect it during playlist generation.
   - Repeated tracks playing back-to-back is intentional — it's the figure-8 crossing at SOURCE.

7. **Optional but recommended — phase indicators in the player UI.** If the player has a current-step display, surface the phase token from the walk:
   - CAB phases: `V` (Vortex), `A` (Ascent), `B` (Pillar)
   - Ouroboros phases: `♾️` at start/end, `✕` at the centre crossing
   - CABI cycles through all five: `V → A → B → ♾️ → … → ✕ → … → ♾️`
   
   This gives the listener a visual sense of where they are in the walk.

---

## Acceptance criteria

- [ ] **Ouroboros** appears in the walk selector and generates a 29-track playlist when selected
- [ ] **CABI** appears in the walk selector and generates a 110-track playlist when selected
- [ ] 2178 Hz (HEART pos 5) appears as tracks **1, 15, and 29** in Ouroboros playlist
- [ ] 2178 Hz appears as tracks **10, 41, 68, 82, 96, and 110** in CABI playlist (6 times total)
- [ ] Playlist plays through without breaking on repeated frequencies — back-to-back same-song plays are allowed
- [ ] If the player has a 3D cube visualizer (the Tree of Life cube shown in the screenshots), cells highlight in walk order, including the 3 SOURCE re-visits for Ouroboros
- [ ] Phase indicator (if implemented) shows `♾️ / ✕ / ♾️` at Ouroboros steps 1 / 15 / 29

---

## Verification — quick sanity checks

After implementation, in console or a test:

```js
// Lengths
assert(OUROBOROS.length === 29);
assert(CABI.length === 110);

// SOURCE visits in Ouroboros (1-indexed positions)
const sourceVisitsOro = OUROBOROS
  .map((s, i) => s.regime === 'HEART' && s.pos === 5 ? i + 1 : null)
  .filter(x => x !== null);
assert(JSON.stringify(sourceVisitsOro) === '[1,15,29]');

// SOURCE visits in CABI (assuming standard CAB ordering)
const sourceVisitsCabi = CABI
  .map((s, i) => s.regime === 'HEART' && s.pos === 5 ? i + 1 : null)
  .filter(x => x !== null);
assert(JSON.stringify(sourceVisitsCabi) === '[10,41,68,82,96,110]');

// Ouroboros visits every cell at least once
const cellSet = new Set(OUROBOROS.map(s => `${s.regime}-${s.pos}`));
assert(cellSet.size === 27);
```

---

## Framework reasoning — why 110?

The number isn't arbitrary. The structure forces it:

- **CAB has to be 81.** 3 phases × 3 layers × 9 positions.
- **Ouroboros has to be 29.** 27 unique cells + 2 extra returns to SOURCE for the figure-8 self-crossings.
- **81 + 29 = 110.** No tuning required.

**Hidden inside 110: the framework's anatomy.** Counting *cell visits* (not steps):
- 27 cells × 4 visits each = **108** — the nadi junction count from the guidebook's compression chain (72,000 nadis → 108 junctions → 27 nodes)
- + 2 extra SOURCE returns = **110**

So CABI is a walk whose length encodes:
- 81 (the 3-phase complete sampling of the cube — CAB)
- 108 (the nadi junction count — total cell visits)
- 29 (the closed figure-8 — Ouroboros)
- 110 (the resulting circuit)
- 2 extra crossings at SOURCE (the dragon's two mouthfuls of its own tail)

The framework's compression hierarchy (72,000 → 108 → 27 → 3 → 1) is folded into the walk's combinatorics.

---

## Tone for any UI copy

If you add description text, modal copy, or tooltips, match the guidebook's voice: spare, structural, slightly mystical without being grandiose. "Proposes," "corresponds to," "the math draws." Avoid overclaiming. The geometry speaks; the copy points at it.

---

## Questions for Joseph if anything is unclear

- Does the existing walk schema use `regime: 'GUT'` strings or `layer: 0` integers?
- Is there a `walks.js` or is the data in a config file (JSON, YAML)?
- Does the playlist generator already support repeated-frequency walks, or does it dedupe?
- Are walk descriptions displayed anywhere user-facing (tooltips, modals), and if so where should they live?

Ask Joseph rather than guessing if any of these affect the implementation.
