import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchWithTimeout,
  fetchJsonWithTimeout,
  broadcastViaPioneer,
  cosmosSignedSerialized,
  rippleSignedSerialized,
} from './fetchUtils';
import { ensureQueryKey } from './pioneerKey';

vi.mock('./pioneerKey', () => ({ ensureQueryKey: vi.fn(async () => 'bex:0b6c1f2e-4d7a-4c1e-9f0a-2a3b4c5d6e7f') }));

// Build a minimal Response-like stub — only the fields the helpers touch.
const resp = (status: number, body: unknown = '') =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  }) as unknown as Response;

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  // Fake timers so retry backoff sleeps are deterministic and instant.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Drive a fetchUtils promise to completion while flushing backoff timers.
// The swallowing `.catch` keeps a rejection from being "unhandled" during
// the timer advance; the original `p` is still returned so `expect().rejects`
// observes it normally.
async function run<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  await vi.advanceTimersByTimeAsync(5000); // covers 200+400+800ms backoffs, under the 8s budget
  return p;
}

describe('fetchWithTimeout', () => {
  it('returns the response on first success (no retry)', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, 'ok'));
    const r = await run(fetchWithTimeout('https://x.test'));
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a 4xx — returns it for the caller to handle', async () => {
    fetchMock.mockResolvedValue(resp(404, 'nope'));
    const r = await run(fetchWithTimeout('https://x.test', {}, { retries: 2 }));
    expect(r.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx up to the budget, then returns the last response', async () => {
    fetchMock.mockResolvedValue(resp(503, 'down'));
    const r = await run(fetchWithTimeout('https://x.test', {}, { retries: 2 }));
    expect(r.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('recovers when a transient 5xx is followed by a success', async () => {
    fetchMock.mockResolvedValueOnce(resp(502)).mockResolvedValueOnce(resp(200, 'recovered'));
    const r = await run(fetchWithTimeout('https://x.test', {}, { retries: 2 }));
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a thrown network/timeout error, then succeeds', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(resp(200, 'ok'));
    const r = await run(fetchWithTimeout('https://x.test', {}, { retries: 2 }));
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after every attempt throws', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(run(fetchWithTimeout('https://x.test', {}, { retries: 1 }))).rejects.toThrow('boom');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honors a custom retryOn predicate', async () => {
    fetchMock.mockResolvedValue(resp(429, 'rate limited'));
    // Default treats 429 as non-transient (4xx); a custom predicate opts in.
    const r = await run(fetchWithTimeout('https://x.test', {}, { retries: 1, retryOn: s => s === 429 }));
    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('warns when an api.keepkey.info answer is served by green (and only then)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const served = (by: string) => new Response('{}', { status: 404, headers: { 'x-kk-served-by': by } });
    fetchMock
      .mockResolvedValueOnce(served('green'))
      .mockResolvedValueOnce(served('gateway'))
      .mockResolvedValueOnce(served('green'));
    await run(fetchWithTimeout('https://api.keepkey.info/api/v1/buildTx'));
    await run(fetchWithTimeout('https://api.keepkey.info/api/v1/broadcast'));
    await run(fetchWithTimeout('https://other.test/x'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[pioneer] served by green:', 'https://api.keepkey.info/api/v1/buildTx', 404);
    warn.mockRestore();
  });
});

describe('fetchJsonWithTimeout', () => {
  it('parses and returns JSON on success', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, { hello: 'world' }));
    const data = await run(fetchJsonWithTimeout<{ hello: string }>('https://x.test'));
    expect(data).toEqual({ hello: 'world' });
  });

  it('throws with the status and url on a non-OK response', async () => {
    fetchMock.mockResolvedValue(resp(500, 'server error'));
    await expect(run(fetchJsonWithTimeout('https://x.test'))).rejects.toThrow(/HTTP 500 from https:\/\/x\.test/);
  });
});

// KeepKey Desktop sign responses, real shapes:
// - /cosmos/sign-amino, /osmosis/sign-amino, /thorchain/sign-amino-transfer,
//   /mayachain/sign-amino-transfer → rest-api.ts cosmosAminoSign():
//   { signature, serialized, signed }. Values: proto-tx-builder reference
//   tx01.mainnet.mayachain.transfer.signed.json (serialized = base64 TxRaw).
// - /xrp/sign-transaction → hdwallet rippleSignTx() output returned as-is:
//   the StdTx with value.signatures[0] = { serializedTx (base64), signature }.
//   Values: hdwallet integration ripple/tx01.signed.json.
const DESKTOP_COSMOS_AMINO_RESPONSE = {
  signature: 'ebZ9miVlT1hF7JpolPtO0B3qo9N9Sra/FjYE+F53dYICSPOSgj6KOsh6i82QIV3AvHw0PNNPZGjyFsAiTnjhcQ==',
  serialized:
    'CkwKSgoOL3R5cGVzLk1zZ1NlbmQSOAoU/CMekQrVt/W70pEpQMVIvKfXlEESFPwjHpEK1bf1u9KRKUDFSLyn15RBGgoKBWNhY2FvEgExElgKUApGCh8vY29zbW9zLmNyeXB0by5zZWNwMjU2azEuUHViS2V5EiMKIQMVGXE7i0K9w2cRLTMTLPFM7fkorFdx1ES6RZuUlxF7oxIECgIIARgDEgQQgIl6GkB5tn2aJWVPWEXsmmiU+07QHeqj031Ktr8WNgT4Xnd1ggJI85KCPoo6yHqLzZAhXcC8fDQ8009kaPIWwCJOeOFx',
  signed: {
    chain_id: 'mayachain-mainnet-v1',
    account_number: '17',
    sequence: '3',
    fee: { amount: [], gas: '2000000' },
    memo: '',
    msgs: [{ type: 'mayachain/MsgSend', value: {} }],
  },
};
const DESKTOP_XRP_SIGN_RESPONSE = {
  type: 'auth/StdTx',
  value: {
    fee: { amount: [{ amount: '1000', denom: 'drop' }], gas: '28000' },
    memo: 'KeepKey',
    msg: [
      {
        type: 'ripple-sdk/MsgSend',
        value: {
          amount: [{ amount: '47000', denom: 'drop' }],
          from_address: 'rh5ZnEVySAy7oGd3nebT3wrohGDrsNS83E',
          to_address: 'rEpwmtmvx8gkMhX5NLdU3vutQt7dor4MZm',
        },
      },
    ],
    signatures: [
      {
        signature: 'MEQCIGpbPuBb+54fCpARqM0NmmegQ557ktoK5WQx5DcfevPmAiBr0u9PmpaGb/sXA5ttI4tTh7JWRnGyXdzzYGcjgdBQow==',
        serializedTx:
          'EgAAIoAAAAAkAAAAAy5JlgLSIBsAAAAAYUAAAAAAALeYaEAAAAAAAAPocyEDgqy3cRfq59HTQG+Dx/NT0wEputf1nYUY9o8i0daaN250RjBEAiBqWz7gW/ueHwqQEajNDZpnoEOee5LaCuVkMeQ3H3rz5gIga9LvT5qWhm/7FwObbSOLU4eyVkZxsl3c82BnI4HQUKOBFCjENIhxoC1ID/3y8ZIRAYXbE8/ZgxQoxDSIcaAtSA/98vGSEQGF2xPP2Q==',
      },
    ],
  },
};

describe('signed-tx serialized selection (Desktop sign responses)', () => {
  it('Cosmos family: the base64 TxRaw in `serialized`', () => {
    expect(cosmosSignedSerialized(DESKTOP_COSMOS_AMINO_RESPONSE)).toBe(DESKTOP_COSMOS_AMINO_RESPONSE.serialized);
    expect(Buffer.from(cosmosSignedSerialized(DESKTOP_COSMOS_AMINO_RESPONSE), 'base64').length).toBeGreaterThan(0);
  });

  it('XRP: value.signatures[0].serializedTx (base64 blob)', () => {
    expect(rippleSignedSerialized(DESKTOP_XRP_SIGN_RESPONSE)).toBe(
      DESKTOP_XRP_SIGN_RESPONSE.value.signatures[0].serializedTx,
    );
  });

  it('0.0.39 selection (`serializedTx || signedTx`) sent the whole object for both', () => {
    const old = (t: any) => t.serializedTx || t;
    expect(typeof old(DESKTOP_COSMOS_AMINO_RESPONSE)).toBe('object');
    expect(typeof old(DESKTOP_XRP_SIGN_RESPONSE)).toBe('object');
  });
});

describe('broadcastViaPioneer', () => {
  const served = (body: unknown, status = 200, by = 'gateway') =>
    new Response(JSON.stringify(body), { status, headers: { 'x-kk-served-by': by } });
  const COSMOS = 'cosmos:mayachain-mainnet-v1/slip44:931';

  beforeEach(() => {
    vi.mocked(ensureQueryKey).mockClear();
  });

  it('one keyed send with { networkId, caip, serialized }; returns the txid', async () => {
    fetchMock.mockResolvedValueOnce(served({ success: true, txid: 'ABC123' }));
    const txid = await run(broadcastViaPioneer(COSMOS, DESKTOP_COSMOS_AMINO_RESPONSE.serialized));
    expect(txid).toBe('ABC123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.keepkey.info/api/v1/broadcast');
    expect(init.headers.Authorization).toBe('bex:0b6c1f2e-4d7a-4c1e-9f0a-2a3b4c5d6e7f');
    expect(JSON.parse(init.body)).toEqual({
      networkId: 'cosmos:mayachain-mainnet-v1',
      caip: COSMOS,
      serialized: DESKTOP_COSMOS_AMINO_RESPONSE.serialized,
    });
    expect(ensureQueryKey).toHaveBeenCalledWith();
  });

  it('Cosmos CheckTx rejection: 200 { success:false, txid } is a failure', async () => {
    fetchMock.mockResolvedValueOnce(
      served({ success: false, txid: 'DEAD', error: { code: 5, message: 'insufficient funds' } }),
    );
    await expect(run(broadcastViaPioneer(COSMOS, 'AAAA'))).rejects.toThrow(
      'Pioneer broadcast failed: insufficient funds',
    );
  });

  it('XRP tec* result: 200 { success:false, engineResult } is a failure', async () => {
    fetchMock.mockResolvedValueOnce(
      served({ success: false, txid: 'E1', engineResult: 'tecUNFUNDED_PAYMENT', error: 'tecUNFUNDED_PAYMENT' }),
    );
    await expect(
      run(broadcastViaPioneer('ripple:4109c6f2045fc7eff4cde8f9905d19c2/slip44:144', 'AAAA')),
    ).rejects.toThrow('Pioneer broadcast failed: tecUNFUNDED_PAYMENT');
  });

  it('a 200 with no txid is a failure', async () => {
    fetchMock.mockResolvedValueOnce(served({ success: true }));
    await expect(run(broadcastViaPioneer(COSMOS, 'AAAA'))).rejects.toThrow('Pioneer broadcast failed');
  });

  it('a gateway 400 throws with the body and does not touch the key', async () => {
    fetchMock.mockResolvedValueOnce(served({ code: 'bad_request', message: 'serialized must be base64' }, 400));
    await expect(run(broadcastViaPioneer(COSMOS, 'not base64!'))).rejects.toThrow(
      /HTTP 400 .*serialized must be base64/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ensureQueryKey).not.toHaveBeenCalledWith(true);
  });

  it('a green non-ok re-registers the key and throws; never re-sends', async () => {
    fetchMock.mockResolvedValueOnce(served({ error: 'unauthorized' }, 401, 'green'));
    await expect(run(broadcastViaPioneer(COSMOS, 'AAAA'))).rejects.toThrow(/HTTP 401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ensureQueryKey).toHaveBeenCalledWith(true);
  });

  it('a green 2xx with a txid is accepted as-is (no resend, no re-register)', async () => {
    fetchMock.mockResolvedValueOnce(served({ success: true, txid: 'GREEN1' }, 200, 'green'));
    expect(await run(broadcastViaPioneer(COSMOS, 'AAAA'))).toBe('GREEN1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ensureQueryKey).not.toHaveBeenCalledWith(true);
  });

  // A write is never re-sent: the first send may already have broadcast, and a
  // resend of the same bytes comes back as a duplicate rejection (Cosmos CheckTx
  // 19 'tx already exists in cache', XRP tefPAST_SEQ, 'txn-already-in-mempool').
  it.each([
    ['gateway 502', () => served({ error: 'bad gateway' }, 502, 'gateway'), /HTTP 502/],
    ['green 503', () => served({ error: 'down' }, 503, 'green'), /HTTP 503/],
  ])('a %s is sent once and reported as unknown, not failed', async (_label, reply, status) => {
    fetchMock.mockResolvedValueOnce(reply()).mockResolvedValueOnce(served({ success: false, txid: 'X' }));
    const p = run(broadcastViaPioneer(COSMOS, 'AAAA'));
    await expect(p).rejects.toThrow(/result unknown.*check the explorer/i);
    await expect(p).rejects.toThrow(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['15 s timeout', () => new DOMException('The operation was aborted due to timeout', 'TimeoutError')],
    ['network drop', () => new TypeError('Failed to fetch')],
  ])('a %s is sent once and reported as unknown, not failed', async (_label, err) => {
    fetchMock.mockRejectedValueOnce(err()).mockResolvedValueOnce(served({ success: false, txid: 'X' }));
    await expect(run(broadcastViaPioneer(COSMOS, 'AAAA'))).rejects.toThrow(/result unknown.*check the explorer/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('an unreadable 2xx answer is reported as unknown', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>ok</html>', { status: 200 }));
    await expect(run(broadcastViaPioneer(COSMOS, 'AAAA'))).rejects.toThrow(/result unknown/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a non-string serialized before sending anything', async () => {
    await expect(run(broadcastViaPioneer(COSMOS, DESKTOP_COSMOS_AMINO_RESPONSE as any))).rejects.toThrow(
      /no serialized/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
