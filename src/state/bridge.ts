/**
 * Imperative UI → engine commands that don't belong in serialisable state.
 * The engine registers an implementation at boot; the UI calls `engineCommands()`.
 * Before registration every command is a harmless no-op, so the UI never has to null-check.
 */
export interface EngineCommands {
  /** Multiply the camera distance (e.g. 0.5 = zoom in 2×), animated. */
  zoomBy(factor: number): void;
  /** Return to the default framing of the current focus. */
  resetView(): void;
  /** Render one frame at the current size and resolve a PNG blob (null if unsupported). */
  capture(): Promise<Blob | null>;
}

const noop: EngineCommands = {
  zoomBy() {},
  resetView() {},
  capture: async () => null,
};

let current: EngineCommands = noop;

export function registerEngineCommands(cmds: EngineCommands): () => void {
  current = cmds;
  return () => {
    if (current === cmds) current = noop;
  };
}

export function engineCommands(): EngineCommands {
  return current;
}
