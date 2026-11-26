import { useMemo, useEffect, useState } from 'react';
import { Avatar, Box, Flex, Image, Text } from '@chakra-ui/react';
import { tokens, fonts } from '../../styles/tokens';
import { KNOWN_EVM_CHAINS } from '../../components/header/headerConstants';
import { Chip } from '../ui';

const KEEPKEY_LOGO = '/kk-logo.png';
const KEEPKEY_LOGO_FALLBACK = '/icon-128.png';

interface IProps {
  transaction: any;
}

// What the request does, in words — the raw RPC method stays visible as a
// small mono chip for people who want it.
const ACTION_LABELS: Record<string, string> = {
  eth_sendTransaction: 'Send a transaction',
  transfer: 'Send a transaction',
  eth_signTransaction: 'Sign a transaction',
  personal_sign: 'Sign a message',
  eth_sign: 'Sign a message',
  eth_signTypedData: 'Sign typed data',
  eth_signTypedData_v3: 'Sign typed data',
  eth_signTypedData_v4: 'Sign typed data',
  wallet_addEthereumChain: 'Add a network',
};

const chainIdToNetworkId = (chainId: unknown): string | null => {
  if (chainId === undefined || chainId === null || chainId === '') return null;
  const raw = String(chainId);
  const n = /^0x/i.test(raw) ? parseInt(raw, 16) : parseInt(raw, 10);
  return Number.isFinite(n) ? `eip155:${n}` : null;
};

export default function ProjectInfoCard({ transaction }: IProps) {
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);
  const isKeepKeyExtension = transaction?.siteUrl === 'KeepKey Browser Extension';

  const host = useMemo(() => {
    try {
      return new URL(transaction?.siteUrl).hostname;
    } catch {
      return null;
    }
  }, [transaction?.siteUrl]);

  // "app.uniswap.org" → "uniswap.org", so the initial fallback reads "U", not "A"
  const siteName = useMemo(() => host?.replace(/^(www|app)\./, ''), [host]);

  useEffect(() => {
    setLogoError(false);
    if (isKeepKeyExtension) setFaviconUrl(KEEPKEY_LOGO);
    else if (host) setFaviconUrl(`https://${host}/favicon.ico`);
  }, [host, isKeepKeyExtension]);

  const networkId = chainIdToNetworkId(transaction?.unsignedTx?.chainId ?? transaction?.chainId);
  const networkName = networkId ? KNOWN_EVM_CHAINS[networkId]?.name : undefined;
  const action = ACTION_LABELS[transaction?.type] ?? 'Review a request';

  return (
    <Flex direction="column" alignItems="center" textAlign="center" paddingTop="8px" paddingBottom="4px">
      <Box position="relative" marginBottom="14px">
        {isKeepKeyExtension ? (
          <Image
            src={logoError ? KEEPKEY_LOGO_FALLBACK : faviconUrl || KEEPKEY_LOGO}
            alt="KeepKey"
            boxSize="52px"
            objectFit="contain"
            onError={() => setLogoError(true)}
          />
        ) : (
          // A site without a usable favicon gets its initial, never the KeepKey
          // status icon blown up — that implied KeepKey itself was asking.
          <Avatar
            src={faviconUrl ?? undefined}
            name={siteName}
            width="52px"
            height="52px"
            background={tokens.surfaceHi}
            color={tokens.text}
            border={`1px solid ${tokens.lineHi}`}
          />
        )}
        {!isKeepKeyExtension && (
          <Image
            src={KEEPKEY_LOGO}
            boxSize="20px"
            position="absolute"
            bottom="-2px"
            right="-4px"
            borderRadius="6px"
            border={`2px solid ${tokens.bg}`}
            background={tokens.bg}
          />
        )}
      </Box>

      <Text
        data-testid="session-info-card-text"
        fontSize="17px"
        fontWeight={600}
        color={tokens.text}
        letterSpacing="-0.01em"
        wordBreak="break-all">
        {isKeepKeyExtension ? 'KeepKey' : host || transaction?.siteUrl || 'Unknown site'}
      </Text>
      <Text fontSize="13px" color={tokens.dim} marginTop="2px">
        wants to{' '}
        <Text as="span" color={tokens.text}>
          {action.toLowerCase()}
        </Text>
        {networkName ? (
          <>
            {' '}
            on{' '}
            <Text as="span" color={tokens.text}>
              {networkName}
            </Text>
          </>
        ) : null}
      </Text>
      {transaction?.type && (
        <Box marginTop="10px">
          <Chip title="JSON-RPC method">
            <Text as="span" fontFamily={fonts.mono} textTransform="none" letterSpacing="0.02em">
              {transaction.type}
            </Text>
          </Chip>
        </Box>
      )}
    </Flex>
  );
}
