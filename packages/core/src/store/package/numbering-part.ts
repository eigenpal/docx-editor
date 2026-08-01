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

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NUMBERING_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const NUMBERING_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const CONTENT_TYPES_PART = '/[Content_Types].xml';
const NUMBERING_PART = '/word/numbering.xml';

/** The two list kinds a toolbar offers. */
export type ListKind = 'bullet' | 'ordered';

/** Word's own bullet glyphs and fonts, by level, cycling every three. */
const BULLETS = [
  { text: '•', font: 'Symbol' },
  { text: 'o', font: 'Courier New' },
  { text: '§', font: 'Wingdings' },
] as const;

/** Word's own numbering formats, by level, cycling every three. */
const NUMBER_FORMATS = ['decimal', 'lowerLetter', 'lowerRoman'] as const;

/** Nine levels, the count `w:ilvl` allows (ECMA-376 17.9.24). */
const LEVEL_COUNT = 9;

function levelXml(kind: ListKind, ilvl: number): string {
  // 0.25" per level, with the marker in a 0.25" hanging slot — Word's own list geometry.
  const left = 720 * (ilvl + 1);
  const common =
    `<w:start w:val="1"/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr>`;
  if (kind === 'bullet') {
    const bullet = BULLETS[ilvl % BULLETS.length]!;
    return (
      `<w:lvl w:ilvl="${ilvl}"><w:numFmt w:val="bullet"/>` +
      `<w:lvlText w:val="${bullet.text}"/>${common}` +
      `<w:rPr><w:rFonts w:ascii="${bullet.font}" w:hAnsi="${bullet.font}" w:hint="default"/></w:rPr>` +
      '</w:lvl>'
    );
  }
  const format = NUMBER_FORMATS[ilvl % NUMBER_FORMATS.length]!;
  // `%N` is the placeholder for level N+1's counter; each level shows only its own.
  return (
    `<w:lvl w:ilvl="${ilvl}"><w:numFmt w:val="${format}"/>` +
    `<w:lvlText w:val="%${ilvl + 1}."/>${common}</w:lvl>`
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

  // After the last `w:abstractNum`, and at the end, respectively.
  const lastAbstract = abstractNums[abstractNums.length - 1];
  const abstractAt = lastAbstract
    ? root.children.findIndex((child) => child.id === lastAbstract.id) + 1
    : 0;
  const withAbstract = insertChildren(numbering, root.id, abstractAt, [newAbstract]);
  if (!withAbstract.ok) return null;
  const withNum = insertChildren(
    withAbstract.part,
    root.id,
    withAbstract.part.root.children.length,
    [newNum]
  );
  if (!withNum.ok) return null;

  let next: OoxmlPackage = Object.freeze({
    ...pkg,
    parts: new Map([...pkg.parts, [NUMBERING_PART, withNum.part]]),
  });
  if (!existingPart) {
    const related = withNumberingRelationship(next);
    if (!related) return null;
    next = withNumberingContentType(related);
  }
  return { pkg: next, numId: String(numId) };
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
 */
function withNumberingRelationship(pkg: OoxmlPackage): OoxmlPackage | null {
  const relsName = relsPartNameFor(pkg.mainDocumentPart);
  const existing = pkg.parts.get(relsName);
  const id = freeRelationshipId(pkg);
  const authored = readOoxmlPart(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="${id}" Type="${NUMBERING_REL_TYPE}" Target="numbering.xml"/>` +
      '</Relationships>',
    { name: relsName, contentType: RELS_CONTENT_TYPE }
  );
  if (!authored.ok) return null;
  if (!existing) {
    return Object.freeze({ ...pkg, parts: new Map([...pkg.parts, [relsName, authored.part]]) });
  }
  const nextId = createNodeIdAllocator(existing);
  const record = authored.part.root.children[0];
  if (!record) return null;
  const inserted = insertChildren(existing, existing.root.id, existing.root.children.length, [
    withFreshIds(record, nextId),
  ]);
  if (!inserted.ok) return null;
  return Object.freeze({ ...pkg, parts: new Map([...pkg.parts, [relsName, inserted.part]]) });
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

/**
 * Declare the numbering part in `[Content_Types].xml`.
 *
 * That part is deliberately NOT a tree — the reader skips it — so this is the one place
 * that edits raw bytes. The override is appended before the closing tag; both strings are
 * engine literals, and a types part that does not close as expected is left alone rather
 * than patched blindly.
 */
function withNumberingContentType(pkg: OoxmlPackage): OoxmlPackage {
  const bytes = pkg.partBytes.get(CONTENT_TYPES_PART);
  if (!bytes) return pkg;
  const xml = strFromU8(bytes);
  if (xml.includes(NUMBERING_PART)) return pkg;
  const close = xml.lastIndexOf('</Types>');
  if (close === -1) return pkg;
  const override = `<Override PartName="${NUMBERING_PART}" ContentType="${NUMBERING_CONTENT_TYPE}"/>`;
  const patched = xml.slice(0, close) + override + xml.slice(close);
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
