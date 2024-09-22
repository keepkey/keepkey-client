import { Box, Heading, Text, IconButton } from '@chakra-ui/react';
import { CodeBlock, codepen } from 'react-code-blocks';
import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@chakra-ui/icons';

/**
 * Types
 */

/**
 * Component
 */
export default function RequestDataCard({ transaction }: any) {
  const [isOpen, setIsOpen] = useState(false);

  // Toggle visibility
  const toggleVisibility = () => {
    setIsOpen(!isOpen);
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

      {/* Conditionally render the code block */}
      {isOpen && (
        <Box mt={2}>
          <CodeBlock
            showLineNumbers={false}
            text={JSON.stringify(transaction, null, 2)}
            theme={codepen}
            language="json"
          />
        </Box>
      )}
    </Box>
  );
}
