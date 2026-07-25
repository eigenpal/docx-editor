// Framework-independent DOCX editing session (document-engine 4.1 / comprehensive 4.1). The
// engine-neutral controller the production Editor and both example editable components own: it holds
// the canonical DocumentStore and the EditorBinding, decides whether a document is editable, maps an
// edited ProseMirror doc to ONE DocOp transaction, and saves. ProseMirror is only a PROJECTION here
// — the PackageModel in the store is canonical. No framework, DOM, or Yjs. This is the sole PM-aware
// integration package (production-engine-packages.md), so the session lives beside the binding it
// drives; the PM-free Editor facade wraps it without leaking PM types.

import type { Node as PMNode } from 'prosemirror-model';
import {
  parseDocx,
  writeDocx,
  assessBodyEditability,
  DocumentStore,
  bodyStoryId,
  type PackageModel,
  type ParagraphRecord,
  type ReadOnlyDiagnostic,
} from '@docx-editor.dev/engine-core';
import { EditorBinding, runIsProjectable } from './binding.ts';

export interface ApplyResult {
  /** True when the edit committed a transaction to the canonical store. */
  readonly committed: boolean;
  /** True when the edit was refused (fail closed) — e.g. a read-only document. */
  readonly rejected: boolean;
  /** Number of DocOps the edit produced. */
  readonly opCount: number;
}

export interface DocxEditorSession {
  /** Whether body paragraphs may be edited. Editable ONLY for a document writeDocx
   *  reproduces losslessly (plain fully-captured paragraphs, no parts/relationships/
   *  section-props/tables/SDTs/inline structure it would drop). Anything else opens
   *  read-only so an edit-and-save can never silently lose content. */
  /** True when the document has at least one editable region (`mode !== 'none'`). */
  readonly editable: boolean;
  /**
   * Document-level editability (partial-body-editability, task M6P.1).
   *
   * `full` every top-level block patchable, `partial` some safe paragraphs editable
   * beside immutable structures, `none` no editable region.
   */
  readonly mode: 'full' | 'partial' | 'none';
  /** One structured diagnostic per read-only block, or the body-level failure. */
  readonly readOnlyRegions: readonly ReadOnlyDiagnostic[];
  /** Whether top-level split/join/insert/delete/reorder is permitted. */
  readonly structuralMutationAllowed: boolean;
  /** When the document opened read-only, a structured diagnostic naming the blocking capability,
   *  QName/context, story, and missing pipeline lane (comprehensive 4.9); null when editable. */
  readonly readOnlyReason: ReadOnlyDiagnostic | null;
  /** Project the current canonical model into a ProseMirror doc for the view. */
  projectDoc(): PMNode;
  /** Map an edited ProseMirror doc to one DocOp transaction against the store. On a
   *  read-only document, or any edit that would disturb a read-only block, this refuses
   *  (rejected, no commit). */
  applyPmDoc(doc: PMNode): ApplyResult;
  /** Body text (paragraphs joined by newlines) from the CANONICAL model, not the view. */
  bodyText(): string;
  /** The ordered ids of the body blocks in the CANONICAL model. After a structural edit
   *  (split/join) the view uses this to re-tag its projected paragraphs with the ids the
   *  store minted, so identity — and the caret — survive without a full reprojection. */
  bodyBlockIds(): string[];
  /** The current canonical model — the source of truth the paginated display repaints from. */
  currentModel(): PackageModel;
  /** The store's current revision — used to key a per-revision selection history so undo/redo
   *  can restore the caret that was active at each revision. */
  revision(): number;
  /** Undo the last committed edit on the CANONICAL store; returns whether the model changed
   *  (so the caller can reproject the view). Structural edits (split/join/insert) undo
   *  correctly here — the view's own history cannot, because it would restore stale ids. */
  undo(): boolean;
  /** Redo the last undone edit on the canonical store; returns whether the model changed. */
  redo(): boolean;
  /** Subscribe to canonical commits (any source, incl. another editor sharing this store). Fires
   *  after every committed revision; returns an unsubscribe. A read-only shared view uses this to
   *  repaint when the owning editor edits. */
  subscribe(onChange: () => void): () => void;
  /** Serialize the canonical model back to DOCX bytes. */
  save(): Uint8Array;
}

