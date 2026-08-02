// Creating a list definition, and the `numbering.xml` part to hold it.
//
// Toggling a bullet or numbered list is not a property edit: `w:numPr` names a `w:num`,
// which names a `w:abstractNum`, which is where the nine levels and their formats live.
// A document Word has never numbered has no `numbering.xml` at all, so the part, its
// relationship and its content-type override all have to be created before the first
// bullet can exist.
//
// Everything here is ENGINE-AUTHORED — none of it is file-derived — so the XML is built
// from literals and validated ids rather than interpolated from anything an attacker
// controls.

import { strFromU8, strToU8 } from 'fflate';
import { createNodeIdAllocator, insertChildren } from './ooxml-edit.ts';
import { readOoxmlPart } from './ooxml-tree.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import type { RelationshipRecord } from './relationships.ts';
import { readXml, type XmlNode } from './xml-reader.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NUMBERING_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const NUMBERING_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const CONTENT_TYPES_PART = '/[Content_Types].xml';
const NUMBERING_PART = '/word/numbering.xml';

/** The two list kinds a toolbar offers. */
export type ListKind = 'bullet' | 'ordered';

/**
 * Word's own bullet glyphs and fonts, by level, cycling every three.
 *
 * The codepoints are the SYMBOL-FONT ones Word writes, not their Unicode lookalikes:
 * U+F0B7 in Symbol and U+F0A7 in Wingdings, both in the private-use range those legacy
 * fonts map through. Writing `•` (U+2022) and `§` (U+00A7) instead produced a file whose
 * glyphs differ from Word's the moment the named font is present, because the font maps
 * F0xx, not the Unicode character with the same picture.
 */
const BULLETS = [
  { text: '\uF0B7', font: 'Symbol' },
  { text: 'o', font: 'Courier New' },
  { text: '\uF0A7', font: 'Wingdings' },
] as const;

/** Word's own numbering formats, by level, cycling every three. */
const NUMBER_FORMATS = ['decimal', 'lowerLetter', 'lowerRoman'] as const;

/** Nine levels, the count `w:ilvl` allows (ECMA-376 17.9.24). */
const LEVEL_COUNT = 9;

/**
 * One `w:lvl`, with its children in `CT_Lvl` order.
 *
 * ORDER IS LOAD-BEARING — do not "tidy" it. `CT_Lvl` (ECMA-376 17.9.6) is a strict
 * `xsd:sequence`: `start, numFmt, lvlRestart, pStyle, isLgl, suff, lvlText,
 * lvlPicBulletId, lvlJc, pPr, rPr`. This used to emit `numFmt, lvlText, start, lvlJc, pPr`,
 * which puts `w:start` two slots late and `w:lvlText` ahead of its own predecessors — so
 * every list this engine created was schema-invalid. Word calls such a `numbering.xml`
 * unreadable content, repairs the file, and drops the part and every list with it.
 *
 * `w:lvlJc="left"` and `w:ind w:left=` are the TRANSITIONAL spellings Word writes. The
 * schema copy under `reference/` is ISO 29500 Strict, where those same slots read
 * `start`/`end`; that is a namespace difference, not a defect here.
 */
function levelXml(kind: ListKind, ilvl: number): string {
  // 0.25" per level, with the marker in a 0.25" hanging slot — Word's own list geometry.
  const left = 720 * (ilvl + 1);
  const start = '<w:start w:val="1"/>';
  // Everything from `w:lvlJc` on: the tail of the sequence, shared by both kinds.
  const tail =
    `<w:lvlJc w:val="left"/>` + `<w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr>`;
  if (kind === 'bullet') {
    const bullet = BULLETS[ilvl % BULLETS.length]!;
    return (
      `<w:lvl w:ilvl="${ilvl}">${start}<w:numFmt w:val="bullet"/>` +
      `<w:lvlText w:val="${bullet.text}"/>${tail}` +
      `<w:rPr><w:rFonts w:ascii="${bullet.font}" w:hAnsi="${bullet.font}" w:hint="default"/></w:rPr>` +
      '</w:lvl>'
    );
  }
  const format = NUMBER_FORMATS[ilvl % NUMBER_FORMATS.length]!;
  // `%N` is the placeholder for level N+1's counter; each level shows only its own.
  return (
    `<w:lvl w:ilvl="${ilvl}">${start}<w:numFmt w:val="${format}"/>` +
    `<w:lvlText w:val="%${ilvl + 1}."/>${tail}</w:lvl>`
  );
}

