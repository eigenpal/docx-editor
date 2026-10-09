// Moving a saved room to the current collaboration format.
//
// A room of an earlier format cannot be read by this build: its paragraphs are stored
// differently. So a room moves in two steps. First the build that created it exports the
// room as a `.docx` (`export-rooms.ts`). Then this build seeds a new room from that export,
// checks that the new room holds the same text, and only then replaces the old state
// (`migrate-rooms.ts`). The old state stays as a backup.

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  COLLABORATION_FORMAT_VERSION,
  createDocumentCollaboration,
  readCollaborationDocument,
  readCollaborationFormatVersion,
} from '@docx-editor.dev/pro/collaboration';
import { readOoxmlPackage, type OoxmlNode } from '@docx-editor.dev/core/store';

/** Whether saved room state is already in the format this build writes. */
export function isCurrentFormat(state: Uint8Array): boolean {
  const room = new Y.Doc();
  try {
    Y.applyUpdate(room, state);
    return readCollaborationFormatVersion(room) === COLLABORATION_FORMAT_VERSION;
  } finally {
    room.destroy();
  }
}

/** A paragraph of a `.docx`: its text, and whether the editor shows it as a paragraph. */
export interface ParagraphText {
  readonly text: string;
  readonly shown: boolean;
}

/** Every paragraph of a `.docx`, in document order, with tables and notes. */
export function paragraphTexts(docx: Uint8Array): ParagraphText[] {
  const read = readOoxmlPackage(docx);
  if (!read.ok) throw new Error(`the export cannot be read: ${read.reason}`);
  const texts: ParagraphText[] = [];
  const textOf = (node: OoxmlNode): string =>
    node.kind === 'textValue' ? node.value : node.children.map(textOf).join('');
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'p') {
      // Each paragraph counts, shown or not: one the editor cannot show is still text a
      // person wrote.
      texts.push({ text: textOf(node), shown: node.kind === 'paragraph' });
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const part of read.package.parts.values()) visit(part.root);
  return texts;
}

/** Room state in the current format, seeded from an export, and checked against it. */
export async function migrateRoom(
  exported: Uint8Array,
  documentId: string
): Promise<{
  readonly state: Uint8Array;
  readonly paragraphs: number;
  /** Paragraphs the new room keeps but the editor cannot show or edit. */
  readonly hidden: number;
}> {
  const room = new Y.Doc();
  const awareness = new Awareness(room);
  try {
    const handle = await createDocumentCollaboration({
      ydoc: room,
      awareness,
      documentId,
      identity: { actorId: 'room-migration', name: 'Room migration' },
      bootstrap: { kind: 'create', document: exported },
    });
    handle.destroy();
    const state = Y.encodeStateAsUpdate(room);
    // The new room must hold every paragraph the export holds, with the same text. A
    // paragraph the seed could not show would otherwise leave the room without a trace.
    const before = paragraphTexts(exported);
    const after = paragraphTexts(readCollaborationDocument(room));
    if (before.length !== after.length) {
      throw new Error(`the export has ${before.length} paragraphs, the new room ${after.length}`);
    }
    const changed = before.findIndex((paragraph, index) => paragraph.text !== after[index]!.text);
    if (changed >= 0) throw new Error(`paragraph ${changed + 1} differs in the new room`);
    const hidden = after.filter((paragraph) => !paragraph.shown).length;
    return { state, paragraphs: before.length, hidden };
  } finally {
    awareness.destroy();
    room.destroy();
  }
}
