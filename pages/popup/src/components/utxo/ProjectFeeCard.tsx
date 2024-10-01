import React, { useState, useEffect } from 'react';
import {
    Box,
    Text,
    VStack,
    RadioGroup,
    Radio,
    Button,
    Input,
    Card,
    CardBody,
    Divider,
    Badge,
    Table,
    Tbody,
    Tr,
    Td,
    TableContainer
} from '@chakra-ui/react';

// Placeholder function to get recommended fees
const getRecommendedFees = () => ({
    high: 20, // sat/byte
    medium: 10,
    low: 5,
});

// Placeholder function to request asset context (returns BTC price in USD)
const requestAssetContext = () => {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, (response) => {
            if (chrome.runtime.lastError) {
                return reject(chrome.runtime.lastError);
            }
            resolve(response);
        });
    });
};

interface TransactionInput {
    scriptType: string;
    // other properties
}

interface TransactionOutput {
    address: string;
    // other properties
}

interface Transaction {
    unsignedTx: {
        inputs: TransactionInput[];
        outputs: TransactionOutput[];
    };
    // other properties
}

interface ProjectFeeCardProps {
    transaction: Transaction; // Accepts the transaction object
}

const estimateTxSize = (
    inputs: TransactionInput[],
    outputs: TransactionOutput[]
) => {
    // Base transaction weight (version, locktime, marker, and flag)
    const baseTransactionWeight = 10 * 4; // 10 bytes * 4 weight units

    let totalWeight = 0;

    // Inputs
    inputs.forEach((input) => {
        let weight = 0;

        if (input.scriptType === 'p2wpkh') {
            // P2WPKH input: 41 bytes * 4 weight units
            weight = 41 * 4;
        } else if (input.scriptType === 'p2pkh') {
            // P2PKH input: 148 bytes * 4 weight units
            weight = 148 * 4;
        } else if (input.scriptType === 'p2sh-p2wpkh') {
            // P2SH-P2WPKH input: 91 bytes * 4 weight units
            weight = 91 * 4;
        } else {
            // Default to P2PKH if unknown
            weight = 148 * 4;
        }
        totalWeight += weight;
    });

    // Outputs
    outputs.forEach((output) => {
        let weight = 0;

        if (output.address && output.address.startsWith('bc1')) {
            // P2WPKH output: 31 bytes * 4 weight units
            weight = 31 * 4;
        } else if (output.address && output.address.startsWith('3')) {
            // P2SH output: 32 bytes * 4 weight units
            weight = 32 * 4;
        } else {
            // P2PKH output: 34 bytes * 4 weight units
            weight = 34 * 4;
        }
        totalWeight += weight;
    });

    // Total transaction weight
    const totalTxWeight = baseTransactionWeight + totalWeight;

    // Virtual Size (vsize) = (Total Weight + 3) / 4 (rounded up)
    const vsize = Math.ceil((totalTxWeight + 3) / 4);

    return vsize;
};

