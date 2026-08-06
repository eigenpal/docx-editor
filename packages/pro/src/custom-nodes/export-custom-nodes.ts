/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `preserveOnExport`, applied.
//
// A PIPELINE OF ITS OWN, not something `save()` does. That is the whole point of the option: one
// document serializes one way at rest — tags, bindings and payloads intact, so reopening it in
// this editor gives the chips back — and another on the way out. A host that wanted both from
// one call would have to choose, and whichever it chose would be wrong for the other case.
//
// ```ts
// await storage.put(docId, new Uint8Array(await editor.save())); // the copy you keep
// const outgoing = await saveForExport(editor);                  // the copy that leaves
// if (outgoing.ok) download(outgoing.bytes);
// ```
//
// TWO ENTRY POINTS, one pipeline. `saveForExport` takes the editor, which already holds every
// definition the host registered, so the common call cannot ship a node by forgetting to list it.
// `prepareForExport` takes bytes and an explicit list, for the server, where there is no editor
// to ask.
//
// WHAT IT DOES NOT DO. It removes THIS LIBRARY'S markup and nothing else. A `.docx` carries its
// origin in `docProps/app.xml`, `docProps/core.xml`, comment and revision authors, rsids and
// custom document properties, and none of those are touched. Calling the result anonymous would
// be false.

