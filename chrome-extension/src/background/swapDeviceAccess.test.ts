import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./wallet', () => ({ getSdk: () => ({ getClient: () => ({ getApiKey: () => 'synthetic-key' }) }) }));
vi.mock('@extension/storage', () => ({ keepKeyApiKeyStorage: { getApiKey: async () => 'synthetic-key' } }));
vi.mock('./keepAlive', () => ({ withServiceWorkerKeepAlive: (operation: () => Promise<unknown>) => operation() }));
import { handleSwapMessage } from './swapHandler';
import { swapExecutionParams } from '../../../pages/side-panel/src/swap/swapExecution';
import type { UiAsset, SwapQuote } from '../../../pages/side-panel/src/swap/types';

afterEach(() => vi.unstubAllGlobals());
describe('swap quote device access', () => {
  it('carries the Desktop-issued quote identity and reviewed transaction through execute', async () => {
    const from: UiAsset = {
      asset: 'BASE.ETH',
      caip: 'eip155:8453/slip44:60',
      chainId: 'base',
      decimals: 18,
      symbol: 'ETH',
      name: 'Ethereum',
      chainFamily: 'evm',
      color: 'blue',
    };
    const to: UiAsset = { ...from, asset: 'ETH.ETH', caip: 'eip155:1/slip44:60', chainId: 'ethereum' };
    const quote: SwapQuote = {
      quoteId: 'desktop-issued-quote',
      expectedOutput: '0.0062',
      minimumOutput: '0.006',
      memo: '',
      inboundAddress: '0xdeposit',
      slippageBps: 300,
      fees: { affiliate: '0', outbound: '0', totalBps: 30 },
      estimatedTime: 3,
      integration: 'relay',
      relayTx: { to: '0xdeposit', data: '0x49290c1c', value: '6315000000000000', chainId: 8453 },
    };
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
      Response.json({ data: { txid: 'test-only' } }),
    );
    vi.stubGlobal('fetch', fetcher);
    await handleSwapMessage({ action: 'execute', params: swapExecutionParams(from, to, '0.006315', quote) }, []);
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toMatchObject({
      quoteId: 'desktop-issued-quote',
      amount: '0.006315',
      fromCaip: from.caip,
      toCaip: to.caip,
      relayTx: quote.relayTx,
    });
  });
  it('shows the specific Desktop quote refusal instead of hiding it behind Swap API error', async () => {
    const details = 'This Relay quote describes a different Relay order than the deposit it asks you to sign.';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Swap API error', details }, { status: 502 })),
    );
    expect(await handleSwapMessage({ action: 'assets' }, [])).toEqual({ ok: false, status: 502, error: details });
  });
  it('retains a useful generic error when Desktop has no string detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Swap API error', details: {} }, { status: 502 })),
    );
    expect(await handleSwapMessage({ action: 'assets' }, [])).toEqual({
      ok: false,
      status: 502,
      error: 'Swap API error',
    });
  });
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
