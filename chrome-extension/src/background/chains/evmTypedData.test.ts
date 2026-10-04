/**
 * The EVM typed-data approval card shows evmTypedData's summary and nothing
 * else a user can read: the device path (EthereumSignTypedHash) puts only two
 * hashes on the OLED. So the summary must read every value exactly as the
 * vault's hasher does — a payload written to look like one thing and hash as
 * another is the attack — and must never downgrade an approval it cannot read
 * into a quiet generic view.
 *
 * The "hashes identically" vectors below were checked against the vault's
 * installed eip-712 1.0.0 / @findeth/abi 0.3.1 (same domain and message hash
 * as the canonical payload); the bool vectors record what that hasher does,
 * which is BigInt(value), not truthiness.
 */
import { describe, it, expect } from 'vitest';
import {
  extractTypedData,
  formatUnits,
  permitTokenAddresses,
  sanitizeSymbol,
  summarizeTypedData,
  toTokenMeta,
  withTokenMetadata,
  type TypedDataSummary,
} from './evmTypedData';

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const ROUTER = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD';
const OWNER = '0x1111111111111111111111111111111111111111';
const NOW = 1_800_000_000;
const DAY = 86_400;
const MAX_UINT160 = '1461501637330902918203684832716283019655932542975';
const MAX_UINT48 = '281474976710655';
const MAX_UINT256 = ((1n << 256n) - 1n).toString();
const CTX = { activeChainId: 1, nowSec: NOW };

const f = (name: string, type: string) => ({ name, type });
const PERMIT2_DOMAIN_TYPE = [f('name', 'string'), f('chainId', 'uint256'), f('verifyingContract', 'address')];
const TOKEN_DOMAIN_TYPE = [
  f('name', 'string'),
  f('version', 'string'),
  f('chainId', 'uint256'),
  f('verifyingContract', 'address'),
];
const PERMIT_DETAILS = [f('token', 'address'), f('amount', 'uint160'), f('expiration', 'uint48'), f('nonce', 'uint48')];
const TOKEN_PERMISSIONS = [f('token', 'address'), f('amount', 'uint256')];

// What Uniswap's interface asks for: unlimited amount, 30-day allowance,
// 30-minute signature deadline.
const permitSingle = () => ({
  types: {
    EIP712Domain: PERMIT2_DOMAIN_TYPE,
    PermitSingle: [f('details', 'PermitDetails'), f('spender', 'address'), f('sigDeadline', 'uint256')],
    PermitDetails: PERMIT_DETAILS,
  },
  primaryType: 'PermitSingle',
  domain: { name: 'Permit2', chainId: 1, verifyingContract: PERMIT2 },
  message: {
    details: { token: USDC, amount: MAX_UINT160, expiration: String(NOW + 30 * DAY), nonce: '0' },
    spender: ROUTER,
    sigDeadline: String(NOW + 1800),
  } as Record<string, any>,
});

const permitBatch = () => ({
  types: {
    EIP712Domain: PERMIT2_DOMAIN_TYPE,
    PermitBatch: [f('details', 'PermitDetails[]'), f('spender', 'address'), f('sigDeadline', 'uint256')],
    PermitDetails: PERMIT_DETAILS,
  },
  primaryType: 'PermitBatch',
  domain: { name: 'Permit2', chainId: 1, verifyingContract: PERMIT2 },
  message: {
    details: [
      { token: USDC, amount: '1234560000', expiration: String(NOW + DAY), nonce: '0' },
      { token: WETH, amount: '5', expiration: String(NOW + DAY), nonce: '0' },
    ],
    spender: ROUTER,
    sigDeadline: String(NOW + 1800),
  },
});

const transferWithWitness = () => ({
  types: {
    EIP712Domain: PERMIT2_DOMAIN_TYPE,
    PermitWitnessTransferFrom: [
      f('permitted', 'TokenPermissions'),
      f('spender', 'address'),
      f('nonce', 'uint256'),
      f('deadline', 'uint256'),
      f('witness', 'Order'),
    ],
    TokenPermissions: TOKEN_PERMISSIONS,
    Order: [f('recipient', 'address'), f('minOut', 'uint256')],
  },
  primaryType: 'PermitWitnessTransferFrom',
  domain: { name: 'Permit2', chainId: 1, verifyingContract: PERMIT2 },
  message: {
    permitted: { token: USDC, amount: '1000000' },
    spender: ROUTER,
    nonce: '7',
    deadline: String(NOW + 600),
    witness: { recipient: OWNER, minOut: '42' } as Record<string, any>,
  } as Record<string, any>,
});

// SignatureTransfer without a witness, single or batch.
const transferFrom = (batch: boolean) => ({
  types: {
    EIP712Domain: PERMIT2_DOMAIN_TYPE,
    [batch ? 'PermitBatchTransferFrom' : 'PermitTransferFrom']: [
      f('permitted', batch ? 'TokenPermissions[]' : 'TokenPermissions'),
      f('spender', 'address'),
      f('nonce', 'uint256'),
      f('deadline', 'uint256'),
    ],
    TokenPermissions: TOKEN_PERMISSIONS,
  },
  primaryType: batch ? 'PermitBatchTransferFrom' : 'PermitTransferFrom',
  domain: { name: 'Permit2', chainId: 1, verifyingContract: PERMIT2 },
  message: {
    permitted: batch
      ? [
          { token: USDC, amount: '1000000' },
          { token: WETH, amount: MAX_UINT256 },
        ]
      : { token: USDC, amount: '1000000' },
    spender: ROUTER,
    nonce: '7',
    deadline: String(NOW + 600),
  },
});

const usdcPermit = () => ({
  types: {
    EIP712Domain: TOKEN_DOMAIN_TYPE,
    Permit: [
      f('owner', 'address'),
      f('spender', 'address'),
      f('value', 'uint256'),
      f('nonce', 'uint256'),
      f('deadline', 'uint256'),
    ],
  },
  primaryType: 'Permit',
  domain: { name: 'USD Coin', version: '2', chainId: 1, verifyingContract: USDC } as Record<string, any>,
  message: { owner: OWNER, spender: ROUTER, value: '1000000', nonce: 0, deadline: NOW + 1800 } as Record<string, any>,
});

const daiPermit = (allowed: unknown) => ({
  types: {
    EIP712Domain: TOKEN_DOMAIN_TYPE,
    Permit: [
      f('holder', 'address'),
      f('spender', 'address'),
      f('nonce', 'uint256'),
      f('expiry', 'uint256'),
      f('allowed', 'bool'),
    ],
  },
  primaryType: 'Permit',
  domain: { name: 'Dai Stablecoin', version: '1', chainId: 1, verifyingContract: DAI },
  message: { holder: OWNER, spender: ROUTER, nonce: 0, expiry: NOW + DAY, allowed },
});

// The example from the EIP-712 spec itself.
const mail = () => ({
  types: {
    EIP712Domain: TOKEN_DOMAIN_TYPE,
    Person: [f('name', 'string'), f('wallet', 'address')],
    Mail: [f('from', 'Person'), f('to', 'Person'), f('contents', 'string')],
  },
  primaryType: 'Mail',
  domain: {
    name: 'Ether Mail',
    version: '1',
    chainId: 1,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  },
  message: {
    from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
    to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
    contents: 'Hello, Bob!',
  },
});

