import { FormEvent, useState } from 'react';
import { useApp } from '../store/useApp';

interface QuickNoteInputProps {
  autoFocus?: boolean;
  /** Called after a note is successfully added — e.g. so a dialog can close itself. */
  onAdded?: () => void;
}

/**
 * The add-a-quick-note form: shared between the Today view's embedded
 * section and the top-bar QuickNoteDialog, so fast capture behaves
 * identically everywhere it appears (Enter submits, empty text is refused,
 * an explicit Add button covers mobile where Enter is less discoverable).
 */
export function QuickNoteInput({ autoFocus = false, onAdded }: QuickNoteInputProps) {
  const { dispatch } = useApp();
  const [text, setText] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    dispatch({ type: 'ADD_QUICK_NOTE', text: trimmed });
    setText('');
    onAdded?.();
  }

  return (
    <form className="quick-note-input" onSubmit={handleSubmit}>
      <label htmlFor="quick-note-text" className="visually-hidden">
        Add a quick reminder
      </label>
      <input
        id="quick-note-text"
        type="text"
        placeholder="Add a quick reminder…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus={autoFocus}
      />
      <button type="submit" disabled={!text.trim()}>
        Add
      </button>
    </form>
  );
}
