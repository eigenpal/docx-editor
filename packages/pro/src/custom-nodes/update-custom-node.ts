/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The rest of the write story: change or remove an EXISTING custom node by its canonical
// node id (the `nodeId` every `ActivatedCustomNode` and `kind: 'custom'` review item
// carries). An update is remove+reinsert at the node's own span, in ONE transaction and
// one undo step — the tag codec has no in-place rewrite, and pretending it did would put
// a second write path beside `insertInlineContentControl`.

import type { Editor, ExecResult } from '@docx-editor.dev/core/contracts/editor';
import type { PaginatedSurface } from '@docx-editor.dev/core/editor';
import {
  boundCustomXmlNodeIdOf,
  contentControlsIn,
  customXmlDataParts,
  segmentsOf,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { CustomNodeDefinition } from './define-custom-node.ts';
import { describeRefusal, payloadFor } from './insert-custom-node.ts';
import { encodeCustomNodeTag } from './tag-codec.ts';

/** Instance-only surface on the concrete facade, the same escape hatch chrome uses. */
function surfaceOf(editor: Editor): PaginatedSurface | null {
  const candidate = editor as Editor & { readonly surface?: PaginatedSurface | null };
  return candidate.surface ?? null;
}

/** The paragraph holding a node, found in one walk from the part root. */
function paragraphHolding(part: OoxmlPart, nodeId: string): OoxmlParagraphNode | null {
  let found: OoxmlParagraphNode | null = null;
  const contains = (node: OoxmlNode): boolean => {
    if (node.id === nodeId) return true;
    if (node.kind === 'textValue') return false;
    return node.children.some(contains);
  };
  const walk = (node: OoxmlNode, depth: number): void => {
    if (found || node.kind === 'textValue' || depth > 64) return;
    if (node.kind === 'paragraph') {
      if (contains(node)) found = node;
      return;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(part.root, 0);
  return found;
}

/** The UTF-16 span a node's content covers inside its paragraph. */
function spanOf(
  paragraph: OoxmlParagraphNode,
  nodeId: string
): { readonly start: number; readonly end: number } | null {
  const ids = new Set<string>();
  const collect = (node: OoxmlNode): void => {
    ids.add(node.id);
    if (node.kind === 'textValue') return;
    for (const child of node.children) collect(child);
  };
  const findControl = (node: OoxmlNode): OoxmlNode | null => {
    if (node.id === nodeId) return node;
    if (node.kind === 'textValue') return null;
    for (const child of node.children) {
      const hit = findControl(child);
      if (hit) return hit;
    }
    return null;
  };
  const control = findControl(paragraph);
  if (!control) return null;
  collect(control);
  let start = Number.MAX_SAFE_INTEGER;
  let end = -1;
  for (const segment of segmentsOf(paragraph)) {
    if (!ids.has(segment.runId)) continue;
    if (segment.start < start) start = segment.start;
    if (segment.end > end) end = segment.end;
  }
  // An EMPTY control has no segments; it still has a place — fall back to offset 0 only
  // when nothing else anchors it. Callers replace in place, so a wrong offset would move
  // the node; refuse instead.
  return end < 0 ? null : { start, end };
}

/**
 * Delete one custom node — wrapper AND content, one undo step.
 *
 * The default `contentLocked` chip deletes fine (the lock guards its characters, not its
 * existence); a `sdtLocked`/`sdtContentLocked` wrapper refuses with the engine's reason.
 */
export function removeCustomNode(editor: Editor, nodeId: string): ExecResult {
  const surface = surfaceOf(editor);
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is mounted' };
  // The control AND the payload it bound, in one transaction. The orphan sweep would collect
  // the payload on the next open regardless, but a document saved in between would carry a
  // payload for a chip that is gone.
  const removed = surface.session.removeCustomNode(nodeId);
  if (!removed.ok) return { ok: false, code: 'unsupported', reason: describeRefusal(removed) };
  return { ok: true, changed: true };
}

/**
 * How {@link updateCustomNode} rewrites the control it replaces.
 *
 * @public
 */
export interface UpdateCustomNodeOptions {
  /** `w:alias` for the rewritten control. */
  readonly alias?: string;
  /** `w:lock` for the rewritten control. Defaults to `contentLocked`, like the insert. */
  readonly lock?: false | 'sdtLocked' | 'sdtContentLocked' | 'contentLocked';
  /**
   * The payload the rewritten node carries.
   *
   * Written in the SAME transaction as the label, so an update cannot leave the two
   * disagreeing — which is the one way a bound chip could ever show text its payload does not
   * describe. Omitted, the node comes back with no payload at all; pass the old value through
   * to keep it.
   */
  readonly data?: unknown;
}

/**
 * Replace one custom node's attrs and text in place: the node is removed and a fresh one
 * with the new tag and label is inserted at its own span — ONE transaction, one undo step,
 * recognized by construction like `insertCustomNode`.
 *
 * ```ts
 * updateCustomNode(editor, citation, node.nodeId, { sourceId: 'src_2' }, '(Jones 2025)');
 * ```
 */
export function updateCustomNode(
  editor: Editor,
  definition: CustomNodeDefinition,
  nodeId: string,
  attrs: Readonly<Record<string, string>>,
  text: string,
  options: UpdateCustomNodeOptions = {}
): ExecResult {
  const surface = surfaceOf(editor);
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is mounted' };
  const encoded = encodeCustomNodeTag(definition.tagPrefix, definition.name, attrs);
  if (!encoded.ok) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: `the encoded tag is ${encoded.length} characters; Word caps w:tag at 64 — shorten the attrs`,
    };
  }
  const part = surface.session.part();
  const paragraph = paragraphHolding(part, nodeId);
  const span = paragraph ? spanOf(paragraph, nodeId) : null;
  if (!paragraph || !span) {
    return { ok: false, code: 'notFound', reason: 'no custom node with that id' };
  }
  // The payload keeps the id the node already had, so an update is an upsert in the store
  // rather than a new entry beside the old one.
  const payload = payloadFor(
    surface,
    definition,
    options.data,
    text,
    boundNodeIdOf(surface, nodeId)
  );
  if (payload && 'reason' in payload) {
    return { ok: false, code: 'invalidArgs', reason: payload.reason };
  }
  const lock = options.lock === undefined ? 'contentLocked' : options.lock;
  const written = surface.session.insertCustomNode({
    replaceControlId: nodeId,
    paragraphId: paragraph.id,
    offset: span.start,
    tag: encoded.tag,
    text,
    ...(options.alias === undefined ? {} : { alias: options.alias }),
    ...(lock === false ? {} : { lock }),
    ...(payload ? { payload: payload.value } : {}),
  });
  if (!written.ok) {
    return { ok: false, code: 'unsupported', reason: describeRefusal(written) };
  }
  return { ok: true, changed: true };
}

/** The store node this control already binds, so a rewrite reuses the id rather than minting one. */
function boundNodeIdOf(surface: PaginatedSurface, controlNodeId: string): string | undefined {
  const part = surface.session.part();
  const control = contentControlsIn(part.root).find((entry) => entry.node.id === controlNodeId);
  if (!control) return undefined;
  for (const dataPart of customXmlDataParts(surface.session.currentPackage(), part.name)) {
    const bound = boundCustomXmlNodeIdOf(control.node, dataPart.itemId);
    if (bound !== null) return bound;
  }
  return undefined;
}