// Permit2 hashes a witness transfer with typeHash = keccak(STUB ‖
// witnessTypeString), and the caller picks witnessTypeString when it submits.
// Merging two canonical names into one and adding a trailing field keeps both
// the typehash text and Permit2's six-word layout. So `nonce` and `spender`
// (and the batch variant) all hash as Permit2's digest for an UNLIMITED USDC
// transfer to 0xbad…bad0, with witnessTypeString
// 'uint256 witness,bytes32 extra)TokenPermissions(address token,uint256 amount)'.
// This was checked against the vault's hasher and Permit2's hashWithWitness.
const forgedWitness = (merged: 'nonce' | 'spender', batch = false) => {
  const primaryType = batch ? 'PermitBatchWitnessTransferFrom' : 'PermitWitnessTransferFrom';
  const permittedType = batch ? 'TokenPermissions[]' : 'TokenPermissions';
  const permitted = batch ? [{ token: USDC, amount: MAX_UINT256 }] : { token: USDC, amount: MAX_UINT256 };
  const nonce = '1993350690010297187297845542225651345614342557312405510537486004353335001601';
  const [head, values] =
    merged === 'nonce'
      ? [
          [f('permitted', permittedType), f('spender', 'address'), f('nonce,uint256 deadline', 'uint256')],
          { permitted, spender: '0xbadbadbadbadbadbadbadbadbadbadbadbadbad0', 'nonce,uint256 deadline': nonce },
        ]
      : [
          [f('permitted,address spender', permittedType), f('nonce', 'uint256'), f('deadline', 'uint256')],
          // The spender, as a decimal "nonce".
          {
            'permitted,address spender': permitted,
            nonce: '1066771280581701788158928929179235639988176403152',
            deadline: nonce,
          },
        ];
  return {
    types: {
      EIP712Domain: PERMIT2_DOMAIN_TYPE,
      [primaryType]: [...head, f('witness', 'uint256'), f('extra', 'bytes32')],
      TokenPermissions: TOKEN_PERMISSIONS,
    },
    primaryType,
    domain: { name: 'Permit2', chainId: 1, verifyingContract: PERMIT2 },
    message: { ...values, witness: '1758001800', extra: '0x' + '00'.repeat(32) },
  };
};
const FORGED_WITNESSES = [forgedWitness('nonce'), forgedWitness('spender'), forgedWitness('nonce', true)];

// Hyperliquid's user-signed actions, as pinned in the vault's known-answer
// tests (hdwallet-keepkey eip712-struct-hash.test.ts): colon-namespaced types.
const HL_DOMAIN_TYPE = TOKEN_DOMAIN_TYPE;
const HL_DOMAIN = {
  name: 'HyperliquidSignTransaction',
  version: '1',
  chainId: 421614,
  verifyingContract: '0x0000000000000000000000000000000000000000',
};
const hyperliquidApproveAgent = () => ({
  types: {
    EIP712Domain: HL_DOMAIN_TYPE,
    'HyperliquidTransaction:ApproveAgent': [
      f('hyperliquidChain', 'string'),
      f('agentAddress', 'address'),
      f('agentName', 'string'),
      f('nonce', 'uint64'),
    ],
  },
  primaryType: 'HyperliquidTransaction:ApproveAgent',
  domain: HL_DOMAIN,
  message: {
    hyperliquidChain: 'Mainnet',
    agentAddress: '0x141d9959cae3853B035000490C03991Eb70Fc4AC',
    agentName: 'BasedApp',
    nonce: '1783201736956',
  },
});
const hyperliquidUsdSend = () => ({
  types: {
    EIP712Domain: HL_DOMAIN_TYPE,
    'HyperliquidTransaction:UsdSend': [
      f('hyperliquidChain', 'string'),
      f('destination', 'string'),
      f('amount', 'string'),
      f('time', 'uint64'),
    ],
  },
  primaryType: 'HyperliquidTransaction:UsdSend',
  domain: HL_DOMAIN,
  message: {
    hyperliquidChain: 'Mainnet',
    destination: '0x5e9ee1089755c3435139848e47e6635505d5a13',
    amount: '100.0',
    time: 1783201736956,
  },
});

/** Through the extractor, as ethereumHandler does it. */
function summarize(payload: unknown, ctx: { activeChainId: string | number | null; nowSec: number } = CTX) {
  const r = extractTypedData([OWNER, payload]);
  if (!r.ok) throw new Error(`extract rejected: ${r.message}`);
  return summarizeTypedData(r.typedData, ctx);
}

const codes = (s: TypedDataSummary) => s.warnings.map(w => w.code);

/** The parts of a summary a permit card renders — everything but the field tree. */
const decoded = (s: TypedDataSummary) => ({
  kind: s.kind,
  tokens: s.tokens,
  spender: s.spender?.toLowerCase(),
  deadline: s.deadline,
  chainId: s.chainId,
  verifyingContract: s.verifyingContract?.toLowerCase(),
  warnings: s.warnings,
});

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

function expectJsonSafe(v: unknown, path = 'summary'): void {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') {
    expect(Number.isFinite(v), path).toBe(true);
    return;
  }
  if (Array.isArray(v)) return v.forEach((x, i) => expectJsonSafe(x, `${path}[${i}]`));
  if (typeof v === 'object') return Object.entries(v).forEach(([k, x]) => expectJsonSafe(x, `${path}.${k}`));
  throw new Error(`${path} is ${typeof v}, which chrome.storage cannot hold`);
}

