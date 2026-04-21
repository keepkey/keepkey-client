/**
 * Side-panel approval flow smoke test.
 *
 * Replaces the popup approval coverage deleted when the popup was
 * removed. The point isn't to exercise the device path (that needs a
 * KeepKey + vault running) — it's to catch regressions in the
 * plumbing this PR touched:
 *
 *   - SidePanel subscribing to requestStorage (key: 'keepkey-requests')
 *   - The overlay rendering when an event is pending
 *   - The reject button wiring through to removeEventById so the
 *     overlay dismisses and the event actually leaves storage
 *
 * The test seeds chrome.storage.local directly rather than going
 * through a dApp injection, because we want to validate the sidebar's
 * own surface contract — the request-injection path has its own spec.
 */

const STORAGE_KEY = 'keepkey-requests';

const seedRequestEvent = async () => {
  await browser.execute((key: string) => {
    const mockEvent = {
      id: 'e2e-approval-1',
      networkId: 'eip155:1',
      chain: 'ethereum',
      type: 'personal_sign',
      request: [
        '0x48656c6c6f2c20576f726c6421', // "Hello, World!" hex
        '0x0000000000000000000000000000000000000000',
      ],
      requestInfo: {
        id: 'e2e-approval-1',
        method: 'personal_sign',
        params: ['0x48656c6c6f2c20576f726c6421', '0x0000000000000000000000000000000000000000'],
        siteUrl: 'https://e2e.example',
        href: 'https://e2e.example/',
      },
      status: 'request',
      timestamp: new Date().toISOString(),
    };
    return new Promise<void>(resolve => {
      chrome.storage.local.set({ [key]: [mockEvent] }, () => resolve());
    });
  }, STORAGE_KEY);
};

const readEvents = async () =>
  browser.execute(
    (key: string) =>
      new Promise<any[]>(resolve => {
        chrome.storage.local.get([key], (result: any) => resolve(result[key] || []));
      }),
    STORAGE_KEY,
  );

const clearEvents = async () => {
  await browser.execute((key: string) => {
    return new Promise<void>(resolve => {
      chrome.storage.local.set({ [key]: [] }, () => resolve());
    });
  }, STORAGE_KEY);
};

describe('Side Panel approval overlay', () => {
  afterEach(async () => {
    // Leave the extension storage clean for other specs.
    await clearEvents();
  });

  it('renders the overlay when a request is pending and dismisses on reject', async () => {
    const extensionPath = await browser.getExtensionPath();

    // Load the side panel first; subscription hook needs a mounted tree
    // before we seed storage so the live-update path fires.
    await browser.url(`${extensionPath}/side-panel/index.html`);
    await expect(browser).toHaveTitle('Side Panel');

    await seedRequestEvent();

    // Approve + Reject buttons live inside the EVM approval view. Wait
    // on the Reject button specifically — if the overlay never mounts,
    // this assertion times out with a clear signal.
    const rejectBtn = await $('button=Reject');
    await rejectBtn.waitForExist({ timeout: 5000 });
    await expect(rejectBtn).toBeExisting();

    await rejectBtn.click();

    // Transaction.tsx's reject path calls requestStorage.removeEventById
    // (plus a message that the background is free to ignore in this
    // test harness — no requireApproval promise is in flight). What
    // matters is the storage mutation.
    await browser.waitUntil(
      async () => {
        const events = await readEvents();
        return Array.isArray(events) && events.length === 0;
      },
      {
        timeout: 5000,
        timeoutMsg: 'Rejecting did not remove the event from requestStorage',
      },
    );
  });
});
