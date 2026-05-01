import { Badge, Box, Divider, Flex, HStack, Switch, Table, Tbody, Td, Text, Textarea, Tr } from '@chakra-ui/react';
import React, { useMemo, useState } from 'react';

/**
 * Approval-dialog view for EIP-191 `personal_sign` (and the legacy
 * `eth_sign`) requests.
 *
 * Why this exists: dApps pass messages to the wallet as hex-encoded UTF-8
 * text per the JSON-RPC spec. The KeepKey firmware displays the hash as
 * "Sign Bytes" on-device whenever the payload contains any non-printable
 * byte — `\n` (0x0A), `\r`, `\t`. Real SIWE (EIP-4361) login challenges
 * (OpenSea, Uniswap, Blur, etc.) are always multi-line, so the device
 * physically cannot render them as text. The user's only surface for
 * reading what they're signing is this approval popup — if we show raw
 * hex here too, informed consent is impossible.
 *
 * Mirror of the fix shipped in the KeepKey Vault at
 * `projects/keepkey-vault-v11/projects/keepkey-vault/src/mainview/components/device/SigningApproval.tsx`
 * (EthMessageSection). Same decode semantics: try UTF-8 with the fatal
 * decoder, fall back to raw-hex display on failure, keep the raw hex
 * always-available behind a toggle so power users can hash-verify.
 */
export default function PersonalSignTx({ transaction }: any) {
  const method: string = transaction?.type || '';
  const params: any[] = transaction?.request || transaction?.requestInfo?.params || [];

  // JSON-RPC ordering differs between the two historical methods:
  //   personal_sign → params = [message, address]
  //   eth_sign      → params = [address, message]
  // If the dApp got it wrong (both params happen to be strings), we still
  // pick the one that starts with `0x{even-number-of-hex-chars}` or, if
  // neither does, fall back to the conventional slot.
  const [rawMessage, signer] = useMemo(() => {
    if (method === 'eth_sign') return [String(params?.[1] ?? ''), String(params?.[0] ?? '')];
    return [String(params?.[0] ?? ''), String(params?.[1] ?? '')];
  }, [method, params]);

  const decoded = useMemo(() => decodeEip191Message(rawMessage), [rawMessage]);
  const [showHex, setShowHex] = useState(!decoded.isUtf8Text);

  return (
    <Flex direction="column" mb={4}>
      <Box mb={2}>
        <Table variant="simple" size="sm">
          <Tbody>
            <Tr>
              <Td>
                <Badge>Method:</Badge>
              </Td>
              <Td>{method}</Td>
            </Tr>
            <Tr>
              <Td>
                <Badge>Signer:</Badge>
              </Td>
              <Td wordBreak="break-all" fontSize="sm">
                {signer || 'Unknown'}
              </Td>
            </Tr>
            <Tr>
              <Td verticalAlign="top">
                <Badge>Message:</Badge>
              </Td>
              <Td>
                {decoded.isUtf8Text ? (
                  <Box bg="rgba(0,0,0,0.25)" borderRadius="md" p={2} maxH="280px" overflowY="auto">
                    <Text fontSize="sm" whiteSpace="pre-wrap" wordBreak="break-word">
                      {decoded.text}
                    </Text>
                  </Box>
                ) : (
                  <Text fontSize="xs" color="orange.300">
                    Message is not valid UTF-8 — verify the raw hex below before approving.
                  </Text>
                )}
              </Td>
            </Tr>
          </Tbody>
        </Table>

        <HStack mt={3}>
          <Text fontSize="sm">Show raw hex</Text>
          <Switch onChange={() => setShowHex(s => !s)} isChecked={showHex} />
        </HStack>

        {showHex && (
          <Textarea
            mt={2}
            value={rawMessage || '(empty)'}
            isReadOnly
            size="sm"
            resize="vertical"
            minHeight="100px"
            maxHeight="200px"
            cursor="default"
            wordBreak="break-all"
            whiteSpace="pre-wrap"
            _focus={{ boxShadow: 'none' }}
            fontFamily="mono"
          />
        )}
      </Box>
      <Divider my={2} />
    </Flex>
  );
}

/**
 * Convert an EIP-191 wire message to the two forms the UI needs:
 *   - `text`: UTF-8 string (when the bytes decode cleanly)
 *   - `isUtf8Text`: whether `text` was produced by a successful decode
 *
 * Uses `TextDecoder` with `{ fatal: true }` so any invalid sequence
 * bails to the hex-fallback path — we never silently render garbage
 * text that misrepresents what the user is signing.
 */
function decodeEip191Message(raw: string): { text?: string; isUtf8Text: boolean } {
  if (!raw) return { isUtf8Text: false };
  const m = /^0x([0-9a-fA-F]*)$/.exec(raw);
  if (m) {
    const hex = m[1];
    if (hex.length === 0) return { isUtf8Text: false };
    if (hex.length % 2 !== 0) return { isUtf8Text: false };
    try {
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return { text, isUtf8Text: true };
    } catch {
      return { isUtf8Text: false };
    }
  }
  // Already plaintext (non-spec clients occasionally send UTF-8 directly).
  return { text: raw, isUtf8Text: true };
}