describe('extractTypedData', () => {
  it('finds the payload in v1 and v3/v4 param order, object or JSON string', () => {
    const obj = permitSingle();
    const v4 = extractTypedData([OWNER, obj]);
    expect(v4.ok && v4.typedData).toBe(obj); // the dApp's own object, not a copy
    const v1 = extractTypedData([obj, OWNER]);
    expect(v1.ok && v1.typedData).toBe(obj);
    const str = extractTypedData([OWNER, JSON.stringify(obj)]);
    expect(str.ok && str.typedData).toEqual(obj);
  });

  it('rejects the legacy v1 array format with 4200', () => {
    const legacy = [{ type: 'string', name: 'message', value: 'hi' }];
    expect(extractTypedData([legacy, OWNER])).toMatchObject({ ok: false, code: 4200 });
    expect(extractTypedData([OWNER, JSON.stringify(legacy)])).toMatchObject({ ok: false, code: 4200 });
  });

  it('rejects malformed payloads with -32602', () => {
    const bad = [
      [OWNER, { ...permitSingle(), primaryType: 7 }],
      [OWNER, { ...permitSingle(), types: 'x' }],
      [OWNER, { ...permitSingle(), message: null }],
      [OWNER, { ...permitSingle(), message: [] }],
      [OWNER, '{not json'],
      [OWNER, '"a string"'],
      [OWNER],
      [],
      'not-an-array',
    ];
    for (const params of bad) expect(extractTypedData(params)).toMatchObject({ ok: false, code: -32602 });
  });

  it('refuses type names the hasher reads two ways', () => {
    // Vaults before hdwallet's colon fix look a struct up by the leading \w+
    // of its name for the typehash, and by the full name for the fields.
    // There `claim`, `reward` and `colon` hash exactly like the canonical
    // unlimited PermitSingle / 2612 permit while declaring fields that read as
    // an airdrop claim.
    const claim = permitSingle() as any;
    claim.primaryType = 'PermitSingle-Claim';
    claim.types['PermitSingle-Claim'] = [
      f('reward', 'PermitDetails-Airdrop'),
      f('claimer', 'address'),
      f('claimBy', 'uint256'),
    ];
    claim.types['PermitDetails-Airdrop'] = [
      f('rewardToken', 'address'),
      f('rewardAmount', 'uint160'),
      f('claimWindow', 'uint48'),
      f('claimId', 'uint48'),
    ];
    claim.message = {
      reward: { rewardToken: USDC, rewardAmount: MAX_UINT160, claimWindow: String(NOW + 30 * DAY), claimId: '0' },
      claimer: ROUTER,
      claimBy: String(NOW + 1800),
    };
    const reward = usdcPermit() as any;
    reward.primaryType = 'Permit Reward';
    reward.types['Permit Reward'] = [
      f('a', 'address'),
      f('b', 'address'),
      f('c', 'uint256'),
      f('d', 'uint256'),
      f('e', 'uint256'),
    ];
    reward.message = { a: OWNER, b: ROUTER, c: MAX_UINT256, d: 0, e: NOW + 1800 };
    // A colon is fine on its own (Hyperliquid), not when `types` also
    // defines the name before it.
    const colon = { ...reward, primaryType: 'Permit:Reward', types: { ...reward.types } };
    colon.types['Permit:Reward'] = colon.types['Permit Reward'];
    delete colon.types['Permit Reward'];
    // Refused wherever such a name appears, array suffix or not.
    const nested = permitBatch() as any;
    nested.types.PermitBatch[0] = f('details', 'PermitDetails-Airdrop[]');
    nested.types['PermitDetails-Airdrop'] = PERMIT_DETAILS;
    for (const p of [claim, reward, colon, nested]) {
      expect(extractTypedData([OWNER, p]), p.primaryType).toMatchObject({ ok: false, code: -32602 });
    }
  });

  it('refuses an array suffix on primaryType', () => {
    // The typehash comes from the leading \w+ ('Permit'), the values from the
    // full key ('Permit[]'): the canonical definition stays under the plain
    // name, and the suffixed one renames every field. Each of these hashes
    // like the canonical unlimited permit.
    const suffixed = (p: any, suffix: string) => {
      const defs: { name: string; type: string }[] = p.types[p.primaryType];
      const renamed = defs.map((d, i) => f(`claim${i}`, d.type));
      const message = Object.fromEntries(defs.map((d, i) => [`claim${i}`, p.message[d.name]]));
      return {
        ...p,
        primaryType: p.primaryType + suffix,
        types: { ...p.types, [p.primaryType + suffix]: renamed },
        message,
      };
    };
    const unlimited = usdcPermit();
    unlimited.message.value = MAX_UINT256;
    const batchWitness = transferWithWitness() as any;
    batchWitness.types.PermitBatchWitnessTransferFrom = batchWitness.types.PermitWitnessTransferFrom.map((d: any) =>
      d.name === 'permitted' ? f('permitted', 'TokenPermissions[]') : d,
    );
    delete batchWitness.types.PermitWitnessTransferFrom;
    batchWitness.primaryType = 'PermitBatchWitnessTransferFrom';
    batchWitness.message.permitted = [{ token: USDC, amount: MAX_UINT256 }];
    for (const p of [suffixed(unlimited, '[]'), suffixed(permitSingle(), '[]'), suffixed(batchWitness, '[0]')]) {
      expect(extractTypedData([OWNER, p]), p.primaryType).toMatchObject({ ok: false, code: -32602 });
    }
    // Refused on either half alone: a suffixed primaryType with no such key,
    // and a `types` key that is not \w+ (reachable only that way).
    const bare = { ...usdcPermit(), primaryType: 'Permit[]' };
    const spare = usdcPermit() as any;
    spare.types['Permit[]'] = spare.types.Permit;
    for (const p of [bare, spare]) expect(extractTypedData([OWNER, p])).toMatchObject({ ok: false, code: -32602 });
  });

  it('refuses page-sized type strings quickly', () => {
    // A strip-then-test regex retried at every '[' was quadratic here: 60 KB
    // blocked the service worker for seconds, before any approval.
    for (const junk of ['[]'.repeat(30_000) + 'x', '[1]'.repeat(30_000) + 'x', 'A' + '[1]'.repeat(30_000)]) {
      for (const p of [
        { ...mail(), primaryType: junk },
        { ...mail(), types: { ...mail().types, Mail: [f('contents', junk)] } },
      ]) {
        const start = performance.now();
        expect(extractTypedData([OWNER, p])).toMatchObject({ ok: false, code: -32602 });
        expect(performance.now() - start).toBeLessThan(250);
      }
    }
  });

  it('caps the length of every name, since the summary repeats it in each node', () => {
    const long = 'A'.repeat(257);
    const cases = [
      { ...mail(), primaryType: long, types: { ...mail().types, [long]: mail().types.Mail } },
      { ...mail(), types: { ...mail().types, [long]: [] } },
      { ...mail(), types: { ...mail().types, Mail: [f('from', long)], [long]: [] } },
      { ...mail(), types: { ...mail().types, Mail: [f(long, 'string')] } },
    ];
    for (const p of cases) expect(extractTypedData([OWNER, p])).toMatchObject({ ok: false, code: -32602 });
    // 256 is the cap, not the limit of a legitimate name.
    const atCap = 'A'.repeat(256);
    expect(extractTypedData([OWNER, { ...mail(), types: { ...mail().types, [atCap]: [f(atCap, 'string')] } }]).ok).toBe(
      true,
    );
  });

  it('accepts colon-namespaced type names, which the vault hashes as written (Hyperliquid)', () => {
    for (const p of [hyperliquidApproveAgent(), hyperliquidUsdSend()]) {
      const s = summarize(JSON.stringify(p), { activeChainId: 421614, nowSec: NOW });
      expect(s.kind, p.primaryType).toBe('generic');
      expect(s.looksLikePermit, p.primaryType).toBe(false);
      expect(s.primaryType).toBe(p.primaryType);
      expect(codes(s), p.primaryType).toEqual([]);
      expect(s.messageFields.map(n => [n.name, n.value, n.invalid])).toEqual(
        Object.entries(p.message).map(([k, v]) => [k, String(v), false]),
      );
    }
  });

  it('refuses field names that respell the typehash', () => {
    // A ',' '(' or ')' in a field name lets one set of fields spell another's
    // typehash (see forgedWitness).
    for (const p of FORGED_WITNESSES) {
      expect(extractTypedData([OWNER, JSON.stringify(p)]), p.primaryType).toMatchObject({ ok: false, code: -32602 });
    }
    const paren = mail() as any;
    paren.types.Mail[2] = f('contents)Note(uint256 id', 'string');
    expect(extractTypedData([OWNER, paren])).toMatchObject({ ok: false, code: -32602 });
  });
});

