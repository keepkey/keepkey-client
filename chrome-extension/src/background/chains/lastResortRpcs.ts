/**
 * Last-resort EVM RPC URLs for the broadcast failover loop.
 *
 * # Why this exists
 *
 * Pioneer is the source of truth for chain RPCs (see `registry.ts`).
 * BUT during a broadcast we sometimes need to try multiple URLs because
 * a single endpoint rate-limited (the Tenderly-on-Optimism case from
 * 2026-04-30). When Pioneer's full list is exhausted — or when Pioneer
 * itself is unreachable — we still want the user's transaction to land.
 *
 * # The rule
 *
 * **Pioneer URLs always run FIRST. This list runs LAST.**
 *
 * The historical objection to a hardcoded RPC table (see
 * `feedback_no_hardcoded_rpcs.md`) was that it could *block* live
 * Pioneer nodes when entries went stale, forcing emergency releases to
 * fix individual URL rot. Appending the table to the end of the loop
 * removes that risk: a stale entry can only fail; it can never preempt
 * a working Pioneer-discovered URL.
 *
 * # How to maintain
 *
 * Keep this list small (2 URLs per chain is enough). Pick canonical
 * public endpoints that have been historically reliable: chain-team
 * official RPCs, drpc.org, publicnode.com. Don't use anything that
 * needs an API key.
 *
 * If a chain isn't here, broadcast failover relies entirely on the
 * Pioneer list — which is fine for the long tail.
 */

const RPCS: Record<string, string[]> = {
  'eip155:1': ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
  'eip155:10': ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'],
  'eip155:56': ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'],
  'eip155:137': ['https://polygon-rpc.com', 'https://polygon-bor-rpc.publicnode.com'],
  'eip155:324': ['https://mainnet.era.zksync.io'],
  'eip155:8453': ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
  'eip155:42161': ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
  'eip155:43114': ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com'],
};

export function getLastResortRpcs(networkId: string): string[] {
  return RPCS[networkId] ? [...RPCS[networkId]] : [];
}