function bodyParagraphs(store: DocumentStore): ParagraphRecord[] {
  const model = store.currentModel;
  return model.stories
    .get(bodyStoryId(model))!
    .blocks.filter((b): b is ParagraphRecord => b.kind === 'paragraph');
}

/** Open a DOCX into an editing session. Throws only when the bytes are not a parseable
 *  package (an unsupported-but-parseable document opens read-only instead). */

/**
 * Block ids the policy marks read-only: every top-level body block that is not
 * patchable. Derived rather than stored, so it cannot drift from the assessment.
 */
function readOnlyIdsFrom(
  model: PackageModel,
  assessment: { readonly patchableBlockIds: ReadonlySet<string> },
): ReadonlySet<string> {
  const ids = new Set<string>();
  let storyId: string;
  try {
    storyId = bodyStoryId(model);
  } catch {
    return ids;
  }
  for (const block of model.stories.get(storyId)?.blocks ?? []) {
    if (!assessment.patchableBlockIds.has(block.id)) {
      ids.add(block.id);
      continue;
    }
    // Preservation says this paragraph can be patched, but the REVERSE lane has its own
    // lossless requirement: a run carrying a stable id, a styleId, underline, or an
    // explicit-off bold/italic cannot round-trip through the ProseMirror projection,
    // which represents only the PRESENCE of bold/italic. `commitFromDoc` already
    // refuses to overwrite such a paragraph.
    //
    // The two must agree, or the UI offers an editable caret and every keystroke is
    // silently rejected — precisely the silent no-op this feature must not ship. So the
    // policy narrows here: patchable AND projectable.
    if (block.kind === 'paragraph' && !block.runs.every(runIsProjectable)) ids.add(block.id);
  }
  return ids;
}

