// Renderable projections of `wps:wsp` graphics: solid-geometry vector shapes and textbox
// stories. Split from drawing-projection.ts, which owns the drawing walk, MC selection, and
// the assembled DrawingProjection; this module is pure direct-child reads with no walk state.

import { findDirectKind, isElement } from './drawing-projection-walk.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from './ooxml-tree.ts';

const WPS_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const WPS_GRAPHIC_DATA_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG_GRAPHIC_DATA_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const SHAPE_HEX_RE = /^[0-9A-Fa-f]{6}$/;
const MAX_VECTOR_SHAPE_SUBPATHS = 64;
const MAX_VECTOR_SHAPE_POINTS = 1024;
const MAX_GROUP_SHAPE_CHILDREN = 128;
const ELLIPSE_POINTS = 32;
const CUBIC_BEZIER_SEGMENTS = 8;

export type ShapeSchemeColorResolver = (scheme: string) => string | null;
export type ShapeStyleMatrixResolver = (
  kind: 'fill' | 'line',
  index: number
) => OoxmlElement | null;

export const MAX_EMU = 2 ** 31 - 1;

export function parseEmu(value: string | undefined, clamp = true): number | null {
  if (value === undefined || !/^-?\d{1,15}$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (!clamp) return parsed;
  if (parsed < 0) return 0;
  if (parsed > MAX_EMU) return MAX_EMU;
  return parsed;
}

/**
 * An `xsd:boolean` attribute read fail-closed.
 *
 * Ignoring whitespace, the schema allows exactly `0`, `1`, `false` and `true`. Only `0`,
 * `false` and an absent attribute mean "not set"; every other spelling — `TRUE`, `yes`, `2`
 * — is schema-invalid, and the sender chose it, so it refuses the shape rather than painting
 * as if the flag were unset.
 *
 * The collapse is load-bearing. `xsd:boolean` carries a fixed `whiteSpace="collapse"` facet,
 * so ` 0 ` and `0\n` are valid false, but the XML reader keeps attribute values verbatim
 * (`trimValues: false`). Comparing the raw string would refuse a shape Word paints, which is
 * the one way a fail-closed read like this can be worse than the permissive one it replaced.
 */
function schemaFlagIsUnset(value: string | undefined): boolean {
  if (value === undefined) return true;
  const collapsed = collapseSchemaFlag(value);
  return collapsed === '0' || collapsed === 'false';
}

/**
 * The complement of {@link schemaFlagIsUnset}: an `xsd:boolean` that legally reads true.
 *
 * A value is neither set nor unset when it is schema-invalid, and the two callers want
 * opposite things there. A flag the engine cannot HONOUR (a flipped vector shape) refuses
 * through `schemaFlagIsUnset`, because painting it unflipped would be a wrong render. A flag
 * the engine can honour (a flipped picture) reads through here and treats anything invalid
 * as unset, because refusing would drop the picture entirely — a worse outcome than a
 * mirror the sender spelled illegally.
 */
export function schemaFlagIsSet(value: string | undefined): boolean {
  if (value === undefined) return false;
  const collapsed = collapseSchemaFlag(value);
  return collapsed === '1' || collapsed === 'true';
}

function collapseSchemaFlag(value: string): string {
  // XML whitespace is exactly space, tab, LF and CR — not `\s`, which is wider.
  return value.replace(/[ \t\n\r]+/g, ' ').trim();
}

export function findDirectChild(
  nodes: readonly OoxmlNode[],
  options: {
    readonly typedKind?: string;
    readonly namespaceUri?: string;
    readonly localName?: string;
  }
): OoxmlElement | null {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (options.typedKind !== undefined && node.kind === options.typedKind) return node;
    if (
      options.namespaceUri !== undefined &&
      options.localName !== undefined &&
      node.kind === 'generic' &&
      node.namespaceUri === options.namespaceUri &&
      node.localName === options.localName
    ) {
      return node;
    }
  }
  return null;
}

/**
 * The renderable subset of a `wps:wsp` non-picture graphic, or of one bounded `wpg:wgp`
 * group of them: closed polygon subpaths (`a:custGeom` with move/line/close/cubicBezTo
 * verbs, or a supported `a:prstGeom`) with a solid fill and/or stroke. The colour may come
 * from `a:srgbClr` or from the theme, through `a:schemeClr` or a `wps:style` matrix
 * reference. Anything richer (gradient and picture fills, text bodies, rotation, a nested
 * group) projects as `null` and paints the labelled placeholder instead.
 */
