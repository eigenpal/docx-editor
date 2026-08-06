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
// const bytes = new Uint8Array(await editor.save());
// const exported = exportCustomNodes(bytes, [citation, figure]);
// if (exported.ok) download(exported.bytes);
// ```
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
import type { CustomNodeDefinition } from './define-custom-node.ts';
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
export type ExportCustomNodesResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      /** Controls unwrapped to their text, and controls removed outright. */
      readonly unwrapped: number;
      readonly removed: number;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Apply every definition's `preserveOnExport` to a document, and answer the bytes to ship.
 *
 * `true` (the default) leaves a node untouched. `'text'` unwraps the control, keeping the words
 * and dropping the tag, the binding and the payload. `false` removes the node with its content.
 * A tag no definition claims is never touched — this is a host applying its own policy to its
 * own markup, not a scrub of the document.
 *
 * Applied to EVERY story, so a chip in a header is treated like a chip in the body. The payload
 * stores hang off the main document part, which is where Word enumerates its data store from, so
 * that is the only part they are cleaned up against.
 */
export function exportCustomNodes(
  bytes: Uint8Array,
  definitions: readonly CustomNodeDefinition[]
): ExportCustomNodesResult {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) return { ok: false, reason: `the document could not be read: ${read.reason}` };

  const byIdentity = new Map<string, CustomNodeDefinition>();
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
  for (const partName of storyPartNames(pkg)) {
    const applied = withExportedCustomNodes(pkg, {
      storyPartName: partName,
      // The stores are related to the MAIN part, so that is the only pass that may remove one.
      namespaces: partName === pkg.mainDocumentPart ? namespaces : [],
      decide,
    });
    if (!applied.ok) return { ok: false, reason: applied.reason };
    pkg = applied.pkg;
    unwrapped += applied.unwrapped;
    removed += applied.removed;
  }
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
