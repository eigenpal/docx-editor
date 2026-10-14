// Outline attributes of a `wps:wsp`, inherited attribute by attribute.
import { findDirectChild, parseEmu } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import { schemaAttributeValue, WPS_NAMESPACE_URI } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import type { ShapeStyleMatrixResolver } from './drawing-shape-projection.ts';

const DEFAULT_LINE_WIDTH_EMU = 12_700;

/**
 * The outline width and alignment of a shape. Line properties inherit attribute by attribute:
 * a direct `a:ln` attribute wins, and otherwise the theme line that `wps:style/a:lnRef` names
 * decides, whether or not the direct line sets its own fill. The theme line is read for its
 * attributes only, so an unresolvable theme colour does not lose them.
 */
export function readLineProperties(
  wsp: OoxmlElement,
  ln: OoxmlElement | null,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver,
  resolvedThemeLine?: OoxmlElement
): {
  readonly widthEmu: number;
  readonly alignment: string | undefined;
  readonly cap: 'butt' | 'round' | 'square' | undefined;
  readonly join: 'round' | 'bevel' | undefined;
} {
  const directWidth = ln ? parseEmu(schemaAttributeValue(ln.attributes, 'w')) : null;
  const directAlignment = ln ? schemaAttributeValue(ln.attributes, 'algn') : undefined;
  const directCap = ln ? schemaAttributeValue(ln.attributes, 'cap') : undefined;
  const directJoin = lineJoin(ln);
  const theme =
    directWidth === null ||
    directAlignment === undefined ||
    directCap === undefined ||
    directJoin === undefined
      ? isThemeLine(resolvedThemeLine)
        ? resolvedThemeLine
        : themeLine(wsp, resolveStyleMatrixReference)
      : null;
  return {
    widthEmu:
      directWidth ??
      (theme ? parseEmu(schemaAttributeValue(theme.attributes, 'w')) : null) ??
      DEFAULT_LINE_WIDTH_EMU,
    alignment:
      directAlignment ?? (theme ? schemaAttributeValue(theme.attributes, 'algn') : undefined),
    cap: lineCap(directCap ?? (theme ? schemaAttributeValue(theme.attributes, 'cap') : undefined)),
    join: supportedJoin(directJoin ?? lineJoin(theme)),
  };
}

function lineCap(value: string | undefined): 'butt' | 'round' | 'square' | undefined {
  if (value === 'flat') return 'butt';
  if (value === 'rnd') return 'round';
  if (value === 'sq') return 'square';
  return undefined;
}

function lineJoin(line: OoxmlElement | null): string | undefined {
  if (!line) return undefined;
  const joins = line.children.filter(
    (node) =>
      isElement(node) &&
      node.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
      ['round', 'bevel', 'miter'].includes(node.localName)
  );
  // An explicit unsupported or ambiguous join must not inherit a different theme join.
  if (joins.length > 1) return 'unsupported';
  return joins.length === 1 && isElement(joins[0]!) ? joins[0]!.localName : undefined;
}

function supportedJoin(value: string | undefined): 'round' | 'bevel' | undefined {
  return value === 'round' || value === 'bevel' ? value : undefined;
}

/**
 * The `wps:style` reference a shape names for its fill or line (`a:fillRef`/`a:lnRef`): the
 * style-matrix index and the placeholder colour element, or null when there is none.
 */
export function readStyleReferenceIndex(
  wsp: OoxmlElement,
  referenceName: 'fillRef' | 'lnRef'
): {
  readonly index: number;
  readonly color: OoxmlElement['children'][number] | undefined;
} | null {
  const style = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'style',
  });
  const reference = style
    ? findDirectChild(style.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: referenceName,
      })
    : null;
  const rawIndex = reference ? schemaAttributeValue(reference.attributes, 'idx') : undefined;
  if (!reference || !rawIndex || !/^\d{1,4}$/.test(rawIndex)) return null;
  return { index: Number(rawIndex), color: reference.children.find(isElement) };
}

function themeLine(
  wsp: OoxmlElement,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): OoxmlElement | null {
  if (!resolveStyleMatrixReference) return null;
  const reference = readStyleReferenceIndex(wsp, 'lnRef');
  if (!reference) return null;
  const matrix = resolveStyleMatrixReference('line', reference.index);
  return isThemeLine(matrix) ? matrix : null;
}

/** Only an `a:ln` entry of the theme's line styles carries line attributes. */
function isThemeLine(element: OoxmlElement | null | undefined): element is OoxmlElement {
  return (
    element !== null &&
    element !== undefined &&
    element.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
    element.localName === 'ln'
  );
}
