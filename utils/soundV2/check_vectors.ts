/**
 * Checks aetheria_sound_v2.ts against test_vectors.json:
 *
 *     node docs/aetheria-sound/check_vectors.ts
 *
 * Node 22.18 or later runs TypeScript as it is (type stripping). Exits 1 on any mismatch.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "./aetheria_sound_v2.ts";

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(readFileSync(join(here, "test_vectors.json"), "utf8"));
let passed = 0;
const failures: string[] = [];

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(V.tolerance.absolute, V.tolerance.relative * Math.max(Math.abs(a), Math.abs(b)));
}

function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}

const C = V.constants;
check(JSON.stringify(C.canonical_hz) === JSON.stringify(S.CANONICAL_HZ), "the 33 canonical frequencies");
check(JSON.stringify(C.bands) === JSON.stringify(S.BANDS) && JSON.stringify(C.floors) === JSON.stringify(S.FLOORS), "bands and floors");
const scalars: [string, number][] = [
  ["tone_lo", S.TONE_LO], ["tone_hi", S.TONE_HI], ["carrier_lo", S.CARRIER_LO], ["carrier_per_beat", S.CARRIER_PER_BEAT],
  ["drone_lo", S.DRONE_LO], ["pulse_lo", S.PULSE_LO], ["level_tone", S.LEVEL_TONE], ["level_beat", S.LEVEL_BEAT],
  ["level_drone_sub", S.LEVEL_DRONE_SUB], ["level_drone_audible", S.LEVEL_DRONE_AUDIBLE], ["mod_depth", S.MOD_DEPTH],
  ["duck_db", S.DUCK_DB], ["sham_start_cents", S.SHAM_START_CENTS], ["sham_min_cents", S.SHAM_MIN_CENTS],
  ["drone_on_s", S.DRONE_ON_S], ["drone_rest_s", S.DRONE_REST_S],
];
for (const [k, v] of scalars) check(C[k] === v, `constant ${k}`);

for (const c of V.plans) {
  check(S.frequencyOf(c.id, c.scale) === c.f, `frequencyOf ${c.scale} ${c.id}`);
  const p = S.plan(c.f, c.output, c.beat_mode, S.BANDS[c.band as S.Band], c.arm);
  const tag = `plan ${c.scale} ${c.id} ${c.output} ${c.band} ${c.arm}`;
  if (!p) {
    check(false, tag + ": no plan");
    continue;
  }
  for (const k of ["canonical_hz", "sounding_hz", "tone_hz", "carrier_hz", "partner_hz", "beat_hz", "drone_hz", "pulse_hz", "level_tone", "level_beat", "level_drone"]) {
    check(near((p as unknown as Record<string, number>)[k], c[k]), `${tag}: ${k} ${(p as unknown as Record<string, number>)[k]} != ${c[k]}`);
  }
  check(p.sham_cents === c.sham_cents && p.drone_k === c.drone_k && p.drone_sub === c.drone_sub, `${tag}: cents, k, sub`);
}
check(S.plan(528, "headphones", "binaural", 10, "off") === null && S.plan(0, "headphones", "binaural", 10) === null, "nothing sounds off, or with no frequency");

for (const q of V.pitch) {
  check(near(S.canonicalDistanceCents(q.f), q.canonical_distance_cents) && S.shamCents(q.f) === q.sham_cents, `sham of ${q.f}`);
  check(near(S.canonicalDistanceCents(q.f * Math.pow(2, q.sham_cents / 1200)), q.sham_distance_cents), `sham distance of ${q.f}`);
}
for (const q of V.fit) {
  const r = S.musicFit(q.tone_hz, V.chromas[q.chroma], q.a4, q.key_confidence);
  check(near(r.rel, q.rel) && near(r.strength, q.strength) && near(r.duck_db, q.duck_db), `fit ${q.chroma} ${q.f} ${q.a4}: ${r.duck_db} != ${q.duck_db}`);
}
for (const e of V.envelope) check(near(S.phiEnvelope(e.position, e.duration), e.value), `envelope ${e.position}`);
for (const b of V.intensity_bands) check(S.bandForIntensity(b.intensity) === b.band, `intensity ${b.intensity}`);
for (const h of V.heart_bands) check(S.bandForHeart(h.live, h.adrenaline, h.resonance) === h.band, `heart ${JSON.stringify(h)}`);
for (const d of V.outputs_guessed) check(S.guessOutput(d.device, d.devices, d.mobile) === d.output, `output ${JSON.stringify(d)}`);
for (const f of V.fold) check(near(S.fold(f.x, f.lo), f.value), `fold ${f.x} ${f.lo}`);
for (const r of V.roughness) check(near(S.roughness(r.f1, r.f2), r.value), `roughness ${r.f1} ${r.f2}`);

// The rules the vectors embody, checked directly too.
let canon = true;
let torso = true;
for (const c of V.plans) {
  const layers = [c.tone_hz, c.carrier_hz, c.drone_hz].filter((x: number) => x > 0);
  if (c.arm === "on") canon = canon && layers.every((x: number) => Number.isInteger(Math.log2(x / c.f)));
  torso = torso && [...layers, c.partner_hz].every((x: number) => x < S.TORSO_LO || x >= S.TORSO_HI);
}
check(canon, "on: every layer is an exact octave of the canonical frequency");
check(torso, "nothing sustained in 50-100 Hz");

const duty = new S.DroneDuty();
let rested = false;
for (let t = 0; t < S.DRONE_ON_S + 1; t += 1) rested = duty.tick(1, true) || rested;
check(rested && duty.resting, "the drone rests after 20 minutes");
for (let t = 0; t < S.DRONE_REST_S + 1; t += 1) duty.tick(1, false);
check(!duty.resting && duty.onS === 0, "and comes back after 10");

// The Web Audio graph against a mock context that records the automation, so the schedule (a
// retune closes the gates, retunes in the silence, opens them again) is checked without a browser.
class MockParam {
  value: number;
  events: [string, number, number][] = [];
  constructor(v: number) { this.value = v; }
  setValueAtTime(v: number, t: number) { this.events.push(["set", v, t]); return this; }
  linearRampToValueAtTime(v: number, t: number) { this.events.push(["ramp", v, t]); return this; }
  setTargetAtTime(v: number, t: number) { this.events.push(["set", v, t]); return this; }
  cancelScheduledValues(t: number) { this.events = this.events.filter((e) => e[2] < t); return this; }
  cancelAndHoldAtTime(t: number) { const v = this.at(t); this.cancelScheduledValues(t); this.events.push(["set", v, t]); return this; }
  at(t: number): number {
    let v = this.value;
    let pt = 0;
    for (const [kind, ev, et] of [...this.events].sort((x, y) => x[2] - y[2])) {
      if (et > t) {
        if (kind === "ramp") return v + ((ev - v) * (t - pt)) / Math.max(1e-9, et - pt);
        break;
      }
      v = ev;
      pt = et;
    }
    return v;
  }
}
const node = () => ({ connect: (n: unknown) => n });
const mock = {
  currentTime: 0,
  destination: node(),
  createGain: () => ({ ...node(), gain: new MockParam(1) }),
  createOscillator: () => ({ ...node(), type: "sine", frequency: new MockParam(440), start() {}, stop() {} }),
  createChannelMerger: () => node(),
};
const graph = new S.LayerGraph(mock as unknown as BaseAudioContext);
const g = graph as unknown as Record<string, { gain?: MockParam; frequency?: MockParam }>;
const p528 = S.plan(528, "headphones", "binaural", 10)!;
graph.play(p528);
graph.setLevel(1);
check(Math.abs(g.gate.gain!.at(3) - 1) < 1e-9 && g.tone.frequency!.at(1) === 528, "LayerGraph: the first plan opens to 528 Hz within 2.5 s");
check(g.toneLevel.gain!.at(3) === p528.level_tone && g.beatLevel.gain!.at(3) === p528.level_beat, "and the levels are the plan's");
mock.currentTime = 10;
const p639 = S.plan(639, "headphones", "binaural", 10)!;
graph.play(p639);
for (let i = 0; i < 20; i++) graph.setLevel(1); // a host updating every frame
const ga = g.gate.gain!;
const dg = g.droneGate.gain!;
check(ga.at(10.4) > 0 && ga.at(10.4) < 1 && ga.at(10.8) === 0 && ga.at(13.02) === 0, "a retune closes the gate (0.8 s) and keeps it shut until the drone's gate has closed too");
check(dg.at(13.0) === 0 && g.tone.frequency!.at(13.0) === 528 && g.tone.frequency!.at(13.03) === 639, "the frequency changes only in the silence");
check(Math.abs(ga.at(15.52) - 1) < 1e-9 && dg.at(17) > 0 && dg.at(17) < 1 && Math.abs(dg.at(21.02) - 1) < 1e-9,
  "then the gates open: 2.5 s, the drone over 8 s (the host's every-frame level calls never cut the fade)");
mock.currentTime = 30;
graph.setDroneResting(true);
check(dg.at(31.5) > 0 && dg.at(33) === 0 && Math.abs(ga.at(33) - 1) < 1e-9, "the drone rests on its own (3 s out); the tone and beat play on");
const pSpk = S.plan(639, "speakers", "monaural", 10)!;
graph.play(pSpk);
check((g.aGains as unknown as { gain: MockParam }[])[1].gain.at(40) === 1 && (g.bGains as unknown as { gain: MockParam }[])[0].gain.at(40) === 1,
  "monaural: after the retune both tones reach both ears");

console.log(`aetheria_sound_v2.ts: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures.slice(0, 20)) console.log("  FAILED " + f);
process.exit(failures.length ? 1 : 0);
