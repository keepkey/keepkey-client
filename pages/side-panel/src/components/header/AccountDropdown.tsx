import React, { useState, useRef } from 'react';
import { Flex, Text, Box, Icon, IconButton, Badge, Button, useToast, useOutsideClick } from '@chakra-ui/react';
import { ChevronDownIcon, ChevronUpIcon, CopyIcon, CheckIcon, AddIcon, SmallCloseIcon } from '@chakra-ui/icons';
import type { AccountItem } from './headerTypes';
import { formatAddress } from './headerUtils';

interface AccountDropdownProps {
  accounts: AccountItem[];
  selectedAccountKey: string | null;
  onSelect: (account: AccountItem) => void;
  /** True for families that support add-account (EVM + non-Bitcoin UTXO, Cosmos, Solana) */
  canAddAccount: boolean;
  onAddAccount?: () => void;
  isAddingAccount?: boolean;
  /** Show remove button for non-default accounts (accountIndex > 0) */
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when the user clicks anywhere outside the trigger + panel.
  useOutsideClick({ ref: containerRef, handler: () => setIsExpanded(false) });

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
    <Box position="relative" ref={containerRef}>
      {/* Trigger — single-line to match NetworkDropdown height. Label when
          we have multiple accounts so the user can tell them apart; short
          address when we only have one (the label is redundant then). */}
      <Flex
        alignItems="center"
        cursor={hasMultiple ? 'pointer' : 'default'}
        onClick={() => hasMultiple && setIsExpanded(prev => !prev)}
        px={2}
        h="32px"
        borderRadius="md"
        bg="kk.surface"
        _hover={hasMultiple ? { bg: 'kk.surfaceHi' } : {}}
        transition="background 0.15s"
        minW={0}
        title={selected?.address || ''}>
        <Text
          fontSize="xs"
          fontWeight={hasMultiple ? 'semibold' : 500}
          color="kk.text"
          isTruncated
          maxW="100px"
          className={hasMultiple ? undefined : 'mono'}>
          {hasMultiple ? selected?.label || 'Account' : selected ? formatAddress(selected.address) : ''}
        </Text>
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
        {hasMultiple && <Icon as={isExpanded ? ChevronUpIcon : ChevronDownIcon} boxSize={3} ml={1} color="kk.dim" />}
      </Flex>

      {/* Dropdown panel — conditionally rendered (no Collapse wrapper: an
          absolutely-positioned child reports zero height to Collapse, which
          then clamps overflow and breaks the panel's own scroll). */}
      {isExpanded && (
        <Box
          position="absolute"
          top="100%"
          right={0}
          mt={1}
          zIndex={10}
          borderRadius="md"
          border="1px solid"
          borderColor="kk.lineHi"
          bg="kk.surface"
          maxH="calc(100vh - 84px)"
          minW="180px"
          overflowY="auto"
          overscrollBehavior="contain"
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
              bg={selectedAccountKey === account.key ? 'kk.surfaceHi' : 'transparent'}
              _hover={{ bg: 'kk.surfaceHi' }}
              transition="background 0.1s"
              onClick={() => handleSelect(account)}
              borderBottom="1px solid"
              borderColor="kk.line">
              <Box flex={1} minW={0}>
                <Flex alignItems="center" gap={1}>
                  <Text fontSize="xs" color="kk.text" isTruncated>
                    {account.label}
                  </Text>
                  {account.isDefault && (
                    <Badge fontSize="0.5rem" bg="kk.surfaceHi" color="kk.dim" variant="subtle" px={1}>
                      Default
                    </Badge>
                  )}
                </Flex>
                <Text fontSize="xs" fontFamily="mono" color="kk.dim" isTruncated>
                  {formatAddress(account.address)}
                </Text>
                {account.path && (
                  <Text fontSize="0.6rem" fontFamily="mono" color="kk.faint" isTruncated>
                    {account.path}
                  </Text>
                )}
              </Box>
              {/* Remove button for non-default accounts. Gate on accountIndex > 0
                  (not just !isDefault): a UTXO chain's account 0 has multiple
                  script-type rows, and only the first is flagged isDefault —
                  the others still carry accountIndex 0 and must stay
                  non-removable. */}
              {onRemoveAccount && account.accountIndex !== undefined && account.accountIndex > 0 && (
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
              _hover={{ bg: 'kk.surfaceHi' }}
              borderTop="1px solid"
              borderColor="kk.line">
              <Button
                size="xs"
                variant="ghost"
                color="kk.accent"
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
      )}
    </Box>
  );
};

export default AccountDropdown;