import {
  readOoxmlPackage,
  storyRootsOf,
  withExportedCustomNodes,
  writeOoxmlPackage,
  type CustomNodeExportPolicy,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import type { AnyCustomNodeDefinition } from './define-custom-node.ts';
import { decodeCustomNodeTag } from './tag-codec.ts';
import { customNodeNamespace } from './node-payload.ts';

/**
 * The exported document, or the reason there is not one.
 *
 * A refusal answers no bytes. "Stripping failed, here are the bytes anyway" is the one outcome
 * that must not be possible: a caller would ship the markup it asked to remove and have been
 * told the export succeeded.
 *
 * @public
 */
export type DocumentExportResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      /** Controls unwrapped to their text, and controls removed outright. */
      readonly unwrapped: number;
      readonly removed: number;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Where this copy of the document is going.
 *
 * The distinction the whole option exists for, made explicit at the call site so a host writes
 * intent rather than remembering which function strips:
 *
 *  - `internal` — the copy you keep. Your own storage, your own system, a draft a user will
 *    reopen HERE. Nothing is stripped, because a stripped copy reopens as plain text and the
 *    chips are gone for good.
 *  - `external` — the copy that leaves. A download, an email attachment, a hand-off to someone
 *    who does not run this library. `preserveOnExport` decides what travels.
 *
 * A UI with one Download button and a "keep our markup" checkbox drives both from one call.
 *
 * @public
 */
export type DocumentDestination = 'internal' | 'external';

/** How {@link saveForExport} and {@link prepareForExport} treat this copy. */
export interface DocumentExportOptions {
  /**
   * Defaults to `external`, because that is what calling an export function means.
   *
   * `internal` answers the bytes unchanged — the identity case, present so a caller with one
   * code path and a runtime choice does not need two.
   */
  readonly destination?: DocumentDestination;
}

/**
 * Apply every definition's `preserveOnExport` to a document, and answer the bytes to ship.
 *
 * The BYTES form, for a caller with no editor: a request handler, a queue worker, a build step, a
 * document `customNodeXml` authored server-side. In a browser with an editor mounted, reach for
 * {@link saveForExport} instead — it reads the definitions off the editor, so a node cannot leave
 * because the list passed here forgot it.
 *
 * `true` (the default) leaves a node untouched. `'text'` unwraps the control, keeping the words
 * and dropping the tag, the binding and the payload. `false` removes the node with its content.
 * A tag no definition claims is never touched — this is a host applying its own policy to its
 * own markup, not a scrub of the document.
 *
 * ```ts
 * const generated = await renderContract(order);
 * const outgoing = prepareForExport(generated, [Clause, InternalNote]);
 * if (outgoing.ok) await email.attach(outgoing.bytes);
 * ```
 *
 * Applied to EVERY story, so a chip in a header is treated like a chip in the body. The payload
 * stores hang off the main document part, which is where Word enumerates its data store from, so
 * that is the only part they are cleaned up against.
 */
export function prepareForExport(
  bytes: Uint8Array,
  definitions: readonly AnyCustomNodeDefinition[],
  options: DocumentExportOptions = {}
): DocumentExportResult {
  // THE COPY YOU KEEP. Answered before anything is parsed: an internal save must be the bytes
  // the editor produced, not a re-serialization of them, so a round trip through here cannot
  // become a way for the export path to touch a document it was told to leave alone.
  if (options.destination === 'internal') {
    return { ok: true, bytes, unwrapped: 0, removed: 0 };
  }

  const read = readOoxmlPackage(bytes);
  if (!read.ok) return { ok: false, reason: `the document could not be read: ${read.reason}` };

  const byIdentity = new Map<string, AnyCustomNodeDefinition>();
  for (const definition of definitions) {
    byIdentity.set(`${definition.tagPrefix}:${definition.name}`, definition);
  }
  const decide = (tag: string): CustomNodeExportPolicy => {
    const decoded = decodeCustomNodeTag(tag);
    if (!decoded) return 'keep';
    const definition = byIdentity.get(`${decoded.prefix}:${decoded.name}`);
    if (!definition) return 'keep';
    if (definition.preserveOnExport === 'text') return 'text';
    return definition.preserveOnExport === false ? 'remove' : 'keep';
  };
  // Only the namespaces of definitions that are actually leaving. A store belonging to a
  // definition the host said to preserve is not this call's to tidy — collecting orphans is the
  // open-time sweep's decision, and an export that also swept would make the two indistinguishable.
  const namespaces = [
    ...new Set(
      definitions
        .filter((definition) => definition.preserveOnExport !== undefined)
        .filter((definition) => definition.preserveOnExport !== true)
        .map(customNodeNamespace)
    ),
  ];

  let pkg: OoxmlPackage = read.package;
  let unwrapped = 0;
  let removed = 0;
  // EVERY STORY FIRST, then the stores. The cleanup asks "does anything still bind this
  // payload", which is a question about the finished document — asking it during the main-part
  // pass answered "yes" for a chip in a header that had not been unwrapped yet, so the store
  // survived, the header chip was then unwrapped, and the export shipped the payload of a node
  // the caller had asked to remove.
  const stories = storyPartNames(pkg);
  for (const partName of stories) {
    const applied = withExportedCustomNodes(pkg, {
      storyPartName: partName,
      namespaces: [],
      decide,
    });
    if (!applied.ok) return { ok: false, reason: applied.reason };
    pkg = applied.pkg;
    unwrapped += applied.unwrapped;
    removed += applied.removed;
  }
  // The stores hang off the main document part, which is where Word enumerates its data store
  // from, so that is the part they are cleaned up against.
  const cleaned = withExportedCustomNodes(pkg, {
    storyPartName: pkg.mainDocumentPart,
    namespaces,
    decide: () => 'keep',
  });
  if (!cleaned.ok) return { ok: false, reason: cleaned.reason };
  pkg = cleaned.pkg;
  return { ok: true, bytes: writeOoxmlPackage(pkg), unwrapped, removed };
}

/**
 * Every part holding a story, main part first.
 *
 * By SHAPE rather than by name: a header part is whatever the relationships called it, and a
 * document from another producer is entitled to name it something this list would not have
 * guessed.
 */
function storyPartNames(pkg: OoxmlPackage): readonly string[] {
  const names: string[] = [];
  for (const [name, part] of pkg.parts) {
    if (name === pkg.mainDocumentPart) continue;
    if (storyRootsOf(part).length === 0) continue;
    names.push(name);
  }
  return [pkg.mainDocumentPart, ...names];
}
