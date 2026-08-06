/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The WRITE half of `defineCustomNode`: insert a recognized-by-construction
// node — a run-level `w:sdt` whose `w:tag` carries the definition's identity
// and attrs, `contentLocked` by default so neither Word users nor inline
// typing can drift the label away from the attrs, with the literal label text
// as its content (what Word and the free tier render).

import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { PaginatedSurface } from '@docx-editor.dev/core/editor';
import type { CustomNodePayloadWrite, CustomNodeWriteResult } from '@docx-editor.dev/core/store';
import type { AnyCustomNodeDefinition, CustomNodeDefinition } from './define-custom-node.ts';
import type { InferSchemaInput, StandardSchemaV1 } from './data-schema.ts';
import { encodeCustomNodeTag } from './tag-codec.ts';
import {
  invalidPayload,
  type CustomNodeIssue,
  type CustomNodeWriteOutcome,
} from './node-write-result.ts';
import {
  CUSTOM_NODE_STORE_ROOT,
  customNodeDataFor,
  customNodeNamespace,
  nextCustomNodeId,
} from './node-payload.ts';

/** Instance-only surface on the concrete facade, the same escape hatch chrome uses. */
function surfaceOf(editor: Editor): PaginatedSurface | null {
  const candidate = editor as Editor & { readonly surface?: PaginatedSurface | null };
  return candidate.surface ?? null;
}

/**
 * The payload half of a write, or the reason there is not one.
 *
 * Null means the caller asked for no payload, which is the ordinary tagged control. The id is
 * minted against the document as it stands, so it is unique inside it and stable afterwards.
 */
export function payloadFor(
  surface: PaginatedSurface,
  definition: AnyCustomNodeDefinition,
  data: unknown,
  label: string,
  nodeId?: string
):
  | { readonly value: CustomNodePayloadWrite }
  | { readonly reason: string; readonly issues: readonly CustomNodeIssue[] }
  | null {
  if (data === undefined) return null;
  const prepared = customNodeDataFor(definition, data);
  if (!prepared.ok) return { reason: prepared.reason, issues: prepared.issues };
  const namespaceUri = customNodeNamespace(definition);
  const storyPartName = surface.session.part().name;
  return {
    value: {
      namespaceUri,
      rootLocalName: CUSTOM_NODE_STORE_ROOT,
      nodeId:
        nodeId ?? nextCustomNodeId(surface.session.currentPackage(), storyPartName, namespaceUri),
      label,
      data: prepared.data,
    },
  };
}

/**
 * The engine's refusal, as an `ExecResult` a host can branch on.
 *
 * `invalidArgs` for the ones the CALLER can fix by passing something else — a payload past the
 * cap, an offset outside the paragraph, a store that could not be authored for this namespace.
 * `unsupported` for the rest, which are facts about the document: a lock, a protected form, a
 * control bound to a part this engine will not rewrite. Sorting them here means a host can tell
 * "fix your call" from "this document says no" without string-matching a reason.
 */
export function refusalOf(
  result: Extract<CustomNodeWriteResult, { ok: false }>
): CustomNodeWriteOutcome {
  const reason = result.detail ? `${result.reason}: ${result.detail}` : result.reason;
  return {
    ok: false,
    code: CALLER_FIXABLE.has(result.reason) ? 'invalidArgs' : 'unsupported',
    reason,
  };
}

const CALLER_FIXABLE: ReadonlySet<string> = new Set([
  'payload-too-large',
  'unaddressable-payload',
  'store-not-authored',
  'offset-out-of-range',
  'invalid-range',
  'invalid-property-value',
  'splits-surrogate-pair',
]);

/**
 * What a node says and where it goes — one object, so the parts cannot be passed in the wrong
 * order or get out of step.
 *
 * A definition with `toDocx` needs only `data`: the `w:tag` attrs and the text a reader sees are
 * derived from it, so a node has ONE representation and nothing has to keep three in agreement.
 * Without `toDocx`, pass `attrs` and `text` yourself.
 *
 * ```ts
 * insertCustomNode(editor, Citation, { data: citation });                 // toDocx derives
 * insertCustomNode(editor, Tag, { attrs: { id: 'x' }, text: '[tag]' });   // no payload
 * ```
 *
 * @public
 */
