// Whether a tracked property change changes anything once the style hierarchy is applied.
//
// A `w:pPrChange` or `w:rPrChange` records the properties a paragraph or run had before an
// edit. When the earlier and the current properties resolve to the same formatting through the
// document defaults, the style chain and the numbering level, there is nothing to review: the
// file holds the record, but neither Accept nor Reject would change the document.
//
// The answer is CONSERVATIVE. Any input this module cannot compare with certainty reads as a
// real change: different style or numbering references, structured children such as tab stops
// or borders that differ, content in a table (its table style is not resolved here), or a
// numbering reference whose level cannot be resolved. A real change must never be hidden.

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '../store/package/ooxml-tree.ts';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { propertiesOf } from './paragraph-flow.ts';
import {
  buildStyleCascadeTable,
  cascadeParagraphWithNumbering,
  cascadeRunProperties,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { styleChain } from './style-chain.ts';
import { STYLE_TOGGLE_PROPERTIES } from './style-toggles.ts';
import {
  buildNumberingIndex,
  resolveNumberingLevel,
  type NumberingIndex,
} from './numbering-index.ts';
import { numberingParagraphProperties } from './numbering-paragraph-properties.ts';

/** The styles and numbering a document's property changes resolve against. */
export interface PropertyChangeContext {
  readonly table: StyleCascadeTable;
  readonly numbering: NumberingIndex;
}

const contexts = new WeakMap<object, WeakMap<object, PropertyChangeContext>>();
const NO_ROOT = {};

/** One context per pair of styles and numbering roots. */
export function propertyChangeContext(
  stylesRoot: OoxmlElement | null,
  numberingRoot: OoxmlElement | null
): PropertyChangeContext {
  const byStyles = contexts.get(stylesRoot ?? NO_ROOT) ?? new WeakMap();
  contexts.set(stylesRoot ?? NO_ROOT, byStyles);
  let context = byStyles.get(numberingRoot ?? NO_ROOT);
  if (!context) {
    context = {
      table: buildStyleCascadeTable(stylesRoot),
      numbering: buildNumberingIndex(numberingRoot),
    };
    byStyles.set(numberingRoot ?? NO_ROOT, context);
  }
  return context;
}

/** Children that are not the properties being compared. */
const PARAGRAPH_SKIPPED = new Set(['pPrChange', 'rPr', 'sectPr']);
const RUN_SKIPPED = new Set(['rPrChange', 'ins', 'del', 'moveFrom', 'moveTo']);

/** Properties whose attributes inherit one by one; every other element replaces as a whole. */
const ATTRIBUTE_MERGED = new Set(['ind', 'spacing', 'rFonts', 'lang']);

/** `CT_OnOff` properties: a false value is the same as no value at all. */
const ON_OFF = new Set<string>([
  'dstrike',
  'noProof',
  'snapToGrid',
  'webHidden',
  'specVanish',
  'rtl',
  'cs',
  'oMath',
  'keepNext',
  'keepLines',
  'pageBreakBefore',
  'suppressLineNumbers',
  'suppressAutoHyphens',
  'contextualSpacing',
  'mirrorIndents',
  'suppressOverlap',
  'bidi',
]);
for (const toggle of STYLE_TOGGLE_PROPERTIES) ON_OFF.add(toggle);
const FALSE_VALUES = new Set(['0', 'false', 'off']);

/** Values that mean the same as the property being absent once nothing above sets it. */
function isDefault(localName: string, attribute: string, value: string, bidi: boolean): boolean {
  if (ON_OFF.has(localName)) return attribute === 'val' && FALSE_VALUES.has(value);
  switch (localName) {
    case 'jc':
      return value === 'start' || (!bidi && value === 'left');
    case 'ind':
      return value === '0';
    case 'u':
    case 'highlight':
      return value === 'none';
    case 'vertAlign':
      return value === 'baseline';
    case 'color':
      return value === 'auto';
    case 'position':
      return value === '0';
    case 'w':
      return value === '100';
    default:
      return false;
  }
}

/** The resolved properties as a comparable string; later properties win. */
function resolvedKey(properties: readonly OoxmlProperty[], skipped: ReadonlySet<string>): string {
  const resolved = new Map<string, Record<string, string>>();
  for (const property of properties) {
    if (skipped.has(property.localName)) continue;
    const attributes: Record<string, string> = { ...property.attributes };
    if (ON_OFF.has(property.localName) && attributes.val === undefined) attributes.val = 'true';
    const previous = resolved.get(property.localName);
    resolved.set(
      property.localName,
      previous && ATTRIBUTE_MERGED.has(property.localName)
        ? { ...previous, ...attributes }
        : attributes
    );
  }
  const bidi = resolved.get('bidi');
  const isBidi = bidi !== undefined && !FALSE_VALUES.has(bidi.val ?? 'true');
  const entries: string[] = [];
  for (const [localName, attributes] of resolved) {
    const kept = Object.entries(attributes)
      .filter(([attribute, value]) => !isDefault(localName, attribute, value, isBidi))
      .sort(([a], [b]) => a.localeCompare(b));
    // An element with no attributes left said nothing beyond the default.
    if (kept.length === 0 && Object.keys(attributes).length > 0) continue;
    entries.push(`${localName}(${kept.map(([key, value]) => `${key}=${value}`).join(',')})`);
  }
  return entries.sort().join(' ');
}

function fingerprint(node: OoxmlNode, out: string[], depth: number): void {
  if (node.kind === 'textValue') {
    out.push(JSON.stringify(node.value));
    return;
  }
  if (depth > 32) {
    out.push('…');
    return;
  }
  const attributes = node.attributes
    .map((attribute) => `${attribute.namespaceUri ?? ''}|${attribute.localName}=${attribute.value}`)
    .sort();
  out.push(`<${node.namespaceUri ?? ''}|${node.localName} ${attributes.join(' ')}>`);
  for (const child of node.children) fingerprint(child, out, depth + 1);
  out.push('>');
}

/**
 * The children a flat property list cannot represent: elements with children of their own
 * (tab stops, borders, numbering references) and foreign elements. They must match exactly.
 */
function structuredChildren(properties: OoxmlElement | undefined, skipped: ReadonlySet<string>) {
  const out: string[] = [];
  for (const child of properties?.children ?? []) {
    if (child.kind === 'textValue') continue;
    const wml = child.namespaceUri === WML_NAMESPACE_URI;
    if (wml && skipped.has(child.localName)) continue;
    if (wml && !child.children.some((grandchild) => grandchild.kind !== 'textValue')) continue;
    fingerprint(child, out, 0);
  }
  return out.join('');
}

function styleReference(properties: readonly OoxmlProperty[], localName: string): string {
  let value = '';
  for (const property of properties) {
    if (property.localName === localName) value = property.attributes?.val ?? '';
  }
  return value;
}

function childElement(parent: OoxmlElement | undefined, localName: string) {
  for (const child of parent?.children ?? []) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

/**
 * The numbering level's `w:pPr` for a paragraph, `null` when it has no numbering, or
 * `undefined` when it names numbering this context cannot resolve.
 */
function numberingLevelProperties(
  context: PropertyChangeContext,
  paragraphProperties: OoxmlElement | undefined
): OoxmlElement | null | undefined {
  let numId: string | undefined;
  let ilvl: string | undefined;
  const read = (properties: OoxmlElement | undefined) => {
    const numPr = childElement(properties, 'numPr');
    const id = childElement(numPr, 'numId')?.attributes.find((a) => a.localName === 'val');
    const level = childElement(numPr, 'ilvl')?.attributes.find((a) => a.localName === 'val');
    if (id) numId = id.value;
    if (level) ilvl = level.value;
  };
  const styleId =
    styleReference(propertiesOf(paragraphProperties), 'pStyle') ||
    context.table.defaultParagraphStyleId;
  if (styleId) {
    for (const style of styleChain(context.table, styleId, 'paragraph')) {
      read(style.paragraphPropertiesNode);
    }
  }
  read(paragraphProperties);
  if (numId === undefined || numId === '0') return null;
  const level = resolveNumberingLevel(context.numbering, numId, Number(ilvl ?? '0'));
  return (level && numberingParagraphProperties(level.level)) ?? undefined;
}

function resolveParagraph(
  context: PropertyChangeContext,
  properties: OoxmlElement | undefined
): string | null {
  const level = numberingLevelProperties(context, properties);
  if (level === undefined) return null;
  const cascaded = cascadeParagraphWithNumbering(
    context.table,
    properties,
    undefined,
    level ?? undefined
  );
  return resolvedKey(cascaded.paragraphProperties, PARAGRAPH_SKIPPED);
}

/**
 * Whether a `w:pPrChange` leaves its paragraph formatted exactly as before.
 *
 * `current` is the paragraph's `w:pPr`, which holds `change`.
 */
export function paragraphChangeIsInert(
  context: PropertyChangeContext,
  change: OoxmlElement,
  current: OoxmlElement
): boolean {
  const previous = childElement(change, 'pPr');
  const currentProps = propertiesOf(current);
  const previousProps = propertiesOf(previous);
  if (styleReference(currentProps, 'pStyle') !== styleReference(previousProps, 'pStyle')) {
    return false;
  }
  if (
    structuredChildren(current, PARAGRAPH_SKIPPED) !==
    structuredChildren(previous, PARAGRAPH_SKIPPED)
  ) {
    return false;
  }
  const after = resolveParagraph(context, current);
  const before = resolveParagraph(context, previous);
  return after !== null && after === before;
}

/**
 * Whether a `w:rPrChange` leaves its run formatted exactly as before.
 *
 * `current` is the run's `w:rPr`, which holds `change`; `paragraph` is the containing
 * paragraph's `w:pPr`, whose style the run inherits from.
 */
export function runChangeIsInert(
  context: PropertyChangeContext,
  change: OoxmlElement,
  current: OoxmlElement,
  paragraph: OoxmlElement | undefined
): boolean {
  const previous = childElement(change, 'rPr');
  const currentProps = propertiesOf(current);
  const previousProps = propertiesOf(previous);
  if (styleReference(currentProps, 'rStyle') !== styleReference(previousProps, 'rStyle')) {
    return false;
  }
  if (structuredChildren(current, RUN_SKIPPED) !== structuredChildren(previous, RUN_SKIPPED)) {
    return false;
  }
  const level = numberingLevelProperties(context, paragraph);
  if (level === undefined) return false;
  const inherited = cascadeParagraphWithNumbering(
    context.table,
    paragraph,
    undefined,
    level ?? undefined
  ).runProperties;
  const resolve = (direct: readonly OoxmlProperty[]) =>
    resolvedKey(cascadeRunProperties(inherited, direct, context.table), RUN_SKIPPED);
  return resolve(currentProps) === resolve(previousProps);
}
