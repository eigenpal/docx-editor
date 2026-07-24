// Canonical paragraph ownership for semantic sync (interactive-paginated-editing 4.2).
// Derives editability from model traversal context — never from caller-supplied roles.

import {
  bodyStoryId,
  isTopLevelEditable,
  type Block,
  type PackageModel,
  type ParagraphRecord,
  type SdtRecord,
  type TableRecord,
} from '@docx-editor.dev/engine-core';

export interface ParagraphTraversalContext {
  readonly inTopLevelBodyFlow: boolean;
  readonly inTableCell: boolean;
}

export type ParagraphOwnershipRejectReason = 'tableCell' | 'structural' | 'missing';

export interface ParagraphOwnership {
  readonly paragraph: ParagraphRecord;
  readonly editable: boolean;
  readonly rejectReason?: ParagraphOwnershipRejectReason;
}

function flattenSdt(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.kind === 'sdt') out.push(...flattenSdt((b as SdtRecord).blocks));
    else out.push(b);
  }
  return out;
}

function paragraphEditableInLane(context: ParagraphTraversalContext): boolean {
  if (context.inTableCell) return false;
  if (!context.inTopLevelBodyFlow) return false;
  return isTopLevelEditable('paragraph');
}

function walk(
  blocks: readonly Block[],
  context: ParagraphTraversalContext,
  blockId: string,
): ParagraphOwnership | null {
  for (const block of flattenSdt(blocks)) {
    if (block.kind === 'paragraph' && block.id === blockId) {
      const editable = paragraphEditableInLane(context);
      return {
        paragraph: block as ParagraphRecord,
        editable,
        rejectReason: editable ? undefined : context.inTableCell ? 'tableCell' : 'structural',
      };
    }
    if (block.kind === 'table') {
      for (const row of (block as TableRecord).rows) {
        for (const cell of row.cells) {
          const found = walk(cell.blocks, { inTopLevelBodyFlow: false, inTableCell: true }, blockId);
          if (found) return found;
        }
      }
    }
  }
  return null;
}

/** Locate a paragraph and whether the binding lane may edit it. */
export function paragraphOwnership(model: PackageModel, blockId: string, storyId = bodyStoryId(model)): ParagraphOwnership | null {
  const story = model.stories.get(storyId);
  if (!story) return null;
  return walk(story.blocks, { inTopLevelBodyFlow: true, inTableCell: false }, blockId);
}

/** Whether a top-level block id refers to a read-only structural block. */
export function topLevelBlockKind(
  model: PackageModel,
  blockId: string,
  storyId = bodyStoryId(model),
): 'paragraph' | 'readOnlyBlock' | 'missing' {
  const story = model.stories.get(storyId);
  if (!story) return 'missing';
  for (const block of flattenSdt(story.blocks)) {
    if (block.id !== blockId) continue;
    return block.kind === 'paragraph' ? 'paragraph' : 'readOnlyBlock';
  }
  return 'missing';
}
