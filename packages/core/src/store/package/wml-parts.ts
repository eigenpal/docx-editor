// Secondary OPC part loaders (document-engine task 2.10: the `stories.ts` +
// `styles-numbering.ts` concern). Given the decoded package entry map, these read a
// SECONDARY part (relationships, header/footer/notes/comments stories, styles.xml,
// numbering.xml) into authored records. Element-to-model parsing itself lives in
// wml-parse; this module owns only the part discovery/relationship resolution around it.
// All values are untrusted; every read goes through the bounded XML reader.

import { readXml, findElement, childElements, type XmlNode } from './xml-reader.ts';
import { strFromU8 } from './zip.ts';
import { resolveInternalTarget } from './opc-names.ts';
import { el, collectParagraphElements, paragraphFromElement, parseRPr } from './wml-parse.ts';
import { IdentityAllocator } from '../model/identity.ts';
import {
  type ParagraphRecord,
  type StyleRecord,
  type NumberingRecord,
  type DocDefaults,
  type RunProps,
  type ThemeFonts,
  REL_TYPES,
} from '../model/index.ts';

/** Collect every `Relationship` element from a rels part's tree. */
function allRelationships(nodes: readonly XmlNode[]): Extract<XmlNode, { type: 'element' }>[] {
  const out: Extract<XmlNode, { type: 'element' }>[] = [];
  const walk = (ns: readonly XmlNode[]): void => {
    for (const n of ns) {
      if (!el(n)) continue;
      if (n.name === 'Relationship') out.push(n);
      else walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

// Related-story parts: rel-type suffix -> { model story kind, part root element,
// and (for note/comment collections) the per-item wrapper element }.
interface StorySpec {
  readonly kind: 'header' | 'footer' | 'footnote' | 'endnote' | 'comment';
  readonly root: string;
  readonly item?: string;
}
const STORY_SPECS: Record<string, StorySpec> = {
  '/header': { kind: 'header', root: 'w:hdr' },
  '/footer': { kind: 'footer', root: 'w:ftr' },
  '/footnotes': { kind: 'footnote', root: 'w:footnotes', item: 'w:footnote' },
  '/endnotes': { kind: 'endnote', root: 'w:endnotes', item: 'w:endnote' },
  '/comments': { kind: 'comment', root: 'w:comments', item: 'w:comment' },
};

/** Related-story parts referenced by document.xml's relationships (internal only). */
export function relatedStoryParts(
  entries: ReadonlyMap<string, Uint8Array>
): { partName: string; spec: StorySpec }[] {
  const relsPart = entries.get('/word/_rels/document.xml.rels');
  if (!relsPart) return [];
  const rx = readXml(strFromU8(relsPart));
  if (!rx.ok) return [];
  const out: { partName: string; spec: StorySpec }[] = [];
  for (const rel of allRelationships(rx.nodes)) {
    if (rel.attributes.TargetMode === 'External') continue;
    const type = rel.attributes.Type ?? '';
    const suffix = Object.keys(STORY_SPECS).find((s) => type.endsWith(s));
    if (!suffix) continue;
    const resolved = resolveInternalTarget('/word/document.xml', rel.attributes.Target ?? '');
    if (resolved.ok) out.push({ partName: resolved.partName, spec: STORY_SPECS[suffix] });
  }
  return out;
}

export function parseStoryParagraphs(
  root: Extract<XmlNode, { type: 'element' }>,
  alloc: IdentityAllocator
): ParagraphRecord[] {
  return collectParagraphElements(root).map((p) => paragraphFromElement(p, alloc));
}

const WML_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);
const STYLES_XML_MAX_BYTES = 8 * 1024 * 1024;
const STYLES_XML_MAX_ELEMENTS = 100_000;

function normalizeWmlNode(node: XmlNode, inherited: ReadonlyMap<string, string>): XmlNode {
  if (!el(node)) return node;
  const bindings = new Map(inherited);
  for (const [name, value] of Object.entries(node.attributes)) {
    if (name === 'xmlns') bindings.set('', value);
    else if (name.startsWith('xmlns:')) bindings.set(name.slice(6), value);
  }
  const normalizeName = (name: string, isAttribute: boolean): string => {
    const colon = name.indexOf(':');
    if (colon < 0)
      return !isAttribute && WML_NAMESPACES.has(bindings.get('') ?? '') ? `w:${name}` : name;
    const prefix = name.slice(0, colon);
    const local = name.slice(colon + 1);
    return WML_NAMESPACES.has(bindings.get(prefix) ?? '') ? `w:${local}` : name;
  };
  const attributes = Object.create(null) as Record<string, string>;
  for (const [name, value] of Object.entries(node.attributes))
    attributes[normalizeName(name, true)] = value;
  return {
    type: 'element',
    name: normalizeName(node.name, false),
    attributes,
    children: node.children.map((child) => normalizeWmlNode(child, bindings)),
  };
}

function stylesFromRoot(root: Extract<XmlNode, { type: 'element' }>): StyleRecord[] {
  const out: StyleRecord[] = [];
  for (const style of childElements(root, 'w:style') as Extract<XmlNode, { type: 'element' }>[]) {
    const id = style.attributes['w:styleId'];
    if (!id) continue;
    const t = style.attributes['w:type'];
    const type: StyleRecord['type'] =
      t === 'character' || t === 'table' || t === 'numbering' ? t : 'paragraph';
    const name = childElements(style, 'w:name')[0]?.attributes['w:val'] ?? id;
    const isDefault =
      style.attributes['w:default'] === '1' || style.attributes['w:default'] === 'true';
    const basedOn = childElements(style, 'w:basedOn')[0]?.attributes['w:val'];
    const rPr = childElements(style, 'w:rPr')[0];
    const runProps = rPr ? parseRPr(rPr) : undefined;
    out.push({
      id,
      name,
      type,
      ...(isDefault ? { isDefault: true } : {}),
      ...(basedOn ? { basedOn } : {}),
      ...(runProps && Object.keys(runProps).length > 0 ? { runProps } : {}),
    });
  }
  return out;
}

function defaultsFromRoot(root: Extract<XmlNode, { type: 'element' }>): DocDefaults | undefined {
  const docDefaults = childElements(root, 'w:docDefaults')[0];
  if (!docDefaults) return undefined;
  const rPrDefault = childElements(docDefaults, 'w:rPrDefault')[0];
  const rPr = rPrDefault ? childElements(rPrDefault, 'w:rPr')[0] : undefined;
  const runProps: RunProps | undefined = rPr ? parseRPr(rPr) : undefined;
  return runProps && Object.keys(runProps).length > 0 ? { runProps } : undefined;
}

export type StylesParseResult =
  | {
      readonly ok: true;
      readonly styles: StyleRecord[];
      readonly docDefaults?: DocDefaults;
    }
  | { readonly ok: false; readonly detail: string };

/** Parse styles/defaults once through a bounded, namespace-aware trust boundary. */
export function parseStylesAndDefaults(
  entries: ReadonlyMap<string, Uint8Array>
): StylesParseResult {
  const part = entries.get('/word/styles.xml');
  if (!part) return { ok: true, styles: [] };
  if (part.byteLength > STYLES_XML_MAX_BYTES)
    return { ok: false, detail: 'styles part exceeds byte ceiling' };
  const sx = readXml(strFromU8(part), {
    maxBytes: STYLES_XML_MAX_BYTES,
    maxElements: STYLES_XML_MAX_ELEMENTS,
  });
  if (!sx.ok) return { ok: false, detail: `invalid styles XML: ${sx.reason}` };
  const roots = sx.nodes.filter(el);
  if (roots.length !== 1)
    return { ok: false, detail: 'styles XML must have exactly one root element' };
  const root = normalizeWmlNode(roots[0], new Map());
  if (!el(root) || root.name !== 'w:styles')
    return { ok: false, detail: 'styles XML root is not WordprocessingML styles' };
  const docDefaults = defaultsFromRoot(root);
  return {
    ok: true,
    styles: stylesFromRoot(root),
    ...(docDefaults ? { docDefaults } : {}),
  };
}

/** Parse the document theme's major/minor Latin, East Asian, and complex-script
 * font families. Theme part discovery follows the main document relationship and
 * never resolves or fetches an external target. */
export type ThemeFontsParseResult =
  | { readonly ok: true; readonly fonts?: ThemeFonts }
  | { readonly ok: false; readonly detail: string };

const DRAWINGML_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://purl.oclc.org/ooxml/drawingml/main',
]);
const THEME_XML_MAX_BYTES = 1024 * 1024;
const THEME_XML_MAX_ELEMENTS = 10_000;

