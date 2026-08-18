import {
  defineComponent,
  h,
  onBeforeMount,
  onUnmounted,
  provide,
  shallowRef,
  watch,
  type PropType,
} from 'vue';
import type {
  DocumentChange,
  DocumentSource,
  Editor,
  ZoomMode,
} from '@docx-editor.dev/core/contracts/editor';
import {
  createDocxEditor,
  defaultTableLabel,
  resolveZoomMode,
  sameZoomMode,
  type DocxEditorInstance,
  type EditorModule,
  type FontConfigurationFragment,
  type FontResolver,
  type ImageDecodePort,
} from '@docx-editor.dev/core/editor';
import type { FontConfiguration } from '@docx-editor.dev/core/contracts/editor';
import { useTranslation, type TranslationKey } from '../i18n';
import {
  docxEditorKey,
  editorStateTickKey,
  ReviewRailContext,
  type ReviewRailRegistry,
} from './context';
import { deferredTick } from './deferred-notifier';
import { HyperlinkPopupContext, useHyperlinkPopupInstance } from './useHyperlinkPopup';
import { ContentControlContext, useContentControlInstance } from './useContentControl';
import { createNavigationLayoutStore, navigationLayoutKey } from './navigation/navigation-layout';
import { ImageInsertProvider } from './images/ImageInsert';

/** @public */
export interface DocxEditorRootProps {
  document?: DocumentSource;
  fonts?: FontConfiguration | FontConfigurationFragment | FontResolver;
  author?: string;
  locale?: string;
  translate?: (key: string, params?: Record<string, string | number>) => string;
  modules?: readonly EditorModule[];
  mode?: 'edit' | 'view' | 'suggesting';
  zoom?: number;
  zoomMode?: ZoomMode | 'auto';
  tableInteractionLabel?: (key: 'table.insertRowBelow' | 'table.insertColumnRight') => string;
  imageDecodePort?: ImageDecodePort;
}

function sameZoomProp(a: ZoomMode | 'auto', b: ZoomMode | 'auto'): boolean {
  if (a === b) return true;
  const left = resolveZoomMode(a);
  const right = resolveZoomMode(b);
  return left !== null && right !== null && sameZoomMode(left, right);
}

let facadeListenerCount = 0;

/** @internal */
export function docxEditorFacadeListenerCount(): number {
  return facadeListenerCount;
}

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

/** @public */
export const DocxEditorRoot = defineComponent({
  name: 'DocxEditorRoot',
  props: {
    document: {
      type: [Object, Uint8Array, ArrayBuffer] as PropType<DocumentSource>,
      default: undefined,
    },
    fonts: { type: Object as PropType<DocxEditorRootProps['fonts']>, default: undefined },
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
    const editorRef = shallowRef<DocxEditorInstance | null>(null);
    const tick = shallowRef(0);
    provide(docxEditorKey, editorRef);
    provide(editorStateTickKey, tick);
    provide(navigationLayoutKey, createNavigationLayoutStore());

    const { t: catalogT } = useTranslation();
    const defaultTranslate = (key: string, params?: Record<string, string | number>) =>
      catalogT.value(key as TranslationKey, params);

    const railCount = shallowRef(0);
    const railRegistry = shallowRef<ReviewRailRegistry>({
      mounted: 0,
      register: () => () => {},
    });
    watch(
      railCount,
      (mounted) => {
        railRegistry.value = {
          mounted,
          register: () => {
            railCount.value++;
            return () => {
              railCount.value = Math.max(0, railCount.value - 1);
            };
          },
        };
      },
      { immediate: true }
    );
    provide(ReviewRailContext, railRegistry);

    const cleanups: Array<() => void> = [];

    const destroyEditor = () => {
      const listenerCleanups = cleanups.length;
      if (listenerCleanups >= 3) facadeListenerCount = Math.max(0, facadeListenerCount - 3);
      for (const off of cleanups.splice(0)) off();
      const instance = editorRef.value;
      if (instance) {
        instance.destroy();
        editorRef.value = null;
      }
    };

    const createEditor = () => {
      destroyEditor();
      const translate = props.translate ?? defaultTranslate;
      const instance = createDocxEditor({
        ...(props.document !== undefined ? { document: props.document } : {}),
        ...(props.fonts ? { fonts: props.fonts } : {}),
        ...(props.author !== undefined ? { author: props.author } : {}),
        ...(props.locale !== undefined ? { locale: props.locale } : {}),
        translate,
        ...(props.mode !== undefined ? { mode: props.mode } : {}),
        ...(props.modules !== undefined ? { modules: props.modules } : {}),
        ...(props.zoom !== undefined ? { zoom: props.zoom } : {}),
        ...(props.zoomMode !== undefined ? { zoomMode: props.zoomMode } : {}),
        ...(props.tableInteractionLabel
          ? { tableInteractionLabel: props.tableInteractionLabel }
          : {}),
        ...(props.imageDecodePort ? { imageDecodePort: props.imageDecodePort } : {}),
        onFontError: (error) => emit('fontError', error),
      });
      const notify = deferredTick(() => {
        tick.value++;
      });
      facadeListenerCount += 3;
      cleanups.push(
        instance.on('change', (change) => {
          emit('change', change);
          notify();
        })
      );
      cleanups.push(instance.on('selectionChange', notify));
      cleanups.push(instance.on('error', notify));
      editorRef.value = instance;
      if (!instance.snapshot().isOpening) emit('ready', instance);
      else {
        const off = instance.on('change', () => {
          off();
          emit('ready', instance);
        });
        cleanups.push(off);
      }
    };

    onBeforeMount(createEditor);
    watch(
      () => [props.document, props.fonts, props.translate, props.imageDecodePort] as const,
      createEditor
    );
    onUnmounted(destroyEditor);

    const applied = {
      zoom: undefined as number | undefined,
      mode: undefined as ZoomMode | 'auto' | undefined,
    };
    watch(
      () => [editorRef.value, props.zoom, props.zoomMode] as const,
      ([, zoom, zoomMode]) => {
        if (!editorRef.value) return;
        const editor = editorRef.value;
        if (zoom !== undefined && zoom !== applied.zoom) {
          applied.zoom = zoom;
          editor.setZoom(zoom);
        }
        const modeMoved =
          zoomMode !== undefined &&
          (applied.mode === undefined || !sameZoomProp(applied.mode, zoomMode));
        const resolved = zoomMode === undefined ? null : resolveZoomMode(zoomMode);
        const reassertDeclaredFit =
          zoom !== undefined &&
          zoomMode !== undefined &&
          resolved !== null &&
          resolved.type === 'fit';
        if (modeMoved || reassertDeclaredFit) {
          applied.mode = zoomMode!;
          editor.setZoomMode(zoomMode!);
        }
      },
      { flush: 'post' }
    );

    watch(
      () => [editorRef.value, props.tableInteractionLabel] as const,
      ([editor, label]) => {
        if (editor) editor.setTableInteractionLabel(label ?? defaultTableLabel);
      },
      { flush: 'post' }
    );

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

/** @public */
export function provideDocxEditor(options: DocxEditorRootProps) {
  return { DocxEditorRoot, props: options };
}
