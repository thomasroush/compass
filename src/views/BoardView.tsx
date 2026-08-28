import { useApp } from '../store/useApp';
import { getTasksByStatus } from '../store/reducer';
import { TaskRow } from '../components/TaskRow';
import { TASK_STATUSES } from '../types';

export function BoardView() {
  const { state } = useApp();

  return (
    <div className="view">
      <header className="view-header">
        <h1>Board</h1>
        <p className="subtitle">Move tasks between columns using the status selector.</p>
      </header>

      <div className="board">
        {TASK_STATUSES.map((status) => {
          const tasks = getTasksByStatus(state.tasks, status);
          return (
            <section key={status} className="board-column" aria-label={status}>
              <h2 className="column-title">
                {status}
                <span className="count">{tasks.length}</span>
              </h2>
              {tasks.length === 0 ? (
                <p className="empty column-empty">No tasks</p>
              ) : (
                <ul className="task-list">
                  {tasks.map((task) => (
                    <li key={task.id}>
                      <TaskRow task={task} showReorder compact />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
