// tools/chroma-check.ts — Analyse tracks (v15.1): the browser parity page (build spec v15.1 §11.3).
//
// Dev-only: Vite serves it at /tools/chroma-check.html; it is never built (vite.config.ts builds only index.html and
// public/sw.js). e2e/tests/chroma-parity.spec.ts drives it (@parity), with tools/serve-readonly.mjs serving the
// reference files.
//
// For each reference track, the production path: createDecodeContext(), decodeAudioData on a fresh arrayBuffer() of
// the fetched file, analyseKeyOf(buf, { sliceMs: 8, yieldFn: a MessageChannel round trip }). analyseKeyOf leaves
// channel 0 holding its mono mix, so the page analyses that once more (the same input, so the same numbers) for the
// unrounded values the bounds are defined on, and checks that they give exactly the fields analyseKeyOf returned.
// tools/chromaParity.ts then compares them with the stored values. The buffer is dropped before the next track.
//
// URL parameters: lib (the library.json URL), src (the audio base URL), ext (wav | mp3), bounds (tolerant | mp3),
// list (optional: the URL of a JSON array of `source`s to run), env (optional N: on every Nth track, also decode at
// 48 kHz and compare the band envelopes of both decodes; a report, no bound).
//
// Output: data-testid="chroma-check-result" reads `PASS (n)` or `FAIL: …`, and one console line
// '[chroma-check] {json}' holds the report. Rows are keyed by library index; no names or URLs are reported.

import { createDecodeContext, analyseKeyOf, toKeyFields } from '../utils/soundV2/keyAnalysis.ts';
import { analysePitchContentSync } from '../utils/soundV2/chroma.ts';
import { compareWithRef, errorRow, verdict, formatRow, formatVerdict } from './chromaParity.ts';
import type { ParityRow, RefEntry, BoundsName } from './chromaParity.ts';

interface Track extends RefEntry { source: string }
interface Bands { fps: number; sub: Uint8Array; bass: Uint8Array; mid: Uint8Array; high: Uint8Array }
interface EnvRow { index: number; bands: Record<'sub' | 'bass' | 'mid' | 'high', { corr: number | null; meanAbs: number }>; ms22050: number; ms48000: number }

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

// A macrotask yield: a MessageChannel round trip, as the pass uses between slices.
const channel = new MessageChannel();
let wake: (() => void) | null = null;
channel.port1.onmessage = () => {
  const w = wake;
  wake = null;
  if (w) w();
};
const macrotask = (): Promise<void> =>
  new Promise<void>((resolve) => {
    wake = resolve;
    channel.port2.postMessage(0);
  });

// A COPY of App.tsx's analyzeBandEnvelopes (v15.0.1), for the optional envelope comparison only (D2). The app's own
// function is the one the pass and Deep Scan use; keep this copy in step if that one changes.
async function bandEnvelopesCopy(buffer: AudioBuffer, fps = 20): Promise<Bands | undefined> {
  const SR8K = 8000;
  const MAX_SECONDS = 1800;
  const seconds = Math.min(buffer.duration || 0, MAX_SECONDS);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const length = Math.max(1, Math.ceil(seconds * SR8K));
  const hop = Math.max(1, Math.floor(SR8K / fps));
  const renderBand = async (wire: (ctx: OfflineAudioContext, src: AudioBufferSourceNode) => AudioNode): Promise<Uint8Array> => {
    const ctx = new OfflineAudioContext(1, length, SR8K);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const out = wire(ctx, src);
    out.connect(ctx.destination);
    src.start();
    const data = (await ctx.startRendering()).getChannelData(0);
    const n = Math.ceil(data.length / hop);
    const rms = new Float32Array(n);
    let max = 0;
    for (let k = 0; k < n; k++) {
      const start = k * hop;
      const end = Math.min(start + hop, data.length);
      let sum = 0;
      for (let j = start; j < end; j++) sum += data[j] * data[j];
      const v = Math.sqrt(sum / Math.max(1, end - start));
      rms[k] = v;
      if (v > max) max = v;
    }
    const u = new Uint8Array(n);
    if (max < 1e-4) return u;
    for (let k = 0; k < n; k++) u[k] = Math.min(255, Math.round((rms[k] / max) * 255));
    return u;
  };
  const sub = await renderBand((ctx, src) => {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 60; f.Q.value = 0.7;
    src.connect(f); return f;
  });
  const bass = await renderBand((ctx, src) => {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 250;
    src.connect(hp); hp.connect(lp); return lp;
  });
  const mid = await renderBand((ctx, src) => {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.7;
    src.connect(f); return f;
  });
  const high = await renderBand((ctx, src) => {
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2000;
    src.connect(f); return f;
  });
  return { fps, sub, bass, mid, high };
}

function compareBand(a: Uint8Array, b: Uint8Array): { corr: number | null; meanAbs: number } {
  const n = Math.min(a.length, b.length);
  let sa = 0, sb = 0, d = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
    d += Math.abs(a[i] - b[i]);
  }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return { corr: va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null, meanAbs: n ? d / n : 0 };
}

const stemOf = (source: string): string => source.replace(/\.[^.\\/]*$/, '');

