import { ethers, Transaction } from 'ethers';

// Signed transaction from the logs
const signedTx = '0xf86d8201a48506fc23ac00825208947d1bb46c5d7453356d853565f68e62ee3cd0294f871b186f244314008025a0a12d28d15e938708d3a026c86bc7f5998057885cb9b83862e8aafbef75b114e6a028c7dced1657643f7f777b1a6cba030919dcc924df0c26c1992b202ec6cda5ec';

try {
  // Parse the signed transaction (ethers v6 API)
  const tx = Transaction.from(signedTx);

  console.log('=== TRANSACTION DETAILS ===');
  console.log('From address:', tx.from);
  console.log('To address:', tx.to);
  console.log('Value (wei):', tx.value.toString());
  console.log('Value (ETH):', ethers.formatEther(tx.value));
  console.log('Nonce:', tx.nonce);
  console.log('Gas Price:', ethers.formatUnits(tx.gasPrice, 'gwei'), 'gwei');
  console.log('Gas Limit:', tx.gasLimit.toString());
  console.log('Chain ID:', tx.chainId);

  // Calculate transaction cost
  const txCost = tx.gasPrice * tx.gasLimit;
  const totalCost = tx.value + txCost;

  console.log('\n=== COST ANALYSIS ===');
  console.log('Gas cost (wei):', txCost.toString());
  console.log('Gas cost (ETH):', ethers.formatEther(txCost));
  console.log('Total needed (value + gas) (ETH):', ethers.formatEther(totalCost));

  // Now check the actual on-chain balance
  console.log('\n=== CHECKING ON-CHAIN BALANCE ===');
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');

  const balance = await provider.getBalance(tx.from);
  console.log('Current balance (wei):', balance.toString());
  console.log('Current balance (ETH):', ethers.formatEther(balance));

  const nonce = await provider.getTransactionCount(tx.from);
  console.log('Current nonce on-chain:', nonce);

  console.log('\n=== VERIFICATION ===');
  console.log('Expected sender:', '0x141D9959cAe3853b035000490C03991eB70Fc4aC');
  console.log('Actual sender:', tx.from);
  console.log('Addresses match:', tx.from.toLowerCase() === '0x141D9959cAe3853b035000490C03991eB70Fc4aC'.toLowerCase() ? '✅' : '❌');
  console.log('Has sufficient balance:', balance >= totalCost ? '✅' : '❌');
  console.log('Nonce matches:', nonce === tx.nonce ? '✅' : `❌ (expected ${nonce}, got ${tx.nonce})`);

} catch (error) {
  console.error('Error decoding transaction:', error);
}
