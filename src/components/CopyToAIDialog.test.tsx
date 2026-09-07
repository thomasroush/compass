// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CopyToAIDialog } from './CopyToAIDialog';
import { createEmptyAppData, type AppData } from '../types';
import { createTaskForTest } from '../store/reducer';

const mocks = vi.hoisted(() => ({
  appState: {
    current: { version: 1, tasks: [], projects: [], dailyNotes: [] } as AppData,
    dispatch: vi.fn(),
  },
}));

vi.mock('../store/useApp', () => ({
  useApp: () => ({ state: mocks.appState.current, dispatch: mocks.appState.dispatch }),
}));

function seedData(): AppData {
  return {
    ...createEmptyAppData(),
    projects: [
      { id: 'p1', name: 'Alpha', status: 'active' },
      { id: 'p2', name: 'Beta', status: 'active' },
    ],
    tasks: [
      createTaskForTest({ id: 't1', title: 'Alpha task', projectId: 'p1', status: 'Today' }),
      createTaskForTest({ id: 't2', title: 'Beta task', projectId: 'p2' }),
    ],
  };
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState.current = seedData();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
});

afterEach(() => {
  cleanup();
});

describe('CopyToAIDialog', () => {
  it('renders with Current work selected by default and shows a matching preview', () => {
    render(<CopyToAIDialog onClose={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Current work' })).toHaveProperty('checked', true);
    const preview = screen.getByLabelText('Preview') as HTMLTextAreaElement;
    expect(preview.value).toContain('Scope: Current work');
    expect(preview.value).toContain('Alpha task');
  });

  it('switches the preview when the Today scope is selected', () => {
    render(<CopyToAIDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Today' }));
    const preview = screen.getByLabelText('Preview') as HTMLTextAreaElement;
    expect(preview.value).toContain('Scope: Today');
    expect(preview.value).toContain('Alpha task');
    expect(preview.value).not.toContain('Beta task');
  });

  it('reveals a project selector for One project scope and restricts the preview to that project', () => {
    render(<CopyToAIDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'One project' }));

    const select = screen.getByLabelText('Project') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'p2' } });

    const preview = screen.getByLabelText('Preview') as HTMLTextAreaElement;
    expect(preview.value).toContain('## Project: Beta');
    expect(preview.value).toContain('Beta task');
    expect(preview.value).not.toContain('Alpha task');
    expect(preview.value).not.toContain('## Project: Alpha');
  });

  it('disables Copy for One project scope until a project is chosen', () => {
    mocks.appState.current = { ...seedData(), projects: [] };
    render(<CopyToAIDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'One project' }));
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveProperty('disabled', true);
  });

  it('copies exactly the previewed text and shows a success message', async () => {
    render(<CopyToAIDialog onClose={vi.fn()} />);
    const preview = screen.getByLabelText('Preview') as HTMLTextAreaElement;
    const expected = preview.value;

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByText('Copied to clipboard.');

    expect(writeText).toHaveBeenCalledWith(expected);
  });

  it('shows a usable error and keeps the preview selectable when clipboard access fails', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<CopyToAIDialog onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByRole('alert');

    const preview = screen.getByLabelText('Preview') as HTMLTextAreaElement;
    expect(preview).toHaveProperty('disabled', false);
    expect(preview.readOnly).toBe(true);
  });

  it('calls onClose and does not copy when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<CopyToAIDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('shows the privacy statement from the plan', () => {
    render(<CopyToAIDialog onClose={vi.fn()} />);
    expect(
      screen.getByText('Only the text shown here is copied. Compass does not send it anywhere.'),
    ).toBeTruthy();
  });

  it('has an accessible dialog name', () => {
    render(<CopyToAIDialog onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Copy to AI' })).toBeTruthy();
  });
});

describe('CopyToAIDialog — layout structure (responsive CSS hooks)', () => {
  // jsdom has no layout engine, so these assert the DOM structure app.css's
  // desktop two-column / mobile single-column and sticky-footer rules rely
  // on, rather than actual rendered widths or media-query behavior.

  it('uses the wide dialog layout class', () => {
    render(<CopyToAIDialog onClose={vi.fn()} />);
    expect(screen.getByRole('dialog').className).toContain('copy-ai-dialog');
  });

  it('groups scope/project controls separately from the preview, inside the scrollable body', () => {
    const { container } = render(<CopyToAIDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'One project' }));

    const body = container.querySelector('.copy-ai-body');
    const controls = container.querySelector('.copy-ai-controls');
    const previewPane = container.querySelector('.copy-ai-preview-pane');
    expect(body).toBeTruthy();
    expect(controls).toBeTruthy();
    expect(previewPane).toBeTruthy();

    // scope selector and project selector belong to the controls column...
    expect(controls?.contains(screen.getByRole('radio', { name: 'Current work' }))).toBe(true);
    expect(controls?.contains(screen.getByLabelText('Project'))).toBe(true);
    // ...and the preview lives in its own column, not the controls column.
    expect(previewPane?.contains(screen.getByLabelText('Preview'))).toBe(true);
    expect(controls?.contains(screen.getByLabelText('Preview'))).toBe(false);
  });

  it('keeps Cancel and Copy together in a dedicated action row after the scrollable body', () => {
    const { container } = render(<CopyToAIDialog onClose={vi.fn()} />);
    const actions = container.querySelector('.copy-ai-actions');
    expect(actions).toBeTruthy();
    expect(actions?.contains(screen.getByRole('button', { name: 'Cancel' }))).toBe(true);
    expect(actions?.contains(screen.getByRole('button', { name: 'Copy' }))).toBe(true);

    const body = container.querySelector('.copy-ai-body');
    // DOM order determines source order for the action row sitting after
    // (not inside) the scrollable preview/controls body.
    expect(body?.compareDocumentPosition(actions!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
