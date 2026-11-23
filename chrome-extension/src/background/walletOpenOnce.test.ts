import { describe, expect, it } from 'vitest';
import { walletOpenReason } from './walletOpenOnce';

// chrome.storage.session survives service-worker restarts but not a browser restart.
const sessionStore = () => {
  const items: Record<string, unknown> = {};
  return {
    async get(key: string) {
      return key in items ? { [key]: items[key] } : {};
    },
    async set(next: Record<string, unknown>) {
      Object.assign(items, next);
    },
  };
};

describe('walletOpenReason', () => {
  it('pays for discovery once per wallet per browser session; reruns are automatic', async () => {
    const store = sessionStore();
    expect(await walletOpenReason('0xAAaa000000000000000000000000000000000001', store)).toBe('wallet-open');
    // ON_START health-poll rerun in the same worker
    expect(await walletOpenReason('0xaaaa000000000000000000000000000000000001', store)).toBe('automatic');
    // A different wallet (device switch) gets its own first open
    expect(await walletOpenReason('0xbbbb000000000000000000000000000000000002', store)).toBe('wallet-open');
  });

  it('a worker restart (fresh memory, same session storage) stays automatic', async () => {
    const store = sessionStore();
    await store.set({ 'walletOpenRefresh:0xcccc000000000000000000000000000000000003': 1 });
    expect(await walletOpenReason('0xCCCC000000000000000000000000000000000003', store)).toBe('automatic');
  });

  it('concurrent onStart runs claim the open only once', async () => {
    const store = sessionStore();
    const reasons = await Promise.all(
      Array.from({ length: 5 }, () => walletOpenReason('0xdddd000000000000000000000000000000000004', store)),
    );
    expect(reasons.filter(r => r === 'wallet-open')).toHaveLength(1);
  });

  it.each(['get', 'set'] as const)('storage %s failure never authorizes discovery', async operation => {
    const store = sessionStore();
    store[operation] = async () => {
      throw Error('session unavailable');
    };
    expect(await walletOpenReason('wallet-' + operation, store)).toBe('automatic');
  });

  it('no wallet identity is never paid', async () => {
    expect(await walletOpenReason('', sessionStore())).toBe('automatic');
  });
});
