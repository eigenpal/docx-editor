// Engine-neutral editing session (queue item 3). The framework-agnostic controller both
// the React and Vue editable components wrap: it owns the canonical DocumentStore and the
// EditorBinding, decides whether a document is editable, maps an edited ProseMirror doc to
// ONE DocOp transaction, and saves. ProseMirror is only a projection here — the
// PackageModel in the store is canonical. No framework, DOM, or Yjs.

import type { Node as PMNode } from 'prosemirror-model';
import {
  parseDocx,
  writeDocx,
  isModelBodyPatchable,
  DocumentStore,
  bodyStoryId,
  type PackageModel,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';
import { EditorBinding } from '@docx-editor.dev/engine-binding';

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
  // (tables/SDTs, unmodeled paragraph content, or an unpreservable document).
  const editable = isModelBodyPatchable(model);

  return {
    editable,
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
    currentModel: () => store.currentModel,
    // Only an editable document re-serializes (verbatim package + patched paragraphs). A
    // read-only document is returned EXACTLY as opened — writeDocx could throw on a
    // degenerate preservation snapshot (e.g. an empty or sectPr-only body) or drop parts.
    save: () => (editable ? writeDocx(store.currentModel) : bytes),
  };
}
