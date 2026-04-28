import { Box, HStack, Link, Text } from '@chakra-ui/react';
import React from 'react';

type NonceInfo = { latest: number; pending: number; willReplace: boolean };

interface Props {
  nonceInfo: NonceInfo;
  /** Address whose nonces we report — for the etherscan deep-link. Optional. */
  address?: string;
  /** chainId for deep-link routing — defaults to mainnet. */
  chainId?: number | string;
}

/**
 * Read-only nonce visibility. Shows the next-available nonce, plus a yellow
 * warning when there's already a pending tx that this one would queue behind
 * (or replace). No edit affordance in this round — manual nonce override is
 * deferred to a follow-up.
 */
export default function NonceInfoRow({ nonceInfo, address, chainId }: Props) {
  const { latest, pending, willReplace } = nonceInfo;
  const inFlight = pending - latest;

  const explorerHref =
    address && (chainId === 1 || chainId === '0x1' || chainId === undefined)
      ? `https://etherscan.io/address/${address}`
      : null;

  const tone = willReplace ? 'red.300' : inFlight > 0 ? 'orange.300' : 'rgba(255,255,255,0.65)';

  let label: string;
  if (willReplace) {
    label = `⚠ Replaces a pending tx at nonce ${latest}. Needs +10% on both fees to evict.`;
  } else if (inFlight > 0) {
    label = `Nonce ${pending} (you have ${inFlight} pending tx${inFlight > 1 ? 's' : ''} ahead of this).`;
  } else {
    label = `Nonce ${pending} (next available).`;
  }

  return (
    <Box px={3} py={2} borderRadius="md" bg="rgba(255,255,255,0.04)" mb={2}>
      <HStack spacing={2} fontSize="xs">
        <Text color={tone}>{label}</Text>
        {explorerHref && (
          <Link href={explorerHref} isExternal color="blue.300" fontSize="xs">
            view on etherscan ↗
          </Link>
        )}
      </HStack>
    </Box>
  );
}
