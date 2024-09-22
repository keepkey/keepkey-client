import React, { useEffect, useState } from 'react';
import EvmTransaction from './evm';
import { approvalStorage, requestStorage } from '@extension/storage/dist/lib';

const Transaction = ({ event, reloadEvents }: { event: any; reloadEvents: () => void }) => {
  const [transactionType, setTransactionType] = useState<string | null>(null);

  const handleResponse = async (decision: 'accept' | 'reject') => {
    try {
      console.log('handleResponse:', decision);
      if (decision === 'reject') {
        // Delete event
        await requestStorage.removeEventById(event.id);
      } else {
        // Move event to approval storage
        const updatedEvent = { ...transaction, status: 'approval' };
        await requestStorage.removeEventById(event.id);
        await approvalStorage.addEvent(updatedEvent);
        console.log('Moved event to approval storage:', updatedEvent);
      }
      chrome.runtime.sendMessage({ action: 'eth_sign_response', response: { decision, eventId: event.id } });
      reloadEvents();
    } catch (error) {
      console.error('Error handling response:', error);
    }
  };

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
        return <EvmTransaction transaction={event} reloadEvents={reloadEvents} handleResponse={handleResponse} />;
      case 'utxo':
        return <div>TODO UTXO</div>;
      default:
        return <div>Unknown Transaction Type</div>;
    }
  };

  return <div>{renderTransaction()}</div>;
};

export default Transaction;
