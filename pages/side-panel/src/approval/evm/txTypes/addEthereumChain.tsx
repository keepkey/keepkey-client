import React, { useMemo } from 'react';
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Divider,
  Flex,
  HStack,
  Link,
  Table,
  Tbody,
  Td,
  Text,
  Tr,
} from '@chakra-ui/react';
import { ExternalLinkIcon } from '@chakra-ui/icons';

/**
 * Approval view for `wallet_addEthereumChain`. The dApp provides an RPC
 * URL that the wallet will use for ALL subsequent reads on that chain
 * (balances, gas price, `eth_call`, …). If we hand over to a malicious
 * RPC the attacker can show fake "confirmed" balances to trick the user
 * into thinking a send succeeded, fake zero-gas quotes to steer them
 * into signing something else, etc. The on-device step only confirms
 * outgoing transactions — not the view of the world — so this approval
 * is the ONLY surface that protects against a phishing RPC.
 *
 * Design decisions:
 *   - RPC URL is always rendered in full, monospaced, word-broken. No
 *     truncation. Users need to see the whole host so they can spot
 *     typosquat domains.
 *   - Warn if RPC is plain http:// (cleartext — eavesdropping risk).
 *   - chainId shown in both hex and decimal — the dApp sends hex, but
 *     "1" is more recognizable than "0x1".
 *   - No fee tab / no gas info — this flow never triggers a signed tx.
 */
export default function AddEthereumChainTx({ transaction }: any) {
  // event.request = [{ chainId, chainName, nativeCurrency, rpcUrls, blockExplorerUrls?, iconUrls? }]
  const req = transaction?.request?.[0] || transaction?.requestInfo?.params?.[0] || {};

  const parsed = useMemo(() => {
    const chainIdHex: string = req.chainId || '';
    const chainIdDecimal = /^0x[0-9a-fA-F]+$/.test(chainIdHex) ? parseInt(chainIdHex, 16) : NaN;
    const rpcUrls: string[] = Array.isArray(req.rpcUrls) ? req.rpcUrls.filter((u: any) => typeof u === 'string') : [];
    const explorers: string[] = Array.isArray(req.blockExplorerUrls)
      ? req.blockExplorerUrls.filter((u: any) => typeof u === 'string')
      : [];
    const native = req.nativeCurrency || {};
    return {
      chainIdHex,
      chainIdDecimal,
      chainName: req.chainName || '(unnamed)',
      rpcUrls,
      explorers,
      native: {
        name: native.name || '',
        symbol: native.symbol || '',
        decimals: typeof native.decimals === 'number' ? native.decimals : undefined,
      },
    };
  }, [req]);

  const primaryRpc = parsed.rpcUrls[0] || '';
  const isHttpOnly = /^http:\/\//i.test(primaryRpc);

  return (
    <Flex direction="column" mb={4} gap={3}>
      <Alert status="warning" borderRadius="md" fontSize="sm">
        <AlertIcon />
        <Box>
          <Text fontWeight="semibold">Adding a network lets this site choose your RPC.</Text>
          <Text mt={1} color="whiteAlpha.800">
            All balance lookups and gas estimates for this chain will go through the URL below. Verify it matches the
            official provider before approving.
          </Text>
        </Box>
      </Alert>

      {isHttpOnly && (
        <Alert status="error" borderRadius="md" fontSize="sm">
          <AlertIcon />
          <Text>
            RPC URL is <strong>plain http</strong> — traffic is unencrypted. Most legitimate chains offer{' '}
            <code>https</code>. Strongly recommend rejecting.
          </Text>
        </Alert>
      )}

      <Box>
        <Table variant="simple" size="sm">
          <Tbody>
            <Tr>
              <Td width="130px" verticalAlign="top">
                <Badge>Chain:</Badge>
              </Td>
              <Td>
                <HStack spacing={2} wrap="wrap">
                  <Text fontWeight="semibold">{parsed.chainName}</Text>
                  <Text fontSize="xs" color="whiteAlpha.600">
                    {parsed.chainIdHex}
                    {Number.isFinite(parsed.chainIdDecimal) ? ` (${parsed.chainIdDecimal})` : ''}
                  </Text>
                </HStack>
              </Td>
            </Tr>

            <Tr>
              <Td verticalAlign="top">
                <Badge>Currency:</Badge>
              </Td>
              <Td>
                <HStack spacing={2} wrap="wrap">
                  {parsed.native.symbol && (
                    <Text fontFamily="mono" fontWeight="bold">
                      {parsed.native.symbol}
                    </Text>
                  )}
                  {parsed.native.name && (
                    <Text fontSize="sm" color="whiteAlpha.700">
                      {parsed.native.name}
                    </Text>
                  )}
                  {parsed.native.decimals !== undefined && (
                    <Text fontSize="xs" color="whiteAlpha.600">
                      {parsed.native.decimals} decimals
                    </Text>
                  )}
                </HStack>
              </Td>
            </Tr>

            <Tr>
              <Td verticalAlign="top">
                <Badge colorScheme={isHttpOnly ? 'red' : 'yellow'}>RPC URL:</Badge>
              </Td>
              <Td>
                {parsed.rpcUrls.length === 0 ? (
                  <Text color="red.300" fontSize="sm">
                    (none provided)
                  </Text>
                ) : (
                  <Box>
                    {parsed.rpcUrls.map((url, i) => (
                      <Text
                        key={i}
                        fontFamily="mono"
                        fontSize="xs"
                        wordBreak="break-all"
                        color={isHttpOnly && i === 0 ? 'red.300' : 'whiteAlpha.900'}
                        bg="rgba(0,0,0,0.25)"
                        px={2}
                        py={1}
                        borderRadius="sm"
                        mb={i < parsed.rpcUrls.length - 1 ? 1 : 0}>
                        {url}
                      </Text>
                    ))}
                  </Box>
                )}
              </Td>
            </Tr>

            {parsed.explorers.length > 0 && (
              <Tr>
                <Td verticalAlign="top">
                  <Badge>Explorer:</Badge>
                </Td>
                <Td>
                  {parsed.explorers.map((url, i) => (
                    <Link key={i} href={url} isExternal fontFamily="mono" fontSize="xs" wordBreak="break-all" mr={2}>
                      {url}
                      <ExternalLinkIcon mx={1} boxSize={3} />
                    </Link>
                  ))}
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </Box>
      <Divider my={1} />
    </Flex>
  );
}
