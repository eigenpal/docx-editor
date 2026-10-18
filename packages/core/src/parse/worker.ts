// The editor's parse worker: reads a document's package off the page's thread.
//
// The editor starts this file itself when `parseInWorker` is on (`editor/parse-off-thread.ts`)
// and answers each request once. The build emits it as `dist/parse.js`, beside the bundle that
// loads it, and publishes it at `@docx-editor.dev/core/parse` only so a host can start it
// itself (`parseInWorker: () => new Worker(...)`). It exports nothing. The request and reply
// shapes belong to `store/package/parsed-document.ts`, which both sides import.
//
// This lane compiles without the DOM lib, so the worker scope is declared here: only the two
// members it uses.

import { answerParseRequest } from '../store/package/parsed-document.ts';

interface ParseWorkerScope {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
}

const scope = globalThis as unknown as ParseWorkerScope & { readonly document?: unknown };

// Imported into a page by mistake, it must not take over the window's messages.
if (scope.document === undefined) {
  scope.onmessage = (event) => {
    const answer = answerParseRequest(event.data);
    if (answer) scope.postMessage(answer.reply, answer.transfer);
  };
}