function abstractNumXml(kind: ListKind, abstractNumId: number): string {
  const levels = Array.from({ length: LEVEL_COUNT }, (_, ilvl) => levelXml(kind, ilvl)).join('');
  return (
    `<w:abstractNum w:abstractNumId="${abstractNumId}">` +
    `<w:multiLevelType w:val="${kind === 'bullet' ? 'hybridMultilevel' : 'multilevel'}"/>` +
    `${levels}</w:abstractNum>`
  );
}

/** An empty `numbering.xml`, for a document that has never carried a list. */
function emptyNumberingPart(): OoxmlPart | null {
  const read = readOoxmlPart(`<w:numbering xmlns:w="${W}"></w:numbering>`, {
    name: NUMBERING_PART,
    contentType: NUMBERING_CONTENT_TYPE,
  });
  return read.ok ? read.part : null;
}

const childrenNamed = (node: OoxmlElement, localName: string): OoxmlElement[] => {
  const found: OoxmlElement[] = [];
  for (const child of node.children) {
    if (child.kind === 'textValue' || child.localName !== localName) continue;
    found.push(child as OoxmlElement);
  }
  return found;
};

const attribute = (node: OoxmlElement, localName: string): string | undefined =>
  node.attributes.find((entry) => entry.localName === localName)?.value;

/**
 * `CT_Numbering`'s child sequence (ECMA-376 17.9.16). ORDER IS LOAD-BEARING.
 *
 * `numPicBullet*, abstractNum*, num*, numIdMacAtCleanup?` is a strict `xsd:sequence`, so a
 * new child's position is fixed by the SEQUENCE, not by where its own kind happens to end.
 */
const CT_NUMBERING_SEQUENCE = ['numPicBullet', 'abstractNum', 'num', 'numIdMacAtCleanup'];

/**
 * Where a new child of `localName` belongs among `children`, per a strict `xsd:sequence`.
 *
 * "After the last sibling of my own kind, or 0" is the rule this replaces, and it is wrong
 * twice over: on a part holding a `w:numPicBullet` the fallback put the first
 * `w:abstractNum` at index 0 — ahead of the picture bullet — and appending at the end put
 * `w:num` after `w:numIdMacAtCleanup`. Both make Word repair the file.
 *
 * The rule here is "after the last sibling whose slot is at or before mine". Whitespace and
 * elements the sequence does not model are TRANSPARENT: they neither move the insert nor
 * get reordered, because their position is not ours to decide. This is the same class of
 * fix `store/tree-op-properties.ts` made for `CT_PPr`; that module's rank/order helpers are
 * private to it and specific to a property container, so this is a local, four-name twin
 * rather than a shared abstraction.
 */
function sequenceInsertIndex(
  children: readonly OoxmlNode[],
  sequence: readonly string[],
  localName: string
): number {
  const rank = sequence.indexOf(localName);
  if (rank === -1) return children.length;
  let at = 0;
  children.forEach((child, index) => {
    if (child.kind === 'textValue') return;
    const childRank = sequence.indexOf(child.localName);
    if (childRank !== -1 && childRank <= rank) at = index + 1;
  });
  return at;
}

/** The largest existing id in a set, so a new one cannot collide. */
function nextFreeId(nodes: readonly OoxmlElement[], attributeName: string): number {
  let max = 0;
  for (const node of nodes) {
    const raw = attribute(node, attributeName);
    if (!raw || !/^\d{1,9}$/.test(raw)) continue;
    max = Math.max(max, Number(raw));
  }
  return max + 1;
}

export interface EnsuredListDefinition {
  readonly pkg: OoxmlPackage;
  /** The `w:numId` a paragraph's `w:numPr` should name. */
  readonly numId: string;
}

