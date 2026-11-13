// Paragraph borders, in the vocabulary an Office-shaped object model reads and writes.
//
// INTERNAL to the automation lane. The object model's `Paragraph.borders` is a collection of five
// edges in a fixed order: top, left, bottom, right, then the border between paragraphs. That is
// the `CT_PBdr` sequence without `w:bar`, which no Office-shaped member addresses and which every
// write carries through unchanged.
//
// A READ ANSWERS WHAT THE PAGE SHOWS. Borders very often come from a style (a title's rule, a
// quote's box), so answering only the paragraph's own `w:pBdr` would report "no border" under a
// visible line. The read resolves the same cascade layout paints from: the paragraph's own
// `w:pBdr` when it has one, else the last one its style chain states. Writing back a value read
// here changes nothing: a write that lands on what is already in force writes no op.
//
// A WRITE STATES THE WHOLE ELEMENT. A paragraph's own `w:pBdr` replaces the style's borders as a
// unit, so changing one edge of a style border means copying the style's other edges into the
// paragraph first. An edge turned off that a style would otherwise show is written as
// `w:val="nil"`, so the result is the same whether a reader merges edges or replaces them.
//
// UNTRUSTED VALUES. Every request value is checked against a fixed table before it becomes an
// attribute; every attribute read from the file is checked before it becomes an answer.

import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { nullRecord } from '../store/package/safe-record.ts';
import { namedChild, paragraphPropertiesNodeOf } from '../store/store/tree-op-nodes.ts';
import type {
  ParagraphBorderEdgeName,
  ParagraphBorderEdgeWrite,
} from '../store/store/tree-op-paragraph-borders.ts';
import { PARAGRAPH_BORDER_EDGES } from '../store/store/tree-op-paragraph-borders.ts';

/** One edge the object model addresses. */
export type AutomationParagraphBorderEdge = 'top' | 'left' | 'bottom' | 'right' | 'between';

/** The edges the object model addresses, in collection order. */
const AUTOMATION_PARAGRAPH_BORDER_EDGES: readonly AutomationParagraphBorderEdge[] = [
  'top',
  'left',
  'bottom',
  'right',
  'between',
];

/** A `Word.BorderLineStyle` value. `None` turns the edge off. */
export type AutomationBorderLineStyle =
  | 'None'
  | 'Single'
  | 'Dot'
  | 'DashSmallGap'
  | 'DashLargeGap'
  | 'DashDot'
  | 'DashDotDot'
  | 'Double'
  | 'Triple'
  | 'ThinThickSmallGap'
  | 'ThickThinSmallGap'
  | 'ThinThickThinSmallGap'
  | 'ThinThickMedGap'
  | 'ThickThinMedGap'
  | 'ThinThickThinMedGap'
  | 'ThinThickLargeGap'
  | 'ThickThinLargeGap'
  | 'ThinThickThinLargeGap'
  | 'SingleWavy'
  | 'DoubleWavy'
  | 'DashDotStroked'
  | 'Emboss3D'
  | 'Engrave3D'
  | 'Outset'
  | 'Inset';

/** `Word.BorderLineStyle` values, by the `ST_Border` value each one writes. */
const LINE_STYLE_VALUES: Readonly<Record<Exclude<AutomationBorderLineStyle, 'None'>, string>> = {
  Single: 'single',
  Dot: 'dotted',
  DashSmallGap: 'dashSmallGap',
  DashLargeGap: 'dashed',
  DashDot: 'dotDash',
  DashDotDot: 'dotDotDash',
  Double: 'double',
  Triple: 'triple',
  ThinThickSmallGap: 'thinThickSmallGap',
  ThickThinSmallGap: 'thickThinSmallGap',
  ThinThickThinSmallGap: 'thinThickThinSmallGap',
  ThinThickMedGap: 'thinThickMediumGap',
  ThickThinMedGap: 'thickThinMediumGap',
  ThinThickThinMedGap: 'thinThickThinMediumGap',
  ThinThickLargeGap: 'thinThickLargeGap',
  ThickThinLargeGap: 'thickThinLargeGap',
  ThinThickThinLargeGap: 'thinThickThinLargeGap',
  SingleWavy: 'wave',
  DoubleWavy: 'doubleWave',
  DashDotStroked: 'dashDotStroked',
  Emboss3D: 'threeDEmboss',
  Engrave3D: 'threeDEngrave',
  Outset: 'outset',
  Inset: 'inset',
};

