/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Styles and lists that content taken from the revised document needs.
 *
 * The output keeps the original's definitions. A style only the revised document defines is
 * added. A revised list keeps its id only when the original has the same definition under that
 * id; every other revised list is added under new ids, so it never reads as an original list
 * with the same number, and two revised lists that look alike still number apart.
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

/** Picture bullets name pictures the output does not copy; the levels fall back to text. */
const withoutPictureBullets = (xml: string) =>
  xml
    .replace(/<(?:[\w.-]+:)?numPicBullet\b[\s\S]*?<\/(?:[\w.-]+:)?numPicBullet>/g, '')
    .replace(/<(?:[\w.-]+:)?lvlPicBulletId\b[^>]*\/>/g, '');

function newPart(pkg: OoxmlPackage, xml: string, source: OoxmlPart, kind: string): StoryOutput {
  let name = `/word/${kind}.xml`;
  for (let n = 2; pkg.parts.has(name) || pkg.partBytes.has(name.slice(1)); n++)
    name = `/word/${kind}${n}.xml`;
  return {
    partName: name,
    contentType: source.contentType,
    xml,
    isNew: true,
    relType: `${REL_BASE}/${kind}`,
  };
}

function mergeStyles(
  base: OoxmlPackage,
  revised: OoxmlPackage,
  lists: ReadonlyMap<string, string>
): StoryOutput | null {
  const from = partOfType(revised, '.styles+xml');
  if (!from) return null;
  const into = partOfType(base, '.styles+xml');
  // A style that names a list names it by the revised id, which the output may have moved.
  if (!into) {
    const xml = withMappedNumbering(fragment(from.root as ElementNode), lists);
    return newPart(base, xml, from, 'styles');
  }
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
    added += withMappedNumbering(fragment(style), lists);
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

const abstractIdOf = (num: ElementNode) =>
  attributeOf(childNamed(num, 'abstractNumId') ?? num, 'val');

/**
 * Identity of a list instance: its definition and its level overrides. Each definition is
 * serialized once, however many instances share it.
 */
function numKeys(lists: ListDefinitions): (num: ElementNode) => string {
  const keys = new Map<string, string>();
  return (num) => {
    const abstractId = abstractIdOf(num) ?? '';
    let key = keys.get(abstractId);
    if (key === undefined) {
      const abstract = lists.abstracts.get(abstractId);
      key = abstract ? abstractKey(abstract) : `missing:${abstractId}`;
      keys.set(abstractId, key);
    }
    const overrides = elementChildren(num)
      .filter((child) => child.localName !== 'abstractNumId')
      .map(fragment)
      .join('');
    return `${key}\u0001${overrides}`;
  };
}

const maxId = (ids: Iterable<string>) => {
  let max = 0;
  for (const id of ids) {
    const n = Number(id);
    if (Number.isSafeInteger(n) && n > max) max = n;
  }
  return max;
};

/**
 * Instances that share a revised definition share its copy, or the original's definition when
 * one of them kept its id, so they keep numbering together.
 */
function mergeNumbering(
  base: OoxmlPackage,
  revised: OoxmlPackage
): { readonly map: Map<string, string>; readonly output: StoryOutput | null } {
  const map = new Map<string, string>();
  const from = partOfType(revised, '.numbering+xml');
  if (!from) return { map, output: null };
  const into = partOfType(base, '.numbering+xml');
  if (!into) {
    const xml = withoutPictureBullets(fragment(from.root as ElementNode));
    return { map, output: newPart(base, xml, from, 'numbering') };
  }
  const ours = listDefinitions(into);
  const theirs = listDefinitions(from);
  const ourKey = numKeys(ours);
  const theirKey = numKeys(theirs);
  // Revised definition id to the output definition id its instances use.
  const definitions = new Map<string, string>();
  const kept = new Set<string>();
  for (const [id, num] of theirs.nums) {
    const same = ours.nums.get(id);
    if (!same || ourKey(same) !== theirKey(num)) continue;
    kept.add(id);
    const abstractId = abstractIdOf(num);
    const target = abstractIdOf(same);
    if (abstractId !== undefined && target !== undefined && !definitions.has(abstractId))
      definitions.set(abstractId, target);
  }
  let nextAbstract = maxId(ours.abstracts.keys()) + 1;
  let nextNum = maxId(ours.nums.keys()) + 1;
  let abstracts = '';
  let nums = '';
  for (const [id, num] of theirs.nums) {
    if (kept.has(id)) continue;
    const abstractId = abstractIdOf(num);
    const abstract = abstractId === undefined ? undefined : theirs.abstracts.get(abstractId);
    if (!abstract || abstractId === undefined) continue;
    let target = definitions.get(abstractId);
    if (target === undefined) {
      target = String(nextAbstract++);
      definitions.set(abstractId, target);
      abstracts += withoutPictureBullets(
        fragment(abstract).replace(/(\babstractNumId=")[^"]*"/, `$1${target}"`)
      );
    }
    const newId = String(nextNum++);
    nums += fragment(num)
      .replace(/(\bnumId=")[^"]*"/, `$1${newId}"`)
      .replace(/(<(?:[\w.-]+:)?abstractNumId\b[^>]*?\s(?:[\w.-]+:)?val=")[^"]*"/, `$1${target}"`);
    map.set(id, newId);
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
  return [mergeStyles(base, revised, numbering.map), numbering.output].filter(
    (output): output is StoryOutput => output !== null
  );
}
