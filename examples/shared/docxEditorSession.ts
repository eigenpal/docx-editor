// Engine-neutral editing session (queue item 3). The framework-agnostic controller both
// the React and Vue editable components wrap: it owns the canonical DocumentStore and the
// EditorBinding, decides whether a document is editable, maps an edited ProseMirror doc to
// ONE DocOp transaction, and saves. ProseMirror is only a projection here — the
// PackageModel in the store is canonical. No framework, DOM, or Yjs.

import type { Node as PMNode } from 'prosemirror-model';
import {
  parseDocx,
  writeDocx,
  DocumentStore,
  bodyStoryId,
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
  /** Whether body paragraphs may be edited. A document is editable only when the engine
   *  can round-trip an edit: paragraph-only body, no lossless-preservation part (tables/
   *  SDTs take the preservation path and open read-only so nothing is dropped on save). */
  readonly editable: boolean;
  /** Project the current canonical model into a ProseMirror doc for the view. */
  projectDoc(): PMNode;
  /** Map an edited ProseMirror doc to one DocOp transaction against the store. On a
   *  read-only document, or any edit that would disturb a read-only block, this refuses
   *  (rejected, no commit). */
  applyPmDoc(doc: PMNode): ApplyResult;
  /** Body text (paragraphs joined by newlines) from the CANONICAL model, not the view. */
  bodyText(): string;
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
  const parsed = parseDocx(bytes);
  if (!parsed.ok) throw new Error(`cannot open document: ${parsed.reason}${parsed.detail ? ` (${parsed.detail})` : ''}`);
  const model = parsed.model;
  const store = new DocumentStore(model);
  const binding = new EditorBinding(store);

  const blocks = model.stories.get(bodyStoryId(model))!.blocks;
  const editable = !model.preservation && blocks.every((b) => b.kind === 'paragraph');

  return {
    editable,
    projectDoc: () => binding.projectDoc(),
    applyPmDoc(doc) {
      if (!editable) return { committed: false, rejected: true, opCount: 0 };
      const res = binding.commitFromDoc(doc);
      const committed = res.result?.ok === true;
      return { committed, rejected: res.rejected === true, opCount: res.ops.length };
    },
    bodyText() {
      return bodyParagraphs(store)
        .map((p) => p.runs.map((r) => r.text).join(''))
        .join('\n');
    },
    save: () => writeDocx(store.currentModel),
  };
}
