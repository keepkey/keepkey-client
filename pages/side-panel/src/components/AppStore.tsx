import React, { useState, useEffect } from 'react';
import { Box, Grid, Image, Text, IconButton, Flex, HStack, Spinner, Button, useDisclosure } from '@chakra-ui/react';
import { ChevronLeftIcon, ChevronRightIcon } from '@chakra-ui/icons';
import { AddDappModal } from './AddDappModal';

interface Dapp {
  name: string;
  icon: string;
  url: string;
}

interface AppStoreProps {
  networkId: string;
}

async function getDapps(networkId: string): Promise<Dapp[]> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_DAPPS_BY_NETWORKID', networkId }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching dapps:', chrome.runtime.lastError.message);
        reject(chrome.runtime.lastError);
        return;
      }
      if (response) {
        const formattedDapps = response.map((dapp: any) => ({
          name: dapp.name,
          icon: dapp.image,
          url: dapp.app,
        }));
        resolve(formattedDapps || []);
      } else {
        reject(new Error('No dapps found'));
      }
    });
  });
}

export const AppStore: React.FC<AppStoreProps> = ({ networkId }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [dapps, setDapps] = useState<Dapp[]>([]);
  const [loading, setLoading] = useState(true);
  const dappsPerPage = 9;

  const { isOpen, onOpen, onClose } = useDisclosure();

  useEffect(() => {
    setLoading(true);
    getDapps(networkId)
      .then(fetchedDapps => {
        setDapps(fetchedDapps);
        setLoading(false);
      })
      .catch(error => {
        console.error('Error fetching dapps:', error);
        setLoading(false);
      });
  }, [networkId]);

  const addDapp = (newDapp: Dapp) => {
    setDapps(prevDapps => [...prevDapps, newDapp]);
  };

  const totalPages = Math.ceil((dapps.length + 1) / dappsPerPage);

  const indexOfLastDapp = currentPage * dappsPerPage;
  const indexOfFirstDapp = indexOfLastDapp - dappsPerPage;
  const currentDapps = [...dapps.slice(indexOfFirstDapp, indexOfLastDapp - 1), { name: 'Add DApp', icon: '', url: '' }];

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

  const handlePageClick = (pageNumber: number) => {
    setCurrentPage(pageNumber);
  };

  const renderPageNumbers = () => {
    const pageNumbers = [];
    for (let i = 1; i <= totalPages; i++) {
      pageNumbers.push(
        <Button
          key={i}
          size="sm"
          variant={i === currentPage ? 'solid' : 'outline'}
          onClick={() => handlePageClick(i)}
          mx={1}>
          {i}
        </Button>,
      );
    }
    return pageNumbers;
  };

  return (
    <Box>
      {loading ? (
        <Flex justifyContent="center" alignItems="center" minHeight="200px">
          <Spinner size="xl" />
          <Text ml={3}>Loading dApps...</Text>
        </Flex>
      ) : dapps.length === 0 ? (
        <Flex justifyContent="center" alignItems="center" minHeight="200px">
          <Text>No dApps found for this network</Text>
        </Flex>
      ) : (
        <>
          <Grid templateColumns="repeat(3, 1fr)" gap={4}>
            {currentDapps.map((dapp, index) =>
              dapp.name === 'Add DApp' ? (
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
                  height="80px" // Reduced height
                >
                  <Text fontSize="xl" color="gray.500">
                    +
                  </Text>
                  <Text mt={1} fontSize="sm">
                    Add DApp
                  </Text>
                </Box>
              ) : (
                <Box key={index} textAlign="center" cursor="pointer" onClick={() => openUrl(dapp.url)}>
                  <Image src={dapp.icon} alt={dapp.name} boxSize="60px" objectFit="contain" mx="auto" />
                  <Text mt={1} fontSize="sm">
                    {dapp.name}
                  </Text>
                </Box>
              ),
            )}
          </Grid>
          <Flex justifyContent="center" alignItems="center" mt={4}>
            <IconButton
              icon={<ChevronLeftIcon />}
              aria-label="Previous Page"
              onClick={handlePrevPage}
              isDisabled={currentPage === 1}
            />
            <HStack spacing={1} mx={2}>
              {renderPageNumbers()}
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

      <AddDappModal isOpen={isOpen} onClose={onClose} onSave={addDapp} />
    </Box>
  );
};

export default AppStore;
