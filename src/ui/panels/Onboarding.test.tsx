// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../state/store';
import { resetStore } from '../testing';
import { Onboarding } from './Onboarding';

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  act(() => store.getState().updateSettings({}));
  act(() => store.setState({ ui: { ...store.getState().ui, onboardingSeen: false } }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const dialog = () => screen.queryByRole('dialog', { name: 'Three things to know' });

describe('Onboarding', () => {
  it('arrives a beat after the view is ready, with three tips and the origin story', () => {
    render(<Onboarding />);
    expect(dialog()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(dialog()).not.toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText(/used to be a star-rating component/)).toBeTruthy();
  });

  it('waits for the engine (store.ready)', () => {
    act(() => store.setState({ ready: false }));
    render(<Onboarding />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(dialog()).toBeNull();
    act(() => store.setState({ ready: true }));
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(dialog()).not.toBeNull();
  });

  it('dismisses for good', () => {
    render(<Onboarding />);
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Begin exploring' }));
    expect(store.getState().ui.onboardingSeen).toBe(true);
    expect(dialog()).toBeNull();
  });

  it('never shows once seen', () => {
    act(() => store.setState({ ui: { ...store.getState().ui, onboardingSeen: true } }));
    render(<Onboarding />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(dialog()).toBeNull();
  });
});
