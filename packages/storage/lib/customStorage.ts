import { BaseStorage, createStorage, StorageType } from './base';

type Event = {
  id: string;
  type: string;
  request: any;
  status: 'request' | 'approval' | 'completed';
  timestamp: string;
};

type ApiKeyStorage = BaseStorage<string> & {
  saveApiKey: (apiKey: string) => Promise<void>;
  getApiKey: () => Promise<string | null>;
};

type PioneerStorage = BaseStorage<string> & {
  savePioneerWss: (wss: string) => Promise<void>;
  getPioneerWss: () => Promise<string | null>;
  savePioneerSpec: (spec: string) => Promise<void>;
  getPioneerSpec: () => Promise<string | null>;
  saveQueryKey: (queryKey: string) => Promise<void>;
  getQueryKey: () => Promise<string | null>;
  saveUsername: (username: string) => Promise<void>;
  getUsername: () => Promise<string | null>;
};

type EventStorage = BaseStorage<Event[]> & {
  addEvent: (event: Event) => Promise<boolean>;
  getEvents: () => Promise<Event[] | null>;
  getEventById: (id: string) => Promise<Event | null>;
  removeEventById: (id: string) => Promise<void>;
  clearEvents: () => Promise<void>;
};

type Web3ProviderStorage = BaseStorage<string> & {
  saveWeb3Provider: (provider: string) => Promise<void>;
  getWeb3Provider: () => Promise<string | null>;
  clearWeb3Provider: () => Promise<void>;
};

type AssetContext = {
  [key: string]: any;
};

type AssetContextStorage = BaseStorage<AssetContext> & {
  updateContext: (newContext: AssetContext) => Promise<void>;
  clearContext: () => Promise<void>;
};

const TAG = ' | customStorage | ';

// Create Pioneer Storage
const createPioneerStorage = (): PioneerStorage => {
  const queryKeyStorage = createStorage<string>('pioneer-query-key', '', {
    storageType: StorageType.Local,
    liveUpdate: true,
  });

  const usernameStorage = createStorage<string>('pioneer-username', '', {
    storageType: StorageType.Local,
    liveUpdate: true,
  });

  const specStorage = createStorage<string>('pioneer-spec', '', {
    storageType: StorageType.Local,
    liveUpdate: true,
  });

  const wssStorage = createStorage<string>('pioneer-wss', '', {
    storageType: StorageType.Local,
    liveUpdate: true,
  });

  return {
    ...queryKeyStorage,
    ...usernameStorage,
    ...specStorage,
    ...wssStorage,
    savePioneerSpec: async (spec: string) => {
      await specStorage.set(() => spec);
    },
    getPioneerSpec: async () => {
      return await specStorage.get();
    },
    savePioneerWss: async (wss: string) => {
      await wssStorage.set(() => wss);
    },
    getPioneerWss: async () => {
      return await wssStorage.get();
    },
    saveQueryKey: async (queryKey: string) => {
      await queryKeyStorage.set(() => queryKey);
    },
    getQueryKey: async () => {
      return await queryKeyStorage.get();
    },
    saveUsername: async (username: string) => {
      await usernameStorage.set(() => username);
    },
    getUsername: async () => {
      return await usernameStorage.get();
    },
  };
};

export const pioneerKeyStorage = createPioneerStorage();

// Create API Key Storage
const createApiKeyStorage = (): ApiKeyStorage => {
  const storage = createStorage<string>('keepkey-api-key', '', {
    storageType: StorageType.Local,
    liveUpdate: true,
  });

  return {
    ...storage,
    saveApiKey: async (apiKey: string) => {
      await storage.set(() => apiKey);
    },
    getApiKey: async () => {
      return await storage.get();
    },
  };
};

export const keepKeyApiKeyStorage = createApiKeyStorage();

