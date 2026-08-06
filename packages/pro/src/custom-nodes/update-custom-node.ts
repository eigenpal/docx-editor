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

import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { PaginatedSurface } from '@docx-editor.dev/core/editor';
import {
  customNodePayloadsByControl,
  segmentsOf,
  type CustomNodePayloadRead,
  type CustomNodePayloadWrite,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { AnyCustomNodeDefinition, CustomNodeDefinition } from './define-custom-node.ts';
import { CUSTOM_NODE_STORE_ROOT, customNodeNamespace } from './node-payload.ts';
import { payloadFor, projectionOf, refusalOf, type CustomNodeInput } from './insert-custom-node.ts';
import {
  parseCustomNodeData,
  type InferSchemaInput,
  type StandardSchemaV1,
} from './data-schema.ts';
import { invalidPayload, type CustomNodeWriteOutcome } from './node-write-result.ts';
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
export function removeCustomNode(editor: Editor, nodeId: string): CustomNodeWriteOutcome {
  const surface = surfaceOf(editor);
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is mounted' };
  // The control AND the payload it bound, in one transaction. The orphan sweep would collect
  // the payload on the next open regardless, but a document saved in between would carry a
  // payload for a chip that is gone.
  const removed = surface.session.removeCustomNode(nodeId);
  if (!removed.ok) return refusalOf(removed);
  return { ok: true, changed: true };
}

/**
 * How {@link updateCustomNode} rewrites the control it replaces.
 *
 * The same shape {@link CustomNodeInput} takes, minus `at` — an update happens where the node
 * already is — and with `data` able to be `null`.
 *
 * @public
 */
export interface CustomNodeUpdate<
  Schema extends StandardSchemaV1 | undefined = undefined,
> extends Omit<CustomNodeInput<Schema>, 'at' | 'data'> {
  /**
   * The payload the rewritten node carries.
   *
   * Written in the SAME transaction as the label, so an update cannot leave the two
   * disagreeing — which is the one way a bound chip could ever show text its payload does not
   * describe.
   *
   * OMITTING IT KEEPS THE PAYLOAD the node already had. That is the important default: the
   * commonest update is a label edit, and an omission that dropped the citation's authors and
   * year would be data loss the caller never asked for and could not see. Pass `null` to remove
   * the payload deliberately.
   *
   * A definition with `toDocx` re-derives its attrs and text from whichever payload ends up
   * being written, so `updateCustomNode(editor, def, id, { data })` rewrites all three together.
   */
  readonly data?: InferSchemaInput<Schema> | null;
}

/**
 * Replace one custom node in place: the node is removed and a fresh one is inserted at its own
 * span — ONE transaction, one undo step, recognized by construction like `insertCustomNode`.
 *
 * ```ts
 * updateCustomNode(editor, citation, node.nodeId, { data: { ...citation, year: 2025 } });
 * ```
 */
export function updateCustomNode<Schema extends StandardSchemaV1 | undefined = undefined>(
  editor: Editor,
  definition: CustomNodeDefinition<Schema>,
  nodeId: string,
  update: CustomNodeUpdate<Schema> = {}
): CustomNodeWriteOutcome {
  const surface = surfaceOf(editor);
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is mounted' };
  const part = surface.session.part();
  const paragraph = paragraphHolding(part, nodeId);
  const span = paragraph ? spanOf(paragraph, nodeId) : null;
  if (!paragraph || !span) {
    return { ok: false, code: 'notFound', reason: 'no custom node with that id' };
  }

  // The payload the node already has, so an omitted `data` carries it forward and a definition
  // with `toDocx` can re-derive its text from it.
  const bound = boundPayloadOf(surface, nodeId);
  const carried = update.data === undefined ? parsedPayload(definition, bound) : update.data;
  const projected = projectionOf(definition, {
    ...(update.attrs === undefined ? {} : { attrs: update.attrs }),
    ...(update.text === undefined ? {} : { text: update.text }),
    ...(carried === undefined || carried === null ? {} : { data: carried }),
  });
  if ('reason' in projected) {
    return { ok: false, code: 'invalidArgs', reason: projected.reason };
  }

  const encoded = encodeCustomNodeTag(definition.tagPrefix, definition.name, projected.attrs);
  if (!encoded.ok) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: `the encoded tag is ${encoded.length} characters; Word caps w:tag at 64 — move what does not fit into the payload (\`data\`), or shorten the attrs`,
    };
  }

  // The payload keeps the id the node already had, so an update is an upsert in the store rather
  // than a new entry beside the old one.
  const payload =
    update.data === null
      ? null
      : update.data === undefined
        ? carriedPayload(definition, bound, projected.text)
        : payloadFor(surface, definition, update.data, projected.text, bound?.nodeId);
  if (payload && 'reason' in payload) return invalidPayload(payload.reason, payload.issues);

  const lock = update.lock === undefined ? 'contentLocked' : update.lock;
  const written = surface.session.insertCustomNode({
    replaceControlId: nodeId,
    paragraphId: paragraph.id,
    offset: span.start,
    tag: encoded.tag,
    text: projected.text,
    ...(update.alias === undefined ? {} : { alias: update.alias }),
    ...(lock === false ? {} : { lock }),
    ...(payload ? { payload: payload.value } : {}),
  });
  if (!written.ok) return refusalOf(written);
  return { ok: true, changed: true };
}

/**
 * The node's existing payload as a VALUE, for a definition that needs to re-derive from it.
 *
 * Parsed without the schema: it came out of the store, so it has already been through one on the
 * way in, and a schema that tightened since the document was written must not make a label edit
 * impossible.
 */
function parsedPayload(
  definition: AnyCustomNodeDefinition,
  bound: CustomNodePayloadRead | undefined
): unknown {
  if (!bound || !definition.toDocx) return undefined;
  const parsed = parseCustomNodeData(undefined, bound.data);
  return parsed.ok ? parsed.value : undefined;
}

/** The payload this control already binds, so a rewrite can reuse both its id and its data. */
function boundPayloadOf(
  surface: PaginatedSurface,
  controlNodeId: string
): CustomNodePayloadRead | undefined {
  const part = surface.session.part();
  return customNodePayloadsByControl(surface.session.currentPackage(), part.name).get(
    controlNodeId
  );
}

/**
 * The payload the node already had, under the NEW label.
 *
 * Re-serialized rather than re-validated: it came out of the store, so it has already been
 * through the schema on the way in, and a definition whose schema TIGHTENED since the document
 * was written should not have its label edit refused by a payload the caller never touched.
 */
function carriedPayload(
  definition: AnyCustomNodeDefinition,
  bound: CustomNodePayloadRead | undefined,
  label: string
): { readonly value: CustomNodePayloadWrite } | null {
  if (!bound) return null;
  return {
    value: {
      namespaceUri: customNodeNamespace(definition),
      rootLocalName: CUSTOM_NODE_STORE_ROOT,
      nodeId: bound.nodeId,
      label,
      data: bound.data,
    },
  };
}