export interface CustomNodeInput<Schema extends StandardSchemaV1 | undefined = undefined> {
  /**
   * The node's payload: everything that does not fit in 64 characters of `w:tag`.
   *
   * Written into a customXml data part and bound to the control, in the SAME transaction as the
   * control itself. Validated against the definition's `schema` first, so a payload that does
   * not match is refused here — with the failing fields in `issues` — rather than written and
   * rejected on the next open.
   */
  readonly data?: InferSchemaInput<Schema>;
  /**
   * The `w:tag` attrs. Derived by `toDocx` when the definition declares one.
   *
   * Word caps the encoded tag at 64 characters, so this is the node's IDENTITY and nothing else.
   */
  readonly attrs?: Readonly<Record<string, string>>;
  /** The literal text the control holds — what Word and a reader without this library see. */
  readonly text?: string;
  /**
   * Where to insert. Omitted, the node lands at the current selection HEAD — the programmatic
   * mirror of "type a citation at the caret".
   */
  readonly at?: { readonly paragraphId: string; readonly offset: number };
  /**
   * The `w:lock` written on the control. Defaults to `contentLocked` — the text is locked so the
   * label cannot drift out of sync with the attrs by inline typing, while the node itself stays
   * DELETABLE as one unit, in the editor and in Word alike. `false` writes no lock;
   * `sdtContentLocked` also forbids deleting the node.
   *
   * A node carrying a payload is uneditable whatever this says: the engine refuses content edits
   * inside a bound control, and so does Word.
   */
  readonly lock?: false | 'sdtLocked' | 'sdtContentLocked' | 'contentLocked';
  /** `w:alias` — the human title Word shows on the control, and the chrome's floating label. */
  readonly alias?: string;
}

/** What the definition says this node should look like in the document, or why it cannot say. */
export function projectionOf(
  definition: AnyCustomNodeDefinition,
  input: CustomNodeInput<StandardSchemaV1 | undefined>
):
  | { readonly attrs: Readonly<Record<string, string>>; readonly text: string }
  | { readonly reason: string } {
  // EXPLICIT WINS. A caller that passed both meant the override — most often a label a user
  // edited by hand — and silently recomputing it from the payload would throw that away.
  if (input.attrs !== undefined && input.text !== undefined) {
    return { attrs: input.attrs, text: input.text };
  }
  if (definition.toDocx && input.data !== undefined) {
    const projected = definition.toDocx(input.data);
    return {
      attrs: input.attrs ?? projected.attrs,
      text: input.text ?? projected.text,
    };
  }
  if (input.text === undefined) {
    return {
      reason: definition.toDocx
        ? `${definition.name} derives its text from \`data\`, so pass one — or pass \`text\` directly`
        : `${definition.name} declares no toDocx, so \`text\` is required`,
    };
  }
  return { attrs: input.attrs ?? {}, text: input.text };
}

/**
 * Insert one custom node. Returns the engine's typed result: refusals carry the engine's own
 * reason (tag overflow, offset out of range, viewing mode, …), and a payload the schema refused
 * carries the failing fields in `issues`.
 *
 * ```ts
 * insertCustomNode(editor, citation, { data: { sourceId: 'src_9f3', year: 2024 } });
 * ```
 */
export function insertCustomNode<Schema extends StandardSchemaV1 | undefined = undefined>(
  editor: Editor,
  definition: CustomNodeDefinition<Schema>,
  input: CustomNodeInput<Schema> = {}
): CustomNodeWriteOutcome {
  const surface = surfaceOf(editor);
  if (!surface) {
    return { ok: false, code: 'notFound', reason: 'no document is mounted' };
  }
  const projected = projectionOf(definition, input);
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
  const payload = payloadFor(surface, definition, input.data, projected.text);
  if (payload && 'reason' in payload) return invalidPayload(payload.reason, payload.issues);
  const at = input.at ?? surface.state().selection.head;
  const lock = input.lock === undefined ? 'contentLocked' : input.lock;
  const written = surface.session.insertCustomNode({
    paragraphId: at.paragraphId,
    offset: at.offset,
    tag: encoded.tag,
    text: projected.text,
    ...(input.alias === undefined ? {} : { alias: input.alias }),
    ...(lock === false ? {} : { lock }),
    ...(payload ? { payload: payload.value } : {}),
  });
  if (!written.ok) return refusalOf(written);
  return { ok: true, changed: true };
}
