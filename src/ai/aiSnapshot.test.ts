import { describe, expect, it } from 'vitest';
import { buildAISnapshot, formatGeneratedAt } from './aiSnapshot';
import { createTaskForTest } from '../store/reducer';
import type { Project, Task } from '../types';

function project(overrides: Partial<Project> = {}): Project {
  return { id: 'p1', name: 'Project One', status: 'active', ...overrides };
}

const GENERATED_AT = new Date(2026, 8, 7, 9, 15); // September 7, 2026, 9:15 AM (local)

describe('formatGeneratedAt', () => {
  it('formats a date as "Month D, YYYY, h:mm AM/PM"', () => {
    expect(formatGeneratedAt(new Date(2026, 8, 7, 9, 15))).toBe('September 7, 2026, 9:15 AM');
  });

  it('formats an afternoon time with PM and 12-hour rollover', () => {
    expect(formatGeneratedAt(new Date(2026, 0, 1, 13, 5))).toBe('January 1, 2026, 1:05 PM');
  });

  it('formats midnight as 12 AM', () => {
    expect(formatGeneratedAt(new Date(2026, 0, 1, 0, 0))).toBe('January 1, 2026, 12:00 AM');
  });
});

describe('buildAISnapshot — header', () => {
  it('always includes the title, generated line, scope line, and instructions', () => {
    const text = buildAISnapshot([], [], { type: 'current-work' }, GENERATED_AT);
    expect(text.startsWith('# Daily Compass Snapshot\n')).toBe(true);
    expect(text).toContain('Generated: September 7, 2026, 9:15 AM');
    expect(text).toContain('Scope: Current work');
    expect(text).toContain('## Instructions for my AI');
  });

  it('produces identical output for identical input except the generated-at line', () => {
    const projects = [project()];
    const tasks = [createTaskForTest({ id: 't1', projectId: 'p1' })];
    const a = buildAISnapshot(projects, tasks, { type: 'current-work' }, new Date(2026, 0, 1, 8, 0));
    const b = buildAISnapshot(projects, tasks, { type: 'current-work' }, new Date(2026, 0, 2, 20, 30));
    const stripGenerated = (s: string) => s.replace(/Generated: .*/, 'Generated: X');
    expect(stripGenerated(a)).toBe(stripGenerated(b));
  });
});

