/**
 * The cards inside the info panel: header, rating plate, actions, and the star / planet / moon
 * bodies. Data comes from the Universe facade via `ObjectModel`; user data from the store.
 */
import { type CSSProperties, useState } from 'react';
import { rgbToCss, saturateRGB } from '../../core/color';
import {
  formatAgeGyr,
  formatDensityGcc,
  formatDistanceKm,
  formatGravityG,
  formatLuminositySolar,
  formatMassEarth,
  formatMassSolar,
  formatNumber,
  formatPeriodDays,
  formatPressureAtm,
  formatRadiusKm,
  formatRadiusSolar,
  formatTemperature,
  NBSP,
} from '../../core/format';
import type { Moon, Planet } from '../../core/types';
import { engineCommands } from '../../state/bridge';
import { useStore } from '../../state/store';
import { CopyLinkButton } from '../components/CopyLinkButton';
import { Icon } from '../components/Icon';
import { StarRating } from '../components/StarRating';
import { CompositionBars, Meter, SpecList } from '../components/Specs';
import { PlanetSwatch, StarGlyph } from '../components/Swatches';
import { useUniverse } from '../hooks';
import { flyTo, focusIs } from '../lib/actions';
import {
  type ObjectModel,
  bodyOf,
  habitabilityLabel,
  homeDistanceLabel,
  LIFE_LABEL,
  objectName,
  planetTypeLabel,
  ratingWord,
  starClassLabel,
  surveyRatingOf,
  distanceLy,
} from '../lib/model';
import { PlanetRow, SystemOverview, kelvin } from './SystemOverview';

// ───────────────────────────────────────────────────────────── header

function headerFacts(model: ObjectModel, homeLabel: string) {
  if (model.kind === 'star') {
    return {
      kind: 'Star',
      parent: null as string | null,
      catalogue: model.star.designation as string | null,
      sub: `${starClassLabel(model.star)}${homeLabel ? ` · ${homeLabel}` : ''}`,
    };
  }
  if (model.kind === 'planet') {
    const { planet, star } = model;
    const giant = planet.sudarskyClass ? ` · class ${planet.sudarskyClass}` : '';
    return {
      kind: 'Planet',
      parent: star.name,
      catalogue: null,
      sub: `${planetTypeLabel(planet.type)}${giant}${planet.inHabitableZone ? ' · habitable zone' : ''}`,
    };
  }
  const { moon, planet } = model;
  return {
    kind: 'Moon',
    parent: planet.name,
    catalogue: null,
    sub: `${planetTypeLabel(moon.type, true)} of ${planet.name}`,
  };
}

export function ObjectHeader({ model }: { model: ObjectModel }) {
  const universe = useUniverse();
  const name = objectName(model);
  const home = model.kind === 'star' ? homeDistanceLabel(universe, model.star.posLy) : '';
  const facts = headerFacts(model, home);
  const body = bodyOf(model);
  const tint = rgbToCss(body ? body.appearance.swatch : saturateRGB(model.star.colorRGB, 1.25));
  return (
    <header className="sd-info__head" style={{ '--sd-tint': tint } as CSSProperties}>
      <div className="sd-info__eyebrow">
        {model.kind === 'star' ? (
          <StarGlyph star={model.star} size={11} />
        ) : (
          body && <PlanetSwatch body={body} size={16} />
        )}
        <span className="sd-eyebrow">
          {facts.kind}
          {facts.parent ? ` · ${facts.parent}` : ''}
        </span>
        {facts.catalogue && (
          <span className="sd-info__cat" title={facts.catalogue}>
            {facts.catalogue}
          </span>
        )}
      </div>
      <h2 className="sd-info__name" id="sd-info-title">
        {name}
      </h2>
      <p className="sd-info__sub">{facts.sub}</p>
    </header>
  );
}

// ───────────────────────────────────────────────────────────── rating plate

function BookmarkButton({ id, name }: { id: string; name: string }) {
  const on = useStore((s) => s.bookmarks.includes(id));
  const toggle = useStore((s) => s.toggleBookmark);
  return (
    <button
      type="button"
      className="sd-iconbtn sd-plate__bookmark"
      aria-pressed={on}
      aria-label={on ? `Remove bookmark for ${name}` : `Bookmark ${name}`}
      title={on ? 'Bookmarked' : 'Bookmark'}
      onClick={() => toggle(id)}
    >
      <Icon name="bookmark" size={20} filled={on} />
    </button>
  );
}

