// Paragraph formatting over a content lock, answered BEFORE the write, so `can`, the toolbar
// and `exec` all say the same thing. Several paragraph writers return nothing, so a store
// refusal inside them reached the caller as `ok` with no change. Asking the store's own rule
// here first is what keeps a button from looking available and then doing nothing.

import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { ContentLockPolicy } from '../store/package/ooxml-edit.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  contentControlPropertiesOf,
  contentControlsIn,
  lockForbidsEdit,
} from '../store/package/content-control-nodes.ts';
import { directParagraphProperties, propertyContainer } from '../store/store/direct-properties.ts';
import { isBoundAt } from '../store/store/tree-op-nodes.ts';
import { validateTreeOp } from '../store/store/tree-op-validate.ts';
import type { TreeDocOp } from '../store/store/tree-op-types.ts';
import { paragraphsInCells } from '../layout/semantic-cell-selection.ts';
import { LOCKED_FORMAT_REASON } from './content-lock-format-refusal.ts';
import { partOfNodeId, storyScopeOfNodeId } from './surface-scope.ts';

/** A content lock lets only alignment through, so every other paragraph format names that. */
export const LOCKED_PARAGRAPH_FORMAT_REASON = 'this content is locked; only alignment can change';

/** A data binding mirrors another part, so the engine cannot change the paragraph either. */
export const BOUND_PARAGRAPH_FORMAT_REASON = 'this content is bound to data and cannot change';

type ParagraphFormatCommand = Extract<
  EditorCommand,
  {
    type:
      | 'setAlignment'
      | 'setParagraphDirection'
      | 'setLineSpacing'
      | 'setParagraphSpacing'
      | 'setIndent'
      | 'adjustIndent'
      | 'toggleList'
      | 'setParagraphStyle'
      | 'setParagraphFormat';
  }
>;

const PARAGRAPH_FORMAT_COMMANDS: ReadonlySet<EditorCommand['type']> = new Set<
  ParagraphFormatCommand['type']
>([
  'setAlignment',
  'setParagraphDirection',
  'setLineSpacing',
  'setParagraphSpacing',
  'setIndent',
  'adjustIndent',
  'toggleList',
  'setParagraphStyle',
  'setParagraphFormat',
]);

/** Whether the command changes paragraph alignment and nothing else. */
function alignsOnly(command: ParagraphFormatCommand): boolean {
  if (command.type === 'setAlignment') return true;
  if (command.type !== 'setParagraphFormat') return false;
  const { type: _type, alignment, ...others } = command;
  return alignment !== undefined && Object.values(others).every((value) => value === undefined);
}

