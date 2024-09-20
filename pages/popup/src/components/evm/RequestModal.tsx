import { ReactNode, useMemo, useState } from 'react';
import { Divider, Box, VStack } from '@chakra-ui/react';
// import { CoreTypes } from '@walletconnect/types';

// import ModalFooter, { LoaderProps } from '@/components/ModalFooter';
import ProjectInfoCard from './ProjectInfoCard';
import RequestModalContainer from './RequestModalContainer';
// import VerifyInfobox from '@/components/VerifyInfobox';
// import { useSnapshot } from 'valtio';
// import SettingsStore from '@/store/SettingsStore';
import ThreatPrompt from './ThreatPrompt';

interface IProps {
  children: ReactNode;
  metadata: any;
  onApprove: () => void;
  onReject: () => void;
  intention?: string;
  infoBoxCondition?: boolean;
  infoBoxText?: string;
  // approveLoader?: LoaderProps;
  // rejectLoader?: LoaderProps;
}

export default function RequestModal({
  children,
  metadata,
  onApprove,
  onReject,
  // approveLoader,
  // rejectLoader,
  intention,
  infoBoxCondition,
  infoBoxText,
}: IProps) {
  // const { currentRequestVerifyContext } = useSnapshot(SettingsStore.state);
  // const isScam = currentRequestVerifyContext?.verified.isScam;
  const isScam = false;
  const [threatAcknowledged, setThreatAcknowledged] = useState(false);

  const threatPromptContent = useMemo(() => {
    return <ThreatPrompt metadata={metadata} onApprove={() => setThreatAcknowledged(true)} onReject={onReject} />;
  }, [metadata, onReject]);

  const modalContent = useMemo(() => {
    return (
      <VStack spacing={4}>
        <RequestModalContainer title="">
          <ProjectInfoCard metadata={metadata} intention={intention} />
          <Divider my={4} />
          {children}
          <Divider my={4} />
          {/*<VerifyInfobox metadata={metadata} />*/}
        </RequestModalContainer>
        {/*<ModalFooter*/}
        {/*  onApprove={onApprove}*/}
        {/*  onReject={onReject}*/}
        {/*  approveLoader={approveLoader}*/}
        {/*  rejectLoader={rejectLoader}*/}
        {/*  infoBoxCondition={infoBoxCondition}*/}
        {/*  infoBoxText={infoBoxText}*/}
        {/*/>*/}
      </VStack>
    );
  }, [
    // approveLoader,
    children,
    infoBoxCondition,
    infoBoxText,
    intention,
    metadata,
    onApprove,
    onReject,
    // rejectLoader,
  ]);

  return <>{isScam && !threatAcknowledged ? threatPromptContent : modalContent}</>;
}
