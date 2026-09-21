/**
 * Length limits for free-text notes, enforced in the app's forms only — there
 * is no database-level limit.
 */
export const TASK_NOTES_MAX_LENGTH = 25000;
export const TASK_NOTES_COUNTER_THRESHOLD = 20000;
export const QUICK_NOTE_MAX_LENGTH = 5000;
export const QUICK_NOTE_COUNTER_THRESHOLD = 4000;

export const TASK_NOTES_LIMIT_MESSAGE =
  'Task notes are limited to 25,000 characters. Consider splitting longer material into multiple tasks.';
export const QUICK_NOTE_LIMIT_MESSAGE =
  'Quick Notes are limited to 5,000 characters. Consider converting this note into a task or splitting it into multiple notes.';

/**
 * Length in Unicode code points — the same unit Postgres's char_length()
 * counts — so a note the UI accepts is never rejected by the database
 * (String.length would count an emoji as two).
 */
export function countCharacters(text: string): number {
  // Each surrogate pair (one astral character) is two UTF-16 units but one code point.
  return text.length - (text.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0);
}

/**
 * True when `length` is over `max` and the save should be refused. A record
 * saved before the limit existed may already be longer than `max`; it is
 * tolerated as long as it does not grow (`existingLength` is its stored
 * length), so it stays editable and can be shortened but never extended.
 */
export function exceedsLimit(length: number, max: number, existingLength = 0): boolean {
  return length > max && length > existingLength;
}

/** Whether the "n / max characters" counter should be on screen yet. */
export function showCounter(length: number, threshold: number): boolean {
  return length >= threshold;
}

export function formatCharacterCount(length: number, max: number): string {
  return `${length.toLocaleString('en-US')} / ${max.toLocaleString('en-US')} characters`;
}
