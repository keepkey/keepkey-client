/**
 * Every clear-signable Hive op must render a readable summary.
 *
 * The side-panel approval card shows `unsignedTx.operations[].summary` and
 * nothing else — a Hive tx has no single destination or amount to fall back
 * on. opSummary()'s `default` arm returns the bare op name, so an op added to
 * SUPPORTED_OPS without a matching `case` degrades the approval to
 * "limit_order_create" with no values in it, silently. That is the exact
 * unreadable-confirm this pairs with RequestDetailsCard to prevent.
 */
import { describe, it, expect } from 'vitest';
import { SUPPORTED_OPS, opSummary } from './hiveOps';

// One realistic payload per op, in the vault serializer's field names.
const SAMPLES: Record<string, Record<string, any>> = {
  vote: { voter: 'alice', author: 'bob', permlink: 'a-post', weight: 10000 },
  comment: { author: 'alice', permlink: 'a-post', title: 'Hello', body: 'hi', json_metadata: '{}' },
  custom_json: { required_auths: [], required_posting_auths: ['alice'], id: 'follow', json: '["follow",{}]' },
  // to !== from on purpose: a self-power-up would hide a from/to swap.
  transfer_to_vesting: { from: 'alice', to: 'bob', amount: '1.500 HIVE' },
  withdraw_vesting: { account: 'alice', vesting_shares: '1000.000000 VESTS' },
  limit_order_create: {
    owner: 'alice',
    orderid: 1,
    amount_to_sell: '1.500 HIVE',
    min_to_receive: '0.400 HBD',
    fill_or_kill: false,
    expiration: 1700003600,
  },
  limit_order_cancel: { owner: 'alice', orderid: 1 },
  convert: { owner: 'alice', requestid: 1, amount: '0.400 HBD' },
  comment_options: {
    author: 'alice',
    permlink: 'a-post',
    max_accepted_payout: '1000000.000 HBD',
    percent_hbd: 10000,
    allow_votes: true,
    allow_curation_rewards: true,
    extensions: [],
  },
  transfer_to_savings: { from: 'alice', to: 'bob', amount: '1.500 HIVE', memo: '' },
  transfer_from_savings: { from: 'alice', request_id: 1, to: 'bob', amount: '1.500 HIVE', memo: '' },
  claim_reward_balance: {
    account: 'alice',
    reward_hive: '1.500 HIVE',
    reward_hbd: '0.400 HBD',
    reward_vests: '1000.000000 VESTS',
  },
  delegate_vesting_shares: { delegator: 'alice', delegatee: 'bob', vesting_shares: '1000.000000 VESTS' },
  account_update2: { account: 'alice', json_metadata: '', posting_json_metadata: '{}' },
};