type XmlElement = Extract<XmlNode, { type: 'element' }>;

function buildNamespaceIndex(root: XmlElement): WeakMap<XmlElement, string | undefined> {
  const index = new WeakMap<XmlElement, string | undefined>();
  const walk = (current: XmlElement, inherited: ReadonlyMap<string, string>): void => {
    const bindings = new Map(inherited);
    for (const [name, value] of Object.entries(current.attributes)) {
      if (name === 'xmlns') bindings.set('', value);
      else if (name.startsWith('xmlns:')) bindings.set(name.slice(6), value);
    }
    const colon = current.name.indexOf(':');
    const prefix = colon < 0 ? '' : current.name.slice(0, colon);
    index.set(current, bindings.get(prefix));
    for (const child of current.children) if (el(child)) walk(child, bindings);
  };
  walk(root, new Map());
  return index;
}

function elementLocalName(node: XmlElement): string {
  const colon = node.name.indexOf(':');
  return colon < 0 ? node.name : node.name.slice(colon + 1);
}

function namespaceDescendants(
  node: XmlElement,
  index: WeakMap<XmlElement, string | undefined>,
  localName: string
): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (current: XmlElement): void => {
    if (
      DRAWINGML_NAMESPACES.has(index.get(current) ?? '') &&
      elementLocalName(current) === localName
    )
      out.push(current);
    for (const child of current.children) if (el(child)) walk(child);
  };
  walk(node);
  return out;
}

