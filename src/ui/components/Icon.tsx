/**
 * Hand-drawn inline icons: 24×24 grid, 1.4 px strokes, round caps — an engraver's line, not an
 * icon font. `filled` icons fill with currentColor at low opacity (bookmark, star).
 */
import type { ReactNode, SVGProps } from 'react';

const P = (d: string) => <path d={d} />;

const ICONS = {
  search: (
    <>
      <circle cx="10.6" cy="10.4" r="6.3" />
      <path d="M15.3 15.1 20.2 20" />
      <path d="M7.7 8.5a3.7 3.7 0 0 1 2.3-1.5" opacity=".55" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.6C10.2 5.3 7.8 4.7 4.5 4.7v13.2c3.3 0 5.7.6 7.5 1.9 1.8-1.3 4.2-1.9 7.5-1.9V4.7c-3.3 0-5.7.6-7.5 1.9Z" />
      <path d="M12 6.6v13.2" />
      <path d="M15.6 9.1v2.6M14.3 10.4h2.6" opacity=".7" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h8.2M16.8 7H20M4 12h3.2M11.8 12H20M4 17h9.2M17.8 17H20" />
      <circle cx="14.5" cy="7" r="2.2" />
      <circle cx="9.5" cy="12" r="2.2" />
      <circle cx="15.5" cy="17" r="2.2" />
    </>
  ),
  sound: (
    <>
      <path d="M4.5 9.6h3.2l4.6-3.7v12.2l-4.6-3.7H4.5Z" />
      <path d="M15.4 9.3a3.8 3.8 0 0 1 0 5.4M17.9 6.9a7.2 7.2 0 0 1 0 10.2" />
    </>
  ),
  mute: (
    <>
      <path d="M4.5 9.6h3.2l4.6-3.7v12.2l-4.6-3.7H4.5Z" />
      <path d="m15.8 9.6 4.4 4.8M20.2 9.6l-4.4 4.8" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M9.5 9.7a2.6 2.6 0 0 1 5 .7c0 1.8-2.5 2.1-2.5 3.8" />
      <path d="M12 16.9h.01" strokeWidth="1.9" />
    </>
  ),
  close: P('M6 6l12 12M18 6 6 18'),
  plus: P('M12 5v14M5 12h14'),
  minus: P('M5 12h14'),
  check: P('m5 12.5 4.5 4.5L19 7'),
  chevronDown: P('m6.5 9.5 5.5 5.5 5.5-5.5'),
  chevronUp: P('m6.5 14.5 5.5-5.5 5.5 5.5'),
  chevronLeft: P('m14.5 6.5-5.5 5.5 5.5 5.5'),
  chevronRight: P('m9.5 6.5 5.5 5.5-5.5 5.5'),
  crumb: P('m10 7 5 5-5 5'),
  bookmark: P('M7 4.6h10v15.1l-5-3.7-5 3.7Z'),
  fly: (
    <>
      <path d="M20.3 3.7 3.9 10.5l6.5 2.5 2.5 6.5Z" />
      <path d="m10.4 13 4.1-4.1" />
    </>
  ),
  link: (
    <>
      <path d="M10.3 13.7a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1 1" />
      <path d="M13.7 10.3a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1-1" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.6h3.1l1.6-2.4h6.6l1.6 2.4H20v10.1H4Z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  reset: (
    <>
      <circle cx="12" cy="12" r="5.2" />
      <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4" />
      <circle cx="12" cy="12" r=".6" />
    </>
  ),
  up: (
    <>
      <path d="M12 19.5V8.2M7 12.8l5-5 5 5" />
      <path d="M6 4.5h12" />
    </>
  ),
  play: P('M8.2 5.6v12.8l10.2-6.4Z'),
  pause: P('M8.5 5.5v13M15.5 5.5v13'),
  slower: P('m11.5 7-5 5 5 5M18 7l-5 5 5 5'),
  faster: P('m6 7 5 5-5 5M12.5 7l5 5-5 5'),
  now: (
    <>
      <path d="M4.6 12a7.4 7.4 0 1 1 2.2 5.3" />
      <path d="M4.3 7.2v4.4h4.4" />
      <path d="M12 8v4.2l2.9 1.7" />
    </>
  ),
  sparkle: P('M12 3.4c.6 4.7 1.9 6 6.6 6.6-4.7.6-6 1.9-6.6 6.6-.6-4.7-1.9-6-6.6-6.6 4.7-.6 6-1.9 6.6-6.6Z'),
  home: (
    <>
      <path d="M4.4 11.2 12 4.6l7.6 6.6" />
      <path d="M6.4 9.9v9.6h11.2V9.9" />
      <path d="M10 19.5v-5h4v5" />
    </>
  ),
  galaxy: (
    <>
      <path d="M12 12c0-1.7 2.5-2.3 4-1 2.1 1.9.8 5.3-2 6.3-3.6 1.3-7.6-1.1-8-5.1-.4-4.4 3.4-7.7 7.8-7.3" />
      <circle cx="12" cy="12" r=".9" />
    </>
  ),
  core: (
    <>
      <circle cx="12" cy="12" r="3" />
      <ellipse cx="12" cy="12" rx="9" ry="3.2" transform="rotate(-20 12 12)" />
    </>
  ),
  star: P('m12 3.6 2.5 5.7 6.2.6-4.7 4.1 1.4 6.1L12 16.9l-5.4 3.2L8 14l-4.7-4.1 6.2-.6Z'),
  planet: (
    <>
      <circle cx="12" cy="12" r="4.8" />
      <ellipse cx="12" cy="12" rx="9.4" ry="2.9" transform="rotate(-22 12 12)" />
    </>
  ),
  moon: P('M18.6 14.7A7.6 7.6 0 0 1 9.3 5.4a7.6 7.6 0 1 0 9.3 9.3Z'),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.3" />
      <path d="M12 7.3V12l3.1 1.9" />
    </>
  ),
  orbit: (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="4.2" transform="rotate(-24 12 12)" />
      <circle cx="12" cy="12" r="2.1" />
      <path d="m17.7 6.9 2 .3-.6 1.9" />
    </>
  ),
  pinch: (
    <>
      <path d="M14.5 9.5 20 4M9.5 14.5 4 20" />
      <path d="M15 4h5v5M9 20H4v-5" />
    </>
  ),
  pointer: (
    <>
      <path d="M7 4.6 18.6 10l-5.2 1.7-1.9 5.4Z" />
      <path d="M16.2 16.2a4 4 0 0 1 2.4 2.4" opacity=".6" />
    </>
  ),
  download: P('M12 4.5v10.5M7.5 10.6 12 15l4.5-4.4M5 19.5h14'),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
      <path d="M15.5 8.5v-2a1.5 1.5 0 0 0-1.5-1.5H6.5A1.5 1.5 0 0 0 5 6.5V14a1.5 1.5 0 0 0 1.5 1.5h2" />
    </>
  ),
  shutter: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="m12 3.6 3.6 6.2M20.2 9.6l-7.2.1M18.4 17.4 14.9 11M8.4 20.1l3.6-6.2M3.8 14.4l7.2-.1M5.6 6.6 9.1 13" opacity=".7" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12S6.2 6 12 6s9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  life: (
    <>
      <path d="M12 20V11" />
      <path d="M12 13.5C8.3 13.5 6 11.3 6 7.3c3.8 0 6 2 6 6.2Z" />
      <path d="M12 16.2c3.3 0 5.4-1.9 5.4-5.4-3.4 0-5.4 1.8-5.4 5.4Z" />
    </>
  ),
  ring: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <ellipse cx="12" cy="12" rx="9" ry="3" transform="rotate(-18 12 12)" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  filled?: boolean;
}

export function Icon({ name, size = 18, filled = false, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      fillOpacity={filled ? 0.28 : undefined}
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {ICONS[name]}
    </svg>
  );
}

/** The Sidereal mark: an armillary ring with cardinal ticks and a four-point star. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="12.6" stroke="currentColor" strokeWidth="0.9" opacity="0.75" />
      <path
        d="M16 1.6v4M16 26.4v4M1.6 16h4M26.4 16h4"
        stroke="currentColor"
        strokeWidth="0.9"
        opacity="0.75"
        strokeLinecap="round"
      />
      <path
        d="M16 6.4c.8 6.6 2.7 8.5 9.2 9.6-6.5 1.1-8.4 3-9.2 9.6-.8-6.6-2.7-8.5-9.2-9.6 6.5-1.1 8.4-3 9.2-9.6Z"
        fill="var(--sd-accent)"
      />
      <circle cx="24.3" cy="7.7" r="1.2" fill="var(--sd-accent-2)" />
    </svg>
  );
}
