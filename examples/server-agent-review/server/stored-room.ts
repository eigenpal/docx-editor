import { readFile } from 'node:fs/promises';
import * as Y from 'yjs';
import {
  CollaborationSchemaError,
  compactCollaborationState,
} from '@docx-editor.dev/pro/collaboration';
import { atomicWrite } from './files.ts';

/** Validate saved state before it can enter a prepared live room. */
export async function loadStoredReviewRoom(document: Y.Doc, file: string): Promise<void> {
  let stored: Uint8Array;
  try {
    stored = new Uint8Array(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  let compacted: Uint8Array | null;
  try {
    compacted = await compactCollaborationState(stored);
  } catch (error) {
    const reason =
      error instanceof CollaborationSchemaError &&
      [
        'collaboration-format-mismatch',
        'protocol-version-mismatch',
        'schema-version-mismatch',
      ].includes(error.code)
        ? error.code
        : 'invalid-saved-room';
    throw Object.assign(new Error(reason, { cause: error }), { reason });
  }
  if (compacted) await atomicWrite(file, compacted);
  Y.applyUpdate(document, compacted ?? stored);
}
