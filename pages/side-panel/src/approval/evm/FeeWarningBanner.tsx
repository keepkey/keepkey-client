import { Box, Button, Flex, HStack, Input, Stack, Text, useToast } from '@chakra-ui/react';
import React, { useState } from 'react';
import { requestStorage } from '@extension/storage';

/** Mirrors FeeWarning from chrome-extension/src/background/chains/feeFloors.ts */
type FeeWarning = {
  dappMaxFeePerGas: string;
  dappMaxPriorityFeePerGas: string;
  suggestedMaxFeePerGas: string;
  suggestedMaxPriorityFeePerGas: string;
  floorWei: string;
  /** Optional — present on builds with tip-aware warning. */
  priorityFloorWei?: string;
  /** Optional — present on builds with tip-aware warning. */
  effectiveTipWei?: string;
  /** Optional — present on builds with tip-aware warning. */
  trigger?: 'maxFee' | 'tip' | 'both';
  baseFeeWei: string | null;
  reason: string;
  chainId: string;
};

type FeeChoice =
  | { source: 'dapp' | 'suggested' }
  | { source: 'custom'; customMaxFeePerGas: string; customMaxPriorityFeePerGas: string };

const hexToGwei = (h: string | null | undefined): string => {
  if (!h) return '—';
  try {
    const wei = BigInt(h);
    // Render with up to 4 decimals of gwei precision for legibility.
    const gweiTimes1e4 = Number((wei * 10000n) / 1_000_000_000n) / 10000;
    return gweiTimes1e4.toString();
  } catch {
    return h;
  }
};

const gweiToHex = (g: string): string => {
  const n = parseFloat(g);
  if (!isFinite(n) || n < 0) throw new Error('invalid gwei');
  // gwei → wei via integer math to avoid float drift on small values
  const wei = BigInt(Math.round(n * 1e9));
  return '0x' + wei.toString(16);
};

interface Props {
  eventId: string;
  warning: FeeWarning;
  /** Selection state — parent EvmTransaction reads this to decide whether to enable Approve. */
  choice: FeeChoice | null;
  onChoiceChange: (c: FeeChoice | null) => void;
}

export default function FeeWarningBanner({ eventId, warning, choice, onChoiceChange }: Props) {
  const toast = useToast();
  const [customMode, setCustomMode] = useState(false);
  const [customMax, setCustomMax] = useState(hexToGwei(warning.suggestedMaxFeePerGas));
  const [customPriority, setCustomPriority] = useState(hexToGwei(warning.suggestedMaxPriorityFeePerGas));

  const persist = async (next: FeeChoice) => {
    try {
      // @ts-expect-error storage event shape is typed loosely
      await requestStorage.updateEventById(eventId, { feeChoice: next });
      onChoiceChange(next);
    } catch (e: any) {
      toast({ status: 'error', title: 'Could not save fee choice', description: String(e?.message || e) });
    }
  };

  const pickDapp = () => persist({ source: 'dapp' });
  const pickSuggested = () => persist({ source: 'suggested' });

  const applyCustom = () => {
    let maxHex: string, prioHex: string;
    try {
      maxHex = gweiToHex(customMax);
      prioHex = gweiToHex(customPriority);
    } catch {
      toast({ status: 'error', title: 'Custom fees must be positive numbers' });
      return;
    }
    persist({ source: 'custom', customMaxFeePerGas: maxHex, customMaxPriorityFeePerGas: prioHex });
  };

  const isPicked = (s: FeeChoice['source']) => choice?.source === s;

  return (
    <Box
      borderWidth="1px"
      borderColor="orange.400"
      borderRadius="md"
      bg="rgba(245, 158, 11, 0.08)"
      px={3}
      py={3}
      mb={3}>
      <Stack spacing={2}>
        <HStack>
          <Text fontWeight="bold" color="orange.300">
            {warning.trigger === 'tip'
              ? '⚠ Low miner tip — tx may be dropped'
              : warning.trigger === 'both'
                ? '⚠ Both maxFee and tip too low'
                : '⚠ Low fee — tx may sit pending'}
          </Text>
        </HStack>
        <Text fontSize="sm" color="rgba(255,255,255,0.85)">
          {warning.reason}
        </Text>

        <Flex gap={2} flexWrap="wrap">
          <Button
            size="sm"
            colorScheme={isPicked('dapp') ? 'orange' : 'gray'}
            variant={isPicked('dapp') ? 'solid' : 'outline'}
            onClick={pickDapp}>
            Keep dApp's ({hexToGwei(warning.dappMaxFeePerGas)} gwei)
          </Button>
          <Button
            size="sm"
            colorScheme={isPicked('suggested') ? 'green' : 'gray'}
            variant={isPicked('suggested') ? 'solid' : 'outline'}
            onClick={pickSuggested}>
            Use suggested ({hexToGwei(warning.suggestedMaxFeePerGas)} gwei)
          </Button>
          <Button
            size="sm"
            colorScheme={isPicked('custom') ? 'blue' : 'gray'}
            variant={customMode || isPicked('custom') ? 'solid' : 'outline'}
            onClick={() => setCustomMode(v => !v)}>
            Custom…
          </Button>
        </Flex>

        {customMode && (
          <Stack spacing={2} mt={2} p={2} borderWidth="1px" borderColor="rgba(255,255,255,0.15)" borderRadius="md">
            <HStack>
              <Text fontSize="xs" w="140px" color="rgba(255,255,255,0.7)">
                Max fee (gwei)
              </Text>
              <Input size="sm" value={customMax} onChange={e => setCustomMax(e.target.value)} placeholder="e.g. 1.5" />
            </HStack>
            <HStack>
              <Text fontSize="xs" w="140px" color="rgba(255,255,255,0.7)">
                Priority (gwei)
              </Text>
              <Input
                size="sm"
                value={customPriority}
                onChange={e => setCustomPriority(e.target.value)}
                placeholder="e.g. 0.5"
              />
            </HStack>
            <Button size="sm" colorScheme="blue" onClick={applyCustom} alignSelf="flex-end">
              Apply custom
            </Button>
          </Stack>
        )}

        <Text fontSize="xs" color="rgba(255,255,255,0.55)">
          Base fee: {hexToGwei(warning.baseFeeWei)} gwei · maxFee floor: {hexToGwei(warning.floorWei)} gwei
          {warning.priorityFloorWei !== undefined && (
            <>
              {' · tip floor: '}
              {hexToGwei(warning.priorityFloorWei)} gwei
            </>
          )}
          {warning.effectiveTipWei !== undefined && (
            <>
              {' · effective tip: '}
              {hexToGwei(warning.effectiveTipWei)} gwei
            </>
          )}
        </Text>
      </Stack>
    </Box>
  );
}
