/** Test-only: static render of the Enable-long-posts view (not imported by the app). */
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import { EnableLongPostsView, type EnableLongPostsViewProps } from './EnableLongPosts';

export const renderEnableLongPosts = (p: EnableLongPostsViewProps) =>
  renderToStaticMarkup(
    <ChakraProvider>
      <EnableLongPostsView {...p} />
    </ChakraProvider>,
  );
