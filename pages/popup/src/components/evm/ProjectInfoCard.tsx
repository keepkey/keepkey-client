import { useMemo, useEffect, useState } from 'react';
import { Avatar, Box, Text, VStack, Stack, Badge, Image } from '@chakra-ui/react';

// KeepKey logo URL with fallback
const KEEPKEY_LOGO = 'https://pioneers.dev/coins/keepkey.png';
const KEEPKEY_LOGO_FALLBACK = '/icon-128.png';

interface IProps {
  transaction: any;
}

export default function ProjectInfoCard({ transaction }: IProps) {
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);
  const isKeepKeyExtension = transaction?.siteUrl === 'KeepKey Browser Extension';

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
    setLogoError(false); // Reset error state for new URL
    if (isKeepKeyExtension) {
      setFaviconUrl(KEEPKEY_LOGO);
    } else if (cleanUrl) {
      const favicon = `${cleanUrl}/favicon.ico`;
      setFaviconUrl(favicon);
    }
  }, [cleanUrl, isKeepKeyExtension]);

  // Get the appropriate logo src
  const getLogoSrc = () => {
    if (logoError) return KEEPKEY_LOGO_FALLBACK;
    return faviconUrl || KEEPKEY_LOGO;
  };

  return (
    <Box textAlign="center">
      <Stack align="center" position="relative">
        {/* Logo - square for KeepKey, round avatar for dApps */}
        {isKeepKeyExtension ? (
          <Image
            src={getLogoSrc()}
            alt="KeepKey"
            boxSize="80px"
            objectFit="contain"
            onError={() => setLogoError(true)}
          />
        ) : (
          <Avatar src={getLogoSrc()} size="xl" bg="gray.700" onError={() => setLogoError(true)} />
        )}

        {/* Sub Avatar for KeepKey logo - only show if not already KeepKey */}
        {!isKeepKeyExtension && (
          <Image
            src={KEEPKEY_LOGO}
            boxSize="24px"
            position="absolute"
            bottom={0}
            right="calc(50% - 40px)"
            borderWidth="2px"
            borderColor="gray.800"
            borderRadius="md"
          />
        )}
      </Stack>
      <Stack align="center" mt={4}>
        {/* For KeepKey extension, just show "wants to" since logo has the name */}
        {isKeepKeyExtension ? (
          <Text fontSize="xl" data-testid="session-info-card-text">
            wants to{' '}
            <Badge colorScheme="yellow" fontSize="md" px={2}>
              {transaction.type}
            </Badge>
          </Text>
        ) : (
          <VStack spacing={1} data-testid="session-info-card-text">
            <Text fontSize="2xl">{cleanUrl}</Text>
            <Text fontSize="xl">
              wants to <Badge colorScheme="yellow">{transaction.type}</Badge>
            </Text>
          </VStack>
        )}
      </Stack>
    </Box>
  );
}
