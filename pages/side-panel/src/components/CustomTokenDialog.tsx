import React, { useState, useEffect } from 'react';
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Button,
  Input,
  VStack,
  HStack,
  Box,
  Text,
  Image,
  Spinner,
  IconButton,
} from '@chakra-ui/react';
import { FaSearch, FaPlus, FaTimes, FaSpinner, FaCheckCircle, FaExclamationTriangle } from 'react-icons/fa';
import { type CustomToken } from '@extension/storage';

interface CustomTokenDialogProps {
  isOpen: boolean;
  onClose: () => void;
  networkId: string;
  userAddress: string;
  customTokens: CustomToken[];
  onAddToken: (token: Omit<CustomToken, 'addedAt'>) => Promise<{ success: boolean; message?: string }>;
  onRemoveToken: (tokenAddress: string) => Promise<boolean>;
  onValidateToken: (
    contractAddress: string,
  ) => Promise<{ valid: boolean; token?: Omit<CustomToken, 'addedAt'>; error?: string }>;
}

export const CustomTokenDialog = ({
  isOpen,
  onClose,
  networkId,
  userAddress,
  customTokens,
  onAddToken,
  onRemoveToken,
  onValidateToken,
}: CustomTokenDialogProps) => {
  const [contractAddress, setContractAddress] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    token?: Omit<CustomToken, 'addedAt'>;
    error?: string;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      setContractAddress('');
      setValidationResult(null);
      setSuccessMessage('');
      setErrorMessage('');
    }
  }, [isOpen]);

  // Check if address looks like a valid contract address
  const isValidAddress = (address: string): boolean => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  // Check if token is already added
  const isTokenAdded = (tokenAddress: string): boolean => {
    return customTokens.some(token => token.address.toLowerCase() === tokenAddress.toLowerCase());
  };

  // Auto-validate when a complete contract address is entered
  useEffect(() => {
    const trimmed = contractAddress.trim();
    if (isValidAddress(trimmed) && !isValidating && !validationResult) {
      // Debounce validation
      const timer = setTimeout(async () => {
        console.log('🔍 [CustomTokenDialog] Auto-validating contract:', trimmed);
        await handleValidate();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [contractAddress]);

  const handleValidate = async () => {
    const trimmed = contractAddress.trim();

    if (!trimmed) {
      setErrorMessage('Please enter a contract address');
      return;
    }

    if (!isValidAddress(trimmed)) {
      setErrorMessage('Invalid contract address format');
      return;
    }

    // Check if already added
    if (isTokenAdded(trimmed)) {
      setErrorMessage('This token is already added');
      return;
    }

    setIsValidating(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const result = await onValidateToken(trimmed);
      setValidationResult(result);

      if (!result.valid) {
        setErrorMessage(result.error || 'Failed to validate token');
      }
    } catch (error: any) {
      setErrorMessage(error.message || 'Failed to validate token');
      setValidationResult(null);
    } finally {
      setIsValidating(false);
    }
  };

  const handleAddToken = async () => {
    if (!validationResult?.valid || !validationResult.token) {
      return;
    }

    setIsProcessing(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const result = await onAddToken(validationResult.token);

      if (result.success) {
        setSuccessMessage(`✅ ${validationResult.token.symbol} added successfully!`);
        // Clear form after 2 seconds
        setTimeout(() => {
          setContractAddress('');
          setValidationResult(null);
          setSuccessMessage('');
        }, 2000);
      } else {
        setErrorMessage(result.message || 'Failed to add token');
      }
    } catch (error: any) {
      setErrorMessage(error.message || 'Failed to add token');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemoveToken = async (token: CustomToken) => {
    setIsProcessing(true);
    setErrorMessage('');

    try {
      const success = await onRemoveToken(token.address);

      if (success) {
        setSuccessMessage(`✅ ${token.symbol} removed successfully!`);
        setTimeout(() => setSuccessMessage(''), 2000);
      } else {
        setErrorMessage('Failed to remove token');
      }
    } catch (error: any) {
      setErrorMessage(error.message || 'Failed to remove token');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Custom Tokens</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={4} align="stretch">
            {/* Add Token Form */}
            <Box>
              <Text fontSize="sm" fontWeight="medium" mb={2}>
                Token Contract Address
              </Text>
              <HStack>
                <Input
                  placeholder="0x..."
                  value={contractAddress}
                  onChange={e => setContractAddress(e.target.value)}
                  isDisabled={isValidating || isProcessing}
                  flex={1}
                />
                <IconButton
                  aria-label="Validate token"
                  icon={isValidating ? <Spinner size="sm" /> : <FaSearch />}
                  onClick={handleValidate}
                  isDisabled={isValidating || isProcessing || !contractAddress.trim()}
                />
              </HStack>
            </Box>

            {/* Validation Result */}
            {validationResult?.valid && validationResult.token && (
              <Box p={4} borderWidth="1px" borderRadius="lg" bg="rgba(255, 255, 255, 0.05)">
                <HStack justify="space-between">
                  <HStack spacing={3}>
                    {validationResult.token.icon && (
                      <Image src={validationResult.token.icon} alt={validationResult.token.symbol} boxSize="32px" />
                    )}
                    <Box>
                      <Text fontWeight="medium">{validationResult.token.symbol}</Text>
                      <Text fontSize="sm" color="whiteAlpha.600">
                        {validationResult.token.name}
                      </Text>
                    </Box>
                  </HStack>
                  <Button
                    onClick={handleAddToken}
                    isDisabled={isProcessing}
                    leftIcon={isProcessing ? <Spinner size="sm" /> : <FaPlus />}
                    size="sm"
                    colorScheme="blue">
                    Add Token
                  </Button>
                </HStack>
              </Box>
            )}

            {/* Status Messages */}
            {successMessage && (
              <Box p={3} bg="green.900" color="green.200" borderRadius="lg">
                <HStack spacing={2}>
                  <FaCheckCircle />
                  <Text fontSize="sm">{successMessage}</Text>
                </HStack>
              </Box>
            )}

            {errorMessage && (
              <Box p={3} bg="red.900" color="red.200" borderRadius="lg">
                <HStack spacing={2}>
                  <FaExclamationTriangle />
                  <Text fontSize="sm">{errorMessage}</Text>
                </HStack>
              </Box>
            )}

            {/* Custom Tokens List */}
            {customTokens.length > 0 && (
              <Box>
                <Text fontSize="sm" fontWeight="medium" mb={2}>
                  Your Custom Tokens
                </Text>
                <VStack maxH="300px" overflowY="auto" spacing={2}>
                  {customTokens.map(token => (
                    <HStack
                      key={token.address}
                      w="full"
                      p={3}
                      borderWidth="1px"
                      borderRadius="lg"
                      bg="rgba(255, 255, 255, 0.05)"
                      justify="space-between"
                      _hover={{ bg: 'rgba(255, 255, 255, 0.08)' }}>
                      <HStack spacing={3}>
                        {token.icon && <Image src={token.icon} alt={token.symbol} boxSize="24px" />}
                        <Box>
                          <Text fontWeight="medium" fontSize="sm">
                            {token.symbol}
                          </Text>
                          <Text fontSize="xs" color="whiteAlpha.600">
                            {token.name}
                          </Text>
                        </Box>
                      </HStack>
                      <IconButton
                        aria-label="Remove token"
                        icon={<FaTimes />}
                        onClick={() => handleRemoveToken(token)}
                        isDisabled={isProcessing}
                        variant="ghost"
                        size="sm"
                      />
                    </HStack>
                  ))}
                </VStack>
              </Box>
            )}

            {customTokens.length === 0 && !validationResult && (
              <Box p={8} borderWidth="1px" borderRadius="lg" borderStyle="dashed" textAlign="center">
                <Text fontSize="sm" color="whiteAlpha.600">
                  No custom tokens added yet.
                </Text>
                <Text fontSize="sm" color="whiteAlpha.600" mt={1}>
                  Enter a token contract address above to get started.
                </Text>
              </Box>
            )}
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};
