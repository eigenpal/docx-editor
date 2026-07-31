// Layout-side paragraph style cascade (styles.xml → semantic layout).
//
// The canonical tree keeps `w:pStyle` and direct `rPr`/`pPr` as authored. Layout is the
// place that expands a style id into measurable run and paragraph properties: Word paints
// headings from the styles part when runs carry no direct formatting.
//
// Bounds everywhere: style ids are length/control validated, `basedOn` walks are depth- and
// cycle-capped, duplicate style ids keep the LAST definition (Word), and property values are
// still sanitised by `resolveRunStyle` / `paragraphSpacing` / `paragraphBorders` /
// `paragraphShading`. This module never invents theme colours or fetches remote resources.

import type { OoxmlElement, OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core-contract/store';
import { isDangerousKey } from '../store/package/safe-record.ts';
import {
  paragraphAlignment,
  paragraphIndent,
  propertiesOf,
  type Alignment,
} from './paragraph-flow.ts';
import {
  paragraphBorders,
  paragraphSpacing,
  type ParagraphBorderEdge,
  type ParagraphSpacing,
} from './paragraph-style.ts';
import { paragraphShading } from './ooxml-shading.ts';
import {
  cascadedTabStops,
  paragraphTabStops,
  tabStopsFingerprint,
  type ResolvedTabStops,
} from './paragraph-tabs.ts';

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
}

export interface StyleCascadeTable {
  /**
   * Stable fingerprint folded into layout cache producers so a different styles part cannot
   * reuse breaks measured under another cascade.
   */
  readonly cacheToken: string;
  readonly docDefaultsRun: readonly OoxmlProperty[];
  readonly docDefaultsParagraph: readonly OoxmlProperty[];
  readonly docDefaultsParagraphNode: OoxmlElement | undefined;
  readonly styles: ReadonlyMap<string, StyleDefinition>;
}

