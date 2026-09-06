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

import {
  canonicalOoxmlFingerprint,
  twipsToPoints,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';
import { stableHash } from '../store/comparators/canonical.ts';
import { cjkTypographyFromSettings, type CjkTypographySettings } from './cjk-typography.ts';
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
import { NO_THEME_FONTS, type ThemeFonts } from './run-style.ts';
import { combineStyleToggles } from './style-toggles.ts';
import {
  findParagraphProperties,
  findRunProperties,
  isElement,
  isValidStyleId,
  readDocDefaults,
  readStyleDefinition,
  withoutChangeRecords,
  type StyleDefinition,
} from './style-definition-reader.ts';

export { isValidStyleId } from './style-definition-reader.ts';
export type { StyleDefinition } from './style-definition-reader.ts';

/** Soft ceiling on `basedOn` chain length — enough for real templates, refuses hostile graphs. */
export const MAX_STYLE_BASED_ON_DEPTH = 32;

/** Soft ceiling on style definitions read from one styles part. */
export const MAX_STYLE_DEFINITIONS = 4096;

/**
 * The whole styles part, indexed and ready to resolve against.
 *
 * `cacheToken` is load-bearing: it folds into layout cache producers so breaks measured under one
 * styles part are never reused under another.
 */
export interface StyleCascadeTable {
  readonly typography?: CjkTypographySettings;
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
   * `w:style[@w:default='1'][@w:type='table']` — last wins among defaults of that type.
   *
   * A `w:tbl` with no `w:tblStyle` still resolves against this one. Word's own
   * `TableNormal` is where the 0/108/0/108 twip cell margins live, so skipping it gives
   * every unstyled table padding the document says it does not have.
   */
  readonly defaultTableStyleId: string | null;
  /**
   * The theme part's typefaces, for `w:rFonts` theme references.
   *
   * Lives on the cascade because it is document-level style material with the same
   * lifetime, and because every site that resolves run properties already holds this table.
   */
  readonly themeFonts: ThemeFonts;
  readonly styles: ReadonlyMap<string, StyleDefinition>;
}

/**
 * A paragraph's properties after the cascade, plus the same list WITHOUT its own `w:pPr`.
 *
 * Both, because a writer needs to know what a paragraph INHERITS to decide whether setting a
 * value is a change or a no-op — and writing back an inherited value freezes it into the
 * paragraph as though the author had chosen it.
 */
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
  /**
   * Inherited run properties for CONTENT runs (before direct run `rPr`).
   *
   * Does NOT include direct `w:pPr/w:rPr` — that formats the paragraph MARK only
   * (ECMA-376 §17.3.1.36). Folding mark `w:sz` into content made BodyText runs with no
   * direct size paint at the mark's size (Selection Notice "or" alternative → 6.5pt).
   */
  readonly runProperties: readonly OoxmlProperty[];
  /**
   * Content cascade plus direct `w:pPr/w:rPr` — empty-line metrics and last-line mark height.
   */
  readonly markRunProperties: readonly OoxmlProperty[];
  /**
   * The style this paragraph resolved to, or null when it names none and there is no
   * document default. `w:contextualSpacing` compares neighbours by exactly this.
   */
  readonly styleId: string | null;
}

function propertiesFingerprint(props: readonly OoxmlProperty[]): unknown {
  return props.map((property) =>
    property.attributes
      ? { n: property.localName, a: property.attributes }
      : { n: property.localName }
  );
}

/** Fixed-width semantic digest for nested style property material. */
function styleNodeFingerprint(node: OoxmlElement | undefined): string {
  return node ? stableHash(canonicalOoxmlFingerprint(node)) : '';
}