export interface VectorShapeProjection {
  /** The drawing extent that frames the subpath coordinate space. */
  readonly extentEmu: Readonly<{ cx: number; cy: number }>;
  /**
   * Every component's subpath polygons, flattened, in extent-EMU space; fill rule is
   * even-odd. Painting reads `components`, which keeps each polygon with its own colours;
   * this stays the geometry summary (bounds, hit tests, wrap holes).
   */
  readonly subpathsEmu: readonly (readonly Readonly<{ x: number; y: number }>[])[];
  /**
   * Validated 6-digit sRGB hex (no `#`) of the one component, or null. A group of two or
   * more components has no single fill, so this is null there as well: null means "no one
   * fill to name", not "nothing is filled". Read `components` to paint.
   */
  readonly fillHex: string | null;
  readonly fillAlpha?: number;
  /** As `fillHex`, for the stroke: the one component's stroke, else null. */
  readonly strokeHex: string | null;
  readonly strokeAlpha?: number;
  /** The one component's stroke width in EMU; 0 when absent or when grouped. */
  readonly strokeWidthEmu: number;
  /** Independently styled paths, always non-empty. A direct shape has one component. */
  readonly components: readonly VectorShapeComponent[];
}

export interface VectorShapeComponent {
  readonly subpathsEmu: readonly (readonly Readonly<{ x: number; y: number }>[])[];
  readonly fillHex: string | null;
  readonly fillAlpha: number;
  readonly strokeHex: string | null;
  readonly strokeAlpha: number;
  readonly strokeWidthEmu: number;
}

/**
 * The story carried by a `wps:wsp` text box (`wps:txbx` → `w:txbxContent`).
 *
 * The projection captures only the story root and the shape chrome reads; it never walks the
 * story content, so the per-drawing element budget is not spent on paragraphs. Layout collects
 * blocks from `content` under its own caps.
 */
export interface TextboxStoryProjection {
  /** Canonical node id of the `w:txbxContent` element. */
  readonly contentNodeId: string;
  /** The `w:txbxContent` element itself; treated as an opaque story root here. */
  readonly content: OoxmlElement;
  /** `wps:bodyPr` insets with the OOXML defaults (91440 EMU l/r, 45720 EMU t/b) when absent. */
  readonly insetsEmu: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  /** `wps:bodyPr/@anchor` collapsed to the three renderable positions; default top. */
  readonly verticalAnchor: 'top' | 'center' | 'bottom';
  /** Autofit child of `wps:bodyPr`; extent stays authoritative either way (diagnostic only). */
  readonly autofit: 'none' | 'shape' | 'normal';
  /** Solid fill of the hosting shape, painted behind the story; null for no fill. */
  readonly fillHex: string | null;
  /** Solid outline of the hosting shape; null for no outline. */
  readonly strokeHex: string | null;
  /** Outline width in EMU; 0 when absent. */
  readonly strokeWidthEmu: number;
}

interface ShapeColor {
  readonly hex: string;
  readonly alpha: number;
}

