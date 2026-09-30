import { expect, type Page, test } from '@playwright/test';

/**
 * Engine end-to-end: boot, pixels, deep links, picking and navigation through the real app (the
 * production build in SwiftShader). Everything is observed through the store and the debug handle
 * `window.__SIDEREAL__` (src/app/debug.ts).
 */

const HOME = '1.399.0.-276.0';
const HALCYON = `${HOME}.d`;

interface FocusLike {
  kind: string;
  id?: string;
}
interface Handle {
  store: {
    getState(): {
      focus: FocusLike;
      level: string;
      selection: FocusLike | null;
      flightTarget: FocusLike | null;
      goUp(): void;
    };
  };
  engine: {
    renderNow(): void;
    renderer: { getContext(): WebGL2RenderingContext };
    frame: { sun: { x: number; y: number; visibility: number } | null };
  };
  debug: {
    select(id: string | null): void;
    freeze(on: boolean): void;
    jumpTo(id: string, pose?: { distanceKm?: number; yaw?: number; pitch?: number }): boolean;
    frames(n: number): Promise<void>;
  };
}
type Win = Window & { __SIDEREAL__: Handle; __READY__?: boolean };

async function boot(page: Page, hash = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`/${hash}`);
  await page.waitForFunction(() => (window as unknown as Win).__READY__ === true, null, {
    timeout: 150_000,
  });
  return errors;
}

test('boots, renders a lit galaxy and throws nothing', async ({ page }) => {
  const errors = await boot(page);
  const lit = await page.evaluate(() => {
    const { engine } = (window as unknown as Win).__SIDEREAL__;
    engine.renderNow(); // same task as readPixels: the drawing buffer is intact
    const gl = engine.renderer.getContext();
    const px = new Uint8Array(4);
    let count = 0;
    for (let i = 1; i < 16; i++) {
      for (let j = 1; j < 16; j++) {
        gl.readPixels(
          Math.floor((gl.drawingBufferWidth * i) / 16),
          Math.floor((gl.drawingBufferHeight * j) / 16),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          px,
        );
        if (px[0] + px[1] + px[2] > 45) count++;
      }
    }
    return count;
  });
  expect(lit).toBeGreaterThan(8);
  const state = await page.evaluate(
    () => (window as unknown as Win).__SIDEREAL__.store.getState().level,
  );
  expect(state).toBe('galaxy');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a deep link to a planet lands at that planet', async ({ page }) => {
  const errors = await boot(page, `#${HALCYON}`);
  const state = await page.evaluate(() => {
    const s = (window as unknown as Win).__SIDEREAL__.store.getState();
    return { focus: s.focus, level: s.level };
  });
  expect(state.focus).toEqual({ kind: 'planet', id: HALCYON });
  expect(state.level).toBe('planet');
  expect(new URL(page.url()).hash).toBe(`#${HALCYON}`);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('selection works through the debug handle and by clicking the star', async ({ page }) => {
  await boot(page, `#${HOME}`);
  await page.evaluate(
    (id) => (window as unknown as Win).__SIDEREAL__.debug.select(id),
    `${HOME}.f`,
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as Win).__SIDEREAL__.store.getState().selection),
    )
    .toEqual({ kind: 'planet', id: `${HOME}.f` });

  // Click where the engine says the system's star is on screen.
  const sun = await page.evaluate(async () => {
    const { debug, engine } = (window as unknown as Win).__SIDEREAL__;
    debug.freeze(true);
    await debug.frames(2);
    return engine.frame.sun;
  });
  expect(sun?.visibility).toBeGreaterThan(0);
  await page.evaluate(() => {
    // The React overlay may cover the canvas in places; clicks must reach the canvas for this test.
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';
  });
  await page.mouse.click(sun?.x ?? 0, sun?.y ?? 0);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as Win).__SIDEREAL__.store.getState().selection),
    )
    .toEqual({ kind: 'star', id: HOME });
});

test('going up a level starts a flight to the parent', async ({ page }) => {
  await boot(page, `#${HALCYON}`);
  await page.evaluate(() => (window as unknown as Win).__SIDEREAL__.store.getState().goUp());
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as Win).__SIDEREAL__.store.getState().flightTarget),
    )
    .toEqual({ kind: 'star', id: HOME });
});
