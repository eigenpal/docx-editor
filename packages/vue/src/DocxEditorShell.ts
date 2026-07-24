// Polished shell presentation (interactive-paginated-editing M5.1).
//
// The Vue counterpart of React's `DocxEditorShell.tsx`. Same class names, same
// slots, same rule: the shell owns CHROME ONLY. It sets no document geometry and
// introduces no horizontal offset — page centering stays the page stack's job,
// because a shell-introduced offset is exactly what broke hit testing in M3.
//
// Written as a `defineComponent` render function rather than an SFC because this
// package is SFC-free and typechecks with plain `tsc`; a `.vue` file would need
// `vue-tsc` or a module shim that erases prop types.

import { defineComponent, h } from 'vue';

export default defineComponent({
  name: 'DocxEditorShell',
  setup(_props, { slots }) {
    return () =>
      h('div', { class: 'ep-root docx-editor ep-shell', 'data-testid': 'docx-editor-shell' }, [
        slots.titleBar ? h('div', { class: 'ep-shell__title' }, slots.titleBar()) : null,
        slots.toolbar ? h('div', { class: 'ep-shell__toolbar' }, slots.toolbar()) : null,
        h('div', { class: 'ep-shell__document' }, [
          slots.horizontalRuler ? h('div', { class: 'ep-shell__ruler-h' }, slots.horizontalRuler()) : null,
          h('div', { class: 'ep-shell__canvas' }, [
            slots.verticalRuler ? h('div', { class: 'ep-shell__ruler-v' }, slots.verticalRuler()) : null,
            slots.default ? slots.default() : null,
          ]),
          slots.pageIndicator ? h('div', { class: 'ep-shell__page-indicator' }, slots.pageIndicator()) : null,
        ]),
      ]);
  },
});
