import { useApp } from '../store/useApp';
import { getTasksByStatus } from '../store/reducer';
import { TaskRow } from '../components/TaskRow';
import { TASK_STATUSES } from '../types';

const [INBOX_STATUS, ...OTHER_STATUSES] = TASK_STATUSES;

export function BoardView() {
  const { state } = useApp();

  function renderColumn(status: (typeof TASK_STATUSES)[number]) {
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
  }

  return (
    <div className="view">
      <header className="view-header">
        <h1>Board</h1>
        <p className="subtitle">Move tasks between columns using the status selector.</p>
      </header>

      <div className="board">
        {renderColumn(INBOX_STATUS)}
        <div className="board-row">{OTHER_STATUSES.map(renderColumn)}</div>
      </div>
    </div>
  );
}
