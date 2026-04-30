import { Button, Card, Box, Flex, Stack, Text, Heading, Icon, Divider, Link } from '@chakra-ui/react';
import { ExternalLinkIcon, WarningTwoIcon } from '@chakra-ui/icons';
import { requestStorage } from '@extension/storage';

/**
 * Surface for a wallet_switchEthereumChain request that hit a chain we
 * don't know about. The 4902 has already gone back to the dApp by the
 * time this renders — this is purely informational so the user
 * understands why nothing happened, and has somewhere to go to fix it.
 *
 * TODO(pioneer-evm-discovery): when the BEX learns to ask Pioneer for
 * an EVM chain catalog, this card should be replaced (or wrapped) by a
 * one-step add-and-switch approval flow whenever Pioneer recognizes
 * the chain. Falling back to the manual Chainlist path only when
 * Pioneer also doesn't know it.
 */
export default function ChainNotEnabledCard({ event, onDismiss }: { event: any; onDismiss: () => void }) {
  const chainIdHex: string = event?.unsignedTx?.chainIdHex || '?';
  const chainIdDecimal: number | string = event?.unsignedTx?.chainIdDecimal ?? '?';
  const siteUrl: string = event?.siteUrl || event?.href || '';

  const close = async () => {
    try {
      await requestStorage.removeEventById(event.id);
    } catch (e) {
      console.warn('Failed to remove chain-not-enabled event:', e);
    }
    onDismiss();
  };

  const openChainlist = () => {
    window.open('https://chainlist.org/', '_blank');
  };

  return (
    <Flex direction="column" alignItems="center" p={4}>
      <Card padding="4" boxShadow="lg" borderRadius="md" width="100%" maxWidth="600px">
        <Stack spacing={4}>
          <Flex direction="column" align="center" textAlign="center">
            <Icon as={WarningTwoIcon} boxSize={10} color="yellow.400" mb={3} />
            <Heading as="h3" size="md" mb={1}>
              Chain not enabled
            </Heading>
            {siteUrl && (
              <Text fontSize="sm" color="whiteAlpha.700" wordBreak="break-all">
                {siteUrl}
              </Text>
            )}
            <Text fontSize="sm" color="whiteAlpha.800" mt={2}>
              tried to switch to a chain that isn't loaded on this wallet.
            </Text>
          </Flex>

          <Divider />

          <Box>
            <Text fontSize="xs" color="whiteAlpha.600" mb={1}>
              Requested chain
            </Text>
            <Text fontFamily="mono" fontSize="sm">
              {chainIdHex} ({chainIdDecimal})
            </Text>
          </Box>

          <Divider />

          <Box>
            <Text fontSize="sm" color="whiteAlpha.800" mb={2}>
              Add this network from Chainlist, then try the dApp action again.
            </Text>
            <Link onClick={openChainlist} color="blue.300" fontSize="sm" display="inline-flex" alignItems="center">
              Browse Chainlist.org
              <Icon as={ExternalLinkIcon} ml={1} boxSize={3} />
            </Link>
          </Box>

          <Flex justify="center" pt={2}>
            <Button colorScheme="yellow" onClick={close}>
              Close
            </Button>
          </Flex>
        </Stack>
      </Card>
    </Flex>
  );
}
