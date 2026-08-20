import {
  defineComponent,
  h,
  inject,
  onUnmounted,
  provide,
  shallowRef,
  type PropType,
  type ShallowRef,
} from 'vue';
import type {
  DocumentChange,
  DocumentSource,
  Editor,
  EditorFontError,
  ZoomMode,
} from '@docx-editor.dev/core/contracts/editor';
import type { EditorModule, ImageDecodePort } from '@docx-editor.dev/core/editor';
import { HyperlinkPopupContext, useHyperlinkPopupInstance } from './useHyperlinkPopup';
import { ContentControlContext, useContentControlInstance } from './useContentControl';
import { ImageInsertProvider } from './images/ImageInsert';
import {
  docxEditorRootHostEmitKey,
  useDocxEditorRootOwned,
  useDocxEditorRootOwner,
  type DocxEditorRootEmit,
  type DocxEditorRootProps,
} from './useDocxEditorRoot';
import { useDocxEditor } from './context';

export { docxEditorFacadeListenerCount, type DocxEditorRootProps } from './useDocxEditorRoot';

/** @internal */
const HyperlinkPopupProvider = defineComponent({
  name: 'HyperlinkPopupProvider',
  setup(_, { slots }) {
    const popup = useHyperlinkPopupInstance(true);
    provide(HyperlinkPopupContext, popup);
    return () => slots.default?.();
  },
});

/** @internal */
const ContentControlProvider = defineComponent({
  name: 'ContentControlProvider',
  setup(_, { slots }) {
    const chrome = useContentControlInstance();
    provide(ContentControlContext, chrome);
    return () => slots.default?.();
  },
});

/** @public Lifecycle listeners for {@link provideDocxEditor}; bind on {@link DocxEditorRoot}. */
export interface DocxEditorRootListeners {
  onReady?: (editor: Editor) => void;
  onChange?: (change: DocumentChange) => void;
  onFontError?: (error: EditorFontError) => void;
}

/** @public */
export interface ProvideDocxEditorResult {
  readonly DocxEditorRoot: typeof DocxEditorRoot;
  readonly rootProps: ShallowRef<Omit<DocxEditorRootProps, keyof DocxEditorRootListeners>>;
  readonly rootListeners: DocxEditorRootListeners;
  readonly editorRef: ReturnType<typeof useDocxEditor>;
}

const noopEmit: DocxEditorRootEmit = {
  ready: () => {},
  change: () => {},
  fontError: () => {},
};

/**
 * Setup composable for hosts that own the editor above the packaged root.
 * Creates the instance, publishes `docxEditorKey`, and returns props for
 * {@link DocxEditorRoot}.
 *
 * @public
 */
export function provideDocxEditor(options: DocxEditorRootProps): ProvideDocxEditorResult {
  const { onReady, onChange, onFontError, ...engineProps } = options;
  const rootProps = shallowRef({ ...engineProps });
  const rootListeners: DocxEditorRootListeners = { onReady, onChange, onFontError };
  const hostEmit = shallowRef({ ...noopEmit });
  provide(docxEditorRootHostEmitKey, hostEmit);
  const { editorRef } = useDocxEditorRootOwner(rootProps, {
    ready: (editor) => hostEmit.value.ready(editor),
    change: (change) => hostEmit.value.change(change),
    fontError: (error) => hostEmit.value.fontError(error),
  });
  return {
    DocxEditorRoot,
    rootProps,
    rootListeners,
    editorRef,
  };
}

/** @public */
export const DocxEditorRoot = defineComponent({
  name: 'DocxEditorRoot',
  props: {
    document: {
      type: [String, Object, Uint8Array, ArrayBuffer] as PropType<DocumentSource>,
      default: undefined,
    },
    fonts: {
      type: [Object, Function] as PropType<DocxEditorRootProps['fonts']>,
      default: undefined,
    },
    author: { type: String, default: undefined },
    locale: { type: String, default: undefined },
    translate: { type: Function as PropType<DocxEditorRootProps['translate']>, default: undefined },
    modules: { type: Array as PropType<readonly EditorModule[]>, default: undefined },
    mode: { type: String as PropType<'edit' | 'view' | 'suggesting'>, default: undefined },
    zoom: { type: Number, default: undefined },
    zoomMode: { type: [Object, String] as PropType<ZoomMode | 'auto'>, default: undefined },
    tableInteractionLabel: {
      type: Function as PropType<DocxEditorRootProps['tableInteractionLabel']>,
      default: undefined,
    },
    imageDecodePort: { type: Object as PropType<ImageDecodePort>, default: undefined },
  },
  emits: {
    ready: (_editor: Editor) => true,
    change: (_change: DocumentChange) => true,
    fontError: (_error: unknown) => true,
  },
  setup(props, { emit, slots }) {
    const ownedAbove = useDocxEditorRootOwned();
    const hostEmit = inject(docxEditorRootHostEmitKey, null);
    if (ownedAbove && hostEmit) {
      hostEmit.value = {
        ready: (editor) => emit('ready', editor),
        change: (change) => emit('change', change),
        fontError: (error) => emit('fontError', error),
      };
      onUnmounted(() => {
        hostEmit.value = { ...noopEmit };
      });
    } else if (!ownedAbove) {
      useDocxEditorRootOwner(props, {
        ready: (editor) => emit('ready', editor),
        change: (change) => emit('change', change),
        fontError: (error) => emit('fontError', error),
      });
    }

    return () =>
      h(HyperlinkPopupProvider, null, {
        default: () =>
          h(ContentControlProvider, null, {
            default: () =>
              h(ImageInsertProvider, null, {
                default: () => slots.default?.(),
              }),
          }),
      });
  },
});
