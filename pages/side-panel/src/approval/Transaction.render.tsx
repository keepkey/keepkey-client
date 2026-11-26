/** Test-only: static render of the approval card for a stored event (not imported by the app). */
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import Transaction from './Transaction';

export const renderTransactionCard = (event: any) =>
  renderToStaticMarkup(
    <ChakraProvider>
      <Transaction event={event} reloadEvents={() => {}} onDismiss={() => {}} />
    </ChakraProvider>,
  );
