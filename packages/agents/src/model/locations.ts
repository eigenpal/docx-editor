// The insert locations, and the argument checks every model call starts with.
//
// TWO REASONS THIS IS ITS OWN FILE. The first is that "where does this text go" is one vocabulary
// shared by `Body`, `Paragraph` and `Range`, each accepting a different SUBSET of it — and a subset
// is only meaningful if the whole is written down once. The second is that these values arrive from
// a consumer, in a language with no runtime types: `insertText('x', 'Ende')` is a typo that a model
// which trusted its parameters would turn into a silent no-op or, worse, an insertion somewhere
// plausible. Every one of them is checked against the list and refused by name.

import { fail } from '../runtime/model-support.ts';

/** Every place this API can insert at. Individual members accept a subset. */
export type InsertLocation = 'Replace' | 'Start' | 'End' | 'Before' | 'After';

/** Where a story accepts text: over all of it, or at either edge. */
export type BodyInsertTextLocation = Extract<InsertLocation, 'Replace' | 'Start' | 'End'>;

/** Where a story accepts a paragraph. `Start`/`End` mean "before the first"/"after the last". */
export type BodyInsertParagraphLocation = Extract<InsertLocation, 'Start' | 'End'>;

/** Where a paragraph accepts text: over all of it, or at either edge of it. */
export type ParagraphInsertTextLocation = Extract<InsertLocation, 'Replace' | 'Start' | 'End'>;

/** Which side of a paragraph or a range a new paragraph goes on. */
export type BesideLocation = Extract<InsertLocation, 'Before' | 'After'>;

/** Where a range accepts text. See `Range#insertText` for what `Before`/`Start` mean here. */
export type RangeInsertTextLocation = InsertLocation;

/** Where a selection lands: over the range, or collapsed to one of its edges. */
export type SelectionMode = 'Select' | 'Start' | 'End';

const BODY_TEXT: readonly BodyInsertTextLocation[] = ['Replace', 'Start', 'End'];
const BODY_PARAGRAPH: readonly BodyInsertParagraphLocation[] = ['Start', 'End'];
const PARAGRAPH_TEXT: readonly ParagraphInsertTextLocation[] = ['Replace', 'Start', 'End'];
const BESIDE: readonly BesideLocation[] = ['Before', 'After'];
const RANGE_TEXT: readonly RangeInsertTextLocation[] = [
  'Replace',
  'Start',
  'End',
  'Before',
  'After',
];
const SELECTION: readonly SelectionMode[] = ['Select', 'Start', 'End'];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], target: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail({ code: 'InvalidArgument', target });
  }
  return value as T;
}

export const bodyTextLocation = (value: unknown, target: string): BodyInsertTextLocation =>
  oneOf(value, BODY_TEXT, target);

export const bodyParagraphLocation = (
  value: unknown,
  target: string
): BodyInsertParagraphLocation => oneOf(value, BODY_PARAGRAPH, target);

export const paragraphTextLocation = (
  value: unknown,
  target: string
): ParagraphInsertTextLocation => oneOf(value, PARAGRAPH_TEXT, target);

export const besideLocation = (value: unknown, target: string): BesideLocation =>
  oneOf(value, BESIDE, target);

export const rangeTextLocation = (value: unknown, target: string): RangeInsertTextLocation =>
  oneOf(value, RANGE_TEXT, target);

export const selectionMode = (value: unknown, target: string): SelectionMode =>
  value === undefined ? 'Select' : oneOf(value, SELECTION, target);

/**
 * Text a write is allowed to carry.
 *
 * A paragraph mark is refused HERE rather than at the host, because the answer is about the call
 * and not about the document: this API's `insertText` writes text into a paragraph, and Word's
 * habit of splitting paragraphs on an embedded newline is a different operation
 * (`insertParagraph`). Accepting the character and writing it into a run would produce a document
 * whose text reads back with a break that the layout does not honour.
 */
export function insertableText(value: unknown, target: string): string {
  if (typeof value !== 'string') fail({ code: 'InvalidArgument', target });
  if (/[\r\n\v\f\u2028\u2029]/.test(value)) fail({ code: 'InvalidArgument', target });
  return value;
}
