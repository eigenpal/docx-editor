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
 * its state is returned, so a server replaces a room only with one that holds the same text.
 *
 * The new room is a new generation, as compaction makes one: a replica that still holds the
 * earlier room is refused by `checkCollaborationRoomGeneration` and rejoins.
 */
import * as Y from 'yjs';
import { readOoxmlPackage, type OoxmlNode } from '@docx-editor.dev/core/store';
import { readCollaborationDocument } from './document-read.ts';
import { COLLABORATION_FORMAT_VERSION, readCollaborationFormatVersion } from './document-format.ts';
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
 * Throws `CollaborationSchemaError` with code `not-initialized` for state that holds no room.
 * A room whose version information is missing or malformed was written before collaboration
 * formats were versioned, and counts as `earlier-format`.
 *
 * @public
 */
export function collaborationMigrationNeed(state: Uint8Array): CollaborationMigrationNeed {
  const room = new Y.Doc();
  try {
    Y.applyUpdate(room, state);
    let format: string;
    try {
      format = readCollaborationFormatVersion(room);
    } catch (error) {
      if (
        error instanceof CollaborationSchemaError &&
        error.code === 'collaboration-format-mismatch'
      ) {
        return 'earlier-format';
      }
      throw error;
    }
    const order = compareFormats(format, COLLABORATION_FORMAT_VERSION);
    return order === 0 ? 'current' : order < 0 ? 'earlier-format' : 'later-format';
  } finally {
    room.destroy();
  }
}

/** One paragraph a migration compares: its text, and whether the editor shows it. @public */
export interface CollaborationMigrationParagraph {
  /** The paragraph's text, in every run, field result, and nested text it holds. */
  readonly text: string;
  /** False for a paragraph the room keeps but the editor can neither show nor edit. */
  readonly shown: boolean;
}

/**
 * What a migration found, comparing the new room with the export it was seeded from.
 *
 * The comparison covers the text of every paragraph, with simple field instructions and
 * symbols, every media part by its bytes, and every external link target. It does not compare
 * formatting: reopen exports to check formatting before people edit again.
 *
 * @public
 */
export interface CollaborationMigrationReport {
  /**
   * Whether the new room holds every paragraph of the export in order with the same text, every
   * media part, and every external link target.
   */
  readonly ok: boolean;
  /**
   * Paragraphs in the export, in every part: body, tables, headers, footers, notes, and
   * comments. A paragraph inside another, as in a text box, counts with the one that holds it.
   */
  readonly paragraphs: number;
  /**
   * Paragraphs the new room keeps but the editor can neither show nor edit. They save back
   * unchanged. Check such rooms before people edit them again.
   */
  readonly hidden: number;
  /** Each paragraph that differs, by its position in the export, at most 20. */
  readonly differences: readonly {
    readonly paragraph: number;
    readonly expected: string | null;
    readonly actual: string | null;
  }[];
  /** Media parts of the export, by name, whose bytes the new room does not hold. */
  readonly missingMedia: readonly string[];
  /** External link targets of the export that the new room does not hold. */
  readonly missingLinks: readonly string[];
}

/**
 * The result of `migrateCollaborationRoom`: the new room's state when the check passed, and
 * the report either way.
 *
 * @public
 */
export type CollaborationMigration =
  | { readonly ok: true; readonly state: Uint8Array; readonly report: CollaborationMigrationReport }
  | { readonly ok: false; readonly report: CollaborationMigrationReport };

/** Options for {@link migrateCollaborationRoom}. @public */
export interface MigrateCollaborationRoomOptions {
  /** The document ID of the new room. Keep the earlier room's ID to keep links to it. */
  readonly documentId: string;
}

/**
 * Seed a room in this build's format from a `.docx` that the build which created the earlier
 * room exported, and check the new room against the export.
 *
 * Returns the new room's state only when the report is `ok`: every paragraph of the export is
 * in the new room in order with the same text, with every media part and external link
 * target. Store that state in place of the earlier room's state, and
 * keep the earlier state until you accept the migration. A failed check returns the report
 * and no state, and the earlier room stays as it is.
 *
 * Throws `CollaborationSchemaError` when the export cannot be seeded, for example a value
 * larger than the room's limits.
 *
 * @public
 */
