/**
 * Every Hive request renders a readable approval (KEEPKEY: peakd Snaps showed
 * "Unknown Method" with only ACCOUNT and COMMENT), and requests the KeepKey
 * would refuse are flagged before Approve. Payloads are shaped like peakd's
 * Keychain calls after hiveHandler turns them into events.
 */
import { describe, expect, it } from 'vitest';
import {
  buildHiveApprovalView,
  estimateHiveTxBytes,
  formatHiveOp,
  hiveOpsChecks,
  HIVE_CLEAR_SIGN_OPS,
  HIVE_CLIENT_POSTING_OPS,
} from '../../../../packages/shared/lib/utils/hiveApproval';
import { SUPPORTED_OPS } from './hiveOps';

const opsEvent = (type: string, operations: [string, Record<string, any>][], from = 'sopadevs') => ({
  type,
  siteUrl: 'https://peakd.com/snaps',
  unsignedTx: { from, operations: operations.map(([op, params]) => ({ op, summary: op, params })) },
});

// peakd Snaps: a reply under @peak.snaps' container post (the Vlad's real test shape).
const SNAP: [string, Record<string, any>] = [
  'comment',
  {
    parent_author: 'peak.snaps',
    parent_permlink: 'snap-container-1764160000',
    author: 'sopadevs',
    permlink: 're-peaksnaps-tp48oc',
    title: '',
    body: 'gm from a KeepKey 🔑\n\nfirst snap signed on the device',
    json_metadata: JSON.stringify({ app: 'peakd/2026.11.4', tags: ['snaps', 'keepkey'], image: [] }),
  },
];

const POST: [string, Record<string, any>] = [
  'comment',
  {
    parent_author: '',
    parent_permlink: 'hive-163772',
    author: 'sopadevs',
    permlink: 'hello-hive-from-keepkey',
    title: 'Hello Hive from a KeepKey',
    body: '# Hi\n\nThis post was signed on a hardware wallet.',
    json_metadata: JSON.stringify({ app: 'peakd/2026.11.4', tags: ['hive-163772', 'keepkey'], format: 'markdown' }),
  },
];

const OPTIONS: [string, Record<string, any>] = [
  'comment_options',
  {
    author: 'sopadevs',
    permlink: 'hello-hive-from-keepkey',
    max_accepted_payout: '1000000.000 HBD',
    percent_hbd: 0,
    allow_votes: true,
    allow_curation_rewards: true,
    extensions: [
      [
        0,
        {
          beneficiaries: [
            { account: 'keepkey', weight: 500 },
            { account: 'peakd', weight: 300 },
          ],
        },
      ],
    ],
  },
];

describe('requestPost', () => {
  it('a Snap reply: readable title, body preview, tags in details, posting key, device hint', () => {
    const v = buildHiveApprovalView(opsEvent('post', [SNAP]));
    expect(v.title).toBe('Reply to @peak.snaps/snap-container-1764160000');
    expect(v.title).not.toMatch(/unknown/i);
    expect(v.keyRole).toBe('posting');
    expect(v.account).toBe('sopadevs');
    expect(v.deviceHint).toBe('Reply by @sopadevs to @peak.snaps?');
    const op = v.ops[0];
    expect(op.opNumber).toBe(1);
    expect(op.rows).toEqual([{ label: 'Body', value: SNAP[1].body, long: true }]);
    expect(op.details).toEqual(
      expect.arrayContaining([
        { label: 'Permlink', value: 're-peaksnaps-tp48oc', mono: true },
        { label: 'Tags', value: '#snaps #keepkey' },
        { label: 'App', value: 'peakd/2026.11.4' },
      ]),
    );
    expect(v.checks).toEqual([expect.objectContaining({ status: 'ok' })]);
  });

  it('a top-level post with comment_options: payout and beneficiaries in clear rows', () => {
    const v = buildHiveApprovalView(opsEvent('post', [POST, OPTIONS]));
    expect(v.title).toBe('Publish a post');
    expect(v.deviceHint).toBe('Create post by @sopadevs?');
    expect(v.ops[0].rows).toEqual([
      { label: 'Title', value: 'Hello Hive from a KeepKey' },
      { label: 'Body', value: POST[1].body, long: true },
      { label: 'Category', value: 'hive-163772' },
    ]);
    expect(v.ops[1].opNumber).toBe(19);
    expect(v.ops[1].rows).toEqual([
      { label: 'Max payout', value: '1000000.000 HBD (default)' },
      { label: 'HBD split', value: '0%' },
      { label: 'Votes', value: 'Allowed' },
      { label: 'Curation', value: 'Allowed' },
      { label: 'Beneficiary 1/2', value: '@keepkey gets 5%' },
      { label: 'Beneficiary 2/2', value: '@peakd gets 3%' },
    ]);
    expect(v.checks.map(c => c.status)).toEqual(['ok']);
  });

  it('declined payout reads as such', () => {
    const op = formatHiveOp('comment_options', { ...OPTIONS[1], max_accepted_payout: '0.000 HBD', extensions: [] });
    expect(op.rows[0]).toEqual({ label: 'Max payout', value: '0.000 HBD (declines payout)' });
  });
});