function directNamespaceChildren(
  node: XmlElement,
  index: WeakMap<XmlElement, string | undefined>,
  localName: string
): XmlElement[] {
  return node.children.filter(
    (child): child is XmlElement =>
      el(child) &&
      DRAWINGML_NAMESPACES.has(index.get(child) ?? '') &&
      elementLocalName(child) === localName
  );
}

export function parseThemeFonts(entries: ReadonlyMap<string, Uint8Array>): ThemeFontsParseResult {
  const relsPart = entries.get('/word/_rels/document.xml.rels');
  if (!relsPart) return { ok: true };
  const rx = readXml(strFromU8(relsPart));
  if (!rx.ok) return { ok: false, detail: `invalid document relationships: ${rx.reason}` };
  const relationships = allRelationships(rx.nodes).filter((rel) => {
    const type = rel.attributes.Type;
    return type === REL_TYPES.theme || type === REL_TYPES.themeStrict;
  });
  if (relationships.length === 0) return { ok: true };
  if (relationships.length !== 1)
    return { ok: false, detail: 'document has duplicate theme relationships' };
  const relationship = relationships[0];
  const targetMode = relationship.attributes.TargetMode;
  if (targetMode === 'External') return { ok: true };
  if (targetMode !== undefined)
    return { ok: false, detail: `invalid theme TargetMode: ${targetMode}` };
  const target = relationship.attributes.Target;
  if (!target) return { ok: false, detail: 'internal theme relationship has no target' };
  const resolved = resolveInternalTarget('/word/document.xml', target);
  if (!resolved.ok)
    return { ok: false, detail: `invalid internal theme target: ${resolved.reason}` };
  const partName = resolved.partName;
  const part = entries.get(partName);
  if (!part) return { ok: false, detail: `missing internal theme part: ${partName}` };
  if (part.byteLength > THEME_XML_MAX_BYTES)
    return { ok: false, detail: 'theme part exceeds byte ceiling' };
  const tx = readXml(strFromU8(part), {
    maxBytes: THEME_XML_MAX_BYTES,
    maxElements: THEME_XML_MAX_ELEMENTS,
  });
  if (!tx.ok) return { ok: false, detail: `invalid theme XML: ${tx.reason}` };
  const roots = tx.nodes.filter(el);
  if (roots.length !== 1) return { ok: false, detail: 'theme XML must have one root element' };
  const namespaceIndex = buildNamespaceIndex(roots[0]);
  const schemes = namespaceDescendants(roots[0], namespaceIndex, 'fontScheme');
  if (schemes.length !== 1)
    return { ok: false, detail: 'theme XML must have exactly one fontScheme' };
  const scheme = schemes[0];
  const majors = directNamespaceChildren(scheme, namespaceIndex, 'majorFont');
  const minors = directNamespaceChildren(scheme, namespaceIndex, 'minorFont');
  if (majors.length !== 1 || minors.length !== 1)
    return { ok: false, detail: 'theme fontScheme must have one majorFont and one minorFont' };
  const typeface = (group: XmlElement, childName: string): string | undefined => {
    const children = directNamespaceChildren(group, namespaceIndex, childName);
    if (children.length > 1) throw new Error(`duplicate theme ${childName}`);
    return children[0]?.attributes.typeface || undefined;
  };
  let fonts: ThemeFonts;
  try {
    const majorLatin = typeface(majors[0], 'latin');
    const minorLatin = typeface(minors[0], 'latin');
    const majorEastAsia = typeface(majors[0], 'ea');
    const minorEastAsia = typeface(minors[0], 'ea');
    const majorComplexScript = typeface(majors[0], 'cs');
    const minorComplexScript = typeface(minors[0], 'cs');
    fonts = {
      ...(majorLatin !== undefined ? { majorLatin } : {}),
      ...(minorLatin !== undefined ? { minorLatin } : {}),
      ...(majorEastAsia !== undefined ? { majorEastAsia } : {}),
      ...(minorEastAsia !== undefined ? { minorEastAsia } : {}),
      ...(majorComplexScript !== undefined ? { majorComplexScript } : {}),
      ...(minorComplexScript !== undefined ? { minorComplexScript } : {}),
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'invalid theme fonts' };
  }
  return Object.keys(fonts).length > 0 ? { ok: true, fonts } : { ok: true };
}

/** Parse word/numbering.xml into authored numbering records (task 2.7). */
export function parseNumbering(entries: ReadonlyMap<string, Uint8Array>): NumberingRecord[] {
  const part = entries.get('/word/numbering.xml');
  if (!part) return [];
  const sx = readXml(strFromU8(part));
  if (!sx.ok) return [];
  const root = findElement(sx.nodes, 'w:numbering');
  if (!root) return [];
  const out: NumberingRecord[] = [];
  for (const num of childElements(root, 'w:num') as Extract<XmlNode, { type: 'element' }>[]) {
    const numId = num.attributes['w:numId'];
    if (!numId) continue;
    const abstractId = childElements(num, 'w:abstractNumId')[0]?.attributes['w:val'] ?? '';
    out.push({ numId, abstractId });
  }
  return out;
}

// ---- structural table parsing (the layout/render projection; losslessness on
// save comes from the verbatim range, so this need not model every property) ----
