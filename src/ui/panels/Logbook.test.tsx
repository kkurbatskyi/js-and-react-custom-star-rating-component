// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../state/store';
import { halcyon, homeId, lanthorn, resetStore } from '../testing';
import { Logbook, relativeTime } from './Logbook';

beforeEach(() => {
  resetStore();
  store.getState().setPanel('logbook', true);
});
afterEach(cleanup);

describe('relativeTime', () => {
  const now = Date.UTC(2026, 8, 29, 12, 0, 0);
  it.each([
    [30_000, 'just now'],
    [5 * 60_000, '5 min ago'],
    [3 * 3_600_000, '3 h ago'],
    [2 * 86_400_000, '2 days ago'],
    [30 * 86_400_000, '2026-08-30'],
  ])('%d ms ago → %s', (ago, expected) => {
    expect(relativeTime(now - ago, now)).toBe(expected);
  });
});

describe('Logbook', () => {
  it('has designed empty states that offer a way forward', () => {
    render(<Logbook />);
    expect(screen.getByText('A blank log. Go and have opinions.')).toBeTruthy();
    expect(screen.getByText('You have not been anywhere.')).toBeTruthy(); // defaults to Visited without ratings
    fireEvent.click(screen.getByRole('tab', { name: /Top rated/ }));
    expect(screen.getByText('Nothing rated yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Bookmarked/ }));
    expect(screen.getByText('Nothing bookmarked.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Fly home/ }));
    expect(store.getState().navRequest?.target).toEqual({ kind: 'star', id: homeId });
    expect(store.getState().ui.open.logbook).toBe(false);
  });

  it('ranks your top-rated objects and summarises the log', () => {
    act(() => {
      const s = store.getState();
      s.rate(homeId, 3);
      s.rate(halcyon.id, 5);
      s.rate(lanthorn.id, 4);
      s.toggleBookmark(halcyon.id);
      s.markVisited(homeId);
    });
    render(<Logbook />);
    expect(screen.getByText('1 visited, 3 rated (average 4 stars), 1 bookmarked.')).toBeTruthy();
    const tab = screen.getByRole('tab', { name: /Top rated/ });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Your top-rated stars' })).toBeTruthy();
    const names = within(screen.getByRole('tabpanel'))
      .getAllByRole('button')
      .map((b) => b.querySelector('.sd-row__name')?.textContent);
    expect(names).toEqual(['Halcyon', 'Lanthorn', 'Aurelia']);
  });

  it('flies to an entry and lists visits and bookmarks in their own tabs', () => {
    act(() => {
      const s = store.getState();
      s.markVisited(homeId);
      s.toggleBookmark(halcyon.id);
    });
    render(<Logbook />);
    fireEvent.click(screen.getByRole('tab', { name: /Bookmarked/ }));
    fireEvent.click(within(screen.getByRole('tabpanel')).getByText('Halcyon'));
    expect(store.getState().navRequest?.target).toEqual({ kind: 'planet', id: halcyon.id });
    expect(store.getState().selection).toEqual({ kind: 'planet', id: halcyon.id });
    fireEvent.click(screen.getByRole('tab', { name: /Visited/ }));
    expect(within(screen.getByRole('tabpanel')).getByText('Aurelia')).toBeTruthy();
    expect(within(screen.getByRole('tabpanel')).getByText('just now')).toBeTruthy();
  });

  it('survives ids it cannot resolve: well-formed ones are listed but inert, malformed ones are dropped', () => {
    act(() => store.setState({ bookmarks: ['0.999.999.999.0', 'garbage', halcyon.id] }));
    render(<Logbook />);
    fireEvent.click(screen.getByRole('tab', { name: /Bookmarked/ }));
    const panel = within(screen.getByRole('tabpanel'));
    const row = panel.getByText('Unknown object').closest('button');
    expect(row?.hasAttribute('disabled')).toBe(true);
    expect(panel.queryByText('garbage')).toBeNull();
    expect(panel.getByText('Halcyon')).toBeTruthy();
  });
});
