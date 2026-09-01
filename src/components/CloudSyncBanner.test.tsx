// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { CloudSyncBanner } from './CloudSyncBanner';
import { CloudSyncContext, type CloudSyncState } from '../store/CloudSyncContext';

function renderWithSync(value: CloudSyncState) {
  return render(
    <CloudSyncContext.Provider value={value}>
      <CloudSyncBanner />
    </CloudSyncContext.Provider>,
  );
}

function state(overrides: Partial<CloudSyncState>): CloudSyncState {
  return {
    status: 'idle',
    message: null,
    localCounts: null,
    cloudCounts: null,
    retry: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('CloudSyncBanner', () => {
  it('renders nothing while idle', () => {
    const { container } = renderWithSync(state({ status: 'idle' }));
    expect(container.textContent).toBe('');
  });

  it('shows a loading message', () => {
    renderWithSync(state({ status: 'loading' }));
    expect(screen.getByRole('status').textContent).toMatch(/Loading your account/);
  });

  it('shows a recoverable error with a working retry action', () => {
    const retry = vi.fn();
    renderWithSync(state({ status: 'error', message: 'Network request failed.', retry }));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Network request failed\./);
    expect(alert.textContent).toMatch(/Local data on this device is unchanged/);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows the needs-choice message verbatim', () => {
    renderWithSync(state({ status: 'needs-choice', message: 'Automatic syncing is paused until that is resolved.' }));
    expect(screen.getByRole('status').textContent).toBe('Automatic syncing is paused until that is resolved.');
  });

  it('shows a one-time notice after a hydration, with no stale "local only" claim now that cloud writes are active', () => {
    renderWithSync(state({ status: 'hydrated' }));
    const notice = screen.getByRole('status');
    expect(notice.textContent).toMatch(/Loaded your account.s data onto this device/);
    expect(notice.textContent).not.toMatch(/cloud sync writes are not active yet/);
  });

  it('renders nothing while up to date with no message (write-sync status is shown separately, in Settings)', () => {
    const { container } = renderWithSync(state({ status: 'up-to-date' }));
    expect(container.textContent).toBe('');
  });

  it('shows a non-fatal refresh-failure notice, with a working retry, when up-to-date carries a message', () => {
    const retry = vi.fn();
    renderWithSync(
      state({ status: 'up-to-date', message: 'Could not refresh from your account just now: offline.', retry }),
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Could not refresh from your account just now/);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh from cloud' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
