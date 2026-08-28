import { AppData, STORAGE_KEY } from '../types';
import { loadFromStorageString } from './validation';

const memoryStore = new Map<string, string>();

export function getStorage(): StorageLike {
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }
  return {
    getItem: (key) => memoryStore.get(key) ?? null,
    setItem: (key, value) => {
      memoryStore.set(key, value);
    },
    removeItem: (key) => {
      memoryStore.delete(key);
    },
  };
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadAppData(): AppData {
  const storage = getStorage();
  const raw = storage.getItem(STORAGE_KEY);
  return loadFromStorageString(raw);
}

export function saveAppData(data: AppData): void {
  const storage = getStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function clearAppData(): void {
  const storage = getStorage();
  storage.removeItem(STORAGE_KEY);
}

export function flushSave(data: AppData): void {
  saveAppData(data);
}

export function resetMemoryStore(): void {
  memoryStore.clear();
}
