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
 * id, shared with the same other lists; every other revised list is added under new ids, so it
 * never reads as an original list with the same number, and two revised lists that number
 * apart still do.
 */
import { serializeOoxmlPart, type OoxmlPackage, type OoxmlPart } from '@docx-editor.dev/core/store';
import type { StoryOutput } from './stories.ts';
import { freeIds, referencedIds } from './free-ids.ts';
import { attributeOf, childNamed, elementChildren, type ElementNode } from './xml-fragments.ts';
import { freePartName, relatedPart, wordprocessingType } from './related-parts.ts';

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

/** The styles or numbering part the main document relates to; content types decide nothing. */
const partOfType = (pkg: OoxmlPackage, kind: 'styles' | 'numbering'): OoxmlPart | undefined =>
  relatedPart(pkg, kind);

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

/**
 * A copied list definition without the identities the original may share: its list identity
 * (`w:nsid`), its durable id, and the style links that belong to the original's styles.
 */
const asCopy = (xml: string) =>
  withoutPictureBullets(xml)
    .replace(/<(?:[\w.-]+:)?(?:nsid|styleLink|numStyleLink)\b[^>]*\/>/g, '')
    .replace(/\s[\w.-]+:durableId="[^"]*"/g, '');

function newPart(pkg: OoxmlPackage, xml: string, source: OoxmlPart, kind: string): StoryOutput {
  void source;
  return {
    partName: freePartName(pkg, `/word/${kind}.xml`),
    contentType: wordprocessingType(kind),
    xml,
    isNew: true,
    relType: `${REL_BASE}/${kind}`,
  };
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LIST_REFERENCES = new Set(['numId']);
const DEFINITION_REFERENCES = new Set(['abstractNumId']);
const STYLE_REFERENCES = new Set(['pStyle', 'rStyle', 'tblStyle', 'basedOn', 'next', 'link']);

function mergeStyles(
  base: OoxmlPackage,
  revised: OoxmlPackage,
  lists: ReadonlyMap<string, string>
): StoryOutput | null {
  const from = partOfType(revised, 'styles');
  if (!from) return null;
  const into = partOfType(base, 'styles');
  // A style the original names but does not define keeps its meaning too: a revised style must
  // not take it over, or original paragraphs would change look with no revision.
  const known = new Set<string | undefined>(referencedIds(base, STYLE_REFERENCES));
  for (const style of into ? elementChildren(into.root) : []) {
    if (style.localName === 'style') known.add(attributeOf(style, 'styleId'));
  }
  let added = '';
  for (const style of elementChildren(from.root)) {
    if (style.localName !== 'style') continue;
    const id = attributeOf(style, 'styleId');
    if (id === undefined || known.has(id)) continue;
    known.add(id);
    // The original's default styles stay the defaults.
    const shell = /^<[^>]*>/.exec(fragment(style))![0];
    const xml = fragment(style).replace(shell, shell.replace(/\s[\w.-]*:?default="[^"]*"/, ''));
    // A style that names a list names it by the revised id, which the output may have moved.
    added += withMappedNumbering(xml, lists);
  }
  if (!added) return null;
  // Without an original styles part the added styles go in a new one, with no document
  // defaults: the original keeps the look it had.
  if (!into)
    return newPart(base, `<w:styles xmlns:w="${W_NS}">${added}</w:styles>`, from, 'styles');
  return {
    partName: into.name,
    contentType: into.contentType,
    xml: insertBefore(into, [], added),
    isNew: false,
  };
}

/** Identity of a list definition: its levels, without its own ids or style links. */
function abstractKey(node: ElementNode): string {
  const levels = elementChildren(node).filter(
    (child) =>
      child.localName !== 'nsid' &&
      child.localName !== 'tmpl' &&
      child.localName !== 'styleLink' &&
      child.localName !== 'numStyleLink'
  );
  return levels.map(fragment).join('');
}

interface ListDefinitions {
  readonly abstracts: Map<string, ElementNode>;
  readonly nums: Map<string, ElementNode>;
  /** List style id to the list id its paragraph properties name. */
  readonly styleLists: Map<string, string>;
}

function listDefinitions(part: OoxmlPart, styles: OoxmlPart | undefined): ListDefinitions {
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
  const styleLists = new Map<string, string>();
  for (const style of styles ? elementChildren(styles.root) : []) {
    if (style.localName !== 'style') continue;
    const id = attributeOf(style, 'styleId');
    const pPr = childNamed(style, 'pPr');
    const numPr = pPr && childNamed(pPr, 'numPr');
    const numId = numPr && childNamed(numPr, 'numId');
    const value = numId && attributeOf(numId, 'val');
    if (id !== undefined && value !== undefined) styleLists.set(id, value);
  }
  return { abstracts, nums, styleLists };
}

const abstractIdOf = (num: ElementNode) =>
  attributeOf(childNamed(num, 'abstractNumId') ?? num, 'val');

/** List style links a definition may follow, in a chain. */
const MAX_STYLE_LINKS = 4;

/**
 * The definition a list instance numbers with: its own, or, when that one only links to a list
 * style (`w:numStyleLink`), the definition of the list that style names.
 */
function definitionOf(num: ElementNode, lists: ListDefinitions): string | undefined {
  let id = abstractIdOf(num);
  for (let hops = 0; id !== undefined && hops < MAX_STYLE_LINKS; hops++) {
    const abstract = lists.abstracts.get(id);
    const link = abstract && childNamed(abstract, 'numStyleLink');
    const style = link && attributeOf(link, 'val');
    const target = style === undefined ? undefined : lists.styleLists.get(style);
    const linked = target === undefined ? undefined : lists.nums.get(target);
    const next = linked && abstractIdOf(linked);
    if (next === undefined || next === id) return id;
    id = next;
  }
  return id;
}

/**
 * Identity of a list instance: its definition and its level overrides. Each definition is
 * serialized once, however many instances share it.
 */
function numKeys(lists: ListDefinitions): (num: ElementNode) => string {
  const keys = new Map<string, string>();
  return (num) => {
    const abstractId = definitionOf(num, lists) ?? '';
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

/** Hands out the smallest positive ids no definition uses yet. */
/** Groups instances by the definition they number with. */
function groups(lists: ListDefinitions): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [id, num] of lists.nums) {
    const definition = definitionOf(num, lists);
    if (definition === undefined) continue;
    const list = out.get(definition) ?? [];
    list.push(id);
    out.set(definition, list);
  }
  return out;
}

/**
 * Instances that share a revised definition share one output definition: the original's when
 * the whole group kept its ids, else one copy. Counters run per definition, so this keeps
 * lists that number together together and lists that number apart apart.
 */
function mergeNumbering(
  base: OoxmlPackage,
  revised: OoxmlPackage
): { readonly map: Map<string, string>; readonly output: StoryOutput | null } {
  const map = new Map<string, string>();
  const from = partOfType(revised, 'numbering');
  const into = partOfType(base, 'numbering');
  if (!from) {
    // The revised document defines no lists, so none of its list references numbers anything.
    for (const id of into ? listDefinitions(into, undefined).nums.keys() : []) map.set(id, '0');
    return { map, output: null };
  }
  const ours: ListDefinitions = into
    ? listDefinitions(into, partOfType(base, 'styles'))
    : { abstracts: new Map(), nums: new Map(), styleLists: new Map() };
  const theirs = listDefinitions(from, partOfType(revised, 'styles'));
  const ourKey = numKeys(ours);
  const theirKey = numKeys(theirs);
  const ourGroups = groups(ours);
  // Revised definition id to the output definition id its instances use.
  const definitions = new Map<string, string>();
  const kept = new Set<string>();
  for (const [definition, ids] of groups(theirs)) {
    let target: string | undefined;
    const keeps = ids.every((id) => {
      const same = ours.nums.get(id);
      if (!same || ourKey(same) !== theirKey(theirs.nums.get(id)!)) return false;
      const ourDefinition = definitionOf(same, ours);
      target ??= ourDefinition;
      return ourDefinition === target;
    });
    // The original's group may hold more instances, but none the revised document groups apart.
    const together =
      target !== undefined &&
      (ourGroups.get(target) ?? []).every((id) => !theirs.nums.has(id) || ids.includes(id));
    if (!keeps || !together || target === undefined) continue;
    for (const id of ids) kept.add(id);
    definitions.set(definition, target);
  }
  // Like list ids: an instance in the original may name a definition it does not hold.
  const nextAbstract = freeIds([
    ...ours.abstracts.keys(),
    ...referencedIds(base, DEFINITION_REFERENCES),
  ]);
  // A new id never takes one the original names without defining it: those paragraphs number
  // nothing and must keep numbering nothing.
  const nextNum = freeIds([
    ...ours.nums.keys(),
    ...theirs.nums.keys(),
    ...referencedIds(base, LIST_REFERENCES),
  ]);
  let abstracts = '';
  let nums = '';
  for (const [id, num] of theirs.nums) {
    if (kept.has(id)) continue;
    const definition = definitionOf(num, theirs);
    const abstract = definition === undefined ? undefined : theirs.abstracts.get(definition);
    if (!abstract || definition === undefined) {
      // An instance without a definition numbers nothing.
      map.set(id, '0');
      continue;
    }
    let target = definitions.get(definition);
    if (target === undefined) {
      target = nextAbstract();
      definitions.set(definition, target);
      abstracts += asCopy(fragment(abstract).replace(/(\babstractNumId=")[^"]*"/, `$1${target}"`));
    }
    const newId = nextNum();
    nums += asCopy(
      fragment(num)
        .replace(/(\bnumId=")[^"]*"/, `$1${newId}"`)
        .replace(/(<(?:[\w.-]+:)?abstractNumId\b[^>]*?\s(?:[\w.-]+:)?val=")[^"]*"/, `$1${target}"`)
    );
    map.set(id, newId);
  }
  // A revised reference to a list the revised document does not define numbers nothing; it
  // must not pick up the original's list with that id.
  for (const id of ours.nums.keys()) if (!theirs.nums.has(id) && !map.has(id)) map.set(id, '0');
  if (!abstracts && !nums) return { map, output: null };
  if (!into) {
    const xml = `<w:numbering xmlns:w="${W_NS}">${abstracts}${nums}</w:numbering>`;
    return { map, output: newPart(base, xml, from, 'numbering') };
  }
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
