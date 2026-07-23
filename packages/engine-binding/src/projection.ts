// Authored model -> ProseMirror projection (document-engine task 6.2). The PM doc is a projection
// of authored state; it is never canonical. Each block projects through its registered binding
// capability (comprehensive 3.5), so modelToDoc has no `block.kind` switch. Paragraph nodes carry
// `semId` so the forward mapper can target the right authored paragraph.

import { Node as PMNode } from 'prosemirror-model';
import { bodyStoryId, type PackageModel, type RunRecord } from '@docx-editor.dev/engine-core';
import { docSchema } from './schema.ts';
import { projectBlock } from './binding-capabilities.ts';

/** Project the body story into a ProseMirror doc. Each block projects through its capability
 *  (paragraphs editable; every other kind a read-only atom carrying its authored semId), so
 *  unsupported content stays visible and structurally intact rather than flattened. */
export function modelToDoc(model: PackageModel): PMNode {
  const story = model.stories.get(bodyStoryId(model))!;
  const nodes = story.blocks.map((b) => projectBlock(b, docSchema));
  return docSchema.node('doc', null, nodes.length > 0 ? nodes : [docSchema.node('paragraph', { semId: null })]);
}

/** Read a paragraph node's inline content back into authored runs. */
export function paragraphNodeToRuns(node: PMNode): RunRecord[] {
  const runs: RunRecord[] = [];
  node.forEach((child) => {
    if (!child.isText || !child.text) return;
    const props: { bold?: true; italic?: true } = {};
    for (const m of child.marks) {
      if (m.type.name === 'bold') props.bold = true;
      if (m.type.name === 'italic') props.italic = true;
    }
    runs.push(Object.keys(props).length > 0 ? { text: child.text, props } : { text: child.text });
  });
  return runs;
}
