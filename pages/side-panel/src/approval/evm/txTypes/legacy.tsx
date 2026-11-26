import { Box, Flex, Link, Switch, Text } from '@chakra-ui/react';
import React, { useState, useEffect } from 'react';
import { getExplorerAddressUrl } from '@extension/shared/lib/utils/explorerUrls';
import { shortAddresses } from '../../clearSignFormat';
import { tokens, fonts } from '../../../styles/tokens';
import { EVM_NATIVE_GAS, KNOWN_EVM_CHAINS } from '../../../components/header/headerConstants';
import { MicroLabel } from '../../../components/v2/primitives';
import { CodeBlock, KvRow } from '../../ui';

const requestAssetContext = () => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve(response);
    });
  });
};

const toNetworkId = (chainId: unknown): string | null => {
  if (chainId === undefined || chainId === null || chainId === '') return null;
  const raw = String(chainId);
  const n = /^0x/i.test(raw) ? parseInt(raw, 16) : parseInt(raw, 10);
  return Number.isFinite(n) ? `eip155:${n}` : null;
};

export default function LegacyTx({ transaction }: any) {
  const [showHex, setShowHex] = useState(false);
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    requestAssetContext()
      .then((response: any) => {
        const parsed = parseFloat(response?.assets?.priceUsd);
        if (Number.isFinite(parsed)) setPrice(parsed);
      })
      .catch(err => console.error('Error fetching asset context:', err));
  }, []);

  const tx = transaction?.unsignedTx ?? {};
  const networkId = toNetworkId(tx.chainId);
  const networkName = networkId ? KNOWN_EVM_CHAINS[networkId]?.name : undefined;
  // L2s pay gas and carry value in ETH, Polygon in POL — never hardcode "ETH".
  const nativeSymbol = (networkId && EVM_NATIVE_GAS[networkId]?.symbol) || 'ETH';

  const valueHex: string = tx.value || '0x0';
  let nativeValue = 0;
  try {
    nativeValue = Number(BigInt(valueHex)) / 1e18;
  } catch {
    nativeValue = 0;
  }
  const valueUsd = price !== null && nativeValue > 0 ? (price * nativeValue).toFixed(2) : null;

  const to: string | undefined = tx.to;
  const explorerUrl = networkId && to ? getExplorerAddressUrl(networkId, to) : null;
  const data: string | undefined = tx.data && tx.data !== '0x' ? tx.data : undefined;

  return (
    <Box>
      <KvRow label="Network" title={tx.chainId != null ? `chainId ${tx.chainId}` : undefined}>
        {networkName ?? (tx.chainId != null ? String(tx.chainId) : '—')}
      </KvRow>
      <KvRow label={data ? 'Contract' : 'Recipient'} title={to}>
        {to ? (
          explorerUrl ? (
            <Link href={explorerUrl} isExternal color={tokens.text} _hover={{ color: tokens.accent }}>
              {shortAddresses(to)} ↗
            </Link>
          ) : (
            shortAddresses(to)
          )
        ) : (
          '—'
        )}
      </KvRow>
      <KvRow label="Value" last={!data}>
        {showHex ? valueHex : `${nativeValue} ${nativeSymbol}`}
        {valueUsd && !showHex && (
          <Text as="span" color={tokens.faint} marginLeft="6px">
            ≈ ${valueUsd}
          </Text>
        )}
      </KvRow>

      {data && (
        <Box paddingTop="12px">
          <Flex justifyContent="space-between" alignItems="center" marginBottom="8px">
            <MicroLabel>Call data</MicroLabel>
            <Text fontFamily={fonts.mono} fontSize="11px" color={tokens.faint}>
              {(data.length - 2) / 2} bytes
            </Text>
          </Flex>
          <CodeBlock>{data}</CodeBlock>
        </Box>
      )}

      <Flex alignItems="center" justifyContent="flex-end" gap="8px" marginTop="12px">
        <MicroLabel as="label" htmlFor="kk-show-hex" cursor="pointer">
          Raw hex value
        </MicroLabel>
        <Switch id="kk-show-hex" size="sm" isChecked={showHex} onChange={() => setShowHex(v => !v)} />
      </Flex>
    </Box>
  );
}