export interface CascadedParagraphFormatting {
  /** Flat paragraph properties in cascade order (defaults → bases → style → direct). */
  readonly paragraphProperties: readonly OoxmlProperty[];
  /** Matching `w:pPr` nodes for nested border resolution. */
  readonly paragraphPropertyNodes: readonly OoxmlNode[];
  /** Inherited run properties for every run in the paragraph (before direct run `rPr`). */
  readonly runProperties: readonly OoxmlProperty[];
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

function propertiesToken(props: readonly OoxmlProperty[]): string {
  return props
    .map((property) => {
      const attrs = property.attributes
        ? Object.entries(property.attributes)
            .map(([key, value]) => `${key}=${value}`)
            .join(',')
        : '';
      return attrs ? `${property.localName}(${attrs})` : property.localName;
    })
    .join(';');
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

function findParagraphProperties(container: OoxmlElement | undefined): OoxmlElement | undefined {
  if (!container) return undefined;
  for (const child of container.children) {
    if (isElement(child) && (child.kind === 'paragraphProperties' || child.localName === 'pPr')) {
      return child;
    }
  }
  return undefined;
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
    run: propertiesOf(runNode),
    paragraph: propertiesOf(paragraphNode),
    paragraphNode,
  };
}

function readStyleDefinition(node: OoxmlElement): StyleDefinition | null {
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
  return {
    styleId,
    type,
    basedOn,
    paragraphProperties: propertiesOf(paragraphPropertiesNode),
    runProperties: propertiesOf(runPropertiesNode),
    paragraphPropertiesNode,
  };
}

/**
 * Build a cascade table from a styles part root.
 *
 * Only direct `w:style` children of the root participate (bounded count). Duplicate
 * `styleId` values keep the last definition, matching Word's reader for this fixture class.
 */
export function buildStyleCascadeTable(stylesRoot: OoxmlElement | null): StyleCascadeTable {
  const styles = new Map<string, StyleDefinition>();
  if (!stylesRoot) {
    return {
      cacheToken: 'empty',
      docDefaultsRun: [],
      docDefaultsParagraph: [],
      docDefaultsParagraphNode: undefined,
      styles,
    };
  }

  const defaults = readDocDefaults(stylesRoot);
  let counted = 0;
  for (const child of stylesRoot.children) {
    if (!isElement(child) || child.localName !== 'style') continue;
    if (counted >= MAX_STYLE_DEFINITIONS) break;
    counted += 1;
    const definition = readStyleDefinition(child);
    if (!definition) continue;
    // Last duplicate wins.
    styles.set(definition.styleId, definition);
  }

  const cacheToken = [
    `dR:${propertiesToken(defaults.run)}`,
    `dP:${propertiesToken(defaults.paragraph)}`,
    ...[...styles.values()].map(
      (style) =>
        `${style.styleId}@${style.type}>${style.basedOn ?? ''}|p:${propertiesToken(style.paragraphProperties)}|r:${propertiesToken(style.runProperties)}`
    ),
  ].join('/');

  return {
    cacheToken,
    docDefaultsRun: defaults.run,
    docDefaultsParagraph: defaults.paragraph,
    docDefaultsParagraphNode: defaults.paragraphNode,
    styles,
  };
}

function paragraphStyleId(directProps: readonly OoxmlProperty[]): string | null {
  let id: string | null = null;
  for (const property of directProps) {
    if (property.localName !== 'pStyle') continue;
    const value = property.attributes?.val;
    id = isValidStyleId(value) ? value : null;
  }
  return id;
}

/**
 * Resolve the `basedOn` chain base-first, stopping on missing ids, cycles, or depth.
 *
 * The tip must be a paragraph style; character/table styles named by `w:pStyle` contribute
 * nothing (Word ignores them for paragraph inheritance).
 */
function paragraphStyleChain(
  table: StyleCascadeTable,
  styleId: string
): readonly StyleDefinition[] {
  const tip = table.styles.get(styleId);
  if (!tip || tip.type !== 'paragraph') return [];

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
 * Order: `docDefaults` → `basedOn` ancestors → paragraph style → direct formatting.
 * Direct formatting is last so it overrides inherited values inside the existing resolvers.
 */
export function cascadeParagraphFormatting(
  table: StyleCascadeTable,
  directPPr: OoxmlNode | undefined
): CascadedParagraphFormatting {
  const directProps = propertiesOf(directPPr);
  const styleId = paragraphStyleId(directProps);
  const chain = styleId ? paragraphStyleChain(table, styleId) : [];

  const paragraphProperties: OoxmlProperty[] = [
    ...table.docDefaultsParagraph,
    ...chain.flatMap((style) => style.paragraphProperties),
    ...directProps,
  ];

  const paragraphPropertyNodes: OoxmlNode[] = [];
  if (table.docDefaultsParagraphNode) paragraphPropertyNodes.push(table.docDefaultsParagraphNode);
  for (const style of chain) {
    if (style.paragraphPropertiesNode) paragraphPropertyNodes.push(style.paragraphPropertiesNode);
  }
  if (directPPr) paragraphPropertyNodes.push(directPPr);

  const directMarkRun = findRunProperties(
    directPPr && isElement(directPPr) ? directPPr : undefined
  );

  const runProperties: OoxmlProperty[] = [
    ...table.docDefaultsRun,
    ...chain.flatMap((style) => style.runProperties),
    ...propertiesOf(directMarkRun),
  ];

  return { paragraphProperties, paragraphPropertyNodes, runProperties };
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

/** Merge inherited paragraph-style run props with a run's direct `rPr` (direct last). */
export function cascadeRunProperties(
  inheritedRunProperties: readonly OoxmlProperty[],
  directRunProperties: readonly OoxmlProperty[]
): readonly OoxmlProperty[] {
  if (inheritedRunProperties.length === 0) return directRunProperties;
  if (directRunProperties.length === 0) return inheritedRunProperties;
  return [...inheritedRunProperties, ...directRunProperties];
}

export interface ParagraphLayoutInputs {
  readonly props: OoxmlProperty[];
  readonly indent: { left: number; right: number; hanging: number; firstLine: number };
  readonly available: number;
  readonly alignment: Alignment;
  readonly spacing: ParagraphSpacing;
  readonly bottomBorder: ParagraphBorderEdge | undefined;
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
 */
export function resolveParagraphLayoutInputs(
  paragraph: OoxmlElement,
  contentWidth: number,
  styleCascade: StyleCascadeTable | undefined,
  listItem?: import('./list-resolve.ts').ResolvedListItem
): ParagraphLayoutInputs {
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  const cascaded = styleCascade ? cascadeParagraphFormatting(styleCascade, pPr) : null;
  const props = cascaded ? [...cascaded.paragraphProperties] : propertiesOf(pPr);
  const inheritedRunProperties = cascaded?.runProperties ?? [];
  const baseIndent = paragraphIndent(props);
  let hanging = 0;
  let firstLine = 0;
  if (listItem) {
    hanging = listItem.indent.hanging;
    firstLine = listItem.indent.firstLine;
  } else {
    for (const property of props) {
      if (property.localName !== 'ind') continue;
      const h = property.attributes?.hanging;
      const f = property.attributes?.firstLine;
      if (h && /^\d{1,9}$/.test(h)) hanging = Number(h) / 20;
      if (f && /^-?\d{1,9}$/.test(f)) firstLine = Math.max(0, Number(f) / 20);
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
    bottomBorder: cascaded
      ? cascadedBottomBorder(cascaded.paragraphPropertyNodes)
      : paragraphBorders(pPr).bottom,
    shading: paragraphShading(props),
    inheritedRunProperties,
    tabStops,
    tabStopsCacheToken: tabStopsFingerprint(tabStops),
    ...(listItem ? { listItem } : {}),
  };
}
