// The toolbar's Insert Table control: a button that opens the table-size grid.
//
// The slot's own command inserts a 1×1 table, which is a placeholder rather than a choice.
// The size is the user's to pick, so the press opens the same grid as Insert › Table in the
// menu bar, and the enabled state still comes from the engine through the slot.

import { defineComponent, h, nextTick, ref, watch, type PropType, type VNode } from 'vue';
import { toolbarPopupLeft, type ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorCommand } from '../useEditorCommand';
import { mergeHostClass } from '../../lib/mergeHostClass';
import { useStableDocxId } from '../../lib/stable-id';
import { useToolbarLabel } from './toolbar-context';
import { Slot } from './Slot';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import { TableSizeGrid } from './TableSizeGrid';
import { useToolbarOverflowClose } from './ToolbarOverflow';
import type { ToolbarPartComponent } from './parts';

const SLOT: ChromeSlotId = 'table.insert';

/** Insert Table (`DocxEditorToolbar.TableInsert`): opens the table-size grid. */
export const ToolbarTableInsert = defineComponent({
  name: 'ToolbarTableInsert',
  props: {
    class: { type: String, default: undefined },
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
    asChild: { type: Boolean, default: undefined },
    icon: { type: Object as PropType<VNode>, default: undefined },
  },
  setup(props, { slots }) {
    const editorRef = useDocxEditor();
    const command = useEditorCommand(SLOT);
    const label = useToolbarLabel();
    const open = ref(false);
    const rootRef = ref<HTMLSpanElement | null>(null);
    const triggerRef = ref<HTMLButtonElement | null>(null);
    const popupRef = ref<HTMLDivElement | null>(null);
    const popupId = useStableDocxId('table-insert');
    // Inside the "⋯" panel, a pick also closes the panel. Outside it this does nothing.
    const closePanel = useToolbarOverflowClose();

    // A press outside closes the popup. Capture, because the painted surface prevents the
    // default on its own pointer handling. The editor's own document, which is not the
    // global one when the editor renders into an iframe or a popup window.
    watch(open, (isOpen, _, onCleanup) => {
      const doc = rootRef.value?.ownerDocument;
      if (!isOpen || !doc) return;
      const onMouseDown = (event: MouseEvent) => {
        const root = rootRef.value;
        if (root && event.target instanceof Node && root.contains(event.target)) return;
        open.value = false;
      };
      doc.addEventListener('mousedown', onMouseDown, true);
      onCleanup(() => doc.removeEventListener('mousedown', onMouseDown, true));
      void nextTick(() => {
        placePopup();
        // Every open, by pointer or key, moves focus into the grid's tab stop, so the grid's
        // own key handler sees Escape and the arrows.
        rootRef.value?.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')?.focus();
      });
    });

    // In the bar the grid opens under its button, moved in only as far as it must to stay
    // inside the viewport. In the "⋯" panel it is panel content and needs no placement.
    const placePopup = () => {
      const popup = popupRef.value;
      const root = rootRef.value;
      const view = root?.ownerDocument.defaultView;
      if (!popup || !root || !view || root.closest('.docx-toolbar__more-panel')) return;
      const anchor = root.getBoundingClientRect();
      const left = toolbarPopupLeft({
        anchorLeft: anchor.left,
        popupWidth: popup.offsetWidth,
        viewportWidth: view.innerWidth,
      });
      popup.style.left = `${left - anchor.left}px`;
    };

    const close = () => {
      open.value = false;
      closePanel(false);
    };

    return () => {
      if (props.hidden) return null;
      const control = chromeControlForSlot(SLOT);
      const text = label(control?.labelKey ?? SLOT);
      const isEnabled = command.isEnabled.value;
      const shown = open.value && isEnabled;
      const trigger = {
        ref: triggerRef,
        type: 'button',
        class: mergeHostClass('docx-toolbar__button', props.class, props.className),
        'data-slot': SLOT,
        disabled: !isEnabled,
        ...(!isEnabled ? { 'data-disabled': '' } : {}),
        ...(shown ? { 'data-active': '' } : {}),
        'aria-haspopup': 'grid',
        'aria-expanded': shown,
        'aria-controls': shown ? popupId : undefined,
        'aria-label': text,
        title: command.disabledReason.value ?? text,
        onMousedown: guardToolbarMousedown,
        onClick: () => {
          if (!open.value) {
            open.value = true;
            return;
          }
          // Focus is in the grid, which unmounts: give it back to the document, or typing
          // goes nowhere.
          open.value = false;
          editorRef.value?.focus();
        },
        onKeydown: (event: KeyboardEvent) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          open.value = true;
        },
      };
      const button = props.asChild
        ? h(Slot, trigger, slots.default)
        : h(
            'button',
            trigger,
            props.icon ?? slots.default?.() ?? chromeIcon(control?.paths) ?? undefined
          );
      return (
        <span ref={rootRef} class="docx-toolbar__table-insert">
          {button}
          {shown ? (
            <div
              ref={popupRef}
              id={popupId}
              class="docx-toolbar__menu docx-toolbar__table-insert-menu"
              // Focus that leaves the control (Tab, a click elsewhere) closes the grid, so it
              // never stays open behind the focus.
              onFocusout={(event: FocusEvent) => {
                const next = event.relatedTarget;
                if (next instanceof Node && !rootRef.value?.contains(next)) open.value = false;
              }}
              onKeydown={(event: KeyboardEvent) => {
                if (event.key !== 'Escape') return;
                // Stopped so an enclosing "⋯" panel stays open: Escape closes one layer.
                event.preventDefault();
                event.stopPropagation();
                open.value = false;
                triggerRef.value?.focus();
              }}
            >
              <TableSizeGrid slot={SLOT} label={label('toolbar.insertTable')} onInserted={close} />
            </div>
          ) : null}
        </span>
      );
    };
  },
});
(ToolbarTableInsert as unknown as ToolbarPartComponent).docxSlot = SLOT;
