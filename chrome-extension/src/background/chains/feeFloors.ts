/*
 * Per-chain minimum fee floors for EIP-1559 transactions.
 *
 * Used by signTransaction to detect dApp-suggested fees that would
 * leave a tx stuck pending in mempool. The actual floor at sign time
 * is the higher of:
 *
 *   - the per-chain static floor below (set from typical mempool
 *     median during the worst congestion of a normal day, not the
 *     all-time high — these are "below this and you'll wait" not
 *     "below this and you can't mine"), and
 *
 *   - currentBaseFee * 1.1 (always-correct floor — a tx with
 *     maxFeePerGas < baseFee literally cannot be included, and 10%
 *     headroom absorbs single-block base-fee spikes).
 *
 * Numbers below are in wei. To convert: 1 gwei = 1e9 wei.
 */

const GWEI = 1_000_000_000n;

/**
 * Static per-chain floor, keyed by hex chainId (matches the chainId
 * format used by the Pioneer chain registry and dApp eth_sendTransaction
 * params). Decimal chainIds are normalised via normalizeChainId() before
 * lookup.
 */
const STATIC_FLOOR_WEI: Record<string, bigint> = {
  '0x1': 1n * GWEI, // Ethereum — 1 gwei
  '0x89': 30n * GWEI, // Polygon — 30 gwei
  '0x38': 3n * GWEI, // BSC — 3 gwei
  '0xa': GWEI / 1000n, // Optimism — 0.001 gwei
  '0xa4b1': GWEI / 100n, // Arbitrum — 0.01 gwei
  '0x2105': GWEI / 1000n, // Base — 0.001 gwei
  '0xa86a': 25n * GWEI, // Avalanche — 25 gwei
  '0x144': GWEI / 40n, // zkSync Era — 0.025 gwei
};

/**
 * Per-chain minimum *priority tip* (maxPriorityFeePerGas) for reliable
 * propagation. A tx with low tip may pass the maxFee floor (because dApps
 * often pad maxFee to baseFee*1.5+ for headroom) yet still sit in a
 * single mempool node and never get gossiped to miners. We've seen txs
 * land on etherscan briefly with sub-1-gwei tips, then evict — see
 * RETRO_uniswap_swap_dropped_tx.md.
 */
const STATIC_PRIORITY_FLOOR_WEI: Record<string, bigint> = {
  '0x1': 1n * GWEI, // Ethereum — 1 gwei tip is the practical floor for inclusion
  '0x89': 25n * GWEI, // Polygon — 25 gwei
  '0x38': 1n * GWEI, // BSC — 1 gwei
  '0xa': 0n, // Optimism — sequencer-driven, no tip floor
  '0xa4b1': 0n, // Arbitrum — sequencer-driven
  '0x2105': 0n, // Base — sequencer-driven
  '0xa86a': 1n * GWEI, // Avalanche — 1 gwei
  '0x144': 0n, // zkSync Era — sequencer-driven
};

function normalizeChainId(chainId: string | number): string {
  if (typeof chainId === 'number') return '0x' + chainId.toString(16);
  if (typeof chainId === 'string') {
    if (chainId.startsWith('0x')) return chainId.toLowerCase();
    if (/^[0-9]+$/.test(chainId)) return '0x' + parseInt(chainId, 10).toString(16);
  }
  return '0x1'; // unknown shape → conservative default
}

/**
 * Compute the effective fee floor for a chain at this moment.
 * Returns the higher of the static per-chain floor and (baseFee * 1.1).
 * If baseFee is unknown (null/undefined), only the static floor applies.
 */
export function getFeeFloor(chainId: string | number, currentBaseFeeWei: bigint | null | undefined): bigint {
  const normalized = normalizeChainId(chainId);
  const staticFloor = STATIC_FLOOR_WEI[normalized] ?? GWEI; // unknown chains → 1 gwei default
  if (currentBaseFeeWei == null) return staticFloor;
  // 10% headroom = baseFee * 11 / 10
  const dynamicFloor = (currentBaseFeeWei * 11n) / 10n;
  return dynamicFloor > staticFloor ? dynamicFloor : staticFloor;
}