const LINE_STYLE_BY_VALUE: ReadonlyMap<string, AutomationBorderLineStyle> = new Map(
  Object.entries(LINE_STYLE_VALUES).map(
    ([style, value]) => [value, style as AutomationBorderLineStyle] as const
  )
);

/** A `Word.LineWidth` value. */
export type AutomationBorderLineWidth =
  'Pt025' | 'Pt050' | 'Pt075' | 'Pt100' | 'Pt150' | 'Pt225' | 'Pt300' | 'Pt450' | 'Pt600';

/** `Word.LineWidth` values, by the `w:sz` (eighths of a point) each one writes. */
const LINE_WIDTH_EIGHTHS: Readonly<Record<AutomationBorderLineWidth, number>> = {
  Pt025: 2,
  Pt050: 4,
  Pt075: 6,
  Pt100: 8,
  Pt150: 12,
  Pt225: 18,
  Pt300: 24,
  Pt450: 36,
  Pt600: 48,
};

const LINE_WIDTH_BY_EIGHTHS: ReadonlyMap<number, AutomationBorderLineWidth> = new Map(
  Object.entries(LINE_WIDTH_EIGHTHS).map(
    ([width, eighths]) => [eighths, width as AutomationBorderLineWidth] as const
  )
);

/** A `Word.ColorIndex` value a read can answer. */
export type AutomationBorderColorIndex =
  | 'Auto'
  | 'Black'
  | 'Blue'
  | 'Turquoise'
  | 'BrightGreen'
  | 'Pink'
  | 'Red'
  | 'Yellow'
  | 'White'
  | 'DarkBlue'
  | 'Teal'
  | 'Green'
  | 'Violet'
  | 'DarkRed'
  | 'DarkYellow'
  | 'Gray50'
  | 'Gray25';

/**
 * `Word.ColorIndex` values this lane writes, by colour. The classic and by-author entries
 * depend on the reading application's palette or on revision authors, so they are refused.
 */
const COLOR_INDEX_HEX: Readonly<Record<Exclude<AutomationBorderColorIndex, 'Auto'>, string>> = {
  Black: '000000',
  Blue: '0000FF',
  Turquoise: '00FFFF',
  BrightGreen: '00FF00',
  Pink: 'FF00FF',
  Red: 'FF0000',
  Yellow: 'FFFF00',
  White: 'FFFFFF',
  DarkBlue: '000080',
  Teal: '008080',
  Green: '008000',
  Violet: '800080',
  DarkRed: '800000',
  DarkYellow: '808000',
  Gray50: '808080',
  Gray25: 'C0C0C0',
};

const COLOR_INDEX_BY_HEX: ReadonlyMap<string, AutomationBorderColorIndex> = new Map(
  Object.entries(COLOR_INDEX_HEX).map(
    ([name, hex]) => [hex, name as AutomationBorderColorIndex] as const
  )
);

/** One edge, as the object model reads it. */
export interface AutomationParagraphBorderRead {
  readonly edge: AutomationParagraphBorderEdge;
  /** Whether a line shows on this edge. */
  readonly isVisible: boolean;
  /** `None` for no line; `null` for a line style no `Word.BorderLineStyle` value names. */
  readonly lineStyle: AutomationBorderLineStyle | null;
  /** `null` for no line, or for a width no `Word.LineWidth` value names. */
  readonly lineWidth: AutomationBorderLineWidth | null;
  /** `#RRGGBB`, or `null` for no line or an automatic colour. */
  readonly color: string | null;
  /** `Auto` for an automatic colour; `null` for no line or a colour outside the palette. */
  readonly colorIndex: AutomationBorderColorIndex | null;
  /** Whether this is the border between paragraphs: the collection's inside edge. */
  readonly inside: boolean;
}

