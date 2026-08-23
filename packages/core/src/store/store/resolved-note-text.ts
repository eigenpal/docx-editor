import {
  contentControlContentChildren,
  isContentControl,
  MAX_CONTENT_CONTROL_NESTING,
  walkAllStoryParagraphs,
} from '../package/content-control-walk.ts';
import { fieldAtomText } from '../package/field-nodes.ts';
import { hardBreakText } from '../package/hard-break.ts';
import { isContentRevisionKind, WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { segmentsOf } from './tree-op-segments.ts';

export type ResolvedNoteDisplayMode = 'proposed' | 'original';

type RevisionDisplayMode = ResolvedNoteDisplayMode | 'all-markup';

interface ParentedBlock {
  readonly block: OoxmlElement;
  readonly parentKey: string;
}

function replaceChildrenShallow<T extends OoxmlElement>(
  element: T,
  children: readonly OoxmlNode[]
): T {
  // SAFETY: the caller preserves the element kind and only swaps its child list. The tree
  // still goes through the typed paragraph walker and segment reader, which reject invalid
  // structures if this helper were misused.
  return { ...element, children } as T;
}

function wmlChildNamed(node: OoxmlNode, localName: string): OoxmlNode | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const child of node.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === WML_NAMESPACE_URI && child.localName === localName) return child;
  }
  return undefined;
}

function paragraphMarkDeleted(paragraph: OoxmlNode): boolean {
  if (paragraph.kind === 'textValue') return false;
  const properties =
    wmlChildNamed(paragraph, 'paragraphProperties') ?? wmlChildNamed(paragraph, 'pPr');
  if (!properties) return false;
  const markRunProperties =
    wmlChildNamed(properties, 'runProperties') ?? wmlChildNamed(properties, 'rPr');
  if (!markRunProperties) return false;
  return (
    wmlChildNamed(markRunProperties, 'del') !== undefined ||
    wmlChildNamed(markRunProperties, 'moveFrom') !== undefined
  );
}

function markRemovedInMode(paragraph: OoxmlNode, displayMode: RevisionDisplayMode): boolean {
  if (displayMode === 'all-markup' || paragraph.kind === 'textValue') return false;
  const properties =
    wmlChildNamed(paragraph, 'paragraphProperties') ?? wmlChildNamed(paragraph, 'pPr');
  if (!properties) return false;
  const markRunProperties =
    wmlChildNamed(properties, 'runProperties') ?? wmlChildNamed(properties, 'rPr');
  if (!markRunProperties) return false;
  const removedNames =
    displayMode === 'proposed' ? (['del', 'moveFrom'] as const) : (['ins', 'moveTo'] as const);
  return removedNames.some((name) => wmlChildNamed(markRunProperties, name) !== undefined);
}

function rendersNoText(node: OoxmlNode, depth: number): boolean {
  if (node.kind === 'textValue') return true;
  if (depth > MAX_CONTENT_CONTROL_NESTING) return true;
  const walkChildren = (children: readonly OoxmlNode[], childDepth: number): boolean => {
    for (const child of children) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'run') {
        for (const grand of child.children) {
          if (grand.kind === 'text') {
            for (const value of grand.children) {
              if (value.kind === 'textValue' && value.value.length > 0) return false;
            }
            continue;
          }
          if (grand.kind !== 'runProperties') return false;
        }
        continue;
      }
      if (isContentControl(child)) {
        if (childDepth >= MAX_CONTENT_CONTROL_NESTING) continue;
        const content = contentControlContentChildren(child);
        if (content.length > 0 && !walkChildren(content, childDepth + 1)) return false;
        continue;
      }
      const descends =
        child.kind === 'hyperlink' ||
        child.kind === 'revisionInsert' ||
        child.kind === 'revisionMoveTo';
      if (descends && !rendersNoText(child, childDepth + 1)) return false;
    }
    return true;
  };
  return walkChildren(node.children, depth);
}

function revisionRemovesParagraph(
  paragraph: OoxmlNode,
  displayMode: RevisionDisplayMode = 'proposed'
): boolean {
  if (paragraph.kind !== 'paragraph' || displayMode !== 'proposed') return false;
  if (!paragraphMarkDeleted(paragraph)) return false;
  return rendersNoText(paragraph, 0);
}

function flowBlocksWithParent(
  children: readonly OoxmlNode[],
  parentKey = ''
): readonly ParentedBlock[] {
  const blocks: ParentedBlock[] = [];
  const collect = (nodes: readonly OoxmlNode[], nest: number, owner: string): void => {
    for (const child of nodes) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'paragraph' || child.kind === 'table') {
        blocks.push({ block: child, parentKey: owner });
        continue;
      }
      if (isContentControl(child) && nest < MAX_CONTENT_CONTROL_NESTING) {
        collect(contentControlContentChildren(child), nest + 1, child.id);
      }
    }
  };
  collect(children, 0, parentKey);
  return blocks;
}

function isParagraphProperties(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' && (node.kind === 'paragraphProperties' || node.localName === 'pPr')
  );
}

function mergedParagraph(
  members: readonly OoxmlParagraphNode[],
  survivor: OoxmlParagraphNode
): OoxmlParagraphNode {
  const properties = survivor.children.filter((child) => isParagraphProperties(child));
  const content = members.flatMap((member) =>
    member.children.filter((child) => !isParagraphProperties(child))
  );
  return { ...survivor, children: [...properties, ...content] };
}

