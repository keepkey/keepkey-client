import React, { useState, useEffect, Fragment } from 'react';
import { Box, Spinner, Flex } from '@chakra-ui/react';
import LegacyTx from './txTypes/legacy';
import Eip712Tx from './txTypes/eip712';
import PersonalSignTx from './txTypes/personalSign';
import AddEthereumChainTx from './txTypes/addEthereumChain';

// Methods that don't produce an on-chain transaction — they have no
// `unsignedTx` and must not be blocked behind the "waiting for
// transaction build" spinner meant for transfers.
const NO_UNSIGNED_TX_METHODS = new Set(['personal_sign', 'eth_sign', 'wallet_addEthereumChain']);

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
      case 'personal_sign':
      case 'eth_sign':
        return <PersonalSignTx transaction={transaction} />;
      case 'wallet_addEthereumChain':
        return <AddEthereumChainTx transaction={transaction} />;
      default:
        return <LegacyTx transaction={transaction} />;
    }
  };

  // Wait for the unsigned-tx build only for methods that produce one.
  // Message-signing and configuration-change methods never populate it.
  const skipSpinner = NO_UNSIGNED_TX_METHODS.has(transaction?.type);
  if (!skipSpinner && !transaction?.unsignedTx) {
    return (
      <Flex justifyContent="center" alignItems="center" height="100%">
        <Spinner size="xl" />
      </Flex>
    );
  }

  return <Fragment>{renderTx()}</Fragment>;
}