/** The paragraphs a paragraph write reaches, with the same coverage the writer uses. */
function selectedParagraphIds(surface: PaginatedSurface): readonly string[] {
  const state = surface.state();
  const cells = state.cellSelection;
  if (cells) return [...paragraphsInCells(surface.layout(), cells.cellIds)];
  const { anchor, head } = state.selection;
  if (anchor.paragraphId === head.paragraphId) return [head.paragraphId];
  const scope = storyScopeOfNodeId(surface.session, anchor.paragraphId, { kind: 'body' });
  const order = surface.session.paragraphIdsIn(scope);
  const a = order.indexOf(anchor.paragraphId);
  const b = order.indexOf(head.paragraphId);
  if (a === -1 || b === -1) return [anchor.paragraphId, head.paragraphId];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * Per story root: the paragraphs inside a control that locks content or binds data. Every
 * paragraph the store can protect is in this set, so the store is asked only about these.
 * Canonical roots are immutable per revision, so the root identity is a safe key.
 */
const PROTECTED_PARAGRAPHS = new WeakMap<object, ReadonlySet<string>>();

function protectedParagraphs(part: OoxmlPart): ReadonlySet<string> {
  const known = PROTECTED_PARAGRAPHS.get(part.root);
  if (known) return known;
  const ids = new Set<string>();
  for (const entry of contentControlsIn(part.root)) {
    const properties = contentControlPropertiesOf(entry.node);
    if (!lockForbidsEdit(properties.lock) && properties.dataBinding === undefined) continue;
    const pending: OoxmlNode[] = [entry.node];
    while (pending.length > 0) {
      const node = pending.pop()!;
      if (node.kind === 'textValue') continue;
      if (node.kind === 'paragraph') ids.add(node.id);
      for (const child of node.children) pending.push(child);
    }
  }
  PROTECTED_PARAGRAPHS.set(part.root, ids);
  return ids;
}

/** Whether the paragraph holds a pending paragraph property change. */
function hasPendingParagraphChange(part: OoxmlPart, paragraphId: string): boolean {
  const paragraph = findNode(part, paragraphId);
  if (paragraph?.kind !== 'paragraph') return false;
  const properties = propertyContainer(paragraph, 'paragraphProperties', 'pPr');
  return (
    properties !== undefined &&
    properties.kind !== 'textValue' &&
    properties.children.some(
      (child) => child.kind !== 'textValue' && child.localName === 'pPrChange'
    )
  );
}

/**
 * The write the store is asked about. Alignment asks with the alignment it would write,
 * tracked as the surface would track it. Every other command asks with a change to a
 * property other than alignment, because that is the part of the write a lock refuses.
 */
function probeOp(
  part: OoxmlPart,
  paragraphId: string,
  aligns: boolean,
  author: string | undefined
): TreeDocOp {
  const direct = directParagraphProperties(part, paragraphId);
  if (aligns) {
    return {
      op: 'setParagraphProperties',
      paragraphId,
      properties: [
        ...direct.filter((property) => property.localName !== 'jc'),
        { localName: 'jc', attributes: { val: 'center' } },
      ],
      ...(author !== undefined ? { revision: { author } } : {}),
    };
  }
  const withoutKeep = direct.filter((property) => property.localName !== 'keepNext');
  return {
    op: 'setParagraphProperties',
    paragraphId,
    properties:
      withoutKeep.length === direct.length ? [...direct, { localName: 'keepNext' }] : withoutKeep,
  };
}

/**
 * The refusal a paragraph formatting command meets because the selection reaches a
 * paragraph that a content lock or a data binding protects, or null.
 *
 * Alignment passes a content lock, so it is refused only where the store refuses the exact
 * alignment write. Every other paragraph format is refused wherever the lock reaches.
 */
export function paragraphFormatLockRefusal(
  command: EditorCommand,
  surface: PaginatedSurface,
  policy: ContentLockPolicy | undefined
): Exclude<ExecResult, { ok: true }> | null {
  if (!PARAGRAPH_FORMAT_COMMANDS.has(command.type)) return null;
  const aligns = alignsOnly(command as ParagraphFormatCommand);
  const writer = surface.author()?.trim();
  const author =
    surface.editingMode() === 'suggest' &&
    writer &&
    !surface.session.trackingSettings().doNotTrackFormatting
      ? writer
      : undefined;
  let lastPart: OoxmlPart | null = null;
  let guarded: ReadonlySet<string> = new Set();
  for (const paragraphId of selectedParagraphIds(surface)) {
    // A pure ancestry read of the story that holds the paragraph.
    const part = partOfNodeId(surface.session, paragraphId) ?? surface.session.part();
    if (part !== lastPart) {
      lastPart = part;
      guarded = protectedParagraphs(part);
    }
    if (!guarded.has(paragraphId)) continue;
    // A lock lets alignment through, so only a binding or a pending tracked change that the
    // write would merge into can refuse it: skip the store for every other paragraph.
    if (
      aligns &&
      !isBoundAt(part, paragraphId) &&
      (author === undefined || !hasPendingParagraphChange(part, paragraphId))
    ) {
      continue;
    }
    const refused = validateTreeOp(part, probeOp(part, paragraphId, aligns, author), {
      contentLockPolicy: policy,
    });
    if (refused === 'bound') {
      return { ok: false, code: 'bound', reason: BOUND_PARAGRAPH_FORMAT_REASON };
    }
    if (refused === 'locked') {
      return {
        ok: false,
        code: 'locked',
        reason: aligns ? LOCKED_FORMAT_REASON : LOCKED_PARAGRAPH_FORMAT_REASON,
      };
    }
  }
  return null;
}
