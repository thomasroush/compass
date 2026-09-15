import { useState } from 'react';
import { useApp } from '../store/useApp';
import { useCloudSync } from '../store/useCloudSync';
import { getActiveQuickNotes } from '../store/reducer';
import type { QuickNote } from '../types';
import { QuickNoteInput } from './QuickNoteInput';
import { TaskForm } from './TaskForm';

/**
 * Embedded in the Today view, above the regular task list (requirement 2):
 * fast capture for small reminders that should never appear on the Kanban
 * board unless explicitly converted into a task (requirement 8). Checking a
 * note is the only completion/removal control — it dispatches
 * COMPLETE_QUICK_NOTE (unchanged, still synced) and the note simply leaves
 * this list; there is no "Recently completed" view to reopen or purge it
 * from.
 */
export function QuickNotesSection() {
  const { state, dispatch } = useApp();
  const { quickNotesError } = useCloudSync();
  const [convertingNote, setConvertingNote] = useState<QuickNote | null>(null);

  const active = getActiveQuickNotes(state.quickNotes);

  return (
    <section className="section quick-notes-section">
      <h2>Quick Notes</h2>
      <p className="section-help">Fast reminders and ideas — not tasks unless you convert them.</p>

      {quickNotesError && (
        <p className="message error" role="alert">
          Quick Notes could not be synced with your account just now: {quickNotesError} Changes are
          still saved on this device and will sync automatically once this is resolved.
        </p>
      )}

      <QuickNoteInput autoFocus={false} />

      {active.length === 0 ? (
        <p className="empty">No quick notes yet.</p>
      ) : (
        <ul className="quick-note-list">
          {active.map((note) => (
            <li key={note.id} className="quick-note-row">
              <label className="quick-note-checkbox">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => dispatch({ type: 'COMPLETE_QUICK_NOTE', id: note.id })}
                  aria-label={`Mark "${note.text}" complete`}
                />
                <span className="quick-note-text">{note.text}</span>
              </label>
              <div className="quick-note-actions">
                <button type="button" className="secondary" onClick={() => setConvertingNote(note)}>
                  Convert to Task
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {convertingNote && (
        <TaskForm
          initialTitle={convertingNote.text}
          onCreated={() => dispatch({ type: 'DELETE_QUICK_NOTE', id: convertingNote.id })}
          onClose={() => setConvertingNote(null)}
        />
      )}
    </section>
  );
}
