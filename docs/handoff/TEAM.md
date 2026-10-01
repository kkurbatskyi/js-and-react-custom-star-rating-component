# Sidereal build team — rules of engagement

You are one of several engineers working IN PARALLEL on the same checkout:
  REPO = /home/user/js-and-react-custom-star-rating-component
  SCRATCH = <scratch>
Read `docs/ARCHITECTURE.md` and the contract files it lists before writing code.

1. **Ownership.** Only create/edit files you own (listed in your brief). If you need a change in a file
   you don't own, do NOT edit it — describe the exact change in your final report. Contract files
   (`*/contracts.ts`, `src/core/types.ts`) are owned by the lead: you may ADD optional fields only if
   your brief allows it; never change or remove existing ones.
2. **Git is read-only for you.** Never run git commands that change state (add, commit, stash, checkout,
   reset, restore, rebase, clean, rm). `git status`/`git diff`/`git log` are fine. The lead commits.
3. **Dependencies are frozen.** Never run npm install/uninstall or edit package.json / package-lock.json
   (unless your brief says you own them). Need a package? Work without it and mention it in your report.
   Available: three@0.186 (+ three/examples/jsm/*), postprocessing@6.39, react@19, zustand@5, lil-gui (dev only),
   vitest, happy-dom, @testing-library/react, @playwright/test@1.56.
4. **Typecheck** the whole project with `npx tsc --noEmit -p .` — other agents' half-finished files may error;
   only fix errors in YOUR files (filter: `npx tsc --noEmit -p . 2>&1 | grep '^src/your/dir'`).
   **Tests**: `npx vitest run src/your/dir`. **Lint/format** only your files: `npx biome check --write <your paths>`.
5. **Dev server** (only if you need a browser): run in background on YOUR port from your brief:
   `VITE_CACHE_DIR=node_modules/.vite-<yourname> npx vite --port <PORT> --strictPort --host 127.0.0.1`
   Kill it before you finish: `pkill -f -- "--port <PORT>"`.
6. **Look at your work.** `node scripts/shot.mjs http://127.0.0.1:<PORT>/dev/<page>.html $SCRATCH/shots/<yourname>/<name>.png --size=960x540`
   (headless Chromium + SwiftShader: slow but exact; waits for `window.__READY__`, prints console errors).
   Then open the PNG with the Read tool. Iterate visually until it is genuinely beautiful — do not guess.
   Keep screenshots ≤ 1280×720; heavy shaders can take 10–60 s per frame in SwiftShader, so pass a larger
   `--timeout=` when needed. (If scripts/shot.mjs does not exist yet, the scaffold agent is still writing it.)
7. **No stray processes**: stop any server/watcher you started before you finish.
8. **Quality bar**: this is a showcase built to impress a senior engineer. Production-quality, idiomatic,
   strictly typed (no `any`), commented where non-obvious (cite formulas), unit-tested where testable,
   no per-frame allocations in hot paths, dispose GPU resources. Visuals must be stunning, not programmer art.
9. **Document**: write/refresh `README.md` in your module directory (public API, usage, design notes, limits).
10. **Final report** (≤ 300 words, no code dumps): files created, deviations from contracts and why,
    requested changes to files you don't own, known issues/TODOs, and paths to your 1–3 best screenshots.
11. **Token economy (IMPORTANT).** The whole team shares a tight API usage quota; when it runs out, everyone
    stops for hours. Be economical: grep / `sed -n 'a,bp'` for the parts of files you need instead of reading
    whole large files; don't re-read files you already know; keep screenshots small (640×360 for iteration)
    and look at them only when they tell you something new; batch related edits; avoid long exploratory
    detours. Quality still matters most — spend tokens on building and verifying, not on browsing.
