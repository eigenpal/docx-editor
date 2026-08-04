// Everything an object model needs from the runtime, in one import.
//
// The published object model is a later slice, and it will be many small files. Each of them
// importing six runtime modules directly would make the runtime's internal file layout part of
// how the model is written — and then a rename inside the runtime would be a change to dozens of
// model files. This is the seam: the model imports from here, the runtime is free to move.
//
// It is NOT the package's public surface. Nothing here is re-exported from the package entry: a
// consumer gets objects and errors, not the tools for making objects. That distinction is the
// same one the core automation lane draws by not exporting its host composition factory.

export { ClientObject } from './client-object.ts';
export { ClientResult, clientResult } from './client-result.ts';
export { DocxEditorError, fail, type DocxEditorErrorCode } from './errors.ts';
export {
  hydratedApplied,
  hydratedHandle,
  hydratedHandles,
  hydratedSpan,
  hydratedSpans,
  hydratedText,
} from './hydrate.ts';
export { internalsOf, type ContextInternals, type RootHandles } from './internals.ts';
export { ObjectPath, type ObjectPathState } from './object-path.ts';
export {
  resolveLoadOption,
  type LoadOption,
  type LoadQueryOptions,
  type ResolvedLoadOptions,
} from './load-options.ts';
export type { ActionSort, QueuedAction } from './queue.ts';
export { RequestContext } from './request-context.ts';
export { selectedProperties } from './selection.ts';
export type {
  AutomationHandle,
  AutomationSearchOptions,
  AutomationSpan,
  AutomationSpanRef,
} from '@docx-editor.dev/core-contract/automation';
