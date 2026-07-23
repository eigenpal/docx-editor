// ProseMirror schema for the editable projection (document-engine task 6.2), COMPOSED from
// registered binding capabilities (comprehensive 3.4/3.5) rather than hardcoded. This module
// registers the base nodes (doc, text), the editable PARAGRAPH capability (paragraph node +
// bold/italic marks + its projector), and the generic READ-ONLY capability (blockEmbed atom + the
// default projector), then builds the schema. A new block kind registers a projector instead of
// editing this schema. The PM doc is a PROJECTION target, never canonical state.

import { Node as PMNode, type Schema } from 'prosemirror-model';
import type { Block, ParagraphRecord, RunRecord } from '@docx-editor.dev/engine-core';
import {
  registerBindingNode,
  registerBindingMark,
  registerBlockProjector,
  registerDefaultBlockProjector,
  buildDocSchema,
} from './binding-capabilities.ts';

// --- base structural nodes ---
registerBindingNode('doc', { content: 'block+' });

// --- editable paragraph capability: node + marks + projector ---
registerBindingNode('paragraph', {
  content: 'text*',
  group: 'block',
  // The authored paragraph id, threaded through so edits keep identity.
  attrs: { semId: { default: null } },
  // toDOM lets the schema also drive a live EditorView (not just headless mapping).
  toDOM() {
    return ['p', 0];
  },
  parseDOM: [{ tag: 'p' }],
});

// --- generic read-only capability: a non-paragraph authored block (table, SDT, ...) projected as
// an opaque atom that carries the block's authored semId so the forward mapper maps it back to the
// exact canonical block and never flattens or mutates it. Rendered as a labeled, non-editable box.
registerBindingNode('blockEmbed', {
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,
  attrs: { semId: { default: null }, kind: { default: 'block' } },
  toDOM(node) {
    return [
      'div',
      {
        class: 'docx-block-embed',
        'data-sem-id': String(node.attrs.semId ?? ''),
        'data-kind': String(node.attrs.kind ?? 'block'),
        contenteditable: 'false',
      },
      `[${String(node.attrs.kind ?? 'block')}]`,
    ];
  },
});
registerBindingNode('text', { group: 'inline' });

registerBindingMark('bold', { toDOM: () => ['strong', 0], parseDOM: [{ tag: 'strong' }, { tag: 'b' }] });
registerBindingMark('italic', { toDOM: () => ['em', 0], parseDOM: [{ tag: 'em' }, { tag: 'i' }] });

function runToText(run: RunRecord, schema: Schema): PMNode {
  const marks = [];
  if (run.props?.bold) marks.push(schema.marks.bold.create());
  if (run.props?.italic) marks.push(schema.marks.italic.create());
  return schema.text(run.text, marks);
}
registerBlockProjector('paragraph', (block, schema) => {
  const p = block as ParagraphRecord;
  const inline = p.runs.filter((r) => r.text.length > 0).map((r) => runToText(r, schema));
  return schema.node('paragraph', { semId: p.id }, inline);
});
registerDefaultBlockProjector((block: Block, schema) => schema.node('blockEmbed', { semId: block.id, kind: block.kind }));

/** The composed ProseMirror schema (built from every registered binding capability). */
export const docSchema: Schema = buildDocSchema();
