/** @spike-features engine-neutral-editor-driver-contract */
export const POC_STORY_ID = 'story-body-0';

export const BINDING_RECONCILIATION_ORIGIN = 'poc-binding-reconciliation';

export function isBindingReconciliationOrigin(origin: unknown): origin is typeof BINDING_RECONCILIATION_ORIGIN {
  return origin === BINDING_RECONCILIATION_ORIGIN;
}
