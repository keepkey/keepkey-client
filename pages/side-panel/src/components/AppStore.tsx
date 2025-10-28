import React, { useState, useEffect } from 'react';
import { Box, Grid, Image, Text, IconButton, Flex, HStack, Spinner, Button, useDisclosure } from '@chakra-ui/react';
import { ChevronLeftIcon, ChevronRightIcon } from '@chakra-ui/icons';
import { AddDappModal } from './AddDappModal';
import { dappStorage } from '@extension/storage';

interface Dapp {
  name: string;
  icon: string;
  url: string;
}

interface AppStoreProps {
  networkId: string;
}

async function getLookedUpDapps(networkId: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_DAPPS_BY_NETWORKID', networkId }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching dapps:', chrome.runtime.lastError.message);
        reject(chrome.runtime.lastError);
        return;
      }
      if (response && Array.isArray(response)) {
        console.log('response:', response);
        const formattedDapps = response.map((dapp: any) => ({
          name: dapp.name,
          icon: dapp.image,
          url: dapp.app,
        }));
        resolve(formattedDapps);
      } else {
        console.warn('Unexpected response format:', response);
        resolve([]); // Gracefully resolve with an empty array
      }
    });
  });
}

async function getStoredDapps(networkId: string): Promise<Dapp[]> {
  const allDapps = await dappStorage.getDapps();
  return allDapps.filter(dapp => dapp.networks.includes(networkId));
}

export const AppStore: React.FC<AppStoreProps> = ({ networkId }) => {
  const [dapps, setDapps] = useState<Dapp[]>([]);
  const [loading, setLoading] = useState(true);
  const dappsPerPage = 9;
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [currentPage, setCurrentPage] = useState(1);

  const fetchDapps = async () => {
    // Don't fetch if networkId is not provided
    if (!networkId) {
      console.log('[AppStore] No networkId provided, skipping dapp fetch');
      setLoading(false);
      setDapps([]);
      return;
    }

    setLoading(true);

    try {
      const [lookedUpDapps, storedDapps] = await Promise.all([getLookedUpDapps(networkId), getStoredDapps(networkId)]);
      const combinedDapps = [...lookedUpDapps, ...storedDapps];
      const uniqueDapps = Array.from(new Map(combinedDapps.map(dapp => [dapp.url, dapp])).values());

      setDapps(uniqueDapps);
    } catch (error) {
      console.error('Error fetching dapps:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDapps();
  }, [networkId]);

  const handleDappAdded = () => {
    fetchDapps(); // Reload dApps after adding a new one
  };

  const totalPages = Math.ceil(dapps.length / dappsPerPage);
  const indexOfLastDapp = currentPage * dappsPerPage;
  const indexOfFirstDapp = indexOfLastDapp - dappsPerPage;
  const currentDapps = dapps.slice(indexOfFirstDapp, indexOfLastDapp);

  const openUrl = (url: string) => {
    window.open(url, '_blank');
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(prevPage => prevPage + 1);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(prevPage => prevPage - 1);
    }
  };

  return (
    <Box>
      {loading ? (
        <Flex justifyContent="center" alignItems="center" minHeight="200px">
          <Spinner size="xl" />
          <Text ml={3}>Loading dApps...</Text>
        </Flex>
      ) : (
        <>
          <Grid templateColumns="repeat(3, 1fr)" gap={4}>
            {dapps.length === 0 ? (
              <Box
                textAlign="center"
                cursor="pointer"
                onClick={onOpen}
                display="flex"
                flexDirection="column"
                alignItems="center"
                justifyContent="center"
                height="80px">
                <Text>No dApps found for this network</Text>
              </Box>
            ) : (
              currentDapps.map((dapp, index) => (
                <Box key={index} textAlign="center" cursor="pointer" onClick={() => openUrl(dapp.url)}>
                  <Image src={dapp.icon} alt={dapp.name} boxSize="60px" objectFit="contain" mx="auto" />
                  <Text mt={1} fontSize="sm">
                    {dapp.name}
                  </Text>
                </Box>
              ))
            )}
            <Box
              key="add-dapp"
              textAlign="center"
              cursor="pointer"
              border="1px dashed gray"
              onClick={onOpen}
              display="flex"
              flexDirection="column"
              alignItems="center"
              justifyContent="center"
              height="80px">
              <Text fontSize="xl" color="gray.500">
                +
              </Text>
              <Text mt={1} fontSize="sm">
                Add DApp
              </Text>
            </Box>
          </Grid>
          <Flex justifyContent="center" alignItems="center" mt={4}>
            <IconButton
              icon={<ChevronLeftIcon />}
              aria-label="Previous Page"
              onClick={handlePrevPage}
              isDisabled={currentPage === 1}
            />
            <HStack spacing={1} mx={2}>
              {[...Array(totalPages).keys()].map(i => (
                <Button
                  key={i}
                  size="sm"
                  variant={i + 1 === currentPage ? 'solid' : 'outline'}
                  onClick={() => setCurrentPage(i + 1)}>
                  {i + 1}
                </Button>
              ))}
            </HStack>
            <IconButton
              icon={<ChevronRightIcon />}
              aria-label="Next Page"
              onClick={handleNextPage}
              isDisabled={currentPage === totalPages}
            />
          </Flex>
        </>
      )}
      <AddDappModal networkId={networkId} isOpen={isOpen} onClose={onClose} onSave={handleDappAdded} />
    </Box>
  );
};

export default AppStore;
