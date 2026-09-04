import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { LinkingChoice } from './components/LinkingChoice';
import { LoadingScreen } from './components/LoadingScreen';
import { LoginScreen } from './components/LoginScreen';
import { AppProvider } from './store/AppContext';
import { AuthProvider } from './store/AuthContext';
import { CloudSyncProvider } from './store/CloudSyncContext';
import { SyncEngineProvider } from './store/SyncEngineContext';
import { useAuth } from './store/useAuth';
import { useCloudSync } from './store/useCloudSync';
import { BoardView } from './views/BoardView';
import { CalendarView } from './views/CalendarView';
import { DailyNotesView } from './views/DailyNotesView';
import { ProjectsView } from './views/ProjectsView';
import { SettingsView } from './views/SettingsView';
import { TasksView } from './views/TasksView';
import { TodayView } from './views/TodayView';
import './app.css';

/**
 * Login-first gate (Part 2). Deliberately scoped to `isSupabaseConfigured`:
 * AGENTS.md's "Supabase is never required to start, load, or save data"
 * rule still holds for a deployment with no Supabase project configured —
 * there is nothing to sign in to, so the app opens straight to local-only
 * use exactly as before. When Supabase *is* configured, a real account
 * exists to protect, so a signed-out visitor sees only the login screen —
 * never the nav, views, or any project/task/note content.
 */
function AuthGate() {
  const auth = useAuth();
  const cloudSync = useCloudSync();

  if (auth.isSupabaseConfigured) {
    if (auth.status === 'loading') return <LoadingScreen />;
    if (!auth.user) return <LoginScreen />;
    // Blocks the rest of the app until this device's relationship to the
    // account's data is explicitly resolved — see LinkingChoice.tsx.
    if (cloudSync.status === 'needs-choice') return <LinkingChoice />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<TodayView />} />
        <Route path="board" element={<BoardView />} />
        <Route path="tasks" element={<TasksView />} />
        <Route path="projects" element={<ProjectsView />} />
        <Route path="notes" element={<DailyNotesView />} />
        <Route path="calendar" element={<CalendarView />} />
        <Route path="settings" element={<SettingsView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <CloudSyncProvider>
          <SyncEngineProvider>
            <BrowserRouter>
              <AuthGate />
            </BrowserRouter>
          </SyncEngineProvider>
        </CloudSyncProvider>
      </AppProvider>
    </AuthProvider>
  );
}