export function openDocxSession(bytes: Uint8Array): DocxEditorSession {
  // Prefer the verbatim SELECTIVE-PRESERVATION path so ordinary documents (styles,
  // relationships, section properties) can be edited: every part and every unedited byte
  // round-trips losslessly while edited paragraphs are patched in place. Fall back to a
  // flat parse (read-only) when strict preservation cannot be established.
  const parsed = parseDocx(bytes, { preserveAll: true });
  const result = parsed.ok ? parsed : parseDocx(bytes);
  if (!result.ok) throw new Error(`cannot open document: ${result.reason}${result.detail ? ` (${result.detail})` : ''}`);
  const model = result.model;
  const store = new DocumentStore(model);
  const binding = new EditorBinding(store);
  // Editable when the body is patchable paragraphs under preservation; otherwise read-only
  // (tables/SDTs, unmodeled paragraph content, or an unpreservable document) — with a structured
  // reason a host can show the user.
  // Per-block access policy (partial-body-editability, task M6P.1).
  //
  // This used to reduce the body to one boolean via `diagnoseBodyPatchability`, which
  // returns at the FIRST blocking block — so a single table anywhere made the whole
  // document immutable. On the comprehensive Word fixture that is 0 editable paragraphs
  // out of 258, when 167 of them have a proven lossless patch path.
  //
  // `editable` is now "this document has at least one editable region". Read-only blocks
  // stay visible and are projected as immutable atoms, so they cannot be edited, pasted
  // over, or disturbed; the binding validates every projected id against this policy.
  // Recomputed per canonical revision, not captured once at load.
  //
  // The design is explicit that policy is "recomputed after canonical changes that can
  // affect block identity or preservation evidence" and "keyed by canonical revision".
  // Computing it once meant undo, redo, and a remote/agent commit through the shared
  // store all left the projection and the guards running on a stale snapshot — a block
  // could become read-only, or stop being read-only, with nothing rebuilt.
  let assessment = assessBodyEditability(model);
  let assessedRevision = store.currentRevision;
  const refreshPolicy = (): void => {
    if (store.currentRevision === assessedRevision) return;
    assessment = assessBodyEditability(store.currentModel);
    assessedRevision = store.currentRevision;
    binding.setReadOnlyBlockIds(readOnlyIdsFrom(store.currentModel, assessment));
  };
  // `editable` stays the OPEN-time answer: a document that opened with an editable
  // region does not lose its surface mid-session because one paragraph became
  // unpatchable. Per-block policy still tightens through `refreshPolicy`.
  const editable = assessment.mode !== 'none';
  binding.setReadOnlyBlockIds(readOnlyIdsFrom(model, assessment));

  return {
    editable,
    // The first region when the document has no editable content at all. A PARTIAL
    // document is editable, so it has no single blocking reason — its per-region
    // diagnostics are the honest answer and are exposed separately.
    readOnlyReason: assessment.mode === 'none' ? (assessment.regions[0] ?? null) : null,
    get mode() {
      refreshPolicy();
      return assessment.mode;
    },
    get readOnlyRegions() {
      refreshPolicy();
      return assessment.regions;
    },
    get structuralMutationAllowed() {
      refreshPolicy();
      return assessment.structuralMutationAllowed;
    },
    projectDoc: () => binding.projectDoc(),
    applyPmDoc(doc) {
      if (!editable) return { committed: false, rejected: true, opCount: 0 };
      // Structural mutation preflight (partial-body-editability, task M6P.1).
      //
      // In partial mode a changed top-level block count would invoke whole-region
      // regeneration on save, which is unavailable when any original block is not
      // fully captured — so a split, join, insert, delete, reorder, or multi-block
      // paste must be rejected BEFORE `DocumentStore.apply`, atomically, rather than
      // failing later at serialization with the store already mutated.
      //
      // Enforced here rather than only by disabling key bindings, because a
      // transaction can also originate from a plugin, clipboard handling, a test, or a
      // future adapter. Disabled bindings are UX; this is defense in depth.
      //
      // REDUNDANT TODAY, deliberately kept. With the read-only policy installed, the
      // reverse matcher in `commitFromDoc` already refuses any top-level block-count
      // change in partial mode: disabling this branch was measured to leave every
      // rejection unchanged. It stays because it is cheap, states the rule where the
      // rule is decided, and does not depend on the matcher's behavior — but no test
      // asserts it as load-bearing, because it is not.
      refreshPolicy();
      if (!assessment.structuralMutationAllowed) {
        const blocks = store.currentModel.stories.get(bodyStoryId(store.currentModel))?.blocks ?? [];
        if (doc.childCount !== blocks.length) {
          return { committed: false, rejected: true, opCount: 0 };
        }
      }
      const res = binding.commitFromDoc(doc);
      // A BindingRejection OR a store-level failure both mean "not committed" — surface
      // either as rejected so the view can snap back to the canonical projection.
      const committed = res.result?.ok === true;
      const rejected = res.rejected === true || res.result?.ok === false;
      return { committed, rejected, opCount: res.ops.length };
    },
    bodyText() {
      return bodyParagraphs(store)
        .map((p) => p.runs.map((r) => r.text).join(''))
        .join('\n');
    },
    bodyBlockIds() {
      const m = store.currentModel;
      return m.stories.get(bodyStoryId(m))!.blocks.map((b) => b.id);
    },
    // Undo and redo mutate the model without passing through `applyPmDoc`, so they must
    // refresh the policy themselves or the projection keeps a superseded read-only set.
    undo: () => {
      const ok = editable && store.canUndo() ? store.undo().ok : false;
      if (ok) refreshPolicy();
      return ok;
    },
    redo: () => {
      const ok = editable && store.canRedo() ? store.redoLast().ok : false;
      if (ok) refreshPolicy();
      return ok;
    },
    subscribe: (onChange) => store.subscribe(() => onChange()),
    currentModel: () => store.currentModel,
    revision: () => store.currentRevision,
    // Only an editable document re-serializes (verbatim package + patched paragraphs). A
    // read-only document is returned EXACTLY as opened — writeDocx could throw on a
    // degenerate preservation snapshot (e.g. an empty or sectPr-only body) or drop parts.
    save: () => (editable ? writeDocx(store.currentModel) : bytes),
  };
}
