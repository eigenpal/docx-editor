/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Moving a saved room to the current collaboration format.
 *
 * A room of an earlier format cannot be read by this build, because it stores paragraphs
 * differently. A room therefore moves in two steps: the build that created it exports it as
 * a `.docx` with `readCollaborationDocument`, and this build seeds a new room from that
 * export with `migrateCollaborationRoom`. The new room is checked against the export before
 * its state is returned, so a server replaces a room only with one that holds the same
 * document.
 *
 * The new room is a new generation, as compaction makes one: a replica that still holds the
 * earlier room is refused by `checkCollaborationRoomGeneration` and rejoins.
 */
import * as Y from 'yjs';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { readCollaborationDocument } from './document-read.ts';
import { validateDocumentId } from './document-awareness.ts';
import { COLLABORATION_FORMAT_VERSION, readCollaborationFormatVersion } from './document-format.ts';
import { PACKAGE_META_KEY } from './document/schema.ts';
import { CollaborationSchemaError } from './errors.ts';
import { seedGeneration } from './room-generation.ts';

/**
 * How saved room state relates to the format this build writes.
 *
 * - `current`: the room is in this build's format; it needs no migration.
 * - `earlier-format`: an earlier build wrote it; export it with that build and migrate it.
 * - `later-format`: a later build wrote it; this build must not open or replace it.
 *
 * @public
 */
export type CollaborationMigrationNeed = 'current' | 'earlier-format' | 'later-format';

/**
 * Whether saved room state needs a migration before this build can serve it.
 *
 * A room whose version information is missing or malformed was written before collaboration
 * formats were versioned, and counts as `earlier-format`.
 *
 * Throws `CollaborationSchemaError` with code `not-initialized` for state that holds no room,
 * and with code `invalid-baseline` for bytes that are not room state.
 *
 * @public
 */
export function collaborationMigrationNeed(state: Uint8Array): CollaborationMigrationNeed {
  return withRoom(state, (room) => needOf(formatOf(room)));
}

/**
 * A check that a migration runs on the new room, compared with the export.
 *
 * - `paragraphs`: the new room holds a different number of paragraphs.
 * - `text`: a paragraph's text differs.
 * - `formatting`: a paragraph's properties, or the character formatting of its text, differ.
 * - `structure`: an XML part differs in something the other checks do not cover, such as
 *   tables, sections, styles, numbering, tracked changes, comments, or notes.
 * - `media`: a media part's bytes are missing.
 * - `links`: an external link target is missing.
 *
 * @public
 */
export type CollaborationMigrationCheck =
  | 'paragraphs'
  | 'text'
  | 'formatting'
  | 'structure'
  | 'media'
  | 'links';

/** A paragraph by its part and its position in that part, from 1. @public */
export interface CollaborationMigrationPosition {
  /** The package part that holds the paragraph, such as `/word/document.xml`. */
  readonly part: string;
  /** The paragraph's position in its part, from 1, in document order. */
  readonly paragraph: number;
}

/**
 * One paragraph that differs between the export and the new room.
 *
 * `expected` and `actual` hold document text. Treat them as document content: keep them out
 * of logs that people without access to the document can read.
 *
 * @public
 */
export interface CollaborationMigrationDifference extends CollaborationMigrationPosition {
  /**
   * - `text`: the paragraph's text differs.
   * - `formatting`: its text is the same, but its properties or character formatting differ.
   * - `missing`: the export has the paragraph and the new room does not.
   * - `added`: the new room has a paragraph the export does not.
   */
  readonly kind: 'text' | 'formatting' | 'missing' | 'added';
  /** The paragraph's text in the export, or null when the export has no such paragraph. */
  readonly expected: string | null;
  /** The paragraph's text in the new room, or null when the new room has no such paragraph. */
  readonly actual: string | null;
}

/**
 * What a migration found, comparing the new room with the export it was seeded from.
 *
 * The check compares each XML part of the export with the new room's. It ignores only what
 * every save writes anew: namespace declarations, the values of paragraph IDs
 * (`w14:paraId`, `w14:textId`) and of `w:id`, and the relationship parts. A reference to an ID,
 * such as a comment anchor or a comment extension, must still name the same element. Revision
 * IDs are not compared: they only have to be unique. For each paragraph it also
 * reports its text and formatting, to locate a difference. It compares every media part by its
 * bytes, and every external link target.
 *
 * @public
 */
