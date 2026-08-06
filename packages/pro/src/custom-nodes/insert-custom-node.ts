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
import {
  parseNoteScopeId,
  type CustomNodePayloadWrite,
  type CustomNodeWriteResult,
  type StoryScope,
} from '@docx-editor.dev/core/store';
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
 * A payload that passed the definition's schema: what to store, and what the schema produced.
 *
 * VALIDATED BEFORE ANYTHING ELSE HAPPENS. Everything downstream — the text a reader sees, the
 * tag, the store entry — derives from `value`, which is the schema's OUTPUT and not the caller's
 * argument. A `.default()`, a `.transform()` or a `.coerce()` all make the two differ, and
 * deriving from the argument writes a document that describes a value it does not hold.
 */
export type ValidatedPayload =
  | { readonly ok: true; readonly serialized: string; readonly value: unknown }
  | { readonly ok: false; readonly reason: string; readonly issues: readonly CustomNodeIssue[] }
  | null;

/** Null when the caller asked for no payload, which is the ordinary tagged control. */
export function validatePayload(
  definition: AnyCustomNodeDefinition,
  data: unknown
): ValidatedPayload {
  if (data === undefined || data === null) return null;
  const prepared = customNodeDataFor(definition, data);
  if (!prepared.ok) return { ok: false, reason: prepared.reason, issues: prepared.issues };
  return { ok: true, serialized: prepared.data, value: prepared.value };
}

