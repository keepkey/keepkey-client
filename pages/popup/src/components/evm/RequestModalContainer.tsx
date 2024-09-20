import { Fragment, ReactNode } from 'react';
import { Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, Text, Box } from '@chakra-ui/react';

/**
 * Types
 */
interface IProps {
  title?: string;
  children: ReactNode | ReactNode[];
}

/**
 * Component
 */
export default function RequestModalContainer({ children, title }: IProps) {
  return (
    <Fragment>
      <Modal isOpen={true} onClose={() => {}}>
        <ModalOverlay />
        <ModalContent>
          {title && (
            <ModalHeader>
              <Text fontSize="2xl">{title}</Text>
            </ModalHeader>
          )}
          <ModalBody>
            <Box p={0}>{children}</Box>
          </ModalBody>
        </ModalContent>
      </Modal>
    </Fragment>
  );
}
