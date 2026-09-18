import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { buildTaskIcs } from './ics';

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test task',
    status: 'Today',
    priority: 'Normal',
    createdAt: '2026-09-01T00:00:00.000Z',
    sortOrder: 0,
    isPrimary: false,
    archived: false,
    calendarOnly: false,
    ...overrides,
  };
}

describe('buildTaskIcs', () => {
  it('returns null when the task has no due date (calendar export unavailable)', () => {
    expect(buildTaskIcs(baseTask({ dueDate: undefined }))).toBeNull();
  });

  it('generates an all-day event for a date-only task', () => {
    const ics = buildTaskIcs(baseTask({ dueDate: '2026-09-20' }));
    expect(ics).toContain('DTSTART;VALUE=DATE:20260920');
    // All-day DTEND is exclusive per RFC 5545, so it's the day after dueDate.
    expect(ics).toContain('DTEND;VALUE=DATE:20260921');
    expect(ics).not.toMatch(/DTSTART:\d{8}T/);
  });

  it('generates a timed event with a one-hour default duration', () => {
    const ics = buildTaskIcs(baseTask({ dueDate: '2026-09-20', dueTime: '14:30' }));
    expect(ics).toContain('DTSTART:20260920T143000');
    expect(ics).toContain('DTEND:20260920T153000');
    expect(ics).not.toMatch(/VALUE=DATE/);
  });

  it('escapes commas, semicolons, backslashes, and line breaks', () => {
    const ics = buildTaskIcs(
      baseTask({
        title: 'Buy milk, eggs; and bread\\now',
        notes: 'Line one\nLine two',
        dueDate: '2026-09-20',
      }),
    );
    expect(ics).toContain('SUMMARY:Buy milk\\, eggs\\; and bread\\\\now');
    expect(ics).toContain('Line one\\nLine two');
  });
});
