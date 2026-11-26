/**
 * The approval card (re)mounts from the stored event: a reloaded panel shows
 * an approved request as in progress, a sent one as sent, a failed one with
 * its reason — never a fresh Approve button (KEEPKEY-192).
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn(() => Promise.resolve()),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: (() => {
    const area = () => ({
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      onChanged: { addListener: vi.fn() },
    });
    return { local: area(), session: area(), sync: area(), managed: area(), onChanged: { addListener: vi.fn() } };
  })(),
});

// The chain review cards aren't under test here (and pull browser-only deps).
vi.mock('../../../../pages/side-panel/src/approval/evm', () => ({ default: () => 'EVM_REVIEW_CARD' }));
vi.mock('../../../../pages/side-panel/src/approval/utxo', () => ({ default: () => 'REVIEW' }));
vi.mock('../../../../pages/side-panel/src/approval/other', () => ({ default: () => 'REVIEW' }));
vi.mock('../../../../pages/side-panel/src/approval/tendermint', () => ({ default: () => 'REVIEW' }));

const { renderTransactionCard } = await import('../../../../pages/side-panel/src/approval/Transaction.render');

const base = {
  id: 'e1',
  type: 'eth_sendTransaction',
  chain: 'ethereum',
  networkId: 'eip155:8453',
  timestamp: new Date().toISOString(),
};

describe('approval card from stored state', () => {
  it('approved → waiting on the device, no Approve button', () => {
    const html = renderTransactionCard({ ...base, status: 'approved' });
    expect(html).not.toMatch(/>\s*Approve\s*</);
    expect(html).not.toContain('Unknown Transaction Type'); // the review card would render here
    expect(html.toLowerCase()).toContain('keepkey');
  });

  it('sent → success page with the txid and explorer link', () => {
    const html = renderTransactionCard({
      ...base,
      status: 'approved',
      txid: '0xabc0000000000000000000000000000000000000000000000000000000000def',
      explorerTxLink: 'https://basescan.org/tx/',
    });
    expect(html).toContain('data-txid-page');
    expect(html).toContain(
      'href="https://basescan.org/tx/0xabc0000000000000000000000000000000000000000000000000000000000def"',
    );
  });

  it('reverted → says the transaction would fail, with the reason', () => {
    const html = renderTransactionCard({
      ...base,
      status: 'failed',
      errorKind: 'reverted',
      error: 'This transaction would fail on-chain (execution reverted: GS013). It was not signed or sent.',
    });
    expect(html).toContain('This transaction would fail');
    expect(html).toContain('GS013');
    expect(html).not.toContain('data-txid-page');
  });
});
