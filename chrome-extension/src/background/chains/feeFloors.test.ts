import { describe, it, expect } from 'vitest';
import { getFeeFloor, getPriorityFeeFloor, toBigInt, buildFeeWarning } from './feeFloors';

const GWEI = 1_000_000_000n;
const gwei = (n: number | bigint) => BigInt(n) * GWEI;
const hex = (v: bigint) => '0x' + v.toString(16);

describe('toBigInt', () => {
  it('passes through bigint', () => {
    expect(toBigInt(5n)).toBe(5n);
  });

  it('converts a number', () => {
    expect(toBigInt(42)).toBe(42n);
  });

  it('parses a hex string', () => {
    expect(toBigInt('0x10')).toBe(16n);
  });

  it('parses a decimal string', () => {
    expect(toBigInt('1000000000')).toBe(GWEI);
  });

  it('returns null for null/undefined', () => {
    expect(toBigInt(null)).toBeNull();
    expect(toBigInt(undefined)).toBeNull();
  });
});

describe('getFeeFloor', () => {
  it('uses the static per-chain floor when base fee is unknown', () => {
    // Ethereum static floor is 1 gwei.
    expect(getFeeFloor('0x1', null)).toBe(gwei(1));
    // Polygon static floor is 30 gwei.
    expect(getFeeFloor('0x89', undefined)).toBe(gwei(30));
  });

  it('defaults unknown chains to a 1 gwei floor', () => {
    expect(getFeeFloor('0xdead', null)).toBe(gwei(1));
  });

  it('returns the dynamic floor (baseFee * 1.1) when it exceeds the static floor', () => {
    // Ethereum: static 1 gwei, baseFee 50 gwei -> dynamic 55 gwei wins.
    expect(getFeeFloor('0x1', gwei(50))).toBe((gwei(50) * 11n) / 10n);
  });

  it('returns the static floor when it exceeds the dynamic floor', () => {
    // Polygon: static 30 gwei, baseFee 1 gwei -> dynamic 1.1 gwei loses.
    expect(getFeeFloor('0x89', gwei(1))).toBe(gwei(30));
  });

  it('normalizes a decimal-string chainId to hex before lookup', () => {
    // "137" === 0x89 (Polygon), static floor 30 gwei.
    expect(getFeeFloor('137', null)).toBe(gwei(30));
  });

  it('normalizes a numeric chainId', () => {
    // 1 -> 0x1 (Ethereum).
    expect(getFeeFloor(1, null)).toBe(gwei(1));
  });

  it('is case-insensitive on hex chainIds', () => {
    expect(getFeeFloor('0xA86A', null)).toBe(gwei(25)); // Avalanche
  });
});

describe('getPriorityFeeFloor', () => {
  it('returns the configured tip floor for a known chain', () => {
    expect(getPriorityFeeFloor('0x1')).toBe(gwei(1)); // Ethereum
    expect(getPriorityFeeFloor('0x89')).toBe(gwei(25)); // Polygon
  });

  it('returns 0 for sequencer-driven L2s', () => {
    expect(getPriorityFeeFloor('0xa')).toBe(0n); // Optimism
    expect(getPriorityFeeFloor('0xa4b1')).toBe(0n); // Arbitrum
    expect(getPriorityFeeFloor('0x2105')).toBe(0n); // Base
  });

  it('defaults unknown chains to 1 gwei', () => {
    expect(getPriorityFeeFloor('0xdead')).toBe(gwei(1));
  });
});

