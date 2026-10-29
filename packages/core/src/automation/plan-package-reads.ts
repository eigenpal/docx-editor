// The operations that address the package as a whole: its styles, its document properties, and
// its sections' page setup reads.
//
// INTERNAL. Split out of `plan.ts` so the main planner keeps room under its line cap. Each case
// behaves exactly as it did inline; nothing here opens a story transaction except the document
// property writes, which go through the `pin` the planner hands in.

import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import { planDocumentProperties } from './plan-document-properties.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationPackageReads } from './reads.ts';
import { planStyleListing } from './style-listing.ts';

/** The operations this sub-planner answers. */
export type AutomationPackageOperation = Extract<
  AutomationOperation,
  {
    op:
      | 'getStyles'
      | 'getDocumentProperty'
      | 'setDocumentProperties'
      | 'removeDocumentInformation'
      | 'getSections'
      | 'getPageSetup';
  }
>;

export interface PackagePlannerContext {
  readonly reads: AutomationPackageReads;
  readonly handles: AutomationHandleTable;
  /** Pins a document property write to the body story, or answers why it cannot be. */
  readonly pin: () => PlannedOperation | null;
  /** False on a collaborative host, where a write may not create a part. */
  readonly supportsPartCreation: boolean;
}

function invalidHandle(message: string, detail?: string): PlannedOperation {
  return {
    ok: false,
    // Frozen, like the main planner's refusals.
    error: Object.freeze(
      detail === undefined
        ? { code: 'invalid-handle' as const, message }
        : { code: 'invalid-handle' as const, message, detail }
    ),
  };
}

/** Plan one package-level operation. */
export function planPackageOperation(
  operation: AutomationPackageOperation,
  context: PackagePlannerContext
): PlannedOperation {
  const { reads, handles } = context;
  switch (operation.op) {
    case 'getStyles':
      return planStyleListing(operation, reads);
    case 'getSections':
      if (!handles.resolve(operation.document, 'document'))
        return invalidHandle('that handle does not name a document', 'document');
      return {
        ok: true,
        kind: 'query',
        value: {
          kind: 'handles',
          handles: reads.sections().map((section) => handles.section(section.index)),
        },
      };
    case 'getPageSetup': {
      const target = handles.resolve(operation.section, 'section');
      if (!target || target.kind !== 'section')
        return invalidHandle('that handle does not name a section', 'section');
      const section = reads.sections()[target.index];
      if (!section) return invalidHandle('that section is not in this document');
      return { ok: true, kind: 'query', value: { kind: 'pageSetup', setup: section.pageSetup } };
    }
    default:
      return planDocumentProperties(operation, reads, context.pin, context.supportsPartCreation);
  }
}