describe('device checks before Approve', () => {
  it('unsorted beneficiaries, >100% and options not after their post are blocked', () => {
    const bad: [string, Record<string, any>] = [
      'comment_options',
      {
        ...OPTIONS[1],
        extensions: [
          [
            0,
            {
              beneficiaries: [
                { account: 'zed', weight: 6000 },
                { account: 'abe', weight: 6000 },
              ],
            },
          ],
        ],
      },
    ];
    const titles = hiveOpsChecks([POST, bad]).map(c => `${c.status}:${c.title}`);
    expect(titles).toContain('block:Beneficiaries must be sorted by name, without repeats');
    expect(titles).toContain('block:Beneficiaries add up to 120% (max 100%)');
    expect(hiveOpsChecks([OPTIONS, POST]).map(c => c.title)).toContain('Payout options must follow their post');
  });

  it('a post too long for the 2048-byte device buffer is blocked; near the limit warns', () => {
    const long: [string, Record<string, any>] = ['comment', { ...POST[1], body: 'x'.repeat(2100) }];
    expect(hiveOpsChecks([long])[0]).toMatchObject({
      status: 'block',
      title: expect.stringMatching(/^Too long for KeepKey/),
    });
    const near: [string, Record<string, any>] = ['comment', { ...POST[1], body: 'x'.repeat(1750) }];
    expect(estimateHiveTxBytes([near])).toBeGreaterThan(1898);
    expect(hiveOpsChecks([near]).map(c => c.status)).toEqual(['warn']);
  });

  it('more than 4 ops, posting+active mix and ops outside the table are blocked', () => {
    const vote: [string, Record<string, any>] = [
      'vote',
      { voter: 'sopadevs', author: 'a', permlink: 'p', weight: 10000 },
    ];
    expect(hiveOpsChecks([vote, vote, vote, vote, vote]).map(c => c.title)).toContain(
      'KeepKey signs 1–4 operations at a time (this has 5)',
    );
    const powerUp: [string, Record<string, any>] = [
      'transfer_to_vesting',
      { from: 'sopadevs', to: 'sopadevs', amount: '1.000 HIVE' },
    ];
    expect(hiveOpsChecks([vote, powerUp]).map(c => c.title)).toContain('Mixes posting-key and active-key operations');
    expect(
      hiveOpsChecks([['account_witness_vote', { account: 'sopadevs', witness: 'w', approve: true }]]).map(c => c.title),
    ).toContain("KeepKey can't sign account_witness_vote");
  });

  it('the panel browser-key table matches the signer table, and flags posting-only batches', async () => {
    const { CLIENT_POSTING_OPS } = await import('./hiveTx');
    expect([...HIVE_CLIENT_POSTING_OPS].sort()).toEqual([...CLIENT_POSTING_OPS].sort());
    expect(buildHiveApprovalView(opsEvent('post', [POST, OPTIONS])).clientSignable).toBe(true);
    const powerUp = buildHiveApprovalView(
      opsEvent('powerUp', [['transfer_to_vesting', { from: 'a', to: 'a', amount: '1.000 HIVE' }]]),
    );
    expect(powerUp.clientSignable).toBe(false);
    const heJson = buildHiveApprovalView(
      opsEvent('custom_json', [
        ['custom_json', { required_auths: ['a'], required_posting_auths: [], id: 'ssc-mainnet-hive', json: '{}' }],
      ]),
    );
    expect(heJson.clientSignable).toBe(false);
  });

  it('the panel table matches the background clear-sign table', () => {
    expect([...HIVE_CLEAR_SIGN_OPS].sort()).toEqual([...SUPPORTED_OPS].sort());
  });
});

describe('requestVote', () => {
  it('upvote, downvote and unvote with weight in %', () => {
    const up = buildHiveApprovalView(
      opsEvent('vote', [['vote', { voter: 'sopadevs', author: 'peak.snaps', permlink: 're-x', weight: 5000 }]]),
    );
    expect(up.title).toBe('Vote on @peak.snaps/re-x');
    expect(up.ops[0].rows).toEqual([
      { label: 'Voter', value: '@sopadevs' },
      { label: 'Weight', value: '50%' },
    ]);
    expect(formatHiveOp('vote', { voter: 'a', author: 'b', permlink: 'c', weight: -2500 }).title).toBe('Downvote @b/c');
    expect(formatHiveOp('vote', { voter: 'a', author: 'b', permlink: 'c', weight: 0 }).title).toBe(
      'Remove vote on @b/c',
    );
  });
});