/** Conditional table formats are ordered as authored and bounded by the style reader. */
function conditionalTableFingerprint(
  style: StyleDefinition
): readonly (readonly [string, string])[] {
  return [...style.conditionalTableFormats].map(
    ([condition, node]) => [condition, styleNodeFingerprint(node)] as const
  );
}

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
  readonly tableRowPropertyNodes: readonly OoxmlElement[];
  readonly paragraphPropertyNodes: readonly OoxmlElement[];
  readonly paragraphProperties: readonly OoxmlProperty[];
  readonly runProperties: readonly OoxmlProperty[];
  readonly conditional: ReadonlyMap<string, OoxmlElement>;
}

export const EMPTY_TABLE_FORMATTING: CascadedTableFormatting = Object.freeze({
  tablePropertyNodes: Object.freeze([]) as readonly OoxmlElement[],
  tableRowPropertyNodes: Object.freeze([]) as readonly OoxmlElement[],
  paragraphPropertyNodes: Object.freeze([]) as readonly OoxmlElement[],
  paragraphProperties: Object.freeze([]) as readonly OoxmlProperty[],
  runProperties: Object.freeze([]) as readonly OoxmlProperty[],
  conditional: new Map<string, OoxmlElement>(),
});

/**
 * Resolve a `w:tblStyle` id against the cascade, base-first.
 *
 * An absent or unusable id falls to the document's default table style, the same way an
 * absent `w:pStyle` falls to the default paragraph style. Word's `TableNormal` is what
 * states the 0/108/0/108 twip cell margins, and a table that names no style still gets
 * them.
 */
export function cascadeTableFormatting(
  table: StyleCascadeTable,
  styleId: string | undefined
): CascadedTableFormatting {
  const named = styleId && isValidStyleId(styleId) ? styleId : null;
  const fromNamed = named ? cachedTableFormatting(table, named) : null;
  if (fromNamed) return fromNamed;
  // A `w:tblStyle` naming a style the part does not define is no statement at all, so it
  // falls to the default the same way an absent one does. Checked AFTER the chain rather
  // than before it: a well-formed id that resolves to nothing would otherwise keep the
  // borders, conditional formats and `w:tblCellMar` that `TableNormal` supplies.
  const fallback = table.defaultTableStyleId;
  if (!fallback || fallback === named) return EMPTY_TABLE_FORMATTING;
  return cachedTableFormatting(table, fallback) ?? EMPTY_TABLE_FORMATTING;
}

/**
 * One resolved chain per (cascade, style id), for the life of the cascade.
 *
 * Every table in a document that names the same style — and every table that names none,
 * which is now every one of them through the default — asks for the same answer. Flattening
 * the chain per table allocated five containers each and showed up as GC on a corpus pass.
 * The key space is bounded by the styles map, because an id that resolves to an empty chain
 * is never stored.
 */
const tableFormattingMemos = new WeakMap<StyleCascadeTable, Map<string, CascadedTableFormatting>>();

function cachedTableFormatting(
  table: StyleCascadeTable,
  styleId: string
): CascadedTableFormatting | null {
  let byId = tableFormattingMemos.get(table);
  if (!byId) {
    byId = new Map();
    tableFormattingMemos.set(table, byId);
  }
  const cached = byId.get(styleId);
  if (cached) return cached;
  const built = flattenTableStyleChain(table, styleId);
  if (!built) return null;
  byId.set(styleId, built);
  return built;
}

