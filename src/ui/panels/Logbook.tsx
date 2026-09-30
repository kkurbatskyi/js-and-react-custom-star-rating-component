/**
 * Logbook: what you have rated ("Your top-rated stars"), visited and bookmarked, for the current
 * galaxy. Kept in this browser (the store persists it per galaxy seed). Click an entry to fly there.
 */
import { useMemo, useState } from 'react';
import { formatNumber } from '../../core/format';
import type { SelectionRef } from '../../core/types';
import { useStore } from '../../state/store';
import { parseId } from '../../universe';
import type { Universe } from '../../universe/contracts';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { StarRating } from '../components/StarRating';
import { useLayout, useUniverse } from '../hooks';
import { flyHome, flyTo } from '../lib/actions';
import { type ObjectModel, objectName, resolveObject } from '../lib/model';
import { closePanels } from '../lib/panels';
import { ObjectGlyph } from './Glyph';
import './dialogs.css';

type Tab = 'top' | 'visited' | 'bookmarks';

interface Entry {
  id: string;
  ref: SelectionRef;
  model: ObjectModel | null;
  name: string;
  sub: string;
  rating: number;
  at?: number;
}

const TAB_LABEL: Record<Tab, string> = {
  top: 'Top rated',
  visited: 'Visited',
  bookmarks: 'Bookmarked',
};

function refFromId(id: string): SelectionRef | null {
  const p = parseId(id);
  if (!p) return null;
  return p.kind === 'star'
    ? { kind: 'star', id: p.starId }
    : p.kind === 'planet'
      ? { kind: 'planet', id: p.planetId }
      : { kind: 'moon', id: p.moonId };
}

function makeEntry(
  universe: Universe,
  ratings: Record<string, number>,
  id: string,
  at?: number,
): Entry | null {
  const ref = refFromId(id);
  if (!ref) return null;
  const model = resolveObject(universe, ref);
  const sub = !model
    ? 'Unknown object'
    : model.kind === 'star'
      ? `${model.star.spectralType} · ${model.system?.planets.length ?? 0} planets`
      : model.kind === 'planet'
        ? `${model.planet.type.replace('-', ' ')} · ${model.star.name}`
        : `moon of ${model.planet.name}`;
  return {
    id,
    ref,
    model,
    name: model ? objectName(model) : id,
    sub,
    rating: ratings[id] ?? 0,
    at,
  };
}

/** "just now", "12 min ago", "3 h ago", "2 days ago", then a date. */
export function relativeTime(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86_400 * 14) return `${Math.round(s / 86_400)} days ago`;
  return new Date(at).toISOString().slice(0, 10);
}

const EMPTY: Record<Tab, { title: string; body: string }> = {
  top: {
    title: 'Nothing rated yet.',
    body: 'The galaxy is waiting to be judged. Open any star or planet and give it stars.',
  },
  visited: {
    title: 'You have not been anywhere.',
    body: 'Everywhere is, technically, still an option.',
  },
  bookmarks: {
    title: 'Nothing bookmarked.',
    body: 'Use the ribbon on a star or planet to keep it here.',
  },
};

export function Logbook() {
  const open = useStore((s) => s.ui.open.logbook);
  return open ? <LogbookBody /> : null;
}

