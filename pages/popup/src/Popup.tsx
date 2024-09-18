import '@src/Popup.css';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import EventsViewer from './components/Events';

const Popup = () => {
  return (
    <div>
      Popup
      <EventsViewer></EventsViewer>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Popup, <div> Loading ... </div>), <div> Error Occur </div>);
