import React from 'react';
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  Button,
  Box,
  Text,
  Badge,
} from '@chakra-ui/react';

interface Pubkey {
  note: string;
  url: string;
  type: string;
  pubkey: string;
  address?: string;
  networks: string[];
}

interface TransactionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  pubkeys: Pubkey[];
  asset: any;
  openUrl: (pubkey: Pubkey) => void;
}

// Utility function to truncate the public key with a middle ellipsis
const truncateMiddle = (key: string, start = 6, end = 6) => {
  if (key.length <= start + end) return key;
  return `${key.slice(0, start)}...${key.slice(-end)}`;
};

const TransactionHistoryModal: React.FC<TransactionHistoryModalProps> = ({
  isOpen,
  onClose,
  pubkeys,
  asset,
  openUrl,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Transaction History</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          {pubkeys.map((pubkey, index) => (
            <Button key={index} my={2} size="md" variant="outline" width="100%" onClick={() => openUrl(pubkey)}>
              <Box>
                <Text>View History</Text>
                <Badge colorScheme="teal">
                  <Text fontSize="sm">{truncateMiddle(pubkey.pubkey)}</Text>
                </Badge>
              </Box>
            </Button>
          ))}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default TransactionHistoryModal;
