import React, { useState, useEffect } from 'react';
import { Flex, Spinner, Avatar, Box, Text, Badge, Card, Stack } from '@chakra-ui/react';
import { withErrorBoundary, withSuspense } from '@extension/shared';

const SidePanel = () => {
  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBalances = () => {
    console.log('Fetching KeepKey state...');
    chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, response => {
      console.log('Fetched balances:', response);
      if (response) {
        console.log('Fetched balances:', response.balances);
        setBalances(response.balances);
        setLoading(false);
      }
    });
  };

  const fetchAssets = () => {
    console.log('Fetching KeepKey assets...');
    chrome.runtime.sendMessage({ type: 'GET_APP_ASSETS' }, response => {
      console.log('Fetched balances:', response);
      if (response) {
        console.log('Fetched balances:', response.assets);
        setBalances(response.assets);
        setLoading(false);
      }
    });
  };


  useEffect(() => {
    fetchBalances();
  }, []);

  const formatBalance = (balance: string) => {
    const [integer, decimal] = balance.split('.');
    const largePart = decimal?.slice(0, 4);
    return { integer, largePart };
  };

  return (
      <Flex direction="column" width="100%" height="100vh" p={4}>
        {loading ? (
            <Flex justifyContent="center" alignItems="center">
              <Spinner size="xl" />
            </Flex>
        ) : (
            <Stack spacing={4} width="100%">
              {balances.map((balance, index) => (
                  <Card key={index} borderRadius="md" p={4}>
                    <Flex align="center" width="100%">
                      <Avatar src={balance.asset.icon} />
                      <Box ml={3}>
                        <Text fontWeight="bold">{balance.asset.name}</Text>
                        <Text>
                          {formatBalance(balance.balance).integer}.
                          <Text as="span" fontSize="lg">{formatBalance(balance.balance).largePart}</Text>
                        </Text>
                        <Badge ml={2} colorScheme="teal">{balance.asset.symbol}</Badge>
                      </Box>
                    </Flex>
                  </Card>
              ))}
            </Stack>
        )}
      </Flex>
  );
};

export default withErrorBoundary(withSuspense(SidePanel, <div>Loading...</div>), <div>Error Occur</div>);
