import { TEST_ORIGIN } from './adb';
import { isOtherLocalOrigin } from './helpers';

// v16.0.1 (device-hide.spec.ts): a raw DevTools client, the browser's own websocket with flat sessions, no Playwright.
// Measured on the Note 20: while a Playwright connectOverCDP connection is open, Chrome on Android keeps EVERY tab it is
// attached to "visible" after the home key or the screen lock (no visibilitychange, timers at full rate). With only a
// raw session attached, the page goes hidden about 300 ms after the key. So the hide tests disconnect Playwright first
// and drive the hidden phase from here.

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; method: string; timer: ReturnType<typeof setTimeout> };

export class RawCdp {
  private id = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(m: { method: string; params: any; sessionId?: string }) => void>();

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (ev: MessageEvent) => {
      const d = JSON.parse(String(ev.data));
      if (typeof d.id === 'number') {
        const p = this.pending.get(d.id);
        if (!p) return;
        this.pending.delete(d.id);
        clearTimeout(p.timer);
        if (d.error) p.reject(new Error(`${p.method}: ${d.error.message}`));
        else p.resolve(d.result);
      } else if (d.method) {
        for (const l of this.listeners) l(d);
      }
    };
    ws.onclose = () => {
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`${p.method}: the DevTools socket closed`));
      }
      this.pending.clear();
    };
  }

  /** The browser's DevTools socket at `endpoint` (http://localhost:9222 on the phone, through adb forward). */
  static async connect(endpoint: string): Promise<RawCdp> {
    const version = await (await fetch(`${endpoint}/json/version`)).json();
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`could not open ${version.webSocketDebuggerUrl}`));
    });
    return new RawCdp(ws);
  }

  /** A command; rejects on a protocol error or after `timeoutMs` (a target that is gone never answers). */
  send(method: string, params: object = {}, sessionId?: string, timeoutMs = 15_000): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no answer in ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  /** A command sent and never awaited (Page.crash: its target is gone, so it never answers). */
  fire(method: string, params: object = {}, sessionId?: string): void {
    this.ws.send(JSON.stringify({ id: ++this.id, method, params, ...(sessionId ? { sessionId } : {}) }));
  }

  /** The first event that `match` accepts, within `timeoutMs`. Subscribe before the action that causes it. */
  waitForEvent(match: (m: { method: string; params: any; sessionId?: string }) => boolean, timeoutMs: number, what: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const l = (m: { method: string; params: any; sessionId?: string }) => {
        if (!match(m)) return;
        this.listeners.delete(l);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.listeners.delete(l);
        reject(new Error(`${what}: not within ${timeoutMs} ms`));
      }, timeoutMs);
      this.listeners.add(l);
    });
  }

  /** Every page target: id, URL, title. Reading only. */
  async pages(): Promise<{ targetId: string; url: string; title: string }[]> {
    const { targetInfos } = await this.send('Target.getTargets');
    return (targetInfos as any[]).filter((t) => t.type === 'page').map((t) => ({ targetId: t.targetId, url: t.url, title: t.title }));
  }

  /** The test's own tab: the one page whose title is `title` (a marker the test set) and whose URL is the test origin's. */
  async ourPage(title: string): Promise<{ targetId: string; url: string; title: string }> {
    const ours = (await this.pages()).filter((t) => t.title === title && t.url.startsWith(TEST_ORIGIN + '/'));
    if (ours.length !== 1) throw new Error(`Expected exactly one tab titled ${title} on ${TEST_ORIGIN}, found ${ours.length}`);
    return ours[0];
  }

  /** A flat session on the target. */
  async attach(targetId: string): Promise<string> {
    return (await this.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  }

  /** Evaluate in the session's page, returning the value; throws on an exception in the page. */
  async evaluate<T = any>(sessionId: string, expression: string, timeoutMs = 10_000): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId, timeoutMs);
    if (r.exceptionDetails) throw new Error(`in the page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value as T;
  }

  /**
   * crashPage's guard, over the raw target list: our tab must be the test origin's, and no OTHER page of the browser
   * may be on a local host with another origin (Page.crash kills the whole renderer process, which a port does not
   * keep apart: on the phone, the user's localhost:3100 tab). Reads URLs only.
   */
  async assertCrashable(targetId: string): Promise<void> {
    const all = await this.pages();
    const ours = all.find((t) => t.targetId === targetId);
    if (!ours || !ours.url.startsWith(TEST_ORIGIN + '/')) throw new Error(`Refusing to crash ${ours?.url ?? 'a tab that is gone'}: only a tab of ${TEST_ORIGIN} is the tests' own.`);
    const others = all.filter((t) => t.targetId !== targetId && isOtherLocalOrigin(t.url)).map((t) => t.url);
    if (others.length) {
      throw new Error(
        `Refusing to crash the test tab: Page.crash kills its whole renderer process, which another local origin can share ` +
          `(a port is not part of a site). Open now: ${others.join(', ')}. Close ${others.length === 1 ? 'that tab' : 'those tabs'} and run it again.`
      );
    }
  }

  /** Kill our tab's renderer (Page.crash, sent and not awaited) after assertCrashable; resolves once Chrome reports
   *  the crash (Target.targetCrashed, or Inspector.targetCrashed on the session) or the session loses its renderer
   *  (Inspector.detached, "Render process gone."). With Chrome in the background, Android Chrome reports only the
   *  last until it is brought back (then it reloads the tab and reports the crash; measured on the Note 20). */
  async crash(targetId: string, sessionId: string): Promise<void> {
    await this.assertCrashable(targetId);
    await this.send('Target.setDiscoverTargets', { discover: true });
    await this.send('Inspector.enable', {}, sessionId).catch(() => {});
    const crashed = this.waitForEvent(
      (m) =>
        (m.method === 'Target.targetCrashed' && m.params?.targetId === targetId) ||
        (m.method === 'Inspector.targetCrashed' && m.sessionId === sessionId) ||
        (m.method === 'Inspector.detached' && m.sessionId === sessionId && /render process gone/i.test(String(m.params?.reason ?? ''))),
      15_000,
      'the test tab’s renderer crashed'
    );
    this.fire('Page.crash', {}, sessionId);
    await crashed;
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // Already closed.
    }
  }
}
