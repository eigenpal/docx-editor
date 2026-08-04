// A runtime over DOCX bytes, with no browser anywhere.
//
// `async` even though opening a package is synchronous today. Opening a document is exactly the
// operation that acquires resources — and a caller who wrote `await` can be handed a runtime that
// streams, fetches or hands the work to a worker later, without their code changing. A
// synchronous signature would make that a breaking change.
//
// UNTRUSTED BYTES. A `.docx` is a zip of XML an attacker controls end to end, and every one of
// those defences lives in the core reader this calls: decompression-ratio and size caps, part and
// relationship path validation, DTD/entity-free XML. This module adds no parsing of its own, and
// a refusal comes back as `InvalidArgument` rather than as a throw from inside a zip decoder.
// Nothing about WHY the document was refused is put in the message: a caller opening files they
// did not author gets "not a document this API can open", and a probe cannot use the error to
// learn about the reader's limits.

import {
  createServerAutomationHost,
  type ServerAutomationHostOptions,
} from '@docx-editor.dev/core-contract/automation';
import { fail } from './errors.ts';
import { createRuntime, type DocxEditorServerRuntime } from './runtime.ts';

export interface CreateServerOptions {
  /**
   * Tighter budgets for the bounded reader — zip ratio, part count, XML depth.
   *
   * Exposed because a server opening documents it did not author is exactly where a caller may
   * want smaller limits than the defaults. Omitted means the engine's own defaults.
   */
  readonly limits?: ServerAutomationHostOptions['limits'];
}

export async function createServer(
  bytes: Uint8Array,
  options: CreateServerOptions = {}
): Promise<DocxEditorServerRuntime> {
  const opened = createServerAutomationHost(bytes, {
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  if (!opened.ok) fail({ code: 'InvalidArgument', target: 'createServer' });
  return createRuntime({ host: opened.host, save: true });
}
