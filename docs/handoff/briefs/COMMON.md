# Common context for all Phase-2 specialists

Sidereal: browser-based procedural galaxy explorer. Continuous zoom from a 100,000-ly spiral galaxy to a
planet's cloud tops; every star deterministic from a seed; you can visit, study and RATE actual stars (the
repo used to be a star-rating component — the pun is the product's soul). Zero asset files: every pixel
and sound is procedural. Built to impress a senior engineer who will open it on a laptop AND a phone.

Before coding, read in full:
1. <scratch>/TEAM.md — rules of engagement (shared checkout, ownership, git read-only, deps frozen).
2. docs/ARCHITECTURE.md — the design. Contracts: src/core/types.ts, src/render/contracts.ts,
   src/engine/contracts.ts, src/universe/contracts.ts, src/state/contracts.ts, src/audio/contracts.ts.
3. The README.md of any module you consume (e.g. src/render/post/README.md, dev/README.md).
4. The foundation already provides: src/core/* (rng, hash, math, color/blackbody, noise, units, format, log),
   src/gen/galaxy/* (GalaxyModel v1), src/sim/* (Kepler, orientation, time), src/state/store.ts (zustand),
   src/universe/index.ts (facade over MOCK data until the generators land), working placeholder visual stubs
   for every render module, src/render/post/PostFX.ts (HDR bloom + ACES), src/render/shaders/*.glsl.ts
   (noise/common/color chunks), dev/harness.ts (sandbox with camera-relative helper), scripts/shot.mjs.

Everyone is working at the same time. APIs in the contract files are FIXED; code against them and the
stubs will be replaced by real implementations underneath you. If a module you depend on is still a
stub, that is expected — never edit it; build and test against its contract.

Work loop for visual work: build → screenshot (scripts/shot.mjs) → LOOK at the PNG → critique it like
an art director comparing with real astrophotography / premium product UI → improve → repeat.
Several iterations minimum. Also check a narrow/mobile viewport where relevant (--mobile).

Definition of done: contract satisfied; strictly typed; tests for logic; your module README written;
typecheck/lint/tests clean for your paths; dev page(s) demonstrate the work; screenshots saved under
<scratch>/shots/<yourname>/; background processes stopped; final report per TEAM.md.
