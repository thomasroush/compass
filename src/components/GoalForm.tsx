import { FormEvent, useEffect, useState } from 'react';
import { useApp } from '../store/useApp';
import { GOAL_STATUSES, PRIORITIES, generateId, type Goal, type GoalStatus, type Priority } from '../types';

interface GoalFormProps {
  goal?: Goal;
  onClose: () => void;
}

/**
 * Mirrors TaskForm.tsx's shell and staged-fields-applied-on-submit pattern.
 * Status uses a plain <select> bound to GOAL_STATUSES inline (no separate
 * status-select component, per instruction) and is only shown when editing —
 * a new Goal always starts 'active' (reducer's ADD_GOAL sets this).
 *
 * Linked Projects are staged locally (like every other field here) and
 * applied on submit as LINK_GOAL_PROJECT/UNLINK_GOAL_PROJECT dispatches —
 * UPDATE_GOAL has no projectIds field, since that's how the reducer already
 * models it. For a new Goal, an id is generated up front so those links can
 * target it in the same submit. A project already linked but no longer
 * active (archived) has no checkbox here and is therefore left untouched —
 * never silently unlinked just because it dropped out of this list.
 */
export function GoalForm({ goal, onClose }: GoalFormProps) {
  const { state, dispatch } = useApp();
  const isNew = !goal;

  const [name, setName] = useState(goal?.name ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  const [dueDate, setDueDate] = useState(goal?.dueDate ?? '');
  const [priority, setPriority] = useState<Priority>(goal?.priority ?? 'Normal');
  const [status, setStatus] = useState<GoalStatus>(goal?.status ?? 'active');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(goal?.projectIds ?? []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activeProjects = state.projects.filter((p) => p.status === 'active');

  function toggleProject(projectId: string, checked: boolean) {
    setSelectedProjectIds((prev) => (checked ? [...prev, projectId] : prev.filter((id) => id !== projectId)));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    if (isNew) {
      const id = generateId();
      dispatch({
        type: 'ADD_GOAL',
        id,
        name: trimmed,
        description: description.trim() || undefined,
        dueDate: dueDate || undefined,
        priority,
      });
      for (const projectId of selectedProjectIds) {
        dispatch({ type: 'LINK_GOAL_PROJECT', goalId: id, projectId });
      }
    } else {
      dispatch({
        type: 'UPDATE_GOAL',
        id: goal.id,
        name: trimmed,
        description: description.trim() || undefined,
        dueDate: dueDate || null,
        priority,
        status,
      });
      const originalIds = new Set(goal.projectIds);
      const nextIds = new Set(selectedProjectIds);
      for (const projectId of nextIds) {
        if (!originalIds.has(projectId)) {
          dispatch({ type: 'LINK_GOAL_PROJECT', goalId: goal.id, projectId });
        }
      }
      for (const projectId of originalIds) {
        if (!nextIds.has(projectId)) {
          dispatch({ type: 'UNLINK_GOAL_PROJECT', goalId: goal.id, projectId });
        }
      }
    }
    onClose();
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="goal-form-title">{isNew ? 'New goal' : 'Edit goal'}</h2>
        <form onSubmit={handleSubmit} className="stack-form">
          <div className="field">
            <label htmlFor="goal-name">Name</label>
            <input
              id="goal-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="goal-description">Description</label>
            <textarea
              id="goal-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="goal-due">Due date</label>
              <input id="goal-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>

            <div className="field">
              <label htmlFor="goal-priority">Priority</label>
              <select
                id="goal-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!isNew && (
            <div className="field">
              <label htmlFor="goal-status">Status</label>
              <select
                id="goal-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as GoalStatus)}
              >
                {GOAL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <fieldset className="field">
            <legend>Linked projects</legend>
            {activeProjects.length === 0 ? (
              <p className="section-help">No active projects to link.</p>
            ) : (
              <div className="checkbox-list">
                {activeProjects.map((p) => (
                  <label key={p.id} className="field checkbox-field">
                    <input
                      type="checkbox"
                      checked={selectedProjectIds.includes(p.id)}
                      onChange={(e) => toggleProject(p.id, e.target.checked)}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit">{isNew ? 'Add goal' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
