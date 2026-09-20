// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TaskRow } from './TaskRow';
import { createEmptyAppData } from '../types';
import { createTaskForTest } from '../store/reducer';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock('../store/useApp', () => ({
  useApp: () => ({ state: { ...createEmptyAppData(), tasks: [] }, dispatch: mocks.dispatch }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('TaskRow actions outside the Calendar', () => {
  it('still offers Complete and Archive as separate actions', () => {
    render(<TaskRow task={createTaskForTest({ id: 't', title: 'Write report' })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    expect(mocks.dispatch).toHaveBeenLastCalledWith({ type: 'COMPLETE_TASK', id: 't' });

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(mocks.dispatch).toHaveBeenLastCalledWith({ type: 'ARCHIVE_TASK', id: 't' });
  });

  it('still offers Reopen on a completed task', () => {
    render(<TaskRow task={createTaskForTest({ id: 't', status: 'Done' })} />);

    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
  });
});

describe('TaskRow with minimalActions (Calendar)', () => {
  it('renders Archive before Edit and nothing else', () => {
    render(<TaskRow task={createTaskForTest({ id: 't' })} minimalActions />);

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Archive', 'Edit']);
  });
});
