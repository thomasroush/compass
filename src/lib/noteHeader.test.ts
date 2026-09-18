import { describe, it, expect } from 'vitest';
import {
  addNoteHeader,
  formatNoteHeader,
  noteAuthorName,
  removeEmptyNoteHeader,
} from './noteHeader';

describe('noteAuthorName', () => {
  it('uses the part of the email before the @', () => {
    expect(noteAuthorName('tom@example.com')).toBe('tom');
  });

  it('has no name when there is no email', () => {
    expect(noteAuthorName(undefined)).toBeUndefined();
    expect(noteAuthorName(null)).toBeUndefined();
    expect(noteAuthorName('  ')).toBeUndefined();
  });
});

describe('formatNoteHeader', () => {
  it('formats afternoon time without seconds, with AM/PM and MM/DD/YYYY', () => {
    expect(formatNoteHeader('Tom', new Date(2026, 8, 18, 15, 58, 42))).toBe(
      'Tom — 3:58 PM 09/18/2026',
    );
  });

  it('formats morning time with a zero-padded minute and no leading hour zero', () => {
    expect(formatNoteHeader('Gina', new Date(2026, 8, 19, 9, 4))).toBe('Gina — 9:04 AM 09/19/2026');
  });

  it('shows midnight and noon as 12 AM and 12 PM', () => {
    expect(formatNoteHeader('Tom', new Date(2026, 0, 5, 0, 0))).toBe('Tom — 12:00 AM 01/05/2026');
    expect(formatNoteHeader('Tom', new Date(2026, 0, 5, 12, 30))).toBe('Tom — 12:30 PM 01/05/2026');
  });
});

describe('addNoteHeader', () => {
  const header = 'Tom — 3:58 PM 09/18/2026';

  it('puts the first character of a new note under the header', () => {
    expect(addNoteHeader('', 'C', header)).toBe(`${header}\nC`);
  });

  it('separates a new entry from existing notes with a blank line', () => {
    expect(addNoteHeader('Old note', 'Old noteC', header)).toBe(`Old note\n\n${header}\nC`);
  });

  it('moves text inserted mid-notes to the bottom, keeping the existing text intact', () => {
    expect(addNoteHeader('Line one', 'Line X one', header)).toBe(`Line one\n\n${header}\nX `);
  });

  it('returns null for deletions, replacements, and whitespace-only insertions', () => {
    expect(addNoteHeader('Old note', 'Old not', header)).toBeNull();
    expect(addNoteHeader('Old note', 'Old nXte', header)).toBeNull();
    expect(addNoteHeader('Old note', 'Old note ', header)).toBeNull();
    expect(addNoteHeader('Old note', 'Old note', header)).toBeNull();
    expect(addNoteHeader('', '\n', header)).toBeNull();
  });
});

describe('removeEmptyNoteHeader', () => {
  const header = 'Tom — 3:58 PM 09/18/2026';

  it('removes a header with nothing under it, and the separating blank line', () => {
    expect(removeEmptyNoteHeader(`Old note\n\n${header}\n`, header)).toBe('Old note');
    expect(removeEmptyNoteHeader(`${header}\n`, header)).toBe('');
  });

  it('leaves notes that have text under the header unchanged', () => {
    const notes = `Old note\n\n${header}\nCalled back.`;
    expect(removeEmptyNoteHeader(notes, header)).toBe(notes);
  });
});
