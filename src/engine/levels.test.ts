import { describe, expect, it } from 'vitest';
import { LevelTracker, levelFor, type SystemCandidate } from './levels';

const cand = (id: string | null, distanceKm: number, radiusKm = 1e10): SystemCandidate => ({
  id,
  distanceKm,
  radiusKm,
});

describe('levelFor', () => {
  it('maps focus and zones to a view level', () => {
    expect(levelFor('planet', true, true)).toBe('planet');
    expect(levelFor('moon', true, false)).toBe('planet');
    expect(levelFor('star', true, true)).toBe('system');
    expect(levelFor('planet', false, true)).toBe('system');
    expect(levelFor('galaxy', false, false)).toBe('galaxy');
  });
});

describe('LevelTracker', () => {
  it('enters and leaves a system with hysteresis', () => {
    const t = new LevelTracker();
    expect(t.update('star', 2e10, 0, [cand('a', 2e10)], 1)).toBe('galaxy');
    expect(t.update('star', 0.99e10, 0, [cand('a', 0.99e10)], 1)).toBe('system');
    expect(t.systemId).toBe('a');
    // Just outside the radius: still inside thanks to hysteresis.
    expect(t.update('star', 1.05e10, 0, [cand('a', 1.05e10)], 1)).toBe('system');
    expect(t.update('star', 1.2e10, 0, [cand('a', 1.2e10)], 1)).toBe('galaxy');
    expect(t.systemId).toBeNull();
  });

  it('enters and leaves the planet zone with hysteresis', () => {
    const t = new LevelTracker();
    const inside = [cand('a', 1e8)];
    expect(t.update('planet', 1e6, 5e5, inside, 1)).toBe('system');
    expect(t.update('planet', 4e5, 5e5, inside, 1)).toBe('planet');
    expect(t.update('planet', 6e5, 5e5, inside, 1)).toBe('planet');
    expect(t.update('planet', 7e5, 5e5, inside, 1)).toBe('system');
  });

  it('prefers the system the camera is deepest inside and skips null candidates', () => {
    const t = new LevelTracker();
    t.update('star', 5e9, 0, [cand(null, 0), cand('a', 9e9), cand('b', 1e9)], 3);
    expect(t.systemId).toBe('b');
    t.update('star', 5e9, 0, [cand('a', 9e9)], 0);
    expect(t.systemId).toBeNull();
  });
});
