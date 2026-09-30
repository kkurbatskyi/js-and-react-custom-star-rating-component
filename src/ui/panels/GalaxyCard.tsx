/** The empty selection: the galaxy itself, and a few good places to start. */
import type { CSSProperties } from 'react';
import { formatCount, formatLy, formatNumber, NBSP } from '../../core/format';
import { useStore } from '../../state/store';
import { Icon } from '../components/Icon';
import { useUniverse } from '../hooks';
import { flyHome, flyToCore, surpriseMe } from '../lib/actions';
import { radiusFromCentreLy } from '../lib/model';

export function GalaxyCard() {
  const universe = useUniverse();
  const cameraLy = useStore((s) => s.cameraLy);
  const visited = useStore((s) => s.visited.length);
  const rated = useStore((s) => Object.keys(s.ratings).length);
  const bookmarked = useStore((s) => s.bookmarks.length);
  const p = universe.galaxy.params;
  const home = radiusFromCentreLy(p.homeLy);
  const here = radiusFromCentreLy(cameraLy);
  const arms = p.armCount;
  const shape = p.barLengthLy > 0 ? 'Barred spiral' : 'Spiral galaxy';
  return (
    <>
      <header
        className="sd-info__head"
        style={{ '--sd-tint': 'var(--sd-accent-2)' } as CSSProperties}
      >
        <div className="sd-info__eyebrow">
          <Icon name="galaxy" size={15} />
          <span className="sd-eyebrow">Galaxy</span>
          <span className="sd-info__cat">seed {p.seed}</span>
        </div>
        <h2 className="sd-info__name" id="sd-info-title">
          {p.name}
        </h2>
        <p className="sd-info__sub">
          {shape} · {arms} arms
        </p>
      </header>
      <div className="sd-info__scroll">
        <p className="sd-blurb">
          About {formatCount(p.estimatedStarCount)} stars in a disk {formatLy(p.radiusLy * 2)}{' '}
          across. Home is {formatLy(home)} from the middle, in the suburbs, which is where the good
          restaurants are.
        </p>
        <section className="sd-block">
          <h3 className="sd-heading">Begin</h3>
          <div className="sd-starts">
            <button type="button" className="sd-btn sd-btn--primary" onClick={flyHome}>
              <Icon name="home" size={15} />
              Fly home
            </button>
            <button type="button" className="sd-btn" onClick={() => surpriseMe('habitable')}>
              <Icon name="sparkle" size={15} />
              Surprise me
            </button>
            <button type="button" className="sd-btn" onClick={flyToCore}>
              <Icon name="core" size={15} />
              Galactic core
            </button>
          </div>
        </section>
        <section className="sd-block">
          <h3 className="sd-heading">Your log</h3>
          <dl className="sd-tally">
            <div>
              <dt className="sd-eyebrow">Visited</dt>
              <dd className="sd-mono">{visited}</dd>
            </div>
            <div>
              <dt className="sd-eyebrow">Rated</dt>
              <dd className="sd-mono">{rated}</dd>
            </div>
            <div>
              <dt className="sd-eyebrow">Bookmarked</dt>
              <dd className="sd-mono">{bookmarked}</dd>
            </div>
          </dl>
          <p className="sd-footnote sd-mono">
            You are {formatNumber(here, { decimals: 0 })}
            {NBSP}ly from the centre.
          </p>
        </section>
      </div>
    </>
  );
}
