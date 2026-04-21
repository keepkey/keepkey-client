import { useState, useEffect } from 'react';
import { Box, Spinner, Flex } from '@chakra-ui/react';
import React, { Fragment } from 'react';
import LegacyTx from './txTypes/legacy';
import Eip712Tx from './txTypes/eip712';

// Function to request asset context from background script
const requestAssetContext = () => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve(response);
    });
  });
};

export default function RequestDetailsCard({ transaction }: any) {
  const [price, setPrice] = useState<number | null>(null);
  const [isNative, setIsNative] = useState(true); // Toggle for hex/native
  const [usdValue, setUsdValue] = useState<string>('');

  useEffect(() => {
    // Request the asset context from the background script
    requestAssetContext()
      .then((assetContext: any) => {
        console.log('assetContext: ', assetContext);
        setPrice(assetContext?.assets?.priceUsd); // Assume priceUsd is the key for USD price
      })
      .catch(err => console.error(err));
  }, []);

  const toggleHexNative = () => {
    setIsNative(!isNative);
  };

  const renderTx = () => {
    switch (transaction?.type) {
      case 'eth_signTypedData_v4':
      case 'eth_signTypedData_v3':
      case 'eth_signTypedData':
        return <Eip712Tx transaction={transaction} />;
      default:
        return <LegacyTx transaction={transaction} />;
    }
  };

  if (!transaction?.unsignedTx) {
    // Show spinner if transaction.unsignedTx is not set
    return (
      <Flex justifyContent="center" alignItems="center" height="100%">
        <Spinner size="xl" />
      </Flex>
    );
  }

  return <Fragment>{renderTx()}</Fragment>;
}
