// The copy lane's small self-contained style cascade over the FRAGMENT's own styles
// part — split from clipboard-html-write.ts at the max-lines cap. Toggle properties
// resolve per ECMA-376 §17.7.3, matching layout/style-cascade.ts.

import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import { relationshipsOf } from '../store/package/package-edit.ts';
import { resolveInternalTarget } from '../store/package/opc-names.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';
import { MAX_STYLE_BASED_ON_DEPTH } from '../layout/style-cascade.ts';
import { isElement, wmlChild, wmlVal } from './clipboard-html-write-tree.ts';

const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
// The layout cascade's own depth cap, so copy output resolves the same chains the
// painter does.
const MAX_STYLE_CHAIN = MAX_STYLE_BASED_ON_DEPTH;

export interface StyleIndex {
  readonly byId: ReadonlyMap<string, OoxmlElement>;
  readonly docDefaultsRPr: OoxmlElement | null;
  readonly docDefaultsPPr: OoxmlElement | null;
  readonly defaultParagraphStyleId: string | null;
}

export function relatedPart(
  pkg: OoxmlPackage,
  relType: string,
  fallback: string
): OoxmlElement | null {
  for (const record of relationshipsOf(pkg, pkg.mainDocumentPart)) {
    if (record.type !== relType || record.targetMode === 'External') continue;
    const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
    if (resolved.ok) {
      const part = pkg.parts.get(resolved.partName);
      if (part && isElement(part.root)) return part.root;
    }
  }
  const part = pkg.parts.get(fallback);
  return part && isElement(part.root) ? part.root : null;
}

export function styleIndexOf(pkg: OoxmlPackage): StyleIndex {
  const root = relatedPart(pkg, STYLES_REL, '/word/styles.xml');
  const byId = new Map<string, OoxmlElement>();
  let docDefaultsRPr: OoxmlElement | null = null;
  let docDefaultsPPr: OoxmlElement | null = null;
  let defaultParagraphStyleId: string | null = null;
  if (!root) return { byId, docDefaultsRPr, docDefaultsPPr, defaultParagraphStyleId };
  for (const child of root.children) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName === 'docDefaults') {
      docDefaultsRPr = wmlChild(wmlChild(child, 'rPrDefault'), 'rPr');
      docDefaultsPPr = wmlChild(wmlChild(child, 'pPrDefault'), 'pPr');
      continue;
    }
    if (child.localName !== 'style') continue;
    const id = attributeValueOf(child, 'styleId', WML_NAMESPACE_URI);
    if (!id) continue;
    byId.set(id, child);
    const isDefault = attributeValueOf(child, 'default', WML_NAMESPACE_URI);
    const type = attributeValueOf(child, 'type', WML_NAMESPACE_URI);
    if ((isDefault === '1' || isDefault === 'true') && type === 'paragraph') {
      defaultParagraphStyleId = id;
    }
  }
  return { byId, docDefaultsRPr, docDefaultsPPr, defaultParagraphStyleId };
}

/** The `basedOn` chain, base style FIRST, cycle-capped. */
export function styleChain(index: StyleIndex, styleId: string | undefined): OoxmlElement[] {
  const chain: OoxmlElement[] = [];
  const seen = new Set<string>();
  let current = styleId;
  while (current && !seen.has(current) && chain.length < MAX_STYLE_CHAIN) {
    seen.add(current);
    const style = index.byId.get(current);
    if (!style) break;
    chain.unshift(style);
    current = wmlVal(wmlChild(style, 'basedOn'));
  }
  return chain;
}

/**
 * Ordered property sources, lowest precedence first: docDefaults, the default paragraph
 * style chain, the paragraph style chain, the run style chain, then direct formatting.
 */
export function paragraphPropertySources(
  index: StyleIndex,
  ownPPr: OoxmlElement | null
): OoxmlElement[] {
  const sources: OoxmlElement[] = [];
  if (index.docDefaultsPPr) sources.push(index.docDefaultsPPr);
  // The default (Normal) style applies ONLY when the paragraph names no pStyle —
  // the same rule layout/style-cascade.ts follows. A named style not basedOn
  // Normal must not inherit Normal's formatting.
  const ownStyleId = wmlVal(wmlChild(ownPPr, 'pStyle'));
  for (const style of styleChain(index, ownStyleId ?? index.defaultParagraphStyleId ?? undefined)) {
    const pPr = wmlChild(style, 'pPr');
    if (pPr) sources.push(pPr);
  }
  if (ownPPr) sources.push(ownPPr);
  return sources;
}

