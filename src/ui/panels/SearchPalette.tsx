/**
 * Search palette (⌘K / Ctrl+K / "/"): fuzzy search over stars and worlds through the Universe facade,
 * quick actions when the field is empty (home, surprise me, the galactic core, overview) and the
 * places you have been. A combobox: type, ↑/↓, Enter.
 */
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { SelectionRef } from '../../core/types';
import { useStore } from '../../state/store';
import { parseId } from '../../universe';
import { Icon, type IconName } from '../components/Icon';
import { Modal } from '../components/Modal';
import { StarRating } from '../components/StarRating';
import { modKeyLabel, useUniverse } from '../hooks';
import {
  flyHome,
  flyTo,
  flyToCore,
  galaxyOverview,
  type SurpriseKind,
  surpriseMe,
} from '../lib/actions';
import { type ObjectModel, objectName, resolveObject } from '../lib/model';
import { closePanels } from '../lib/panels';
import { ObjectGlyph } from './Glyph';
import './dialogs.css';

interface ActionItem {
  type: 'action';
  key: string;
  title: string;
  subtitle: string;
  icon: IconName;
  run: () => void;
}
interface ObjectItem {
  type: 'object';
  key: string;
  ref: SelectionRef;
  title: string;
  subtitle: string;
  model: ObjectModel | null;
  hint?: 'recent' | 'bookmark';
}
type Item = ActionItem | ObjectItem;
interface Section {
  title: string;
  items: Item[];
}

const surprise = (kind: SurpriseKind) => () => surpriseMe(kind);

const ACTIONS: readonly ActionItem[] = [
  { type: 'action', key: 'home', title: 'Fly home', subtitle: 'Back to Aurelia, where it all began', icon: 'home', run: flyHome },
  { type: 'action', key: 'surprise-habitable', title: 'Surprise me — a habitable world', subtitle: 'The best-looking planet in a random system', icon: 'sparkle', run: surprise('habitable') },
  { type: 'action', key: 'surprise-ringed', title: 'Surprise me — a ringed giant', subtitle: 'Something Saturn-shaped', icon: 'ring', run: surprise('ringed') },
  { type: 'action', key: 'surprise-exotic', title: 'Surprise me — an exotic object', subtitle: 'Pulsars, white dwarfs, things with event horizons', icon: 'core', run: surprise('exotic') },
  { type: 'action', key: 'core', title: 'Visit the galactic core', subtitle: 'Ouroboros, four million suns in a very small place', icon: 'core', run: flyToCore },
  { type: 'action', key: 'overview', title: 'Go to galaxy overview', subtitle: 'The whole spiral at once', icon: 'galaxy', run: galaxyOverview },
];

function refFromId(id: string): SelectionRef | null {
  const parsed = parseId(id);
  if (!parsed) return null;
  if (parsed.kind === 'star') return { kind: 'star', id: parsed.starId };
  if (parsed.kind === 'planet') return { kind: 'planet', id: parsed.planetId };
  return { kind: 'moon', id: parsed.moonId };
}

function subtitleFor(model: ObjectModel): string {
  if (model.kind === 'star') return `${model.star.spectralType} · ${model.system ? `${model.system.planets.length} planets` : 'unsurveyed'}`;
  if (model.kind === 'planet') return `${model.planet.type.replace('-', ' ')} · ${model.star.name}`;
  return `moon of ${model.planet.name} · ${model.star.name}`;
}

export function SearchPalette() {
  const open = useStore((s) => s.ui.open.search);
  return open ? <PaletteBody /> : null;
}