/** Per-chain priority-tip floor. Unknown chains default to 1 gwei. */
export function getPriorityFeeFloor(chainId: string | number): bigint {
  const normalized = normalizeChainId(chainId);
  return STATIC_PRIORITY_FLOOR_WEI[normalized] ?? GWEI;
}

/** Convert any of (hex string, decimal string, number, bigint) to bigint. */
export function toBigInt(v: string | number | bigint | undefined | null): bigint | null {
  if (v == null) return null;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string') {
    if (v.startsWith('0x')) return BigInt(v);
    return BigInt(v);
  }
  return null;
}

export interface FeeWarning {
  /** dApp-supplied maxFeePerGas, hex string */
  dappMaxFeePerGas: string;
  /** dApp-supplied maxPriorityFeePerGas, hex string */
  dappMaxPriorityFeePerGas: string;
  /** Wallet's recommended bump, hex string */
  suggestedMaxFeePerGas: string;
  /** Wallet's recommended priority, hex string */
  suggestedMaxPriorityFeePerGas: string;
  /** maxFee floor at this moment, hex string */
  floorWei: string;
  /** Priority-tip floor for this chain, hex string */
  priorityFloorWei: string;
  /** Effective tip miners would actually see: min(maxPriority, maxFee - baseFee), hex */
  effectiveTipWei: string;
  /** Current network base fee, hex string (or null if unknown) */
  baseFeeWei: string | null;
  /** Which check failed: 'maxFee', 'tip', or 'both'. */
  trigger: 'maxFee' | 'tip' | 'both';
  /** Human reason — surfaced in the side-panel banner */
  reason: string;
  /** Chain we evaluated against */
  chainId: string;
}

/**
 * Build a FeeWarning if the dApp's fees fall below the chain floor.
 * Returns null when no warning is needed (fees are fine, or fields missing).
 *
 * Suggested values: max(dappPriority, ourPriorityOracle) for the tip, and
 * floor*1.5 for the maxFeePerGas (gives mining headroom across a few blocks).
 */
