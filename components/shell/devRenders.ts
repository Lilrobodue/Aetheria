// components/shell/devRenders.ts (v15.5, the new layout beta)
//
// Dev builds only: each new-layout view counts its renders in window.__aetheriaRenders[name] (layout.spec 7: while
// playing, only the time readers follow the 4 Hz clock). A no-op in production, where the branch and the name are
// stripped (the __aetheriaCrash pattern). React's StrictMode renders twice in dev; the test allows for it.

const IS_DEV_BUILD = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;

export const countRender: (name: string) => void = IS_DEV_BUILD
  ? (name: string) => {
      const w = window as unknown as { __aetheriaRenders?: Record<string, number> };
      const counts = w.__aetheriaRenders ?? (w.__aetheriaRenders = {});
      counts[name] = (counts[name] ?? 0) + 1;
    }
  : () => {};