export interface CollaborationMigrationReport {
  /** True when every check passed. */
  readonly ok: boolean;
  /** The checks that failed. Empty when `ok` is true. */
  readonly failed: readonly CollaborationMigrationCheck[];
  /** The earlier room's format, or `unversioned` for a room written before formats had one. */
  readonly from: string;
  /** The format of the new room: this build's. */
  readonly to: string;
  /** The document ID of the new room. Every client must open the room with this ID. */
  readonly documentId: string;
  /**
   * Paragraphs in the export, in every part: body, tables, headers, footers, notes, and
   * comments. A paragraph inside another, as in a text box, counts with the one that holds it.
   */
  readonly paragraphs: number;
  /**
   * Paragraphs the new room keeps but the editor can neither show nor edit. They save back
   * unchanged, and they do not fail the check. Check such rooms before people edit them.
   */
  readonly hidden: number;
  /** Where the first hidden paragraphs are, at most 20. */
  readonly hiddenAt: readonly CollaborationMigrationPosition[];
  /**
   * XML parts that differ, by name, or that one side does not have. A part whose paragraphs
   * differ is listed too.
   */
  readonly changedParts: readonly string[];
  /** How many paragraphs differ. `differences` lists at most the first 20. */
  readonly differenceCount: number;
  /** The first paragraphs that differ, at most 20. */
  readonly differences: readonly CollaborationMigrationDifference[];
  /** Media parts of the export, by name, whose bytes the new room does not hold. */
  readonly missingMedia: readonly string[];
  /** External link targets of the export that the new room does not hold. */
  readonly missingLinks: readonly string[];
}

/**
 * The result of `migrateCollaborationRoom`.
 *
 * - `ok: true`: the check passed. Store `state` in place of the earlier room's state.
 * - `reason: 'check-failed'`: the new room differs from the export. Nothing is returned to
 *   store; `report` says what differs.
 * - `reason: 'current'`: the room is already in this build's format. Leave it as it is.
 * - `reason: 'later-format'`: a later build wrote the room. Do not open or replace it.
 *
 * @public
 */
export type CollaborationMigration =
  | { readonly ok: true; readonly state: Uint8Array; readonly report: CollaborationMigrationReport }
  | {
      readonly ok: false;
      readonly reason: 'check-failed';
      readonly report: CollaborationMigrationReport;
    }
  | { readonly ok: false; readonly reason: 'current' | 'later-format' };

/** Options for {@link migrateCollaborationRoom}. @public */
export interface MigrateCollaborationRoomOptions {
  /** The earlier room's saved state: the exact bytes that `exported` was exported from. */
  readonly state: Uint8Array;
  /**
   * The `.docx` that the build which created the room exported from `state`, with
   * `readCollaborationDocument`.
   */
  readonly exported: Uint8Array;
  /**
   * The document ID of the new room. Omit it to keep the earlier room's ID, which is what its
   * clients open the room with: a client whose ID differs is refused with
   * `document-id-mismatch`. Pass it only to give the room a new ID, and open it with that ID.
   */
  readonly documentId?: string;
}

/**
 * Seed a room in this build's format from the `.docx` that the earlier build exported, and
 * check the new room against that export.
 *
 * The new room keeps the earlier room's document ID unless `documentId` gives another. It is a
 * new room generation: a replica that still holds the earlier room is refused with
 * `room-generation-changed` and rejoins.
 *
 * This function does not check that `exported` was made from `state`. Store a digest of the
 * state with each export, and compare it before you call this function: an export made before
 * later edits would lose them.
 *
 * Throws `CollaborationSchemaError` when the inputs cannot be used: `invalid-baseline` for
 * bytes that are not room state or not a `.docx`, `not-initialized` for state that holds no
 * room, `invalid-document-id` for an unusable document ID, and a limit code such as
 * `too-many-nodes` for an export larger than a room's limits.
 *
 * @public
 */
export async function migrateCollaborationRoom(
  options: MigrateCollaborationRoomOptions
): Promise<CollaborationMigration> {
  const earlier = withRoom(options.state, (room) => ({
    format: formatOf(room),
    documentId: documentIdOf(room),
  }));
  const need = needOf(earlier.format);
  if (need === 'current') return { ok: false, reason: 'current' };
  if (need === 'later-format') return { ok: false, reason: 'later-format' };
  const given = options.documentId ?? earlier.documentId;
  if (typeof given !== 'string') {
    throw new CollaborationSchemaError(
      'invalid-document-id',
      'The earlier room holds no document ID. Pass the ID its clients use as documentId.'
    );
  }
  const documentId = validateDocumentId(given);
  const before = await migrationContentsOf(options.exported);
  const state = await seedGeneration(options.exported, documentId);
  const after = withRoom(state, (room) => readCollaborationDocument(room));
  const report = compareMigrationContents(before, await migrationContentsOf(after), {
    from: earlier.format ?? 'unversioned',
    to: COLLABORATION_FORMAT_VERSION,
    documentId,
  });
  return report.ok ? { ok: true, state, report } : { ok: false, reason: 'check-failed', report };
}