/** A change to one edge. Every field is optional; an omitted one keeps its value. */
export interface AutomationParagraphBorderWrite {
  readonly isVisible?: boolean;
  readonly lineStyle?: AutomationBorderLineStyle;
  readonly lineWidth?: AutomationBorderLineWidth;
  /** `#RRGGBB`. */
  readonly color?: string;
  readonly colorIndex?: AutomationBorderColorIndex;
}

/** Changes to a paragraph's borders, by edge. */
export type AutomationParagraphBordersWrite = Readonly<
  Partial<Record<AutomationParagraphBorderEdge, AutomationParagraphBorderWrite>>
>;

/** The `w:space` a new line takes: the gap a newly drawn paragraph border has, in points. */
const DEFAULT_SPACE: Readonly<Record<AutomationParagraphBorderEdge, string>> = {
  top: '1',
  left: '4',
  bottom: '1',
  right: '4',
  between: '1',
};

const NO_LINE: ReadonlySet<string> = new Set(['nil', 'none']);
const FILE_HEX = /^[0-9A-Fa-f]{6}$/;
const REQUEST_HEX = /^#([0-9A-Fa-f]{6})$/;
const THEME_ATTRIBUTES = ['themeColor', 'themeTint', 'themeShade'] as const;
const WRITE_FIELDS: ReadonlySet<string> = new Set([
  'isVisible',
  'lineStyle',
  'lineWidth',
  'color',
  'colorIndex',
]);

type EdgeAttributes = Record<string, string>;

/** Where the inherited `w:pBdr` comes from: the style index, which owns the cascade. */
export interface InheritedParagraphBorders {
  /**
   * The last `w:pBdr` the paragraph's style chain and document defaults state, ignoring the
   * paragraph's own. `styleId` resolves it as if the paragraph named that style.
   */
  inheritedBorders(paragraph: OoxmlNode, styleId?: string): OoxmlNode | undefined;
}

