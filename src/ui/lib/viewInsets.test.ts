import { describe, expect, it } from 'vitest';
import { type CoverBoxes, insetsFromBoxes } from './viewInsets';

const desktop: CoverBoxes = {
  width: 1280,
  height: 800,
  topbarBottom: 58,
  panel: { left: 884, top: 62 }, // 380 px plate + 16 px gutter
};

describe('insetsFromBoxes', () => {
  it('desktop: the top bar and the info plate cover the top and right', () => {
    expect(insetsFromBoxes(desktop, false)).toEqual({ top: 58, right: 396, bottom: 0, left: 0 });
  });

  it('desktop: a collapsed plate (only a tab) covers nothing on the right', () => {
    expect(insetsFromBoxes({ ...desktop, panel: null }, false)).toEqual({
      top: 58,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('phone: the bottom sheet covers the bottom, not the right', () => {
    const phone: CoverBoxes = {
      width: 390,
      height: 844,
      topbarBottom: 98,
      panel: { left: 0, top: 668 },
    };
    expect(insetsFromBoxes(phone, true)).toEqual({ top: 98, right: 0, bottom: 176, left: 0 });
    // and no sheet (nothing selected) means no bottom inset
    expect(insetsFromBoxes({ ...phone, panel: null }, true)).toEqual({
      top: 98,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('photo mode (no chrome at all) leaves the whole view free', () => {
    expect(
      insetsFromBoxes({ width: 1280, height: 800, topbarBottom: null, panel: null }, false),
    ).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('never lets chrome swallow the view (a full sheet, a very wide plate)', () => {
    const fullSheet: CoverBoxes = {
      width: 390,
      height: 844,
      topbarBottom: 98,
      panel: { left: 0, top: 98 },
    };
    expect(insetsFromBoxes(fullSheet, true).bottom).toBe(Math.round(844 * 0.6));
    const wide: CoverBoxes = { ...desktop, panel: { left: 100, top: 62 } };
    expect(insetsFromBoxes(wide, false).right).toBe(Math.round(1280 * 0.6));
  });

  it('rounds to whole pixels and ignores nonsense', () => {
    const odd: CoverBoxes = {
      width: 1280.4,
      height: 800,
      topbarBottom: 57.6,
      panel: { left: 884.4, top: 62 },
    };
    expect(insetsFromBoxes(odd, false)).toEqual({ top: 58, right: 396, bottom: 0, left: 0 });
    const beyond: CoverBoxes = { ...desktop, panel: { left: 2000, top: 62 } };
    expect(insetsFromBoxes(beyond, false).right).toBe(0);
  });
});
