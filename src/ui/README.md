# src/ui — the React overlay

*A classical star atlas meets an observatory instrument panel.* Ink-glass panels over the 3D view,
hairline rules, tick marks, catalogue numbers, small caps — one deliberately dark theme — and the
product's wink: **a star-rating component that rates actual stars**.

```tsx
import { App } from './ui/App';   // no props; mounted by src/main.tsx inside #app (pointer-events: none)
```

Everything reads state through `useStore` (`src/state/store.ts`) and data through the Universe facade
(`getUniverse(seed)`); camera actions go through `engineCommands()` (`src/state/bridge.ts`). The
overlay never touches the engine directly and re-renders only on throttled store writes.

## What is here

| Path | |
|---|---|
| `App.tsx` | composition, layout info, global shortcuts, visit tracking, photo-mode attribute |
| `theme.css` | design tokens (`--sd-*` on `:root`, also used by the engine's label overlay) + primitives |
| `layout.css` | where the HUD slots sit (desktop / medium / phone / short windows) |
| `fonts.ts` | self-hosted `@fontsource` latin subsets: Cormorant Garamond 500/600/500i, IBM Plex Sans 400/500, Plex Mono 400/500 |
| `components/` | `StarRating`, `Icon` (hand-drawn SVG), `Swatches` (planet/star pictures), `Specs` (leader rows, meter, composition bars), `Modal`, `CopyLinkButton`, `ErrorBoundary` |
| `panels/` | `TopBar` · `InfoPanel` (+ `ObjectCards`, `SystemOverview`, `GalaxyCard`) · `SearchPalette` · `Logbook` · `SettingsPanel` · `HelpOverlay` · `Onboarding` · `LoadingScreen` · `PhotoMode` |
| `hud/` | `TimeControls` · `ScaleBar` · `Coordinates` · `Minimap` · `ViewControls` · `HoverTooltip` · `Toasts` · `FpsMeter` |
| `lib/` | pure helpers: `model` (ids → card models, words, breadcrumbs), `scale` (ruler maths), `links` (deep-link token, clipboard), `minimapRender`, `actions` (fly/select/surprise), `panels`, `shortcuts`, small zustand stores for the phone sheet and photo preview |

## StarRating

```tsx
<StarRating label="Kiranth" value={rating} onChange={(v) => (v === 0 ? clear(id) : rate(id, v))} />
<StarRating label="Halcyon" value={3.5} readOnly caption="Surveyor’s rating" tone="muted" showValue />
```

* **Interactive** (`onChange` given): an ARIA radio group with a roving tabindex and labels such as
  “Rate Kiranth 4 of 5 stars”. ← ↓ / → ↑ move to and choose the neighbouring star, Home / End jump,
  digits choose directly, Backspace / Delete / 0 clear; **choosing the current value again clears it**
  (`onChange(0)`). Mouse hover previews (`onPreview` reports it — the info card turns it into the
  verdict word: *Skip it · Mostly harmless · Worth a stop · Recommended · Unmissable*), the pointed-at
  star twinkles, and a newly chosen fifth star sets off a small supernova (rays + ring + a ripple
  through the filled stars).
* **Read-only**: `role="img"` with a spoken value; halves render as half-filled stars.
* Stars are SVG (outline + faceted fill + soft glow); sizes 11–48 px; ≥ 44 px tap area on touch.

## Layout

The overlay is a CSS container (`container: sd / size`), so every responsive rule follows *its own*
box, not the window — dev/ui.tsx previews the phone layout inside a 390×844 frame. Breakpoints:
≤ 1180 px (tighter clock, ruler yields to the panel), ≤ 720 px (phone), height ≤ 560 / 430 px.

* **Desktop**: top bar (wordmark, breadcrumbs, search ⌘K, logbook, settings, sound, help); info plate
  on the right (collapses to a tab); camera buttons left; minimap + scale ruler bottom-left;
  coordinates under the wordmark; clock bottom-right of the free area.
* **Phone**: two-row top bar (help moves into Settings), minimap and camera buttons under it, and the
  info card as a **bottom sheet** with three snaps — peek (stars + fly) → half → full — by drag, tap,
  chevron or ↑/↓ on the grip. The first selection arrives as a peek. Dialogs go full-screen.
* `data-panel` / `data-sheet` on `.sd-layout` tell CSS how much room the card takes.

## Behaviour worth knowing

* **What the card shows**: `selection`, else the object the camera is at or *flying to*
  (`flightTarget`) — so deep links and search results open their card and flights are announced in the
  breadcrumbs (“En route to …”) with a progress hairline.
* **Keys.** The engine owns the camera and clock keys (arrows/WASD, + −, F, Space, H, [ ]). The UI
  owns `⌘/Ctrl+K` and `/` (search), `?` (help), `L` (logbook), `M` (mute) and **Escape while something
  is open** (photo preview → dialog → photo mode). The handler runs in the capture phase and calls
  `stopPropagation()` for exactly those, so the engine's own Escape (“up a level”) never double-fires.
* **Photo mode** unmounts every other piece of UI, sets `html[data-sd-photo="on"]`, offers a shutter
  (`engineCommands().capture()`), and shows the PNG in an in-page preview with a download link — hosts
  may block downloads, so right-click / long-press also works. Object URLs are revoked on close.
* **Visits**: when the camera has arrived (`flightProgress === null`) at a star/planet/moon, its star
  is `markVisited` unless it is already the newest entry (idempotent with `StoreSync`).
* **Copy link** builds `[<seed>~]<id>` (`lib/links.ts`; identical to `formatDeepLink` in `src/app/deepLink.ts`, pinned by a test), uses the
  async clipboard, then `execCommand`, then reveals the URL pre-selected — never `alert()`.
* **Motion**: `data-motion="reduce"` is set when the OS *or* Settings asks for it and kills every
  animation/transition; the boot ring's SMIL orbiter is also skipped. `quality: low` drops the
  backdrop blur (`data-fx="low"`), the costly part over a live canvas.
* **Errors**: each big surface sits in an `ErrorBoundary` (“instrument fault”); unknown ids show an
  *Uncharted* card; the logbook lists unresolvable ids as inert rows.
* **Minimap**: rendered once per seed from `GalaxyModel` (density → brightness, `bulgeFraction` warm,
  `youngFraction` blue, dust lanes, deterministic stipple); click or arrows + Enter to fly.
* **Scale ruler** assumes a 50° vertical field of view (`DEFAULT_FOV_DEG` in `lib/scale.ts`); change it
  there if the engine's camera differs.

## Tokens (theme.css)

`--sd-ink` `--sd-panel` `--sd-line` `--sd-text` `--sd-text-dim` `--sd-accent` (stellar gold: ratings,
primary actions) `--sd-accent-2` (Rayleigh blue: focus) `--sd-danger` · `--sd-font-display|ui|mono` ·
spacing `--sd-s-1…7`, radius `--sd-r-*`, shadows, z-index `--sd-z-*`, motion `--sd-ease` / `--sd-dur-*`,
safe-area `--sd-safe-*`, and the atmosphere series `--sd-gas-1…6`. Components use tokens, not literals.

## Testing and dev pages

* `npx vitest run src/ui` — StarRating (roles, keys, halves, nova), libs (`scale`, `links`, `model`,
  `shortcuts`), and happy-dom integration tests of App, SearchPalette, TimeControls, Onboarding and
  Logbook (including the phone sheet).
* `dev/ui.html` — the full overlay over a static 2D starfield with mock data; query flags are listed in
  `dev/ui.tsx` (`?sel=star|planet|moon|giant|core|neutron|none &open=search,logbook,… &photo=1
  &mobile=1 &flight=0.4 &loading=0.4 &onboard=1 &hover=planet &toast=1 &panel=0`).
* `dev/ui-stars.html` — StarRating in every state (`--dpr=2` for a close look).
* Screenshots: `node scripts/shot.mjs "http://127.0.0.1:5302/dev/ui.html?sel=star&panel=0" out.png
  --size=1280x800` and `--mobile` for the phone layout.

## Known limits

* `formatToken` is implemented locally until `src/universe/ids.ts` exports one (pinned by a test).
* The mock `universe.search` can list a remembered body twice; the palette de-duplicates.
* Landscape phones use the desktop layout with the whole card scrolling; the minimap is hidden below
  430 px of height.