/** Run `read` over a room built from `state`, and destroy the room after. */
function withRoom<T>(state: Uint8Array, read: (room: Y.Doc) => T): T {
  const room = new Y.Doc();
  try {
    try {
      Y.applyUpdate(room, state);
    } catch {
      throw new CollaborationSchemaError('invalid-baseline', 'The bytes are not room state.');
    }
    return read(room);
  } finally {
    room.destroy();
  }
}

/**
 * The room's document ID, or undefined when its metadata cannot hold one: an earlier room whose
 * metadata is not a map then needs the ID passed as `documentId`.
 */
function documentIdOf(room: Y.Doc): unknown {
  try {
    return room.getMap(PACKAGE_META_KEY).get('documentId');
  } catch {
    return undefined;
  }
}

/** The room's format, or null for a room written before formats were versioned. */
function formatOf(room: Y.Doc): string | null {
  try {
    return readCollaborationFormatVersion(room);
  } catch (error) {
    if (
      error instanceof CollaborationSchemaError &&
      error.code === 'collaboration-format-mismatch'
    ) {
      return null;
    }
    throw error;
  }
}

function needOf(format: string | null): CollaborationMigrationNeed {
  if (format === null) return 'earlier-format';
  const order = compareFormats(format, COLLABORATION_FORMAT_VERSION);
  return order === 0 ? 'current' : order < 0 ? 'earlier-format' : 'later-format';
}

/** One paragraph a migration compares. */
export interface MigrationParagraph {
  /** The part that holds it. */
  readonly part: string;
  /** Its position in that part, from 1. */
  readonly index: number;
  /** Its text, in every run, field result, and nested text it holds. */
  readonly text: string;
  /** Its paragraph properties and the character formatting of its text, as one key. */
  readonly formatting: string;
  /** False for a paragraph the room keeps but the editor can neither show nor edit. */
  readonly shown: boolean;
}

/** What a migration compares in a `.docx`. */
export interface MigrationContents {
  readonly paragraphs: readonly MigrationParagraph[];
  /** Media parts by the SHA-256 of their bytes, with the name of one part. */
  readonly media: ReadonlyMap<string, string>;
  /** External link targets, by relationship type and target. */
  readonly links: readonly string[];
  /** Each XML part by name, as a fingerprint that ignores what every save writes anew. */
  readonly parts: ReadonlyMap<string, string>;
}

const MAX_DIFFERENCES = 20;

/** The report for an export (`before`) and the new room's own export (`after`). */
export function compareMigrationContents(
  before: MigrationContents,
  after: MigrationContents,
  room: { readonly from: string; readonly to: string; readonly documentId: string }
): CollaborationMigrationReport {
  const differences: CollaborationMigrationDifference[] = [];
  let differenceCount = 0;
  const failed = new Set<CollaborationMigrationCheck>();
  if (before.paragraphs.length !== after.paragraphs.length) failed.add('paragraphs');
  const length = Math.max(before.paragraphs.length, after.paragraphs.length);
  for (let at = 0; at < length; at += 1) {
    const left = before.paragraphs[at];
    const right = after.paragraphs[at];
    const kind = !right
      ? 'missing'
      : !left
        ? 'added'
        : left.text !== right.text
          ? 'text'
          : left.formatting !== right.formatting
            ? 'formatting'
            : null;
    if (kind === null) continue;
    if (kind === 'text' || kind === 'formatting') failed.add(kind);
    differenceCount += 1;
    if (differences.length >= MAX_DIFFERENCES) continue;
    const where = (left ?? right)!;
    differences.push({
      part: where.part,
      paragraph: where.index,
      kind,
      expected: left?.text ?? null,
      actual: right?.text ?? null,
    });
  }
  const missingMedia = [...before.media]
    .filter(([digest]) => !after.media.has(digest))
    .map(([, name]) => name)
    .sort();
  if (missingMedia.length > 0) failed.add('media');
  const missingLinks = missingFrom(before.links, after.links);
  if (missingLinks.length > 0) failed.add('links');
  const changedParts = [...new Set([...before.parts.keys(), ...after.parts.keys()])]
    .filter((name) => before.parts.get(name) !== after.parts.get(name))
    .sort();
  if (changedParts.length > 0) failed.add('structure');
  const hidden = after.paragraphs.filter((paragraph) => !paragraph.shown);
  const order: readonly CollaborationMigrationCheck[] = [
    'paragraphs',
    'text',
    'formatting',
    'structure',
    'media',
    'links',
  ];
  return {
    ok: failed.size === 0,
    failed: order.filter((check) => failed.has(check)),
    from: room.from,
    to: room.to,
    documentId: room.documentId,
    paragraphs: before.paragraphs.length,
    hidden: hidden.length,
    hiddenAt: hidden
      .slice(0, MAX_DIFFERENCES)
      .map((paragraph) => ({ part: paragraph.part, paragraph: paragraph.index })),
    changedParts,
    differenceCount,
    differences,
    missingMedia,
    missingLinks,
  };
}