function PaletteBody() {
  const universe = useUniverse();
  const visited = useStore((s) => s.visited);
  const bookmarks = useStore((s) => s.bookmarks);
  const ratings = useStore((s) => s.ratings);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const q = query.trim();

  const sections: Section[] = useMemo(() => {
    const out: Section[] = [];
    if (q) {
      const lower = q.toLowerCase();
      const actions = ACTIONS.filter((a) => a.title.toLowerCase().includes(lower) || a.subtitle.toLowerCase().includes(lower));
      if (actions.length) out.push({ title: 'Actions', items: actions.slice(0, 3) });
      const found: Item[] = universe.search(q, 8).map((r) => {
        const model = resolveObject(universe, r.ref);
        return { type: 'object', key: `${r.ref.kind}:${r.ref.id}`, ref: r.ref, title: r.name, subtitle: r.subtitle, model };
      });
      if (found.length) out.push({ title: 'Stars & worlds', items: found });
      return out;
    }
    out.push({ title: 'Quick actions', items: [...ACTIONS] });
    const seen = new Set<string>();
    const recent: Item[] = [];
    const push = (id: string, hint: 'recent' | 'bookmark') => {
      const ref = refFromId(id);
      if (!ref || seen.has(id) || recent.length >= 6) return;
      const model = resolveObject(universe, ref);
      if (!model) return;
      seen.add(id);
      recent.push({ type: 'object', key: `${hint}:${id}`, ref, title: objectName(model), subtitle: subtitleFor(model), model, hint });
    };
    for (const v of visited.slice(0, 4)) push(v.id, 'recent');
    for (const b of bookmarks.slice(0, 4)) push(b, 'bookmark');
    if (recent.length) out.push({ title: 'Recent & bookmarked', items: recent });
    return out;
  }, [q, universe, visited, bookmarks]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, flat]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    closePanels();
    if (item.type === 'action') item.run();
    else flyTo(item.ref);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = flat.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (n ? (a + 1) % n : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (n ? (a - 1 + n) % n : 0));
    } else if (e.key === 'Home' && !q) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && !q) {
      e.preventDefault();
      setActive(Math.max(0, n - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(flat[active]);
    }
  };

  let index = -1;
  return (
    <Modal onClose={() => closePanels()} labelledBy="sd-search-title" variant="top" className="sd-palette">
      <h2 id="sd-search-title" className="sd-visually-hidden">
        Search stars and worlds
      </h2>
      <div className="sd-palette__field">
        <Icon name="search" size={19} />
        <input
          data-autofocus
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="sd-search-list"
          aria-activedescendant={flat[active] ? `sd-opt-${flat[active]?.key}` : undefined}
          aria-autocomplete="list"
          aria-label="Search stars and worlds"
          placeholder="Search a star, a world, a designation…"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <span className="sd-kbd" aria-hidden="true">
          Esc
        </span>
      </div>
      <div className="sd-palette__list" id="sd-search-list" role="listbox" aria-label="Results" ref={list}>
        {flat.length === 0 && (
          <p className="sd-palette__empty">
            Nothing by that name in this galaxy.
            <span>Try a star’s name, a planet, or a designation such as “SDR”.</span>
          </p>
        )}
        {sections.map((section) => (
          <div key={section.title} role="group" aria-label={section.title}>
            <p className="sd-eyebrow sd-palette__section">{section.title}</p>
            {section.items.map((item) => {
              index += 1;
              const i = index;
              const isActive = i === active;
              const rated = item.type === 'object' ? (ratings[item.ref.id] ?? 0) : 0;
              return (
                <div
                  key={item.key}
                  id={`sd-opt-${item.key}`}
                  role="option"
                  aria-selected={isActive}
                  tabIndex={-1}
                  className="sd-palette__item"
                  onPointerMove={() => !isActive && setActive(i)}
                  onClick={() => choose(item)}
                  onKeyDown={undefined}
                  data-sd-interactive
                >
                  <span className="sd-palette__glyph">
                    {item.type === 'action' ? <Icon name={item.icon} size={19} /> : <ObjectGlyph model={item.model} size={28} />}
                  </span>
                  <span className="sd-palette__text">
                    <span className={item.type === 'action' ? 'sd-palette__title is-action' : 'sd-palette__title'}>{item.title}</span>
                    <span className="sd-palette__sub">{item.subtitle}</span>
                  </span>
                  <span className="sd-palette__aside">
                    {item.type === 'object' && rated > 0 && (
                      <StarRating label={item.title} value={rated} readOnly size={11} caption="Your rating" />
                    )}
                    {item.type === 'object' && item.hint === 'bookmark' && <Icon name="bookmark" size={14} filled />}
                    {item.type === 'object' && item.hint === 'recent' && <Icon name="clock" size={14} />}
                    {isActive && <span className="sd-kbd">↵</span>}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <footer className="sd-palette__foot">
        <span>
          <span className="sd-kbd">↑</span> <span className="sd-kbd">↓</span> navigate
        </span>
        <span>
          <span className="sd-kbd">↵</span> go
        </span>
        <span className="sd-palette__foot-end">
          <span className="sd-kbd">{modKeyLabel()} K</span> toggles
        </span>
      </footer>
    </Modal>
  );
}
