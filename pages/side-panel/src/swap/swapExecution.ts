import type { ExecuteSwapParams, SwapQuote, UiAsset } from './types';

/** Keep the Desktop-issued quote identity attached to the reviewed route. */
export function swapExecutionParams(from: UiAsset, to: UiAsset, amount: string, quote: SwapQuote): ExecuteSwapParams {
  return {
    quoteId: quote.quoteId,
    fromChainId: from.chainId,
    toChainId: to.chainId,
    fromCaip: from.caip || from.asset,
    toCaip: to.caip || to.asset,
    amount,
    memo: quote.memo,
    inboundAddress: quote.inboundAddress,
    router: quote.router,
    expiry: quote.expiry,
    expectedOutput: quote.expectedOutput,
    slippageBps: quote.slippageBps,
    integration: quote.integration,
    swapper: quote.swapper,
    tokenDecimals: from.decimals,
    relayTx: quote.relayTx,
    netFromAmount: quote.netFromAmount,
    minimumOutput: quote.minimumOutput,
    fees: quote.fees,
    estimatedTime: quote.estimatedTime,
    nearIntentsDepositAddress: quote.nearIntentsDepositAddress,
    minAmountIn: quote.minAmountIn,
  };
}
