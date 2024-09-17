import { BaseStorage, createStorage, StorageType } from './base';

type Theme = 'light' | 'dark';
type SidebarPreference = boolean;

type ThemeStorage = BaseStorage<Theme> & {
  toggleTheme: () => Promise<void>;
};

type SidebarStorage = BaseStorage<SidebarPreference> & {
  toggleSidebar: () => Promise<void>;
};

// Storage for theme preference
const themeStorage = createStorage<Theme>('theme-storage-key', 'dark', {
  storageType: StorageType.Local,
  liveUpdate: true,
});

// Storage for sidebar preference
const sidebarStorage = createStorage<SidebarPreference>('sidebar-storage-key', true, {
  storageType: StorageType.Local,
  liveUpdate: true,
});

// Example theme storage with a toggle function
export const exampleThemeStorage: ThemeStorage = {
  ...themeStorage,
  toggleTheme: async () => {
    await themeStorage.set(currentTheme => {
      return currentTheme === 'dark' ? 'light' : 'dark';
    });
  },
};

// Example sidebar storage with a toggle function
export const exampleSidebarStorage: SidebarStorage = {
  ...sidebarStorage,
  toggleSidebar: async () => {
    await sidebarStorage.set(currentSidebar => {
      return currentSidebar === true ? false : true;
    });
  },
};
