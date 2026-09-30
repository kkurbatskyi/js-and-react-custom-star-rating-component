// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../state/store';
import { halcyon, homeId, resetStore } from '../testing';
import { SearchPalette } from './SearchPalette';

beforeEach(() => {
  resetStore();
  store.getState().setPanel('search', true);
});
afterEach(cleanup);

const input = () => screen.getByRole('combobox', { name: 'Search stars and worlds' });
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const options = () => screen.queryAllByRole('option');

describe('SearchPalette', () => {
  it('is a combobox over a listbox, and offers quick actions when empty', () => {
    render(<SearchPalette />);
    expect(screen.getByRole('dialog', { name: 'Search stars and worlds' })).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Results' })).toBeTruthy();
    const text = options().map((o) => o.textContent ?? '');
    for (const wanted of [
      'Fly home',
      'habitable world',
      'ringed giant',
      'exotic object',
      'galactic core',
      'galaxy overview',
    ]) {
      expect(
        text.some((t) => t.includes(wanted)),
        wanted,
      ).toBe(true);
    }
  });

  it('lists places you have been under "Recent & bookmarked"', () => {
    act(() => {
      store.setState({ visited: [{ id: homeId, at: Date.now() }], bookmarks: [halcyon.id] });
    });
    render(<SearchPalette />);
    const group = screen.getByRole('group', { name: 'Recent & bookmarked' });
    expect(within(group).getByText('Aurelia')).toBeTruthy();
    expect(within(group).getByText('Halcyon')).toBeTruthy();
  });

  it('searches, moves with the arrow keys (wrapping) and flies on Enter', () => {
    render(<SearchPalette />);
    type('aurel');
    const found = options();
    expect(found.length).toBeGreaterThan(1);
    expect(found[0]?.getAttribute('aria-selected')).toBe('true');
    expect(input().getAttribute('aria-activedescendant')).toBe(found[0]?.id);

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(options()[1]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' }); // wraps to the last result
    expect(options().at(-1)?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });

    fireEvent.keyDown(input(), { key: 'Enter' });
    const s = store.getState();
    expect(s.navRequest?.mode).toBe('fly');
    expect(s.selection).not.toBeNull();
    expect(s.navRequest?.target).toMatchObject({ kind: s.selection?.kind, id: s.selection?.id });
    expect(s.ui.open.search).toBe(false);
  });

  it('flies to a planet found by name', () => {
    render(<SearchPalette />);
    type('halcyon');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(store.getState().navRequest?.target).toEqual({ kind: 'planet', id: halcyon.id });
  });

  it('lists each result once even when the facade repeats it', () => {
    store.getState().rate(halcyon.id, 5); // remember()ed bodies are where duplicates came from
    render(<SearchPalette />);
    type('halcyon');
    const titles = options().map((o) => within(o).getAllByText(/./)[0]?.textContent);
    expect(new Set(options().map((o) => o.id)).size).toBe(options().length);
    expect(titles.filter((t) => t === 'Halcyon')).toHaveLength(1);
  });

  it('shows a friendly empty state', () => {
    render(<SearchPalette />);
    type('zzzzqqqq');
    expect(options()).toHaveLength(0);
    expect(screen.getByText(/Nothing by that name/)).toBeTruthy();
  });

  it('runs a quick action on click and closes', () => {
    render(<SearchPalette />);
    fireEvent.click(screen.getByText('Fly home'));
    expect(store.getState().navRequest?.target).toEqual({ kind: 'star', id: homeId });
    expect(store.getState().ui.open.search).toBe(false);
  });

  it('renders nothing while closed', () => {
    store.getState().setPanel('search', false);
    const { container } = render(<SearchPalette />);
    expect(container.firstChild).toBeNull();
  });
});