/** "Your rating" (interactive) and "Surveyor's rating" (read-only, halves). */
export function RatingPlate({ id, name, survey }: { id: string; name: string; survey: number | null }) {
  const rating = useStore((s) => s.ratings[id] ?? 0);
  const rate = useStore((s) => s.rate);
  const clear = useStore((s) => s.clearRating);
  const [preview, setPreview] = useState(0);
  const word = ratingWord(preview || rating);
  return (
    <section className="sd-plate" aria-label="Ratings">
      <div className="sd-plate__top">
        <span className="sd-eyebrow">Your rating</span>
        <span className="sd-plate__word" aria-live="polite" data-set={rating > 0 || preview > 0 ? '' : undefined}>
          {word}
        </span>
      </div>
      <div className="sd-plate__stars">
        <StarRating
          key={id}
          label={name}
          value={rating}
          size={30}
          onChange={(v) => (v === 0 ? clear(id) : rate(id, v))}
          onPreview={setPreview}
        />
        <BookmarkButton id={id} name={name} />
      </div>
      {survey !== null && (
        <div className="sd-plate__survey">
          <span className="sd-plate__survey-label">Surveyor’s rating</span>
          <StarRating label={name} value={survey} readOnly size={14} tone="muted" showValue caption="Surveyor’s rating" />
        </div>
      )}
    </section>
  );
}

// ───────────────────────────────────────────────────────────── actions

export function FlyButton({ model, compact = false }: { model: ObjectModel; compact?: boolean }) {
  const ref = { kind: model.kind, id: model.id } as const;
  const focus = useStore((s) => s.focus);
  const flightTarget = useStore((s) => s.flightTarget);
  const progress = useStore((s) => s.flightProgress);
  const headingHere = focusIs(flightTarget, ref) && progress !== null;
  const here = !headingHere && focusIs(focus, ref);
  const label = headingHere ? 'En route' : here ? 'Reset view' : 'Fly here';
  return (
    <button
      type="button"
      className="sd-btn sd-btn--primary sd-fly"
      disabled={headingHere}
      aria-busy={headingHere}
      onClick={() => (here ? engineCommands().resetView() : flyTo(ref))}
    >
      <Icon name={here ? 'reset' : 'fly'} size={15} />
      {compact && headingHere ? '…' : label}
      {headingHere && progress !== null && (
        <span className="sd-fly__progress" style={{ transform: `scaleX(${progress})` }} />
      )}
    </button>
  );
}

export function ActionRow({ model }: { model: ObjectModel }) {
  return (
    <div className="sd-info__actions">
      <FlyButton model={model} />
      <CopyLinkButton id={model.id} name={objectName(model)} />
    </div>
  );
}

/** Phone bottom-sheet peek: just the stars and the fly button. */
export function PeekRow({ model }: { model: ObjectModel }) {
  const id = model.id;
  const name = objectName(model);
  const rating = useStore((s) => s.ratings[id] ?? 0);
  const rate = useStore((s) => s.rate);
  const clear = useStore((s) => s.clearRating);
  return (
    <div className="sd-info__peek">
      <StarRating
        key={id}
        label={name}
        value={rating}
        size={26}
        groupLabel={`Your rating for ${name} (quick)`}
        onChange={(v) => (v === 0 ? clear(id) : rate(id, v))}
      />
      <FlyButton model={model} compact />
    </div>
  );
}

// ───────────────────────────────────────────────────────────── bodies

function Tags({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="sd-tags" aria-label="Tags">
      {tags.map((t) => (
        <li key={t} className="sd-chip">
          {t}
        </li>
      ))}
    </ul>
  );
}

export function StarBody({ model }: { model: Extract<ObjectModel, { kind: 'star' }> }) {
  const universe = useUniverse();
  const { star, system } = model;
  const fromHome = distanceLy(star.posLy, universe.galaxy.params.homeLy);
  const rows = [
    {
      label: 'Spectral type',
      value: (
        <>
          <StarGlyph star={star} size={9} />
          {star.spectralType}
        </>
      ),
    },
    star.temperatureK > 0 && { label: 'Temperature', value: formatTemperature(star.temperatureK) },
    { label: 'Mass', value: formatMassSolar(star.massSolar) },
    { label: 'Radius', value: formatRadiusSolar(star.radiusSolar) },
    star.luminositySolar > 0 && { label: 'Luminosity', value: formatLuminositySolar(star.luminositySolar) },
    { label: 'Age', value: formatAgeGyr(star.ageGyr) },
    star.pulsarPeriodSec !== undefined && {
      label: 'Pulse period',
      value: `${formatNumber(star.pulsarPeriodSec, { sig: 3 })}${NBSP}s`,
    },
    { label: 'From home', value: fromHome < 0.05 ? 'Home' : homeDistanceLabel(universe, star.posLy).replace(' from home', '') },
    { label: 'Planets', value: system ? String(system.planets.length) : '—' },
  ];
  return (
    <>
      {system && <p className="sd-blurb">{system.blurb}</p>}
      <section className="sd-block">
        <h3 className="sd-heading">Specifications</h3>
        <SpecList rows={rows} />
      </section>
      {system ? <SystemOverview system={system} /> : <p className="sd-empty">No survey on file for this system.</p>}
      {system && <Tags tags={system.tags} />}
    </>
  );
}

