// Toolbar (interactive-paginated-editing M5.1).
//
// The Vue counterpart of React's `DocxEditorToolbar.tsx`, sharing the engine's
// can-before-exec wiring so the two toolbars cannot drift on when a control is
// enabled. Every control's enabled state is one `Editor.can(command)` answer; a
// click runs `Editor.exec(command)` only after `can` said yes; save calls
// `Editor.save()` directly. A control the engine cannot honour renders disabled
// with the engine's own reason as its tooltip.

import { computed, defineComponent, h, type PropType } from 'vue';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import {
  runToolbarCommand,
  toolbarCommandState,
  type ToolbarCommandId,
  type ToolbarCommandState,
} from '@docx-editor.dev/engine-editor';
import { useEditorSnapshot } from './useEditorSnapshot';

const ICONS: Record<ToolbarCommandId | 'save', string> = {
  bold: 'M8 19V5h5.2c1.4 0 2.5.4 3.3 1.1.8.7 1.2 1.6 1.2 2.8 0 .7-.2 1.3-.5 1.8s-.8.9-1.4 1.2c.8.2 1.4.6 1.8 1.2.4.6.7 1.3.7 2.1 0 1.2-.4 2.2-1.3 2.9-.9.7-2 1-3.5 1H8Zm2.8-2.3h2.4c.6 0 1.1-.2 1.4-.5.3-.3.5-.7.5-1.3s-.2-1-.5-1.3c-.3-.3-.8-.5-1.5-.5h-2.3v3.6Zm0-5.8h2c.6 0 1.1-.1 1.4-.4.3-.3.5-.7.5-1.2s-.2-.9-.5-1.2c-.3-.3-.8-.4-1.4-.4h-2v3.2Z',
  italic: 'M5 19v-2.2h3.2l3-9.6H8V5h8v2.2h-3.2l-3 9.6H13V19H5Z',
  underline: 'M5 21v-2h14v2H5Zm7-4c-1.7 0-3-.5-4-1.5-1-1-1.4-2.3-1.4-4V3h2.3v8.6c0 1 .3 1.8.8 2.4.6.6 1.3.9 2.3.9s1.8-.3 2.3-.9c.6-.6.8-1.4.8-2.4V3H17v8.5c0 1.7-.5 3-1.4 4-1 1-2.3 1.5-3.9 1.5Z',
  undo: 'M7.5 18c-.4 0-.8-.1-1-.4-.3-.3-.4-.6-.4-1s.1-.8.4-1c.2-.3.6-.4 1-.4h6.9c1.1 0 2-.4 2.8-1.1.8-.8 1.2-1.7 1.2-2.8s-.4-2-1.2-2.8c-.8-.7-1.7-1.1-2.8-1.1H7.9l2 2c.3.3.4.6.4 1s-.1.7-.4 1c-.3.3-.6.4-1 .4s-.7-.1-1-.4L3.4 8.6c-.3-.3-.4-.6-.4-1s.1-.7.4-1L7.9 2c.3-.3.6-.4 1-.4s.7.1 1 .4c.3.3.4.6.4 1s-.1.7-.4 1l-2 2h6.5c1.9 0 3.5.6 4.8 1.9 1.3 1.3 2 2.8 2 4.7s-.7 3.5-2 4.8c-1.3 1.3-2.9 1.9-4.8 1.9H7.5Z',
  redo: 'M9.6 18c-1.9 0-3.5-.6-4.8-1.9-1.3-1.3-2-2.9-2-4.8s.7-3.4 2-4.7C6.1 5.3 7.7 4.7 9.6 4.7h6.5l-2-2c-.3-.3-.4-.6-.4-1s.1-.7.4-1c.3-.3.6-.4 1-.4s.7.1 1 .4l4.5 4.6c.3.3.4.6.4 1s-.1.7-.4 1L16.1 12c-.3.3-.6.4-1 .4s-.7-.1-1-.4c-.3-.3-.4-.6-.4-1s.1-.7.4-1l2-2H9.6c-1.1 0-2 .4-2.8 1.1-.8.8-1.2 1.7-1.2 2.8s.4 2 1.2 2.8c.8.7 1.7 1.1 2.8 1.1h6.9c.4 0 .8.1 1 .4.3.2.4.6.4 1s-.1.7-.4 1c-.2.3-.6.4-1 .4H9.6Z',
  save: 'M5 21c-.6 0-1-.2-1.4-.6C3.2 20 3 19.6 3 19V5c0-.6.2-1 .6-1.4C4 3.2 4.4 3 5 3h11.2L21 7.8V19c0 .6-.2 1-.6 1.4-.4.4-.8.6-1.4.6H5Zm7-3c.8 0 1.5-.3 2.1-.9.6-.6.9-1.3.9-2.1s-.3-1.5-.9-2.1c-.6-.6-1.3-.9-2.1-.9s-1.5.3-2.1.9c-.6.6-.9 1.3-.9 2.1s.3 1.5.9 2.1c.6.6 1.3.9 2.1.9ZM6 10h9V6H6v4Z',
};

