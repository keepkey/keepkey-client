import { Flex, Link, Text } from '@chakra-ui/react';
import React from 'react';
import { tokens, fonts } from '../../styles/tokens';
import { MicroLabel } from '../../components/v2/primitives';
import { ToneDot } from '../ui';

type NonceInfo = { latest: number; pending: number; willReplace: boolean };

interface Props {
  nonceInfo: NonceInfo;
  /** Address whose nonces we report — for the etherscan deep-link. Optional. */
  address?: string;
  /** chainId for deep-link routing — defaults to mainnet. */
  chainId?: number | string;
}

/**
 * Read-only nonce visibility: the nonce this tx will use, plus a status dot
 * when a pending tx sits ahead of it (or would be replaced). No edit
 * affordance yet — manual nonce override is a follow-up.
 */
export default function NonceInfoRow({ nonceInfo, address, chainId }: Props) {
  const { latest, pending, willReplace } = nonceInfo;
  const inFlight = pending - latest;

  const explorerHref =
    address && (chainId === 1 || chainId === '0x1' || chainId === undefined)
      ? `https://etherscan.io/address/${address}`
      : null;

  const tone = willReplace ? 'bad' : inFlight > 0 ? 'warn' : null;
  const note = willReplace
    ? `Replaces the pending tx at nonce ${latest}. Needs +10% on both fees.`
    : inFlight > 0
      ? `${inFlight} pending tx${inFlight > 1 ? 's' : ''} ahead of this one`
      : 'next available';

  return (
    <Flex alignItems="center" justifyContent="space-between" gap="12px" padding="2px 2px">
      <Flex alignItems="center" gap="8px" minWidth={0}>
        <MicroLabel>Nonce</MicroLabel>
        <Text fontFamily={fonts.mono} fontSize="12.5px" color={tokens.text}>
          {willReplace ? latest : pending}
        </Text>
        {tone && <ToneDot tone={tone} />}
        <Text fontSize="12px" color={tone ? tokens.dim : tokens.faint} noOfLines={2}>
          {note}
        </Text>
      </Flex>
      {explorerHref && (
        <Link
          href={explorerHref}
          isExternal
          fontFamily={fonts.mono}
          fontSize="11px"
          color={tokens.faint}
          flexShrink={0}
          _hover={{ color: tokens.text }}>
          Etherscan ↗
        </Link>
      )}
    </Flex>
  );
}
