import { useMemo, useState } from 'react';
import { useApp } from '../store/useApp';
import { TaskForm } from '../components/TaskForm';
import { TaskRow } from '../components/TaskRow';
import { getTriageTasks } from '../store/reducer';

export function TasksView() {
  const { state } = useApp();
  const [showNewForm, setShowNewForm] = useState(false);

  const triageTasks = useMemo(() => getTriageTasks(state.tasks), [state.tasks]);

  return (
    <div className="view">
      <header className="view-header view-header-row">
        <div>
          <h1>Tasks</h1>
          <p className="subtitle">
            Untriaged inbox — newest first. Assign a project, set a priority, or move a task out
            of Inbox to clear it from this list.
          </p>
        </div>
        <button type="button" onClick={() => setShowNewForm(true)}>
          New task
        </button>
      </header>

      {triageTasks.length === 0 ? (
        <p className="empty">Inbox is clear — no untriaged tasks.</p>
      ) : (
        <ul className="task-list">
          {triageTasks.map((task) => (
            <li key={task.id}>
              <TaskRow task={task} />
            </li>
          ))}
        </ul>
      )}

      {showNewForm && <TaskForm onClose={() => setShowNewForm(false)} />}
    </div>
  );
}
