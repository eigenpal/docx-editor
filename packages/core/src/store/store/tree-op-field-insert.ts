// Field insertion ops: the page-number fields and one inert complex field.
//
// Split out of `tree-op-types.ts` and `tree-op-validate.ts`, which are at their line caps. Both
// ops write a complete complex field. With a revision, the whole field goes into ONE `w:ins`,
// because the field is one proposal: rejecting it must take the complete atom back, never leave
// a `begin` without its `end`. A `w:fldSimple` is never written into a revision.

import type { EditOptions } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import {
  readOoxmlPart,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { escapeXml } from '../package/sinks.ts';
import { storyParagraphs } from '../package/story-blocks.ts';
import { inertFieldInstruction, inertFieldKeyword } from './inert-field-instruction.ts';
import { insertionRunPropertiesAt } from './tree-op-field-formatting.ts';
import { applyInsertFragment } from './tree-op-fragment.ts';
import { complexFieldRuns } from './tree-op-fields.ts';
import { applyInsertTrackedRun } from './tree-op-tracked.ts';
import { invalidRevisionAttribution } from './tree-op-revision-attribution.ts';
import type { RevisionAttributionInput } from './tree-op-revision-attribution.ts';
import { splitsSurrogate } from './tree-op-segments.ts';
import type { TreeOpRejection, TreeOpResult } from './tree-op-types.ts';
import { rejectContentEdit } from './tree-op-validate-controls.ts';

/**
 * Insert an allowlisted page-number complex field at a UTF-16 offset.
 *
 * `PAGE_X_OF_Y` is PAGE + literal " of " + NUMPAGES in one undoable op. Non-page
 * instructions are refused — never authored through this path.
 */
export interface InsertPageFieldOp {
  readonly op: 'insertPageField';
  readonly paragraphId: string;
  readonly offset: number;
  readonly field: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES' | 'PAGE_X_OF_Y';
  /**
   * Write this as a TRACKED insertion, on the same terms as `insertText`.
   *
   * The whole field — every `w:fldChar`, the instruction, the `PAGE_X_OF_Y` literal —
   * goes into ONE `w:ins`, because the field is one proposal: rejecting it must take
   * the complete atom back, never leave a `begin` standing without its `end`.
   */
  readonly revision?: RevisionAttributionInput;
}

/**
 * Insert one complex field with an empty cached result at a UTF-16 offset.
 *
 * The instruction must be one that `inertFieldInstruction` admits: a page number, a reference
 * to a bookmark, note, or style, a sequence number, or a date. It is written as text and never
 * evaluated. Every other instruction refuses with `invalidArgs`.
 */
export interface InsertComplexFieldOp {
  readonly op: 'insertComplexField';
  readonly paragraphId: string;
  readonly offset: number;
  readonly instruction: string;
  /** Write the whole field as ONE tracked insertion, on the same terms as `insertText`. */
  readonly revision?: RevisionAttributionInput;
}

const PAGE_FIELDS: ReadonlySet<unknown> = new Set([
  'PAGE',
  'NUMPAGES',
  'SECTIONPAGES',
  'PAGE_X_OF_Y',
]);

/** Validate either field insertion against its paragraph, before any tree work. */
export function validateFieldInsertion(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  length: number,
  op: InsertPageFieldOp | InsertComplexFieldOp
): TreeOpRejection | null {
  if (!Number.isInteger(op.offset) || op.offset < 0 || op.offset > length) {
    return 'offset-out-of-range';
  }
  if (splitsSurrogate(paragraph, op.offset)) return 'splits-surrogate-pair';
  if (op.op === 'insertPageField' ? !PAGE_FIELDS.has(op.field) : !insertableInstruction(op)) {
    return 'invalidArgs';
  }
  // `CT_TrackChange` makes `@w:author` required, so a tracked variant with an empty one
  // would serialize a proposal no reader can attribute or resolve.
  if (op.revision !== undefined && invalidRevisionAttribution(op.revision)) {
    return 'invalid-property-value';
  }
  return rejectContentEdit(part, paragraph, op.offset, op.offset);
}

/** The op is a trust boundary of its own: only the normalized instruction is written. */
function insertableInstruction(op: InsertComplexFieldOp): boolean {
  return inertFieldInstruction(op.instruction) === op.instruction;
}

/**
 * Write the field as five runs: `begin`, instruction, `separate`, an empty result, `end`. With a revision the
 * runs go into ONE `w:ins` through the placement typed text follows. Without one they land
 * as a one-paragraph fragment, so the field shape is the same in both arms.
 *
 * Every run takes the formatting a word typed at the offset would take. The begin marker
 * carries `w:dirty="true"` unless the field is PAGE or NUMPAGES, whose result `updateResult`
 * computes: the cached result is empty, so a reader that evaluates fields recomputes it.
 */
export function applyInsertComplexField(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  op: InsertComplexFieldOp,
  options?: EditOptions
): TreeOpResult {
  const keyword = inertFieldKeyword(op.instruction);
  const dirty = keyword !== 'PAGE' && keyword !== 'NUMPAGES';
  if (op.revision) {
    return applyInsertTrackedRun(
      part,
      paragraph,
      op.offset,
      (mint) =>
        complexFieldRuns(mint, op.instruction, {
          dirty,
          properties: () => insertionRunPropertiesAt(part, paragraph, op.offset, mint),
        }),
      op.revision,
      options
    );
  }
  let counter = 0;
  const properties = insertionRunPropertiesAt(part, paragraph, op.offset, () => `f${counter++}`);
  const block = complexFieldParagraph(op.instruction, dirty, properties);
  if (!block) return { ok: false, reason: 'invalidArgs' };
  return applyInsertFragment(
    part,
    {
      op: 'insertFragment',
      paragraphId: op.paragraphId,
      offset: op.offset,
      blocks: [block],
      lastMarkCovered: false,
    },
    options
  );
}

/**
 * A one-paragraph fragment holding the field's five runs, read through the bounded parser.
 * Each run gets `properties`; the fragment insertion gives every node a fresh id.
 */
function complexFieldParagraph(
  instruction: string,
  dirty: boolean,
  properties: readonly OoxmlNode[]
): OoxmlParagraphNode | null {
  const run = (content: string) => `<w:r>${content}</w:r>`;
  const marker = (type: string) =>
    run(
      `<w:fldChar w:fldCharType="${type}"${type === 'begin' && dirty ? ' w:dirty="true"' : ''}/>`
    );
  const content =
    marker('begin') +
    run(`<w:instrText xml:space="preserve"> ${escapeXml(instruction)} </w:instrText>`) +
    marker('separate') +
    run('<w:t/>') +
    marker('end');
  const read = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p>${content}</w:p></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!read.ok) return null;
  const body = read.part.root.children.find((node) => node.kind === 'body');
  const paragraph = body && storyParagraphs(body)[0];
  if (!paragraph || paragraph.kind !== 'paragraph') return null;
  if (properties.length === 0) return paragraph;
  return {
    ...paragraph,
    children: paragraph.children.map((child) =>
      child.kind === 'run' ? { ...child, children: [...properties, ...child.children] } : child
    ),
  } as OoxmlParagraphNode;
}
