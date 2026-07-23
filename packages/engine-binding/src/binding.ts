// EditorBinding — the ONLY ProseMirror-aware integration (document-engine tasks
// 6.1, 6.3, 6.4, 6.5, 6.9 / ADR-S6). It maps an edited PM doc to semantic DocOps
// and commits the store FIRST, then reconciles the view from committed evidence.
// Forward mapping is model-first and identity-preserving: an existing paragraph's
// changed content becomes `setParagraphRuns` (ReplaceBlockContent, keeps id), a
// new paragraph becomes `appendParagraph` (mints id), a vanished paragraph becomes
// `deleteParagraph`. The rejected POC prefix/suffix text diff is NOT used.
//
// Loop prevention (6.9): reconciliation output is a projection; only genuine user
// edits call `commitFromDoc`, so a reconciled doc maps to zero ops.

import { EditorState } from 'prosemirror-state';
import { Node as PMNode } from 'prosemirror-model';
import {
  DocumentStore,
  bodyStoryId,
  ORIGIN_IDS,
  type DocOp,
  type BatchResult,
  type ParagraphRecord,
  type RunRecord,
} from '@docx-editor.dev/engine-core';
import { docSchema } from './schema.ts';
import { modelToDoc, paragraphNodeToRuns } from './projection.ts';

const MUTATION = ORIGIN_IDS.mutationHuman;

function runsEqual(a: readonly RunRecord[], b: readonly RunRecord[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface ForwardResult {
  readonly ops: readonly DocOp[];
  readonly result?: BatchResult;
}

export class EditorBinding {
  constructor(private readonly store: DocumentStore) {}

  get schema() {
    return docSchema;
  }

  /** Project current authored state into a ProseMirror doc / state. */
  projectDoc(): PMNode {
    return modelToDoc(this.store.currentModel);
  }
  createState(): EditorState {
    return EditorState.create({ schema: docSchema, doc: this.projectDoc() });
  }

  /** Derive the DocOps that turn the current authored state into `newDoc`. */
  mapDocToOps(newDoc: PMNode): DocOp[] {
    const model = this.store.currentModel;
    const storyId = bodyStoryId(model);
    const story = model.stories.get(storyId)!;
    const byId = new Map(story.blocks.map((b) => [b.id, b as ParagraphRecord]));
    const ops: DocOp[] = [];
    const seen = new Set<string>();
    let sym = 0;

    newDoc.forEach((node) => {
      if (node.type.name !== 'paragraph') return;
      const semId = node.attrs.semId as string | null;
      const runs = paragraphNodeToRuns(node);
      const existing = semId ? byId.get(semId) : undefined;
      if (existing) {
        seen.add(semId!);
        if (!runsEqual(existing.runs, runs)) ops.push({ op: 'setParagraphRuns', paragraphId: semId!, runs });
      } else {
        // New paragraph (e.g. typed after Enter at end); mint identity.
        const symbolicId = `$b${(sym += 1)}`;
        ops.push({ op: 'appendParagraph', storyId, symbolicId });
        if (runs.length > 0) ops.push({ op: 'setParagraphRuns', paragraphId: symbolicId, runs });
      }
    });
    for (const id of byId.keys()) if (!seen.has(id)) ops.push({ op: 'deleteParagraph', paragraphId: id });
    return ops;
  }

  /** Forward: map an edited PM doc to DocOps and commit ONE store transaction. */
  commitFromDoc(newDoc: PMNode): ForwardResult {
    const ops = this.mapDocToOps(newDoc);
    if (ops.length === 0) return { ops };
    return { ops, result: this.store.applyEdits(ops, MUTATION) };
  }

  /**
   * Reverse reconciliation: after a non-PM commit (remote/agent/undo), reproject
   * the authored model into a fresh PM doc for the view. Tagged as projection
   * work — it is never fed back into `commitFromDoc`.
   */
  reconcileDoc(): PMNode {
    return this.projectDoc();
  }
}
