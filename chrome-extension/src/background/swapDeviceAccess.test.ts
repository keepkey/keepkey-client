import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./wallet', () => ({ getSdk: () => ({ getClient: () => ({ getApiKey: () => 'synthetic-key' }) }) }));
vi.mock('@extension/storage', () => ({ keepKeyApiKeyStorage: { getApiKey: async () => 'synthetic-key' } }));
vi.mock('./keepAlive', () => ({ withServiceWorkerKeepAlive: (operation: () => Promise<unknown>) => operation() }));
import { handleSwapMessage } from './swapHandler';

afterEach(() => vi.unstubAllGlobals());
describe('swap quote device access', () => {
  it.each([
    { isMax: false, foreground: false, access: 'cached' },
    { isMax: true, foreground: false, access: 'cached' },
    { isMax: false, foreground: true, access: 'cached' },
    { isMax: true, foreground: true, access: 'foreground' },
    { isMax: undefined, foreground: true, access: 'cached' },
    { isMax: 'true', foreground: true, access: 'cached' },
  ])('requires explicit foreground MAX to allow a device prompt: %j', async ({ isMax, foreground, access }) => {
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
      Response.json({ data: { expectedOutput: '1' } }),
    );
    vi.stubGlobal('fetch', fetcher);
    await handleSwapMessage(
      {
        action: 'quote',
        foreground,
        params: {
          fromCaip: 'synthetic:from',
          toCaip: 'synthetic:to',
          fromAddress: 'from',
          toAddress: 'to',
          amount: '1',
          isMax,
        },
      },
      [],
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { 'X-KeepKey-Device-Access': access } });
    const body = JSON.parse(fetcher.mock.calls[0][1].body as string);
    if (isMax === true) expect(body.isMax).toBe(true);
    else expect(Object.hasOwn(body, 'isMax')).toBe(false);
  });
});
