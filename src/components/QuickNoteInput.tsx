import { FormEvent, useState } from 'react';
import { useApp } from '../store/useApp';
import {
  QUICK_NOTE_COUNTER_THRESHOLD,
  QUICK_NOTE_LIMIT_MESSAGE,
  QUICK_NOTE_MAX_LENGTH,
  countCharacters,
  exceedsLimit,
  formatCharacterCount,
  showCounter,
} from '../lib/noteLimits';

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
  // Only set once a submit attempt fails the length limit; the message itself
  // is recomputed live, so it clears as soon as the text is shortened.
  const [limitAttempted, setLimitAttempted] = useState(false);
  const length = countCharacters(text);
  const overLimit = exceedsLimit(length, QUICK_NOTE_MAX_LENGTH);
  const showLimitError = limitAttempted && overLimit;
  const showCharCounter = showCounter(length, QUICK_NOTE_COUNTER_THRESHOLD);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    // Refuse rather than truncate: the text stays in the field, untouched.
    if (overLimit) {
      setLimitAttempted(true);
      return;
    }
    dispatch({ type: 'ADD_QUICK_NOTE', text: trimmed });
    setText('');
    setLimitAttempted(false);
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
        aria-invalid={showLimitError || undefined}
        aria-describedby={showCharCounter ? 'quick-note-counter' : undefined}
      />
      <button type="submit" disabled={!text.trim()}>
        Add
      </button>
      {showCharCounter && (
        <p
          id="quick-note-counter"
          className={overLimit ? 'char-counter over-limit' : 'char-counter'}
        >
          {formatCharacterCount(length, QUICK_NOTE_MAX_LENGTH)}
        </p>
      )}
      {showLimitError && (
        <p className="message error" role="alert">
          {QUICK_NOTE_LIMIT_MESSAGE}
        </p>
      )}
    </form>
  );
}
