/**
 * LabelOverlay — imperative, pooled DOM labels over the canvas (no React per frame).
 *
 * Every frame the engine hands over this frame's LabelSpecs (already occlusion-culled); the overlay
 * keeps the top MAX_LABELS by priority, measures text once per string (canvas measureText, cached),
 * lays them out greedily (./layout.ts), and fades entries in and out. DOM writes happen only when a
 * value changed (transforms for moving labels, opacity while fading). Labels are clickable: click
 * selects, double-click flies. Styling uses the UI's `--sd-*` tokens with fallbacks.
 */
import type { SelectionRef } from '../../core/types';
import type { LabelSpec } from '../contracts';
import { type LabelBox, layoutLabels } from './layout';

export interface LabelOverlayCallbacks {
  select(ref: SelectionRef): void;
  fly(ref: SelectionRef): void;
}

const MAX_LABELS = 40;
const FADE_LAMBDA = 14;
const NAME_FONT = '500 12px "IBM Plex Sans", system-ui, sans-serif';
const SUB_FONT = '400 10px "IBM Plex Mono", ui-monospace, monospace';
const NAME_TRACKING = 0.04 * 12;
const SUB_GAP = 6;
const LINE_H = 16;
/** Priority at or above which a label is emphasised (selected / focus tiers). */
const STRONG_PRIORITY = 4000;

const STYLE = `
.sd-labels { position: fixed; inset: 0; z-index: 1; pointer-events: none; overflow: hidden;
  contain: strict; font-family: var(--sd-font-ui, 'IBM Plex Sans', system-ui, sans-serif); }
.sd-labels[hidden] { display: none; }
.sd-label { position: absolute; left: 0; top: 0; will-change: transform, opacity; opacity: 0; }
.sd-label__marker { position: absolute; left: 0; top: 0; pointer-events: auto; cursor: pointer;
  box-sizing: border-box; border-radius: 50%; }
.sd-label__marker[data-kind="ring"] { width: 14px; height: 14px; margin: -7px 0 0 -7px;
  border: 1.5px solid var(--sd-marker, var(--sd-accent, #d9b36c)); }
.sd-label__marker[data-kind="dot"] { width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px;
  background: var(--sd-marker, var(--sd-text, #e9e4d8)); box-shadow: 0 0 6px var(--sd-marker, transparent); }
.sd-label__marker[data-kind=""] { display: none; }
.sd-label__text { position: absolute; left: 0; top: 0; white-space: nowrap; line-height: ${LINE_H}px;
  pointer-events: auto; cursor: pointer; user-select: none; -webkit-user-select: none;
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.9), 0 1px 8px rgba(0, 0, 0, 0.7); }
.sd-label__name { font-size: 12px; font-weight: 500; letter-spacing: 0.04em;
  color: var(--sd-text-dim, rgba(233, 228, 216, 0.72)); }
.sd-label__sub { margin-left: ${SUB_GAP}px; font: ${SUB_FONT}; font-family: var(--sd-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  font-variant-numeric: tabular-nums; color: var(--sd-text-dim, rgba(233, 228, 216, 0.55)); opacity: 0.8; }
.sd-label[data-strong] .sd-label__name { color: var(--sd-text, #e9e4d8); }
.sd-label[data-strong] .sd-label__sub { color: var(--sd-accent, #d9b36c); opacity: 1; }
.sd-label__text:hover .sd-label__name { color: var(--sd-accent-2, #8fb8ff); }
`;

interface Entry {
  key: string;
  root: HTMLDivElement;
  marker: HTMLDivElement;
  text: HTMLDivElement;
  name: HTMLSpanElement;
  sub: HTMLSpanElement;
  box: LabelBox;
  refKind: SelectionRef['kind'] | null;
  refId: string;
  alpha: number;
  target: number;
  seen: boolean;
  lastText: string;
  lastSub: string;
  lastMarker: string;
  lastColor: string;
  lastStrong: boolean;
  lastTransform: string;
  lastTextTransform: string;
  lastOpacity: number;
}

