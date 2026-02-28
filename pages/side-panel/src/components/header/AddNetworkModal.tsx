import React, { useState } from 'react';
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  FormControl,
  FormLabel,
  Input,
  Button,
  useToast,
} from '@chakra-ui/react';
import type { CustomEvmNetwork } from './headerTypes';

interface AddNetworkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (network: CustomEvmNetwork) => void;
}

const AddNetworkModal: React.FC<AddNetworkModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [form, setForm] = useState({ chainId: '', name: '', rpc: '', symbol: '', explorerUrl: '' });
  const toast = useToast();

  const handleSubmit = () => {
    const chainId = parseInt(form.chainId, 10);
    if (!chainId || !form.name || !form.rpc || !form.symbol) {
      toast({ title: 'Fill all required fields', status: 'warning', duration: 2000 });
      return;
    }
    onSubmit({
      networkId: `eip155:${chainId}`,
      chainId,
      name: form.name,
      rpc: form.rpc,
      symbol: form.symbol.toUpperCase(),
      explorerUrl: form.explorerUrl || undefined,
    });
    setForm({ chainId: '', name: '', rpc: '', symbol: '', explorerUrl: '' });
    onClose();
  };

  const inputProps = {
    size: 'sm' as const,
    bg: 'whiteAlpha.100',
    border: '1px solid',
    borderColor: 'whiteAlpha.200',
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <ModalOverlay />
      <ModalContent bg="gray.800" color="white">
        <ModalHeader fontSize="md">Add Custom EVM Network</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <FormControl mb={3}>
            <FormLabel fontSize="xs" color="whiteAlpha.600">
              Chain ID *
            </FormLabel>
            <Input
              {...inputProps}
              placeholder="e.g. 42220"
              value={form.chainId}
              onChange={e => setForm(prev => ({ ...prev, chainId: e.target.value }))}
            />
          </FormControl>
          <FormControl mb={3}>
            <FormLabel fontSize="xs" color="whiteAlpha.600">
              Network Name *
            </FormLabel>
            <Input
              {...inputProps}
              placeholder="e.g. Celo"
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            />
          </FormControl>
          <FormControl mb={3}>
            <FormLabel fontSize="xs" color="whiteAlpha.600">
              RPC URL *
            </FormLabel>
            <Input
              {...inputProps}
              placeholder="https://forno.celo.org"
              value={form.rpc}
              onChange={e => setForm(prev => ({ ...prev, rpc: e.target.value }))}
            />
          </FormControl>
          <FormControl mb={3}>
            <FormLabel fontSize="xs" color="whiteAlpha.600">
              Currency Symbol *
            </FormLabel>
            <Input
              {...inputProps}
              placeholder="e.g. CELO"
              value={form.symbol}
              onChange={e => setForm(prev => ({ ...prev, symbol: e.target.value }))}
            />
          </FormControl>
          <FormControl mb={3}>
            <FormLabel fontSize="xs" color="whiteAlpha.600">
              Block Explorer URL (optional)
            </FormLabel>
            <Input
              {...inputProps}
              placeholder="https://explorer.celo.org"
              value={form.explorerUrl}
              onChange={e => setForm(prev => ({ ...prev, explorerUrl: e.target.value }))}
            />
          </FormControl>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="ghost" mr={2} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" colorScheme="blue" onClick={handleSubmit}>
            Add Network
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default AddNetworkModal;