describe('buildFeeWarning', () => {
  const ethOk = {
    chainId: '0x1',
    baseFeeWei: gwei(20),
    oracleMaxFeePerGas: gwei(45),
    oracleMaxPriorityFeePerGas: gwei(2),
  };

  it('returns null when the dApp supplies no maxFeePerGas', () => {
    const w = buildFeeWarning({
      ...ethOk,
      dappMaxFeePerGas: undefined,
      dappMaxPriorityFeePerGas: hex(gwei(2)),
    });
    expect(w).toBeNull();
  });

  it('returns null when fees comfortably clear both floors', () => {
    const w = buildFeeWarning({
      ...ethOk,
      // maxFee 60 gwei (> baseFee*1.1=22), tip 3 gwei (> 1 gwei floor)
      dappMaxFeePerGas: hex(gwei(60)),
      dappMaxPriorityFeePerGas: hex(gwei(3)),
    });
    expect(w).toBeNull();
  });

  it("flags 'maxFee' when the dApp maxFee is below the floor", () => {
    // Use Optimism (0xa): its priority-tip floor is 0, so the tip check can
    // never fire and 'maxFee' is isolated. baseFee 100 -> dynamic floor 110
    // gwei; dApp 50 gwei is below it.
    const w = buildFeeWarning({
      chainId: '0xa',
      baseFeeWei: gwei(100),
      dappMaxFeePerGas: hex(gwei(50)),
      dappMaxPriorityFeePerGas: hex(gwei(1)),
      oracleMaxFeePerGas: null,
      oracleMaxPriorityFeePerGas: null,
    });
    expect(w).not.toBeNull();
    expect(w!.trigger).toBe('maxFee');
    expect(w!.chainId).toBe('0xa');
  });

  it("flags 'tip' when maxFee is fine but the effective tip is below the floor", () => {
    const w = buildFeeWarning({
      ...ethOk,
      // maxFee 60 gwei is fine; tip 0.1 gwei is below the 1 gwei eth floor.
      dappMaxFeePerGas: hex(gwei(60)),
      dappMaxPriorityFeePerGas: hex(GWEI / 10n),
    });
    expect(w).not.toBeNull();
    expect(w!.trigger).toBe('tip');
  });

  it("flags 'both' when maxFee and tip are both too low", () => {
    const w = buildFeeWarning({
      ...ethOk,
      dappMaxFeePerGas: hex(gwei(10)), // < 22 gwei floor
      dappMaxPriorityFeePerGas: hex(GWEI / 10n), // < 1 gwei tip floor
    });
    expect(w).not.toBeNull();
    expect(w!.trigger).toBe('both');
  });

  it('caps the effective tip at (maxFee - baseFee) per EIP-1559', () => {
    // High stated priority (5 gwei) but maxFee only 0.5 gwei above baseFee,
    // so miners only ever see ~0.5 gwei -> tip floor (1 gwei) is tripped.
    const w = buildFeeWarning({
      chainId: '0x1',
      baseFeeWei: gwei(20),
      dappMaxFeePerGas: hex(gwei(20) + GWEI / 2n), // baseFee + 0.5 gwei
      dappMaxPriorityFeePerGas: hex(gwei(5)),
      oracleMaxFeePerGas: gwei(45),
      oracleMaxPriorityFeePerGas: gwei(2),
    });
    expect(w).not.toBeNull();
    // effectiveTip = min(5 gwei, 0.5 gwei) = 0.5 gwei
    expect(toBigInt(w!.effectiveTipWei)).toBe(GWEI / 2n);
  });

  // Regression guard for the PR #55 "tip headroom hole": the values the
  // wallet recommends ('suggested') must themselves clear both floors, or
  // the user picks "use suggested" and trips the exact same warning again.
  it('produces a suggestion that does not re-trip the warning (PR #55 invariant)', () => {
    const scenarios = [
      // Low maxFee + low tip on Ethereum
      {
        chainId: '0x1',
        baseFeeWei: gwei(30),
        dappMaxFeePerGas: hex(gwei(12)),
        dappMaxPriorityFeePerGas: hex(GWEI / 20n),
      },
      // Polygon, where the priority floor (25 gwei) is unusually high
      {
        chainId: '0x89',
        baseFeeWei: gwei(40),
        dappMaxFeePerGas: hex(gwei(35)),
        dappMaxPriorityFeePerGas: hex(gwei(1)),
      },
      // Tight maxFee just above base fee
      {
        chainId: '0x1',
        baseFeeWei: gwei(50),
        dappMaxFeePerGas: hex(gwei(51)),
        dappMaxPriorityFeePerGas: hex(GWEI / 10n),
      },
    ];

    const label = (s: object) => JSON.stringify(s, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    for (const s of scenarios) {
      const w = buildFeeWarning({
        ...s,
        oracleMaxFeePerGas: null,
        oracleMaxPriorityFeePerGas: null,
      });
      expect(w, `expected a warning for ${label(s)}`).not.toBeNull();

      // Feed the wallet's own suggestion back in as if it were the dApp's
      // fees. It must clear both floors -> no second warning.
      const rechecked = buildFeeWarning({
        chainId: s.chainId,
        baseFeeWei: toBigInt(w!.baseFeeWei),
        dappMaxFeePerGas: w!.suggestedMaxFeePerGas,
        dappMaxPriorityFeePerGas: w!.suggestedMaxPriorityFeePerGas,
        oracleMaxFeePerGas: null,
        oracleMaxPriorityFeePerGas: null,
      });
      expect(rechecked, `suggestion re-tripped the warning for ${label(s)}`).toBeNull();
    }
  });

  it('never silently 10xs the dApp fee: suggestion stays bounded', () => {
    const w = buildFeeWarning({
      chainId: '0x1',
      baseFeeWei: gwei(20),
      dappMaxFeePerGas: hex(gwei(10)),
      dappMaxPriorityFeePerGas: hex(GWEI / 10n),
      oracleMaxFeePerGas: null,
      oracleMaxPriorityFeePerGas: null,
    });
    expect(w).not.toBeNull();
    // baseFee*2 + suggestedPriority is the formula; with a 1 gwei priority
    // floor that is 41 gwei — comfortably under 10x the 10 gwei dApp value
    // would be 100 gwei, so the bound holds.
    const suggested = toBigInt(w!.suggestedMaxFeePerGas)!;
    expect(suggested).toBeLessThan(gwei(100));
    expect(suggested).toBeGreaterThanOrEqual(toBigInt(w!.floorWei)!);
  });
});