/** Flatten one style's `w:basedOn` chain, base-first. Null when the id resolves to nothing. */
function flattenTableStyleChain(
  table: StyleCascadeTable,
  styleId: string
): CascadedTableFormatting | null {
  const chain = styleChain(table, styleId, 'table');
  if (chain.length === 0) return null;
  const tablePropertyNodes: OoxmlElement[] = [];
  const tableRowPropertyNodes: OoxmlElement[] = [];
  const paragraphPropertyNodes: OoxmlElement[] = [];
  const paragraphProperties: OoxmlProperty[] = [];
  const runProperties: OoxmlProperty[] = [];
  const conditional = new Map<string, OoxmlElement>();
  for (const style of chain) {
    if (style.tablePropertiesNode) tablePropertyNodes.push(style.tablePropertiesNode);
    if (style.tableRowPropertiesNode) tableRowPropertyNodes.push(style.tableRowPropertiesNode);
    if (style.paragraphPropertiesNode) paragraphPropertyNodes.push(style.paragraphPropertiesNode);
    paragraphProperties.push(...style.paragraphProperties);
    runProperties.push(...style.runProperties);
    for (const [conditionType, node] of style.conditionalTableFormats) {
      conditional.set(conditionType, node);
    }
  }
  // Immutable because it is now SHARED by every table that names this style — and with the
  // default fallback, that is every table in the document. A consumer that mutated any of it
  // would rewrite the answer for all of them.
  //
  // `Object.freeze` does nothing to a `Map`: its contents live in internal slots, so a frozen
  // Map still takes `set` and `delete`. The static type says `ReadonlyMap`, which is the
  // guarantee the other four members get from `Object.freeze` for real, so the map is handed
  // out through a view that has no mutators to reach for.
  return Object.freeze({
    tablePropertyNodes: Object.freeze(tablePropertyNodes) as readonly OoxmlElement[],
    tableRowPropertyNodes: Object.freeze(tableRowPropertyNodes) as readonly OoxmlElement[],
    paragraphPropertyNodes: Object.freeze(paragraphPropertyNodes) as readonly OoxmlElement[],
    paragraphProperties: Object.freeze(paragraphProperties) as readonly OoxmlProperty[],
    runProperties: Object.freeze(runProperties) as readonly OoxmlProperty[],
    conditional: readonlyMapView(conditional),
  });
}

/**
 * A `ReadonlyMap` that is one at RUNTIME, not only to the type checker.
 *
 * Reads delegate to the source map; there is no `set`, `delete` or `clear` to find on the
 * object at all, so a consumer that casts the type away still cannot write through it.
 */
function readonlyMapView<K, V>(source: Map<K, V>): ReadonlyMap<K, V> {
  const view = Object.freeze({
    get: (key: K) => source.get(key),
    has: (key: K) => source.has(key),
    forEach: (callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) => {
      for (const [key, value] of source) callback.call(thisArg, value, key, view);
    },
    keys: () => source.keys(),
    values: () => source.values(),
    entries: () => source.entries(),
    [Symbol.iterator]: () => source[Symbol.iterator](),
    [Symbol.toStringTag]: 'Map',
    get size() {
      return source.size;
    },
  }) as ReadonlyMap<K, V>;
  return view;
}

/**
 * Does this style contribute anything a CELL's paragraphs read?
 *
 * `tableCellStyleFormatting` reads only the paragraph, run and conditional material — never
 * `tablePropertyNodes` — so a style that carries `w:tblPr` alone (Word's `TableNormal` is
 * exactly that) can answer for every condition set without being asked. Callers use this to
 * keep the `EMPTY_TABLE_CELL_STYLE_FORMATTING` short circuit they used to get from an
 * identity check against {@link EMPTY_TABLE_FORMATTING}.
 */
