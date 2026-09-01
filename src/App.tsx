import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AppProvider } from './store/AppContext';
import { AuthProvider } from './store/AuthContext';
import { CloudSyncProvider } from './store/CloudSyncContext';
import { BoardView } from './views/BoardView';
import { DailyNotesView } from './views/DailyNotesView';
import { ProjectsView } from './views/ProjectsView';
import { SettingsView } from './views/SettingsView';
import { TasksView } from './views/TasksView';
import { TodayView } from './views/TodayView';
import './app.css';

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <CloudSyncProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<TodayView />} />
                <Route path="board" element={<BoardView />} />
                <Route path="tasks" element={<TasksView />} />
                <Route path="projects" element={<ProjectsView />} />
                <Route path="notes" element={<DailyNotesView />} />
                <Route path="settings" element={<SettingsView />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </CloudSyncProvider>
      </AppProvider>
    </AuthProvider>
  );
}
