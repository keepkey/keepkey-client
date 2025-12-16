import '@src/Options.css';
import { useEffect, useState } from 'react';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleSidebarStorage } from '@extension/storage'; // Re-import the storage
import type { DeviceInfo } from '@extension/storage';

const Options = () => {
  const [openSidebar, setOpenSidebar] = useState<boolean>(true);
  const [cacheEnabled, setCacheEnabledState] = useState<boolean>(true);
  const [hasCachedPubkeys, setHasCachedPubkeys] = useState<boolean>(false);
  const [cachedDeviceInfo, setCachedDeviceInfo] = useState<DeviceInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

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

  // Fetch cache status on component mount
  useEffect(() => {
    const fetchCacheStatus = async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_CACHED_PUBKEYS_STATUS',
        });

        if (!response.error) {
          setHasCachedPubkeys(response.hasCached);
          setCachedDeviceInfo(response.deviceInfo);
          setCacheEnabledState(response.cacheEnabled);
        }
      } catch (error) {
        console.error('Error fetching cache status:', error);
      }
    };

    fetchCacheStatus();
  }, []);

  // Handle toggle change
  const handleToggle = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.checked;
    setOpenSidebar(value);
    await exampleSidebarStorage.set(value);
  };

  const handleToggleCache = async () => {
    try {
      setLoading(true);
      const newValue = !cacheEnabled;
      const response = await chrome.runtime.sendMessage({
        type: 'SET_CACHE_ENABLED',
        enabled: newValue,
      });

      if (response.success) {
        setCacheEnabledState(newValue);
      }
    } catch (error) {
      console.error('Error toggling cache:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClearCache = async () => {
    if (!confirm('Clear all cached pubkeys? You will need to reconnect your device to use view-only mode.')) {
      return;
    }

    try {
      setLoading(true);
      const response = await chrome.runtime.sendMessage({
        type: 'CLEAR_CACHED_PUBKEYS',
      });

      if (response.success) {
        setHasCachedPubkeys(false);
        setCachedDeviceInfo(null);
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="options-container">
      <h1>Extension Options</h1>

      <section>
        <h2>Interface</h2>
        <label>
          <input type="checkbox" checked={openSidebar} onChange={handleToggle} />
          Open Sidebar instead of Popup
        </label>
      </section>

      <section>
        <h2>View-Only Mode Cache</h2>
        <p className="description">
          Cache your device's public keys to view balances and portfolio when your KeepKey is not connected. Signing
          transactions always requires your device.
        </p>

        <div className="cache-controls">
          <label>
            <input type="checkbox" checked={cacheEnabled} onChange={handleToggleCache} disabled={loading} />
            Enable pubkey caching
          </label>

          {hasCachedPubkeys && (
            <div className="cache-status">
              <p>
                <strong>Device:</strong> {cachedDeviceInfo?.label || 'Unknown'}
              </p>
              <button onClick={handleClearCache} disabled={loading} className="clear-cache-btn">
                Clear Cache
              </button>
            </div>
          )}

          {!hasCachedPubkeys && cacheEnabled && <p className="info">No cached pubkeys. Connect your device to enable view-only mode.</p>}
        </div>
      </section>
    </div>
  );
};

// Wrapping the component with error boundary and suspense
export default withErrorBoundary(withSuspense(Options, <div>Loading...</div>), <div>Error Occurred</div>);
