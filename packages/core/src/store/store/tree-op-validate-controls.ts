// Content-control restrictions, as the validator sees them (store lane).
//
// Split out of tree-op-validate.ts, which is at its line cap. `w:sdt` locks are the one
// refusal family that needs its own ancestor walk: whether an edit is allowed depends not
// on the node it names but on every control WRAPPING that node. Re-exported from
// tree-op-validate.ts so importers keep one entry point.

import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { isValidXmlText } from '../package/sinks.ts';
import {
  contentControlAncestorsOf,
  contentControlValueTypeOf,
  declaredLockOf,
  effectiveContentLockAt,
  effectiveLockOf,
  findContentControl,
  formatSdtDateDisplay,
  innermostContentControlAround,
  isBoundAt,
  isBoundContentControl,
  isContentControlNode,
  isRepeatingSectionControl,
  isShowingPlaceholder,
  isTemporaryControl,
  leavesInlineContainer,
  listItemsOf,
  parseCheckboxValue,
} from './tree-op-nodes.ts';
import { segmentsOf } from './tree-op-segments.ts';
import type { TreeOpRejection } from './tree-op-types.ts';

/**
 * The content control that owns a caret/range in a paragraph — innermost ancestor of the
 * run under the caret. At a boundary, a `showingPlcHdr` control on either side wins so a
 * first keystroke replaces the prompt rather than appending beside it.
 */
export function contentControlAtCaret(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  bias?: 'left' | 'right'
): ReturnType<typeof findContentControl> {
  const segments = segmentsOf(paragraph);
  const overlapping = segments.filter((segment) => segment.start < end && segment.end > start);
  if (overlapping.length > 0) {
    return innermostContentControlAround(part, overlapping[0]!.runId);
  }
  if (start !== end) {
    return innermostContentControlAround(part, paragraph.id);
  }
  const after = segments.find((segment) => segment.start === start);
  const before = [...segments].reverse().find((segment) => segment.end === start);
  const afterControl = after ? innermostContentControlAround(part, after.runId) : null;
  const beforeControl = before ? innermostContentControlAround(part, before.runId) : null;
  if (afterControl && isShowingPlaceholder(afterControl)) return afterControl;
  if (beforeControl && isShowingPlaceholder(beforeControl)) return beforeControl;
  // A `w:temporary` control at either side of the caret is claimed EAGERLY, like a
  // placeholder: its contract is unwrap-on-first-edit, and a keystroke at its boundary is
  // that edit (pinned by the temporary-unwrap tests).
  if (afterControl && isTemporaryControl(afterControl)) return afterControl;
  if (beforeControl && isTemporaryControl(beforeControl)) return beforeControl;
  // Otherwise attribute the caret to the control the APPLY side would type into, under
  // apply's EXACT conditions — bias left, an intact (non-deleted) before segment, no
  // control-membership change across the boundary, and not leaving a link/field.
  // Mirroring only part of the rule is how a `bias: 'right'` insert validated against
  // the outside run while apply wrote inside a locked chip.
  if (
    bias !== 'right' &&
    before &&
    before.removeNodeIds === undefined &&
    beforeControl?.id === afterControl?.id &&
    !leavesInlineContainer(paragraph, before, after)
  ) {
    return beforeControl ?? innermostContentControlAround(part, paragraph.id);
  }
  // At an inline-control boundary the run STARTING at the caret owns the insertion —
  // typing at a control's leading edge enters it, as in Word.
  if (after) return afterControl ?? innermostContentControlAround(part, paragraph.id);
  if (beforeControl) {
    // Outer edge with nothing beyond: only controls ABOVE the one being left still own
    // the caret (a run inside a control with no after segment always leaves it).
    const ancestors = contentControlAncestorsOf(part, beforeControl.id);
    return ancestors[ancestors.length - 1] ?? null;
  }
  return innermostContentControlAround(part, paragraph.id);
}

/**
 * Whether `[start, end)` overlaps content that an enclosing content control forbids editing.
 * A range that merely touches a lock boundary is refused whole — never partially applied.
 *
 * `dataBinding` refuses before placeholder/temporary transitions. A `w:temporary` control
 * whose wrapper cannot be removed (effective `sdtLocked` / `sdtContentLocked`) refuses the
 * whole content edit with `locked` — temporary's contract is unwrap-on-edit.
 */
export function rangeTouchesContentRestriction(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  bias?: 'left' | 'right'
): TreeOpRejection | null {
  const segments = segmentsOf(paragraph);
  const overlappingRunIds = new Set(
    segments.filter((segment) => segment.start < end && segment.end > start).map((s) => s.runId)
  );
  // A collapsed insert at `start` (end === start) still sits at a caret. The run checked
  // is the run the APPLY side would type into, under apply's EXACT conditions (bias left,
  // an intact before segment, not leaving a container) — mirroring only part of the rule
  // is how a `bias: 'right'` insert validated against the outside run while apply wrote
  // inside a locked chip. At a container's outer edge with nothing beyond, the insert
  // lands BESIDE it and the control check below owns ancestor locks.
  if (overlappingRunIds.size === 0 && start === end) {
    const after = segments.find((segment) => segment.start === start);
    const before = [...segments].reverse().find((segment) => segment.end === start);
    const leftWins =
      bias !== 'right' &&
      before !== undefined &&
      before.removeNodeIds === undefined &&
      // The same control-membership guard apply's `crossesContentControlBoundary` applies:
      // at a control boundary the run STARTING at the caret owns the insertion.
      innermostContentControlAround(part, before.runId)?.id ===
        (after ? innermostContentControlAround(part, after.runId)?.id : undefined) &&
      !leavesInlineContainer(paragraph, before, after);
    const at = leftWins ? before : after;
    if (at) overlappingRunIds.add(at.runId);
  }
  for (const runId of overlappingRunIds) {
    if (isBoundAt(part, runId)) return 'bound';
    if (effectiveContentLockAt(part, runId).content) return 'locked';
  }
  const control = contentControlAtCaret(part, paragraph, start, end, bias);
  if (control) {
    if (
      isBoundContentControl(control) ||
      contentControlAncestorsOf(part, control.id).some(isBoundContentControl)
    ) {
      return 'bound';
    }
    // Empty paragraphs have no overlapping runs, so content lock must be read from the
    // control itself — otherwise an empty `contentLocked` / `sdtContentLocked` control
    // would admit the first insertion.
    if (effectiveLockOf(part, control).content) return 'locked';
    if (isTemporaryControl(control) && effectiveLockOf(part, control).wrapper) {
      return 'locked';
    }
  }
  return null;
}

