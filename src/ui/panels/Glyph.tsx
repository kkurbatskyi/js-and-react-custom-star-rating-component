/** Small leading picture for any selectable object: a star dot or a planet swatch. */
import { PlanetSwatch, StarGlyph } from '../components/Swatches';
import { bodyOf, type ObjectModel } from '../lib/model';

export function ObjectGlyph({ model, size = 26 }: { model: ObjectModel | null; size?: number }) {
  if (!model) return <span style={{ width: size, height: size, display: 'inline-block' }} />;
  const body = bodyOf(model);
  if (body) return <PlanetSwatch body={body} size={size} />;
  return (
    <span className="sd-glyph-box" style={{ width: size, height: size }}>
      <StarGlyph star={model.star} size={Math.round(size * 0.5)} />
    </span>
  );
}