/** The `w:`-namespace attributes of one element, with logical names folded to physical ones. */
function edgesOf(pBdr: OoxmlNode | undefined): Map<ParagraphBorderEdgeName, EdgeAttributes> {
  const edges = new Map<ParagraphBorderEdgeName, EdgeAttributes>();
  if (!pBdr || pBdr.kind === 'textValue') return edges;
  for (const child of pBdr.children) {
    if (child.kind === 'textValue' || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    const name =
      child.localName === 'start' ? 'left' : child.localName === 'end' ? 'right' : child.localName;
    if (!PARAGRAPH_BORDER_EDGES.includes(name as ParagraphBorderEdgeName)) continue;
    // The physical name wins when a file states both spellings, as layout reads it.
    if (edges.has(name as ParagraphBorderEdgeName) && child.localName !== name) continue;
    const attributes = nullRecord<string>();
    for (const attribute of child.attributes) {
      if (attribute.namespaceUri === WML_NAMESPACE_URI)
        attributes[attribute.localName] = attribute.value;
    }
    edges.set(name as ParagraphBorderEdgeName, attributes);
  }
  return edges;
}

function visible(attributes: EdgeAttributes | undefined): attributes is EdgeAttributes {
  return attributes !== undefined && attributes.val !== undefined && !NO_LINE.has(attributes.val);
}

function readEdge(
  edge: AutomationParagraphBorderEdge,
  attributes: EdgeAttributes | undefined
): AutomationParagraphBorderRead {
  const inside = edge === 'between';
  if (!visible(attributes)) {
    return {
      edge,
      isVisible: false,
      lineStyle: 'None',
      lineWidth: null,
      color: null,
      colorIndex: null,
      inside,
    };
  }
  // A missing `w:sz` paints at the half-point default, as layout draws it.
  const eighths = attributes.sz === undefined ? 4 : Number(attributes.sz);
  // An absent `w:color` is automatic, the same as `auto`.
  const automatic = attributes.color === undefined || attributes.color === 'auto';
  const hex =
    !automatic && FILE_HEX.test(attributes.color!) ? attributes.color!.toUpperCase() : null;
  return {
    edge,
    isVisible: true,
    lineStyle: LINE_STYLE_BY_VALUE.get(attributes.val) ?? null,
    lineWidth: Number.isInteger(eighths) ? (LINE_WIDTH_BY_EIGHTHS.get(eighths) ?? null) : null,
    color: hex === null ? null : `#${hex}`,
    colorIndex: automatic ? 'Auto' : hex === null ? null : (COLOR_INDEX_BY_HEX.get(hex) ?? null),
    inside,
  };
}

/** The `w:pBdr` in force for a paragraph: its own, else the one its style chain states. */
function borderElementInForce(
  paragraph: OoxmlNode,
  styles: InheritedParagraphBorders
): OoxmlNode | undefined {
  return (
    namedChild(paragraphPropertiesNodeOf(paragraph), 'pBdr') ?? styles.inheritedBorders(paragraph)
  );
}

/** The five edges the object model reads, in collection order, or null for no paragraph. */
export function paragraphBordersRead(
  part: OoxmlPart,
  paragraphId: string,
  styles: InheritedParagraphBorders
): readonly AutomationParagraphBorderRead[] | null {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;
  const edges = edgesOf(borderElementInForce(paragraph, styles));
  return AUTOMATION_PARAGRAPH_BORDER_EDGES.map((edge) => readEdge(edge, edges.get(edge)));
}

/** The result of planning a border write. */
export type ParagraphBordersPlan =
  | {
      readonly ok: true;
      /** The paragraph's own `w:pBdr` edges as they should stand, or null for no change. */
      readonly edges: readonly ParagraphBorderEdgeWrite[] | null;
    }
  | { readonly ok: false; readonly detail: string };

function refuse(detail: string): ParagraphBordersPlan {
  return { ok: false, detail };
}

function sameEdges(
  left: ReadonlyMap<ParagraphBorderEdgeName, EdgeAttributes>,
  right: ReadonlyMap<ParagraphBorderEdgeName, EdgeAttributes>
): boolean {
  if (left.size !== right.size) return false;
  for (const [edge, attributes] of left) {
    const other = right.get(edge);
    if (!other) return false;
    const names = Object.keys(attributes);
    if (names.length !== Object.keys(other).length) return false;
    if (names.some((name) => attributes[name] !== other[name])) return false;
  }
  return true;
}

/**
 * The paragraph's own border edges after a write, or why the write is refused.
 *
 * `styleId` is the style the same write applies, if any, so a style and a border can share a
 * sync and the border resolves against the new style.
 */
export function paragraphBordersPlan(
  paragraph: OoxmlNode,
  request: unknown,
  styles: InheritedParagraphBorders,
  styleId?: string
): ParagraphBordersPlan {
  if (typeof request !== 'object' || request === null || Array.isArray(request))
    return refuse('borders: not an object');
  const own = namedChild(paragraphPropertiesNodeOf(paragraph), 'pBdr');
  const inheritedElement = styles.inheritedBorders(paragraph, styleId);
  const inherited = edgesOf(inheritedElement);
  const before = own ? edgesOf(own) : inherited;
  const next = new Map(before);
  for (const [key, change] of Object.entries(request)) {
    if (!AUTOMATION_PARAGRAPH_BORDER_EDGES.includes(key as AutomationParagraphBorderEdge))
      return refuse(`borders: ${key} is not an edge`);
    const edge = key as AutomationParagraphBorderEdge;
    const label = `borders.${edge}`;
    if (typeof change !== 'object' || change === null || Array.isArray(change))
      return refuse(`${label}: not an object`);
    const fields = change as Record<string, unknown>;
    for (const field of Object.keys(fields)) {
      if (!WRITE_FIELDS.has(field)) return refuse(`${label}.${field}: not a border property`);
    }
    const current = before.get(edge);
    let shown = visible(current);
    let val = shown ? current!.val! : undefined;
    if (fields.lineStyle !== undefined) {
      if (fields.lineStyle === 'None') {
        shown = false;
      } else {
        const mapped =
          LINE_STYLE_VALUES[fields.lineStyle as Exclude<AutomationBorderLineStyle, 'None'>];
        if (
          typeof fields.lineStyle !== 'string' ||
          !Object.hasOwn(LINE_STYLE_VALUES, fields.lineStyle)
        )
          return refuse(`${label}.lineStyle: ${String(fields.lineStyle)}`);
        shown = true;
        val = mapped;
      }
    }
    if (fields.isVisible !== undefined) {
      if (typeof fields.isVisible !== 'boolean') return refuse(`${label}.isVisible: not a boolean`);
      // One sync carries the last value of each property, not their order, so a line style
      // and a visibility that disagree cannot both be honored.
      if (fields.lineStyle !== undefined && (fields.lineStyle !== 'None') !== fields.isVisible)
        return refuse(`${label}: isVisible and lineStyle disagree`);
      if (fields.isVisible && !shown) val = 'single';
      shown = fields.isVisible;
    }
    if (fields.color !== undefined && fields.colorIndex !== undefined)
      return refuse(`${label}: color and colorIndex both set`);
    const restyles =
      fields.lineWidth !== undefined ||
      fields.color !== undefined ||
      fields.colorIndex !== undefined;
    if (!shown) {
      // A width or colour on an edge with no line would be stored on nothing and read back
      // as no line. Refused rather than silently dropped.
      if (restyles) return refuse(`${label}: no line is shown; set lineStyle or isVisible`);
      next.delete(edge);
      continue;
    }
    const attributes: EdgeAttributes = visible(current)
      ? { ...current }
      : { sz: '4', space: DEFAULT_SPACE[edge], color: 'auto' };
    attributes.val = val!;
    if (fields.lineWidth !== undefined) {
      if (
        typeof fields.lineWidth !== 'string' ||
        !Object.hasOwn(LINE_WIDTH_EIGHTHS, fields.lineWidth)
      )
        return refuse(`${label}.lineWidth: ${String(fields.lineWidth)}`);
      attributes.sz = String(LINE_WIDTH_EIGHTHS[fields.lineWidth as AutomationBorderLineWidth]);
    }
    let color: string | undefined;
    if (fields.color !== undefined) {
      const match = typeof fields.color === 'string' ? REQUEST_HEX.exec(fields.color) : null;
      if (!match) return refuse(`${label}.color: not #RRGGBB`);
      color = match[1]!.toUpperCase();
    }
    if (fields.colorIndex !== undefined) {
      if (fields.colorIndex === 'Auto') color = 'auto';
      else if (
        typeof fields.colorIndex === 'string' &&
        Object.hasOwn(COLOR_INDEX_HEX, fields.colorIndex)
      )
        color = COLOR_INDEX_HEX[fields.colorIndex as Exclude<AutomationBorderColorIndex, 'Auto'>];
      else return refuse(`${label}.colorIndex: ${String(fields.colorIndex)}`);
    }
    if (color !== undefined) {
      attributes.color = color;
      // A theme colour overrides `w:color`, so a stated colour has to drop it to show.
      for (const name of THEME_ATTRIBUTES) delete attributes[name];
    }
    next.set(edge, attributes);
  }
  // Every edge the style shows and this write does not keep is stated off. A reader that
  // replaces the style's element and one that merges edges then both show the same borders,
  // and dropping the paragraph's own element can never bring a hidden style edge back.
  for (const [edge, attributes] of inherited) {
    if (visible(attributes) && !visible(next.get(edge))) next.set(edge, { val: 'nil' });
  }
  // No write when nothing moves: neither the paragraph's own element, nor, for a paragraph
  // with none, the style's — restating that would freeze inherited values into the paragraph.
  if (sameEdges(next, own ? before : inherited)) return { ok: true, edges: null };
  return {
    ok: true,
    edges: PARAGRAPH_BORDER_EDGES.flatMap((edge) => {
      const attributes = next.get(edge);
      return attributes ? [{ edge, attributes: { ...attributes } }] : [];
    }),
  };
}