export function holds(node: OoxmlNode, id: string): boolean {
  if (node.id === id) return true;
  if (node.kind === 'textValue') return false;
  return node.children.some((child) => holds(child, id));
}

/** Refuse a content-bearing edit that would rewrite a locked or bound region. */
export function rejectContentEdit(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  bias?: 'left' | 'right'
): TreeOpRejection | null {
  return rangeTouchesContentRestriction(part, paragraph, start, end, bias);
}

/**
 * Whether rewriting a node (hyperlink retarget/removal, and similar) would touch a locked or
 * bound content control that encloses it. Same axes as {@link rangeTouchesContentRestriction}:
 * `dataBinding` → `bound`, content lock → `locked`, temporary unwrap blocked by wrapper lock →
 * `locked`.
 */
export function nodeTouchesContentRestriction(
  part: OoxmlPart,
  nodeId: string
): TreeOpRejection | null {
  if (isBoundAt(part, nodeId)) return 'bound';
  if (effectiveContentLockAt(part, nodeId).content) return 'locked';
  const control = innermostContentControlAround(part, nodeId);
  if (control) {
    if (
      isBoundContentControl(control) ||
      contentControlAncestorsOf(part, control.id).some(isBoundContentControl)
    ) {
      return 'bound';
    }
    if (isTemporaryControl(control) && effectiveLockOf(part, control).wrapper) {
      return 'locked';
    }
  }
  return null;
}

/**
 * Whether deleting `block` would destroy a locked or bound content control: enclosing content
 * locks / bindings on the block itself, or any descendant control whose content lock, wrapper
 * lock, or data binding would be removed with the subtree.
 *
 * Wrapper locks matter on descendants because `deleteBlock` removes the wrapper from the
 * document; they do not matter on ancestors (deleting a paragraph inside an `sdtLocked`
 * control leaves the wrapper in place).
 */
export function deleteBlockTouchesContentRestriction(
  part: OoxmlPart,
  block: OoxmlNode
): TreeOpRejection | null {
  if (block.kind === 'textValue') return null;
  if (isBoundAt(part, block.id)) return 'bound';
  if (effectiveContentLockAt(part, block.id).content) return 'locked';

  const walk = (node: OoxmlNode): TreeOpRejection | null => {
    if (node.kind === 'textValue') return null;
    if (isContentControlNode(node)) {
      if (isBoundContentControl(node)) return 'bound';
      const lock = declaredLockOf(node);
      if (lock.content || lock.wrapper) return 'locked';
    }
    for (const child of node.children) {
      const rejection = walk(child);
      if (rejection) return rejection;
    }
    return null;
  };
  return walk(block);
}

export function validateSetContentControlValue(
  part: OoxmlPart,
  controlId: string,
  value: string
): TreeOpRejection | null {
  if (typeof controlId !== 'string' || controlId.length === 0) return 'unknown-control';
  const control = findContentControl(part, controlId);
  if (!control) return 'unknown-control';
  if (
    isRepeatingSectionControl(control) ||
    contentControlValueTypeOf(control) === 'repeatingSection'
  ) {
    return 'unsupported';
  }
  if (
    isBoundContentControl(control) ||
    contentControlAncestorsOf(part, control.id).some(isBoundContentControl)
  ) {
    return 'bound';
  }
  if (effectiveLockOf(part, control).content) return 'locked';
  // Temporary unwrap is part of a successful value write; refuse when the wrapper is locked.
  if (isTemporaryControl(control) && effectiveLockOf(part, control).wrapper) return 'locked';
  if (typeof value !== 'string' || !isValidXmlText(value)) return 'invalidArgs';

  const type = contentControlValueTypeOf(control);
  switch (type) {
    case 'dropdown': {
      const items = listItemsOf(control);
      if (!items.some((item) => item.value === value)) return 'invalidArgs';
      return null;
    }
    case 'combo':
      return null;
    case 'checkbox':
      return parseCheckboxValue(value) === null ? 'typeMismatch' : null;
    case 'date': {
      if (formatSdtDateDisplay(value, undefined) === null) return 'invalidArgs';
      return null;
    }
    case 'picture':
      return 'typeMismatch';
    case 'text':
    case 'richText':
    case 'other':
      return null;
    default:
      return 'unsupported';
  }
}

export function validateRemoveContentControl(
  part: OoxmlPart,
  controlId: string
): TreeOpRejection | null {
  if (typeof controlId !== 'string' || controlId.length === 0) return 'unknown-control';
  const control = findContentControl(part, controlId);
  if (!control) return 'unknown-control';
  if (effectiveLockOf(part, control).wrapper) return 'locked';
  return null;
}
