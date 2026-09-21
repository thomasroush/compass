import { describe, it, expect } from 'vitest';
import {
  QUICK_NOTE_COUNTER_THRESHOLD,
  QUICK_NOTE_LIMIT_MESSAGE,
  QUICK_NOTE_MAX_LENGTH,
  TASK_NOTES_COUNTER_THRESHOLD,
  TASK_NOTES_LIMIT_MESSAGE,
  TASK_NOTES_MAX_LENGTH,
  countCharacters,
  exceedsLimit,
  formatCharacterCount,
  showCounter,
} from './noteLimits';

describe('noteLimits — constants', () => {
  it('uses the agreed limits, thresholds, and messages', () => {
    expect(TASK_NOTES_MAX_LENGTH).toBe(25000);
    expect(TASK_NOTES_COUNTER_THRESHOLD).toBe(20000);
    expect(QUICK_NOTE_MAX_LENGTH).toBe(5000);
    expect(QUICK_NOTE_COUNTER_THRESHOLD).toBe(4000);
    expect(TASK_NOTES_LIMIT_MESSAGE).toBe(
      'Task notes are limited to 25,000 characters. Consider splitting longer material into multiple tasks.',
    );
    expect(QUICK_NOTE_LIMIT_MESSAGE).toBe(
      'Quick Notes are limited to 5,000 characters. Consider converting this note into a task or splitting it into multiple notes.',
    );
  });
});

describe('countCharacters', () => {
  it('counts plain text and the empty string', () => {
    expect(countCharacters('')).toBe(0);
    expect(countCharacters('hello')).toBe(5);
  });

  it('counts newlines as characters', () => {
    expect(countCharacters('a\nb')).toBe(3);
  });

  it('counts an astral character (emoji) as one, like Postgres char_length', () => {
    expect('\u{1F600}'.length).toBe(2);
    expect(countCharacters('\u{1F600}')).toBe(1);
    expect(countCharacters('a\u{1F600}b')).toBe(3);
  });
});

describe('exceedsLimit', () => {
  it('allows below and exactly at the limit, refuses above it', () => {
    expect(exceedsLimit(24999, 25000)).toBe(false);
    expect(exceedsLimit(25000, 25000)).toBe(false);
    expect(exceedsLimit(25001, 25000)).toBe(true);
  });

  it('tolerates an already-oversized record that has not grown', () => {
    expect(exceedsLimit(30000, 25000, 30000)).toBe(false);
    expect(exceedsLimit(28000, 25000, 30000)).toBe(false);
  });

  it('refuses an already-oversized record that has grown', () => {
    expect(exceedsLimit(30001, 25000, 30000)).toBe(true);
  });

  it('applies the limit in full when the stored length is within it', () => {
    expect(exceedsLimit(25001, 25000, 100)).toBe(true);
  });
});

describe('showCounter', () => {
  it('appears at the threshold, not before', () => {
    expect(showCounter(19999, 20000)).toBe(false);
    expect(showCounter(20000, 20000)).toBe(true);
    expect(showCounter(30000, 20000)).toBe(true);
  });
});

describe('formatCharacterCount', () => {
  it('formats with thousands separators', () => {
    expect(formatCharacterCount(20145, 25000)).toBe('20,145 / 25,000 characters');
    expect(formatCharacterCount(4000, 5000)).toBe('4,000 / 5,000 characters');
  });
});
