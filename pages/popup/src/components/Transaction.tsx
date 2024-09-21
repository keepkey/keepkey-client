import React, { useEffect, useState } from 'react';
import EvmTransaction from './evm';

const Transaction = ({ event, reloadEvents }: { event: any; reloadEvents: () => void }) => {
  const [transactionType, setTransactionType] = useState<string | null>(null);

  useEffect(() => {
    console.log('event', event);

    if (event && event?.networkId) {
      if (event.networkId.includes('eip155')) {
        setTransactionType('evm');
      } else if (event.networkId.includes('utxo')) {
        setTransactionType('utxo');
      } else {
        setTransactionType('unknown');
      }
    }
  }, [event]);

  const renderTransaction = () => {
    switch (transactionType) {
      case 'evm':
        return <EvmTransaction transaction={event} reloadEvents={reloadEvents} />;
      case 'utxo':
        return <div>TODO UTXO</div>;
      default:
        return <div>Unknown Transaction Type</div>;
    }
  };

  return <div>{renderTransaction()}</div>;
};

export default Transaction;
