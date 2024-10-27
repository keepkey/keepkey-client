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
  useToast,
} from '@chakra-ui/react';

interface AddDappModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddDappModal({ isOpen, onClose }: AddDappModalProps) {
  const [url, setUrl] = useState('');
  const toast = useToast();

  const handleSave = () => {
    const urlPattern = new RegExp(
      '^(https?:\\/\\/)?' + // protocol
        '((([a-z\\d]([a-z\\d-]*[a-z\\d])*))+' + // domain name
        '(\\.[a-z]{2,})' + // dot-something
        '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
        '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
        '(\\#[-a-z\\d_]*)?$',
      'i',
    );
    if (!urlPattern.test(url)) {
      toast({ title: 'Invalid URL format', status: 'error', duration: 3000 });
      return;
    }
    // Mock saving to localStorage with a chainId
    const chainId = 'mockedChainId';
    const dapps = JSON.parse(localStorage.getItem('dapps') || '[]');
    dapps.push({ url, chainId });
    localStorage.setItem('dapps', JSON.stringify(dapps));

    toast({ title: 'Dapp added successfully', status: 'success', duration: 3000 });
    setUrl('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Add a Dapp</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Input placeholder="Enter dApp URL" value={url} onChange={e => setUrl(e.target.value)} type="url" />
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