function colorChannels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function channelsHex(channels: readonly number[]): string {
  return channels
    .map((channel) =>
      Math.round(Math.max(0, Math.min(255, channel)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase();
}

/**
 * DrawingML blends `a:tint` and `a:shade` in linear light, not on the stored sRGB channel.
 * The conversion uses a plain 2.3 colour-space gamma, not the sRGB piecewise curve, and the
 * linear result truncates back to a byte rather than rounding.
 *
 * Where those two constants come from, precisely, because they look arbitrary:
 *
 * - Measured against LibreOffice, rendering purpose-built `.docx` files to PDF and sampling
 *   the pixel. Word was not available on the machine that wrote this, so it is NOT the
 *   oracle here. Treat this as one renderer's behaviour reproduced exactly (47 of 47
 *   base/ratio pairs), not as Word's behaviour confirmed. Note also that 2.3 is LibreOffice's
 *   own colour-space gamma, so agreement with it is partly circular.
 * - The one check that does not come from a renderer: ECMA-376 Part 1 20.1.2.3.31's worked
 *   `a:shade` example, `00FF00` at `val="50%"`, gives `00BC00`. This model reproduces it
 *   exactly. Read what that does and does not settle — a blend on the stored channel gives
 *   `008000`, so the example rules that reading out decisively, but the sRGB curve gives
 *   `00BB00`, one level away, so it barely speaks to the choice of curve.
 *
 * On the spelling in that citation: Part 1 (Strict) writes percentages as `50%`, and its
 * `ST_PositiveFixedPercentage` does not admit `50000` at all. The 1000ths-of-a-percent
 * integer Word writes is Part 4 (Transitional). `transformRatio` takes both.
 *
 * Both constants are load-bearing, though neither is dramatic on any single colour. Against
 * `Math.round` the result moves a level on about half of a uniform base/ratio grid. Against
 * the sRGB piecewise curve, holding this floor fixed, it moves on about half as well, by
 * four levels on `336699` + `shade 40000` (`224466` here, `1E4163` through sRGB) and by as
 * much as eleven at the dark end.
 *
 * `lumMod`/`lumOff` are NOT linear-light: they stay in HSL over the stored channels and keep
 * `channelsHex`'s rounding. That path is confirmed against Word itself, so do not fold it in.
 */
const SHAPE_COLOR_GAMMA = 2.3;

function linearFromChannel(channel: number): number {
  return (Math.max(0, Math.min(255, channel)) / 255) ** SHAPE_COLOR_GAMMA;
}

function channelFromLinear(linear: number): number {
  const channel = Math.max(0, Math.min(1, linear)) ** (1 / SHAPE_COLOR_GAMMA) * 255;
  // The epsilon only absorbs the round-trip error of the two `**` calls, so a ratio of
  // 100000 (the identity transform) returns the input channel instead of the one below it.
  return Math.max(0, Math.min(255, Math.floor(channel + 1e-6)));
}

function rgbToHsl([red, green, blue]: readonly number[]): [number, number, number] {
  const r = red! / 255;
  const g = green! / 255;
  const b = blue! / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue =
    max === r
      ? (g - b) / delta + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return [hue / 6, saturation, lightness];
}

function hslToRgb([hue, saturation, lightness]: readonly number[]): [number, number, number] {
  if (saturation === 0) return [lightness! * 255, lightness! * 255, lightness! * 255];
  const q =
    lightness! < 0.5
      ? lightness! * (1 + saturation!)
      : lightness! + saturation! - lightness! * saturation!;
  const p = 2 * lightness! - q;
  const channel = (offset: number): number => {
    let value = hue! + offset;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [channel(1 / 3) * 255, channel(0) * 255, channel(-1 / 3) * 255];
}

/**
 * `val` on a colour transform, as a 0..1 ratio, or null to refuse the colour.
 *
 * Two spellings are legal and both appear in the wild:
 *
 * - The 1000ths-of-a-percent integer (`50000`). This is `ST_Percentage`'s Transitional
 *   spelling (ECMA-376 Part 4), and it is what Word writes, so it is the common case.
 * - The percentage literal (`50%`, `12.5%`). This is the Strict spelling (Part 1
 *   20.1.10.40/20.1.10.41) and the one the spec's own worked examples use. Refusing it
 *   dropped the shape to a placeholder card.
 *
 * Both regexes are anchored, bounded and have no nested quantifier, so a hostile `val`
 * cannot make either backtrack. Anything else — a sign, an exponent, whitespace, 7 digits —
 * refuses, and the caller fails the whole colour closed rather than guessing.
 */
function transformRatio(node: OoxmlElement): number | null {
  const value = schemaAttributeValue(node.attributes, 'val');
  if (value === undefined) return null;
  if (/^\d{1,6}$/.test(value)) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100_000 ? parsed / 100_000 : null;
  }
  if (/^(?:100|\d{1,2})(?:\.\d{1,2})?%$/.test(value)) {
    // The regex already bounds this to 0..100, so the divide cannot leave the ratio range.
    return Number(value.slice(0, -1)) / 100;
  }
  return null;
}

function resolveColorNode(
  color: OoxmlNode,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  placeholder?: ShapeColor
): ShapeColor | null {
  if (
    !isElement(color) ||
    !('namespaceUri' in color) ||
    color.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI ||
    (color.localName !== 'srgbClr' && color.localName !== 'schemeClr')
  ) {
    return null;
  }
  const token = schemaAttributeValue(color.attributes, 'val');
  let alpha = 1;
  let hex: string | null | undefined;
  if (color.localName === 'srgbClr') hex = token;
  else if (token === 'phClr' && placeholder) {
    hex = placeholder.hex;
    alpha = placeholder.alpha;
  } else {
    hex = token !== undefined ? resolveSchemeColor?.(token) : null;
  }
  if (!hex || !SHAPE_HEX_RE.test(hex)) return null;
  let channels = colorChannels(hex);
  for (const child of color.children) {
    if (!isElement(child) || child.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) continue;
    const ratio = transformRatio(child);
    if (ratio === null) return null;
    if (child.localName === 'alpha') alpha = ratio;
    else if (child.localName === 'tint') {
      // ECMA-376 20.1.2.3.34: `val` is the fraction of the INPUT colour, the rest white.
      channels = channels.map((channel) =>
        channelFromLinear(linearFromChannel(channel) * ratio + (1 - ratio))
      ) as [number, number, number];
    } else if (child.localName === 'shade') {
      // ECMA-376 20.1.2.3.31: `val` is the fraction of the input colour, the rest black.
      channels = channels.map((channel) =>
        channelFromLinear(linearFromChannel(channel) * ratio)
      ) as [number, number, number];
    } else if (child.localName === 'lumMod' || child.localName === 'lumOff') {
      const hsl = rgbToHsl(channels);
      hsl[2] = Math.max(
        0,
        Math.min(1, child.localName === 'lumMod' ? hsl[2] * ratio : hsl[2] + ratio)
      );
      channels = hslToRgb(hsl);
    } else {
      return null;
    }
  }
  hex = channelsHex(channels);
  return { hex, alpha };
}

/** Resolve and transform one DrawingML solid fill at the store trust boundary. */
function readSolidFill(
  parent: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  placeholder?: ShapeColor
): ShapeColor | null {
  const solidFill = findDirectChild(parent.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'solidFill',
  });
  if (!solidFill) return null;
  const color = solidFill.children.find(isElement);
  return color ? resolveColorNode(color, resolveSchemeColor, placeholder) : null;
}

const FILL_ELEMENT_NAMES = new Set([
  'noFill',
  'solidFill',
  'gradFill',
  'blipFill',
  'pattFill',
  'grpFill',
]);

function directFill(
  parent: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  placeholder?: ShapeColor
): { readonly present: boolean; readonly color: ShapeColor | null } {
  const authored = parent.children.find(
    (child) =>
      isElement(child) &&
      child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
      FILL_ELEMENT_NAMES.has(child.localName)
  );
  if (!authored || !isElement(authored)) return { present: false, color: null };
  return {
    present: true,
    color:
      authored.localName === 'solidFill'
        ? readSolidFill(parent, resolveSchemeColor, placeholder)
        : null,
  };
}

function readStyleReference(
  wsp: OoxmlElement,
  referenceName: 'fillRef' | 'lnRef',
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): { readonly color: ShapeColor; readonly strokeWidthEmu?: number } | null {
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
  const color = reference?.children.find(isElement);
  const rawIndex = reference ? schemaAttributeValue(reference.attributes, 'idx') : undefined;
  if (!color || !rawIndex || !/^\d{1,4}$/.test(rawIndex)) return null;
  const index = Number(rawIndex);
  const placeholder = resolveColorNode(color, resolveSchemeColor);
  const matrix = resolveStyleMatrixReference?.(
    referenceName === 'fillRef' ? 'fill' : 'line',
    index
  );
  if (!placeholder || !matrix) return null;
  if (referenceName === 'fillRef') {
    if (
      !isElement(matrix) ||
      matrix.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI ||
      matrix.localName !== 'solidFill'
    ) {
      return null;
    }
    const matrixColor = matrix.children.find(isElement);
    const resolved = matrixColor
      ? resolveColorNode(matrixColor, resolveSchemeColor, placeholder)
      : null;
    return resolved ? { color: resolved } : null;
  }
  const lineFill = directFill(matrix, resolveSchemeColor, placeholder);
  if (!lineFill.present || !lineFill.color) return null;
  return {
    color: lineFill.color,
    strokeWidthEmu: parseEmu(schemaAttributeValue(matrix.attributes, 'w')) ?? 12_700,
  };
}

/** Polygon subpaths of one `a:path` — move/line/close verbs only; anything else refuses. */
function readShapePathPolygons(
  path: OoxmlElement,
  scaleX: number,
  scaleY: number,
  sink: { x: number; y: number }[][],
  pointBudget: { remaining: number }
): boolean {
  let current: { x: number; y: number }[] | null = null;
  for (const verb of path.children) {
    if (!isElement(verb)) continue;
    if (verb.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) return false;
    if (verb.localName === 'close') {
      current = null;
      continue;
    }
    if (verb.localName === 'cubicBezTo') {
      if (current === null || pointBudget.remaining < CUBIC_BEZIER_SEGMENTS) return false;
      const controls = verb.children.filter(isElement);
      if (
        controls.length !== 3 ||
        controls.some(
          (point) => point.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI || point.localName !== 'pt'
        )
      ) {
        return false;
      }
      const parsed = controls.map((point) => {
        const x = parseEmu(schemaAttributeValue(point.attributes, 'x'), false);
        const y = parseEmu(schemaAttributeValue(point.attributes, 'y'), false);
        return x === null || y === null ? null : { x: x * scaleX, y: y * scaleY };
      });
      if (parsed.some((point) => point === null)) return false;
      const start = current[current.length - 1]!;
      const control1 = parsed[0]!;
      const control2 = parsed[1]!;
      const end = parsed[2]!;
      for (let index = 1; index <= CUBIC_BEZIER_SEGMENTS; index += 1) {
        const t = index / CUBIC_BEZIER_SEGMENTS;
        const inverse = 1 - t;
        current.push({
          x:
            inverse ** 3 * start.x +
            3 * inverse ** 2 * t * control1.x +
            3 * inverse * t ** 2 * control2.x +
            t ** 3 * end.x,
          y:
            inverse ** 3 * start.y +
            3 * inverse ** 2 * t * control1.y +
            3 * inverse * t ** 2 * control2.y +
            t ** 3 * end.y,
        });
      }
      pointBudget.remaining -= CUBIC_BEZIER_SEGMENTS;
      continue;
    }
    if (verb.localName !== 'moveTo' && verb.localName !== 'lnTo') return false;
    const pt = findDirectChild(verb.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'pt',
    });
    if (!pt) return false;
    const x = parseEmu(schemaAttributeValue(pt.attributes, 'x'), false);
    const y = parseEmu(schemaAttributeValue(pt.attributes, 'y'), false);
    if (x === null || y === null) return false;
    const scaled = { x: x * scaleX, y: y * scaleY };
    if (!Number.isFinite(scaled.x) || !Number.isFinite(scaled.y)) return false;
    if (pointBudget.remaining <= 0) return false;
    pointBudget.remaining -= 1;
    if (verb.localName === 'moveTo' || current === null) {
      if (sink.length >= MAX_VECTOR_SHAPE_SUBPATHS) return false;
      current = [scaled];
      sink.push(current);
    } else {
      current.push(scaled);
    }
  }
  return true;
}

function findGraphicData(anchor: OoxmlElement): OoxmlElement | null {
  // Non-picture graphic payloads demote to generic nodes even under a typed
  // `drawingGraphic`, so the generic lookup is always in play here.
  const graphic =
    findDirectKind(anchor.children, 'drawingGraphic') ??
    findDirectChild(anchor.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'graphic',
    });
  if (!graphic) return null;
  const data =
    findDirectKind(graphic.children, 'drawingGraphicData') ??
    findDirectChild(graphic.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'graphicData',
    });
  return data;
}