const LABELS: Record<ToolbarCommandId | 'save', string> = {
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  undo: 'Undo',
  redo: 'Redo',
  save: 'Save',
};

const FORMATTING: readonly ToolbarCommandId[] = ['bold', 'italic', 'underline'];
const HISTORY: readonly ToolbarCommandId[] = ['undo', 'redo'];

export default defineComponent({
  name: 'DocxEditorToolbar',
  props: {
    editor: { type: Object as PropType<Editor | null>, default: null },
    showSave: { type: Boolean, default: true },
  },
  emits: { save: () => true },
  setup(props, { emit }) {
    // Re-render as the selection and document change, or can() answers go stale.
    const revision = useEditorSnapshot(() => props.editor);
    const states = computed<Record<string, ToolbarCommandState>>(() => {
      void revision.value;
      const out: Record<string, ToolbarCommandState> = {};
      for (const id of [...HISTORY, ...FORMATTING]) out[id] = toolbarCommandState(props.editor, id);
      return out;
    });

    const icon = (id: ToolbarCommandId | 'save') =>
      h('svg', { viewBox: '0 0 24 24', width: '18', height: '18', 'aria-hidden': 'true', focusable: 'false' }, [
        h('path', { d: ICONS[id], fill: 'currentColor' }),
      ]);

    const commandButton = (id: ToolbarCommandId) => {
      const state = states.value[id]!;
      return h(
        'button',
        {
          key: id,
          type: 'button',
          class: 'ep-toolbar__button',
          'data-testid': `toolbar-${id}`,
          disabled: !state.enabled,
          // The engine's own words, never an adapter paraphrase.
          title: state.disabledReason ?? LABELS[id],
          'aria-label': LABELS[id],
          onMousedown: (event: Event) => event.preventDefault(), // keep focus on the editor
          onClick: () => runToolbarCommand(props.editor, id),
        },
        [icon(id)],
      );
    };

    return () =>
      h('div', { class: 'ep-toolbar', role: 'toolbar', 'aria-label': 'Formatting', 'data-testid': 'docx-editor-toolbar' }, [
        h('div', { class: 'ep-toolbar__group' }, HISTORY.map(commandButton)),
        h('div', { class: 'ep-toolbar__separator', role: 'separator' }),
        h('div', { class: 'ep-toolbar__group' }, FORMATTING.map(commandButton)),
        ...(props.showSave
          ? [
              h('div', { class: 'ep-toolbar__separator', role: 'separator' }),
              h('div', { class: 'ep-toolbar__group' }, [
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'ep-toolbar__button',
                    'data-testid': 'toolbar-save',
                    disabled: !props.editor,
                    title: LABELS.save,
                    'aria-label': LABELS.save,
                    onMousedown: (event: Event) => event.preventDefault(),
                    onClick: () => emit('save'),
                  },
                  [icon('save')],
                ),
              ]),
            ]
          : []),
      ]);
  },
});
