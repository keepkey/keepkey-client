import { useMemo, useEffect } from 'react';
// import { useSnapshot } from 'valtio';
// import SettingsStore from '@/store/SettingsStore';
import { Icon, Box, Avatar, Link, Text, VStack, HStack, Stack, Badge } from '@chakra-ui/react';
// import { SignClientTypes } from '@walletconnect/types';
import { MdReport, MdReportProblem, MdNewReleases } from 'react-icons/md';

/**
 * Types
 */
interface IProps {
  metadata: '';
  intention?: string;
}

export default function ProjectInfoCard({ transaction }: any) {
  // const { currentRequestVerifyContext } = useSnapshot(SettingsStore.state);
  // const validation = currentRequestVerifyContext?.verified.validation;
  // const { icons, name, url } = metadata;
  // let name = transaction?.siteUrl
  let url = transaction?.siteUrl;

  useEffect(() => {
    // Check URL
    console.log('PROPOSAL URL: ', url);
  }, [url]);

  return (
    <Box textAlign="center">
      <Stack align="center">
        <Avatar src={'https://pioneers.dev/coins/keepkey.png'} size="xl" bg="gray.700" />
      </Stack>
      <Stack align="center">
        <Text fontSize="2xl" data-testid="session-info-card-text">
          <span>{url}</span> <br />
          <Text fontSize="xl">
            wants to <Badge colorScheme="yellow">{transaction?.type}</Badge>
          </Text>
        </Text>
      </Stack>
      <Stack align="center">
        {/*{validation === 'VALID' && (*/}
        {/*  <Box as="img" src="/icons/verified-domain.svg" data-testid="session-info-verified" sx={{ verticalAlign: 'middle', marginRight: '5px' }} />*/}
        {/*)}*/}
        {/*<Link href={url} data-testid="session-info-card-url" isExternal sx={{ verticalAlign: 'middle' }}>*/}
        {/*  <Text color="#697177">{url}</Text>*/}
        {/*</Link>*/}
      </Stack>
      {/*{currentRequestVerifyContext?.verified.isScam ? (*/}
      {/*  <HStack color="red.500" justify="center" p={2}>*/}
      {/*    <Icon as={MdNewReleases} verticalAlign="bottom" />*/}
      {/*    <Text>Potential threat</Text>*/}
      {/*  </HStack>*/}
      {/*) : validation === 'UNKNOWN' ? (*/}
      {/*  <HStack color="orange.500" justify="center" p={2}>*/}
      {/*    <Icon as={MdReport} verticalAlign="bottom" />*/}
      {/*    <Text>Cannot Verify</Text>*/}
      {/*  </HStack>*/}
      {/*) : validation === 'INVALID' ? (*/}
      {/*  <HStack color="red.500" justify="center" p={2}>*/}
      {/*    <Icon as={MdReportProblem} verticalAlign="bottom" mr="2px" />*/}
      {/*    <Text>Invalid Domain</Text>*/}
      {/*  </HStack>*/}
      {/*) : null}*/}
    </Box>
  );
}
