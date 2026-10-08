import { defineComponent, watch, type PropType } from 'vue';
import type { RevisionMarkupOptions, ResolvedRevisionMarkup } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';

/** Viewer-local markup declarations. @public */
export interface DocxEditorRevisionMarkupProps extends RevisionMarkupOptions {
  onRevisionMarkupChange?: (settings: ResolvedRevisionMarkup) => void;
}

/** Declares markup settings without rendering an element. @public */
export const DocxEditorRevisionMarkup = defineComponent({
  name: 'DocxEditorRevisionMarkup',
  props: {
    insertions: Object as PropType<RevisionMarkupOptions['insertions']>,
    deletions: Object as PropType<RevisionMarkupOptions['deletions']>,
    movedFrom: Object as PropType<RevisionMarkupOptions['movedFrom']>,
    movedTo: Object as PropType<RevisionMarkupOptions['movedTo']>,
    formatting: Object as PropType<RevisionMarkupOptions['formatting']>,
    changedLines: Object as PropType<RevisionMarkupOptions['changedLines']>,
    cells: Object as PropType<RevisionMarkupOptions['cells']>,
    trackMoves: { type: Boolean, default: undefined },
    trackFormatting: { type: Boolean, default: undefined },
    revisionsIn: String as PropType<RevisionMarkupOptions['revisionsIn']>,
    commentMarkers: String as PropType<RevisionMarkupOptions['commentMarkers']>,
    paneOverflow: String as PropType<RevisionMarkupOptions['paneOverflow']>,
  },
  emits: { revisionMarkupChange: (_settings: ResolvedRevisionMarkup) => true },
  setup(props, { emit }) {
    const editor = useDocxEditor();
    watch(
      editor,
      (instance, _, cleanup) => {
        if (instance)
          cleanup(
            instance.on('revisionMarkupChange', (settings) =>
              emit('revisionMarkupChange', settings)
            )
          );
      },
      { immediate: true }
    );
    watch(
      [editor, () => JSON.stringify(props)],
      ([instance, serialized]) => {
        instance?.setRevisionMarkup(JSON.parse(serialized) as RevisionMarkupOptions);
      },
      { immediate: true }
    );
    return () => null;
  },
});
