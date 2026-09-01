import { useContext } from 'react';
import { SyncEngineContext } from './SyncEngineContext';

export function useSyncEngine() {
  const ctx = useContext(SyncEngineContext);
  if (!ctx) throw new Error('useSyncEngine must be used within SyncEngineProvider');
  return ctx;
}