const ProjectFeeCard: React.FC<ProjectFeeCardProps> = ({ transaction }) => {
    const [feeOption, setFeeOption] = useState<string>('medium');
    const [customFeeRate, setCustomFeeRate] = useState<string>('');
    const [adjustedFee, setAdjustedFee] = useState<number>(0);
    const [usdFee, setUsdFee] = useState<string>('0.00');
    const [btcPrice, setBtcPrice] = useState<number>(30000); // Default BTC price
    const [txSizeInBytes, setTxSizeInBytes] = useState<number>(0);

    const recommendedFees = getRecommendedFees();

    // Extract inputs and outputs from the transaction
    const inputs = transaction.unsignedTx.inputs;
    const outputs = transaction.unsignedTx.outputs;

    // Calculate estimated transaction size
    useEffect(() => {
        const estimatedSize = estimateTxSize(inputs, outputs);
        setTxSizeInBytes(estimatedSize);
    }, [inputs, outputs]);

    // Fetch asset context (BTC/USD price)
    useEffect(() => {
        const fetchAssetContext = async () => {
            try {
                const assetContext = await requestAssetContext();
                const priceUsd = parseFloat(assetContext.assets.priceUsd);
                if (!isNaN(priceUsd)) {
                    setBtcPrice(priceUsd); // Update the BTC price
                } else {
                    console.error('Invalid BTC price:', assetContext.assets.priceUsd);
                }
            } catch (error) {
                console.error('Error fetching asset context:', error);
            }
        };
        fetchAssetContext();
    }, []);

    // Calculate fee in sats and USD
    useEffect(() => {
        let feeRate = recommendedFees[feeOption as keyof typeof recommendedFees];

        if (feeOption === 'custom') {
            const parsedFeeRate = parseFloat(customFeeRate);
            if (!isNaN(parsedFeeRate) && parsedFeeRate > 0) {
                feeRate = parsedFeeRate;
            } else {
                feeRate = 0;
            }
        }

        // Ensure txSizeInBytes and feeRate are valid numbers
        if (!isNaN(txSizeInBytes) && txSizeInBytes > 0 && feeRate > 0) {
            const newFee = Math.ceil(txSizeInBytes * feeRate); // Fee in sats
            setAdjustedFee(newFee);

            const feeInUsd = ((newFee / 1e8) * btcPrice).toFixed(2); // Convert to USD
            setUsdFee(feeInUsd);
        } else {
            setAdjustedFee(0);
            setUsdFee('0.00');
        }
    }, [feeOption, customFeeRate, txSizeInBytes, btcPrice, recommendedFees]);

    return (
        <Card maxW="400px" mx="auto" mt={4}>
            <CardBody>

                {/* Select Fee Option */}
                <VStack align="stretch" mb={4}>
                    <Text fontSize="lg" fontWeight="bold" mb={2}>
                        Select Fee Option
                    </Text>

                    <RadioGroup onChange={setFeeOption} value={feeOption}>
                        <VStack align="flex-start" spacing={1}>
                            <Radio value="high">
                                High ({recommendedFees.high} sat/byte){' '}
                                <Badge colorScheme="red">Fastest</Badge>
                            </Radio>
                            <Radio value="medium">
                                Medium ({recommendedFees.medium} sat/byte){' '}
                                <Badge colorScheme="yellow">Normal</Badge>
                            </Radio>
                            <Radio value="low">
                                Low ({recommendedFees.low} sat/byte){' '}
                                <Badge colorScheme="green">Slow</Badge>
                            </Radio>
                            <Radio value="custom">Custom</Radio>
                        </VStack>
                    </RadioGroup>

                    {/* Custom Fee Input */}
                    {feeOption === 'custom' && (
                        <Box mt={2}>
                            <Text mb={1} fontSize="sm">Enter Custom Fee Rate (sat/byte):</Text>
                            <Input
                                placeholder="Enter fee rate"
                                value={customFeeRate}
                                onChange={(e) => setCustomFeeRate(e.target.value)}
                                type="number"
                                size="sm"
                            />
                        </Box>
                    )}
                </VStack>

                <Divider />

                {/* Final Details in More Compact Table Format */}
                <TableContainer>
                    <Table variant="simple" size="sm">
                        <Tbody>
                            <Tr>
                                <Td p={1}>Bitcoin Price</Td>
                                <Td p={1} isNumeric>${btcPrice.toLocaleString()} USD</Td>
                            </Tr>
                            <Tr>
                                <Td p={1}>Transaction Size</Td>
                                <Td p={1} isNumeric>{txSizeInBytes} bytes</Td>
                            </Tr>
                            <Tr>
                                <Td p={1}>Number of Inputs</Td>
                                <Td p={1} isNumeric>{inputs.length}</Td>
                            </Tr>
                            <Tr>
                                <Td p={1}>Number of Outputs</Td>
                                <Td p={1} isNumeric>{outputs.length}</Td>
                            </Tr>
                            <Tr>
                                <Td p={1}>Total Fee</Td>
                                <Td p={1} isNumeric>${usdFee} ({adjustedFee.toLocaleString()} sats)</Td>
                            </Tr>
                        </Tbody>
                    </Table>
                </TableContainer>

                <Divider />

                <Button colorScheme="blue" width="100%" mt={3} size="sm">
                    Confirm Fee
                </Button>
            </CardBody>
        </Card>
    );
};

export default ProjectFeeCard;