function mergedTrailingRun(members: readonly OoxmlParagraphNode[]): readonly OoxmlElement[] {
  if (members.length < 2) return members;
  const survivor = members[members.length - 1]!;
  return [mergedParagraph(members, survivor)];
}

function withMergedParagraphs(
  parented: readonly ParentedBlock[],
  displayMode: RevisionDisplayMode
): readonly OoxmlElement[] {
  if (displayMode === 'all-markup') return parented.map((entry) => entry.block);
  const out: OoxmlElement[] = [];
  let pendingMembers: OoxmlParagraphNode[] = [];
  let pendingParent: string | null = null;
  const endRun = (): void => {
    out.push(...mergedTrailingRun(pendingMembers));
    pendingMembers = [];
    pendingParent = null;
  };
  for (const { block, parentKey } of parented) {
    if (pendingMembers.length > 0 && parentKey !== pendingParent) endRun();
    if (block.kind !== 'paragraph') {
      endRun();
      out.push(block);
      continue;
    }
    if (markRemovedInMode(block, displayMode)) {
      pendingMembers.push(block);
      pendingParent = parentKey;
      continue;
    }
    if (pendingMembers.length === 0) {
      out.push(block);
      continue;
    }
    out.push(mergedParagraph([...pendingMembers, block], block));
    pendingMembers = [];
    pendingParent = null;
  }
  out.push(...mergedTrailingRun(pendingMembers));
  return out;
}

function resolvedFlowBlocks(
  children: readonly OoxmlNode[],
  displayMode: RevisionDisplayMode
): readonly OoxmlElement[] {
  return withMergedParagraphs(flowBlocksWithParent(children), displayMode).filter(
    (block) => block.kind !== 'paragraph' || !revisionRemovesParagraph(block, displayMode)
  );
}

function toggle(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  const value =
    node.attributes.find(
      (attribute) =>
        attribute.localName === 'val' &&
        (attribute.namespaceUri === WML_NAMESPACE_URI || attribute.namespaceUri === '')
    )?.value ?? undefined;
  return value === undefined || !(value === '0' || value === 'false' || value === 'off');
}

function runHidden(run: OoxmlNode): boolean {
  if (run.kind !== 'run') return false;
  let hidden = false;
  for (const child of run.children) {
    if (child.kind !== 'runProperties') continue;
    for (const property of child.children) {
      if (property.namespaceUri !== WML_NAMESPACE_URI || property.localName !== 'vanish') continue;
      hidden = toggle(property);
    }
  }
  return hidden;
}

function isSuppressedRevision(node: OoxmlNode, displayMode: ResolvedNoteDisplayMode): boolean {
  if (!isContentRevisionKind(node.kind)) return false;
  return displayMode === 'proposed'
    ? node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom'
    : node.kind === 'revisionInsert' || node.kind === 'revisionMoveTo';
}

function isNoteBodyMark(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  return (
    node.namespaceUri === WML_NAMESPACE_URI &&
    (node.localName === 'footnoteRef' ||
      node.localName === 'endnoteRef' ||
      node.localName === 'separator' ||
      node.localName === 'continuationSeparator')
  );
}

function filterVisibleNodes(
  nodes: readonly OoxmlNode[],
  displayMode: ResolvedNoteDisplayMode
): OoxmlNode[] {
  const kept: OoxmlNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'textValue') {
      kept.push(node);
      continue;
    }
    if (isNoteBodyMark(node)) continue;
    if (isSuppressedRevision(node, displayMode)) continue;
    if (node.kind === 'run' && runHidden(node)) continue;
    const children = filterVisibleNodes(node.children, displayMode);
    if (node.kind === 'runProperties' || node.kind === 'paragraphProperties') {
      kept.push(node);
      continue;
    }
    if (children.length === 0 && node.children.length > 0) continue;
    kept.push(children === node.children ? node : replaceChildrenShallow(node, children));
  }
  return kept;
}

function paragraphDisplayText(
  paragraph: OoxmlParagraphNode,
  displayMode: ResolvedNoteDisplayMode
): string {
  const filtered = replaceChildrenShallow(
    paragraph,
    filterVisibleNodes(paragraph.children, displayMode)
  );
  let text = '';
  for (const segment of segmentsOf(filtered)) {
    if (segment.removeNodeIds && segment.removeNodeIds.length > 0) {
      text += fieldAtomText();
      continue;
    }
    if (segment.node.kind === 'textValue') text += segment.node.value;
    else if (segment.node.kind === 'tab') text += '\t';
    else if (segment.node.kind === 'hardBreak') text += hardBreakText(segment.node);
  }
  return text;
}

export function resolvedNoteText(note: OoxmlNode, displayMode: ResolvedNoteDisplayMode): string {
  if (note.kind !== 'note') return '';
  const paragraphs: string[] = [];
  for (const block of resolvedFlowBlocks(note.children, displayMode)) {
    if (block.kind === 'paragraph') {
      paragraphs.push(paragraphDisplayText(block, displayMode));
      continue;
    }
    if (block.kind !== 'table') continue;
    walkAllStoryParagraphs([block], 0, (paragraph) => {
      if (paragraph.kind === 'paragraph') {
        paragraphs.push(paragraphDisplayText(paragraph, displayMode));
      }
    });
  }
  return paragraphs.join('\r');
}
