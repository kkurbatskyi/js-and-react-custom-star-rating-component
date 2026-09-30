/**
 * Entry point: a full-screen WebGL canvas behind the React overlay mounted in `#app`.
 * The 3D side is imperative (`boot`, src/app); React never re-renders per frame.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { boot } from './app/boot';
import { App } from './ui/App';

function ensureElement<T extends HTMLElement>(id: string, create: () => T): T {
  const existing = document.getElementById(id);
  if (existing) return existing as T;
  const el = create();
  el.id = id;
  document.body.appendChild(el);
  return el;
}

const canvas = ensureElement('sidereal-canvas', () => document.createElement('canvas'));
Object.assign(canvas.style, {
  position: 'fixed',
  inset: '0',
  width: '100%',
  height: '100%',
  display: 'block',
  zIndex: '0',
  touchAction: 'none',
});
document.body.prepend(canvas); // behind the overlay

const appRoot = ensureElement('app', () => document.createElement('div'));
// Stacking: canvas (0) ▸ engine labels (1, see src/engine/labels) ▸ React UI (2). The overlay passes
// pointer events through to the canvas; interactive UI re-enables them.
Object.assign(appRoot.style, { position: 'fixed', inset: '0', zIndex: '2', pointerEvents: 'none' });

createRoot(appRoot).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

boot(canvas);