describe('Permit2 allowance (PermitSingle / PermitBatch)', () => {
  it('decodes a Uniswap-style unlimited PermitSingle', () => {
    const s = summarize(permitSingle());
    expect(s.kind).toBe('permit2-allowance');
    expect(s.looksLikePermit).toBe(true);
    expect(s.spender).toBe(ROUTER);
    expect(s.verifyingContract).toBe(PERMIT2);
    expect(s.chainId).toBe('1');
    expect(s.deadline).toEqual({ raw: String(NOW + 1800), unixMs: (NOW + 1800) * 1000, note: null });
    expect(s.tokens).toHaveLength(1);
    expect(s.tokens[0]).toMatchObject({ address: USDC, amountRaw: MAX_UINT160, unlimited: true });
    expect(s.tokens[0].expires).toEqual({ raw: String(NOW + 30 * DAY), unixMs: (NOW + 30 * DAY) * 1000, note: null });
    // Exactly 30 days is Uniswap's default and is not "long".
    expect(codes(s)).toEqual(['UNLIMITED_AMOUNT']);
    expect(s.warnings[0]).toEqual({ code: 'UNLIMITED_AMOUNT', severity: 'danger', params: { token: USDC } });
  });

  it('formats a finite amount exactly once decimals are known', () => {
    const td = permitSingle();
    td.message.details.amount = '1234560000';
    const s = withTokenMetadata(summarize(td), { [USDC.toLowerCase()]: { symbol: 'USDC', decimals: 6 } });
    expect(s.tokens[0]).toMatchObject({ unlimited: false, symbol: 'USDC', decimals: 6, amount: '1,234.56' });
    expect(codes(s)).toEqual([]);
  });

  it('decodes hasher-equivalent spellings exactly like the canonical payload', () => {
    const canonical = summarize(permitSingle());
    const variant = permitSingle();
    variant.domain = { name: 'Permit2', chainId: ' 1' as any, verifyingContract: '0X' + PERMIT2.slice(2) };
    variant.message = {
      details: {
        token: '0X' + USDC.slice(2),
        amount: ` ${MAX_UINT160} `,
        expiration: '0x' + (NOW + 30 * DAY).toString(16),
        nonce: '0o0',
      },
      spender: '0X' + ROUTER.slice(2).toLowerCase(),
      sigDeadline: `+${NOW + 1800}`,
    };
    expect(decoded(summarize(variant))).toEqual(decoded(canonical));
  });

  it('calls an amount unlimited from 2^128-1 up', () => {
    const at = (amount: bigint) => {
      const td = permitSingle();
      td.message.details.amount = amount.toString();
      const s = summarize(td);
      return [s.tokens[0].unlimited, codes(s)];
    };
    expect(at((1n << 128n) - 2n)).toEqual([false, []]);
    expect(at((1n << 128n) - 1n)).toEqual([true, ['UNLIMITED_AMOUNT']]);
  });

  it('flags an allowance longer than 30 days, and shows max uint48 as never', () => {
    const td = permitSingle();
    td.message.details.expiration = MAX_UINT48;
    const s = summarize(td);
    expect(s.tokens[0].expires).toEqual({ raw: MAX_UINT48, unixMs: null, note: null });
    expect(codes(s)).toEqual(['UNLIMITED_AMOUNT', 'LONG_ALLOWANCE']);
  });

  it('reads expiration 0 as "the submitting block only", not 1970 or never', () => {
    const td = permitSingle();
    td.message.details.expiration = '0';
    const s = summarize(td);
    expect(s.tokens[0].expires).toEqual({ raw: '0', unixMs: 0, note: 'submitting-block' });
    expect(codes(s)).not.toContain('LONG_ALLOWANCE');
  });

  it('treats an amount past uint160 as undecodable, never as a number', () => {
    const td = permitSingle();
    td.message.details.amount = (1n << 160n).toString();
    const s = summarize(td);
    expect(s.kind).toBe('generic');
    expect(s.looksLikePermit).toBe(true);
    expect(s.tokens).toEqual([]);
    expect(s.warnings[0]).toEqual({ code: 'UNDECODABLE_PERMIT', severity: 'danger', params: {} });
  });

  it('keeps a known token formatted and marks an unknown second token', () => {
    const base = summarize(permitBatch());
    expect(permitTokenAddresses(base)).toEqual([USDC.toLowerCase(), WETH.toLowerCase()]);
    const s = withTokenMetadata(base, { [USDC.toLowerCase()]: { symbol: 'USDC', decimals: 6 } });
    expect(s.kind).toBe('permit2-allowance');
    expect(s.tokens[0]).toMatchObject({ address: USDC, amount: '1,234.56', symbol: 'USDC' });
    expect(s.tokens[1]).toMatchObject({ address: WETH, amountRaw: '5', amount: null, decimals: null, symbol: null });
    expect(s.warnings).toEqual([{ code: 'UNKNOWN_TOKEN', severity: 'caution', params: { token: WETH } }]);
  });
});

