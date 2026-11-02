/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Styles and lists that content taken from the revised document needs.
 *
 * The output keeps the original's definitions. A style only the revised document defines is
 * added. A revised list whose definition the original has under some id takes that id; any
 * other revised list is added under new ids, so it never reads as an original list with the
 * same number.
 */
import { serializeOoxmlPart, type OoxmlPackage, type OoxmlPart } from '@docx-editor.dev/core/store';
import type { StoryOutput } from './stories.ts';
import { attributeOf, childNamed, elementChildren, type ElementNode } from './xml-fragments.ts';

const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Revised list ids (`w:numId`) to output list ids, per revised package. */
const NUMBERING_MAPS = new WeakMap<OoxmlPackage, ReadonlyMap<string, string>>();

/** The output list id for a revised list id, for the revised side's serialization. */
export function numberingMapOf(pkg: OoxmlPackage): ReadonlyMap<string, string> | undefined {
  return NUMBERING_MAPS.get(pkg);
}

const NUM_ID_VALUE = /(<(?:[\w.-]+:)?numId\b[^>]*?\s(?:[\w.-]+:)?val=")([^"]*)(")/g;

/** `xml` with revised list ids replaced by output list ids. */
export function withMappedNumbering(xml: string, map: ReadonlyMap<string, string>): string {
  if (map.size === 0 || !xml.includes('numId')) return xml;
  return xml.replace(NUM_ID_VALUE, (whole, lead: string, id: string, end: string) => {
    const mapped = map.get(id);
    return mapped === undefined ? whole : `${lead}${mapped}${end}`;
  });
}

function partOfType(pkg: OoxmlPackage, suffix: string): OoxmlPart | undefined {
  for (const part of pkg.parts.values()) if (part.contentType.endsWith(suffix)) return part;
  return undefined;
}

/** An element serialized on its own, with the declarations it needs. */
function fragment(node: ElementNode): string {
  return serializeOoxmlPart({
    id: 'fragment',
    name: '/fragment.xml',
    contentType: 'application/xml',
    root: node,
  } as OoxmlPart).replace(/^<\?xml[^>]*\?>\s*/, '');
}

/**
 * `text` (a serialized part) with `xml` inserted before the first child named one of `before`,
 * or before the root's end tag.
 */
function insertBeforeIn(text: string, before: readonly string[], xml: string): string {
  // An empty root is written self-closing: open it.
  const empty = /^<([^\s/>]+)([^>]*)\/>\s*$/.exec(text);
  if (empty) return `<${empty[1]}${empty[2]}>${xml}</${empty[1]}>`;
  const at =
    before.length > 0
      ? new RegExp(`<(?:[\\w.-]+:)?(?:${before.join('|')})[\\s/>]`).exec(text)
      : null;
  const index = at ? at.index : text.lastIndexOf('</');
  return text.slice(0, index) + xml + text.slice(index);
}

const insertBefore = (part: OoxmlPart, before: readonly string[], xml: string) =>
  insertBeforeIn(fragment(part.root as ElementNode), before, xml);

function newPart(pkg: OoxmlPackage, source: OoxmlPart, kind: string): StoryOutput {
  let name = `/word/${kind}.xml`;
  for (let n = 2; pkg.parts.has(name) || pkg.partBytes.has(name.slice(1)); n++)
    name = `/word/${kind}${n}.xml`;
  return {
    partName: name,
    contentType: source.contentType,
    xml: fragment(source.root as ElementNode),
    isNew: true,
    relType: `${REL_BASE}/${kind}`,
  };
}

function mergeStyles(base: OoxmlPackage, revised: OoxmlPackage): StoryOutput | null {
  const from = partOfType(revised, '.styles+xml');
  if (!from) return null;
  const into = partOfType(base, '.styles+xml');
  if (!into) return newPart(base, from, 'styles');
  const known = new Set(
    elementChildren(into.root)
      .filter((style) => style.localName === 'style')
      .map((style) => attributeOf(style, 'styleId'))
  );
  let added = '';
  for (const style of elementChildren(from.root)) {
    if (style.localName !== 'style') continue;
    const id = attributeOf(style, 'styleId');
    if (id === undefined || known.has(id)) continue;
    known.add(id);
    added += fragment(style);
  }
  if (!added) return null;
  return {
    partName: into.name,
    contentType: into.contentType,
    xml: insertBefore(into, [], added),
    isNew: false,
  };
}

/** Identity of a list definition: its levels, without its own ids. */
function abstractKey(node: ElementNode): string {
  const levels = elementChildren(node).filter(
    (child) => child.localName !== 'nsid' && child.localName !== 'tmpl'
  );
  return levels.map(fragment).join('');
}

interface ListDefinitions {
  readonly abstracts: Map<string, ElementNode>;
  readonly nums: Map<string, ElementNode>;
}

function listDefinitions(part: OoxmlPart): ListDefinitions {
  const abstracts = new Map<string, ElementNode>();
  const nums = new Map<string, ElementNode>();
  for (const child of elementChildren(part.root)) {
    if (child.localName === 'abstractNum') {
      const id = attributeOf(child, 'abstractNumId');
      if (id !== undefined) abstracts.set(id, child);
    } else if (child.localName === 'num') {
      const id = attributeOf(child, 'numId');
      if (id !== undefined) nums.set(id, child);
    }
  }
  return { abstracts, nums };
}

/** Identity of a list instance: its definition and its level overrides. */
function numKey(num: ElementNode, lists: ListDefinitions): string {
  const abstractId = attributeOf(childNamed(num, 'abstractNumId') ?? num, 'val');
  const abstract = abstractId === undefined ? undefined : lists.abstracts.get(abstractId);
  const overrides = elementChildren(num)
    .filter((child) => child.localName !== 'abstractNumId')
    .map(fragment)
    .join('');
  return `${abstract ? abstractKey(abstract) : `missing:${abstractId}`}\u0001${overrides}`;
}

const maxId = (ids: Iterable<string>) =>
  Math.max(0, ...[...ids].map(Number).filter((n) => Number.isSafeInteger(n) && n >= 0));

function mergeNumbering(
  base: OoxmlPackage,
  revised: OoxmlPackage
): { readonly map: Map<string, string>; readonly output: StoryOutput | null } {
  const map = new Map<string, string>();
  const from = partOfType(revised, '.numbering+xml');
  if (!from) return { map, output: null };
  const into = partOfType(base, '.numbering+xml');
  if (!into) return { map, output: newPart(base, from, 'numbering') };
  const ours = listDefinitions(into);
  const theirs = listDefinitions(from);
  const byKey = new Map<string, string>();
  for (const [id, num] of ours.nums) {
    const key = numKey(num, ours);
    if (!byKey.has(key)) byKey.set(key, id);
  }
  let nextAbstract = maxId(ours.abstracts.keys()) + 1;
  let nextNum = maxId(ours.nums.keys()) + 1;
  const copiedAbstracts = new Map<string, string>();
  let abstracts = '';
  let nums = '';
  for (const [id, num] of theirs.nums) {
    const key = numKey(num, theirs);
    const same = ours.nums.get(id);
    if (same && numKey(same, ours) === key) continue;
    const existing = byKey.get(key);
    if (existing !== undefined) {
      map.set(id, existing);
      continue;
    }
    const abstractId = attributeOf(childNamed(num, 'abstractNumId') ?? num, 'val');
    const abstract = abstractId === undefined ? undefined : theirs.abstracts.get(abstractId);
    if (!abstract || abstractId === undefined) continue;
    let copied = copiedAbstracts.get(abstractId);
    if (copied === undefined) {
      copied = String(nextAbstract++);
      copiedAbstracts.set(abstractId, copied);
      abstracts += fragment(abstract)
        .replace(/(\babstractNumId=")[^"]*"/, `$1${copied}"`)
        // Picture bullets name the revised document's pictures, which are not copied.
        .replace(/<(?:[\w.-]+:)?lvlPicBulletId\b[^>]*\/>/g, '');
    }
    const newId = String(nextNum++);
    nums += fragment(num)
      .replace(/(\bnumId=")[^"]*"/, `$1${newId}"`)
      .replace(/(<(?:[\w.-]+:)?abstractNumId\b[^>]*?\s(?:[\w.-]+:)?val=")[^"]*"/, `$1${copied}"`);
    map.set(id, newId);
    byKey.set(key, newId);
  }
  if (!abstracts && !nums) return { map, output: null };
  let xml = insertBefore(into, ['num', 'numIdMacAtCleanup'], abstracts);
  xml = insertBeforeIn(xml, ['numIdMacAtCleanup'], nums);
  return {
    map,
    output: { partName: into.name, contentType: into.contentType, xml, isNew: false },
  };
}

/**
 * Plans the styles and lists the output adds, and registers the revised list id map that the
 * revised side's serialization applies. Call before any revised content is serialized.
 */
export function mergeDefinitions(base: OoxmlPackage, revised: OoxmlPackage): StoryOutput[] {
  const numbering = mergeNumbering(base, revised);
  NUMBERING_MAPS.set(revised, numbering.map);
  return [mergeStyles(base, revised), numbering.output].filter(
    (output): output is StoryOutput => output !== null
  );
}