describe('Hive op summaries', () => {
  it('has a sample payload for every supported op', () => {
    const missing = [...SUPPORTED_OPS].filter(op => !(op in SAMPLES));
    expect(missing, `No test payload for: ${missing.join(', ')}`).toEqual([]);
  });

  it('summarizes every supported op with more than its own name', () => {
    for (const op of SUPPORTED_OPS) {
      const summary = opSummary(op, SAMPLES[op]);
      // The `default` arm returns `name` verbatim. Anything equal to the op
      // name means no case matched and the approval would render unreadably.
      expect(summary, `${op} falls through to the default arm — add a case to opSummary()`).not.toBe(op);
      expect(summary.length, `${op} summary is empty`).toBeGreaterThan(0);
    }
  });

  it('renders the values a user must check against the device screen', () => {
    // Amount + counterparty are what the OLED shows; the panel has to show the
    // same thing or the comparison the clear-sign table exists for is impossible.
    expect(opSummary('limit_order_create', SAMPLES.limit_order_create)).toContain('1.500 HIVE');
    expect(opSummary('limit_order_create', SAMPLES.limit_order_create)).toContain('0.400 HBD');
    expect(opSummary('transfer_to_savings', SAMPLES.transfer_to_savings)).toContain('bob');
    // Recipient, not sender — the vault serializes str(from), str(to) and a
    // swapped pair would still render plausibly.
    expect(opSummary('transfer_to_vesting', SAMPLES.transfer_to_vesting)).toContain('@bob');
    expect(opSummary('transfer_to_vesting', SAMPLES.transfer_to_vesting)).toContain('1.500 HIVE');
    expect(opSummary('claim_reward_balance', SAMPLES.claim_reward_balance)).toContain('1000.000000 VESTS');
  });

  it('distinguishes the zero-amount sentinels from real amounts', () => {
    // '0.000000 VESTS' means stop/remove, not "send zero" — a user approving
    // these must not see the same wording as an actual power-down.
    expect(opSummary('withdraw_vesting', { account: 'alice', vesting_shares: '0.000000 VESTS' })).toMatch(/stop/i);
    expect(
      opSummary('delegate_vesting_shares', { delegator: 'alice', delegatee: 'bob', vesting_shares: '0.000000 VESTS' }),
    ).toMatch(/remove/i);
  });

  it('shows the JSON a custom_json actually signs, object or string', () => {
    // The vault serializes `typeof json === 'string' ? json : JSON.stringify(json)`
    // (hive-ops.ts:151). String(obj) would render "[object Object]" while the
    // object's real contents get signed — approval showing neither.
    const asObject = opSummary('custom_json', { id: 'follow', json: { follow: 'bob' } });
    expect(asObject).not.toContain('[object Object]');
    expect(asObject).toContain('"follow":"bob"');

    const asString = opSummary('custom_json', { id: 'follow', json: '["follow",{"a":1}]' });
    expect(asString).toContain('["follow",{"a":1}]');
  });

  it('marks a truncated custom_json so two payloads cannot look identical', () => {
    const prefix = 'x'.repeat(120);
    const a = opSummary('custom_json', { id: 'test', json: prefix + 'AAAA' });
    const b = opSummary('custom_json', { id: 'test', json: prefix + 'BBBBBBBB' });
    expect(a).toContain('…');
    expect(a).not.toBe(b);
    expect(a).toContain('+4 more chars');
    expect(b).toContain('+8 more chars');
    // Short payloads must not be marked at all.
    expect(opSummary('custom_json', { id: 'test', json: '{"a":1}' })).not.toContain('…');
  });

  it('surfaces every non-default comment_options payout control', () => {
    // Defaults stay quiet — a default-everything comment_options is just the post.
    expect(opSummary('comment_options', SAMPLES.comment_options)).toBe('Payout options for @alice/a-post');

    const declined = opSummary('comment_options', { ...SAMPLES.comment_options, max_accepted_payout: '0.000 HBD' });
    expect(declined).toContain('0.000 HBD');

    const allHive = opSummary('comment_options', { ...SAMPLES.comment_options, percent_hbd: 0 });
    expect(allHive).toContain('0.0% HBD');

    const noVotes = opSummary('comment_options', { ...SAMPLES.comment_options, allow_votes: false });
    expect(noVotes).toMatch(/votes disabled/i);

    const noCuration = opSummary('comment_options', {
      ...SAMPLES.comment_options,
      allow_curation_rewards: false,
    });
    expect(noCuration).toMatch(/curation rewards disabled/i);

    // Materially different payout behaviour must not render identically.
    expect(declined).not.toBe(allHive);
    expect(allHive).not.toBe(noVotes);
  });

  it('reads percent_steem_dollars, the legacy alias the vault also accepts', () => {
    // hive-ops.ts:225 falls back to it; a summary that ignored it would show
    // the default while a non-default value was signed.
    const legacy = opSummary('comment_options', {
      ...SAMPLES.comment_options,
      percent_hbd: undefined,
      percent_steem_dollars: 0,
    });
    expect(legacy).toContain('0.0% HBD');
  });

  it('names the beneficiaries a comment_options redirects payout to', () => {
    const withBenes = {
      ...SAMPLES.comment_options,
      extensions: [[0, { beneficiaries: [{ account: 'carol', weight: 2500 }] }]],
    };
    const summary = opSummary('comment_options', withBenes);
    expect(summary).toContain('carol');
    expect(summary).toContain('25.0%');
  });
});