/** The `wps:wsp` under the anchor's graphic data, or null when the payload is something else. */
function findWspInAnchor(anchor: OoxmlElement): OoxmlElement | null {
  const data = findGraphicData(anchor);
  if (!data) return null;
  if (schemaAttributeValue(data.attributes, 'uri') !== WPS_GRAPHIC_DATA_URI) return null;
  return (
    findDirectChild(data.children, {
      namespaceUri: WPS_NAMESPACE_URI,
      localName: 'wsp',
    }) ?? null
  );
}

function projectWspComponent(
  wsp: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  pointBudget: { remaining: number },
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): VectorShapeComponent | null {
  if (findDirectChild(wsp.children, { namespaceUri: WPS_NAMESPACE_URI, localName: 'txbx' })) {
    return null;
  }
  const spPr = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'spPr',
  });
  if (!spPr) return null;
  const xfrm = findDirectChild(spPr.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'xfrm',
  });
  if (xfrm) {
    const rot = schemaAttributeValue(xfrm.attributes, 'rot');
    if (rot !== undefined && rot !== '0') return null;
    if (!schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, 'flipH'))) return null;
    if (!schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, 'flipV'))) return null;
  }

  const authoredFill = directFill(spPr, resolveSchemeColor);
  const styleFill = authoredFill.present
    ? null
    : readStyleReference(wsp, 'fillRef', resolveSchemeColor, resolveStyleMatrixReference);
  const fill = authoredFill.present ? authoredFill.color : (styleFill?.color ?? null);
  const ln = findDirectChild(spPr.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'ln',
  });
  const authoredStroke = ln ? directFill(ln, resolveSchemeColor) : null;
  const styleStroke =
    authoredStroke?.present === true
      ? null
      : readStyleReference(wsp, 'lnRef', resolveSchemeColor, resolveStyleMatrixReference);
  const stroke =
    authoredStroke?.present === true ? authoredStroke.color : (styleStroke?.color ?? null);
  const strokeWidthEmu =
    stroke !== null
      ? ((ln ? parseEmu(schemaAttributeValue(ln.attributes, 'w')) : null) ??
        styleStroke?.strokeWidthEmu ??
        12_700)
      : 0;
  if (fill === null && stroke === null) return null;

  const subpaths: { x: number; y: number }[][] = [];
  const custGeom = findDirectChild(spPr.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'custGeom',
  });
  if (custGeom) {
    const pathLst = findDirectChild(custGeom.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'pathLst',
    });
    if (!pathLst) return null;
    for (const child of pathLst.children) {
      if (!isElement(child)) continue;
      if (child.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI || child.localName !== 'path') {
        return null;
      }
      const pathW = parseEmu(schemaAttributeValue(child.attributes, 'w')) ?? extent.cx;
      const pathH = parseEmu(schemaAttributeValue(child.attributes, 'h')) ?? extent.cy;
      if (pathW <= 0 || pathH <= 0) return null;
      if (
        !readShapePathPolygons(child, extent.cx / pathW, extent.cy / pathH, subpaths, pointBudget)
      ) {
        return null;
      }
    }
  } else {
    const prstGeom = findDirectChild(spPr.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'prstGeom',
    });
    const preset = prstGeom ? schemaAttributeValue(prstGeom.attributes, 'prst') : undefined;
    if (preset === 'rect') {
      if (pointBudget.remaining < 4) return null;
      subpaths.push([
        { x: 0, y: 0 },
        { x: extent.cx, y: 0 },
        { x: extent.cx, y: extent.cy },
        { x: 0, y: extent.cy },
      ]);
      pointBudget.remaining -= 4;
    } else if (preset === 'ellipse' && pointBudget.remaining >= ELLIPSE_POINTS) {
      const ellipse: { x: number; y: number }[] = [];
      for (let index = 0; index < ELLIPSE_POINTS; index += 1) {
        const angle = (index / ELLIPSE_POINTS) * Math.PI * 2;
        ellipse.push({
          x: extent.cx / 2 + (Math.cos(angle) * extent.cx) / 2,
          y: extent.cy / 2 + (Math.sin(angle) * extent.cy) / 2,
        });
      }
      pointBudget.remaining -= ELLIPSE_POINTS;
      subpaths.push(ellipse);
    } else {
      return null;
    }
  }
  const polygons = subpaths.filter((points) => points.length >= 3);
  if (polygons.length === 0) return null;
  return {
    subpathsEmu: polygons,
    fillHex: fill?.hex ?? null,
    fillAlpha: fill?.alpha ?? 1,
    strokeHex: stroke?.hex ?? null,
    strokeAlpha: stroke?.alpha ?? 1,
    strokeWidthEmu,
  };
}

