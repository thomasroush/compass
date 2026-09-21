// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TaskForm } from './TaskForm';
import { createEmptyAppData, type AppData } from '../types';
import { createTaskForTest } from '../store/reducer';

const mocks = vi.hoisted(() => ({
  appState: {
    current: { version: 1, tasks: [], projects: [], quickNotes: [], goals: [], targets: [] } as AppData,
    dispatch: vi.fn(),
  },
}));

const authState = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
}));

vi.mock('../store/useApp', () => ({
  useApp: () => ({ state: mocks.appState.current, dispatch: mocks.appState.dispatch }),
}));
vi.mock('../store/useAuth', () => ({ useAuth: () => authState }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState.current = createEmptyAppData();
  authState.user = { id: 'u1', email: 'tom@example.com' };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TaskForm — Calendar only', () => {
  it('cannot be submitted without a due date — shows an inline error and never dispatches', () => {
    const onClose = vi.fn();
    render(<TaskForm onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Dentist appointment' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'calendar-only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));

    expect(screen.getByRole('alert').textContent).toBe('Calendar only requires a due date.');
    expect(mocks.appState.dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('can be submitted once a due date is provided', () => {
    const onClose = vi.fn();
    render(<TaskForm onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Dentist appointment' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'calendar-only' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-09-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.appState.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_TASK',
        title: 'Dentist appointment',
        status: 'Inbox',
        calendarOnly: true,
        dueDate: '2026-09-20',
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('shows Calendar only selected when editing an existing calendar-only task', () => {
    const task = createTaskForTest({
      id: 't1',
      title: 'Dentist appointment',
      dueDate: '2026-09-20',
      calendarOnly: true,
    });

    render(<TaskForm task={task} onClose={vi.fn()} />);

    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('calendar-only');
  });

  it('selecting a normal workflow status moves the task out of Calendar only', () => {
    const task = createTaskForTest({
      id: 't1',
      title: 'Dentist appointment',
      dueDate: '2026-09-20',
      calendarOnly: true,
    });
    const onClose = vi.fn();

    render(<TaskForm task={task} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'This Week' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mocks.appState.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_TASK',
        id: 't1',
        updates: expect.objectContaining({
          status: 'This Week',
          calendarOnly: false,
        }),
      }),
    );
  });
});

describe('TaskForm — Notes attribution header', () => {
  const NOW = new Date(2026, 8, 18, 15, 58); // local time: 3:58 PM, 09/18/2026
  const HEADER = 'tom — 3:58 PM 09/18/2026';

  function notesField() {
    return screen.getByLabelText('Notes') as HTMLTextAreaElement;
  }
  function typeInto(field: HTMLTextAreaElement, value: string) {
    fireEvent.change(field, { target: { value } });
  }
  function savedNotes() {
    const calls = mocks.appState.dispatch.mock.calls;
    const call = calls[calls.length - 1][0];
    return call.type === 'UPDATE_TASK' ? call.updates.notes : call.notes;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  it('adds a header above the first note in an empty Notes field, with the caret after the text', () => {
    render(<TaskForm onClose={vi.fn()} />);

    typeInto(notesField(), 'C');
    expect(notesField().value).toBe(`${HEADER}\nC`);
    expect(notesField().selectionStart).toBe(notesField().value.length);

    typeInto(notesField(), `${HEADER}\nCalled the customer and left a message.`);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Follow up' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));

    expect(savedNotes()).toBe(`${HEADER}\nCalled the customer and left a message.`);
  });

  it('appends a new entry below existing notes, leaving them exactly as they were', () => {
    const existing = 'gina — 9:14 AM 09/17/2026\nCustomer requested revised pricing.\n  keep   spacing';
    const task = createTaskForTest({ id: 't1', title: 'Quote', notes: existing });
    render(<TaskForm task={task} onClose={vi.fn()} />);

    typeInto(notesField(), `${existing}C`);
    expect(notesField().value).toBe(`${existing}\n\n${HEADER}\nC`);

    typeInto(notesField(), `${existing}\n\n${HEADER}\nCalled back.`);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(savedNotes()).toBe(`${existing}\n\n${HEADER}\nCalled back.`);
    expect(savedNotes().startsWith(existing)).toBe(true);
  });

  it('puts new text at the bottom even when it was typed in the middle of existing notes', () => {
    const task = createTaskForTest({ id: 't1', title: 'Quote', notes: 'Line one' });
    render(<TaskForm task={task} onClose={vi.fn()} />);

    typeInto(notesField(), 'Line X one');

    expect(notesField().value).toBe(`Line one\n\n${HEADER}\nX `);
  });

  it("uses the signed-in user's name, and a collaborator's own identity for their entry", () => {
    authState.user = { id: 'u2', email: 'Gina.Lopez@example.com' };
    const task = createTaskForTest({ id: 't1', title: 'Quote', notes: 'Earlier note by the owner.' });
    render(<TaskForm task={task} onClose={vi.fn()} />);

    typeInto(notesField(), 'Earlier note by the owner.R');

    expect(notesField().value).toBe(
      'Earlier note by the owner.\n\nGina.Lopez — 3:58 PM 09/18/2026\nR',
    );
    expect(notesField().value).not.toContain('tom');
  });

  it('adds only one header per editing session, however much is typed or refocused', () => {
    render(<TaskForm onClose={vi.fn()} />);

    fireEvent.focus(notesField());
    typeInto(notesField(), 'A');
    fireEvent.blur(notesField());
    fireEvent.focus(notesField());

    vi.setSystemTime(new Date(2026, 8, 18, 16, 5));
    typeInto(notesField(), `${notesField().value}B`);
    typeInto(notesField(), `${notesField().value}C`);

    expect(notesField().value).toBe(`${HEADER}\nABC`);
    expect(notesField().value.split('—')).toHaveLength(2);
  });

  it('does not add a header when the field is only focused, or only whitespace or deletions are entered', () => {
    const task = createTaskForTest({ id: 't1', title: 'Quote', notes: 'Existing note' });
    render(<TaskForm task={task} onClose={vi.fn()} />);

    fireEvent.focus(notesField());
    fireEvent.click(notesField());
    expect(notesField().value).toBe('Existing note');

    typeInto(notesField(), 'Existing note ');
    typeInto(notesField(), 'Existing not');
    expect(notesField().value).toBe('Existing not');
  });

  it('saves no empty header when the entry is erased before saving', () => {
    const task = createTaskForTest({ id: 't1', title: 'Quote', notes: 'Existing note' });
    render(<TaskForm task={task} onClose={vi.fn()} />);

    typeInto(notesField(), 'Existing noteX');
    typeInto(notesField(), `Existing note\n\n${HEADER}\n`);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(savedNotes()).toBe('Existing note');
  });

  it('saves no notes at all for a new task whose only note entry was erased', () => {
    render(<TaskForm onClose={vi.fn()} />);

    typeInto(notesField(), 'X');
    typeInto(notesField(), `${HEADER}\n`);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Follow up' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));

    expect(savedNotes()).toBeUndefined();
  });

  it('leaves nothing behind when closed without saving', () => {
    const onClose = vi.fn();
    const task = createTaskForTest({ id: 't1', title: 'Quote', notes: 'Existing note' });
    render(<TaskForm task={task} onClose={onClose} />);

    fireEvent.focus(notesField());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mocks.appState.dispatch).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('does not touch Notes when nobody is signed in (local-only use)', () => {
    authState.user = null;
    render(<TaskForm onClose={vi.fn()} />);

    typeInto(notesField(), 'Plain note');

    expect(notesField().value).toBe('Plain note');
  });
});

describe('TaskForm — Notes length limit', () => {
  const LIMIT_MESSAGE =
    'Task notes are limited to 25,000 characters. Consider splitting longer material into multiple tasks.';

  beforeEach(() => {
    // Signed out, so typing never prepends an attribution header and the
    // lengths below are exactly what was entered.
    authState.user = null;
  });

  function notesField() {
    return screen.getByLabelText('Notes') as HTMLTextAreaElement;
  }
  function setNotes(value: string) {
    fireEvent.change(notesField(), { target: { value } });
  }
  function counter() {
    return document.getElementById('task-notes-counter');
  }
  function fillTitleAndAdd() {
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Long note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
  }
  function savedNotes(): string | undefined {
    return (mocks.appState.dispatch.mock.calls[0][0] as { notes?: string }).notes;
  }

  describe('saving new tasks', () => {
    it('saves notes below the limit (24,999 characters)', () => {
      const onClose = vi.fn();
      render(<TaskForm onClose={onClose} />);

      setNotes('x'.repeat(24999));
      fillTitleAndAdd();

      expect(screen.queryByRole('alert')).toBeNull();
      expect(savedNotes()).toHaveLength(24999);
      expect(onClose).toHaveBeenCalled();
    });

    it('saves notes exactly at the limit (25,000 characters)', () => {
      const onClose = vi.fn();
      render(<TaskForm onClose={onClose} />);

      setNotes('x'.repeat(25000));
      fillTitleAndAdd();

      expect(screen.queryByRole('alert')).toBeNull();
      expect(savedNotes()).toHaveLength(25000);
      expect(onClose).toHaveBeenCalled();
    });

    it('refuses notes above the limit (25,001 characters): no save, no close, message shown', () => {
      const onClose = vi.fn();
      render(<TaskForm onClose={onClose} />);

      setNotes('x'.repeat(25001));
      fillTitleAndAdd();

      expect(screen.getByRole('alert').textContent).toBe(LIMIT_MESSAGE);
      expect(mocks.appState.dispatch).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('counts characters rather than UTF-16 units, matching the database (25,000 emoji are accepted)', () => {
      render(<TaskForm onClose={vi.fn()} />);

      setNotes('\u{1F600}'.repeat(25000));
      fillTitleAndAdd();

      expect(screen.queryByRole('alert')).toBeNull();
      expect(mocks.appState.dispatch).toHaveBeenCalledTimes(1);
    });

    it('shows no message before a save is attempted, even when over the limit', () => {
      render(<TaskForm onClose={vi.fn()} />);

      setNotes('x'.repeat(25001));

      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('does not use the maxlength attribute, which would truncate silently', () => {
      render(<TaskForm onClose={vi.fn()} />);

      expect(notesField().hasAttribute('maxlength')).toBe(false);
    });
  });

  describe('character counter', () => {
    it('is hidden below 20,000 characters', () => {
      render(<TaskForm onClose={vi.fn()} />);

      expect(counter()).toBeNull();
      setNotes('x'.repeat(19999));

      expect(counter()).toBeNull();
      expect(screen.queryByText(/characters$/)).toBeNull();
    });

    it('appears at exactly 20,000 characters', () => {
      render(<TaskForm onClose={vi.fn()} />);

      setNotes('x'.repeat(20000));

      expect(counter()?.textContent).toBe('20,000 / 25,000 characters');
    });

    it('shows the running length with thousands separators', () => {
      render(<TaskForm onClose={vi.fn()} />);

      setNotes('x'.repeat(20145));

      expect(counter()?.textContent).toBe('20,145 / 25,000 characters');
    });

    it('stays visible and is marked when over the limit', () => {
      render(<TaskForm onClose={vi.fn()} />);

      setNotes('x'.repeat(25001));

      expect(counter()?.textContent).toBe('25,001 / 25,000 characters');
      expect(counter()?.classList.contains('over-limit')).toBe(true);
    });

    it('disappears again when the text is shortened below 20,000', () => {
      render(<TaskForm onClose={vi.fn()} />);

      setNotes('x'.repeat(20500));
      expect(counter()).not.toBeNull();
      setNotes('x'.repeat(100));

      expect(counter()).toBeNull();
    });

    it('is linked to the field for assistive technology only while shown', () => {
      render(<TaskForm onClose={vi.fn()} />);

      expect(notesField().hasAttribute('aria-describedby')).toBe(false);
      setNotes('x'.repeat(20000));

      expect(notesField().getAttribute('aria-describedby')).toBe('task-notes-counter');
    });
  });

  describe('pasting oversized text', () => {
    function paste(value: string) {
      // A paste is the clipboard event followed by the field's change event;
      // the form must accept the whole value at that point.
      fireEvent.paste(notesField(), { clipboardData: { getData: () => value } });
      setNotes(value);
    }

    it('keeps every pasted character — nothing is truncated', () => {
      render(<TaskForm onClose={vi.fn()} />);
      const pasted = 'ab'.repeat(20000);

      paste(pasted);

      expect(notesField().value).toBe(pasted);
      expect(counter()?.textContent).toBe('40,000 / 25,000 characters');
    });

    it('refuses to save the pasted text, keeps it, and explains why', () => {
      render(<TaskForm onClose={vi.fn()} />);
      const pasted = 'ab'.repeat(20000);

      paste(pasted);
      fillTitleAndAdd();

      expect(screen.getByRole('alert').textContent).toBe(LIMIT_MESSAGE);
      expect(mocks.appState.dispatch).not.toHaveBeenCalled();
      expect(notesField().value).toBe(pasted);
      expect(
        (screen.getByLabelText('Title') as HTMLInputElement).value,
      ).toBe('Long note');
    });

    it('clears the message once the text is shortened, and then saves', () => {
      render(<TaskForm onClose={vi.fn()} />);

      paste('x'.repeat(30000));
      fillTitleAndAdd();
      expect(screen.getByRole('alert')).toBeTruthy();

      setNotes('x'.repeat(25000));
      expect(screen.queryByRole('alert')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
      expect(savedNotes()).toHaveLength(25000);
    });
  });

  describe('editing a task', () => {
    it('enforces the limit when editing a task that was within it', () => {
      const task = createTaskForTest({ id: 't1', title: 'Quote', notes: 'x'.repeat(100) });
      const onClose = vi.fn();
      render(<TaskForm task={task} onClose={onClose} />);

      setNotes('x'.repeat(25001));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(screen.getByRole('alert').textContent).toBe(LIMIT_MESSAGE);
      expect(mocks.appState.dispatch).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(notesField().value).toHaveLength(25001);
    });

    describe('with notes already over the limit (saved before it existed)', () => {
      const OVERSIZED = `${'y'.repeat(29999)}Z`; // 30,000 characters, distinctive last one

      function renderOversized(onClose = vi.fn()) {
        const task = createTaskForTest({ id: 't1', title: 'Quote', notes: OVERSIZED });
        render(<TaskForm task={task} onClose={onClose} />);
        return onClose;
      }
      function savedUpdates() {
        return (
          mocks.appState.dispatch.mock.calls[0][0] as {
            updates: { notes?: string; title?: string };
          }
        ).updates;
      }

      it('loads the full text into the field and shows the counter', () => {
        renderOversized();

        expect(notesField().value).toBe(OVERSIZED);
        expect(counter()?.textContent).toBe('30,000 / 25,000 characters');
      });

      it('shows no error just from opening it', () => {
        renderOversized();

        expect(screen.queryByRole('alert')).toBeNull();
      });

      it('can be saved unchanged (for example after editing only the title) without losing any content', () => {
        const onClose = renderOversized();

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Quote v2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(screen.queryByRole('alert')).toBeNull();
        expect(savedUpdates().title).toBe('Quote v2');
        expect(savedUpdates().notes).toBe(OVERSIZED);
        expect(onClose).toHaveBeenCalled();
      });

      it('can be shortened, even if the result is still over the limit', () => {
        renderOversized();
        const shorter = OVERSIZED.slice(0, 27000);

        setNotes(shorter);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(screen.queryByRole('alert')).toBeNull();
        expect(savedUpdates().notes).toBe(shorter);
      });

      it('can be shortened to within the limit', () => {
        renderOversized();

        setNotes('y'.repeat(25000));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(savedUpdates().notes).toHaveLength(25000);
      });

      it('cannot be made longer: the save is refused and the text is kept', () => {
        const onClose = renderOversized();
        const longer = `${OVERSIZED}!`;

        setNotes(longer);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(screen.getByRole('alert').textContent).toBe(LIMIT_MESSAGE);
        expect(mocks.appState.dispatch).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(notesField().value).toBe(longer);
      });

      it('leaves the stored text intact when the dialog is cancelled', () => {
        const onClose = renderOversized();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(mocks.appState.dispatch).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });
  });
});
