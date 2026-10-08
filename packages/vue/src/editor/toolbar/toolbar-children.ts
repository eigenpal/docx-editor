// Reads the preset toolbar's children into what the root arranges: slot overrides, group
// descriptions (`Toolbar.Group`), and loose children, which keep their old fixed block.

import { camelize, Comment, isVNode, type VNode } from 'vue';
import { flattenChildren } from '../../lib/flattenChildren';
import type { DocxEditorChildren } from '../../docx-editor-children';
import type { ToolbarGroupPartProps } from './ToolbarGroup';

/** A `Toolbar.Group` description, with its default slot content. */
export interface ToolbarGroupSpec extends Omit<ToolbarGroupPartProps, 'children'> {
  readonly children: VNode[] | null;
}

/** The parts of the preset toolbar's children, by role. */
export interface ToolbarChildren<Key extends string> {
  /** Slot overrides of the default arrangement. The last override for a slot wins. */
  readonly overrides: Map<Key, VNode>;
  /** Slot overrides of the contextual table chrome. */
  readonly tableOverrides: Map<Key, VNode>;
  /** `Toolbar.Group` descriptions in order of appearance. The last one for an id wins. */
  readonly groups: readonly ToolbarGroupSpec[];
  /** Everything else, rendered in one fixed block after the groups. */
  readonly appended: readonly VNode[];
}

/**
 * A boolean prop as the vnode carries it. A template's bare attribute (`<Group hidden />`)
 * arrives as an empty string, which is `true`.
 */
export function vnodeFlag(value: unknown): boolean {
  return value === true || value === '';
}

/** True for a `Toolbar.Group` vnode. */
export function isToolbarGroupVNode(child: unknown): child is VNode {
  if (!isVNode(child)) return false;
  const type = child.type as { docxToolbarGroup?: unknown } | null;
  return typeof type === 'object' && type !== null && type.docxToolbarGroup === true;
}

/** The props of a group vnode, camelized, with the default slot rendered. */
function groupSpec(vnode: VNode): ToolbarGroupSpec {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(vnode.props ?? {})) raw[camelize(key)] = value;
  const slots = vnode.children as { default?: () => DocxEditorChildren } | null;
  const content = typeof slots?.default === 'function' ? slots.default() : null;
  const priority = raw.priority === undefined ? undefined : Number(raw.priority);
  return {
    id: String(raw.id),
    ...(typeof raw.label === 'string' ? { label: raw.label } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(raw.pinned !== undefined ? { pinned: vnodeFlag(raw.pinned) } : {}),
    ...(typeof raw.after === 'string' ? { after: raw.after } : {}),
    ...(raw.hidden !== undefined ? { hidden: vnodeFlag(raw.hidden) } : {}),
    ...(typeof raw.overflowContent === 'function'
      ? { overflowContent: raw.overflowContent as () => DocxEditorChildren }
      : {}),
    ...(typeof raw.className === 'string' ? { className: raw.className } : {}),
    // `v-if` branches that render nothing leave comment nodes, which are no content.
    children: flattenChildren(content).filter((node) => node.type !== Comment),
  };
}

export function readToolbarChildren<Key extends string>(
  children: readonly VNode[],
  slotOfChild: (child: VNode) => Key | null,
  isDefaultSlot: (slot: Key) => boolean,
  isTableSlot: (slot: Key) => boolean
): ToolbarChildren<Key> {
  const overrides = new Map<Key, VNode>();
  const tableOverrides = new Map<Key, VNode>();
  const groups = new Map<string, ToolbarGroupSpec>();
  const appended: VNode[] = [];
  for (const child of children) {
    if (isToolbarGroupVNode(child)) {
      const spec = groupSpec(child);
      // Re-inserted so the LAST description's position is its order of appearance.
      groups.delete(spec.id);
      groups.set(spec.id, spec);
      continue;
    }
    const slot = slotOfChild(child);
    // Last override for a slot wins, matching how later props win in a spread.
    if (slot && isDefaultSlot(slot)) overrides.set(slot, child);
    else if (slot && isTableSlot(slot)) tableOverrides.set(slot, child);
    else appended.push(child);
  }
  return { overrides, tableOverrides, groups: [...groups.values()], appended };
}
