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
export function relatedStoryParts(entries: ReadonlyMap<string, Uint8Array>): { partName: string; spec: StorySpec }[] {
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

export function parseStoryParagraphs(root: Extract<XmlNode, { type: 'element' }>, alloc: IdentityAllocator): ParagraphRecord[] {
  return collectParagraphElements(root).map((p) => paragraphFromElement(p, alloc));
}

/** Parse word/styles.xml into authored style records (task 2.7). */
export function parseStyles(entries: ReadonlyMap<string, Uint8Array>): StyleRecord[] {
  const part = entries.get('/word/styles.xml');
  if (!part) return [];
  const sx = readXml(strFromU8(part));
  if (!sx.ok) return [];
  const root = findElement(sx.nodes, 'w:styles');
  if (!root) return [];
  const out: StyleRecord[] = [];
  for (const style of childElements(root, 'w:style') as Extract<XmlNode, { type: 'element' }>[]) {
    const id = style.attributes['w:styleId'];
    if (!id) continue;
    const t = style.attributes['w:type'];
    const type: StyleRecord['type'] = t === 'character' || t === 'table' || t === 'numbering' ? t : 'paragraph';
    const name = childElements(style, 'w:name')[0]?.attributes['w:val'] ?? id;
    const isDefault = style.attributes['w:default'] === '1' || style.attributes['w:default'] === 'true';
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

/** Parse word/styles.xml's w:docDefaults into document-wide default formatting — the
 *  lowest layer of style resolution. Resolution-only; never authored onto content. */
export function parseDocDefaults(entries: ReadonlyMap<string, Uint8Array>): DocDefaults | undefined {
  const part = entries.get('/word/styles.xml');
  if (!part) return undefined;
  const sx = readXml(strFromU8(part));
  if (!sx.ok) return undefined;
  const root = findElement(sx.nodes, 'w:styles');
  if (!root) return undefined;
  const docDefaults = childElements(root, 'w:docDefaults')[0];
  if (!docDefaults) return undefined;
  const rPrDefault = childElements(docDefaults, 'w:rPrDefault')[0];
  const rPr = rPrDefault ? childElements(rPrDefault, 'w:rPr')[0] : undefined;
  const runProps: RunProps | undefined = rPr ? parseRPr(rPr) : undefined;
  if (!runProps || Object.keys(runProps).length === 0) return undefined;
  return { runProps };
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
