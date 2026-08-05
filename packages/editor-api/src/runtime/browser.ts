/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A runtime over an editor that is already open.
//
// It borrows, it does not own. The editor keeps its lifetime, its undo history and its caret; this
// runtime's `dispose()` releases the host adapter's subscription and leaves the editor mounted and
// editable. A batch here goes through the same transaction a keystroke does, so a scripted edit
// and a typed edit are the same edit and the painted pages repaint from it either way.
//
// NO `save()`. The editor already answers "what is the current document", and a second way to ask
// would be a second answer to keep in step. A host embedding the editor saves through the editor.
//
// This is the only module in the runtime that reaches the browser side of the engine. Everything
// else — the queue, the context, the object lifetime, the errors — is neutral and compiles without
// the DOM lib, which is what `__tests__/runtime-boundaries.test.ts` holds in place.

import { createBrowserAutomationHost, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { createRuntime, type DocxEditorRuntime } from './runtime.ts';

// The editor instance, not the narrower `Editor` a document command programs against: the host
// adapter reads `editor.surface`, so an editor that only satisfies `Editor` would answer
// `document-unavailable` to every operation. Re-exported so the entry can write the signature
// down without naming the editor lane a second time.
export type { DocxEditorInstance };

export function createBrowser(editor: DocxEditorInstance): DocxEditorRuntime {
  return createRuntime({ host: createBrowserAutomationHost(editor), save: false });
}