/**
 * Find or create a list definition of `kind`, returning the package that holds it.
 *
 * An existing definition of the same kind is REUSED rather than duplicated: Word does the
 * same, and a document that gains one `w:abstractNum` per toggled paragraph becomes
 * unreadable. Returns null only when the part cannot be built at all.
 */
export function ensureListDefinition(
  pkg: OoxmlPackage,
  kind: ListKind
): EnsuredListDefinition | null {
  const existingPart = pkg.parts.get(NUMBERING_PART);
  const numbering = existingPart ?? emptyNumberingPart();
  if (!numbering) return null;
  const root = numbering.root;

  const abstractNums = childrenNamed(root, 'abstractNum');
  const nums = childrenNamed(root, 'num');

  // Reuse: the first `w:num` whose abstract definition already formats this kind.
  const wantedFormat = kind === 'bullet' ? 'bullet' : 'decimal';
  for (const num of nums) {
    const numId = attribute(num, 'numId');
    const abstractRef = childrenNamed(num, 'abstractNumId')[0];
    const abstractId = abstractRef ? attribute(abstractRef, 'val') : undefined;
    if (!numId || !abstractId) continue;
    const abstract = abstractNums.find((node) => attribute(node, 'abstractNumId') === abstractId);
    if (!abstract) continue;
    const firstLevel = childrenNamed(abstract, 'lvl').find(
      (level) => attribute(level, 'ilvl') === '0' || attribute(level, 'ilvl') === undefined
    );
    const format = firstLevel ? childrenNamed(firstLevel, 'numFmt')[0] : undefined;
    if (format && attribute(format, 'val') === wantedFormat) return { pkg, numId };
  }

  const abstractNumId = nextFreeId(abstractNums, 'abstractNumId');
  const numId = nextFreeId(nums, 'numId');
  // The new definitions are authored as their own document, then GRAFTED under fresh ids.
  // `w:abstractNum` must precede every `w:num` (17.9.1), and Word's reader is strict about
  // it, so the two groups are inserted at their own boundaries rather than appended.
  const authored = readOoxmlPart(
    `<w:numbering xmlns:w="${W}">` +
      abstractNumXml(kind, abstractNumId) +
      `<w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractNumId}"/></w:num>` +
      '</w:numbering>',
    { name: NUMBERING_PART, contentType: NUMBERING_CONTENT_TYPE }
  );
  if (!authored.ok) return null;
  const nextId = createNodeIdAllocator(numbering);
  const [newAbstract, newNum] = authored.part.root.children.map((node) =>
    withFreshIds(node, nextId)
  );
  if (!newAbstract || !newNum) return null;

  // Each lands at its CT_NUMBERING_SEQUENCE slot — see `sequenceInsertIndex`. `w:num` is
  // positioned against the children the `w:abstractNum` insert produced, so the two agree.
  const withAbstract = insertChildren(
    numbering,
    root.id,
    sequenceInsertIndex(root.children, CT_NUMBERING_SEQUENCE, 'abstractNum'),
    [newAbstract]
  );
  if (!withAbstract.ok) return null;
  const withNum = insertChildren(
    withAbstract.part,
    root.id,
    sequenceInsertIndex(withAbstract.part.root.children, CT_NUMBERING_SEQUENCE, 'num'),
    [newNum]
  );
  if (!withNum.ok) return null;

  let next: OoxmlPackage = Object.freeze({
    ...pkg,
    parts: new Map([...pkg.parts, [NUMBERING_PART, withNum.part]]),
  });
  if (!existingPart) {
    // FAIL CLOSED, both of them: a package that gained `/word/numbering.xml` without the
    // matching relationship or content-type override is not a package worth returning.
    const related = withNumberingRelationship(next);
    if (!related) return null;
    const declared = withNumberingContentType(related);
    if (!declared) return null;
    next = declared;
  }
  return { pkg: next, numId: String(numId) };
}

