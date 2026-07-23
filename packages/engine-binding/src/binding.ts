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
  normalizeRuns,
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

/** Compare run lists up to normalization. ProseMirror coalesces adjacent text with
 *  identical marks during projection, so an UNCHANGED paragraph whose model runs merge to
 *  the same normalized form must map to ZERO ops — otherwise re-projecting an untouched
 *  paragraph would spuriously rewrite (and collapse) its authored run segmentation. A real
 *  text/formatting edit still differs after normalization. */
function runsEqual(a: readonly RunRecord[], b: readonly RunRecord[]): boolean {
  return JSON.stringify(normalizeRuns(a)) === JSON.stringify(normalizeRuns(b));
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

  /** Derive the DocOps that turn the current authored state into `newDoc`. This checkpoint
   *  supports ONLY in-place text edits: the PM top-level nodes must correspond 1:1 and IN
   *  ORDER to the canonical body blocks (a paragraph node ↔ a paragraph block, a blockEmbed
   *  atom ↔ its exact non-paragraph block, matched by semId). A changed paragraph emits one
   *  `setParagraphRuns`; a read-only atom emits nothing. ANY structural change — a new,
   *  removed, reordered, split, duplicated, or retyped block — throws {@link BindingRejection}
   *  so nothing is silently dropped, misordered, or mutated (structural editing is a later
   *  increment). */
  mapDocToOps(newDoc: PMNode): DocOp[] {
    const model = this.store.currentModel;
    const blocks = model.stories.get(bodyStoryId(model))!.blocks;
    const ops: DocOp[] = [];
    let i = 0;
    newDoc.forEach((node) => {
      const block: Block | undefined = blocks[i];
      if (!block) throw new BindingRejection('a block was added'); // more PM nodes than canonical blocks
      if (node.type.name === 'blockEmbed') {
        if (block.kind === 'paragraph' || node.attrs.semId !== block.id) {
          throw new BindingRejection('read-only block moved, replaced, or retyped');
        }
      } else if (node.type.name === 'paragraph') {
        if (block.kind !== 'paragraph' || node.attrs.semId !== block.id) {
          throw new BindingRejection('paragraph added, removed, reordered, or split');
        }
        const runs = paragraphNodeToRuns(node);
        if (!runsEqual(block.runs, runs)) ops.push({ op: 'setParagraphRuns', paragraphId: block.id, runs });
      } else {
        throw new BindingRejection(`unexpected node type '${node.type.name}'`);
      }
      i += 1;
    });
    if (i !== blocks.length) throw new BindingRejection('a block was removed'); // fewer PM nodes than blocks
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
