import { Box, Heading, IconButton, Button, Spinner } from '@chakra-ui/react';
import { CodeBlock, codepen } from 'react-code-blocks';
import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@chakra-ui/icons';
import { requestStorage } from '@extension/storage'; // Import the requestStorage

/**
 * Component
 */
export default function RequestDataCard({ transaction }: any) {
  const [isOpen, setIsOpen] = useState(false);
  const [fetchedTransaction, setFetchedTransaction] = useState<any>(transaction);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Toggle visibility
  const toggleVisibility = () => {
    setIsOpen(!isOpen);
  };

  // Function to fetch event data from storage
  const fetchEventData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch the transaction from storage using its ID
      const response = await requestStorage.getEventById(transaction.id);
      if (response) {
        setFetchedTransaction(response); // Update the transaction data with the fetched data
      } else {
        setError('Transaction not found in storage');
      }
    } catch (err) {
      console.error('Error fetching event data:', err);
      setError('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box display="flex" flexDirection="column">
      <Box display="flex" alignItems="center" cursor="pointer" onClick={toggleVisibility}>
        <IconButton
          icon={isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
          aria-label="Toggle data visibility"
          variant="ghost"
          size="sm"
          mr={2}
        />
        <Heading as="h5" size="sm">
          Data
        </Heading>
      </Box>

      {isOpen && (
        <Box mt={2}>
          {/* Fetch Data Button */}
          <Button size="sm" colorScheme="blue" onClick={fetchEventData} disabled={loading}>
            {loading ? <Spinner size="sm" /> : 'Fetch Event Data'}
          </Button>

          {/* Display error if any */}
          {error && (
            <Box mt={2} color="red.500">
              {error}
            </Box>
          )}

          {/* Conditionally render the code block */}
          <Box mt={2}>
            <CodeBlock
              showLineNumbers={false}
              text={JSON.stringify(fetchedTransaction, null, 2)}
              theme={codepen}
              language="json"
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}