/** The store entry for a validated payload. The id is minted against the document as it stands. */
export function payloadWriteOf(
  surface: PaginatedSurface,
  definition: AnyCustomNodeDefinition,
  serialized: string,
  label: string,
  nodeId?: string
): CustomNodePayloadWrite {
  const namespaceUri = customNodeNamespace(definition);
  const storyPartName = surface.session.part().name;
  return {
    namespaceUri,
    rootLocalName: CUSTOM_NODE_STORE_ROOT,
    nodeId:
      nodeId ?? nextCustomNodeId(surface.session.currentPackage(), storyPartName, namespaceUri),
    label,
    data: serialized,
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
 * A definition with `text` needs only `data`: what the document shows is computed from it.
 *
 * ```ts
 * insertCustomNode(editor, Citation, { data: citation });                 // text derives
 * insertCustomNode(editor, Tag, { attrs: { id: 'x' }, text: '[tag]' });   // no payload
 * ```
 *
 * @public
 */
export interface CustomNodeInput<
  // `CustomNodeDefinition` defaults to `any`: without it the obvious wrapper annotation,
  // `function add(input: CustomNodeInput) { insertCustomNode(editor, Citation, input) }`, fails
  // with an error naming the DEFINITION rather than the annotation that caused it.
  Schema extends StandardSchemaV1 | undefined = any,
> {
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
   * The `w:tag` attrs. Derived by the definition's `tagAttrs` when it declares one.
   *
   * Word caps the encoded tag at 64 characters, so this is the node's IDENTITY and nothing else.
   */
  readonly attrs?: Readonly<Record<string, string>>;
  /** What the document shows. Derived by the definition's `text` when it declares one. */
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

/**
 * What the definition says this node looks like in the document, or why it cannot say.
 *
 * `data` is the SCHEMA'S OUTPUT, never the caller's argument — see {@link ValidatedPayload}.
 *
 * The hooks are the host's code running on the host's data, so they can throw. They are called
 * inside a guard because everything on this path answers a typed refusal, and a `TypeError` out
 * of `insertCustomNode` is not one.
 */
export function projectionOf(
  definition: AnyCustomNodeDefinition,
  input: Pick<CustomNodeInput<StandardSchemaV1 | undefined>, 'attrs' | 'text'>,
  data: unknown
):
  | { readonly attrs: Readonly<Record<string, string>>; readonly text: string }
  | { readonly reason: string } {
  // EXPLICIT WINS, per field. A caller that passed `text` meant that text — most often a label a
  // user edited by hand — and recomputing it from the payload would throw the edit away.
  let derivedText: string | undefined;
  let derivedAttrs: Readonly<Record<string, string>> | undefined;
  if (data !== undefined) {
    try {
      derivedText = definition.text?.(data);
      derivedAttrs = definition.tagAttrs?.(data);
    } catch (error) {
      return {
        reason: `${definition.name} could not describe this payload: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  const text = input.text ?? derivedText;
  if (text === undefined) {
    return {
      reason: definition.text
        ? `${definition.name} derives its text from \`data\`, so pass one — or pass \`text\` directly`
        : `${definition.name} declares no \`text\`, so \`text\` is required`,
    };
  }
  // A definition that puts identity in the tag must not end up with an empty one because the
  // caller supplied its own text and no payload to derive the attrs from.
  if (input.attrs === undefined && definition.tagAttrs && derivedAttrs === undefined) {
    return {
      reason: `${definition.name} derives its tag attrs from \`data\`, so pass one — or pass \`attrs\` directly`,
    };
  }
  return { attrs: input.attrs ?? derivedAttrs ?? {}, text };
}

/**
 * Refuse a write while the document is open for VIEWING.
 *
 * `session.applyTreeOps` is the store's path, below the surface's editing-mode gate, so a
 * write routed through it edited a read-only document — the context menu's Remove row
 * deleted a chip in a viewing document and reported success. Every write in this file asks
 * first rather than relying on a gate it does not pass through.
 */
export function viewingRefusal(editor: Editor): CustomNodeWriteOutcome | null {
  return editor.getEditingMode() === 'viewing'
    ? { ok: false, code: 'locked', reason: 'the document is open for viewing' }
    : null;
}

/**
 * The story the reader has open, in the vocabulary `applyTreeOps` takes.
 *
 * A chip lives wherever it was inserted, and a header is an ordinary place to put one.
 * Writes default to the body, so the scope has to travel with them.
 */
export function storyScopeOfEditor(editor: Editor): StoryScope {
  const scope = editor.getActiveScope();
  if (scope.kind === 'headerFooter') return { kind: 'headerFooter', rId: scope.rId };
  if (scope.kind === 'note') {
    const parsed = parseNoteScopeId(scope.id);
    if (parsed) return { kind: 'notesPart', noteKind: parsed.noteKind };
  }
  return { kind: 'body' };
}

/**
 * The story a node or paragraph LIVES in, from its own id.
 *
 * Ids are part-qualified (`/word/header1.xml#0.0`), so the target answers this itself. The
 * open scope is only a fallback for an id that names no part: it is where the READER is,
 * which is a different question and the wrong one whenever a caller addresses a node
 * somewhere else — passing an explicit body `at` while a header is open used to work and
 * would otherwise start refusing as `unknown-paragraph`.
 */
export function storyScopeOfId(editor: Editor, id: string | undefined): StoryScope {
  const surface = surfaceOf(editor);
  const partName = id === undefined ? '' : id.slice(0, id.indexOf('#'));
  if (!surface || partName.length === 0) return storyScopeOfEditor(editor);
  if (partName === surface.session.part().name) return { kind: 'body' };
  for (const section of surface.session.headerFooterResolutionBySection()) {
    for (const slots of [section.headers, section.footers]) {
      for (const slot of slots.values()) {
        if (slot.partName === partName) return { kind: 'headerFooter', rId: slot.rId };
      }
    }
  }
  for (const noteKind of ['footnote', 'endnote'] as const) {
    if (surface.session.partFor({ kind: 'notesPart', noteKind })?.name === partName) {
      return { kind: 'notesPart', noteKind };
    }
  }
  return storyScopeOfEditor(editor);
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
  // VALIDATE FIRST. The text and the tag are derived from what the schema produced, so nothing
  // downstream may run before the schema has had its say.
  const payload = validatePayload(definition, input.data);
  if (payload && !payload.ok) return invalidPayload(payload.reason, payload.issues);

  const projected = projectionOf(definition, input, payload?.value);
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
  const refusal = viewingRefusal(editor);
  if (refusal) return refusal;
  const at = input.at ?? surface.state().selection.head;
  const lock = input.lock === undefined ? 'contentLocked' : input.lock;
  // The story the paragraph is IN. The write defaults to the body, so inserting a chip into
  // an open header addressed a paragraph the body store has never heard of and was refused
  // as `unknown-paragraph` — a header is an ordinary place to want one.
  const scope = storyScopeOfEditor(editor);
  const written = surface.session.insertCustomNode(
    {
      paragraphId: at.paragraphId,
      offset: at.offset,
      tag: encoded.tag,
      text: projected.text,
      ...(input.alias === undefined ? {} : { alias: input.alias }),
      ...(lock === false ? {} : { lock }),
      ...(payload
        ? { payload: payloadWriteOf(surface, definition, payload.serialized, projected.text) }
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