describe('buildAISnapshot — current-work scope', () => {
  it('includes eligible active projects and their non-archived, non-Done tasks', () => {
    const projects = [project({ id: 'p1', name: 'SJE' })];
    const tasks = [
      createTaskForTest({ id: 't1', title: 'Finish vessel presentation', projectId: 'p1', priority: 'High', status: 'In Progress', dueDate: '2026-09-10' }),
    ];
    const text = buildAISnapshot(projects, tasks, { type: 'current-work' }, GENERATED_AT);
    expect(text).toContain('## Project: SJE');
    expect(text).toContain('- [ ] Finish vessel presentation | High | Due: 2026-09-10 | Status: In Progress');
  });

  it('excludes archived projects and their tasks', () => {
    const projects = [project({ id: 'p1', name: 'Archived Co', status: 'archived' })];
    const tasks = [createTaskForTest({ id: 't1', title: 'Ghost task', projectId: 'p1' })];
    const text = buildAISnapshot(projects, tasks, { type: 'current-work' }, GENERATED_AT);
    expect(text).not.toContain('Archived Co');
    expect(text).not.toContain('Ghost task');
  });

  it('excludes completed projects', () => {
    const projects = [project({ id: 'p1', name: 'Wrapped Up', status: 'completed' })];
    const tasks = [createTaskForTest({ id: 't1', title: 'Trailing task', projectId: 'p1' })];
    const text = buildAISnapshot(projects, tasks, { type: 'current-work' }, GENERATED_AT);
    expect(text).not.toContain('Wrapped Up');
    expect(text).not.toContain('Trailing task');
  });

  it('excludes archived tasks even within an active project', () => {
    const projects = [project()];
    const tasks = [createTaskForTest({ id: 't1', title: 'Archived task', projectId: 'p1', archived: true })];
    const text = buildAISnapshot(projects, tasks, { type: 'current-work' }, GENERATED_AT);
    expect(text).not.toContain('Archived task');
  });

  it('excludes Done tasks from current work', () => {
    const projects = [project()];
    const tasks = [createTaskForTest({ id: 't1', title: 'Finished task', projectId: 'p1', status: 'Done' })];
    const text = buildAISnapshot(projects, tasks, { type: 'current-work' }, GENERATED_AT);
    expect(text).not.toContain('Finished task');
  });

  it('lists unassigned tasks in their own section', () => {
    const tasks = [createTaskForTest({ id: 't1', title: 'Call insurance company', dueDate: '2026-09-08', status: 'Today' })];
    const text = buildAISnapshot([], tasks, { type: 'current-work' }, GENERATED_AT);
    expect(text).toContain('## Unassigned tasks');
    expect(text).toContain('- [ ] Call insurance company | Normal | Due: 2026-09-08 | Status: Today');
  });

  it('omits the unassigned section when there are no unassigned tasks in scope', () => {
    const projects = [project()];
    const tasks = [createTaskForTest({ id: 't1', projectId: 'p1' })];
    const text = buildAISnapshot(projects, tasks, { type: 'current-work' }, GENERATED_AT);
    expect(text).not.toContain('## Unassigned tasks');
  });

  it('sorts ranked projects numerically ascending, then unranked projects alphabetically', () => {
    const projects = [
      project({ id: 'p-b', name: 'Bravo', priorityRank: 2 }),
      project({ id: 'p-z', name: 'Zulu' }),
      project({ id: 'p-a', name: 'Alpha', priorityRank: 1 }),
      project({ id: 'p-m', name: 'Mike' }),
    ];
    const tasks: Task[] = [
      createTaskForTest({ id: 't-b', projectId: 'p-b' }),
      createTaskForTest({ id: 't-z', projectId: 'p-z' }),
      createTaskForTest({ id: 't-a', projectId: 'p-a' }),
      createTaskForTest({ id: 't-m', projectId: 'p-m' }),
    ];
    const text = buildAISnapshot(projects, tasks, { type: 'current-work' }, GENERATED_AT);
    const order = ['Alpha', 'Bravo', 'Mike', 'Zulu'].map((name) => text.indexOf(`## Project: ${name}`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it('shows a project priority line, or "Not ranked" when unset', () => {
    const projects = [project({ id: 'p1', name: 'Ranked', priorityRank: 1 }), project({ id: 'p2', name: 'Unranked' })];
    const tasks = [createTaskForTest({ id: 't1', projectId: 'p1' }), createTaskForTest({ id: 't2', projectId: 'p2' })];
    const text = buildAISnapshot(projects, tasks, { type: 'current-work' }, GENERATED_AT);
    expect(text).toContain('Project priority: 1');
    expect(text).toContain('Project priority: Not ranked');
  });

  it('preserves the app\'s existing sortOrder within a project rather than re-sorting', () => {
    const projects = [project()];
    const tasks = [
      createTaskForTest({ id: 't-second', title: 'Second', projectId: 'p1', sortOrder: 2 }),
      createTaskForTest({ id: 't-first', title: 'First', projectId: 'p1', sortOrder: 1 }),
    ];
    const text = buildAISnapshot(projects, tasks, { type: 'current-work' }, GENERATED_AT);
    expect(text.indexOf('First')).toBeLessThan(text.indexOf('Second'));
  });

  it('produces a useful, non-error snapshot for an entirely empty scope', () => {
    const text = buildAISnapshot([], [], { type: 'current-work' }, GENERATED_AT);
    expect(text).toContain('No active tasks or projects match this scope.');
  });

  it('never includes internal IDs or sync metadata', () => {
    const projects = [project({ id: 'proj-secret-id' })];
    const tasks = [createTaskForTest({ id: 'task-secret-id', projectId: 'proj-secret-id' })];
    const text = buildAISnapshot(projects, tasks, { type: 'current-work' }, GENERATED_AT);
    expect(text).not.toContain('proj-secret-id');
    expect(text).not.toContain('task-secret-id');
    expect(text).not.toContain('sortOrder');
    expect(text).not.toContain('createdAt');
  });
});

describe('buildAISnapshot — today scope', () => {
  it('includes only tasks with Today status, annotated with their project', () => {
    const projects = [project({ id: 'p1', name: 'SJE' })];
    const tasks = [
      createTaskForTest({ id: 't-today', title: 'Today task', projectId: 'p1', status: 'Today' }),
      createTaskForTest({ id: 't-inbox', title: 'Inbox task', projectId: 'p1', status: 'Inbox' }),
      createTaskForTest({ id: 't-week', title: 'This week task', projectId: 'p1', status: 'This Week' }),
    ];
    const text = buildAISnapshot(projects, tasks, { type: 'today' }, GENERATED_AT);
    expect(text).toContain('Today task | Project: SJE');
    expect(text).not.toContain('Inbox task');
    expect(text).not.toContain('This week task');
  });

  it('labels a Today task with no project as "Project: None"', () => {
    const tasks = [createTaskForTest({ id: 't1', title: 'Unassigned today task', status: 'Today' })];
    const text = buildAISnapshot([], tasks, { type: 'today' }, GENERATED_AT);
    expect(text).toContain('Unassigned today task | Project: None');
  });

  it('excludes archived Today tasks', () => {
    const tasks = [createTaskForTest({ id: 't1', title: 'Archived today task', status: 'Today', archived: true })];
    const text = buildAISnapshot([], tasks, { type: 'today' }, GENERATED_AT);
    expect(text).not.toContain('Archived today task');
  });

  it('produces a useful message when nothing is scheduled for Today', () => {
    const text = buildAISnapshot([], [], { type: 'today' }, GENERATED_AT);
    expect(text).toContain('No tasks are scheduled for Today.');
  });
});

describe('buildAISnapshot — one-project scope', () => {
  it('includes only the selected project\'s non-archived tasks, never another project\'s', () => {
    const projects = [project({ id: 'p1', name: 'Alpha' }), project({ id: 'p2', name: 'Beta' })];
    const tasks = [
      createTaskForTest({ id: 't1', title: 'Alpha task', projectId: 'p1' }),
      createTaskForTest({ id: 't2', title: 'Beta task', projectId: 'p2' }),
    ];
    const text = buildAISnapshot(projects, tasks, { type: 'project', projectId: 'p1' }, GENERATED_AT);
    expect(text).toContain('## Project: Alpha');
    expect(text).toContain('Alpha task');
    expect(text).not.toContain('Beta task');
    expect(text).not.toContain('## Project: Beta');
  });

  it('includes Done tasks for the selected project (unlike current-work scope)', () => {
    const projects = [project()];
    const tasks = [createTaskForTest({ id: 't1', title: 'Finished project task', projectId: 'p1', status: 'Done' })];
    const text = buildAISnapshot(projects, tasks, { type: 'project', projectId: 'p1' }, GENERATED_AT);
    expect(text).toContain('Finished project task');
  });

  it('excludes archived tasks from the selected project', () => {
    const projects = [project()];
    const tasks = [createTaskForTest({ id: 't1', title: 'Archived project task', projectId: 'p1', archived: true })];
    const text = buildAISnapshot(projects, tasks, { type: 'project', projectId: 'p1' }, GENERATED_AT);
    expect(text).not.toContain('Archived project task');
  });

  it('treats an archived project as not found, never revealing its tasks', () => {
    const projects = [project({ id: 'p1', name: 'Archived Project', status: 'archived' })];
    const tasks = [createTaskForTest({ id: 't1', title: 'Should stay hidden', projectId: 'p1' })];
    const text = buildAISnapshot(projects, tasks, { type: 'project', projectId: 'p1' }, GENERATED_AT);
    expect(text).not.toContain('Should stay hidden');
    expect(text).toContain('No project selected.');
  });

  it('produces a useful message for a project with no tasks', () => {
    const projects = [project({ name: 'Empty Project' })];
    const text = buildAISnapshot(projects, [], { type: 'project', projectId: 'p1' }, GENERATED_AT);
    expect(text).toContain('## Project: Empty Project');
    expect(text).toContain('No tasks in this project.');
  });

  it('produces a useful message when the project id does not match anything', () => {
    const text = buildAISnapshot([], [], { type: 'project', projectId: 'missing' }, GENERATED_AT);
    expect(text).toContain('No project selected.');
  });
});