describe('Permit2 SignatureTransfer', () => {
  it('decodes a witness transfer as a one-time transfer with no allowance expiry', () => {
    const s = summarize(transferWithWitness());
    expect(s.kind).toBe('permit2-transfer');
    expect(s.tokens).toEqual([
      {
        address: USDC,
        amountRaw: '1000000',
        unlimited: false,
        symbol: null,
        decimals: null,
        amount: null,
        expires: null,
      },
    ]);
    expect(s.deadline?.raw).toBe(String(NOW + 600));
    expect(codes(s)).toEqual(['PERMIT2_WITNESS']);
  });

  it('points at the witness terms, which no summary row shows', () => {
    // A UniswapX-style order whose output goes to someone else still decodes
    // as one transfer to the reactor: only the witness says who gets paid.
    const td = transferWithWitness();
    td.message.witness.recipient = '0x000000000000000000000000000000000000dEaD';
    const s = summarize(td);
    expect(s.kind).toBe('permit2-transfer');
    expect(s.warnings).toEqual([
      { code: 'PERMIT2_WITNESS', severity: 'caution', params: { field: 'witness', type: 'Order' } },
    ]);
    const batch = transferFrom(true) as any;
    batch.primaryType = 'PermitBatchWitnessTransferFrom';
    batch.types.PermitBatchWitnessTransferFrom = [...batch.types.PermitBatchTransferFrom, f('order', 'Order')];
    delete batch.types.PermitBatchTransferFrom;
    batch.types.Order = [f('recipient', 'address')];
    batch.message.order = { recipient: OWNER };
    const b = summarize(batch);
    expect(b.kind).toBe('permit2-transfer');
    expect(b.warnings).toContainEqual({
      code: 'PERMIT2_WITNESS',
      severity: 'caution',
      params: { field: 'order', type: 'Order' },
    });
    // No witness, nothing to point at.
    expect(codes(summarize(transferFrom(false)))).toEqual([]);
    expect(codes(summarize(transferFrom(true)))).not.toContain('PERMIT2_WITNESS');
  });

  it('decodes a plain PermitTransferFrom (no witness)', () => {
    const s = summarize(transferFrom(false));
    expect(s.kind).toBe('permit2-transfer');
    expect(s.tokens.map(t => [t.address, t.amountRaw, t.unlimited, t.expires])).toEqual([
      [USDC, '1000000', false, null],
    ]);
    expect(s.deadline?.raw).toBe(String(NOW + 600));
    expect(codes(s)).toEqual([]);
  });

  it('decodes a PermitBatchTransferFrom and flags its unlimited token', () => {
    const s = summarize(transferFrom(true));
    expect(s.kind).toBe('permit2-transfer');
    expect(s.tokens.map(t => [t.address, t.amountRaw, t.unlimited])).toEqual([
      [USDC, '1000000', false],
      [WETH, MAX_UINT256, true],
    ]);
    expect(s.warnings).toEqual([{ code: 'UNLIMITED_AMOUNT', severity: 'danger', params: { token: WETH } }]);
  });

  it('does not decode a witness type with two extra fields, and says so', () => {
    const td = transferWithWitness();
    td.types.PermitWitnessTransferFrom.push(f('extra', 'uint256'));
    td.message.extra = '1';
    const s = summarize(td);
    expect(s.kind).toBe('generic');
    expect(s.looksLikePermit).toBe(true);
    expect(codes(s)).toEqual(['UNDECODABLE_PERMIT']);
  });

  it('lists decoy JSON keys the hasher ignores as not signed', () => {
    const td = transferWithWitness();
    td.message.amount = MAX_UINT256; // a top-level decoy that looks like the amount
    td.message.witness.recipientName = 'Your own wallet'; // a decoy inside the witness struct
    const s = summarize(td);
    expect(s.kind).toBe('permit2-transfer');
    expect(s.tokens[0].amountRaw).toBe('1000000');
    expect(s.unsigned.map(u => u.path)).toEqual(['message.amount', 'message.witness.recipientName']);
    expect(s.unsigned[0].value).toBe(JSON.stringify(MAX_UINT256));
  });
});

describe('EIP-2612 and DAI permits', () => {
  it('decodes a USDC permit: token from the domain, allowance until revoked', () => {
    const s = withTokenMetadata(summarize(usdcPermit()), { [USDC.toLowerCase()]: { symbol: 'USDC', decimals: 6 } });
    expect(s.kind).toBe('eip2612');
    expect(s.tokens).toEqual([
      {
        address: USDC,
        amountRaw: '1000000',
        unlimited: false,
        symbol: 'USDC',
        decimals: 6,
        amount: '1',
        expires: null, // 2612 allowances never expire; the deadline is the signature's
      },
    ]);
    expect(s.deadline).toEqual({ raw: String(NOW + 1800), unixMs: (NOW + 1800) * 1000, note: null });
    expect(codes(s)).toEqual([]);
  });

  it('flags an unlimited 2612 value', () => {
    const td = usdcPermit();
    td.message.value = MAX_UINT256;
    expect(codes(summarize(td))).toEqual(['UNLIMITED_AMOUNT']);
  });

  it('cannot name the token of a permit whose domain does not hash verifyingContract', () => {
    const td = usdcPermit();
    td.types.EIP712Domain = TOKEN_DOMAIN_TYPE.slice(0, 3);
    const s = summarize(td);
    expect(s.kind).toBe('generic');
    expect(s.verifyingContract).toBeNull();
    expect(codes(s)).toContain('UNDECODABLE_PERMIT');
    expect(s.unsigned.map(u => u.path)).toEqual(['domain.verifyingContract']);
  });

  it('reads DAI `allowed` the way the hasher encodes it, not by JS truthiness', () => {
    const allowance = (allowed: unknown) => {
      const s = summarize(daiPermit(allowed));
      return { kind: s.kind, raw: s.tokens[0]?.amountRaw ?? null, codes: codes(s) };
    };
    const unlimited = { kind: 'dai-permit', raw: MAX_UINT256, codes: ['UNLIMITED_AMOUNT'] };
    const zero = { kind: 'dai-permit', raw: '0', codes: [] };
    expect(allowance(true)).toEqual(unlimited);
    expect(allowance(1)).toEqual(unlimited);
    expect(allowance(false)).toEqual(zero);
    expect(allowance(0)).toEqual(zero);
    expect(allowance('0')).toEqual(zero); // BigInt('0') — signed as false
    // BigInt('false') throws in the vault: never shown as a readable permit.
    expect(allowance('false')).toEqual({ kind: 'generic', raw: null, codes: ['UNDECODABLE_PERMIT'] });
    // 2 hashes as a word DAI's bool can never equal.
    expect(allowance(2)).toEqual({ kind: 'generic', raw: null, codes: ['UNDECODABLE_PERMIT'] });
  });

  it('reads DAI expiry 0 as no deadline', () => {
    const td = daiPermit(true);
    td.message.expiry = 0;
    expect(summarize(td).deadline).toEqual({ raw: '0', unixMs: 0, note: 'no-deadline' });
  });
});

