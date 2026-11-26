import { Box, Button, Flex, IconButton, Link, Text, Tooltip, useClipboard } from '@chakra-ui/react';
import { CheckIcon, CopyIcon, ExternalLinkIcon } from '@chakra-ui/icons';
import { tokens } from '../styles/tokens';
import { SuccessMoment } from '../components/SuccessMoment';

export const truncateTxid = (txHash: string) =>
  txHash.length > 20 ? `${txHash.slice(0, 10)}…${txHash.slice(-8)}` : txHash;

/**
 * Broadcast confirmation: the success moment plays once (~900 ms) while the
 * txid and explorer link are already on screen; Close works immediately.
 */
const TxidPage = ({
  txHash,
  explorerUrl,
  networkId,
  onClose,
  reducedMotion,
}: {
  txHash: string;
  explorerUrl?: string;
  networkId?: string;
  onClose?: () => void;
  reducedMotion?: boolean;
}) => {
  const { hasCopied, onCopy } = useClipboard(txHash);
  const short = truncateTxid(txHash);

  return (
    <Flex align="center" justify="center" minHeight="100vh" bg={tokens.bg} padding="16px" data-txid-page>
      <Box
        width="100%"
        maxW="380px"
        bg={tokens.surface}
        border={`1px solid ${tokens.line}`}
        borderRadius="16px"
        padding="28px 20px 20px"
        textAlign="center"
        color={tokens.text}
        animation="kk-rise .3s">
        <SuccessMoment networkId={networkId} reducedMotion={reducedMotion} />

        <Text fontSize="18px" fontWeight={700} marginTop="18px">
          Transaction sent
        </Text>
        <Text fontSize="12.5px" color={tokens.dim} marginTop="4px">
          Signed on your KeepKey and broadcast.
        </Text>

        <Flex
          marginTop="18px"
          align="center"
          gap="8px"
          padding="8px 8px 8px 12px"
          bg={tokens.bg2}
          border={`1px solid ${tokens.line}`}
          borderRadius="10px">
          <Text fontSize="11px" color={tokens.faint} className="mono">
            Tx
          </Text>
          {explorerUrl ? (
            <Link
              href={explorerUrl}
              isExternal
              flex="1"
              minW={0}
              textAlign="left"
              className="mono"
              fontSize="12px"
              color={tokens.accentHi}
              title={txHash}
              data-txid-link
              _hover={{ color: tokens.accent, textDecoration: 'underline' }}>
              {short}
              <ExternalLinkIcon marginLeft="5px" boxSize={3} />
            </Link>
          ) : (
            <Text flex="1" minW={0} textAlign="left" className="mono" fontSize="12px" title={txHash} data-txid-text>
              {short}
            </Text>
          )}
          <Tooltip label={hasCopied ? 'Copied' : 'Copy full transaction ID'} closeOnClick={false} hasArrow>
            <IconButton
              aria-label="Copy transaction ID"
              icon={hasCopied ? <CheckIcon /> : <CopyIcon />}
              onClick={onCopy}
              size="xs"
              variant="ghost"
              color={hasCopied ? tokens.good : tokens.dim}
            />
          </Tooltip>
        </Flex>

        <Flex direction="column" gap="10px" marginTop="20px">
          {explorerUrl && (
            <Button
              as="a"
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="keycapSecondary"
              size="md"
              width="100%"
              data-action="view-explorer">
              View on explorer
            </Button>
          )}
          <Button onClick={() => onClose?.()} variant="solid" size="md" width="100%" data-action="close">
            Done
          </Button>
        </Flex>
      </Box>
    </Flex>
  );
};

export default TxidPage;
