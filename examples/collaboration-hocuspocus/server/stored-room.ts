import * as Y from 'yjs';
import {
  CollaborationSchemaError,
  readCollaborationDocument,
} from '@docx-editor.dev/pro/collaboration';
import { admissionError } from '../shared/admission.ts';

/** Validate a saved room before admitting its state into the server's live document. */
export function loadStoredDemoDocument(document: Y.Doc, stored: Uint8Array): void {
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(candidate, stored);
    // This public read validates persisted versions and package state. Client compatibility
    // alone cannot admit an older room, and this demo does not migrate saved Yjs snapshots.
    readCollaborationDocument(candidate);
  } catch (error) {
    if (
      error instanceof CollaborationSchemaError &&
      (error.code === 'protocol-version-mismatch' || error.code === 'schema-version-mismatch')
    ) {
      throw admissionError(error.code);
    }
    const refusal = admissionError('invalid-saved-room');
    refusal.cause = error;
    throw refusal;
  } finally {
    candidate.destroy();
  }
  Y.applyUpdate(document, stored);
}
