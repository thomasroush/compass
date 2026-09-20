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
  /** When true, renders only one-click Archive and Edit actions, hiding
   * Complete/Reopen, primary toggle, postpone, reorder, and status select.
   * Used by the Calendar view to keep rows scannable and let a passed or
   * irrelevant item be cleared in one click; other views are unaffected.
   * Archiving uses the same ARCHIVE_TASK as every other view and is separate
   * from completion — status and `completedAt` are left untouched. */
  minimalActions?: boolean;
  /** When true, shows the task's due time (if set) instead of the
   * "Due {date}" text — used by the Calendar view, which already groups
   * tasks under a date heading. */
  showTimeInsteadOfDate?: boolean;
}

function formatTime12h(time: string): string {
  const [hStr, mStr] = time.split(':');
  const h = Number(hStr);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${period}`;
}

export function TaskRow({
  task,
  showPrimaryToggle = false,
  showPostpone = false,
  showReorder = false,
  compact = false,
  minimalActions = false,
  showTimeInsteadOfDate = false,
}: TaskRowProps) {
  const { state, dispatch } = useApp();
  const [editing, setEditing] = useState(false);

  const project = state.projects.find((p) => p.id === task.projectId);
  const primaryCount = countPrimaryTodayTasks(state.tasks);
  const canSetPrimary = task.isPrimary || primaryCount < 3;

  function handleStatusChange(status: TaskStatus) {
    dispatch({ type: 'UPDATE_TASK', id: task.id, updates: { status } });
  }

  const archiveButton = (
    <button
      type="button"
      className="secondary"
      onClick={() => dispatch({ type: 'ARCHIVE_TASK', id: task.id })}
    >
      Archive
    </button>
  );

  return (
    <>
      <article className={`task-row ${compact ? 'compact' : ''}`}>
        <div className="task-row-main">
          <h3 className="task-title">{task.title}</h3>
          <div className="task-meta">
            {task.priority !== 'Normal' && (
              <span className="badge">{task.priority}</span>
            )}
            {showTimeInsteadOfDate
              ? task.dueTime && <span className="meta-text">{formatTime12h(task.dueTime)}</span>
              : task.dueDate && <span className="meta-text">Due {task.dueDate}</span>}
            {project && <span className="meta-text">{project.name}</span>}
            {task.isPrimary && <span className="badge primary">Primary</span>}
          </div>
          {task.notes && !compact && <p className="task-notes">{task.notes}</p>}
        </div>

        <div className="task-actions">
          {!minimalActions && showPrimaryToggle && task.status === 'Today' && (
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

          {!minimalActions && task.status !== 'Done' && (
            <button type="button" onClick={() => dispatch({ type: 'COMPLETE_TASK', id: task.id })}>
              Complete
            </button>
          )}

          {!minimalActions && task.status === 'Done' && (
            <button
              type="button"
              className="secondary"
              onClick={() => dispatch({ type: 'UNCOMPLETE_TASK', id: task.id })}
            >
              Reopen
            </button>
          )}

          {minimalActions && archiveButton}

          <button type="button" className="secondary" onClick={() => setEditing(true)}>
            Edit
          </button>

          {!minimalActions && showPostpone && (
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

          {!minimalActions && showReorder && (
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

          {!minimalActions && (
            <StatusSelect
              id={`status-${task.id}`}
              value={task.status}
              onChange={handleStatusChange}
              label="Move to"
            />
          )}

          {!minimalActions && archiveButton}
        </div>
      </article>

      {editing && <TaskForm task={task} onClose={() => setEditing(false)} />}
    </>
  );
}