describe('impostors and undecodable permits', () => {
  it('shows a Permit2 lookalike at another address as generic, with a caution', () => {
    const impostor = '0x000000000022D473030F116dDEE9F6B43aC78BA4';
    const td = permitSingle();
    td.domain.verifyingContract = impostor;
    const s = summarize(td);
    expect(s.kind).toBe('generic');
    expect(s.looksLikePermit).toBe(true);
    expect(s.tokens).toEqual([]);
    expect(s.warnings).toEqual([
      { code: 'PERMIT2_NOT_CANONICAL', severity: 'caution', params: { verifyingContract: impostor } },
    ]);
  });

  it('raises a danger, not a caution, for a Permit2 whose address is not hashed or not readable', () => {
    // Only a well-formed other address is "not Permit2"; this might be it.
    const unhashed = permitSingle();
    unhashed.types.EIP712Domain = PERMIT2_DOMAIN_TYPE.slice(0, 2); // domain.verifyingContract left in the JSON
    const unreadable = permitSingle();
    unreadable.domain.verifyingContract = 'ab' + PERMIT2.slice(2);
    for (const [td, domainCodes] of [
      [unhashed, []],
      [unreadable, ['UNREADABLE_DOMAIN']],
    ] as const) {
      const s = summarize(td);
      expect(s.kind).toBe('generic');
      expect(s.looksLikePermit).toBe(true);
      expect(codes(s)).toEqual(['UNDECODABLE_PERMIT', ...domainCodes]);
    }
  });

  it('raises a danger for anything bound to Permit2 it cannot decode, whatever the field names', () => {
    // Past the extractor on purpose: Permit2 checks whatever typehash the
    // caller's witness string completes, so this must not lean on the
    // extractor's field-name check.
    for (const p of FORGED_WITNESSES) {
      const s = summarizeTypedData(p, CTX);
      expect(s.kind, p.primaryType).toBe('generic');
      expect(s.looksLikePermit, p.primaryType).toBe(true);
      expect(s.tokens, p.primaryType).toEqual([]);
      expect(s.warnings[0], p.primaryType).toEqual({ code: 'UNDECODABLE_PERMIT', severity: 'danger', params: {} });
    }
  });

  it('raises a danger, not a quiet fallback, when canonical types carry an unreadable value', () => {
    const cases: [string, (td: ReturnType<typeof permitSingle>) => void][] = [
      ['token is not strict hex', td => (td.message.details.token = 'ab' + USDC.slice(2))],
      ['amount is not a number', td => (td.message.details.amount = '1e30')],
      ['amount is negative', td => (td.message.details.amount = '-1')],
      ['spender missing', td => delete td.message.spender],
    ];
    for (const [label, mutate] of cases) {
      const td = permitSingle();
      mutate(td);
      const s = summarize(td);
      expect(s.kind, label).toBe('generic');
      expect(s.looksLikePermit, label).toBe(true);
      expect(s.warnings[0], label).toEqual({ code: 'UNDECODABLE_PERMIT', severity: 'danger', params: {} });
    }
  });

  it('will not vouch for a permit whose other signed fields the vault would reject', () => {
    const td = transferWithWitness();
    td.message.witness.minOut = '1e3'; // BigInt('1e3') throws in the vault
    const s = summarize(td);
    expect(s.kind).toBe('generic');
    expect(codes(s)).toEqual(['UNDECODABLE_PERMIT']);
  });

  it('will not vouch for a permit whose witness repeats a field name', () => {
    const td = transferWithWitness();
    td.types.Order.push(f('recipient', 'uint256')); // same value, hashed again as another type
    const s = summarize(td);
    expect(s.kind).toBe('generic');
    expect(codes(s)).toEqual(['UNDECODABLE_PERMIT']);
  });

  it('will not decode a permit too large to show in full', () => {
    const td = permitBatch();
    td.message.details = Array.from({ length: 500 }, () => ({ ...td.message.details[0] }));
    const s = summarize(td);
    expect(s.kind).toBe('generic');
    expect(s.looksLikePermit).toBe(true);
    expect(codes(s)).toEqual(['UNDECODABLE_PERMIT', 'FIELDS_TRUNCATED']);
  });

  it('does not decode a permit whose elementary types are redefined as structs', () => {
    const td = usdcPermit() as any;
    td.types.uint256 = [f('x', 'uint8')];
    const s = summarize(td);
    expect(s.kind).toBe('generic');
    expect(s.looksLikePermit).toBe(false);
  });

  it('still decodes a permit next to type definitions its fields never use', () => {
    // The typehash follows field references only, so these hash exactly like
    // the canonical permit: hiding it behind a spare `bool: []` must not work.
    const usdc = usdcPermit();
    usdc.message.value = MAX_UINT256;
    const usdcSpare = { ...usdc, types: { ...usdc.types, bool: [], uint48: [], uint160: [] } };
    expect(decoded(summarize(usdcSpare))).toEqual(decoded(summarize(usdc)));
    expect(summarize(usdcSpare).kind).toBe('eip2612');
    const single = permitSingle();
    const singleSpare = { ...single, types: { ...single.types, bool: [] } };
    expect(decoded(summarize(singleSpare))).toEqual(decoded(summarize(single)));
    // Used by the witness only: TokenPermissions' typehash is untouched, and
    // Permit2 takes the witness type string from the caller.
    const witness = transferWithWitness() as any;
    witness.types.bool = [];
    witness.types.Order.push(f('flag', 'bool'));
    witness.message.witness.flag = {};
    expect(summarize(witness).kind).toBe('permit2-transfer');
  });

  it('will not vouch for a permit whose witness bytes32 signs other bytes', () => {
    for (const note of ['Only to my own wallet', '0X' + 'ab'.repeat(32), '0xabc']) {
      const td = transferWithWitness();
      td.types.Order.push(f('note', 'bytes32'));
      td.message.witness.note = note;
      const s = summarize(td);
      expect(s.kind, note).toBe('generic');
      expect(codes(s), note).toEqual(['UNDECODABLE_PERMIT']);
    }
  });
});

describe('chain binding', () => {
  it('flags a domain chain that differs from the connected chain', () => {
    const s = summarize(permitSingle(), { activeChainId: 137, nowSec: NOW });
    expect(s.warnings).toContainEqual({
      code: 'CHAIN_MISMATCH',
      severity: 'danger',
      params: { domainChainId: '1', activeChainId: '137' },
    });
  });

  it('compares chain ids as numbers, not strings', () => {
    const td = permitSingle();
    td.domain.chainId = '0x89' as any;
    expect(codes(summarize(td, { activeChainId: 137, nowSec: NOW }))).not.toContain('CHAIN_MISMATCH');
    expect(codes(summarize(permitSingle(), { activeChainId: '0x1', nowSec: NOW }))).not.toContain('CHAIN_MISMATCH');
    expect(codes(summarize(td, { activeChainId: '137', nowSec: NOW }))).not.toContain('CHAIN_MISMATCH');
  });

  it('ignores a domain chainId that is not hashed: no binding, no mismatch', () => {
    const td = usdcPermit();
    td.types.EIP712Domain = [f('name', 'string'), f('version', 'string'), f('verifyingContract', 'address')];
    td.domain.chainId = 137;
    const s = summarize(td, { activeChainId: 1, nowSec: NOW });
    expect(s.chainId).toBeNull();
    expect(codes(s)).toContain('NO_CHAIN_BINDING');
    expect(codes(s)).not.toContain('CHAIN_MISMATCH');
    expect(s.unsigned.map(u => u.path)).toEqual(['domain.chainId']);
    expect(s.domainFields.map(n => n.name)).toEqual(['name', 'version', 'verifyingContract']);
  });

  it('hashes the canonical keys present when types.EIP712Domain is omitted', () => {
    const td = usdcPermit() as any;
    delete td.types.EIP712Domain;
    const s = summarize(td);
    expect(s.kind).toBe('eip2612');
    expect(s.domainFields.map((n: { name: string }) => n.name)).toEqual([
      'name',
      'version',
      'chainId',
      'verifyingContract',
    ]);
  });
});

