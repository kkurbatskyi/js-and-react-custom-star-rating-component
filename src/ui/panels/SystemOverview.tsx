/** A star's system at a glance: the guidebook blurb's companion — planet list, zones and belts. */
import { formatDistanceKm, formatNumber, NBSP } from '../../core/format';
import type { Planet, StarSystem } from '../../core/types';
import { KM_PER_AU } from '../../core/units';
import { Icon } from '../components/Icon';
import { PlanetSwatch } from '../components/Swatches';
import { flyTo } from '../lib/actions';
import { planetTypeLabel } from '../lib/model';

export const kelvin = (k: number): string => `${formatNumber(k, { decimals: 0 })}${NBSP}K`;

const auRange = (a: number, b: number): string =>
  `${formatNumber(a / KM_PER_AU, { sig: 3 })}–${formatNumber(b / KM_PER_AU, { sig: 3 })}${NBSP}AU`;

export function PlanetRow({ planet }: { planet: Planet }) {
  return (
    <li>
      <button
        type="button"
        className="sd-row"
        onClick={() => flyTo({ kind: 'planet', id: planet.id })}
        aria-label={`${planet.name}, ${planetTypeLabel(planet.type)}. Fly there`}
      >
        <PlanetSwatch body={planet} size={32} className="sd-row__swatch" />
        <span className="sd-row__main">
          <span className="sd-row__name">
            {planet.name}
            {planet.rings && (
              <Icon name="ring" size={13} aria-label="Ringed" className="sd-row__glyph" />
            )}
            {planet.moons.length > 0 && (
              <span className="sd-row__glyph sd-mono" title={`${planet.moons.length} moons`}>
                <Icon name="moon" size={12} />
                {planet.moons.length}
              </span>
            )}
          </span>
          <span className="sd-row__meta">
            {planetTypeLabel(planet.type)} · {formatDistanceKm(planet.orbit.semiMajorAxisKm)}
          </span>
        </span>
        <span className="sd-row__aside">
          <span className="sd-mono sd-row__temp">{kelvin(planet.surfaceTempK)}</span>
          <span className="sd-row__badges">
            {planet.inHabitableZone && (
              <span className="sd-chip sd-chip--gold" title="Inside the habitable zone">
                HZ
              </span>
            )}
            {planet.life !== 'none' && (
              <span className="sd-row__life" title="Signs of life">
                <Icon name="life" size={13} />
              </span>
            )}
          </span>
        </span>
        <Icon name="chevronRight" size={14} className="sd-row__go" />
      </button>
    </li>
  );
}

export function SystemOverview({ system }: { system: StarSystem }) {
  const belts = system.belts.length;
  return (
    <section className="sd-block" aria-label="System overview">
      <h3 className="sd-heading">
        Planets <span className="sd-heading__count">{system.planets.length}</span>
      </h3>
      {system.planets.length > 0 ? (
        <ul className="sd-rows">
          {system.planets.map((p) => (
            <PlanetRow key={p.id} planet={p} />
          ))}
        </ul>
      ) : (
        <p className="sd-empty">No planets detected. Some stars prefer to keep to themselves.</p>
      )}
      {system.planets.length > 0 && (
        <p className="sd-footnote sd-mono">
          Habitable zone {auRange(...system.habitableZoneKm)} · frost line{' '}
          {formatDistanceKm(system.frostLineKm)}
          {belts > 0 ? ` · ${belts} ${belts === 1 ? 'belt' : 'belts'}` : ''}
        </p>
      )}
    </section>
  );
}
