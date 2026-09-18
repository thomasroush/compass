/**
 * Attribution headers for task Notes. A header is plain text written into the
 * existing `notes` string ("Tom — 3:58 PM 09/18/2026"), so it needs no schema,
 * sync, or permission changes — it is saved exactly like anything else typed
 * into Notes.
 */

/** Author name for a header: the part of the account email before the `@`. */
export function noteAuthorName(email: string | null | undefined): string | undefined {
  const trimmed = email?.trim();
  if (!trimmed) return undefined;
  return trimmed.split('@')[0] || trimmed;
}

/**
 * "Tom — 3:58 PM 09/18/2026", in the writer's local time. Formatted by hand
 * rather than via `toLocaleTimeString` so the output is identical in every
 * browser and locale (recent ICU builds put a narrow no-break space before
 * AM/PM).
 */
export function formatNoteHeader(author: string, now: Date = new Date()): string {
  const hours24 = now.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const meridiem = hours24 < 12 ? 'AM' : 'PM';
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${author} — ${hours12}:${minutes} ${meridiem} ${month}/${day}/${now.getFullYear()}`;
}

/**
 * Called for the first edit of a Notes field in an editing session. When `next`
 * differs from `previous` only by newly inserted, non-blank text, returns the
 * Notes value with the header appended at the bottom and the inserted text
 * placed underneath it (existing text is kept exactly, separated from the new
 * entry by a blank line). The caret naturally ends up after the typed text,
 * because that is the end of the value.
 *
 * Returns `null` for any other edit — deleting or replacing existing text, or
 * inserting only whitespace — meaning "an ordinary edit, no header yet".
 */
export function addNoteHeader(previous: string, next: string, header: string): string | null {
  let start = 0;
  const shortest = Math.min(previous.length, next.length);
  while (start < shortest && previous[start] === next[start]) start++;

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd--;
    nextEnd--;
  }

  if (previousEnd !== start) return null;
  const inserted = next.slice(start, nextEnd);
  if (!inserted.trim()) return null;

  const existing = previous.trim() ? `${previous}\n\n` : '';
  return `${existing}${header}\n${inserted}`;
}

/**
 * Removes a header that was added this session but never given any text (the
 * user typed, then deleted it again), so no empty header is ever saved.
 * Notes that continue past the header are returned unchanged.
 */
export function removeEmptyNoteHeader(notes: string, header: string): string {
  const trimmed = notes.trimEnd();
  if (!trimmed.endsWith(header)) return notes;
  return trimmed.slice(0, trimmed.length - header.length).trimEnd();
}
