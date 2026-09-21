// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuickNoteInput } from './QuickNoteInput';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
}));

vi.mock('../store/useApp', () => ({
  useApp: () => ({ state: {}, dispatch: mocks.dispatch }),
}));

const LIMIT_MESSAGE =
  'Quick Notes are limited to 5,000 characters. Consider converting this note into a task or splitting it into multiple notes.';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

function field() {
  return screen.getByLabelText('Add a quick reminder') as HTMLInputElement;
}
function setText(value: string) {
  fireEvent.change(field(), { target: { value } });
}
function add() {
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
}
function counter() {
  return document.getElementById('quick-note-counter');
}
function addedText(): string {
  return (mocks.dispatch.mock.calls[0][0] as { text: string }).text;
}

describe('QuickNoteInput — length limit', () => {
  it('saves a note below the limit (4,999 characters)', () => {
    const onAdded = vi.fn();
    render(<QuickNoteInput onAdded={onAdded} />);

    setText('x'.repeat(4999));
    add();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'ADD_QUICK_NOTE', text: 'x'.repeat(4999) });
    expect(onAdded).toHaveBeenCalled();
  });

  it('saves a note exactly at the limit (5,000 characters) and clears the field', () => {
    const onAdded = vi.fn();
    render(<QuickNoteInput onAdded={onAdded} />);

    setText('x'.repeat(5000));
    add();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(addedText()).toHaveLength(5000);
    expect(onAdded).toHaveBeenCalled();
    expect(field().value).toBe('');
  });

  it('refuses a note above the limit (5,001 characters): no save, message shown, text kept', () => {
    const onAdded = vi.fn();
    render(<QuickNoteInput onAdded={onAdded} />);
    const tooLong = 'x'.repeat(5001);

    setText(tooLong);
    add();

    expect(screen.getByRole('alert').textContent).toBe(LIMIT_MESSAGE);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
    expect(field().value).toBe(tooLong);
  });

  it('refuses when Enter is pressed too (form submit), not only the Add button', () => {
    render(<QuickNoteInput />);

    setText('x'.repeat(5001));
    fireEvent.submit(field().closest('form') as HTMLFormElement);

    expect(screen.getByRole('alert').textContent).toBe(LIMIT_MESSAGE);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('keeps the Add button enabled when over the limit, so the reason can be shown', () => {
    render(<QuickNoteInput />);

    setText('x'.repeat(5001));

    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows no message before a save is attempted, even when over the limit', () => {
    render(<QuickNoteInput />);

    setText('x'.repeat(5001));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears the message once the text is shortened, and then saves', () => {
    render(<QuickNoteInput />);

    setText('x'.repeat(6000));
    add();
    expect(screen.getByRole('alert')).toBeTruthy();

    setText('x'.repeat(5000));
    expect(screen.queryByRole('alert')).toBeNull();

    add();
    expect(addedText()).toHaveLength(5000);
  });

  it('does not show a stale message on the next note after a successful save', () => {
    render(<QuickNoteInput />);

    setText('x'.repeat(5001));
    add();
    setText('short');
    add();
    setText('x'.repeat(5001));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('counts characters rather than UTF-16 units, matching the database (5,000 emoji are accepted)', () => {
    render(<QuickNoteInput />);

    setText('\u{1F600}'.repeat(5000));
    add();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  });

  it('does not use the maxlength attribute, which would truncate silently', () => {
    render(<QuickNoteInput />);

    expect(field().hasAttribute('maxlength')).toBe(false);
  });
});

describe('QuickNoteInput — character counter', () => {
  it('is hidden below 4,000 characters', () => {
    render(<QuickNoteInput />);

    expect(counter()).toBeNull();
    setText('x'.repeat(3999));

    expect(counter()).toBeNull();
    expect(screen.queryByText(/characters$/)).toBeNull();
  });

  it('appears at exactly 4,000 characters', () => {
    render(<QuickNoteInput />);

    setText('x'.repeat(4000));

    expect(counter()?.textContent).toBe('4,000 / 5,000 characters');
  });

  it('shows the running length with thousands separators', () => {
    render(<QuickNoteInput />);

    setText('x'.repeat(4321));

    expect(counter()?.textContent).toBe('4,321 / 5,000 characters');
  });

  it('stays visible and is marked when over the limit', () => {
    render(<QuickNoteInput />);

    setText('x'.repeat(5001));

    expect(counter()?.textContent).toBe('5,001 / 5,000 characters');
    expect(counter()?.classList.contains('over-limit')).toBe(true);
  });

  it('disappears again when the text is shortened below 4,000, and after a successful save', () => {
    render(<QuickNoteInput />);

    setText('x'.repeat(4500));
    expect(counter()).not.toBeNull();
    setText('x'.repeat(10));
    expect(counter()).toBeNull();

    setText('x'.repeat(4500));
    add();
    expect(counter()).toBeNull();
  });

  it('is linked to the field for assistive technology only while shown', () => {
    render(<QuickNoteInput />);

    expect(field().hasAttribute('aria-describedby')).toBe(false);
    setText('x'.repeat(4000));

    expect(field().getAttribute('aria-describedby')).toBe('quick-note-counter');
  });
});

describe('QuickNoteInput — pasting oversized text', () => {
  function paste(value: string) {
    // A paste is the clipboard event followed by the field's change event.
    fireEvent.paste(field(), { clipboardData: { getData: () => value } });
    setText(value);
  }

  it('keeps every pasted character — nothing is truncated', () => {
    render(<QuickNoteInput />);
    const pasted = 'ab'.repeat(4000);

    paste(pasted);

    expect(field().value).toBe(pasted);
    expect(counter()?.textContent).toBe('8,000 / 5,000 characters');
  });

  it('refuses to save the pasted text, keeps it, and explains why', () => {
    render(<QuickNoteInput />);
    const pasted = 'ab'.repeat(4000);

    paste(pasted);
    add();

    expect(screen.getByRole('alert').textContent).toBe(LIMIT_MESSAGE);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(field().value).toBe(pasted);
  });
});
