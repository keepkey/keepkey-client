import React, { useState, useEffect } from 'react';
import { Box, Grid, Image, Text, IconButton, Flex, HStack, Button, Spinner } from '@chakra-ui/react';
import { ChevronLeftIcon, ChevronRightIcon } from '@chakra-ui/icons';

interface Dapp {
  name: string;
  icon: string;
  url: string;
}

interface AppStoreProps {
  networkId: string; // Pass the networkId as a prop
}

// Function to fetch dApps data from the backend via Chrome runtime
async function getDapps(networkId: string): Promise<Dapp[]> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_DAPPS_BY_NETWORKID', networkId }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching dapps:', chrome.runtime.lastError.message);
        reject(chrome.runtime.lastError);
        return;
      }
      if (response) {
        console.log('dapps response:', response);
        const formattedDapps = response.map((dapp: any) => ({
          name: dapp.name,
          icon: dapp.image,
          url: dapp.app,
        }));
        resolve(formattedDapps || []);
      } else {
        console.error('Error: No dapps found in the response');
        reject(new Error('No dapps found'));
      }
    });
  });
}

export const AppStore: React.FC<AppStoreProps> = ({ networkId }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [dapps, setDapps] = useState<Dapp[]>([]);
  const [loading, setLoading] = useState(true);
  const dappsPerPage = 6;

  // Fetch dApps on component mount or when networkId changes
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

  // Calculate total pages
  const totalPages = Math.ceil(dapps.length / dappsPerPage);

  // Get current dApps for the page
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
          <Grid templateColumns="repeat(2, 1fr)" gap={6}>
            {currentDapps.map((dapp, index) => (
              <Box key={index} textAlign="center" cursor="pointer" onClick={() => openUrl(dapp.url)}>
                <Image src={dapp.icon} alt={dapp.name} boxSize="80px" objectFit="contain" mx="auto" />
                <Text mt={2}>{dapp.name}</Text>
              </Box>
            ))}
          </Grid>
          {/* Pagination Controls */}
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
    </Box>
  );
};

export default AppStore;
