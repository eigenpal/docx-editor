// The vocabulary both entry points share.
//
// One list, re-exported by the neutral entry and by the browser entry, so the two cannot drift into
// offering different types for the same concepts.
//
// WHAT IS PUBLIC is the lifecycle and its vocabulary: the runtimes, the request context, tracked
// objects, the proxy and result base types, the load options, and the error codes. What is NOT
// public is how objects are built on top of it — `model-support.ts`, the object paths and the action
// queues are this package's, so the shape of the model can change without changing what a consumer
// can hold.

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