function transformComponent(
  component: VectorShapeComponent,
  offset: Readonly<{ x: number; y: number }>,
  scaleX: number,
  scaleY: number
): VectorShapeComponent {
  return {
    ...component,
    subpathsEmu: component.subpathsEmu.map((path) =>
      path.map((point) => ({
        x: offset.x + point.x * scaleX,
        y: offset.y + point.y * scaleY,
      }))
    ),
    strokeWidthEmu: component.strokeWidthEmu * ((Math.abs(scaleX) + Math.abs(scaleY)) / 2),
  };
}

function childTransform(wsp: OoxmlElement): {
  readonly offset: Readonly<{ x: number; y: number }>;
  readonly extent: Readonly<{ cx: number; cy: number }>;
} | null {
  const spPr = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'spPr',
  });
  const xfrm = spPr
    ? findDirectChild(spPr.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'xfrm',
      })
    : null;
  const off = xfrm
    ? findDirectChild(xfrm.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'off',
      })
    : null;
  const ext = xfrm
    ? findDirectChild(xfrm.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'ext',
      })
    : null;
  const cx = ext ? parseEmu(schemaAttributeValue(ext.attributes, 'cx')) : null;
  const cy = ext ? parseEmu(schemaAttributeValue(ext.attributes, 'cy')) : null;
  if (cx === null || cy === null || cx <= 0 || cy <= 0) return null;
  return {
    offset: {
      x: off ? (parseEmu(schemaAttributeValue(off.attributes, 'x'), false) ?? 0) : 0,
      y: off ? (parseEmu(schemaAttributeValue(off.attributes, 'y'), false) ?? 0) : 0,
    },
    extent: { cx, cy },
  };
}

