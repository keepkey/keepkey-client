import React, { useState, useRef } from 'react';
import { Flex, Text, Box, Icon, IconButton, Button, useToast, useOutsideClick } from '@chakra-ui/react';
import { ChevronDownIcon, ChevronUpIcon, CopyIcon, CheckIcon, AddIcon, SmallCloseIcon } from '@chakra-ui/icons';
import type { AccountItem } from './headerTypes';
import { formatAddress } from './headerUtils';
import BottomSheet from '../v2/BottomSheet';

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

      {/* Switcher is a bottom sheet, not a popover (KEEPKEY_STYLE.md §0).
          A 400px panel has nowhere to put an anchored popover: right-aligned
          it clipped off the panel edge. The sheet gets the full width. */}
      <BottomSheet isOpen={isExpanded} title="Accounts" onClose={() => setIsExpanded(false)}>
        {accounts.map(account => {
          const isSelected = selectedAccountKey === account.key;
          return (
            <Flex
              key={account.key}
              alignItems="center"
              gap={3}
              width="100%"
              px={2}
              py={3}
              borderRadius="10px"
              cursor="pointer"
              _hover={{ bg: 'kk.surfaceHi' }}
              transition="background 0.1s"
              onClick={() => handleSelect(account)}>
              <Flex
                flex="none"
                w="28px"
                h="28px"
                borderRadius="50%"
                border="1px solid"
                borderColor="kk.lineHi"
                alignItems="center"
                justifyContent="center"
                className="mono"
                fontSize="12px"
                color="kk.accent">
                {account.accountIndex ?? 0}
              </Flex>
              <Box flex={1} minW={0}>
                <Flex alignItems="center" gap={2}>
                  <Text fontSize="14px" fontWeight={500} color={isSelected ? 'kk.accent' : 'kk.text'} isTruncated>
                    {account.label}
                  </Text>
                  {account.isDefault && (
                    <Text className="kk-eyebrow" fontSize="9px">
                      Default
                    </Text>
                  )}
                </Flex>
                <Text fontSize="11px" fontFamily="mono" color="kk.faint" mt="2px" isTruncated>
                  {account.path || formatAddress(account.address)}
                </Text>
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
                  onClick={e => {
                    e.stopPropagation();
                    onRemoveAccount(account.accountIndex!);
                  }}
                />
              )}
              <IconButton
                icon={copiedKey === account.key ? <CheckIcon /> : <CopyIcon />}
                aria-label="Copy address"
                size="xs"
                variant="ghost"
                color={copiedKey === account.key ? 'kk.good' : undefined}
                onClick={e => {
                  e.stopPropagation();
                  handleCopy(account.address, account.key);
                }}
              />
              {isSelected && <CheckIcon boxSize={3} color="kk.accent" />}
            </Flex>
          );
        })}

        {canAddAccount && onAddAccount && (
          <Button
            variant="ghost"
            width="100%"
            justifyContent="flex-start"
            height="52px"
            px={2}
            color="kk.dim"
            fontSize="13px"
            leftIcon={<AddIcon boxSize={2.5} />}
            isLoading={isAddingAccount}
            onClick={onAddAccount}>
            Add account
          </Button>
        )}
      </BottomSheet>
    </Box>
  );
};

export default AccountDropdown;
