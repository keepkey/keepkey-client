/** Test-only: static render of AssetIcon (not imported by the app). */
import { renderToStaticMarkup } from 'react-dom/server';
import { AssetIcon } from './AssetIcon';

export const renderAssetIcon = (p: Parameters<typeof AssetIcon>[0]) => renderToStaticMarkup(<AssetIcon {...p} />);