describe('requestCustomJson', () => {
  const cj = (id: string, json: unknown, active = false) =>
    formatHiveOp('custom_json', {
      required_auths: active ? ['sopadevs'] : [],
      required_posting_auths: active ? [] : ['sopadevs'],
      id,
      json: JSON.stringify(json),
    });

  it('follow / unfollow / mute / reblog', () => {
    expect(cj('follow', ['follow', { follower: 'sopadevs', following: 'peak.snaps', what: ['blog'] }]).title).toBe(
      'Follow @peak.snaps',
    );
    expect(cj('follow', ['follow', { follower: 'sopadevs', following: 'x', what: [] }]).title).toBe('Unfollow @x');
    expect(cj('follow', ['follow', { follower: 'sopadevs', following: 'x', what: ['ignore'] }]).title).toBe('Mute @x');
    expect(cj('follow', ['reblog', { account: 'sopadevs', author: 'a', permlink: 'p' }]).title).toBe('Reblog @a/p');
  });

  it('community, notifications, Splinterlands, Hive Engine', () => {
    expect(cj('community', ['subscribe', { community: 'hive-163772' }]).title).toBe('Join community hive-163772');
    expect(cj('notify', ['setLastRead', { date: '2026-11-26T15:30:00' }]).title).toBe('Mark notifications as read');
    expect(cj('sm_claim_reward', { type: 'quest' }).title).toBe('Splinterlands: claim reward');
    const he = cj(
      'ssc-mainnet-hive',
      {
        contractName: 'tokens',
        contractAction: 'transfer',
        contractPayload: { symbol: 'LEO', to: 'x', quantity: '1.5', memo: '' },
      },
      true,
    );
    expect(he.title).toBe('Send 1.5 LEO to @x');
  });

  it('shows posting vs active authority and the JSON', () => {
    const op = cj('follow', ['follow', { follower: 'sopadevs', following: 'y', what: ['blog'] }]);
    expect(op.rows).toContainEqual({ label: 'Authority', value: 'Posting (@sopadevs)' });
    expect(op.details[0].label).toBe('JSON');
    const active = cj('ssc-mainnet-hive', { contractName: 'market', contractAction: 'buy', contractPayload: {} }, true);
    expect(active.rows).toContainEqual({ label: 'Authority', value: 'Active (@sopadevs)' });
    expect(active.title).toBe('Hive Engine: market.buy');
    expect(cj('unknown-app', { a: 1 }).title).toBe('Custom JSON: unknown-app');
  });

  it('a custom_json event keys off its authority', () => {
    const v = buildHiveApprovalView(
      opsEvent('custom_json', [
        [
          'custom_json',
          { required_auths: ['sopadevs'], required_posting_auths: [], id: 'ssc-mainnet-hive', json: '{}' },
        ],
      ]),
    );
    expect(v.keyRole).toBe('active');
    expect(v.description).toMatch(/Can move funds/);
  });
});

describe('requestBroadcast', () => {
  it('lists every op with the same formatter', () => {
    const v = buildHiveApprovalView(
      opsEvent('broadcast', [
        ['vote', { voter: 'sopadevs', author: 'a', permlink: 'p', weight: 10000 }],
        [
          'custom_json',
          {
            required_auths: [],
            required_posting_auths: ['sopadevs'],
            id: 'follow',
            json: '["follow",{"follower":"sopadevs","following":"a","what":["blog"]}]',
          },
        ],
      ]),
    );
    expect(v.title).toBe('Broadcast operations');
    expect(v.ops.map(o => o.title)).toEqual(['Vote on @a/p', 'Follow @a']);
    expect(v.deviceHint).toBe('Sign 2 Hive operations with the Posting key?');
  });
});