function LogbookBody() {
  const universe = useUniverse();
  const ratings = useStore((s) => s.ratings);
  const visited = useStore((s) => s.visited);
  const bookmarks = useStore((s) => s.bookmarks);
  const { compact } = useLayout();
  const hasRatings = Object.keys(ratings).length > 0;
  const [tab, setTab] = useState<Tab>(hasRatings ? 'top' : 'visited');

  const lists = useMemo(() => {
    const clean = (xs: (Entry | null)[]) => xs.filter((x): x is Entry => x !== null);
    const make = (id: string, at?: number) => makeEntry(universe, ratings, id, at);
    return {
      top: clean(Object.keys(ratings).map((id) => make(id))).sort(
        (a, b) => b.rating - a.rating || a.name.localeCompare(b.name),
      ),
      visited: clean(visited.map((v) => make(v.id, v.at))),
      bookmarks: clean(bookmarks.map((id) => make(id))),
    };
  }, [universe, ratings, visited, bookmarks]);

  const values = Object.values(ratings);
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const shown = lists[tab];

  const go = (e: Entry) => {
    if (compact) closePanels();
    flyTo(e.ref);
  };

  return (
    <Modal
      onClose={() => closePanels()}
      labelledBy="sd-logbook-title"
      variant="left"
      className="sd-logbook"
    >
      <header className="sd-dialog__head">
        <div>
          <p className="sd-eyebrow">Kept in this browser · {universe.galaxy.params.name}</p>
          <h2 id="sd-logbook-title" className="sd-dialog__title">
            Logbook
          </h2>
        </div>
        <button
          type="button"
          className="sd-iconbtn"
          aria-label="Close logbook"
          onClick={() => closePanels()}
        >
          <Icon name="close" size={18} />
        </button>
      </header>

      <p className="sd-logbook__summary">
        {visited.length + values.length + bookmarks.length === 0
          ? 'A blank log. Go and have opinions.'
          : `${visited.length} visited, ${values.length} rated${values.length ? ` (average ${formatNumber(average, { decimals: 1 })} stars)` : ''}, ${bookmarks.length} bookmarked.`}
      </p>

      <div className="sd-tabs" role="tablist" aria-label="Logbook sections">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`sd-tab-${t}`}
            aria-selected={tab === t}
            aria-controls="sd-logbook-panel"
            tabIndex={tab === t ? 0 : -1}
            className="sd-tab"
            onClick={() => setTab(t)}
            onKeyDown={(e) => {
              const order = Object.keys(TAB_LABEL) as Tab[];
              const i = order.indexOf(t);
              const next =
                e.key === 'ArrowRight'
                  ? order[(i + 1) % 3]
                  : e.key === 'ArrowLeft'
                    ? order[(i + 2) % 3]
                    : null;
              if (next) {
                e.preventDefault();
                setTab(next);
                document.getElementById(`sd-tab-${next}`)?.focus();
              }
            }}
          >
            {TAB_LABEL[t]}
            <span className="sd-mono">{lists[t].length}</span>
          </button>
        ))}
      </div>

      <div
        id="sd-logbook-panel"
        role="tabpanel"
        aria-labelledby={`sd-tab-${tab}`}
        className="sd-logbook__list"
      >
        {shown.length === 0 ? (
          <div className="sd-empty-state">
            <Icon
              name={tab === 'bookmarks' ? 'bookmark' : tab === 'visited' ? 'fly' : 'star'}
              size={26}
            />
            <p className="sd-empty-state__title">{EMPTY[tab].title}</p>
            <p className="sd-empty-state__body">{EMPTY[tab].body}</p>
            <button
              type="button"
              className="sd-btn sd-btn--primary"
              onClick={() => {
                closePanels();
                flyHome();
              }}
            >
              <Icon name="home" size={15} />
              Fly home
            </button>
          </div>
        ) : (
          <>
            {tab === 'top' && <h3 className="sd-heading">Your top-rated stars</h3>}
            <ul className="sd-rows">
              {shown.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className="sd-row sd-row--log"
                    onClick={() => go(e)}
                    disabled={!e.model}
                  >
                    <span className="sd-row__swatch">
                      <ObjectGlyph model={e.model} size={30} />
                    </span>
                    <span className="sd-row__main">
                      <span className="sd-row__name">{e.name}</span>
                      <span className="sd-row__meta">{e.sub}</span>
                    </span>
                    <span className="sd-row__aside">
                      {e.rating > 0 && (
                        <StarRating
                          label={e.name}
                          value={e.rating}
                          readOnly
                          size={12}
                          caption="Your rating"
                        />
                      )}
                      {tab === 'visited' && e.at !== undefined && (
                        <span className="sd-mono sd-row__temp">{relativeTime(e.at)}</span>
                      )}
                    </span>
                    <Icon name="chevronRight" size={14} className="sd-row__go" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
