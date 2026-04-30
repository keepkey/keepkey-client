import { useState, useEffect } from 'react';
import { Box, Divider, Flex, Table, Tbody, Tr, Td, Badge, Avatar, IconButton, Tooltip } from '@chakra-ui/react';
import { CopyIcon, CheckIcon } from '@chakra-ui/icons';

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
    // Zero-decimal assets render as-is — `str.slice(0, -0)` returns ''
    // and `str.slice(-0)` returns the full string (since -0 === 0), so
    // without this guard "123" would render as ".123".
    if (decimals <= 0) return str;
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

/**
 * Decode raw message bytes for display. Most dApp messages (SIWS login
 * challenges, terms-of-service confirmations) are UTF-8 text — show
 * that. If decoding produces a control-character soup, fall back to
 * a hex dump so the user at least sees what's being signed.
 */
/**
 * Group bytes for human-readable hex display: 8 bytes per chunk (space
 * between), 4 chunks per line (newline). One unbroken hex string is
 * unreadable past ~80 chars; this is how every hex dump tool (xxd,
 * hexdump -C) formats output for the same reason.
 */
function formatHexDump(bytes: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    out.push((bytes[i] & 0xff).toString(16).padStart(2, '0'));
    if (i % 32 === 31) out.push('\n');
    else if (i % 8 === 7) out.push('  ');
    else out.push(' ');
  }
  return out.join('').trimEnd();
}

function decodeMessage(bytes: number[] | undefined): { text: string; isPrintable: boolean } {
  if (!bytes || !Array.isArray(bytes) || bytes.length === 0) {
    return { text: '(empty message)', isPrintable: true };
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
    // Reject if more than ~10% of decoded chars are control chars (excluding \n, \r, \t).
    let bad = 0;
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) bad++;
      else if (c === 0xfffd) bad++;
    }
    if (bad / Math.max(text.length, 1) > 0.1) {
      return { text: formatHexDump(bytes), isPrintable: false };
    }
    return { text, isPrintable: true };
  } catch {
    return { text: formatHexDump(bytes), isPrintable: false };
  }
}

/**
 * Pretty-print a stashed hex string (no spacing) into the same grouped
 * dump format `decodeMessage` produces for byte arrays. Used when the
 * handler has already pre-encoded the message as hex (off-chain path).
 */
function regroupHexString(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  const bytes: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const v = parseInt(clean.slice(i, i + 2), 16);
    if (!Number.isFinite(v)) return hex; // unparseable — return original
    bytes.push(v);
  }
  return bytes.length > 0 ? formatHexDump(bytes) : hex;
}

