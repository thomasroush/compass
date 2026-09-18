import { ChangeEvent, FormEvent, MouseEvent, useEffect, useRef, useState } from 'react';
import { useApp } from '../store/useApp';
import { useAuth } from '../store/useAuth';
import { downloadTaskIcs } from '../lib/ics';
import {
  addNoteHeader,
  formatNoteHeader,
  noteAuthorName,
  removeEmptyNoteHeader,
} from '../lib/noteHeader';
import { PRIORITIES, TASK_STATUSES, type Task, type TaskStatus } from '../types';

/**
 * Synthetic placement value shown only in this form's own dropdown —
 * `calendarOnly` is not a `TaskStatus` (see Task.calendarOnly's doc comment)
 * and deliberately never reaches TaskRow's compact inline "Move to"
 * dropdown, which keeps using the plain `StatusSelect` component unchanged.
 */
const CALENDAR_ONLY_PLACEMENT = 'calendar-only' as const;
type PlacementValue = TaskStatus | typeof CALENDAR_ONLY_PLACEMENT;

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
  const { user } = useAuth();
  const isNew = !task;
  // The header added to Notes in this editing session, if any — at most one.
  const noteHeaderRef = useRef<string | null>(null);

  const [title, setTitle] = useState(task?.title ?? initialTitle ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'Inbox');
  const [calendarOnly, setCalendarOnly] = useState(task?.calendarOnly ?? false);
  const [priority, setPriority] = useState(task?.priority ?? 'Normal');
  const [projectId, setProjectId] = useState(task?.projectId ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(task?.dueTime ?? '');
  // Only set once a submit attempt actually fails the calendar-only/due-date
  // rule — recomputed live against the current field values below, so it
  // clears itself the moment the user fixes it, without a separate effect.
  const [dueDateErrorAttempted, setDueDateErrorAttempted] = useState(false);
  const showDueDateError = dueDateErrorAttempted && calendarOnly && !dueDate;

  function handlePlacementChange(value: PlacementValue) {
    if (value === CALENDAR_ONLY_PLACEMENT) {
      setCalendarOnly(true);
    } else {
      setCalendarOnly(false);
      setStatus(value);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activeProjects = state.projects.filter((p) => p.status === 'active');

  // The first time new text is actually typed into Notes, append the writer's
  // "Name — time date" header at the bottom and put that text underneath it.
  // Focusing the field, or only deleting/replacing existing text, adds nothing.
  // Skipped when nobody is signed in (local-only mode has no identity to show).
  function handleNotesChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    const author = noteAuthorName(user?.email);
    if (!noteHeaderRef.current && author) {
      const header = formatNoteHeader(author);
      const withHeader = addNoteHeader(notes, next, header);
      if (withHeader !== null) {
        noteHeaderRef.current = header;
        setNotes(withHeader);
        return;
      }
    }
    setNotes(next);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    if (calendarOnly && !dueDate) {
      setDueDateErrorAttempted(true);
      return;
    }

    // Calendar only is a placement/visibility flag, not a workflow status —
    // it always stores 'Inbox' as its underlying status (see
    // Task.calendarOnly's doc comment); any real status is exactly what the
    // dropdown last selected.
    const finalStatus: TaskStatus = calendarOnly ? 'Inbox' : status;

    // Never save a header the user typed under and then erased.
    const finalNotes = noteHeaderRef.current
      ? removeEmptyNoteHeader(notes, noteHeaderRef.current)
      : notes;

    if (isNew) {
      dispatch({
        type: 'ADD_TASK',
        title: trimmed,
        status: finalStatus,
        notes: finalNotes.trim() || undefined,
        priority,
        projectId: projectId || undefined,
        dueDate: dueDate || undefined,
        dueTime: dueDate ? dueTime || undefined : undefined,
        calendarOnly,
      });
      onCreated?.();
    } else {
      dispatch({
        type: 'UPDATE_TASK',
        id: task.id,
        updates: {
          title: trimmed,
          notes: finalNotes.trim() || undefined,
          status: finalStatus,
          priority,
          projectId: projectId || undefined,
          dueDate: dueDate || undefined,
          dueTime: dueDate ? dueTime || undefined : undefined,
          calendarOnly,
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
              onChange={handleNotesChange}
            />
          </div>

          <div className="field">
            <label htmlFor="task-status">Status</label>
            <select
              id="task-status"
              value={calendarOnly ? CALENDAR_ONLY_PLACEMENT : status}
              onChange={(e) => handlePlacementChange(e.target.value as PlacementValue)}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value={CALENDAR_ONLY_PLACEMENT}>Calendar only</option>
            </select>
          </div>

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

          {showDueDateError && (
            <p className="message error" role="alert">
              Calendar only requires a due date.
            </p>
          )}

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
