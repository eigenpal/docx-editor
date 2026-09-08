import type { ReviewRevisionItem } from '@docx-editor.dev/core/contracts/editor';

type Presentation = {
  label: string;
  description: string;
  decoration: 'insert' | 'delete' | 'neutral';
};
/** Describe the actual decision, including imported Word revisions without inline text. */
export function revisionPresentation(
  item: Pick<ReviewRevisionItem, 'revisionKind' | 'markDirection'>
): Presentation {
  switch (item.revisionKind) {
    case 'insert':
      return { label: 'Insertion', description: 'Inserted text', decoration: 'insert' };
    case 'delete':
      return { label: 'Deletion', description: 'Deleted text', decoration: 'delete' };
    case 'replace':
      return { label: 'Replacement', description: 'Replacement text', decoration: 'insert' };
    case 'moveFrom':
      return {
        label: 'Moved from',
        description: 'Text moved from this location',
        decoration: 'delete',
      };
    case 'moveTo':
      return {
        label: 'Moved to',
        description: 'Text moved to this location',
        decoration: 'insert',
      };
    case 'format':
      return { label: 'Formatting', description: 'Formatting changed', decoration: 'neutral' };
    case 'structural':
      return {
        label: 'Structure',
        description: 'Document structure changed',
        decoration: 'neutral',
      };
    case 'paragraphMark': {
      const descriptions = {
        insert: 'Paragraph break inserted',
        delete: 'Paragraph break deleted',
        moveFrom: 'Paragraph break moved from this location',
        moveTo: 'Paragraph break moved to this location',
      };
      return {
        label: 'Paragraph break',
        description: descriptions[item.markDirection ?? 'insert'],
        decoration: 'neutral',
      };
    }
  }
}
