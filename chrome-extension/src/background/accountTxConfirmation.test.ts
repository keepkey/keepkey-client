import { afterEach, describe, expect, test, vi } from 'vitest';
import { confirmAccountTx } from './accountTxConfirmation';
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});
describe('execution result, after broadcast acceptance', () => {
  const txid = 'A'.repeat(64);
  const check = (body: any, family = 'cosmos') => {
    globalThis.fetch = (async () => Response.json(body)) as typeof fetch;
    return confirmAccountTx(
      family === 'cosmos' ? 'cosmos:cosmoshub-4' : 'ripple:4109c6f2045fc7eff4cde8f9905d19c2',
      txid,
      { attempts: 1 },
    );
  };
  test('ATOM included code 5 is failure, with fee warning and txid', async () => {
    await expect(
      check({ tx_response: { txhash: txid, height: '33895308', code: 5, raw_log: 'insufficient funds' } }),
    ).rejects.toThrow(/failed on chain.*insufficient funds.*fee/);
  });
  test('string chain codes are checked too', async () => {
    await expect(check({ tx_response: { txhash: txid, height: '33895308', code: '5' } })).rejects.toThrow(
      /failed on chain/,
    );
  });
  test('only matching included code zero confirms a Cosmos send', async () => {
    await check({ tx_response: { txhash: txid, height: '33895308', code: 0 } });
    for (const tx of [
      { txhash: txid, height: '0', code: 0 },
      { txhash: 'B'.repeat(64), height: '1', code: 0 },
      { txhash: txid, height: '1' },
    ]) {
      await expect(check({ tx_response: tx })).rejects.toThrow(/confirmation is unknown/);
    }
  });
  test('pending or unreachable means unknown, never completed, and checks never POST a broadcast', async () => {
    let calls = 0;
    globalThis.fetch = (async (_url: any, options: any) => {
      calls++;
      expect(options.method).toBeUndefined();
      return new Response('', { status: 404 });
    }) as typeof fetch;
    await expect(confirmAccountTx('cosmos:cosmoshub-4', txid, { attempts: 1 })).rejects.toThrow(txid);
    expect(calls).toBe(2);
  });
  test('XRP requires validation and checks final engine result', async () => {
    await expect(
      check({ result: { hash: txid, validated: true, meta: { TransactionResult: 'tecUNFUNDED_PAYMENT' } } }, 'xrp'),
    ).rejects.toThrow(/failed on chain/);
    await expect(
      check({ result: { hash: txid, validated: false, meta: { TransactionResult: 'tesSUCCESS' } } }, 'xrp'),
    ).rejects.toThrow(/confirmation is unknown/);
    await check({ result: { hash: txid, validated: true, meta: { TransactionResult: 'tesSUCCESS' } } }, 'xrp');
  });
  test('a pending transaction may become successful while polling reads', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(Response.json({ tx_response: { txhash: txid, height: '123', code: 0 } }));
    await confirmAccountTx('cosmos:cosmoshub-4', txid, { attempts: 2, delayMs: 0 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
  test('the deadline bounds polling and returns the hash with a structured unknown outcome', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 }));
    const result = confirmAccountTx('cosmos:cosmoshub-4', txid, { timeoutMs: 20, delayMs: 1000 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toMatchObject({ kind: 'broadcast_unknown', txid, code: -32603 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
  test('an execution failure carries the hash and never becomes an unknown outcome', async () => {
    await expect(check({ tx_response: { txhash: txid, height: '33895308', code: 5 } })).rejects.toMatchObject({
      kind: 'chain_execution_failed',
      txid,
      code: -32603,
    });
  });
  test('UTXO broadcast keeps its existing acceptance semantics', async () => {
    globalThis.fetch = vi.fn();
    await confirmAccountTx('bip122:any', 'unchanged-txid');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