let styleInjected = false;

export class LabelOverlay {
  readonly element: HTMLDivElement;
  private readonly callbacks: LabelOverlayCallbacks;
  private readonly entries = new Map<string, Entry>();
  private readonly free: Entry[] = [];
  private readonly boxes: LabelBox[] = [];
  private readonly sorted: LabelSpec[] = [];
  private readonly widths = new Map<string, number>();
  private ctx2d: CanvasRenderingContext2D | null = null;
  private visible = true;

  constructor(container: HTMLElement, callbacks: LabelOverlayCallbacks) {
    this.callbacks = callbacks;
    if (!styleInjected) {
      styleInjected = true;
      const style = document.createElement('style');
      style.dataset.sidereal = 'labels';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    this.element = document.createElement('div');
    this.element.className = 'sd-labels';
    this.element.setAttribute('aria-hidden', 'true'); // the UI panel carries the accessible names
    container.appendChild(this.element);
    try {
      document.fonts?.addEventListener?.('loadingdone', () => this.widths.clear());
    } catch {
      // FontFaceSet unsupported: widths measured with fallback fonts are close enough
    }
  }

  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.element.hidden = !on;
  }

  /** Show this frame's labels (`specs` may be reordered). */
  update(specs: readonly LabelSpec[], count: number, width: number, height: number, dtSec: number): void {
    for (const e of this.entries.values()) e.seen = false;
    const sorted = this.sorted;
    sorted.length = 0;
    for (let i = 0; i < count; i++) sorted.push(specs[i]);
    sorted.sort(byPriority);
    const n = Math.min(sorted.length, MAX_LABELS);

    this.boxes.length = 0;
    for (let i = 0; i < n; i++) {
      const spec = sorted[i];
      const e = this.entries.get(spec.key) ?? this.acquire(spec.key);
      if (e.seen) continue; // duplicate key this frame: first (highest priority) wins
      e.seen = true;
      this.apply(e, spec);
      this.boxes.push(e.box);
    }
    layoutLabels(this.boxes, this.boxes.length, width, height);

    const k = 1 - Math.exp(-FADE_LAMBDA * Math.max(dtSec, 1 / 60));
    for (const e of this.entries.values()) {
      e.target = e.seen && e.box.visible ? 1 : 0;
      if (e.seen && e.box.visible) this.position(e);
      e.alpha += (e.target - e.alpha) * k;
      if (e.target === 0 && e.alpha < 0.02) {
        this.release(e);
        continue;
      }
      const o = Math.round(e.alpha * 100) / 100;
      if (o !== e.lastOpacity) {
        e.lastOpacity = o;
        e.root.style.opacity = String(o);
      }
    }
  }

  dispose(): void {
    this.element.remove();
    this.entries.clear();
    this.free.length = 0;
  }

  // ───────────────────────────────────────────── internals

  private apply(e: Entry, spec: LabelSpec): void {
    const text = spec.text;
    const sub = spec.sub ?? '';
    if (text !== e.lastText) {
      e.lastText = text;
      e.name.textContent = text;
    }
    if (sub !== e.lastSub) {
      e.lastSub = sub;
      e.sub.textContent = sub;
      e.sub.style.display = sub ? '' : 'none';
    }
    const marker = spec.marker ?? '';
    if (marker !== e.lastMarker) {
      e.lastMarker = marker;
      e.marker.dataset.kind = marker;
    }
    const color = spec.color ?? '';
    if (color !== e.lastColor) {
      e.lastColor = color;
      if (color) e.root.style.setProperty('--sd-marker', color);
      else e.root.style.removeProperty('--sd-marker');
    }
    const strong = spec.priority >= STRONG_PRIORITY;
    if (strong !== e.lastStrong) {
      e.lastStrong = strong;
      if (strong) e.root.dataset.strong = '';
      else delete e.root.dataset.strong;
    }
    e.refKind = spec.ref?.kind ?? null;
    e.refId = spec.ref?.id ?? '';
    const b = e.box;
    b.x = spec.x;
    b.y = spec.y;
    b.w = this.measure(text, NAME_FONT, NAME_TRACKING) + (sub ? SUB_GAP + this.measure(sub, SUB_FONT, 0) : 0);
    b.h = LINE_H;
    b.priority = spec.priority;
    b.gap = marker === 'ring' ? 11 : marker === 'dot' ? 7 : 8;
  }

