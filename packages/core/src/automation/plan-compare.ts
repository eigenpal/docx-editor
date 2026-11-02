// `compareFromBase64`: compare the open document with a revised DOCX and record the differences
// as tracked changes in the open document.
//
// INTERNAL. The engine comes from the host (a review module); the core ships none. The result
// replaces the package in one transaction, so it commits, replicates, and undoes as one unit.

import type { CompareDocumentsEngine } from '../contracts/document-compare.ts';
import type { AutomationOperation } from './operations.ts';
import { decodeBase64 } from './pictures.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationPackageReads } from './reads.ts';
import { BODY_STORY } from './stories.ts';

/** Largest revised document accepted, in decoded bytes. */
const MAX_REVISED_BYTES = 128 * 1024 * 1024;

export interface ComparePlannerContext {
  readonly reads: AutomationPackageReads;
  readonly engine: CompareDocumentsEngine | undefined;
  readonly collaborative: boolean;
  /** Pins the write to the body story, or answers why it cannot be. */
  readonly pin: () => PlannedOperation | null;
}

export function planCompare(
  operation: Extract<AutomationOperation, { op: 'compareFromBase64' }>,
  context: ComparePlannerContext
): PlannedOperation {
  // Each refusal names a public diagnostic code (`debugInfo.innerError.code`), so a caller can
  // tell the causes apart without reading the message.
  const capability = (message: string, detail: string): PlannedOperation => ({
    ok: false,
    error: { code: 'unsupported-capability', message, detail },
  });
  if (!context.engine)
    return capability('Document compare needs the review module.', 'review-module-required');
  if (context.collaborative) {
    return capability(
      'Document compare is not available in a collaboration session.',
      'edit.operation-unsupported'
    );
  }
  const original = context.reads.package;
  if (!original)
    return { ok: false, error: { code: 'document-unavailable', message: 'document unavailable' } };
  const revised = decodeBase64(operation.base64, MAX_REVISED_BYTES);
  if (!revised) {
    return {
      ok: false,
      error: {
        code: 'unsupported-content',
        message: 'base64File is not valid base64 of a supported size.',
        detail: 'edit.invalid-argument',
      },
    };
  }
  const result = context.engine(original, revised, {
    ...(operation.authorName === undefined ? {} : { authorName: operation.authorName }),
    ...(operation.detectFormatChanges === undefined
      ? {}
      : { detectFormatChanges: operation.detectFormatChanges }),
    ...(operation.removeDateAndTime === undefined
      ? {}
      : { removeDateAndTime: operation.removeDateAndTime }),
  });
  if (!result.ok) {
    switch (result.code) {
      case 'invalid-revised':
        return {
          ok: false,
          error: {
            code: 'unsupported-content',
            message: result.message,
            detail: 'edit.invalid-argument',
          },
        };
      case 'too-large':
        return capability(result.message, 'edit.resource-limit');
      case 'protected':
        return {
          ok: false,
          error: {
            code: 'unsupported-revision',
            message: result.message,
            detail: 'edit.protected-content',
          },
        };
      default:
        return {
          ok: false,
          error: {
            code: 'unsupported-revision',
            message: result.message,
            detail: 'edit.unsupported-content',
          },
        };
    }
  }
  const conflict = context.pin();
  if (conflict) return conflict;
  const compared = result.package;
  return {
    ok: true,
    kind: 'command',
    story: BODY_STORY,
    ops: [],
    packageEdits: [() => compared],
    answer: () => ({ kind: 'applied' }),
  };
}