export async function migrateCollaborationRoom(
  exported: Uint8Array,
  options: MigrateCollaborationRoomOptions
): Promise<CollaborationMigration> {
  const state = await seedGeneration(exported, options.documentId);
  const room = new Y.Doc();
  try {
    Y.applyUpdate(room, state);
    const report = compareMigrationContents(
      await contentsOf(exported),
      await contentsOf(readCollaborationDocument(room))
    );
    return report.ok ? { ok: true, state, report } : { ok: false, report };
  } finally {
    room.destroy();
  }
}

const MAX_DIFFERENCES = 20;

export function compareMigrationParagraphs(
  expected: readonly CollaborationMigrationParagraph[],
  actual: readonly CollaborationMigrationParagraph[]
): CollaborationMigrationReport {
  const differences: { paragraph: number; expected: string | null; actual: string | null }[] = [];
  const length = Math.max(expected.length, actual.length);
  for (let at = 0; at < length && differences.length < MAX_DIFFERENCES; at += 1) {
    const left = expected[at]?.text ?? null;
    const right = actual[at]?.text ?? null;
    if (left !== right) differences.push({ paragraph: at + 1, expected: left, actual: right });
  }
  return {
    ok: differences.length === 0 && expected.length === actual.length,
    paragraphs: expected.length,
    hidden: actual.filter((paragraph) => !paragraph.shown).length,
    differences,
    missingMedia: [],
    missingLinks: [],
  };
}

/** The report for an export (`before`) and the new room's own export (`after`). */
export function compareMigrationContents(
  before: MigrationContents,
  after: MigrationContents
): CollaborationMigrationReport {
  const paragraphs = compareMigrationParagraphs(before.paragraphs, after.paragraphs);
  const missingMedia = [...before.media]
    .filter(([digest]) => !after.media.has(digest))
    .map(([, name]) => name)
    .sort();
  const missingLinks = missingFrom(before.links, after.links);
  return {
    ...paragraphs,
    ok: paragraphs.ok && missingMedia.length === 0 && missingLinks.length === 0,
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

/** What a migration compares in a `.docx`. */
export interface MigrationContents {
  readonly paragraphs: CollaborationMigrationParagraph[];
  /** Media parts by the SHA-256 of their bytes, with the name of one part. */
  readonly media: Map<string, string>;
  /** External link targets, by relationship type and target. */
  readonly links: string[];
}

/**
 * Every paragraph of a `.docx`, in part order and document order, shown or not: one the
 * editor cannot show is still text a person wrote. With it, the media parts and link targets.
 */
async function contentsOf(docx: Uint8Array): Promise<MigrationContents> {
  const read = readOoxmlPackage(docx);
  if (!read.ok) throw new CollaborationSchemaError('invalid-baseline', read.reason);
  const paragraphs: CollaborationMigrationParagraph[] = [];
  // A simple field's instruction and a symbol's character are text an attribute holds.
  const attributeText = (node: OoxmlNode): string => {
    if (node.kind === 'textValue') return '';
    const value = (name: string) =>
      node.attributes.find((attribute) => attribute.localName === name)?.value ?? '';
    if (node.localName === 'fldSimple') return `[${value('instr')}]`;
    if (node.localName === 'sym') return `[${value('font')} ${value('char')}]`;
    return '';
  };
  const textOf = (node: OoxmlNode): string =>
    node.kind === 'textValue'
      ? node.value
      : attributeText(node) + node.children.map(textOf).join('');
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'p') {
      paragraphs.push({ text: textOf(node), shown: node.kind === 'paragraph' });
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const name of [...read.package.parts.keys()].sort()) {
    visit(read.package.parts.get(name)!.root);
  }
  const media = new Map<string, string>();
  for (const [name, bytes] of [...read.package.partBytes].sort(([a], [b]) => (a < b ? -1 : 1))) {
    // Media only: XML parts, relationships, and content types are written anew by each save.
    if (read.package.parts.has(name) || /\.(xml|rels)$/i.test(name)) continue;
    const digest = await sha256(bytes);
    if (!media.has(digest)) media.set(digest, name);
  }
  const links = read.package.externalTargets.map((target) => `${target.type} ${target.rawTarget}`);
  return { paragraphs, media, links };
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
