// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { simDaysNow } from '../../sim/time';
import { store } from '../../state/store';
import { resetStore } from '../testing';
import { TimeControls } from './TimeControls';

beforeEach(() => {
  resetStore();
  act(() => store.setState({ simDays: 0, timeScale: 3600 })); // J2000: 2000-01-01 12:00 UTC
});
afterEach(cleanup);

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const state = () => store.getState();

describe('TimeControls', () => {
  it('shows the date, the speed and the presets', () => {
    render(<TimeControls />);
    expect(screen.getByText('2000-01-01')).toBeTruthy();
    expect(screen.getByText('12:00 UTC')).toBeTruthy();
    expect(screen.getByText('1 h/s')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Simulation clock' })).toBeTruthy();
  });

  it('steps through the TIME_SCALES presets', () => {
    render(<TimeControls />);
    click('Faster');
    expect(state().timeScale).toBe(86_400);
    expect(screen.getByText('1 day/s')).toBeTruthy();
    click('Slower');
    click('Slower');
    expect(state().timeScale).toBe(60);
  });

  it('pauses when slowed below real time, and "faster" resumes at the same speed', () => {
    act(() => store.setState({ timeScale: 1 }));
    render(<TimeControls />);
    click('Slower');
    expect(state().paused).toBe(true);
    expect(state().timeScale).toBe(1);
    expect(screen.getByText('paused')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Slower' }).hasAttribute('disabled')).toBe(true);
    click('Faster');
    expect(state().paused).toBe(false);
    expect(state().timeScale).toBe(1);
  });

  it('toggles play and pause', () => {
    render(<TimeControls />);
    click('Pause time');
    expect(state().paused).toBe(true);
    click('Play time');
    expect(state().paused).toBe(false);
  });

  it('recovers from a zero time scale when asked to play', () => {
    act(() => store.setState({ timeScale: 0 }));
    render(<TimeControls />);
    click('Play time');
    expect(state().timeScale).toBeGreaterThan(0);
    expect(state().paused).toBe(false);
  });

  it('asks the engine to set the clock to now', () => {
    render(<TimeControls />);
    click('Set the clock to now');
    const request = state().timeRequest;
    expect(request).not.toBeNull();
    expect(Math.abs((request?.simDays ?? 0) - simDaysNow())).toBeLessThan(0.01);
  });
});