export function buildFeeWarning(opts: {
  chainId: string | number;
  dappMaxFeePerGas: string | undefined;
  dappMaxPriorityFeePerGas: string | undefined;
  baseFeeWei: bigint | null | undefined;
  oracleMaxFeePerGas: bigint | null | undefined;
  oracleMaxPriorityFeePerGas: bigint | null | undefined;
}): FeeWarning | null {
  if (!opts.dappMaxFeePerGas) return null;
  const dappMax = toBigInt(opts.dappMaxFeePerGas);
  const dappPriority = toBigInt(opts.dappMaxPriorityFeePerGas) ?? 0n;
  if (dappMax == null) return null;

  const floor = getFeeFloor(opts.chainId, opts.baseFeeWei);
  const priorityFloor = getPriorityFeeFloor(opts.chainId);

  // Effective tip = what miners actually receive. EIP-1559 caps the tip at
  // (maxFeePerGas - baseFee), so a high maxFee with a low maxPriority still
  // pays only maxPriority. With a tight maxFee, the tip can be even lower.
  const baseFeeForTip = opts.baseFeeWei ?? 0n;
  const headroom = dappMax > baseFeeForTip ? dappMax - baseFeeForTip : 0n;
  const effectiveTip = dappPriority < headroom ? dappPriority : headroom;

  const failsMaxFee = dappMax < floor;
  const failsTip = effectiveTip < priorityFloor;
  if (!failsMaxFee && !failsTip) return null;

  const baseFee = opts.baseFeeWei ?? floor;
  const oraclePriority = opts.oracleMaxPriorityFeePerGas ?? GWEI / 10n;
  const tipFloorMin = oraclePriority > priorityFloor ? oraclePriority : priorityFloor;
  const suggestedPriority = tipFloorMin > dappPriority ? tipFloorMin : dappPriority;
  // Aim for ~3 blocks of base-fee headroom: baseFee*2 + tip is the
  // ethers-default formula. Cap below the suggested priority + 2*baseFee
  // so we never silently 10x the dApp's fees.
  const oracleSuggestion =
    opts.oracleMaxFeePerGas && opts.oracleMaxFeePerGas > floor
      ? opts.oracleMaxFeePerGas
      : baseFee * 2n + suggestedPriority;
  // Invariant: suggestedMax must leave at least `suggestedPriority` on top
  // of baseFee, otherwise EIP-1559 caps the effective tip at
  // (suggestedMax - baseFee) which lands below priorityFloor and the
  // "use suggested" choice still trips the same warning. Picking the oracle
  // value alone (when baseFee is low and priorityFloor is high) regressed
  // exactly into this hole — see PR #55 review.
  const tipHeadroomFloor = baseFee + suggestedPriority;
  const suggestedMax = oracleSuggestion > tipHeadroomFloor ? oracleSuggestion : tipHeadroomFloor;

  const trigger: 'maxFee' | 'tip' | 'both' = failsMaxFee && failsTip ? 'both' : failsMaxFee ? 'maxFee' : 'tip';

  const baseFeeGwei = opts.baseFeeWei != null ? Number(opts.baseFeeWei) / 1e9 : null;
  const dappGwei = Number(dappMax) / 1e9;
  const tipGwei = Number(effectiveTip) / 1e9;
  const floorGwei = Number(floor) / 1e9;
  const tipFloorGwei = Number(priorityFloor) / 1e9;

  let reason: string;
  if (trigger === 'maxFee') {
    reason =
      baseFeeGwei != null
        ? `dApp's maxFee ${dappGwei.toFixed(3)} gwei is below the ${floorGwei.toFixed(3)} gwei floor (base fee ${baseFeeGwei.toFixed(3)} gwei). Tx may sit pending.`
        : `dApp's maxFee ${dappGwei.toFixed(3)} gwei is below the ${floorGwei.toFixed(3)} gwei network minimum. Tx may sit pending.`;
  } else if (trigger === 'tip') {
    reason = `Effective miner tip is only ${tipGwei.toFixed(3)} gwei (recommended ≥ ${tipFloorGwei.toFixed(3)} gwei). Low-tip txs can be accepted by an entry node, never gossiped to miners, and silently dropped.`;
  } else {
    reason = `Both maxFee (${dappGwei.toFixed(3)} gwei < floor ${floorGwei.toFixed(3)}) and tip (${tipGwei.toFixed(3)} gwei < ${tipFloorGwei.toFixed(3)}) are too low. Tx will likely sit pending or be evicted.`;
  }

  return {
    dappMaxFeePerGas: opts.dappMaxFeePerGas,
    dappMaxPriorityFeePerGas: opts.dappMaxPriorityFeePerGas ?? '0x0',
    suggestedMaxFeePerGas: '0x' + suggestedMax.toString(16),
    suggestedMaxPriorityFeePerGas: '0x' + suggestedPriority.toString(16),
    floorWei: '0x' + floor.toString(16),
    priorityFloorWei: '0x' + priorityFloor.toString(16),
    effectiveTipWei: '0x' + effectiveTip.toString(16),
    baseFeeWei: opts.baseFeeWei != null ? '0x' + opts.baseFeeWei.toString(16) : null,
    trigger,
    reason,
    chainId: normalizeChainId(opts.chainId),
  };
}

/**
 * The user's choice from the side-panel fee-warning banner. Stored on
 * the approval event under `feeChoice` and read back in signTransaction
 * to override the dApp-supplied fees before sending to the vault.
 */
export interface FeeChoice {
  /** 'dapp' = use dApp's original; 'suggested' = use wallet bump; 'custom' = use the user-typed values below */
  source: 'dapp' | 'suggested' | 'custom';
  /** Only set when source === 'custom' */
  customMaxFeePerGas?: string;
  /** Only set when source === 'custom' */
  customMaxPriorityFeePerGas?: string;
}
