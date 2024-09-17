import '@src/Options.css';
import { useEffect, useState } from 'react';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleSidebarStorage } from '@extension/storage'; // Re-import the storage

const Options = () => {
  const [openSidebar, setOpenSidebar] = useState<boolean>(true);

  // Fetch the stored preference on component mount
  useEffect(() => {
    const fetchSidebarPreference = async () => {
      const storedValue = await exampleSidebarStorage.get();
      if (typeof storedValue !== 'undefined') {
        setOpenSidebar(storedValue);
      } else {
        // Set default value to true if no preference is found
        await exampleSidebarStorage.set(true);
        setOpenSidebar(true);
      }
    };
    fetchSidebarPreference();
  }, []);

  // Handle toggle change
  const handleToggle = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.checked;
    setOpenSidebar(value);
    await exampleSidebarStorage.set(value);
  };

  return (
    <div className="options-container">
      <h1>Extension Options</h1>
      <label>
        <input type="checkbox" checked={openSidebar} onChange={handleToggle} />
        Open Sidebar instead of Popup
      </label>
    </div>
  );
};

// Wrapping the component with error boundary and suspense
export default withErrorBoundary(withSuspense(Options, <div>Loading...</div>), <div>Error Occurred</div>);
