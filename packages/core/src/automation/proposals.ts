// Explicit proposals must remain independent review decisions. Adjacent Word revisions
// can coalesce, so pending revision boundaries are excluded as well as their interiors.
import type { AutomationOperation } from './operations.ts';
import type { AutomationError, AutomationErrorCode } from './protocol.ts';
import type { AutomationStoryReads } from './reads.ts';
import { revisionItemsOf } from '../store/store/review-reads.ts';
import { isValidXmlText } from '../store/package/sinks.ts';
import { parentNodeOf } from '../store/package/ooxml-edit.ts';
import { namedChild } from '../store/store/tree-op-nodes.ts';
import { revisionSiteNodeIdsOf } from '../store/store/review-items.ts';

type Proposal = Extract<
  AutomationOperation,
  { op: 'proposeInsertion' | 'proposeDeletion' | 'proposeReplacement' }
>;
const PARAGRAPH_BREAKING = /[\r\n\v\f\u2028\u2029]/;
function invalid(code: AutomationErrorCode, message: string, detail: string): AutomationError {
  return { code, message, detail };
}
export function proposalInputError(
  operation: Proposal,
  allowEmpty = false
): AutomationError | null {
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
      (!allowEmpty && !operation.text.length) ||
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
  // Shared note parts can group one revision identity across several stories. Check the
  // individual sites and ranges, rather than discarding a group that spans note boundaries.
  const items = revisionItemsOf(story.part);
  const ancestors = new Set<string>();
  if (items.some((item) => item.revisionKind === 'structural')) {
    for (
      let node = parentNodeOf(story.part, paragraphId);
      node !== null;
      node = parentNodeOf(story.part, node.id)
    ) {
      ancestors.add(node.id);
      if (node.id === story.root.id) break;
    }
  }
  const overlaps = items.some((item) => {
    if (item.revisionKind === 'structural') {
      // Row/cell ranges locate review cards at the first paragraph's start. Their actual
      // coverage is the owning subtree, including later paragraphs and nested tables.
      const sites = revisionSiteNodeIdsOf(item);
      let ownedSites = 0;
      for (const site of sites) {
        const properties = parentNodeOf(story.part, site);
        const owner = properties && parentNodeOf(story.part, properties.id);
        const propertyName =
          owner?.kind === 'tableRow' ? 'trPr' : owner?.kind === 'tableCell' ? 'tcPr' : null;
        if (!owner || !propertyName || namedChild(owner, propertyName)?.id !== properties?.id)
          continue;
        if (ancestors.has(owner.id)) return true;
        ownedSites += 1;
      }
      // These card anchors must not prevent edits in an unrelated cell or row.
      if (sites.length > 0 && ownedSites === sites.length) return false;
    }
    return item.ranges.some((r) => {
      const first = story.indexOf(r.start.paragraphId);
      const last = story.indexOf(r.end.paragraphId);
      const index = story.indexOf(paragraphId);
      if (first < 0 || last < 0) return false;
      if (index < first || index > last) return false;
      const a = index === first ? r.start.offset : 0;
      const b = index === last ? r.end.offset : Infinity;
      return start <= b && end >= a;
    });
  });
  if (overlaps)
    return invalid(
      'unsupported-revision',
      'proposal touches or overlaps a pending revision',
      'span'
    );

  return null;
}