  private position(e: Entry): void {
    const b = e.box;
    const t = `translate3d(${b.x.toFixed(1)}px,${b.y.toFixed(1)}px,0)`;
    if (t !== e.lastTransform) {
      e.lastTransform = t;
      e.root.style.transform = t;
    }
    const tt = `translate(${(b.left - b.x).toFixed(1)}px,${(b.top - b.y).toFixed(1)}px)`;
    if (tt !== e.lastTextTransform) {
      e.lastTextTransform = tt;
      e.text.style.transform = tt;
    }
    b.preferred = b.side;
  }

  private measure(text: string, font: string, tracking: number): number {
    const key = `${font}|${text}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      if (!this.ctx2d) this.ctx2d = document.createElement('canvas').getContext('2d');
      const ctx = this.ctx2d;
      if (ctx) {
        ctx.font = font;
        w = ctx.measureText(text).width + tracking * text.length;
      } else {
        w = text.length * 7;
      }
      if (this.widths.size > 4000) this.widths.clear();
      this.widths.set(key, w);
    }
    return w;
  }

  private acquire(key: string): Entry {
    const e = this.free.pop() ?? this.create();
    e.key = key;
    e.alpha = 0;
    e.lastOpacity = -1;
    e.box.preferred = -1;
    e.root.style.display = '';
    this.entries.set(key, e);
    return e;
  }

  private release(e: Entry): void {
    this.entries.delete(e.key);
    e.root.style.display = 'none';
    e.root.style.opacity = '0';
    e.lastOpacity = 0;
    e.refKind = null;
    this.free.push(e);
  }

  private create(): Entry {
    const root = document.createElement('div');
    root.className = 'sd-label';
    const marker = document.createElement('div');
    marker.className = 'sd-label__marker';
    marker.dataset.kind = '';
    const text = document.createElement('div');
    text.className = 'sd-label__text';
    const name = document.createElement('span');
    name.className = 'sd-label__name';
    const sub = document.createElement('span');
    sub.className = 'sd-label__sub';
    text.append(name, sub);
    root.append(marker, text);
    this.element.appendChild(root);
    const entry: Entry = {
      key: '',
      root,
      marker,
      text,
      name,
      sub,
      box: {
        x: 0,
        y: 0,
        w: 0,
        h: LINE_H,
        priority: 0,
        gap: 8,
        preferred: -1,
        visible: false,
        side: -1,
        left: 0,
        top: 0,
      },
      refKind: null,
      refId: '',
      alpha: 0,
      target: 0,
      seen: false,
      lastText: '',
      lastSub: '',
      lastMarker: '',
      lastColor: '',
      lastStrong: false,
      lastTransform: '',
      lastTextTransform: '',
      lastOpacity: -1,
    };
    const refOf = (): SelectionRef | null =>
      entry.refKind ? ({ kind: entry.refKind, id: entry.refId } as SelectionRef) : null;
    const onClick = (ev: MouseEvent): void => {
      ev.stopPropagation();
      const ref = refOf();
      if (ref) this.callbacks.select(ref);
    };
    const onDbl = (ev: MouseEvent): void => {
      ev.stopPropagation();
      const ref = refOf();
      if (ref) this.callbacks.fly(ref);
    };
    for (const el of [text, marker]) {
      el.addEventListener('click', onClick);
      el.addEventListener('dblclick', onDbl);
    }
    return entry;
  }
}

function byPriority(a: LabelSpec, b: LabelSpec): number {
  return b.priority - a.priority;
}
