import { useMemo, useEffect, useState } from 'react';
import { Avatar, Box, Text, VStack, Stack, Badge, HStack, Icon } from '@chakra-ui/react';
import { MdReport, MdReportProblem, MdNewReleases } from 'react-icons/md';

interface IProps {
  transaction: any;
}

export default function ProjectInfoCard({ transaction }: IProps) {
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);

  // Clean the URL to extract the domain
  const cleanUrl = useMemo(() => {
    try {
      const urlObj = new URL(transaction?.siteUrl);
      return `${urlObj.protocol}//${urlObj.hostname}`;
    } catch (error) {
      console.error('Invalid URL', error);
      return null;
    }
  }, [transaction?.siteUrl]);

  // Attempt to fetch the favicon from the cleaned URL
  useEffect(() => {
    if (cleanUrl) {
      const favicon = `${cleanUrl}/favicon.ico`;
      setFaviconUrl(favicon);
    }
  }, [cleanUrl]);

  return (
    <Box textAlign="center">
      <Stack align="center" position="relative">
        {/* Main Avatar for the dApp's favicon */}
        <Avatar src={faviconUrl || 'https://via.placeholder.com/150'} size="xl" />

        {/* Sub Avatar for KeepKey logo */}
        <Avatar
          src={'https://pioneers.dev/coins/keepkey.png'}
          size="sm"
          position="absolute"
          bottom={0}
          right={0}
          borderWidth="2px"
          borderColor="white"
        />
      </Stack>
      <Stack align="center" mt={4}>
        <Text fontSize="2xl" data-testid="session-info-card-text">
          {cleanUrl || 'Unknown site'} <br />
          <Text fontSize="xl">
            wants to <Badge>{transaction.type}</Badge>
          </Text>
        </Text>
      </Stack>
      <Stack align="center">
        {/* Display the transaction's site URL and allow opening in a new tab */}
        {/*{cleanUrl && (*/}
        {/*    <HStack>*/}
        {/*        <Text fontSize="md" >*/}
        {/*            {cleanUrl}*/}
        {/*        </Text>*/}
        {/*    </HStack>*/}
        {/*)}*/}
      </Stack>
    </Box>
  );
}
