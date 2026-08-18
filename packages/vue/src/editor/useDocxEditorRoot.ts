import {
  computed,
  inject,
  onMounted,
  onUnmounted,
  provide,
  shallowRef,
  watch,
  type ComputedRef,
  type InjectionKey,
  toValue,
  type MaybeRefOrGetter,
  type ShallowRef,
} from 'vue';
import type {
  DocumentChange,
  DocumentSource,
  Editor,
  EditorFontError,
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
import type { DocxEditorChildren } from '../docx-editor-children';
import { createNavigationLayoutStore, navigationLayoutKey } from './navigation/navigation-layout';

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
  onReady?: (editor: Editor) => void;
  onChange?: (change: DocumentChange) => void;
  onFontError?: (error: EditorFontError) => void;
  children?: DocxEditorChildren;
}

/** @internal Root ownership already established by {@link provideDocxEditor}. */
export const docxEditorRootOwnerKey: InjectionKey<boolean> = Symbol('docxEditorRootOwner');

/** @internal Bridges {@link provideDocxEditor} host emits to {@link DocxEditorRoot}. */
export const docxEditorRootHostEmitKey: InjectionKey<ShallowRef<DocxEditorRootEmit>> =
  Symbol('docxEditorRootHostEmit');

export interface DocxEditorRootEmit {
  ready: (editor: Editor) => void;
  change: (change: DocumentChange) => void;
  fontError: (error: EditorFontError) => void;
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
export function useDocxEditorRootOwner(
  props: MaybeRefOrGetter<DocxEditorRootProps>,
  emit: DocxEditorRootEmit
): {
  editorRef: ShallowRef<DocxEditorInstance | null>;
  translateResolver: ComputedRef<(key: string, params?: Record<string, string | number>) => string>;
} {
  const editorRef = shallowRef<DocxEditorInstance | null>(null);
  const tick = shallowRef(0);
  provide(docxEditorKey, editorRef);
  provide(editorStateTickKey, tick);
  provide(navigationLayoutKey, createNavigationLayoutStore());
  provide(docxEditorRootOwnerKey, true);

  const { t: catalogT, catalogue } = useTranslation();
  const translateResolver = computed(() => {
    catalogue.value;
    const custom = toValue(props).translate;
    if (custom) return custom;
    const t = catalogT;
    return (key: string, params?: Record<string, string | number>) =>
      t(key as TranslationKey, params);
  });

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
  let readyFired = false;

  const destroyEditor = () => {
    if (cleanups.length >= 3) facadeListenerCount = Math.max(0, facadeListenerCount - 3);
    for (const off of cleanups.splice(0)) off();
    const instance = editorRef.value;
    if (instance) {
      instance.destroy();
      editorRef.value = null;
    }
    readyFired = false;
  };

  const fireReady = (instance: DocxEditorInstance) => {
    if (readyFired) return;
    readyFired = true;
    emit.ready(instance);
  };

  const fireChange = (change: DocumentChange) => {
    emit.change(change);
  };

  const fireFontError = (error: EditorFontError) => {
    emit.fontError(error);
  };

  const createEditor = () => {
    if (typeof window === 'undefined') return;
    destroyEditor();
    const p = toValue(props);
    const instance = createDocxEditor({
      ...(p.document !== undefined ? { document: p.document } : {}),
      ...(p.fonts ? { fonts: p.fonts } : {}),
      ...(p.author !== undefined ? { author: p.author } : {}),
      ...(p.locale !== undefined ? { locale: p.locale } : {}),
      translate: translateResolver.value,
      ...(p.mode !== undefined ? { mode: p.mode } : {}),
      ...(p.modules !== undefined ? { modules: p.modules } : {}),
      ...(p.zoom !== undefined ? { zoom: p.zoom } : {}),
      ...(p.zoomMode !== undefined ? { zoomMode: p.zoomMode } : {}),
      ...(p.tableInteractionLabel ? { tableInteractionLabel: p.tableInteractionLabel } : {}),
      ...(p.imageDecodePort ? { imageDecodePort: p.imageDecodePort } : {}),
      onFontError: fireFontError,
    });
    const notify = deferredTick(() => {
      tick.value++;
    });
    facadeListenerCount += 3;
    cleanups.push(
      instance.on('change', (change) => {
        fireChange(change);
        notify();
      })
    );
    cleanups.push(instance.on('selectionChange', notify));
    cleanups.push(instance.on('error', notify));
    editorRef.value = instance;
  };

  onMounted(() => {
    watch(
      editorRef,
      (instance) => {
        if (!instance) return;
        if (!instance.snapshot().isOpening) {
          fireReady(instance);
          return;
        }
        const off = instance.on('change', () => {
          off();
          fireReady(instance);
        });
        cleanups.push(off);
      },
      { flush: 'post', immediate: true }
    );
  });

  if (typeof window !== 'undefined') {
    watch(
      () =>
        [
          toValue(props).document,
          toValue(props).fonts,
          translateResolver.value,
          toValue(props).imageDecodePort,
        ] as const,
      createEditor,
      { immediate: true, flush: 'post' }
    );
  }

  onUnmounted(destroyEditor);

  const applied = {
    zoom: undefined as number | undefined,
    mode: undefined as ZoomMode | 'auto' | undefined,
  };
  watch(
    () => [editorRef.value, toValue(props).zoom, toValue(props).zoomMode] as const,
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
    () => [editorRef.value, toValue(props).tableInteractionLabel] as const,
    ([editor, label]) => {
      if (editor) editor.setTableInteractionLabel(label ?? defaultTableLabel);
    },
    { flush: 'post' }
  );

  return { editorRef, translateResolver };
}

/** @internal Returns true when a parent setup already owns the root. */
export function useDocxEditorRootOwned(): boolean {
  return inject(docxEditorRootOwnerKey, false);
}