/**
 * Renderable-subset projection of direct `wps:wsp` and one bounded `wpg:wgp` group.
 */
export function projectVectorShape(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  compatibilityMode: boolean,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): VectorShapeProjection | null {
  void compatibilityMode;
  if (extent.cx <= 0 || extent.cy <= 0) return null;
  const pointBudget = { remaining: MAX_VECTOR_SHAPE_POINTS };
  const wsp = findWspInAnchor(anchor);
  let components: VectorShapeComponent[] = [];
  if (wsp) {
    const component = projectWspComponent(
      wsp,
      extent,
      pointBudget,
      resolveSchemeColor,
      resolveStyleMatrixReference
    );
    if (!component) return null;
    components = [component];
  } else {
    const data = findGraphicData(anchor);
    if (!data || schemaAttributeValue(data.attributes, 'uri') !== WPG_GRAPHIC_DATA_URI) return null;
    const group = findDirectChild(data.children, {
      namespaceUri: WPG_NAMESPACE_URI,
      localName: 'wgp',
    });
    const groupProperties = group
      ? findDirectChild(group.children, {
          namespaceUri: WPG_NAMESPACE_URI,
          localName: 'grpSpPr',
        })
      : null;
    const xfrm = groupProperties
      ? findDirectChild(groupProperties.children, {
          namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
          localName: 'xfrm',
        })
      : null;
    const childOffset = xfrm
      ? findDirectChild(xfrm.children, {
          namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
          localName: 'chOff',
        })
      : null;
    const childExtent = xfrm
      ? findDirectChild(xfrm.children, {
          namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
          localName: 'chExt',
        })
      : null;
    if (!group || !childExtent) return null;
    if (xfrm) {
      const rotation = schemaAttributeValue(xfrm.attributes, 'rot');
      if (rotation !== undefined && rotation !== '0') return null;
      if (!schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, 'flipH'))) return null;
      if (!schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, 'flipV'))) return null;
    }
    const chOffX = childOffset
      ? (parseEmu(schemaAttributeValue(childOffset.attributes, 'x'), false) ?? 0)
      : 0;
    const chOffY = childOffset
      ? (parseEmu(schemaAttributeValue(childOffset.attributes, 'y'), false) ?? 0)
      : 0;
    const chExtX = parseEmu(schemaAttributeValue(childExtent.attributes, 'cx'));
    const chExtY = parseEmu(schemaAttributeValue(childExtent.attributes, 'cy'));
    if (chExtX === null || chExtY === null || chExtX <= 0 || chExtY <= 0) return null;
    let childCount = 0;
    for (const child of group.children) {
      if (!isElement(child)) continue;
      if (
        child.namespaceUri === WPG_NAMESPACE_URI &&
        (child.localName === 'cNvPr' ||
          child.localName === 'cNvGrpSpPr' ||
          child.localName === 'grpSpPr')
      ) {
        continue;
      }
      // One group level is the enforced nesting cap. Do not paint a partial nested group.
      if (child.namespaceUri !== WPS_NAMESPACE_URI || child.localName !== 'wsp') return null;
      childCount += 1;
      if (childCount > MAX_GROUP_SHAPE_CHILDREN) return null;
      const transform = childTransform(child);
      if (!transform) return null;
      const component = projectWspComponent(
        child,
        transform.extent,
        pointBudget,
        resolveSchemeColor,
        resolveStyleMatrixReference
      );
      if (!component) return null;
      components.push(
        transformComponent(
          component,
          {
            x: ((transform.offset.x - chOffX) * extent.cx) / chExtX,
            y: ((transform.offset.y - chOffY) * extent.cy) / chExtY,
          },
          extent.cx / chExtX,
          extent.cy / chExtY
        )
      );
    }
    if (components.length === 0) return null;
  }
  const subpathsEmu: (readonly Readonly<{ x: number; y: number }>[])[] = [];
  for (const component of components) {
    for (const path of component.subpathsEmu) subpathsEmu.push(path);
  }
  const first = components.length === 1 ? components[0]! : null;
  return {
    extentEmu: { cx: extent.cx, cy: extent.cy },
    subpathsEmu,
    fillHex: first?.fillHex ?? null,
    fillAlpha: first?.fillAlpha ?? 1,
    strokeHex: first?.strokeHex ?? null,
    strokeAlpha: first?.strokeAlpha ?? 1,
    strokeWidthEmu: first?.strokeWidthEmu ?? 0,
    components,
  };
}

