import { useState, useEffect } from 'react';
import { Box, Divider, Flex, Table, Tbody, Tr, Td, Badge, Switch, Text, HStack, Textarea } from '@chakra-ui/react';
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

  // Function to format ETH to USD value
  const formatUsd = (ethValue: string, price: number) => {
    const usd = parseFloat(ethValue) * price;
    return usd.toFixed(2); // Format to 2 decimals
  };

  const toggleHexNative = () => {
    setIsNative(!isNative);
  };

  const ethValue = transaction?.request?.value; // Assume this is in hex
  const nativeValue = parseFloat(parseInt(ethValue, 16).toString()) / 1e18; // Convert from wei to ETH

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

  return <Fragment>{renderTx()}</Fragment>;
}
