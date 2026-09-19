// Bottom sheet (KEEPKEY_STYLE.md §0).
//
// v2 replaces the network/account popovers with sheets: they rise from the
// bottom edge, cap at 74% of the panel and carry a drag handle. In a 400px-wide
// side panel a popover anchored under the header has nowhere to go — a sheet
// gets the full width for rows and keeps the header readable behind it.
//
// Exit is two-phase (state → animate → unmount) so the close animation is
// actually seen; `onClose` fires after the sheet has travelled.
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Flex, IconButton, Text } from '@chakra-ui/react';
import { CloseIcon } from '@chakra-ui/icons';
import { tokens, motion } from '../../styles/tokens';

/** The sheet is positioned against the viewport, not a parent: in the side
 *  panel the window *is* the panel, and the triggers live inside a sticky
 *  header, so anchoring to the nearest positioned ancestor would trap the
 *  sheet inside that 56px strip. This is what made the old popovers clip off
 *  the panel edges. */
const EXIT_MS = 200;

interface BottomSheetProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export const BottomSheet = ({ isOpen, title, onClose, children }: BottomSheetProps) => {
  const [mounted, setMounted] = useState(isOpen);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    // Let the sheet animate out before it leaves the tree.
    setLeaving(true);
    const id = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, EXIT_MS);
    return () => window.clearTimeout(id);
  }, [isOpen, mounted]);

  const close = useCallback(() => onClose(), [onClose]);

  // Capture phase + stopPropagation: a sheet opened inside a Chakra Drawer
  // (Receive's asset picker) would otherwise let Escape reach the Drawer's own
  // handler and close the whole Drawer along with the sheet.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, close]);

  if (!mounted) return null;

  return (
    <>
      <Box
        onClick={close}
        position="fixed"
        inset={0}
        zIndex={1600}
        background="rgba(0,0,0,.55)"
        animation={leaving ? `kk-fade-out ${EXIT_MS}ms ease both` : `kk-fade-in ${motion.fast} ease both`}
      />
      <Flex
        role="dialog"
        aria-modal="true"
        aria-label={title}
        position="fixed"
        left={0}
        right={0}
        bottom={0}
        zIndex={1601}
        maxHeight="74vh"
        direction="column"
        background={tokens.surface}
        border={`1px solid ${tokens.lineHi}`}
        borderBottom={0}
        borderRadius="16px 16px 0 0"
        boxShadow="0 -24px 60px rgba(0,0,0,.5)"
        animation={
          leaving ? `kk-sheet-out ${EXIT_MS}ms ${motion.easeExit} both` : `kk-sheet-in 320ms ${motion.ease} both`
        }>
        <Box width="36px" height="4px" borderRadius="2px" background={tokens.line3} margin="10px auto 0" flex="none" />
        <Flex alignItems="center" justifyContent="space-between" padding="12px 18px 6px" flex="none">
          <Text fontSize="15px" fontWeight={500}>
            {title}
          </Text>
          <IconButton
            aria-label="Close"
            title="Close"
            onClick={close}
            variant="ghost"
            size="sm"
            borderRadius="8px"
            icon={<CloseIcon boxSize="10px" />}
          />
        </Flex>
        <Box overflow="auto" minHeight={0} padding="4px 10px 12px">
          {children}
        </Box>
      </Flex>
    </>
  );
};

export default BottomSheet;
