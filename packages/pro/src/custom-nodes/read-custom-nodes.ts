/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// "What custom nodes does this document have?", as one call.
//
// Answering it by hand meant `editor.surface.session.part()`, `.currentPackage()`, and
// `customNodePayloadsByControl` imported from `@docx-editor.dev/core/store` — three engine
// internals to use a pro feature, none of them mentioned on the pro surface. Worse, the obvious
// shortcut (`recognizeCustomNodes(part, definitions)`) compiles and returns every node with no
// payload at all, which is indistinguishable from a document whose nodes genuinely carry none.

import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { PaginatedSurface } from '@docx-editor.dev/core/editor';
import { customNodePayloadsByControl } from '@docx-editor.dev/core/store';
import {
  isCustomNodeDefinition,
  recognizeCustomNodes,
  type AnyCustomNodeDefinition,
  type CustomNodeDiagnostic,
  type RecognizedCustomNode,
} from './define-custom-node.ts';

/** How {@link customNodesOf} narrows what it answers. */
export interface CustomNodesOfOptions {
  /**
   * Which definitions to recognize. Defaults to everything registered on the editor, which is
   * what a host almost always wants — passing a subset answers only those.
   */
  readonly nodes?: readonly AnyCustomNodeDefinition[];
  /**
   * Told about a node whose payload could not be read.
   *
   * Defaults to the listeners the editor's own modules registered, so a host that passed
   * `onDiagnostic` to `customNodesModule` hears from this call too without repeating itself.
   */
  readonly onDiagnostic?: (diagnostic: CustomNodeDiagnostic) => void;
}

/**
 * Every recognized custom node in the editor's body, in document order, with its payload.
 *
 * ```ts
 * for (const node of customNodesOf(editor)) {
 *   const citation = Citation.dataOf(node);
 *   if (citation) index.add(citation.sourceId);
 * }
 * ```
 *
 * Reads the body story. A node in a header or footer is not answered here — the same limit
 * `recognizeCustomNodes` has, since it takes one part.
 *
 * Derived fresh on every call from the canonical package: there is no cache to go stale, and no
 * change event either, so re-read after an edit rather than holding the array.
 */
export function customNodesOf(
  editor: Editor,
  options: CustomNodesOfOptions = {}
): readonly RecognizedCustomNode[] {
  const surface = surfaceOf(editor);
  if (!surface) return [];
  const definitions =
    options.nodes ?? editor.getCustomNodeDefinitions().filter(isCustomNodeDefinition);
  if (definitions.length === 0) return [];
  // EVERY STORY, not the body alone. A chip in a header is a chip in the document, and reading
  // only the body reported a document with fewer of them than the review queue beside it listed
  // — so a host building a picker from this could not offer the one the reader was looking at.
  const pkg = surface.session.currentPackage();
  // The store hangs off the MAIN part in every case: Word only reads one authored there. So the
  // part that holds the CONTROLS and the part that relates the STORE are two questions, and a
  // furniture story answers them differently.
  const owner = surface.session.part().name;
  const onDiagnostic =
    options.onDiagnostic ??
    ((diagnostic: CustomNodeDiagnostic) => {
      editor.reportCustomNodeDiagnostic(diagnostic);
    });
  return surface.session.storyParts().flatMap((part) =>
    recognizeCustomNodes(part, definitions, {
      payloads: customNodePayloadsByControl(pkg, part.name, owner),
      onDiagnostic,
    })
  );
}

/** Instance-only surface on the concrete facade, the same escape hatch the write path uses. */
function surfaceOf(editor: Editor): PaginatedSurface | null {
  const candidate = editor as Editor & { readonly surface?: PaginatedSurface | null };
  return candidate.surface ?? null;
}
