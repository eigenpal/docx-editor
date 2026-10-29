// `DocxEditorWindow`: render the editor panel in a pop-out window while `open`, and inline
// otherwise. The editor keeps its document, undo history and selection across each move.

import {
  Fragment,
  Teleport,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  shallowRef,
  watch,
  type PropType,
} from 'vue';
import { openEditorWindow, type EditorWindow } from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useTranslation } from '../i18n';
import { useChromeDark } from './color-mode-context';

/** Props for `DocxEditorWindow`. @public */
export interface DocxEditorWindowProps {
  /** Render the default slot in a pop-out window. While `false`, it renders in place. */
  open: boolean;
  /** A same-origin page to open. Defaults to `about:blank`. */
  url?: string;
  /**
   * The window name. Defaults to `docx-editor`. Two `DocxEditorWindow` components with the
   * same name share one browser window, so give each editor its own name.
   */
  name?: string;
  /** The `window.open` features. Defaults to `popup,width=1000,height=900`. */
  features?: string;
  /** The pop-out's title. */
  title?: string;
  /** Copy this page's stylesheets into the window, and keep copying new ones. Default `true`. */
  styles?: boolean | ((from: Document, to: Document) => () => void);
  /** The pop-out went away (the user closed it, or the browser blocked it). The `close` event. */
  onClose?: () => void;
  /** The editor panel: toolbar, viewport and content, or any part of them. */
  children?: DocxEditorChildren;
}

/**
 * Render the editor panel in its own browser window while `open` is `true`.
 *
 * Place it inside `DocxEditorRoot` around the parts to pop out. The root stays in this
 * window, so the editor moves into the pop-out and back with its undo history, selection and
 * collaboration session. The window gets this page's stylesheets. When the user closes it,
 * the panel comes back and the component emits `update:open` with `false` and `close`.
 *
 * The panel remounts on each move, which is what moves the editor; it is never retargeted.
 *
 * @example
 * ```vue
 * <DocxEditorRoot :document="bytes">
 *   <button @click="popped = !popped">Pop out</button>
 *   <DocxEditorWindow v-model:open="popped">
 *     <DocxEditorToolbar />
 *     <DocxEditorViewport>
 *       <DocxEditorContent />
 *     </DocxEditorViewport>
 *   </DocxEditorWindow>
 * </DocxEditorRoot>
 * ```
 *
 * @public
 */
export const DocxEditorWindow = defineComponent({
  name: 'DocxEditorWindow',
  props: {
    open: { type: Boolean, required: true },
    url: { type: String, default: undefined },
    name: { type: String, default: undefined },
    features: { type: String, default: undefined },
    title: { type: String, default: undefined },
    styles: {
      type: [Boolean, Function] as PropType<DocxEditorWindowProps['styles']>,
      default: undefined,
    },
  },
  emits: {
    'update:open': (_open: boolean) => true,
    close: () => true,
  },
  setup(props, { slots, emit }) {
    const dark = useChromeDark();
    const popup = shallowRef<EditorWindow | null>(null);
    let generation = 0;

    const closeCurrent = (): void => {
      generation += 1;
      const current = popup.value;
      popup.value = null;
      // After the re-render that puts the panel back in place: the editor moves home first,
      // then the window closes.
      if (current) void nextTick(() => current.close());
    };

    watch(
      () => props.open,
      (open) => {
        if (!open) {
          closeCurrent();
          return;
        }
        const mine = ++generation;
        void openEditorWindow({
          ...(props.url !== undefined ? { url: props.url } : {}),
          ...(props.name !== undefined ? { name: props.name } : {}),
          ...(props.features !== undefined ? { features: props.features } : {}),
          ...(props.title !== undefined ? { title: props.title } : {}),
          ...(props.styles !== undefined ? { styles: props.styles } : {}),
        }).then((opened) => {
          if (mine !== generation) {
            opened?.close();
            return;
          }
          if (!opened) {
            emit('update:open', false);
            emit('close');
            return;
          }
          opened.onClose(() => {
            if (mine !== generation) return;
            // Inside the window's `pagehide`: Vue flushes this change before the window's
            // document unloads, so the panel is back in place first.
            popup.value = null;
            emit('update:open', false);
            emit('close');
          });
          popup.value = opened;
        });
      },
      { immediate: true }
    );
    onBeforeUnmount(closeCurrent);

    // The window's own document has no host direction to inherit, so a right-to-left
    // catalog sets it on the window's editor root.
    const translation = useTranslation();

    return () => {
      const target = popup.value?.element;
      // Two keyed branches, never one retargeted Teleport: the content must remount to move.
      return target
        ? h(Teleport, { to: target, key: 'popout' }, [
            h(
              'div',
              {
                class: `docx-editor${dark.value ? ' dark' : ''}`,
                style: { height: '100%' },
                dir: translation.dir,
              },
              slots.default?.()
            ),
          ])
        : h(Fragment, { key: 'inline' }, slots.default?.());
    };
  },
});
