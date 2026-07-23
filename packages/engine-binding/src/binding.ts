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
  type Block,
  type RunRecord,
} from '@docx-editor.dev/engine-core';
import { docSchema } from './schema.ts';
import { modelToDoc, paragraphNodeToRuns } from './projection.ts';

const MUTATION = ORIGIN_IDS.mutationHuman;

/** A structural edit the forward mapper refuses to apply (it would flatten, delete, or
 *  mutate a read-only non-paragraph block). commitFromDoc turns it into a rejected,
 *  no-commit result — the canonical store is left untouched. */
class BindingRejection extends Error {}

function runsEqual(a: readonly RunRecord[], b: readonly RunRecord[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface ForwardResult {
  readonly ops: readonly DocOp[];
  readonly result?: BatchResult;
  /** True when the edit was refused (fail closed) — no DocOps, no commit. */
  readonly rejected?: boolean;
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

  /** Derive the DocOps that turn the current authored state into `newDoc`. Only paragraph
   *  text changes produce ops; read-only non-paragraph blocks (projected as blockEmbed
   *  atoms) must map back to their exact canonical block by semId and are never mutated.
   *  Any structural disturbance of a read-only block throws {@link BindingRejection}. */
  mapDocToOps(newDoc: PMNode): DocOp[] {
    const model = this.store.currentModel;
    const storyId = bodyStoryId(model);
    const story = model.stories.get(storyId)!;
    const byId = new Map<string, Block>(story.blocks.map((b) => [b.id, b]));
    const ops: DocOp[] = [];
    const seen = new Set<string>();
    let sym = 0;

    newDoc.forEach((node) => {
      if (node.type.name === 'blockEmbed') {
        // A read-only block. It MUST map back to an existing non-paragraph block; then it
        // is left untouched. A missing/mismatched atom is an illegal edit — fail closed.
        const semId = node.attrs.semId as string | null;
        const existing = semId ? byId.get(semId) : undefined;
        if (!existing || existing.kind === 'paragraph' || seen.has(semId!)) {
          // Missing, retyped, or DUPLICATED read-only block — an illegal structural edit.
          throw new BindingRejection('read-only block cannot be added, moved, duplicated, or altered');
        }
        seen.add(semId!);
        return;
      }
      if (node.type.name !== 'paragraph') return;
      const semId = node.attrs.semId as string | null;
      const runs = paragraphNodeToRuns(node);
      const existing = semId ? byId.get(semId) : undefined;
      if (existing) {
        if (existing.kind !== 'paragraph' || seen.has(semId!)) {
          // A paragraph node claiming a non-paragraph block's identity, or a DUPLICATED
          // paragraph id (e.g. a split that copied semId) — fail closed rather than let the
          // last node silently win and drop the other half.
          throw new BindingRejection('paragraph edit targets a non-paragraph or duplicated block');
        }
        seen.add(semId!);
        if (!runsEqual(existing.runs, runs)) ops.push({ op: 'setParagraphRuns', paragraphId: semId!, runs });
      } else {
        // New paragraph (e.g. typed after Enter at end); mint identity.
        const symbolicId = `$b${(sym += 1)}`;
        ops.push({ op: 'appendParagraph', storyId, symbolicId });
        if (runs.length > 0) ops.push({ op: 'setParagraphRuns', paragraphId: symbolicId, runs });
      }
    });
    for (const [id, block] of byId) {
      if (seen.has(id)) continue;
      // A vanished paragraph is a delete; a vanished read-only block is illegal (would
      // drop unsupported content) — fail closed rather than emit a wrong/destructive op.
      if (block.kind === 'paragraph') ops.push({ op: 'deleteParagraph', paragraphId: id });
      else throw new BindingRejection('a read-only block was removed');
    }
    return ops;
  }

  /** Forward: map an edited PM doc to DocOps and commit ONE store transaction. An edit
   *  that disturbs a read-only block is refused (fail closed): no ops, no commit. */
  commitFromDoc(newDoc: PMNode): ForwardResult {
    let ops: DocOp[];
    try {
      ops = this.mapDocToOps(newDoc);
    } catch (e) {
      if (e instanceof BindingRejection) return { ops: [], rejected: true };
      throw e;
    }
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