export default function RequestDetailsCard({ transaction }: any) {
  const [assetContext, setAssetContext] = useState<any>(null);
  const [messageCopied, setMessageCopied] = useState(false);

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

  // Event-side hints (set by the chain handler) always win; we only
  // fall back to the global asset context when its caip *matches* the
  // event's caip. Why the match gate: dApp-originated sign events
  // carry their own caip (e.g. tron:*/token:TR7NHq...), but the
  // global asset context reflects whatever the user last clicked in
  // the side-panel asset list — could be ETH, SOL, whatever.
  // Without the guard, a dApp-initiated USDT-TRON approval could
  // render with the ETH icon + "ETH" symbol just because the user
  // had ETH selected. Side-panel send flows always match (the user
  // just clicked the asset), so nothing regresses there.
  const unsignedTx = transaction?.unsignedTx;
  const payment = unsignedTx?.payment;
  const kind: string | undefined = unsignedTx?.kind;
  const eventCaip: string = unsignedTx?.caip || '';
  const ctxAsset = assetContext?.assets;
  const ctxCaip: string = ctxAsset?.caip || '';
  const ctxMatches = !!eventCaip && eventCaip === ctxCaip;
  const ctxSymbol: string = ctxMatches ? ctxAsset?.symbol || '' : '';
  const ctxIcon: string = ctxMatches ? ctxAsset?.icon || '' : '';
  const ctxDecimals: number | undefined =
    ctxMatches && typeof ctxAsset?.decimals === 'number' ? ctxAsset.decimals : undefined;

  const decimals: number = typeof payment?.decimals === 'number' ? payment.decimals : (ctxDecimals ?? 6);
  const symbol: string = payment?.symbol || ctxSymbol || '';

  // Sign-message rendering diverges entirely — there's no destination
  // and no amount. Different code paths stash the message in different
  // places:
  //   - solana_signMessage: params[0] is a raw number[]; decode here.
  //   - solana_signOffchainMessage: params[0] is an object, but the
  //     handler decorates `unsignedTx` with `messageUtf8` (UTF-8) and
  //     `message` (hex) at solanaHandler.ts:784. Use those — pulling
  //     `request[0]` would render "[object Object]" via decodeMessage.
  const isSignMessage =
    transaction?.type === 'solana_signMessage' || transaction?.type === 'solana_signOffchainMessage';
  if (isSignMessage) {
    let messageText: string;
    let isPrintable: boolean;
    const stashedUtf8: string | undefined = transaction?.unsignedTx?.messageUtf8;
    const stashedHex: string | undefined = transaction?.unsignedTx?.message;
    if (typeof stashedUtf8 === 'string' && stashedUtf8.length > 0) {
      messageText = stashedUtf8;
      isPrintable = true;
    } else if (typeof stashedHex === 'string' && stashedHex.length > 0) {
      // Re-format the handler's compact hex into a hex dump so it's
      // readable rather than one ~2000-char block.
      messageText = regroupHexString(stashedHex);
      isPrintable = false;
    } else {
      const messageBytes: number[] | undefined = transaction?.request?.[0];
      const decoded = decodeMessage(messageBytes);
      messageText = decoded.text;
      isPrintable = decoded.isPrintable;
    }
    const copyMessage = () => {
      navigator.clipboard
        .writeText(messageText)
        .then(() => {
          setMessageCopied(true);
          setTimeout(() => setMessageCopied(false), 1500);
        })
        .catch(err => console.warn('Failed to copy message:', err));
    };
    return (
      <Flex direction="column" mb={4}>
        <Box mb={2}>
          <Flex align="center" justify="space-between" mb={2}>
            <Badge>Message:</Badge>
            <Tooltip label={messageCopied ? 'Copied' : 'Copy message'} fontSize="xs">
              <IconButton
                aria-label="Copy message"
                size="xs"
                variant="ghost"
                icon={messageCopied ? <CheckIcon color="green.300" /> : <CopyIcon />}
                onClick={copyMessage}
              />
            </Tooltip>
          </Flex>
          <Box
            p={3}
            borderWidth={1}
            borderRadius="md"
            borderColor="whiteAlpha.300"
            bg="whiteAlpha.50"
            maxHeight="360px"
            overflowY="auto"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            fontFamily={isPrintable ? 'inherit' : 'mono'}
            fontSize="sm">
            {messageText}
          </Box>
          {!isPrintable && (
            <Box mt={2} fontSize="xs" color="orange.300">
              Bytes are not printable UTF-8 — shown as hex dump.
            </Box>
          )}
        </Box>
      </Flex>
    );
  }

  // Contract-call rendering diverges — "To" should show the contract
  // and the user should see the raw function selector rather than an
  // amount field that can't be meaningfully formatted without knowing
  // the target contract's ABI. We only reach this branch for Tron dApp
  // sign events today (kind='contract-call'); native TRX + TRC-20
  // transfer() flows still go through the normal path below.
  if (kind === 'contract-call') {
    const callValue = payment?.amount;
    const hasCallValue = callValue != null && String(callValue) !== '0';
    return (
      <div>
        <Flex direction="column" mb={4}>
          {ctxIcon && (
            <Flex justify="center" mb={4}>
              <Avatar size="md" src={ctxIcon} alt="Asset Icon" />
            </Flex>
          )}
          <Box mb={2}>
            <Table variant="simple" size="sm">
              <Tbody>
                <Tr>
                  <Td>
                    <Badge>Contract:</Badge>
                  </Td>
                  <Td wordBreak="break-all">{unsignedTx?.contractAddress || 'N/A'}</Td>
                </Tr>
                <Tr>
                  <Td>
                    <Badge>Function:</Badge>
                  </Td>
                  <Td>{unsignedTx?.functionSelector ? `0x${unsignedTx.functionSelector}` : 'N/A'}</Td>
                </Tr>
                {/* call_value — TRX attached to the invocation. Usually
                    0 for TRC-20, non-zero for swaps spending native. */}
                {hasCallValue && (
                  <Tr>
                    <Td>
                      <Badge>TRX sent:</Badge>
                    </Td>
                    <Td>
                      {formatAmount(callValue, decimals)} {symbol || 'TRX'}
                    </Td>
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

  return (
    <div>
      <Flex direction="column" mb={4}>
        {/* Display the Avatar for the asset — only when ctxCaip matches,
            otherwise we risk showing a wildly-off icon for dApp events. */}
        {ctxIcon && (
          <Flex justify="center" mb={4}>
            <Avatar size="md" src={ctxIcon} alt="Asset Icon" />
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
