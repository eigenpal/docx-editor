// Document title chrome (interactive-paginated-editing M5.1).
//
// The Vue counterpart of React's `DocxEditorTitleBar.tsx`. Title ownership is
// the SHELL's, not the engine's: there is no `Editor` title contract, so the
// title is host state and this is a controlled input over it. It must never be
// presented as if it were persisted into the document.

import { defineComponent, h } from 'vue';

export default defineComponent({
  name: 'DocxEditorTitleBar',
  props: {
    title: { type: String, required: true },
    readOnly: { type: Boolean, default: false },
  },
  emits: { 'update:title': (_value: string) => true },
  setup(props, { emit, slots }) {
    return () =>
      h('div', { class: 'ep-shell__title-bar', 'data-testid': 'document-title-bar' }, [
        h('input', {
          class: 'ep-shell__title-input',
          'data-testid': 'document-title',
          value: props.title,
          readonly: props.readOnly,
          'aria-label': 'Document title',
          onInput: (event: Event) => emit('update:title', (event.target as HTMLInputElement).value),
        }),
        slots.actions ? h('div', { class: 'ep-shell__title-actions' }, slots.actions()) : null,
      ]);
  },
});
