import React, { useState } from 'react';
import { Flex, Text, Box, Icon, Collapse, IconButton, Badge, Button, useToast } from '@chakra-ui/react';
import { ChevronDownIcon, ChevronUpIcon, CopyIcon, CheckIcon, AddIcon, SmallCloseIcon } from '@chakra-ui/icons';
import type { AccountItem } from './headerTypes';
import { formatAddress } from './headerUtils';

interface AccountDropdownProps {
  accounts: AccountItem[];
  selectedAccountKey: string | null;
  onSelect: (account: AccountItem) => void;
  /** Only shown for Ethereum (eip155:1) */
  canAddAccount: boolean;
  onAddAccount?: () => void;
  isAddingAccount?: boolean;
  /** Show remove button for non-default ETH accounts */
  onRemoveAccount?: (accountIndex: number) => void;
}

const AccountDropdown: React.FC<AccountDropdownProps> = ({
  accounts,
  selectedAccountKey,
  onSelect,
  canAddAccount,
  onAddAccount,
  isAddingAccount,
  onRemoveAccount,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const toast = useToast();

  const selected = accounts.find(a => a.key === selectedAccountKey) || accounts[0] || null;

  const handleCopy = (address: string, key: string) => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopiedKey(key);
    toast({ title: 'Address copied!', status: 'success', duration: 1500 });
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSelect = (account: AccountItem) => {
    onSelect(account);
    setIsExpanded(false);
  };

  const hasMultiple = accounts.length > 1 || canAddAccount;

  return (
    <Box position="relative">
      {/* Trigger — always interactive */}
      <Flex
        alignItems="center"
        cursor={hasMultiple ? 'pointer' : 'default'}
        onClick={() => hasMultiple && setIsExpanded(prev => !prev)}
        px={2}
        py={1}
        borderRadius="md"
        bg="whiteAlpha.50"
        _hover={hasMultiple ? { bg: 'whiteAlpha.150' } : {}}
        transition="background 0.15s"
        minW={0}>
        <Box minW={0} flex={1}>
          {hasMultiple && (
            <Text fontSize="xs" color="whiteAlpha.800" isTruncated maxW="80px">
              {selected?.label || 'Account'}
            </Text>
          )}
          <Text
            fontSize="xs"
            fontFamily="mono"
            color="whiteAlpha.500"
            isTruncated
            maxW="100px"
            cursor="pointer"
            _hover={{ color: 'whiteAlpha.800' }}
            onClick={e => {
              e.stopPropagation();
              if (selected?.address) handleCopy(selected.address, selected.key);
            }}
            title={selected?.address || ''}>
            {selected ? formatAddress(selected.address) : ''}
          </Text>
        </Box>
        {!hasMultiple && selected?.address && (
          <IconButton
            icon={copiedKey === selected.key ? <CheckIcon /> : <CopyIcon />}
            aria-label="Copy address"
            size="xs"
            variant="ghost"
            colorScheme={copiedKey === selected.key ? 'green' : 'gray'}
            onClick={e => {
              e.stopPropagation();
              handleCopy(selected.address, selected.key);
            }}
            ml={1}
          />
        )}
        {hasMultiple && (
          <Icon as={isExpanded ? ChevronUpIcon : ChevronDownIcon} boxSize={3} ml={1} color="whiteAlpha.700" />
        )}
      </Flex>

      {/* Dropdown panel */}
      <Collapse in={isExpanded} animateOpacity>
        <Box
          position="absolute"
          top="100%"
          right={0}
          mt={1}
          zIndex={10}
          borderRadius="md"
          border="1px solid"
          borderColor="whiteAlpha.200"
          bg="gray.800"
          maxH="300px"
          minW="180px"
          overflowY="auto"
          sx={{
            '&::-webkit-scrollbar': { width: '4px' },
            '&::-webkit-scrollbar-thumb': { bg: 'whiteAlpha.300', borderRadius: '2px' },
          }}>
          {accounts.map(account => (
            <Flex
              key={account.key}
              alignItems="center"
              px={3}
              py={2}
              cursor="pointer"
              bg={selectedAccountKey === account.key ? 'whiteAlpha.150' : 'transparent'}
              _hover={{ bg: 'whiteAlpha.100' }}
              transition="background 0.1s"
              onClick={() => handleSelect(account)}
              borderBottom="1px solid"
              borderColor="whiteAlpha.50">
              <Box flex={1} minW={0}>
                <Flex alignItems="center" gap={1}>
                  <Text fontSize="xs" color="white" isTruncated>
                    {account.label}
                  </Text>
                  {account.isDefault && (
                    <Badge fontSize="0.5rem" colorScheme="green" variant="subtle" px={1}>
                      Default
                    </Badge>
                  )}
                </Flex>
                <Text fontSize="xs" fontFamily="mono" color="whiteAlpha.600" isTruncated>
                  {formatAddress(account.address)}
                </Text>
                {account.path && (
                  <Text fontSize="0.6rem" fontFamily="mono" color="whiteAlpha.400" isTruncated>
                    {account.path}
                  </Text>
                )}
              </Box>
              {/* Remove button for non-default ETH accounts */}
              {onRemoveAccount && account.accountIndex !== undefined && !account.isDefault && (
                <IconButton
                  icon={<SmallCloseIcon />}
                  aria-label={`Remove account ${account.accountIndex}`}
                  size="xs"
                  variant="ghost"
                  colorScheme="red"
                  onClick={e => {
                    e.stopPropagation();
                    onRemoveAccount(account.accountIndex!);
                  }}
                  ml={1}
                />
              )}
              <IconButton
                icon={copiedKey === account.key ? <CheckIcon /> : <CopyIcon />}
                aria-label="Copy address"
                size="xs"
                variant="ghost"
                colorScheme={copiedKey === account.key ? 'green' : 'gray'}
                onClick={e => {
                  e.stopPropagation();
                  handleCopy(account.address, account.key);
                }}
                ml={1}
              />
            </Flex>
          ))}

          {/* Add Account button (ETH only) */}
          {canAddAccount && onAddAccount && (
            <Flex
              alignItems="center"
              justifyContent="center"
              px={3}
              py={2}
              cursor="pointer"
              _hover={{ bg: 'whiteAlpha.100' }}
              borderTop="1px solid"
              borderColor="whiteAlpha.100">
              <Button
                size="xs"
                variant="ghost"
                colorScheme="blue"
                leftIcon={<AddIcon boxSize={2} />}
                fontSize="xs"
                isLoading={isAddingAccount}
                onClick={e => {
                  e.stopPropagation();
                  onAddAccount();
                }}>
                Add Account
              </Button>
            </Flex>
          )}
        </Box>
      </Collapse>
    </Box>
  );
};

export default AccountDropdown;
