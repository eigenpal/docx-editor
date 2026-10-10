import {
  assertDocumentCollaborationCompatibility,
  assertCollaborationFormatCompatibility,
  CollaborationSchemaError,
  COLLABORATION_FORMAT_VERSION,
} from '@docx-editor.dev/pro/collaboration';

export function admissionError(reason: string): Error & { readonly reason: string } {
  // Hocuspocus v4 sends .reason in its permission-denied message.
  return Object.assign(new Error(reason), { reason });
}

/** This example's authentication envelope; the provider's public token contract stays a string. */
export function encodeDemoToken(token: string): string {
  return JSON.stringify({ token, collaborationVersion: COLLABORATION_FORMAT_VERSION });
}

/** Authenticate and reject incompatible clients before Hocuspocus allows document sync. */
export function authenticateDemoToken(encoded: string, expectedToken: string): void {
  // A valid raw secret from the previous demo is still an incompatible handshake,
  // including secrets that themselves happen to be valid JSON.
  if (encoded === expectedToken) throw admissionError('collaboration-format-mismatch');
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
  try {
    if ('collaborationVersion' in envelope) {
      assertCollaborationFormatCompatibility(envelope.collaborationVersion);
    } else if ('versions' in envelope) {
      // Retain admission for compatible clients using this demo's previous envelope.
      assertDocumentCollaborationCompatibility(envelope.versions);
    } else {
      throw admissionError('collaboration-format-mismatch');
    }
  } catch (error) {
    // Hocuspocus sends .reason as the authentication failure reason. Preserve a stable
    // code for this demo's recovery screen without changing the library transport contract.
    if (error instanceof CollaborationSchemaError) throw admissionError(error.code);
    throw error;
  }
}
