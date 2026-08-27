import { defineComponent, h, computed, type PropType, type VNode } from 'vue';
import type { DocxEditorChildren } from '../../docx-editor-children';
import {
  CHROME_GROUPS,
  chromeSlotId,
  chromeSlotIsToggle,
  type ChromeControl,
  type ChromeSlotId,
} from '@docx-editor.dev/core/editor';
import { mergeHostClass } from '../../lib/mergeHostClass';
import { useEditorCommand } from '../useEditorCommand';
import { usePlatformShortcut } from '../usePlatformShortcut';
import { useToolbarLabel } from './toolbar-context';
import { Slot } from './Slot';

/** The registry control behind one slot id, for its labelKey and icon paths. */
export function chromeControlForSlot(slotId: ChromeSlotId): ChromeControl | null {
  for (const group of CHROME_GROUPS) {
    for (const control of group.controls) {
      if (chromeSlotId(group, control) === slotId) return control;
    }
  }
  return null;
}

/** Registry icon paths as inline SVG (Material Symbols viewBox), aria-hidden. */
export function chromeIcon(paths: readonly string[] | null | undefined): VNode | null {
  if (!paths) return null;
  return h(
    'svg',
    { viewBox: '0 -960 960 960', width: 18, height: 18, ariaHidden: 'true', focusable: 'false' },
    paths.map((d) => h('path', { key: d, d, fill: 'currentColor' }))
  );
}

/** Keep the caret: toolbar mousedown must not steal focus from the surface. */
export function guardToolbarMousedown(event: MouseEvent): void {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
}

/** @public */
export interface ToolbarButtonProps {
  slot: ChromeSlotId;
  icon?: DocxEditorChildren;
  asChild?: boolean;
  class?: string;
  className?: string;
  children?: DocxEditorChildren;
  hidden?: boolean;
}

/** @public */
export const ToolbarButton = defineComponent({
  name: 'ToolbarButton',
  props: {
    slot: { type: String as PropType<ChromeSlotId>, required: true },
    icon: { type: Object as PropType<VNode>, default: undefined },
    asChild: { type: Boolean, default: undefined },
    class: { type: String, default: undefined },
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    const label = useToolbarLabel();
    const shortcut = usePlatformShortcut();
    const command = useEditorCommand(computed(() => props.slot) as unknown as ChromeSlotId);
    return () => {
      if (props.hidden) return null;
      const control = chromeControlForSlot(props.slot);
      // A registry label is tooltip-shaped and often NAMES its chord ("Bold (Ctrl+B)"). The
      // catalogue can only state one spelling, and the engine's accelerator is Ctrl OR Cmd —
      // so the printed name is corrected for this keyboard rather than translated twice.
      const text = shortcut(label(control?.labelKey ?? props.slot));
      // `aria-pressed` only where pressed-ness is meaningful. The rule is the ENGINE's,
      // because it is not derivable from the command table alone — see `chromeSlotIsToggle`.
      const isToggle = chromeSlotIsToggle(props.slot);
      const shared = {
        onClick: () => command.execute(),
        onMousedown: guardToolbarMousedown,
        disabled: !command.isEnabled.value,
        'data-slot': props.slot,
        class: mergeHostClass('docx-toolbar__button', props.class, props.className),
        ...(command.isActive.value ? { 'data-active': '' } : {}),
        ...(!command.isEnabled.value ? { 'data-disabled': '' } : {}),
        ...(isToggle ? { 'aria-pressed': command.isActive.value } : {}),
        // The slot's reported value, for the controls whose state is more than
        // pressed-or-not: the format painter renders `once` and `locked` differently, and
        // only the engine knows which is live. Absent for every slot that reports none, so
        // nothing else gains an attribute.
        ...(command.value.value !== null ? { 'data-value': command.value.value } : {}),
        'aria-label': text,
        title: command.disabledReason.value ?? text,
      };
      const content = props.icon ?? slots.default?.() ?? chromeIcon(control?.paths);
      if (props.asChild) return h(Slot, shared, slots.default);
      return h('button', { type: 'button', ...shared }, content ?? undefined);
    };
  },
});

/** Part marker for merge: ToolbarButton children in the default arrangement. */
(ToolbarButton as unknown as { docxToolbarPart: true }).docxToolbarPart = true;
