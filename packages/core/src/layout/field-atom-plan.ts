import type { OoxmlParagraphNode } from '@docx-editor.dev/core/store';
import { parsedFieldSpansOf } from '../store/package/field-nodes.ts';
import { MAX_FIELD_NESTING, MAX_FIELD_INSTRUCTION_CHARS } from './field-instruction.ts';

/** Resolve atomic field coverage once for a paragraph walk. */
export function fieldAtomPlan(paragraph: OoxmlParagraphNode) {
  const fields = parsedFieldSpansOf(paragraph, {
    maxNesting: MAX_FIELD_NESTING,
    maxInstructionChars: MAX_FIELD_INSTRUCTION_CHARS,
  });
  const atoms = fields.filter((span) => span.addressing === 'atomic');
  const atomBeginIds = new Set(
    atoms.filter((span) => span.kind === 'complex').map((span) => span.node.id)
  );
  const editableResultBeginIds = new Set(
    fields
      .filter((span) => span.kind === 'complex' && span.addressing === 'editable-result')
      .map((span) => span.node.id)
  );
  const coveredIds = new Set<string>();
  for (const span of atoms) {
    for (const id of span.removeNodeIds) coveredIds.add(id);
  }

  return { atomBeginIds, editableResultBeginIds, coveredIds };
}
