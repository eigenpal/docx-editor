// Authored model <-> ProseMirror projection (document-engine task 6.2). The PM
// doc is a projection of authored state; it is never canonical. Paragraph nodes
// carry `semId` so the forward mapper can target the right authored paragraph.

import { Node as PMNode } from 'prosemirror-model';
import { bodyStoryId, type PackageModel, type ParagraphRecord, type RunRecord } from '@docx-editor.dev/engine-core';
import { docSchema } from './schema.ts';

function runToText(run: RunRecord): PMNode {
  const marks = [];
  if (run.props?.bold) marks.push(docSchema.marks.bold.create());
  if (run.props?.italic) marks.push(docSchema.marks.italic.create());
  return docSchema.text(run.text, marks);
}

function paragraphToNode(p: ParagraphRecord): PMNode {
  const inline = p.runs.filter((r) => r.text.length > 0).map(runToText);
  return docSchema.node('paragraph', { semId: p.id }, inline);
}

/** Project the body story into a ProseMirror doc. Paragraphs are editable; every other
 *  block kind (table, SDT, ...) projects as a READ-ONLY atom carrying its authored semId,
 *  so unsupported content stays visible and structurally intact rather than flattened. */
export function modelToDoc(model: PackageModel): PMNode {
  const story = model.stories.get(bodyStoryId(model))!;
  const nodes = story.blocks.map((b) =>
    b.kind === 'paragraph'
      ? paragraphToNode(b)
      : docSchema.node('blockEmbed', { semId: b.id, kind: b.kind }),
  );
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
