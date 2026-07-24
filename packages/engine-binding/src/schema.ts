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
registerBindingNode(
  'paragraph',
  {
    content: 'text*',
    group: 'block',
    // The authored paragraph id, threaded through so edits keep identity.
    attrs: { semId: { default: null } },
    // toDOM lets the schema also drive a live EditorView (not just headless mapping).
    toDOM() {
      return ['p', 0];
    },
    parseDOM: [{ tag: 'p' }],
  },
  'paragraph', // reverse-mapping role: an editable text block
);

// --- generic read-only capability: a non-paragraph authored block (table, SDT, ...) projected as
// an opaque atom that carries the block's authored semId so the forward mapper maps it back to the
// exact canonical block and never flattens or mutates it. Rendered as a labeled, non-editable box.
registerBindingNode(
  'blockEmbed',
  {
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
  },
  'atom', // reverse-mapping role: a read-only projected block
);
registerBindingNode('text', { group: 'inline' });

// bold/italic EXCLUDE the opaque rawRunProps capsule, so applying b/i to a capsule run REMOVES the
// capsule and materializes the modeled mark (the user's edit wins, visibly) rather than being
// discarded by the capsule.
registerBindingMark('bold', { excludes: 'rawRunProps', toDOM: () => ['strong', 0], parseDOM: [{ tag: 'strong' }, { tag: 'b' }] });
registerBindingMark('italic', { excludes: 'rawRunProps', toDOM: () => ['em', 0], parseDOM: [{ tag: 'em' }, { tag: 'i' }] });
// An OPAQUE run-properties capsule mark: it carries the verbatim <w:rPr> bytes of a run whose
// formatting the model does not represent, so editing the run's TEXT preserves its rPr. Two runs
// with different capsules carry different `rpr` attrs and stay separate; identical capsules merge
// (same formatting). The capsule is opaque — the editor cannot toggle its formatting; typed text
// gets no capsule mark (default formatting). Rendered inert (a plain span carrying the bytes).
registerBindingMark('rawRunProps', {
  attrs: { rpr: {} },
  // Self-exclusion (a run has ONE rPr), and bold/italic exclude it (above) so the opaque capsule and
  // the modeled marks never coexist.
  excludes: 'rawRunProps',
  toDOM: (mark) => ['span', { 'data-raw-rpr': String(mark.attrs.rpr) }, 0],
  // SECURITY: NO parseDOM. The capsule is re-emitted VERBATIM into document.xml, and even a balanced
  // w:rPr can carry attacker OOXML (a nested w:object/OLE, duplicate attributes) that a "valid single
  // w:rPr" check cannot scrub. So a capsule may ONLY come from the ORIGINAL parsed document (lossless
  // preservation of bytes already in the file) — NEVER from pasted/untrusted DOM. Without a parseDOM
  // rule, a pasted `data-raw-rpr` span carries no capsule (its text pastes as plain), closing the
  // untrusted-input / OLE-injection vector. In-editor editing of an original styled run still works:
  // the mark comes from the model projection (toDOM), and paragraphNodeToRuns re-validates it.
});

function runToText(run: RunRecord, schema: Schema): PMNode {
  // A run carrying an ownership-scoped rPr capsule projects with the opaque rawRunProps mark (which
  // already holds the full rPr, incl. b/i) instead of the modeled bold/italic marks.
  if (run.rPrCapsule) {
    return schema.text(run.text, [schema.marks.rawRunProps.create({ rpr: run.rPrCapsule })]);
  }
  const marks = [];
  if (run.props?.bold) marks.push(schema.marks.bold.create());
  if (run.props?.italic) marks.push(schema.marks.italic.create());
  return schema.text(run.text, marks);
}
registerBlockProjector('paragraph', (block, schema) => {
  const p = block as ParagraphRecord;
  const inline = p.runs.filter((r) => r.text.length > 0).map((r) => runToText(r, schema));
  return schema.node('paragraph', { semId: p.id }, inline);
}); // paragraph editability is the reverse-lane fact BINDING_EDITABLE_KINDS, not a projector flag
registerDefaultBlockProjector((block: Block, schema) => schema.node('blockEmbed', { semId: block.id, kind: block.kind }));

// The composed ProseMirror schema — a REAL Schema built once from every capability registered
// above (a lazy Proxy stand-in was tried and rejected: it is not transparently a Schema, so PM
// identity / spread / instanceof / `state.schema === doc.type.schema` checks break). Registration
// therefore happens at module-load time: the built-ins here, plus any feature whose registration
// module is evaluated BEFORE this one. NOTE (known limitation): because this build is eager,
// registering a NEW node/mark AFTER engine-binding is imported is not yet supported (a deferred-
// build entry point is a follow-up); the current editable surface is paragraph + read-only atom.
export const docSchema: Schema = buildDocSchema();