/**
 * `CT_AbstractNum`'s child sequence (ECMA-376 17.9.1). ORDER IS LOAD-BEARING.
 *
 * `nsid?, multiLevelType?, tmpl?, name?, styleLink?, numStyleLink?, lvl*` is a strict
 * `xsd:sequence`, so a grafted `w:lvl` must land after every header element. Among the
 * `w:lvl` siblings themselves the schema imposes no order, but Word writes them by `ilvl`
 * and this keeps that shape.
 */
const CT_ABSTRACT_NUM_SEQUENCE = [
  'nsid',
  'multiLevelType',
  'tmpl',
  'name',
  'styleLink',
  'numStyleLink',
  'lvl',
];

/** Where a new `w:lvl` of `ilvl` belongs among an abstractNum's children. */
function levelInsertIndex(children: readonly OoxmlNode[], ilvl: number): number {
  let at = 0;
  children.forEach((child, index) => {
    if (child.kind === 'textValue') return;
    if (child.localName === 'lvl') {
      const raw = attribute(child as OoxmlElement, 'ilvl');
      const existing = raw !== undefined && /^\d$/.test(raw) ? Number(raw) : 0;
      if (existing < ilvl) at = index + 1;
      return;
    }
    if (CT_ABSTRACT_NUM_SEQUENCE.includes(child.localName)) at = index + 1;
  });
  return at;
}

/**
 * Declare `level` in the definition `numId` names, with Word's default format for that
 * level, or refuse.
 *
 * Word never greys Increase Indent out on a list item: demoting past the deepest level a
 * `w:abstractNum` declares makes Word DEFINE the level, cycling its stock bullets
 * (Symbol •, Courier `o`, Wingdings ▪) or number formats (decimal, lowerLetter,
 * lowerRoman) by depth. This is that write. An already-declared level returns the package
 * unchanged, so callers may ask first and act second without a second lookup.
 *
 * A delegating definition (`w:numStyleLink`, 17.9.21) is refused: its levels live on the
 * linked style's definition, and a `w:lvl` grafted here would be shadowed the moment the
 * link resolves.
 */
export function ensureNumberingLevel(
  pkg: OoxmlPackage,
  numId: string,
  level: number,
  kind: ListKind
): OoxmlPackage | null {
  if (!Number.isInteger(level) || level < 0 || level >= LEVEL_COUNT) return null;
  const numbering = pkg.parts.get(NUMBERING_PART);
  if (!numbering) return null;
  const root = numbering.root;

  const num = childrenNamed(root, 'num').find((node) => attribute(node, 'numId') === numId);
  const abstractRef = num ? childrenNamed(num, 'abstractNumId')[0] : undefined;
  const abstractId = abstractRef ? attribute(abstractRef, 'val') : undefined;
  if (!abstractId) return null;
  const abstract = childrenNamed(root, 'abstractNum').find(
    (node) => attribute(node, 'abstractNumId') === abstractId
  );
  if (!abstract) return null;
  if (childrenNamed(abstract, 'numStyleLink').length > 0) return null;

  const declared = childrenNamed(abstract, 'lvl').some(
    (node) => attribute(node, 'ilvl') === String(level)
  );
  if (declared) return pkg;

  const authored = readOoxmlPart(
    `<w:numbering xmlns:w="${W}">${levelXml(kind, level)}</w:numbering>`,
    { name: NUMBERING_PART, contentType: NUMBERING_CONTENT_TYPE }
  );
  if (!authored.ok) return null;
  const node = authored.part.root.children[0];
  if (!node) return null;
  const nextId = createNodeIdAllocator(numbering);
  const inserted = insertChildren(
    numbering,
    abstract.id,
    levelInsertIndex(abstract.children, level),
    [withFreshIds(node, nextId)]
  );
  if (!inserted.ok) return null;

  return Object.freeze({
    ...pkg,
    parts: new Map([...pkg.parts, [NUMBERING_PART, inserted.part]]),
  });
}

/** Re-key a grafted subtree so it cannot collide with the part it is joining. */
function withFreshIds(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { ...node, id: nextId() } as OoxmlNode;
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => withFreshIds(child, nextId)),
  } as OoxmlNode;
}

