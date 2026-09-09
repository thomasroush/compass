import { useState } from 'react';
import { useApp } from '../store/useApp';
import { formatTargetValue, getTargetProgress } from '../store/reducer';
import type { Goal, Target } from '../types';
import { ProgressBar } from './ProgressBar';
import { TargetForm } from './TargetForm';

interface TargetRowProps {
  target: Target;
  goal: Goal;
}

/**
 * Mirrors TaskRow.tsx's shell (title/meta block + action row) and its
 * Up/Down REORDER_TASK pattern, adapted to REORDER_TARGET. Quick-update
 * controls are type-specific: numeric gets a current-value input, yes/no
 * gets an achieved checkbox, linked-tasks has no quick-update control (its
 * progress is read-only, derived entirely from linked Tasks' own statuses).
 * Archive/Restore only — no delete path exists for Targets.
 */
export function TargetRow({ target, goal }: TargetRowProps) {
  const { state, dispatch } = useApp();
  const [editing, setEditing] = useState(false);

  const progress = getTargetProgress(target, state.tasks);
  const linkedCompleted =
    target.type === 'linked-tasks'
      ? target.taskIds.filter((id) => state.tasks.find((t) => t.id === id)?.status === 'Done').length
      : 0;

  return (
    <>
      <li className={`task-row${target.archived ? ' archived' : ''}`}>
        <div className="task-row-main">
          <h4 className="task-title">{target.name}</h4>
          <ProgressBar progress={progress} label={`${target.name} progress`} />
          {target.type === 'numeric' && (
            <p className="meta-text">
              {formatTargetValue(target.currentValue, target)} / {formatTargetValue(target.targetValue, target)}
            </p>
          )}
          {target.type === 'linked-tasks' && (
            <p className="meta-text">
              {linkedCompleted} of {target.taskIds.length} linked tasks complete
            </p>
          )}
        </div>

        <div className="task-actions">
          {!target.archived && target.type === 'numeric' && (
            <div className="field">
              <label htmlFor={`target-current-${target.id}`}>Current value</label>
              <input
                id={`target-current-${target.id}`}
                type="number"
                value={target.currentValue}
                onChange={(e) =>
                  dispatch({
                    type: 'UPDATE_TARGET',
                    id: target.id,
                    updates: { currentValue: Number(e.target.value) || 0 },
                  })
                }
              />
            </div>
          )}

          {!target.archived && target.type === 'yesno' && (
            <label className="field checkbox-field">
              <input
                type="checkbox"
                checked={target.achieved}
                onChange={(e) =>
                  dispatch({ type: 'UPDATE_TARGET', id: target.id, updates: { achieved: e.target.checked } })
                }
              />
              Achieved
            </label>
          )}

          {!target.archived && (
            <>
              <button
                type="button"
                className="secondary"
                aria-label="Move up"
                onClick={() => dispatch({ type: 'REORDER_TARGET', id: target.id, direction: 'up' })}
              >
                Up
              </button>
              <button
                type="button"
                className="secondary"
                aria-label="Move down"
                onClick={() => dispatch({ type: 'REORDER_TARGET', id: target.id, direction: 'down' })}
              >
                Down
              </button>
              <button type="button" className="secondary" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => dispatch({ type: 'ARCHIVE_TARGET', id: target.id })}
              >
                Archive
              </button>
            </>
          )}

          {target.archived && (
            <button
              type="button"
              className="secondary"
              onClick={() => dispatch({ type: 'RESTORE_TARGET', id: target.id })}
            >
              Restore
            </button>
          )}
        </div>
      </li>

      {editing && <TargetForm goal={goal} target={target} onClose={() => setEditing(false)} />}
    </>
  );
}
