import { useMemo, useEffect, useState } from 'react';
import { Avatar, Box, Text, VStack, Stack, Badge } from '@chakra-ui/react';

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

  // Attempt to fetch the favicon from the cleaned URL or handle the KeepKey Browser Extension case
  useEffect(() => {
    if (transaction?.siteUrl === 'KeepKey Browser Extension') {
      setFaviconUrl('https://api.keepkey.info/coins/keepkey.png');
    } else if (cleanUrl) {
      const favicon = `${cleanUrl}/favicon.ico`;
      setFaviconUrl(favicon);
    }
  }, [cleanUrl, transaction?.siteUrl]);

  return (
    <Box textAlign="center">
      <Stack align="center" position="relative">
        {/* Main Avatar for the dApp's favicon */}
        <Avatar src={faviconUrl || 'https://via.placeholder.com/150'} size="xl" />

        {/* Sub Avatar for KeepKey logo */}
        <Avatar
          src={'https://api.keepkey.info/coins/keepkey.png'}
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
          {transaction?.siteUrl === 'KeepKey Browser Extension' ? 'KeepKey Browser Extension' : cleanUrl} <br />
          <Text fontSize="xl">
            wants to <Badge>{transaction.type}</Badge>
          </Text>
        </Text>
      </Stack>
    </Box>
  );
}
