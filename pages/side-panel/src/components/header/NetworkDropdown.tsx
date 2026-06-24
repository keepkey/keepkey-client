import React, { useState, useMemo, useRef } from 'react';
import { Flex, Text, Box, Icon, IconButton, Badge, useOutsideClick } from '@chakra-ui/react';
import { AssetIcon } from '../AssetIcon';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronLeftIcon,
  AddIcon,
  SmallCloseIcon,
  ExternalLinkIcon,
} from '@chakra-ui/icons';
import { NetworkIdToChain } from '@extension/shared';
import type { ChainFamily, NetworkItem } from './headerTypes';
import { CHAIN_FAMILY_LABELS } from './headerConstants';
import { getChainFamily } from './headerUtils';

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
  const [activeFamily, setActiveFamily] = useState<ChainFamily | null>(null);
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

  const groupedNetworks = useMemo(() => {
    const groups: Partial<Record<ChainFamily, NetworkItem[]>> = {};
    for (const net of networks) {
      if (!groups[net.family]) groups[net.family] = [];
      groups[net.family]!.push(net);
    }
    return groups;
  }, [networks]);

  const filteredNetworks = useMemo(() => {
    if (!activeFamily) return null;
    return networks.filter(n => n.family === activeFamily);
  }, [networks, activeFamily]);

  const handleSelect = (net: NetworkItem) => {
    onSelect(net);
    setIsExpanded(false);
    setActiveFamily(getChainFamily(net.networkId));
  };

  const renderNetworkRow = (net: NetworkItem) => (
    <Flex
      key={net.networkId}
      alignItems="center"
      px={3}
      py={2}
      cursor="pointer"
      bg={selectedNetworkId === net.networkId ? 'kk.surfaceHi' : 'transparent'}
      _hover={{ bg: 'kk.surfaceHi' }}
      transition="background 0.1s"
      onClick={() => handleSelect(net)}
      borderBottom="1px solid"
      borderColor="kk.line">
      <AssetIcon src={net.icon} symbol={net.name} size={24} style={{ marginRight: 8 }} />
      <Flex alignItems="center" gap={1} flex={1} minW={0}>
        <Text fontSize="xs" color="kk.text" isTruncated>
          {net.name}
        </Text>
        {net.isCustom && (
          <Badge fontSize="0.5rem" bg="kk.surfaceHi" color="kk.dim" variant="subtle" px={1}>
            Custom
          </Badge>
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
          ml={1}
        />
      )}
    </Flex>
  );

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

      {/* Dropdown panel — conditionally rendered (no Collapse wrapper: an
          absolutely-positioned child reports zero height to Collapse, which
          then clamps overflow and breaks the panel's own scroll). */}
      {isExpanded && (
        <Box
          position="absolute"
          top="100%"
          left={0}
          right={0}
          mt={1}
          zIndex={10}
          borderRadius="md"
          border="1px solid"
          borderColor="kk.lineHi"
          bg="kk.surface"
          maxH="calc(100vh - 84px)"
          minW="200px"
          overflowY="auto"
          overscrollBehavior="contain"
          sx={{
            '&::-webkit-scrollbar': { width: '4px' },
            '&::-webkit-scrollbar-thumb': { bg: 'whiteAlpha.300', borderRadius: '2px' },
          }}>
          {activeFamily && filteredNetworks ? (
            <>
              <Flex
                alignItems="center"
                px={3}
                py={2}
                cursor="pointer"
                _hover={{ bg: 'kk.surfaceHi' }}
                onClick={() => setActiveFamily(null)}
                borderBottom="1px solid"
                borderColor="kk.line">
                <Icon as={ChevronLeftIcon} boxSize={4} color="kk.dim" mr={1} />
                <Text fontSize="xs" color="kk.dim" fontWeight="medium">
                  All Networks
                </Text>
              </Flex>
              {filteredNetworks.map(renderNetworkRow)}
            </>
          ) : (
            (['evm', 'utxo', 'cosmos', 'other'] as ChainFamily[]).map(family => {
              const nets = groupedNetworks[family];
              if (!nets || nets.length === 0) return null;
              return (
                <Box key={family}>
                  <Text
                    fontSize="xs"
                    fontWeight="bold"
                    color="kk.dim"
                    px={3}
                    pt={2}
                    pb={1}
                    textTransform="uppercase"
                    letterSpacing="wider"
                    cursor="pointer"
                    _hover={{ color: 'kk.dim' }}
                    onClick={() => setActiveFamily(family)}>
                    {CHAIN_FAMILY_LABELS[family]}
                  </Text>
                  {nets.slice(0, 3).map(renderNetworkRow)}
                  {nets.length > 3 && (
                    <Text
                      fontSize="xs"
                      color="kk.accent"
                      px={3}
                      py={1}
                      cursor="pointer"
                      _hover={{ color: 'kk.accent' }}
                      onClick={() => setActiveFamily(family)}>
                      +{nets.length - 3} more
                    </Text>
                  )}
                </Box>
              );
            })
          )}

          {networks.length === 0 && (
            <Text fontSize="xs" color="kk.faint" p={3} textAlign="center">
              No networks available
            </Text>
          )}

          {/* Browse Chainlist.org */}
          <Flex
            alignItems="center"
            justifyContent="center"
            px={3}
            py={2}
            cursor="pointer"
            _hover={{ bg: 'kk.surfaceHi' }}
            onClick={e => {
              e.stopPropagation();
              window.open('https://chainlist.org/', '_blank');
              setIsExpanded(false);
            }}
            borderTop="1px solid"
            borderColor="kk.line">
            <Icon as={ExternalLinkIcon} boxSize={3} color="kk.accent" mr={2} />
            <Text fontSize="xs" color="kk.accent" fontWeight="medium">
              Browse Chainlist.org
            </Text>
          </Flex>

          {/* Add Custom Network */}
          <Flex
            alignItems="center"
            justifyContent="center"
            px={3}
            py={1.5}
            cursor="pointer"
            _hover={{ bg: 'kk.surfaceHi' }}
            onClick={e => {
              e.stopPropagation();
              onAddNetwork();
              setIsExpanded(false);
            }}>
            <Icon as={AddIcon} boxSize={3} color="kk.dim" mr={2} />
            <Text fontSize="xs" color="kk.dim" fontWeight="medium">
              Add Custom Network
            </Text>
          </Flex>
        </Box>
      )}
    </Box>
  );
};

export default NetworkDropdown;
