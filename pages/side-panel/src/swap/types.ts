// Vault headless swap REST contract shapes (see the vault handoff).
// Kept minimal — only what the side-panel swap UI reads.

export interface SwapAsset {
  asset: string; // THORChain-style name, e.g. "BTC.BTC"
  chainId: string; // our chain id, e.g. "bitcoin"
  symbol: string;
  name: string;
  chainFamily: string;
  decimals: number;
  caip?: string;
  icon?: string;
  contractAddress?: string;
}

/** Pre-built EVM tx from relay/bridge integrations (relay/0x/chainflip/NEAR EVM).
 *  When present, vault builds from this instead of the memo+router (THORChain) flow. */
export interface RelayTxParams {
  to: string;
  data: string;
  value: string;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  chainId: number;
  isDepositChannel?: boolean;
  serializedTx?: string;
}

export interface SwapQuote {
  expectedOutput: string;
  minimumOutput: string;
  inboundAddress: string;
  router?: string;
  memo: string;
  expiry?: number;
  fees: { affiliate: string; outbound: string; totalBps: number };
  estimatedTime: number; // seconds
  warning?: string;
  slippageBps: number;
  integration?: string;
  swapper?: string;
  minAmountIn?: string;
  netFromAmount?: string;
  relayTx?: RelayTxParams;
  nearIntentsDepositAddress?: string;
}

export interface SwapQuoteParams {
  fromCaip: string;
  toCaip: string;
  amount: string;
  fromAddress?: string; // resolved in the background from cached balances when omitted
  toAddress?: string;
  slippageBps?: number;
  isMax?: boolean;
  feeLevel?: number;
}

export interface ExecuteSwapParams {
  fromChainId: string;
  toChainId: string;
  fromCaip: string;
  toCaip: string;
  amount: string;
  memo: string;
  inboundAddress: string;
  router?: string;
  expiry?: number;
  expectedOutput: string;
  isMax?: boolean;
  feeLevel?: number;
  integration?: string;
  swapper?: string;
  slippageBps?: number;
  tokenDecimals?: number;
  // Full-quote pass-through so vault /execute is stateless (no dependency on its
  // in-process quote cache). relayTx is REQUIRED for relay/0x/chainflip EVM routes;
  // netFromAmount is the NEAR-Intents sendMax correctness field; the rest feed the tracker.
  relayTx?: RelayTxParams;
  netFromAmount?: string;
  minimumOutput?: string;
  fees?: { affiliate: string; outbound: string; totalBps: number };
  estimatedTime?: number;
  nearIntentsDepositAddress?: string;
  minAmountIn?: string;
}

export interface SwapResult {
  txid: string;
  fromCaip: string;
  toCaip: string;
  fromAmount: string;
  expectedOutput: string;
  approvalTxid?: string;
}

export type SwapTrackingStatus =
  | 'signing'
  | 'pending'
  | 'confirming'
  | 'output_detected'
  | 'output_confirming'
  | 'output_confirmed'
  | 'completed'
  | 'failed'
  | 'refunded';

export interface SwapHistoryRecord {
  txid: string;
  status: SwapTrackingStatus;
  outboundTxid?: string;
  receivedOutput?: string;
  completedAt?: number;
  refundReason?: string;
}

/** UI-side asset shape derived from a SwapAsset (adds a glyph color fallback). */
export interface UiAsset extends SwapAsset {
  color: string;
}
