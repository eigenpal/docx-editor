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
  contentControlPropertiesOf,
  contentControlTextOf,
  contentControlsIn,
  customNodePayloadsByControl,
  segmentsOf,
  type CustomNodePayloadRead,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { CustomNodeDefinition } from './define-custom-node.ts';
import type { StoryScope } from '@docx-editor.dev/core/store';
import {
  payloadWriteOf,
  projectionOf,
  refusalOf,
  storyScopeOfId,
  validatePayload,
  viewingRefusal,
  type CustomNodeInput,
  type ValidatedPayload,
} from './insert-custom-node.ts';
import { decodeCustomNodeTag } from './tag-codec.ts';
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
  const refusal = viewingRefusal(editor);
  if (refusal) return refusal;
  // The control AND the payload it bound, in one transaction. The orphan sweep would collect
  // the payload on the next open regardless, but a document saved in between would carry a
  // payload for a chip that is gone. Against the story the reader is IN: the write defaults
  // to the body, so removing a chip inside an open header addressed a control the body
  // store has never heard of — the menu closed, the chip stayed, and nothing said why.
  const removed = surface.session.removeCustomNode(nodeId, storyScopeOfId(editor, nodeId));
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
   * A definition with `text` re-derives what the document shows from whichever payload ends up
   * being written, so `updateCustomNode(editor, def, id, { data })` rewrites both together.
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
  const refusal = viewingRefusal(editor);
  if (refusal) return refusal;
  // From the NODE's own id, not the open scope: a caller may address a chip in a story the
  // reader has since left, and the id says which one.
  const scope = storyScopeOfId(editor, nodeId);
  const part = surface.session.partFor(scope) ?? surface.session.part();
  const paragraph = paragraphHolding(part, nodeId);
  const span = paragraph ? spanOf(paragraph, nodeId) : null;
  const existing = existingNodeOf(surface, nodeId, scope);
  if (!paragraph || !span || !existing) {
    return { ok: false, code: 'notFound', reason: 'no custom node with that id' };
  }
  // THE NODE HAS TO BE THIS DEFINITION'S. Without the check an update rewrites the tag, the text
  // and the payload of whatever the id named — turning a citation into a figure and reporting
  // success. Node ids arrive from review items and activations that carry several definitions'
  // nodes, so picking the wrong one out of a registry is a single keystroke.
  const identity = `${definition.tagPrefix}:${definition.name}`;
  if (existing.identity !== null && existing.identity !== identity) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: `node ${nodeId} is a ${existing.identity}, not a ${identity}`,
    };
  }

  // Everything the caller did not mention is carried from the node being replaced. An update is
  // a REWRITE of one control, so anything omitted has to survive it: the payload, the tag attrs
  // that carry the node's identity, the Word title, and the lock.
  const bound = boundPayloadOf(surface, nodeId);
  const payload =
    update.data === null
      ? null
      : update.data === undefined
        ? carriedPayload(bound)
        : validatePayload(definition, update.data);
  if (payload && !payload.ok) return invalidPayload(payload.reason, payload.issues);

  const projected = projectionOf(
    definition,
    {
      // The old attrs are the fallback, not `{}`: a definition with no `tagAttrs` keeps its
      // identity in the tag, and dropping it leaves a node nothing can recognize again.
      attrs: update.attrs ?? (update.data === undefined ? existing.attrs : undefined),
      text: update.text ?? (payload === null && update.data === null ? existing.text : undefined),
    },
    payload?.value
  );
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

  const alias = update.alias ?? existing.alias;
  const lock = update.lock ?? existing.lock;
  const written = surface.session.insertCustomNode(
    {
      replaceControlId: nodeId,
      paragraphId: paragraph.id,
      offset: span.start,
      tag: encoded.tag,
      text: projected.text,
      ...(alias === undefined ? {} : { alias }),
      ...(lock === false || lock === undefined ? {} : { lock }),
      // The payload keeps the id the node already had, so an update is an upsert in the store
      // rather than a new entry beside the old one.
      ...(payload
        ? {
            payload: payloadWriteOf(
              surface,
              definition,
              payload.serialized,
              projected.text,
              bound?.nodeId
            ),
          }
        : {}),
    },
    scope
  );
  if (!written.ok) return refusalOf(written);
  // The control that now exists, not the one passed in: the write replaces the node.
  return {
    ok: true,
    changed: true,
    ...(written.nodeId === undefined ? {} : { nodeId: written.nodeId }),
  };
}

/** What the control being replaced already says, so an omitted field survives the rewrite. */
interface ExistingNode {
  /** `<prefix>:<name>` from the tag, or null when the tag does not decode. */
  readonly identity: string | null;
  readonly attrs: Readonly<Record<string, string>>;
  readonly text: string;
  readonly alias: string | undefined;
  readonly lock: false | 'sdtLocked' | 'sdtContentLocked' | 'contentLocked' | undefined;
}

function existingNodeOf(
  surface: PaginatedSurface,
  nodeId: string,
  scope: StoryScope
): ExistingNode | null {
  // The STORY the chip lives in. Reading the body part while a header was open found no
  // control with that id, so an update reported `notFound` over a chip on screen.
  const part = surface.session.partFor(scope) ?? surface.session.part();
  const entry = contentControlsIn(part.root).find((candidate) => candidate.node.id === nodeId);
  if (!entry) return null;
  const properties = contentControlPropertiesOf(entry.node);
  const decoded = properties.tag === undefined ? null : decodeCustomNodeTag(properties.tag);
  const declared = properties.lock;
  return {
    identity: decoded ? `${decoded.prefix}:${decoded.name}` : null,
    attrs: decoded?.attrs ?? {},
    text: contentControlTextOf(entry.node),
    alias: properties.alias,
    lock:
      declared === 'sdtLocked' || declared === 'sdtContentLocked' || declared === 'contentLocked'
        ? declared
        : declared === 'unlocked'
          ? false
          : undefined,
  };
}

/**
 * The payload the node already had, ready to be written again unchanged.
 *
 * Parsed WITHOUT the schema deliberately: it came out of the store, so it went through one on the
 * way in, and a schema that has tightened since — or a file someone hand-edited — must not make a
 * label-only update impossible. Anything deriving from it is guarded, so a value the schema would
 * now reject produces a refusal rather than an exception.
 */
function carriedPayload(bound: CustomNodePayloadRead | undefined): ValidatedPayload {
  if (!bound) return null;
  const parsed = parseCustomNodeData(undefined, bound.data);
  return parsed.ok
    ? { ok: true, serialized: bound.data, value: parsed.value }
    : {
        ok: false,
        reason: `the stored payload is not readable: ${parsed.issues.join(', ')}`,
        issues: [],
      };
}

/** The payload this control already binds, so a rewrite reuses both its id and its data. */
function boundPayloadOf(
  surface: PaginatedSurface,
  controlNodeId: string
): CustomNodePayloadRead | undefined {
  const part = surface.session.part();
  return customNodePayloadsByControl(surface.session.currentPackage(), part.name).get(
    controlNodeId
  );
}