describe('active-key requests', () => {
  it('power up/down, delegation, savings, conversion read as actions', () => {
    expect(formatHiveOp('transfer_to_vesting', { from: 'a', to: 'a', amount: '1.000 HIVE' }).title).toBe(
      'Power up 1.000 HIVE',
    );
    expect(formatHiveOp('withdraw_vesting', { account: 'a', vesting_shares: '0.000000 VESTS' }).title).toBe(
      'Stop power down',
    );
    expect(
      formatHiveOp('delegate_vesting_shares', { delegator: 'a', delegatee: 'b', vesting_shares: '10.000000 VESTS' })
        .title,
    ).toBe('Delegate 10.000000 VESTS');
    expect(formatHiveOp('transfer_to_savings', { from: 'a', to: 'a', amount: '1.000 HBD', memo: '' }).title).toBe(
      'Savings deposit 1.000 HBD',
    );
    expect(formatHiveOp('convert', { owner: 'a', requestid: 7, amount: '1.000 HBD' }).title).toBe(
      'Convert 1.000 HBD to HIVE',
    );
  });

  it('transfer event: amount from base units, active key', () => {
    const v = buildHiveApprovalView({
      type: 'transfer',
      unsignedTx: {
        from: 'sopadevs',
        memo: 'thanks',
        payment: { destination: 'peak.snaps', amount: '1500', decimals: 3, symbol: 'HIVE' },
      },
    });
    expect(v.title).toBe('Send 1.500 HIVE to @peak.snaps');
    expect(v.keyRole).toBe('active');
  });
});

describe('requestSignBuffer', () => {
  it('a login challenge reads as a login with the site', () => {
    const v = buildHiveApprovalView({
      type: 'signBuffer',
      siteUrl: 'https://peakd.com/',
      unsignedTx: { from: 'sopadevs', messageUtf8: '#login-1764170000', role: 'posting', title: 'Login' },
    });
    expect(v.title).toBe('Log in to peakd.com');
    expect(v.message).toEqual({
      text: '#login-1764170000',
      printable: true,
      purpose: 'Log in to peakd.com. No funds move.',
    });
    expect(v.checks.map(c => c.status)).toEqual(['ok']);
  });

  it('readable non-login text is a message; raw bytes and long text are blocked', () => {
    const msg = buildHiveApprovalView({
      type: 'signBuffer',
      unsignedTx: { from: 'a', messageUtf8: 'I agree to the terms of service v2.', role: 'posting' },
    });
    expect(msg.title).toBe('Sign a message');
    const raw = buildHiveApprovalView({
      type: 'signBuffer',
      unsignedTx: { from: 'a', message: 'deadbeef', role: 'posting' },
    });
    expect(raw.checks[0]).toMatchObject({ status: 'block', title: 'KeepKey signs readable text only' });
    const long = buildHiveApprovalView({
      type: 'signBuffer',
      unsignedTx: { from: 'a', messageUtf8: 'word '.repeat(300), role: 'posting' },
    });
    expect(long.checks[0].status).toBe('block');
  });
});

describe('requestSignBuffer: skatehive.app KeepKey login', () => {
  it('reads as "Log in to skatehive.app" with account, key and message (no To/Amount)', () => {
    const v = buildHiveApprovalView({
      type: 'signBuffer',
      siteUrl: 'https://skatehive.app/',
      unsignedTx: {
        from: 'sopadevs',
        messageUtf8: 'Login to Skatehive 1764171600000',
        role: 'posting',
        title: 'Login',
      },
    });
    expect(v.title).toBe('Log in to skatehive.app');
    expect(v.account).toBe('sopadevs');
    expect(v.keyRole).toBe('posting');
    expect(v.message?.text).toBe('Login to Skatehive 1764171600000');
    expect(v.ops).toEqual([]);
    expect(JSON.stringify(v)).not.toMatch(/"(To|Amount)"/);
  });
});

describe('requestSignBuffer: control characters', () => {
  it('text with a control character is not printable, so it is blocked', () => {
    const v = buildHiveApprovalView({
      type: 'signBuffer',
      unsignedTx: { from: 'a', messageUtf8: 'hi\u0007there', role: 'posting' },
    });
    expect(v.message?.printable).toBe(false);
    expect(v.checks[0].status).toBe('block');
    const ok = buildHiveApprovalView({
      type: 'signBuffer',
      unsignedTx: { from: 'a', messageUtf8: 'line one\nline two\ttab', role: 'posting' },
    });
    expect(ok.message?.printable).toBe(true);
  });
});

describe('unknown requests', () => {
  it('names the method instead of "Unknown Method"', () => {
    const v = buildHiveApprovalView({ type: 'witnessVote', unsignedTx: { from: 'a' } });
    expect(v.known).toBe(false);
    expect(v.title).toBe('Hive request: witnessVote');
    expect(v.checks[0].status).toBe('warn');
  });

  it('an op outside the table still lists its fields', () => {
    const op = formatHiveOp('account_witness_vote', { account: 'a', witness: 'w', approve: true });
    expect(op.title).toBe('Operation: account_witness_vote');
    expect(op.rows).toEqual([
      { label: 'account', value: 'a' },
      { label: 'witness', value: 'w' },
      { label: 'approve', value: 'true' },
    ]);
  });
});
