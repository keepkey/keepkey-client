import {
  Avatar,
  Button,
  Card,
  CardHeader,
  Flex,
  Spinner,
  Stack,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Divider,
} from '@chakra-ui/react';
import React, { useEffect, useState } from 'react';
import RequestFeeCard from './RequestFeeCard';
import RequestDataCard from './RequestDataCard';
import RequestDetailsCard from './RequestDetailsCard';
import ContractDetailsCard from './ContractDetailsCard';
import RequestMethodCard from './RequestMethodCard';
import ProjectInfoCard from './ProjectInfoCard';
import FeeWarningBanner from './FeeWarningBanner';
import NonceInfoRow from './NonceInfoRow';
import SiweCard from './SiweCard';

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
  const approveBlocked = feeBlocked || siweBlocked;

  return (
    <Stack>
      <ProjectInfoCard transaction={transaction} />

      <Divider />
      {siwe && <SiweCard siwe={siwe} acknowledged={siweAck} onAcknowledge={setSiweAck} />}
      {feeWarning && (
        <FeeWarningBanner
          eventId={transaction.id}
          warning={feeWarning}
          choice={feeChoice}
          onChoiceChange={setFeeChoice}
        />
      )}
      {transaction?.nonceInfo && (
        <NonceInfoRow
          nonceInfo={transaction.nonceInfo}
          address={transaction?.unsignedTx?.from}
          chainId={transaction?.unsignedTx?.chainId}
        />
      )}
      {/* Its green "Safe Method" would contradict a sign-in for another site. */}
      {!siweDanger && <RequestMethodCard transaction={transaction} />}
      <Divider />
      <Tabs defaultIndex={0}>
        <TabList>
          {/*<Tab>Insight</Tab>*/}
          <Tab>Details</Tab>
          <Tab>Fees</Tab>
          <Tab>Raw</Tab>
        </TabList>

        <TabPanels>
          {/* Contract Tab */}
          {/*<TabPanel>*/}
          {/*  <ContractDetailsCard transaction={transaction} />*/}
          {/*</TabPanel>*/}

          {/* Review Tab */}
          <TabPanel>
            <RequestDetailsCard transaction={transaction} />
          </TabPanel>

          {/* Fees Tab — skip for methods that don't produce an on-chain tx */}
          <TabPanel>
            {transaction.type !== 'personal_sign' &&
              transaction.type !== 'eth_sign' &&
              transaction.type !== 'wallet_addEthereumChain' && (
                <>
                  <RequestFeeCard transaction={transaction} />
                </>
              )}
            {transaction.type === 'wallet_addEthereumChain' && (
              <Flex justify="center" p={6}>
                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center' }}>
                  No transaction fees — this flow only stores the RPC configuration locally.
                </div>
              </Flex>
            )}
          </TabPanel>

          {/* Raw Data Tab */}
          <TabPanel>
            <RequestDataCard transaction={transaction} />
          </TabPanel>
        </TabPanels>
      </Tabs>

      <Divider />

      <Flex justifyContent="center" alignItems="center">
        <Button
          variant="solid"
          onClick={() => handleResponse('accept')}
          mr={2}
          isDisabled={approveBlocked}
          title={
            siweBlocked
              ? 'Confirm the sign-in warning above'
              : feeBlocked
                ? 'Pick a fee strategy in the warning banner above'
                : undefined
          }>
          Approve
        </Button>
        <Button variant="keycapSecondary" onClick={() => handleResponse('reject')}>
          Reject
        </Button>
      </Flex>
    </Stack>
  );
}

export default EvmTransaction;
