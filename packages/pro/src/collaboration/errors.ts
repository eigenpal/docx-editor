/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { CollaborationFailureCode } from '@docx-editor.dev/core/collaboration';

const COLLABORATION_UPGRADE_GUIDE_URL =
  'https://www.docx-editor.dev/docs/2.x/pro/collaboration-versions';

/**
 * Typed collaboration schema or trust-boundary failure.
 * Version-mismatch messages include recovery guidance and a documentation link.
 * Use `code` for application logic; `detail` remains diagnostic information.
 * @public
 */
export class CollaborationSchemaError extends Error {
  constructor(
    /** Stable failure code. Branch on it. */
    readonly code: CollaborationFailureCode,
    /** Bounded diagnostic text for logs. Not a parsing contract. */
    readonly detail?: string
  ) {
    const versionMismatch =
      code === 'collaboration-format-mismatch' ||
      code === 'protocol-version-mismatch' ||
      code === 'schema-version-mismatch';
    const diagnostic = detail ? `${code}: ${detail}` : code;
    super(
      versionMismatch
        ? `${diagnostic}\nCollaboration upgrade required. Save local changes and use a compatible app version, or upgrade the saved room. See ${COLLABORATION_UPGRADE_GUIDE_URL}#upgrade-saved-rooms`
        : diagnostic
    );
    this.name = 'CollaborationSchemaError';
  }
}
