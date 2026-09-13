import {
  assertDocumentCollaborationCompatibility,
  CollaborationSchemaError,
  DOCUMENT_COLLABORATION_VERSIONS,
} from '@docx-editor.dev/pro/collaboration';

export function admissionError(reason: string): Error & { readonly reason: string } {
  // Hocuspocus v4 sends .reason in its permission-denied message.
  return Object.assign(new Error(reason), { reason });
}

/** This example's authentication envelope; the provider's public token contract stays a string. */
export function encodeDemoToken(token: string): string {
  return JSON.stringify({ token, versions: DOCUMENT_COLLABORATION_VERSIONS });
}

/** Authenticate and reject incompatible clients before Hocuspocus allows document sync. */
export function authenticateDemoToken(encoded: string, expectedToken: string): void {
  // A valid raw secret from the previous demo is still an incompatible handshake,
  // including secrets that themselves happen to be valid JSON.
  if (encoded === expectedToken) throw admissionError('collaboration-version-required');
  let envelope: unknown;
  try {
    envelope = JSON.parse(encoded);
  } catch {
    throw admissionError('invalid token');
  }
  if (
    envelope === null ||
    typeof envelope !== 'object' ||
    Array.isArray(envelope) ||
    !('token' in envelope) ||
    envelope.token !== expectedToken
  ) {
    throw admissionError('invalid token');
  }
  if (!('versions' in envelope)) throw admissionError('collaboration-version-required');
  try {
    assertDocumentCollaborationCompatibility(envelope.versions);
  } catch (error) {
    // Hocuspocus sends .reason as the authentication failure reason. Preserve a stable
    // code for this demo's recovery screen without changing the library transport contract.
    if (error instanceof CollaborationSchemaError) throw admissionError(error.code);
    throw error;
  }
}