/** Each entry of `expected` that `actual` holds fewer times, once. */
function missingFrom(expected: readonly string[], actual: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const entry of actual) counts.set(entry, (counts.get(entry) ?? 0) + 1);
  const missing = new Set<string>();
  for (const entry of expected) {
    const count = counts.get(entry) ?? 0;
    if (count === 0) missing.add(entry);
    else counts.set(entry, count - 1);
  }
  return [...missing].sort();
}

/** The text of a node, with the text that a simple field or a symbol holds in an attribute. */
function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  const value = (name: string) =>
    node.attributes.find((attribute) => attribute.localName === name)?.value ?? '';
  const own =
    node.localName === 'fldSimple'
      ? `[${value('instr')}]`
      : node.localName === 'sym'
        ? `[${value('font')} ${value('char')}]`
        : '';
  return own + node.children.map(textOf).join('');
}

/**
 * A paragraph's formatting as one key: each of its `w:pPr`, then the character formatting of
 * its text as runs of equal `w:rPr`. Runs split or joined differently with the same formatting
 * give the same key, and so does an empty `w:rPr` and none.
 */
function formattingOf(paragraph: OoxmlNode & { readonly children: readonly OoxmlNode[] }): string {
  const properties: string[] = [];
  const runs: { format: string; text: string }[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue' || node.localName === 'p') return;
    if (node.localName === 'r') {
      const text = textOf(node);
      if (text === '') return;
      const rPr = node.children.find(
        (child) => child.kind !== 'textValue' && child.localName === 'rPr'
      );
      const empty =
        !rPr ||
        rPr.kind === 'textValue' ||
        (rPr.children.length === 0 && rPr.attributes.length === 0);
      const format = empty ? '' : canonicalOoxmlFingerprint(rPr);
      const last = runs.at(-1);
      if (last && last.format === format) last.text += text;
      else runs.push({ format, text });
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const child of paragraph.children) {
    if (child.kind !== 'textValue' && child.localName === 'pPr') {
      properties.push(canonicalOoxmlFingerprint(child));
    } else {
      visit(child);
    }
  }
  return JSON.stringify([properties, runs.map((run) => [run.format, run.text.length])]);
}

/**
 * Every paragraph of a `.docx`, in part order and document order, shown or not: one the
 * editor cannot show is still text a person wrote. With it, the media parts and link targets.
 */
export async function migrationContentsOf(docx: Uint8Array): Promise<MigrationContents> {
  const read = readOoxmlPackage(docx);
  if (!read.ok) throw new CollaborationSchemaError('invalid-baseline', read.reason);
  const roots = withoutSavedAnew(read.package.parts);
  const paragraphs: MigrationParagraph[] = [];
  for (const [part, root] of roots) {
    let index = 0;
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.localName === 'p') {
        index += 1;
        paragraphs.push({
          part,
          index,
          text: textOf(node),
          formatting: formattingOf(node),
          shown: node.kind === 'paragraph',
        });
        return;
      }
      for (const child of node.children) visit(child);
    };
    visit(root);
  }
  const media = new Map<string, string>();
  for (const [name, bytes] of [...read.package.partBytes].sort(([a], [b]) => (a < b ? -1 : 1))) {
    // Media only: XML parts, relationships, and content types are written anew by each save.
    if (read.package.parts.has(name) || /\.(xml|rels)$/i.test(name)) continue;
    const digest = await sha256(bytes);
    if (!media.has(digest)) media.set(digest, name);
  }
  const links = read.package.externalTargets.map((target) => `${target.type} ${target.rawTarget}`);
  const parts = new Map<string, string>();
  for (const [name, root] of roots) {
    if (!/\.rels$/i.test(name)) parts.set(name, canonicalOoxmlFingerprint(root));
  }
  return { paragraphs, media, links, parts };
}