/** Run property sources grouped by cascade level, so toggles can XOR per level. */
export interface RunPropertyLayers {
  /** Every source lowest-precedence first, for the non-toggle folds. */
  readonly all: readonly OoxmlElement[];
  readonly defaults: readonly OoxmlElement[];
  readonly paragraphLevel: readonly OoxmlElement[];
  readonly characterLevel: readonly OoxmlElement[];
  readonly direct: OoxmlElement | null;
}

export function runPropertyLayers(
  index: StyleIndex,
  paragraphPPr: OoxmlElement | null,
  ownRPr: OoxmlElement | null
): RunPropertyLayers {
  const defaults: OoxmlElement[] = [];
  if (index.docDefaultsRPr) defaults.push(index.docDefaultsRPr);
  const paragraphLevel: OoxmlElement[] = [];
  // Same rule as paragraphPropertySources: Normal applies only without a pStyle.
  const paragraphStyleId = wmlVal(wmlChild(paragraphPPr, 'pStyle'));
  for (const style of styleChain(
    index,
    paragraphStyleId ?? index.defaultParagraphStyleId ?? undefined
  )) {
    const rPr = wmlChild(style, 'rPr');
    if (rPr) paragraphLevel.push(rPr);
  }
  const characterLevel: OoxmlElement[] = [];
  for (const style of styleChain(index, wmlVal(wmlChild(ownRPr, 'rStyle')))) {
    const rPr = wmlChild(style, 'rPr');
    if (rPr) characterLevel.push(rPr);
  }
  const all = [...defaults, ...paragraphLevel, ...characterLevel];
  if (ownRPr) all.push(ownRPr);
  return { all, defaults, paragraphLevel, characterLevel, direct: ownRPr };
}

/** The last source carrying the named property child wins. */
export function lastProperty(
  sources: readonly OoxmlElement[],
  localName: string
): OoxmlElement | null {
  let found: OoxmlElement | null = null;
  for (const source of sources) {
    const child = wmlChild(source, localName);
    if (child) found = child;
  }
  return found;
}

/** Fold one attribute across every source carrying the property (per-attribute later-wins). */
export function foldAttribute(
  sources: readonly OoxmlElement[],
  propertyName: string,
  attributeName: string
): string | undefined {
  let value: string | undefined;
  for (const source of sources) {
    const child = wmlChild(source, propertyName);
    if (!child) continue;
    const attr = attributeValueOf(child, attributeName, WML_NAMESPACE_URI);
    if (attr !== undefined) value = attr;
  }
  return value;
}

/** Plain boolean semantics: the last source carrying the property wins.
 *  For paragraph booleans and non-toggle run booleans (`w:rtl`). */
export function toggleOn(sources: readonly OoxmlElement[], localName: string): boolean {
  let state = false;
  for (const source of sources) {
    const child = wmlChild(source, localName);
    if (!child) continue;
    const val = wmlVal(child);
    state = !(val === '0' || val === 'false' || val === 'none');
  }
  return state;
}

/** The resolved value of a toggle within ONE style level, or undefined when unset. */
function toggleLevelValue(
  sources: readonly OoxmlElement[],
  localName: string
): boolean | undefined {
  let value: boolean | undefined;
  for (const source of sources) {
    const child = wmlChild(source, localName);
    if (!child) continue;
    const val = wmlVal(child);
    value = !(val === '0' || val === 'false' || val === 'none');
  }
  return value;
}

/** ECMA-376 §17.7.3 toggle semantics, matching `layout/style-cascade.ts`: direct
 *  formatting is absolute; otherwise the docDefaults base XORs with each style
 *  LEVEL (paragraph, character) that resolves the toggle to true. */
export function runToggleOn(layers: RunPropertyLayers, localName: string): boolean {
  const direct = layers.direct ? wmlChild(layers.direct, localName) : null;
  if (direct) {
    const val = wmlVal(direct);
    return !(val === '0' || val === 'false' || val === 'none');
  }
  let on = toggleLevelValue(layers.defaults, localName) ?? false;
  if (toggleLevelValue(layers.paragraphLevel, localName) === true) on = !on;
  if (toggleLevelValue(layers.characterLevel, localName) === true) on = !on;
  return on;
}