function MoonRow({ moon }: { moon: Moon }) {
  return (
    <li>
      <button
        type="button"
        className="sd-row"
        onClick={() => flyTo({ kind: 'moon', id: moon.id })}
        aria-label={`${moon.name}, ${planetTypeLabel(moon.type, true)}. Fly there`}
      >
        <PlanetSwatch body={moon} size={26} className="sd-row__swatch" />
        <span className="sd-row__main">
          <span className="sd-row__name">{moon.name}</span>
          <span className="sd-row__meta">
            {planetTypeLabel(moon.type, true)} · {formatDistanceKm(moon.orbit.semiMajorAxisKm)}
          </span>
        </span>
        <span className="sd-row__aside">
          <span className="sd-mono sd-row__temp">{kelvin(moon.surfaceTempK)}</span>
        </span>
        <Icon name="chevronRight" size={14} className="sd-row__go" />
      </button>
    </li>
  );
}

function dayLength(body: Planet | Moon): string {
  const days = Math.abs(body.rotationPeriodHours) / 24;
  return `${formatPeriodDays(days)}${body.rotationPeriodHours < 0 ? ' (retrograde)' : ''}`;
}

export function BodyBody({ model }: { model: Extract<ObjectModel, { kind: 'planet' | 'moon' }> }) {
  const body: Planet | Moon = model.kind === 'planet' ? model.planet : model.moon;
  const isMoon = model.kind === 'moon';
  const parentName = isMoon ? model.planet.name : model.star.name;
  const moons = model.kind === 'planet' ? model.planet.moons : [];
  const rows = [
    { label: 'Type', value: planetTypeLabel(body.type, isMoon) },
    { label: 'Radius', value: formatRadiusKm(body.radiusKm) },
    { label: 'Mass', value: formatMassEarth(body.massEarth) },
    { label: 'Gravity', value: formatGravityG(body.surfaceGravityG) },
    { label: 'Density', value: formatDensityGcc(body.densityGcc) },
    { label: 'Temperature', value: formatTemperature(body.surfaceTempK) },
    { label: 'Pressure', value: body.atmosphere ? formatPressureAtm(body.atmosphere.surfacePressureAtm) : 'Airless' },
    { label: `Orbits ${parentName}`, value: formatDistanceKm(body.orbit.semiMajorAxisKm) },
    { label: 'Year', value: formatPeriodDays(body.orbit.periodDays) },
    { label: 'Day', value: dayLength(body) },
    { label: 'Tidally locked', value: body.tidallyLocked ? 'Yes' : 'No' },
    { label: 'Moons', value: String(moons.length) },
    { label: 'Rings', value: body.rings ? `Yes · ${body.rings.composition}` : 'No' },
  ];
  const life = LIFE_LABEL[body.life];
  const habitabilityText = habitabilityLabel(body.habitability);
  return (
    <>
      <p className="sd-blurb">{body.blurb}</p>
      <section className="sd-block" aria-label="Habitability">
        <h3 className="sd-heading">Habitability</h3>
        <Meter
          value={body.habitability}
          label="Habitability index"
          text={`${habitabilityText} · ${formatNumber(body.habitability, { decimals: 2, keepZeros: true })}`}
        />
        <p className={`sd-life${body.life === 'none' ? '' : ' is-alive'}`}>
          <Icon name="life" size={15} />
          {life}
          {body.life === 'civilization' && <span className="sd-life__note"> — lights on the night side</span>}
        </p>
      </section>
      <section className="sd-block">
        <h3 className="sd-heading">Specifications</h3>
        <SpecList rows={rows} />
      </section>
      {body.atmosphere && body.atmosphere.composition.length > 0 && (
        <section className="sd-block" aria-label="Atmosphere">
          <h3 className="sd-heading">Atmosphere</h3>
          <CompositionBars composition={body.atmosphere.composition} />
        </section>
      )}
      {moons.length > 0 && (
        <section className="sd-block" aria-label="Moons">
          <h3 className="sd-heading">
            Moons <span className="sd-heading__count">{moons.length}</span>
          </h3>
          <ul className="sd-rows">
            {moons.map((m) => (
              <MoonRow key={m.id} moon={m} />
            ))}
          </ul>
        </section>
      )}
      <section className="sd-block">
        <h3 className="sd-heading">{isMoon ? 'Parent world' : 'System'}</h3>
        <ul className="sd-rows">
          {isMoon ? (
            <PlanetRow planet={model.planet} />
          ) : (
            <li>
              <button
                type="button"
                className="sd-row"
                onClick={() => flyTo({ kind: 'star', id: model.system.id })}
              >
                <StarGlyph star={model.star} size={14} className="sd-row__swatch" />
                <span className="sd-row__main">
                  <span className="sd-row__name">{model.star.name}</span>
                  <span className="sd-row__meta">
                    {model.star.spectralType} · planet {model.planet.index + 1} of {model.system.planets.length}
                  </span>
                </span>
                <Icon name="chevronRight" size={14} className="sd-row__go" />
              </button>
            </li>
          )}
        </ul>
      </section>
      <Tags tags={body.tags} />
    </>
  );
}

export { surveyRatingOf };
