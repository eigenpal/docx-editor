// The vocabulary both entry points share.
//
// One list, re-exported by the neutral entry and by the browser entry, so the two cannot drift into
// offering different types for the same concepts.
//
// WHAT IS PUBLIC is the lifecycle and its vocabulary — the runtimes, the request context, tracked
// objects, the proxy and result base types, the load options, the error codes — and the object model
// a context hands out. The model classes are exported so a consumer can NAME them in their own
// signatures (`function summarize(body: Body)`); every constructor is private, because the only way
// to get one is to be given one. What is NOT public is how they are built: `model-support.ts`, the
// object paths and the action queues are this package's, so the shape of the model can change
// without changing what a consumer can hold.

export {
  Body,
  Document,
  Paragraph,
  ParagraphCollection,
  Range,
  RangeCollection,
  type BesideLocation,
  type BodyInsertParagraphLocation,
  type BodyInsertTextLocation,
  type InsertLocation,
  type ParagraphInsertTextLocation,
  type RangeInsertTextLocation,
  type SearchOptions,
  type SelectionMode,
} from '../model/index.ts';
export { ClientObject } from './client-object.ts';
export { ClientResult } from './client-result.ts';
export {
  DocxEditorError,
  isDocxEditorError,
  type DocxEditorErrorCode,
  type DocxEditorErrorInit,
} from './errors.ts';
export type { LoadOption, LoadQueryOptions } from './load-options.ts';
export { RequestContext } from './request-context.ts';
export type { DocxEditorRuntime, DocxEditorServerRuntime, RunCallback } from './runtime.ts';
export type { CreateServerOptions } from './server.ts';
export { TrackedObjects } from './tracked-objects.ts';
