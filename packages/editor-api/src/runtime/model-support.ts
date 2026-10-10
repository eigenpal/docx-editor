/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
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
  hydratedFlag,
  hydratedFont,
  hydratedHandle,
  hydratedHandles,
  hydratedNumber,
  hydratedPageSetup,
  hydratedParagraphFormat,
  hydratedSpan,
  hydratedSpans,
  hydratedStyle,
  hydratedText,
} from './hydrate.ts';
export { internalsOf, type ContextInternals, type RootHandles } from './internals.ts';
export { ObjectPath, type ObjectAddress, type ObjectPathState } from './object-path.ts';
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
  AutomationAlignment,
  AutomationContentControlRangeLocation,
  AutomationFontRead,
  AutomationFontWrite,
  AutomationHandle,
  AutomationOperation,
  AutomationPageOrientation,
  AutomationPageSetupRead,
  AutomationPageSetupWrite,
  AutomationParagraphFormatRead,
  AutomationParagraphFormatWrite,
  AutomationPoint,
  AutomationSearchOptions,
  AutomationSpan,
  AutomationSpanRef,
  AutomationValue,
} from '@docx-editor.dev/core/automation';
