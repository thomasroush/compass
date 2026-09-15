import { FormEvent, MouseEvent, useEffect, useState } from 'react';
import { useApp } from '../store/useApp';
import { downloadTaskIcs } from '../lib/ics';
import { PRIORITIES, type Task, type TaskStatus } from '../types';
import { StatusSelect } from './StatusSelect';

interface TaskFormProps {
  task?: Task;
  onClose: () => void;
  /** Pre-fills the title field for a new task — used by "Convert to Task" from a Quick Note. Ignored when editing an existing task. */
  initialTitle?: string;
  /** Called right after a new task is successfully added (never for an edit) — used to remove the source Quick Note so it isn't duplicated. */
  onCreated?: () => void;
}

export function TaskForm({ task, onClose, initialTitle, onCreated }: TaskFormProps) {
  const { state, dispatch } = useApp();
  const isNew = !task;

  const [title, setTitle] = useState(task?.title ?? initialTitle ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'Inbox');
  const [priority, setPriority] = useState(task?.priority ?? 'Normal');
  const [projectId, setProjectId] = useState(task?.projectId ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(task?.dueTime ?? '');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activeProjects = state.projects.filter((p) => p.status === 'active');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    if (isNew) {
      dispatch({
        type: 'ADD_TASK',
        title: trimmed,
        status,
        notes: notes.trim() || undefined,
        priority,
        projectId: projectId || undefined,
        dueDate: dueDate || undefined,
        dueTime: dueDate ? dueTime || undefined : undefined,
      });
      onCreated?.();
    } else {
      dispatch({
        type: 'UPDATE_TASK',
        id: task.id,
        updates: {
          title: trimmed,
          notes: notes.trim() || undefined,
          status,
          priority,
          projectId: projectId || undefined,
          dueDate: dueDate || undefined,
          dueTime: dueDate ? dueTime || undefined : undefined,
        },
      });
    }
    onClose();
  }

  function handleAddToCalendar(e: MouseEvent) {
    e.preventDefault();
    if (!task?.dueDate) return;
    const projectName = state.projects.find((p) => p.id === task.projectId)?.name;
    downloadTaskIcs(task, { projectName });
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="task-form-title">{isNew ? 'New task' : 'Edit task'}</h2>
        <form onSubmit={handleSubmit} className="stack-form">
          <div className="field">
            <label htmlFor="task-title">Title</label>
            <input
              id="task-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="task-notes">Notes</label>
            <textarea
              id="task-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <StatusSelect id="task-status" value={status} onChange={setStatus} />

          <div className="field">
            <label htmlFor="task-priority">Priority</label>
            <select
              id="task-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Task['priority'])}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="task-project">Project</label>
            <select
              id="task-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">None</option>
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="task-due">Due date</label>
              <input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="task-due-time">Time (optional)</label>
              <input
                id="task-due-time"
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                disabled={!dueDate}
              />
            </div>
          </div>

          <div className="dialog-actions">
            {!isNew && task.dueDate && (
              <button
                type="button"
                className="secondary calendar-export-btn"
                onClick={handleAddToCalendar}
              >
                Add to Calendar
              </button>
            )}
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit">{isNew ? 'Add task' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
