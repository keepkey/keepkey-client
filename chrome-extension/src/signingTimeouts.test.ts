import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPROVAL_TIMEOUT_MS, SIGNING_TIMEOUT_MS, WALLET_REQUEST_TIMEOUT_MS } from './signingTimeouts';

vi.mock('./injected/consoleCapture', () => ({ installConsoleCapture() {} }));
vi.mock('./injected/pageObserver', () => ({ installPageObserver() {} }));
vi.mock('../../pages/content/src/agentDom', () => ({ installAgentDom() {} }));

// Run the actual page provider and content bridge together. Only the browser
// surface and background response are simulated; their timeout logic is real.
describe('long-running signature bridge', () => {
  let page: any;
  let respond: (response: any) => void;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const listeners = new Map<string, Set<Function>>();
    page = {
      location: { origin: 'https://dapp.test', href: 'https://dapp.test/', protocol: 'https:' },
      addEventListener(type: string, listener: Function) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener(type: string, listener: Function) {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(event: any) {
        for (const listener of [...(listeners.get(event.type) ?? [])]) listener(event);
      },
      postMessage(data: any) {
        page.dispatchEvent({ type: 'message', source: page, origin: page.location.origin, data });
      },
    };
    vi.stubGlobal('window', page);
    // Node 18 (CI) has no global CustomEvent
    vi.stubGlobal(
      'CustomEvent',
      class {
        type: string;
        detail: any;
        constructor(type: string, init?: any) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
    vi.stubGlobal('document', {
      referrer: '',
      head: { appendChild: (script: any) => script.onload?.() },
      createElement: () => ({ setAttribute() {}, remove() {} }),
      getElementById: () => null,
      addEventListener() {},
    });
    vi.stubGlobal('navigator', { userAgent: 'test', platform: 'test', language: 'en' });
    vi.stubGlobal('chrome', {
      storage: { local: { get: async () => ({}) } },
      runtime: {
        id: 'extension',
        getURL: (path: string) => path,
        onMessage: { addListener() {} },
        sendMessage(message: any, callback: any) {
          if (
            message.type === 'WALLET_REQUEST' &&
            ['personal_sign', 'eth_signTypedData_v4'].includes(message.requestInfo.method)
          )
            respond = callback;
        },
      },
    });
    await import('../../pages/content/src/index');
    await import('./injected/injected');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns a typed-data signature after the previous 30-second deadline', async () => {
    const settled = vi.fn();
    const result = page.keepkey.ethereum
      .request({ method: 'eth_signTypedData_v4', params: ['0xowner', '{}'] })
      .then(settled);
    await vi.advanceTimersByTimeAsync(31_968);
    expect(settled).not.toHaveBeenCalled();
    respond({ result: '0xsigned' });
    await result;
    expect(settled).toHaveBeenCalledOnce();
    expect(settled).toHaveBeenCalledWith('0xsigned');
  });

  it('returns a signature after using the full BEX review and Vault signing windows', async () => {
    const settled = vi.fn();
    const result = page.keepkey.ethereum.request({ method: 'personal_sign', params: ['0x1234'] }).then(settled);
    for (const budget of [APPROVAL_TIMEOUT_MS, SIGNING_TIMEOUT_MS]) {
      await vi.advanceTimersByTimeAsync(budget);
      expect(settled).not.toHaveBeenCalled();
    }
    respond({ result: '0xsigned' });
    await result;
    expect(settled).toHaveBeenCalledOnce();
    expect(settled).toHaveBeenCalledWith('0xsigned');
  });

  it('still rejects an abandoned request when the full bridge budget expires', async () => {
    const settled = vi.fn();
    const result = page.keepkey.ethereum.request({ method: 'personal_sign', params: ['0x1234'] }).catch(settled);
    await vi.advanceTimersByTimeAsync(WALLET_REQUEST_TIMEOUT_MS);
    await result;
    expect(settled).toHaveBeenCalledOnce();
    expect(settled.mock.calls[0][0].message).toContain('Request timeout');
  });

  it('allows ten minutes for approval and signing without an earlier bridge timeout', () => {
    expect(APPROVAL_TIMEOUT_MS).toBe(600_000);
    expect(SIGNING_TIMEOUT_MS).toBe(600_000);
    expect(WALLET_REQUEST_TIMEOUT_MS).toBeGreaterThan(APPROVAL_TIMEOUT_MS + SIGNING_TIMEOUT_MS);
  });
});