export function tableStyleAffectsCells(formatting: CascadedTableFormatting): boolean {
  return (
    formatting.paragraphPropertyNodes.length > 0 ||
    formatting.paragraphProperties.length > 0 ||
    formatting.runProperties.length > 0 ||
    formatting.conditional.size > 0
  );
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
  themeFonts: ThemeFonts = NO_THEME_FONTS,
  settingsRoot: OoxmlElement | null = null
): StyleCascadeTable {
  const typography = cjkTypographyFromSettings(settingsRoot);
  const styles = new Map<string, StyleDefinition>();
  if (!stylesRoot) {
    return {
      // Still keyed on the theme: a document with no styles part can carry a theme, and
      // its runs resolve `+Body` through it.
      cacheToken: stableHash({ empty: true, theme: themeFonts, typography }),
      typography,
      docDefaultsRun: [],
      docDefaultsParagraph: [],
      docDefaultsParagraphNode: undefined,
      defaultParagraphStyleId: null,
      defaultCharacterStyleId: null,
      defaultTableStyleId: null,
      themeFonts,
      styles,
    };
  }

  const defaults = readDocDefaults(stylesRoot);
  let defaultParagraphStyleId: string | null = null;
  let defaultCharacterStyleId: string | null = null;
  let defaultTableStyleId: string | null = null;
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
    } else if (style.type === 'table') {
      if (isDefault) defaultTableStyleId = style.styleId;
      else if (defaultTableStyleId === style.styleId) defaultTableStyleId = null;
    }
  }

  // Canonical material hashed once — never embed the full styles dump in paragraph keys.
  const cacheToken = stableHash({
    typography,
    dR: propertiesFingerprint(defaults.run),
    dP: propertiesFingerprint(defaults.paragraph),
    defP: defaultParagraphStyleId,
    defC: defaultCharacterStyleId,
    defT: defaultTableStyleId,
    // Retheming changes the face every theme-fonted run measures in while no style
    // material moves, so a break cached under the old theme must not be reused.
    theme: themeFonts,
    styles: [...styles.values()].map((style) => ({
      id: style.styleId,
      type: style.type,
      basedOn: style.basedOn,
      outlineLevel: style.outlineLevel,
      p: propertiesFingerprint(style.paragraphProperties),
      r: propertiesFingerprint(style.runProperties),
      // Table layout reads nested property nodes that the flat p/r lists above do not
      // describe. In particular, a styled tblHeader changes pagination without touching
      // the document table node, so all three table-style layers belong in the producer.
      tPr: styleNodeFingerprint(style.tablePropertiesNode),
      trPr: styleNodeFingerprint(style.tableRowPropertiesNode),
      tblStylePr: conditionalTableFingerprint(style),
    })),
  });

  return {
    cacheToken,
    typography,
    docDefaultsRun: defaults.run,
    docDefaultsParagraph: defaults.paragraph,
    docDefaultsParagraphNode: defaults.paragraphNode,
    defaultParagraphStyleId,
    defaultCharacterStyleId,
    defaultTableStyleId,
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
  const markProps = propertiesOf(directMarkRun);

  // Content runs: defaults → table → paragraph style. Mark `w:pPr/w:rPr` is NOT content.
  //
  // THREE LEVELS, not one flat list. §17.7.3 combines a toggle property as
  // `val_table XOR val_paragraph XOR val_character` over the document defaults, and a whole
  // `basedOn` chain is ONE of those values. The character level joins in
  // `cascadeRunProperties`; what comes out here is the table and paragraph levels resolved
  // against the defaults, which is also the answer for a run that names no character style.
  const runProperties = combineStyleToggles([
    { properties: table.docDefaultsRun, role: 'defaults', emit: true },
    { properties: tableCellStyle?.runProperties ?? [], role: 'xor', emit: true },
    { properties: chain.flatMap((style) => style.runProperties), role: 'xor', emit: true },
  ]);
  // The paragraph MARK is the same cascade with the mark's own `w:pPr/w:rPr` on top, and that
  // `w:rPr` is DIRECT formatting for the mark — absolute, either way it is stated.
  //
  // Combined rather than concatenated so the result carries its resolved toggle state like
  // any other cascade output. `list-resolve.ts` resolves a numbering marker from this list,
  // and a plain concatenation is a fresh array with nothing attached: the marker would fall
  // back to reading the properties and could answer differently from the text of the very
  // paragraph it belongs to.
  const markRunProperties: readonly OoxmlProperty[] =
    markProps.length === 0
      ? runProperties
      : combineStyleToggles([
          { properties: runProperties, role: 'carried', emit: true },
          { properties: markProps, role: 'direct', emit: true },
        ]);

  return {
    paragraphProperties,
    inheritedParagraphProperties,
    paragraphPropertyNodes,
    runProperties,
    markRunProperties,
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
 *
 * PASS `inheritedRunProperties` BY IDENTITY. It must be an array
 * {@link cascadeParagraphFormatting} returned — `runProperties` or `markRunProperties` — and
 * not a copy of one. A toggle property (ECMA-376 §17.7.3) resolves per level of the style
 * hierarchy, and the levels below the character style resolve to more than a true or a false:
 * whether the document defaults' short circuit is still standing decides what the character
 * style's own toggle does next, and no single `w:b` element can spell that. The paragraph
 * cascade attaches that state to the array it returns, so spreading, filtering or sorting the
 * list drops it. (`Object.freeze` returns the same object, so that one is safe.) A list
 * without it is read as one ordinary level, which is the most a bare property list can say
 * and is what a caller assembling its own list gets.
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
  // Nothing to combine and nothing to append: hand back the SAME array.
  //
  // Read this for CORRECTNESS, not speed. The identity of the input is what carries the
  // resolved toggle state (see the note on this function), so building a new array here would
  // drop it and send the caller down the bare-property-list path. The saving is only an
  // allocation, and a modest one: paragraph layout keys are content-based (`propertiesToken`
  // joins the properties, `layout-cache.ts`) so no cache entry is missed either way, and the
  // dominant caller — `runPropertiesOf` in `field-run-text.ts`, once per content run — copies
  // the result immediately regardless. This line is unchanged from before the toggle cascade;
  // what is new is that it now has to stay.
  if (characterProps.length === 0 && directRunProperties.length === 0) {
    return inheritedRunProperties;
  }
  const styleProperties =
    characterProps.length === 0
      ? inheritedRunProperties
      : // `inheritedRunProperties` arrives from `cascadeParagraphFormatting` CARRYING the
        // state the defaults, table and paragraph levels resolved to, so it is adopted rather
        // than combined, and the character chain is the one level left to apply.
        //
        // The document defaults are still listed first, for the caller that hands over a list
        // this module did not build: it has no carried state, so it reads as one level, and
        // the defaults are the only way §17.7.3's short circuit reaches it at all.
        //
        // EMPTY inherited list means the paragraph cascade never ran, and then there is no
        // short circuit to apply: the defaults level is left out entirely. `note-pagination`
        // resolves a note mark from its character style alone and passes `[]` for exactly
        // that reason. Injecting the defaults there would apply HALF of them — the toggles,
        // because they combine here, and not `w:sz` or `w:rFonts`, because they do not — so a
        // footnote reference mark in a document whose `docDefaults` declare `<w:b/>` would
        // come back bold at the wrong size. Either all of the defaults or none of them, and
        // none is what that caller has always had.
        //
        // `emit: false` says their ORDINARY properties do not join the result, because a
        // non-empty inherited level already carries them.
        combineStyleToggles([
          ...(inheritedRunProperties.length > 0
            ? ([
                { properties: table?.docDefaultsRun ?? [], role: 'defaults', emit: false },
              ] as const)
            : []),
          { properties: inheritedRunProperties, role: 'carried', emit: true },
          { properties: characterProps, role: 'xor', emit: true },
        ]);
  if (directRunProperties.length === 0) return styleProperties;
  return [...styleProperties, ...directRunProperties];
}

/** Everything the line breaker needs about one paragraph, already cascaded and converted. */
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
  /** Resolved outline level, with 9/invalid values treated as body text. */
  readonly outlineLevel: number | null;
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
  /**
   * Paragraph-mark cascade (`inheritedRunProperties` + direct `w:pPr/w:rPr`).
   * Empty-line sizing and last-line mark height — never content-run face.
   */
  readonly markRunProperties: readonly OoxmlProperty[];
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
 *
 * `inTableCell` is asked for separately because a cell paragraph may have no table style to
 * inherit at all, and `w:beforeAutospacing` still needs to know it is in a cell.
 */
export function resolveParagraphLayoutInputs(
  paragraph: OoxmlElement,
  contentWidth: number,
  styleCascade: StyleCascadeTable | undefined,
  listItem?: import('./list-resolve.ts').ResolvedListItem,
  tableCellStyle?: TableCellStyleFormatting,
  inTableCell = false
): ParagraphLayoutInputs {
  const pPr = findParagraphProperties(paragraph);
  const cascaded = styleCascade
    ? cascadeParagraphFormatting(styleCascade, pPr, tableCellStyle)
    : null;
  const props = cascaded ? [...cascaded.paragraphProperties] : propertiesOf(pPr);
  // Content vs mark: with a styles table, `cascaded.runProperties` is content-only and
  // `markRunProperties` carries direct `w:pPr/w:rPr`. Without styles, there is no style
  // face to inherit — content stays empty and the mark props size empty lines alone.
  const markOnly = propertiesOf(findRunProperties(pPr && isElement(pPr) ? pPr : undefined));
  const inheritedRunProperties = cascaded ? cascaded.runProperties : [];
  const markRunProperties = cascaded ? cascaded.markRunProperties : markOnly;
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
        hanging = h !== null ? Math.max(0, twipsToPoints(h)) : 0;
        // `w:firstLine` is DECLARED unsigned, but Word's model keeps one SIGNED first-line
        // indent and the numbering reader already reads it that way (`numbering-index.ts`).
        // Flattening a negative to zero here rendered a body paragraph flush where Word
        // renders a hanging, and made the two readers disagree about the same attribute.
        firstLine = f !== null ? twipsToPoints(f) : 0;
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
  const styleId = cascaded ? cascaded.styleId : (styleIdFromProps(props, 'pStyle') ?? null);
  let outlineLevel: number | null = null;
  let sawOutlineProperty = false;
  for (const property of props) {
    if (property.localName !== 'outlineLvl') continue;
    sawOutlineProperty = true;
    const value = property.attributes?.val;
    outlineLevel = value !== undefined && /^[0-8]$/.test(value) ? Number(value) : null;
  }
  if (!sawOutlineProperty && styleCascade && styleId) {
    const chain = styleChain(styleCascade, styleId, 'paragraph');
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const inherited = chain[index]!.outlineLevel;
      if (inherited !== null) {
        outlineLevel = inherited;
        break;
      }
    }
  }
  // Built-in Heading styles remain semantic even when a producer omits styles.xml (or names
  // one without defining it). Keep this in the core record substrate so Markdown, PDF and
  // future exporters agree. An explicit outlineLvl=9/invalid above deliberately blocks it.
  if (!sawOutlineProperty && outlineLevel === null && styleId) {
    const builtIn = /^heading\s*([1-9])$/i.exec(styleId.trim());
    if (builtIn) outlineLevel = Number(builtIn[1]) - 1;
  }
  return {
    props,
    indent,
    available: Math.max(1, contentWidth - indent.left - indent.right),
    alignment: paragraphAlignment(props),
    spacing: paragraphSpacing(props, { inList: listItem !== undefined, inTableCell }),
    lineSpacing: paragraphLineSpacing(props),
    contextualSpacing: paragraphContextualSpacing(props),
    styleId,
    outlineLevel,
    bottomBorder: cascaded
      ? cascadedBottomBorder(cascaded.paragraphPropertyNodes)
      : paragraphBorders(pPr).bottom,
    borders: cascaded
      ? cascadedParagraphBorders(cascaded.paragraphPropertyNodes)
      : paragraphBorders(pPr),
    shading: paragraphShading(props),
    inheritedRunProperties,
    markRunProperties,
    tabStops,
    tabStopsCacheToken: tabStopsFingerprint(tabStops),
    ...(listItem ? { listItem } : {}),
  };
}
