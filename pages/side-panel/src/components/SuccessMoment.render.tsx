/** Test-only: static renders of the success moment and the txid page (not imported by the app). */
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import { SuccessMoment } from './SuccessMoment';
import TxidPage from '../approval/TxidPage';

export const renderSuccessMoment = (p: Parameters<typeof SuccessMoment>[0]) =>
  renderToStaticMarkup(<SuccessMoment {...p} />);

export const renderTxidPage = (p: Parameters<typeof TxidPage>[0]) =>
  renderToStaticMarkup(
    <ChakraProvider>
      <TxidPage {...p} />
    </ChakraProvider>,
  );
