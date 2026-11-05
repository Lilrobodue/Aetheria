import type { Browser, Page } from '@playwright/test';

/**
 * v16.7.3: on a device, close every other tab at the tests' origin before a test clears that origin's storage.
 *
 * A run that was stopped part-way can leave its test tab open (traced 2026-11-04). Chrome freezes it in the
 * background, and once the tab is brought back it saves its own stale library into the origin the next test is using.
 * With the suite's fixed track ids that reads as "the reload kept the old crystals", or as "restored 0 tracks" when
 * the stale save names ids whose audio was never stored.
 *
 * Only pages whose URL is at `origin` (the tests' own, localhost:3299 on the phone), in the same browser context as
 * `page` (fix round 1, F5: the phone's one profile is one context; a page in any other context is left alone), and that
 * are not `page` itself. The device runs use one worker (fixtures.ts refuses more), so no other test can own such a tab.
 * Every other tab, the user's own included, is left as it is and never logged. Returns how many leftover tabs were
 * closed; throws if one will not close, since it could still write over this test's library.
 */
export async function closeOtherTestTabs(browser: Browser, page: Page, origin: string): Promise<number> {
  const own = await page.context().newCDPSession(page);
  const { targetInfo } = await own.send('Target.getTargetInfo');
  await own.detach();
  if (!targetInfo.browserContextId) throw new Error("The test's own tab names no browser context: refusing to look for leftovers.");
  const atOrigin = (url: string) => url === origin || url.startsWith(origin + '/');
  const session = await browser.newBrowserCDPSession();
  try {
    const leftovers = async () =>
      (await session.send('Target.getTargets')).targetInfos.filter(
        (t) => t.type === 'page' && t.targetId !== targetInfo.targetId && t.browserContextId === targetInfo.browserContextId && atOrigin(t.url),
      );
    const found = await leftovers();
    for (const t of found) await session.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
    for (let i = 0; i < 50; i++) {
      if (!(await leftovers()).length) return found.length;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`A leftover tab at ${origin} would not close: it could save its stale library over this test's.`);
  } finally {
    await session.detach().catch(() => {});
  }
}
