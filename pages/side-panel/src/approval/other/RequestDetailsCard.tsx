import { useState, useEffect } from 'react';
import { Box, Divider, Flex, Table, Tbody, Tr, Td, Badge, Avatar } from '@chakra-ui/react';

/**
 * Format a raw integer-string amount into a human-readable decimal using
 * the given decimals count. Uses BigInt so 18-decimal TRC-20 amounts
 * don't truncate at Number.MAX_SAFE_INTEGER. Falls back to the raw
 * string for anything that can't be parsed as an integer (legacy rows
 * that still write `amount: someNumber`).
 */
function formatAmount(amountRaw: unknown, decimals: number): string {
  if (amountRaw == null) return 'N/A';
  const str = String(amountRaw);
  // Integer-string path (preferred): BigInt-safe.
  if (/^\d+$/.test(str)) {
    const whole = str.length > decimals ? str.slice(0, -decimals) : '0';
    const frac = str.length > decimals ? str.slice(-decimals) : str.padStart(decimals, '0');
    const trimmed = frac.replace(/0+$/, '');
    return trimmed ? `${whole}.${trimmed}` : whole;
  }
  // Fallback: plain number coercion for rows that never got migrated
  // off the pre-string payment shape. Loses precision for large
  // amounts — acceptable since the vast majority of UI-displayed
  // amounts fit in a Number.
  const n = Number(str);
  if (!Number.isFinite(n)) return str;
  return String(n / Math.pow(10, decimals));
}

export default function RequestDetailsCard({ transaction }: any) {
  const [assetContext, setAssetContext] = useState<any>(null);

  // Function to get asset context
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

  // Fetch the asset context on component mount
  useEffect(() => {
    const fetchAssetContext = async () => {
      try {
        const context: any = await requestAssetContext();
        setAssetContext(context);
      } catch (error) {
        console.error('Failed to get asset context:', error);
      }
    };

    fetchAssetContext();
  }, []);

  // Decimals precedence: event-side payment hint (set by Tron handler),
  // then asset context, then 6 (matches XRP drops + TRX sun — the two
  // chains this renderer has historically served). Symbol follows the
  // same cascade.
  const payment = transaction?.unsignedTx?.payment;
  const decimals: number =
    typeof payment?.decimals === 'number'
      ? payment.decimals
      : typeof assetContext?.assets?.decimals === 'number'
        ? assetContext.assets.decimals
        : 6;
  const symbol: string = payment?.symbol || assetContext?.assets?.symbol || '';

  return (
    <div>
      <Flex direction="column" mb={4}>
        {/* Display the Avatar for the asset */}
        {assetContext && (
          <Flex justify="center" mb={4}>
            <Avatar size="md" src={assetContext?.assets?.icon} alt="Asset Icon" />
          </Flex>
        )}
        <Box mb={2}>
          <Table variant="simple" size="sm">
            <Tbody>
              <Tr>
                <Td>
                  <Badge>To:</Badge>
                </Td>
                <Td>{payment?.destination || 'N/A'}</Td>
              </Tr>
              <Tr>
                <Td>
                  <Badge>Amount:</Badge>
                </Td>
                <Td>
                  {formatAmount(payment?.amount, decimals)} {symbol}
                </Td>
              </Tr>
              {/* Ripple only — suppress the row entirely for other chains
                  so Tron/etc. don't display a misleading "none". */}
              {payment?.destinationTag !== undefined && (
                <Tr>
                  <Td>
                    <Badge>destinationTag:</Badge>
                  </Td>
                  <Td>{payment.destinationTag || 'none'}</Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </Box>
        <Divider my={2} />
      </Flex>
    </div>
  );
}
