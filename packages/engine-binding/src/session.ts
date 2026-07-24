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
  diagnoseBodyPatchability,
  DocumentStore,
  bodyStoryId,
  type PackageModel,
  type ParagraphRecord,
  type ReadOnlyDiagnostic,
} from '@docx-editor.dev/engine-core';
import { EditorBinding } from './binding.ts';

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
  readonly editable: boolean;
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
  const patch = diagnoseBodyPatchability(model);
  const editable = patch.editable;

  return {
    editable,
    readOnlyReason: patch.editable ? null : patch.diagnostic,
    projectDoc: () => binding.projectDoc(),
    applyPmDoc(doc) {
      if (!editable) return { committed: false, rejected: true, opCount: 0 };
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
    undo: () => (editable && store.canUndo() ? store.undo().ok : false),
    redo: () => (editable && store.canRedo() ? store.redoLast().ok : false),
    subscribe: (onChange) => store.subscribe(() => onChange()),
    currentModel: () => store.currentModel,
    revision: () => store.currentRevision,
    // Only an editable document re-serializes (verbatim package + patched paragraphs). A
    // read-only document is returned EXACTLY as opened — writeDocx could throw on a
    // degenerate preservation snapshot (e.g. an empty or sectPr-only body) or drop parts.
    save: () => (editable ? writeDocx(store.currentModel) : bytes),
  };
}
