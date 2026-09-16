import React, { useState, useMemo, useRef } from 'react';
import { Flex, Text, Box, Icon, IconButton, Button, Input, useOutsideClick } from '@chakra-ui/react';
import { AssetIcon } from '../AssetIcon';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  AddIcon,
  SmallCloseIcon,
  ExternalLinkIcon,
  CheckIcon,
  SearchIcon,
} from '@chakra-ui/icons';
import { NetworkIdToChain } from '@extension/shared';
import type { ChainFamily, NetworkItem } from './headerTypes';
import { CHAIN_FAMILY_LABELS } from './headerConstants';
import BottomSheet from '../v2/BottomSheet';

interface NetworkDropdownProps {
  networks: NetworkItem[];
  selectedNetworkId: string | null;
  onSelect: (network: NetworkItem) => void;
  onAddNetwork: () => void;
  onRemoveNetwork: (networkId: string) => void;
}

const NetworkDropdown: React.FC<NetworkDropdownProps> = ({
  networks,
  selectedNetworkId,
  onSelect,
  onAddNetwork,
  onRemoveNetwork,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when the user clicks anywhere outside the trigger + panel.
  useOutsideClick({ ref: containerRef, handler: () => setIsExpanded(false) });

  const selected = useMemo(
    () => networks.find(n => n.networkId === selectedNetworkId) || null,
    [networks, selectedNetworkId],
  );

  // Trigger shows the compact chain symbol (BNB, ETH, MATIC…) instead of the
  // long network name ("BNB Smart Chain") so the crowded header doesn't
  // mid-word-truncate. The dropdown list below keeps full names for clarity.
  const triggerLabel = useMemo(() => {
    if (!selected) return 'Network';
    return (selected.networkId && NetworkIdToChain[selected.networkId]) || selected.name;
  }, [selected]);

  const visibleNetworks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return networks;
    return networks.filter(n => n.name?.toLowerCase().includes(q) || n.networkId?.toLowerCase().includes(q));
  }, [networks, query]);

  const handleSelect = (net: NetworkItem) => {
    onSelect(net);
    setIsExpanded(false);
    setQuery('');
  };

  const renderNetworkRow = (net: NetworkItem) => {
    const isSelected = selectedNetworkId === net.networkId;
    return (
      <Flex
        key={net.networkId}
        alignItems="center"
        gap={3}
        width="100%"
        px={2}
        py={3}
        borderRadius="10px"
        cursor="pointer"
        _hover={{ bg: 'kk.surfaceHi' }}
        transition="background 0.1s"
        onClick={() => handleSelect(net)}>
        <AssetIcon src={net.icon} symbol={net.name} size={28} />
        <Flex alignItems="center" gap={2} flex={1} minW={0}>
          <Text fontSize="14px" fontWeight={500} color={isSelected ? 'kk.accent' : 'kk.text'} isTruncated>
            {net.name}
          </Text>
          {net.isCustom && (
            <Text className="kk-eyebrow" fontSize="9px">
              Custom
            </Text>
          )}
        </Flex>
        {net.isCustom && (
          <IconButton
            icon={<SmallCloseIcon />}
            aria-label="Remove network"
            size="xs"
            variant="ghost"
            color="kk.bad"
            onClick={e => {
              e.stopPropagation();
              onRemoveNetwork(net.networkId);
            }}
          />
        )}
        {isSelected && <CheckIcon boxSize={3} color="kk.accent" />}
      </Flex>
    );
  };

  return (
    <Box position="relative" ref={containerRef}>
      {/* Trigger */}
      <Flex
        alignItems="center"
        cursor="pointer"
        onClick={() => setIsExpanded(prev => !prev)}
        px={2}
        h="32px"
        borderRadius="md"
        bg="kk.surface"
        _hover={{ bg: 'kk.surfaceHi' }}
        transition="background 0.15s"
        minW={0}>
        {selected && <AssetIcon src={selected.icon} symbol={selected.name} size={16} style={{ marginRight: 6 }} />}
        <Text fontSize="xs" fontWeight="semibold" color="kk.text" isTruncated maxW="72px">
          {triggerLabel}
        </Text>
        <Icon as={isExpanded ? ChevronUpIcon : ChevronDownIcon} boxSize={3} ml={1} color="kk.dim" />
      </Flex>

      {/* Switcher is a bottom sheet, not a popover (KEEPKEY_STYLE.md §0).
          Anchored to a pill near the panel's right edge, the popover clipped
          off-screen. Full width also retires the "+N more" drill-down: that
          existed only because the popover had no room, and it cost two taps
          to reach a chain. One scrollable list with a search field instead. */}
      <BottomSheet isOpen={isExpanded} title="Switch chain" onClose={() => setIsExpanded(false)}>
        <Flex alignItems="center" gap={2} h="40px" px={2} mb={1} borderBottom="1px solid" borderColor="kk.lineHi">
          <SearchIcon boxSize={3} color="kk.faint" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search chains"
            variant="unstyled"
            fontSize="14px"
            color="kk.text"
          />
        </Flex>

        {(['evm', 'utxo', 'cosmos', 'other'] as ChainFamily[]).map(family => {
          const nets = visibleNetworks.filter(n => n.family === family);
          if (nets.length === 0) return null;
          return (
            <Box key={family} mt={2}>
              <Text className="kk-eyebrow" px={2} pb={1}>
                {CHAIN_FAMILY_LABELS[family]}
              </Text>
              {nets.map(renderNetworkRow)}
            </Box>
          );
        })}

        {visibleNetworks.length === 0 && (
          <Text fontSize="13px" color="kk.faint" p={4} textAlign="center">
            {networks.length === 0 ? 'No networks available' : `No chains match “${query}”`}
          </Text>
        )}

        <Flex direction="column" mt={3} pt={2} borderTop="1px solid" borderColor="kk.line">
          <Button
            variant="ghost"
            justifyContent="flex-start"
            height="44px"
            px={2}
            fontSize="13px"
            color="kk.dim"
            leftIcon={<AddIcon boxSize={2.5} />}
            onClick={() => {
              onAddNetwork();
              setIsExpanded(false);
            }}>
            Add custom network
          </Button>
          <Button
            variant="ghost"
            justifyContent="flex-start"
            height="44px"
            px={2}
            fontSize="13px"
            color="kk.dim"
            leftIcon={<ExternalLinkIcon boxSize={3} />}
            onClick={() => {
              window.open('https://chainlist.org/', '_blank');
              setIsExpanded(false);
            }}>
            Browse Chainlist.org
          </Button>
        </Flex>
      </BottomSheet>
    </Box>
  );
};

export default NetworkDropdown;
