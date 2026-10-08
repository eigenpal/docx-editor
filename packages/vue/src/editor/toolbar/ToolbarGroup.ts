// Host-owned groups and slot replacements for the preset toolbar.
//
// The preset bar collapses whole GROUPS into the "⋯" panel when it runs out of width. A
// loose host child has no group, so it used to sit in one fixed block that never collapsed.
// `Toolbar.Group` gives host content the same standing as a built-in group: it is measured,
// it takes a place in the collapse order, and when it collapses it becomes a labelled section
// of the panel. The same part, given a BUILT-IN group id, adds the host's controls to that
// group, or removes the group with `hidden`.
//
// `Toolbar.Slot` replaces one built-in slot with arbitrary content. It is a toolbar part like
// any other (the `docxToolbarPart` marker plus its `slot` prop), so the root's existing
// override path places it, and it keeps the slot's position and collapse behavior.
//
// Both parts are DESCRIPTIONS under the preset: the root reads their props and renders the
// content itself. They render on their own only under `preset={false}`.

import {
  defineComponent,
  h,
  inject,
  provide,
  type InjectionKey,
  type PropType,
  type VNode,
} from 'vue';
import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { useToolbarLabel } from './toolbar-context';

/** Props for `DocxEditor.Toolbar.Group`. @public */
export interface ToolbarGroupPartProps {
  /**
   * The group id. A built-in id (`'history'`, `'font'`, `'text'`, `'review'`, ...) adds the
   * children to that group, after its own controls. Any other id makes a host group.
   */
  id: string;
  /**
   * Section heading in the "⋯" panel and the group's accessible name. Plain text, or a
   * translation key that the toolbar's `t` resolves. Defaults to `id`. Built-in groups keep
   * their own label.
   */
  label?: string;
  /**
   * Collapse priority. A lower number leaves the bar first. Built-in groups use 10 (zoom)
   * through 90 (history) in steps of 10. A host group without a priority collapses before
   * every built-in group.
   */
  priority?: number;
  /** `true` keeps the group in the bar at every width, like the review group. */
  pinned?: boolean;
  /**
   * The group this one follows in the bar. Without it, a host group follows every built-in
   * group, in order of appearance. Ignored for built-in ids.
   */
  after?: string;
  /** Removes the group, built-in or host, from the bar and the "⋯" panel. */
  hidden?: boolean;
  /**
   * Content for the group's "⋯" panel section. Without it the panel renders the children
   * in panel rows: actions become labelled rows, other content renders as is.
   */
  overflowContent?: () => DocxEditorChildren;
  className?: string;
  /** The group's controls, passed as the default slot. */
  children?: DocxEditorChildren;
}

/**
 * A group of the preset toolbar: measured, collapsed in priority order, and shown as a
 * labelled section of the "⋯" panel when it does not fit.
 *
 * @example
 * ```ts
 * h(DocxEditorToolbar, null, () => [
 *   h(DocxEditorToolbar.Group, { id: 'review-nav', label: 'Review', priority: 15 }, () => [
 *     h(DocxEditorToolbar.Action, { label: 'Next change', onSelect: next }),
 *   ]),
 * ]);
 * ```
 *
 * @public
 */
export const ToolbarGroup = Object.assign(
  defineComponent({
    name: 'ToolbarGroup',
    props: {
      id: { type: String, required: true },
      label: { type: String, default: undefined },
      priority: { type: Number, default: undefined },
      pinned: { type: Boolean, default: undefined },
      after: { type: String, default: undefined },
      hidden: { type: Boolean, default: undefined },
      overflowContent: {
        type: Function as PropType<() => DocxEditorChildren>,
        default: undefined,
      },
      className: { type: String, default: undefined },
    },
    setup(props, { slots }) {
      const label = useToolbarLabel();
      return () =>
        props.hidden
          ? null
          : h(
              'div',
              {
                role: 'group',
                'aria-label': label(props.label ?? props.id),
                class: `docx-toolbar__group${props.className ? ` ${props.className}` : ''}`,
                'data-toolbar-host-group': props.id,
              },
              slots.default?.()
            );
    },
  }),
  // Marker for the toolbar root: a static, never the component name.
  { docxToolbarGroup: true as const }
);

/** Props for `DocxEditor.Toolbar.Slot`. @public */
export interface ToolbarSlotOverrideProps {
  /** The built-in slot this content replaces, for example `'text.bold'`. */
  slot: ChromeSlotId;
  /** Render nothing. Inside the preset arrangement this removes the slot. */
  hidden?: boolean;
  /**
   * Content for the slot's "⋯" panel row when its group collapses. Without it the panel row
   * shows the default slot content under the slot's label.
   */
  overflowContent?: () => DocxEditorChildren;
  /** The replacement content, passed as the default slot. */
  children?: DocxEditorChildren;
}

/**
 * Replaces one built-in slot with arbitrary content. The content takes the slot's place and
 * collapses with the slot's group. A slot the preset arrangement does not draw has no place
 * to take, so the content is appended and a development warning names the slot.
 *
 * @example
 * ```ts
 * h(DocxEditorToolbar, null, () => [
 *   h(DocxEditorToolbar.Slot, { slot: 'zoom.level' }, () => [h(MyZoomPicker)]),
 * ]);
 * ```
 *
 * @public
 */
export const ToolbarSlot = Object.assign(
  defineComponent({
    name: 'ToolbarSlot',
    props: {
      slot: { type: String as PropType<ChromeSlotId>, required: true },
      hidden: { type: Boolean, default: undefined },
      overflowContent: {
        type: Function as PropType<() => DocxEditorChildren>,
        default: undefined,
      },
    },
    setup(props, { slots }) {
      return () => (props.hidden ? null : (slots.default?.() ?? null));
    },
  }),
  // The same part marker `ToolbarButton` carries: the root reads the `slot` prop with it.
  { docxToolbarPart: true as const }
);

/** Where a host control renders: in the bar, or as a row of the "⋯" panel. */
export type ToolbarPlacement = 'bar' | 'panel';

const ToolbarPlacementKey: InjectionKey<ToolbarPlacement> = Symbol('ToolbarPlacement');

/** Where the calling control renders. */
export function useToolbarPlacement(): ToolbarPlacement {
  return inject(ToolbarPlacementKey, 'bar');
}

/** Renders its children as rows of the "⋯" panel. */
export const ToolbarPanelPlacement = defineComponent({
  name: 'ToolbarPanelPlacement',
  setup(_, { slots }) {
    provide(ToolbarPlacementKey, 'panel');
    return () => h('div', { class: 'docx-toolbar__more-host' }, slots.default?.() as VNode[]);
  },
});
