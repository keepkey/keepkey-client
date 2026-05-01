// AddDappModal.tsx
import React, { useState } from 'react';
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Input,
  Button,
  Text,
  Avatar,
  Flex,
  useToast,
} from '@chakra-ui/react';
import { dappStorage } from '@extension/storage';
import { caipToIcon } from '@extension/shared';

interface AddDappModalProps {
  isOpen: boolean;
  onClose: () => void;
  networkId: string;
  onSave: () => void;
}

export function AddDappModal({ networkId, isOpen, onClose, onSave }: AddDappModalProps) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const toast = useToast();
  const defaultIcon = caipToIcon('eip155:1/slip44:60');

  const handleSave = async () => {
    if (!url || !name) {
      toast({ title: 'Name and URL are required', status: 'error', duration: 3000 });
      return;
    }

    try {
      // Create new dApp with default icon
      const newDapp = { name, icon: defaultIcon, url, networks: [networkId] };
      await dappStorage.addDapp(newDapp);

      // Notify parent component and reset form
      onSave();
      setUrl('');
      setName('');
      setDescription('');
      onClose();
      toast({ title: 'Dapp added successfully', status: 'success', duration: 3000 });
    } catch (error) {
      toast({ title: 'Failed to add dApp', status: 'error', duration: 3000 });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <Flex align="center">
            <Avatar src="/kk-logo.png" name="KeepKey" size="sm" mr={2} />
            <Text>Discovery</Text>
          </Flex>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Input placeholder="Enter dApp Name" value={name} onChange={e => setName(e.target.value)} mb={3} />
          <Input placeholder="Enter dApp URL" value={url} onChange={e => setUrl(e.target.value)} type="url" mb={3} />
          <Input
            placeholder="Sample description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            mb={3}
          />
        </ModalBody>
        <ModalFooter>
          <Button colorScheme="blue" mr={3} onClick={handleSave}>
            Save
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
