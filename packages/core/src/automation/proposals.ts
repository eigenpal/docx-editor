// Explicit proposals must remain independent review decisions. Adjacent Word revisions
// can coalesce, so pending revision boundaries are excluded as well as their interiors.
import type { AutomationOperation } from './operations.ts';
import type { AutomationError, AutomationErrorCode } from './protocol.ts';
import type { AutomationStoryReads } from './reads.ts';
import { revisionItemsInStory } from './review.ts';
import { isValidXmlText } from '../store/package/sinks.ts';

type Proposal = Extract<
  AutomationOperation,
  { op: 'proposeInsertion' | 'proposeDeletion' | 'proposeReplacement' }
>;
const PARAGRAPH_BREAKING = /[\r\n\v\f\u2028\u2029]/;
function invalid(code: AutomationErrorCode, message: string, detail: string): AutomationError {
  return { code, message, detail };
}
export function proposalInputError(operation: Proposal): AutomationError | null {
  if (
    typeof operation.author !== 'string' ||
    !operation.author.trim() ||
    !isValidXmlText(operation.author)
  ) {
    return invalid('unsupported-content', 'proposals need a non-empty XML-safe author', 'author');
  }
  const insertion = operation.op === 'proposeInsertion';
  const deletion = operation.op === 'proposeDeletion';
  if (
    !deletion &&
    (typeof operation.text !== 'string' ||
      !operation.text.length ||
      PARAGRAPH_BREAKING.test(operation.text) ||
      !isValidXmlText(operation.text))
  ) {
    return invalid('unsupported-content', 'proposals need non-empty inline XML-safe text', 'text');
  }
  if (insertion && operation.where !== 'Before' && operation.where !== 'After') {
    return invalid('unsupported-content', 'insertion needs Before or After', 'where');
  }

  return null;
}
export function proposalRevisionError(
  story: AutomationStoryReads,
  paragraphId: string,
  start: number,
  end: number
): AutomationError | null {
  const overlaps = revisionItemsInStory(story).some((item) =>
    item.ranges.some((r) => {
      const first = story.indexOf(r.start.paragraphId);
      const last = story.indexOf(r.end.paragraphId);
      const index = story.indexOf(paragraphId);
      if (index < first || index > last) return false;
      const a = index === first ? r.start.offset : 0;
      const b = index === last ? r.end.offset : Infinity;
      return start <= b && end >= a;
    })
  );
  if (overlaps)
    return invalid(
      'unsupported-revision',
      'proposal touches or overlaps a pending revision',
      'span'
    );

  return null;
}