/** OOXML `wps:bodyPr` inset defaults in EMU. */
const DEFAULT_TEXTBOX_INSET_LR_EMU = 91_440;
const DEFAULT_TEXTBOX_INSET_TB_EMU = 45_720;

/**
 * Story projection of a `wps:wsp` carrying a `wps:txbx`. Captures the `w:txbxContent` root and
 * the bodyPr/shape-chrome reads without walking the story content; returns null when the shape
 * is not a text box or the box has no usable extent.
 */
export function projectTextboxStory(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): TextboxStoryProjection | null {
  if (extent.cx <= 0 || extent.cy <= 0) return null;
  const wsp = findWspInAnchor(anchor);
  if (!wsp) return null;
  const txbx = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'txbx',
  });
  if (!txbx) return null;
  const content = findDirectChild(txbx.children, {
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'txbxContent',
  });
  if (!content) return null;

  const bodyPr = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'bodyPr',
  });
  const inset = (name: string, fallback: number): number => {
    const raw = bodyPr ? schemaAttributeValue(bodyPr.attributes, name) : undefined;
    if (raw === undefined) return fallback;
    const value = parseEmu(raw, false);
    return value === null || value < 0 ? fallback : value;
  };
  const anchorRaw = bodyPr ? schemaAttributeValue(bodyPr.attributes, 'anchor') : undefined;
  const verticalAnchor =
    anchorRaw === 'ctr' ? 'center' : anchorRaw === 'b' ? 'bottom' : ('top' as const);
  let autofit: TextboxStoryProjection['autofit'] = 'none';
  if (bodyPr) {
    if (
      findDirectChild(bodyPr.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'spAutoFit',
      })
    ) {
      autofit = 'shape';
    } else if (
      findDirectChild(bodyPr.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'normAutofit',
      })
    ) {
      autofit = 'normal';
    }
  }

  const spPr = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'spPr',
  });
  const authoredFill = spPr ? directFill(spPr, resolveSchemeColor) : null;
  const styleFill =
    authoredFill?.present === true
      ? null
      : readStyleReference(wsp, 'fillRef', resolveSchemeColor, resolveStyleMatrixReference);
  const fillHex =
    (authoredFill?.present === true ? authoredFill.color?.hex : styleFill?.color.hex) ?? null;
  const ln = spPr
    ? findDirectChild(spPr.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'ln',
      })
    : null;
  const authoredStroke = ln ? directFill(ln, resolveSchemeColor) : null;
  const styleStroke =
    authoredStroke?.present === true
      ? null
      : readStyleReference(wsp, 'lnRef', resolveSchemeColor, resolveStyleMatrixReference);
  const strokeHex =
    (authoredStroke?.present === true ? authoredStroke.color?.hex : styleStroke?.color.hex) ?? null;
  const strokeWidthEmu =
    strokeHex !== null
      ? ((ln ? parseEmu(schemaAttributeValue(ln.attributes, 'w')) : null) ??
        styleStroke?.strokeWidthEmu ??
        12_700)
      : 0;

  return {
    contentNodeId: content.id,
    content,
    insetsEmu: {
      top: inset('tIns', DEFAULT_TEXTBOX_INSET_TB_EMU),
      right: inset('rIns', DEFAULT_TEXTBOX_INSET_LR_EMU),
      bottom: inset('bIns', DEFAULT_TEXTBOX_INSET_TB_EMU),
      left: inset('lIns', DEFAULT_TEXTBOX_INSET_LR_EMU),
    },
    verticalAnchor,
    autofit,
    fillHex,
    strokeHex,
    strokeWidthEmu,
  };
}
