/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The copy that leaves, from the editor that holds it.
//
// `editor.save()` answers the copy you KEEP: tags, bindings and payloads intact, so reopening it
// here gives the chips back. This answers the copy that GOES, with every definition's
// `preserveOnExport` applied. Two files out of one document, which is why they are two calls —
// one call would have to choose, and whichever it chose would be wrong for the other case.
//
// WHY IT TAKES THE EDITOR AND NOT THE BYTES. `prepareForExport` needs the definition list spelled
// out, and a definition missing from that list is not touched — so the failure mode is a host
// that registered three node types, listed two, and shipped the third to a recipient it was
// meant to be hidden from. Nothing warns; the export reports `ok`. The editor already holds every
// registered definition, so asking it removes the chance to get the list wrong.
//
// Split from `export-custom-nodes.ts` so that file stays reachable with no editor and no DOM.

import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { isCustomNodeDefinition, type AnyCustomNodeDefinition } from './define-custom-node.ts';
import {
  prepareForExport,
  type DocumentExportOptions,
  type DocumentExportResult,
} from './export-custom-nodes.ts';

/**
 * How {@link saveForExport} treats this copy.
 *
 * @public
 */
export interface SaveForExportOptions extends DocumentExportOptions {
  /**
   * Which definitions to apply. Defaults to everything registered on the editor, which is the
   * answer a host almost always wants — passing a subset leaves the rest untouched, and an
   * untouched node travels whole.
   */
  readonly nodes?: readonly AnyCustomNodeDefinition[];
}

/**
 * Save the document as the copy that leaves your system.
 *
 * NOT THE DEFAULT PATH. A custom node is an ordinary inline content control: Word and Word Online
 * both render its text and hand the tag, binding and payload back unchanged, so `editor.save()`
 * already produces a file that opens correctly for a recipient who has never heard of this
 * library. This is for the narrower case where the recipient should not have the nodes at all —
 * internal annotations that must not leave, markup that means nothing outside your system.
 *
 * `editor.save()` is the copy you keep — every node intact, reopens here with the chips working.
 * This is its pair: the same document with each definition's `preserveOnExport` applied, for a
 * download, an attachment, or a hand-off you want stripped.
 *
 * ```ts
 * await storage.put(docId, new Uint8Array(await editor.save())); // yours
 *
 * const outgoing = await saveForExport(editor);                  // theirs
 * if (outgoing.ok) download(outgoing.bytes);
 * ```
 *
 * Store the saved bytes, never these. What the export stripped is gone for good: unwrapped text
 * does not become a node again. Produce this copy fresh from the saved one each time you hand
 * one out.
 *
 * Definitions come from the editor's registered modules, so a node cannot leave because a list
 * forgot it. On a server, where there is no editor, use `prepareForExport` with an explicit list.
 *
 * @public
 */
export async function saveForExport(
  editor: Editor,
  options: SaveForExportOptions = {}
): Promise<DocumentExportResult> {
  const definitions =
    options.nodes ?? editor.getCustomNodeDefinitions().filter(isCustomNodeDefinition);
  const saved = await editor.save();
  return prepareForExport(new Uint8Array(saved), definitions, {
    ...(options.destination === undefined ? {} : { destination: options.destination }),
  });
}