// Create Event Storage
const createEventStorage = (key: string): EventStorage => {
  const storage = createStorage<Event[]>(key, [], {
    storageType: StorageType.Local,
    liveUpdate: true,
  });

  return {
    ...storage,
    addEvent: async (event: Event): Promise<boolean> => {
      const tag = TAG + ' | addEvent | ';
      try {
        const eventWithTimestamp = { ...event, timestamp: new Date().toISOString() };
        console.log(tag, 'Adding event:', eventWithTimestamp);
        await storage.set(prev => [...prev, eventWithTimestamp]);
        const savedEvents = await storage.get();
        const isSaved = savedEvents ? savedEvents.some(e => e.id === eventWithTimestamp.id) : false;

        console.log(tag, 'Event saved successfully:', isSaved);
        return isSaved;
      } catch (error) {
        console.error(tag, 'Error saving event:', error);
        return false;
      }
    },
    getEvents: async () => {
      const tag = TAG + ' | getEvents | ';
      const events = await storage.get();
      console.log(tag, 'Retrieved events:', events);
      return events;
    },
    getEventById: async (id: string): Promise<Event | null> => {
      const tag = TAG + ' | getEventById | ';
      const events = await storage.get();
      const event = events ? events.find(event => event.id === id) : null;
      console.log(tag, `Event with id ${id}:`, event);
      return event || null;
    },
    removeEventById: async (id: string) => {
      const tag = TAG + ' | removeEventById | ';
      const events = await storage.get();
      if (events) {
        const updatedEvents = events.filter(event => event.id !== id);
        await storage.set(() => updatedEvents);
        console.log(tag, `Removed event with id ${id}. Updated events:`, updatedEvents);
      }
    },
    clearEvents: async () => {
      const tag = TAG + ' | clearEvents | ';
      await storage.set(() => []);
      console.log(tag, 'Cleared all events.');
    },
  };
};

// Create Web3 Provider Storage
const createWeb3ProviderStorage = (): Web3ProviderStorage => {
  const storage = createStorage<string>('web3-provider', '', {
    storageType: StorageType.Local,
    liveUpdate: true,
  });

  return {
    ...storage,
    saveWeb3Provider: async (provider: string) => {
      await storage.set(() => provider);
    },
    getWeb3Provider: async () => {
      return await storage.get();
    },
    clearWeb3Provider: async () => {
      await storage.set(() => '');
    },
  };
};

export const web3ProviderStorage = createWeb3ProviderStorage();

// Export Event Storages
export const requestStorage = createEventStorage('keepkey-requests');
export const approvalStorage = createEventStorage('keepkey-approvals');
export const completedStorage = createEventStorage('keepkey-completed');

// Create Asset Context Storage
const createAssetContextStorage = (): AssetContextStorage => {
  const storage = createStorage<AssetContext>(
    'keepkey-asset-context',
    {},
    {
      storageType: StorageType.Local,
      liveUpdate: true,
    },
  );

  return {
    ...storage,
    updateContext: async (newContext: AssetContext) => {
      await storage.set(prev => ({ ...prev, ...newContext }));
    },
    clearContext: async () => {
      await storage.set(() => ({}));
    },
  };
};

export const assetContextStorage = createAssetContextStorage();

// Utility function to move an event between storages
const moveEvent = async (
  eventId: string,
  fromStorage: EventStorage,
  toStorage: EventStorage,
  newStatus: 'approval' | 'completed',
) => {
  const tag = TAG + ' | moveEvent | ';
  const event = await fromStorage.getEventById(eventId);
  if (!event) throw new Error(`Event with id ${eventId} not found`);

  const updatedEvent = { ...event, status: newStatus };
  await fromStorage.removeEventById(eventId);
  const isMoved = await toStorage.addEvent(updatedEvent);

  console.log(tag, `Moved event with id ${eventId} to ${newStatus}. Move successful:`, isMoved);
  return isMoved;
};

export const approveEvent = async (eventId: string) => {
  const tag = TAG + ' | approveEvent | ';
  console.log(tag, `Approving event with id ${eventId}`);
  return await moveEvent(eventId, requestStorage, approvalStorage, 'approval');
};

export const completeEvent = async (eventId: string) => {
  const tag = TAG + ' | completeEvent | ';
  console.log(tag, `Completing event with id ${eventId}`);
  return await moveEvent(eventId, approvalStorage, completedStorage, 'completed');
};
