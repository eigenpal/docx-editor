// Sidebar and dialog presentation (interactive-paginated-editing M5.1).
//
// The Vue counterpart of React's `DocxEditorSidebar.tsx`. Same reduction: the
// legacy sidebar hosted comments, tracked changes, and an outline, and the
// legacy dialog set covered find/replace, hyperlinks, images, tables, symbols,
// and footnotes. Every one needs a query or mutation contract this change does
// not own, so unsupported controls are hidden, never faked.

import { defineComponent, h, type PropType, type VNode } from 'vue';
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';

/** A panel the sidebar can show. */
export interface SidebarPanel {
  readonly id: string;
  readonly title: string;
  readonly content: VNode | VNode[] | string;
}

export interface DocxEditorSidebarProps {
  readonly editor: Editor | null;
  readonly open: boolean;
  readonly panels?: readonly SidebarPanel[];
}

/**
 * Dialogs deferred until their contracts land. Exported so the shell and the
 * demo boundary record agree on one list rather than drifting apart.
 */
export const DEFERRED_DIALOGS = [
  'findReplace',
  'hyperlink',
  'insertImage',
  'insertTable',
  'insertSymbol',
  'imageProperties',
  'footnoteProperties',
] as const;

export type DeferredDialogId = (typeof DEFERRED_DIALOGS)[number];

export default defineComponent({
  name: 'DocxEditorSidebar',
  props: {
    editor: { type: Object as PropType<Editor | null>, default: null },
    open: { type: Boolean, default: false },
    panels: { type: Array as PropType<readonly SidebarPanel[]>, default: () => [] },
  },
  emits: { close: () => true },
  setup(props, { emit }) {
    return () => {
      const items = props.panels ?? [];
      // Renders nothing when closed or empty, so an empty shell never appears
      // as a broken feature.
      if (!props.open || !props.editor || items.length === 0) return null;
      return h(
        'aside',
        {
          class: 'ep-sidebar',
          'data-testid': 'docx-editor-sidebar',
          'aria-label': 'Document panels',
        },
        [
          h('div', { class: 'ep-sidebar__header' }, [
            h('span', { class: 'ep-sidebar__title' }, items[0]!.title),
            h(
              'button',
              {
                type: 'button',
                class: 'ep-sidebar__close',
                onClick: () => emit('close'),
                'aria-label': 'Close panel',
              },
              [
                h(
                  'svg',
                  {
                    viewBox: '0 0 24 24',
                    width: '16',
                    height: '16',
                    'aria-hidden': 'true',
                    focusable: 'false',
                  },
                  [
                    h('path', {
                      d: 'M6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19Z',
                      fill: 'currentColor',
                    }),
                  ]
                ),
              ]
            ),
          ]),
          h('div', { class: 'ep-sidebar__body' }, items[0]!.content),
        ]
      );
    };
  },
});
