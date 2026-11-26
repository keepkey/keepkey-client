import { Box, Button, Grid, Stack, Tabs, TabList, TabPanels, Tab, TabPanel, Text } from '@chakra-ui/react';
import React, { useState } from 'react';
import RequestFeeCard from './RequestFeeCard';
import RequestDataCard from './RequestDataCard';
import RequestDetailsCard from './RequestDetailsCard';
import RequestMethodCard from './RequestMethodCard';
import ProjectInfoCard from './ProjectInfoCard';
import FeeWarningBanner from './FeeWarningBanner';
import NonceInfoRow from './NonceInfoRow';
import ClearSignReportCard from '../ClearSignReportCard';
import SiweCard from './SiweCard';
import { tokens, fonts } from '../../styles/tokens';
import { Surface } from '../ui';

// Underline tabs in the v2 micro-label style: mono, uppercase, the active tab
// in full text colour over a 1px rule. No blue, no gold — gold is Approve's.
const tabStyle = {
  fontFamily: fonts.mono,
  fontSize: '10.5px',
  letterSpacing: '0.16em',
  textTransform: 'uppercase' as const,
  color: tokens.faint,
  padding: '10px 2px',
  marginRight: '20px',
  borderBottom: '1px solid transparent',
  marginBottom: '-1px',
  _selected: { color: tokens.text, borderBottomColor: tokens.text },
  _hover: { color: tokens.dim },
};

export function EvmTransaction({ transaction, reloadEvents, handleResponse }: any) {
  // Block Approve until the user picks a fee strategy when a warning is
  // attached. Detection lives background-side in handleSigningMethods —
  // we just enforce that the user has made a choice before we sign.
  const feeWarning = transaction?.feeWarning ?? null;
  const initialChoice = transaction?.feeChoice ?? null;
  const [feeChoice, setFeeChoice] = useState<any>(initialChoice);
  // Sign-In with Ethereum domain check, computed background-side from the
  // Chrome-derived origin. A danger verdict needs an explicit acknowledgment.
  // Transaction keys this component by event id, so this resets per request.
  const siwe = transaction?.siwe ?? null;
  const siweDanger = !!siwe?.warnings?.some((w: any) => w.level === 'danger');
  const [siweAck, setSiweAck] = useState(false);
  const feeBlocked = !!feeWarning && !feeChoice;
  const siweBlocked = siweDanger && !siweAck;
  const vaultBlocked = transaction?.clearSignReport?.protectionLevel === 'P0';
  const approveBlocked = feeBlocked || siweBlocked || vaultBlocked;
  const blockReason = vaultBlocked
    ? 'Vault blocked this transaction'
    : siweBlocked
      ? 'Confirm the sign-in warning above'
      : feeBlocked
        ? 'Pick a fee strategy in the warning above'
        : undefined;

  const isMessage =
    transaction.type === 'personal_sign' ||
    transaction.type === 'eth_sign' ||
    String(transaction.type).startsWith('eth_signTypedData');
  const isAddChain = transaction.type === 'wallet_addEthereumChain';

  return (
    <Box>
      <Stack spacing="12px" paddingBottom="16px">
        <ProjectInfoCard transaction={transaction} />

        <ClearSignReportCard report={transaction?.clearSignReport} error={transaction?.clearSignReportError} />
        {siwe && <SiweCard siwe={siwe} acknowledged={siweAck} onAcknowledge={setSiweAck} />}
        {feeWarning && (
          <FeeWarningBanner
            eventId={transaction.id}
            warning={feeWarning}
            choice={feeChoice}
            onChoiceChange={setFeeChoice}
          />
        )}
        {/* Its green "Message signature" would contradict a sign-in for another site. */}
        {!siweDanger && <RequestMethodCard transaction={transaction} />}
        {transaction?.nonceInfo && (
          <NonceInfoRow
            nonceInfo={transaction.nonceInfo}
            address={transaction?.unsignedTx?.from}
            chainId={transaction?.unsignedTx?.chainId}
          />
        )}

        <Surface padding="4px 16px 16px">
          <Tabs defaultIndex={0} variant="unstyled" isLazy>
            <TabList borderBottom={`1px solid ${tokens.line}`}>
              <Tab {...tabStyle}>Details</Tab>
              {!isMessage && <Tab {...tabStyle}>Fees</Tab>}
              <Tab {...tabStyle}>Raw</Tab>
            </TabList>

            <TabPanels>
              <TabPanel padding="8px 0 0">
                <RequestDetailsCard transaction={transaction} />
              </TabPanel>

              {/* Message signatures produce no on-chain tx, so no fees tab. */}
              {!isMessage && (
                <TabPanel padding="12px 0 0">
                  {isAddChain ? (
                    <Text fontSize="12.5px" color={tokens.dim} textAlign="center" padding="16px 0">
                      No fees. This only saves the RPC configuration locally.
                    </Text>
                  ) : (
                    <RequestFeeCard transaction={transaction} />
                  )}
                </TabPanel>
              )}

              <TabPanel padding="12px 0 0">
                <RequestDataCard transaction={transaction} />
              </TabPanel>
            </TabPanels>
          </Tabs>
        </Surface>
      </Stack>

      {/* Sticky action bar: the decision is always one glance away, however long
          the request. Reject left, the single gold action right. */}
      <Box
        position="sticky"
        bottom={0}
        marginX="-16px"
        marginBottom="-16px"
        padding="16px 16px 18px"
        background={`linear-gradient(180deg, rgba(10,10,11,0) 0%, ${tokens.bg} 28%)`}
        zIndex={2}>
        {approveBlocked && blockReason && (
          <Text fontSize="12px" color={tokens.dim} textAlign="center" marginBottom="10px">
            {blockReason}
          </Text>
        )}
        <Grid templateColumns="1fr 1.4fr" gap="10px">
          <Button variant="keycapSecondary" height="46px" fontSize="12px" onClick={() => handleResponse('reject')}>
            Reject
          </Button>
          <Button
            variant="solid"
            height="46px"
            fontSize="12px"
            onClick={() => handleResponse('accept')}
            isDisabled={approveBlocked}
            title={blockReason}>
            Approve
          </Button>
        </Grid>
      </Box>
    </Box>
  );
}

export default EvmTransaction;
