// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { MobileNav } from './MobileNav';

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MobileNav />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const nav = () => screen.getByRole('navigation', { name: 'Mobile navigation' });
const moreButton = () => within(nav()).getByRole('button', { name: 'More' });
const currentPath = () => screen.getByTestId('location').textContent;

afterEach(cleanup);

describe('MobileNav — bottom bar', () => {
  it('shows Board, Tasks, Calendar, Projects and More, in that order, each with an icon and a label', () => {
    renderAt('/');

    const items = Array.from(nav().children).map((el) => el.querySelector('span'));
    expect(items.map((span) => span?.textContent)).toEqual([
      'Board',
      'Tasks',
      'Calendar',
      'Projects',
      'More',
    ]);

    for (const el of Array.from(nav().querySelectorAll('.mobile-nav-link'))) {
      const icon = el.querySelector('svg');
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('uses links for the four destinations and a button for More', () => {
    renderAt('/');

    const links = within(nav()).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/board',
      '/tasks',
      '/calendar',
      '/projects',
    ]);
    expect(moreButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('marks the current primary destination active and exposes it via aria-current', () => {
    renderAt('/calendar');

    const calendar = within(nav()).getByRole('link', { name: 'Calendar' });
    expect(calendar.className).toContain('active');
    expect(calendar.getAttribute('aria-current')).toBe('page');

    const board = within(nav()).getByRole('link', { name: 'Board' });
    expect(board.className).not.toContain('active');
    expect(board.getAttribute('aria-current')).toBeNull();
    expect(moreButton().className).not.toContain('active');
  });

  it('navigates when a primary destination is tapped', () => {
    renderAt('/');

    fireEvent.click(within(nav()).getByRole('link', { name: 'Projects' }));

    expect(currentPath()).toBe('/projects');
  });
});

describe('MobileNav — More menu', () => {
  it('is closed until More is pressed, then lists every destination without a bottom-bar slot', () => {
    renderAt('/board');
    expect(screen.queryByRole('list', { name: 'More destinations' })).toBeNull();

    fireEvent.click(moreButton());

    expect(moreButton().getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('list', { name: 'More destinations' });
    const links = within(menu).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Today', '/'],
      ['Goals', '/goals'],
      ['About', '/about'],
      ['Settings', '/settings'],
    ]);
  });

  it('keeps every app section reachable from the bottom bar or the More menu', () => {
    renderAt('/');
    fireEvent.click(moreButton());

    const hrefs = within(nav())
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
      .sort();
    expect(hrefs).toEqual(
      ['/', '/about', '/board', '/calendar', '/goals', '/projects', '/settings', '/tasks'].sort(),
    );
  });

  it('closes after a destination is selected, and navigates there', () => {
    renderAt('/board');
    fireEvent.click(moreButton());

    fireEvent.click(within(screen.getByRole('list', { name: 'More destinations' })).getByRole('link', { name: 'Goals' }));

    expect(currentPath()).toBe('/goals');
    expect(screen.queryByRole('list', { name: 'More destinations' })).toBeNull();
    expect(moreButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when More is pressed a second time', () => {
    renderAt('/board');
    fireEvent.click(moreButton());
    fireEvent.click(moreButton());

    expect(screen.queryByRole('list', { name: 'More destinations' })).toBeNull();
  });

  it('closes when the user taps outside it, but not when they tap inside it', () => {
    renderAt('/board');
    fireEvent.click(moreButton());
    const menu = screen.getByRole('list', { name: 'More destinations' });

    fireEvent.pointerDown(menu);
    expect(screen.getByRole('list', { name: 'More destinations' })).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('list', { name: 'More destinations' })).toBeNull();
  });

  it('closes on Escape and returns focus to the More button', () => {
    renderAt('/board');
    fireEvent.click(moreButton());

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('list', { name: 'More destinations' })).toBeNull();
    expect(document.activeElement).toBe(moreButton());
  });

  it('closes when the user navigates elsewhere with the bottom bar', () => {
    renderAt('/board');
    fireEvent.click(moreButton());

    fireEvent.click(within(nav()).getByRole('link', { name: 'Tasks' }));

    expect(currentPath()).toBe('/tasks');
    expect(screen.queryByRole('list', { name: 'More destinations' })).toBeNull();
  });

  it.each(['/', '/goals', '/goals/goal-1', '/about', '/settings'])(
    'shows More as active on %s, and marks that item current in the open menu',
    (path) => {
      renderAt(path);
      expect(moreButton().className).toContain('active');

      fireEvent.click(moreButton());
      const current = within(screen.getByRole('list', { name: 'More destinations' }))
        .getAllByRole('link')
        .filter((a) => a.getAttribute('aria-current') === 'page');
      expect(current).toHaveLength(1);
    },
  );

  it('does not treat a primary destination as a More destination', () => {
    renderAt('/projects');
    expect(moreButton().className).not.toContain('active');
  });
});