async function main(): Promise<void> {
  const p = new URLSearchParams(location.search);
  const libUrl = p.get('lib'), src = p.get('src');
  const ext = (p.get('ext') || 'wav').toLowerCase();
  const bounds = (p.get('bounds') || (ext === 'mp3' ? 'mp3' : 'tolerant')) as BoundsName;
  const listUrl = p.get('list');
  const envEvery = Math.max(0, Math.floor(Number(p.get('env') || 0)));
  if (!libUrl || !src) throw new Error('needs ?lib=<library.json URL>&src=<audio base URL>');
  if (ext !== 'wav' && ext !== 'mp3') throw new Error('ext is wav or mp3');
  if (bounds !== 'tolerant' && bounds !== 'mp3' && bounds !== 'strict') throw new Error('bounds is tolerant or mp3');
  if (!createDecodeContext()) throw new Error("this browser has no OfflineAudioContext");

  const libRes = await fetch(libUrl);
  if (!libRes.ok) throw new Error(`library.json: HTTP ${libRes.status}`);
  const tracks = ((await libRes.json()) as { tracks?: Track[] }).tracks ?? [];
  let picks = tracks.map((_, i) => i);
  let missing = 0;
  if (listUrl) {
    const listRes = await fetch(listUrl);
    if (!listRes.ok) throw new Error(`list: HTTP ${listRes.status}`);
    const want = new Set((await listRes.json()) as string[]);
    picks = picks.filter((i) => want.has(tracks[i].source));
    missing = want.size - picks.length;
  }

  const rows: ParityRow[] = [];
  const env: EnvRow[] = [];
  const pre = $('rows');
  for (let k = 0; k < picks.length; k++) {
    const i = picks[k], t = tracks[i];
    $('status').textContent = `${k + 1}/${picks.length}: #${i}`;
    let row: ParityRow;
    try {
      const file = ext === 'wav' ? t.source : stemOf(t.source) + '.mp3';
      const res = await fetch(`${src.replace(/\/$/, '')}/${encodeURIComponent(file)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      const wantEnv = envEvery > 0 && k % envEvery === 0;
      const copy48 = wantEnv ? bytes.slice(0) : null;
      const ctx = createDecodeContext() as OfflineAudioContext;
      const t0 = performance.now();
      const buf = await ctx.decodeAudioData(bytes);
      const decodeMs = performance.now() - t0;
      if (wantEnv && copy48) {
        // The renders read the untouched buffer, so they run before analyseKeyOf's in-place downmix (D2).
        const e0 = performance.now();
        const a = await bandEnvelopesCopy(buf);
        const ms22050 = performance.now() - e0;
        const buf48 = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(copy48);
        const e1 = performance.now();
        const b = await bandEnvelopesCopy(buf48);
        const ms48000 = performance.now() - e1;
        if (a && b) {
          env.push({ index: i, ms22050, ms48000, bands: { sub: compareBand(a.sub, b.sub), bass: compareBand(a.bass, b.bass), mid: compareBand(a.mid, b.mid), high: compareBand(a.high, b.high) } });
        }
      }
      const t1 = performance.now();
      const fields = await analyseKeyOf(buf, { sliceMs: 8, yieldFn: macrotask });
      const analyseMs = performance.now() - t1;
      const raw = analysePitchContentSync(buf.getChannelData(0)); // channel 0 now holds analyseKeyOf's mono mix
      row = compareWithRef(i, raw, t);
      row.decodeMs = decodeMs;
      row.analyseMs = analyseMs;
      row.seconds = buf.duration;
      if (JSON.stringify(toKeyFields(raw)) !== JSON.stringify(fields)) row.status = 'error: analyseKeyOf and the re-analysis disagree';
    } catch (e) {
      row = errorRow(i, e instanceof Error ? e.name + ': ' + e.message : 'failed', t);
    }
    rows.push(row);
    pre.textContent += formatRow(row) + '\n';
    await macrotask();
  }

  const v = verdict(rows, bounds);
  if (missing) {
    v.failures.push(`${missing} listed source(s) are not in the library`);
    v.pass = false;
  }
  pre.textContent += '\n' + formatVerdict(v, `browser ${ext}`) + '\n';
  const ok = rows.filter((r) => r.status === 'ok');
  const sum = (f: (r: ParityRow) => number | undefined): number => ok.reduce((s, r) => s + (f(r) ?? 0), 0);
  const audioMin = sum((r) => r.seconds) / 60;
  const report = {
    page: 'chroma-check', ext, bounds, ua: navigator.userAgent, deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
    n: rows.length, pass: v.pass, failures: v.failures, summary: v.summary,
    timing: {
      audioMinutes: audioMin, decodeMs: sum((r) => r.decodeMs), analyseMs: sum((r) => r.analyseMs),
      decodeMsPerMin: audioMin ? sum((r) => r.decodeMs) / audioMin : null, analyseMsPerMin: audioMin ? sum((r) => r.analyseMs) / audioMin : null,
    },
    rows, env,
  };
  console.log('[chroma-check] ' + JSON.stringify(report));
  $('status').textContent = `Done: ${rows.length} tracks.`;
  $('result').textContent = v.pass ? `PASS (${rows.length})` : `FAIL: ${v.failures.join('; ')}`;
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.log('[chroma-check] ' + JSON.stringify({ page: 'chroma-check', error: msg }));
  $('result').textContent = 'FAIL: ' + msg;
});
