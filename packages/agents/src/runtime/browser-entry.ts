// The same runtime, for a page that already has an editor open.
//
//   const runtime = DocxEditor.createBrowser(editor);
//   await runtime.run(async (context) => { … });
//
// A separate subpath rather than a second export from `./runtime`, because `createBrowser` reaches
// the editor lane, and the editor lane brings the painted engine and its font shaper with it. Both
// namespaces expose `createServer`: opening bytes is neutral, and a page that opens an attachment
// beside the document it is showing should not need two imports.

import { createBrowser } from './browser.ts';
import { createServer } from './server.ts';

export * from './public.ts';

/** The entry point, with the editor-bound factory. A superset of the one at `./runtime`. */
export const DocxEditor = Object.freeze({
  /** A runtime over an editor that is already open. The editor keeps its own lifetime. */
  createBrowser,
  /** A runtime over DOCX bytes. Additionally offers `save()`. */
  createServer,
});