describe('generic typed data', () => {
  it("walks the EIP-712 spec's Mail example from its types", () => {
    const s = summarize(mail());
    expect(s.kind).toBe('generic');
    expect(s.looksLikePermit).toBe(false);
    expect(s.warnings).toEqual([]);
    expect(s.messageFields.map(n => [n.name, n.type])).toEqual([
      ['from', 'Person'],
      ['to', 'Person'],
      ['contents', 'string'],
    ]);
    expect(s.messageFields[1].children).toEqual([
      { name: 'name', type: 'string', value: 'Bob', invalid: false, children: null },
      {
        name: 'wallet',
        type: 'address',
        value: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        invalid: false,
        children: null,
      },
    ]);
  });

  it('never calls a hashed but unreadable verifyingContract "not signed"', () => {
    // The vault writes hex up to the first non-hex char, so '…zz' signs for
    // the Safe at '…00' (same domain hash under the vault's getStructHash).
    const safe = '0x1234567890123456789012345678901234567800';
    const safeTx = (domainType: { name: string; type: string }[], verifyingContract: string) => ({
      types: { EIP712Domain: domainType, SafeTx: [f('to', 'address'), f('data', 'bytes')] },
      primaryType: 'SafeTx',
      domain: { chainId: 1, verifyingContract },
      message: { to: OWNER, data: '0x' },
    });
    const hashed = [f('chainId', 'uint256'), f('verifyingContract', 'address')];
    const s = summarize(safeTx(hashed, safe.slice(0, -2) + 'zz'));
    expect(s.kind).toBe('generic');
    expect(s.verifyingContract).toBeNull();
    expect(s.unreadableContract).toBe(JSON.stringify(safe.slice(0, -2) + 'zz'));
    expect(s.warnings).toEqual([{ code: 'UNREADABLE_DOMAIN', severity: 'danger', params: {} }]);
    // Declared but missing: the vault throws, and it is still not "not signed".
    const missing = safeTx(hashed, safe) as any;
    delete missing.domain.verifyingContract;
    expect(summarize(missing).unreadableContract).toBe('(missing)');
    // Hashed as something other than an address: signed, but not a contract to show.
    const asString = summarize(safeTx([f('verifyingContract', 'string')], safe));
    expect([asString.verifyingContract, asString.unreadableContract]).toEqual([null, JSON.stringify(safe)]);
    expect(codes(asString)).toContain('UNREADABLE_DOMAIN');
    // Clean, or not hashed at all: nothing to flag.
    const clean = summarize(safeTx(hashed, safe));
    expect([clean.verifyingContract, clean.unreadableContract, codes(clean)]).toEqual([safe, null, []]);
    const unhashed = summarize(safeTx([f('chainId', 'uint256')], safe.slice(0, -2) + 'zz'));
    expect([unhashed.verifyingContract, unhashed.unreadableContract, codes(unhashed)]).toEqual([null, null, []]);
  });

  it('flags any other signed domain field it cannot read', () => {
    const td = mail() as any;
    td.types.EIP712Domain = [...TOKEN_DOMAIN_TYPE, f('salt', 'bytes32')];
    td.domain.salt = '0x' + 'gg'.repeat(32); // passes the vault's schema, hashes as bytes32(0)
    expect(summarize(td).warnings).toEqual([{ code: 'UNREADABLE_DOMAIN', severity: 'danger', params: {} }]);
  });

  it('shows integers and bools as the hasher reads them, marking the spelling it was sent in', () => {
    const td = {
      types: { EIP712Domain: [], T: [f('n', 'uint8'), f('b', 'bool'), f('big', 'uint8'), f('neg', 'int8')] },
      primaryType: 'T',
      domain: {},
      message: { n: '0x10', b: '0', big: 256, neg: '-128' },
    };
    const [n, b, big, neg] = summarize(td).messageFields;
    expect(n).toMatchObject({ value: '16 (sent as "0x10")', invalid: false });
    expect(b).toMatchObject({ value: 'false (sent as "0")', invalid: false });
    expect(big).toMatchObject({ value: '256', invalid: true });
    expect(neg).toMatchObject({ value: '-128', invalid: false });
  });

  it('shows bytes as the hasher encodes them, and marks what it would sign as other bytes', () => {
    const ab = 'ab'.repeat(32);
    const read = (type: string, values: unknown[]) =>
      summarize({
        types: { EIP712Domain: [], T: values.map((_, i) => f(`v${i}`, type)) },
        primaryType: 'T',
        domain: {},
        message: Object.fromEntries(values.map((v, i) => [`v${i}`, v])),
      }).messageFields.map(n => [n.value, n.invalid]);
    expect(read('bytes32', [`0x${ab}`, ab, '0xab'])).toEqual([
      [`0x${ab}`, false],
      [`0x${ab} (sent as "${ab}")`, false],
      [`0xab${'00'.repeat(31)} (sent as "0xab")`, false], // right-padded, as encoded
    ]);
    // Text, '0X…' and a leading space hash as zeros; odd hex drops a nibble;
    // too long or not a string, the vault throws or encodes something else.
    const badFixed = ['Only to my own wallet', `0X${ab}`, ` 0x${ab}`, '0xabc', `0x${ab}ab`, 5];
    expect(read('bytes32', badFixed).map(([, invalid]) => invalid)).toEqual(badFixed.map(() => true));
    expect(read('bytes', ['0xabcd', 'abcd', '0x'])).toEqual([
      ['0xabcd', false],
      ['0xabcd (sent as "abcd")', false],
      ['0x', false],
    ]);
    // Dynamic bytes that are not even-length hex make the vault throw.
    expect(read('bytes', ['hello', '0Xabcd', '0xabc']).map(([, invalid]) => invalid)).toEqual([true, true, true]);
    expect(read('bytes33', ['0xab'])).toEqual([['"0xab"', true]]);
  });
});

describe('warning order', () => {
  it('puts every danger before every caution', () => {
    const td = permitBatch();
    td.message.details[0].amount = MAX_UINT160;
    td.message.details[1].expiration = MAX_UINT48;
    const s = withTokenMetadata(summarize(td, { activeChainId: 10, nowSec: NOW }), {});
    expect(codes(s)).toEqual([
      'UNLIMITED_AMOUNT',
      'CHAIN_MISMATCH',
      'LONG_ALLOWANCE',
      'UNKNOWN_TOKEN',
      'UNKNOWN_TOKEN',
    ]);
  });
});