/**
 * Point the main document at the numbering part.
 *
 * The rels part is a TREE like any other, so the relationship is a node insert. A document
 * with no rels part at all gets one — and it must then be declared in `[Content_Types].xml`
 * too, which `withNumberingContentType` handles by extension default.
 *
 * `pkg.relationships` is updated ALONGSIDE the tree. Writing only the tree left the
 * in-memory map one record short, so `freeRelationshipId` — which reads the map, not the
 * tree — handed the same `rIdN` to a second relationship minted in the same session, and
 * anything resolving a part by relationship (rather than by literal path) could not see the
 * numbering part at all.
 */
function withNumberingRelationship(pkg: OoxmlPackage): OoxmlPackage | null {
  const owner = pkg.mainDocumentPart;
  const relsName = relsPartNameFor(owner);
  const existing = pkg.parts.get(relsName);
  const id = freeRelationshipId(pkg);
  const authored = readOoxmlPart(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="${id}" Type="${NUMBERING_REL_TYPE}" Target="numbering.xml"/>` +
      '</Relationships>',
    { name: relsName, contentType: RELS_CONTENT_TYPE }
  );
  if (!authored.ok) return null;

  const owned = pkg.relationships.get(owner) ?? [];
  const record: RelationshipRecord = {
    ownerPart: owner,
    id,
    type: NUMBERING_REL_TYPE,
    rawTarget: 'numbering.xml',
    targetMode: 'Internal',
    order: owned.reduce((max, entry) => Math.max(max, entry.order), -1) + 1,
  };
  const relationships = new Map([...pkg.relationships, [owner, [...owned, record]]]);

  if (!existing) {
    return Object.freeze({
      ...pkg,
      parts: new Map([...pkg.parts, [relsName, authored.part]]),
      relationships,
    });
  }
  const nextId = createNodeIdAllocator(existing);
  const node = authored.part.root.children[0];
  if (!node) return null;
  const inserted = insertChildren(existing, existing.root.id, existing.root.children.length, [
    withFreshIds(node, nextId),
  ]);
  if (!inserted.ok) return null;
  return Object.freeze({
    ...pkg,
    parts: new Map([...pkg.parts, [relsName, inserted.part]]),
    relationships,
  });
}

/** `/word/document.xml` -> `/word/_rels/document.xml.rels`. */
function relsPartNameFor(partName: string): string {
  const slash = partName.lastIndexOf('/');
  return `${partName.slice(0, slash)}/_rels/${partName.slice(slash + 1)}.rels`;
}

/** An `rIdN` no owner in the package already uses. */
function freeRelationshipId(pkg: OoxmlPackage): string {
  let max = 0;
  for (const records of pkg.relationships.values()) {
    for (const record of records) {
      const match = /^rId(\d{1,9})$/.exec(record.id);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return `rId${max + 1}`;
}

const NUMBERING_OVERRIDE = `<Override PartName="${NUMBERING_PART}" ContentType="${NUMBERING_CONTENT_TYPE}"/>`;

/**
 * Declare the numbering part in `[Content_Types].xml`, or REFUSE.
 *
 * `readOoxmlPackage` keeps this part as bytes rather than a canonical tree (nothing else
 * reads it as one, and `writeOoxmlPackage` re-emits only the parts held as trees), so a
 * tree edit is not reachable here — promoting it to `pkg.parts` would change what the
 * package writes back and what the D9 oracles walk. The bytes are still PARSED before they
 * are touched, and the patched bytes are parsed again to prove the edit landed:
 *
 *   * The root is identified by PARSING, never by matching `</Types>`. These bytes come out
 *     of an attacker-supplied `.docx`, and a legally prefixed root (`<ct:Types
 *     xmlns:ct="...">`) is not a defect — it just is not the string the old code looked
 *     for, so the override was silently skipped.
 *   * The post-condition is structural: after patching, the root's direct children must be
 *     exactly what they were plus our one `Override`, last. That rejects a splice that
 *     landed inside a comment, a CDATA section, or a nested element.
 *   * Every failure returns null and `ensureListDefinition` refuses the whole operation.
 *     Returning `pkg` unchanged was silent corruption: `/word/numbering.xml` was already in
 *     `parts`, so `writeOoxmlPackage` emitted a part with no content-type override — invalid
 *     OPC, which Word repairs by dropping it. No oracle sees content types, so nothing
 *     caught it.
 *
 * The inserted markup is an ENGINE LITERAL — no file-derived value is interpolated — so
 * there is nothing here to escape.
 */
function withNumberingContentType(pkg: OoxmlPackage): OoxmlPackage | null {
  const declared = pkg.contentTypes.overrides.get(NUMBERING_PART.toLowerCase());
  if (declared === NUMBERING_CONTENT_TYPE) return pkg;
  // An override claiming a DIFFERENT type for this part cannot be joined by a second one:
  // duplicate overrides fail closed on the next read, so refuse rather than corrupt.
  if (declared !== undefined) return null;

  const bytes = pkg.partBytes.get(CONTENT_TYPES_PART);
  if (!bytes) return null;
  const xml = strFromU8(bytes);
  const before = contentTypesShape(xml);
  if (!before) return null;

  const close = xml.lastIndexOf(`</${before.rootName}>`);
  if (close === -1) return null;
  const patched = xml.slice(0, close) + NUMBERING_OVERRIDE + xml.slice(close);

  const after = contentTypesShape(patched);
  if (!after || after.rootName !== before.rootName) return null;
  const expected = [
    ...before.children,
    childSignature('Override', { PartName: NUMBERING_PART, ContentType: NUMBERING_CONTENT_TYPE }),
  ];
  if (after.children.length !== expected.length) return null;
  if (after.children.some((child, index) => child !== expected[index])) return null;

  return Object.freeze({
    ...pkg,
    partBytes: new Map([...pkg.partBytes, [CONTENT_TYPES_PART, strToU8(patched)]]),
    contentTypes: Object.freeze({
      defaults: pkg.contentTypes.defaults,
      overrides: new Map([
        ...pkg.contentTypes.overrides,
        [NUMBERING_PART.toLowerCase(), NUMBERING_CONTENT_TYPE],
      ]),
    }),
  });
}

interface ContentTypesShape {
  /** The root's AUTHORED QName, so a prefixed root closes with its own tag. */
  readonly rootName: string;
  /** A signature per direct child, enough to notice any change to any of them. */
  readonly children: readonly string[];
}

/**
 * Parse `[Content_Types].xml` far enough to know its root and its direct children.
 *
 * Returns null unless there is exactly one root element, its local name is `Types`, and the
 * prefix it is written under is bound ON THAT ROOT to the OPC content-types namespace — a
 * root that is not a content-types root is not one this may patch.
 */
function contentTypesShape(xml: string): ContentTypesShape | null {
  const parsed = readXml(xml);
  if (!parsed.ok) return null;
  const roots = parsed.nodes.filter(
    (node): node is Extract<XmlNode, { type: 'element' }> => node.type === 'element'
  );
  if (roots.length !== 1) return null;
  const root = roots[0]!;
  const colon = root.name.indexOf(':');
  const prefix = colon === -1 ? '' : root.name.slice(0, colon);
  if (root.name.slice(colon + 1) !== 'Types') return null;
  if (root.attributes[prefix ? `xmlns:${prefix}` : 'xmlns'] !== CONTENT_TYPES_NS) return null;
  const children: string[] = [];
  for (const child of root.children) {
    if (child.type !== 'element') continue;
    children.push(childSignature(child.name, child.attributes));
  }
  return { rootName: root.name, children };
}

/**
 * One direct child of the types root, reduced to a comparable string.
 *
 * Attribute ORDER carries no meaning here, so it is sorted away; the separator is a
 * character no XML name or attribute value may contain, so two different children cannot
 * collide on one signature.
 */
function childSignature(name: string, attributes: Readonly<Record<string, string>>): string {
  const pairs = Object.entries(attributes)
    .map(([attribute, value]) => `${attribute}=${value}`)
    .sort();
  return [name, ...pairs].join('\u0001');
}
