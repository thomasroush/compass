import { useState } from 'react';
import { useApp } from '../store/useApp';
import { countPrimaryTodayTasks } from '../store/reducer';
import type { Task, TaskStatus } from '../types';
import { StatusSelect } from './StatusSelect';
import { TaskForm } from './TaskForm';

interface TaskRowProps {
  task: Task;
  showPrimaryToggle?: boolean;
  showPostpone?: boolean;
  showReorder?: boolean;
  compact?: boolean;
}

export function TaskRow({
  task,
  showPrimaryToggle = false,
  showPostpone = false,
  showReorder = false,
  compact = false,
}: TaskRowProps) {
  const { state, dispatch } = useApp();
  const [editing, setEditing] = useState(false);

  const project = state.projects.find((p) => p.id === task.projectId);
  const primaryCount = countPrimaryTodayTasks(state.tasks);
  const canSetPrimary = task.isPrimary || primaryCount < 3;

  function handleStatusChange(status: TaskStatus) {
    dispatch({ type: 'UPDATE_TASK', id: task.id, updates: { status } });
  }

  return (
    <>
      <article className={`task-row ${compact ? 'compact' : ''}`}>
        <div className="task-row-main">
          <h3 className="task-title">{task.title}</h3>
          <div className="task-meta">
            {task.priority !== 'Normal' && (
              <span className="badge">{task.priority}</span>
            )}
            {task.dueDate && <span className="meta-text">Due {task.dueDate}</span>}
            {project && <span className="meta-text">{project.name}</span>}
            {task.isPrimary && <span className="badge primary">Primary</span>}
          </div>
          {task.notes && !compact && <p className="task-notes">{task.notes}</p>}
        </div>

        <div className="task-actions">
          {showPrimaryToggle && task.status === 'Today' && (
            <button
              type="button"
              className="secondary"
              disabled={!canSetPrimary && !task.isPrimary}
              onClick={() =>
                dispatch({ type: 'SET_PRIMARY', id: task.id, isPrimary: !task.isPrimary })
              }
            >
              {task.isPrimary ? 'Remove primary' : 'Set primary'}
            </button>
          )}

          {task.status !== 'Done' && (
            <button type="button" onClick={() => dispatch({ type: 'COMPLETE_TASK', id: task.id })}>
              Complete
            </button>
          )}

          {task.status === 'Done' && (
            <button
              type="button"
              className="secondary"
              onClick={() => dispatch({ type: 'UNCOMPLETE_TASK', id: task.id })}
            >
              Reopen
            </button>
          )}

          <button type="button" className="secondary" onClick={() => setEditing(true)}>
            Edit
          </button>

          {showPostpone && (
            <>
              <button
                type="button"
                className="secondary"
                onClick={() => dispatch({ type: 'POSTPONE_DUE', id: task.id, days: 1 })}
              >
                Postpone 1 day
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => dispatch({ type: 'POSTPONE_TO_WEEK', id: task.id })}
              >
                Move to This Week
              </button>
            </>
          )}

          {showReorder && (
            <>
              <button
                type="button"
                className="secondary"
                aria-label="Move up"
                onClick={() => dispatch({ type: 'REORDER_TASK', id: task.id, direction: 'up' })}
              >
                Up
              </button>
              <button
                type="button"
                className="secondary"
                aria-label="Move down"
                onClick={() => dispatch({ type: 'REORDER_TASK', id: task.id, direction: 'down' })}
              >
                Down
              </button>
            </>
          )}

          <StatusSelect
            id={`status-${task.id}`}
            value={task.status}
            onChange={handleStatusChange}
            label="Move to"
          />

          <button
            type="button"
            className="secondary"
            onClick={() => dispatch({ type: 'ARCHIVE_TASK', id: task.id })}
          >
            Archive
          </button>
        </div>
      </article>

      {editing && <TaskForm task={task} onClose={() => setEditing(false)} />}
    </>
  );
}
