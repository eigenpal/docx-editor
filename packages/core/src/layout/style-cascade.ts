// Layout-side paragraph style cascade (styles.xml → semantic layout).
//
// The canonical tree keeps `w:pStyle` / `w:rStyle` and direct `rPr`/`pPr` as authored. Layout
// is the place that expands a style id into measurable run and paragraph properties: Word
// paints headings from the styles part when runs carry no direct formatting.
//
// Bounds everywhere: style ids are length/control validated, `basedOn` walks are depth- and
// cycle-capped, duplicate style ids keep the LAST definition (Word), and property values are
// still sanitised by `resolveRunStyle` / `paragraphSpacing` / `paragraphBorders` /
// `paragraphShading`. This module never invents theme colours or fetches remote resources.
//
// `cacheToken` is a bounded FNV-1a fingerprint of the cascade table (computed once), not the
// full styles material — layout embeds it in every paragraph key, so an unbounded string
// would be quadratic in memory.

import type { OoxmlElement, OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';
import { stableHash } from '../store/comparators/canonical.ts';
import { isDangerousKey } from '../store/package/safe-record.ts';
import {
  indentTwips,
  paragraphAlignment,
  paragraphIndent,
  propertiesOf,
  type Alignment,
} from './paragraph-flow.ts';
import {
  cascadedParagraphBorders,
  paragraphBorders,
  paragraphContextualSpacing,
  paragraphLineSpacing,
  paragraphSpacing,
  type ParagraphBorderEdge,
  type ParagraphBorders,
  type ParagraphLineSpacing,
  type ParagraphSpacing,
} from './paragraph-style.ts';
import { paragraphShading } from './ooxml-shading.ts';
import {
  cascadedTabStops,
  paragraphTabStops,
  tabStopsFingerprint,
  type ResolvedTabStops,
} from './paragraph-tabs.ts';
import type { ThemeFonts } from './run-style.ts';

/** Soft ceiling on `basedOn` chain length — enough for real templates, refuses hostile graphs. */
export const MAX_STYLE_BASED_ON_DEPTH = 32;

/** Soft ceiling on style definitions read from one styles part. */
export const MAX_STYLE_DEFINITIONS = 4096;

/** Identifier-ish strings from a file (style ids): bounded, no control characters. */
const STYLE_ID_MAX = 128;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

export interface StyleDefinition {
  readonly styleId: string;
  readonly type: string;
  readonly basedOn: string | null;
  readonly paragraphProperties: readonly OoxmlProperty[];
  readonly runProperties: readonly OoxmlProperty[];
  /** The style's `w:pPr` node, when present — needed for nested `w:pBdr`. */
  readonly paragraphPropertiesNode: OoxmlElement | undefined;
  /** The style's `w:tblPr`, for a `w:type="table"` style. */
  readonly tablePropertiesNode: OoxmlElement | undefined;
  /**
   * `w:tblStylePr` conditional formats by `w:type` (`firstRow`, `band1Horz`, …).
   *
   * Word puts a table's real appearance here: `Table Grid` carries its grid in the style's
   * `w:tblBorders`, and the banded/​header looks live in these. A document states only
   * `<w:tblStyle w:val="TableGrid"/>`.
   */
  readonly conditionalTableFormats: ReadonlyMap<string, OoxmlElement>;
}

export interface StyleCascadeTable {
  /**
   * Bounded fingerprint folded into layout cache producers so a different styles part cannot
   * reuse breaks measured under another cascade. Computed once per table (FNV-1a hex).
   */
  readonly cacheToken: string;
  readonly docDefaultsRun: readonly OoxmlProperty[];
  readonly docDefaultsParagraph: readonly OoxmlProperty[];
  readonly docDefaultsParagraphNode: OoxmlElement | undefined;
  /** `w:style[@w:default='1'][@w:type='paragraph']` — last wins among defaults of that type. */
  readonly defaultParagraphStyleId: string | null;
  /** `w:style[@w:default='1'][@w:type='character']` — last wins among defaults of that type. */
  readonly defaultCharacterStyleId: string | null;
  /**
   * The theme part's Latin typefaces, for `w:rFonts` theme references.
   *
   * Lives on the cascade because it is document-level style material with the same
   * lifetime, and because every site that resolves run properties already holds this table.
   */
  readonly themeFonts: ThemeFonts;
  readonly styles: ReadonlyMap<string, StyleDefinition>;
}

/** A document with no theme part: every theme reference falls back to its explicit name. */
export const NO_THEME_FONTS: ThemeFonts = { major: null, minor: null };

export interface CascadedParagraphFormatting {
  /** Flat paragraph properties in cascade order (defaults → bases → style → direct). */
  readonly paragraphProperties: readonly OoxmlProperty[];
  /**
   * The same list WITHOUT the paragraph's own `w:pPr` — everything it inherits.
   *
   * Numbering needs the two tiers apart: a level's `w:pPr/w:ind` outranks the style's and is
   * outranked by the paragraph's own, and a flattened list cannot say which is which.
   */
  readonly inheritedParagraphProperties: readonly OoxmlProperty[];
  /** Matching `w:pPr` nodes for nested border resolution. */
  readonly paragraphPropertyNodes: readonly OoxmlNode[];
  /** Inherited run properties for every run in the paragraph (before direct run `rPr`). */
  readonly runProperties: readonly OoxmlProperty[];
  /**
   * The style this paragraph resolved to, or null when it names none and there is no
   * document default. `w:contextualSpacing` compares neighbours by exactly this.
   */
  readonly styleId: string | null;
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function childNamed(parent: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of parent.children) {
    if (isElement(child) && child.localName === localName) return child;
  }
  return undefined;
}

/** Accepted style ids only — over-long, control-bearing, or dangerous keys are dropped. */
export function isValidStyleId(raw: string | undefined): raw is string {
  if (raw === undefined || raw.length === 0 || raw.length > STYLE_ID_MAX) return false;
  if (CONTROL_CHARS.test(raw) || isDangerousKey(raw)) return false;
  return true;
}

function isDefaultFlag(raw: string | undefined): boolean {
  return raw === '1' || raw === 'true';
}

function propertiesFingerprint(props: readonly OoxmlProperty[]): unknown {
  return props.map((property) =>
    property.attributes
      ? { n: property.localName, a: property.attributes }
      : { n: property.localName }
  );
}

function findRunProperties(container: OoxmlElement | undefined): OoxmlElement | undefined {
  if (!container) return undefined;
  for (const child of container.children) {
    if (isElement(child) && (child.kind === 'runProperties' || child.localName === 'rPr')) {
      return child;
    }
  }
  return undefined;
}

/**
 * A container's `w:pPr`, whether or not the canonical read TYPED it.
 *
 * The typed kind is not guaranteed: a `w:pPr` demotes to generic whenever the reader's
 * known-node invariant refuses it, and one shape that trips it is ordinary Word output —
 * the paragraph mark (`w:rPr`) followed by `w:sectPr` or `w:pPrChange`, which is exactly
 * the CT_PPr order (17.3.1.26). A demoted container matched by kind alone reads as no
 * properties at all, so the paragraph renders with none of its authored alignment,
 * indent, numbering or style.
 */
function findParagraphProperties(container: OoxmlElement | undefined): OoxmlElement | undefined {
  if (!container) return undefined;
  for (const child of container.children) {
    if (isElement(child) && (child.kind === 'paragraphProperties' || child.localName === 'pPr')) {
      return child;
    }
  }
  return undefined;
}

/**
 * Tracked-change RECORDS a style definition's property lists can carry: editing a style
 * with tracking on writes `w:rPrChange`/`w:pPrChange` (and `w:ins`/`w:del` for the
 * definition itself) INSIDE the style's `rPr`/`pPr`. They are decisions about the STYLE,
 * not formatting, and none of the property resolvers read them — but cascaded into span
 * property lists they made `formatRevisionOf` mark EVERY span of every paragraph using
 * the style as one tracked format change, painting a whole document grey over a single
 * restyled style definition.
 */
const STYLE_CHANGE_RECORDS: ReadonlySet<string> = new Set([
  'rPrChange',
  'pPrChange',
  'ins',
  'del',
  'moveFrom',
  'moveTo',
]);

function withoutChangeRecords(props: OoxmlProperty[]): OoxmlProperty[] {
  // The common style carries none; keep the allocated array in that case.
  return props.some((property) => STYLE_CHANGE_RECORDS.has(property.localName))
    ? props.filter((property) => !STYLE_CHANGE_RECORDS.has(property.localName))
    : props;
}

function readDocDefaults(stylesRoot: OoxmlElement): {
  run: readonly OoxmlProperty[];
  paragraph: readonly OoxmlProperty[];
  paragraphNode: OoxmlElement | undefined;
} {
  const docDefaults = childNamed(stylesRoot, 'docDefaults');
  if (!docDefaults) return { run: [], paragraph: [], paragraphNode: undefined };
  const rPrDefault = childNamed(docDefaults, 'rPrDefault');
  const pPrDefault = childNamed(docDefaults, 'pPrDefault');
  const runNode = findRunProperties(rPrDefault);
  const paragraphNode = findParagraphProperties(pPrDefault);
  return {
    run: withoutChangeRecords(propertiesOf(runNode)),
    paragraph: withoutChangeRecords(propertiesOf(paragraphNode)),
    paragraphNode,
  };
}

function readStyleDefinition(
  node: OoxmlElement
): (StyleDefinition & { isDefault: boolean }) | null {
  const styleId = attributeValue(node, 'styleId');
  if (!isValidStyleId(styleId)) return null;
  const type = attributeValue(node, 'type') ?? '';
  const basedOnRaw = (() => {
    const basedOn = childNamed(node, 'basedOn');
    return basedOn ? attributeValue(basedOn, 'val') : undefined;
  })();
  const basedOn = isValidStyleId(basedOnRaw) ? basedOnRaw : null;
  const paragraphPropertiesNode = findParagraphProperties(node);
  const runPropertiesNode = findRunProperties(node);
  const conditionalTableFormats = new Map<string, OoxmlElement>();
  let seenConditional = 0;
  for (const child of node.children) {
    if (child.kind === 'textValue' || child.localName !== 'tblStylePr') continue;
    // Bounded: `w:type` is an enumeration of nine values, but the element count is
    // attacker-controlled and each one is retained.
    if (seenConditional >= MAX_CONDITIONAL_TABLE_FORMATS) break;
    seenConditional += 1;
    const conditionType = attributeValue(child, 'type');
    if (conditionType && !conditionalTableFormats.has(conditionType)) {
      conditionalTableFormats.set(conditionType, child);
    }
  }
  return {
    styleId,
    type,
    basedOn,
    isDefault: isDefaultFlag(attributeValue(node, 'default')),
    paragraphProperties: withoutChangeRecords(propertiesOf(paragraphPropertiesNode)),
    runProperties: withoutChangeRecords(propertiesOf(runPropertiesNode)),
    paragraphPropertiesNode,
    tablePropertiesNode: childNamed(node, 'tblPr'),
    conditionalTableFormats,
  };
}

/** Nine `ST_TblStyleOverrideType` values exist; the ceiling only bounds a hostile part. */
const MAX_CONDITIONAL_TABLE_FORMATS = 32;

/**
 * A table style resolved through its `w:basedOn` chain.
 *
 * `tablePropertyNodes` is base-first, so a later node overrides an earlier one — the same
 * ordering the paragraph cascade uses. `conditional` is flattened the same way, so a
 * derived style's `firstRow` replaces its base's.
 *
 * A table style also carries whole-table `w:pPr`/`w:rPr` (17.7.6.1). That is how a style
 * sets the type of every paragraph in the table before any row condition applies.
 */
export interface CascadedTableFormatting {
  readonly tablePropertyNodes: readonly OoxmlElement[];
  readonly paragraphPropertyNodes: readonly OoxmlElement[];
  readonly paragraphProperties: readonly OoxmlProperty[];
  readonly runProperties: readonly OoxmlProperty[];
  readonly conditional: ReadonlyMap<string, OoxmlElement>;
}

export const EMPTY_TABLE_FORMATTING: CascadedTableFormatting = Object.freeze({
  tablePropertyNodes: Object.freeze([]) as readonly OoxmlElement[],
  paragraphPropertyNodes: Object.freeze([]) as readonly OoxmlElement[],
  paragraphProperties: Object.freeze([]) as readonly OoxmlProperty[],
  runProperties: Object.freeze([]) as readonly OoxmlProperty[],
  conditional: new Map<string, OoxmlElement>(),
});

/** Resolve a `w:tblStyle` id against the cascade, base-first. */
export function cascadeTableFormatting(
  table: StyleCascadeTable,
  styleId: string | undefined
): CascadedTableFormatting {
  if (!styleId || !isValidStyleId(styleId)) return EMPTY_TABLE_FORMATTING;
  const chain = styleChain(table, styleId, 'table');
  if (chain.length === 0) return EMPTY_TABLE_FORMATTING;
  const tablePropertyNodes: OoxmlElement[] = [];
  const paragraphPropertyNodes: OoxmlElement[] = [];
  const paragraphProperties: OoxmlProperty[] = [];
  const runProperties: OoxmlProperty[] = [];
  const conditional = new Map<string, OoxmlElement>();
  for (const style of chain) {
    if (style.tablePropertiesNode) tablePropertyNodes.push(style.tablePropertiesNode);
    if (style.paragraphPropertiesNode) paragraphPropertyNodes.push(style.paragraphPropertiesNode);
    paragraphProperties.push(...style.paragraphProperties);
    runProperties.push(...style.runProperties);
    for (const [conditionType, node] of style.conditionalTableFormats) {
      conditional.set(conditionType, node);
    }
  }
  return {
    tablePropertyNodes,
    paragraphPropertyNodes,
    paragraphProperties,
    runProperties,
    conditional,
  };
}

/**
 * What a table style contributes to the paragraphs of ONE cell: the style's whole-table
 * `w:pPr`/`w:rPr` followed by every `w:tblStylePr` the cell is under (17.7.6.6), weakest
 * first in the caller's condition order (banding, column, row, corner).
 *
 * This is how Word makes a header row bold and centred while the document states nothing
 * but `<w:tblStyle w:val="…"/>` on the table and plain runs in the cells.
 */
export interface TableCellStyleFormatting {
  readonly paragraphProperties: readonly OoxmlProperty[];
  /** Matching `w:pPr` nodes, for nested `w:pBdr` / `w:tabs` resolution. */
  readonly paragraphPropertyNodes: readonly OoxmlElement[];
  /** Inherited run properties for every run in the cell, before the paragraph style. */
  readonly runProperties: readonly OoxmlProperty[];
}

export const EMPTY_TABLE_CELL_STYLE_FORMATTING: TableCellStyleFormatting = Object.freeze({
  paragraphProperties: Object.freeze([]) as readonly OoxmlProperty[],
  paragraphPropertyNodes: Object.freeze([]) as readonly OoxmlElement[],
  runProperties: Object.freeze([]) as readonly OoxmlProperty[],
});

/** Flatten a table style's own and conditional paragraph/run properties for one cell. */
export function tableCellStyleFormatting(
  formatting: CascadedTableFormatting,
  conditions: readonly string[]
): TableCellStyleFormatting {
  const paragraphPropertyNodes: OoxmlElement[] = [...formatting.paragraphPropertyNodes];
  const paragraphProperties: OoxmlProperty[] = [...formatting.paragraphProperties];
  const runProperties: OoxmlProperty[] = [...formatting.runProperties];
  for (const conditionType of conditions) {
    const format = formatting.conditional.get(conditionType);
    if (!format) continue;
    const conditionPPr = findParagraphProperties(format);
    if (conditionPPr) {
      paragraphPropertyNodes.push(conditionPPr);
      paragraphProperties.push(...withoutChangeRecords(propertiesOf(conditionPPr)));
    }
    const conditionRPr = findRunProperties(format);
    if (conditionRPr) runProperties.push(...withoutChangeRecords(propertiesOf(conditionRPr)));
  }
  if (
    paragraphPropertyNodes.length === 0 &&
    paragraphProperties.length === 0 &&
    runProperties.length === 0
  ) {
    return EMPTY_TABLE_CELL_STYLE_FORMATTING;
  }
  return { paragraphProperties, paragraphPropertyNodes, runProperties };
}

/**
 * Build a cascade table from a styles part root.
 *
 * Only direct `w:style` children of the root participate (bounded count). Duplicate
 * `styleId` values keep the last definition, matching Word's reader for this fixture class.
 * Default paragraph/character style ids track `w:default="1"` with the same last-wins rule.
 */
export function buildStyleCascadeTable(
  stylesRoot: OoxmlElement | null,
  themeFonts: ThemeFonts = NO_THEME_FONTS
): StyleCascadeTable {
  const styles = new Map<string, StyleDefinition>();
  if (!stylesRoot) {
    return {
      // Still keyed on the theme: a document with no styles part can carry a theme, and
      // its runs resolve `+Body` through it.
      cacheToken: stableHash({ empty: true, theme: themeFonts }),
      docDefaultsRun: [],
      docDefaultsParagraph: [],
      docDefaultsParagraphNode: undefined,
      defaultParagraphStyleId: null,
      defaultCharacterStyleId: null,
      themeFonts,
      styles,
    };
  }

  const defaults = readDocDefaults(stylesRoot);
  let defaultParagraphStyleId: string | null = null;
  let defaultCharacterStyleId: string | null = null;
  let counted = 0;
  for (const child of stylesRoot.children) {
    if (!isElement(child) || child.localName !== 'style') continue;
    if (counted >= MAX_STYLE_DEFINITIONS) break;
    counted += 1;
    const definition = readStyleDefinition(child);
    if (!definition) continue;
    const { isDefault, ...style } = definition;
    // Last duplicate wins.
    styles.set(style.styleId, style);
    if (style.type === 'paragraph') {
      if (isDefault) defaultParagraphStyleId = style.styleId;
      else if (defaultParagraphStyleId === style.styleId) defaultParagraphStyleId = null;
    } else if (style.type === 'character') {
      if (isDefault) defaultCharacterStyleId = style.styleId;
      else if (defaultCharacterStyleId === style.styleId) defaultCharacterStyleId = null;
    }
  }

  // Canonical material hashed once — never embed the full styles dump in paragraph keys.
  const cacheToken = stableHash({
    dR: propertiesFingerprint(defaults.run),
    dP: propertiesFingerprint(defaults.paragraph),
    defP: defaultParagraphStyleId,
    defC: defaultCharacterStyleId,
    // Retheming changes the face every theme-fonted run measures in while no style
    // material moves, so a break cached under the old theme must not be reused.
    theme: themeFonts,
    styles: [...styles.values()].map((style) => ({
      id: style.styleId,
      type: style.type,
      basedOn: style.basedOn,
      p: propertiesFingerprint(style.paragraphProperties),
      r: propertiesFingerprint(style.runProperties),
    })),
  });

  return {
    cacheToken,
    docDefaultsRun: defaults.run,
    docDefaultsParagraph: defaults.paragraph,
    docDefaultsParagraphNode: defaults.paragraphNode,
    defaultParagraphStyleId,
    defaultCharacterStyleId,
    themeFonts,
    styles,
  };
}

function styleIdFromProps(
  directProps: readonly OoxmlProperty[],
  localName: 'pStyle' | 'rStyle'
): string | null {
  let id: string | null = null;
  for (const property of directProps) {
    if (property.localName !== localName) continue;
    const value = property.attributes?.val;
    id = isValidStyleId(value) ? value : null;
  }
  return id;
}

/**
 * Resolve the `basedOn` chain base-first, stopping on missing ids, cycles, or depth.
 *
 * The tip must match `expectedType`; other types named by `w:pStyle` / `w:rStyle` contribute
 * nothing (Word ignores them for that inheritance axis).
 */
function styleChain(
  table: StyleCascadeTable,
  styleId: string,
  expectedType: 'paragraph' | 'character' | 'table'
): readonly StyleDefinition[] {
  const tip = table.styles.get(styleId);
  if (!tip || tip.type !== expectedType) return [];

  const tipFirst: StyleDefinition[] = [];
  const seen = new Set<string>();
  let current: string | null = styleId;
  let depth = 0;
  while (current !== null && depth < MAX_STYLE_BASED_ON_DEPTH) {
    if (seen.has(current)) break;
    if (!isValidStyleId(current)) break;
    seen.add(current);
    const definition = table.styles.get(current);
    if (!definition) break;
    tipFirst.push(definition);
    current = definition.basedOn;
    depth += 1;
  }
  return tipFirst.reverse();
}

/**
 * Cascade paragraph + inherited run properties for one paragraph's direct `w:pPr`.
 *
 * Order: `docDefaults` → table style → `basedOn` ancestors → paragraph style → direct
 * formatting, which is the style hierarchy of 17.7.2: a table style sits above the document
 * defaults and below the paragraph style a cell paragraph names for itself.
 * When `w:pStyle` is absent, the document's default paragraph style (`w:default="1"`) is used.
 * Direct formatting is last so it overrides inherited values inside the existing resolvers.
 */
export function cascadeParagraphFormatting(
  table: StyleCascadeTable,
  directPPr: OoxmlNode | undefined,
  tableCellStyle?: TableCellStyleFormatting
): CascadedParagraphFormatting {
  const directProps = propertiesOf(directPPr);
  const styleId = styleIdFromProps(directProps, 'pStyle') ?? table.defaultParagraphStyleId;
  const chain = styleId ? styleChain(table, styleId, 'paragraph') : [];

  const inheritedParagraphProperties: OoxmlProperty[] = [
    ...table.docDefaultsParagraph,
    ...(tableCellStyle?.paragraphProperties ?? []),
    ...chain.flatMap((style) => style.paragraphProperties),
  ];
  const paragraphProperties: OoxmlProperty[] = [...inheritedParagraphProperties, ...directProps];

  const paragraphPropertyNodes: OoxmlNode[] = [];
  if (table.docDefaultsParagraphNode) paragraphPropertyNodes.push(table.docDefaultsParagraphNode);
  if (tableCellStyle) paragraphPropertyNodes.push(...tableCellStyle.paragraphPropertyNodes);
  for (const style of chain) {
    if (style.paragraphPropertiesNode) paragraphPropertyNodes.push(style.paragraphPropertiesNode);
  }
  if (directPPr) paragraphPropertyNodes.push(directPPr);

  const directMarkRun = findRunProperties(
    directPPr && isElement(directPPr) ? directPPr : undefined
  );

  const runProperties: OoxmlProperty[] = [
    ...table.docDefaultsRun,
    ...(tableCellStyle?.runProperties ?? []),
    ...chain.flatMap((style) => style.runProperties),
    ...propertiesOf(directMarkRun),
  ];

  return {
    paragraphProperties,
    inheritedParagraphProperties,
    paragraphPropertyNodes,
    runProperties,
    styleId: styleId ?? null,
  };
}

/**
 * Bottom border after cascade: a later `w:pBdr` replaces an earlier one; absence inherits.
 * `nil`/`none` clear the edge via `paragraphBorders`.
 */
export function cascadedBottomBorder(
  paragraphPropertyNodes: readonly OoxmlNode[]
): ParagraphBorderEdge | undefined {
  let edge: ParagraphBorderEdge | undefined;
  for (const node of paragraphPropertyNodes) {
    if (!node || node.kind === 'textValue') continue;
    let hasPBdr = false;
    for (const child of node.children) {
      if (isElement(child) && child.localName === 'pBdr') {
        hasPBdr = true;
        break;
      }
    }
    if (!hasPBdr) continue;
    edge = paragraphBorders(node).bottom;
  }
  return edge;
}

/**
 * Merge inherited paragraph-style run props with a run's direct `rPr` (direct last).
 *
 * When a cascade table is supplied, also resolves `w:rStyle` character styles (basedOn chain,
 * cycle/depth capped). Runs without an explicit `rStyle` pick up the default character style
 * (`w:default="1"`). Precedence: inherited → character style chain → direct formatting.
 */
export function cascadeRunProperties(
  inheritedRunProperties: readonly OoxmlProperty[],
  directRunProperties: readonly OoxmlProperty[],
  table?: StyleCascadeTable
): readonly OoxmlProperty[] {
  let characterProps: readonly OoxmlProperty[] = [];
  if (table) {
    const rStyleId = styleIdFromProps(directRunProperties, 'rStyle');
    const characterStyleId = rStyleId ?? table.defaultCharacterStyleId;
    if (characterStyleId) {
      characterProps = styleChain(table, characterStyleId, 'character').flatMap(
        (style) => style.runProperties
      );
    }
  }

  if (inheritedRunProperties.length === 0 && characterProps.length === 0) {
    return directRunProperties;
  }
  if (directRunProperties.length === 0 && characterProps.length === 0) {
    return inheritedRunProperties;
  }
  return [...inheritedRunProperties, ...characterProps, ...directRunProperties];
}

export interface ParagraphLayoutInputs {
  readonly props: OoxmlProperty[];
  readonly indent: { left: number; right: number; hanging: number; firstLine: number };
  readonly available: number;
  readonly alignment: Alignment;
  readonly spacing: ParagraphSpacing;
  /** Resolved `w:line` / `w:lineRule`; single spacing where the cascade says nothing. */
  readonly lineSpacing: ParagraphLineSpacing;
  /** `w:contextualSpacing`: drop before/after between same-style neighbours. */
  readonly contextualSpacing: boolean;
  /** Resolved paragraph style id, for the `w:contextualSpacing` neighbour comparison. */
  readonly styleId: string | null;
  readonly bottomBorder: ParagraphBorderEdge | undefined;
  /**
   * Every `CT_PBdr` edge after cascade, not just the bottom one.
   *
   * `bottomBorder` stays alongside it because the fragment signature and the table flow
   * read that field by name; this is the whole box, so a cell paragraph gets the same
   * frame a body paragraph does.
   */
  readonly borders: ParagraphBorders;
  /** Validated 6-hex paragraph shading fill from cascaded `w:pPr/w:shd`, absent for none. */
  readonly shading: string | undefined;
  readonly inheritedRunProperties: readonly OoxmlProperty[];
  /** Cascaded custom tab stops + default interval for paragraph-flow breaking. */
  readonly tabStops: ResolvedTabStops;
  /**
   * Fingerprint folded into the paragraph layout cache key — nested `w:tabs` are absent
   * from flat property bags, so style-inherited stops must be named explicitly.
   */
  readonly tabStopsCacheToken: string;
  /** Resolved list marker inputs when the paragraph participates in numbering. */
  readonly listItem?: import('./list-resolve.ts').ResolvedListItem;
}

/**
 * Resolve every paragraph input semantic layout / table cells share: cascaded props when a
 * style table is present, otherwise direct formatting only.
 *
 * When `listItem` is provided, its merged level indent becomes the paragraph indent (list
 * hanging / left from `numbering.xml`), which is what Word uses for fixture list paragraphs
 * that author no direct `w:ind`.
 *
 * `tableCellStyle` carries what the enclosing table's style says about this cell's
 * paragraphs; body paragraphs pass nothing.
 */
export function resolveParagraphLayoutInputs(
  paragraph: OoxmlElement,
  contentWidth: number,
  styleCascade: StyleCascadeTable | undefined,
  listItem?: import('./list-resolve.ts').ResolvedListItem,
  tableCellStyle?: TableCellStyleFormatting
): ParagraphLayoutInputs {
  const pPr = findParagraphProperties(paragraph);
  const cascaded = styleCascade
    ? cascadeParagraphFormatting(styleCascade, pPr, tableCellStyle)
    : null;
  const props = cascaded ? [...cascaded.paragraphProperties] : propertiesOf(pPr);
  // Direct `w:pPr/w:rPr` (paragraph mark) must reach empty-line / last-line metrics even
  // when there is no styles part — cascadeParagraphFormatting already folds it in when a
  // table is present.
  const inheritedRunProperties = cascaded
    ? cascaded.runProperties
    : propertiesOf(findRunProperties(pPr && isElement(pPr) ? pPr : undefined));
  const baseIndent = paragraphIndent(props);
  let hanging = 0;
  let firstLine = 0;
  if (listItem) {
    hanging = listItem.indent.hanging;
    firstLine = listItem.indent.firstLine;
  } else {
    for (const property of props) {
      if (property.localName !== 'ind') continue;
      // Both go through the clamp `w:left`/`w:right` already use. `w:ind` is
      // attacker-controlled, and these two were the only indent attributes reaching
      // geometry unbounded — `w:hanging="999999999"` resolved to 50,000,000pt.
      const h = indentTwips(property.attributes?.hanging);
      const f = indentTwips(property.attributes?.firstLine);
      // `w:hanging` and `w:firstLine` are MUTUALLY EXCLUSIVE (§17.3.1.10, §17.3.1.12): they
      // are two spellings of one first-line offset, so an `w:ind` that states either one
      // replaces BOTH. Accumulating them independently let a style's hanging indent survive a
      // paragraph that explicitly cancelled it with `w:firstLine="0"` — the first line of
      // every body paragraph then hung out into the left margin while the rest sat indented.
      //
      // An `w:ind` that states NEITHER (a bare `w:left`) leaves the inherited offset alone,
      // which is why this is gated rather than reset on every `ind`.
      if (
        property.attributes?.hanging !== undefined ||
        property.attributes?.firstLine !== undefined
      ) {
        // `w:hanging` is `ST_TwipsMeasure`, unsigned: a negative one is not a measurement.
        hanging = h !== null ? Math.max(0, h) / 20 : 0;
        // `w:firstLine` is DECLARED unsigned, but Word's model keeps one SIGNED first-line
        // indent and the numbering reader already reads it that way (`numbering-index.ts`).
        // Flattening a negative to zero here rendered a body paragraph flush where Word
        // renders a hanging, and made the two readers disagree about the same attribute.
        firstLine = f !== null ? f / 20 : 0;
      }
    }
  }
  const indent = listItem
    ? {
        left: listItem.indent.left,
        right: listItem.indent.right,
        hanging,
        firstLine,
      }
    : { left: baseIndent.left, right: baseIndent.right, hanging, firstLine };
  const tabStops = cascaded
    ? cascadedTabStops(cascaded.paragraphPropertyNodes)
    : paragraphTabStops(pPr);
  return {
    props,
    indent,
    available: Math.max(1, contentWidth - indent.left - indent.right),
    alignment: paragraphAlignment(props),
    spacing: paragraphSpacing(props),
    lineSpacing: paragraphLineSpacing(props),
    contextualSpacing: paragraphContextualSpacing(props),
    styleId: cascaded ? cascaded.styleId : (styleIdFromProps(props, 'pStyle') ?? null),
    bottomBorder: cascaded
      ? cascadedBottomBorder(cascaded.paragraphPropertyNodes)
      : paragraphBorders(pPr).bottom,
    borders: cascaded
      ? cascadedParagraphBorders(cascaded.paragraphPropertyNodes)
      : paragraphBorders(pPr),
    shading: paragraphShading(props),
    inheritedRunProperties,
    tabStops,
    tabStopsCacheToken: tabStopsFingerprint(tabStops),
    ...(listItem ? { listItem } : {}),
  };
}