const WML = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Attributes that hold a paragraph ID or refer to one, as comment extensions do. */
const PARAGRAPH_IDS = new Set(['paraId', 'paraIdParent']);

/**
 * The `w:id` families whose members refer to each other. Any other `w:id` is a revision's: it
 * only has to be unique, refers to nothing, and a save can renumber it, so it is not compared.
 */
const ID_FAMILIES: Readonly<Record<string, string>> = {
  moveFromRangeStart: 'moveFrom',
  moveFromRangeEnd: 'moveFrom',
  moveToRangeStart: 'moveTo',
  moveToRangeEnd: 'moveTo',
  customXmlInsRangeStart: 'customXmlIns',
  customXmlInsRangeEnd: 'customXmlIns',
  customXmlDelRangeStart: 'customXmlDel',
  customXmlDelRangeEnd: 'customXmlDel',
  customXmlMoveFromRangeStart: 'customXmlMoveFrom',
  customXmlMoveFromRangeEnd: 'customXmlMoveFrom',
  customXmlMoveToRangeStart: 'customXmlMoveTo',
  customXmlMoveToRangeEnd: 'customXmlMoveTo',
  comment: 'comment',
  commentRangeStart: 'comment',
  commentRangeEnd: 'comment',
  commentReference: 'comment',
  footnote: 'footnote',
  footnoteReference: 'footnote',
  endnote: 'endnote',
  endnoteReference: 'endnote',
  bookmarkStart: 'bookmark',
  bookmarkEnd: 'bookmark',
  permStart: 'permission',
  permEnd: 'permission',
};

/**
 * Each part's tree, in part-name order, without what a save writes anew. A paragraph's own IDs
 * are removed, and a reference to a paragraph ID, as in a comment extension, names the
 * paragraph's position instead. A save can renumber `w:id` values. A revision's own value is
 * cleared. The values
 * of a family whose members refer to each other are numbered by first appearance across all
 * parts: a consistent renumbering keeps the trees equal, and a comment, note, bookmark, or
 * range that points at another one does not.
 */
function withoutSavedAnew(
  parts: ReadonlyMap<string, { readonly root: OoxmlNode }>
): Map<string, OoxmlNode> {
  const numbers = new Map<string, Map<string, number>>();
  const numberOf = (family: string, value: string): string => {
    let values = numbers.get(family);
    if (!values) numbers.set(family, (values = new Map()));
    let number = values.get(value);
    if (number === undefined) values.set(value, (number = values.size));
    return String(number);
  };
  // A paragraph's ID is its position among all paragraphs; a reference to one names that.
  const names = [...parts.keys()].sort();
  const positions = new Map<string, number>();
  const collect = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'p') {
      const id = node.attributes.find((attribute) => attribute.localName === 'paraId')?.value;
      if (id !== undefined && !positions.has(id)) positions.set(id, positions.size);
    }
    for (const child of node.children) collect(child);
  };
  for (const name of names) collect(parts.get(name)!.root);
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    const family = Object.hasOwn(ID_FAMILIES, node.localName) ? ID_FAMILIES[node.localName] : null;
    const paragraph = node.localName === 'p';
    return {
      ...node,
      attributes: node.attributes
        .filter(
          (attribute) =>
            attribute.localName !== 'textId' &&
            !(paragraph && PARAGRAPH_IDS.has(attribute.localName))
        )
        .map((attribute) =>
          attribute.localName === 'id' && attribute.namespaceUri === WML
            ? { ...attribute, value: family ? numberOf(family, attribute.value) : '' }
            : PARAGRAPH_IDS.has(attribute.localName)
              ? { ...attribute, value: `p${positions.get(attribute.value) ?? '?'}` }
              : attribute
        ),
      children: node.children.map(visit),
    } as OoxmlNode;
  };
  const roots = new Map<string, OoxmlNode>();
  for (const name of names) roots.set(name, visit(parts.get(name)!.root));
  return roots;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const view =
    bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : bytes.slice();
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', view));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Compare two `docx-collaboration:a.b.c.d` values field by field. */
function compareFormats(left: string, right: string): number {
  const fields = (format: string): number[] =>
    format
      .slice(format.indexOf(':') + 1)
      .split('.')
      .map(Number);
  const a = fields(left);
  const b = fields(right);
  for (let at = 0; at < Math.max(a.length, b.length); at += 1) {
    const difference = (a[at] ?? 0) - (b[at] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
