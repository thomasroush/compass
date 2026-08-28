import {
  createContext,
  useEffect,
  useReducer,
  type ReactNode,
} from 'react';
import { createEmptyAppData, type AppData } from '../types';
import { flushSave, loadAppData } from '../storage/storage';
import { appReducer, type AppAction } from './reducer';

interface AppContextValue {
  state: AppData;
  dispatch: React.Dispatch<AppAction>;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, createEmptyAppData(), () => loadAppData());

  useEffect(() => {
    flushSave(state);
  }, [state]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>
  );
}