describe('summary contract', () => {
  const payloads = {
    permitSingle: permitSingle(),
    permitBatch: permitBatch(),
    witness: transferWithWitness(),
    transferBatch: transferFrom(true),
    usdc: usdcPermit(),
    dai: daiPermit(true),
    mail: mail(),
  };

  it('is plain JSON that survives chrome.storage unchanged', () => {
    for (const [name, p] of Object.entries(payloads)) {
      const s = withTokenMetadata(summarize(p), { [USDC.toLowerCase()]: { symbol: 'USDC', decimals: 6 } });
      expectJsonSafe(s, name);
      expect(JSON.parse(JSON.stringify(s)), name).toStrictEqual(s);
    }
  });

  it('never mutates the payload it summarizes', () => {
    for (const [name, p] of Object.entries(payloads)) {
      const before = JSON.stringify(p);
      const frozen = deepFreeze(p);
      expect(() => summarize(frozen), name).not.toThrow();
      expect(JSON.stringify(frozen), name).toBe(before);
    }
  });

  it('stays small when a page repeats a field name at every level', () => {
    // ~250 bytes: three fields named x, 16 levels deep. Walking every copy
    // is 3^16 nodes and runs the service worker out of memory.
    let message: Record<string, unknown> = {};
    for (let i = 0; i < 16; i++) message = { x: message };
    const s = summarize({
      types: { T: [f('x', 'T'), f('x', 'T'), f('x', 'T')] },
      primaryType: 'T',
      domain: {},
      message,
    });
    const repeated = { name: 'x', type: 'T', value: '(repeated field name)', invalid: true, children: null };
    expect(s.messageFields.slice(1)).toEqual([repeated, repeated]);
    expect(JSON.stringify(s).length).toBeLessThan(20_000);
  });

  it('caps the field tree and the ignored keys, and says so', () => {
    const message: Record<string, unknown> = { list: Array(50_000).fill('1') };
    for (let i = 0; i < 1000; i++) message[`decoy${i}`] = i;
    const s = summarize({ types: { T: [f('list', 'uint256[]')] }, primaryType: 'T', domain: {}, message });
    const list = s.messageFields[0].children ?? [];
    expect(list.length).toBeLessThanOrEqual(2000);
    expect(list[list.length - 1]).toEqual({
      name: '…',
      type: '',
      value: '(too many fields to show)',
      invalid: true,
      children: null,
    });
    expect(s.unsigned).toHaveLength(200);
    expect(codes(s)).toEqual(['NO_CHAIN_BINDING', 'FIELDS_TRUNCATED']);
    expect(JSON.stringify(s).length).toBeLessThan(250_000);
  });

  it('stays far under the storage quota when names are as long as extractTypedData allows', () => {
    // Every item node repeats the struct and field names. At ~5,500 chars, a
    // ~20 KB payload made an 11 MB summary: past chrome.storage.local's 10 MB.
    const repeatedNames = (len: number) => {
      const struct = 'B'.repeat(len - 2);
      const field = 'x'.repeat(len);
      return {
        types: { A: [f('items', `${struct}[]`)], [struct]: [f(field, 'uint8')] },
        primaryType: 'A',
        domain: {},
        message: { items: Array(5000).fill({ [field]: 'z'.repeat(1000) }) },
      };
    };
    expect(extractTypedData([OWNER, repeatedNames(5500)])).toMatchObject({ ok: false, code: -32602 });
    const s = summarize(repeatedNames(256));
    expect(codes(s)).toContain('FIELDS_TRUNCATED');
    expect(JSON.stringify(s).length).toBeLessThan(2_000_000);
  });

  it('reads a huge definition list once, not on every struct it walks', () => {
    // 2,000 items of a struct whose 200k-entry def list holds no fields:
    // filtering that list per item took seconds of service-worker time.
    const start = performance.now();
    const s = summarize({
      types: { A: [f('items', 'B[]')], B: Array(200_000).fill(0) },
      primaryType: 'A',
      domain: {},
      message: { items: Array(2000).fill({}) },
    });
    expect(performance.now() - start).toBeLessThan(250);
    expect(s.messageFields[0].children?.[0]).toEqual({
      name: '[0]',
      type: 'B',
      value: null,
      invalid: false,
      children: [],
    });
  });

  it('never throws for anything extractTypedData accepts', () => {
    const odd: unknown[] = [];
    for (const mutate of [
      (td: any) => (td.message.details = null),
      (td: any) => (td.message.details = 'x'),
      (td: any) => (td.message.details = []),
      (td: any) => (td.message.details = { token: null, amount: {}, expiration: [], nonce: true }),
      (td: any) => delete td.domain,
      (td: any) => (td.domain = null),
      (td: any) => (td.domain = { chainId: null, verifyingContract: 5 }),
      (td: any) => (td.types.EIP712Domain = 'x'),
      (td: any) => (td.types.EIP712Domain = [null, 7, { name: 'chainId' }]),
      (td: any) => (td.types.PermitSingle = [null, { name: 1, type: [] }]),
      (td: any) => (td.types.PermitDetails = {}),
      (td: any) => (td.primaryType = 'Missing'),
      (td: any) => (td.primaryType = 'EIP712Domain'),
      (td: any) => (td.types.PermitDetails = [f('self', 'PermitDetails')]),
    ]) {
      const td = permitSingle();
      mutate(td);
      odd.push(td);
    }
    // A self-referencing struct nested deep enough to overflow the stack
    // of an uncapped walk.
    let deep: any = { v: '1' };
    for (let i = 0; i < 20_000; i++) deep = { next: deep };
    const nested = { types: { N: [f('next', 'N')] }, primaryType: 'N', domain: {}, message: deep };
    odd.push(nested);
    const deepSummary = summarize(nested);
    let node = deepSummary.messageFields[0];
    while (node.children) node = node.children[0];
    expect(node).toMatchObject({ value: '(nested too deep to show)', invalid: true });
    expect(codes(deepSummary)).toContain('FIELDS_TRUNCATED');

    for (const p of odd) {
      for (const activeChainId of [1, null, 'garbage']) {
        const s = summarize(p, { activeChainId, nowSec: NOW + 0.5 });
        expectJsonSafe(s);
        expect(() => withTokenMetadata(s, {})).not.toThrow();
      }
    }
  });
});

describe('formatUnits', () => {
  it('is exact at every scale', () => {
    expect(formatUnits(1234560000n, 6)).toBe('1,234.56');
    expect(formatUnits(1n, 18)).toBe('0.000000000000000001');
    expect(formatUnits(1_234_567n * 10n ** 18n + 5n, 18)).toBe('1,234,567.000000000000000005');
    expect(formatUnits(1_000_000n, 6)).toBe('1');
    expect(formatUnits(0n, 6)).toBe('0');
    expect(formatUnits(999n, 0)).toBe('999');
    expect(formatUnits(1000n, 0)).toBe('1,000');
    expect(formatUnits(9_007_199_254_740_993n, 0)).toBe('9,007,199,254,740,993'); // 2^53 + 1
    expect(formatUnits((1n << 256n) - 1n, 18)).toBe(
      '115,792,089,237,316,195,423,570,985,008,687,907,853,269,984,665,640,564,039,457.584007913129639935',
    );
  });
});

describe('token metadata', () => {
  it('strips control and bidi characters from symbols and caps their length', () => {
    expect(sanitizeSymbol('USDC')).toBe('USDC');
    expect(sanitizeSymbol('  USDC\n')).toBe('USDC');
    expect(sanitizeSymbol('US‮DC')).toBe('USDC'); // right-to-left override
    expect(sanitizeSymbol('U​SDC')).toBe('USDC'); // zero-width space
    expect(sanitizeSymbol('A'.repeat(40))).toBe('A'.repeat(16));
    expect(sanitizeSymbol(' ‍ ')).toBeNull();
    expect(sanitizeSymbol(42)).toBeNull();
  });

  it('never guesses decimals', () => {
    expect(toTokenMeta('USDC', 6n)).toEqual({ symbol: 'USDC', decimals: 6 });
    expect(toTokenMeta(null, 18)).toEqual({ symbol: null, decimals: 18 });
    expect(toTokenMeta('X', 37n)).toBeNull();
    expect(toTokenMeta('X', -1)).toBeNull();
    expect(toTokenMeta('X', 'x')).toBeNull();
    expect(toTokenMeta('X', undefined)).toBeNull();
  });
});
