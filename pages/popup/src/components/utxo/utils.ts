// utils.ts
import { TransactionInput, TransactionOutput, Transaction } from './types'; // Adjust the path as necessary
import { useToast } from '@chakra-ui/react';

const updateEventById = async (id, updatedTransaction) => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'UPDATE_EVENT_BY_ID', payload: { id, updatedEvent: updatedTransaction } },
      response => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(response);
      },
    );
  });
};

export const estimateTxSize = (inputs: TransactionInput[], outputs: TransactionOutput[]) => {
  // (Same as before)
};

interface UpdateFeeParams {
  transaction: Transaction;
  adjustedFee: number;
  setOutputs: (outputs: TransactionOutput[]) => void;
  toast: any;
}

export const updateFee = async ({ transaction, adjustedFee, setOutputs, toast }: UpdateFeeParams) => {
  try {
    const inputs = transaction.unsignedTx.inputs;
    const outputs = transaction.unsignedTx.outputs;

    // Convert input amounts to numbers
    const totalInputs = inputs.reduce((sum, input) => sum + Number(input.amount), 0);

    const newFee = adjustedFee;

    // Ensure the recipient's output has the correct amount
    const recipientAddress = transaction.request.recipient;
    const amountToSend = Number(transaction.request.amount.amount) * 1e8; // Convert BTC to sats

    const recipientOutput = outputs.find(output => output.address === recipientAddress);
    if (recipientOutput) {
      recipientOutput.value = amountToSend;
    } else {
      throw new Error('Recipient output not found');
    }

    // Adjust the change output
    // For now, assume the last output is the change output
    let changeOutput = outputs[outputs.length - 1];

    // If 'isChange' property becomes available, use it:
    // let changeOutput = outputs.find((output) => output.isChange);

    // If the change output is the same as the recipient output, it means there's no change output
    if (changeOutput.address === recipientAddress) {
      // No existing change output
      changeOutput = null;
    }

    if (changeOutput) {
      changeOutput.value = totalInputs - amountToSend - newFee;
      if (changeOutput.value <= 0) {
        // Remove change output if amount is zero or negative
        outputs.pop(); // Remove last element
      }
    } else {
      // No existing change output, create one if necessary
      const changeAmount = totalInputs - amountToSend - newFee;
      if (changeAmount > 0) {
        outputs.push({
          address: 'yourChangeAddress', // Replace with actual change address
          value: changeAmount,
          // isChange: true, // Use when 'isChange' becomes available
        });
      }
    }

    // Recalculate total outputs after setting recipient amount and change
    const totalOutputsAfterUpdate = outputs.reduce((sum, output) => sum + Number(output.value), 0);

    // Check if total inputs cover total outputs plus fee
    if (totalInputs < totalOutputsAfterUpdate + newFee) {
      throw new Error('Not enough inputs to cover the fee and outputs.');
    }

    // Update the transaction with the new outputs
    setOutputs(outputs);

    const updatedTransaction = {
      ...transaction,
      unsignedTx: {
        ...transaction.unsignedTx,
        outputs,
      },
    };

    await updateEventById(transaction.id, updatedTransaction);
    console.log('Transaction updated successfully');
  } catch (error) {
    throw error;
  }
};
