import { useEffect } from 'react';
// import { Button } from '@extension/ui';
// import { useStorage } from '@extension/shared';
// import { exampleThemeStorage } from '@extension/storage';

export default function App() {
  // const theme = useStorage(exampleThemeStorage);

  useEffect(() => {
    console.log('content ui loaded');
  }, []);

  return <div className="flex items-center justify-between gap-2 bg-blue-100 rounded py-1 px-2"></div>;
}
