import {
  computed,
  defineComponent,
  h,
  onMounted,
  onUnmounted,
  provide,
  ref,
  shallowRef,
  watch,
  type CSSProperties,
  type PropType,
  type VNode,
} from 'vue';
import type { TranslationKey } from '../i18n';
import { LocaleProvider, useTranslation } from '../i18n';
import { prefersColorSchemeDark, resolveIsDark, subscribeSystemDark } from '../lib/colorMode';
import { DocxEditorRoot } from '../editor/DocxEditorRoot';
import { DocxEditorViewport } from '../editor/DocxEditorViewport';
import { DocxEditorContent } from '../editor/DocxEditorContent';
import { DocxEditorLoading } from '../editor/DocxEditorLoading';
import { DocxEditorToolbar } from '../editor/toolbar';
import { DocxEditorMenu } from '../editor/menu';
import { DocxEditorHorizontalRuler, DocxEditorVerticalRuler } from '../editor/DocxEditorRulers';
import { DocxEditorDocumentOutline } from '../editor/DocxEditorOutline';
import { DocxEditorNavigation, Navigation } from '../editor/navigation';
import { DocxEditorPageSetupDialog } from '../editor/DocxEditorPageSetup';
import { DocxEditorPageNumber, PageNumberTranslationContext } from '../editor/DocxEditorPageNumber';
import { DocxEditorFontNotice } from '../editor/DocxEditorFontNotice';
import { DocxEditorHeaderFooterChrome } from '../editor/DocxEditorHeaderFooter';
import { DocxEditorHyperLink } from '../editor/DocxEditorHyperLink';
import { DocxEditorNotesChrome } from '../editor/DocxEditorNotes';
import { DocxEditorContextMenu, ContextMenu } from '../editor/contextmenu';
import { DocxEditorContentControl } from '../editor/DocxEditorContentControl';
import { ScopedByAncestorContext } from '../editor/scope-context';
import { useDocxEditor } from '../editor/context';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import type { DocxEditorContextMenuProps } from '../editor/contextmenu';
import type { DocxEditorMenuProps } from '../editor/menu';
import type { DocxEditorProps, DocxEditorRef } from '../types';
import { createDocxEditorRefApi } from './DocxEditor/useDocxEditorRefApi';

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  backgroundColor: 'var(--doc-bg)',
};

const SCROLL_AREA_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflowAnchor: 'none',
};

const WORKSPACE_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};

const RULER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  flex: 'none',
  minHeight: '34px',
  padding: '6px 0 2px',
  overflow: 'hidden',
  backgroundColor: 'var(--doc-bg)',
};

const VERTICAL_RULER_STYLE: CSSProperties = {
  position: 'absolute',
  top: '40px',
  left: 0,
  zIndex: 10,
  pointerEvents: 'none',
};

const CHROME_BAND_STYLE: CSSProperties = {
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  zIndex: 30,
  backgroundColor: 'var(--doc-surface)',
  borderBottomWidth: '1px',
  borderBottomStyle: 'solid',
  borderBottomColor: 'var(--doc-border)',
  boxShadow: '0 1px 3px var(--doc-shadow-subtle)',
};

const TOOLBAR_ROW_STYLE: CSSProperties = {
  padding: '8px 12px',
};

const TITLE_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 12px 0',
  color: 'var(--doc-text)',
};

const TITLE_BLOCK_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  gap: '2px',
};

const TITLE_INPUT_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  font: 'inherit',
  color: 'inherit',
  backgroundColor: 'transparent',
  border: '1px solid transparent',
  borderRadius: '4px',
  padding: '2px 6px',
};

const ScopedChrome = defineComponent({
  name: 'ScopedChrome',
  props: {
    scoped: { type: Boolean, required: true },
  },
  setup(props, { slots }) {
    provide(ScopedByAncestorContext, props.scoped);
    return () => slots.default?.();
  },
});

/** @public */
export interface DocxEditorNamespace {
  (props: DocxEditorProps): VNode;
  readonly Root: typeof DocxEditorRoot;
  readonly Viewport: typeof DocxEditorViewport;
  readonly Content: typeof DocxEditorContent;
  readonly Toolbar: typeof DocxEditorToolbar;
  readonly Menu: typeof DocxEditorMenu;
  readonly Loading: typeof DocxEditorLoading;
  readonly HorizontalRuler: typeof DocxEditorHorizontalRuler;
  readonly VerticalRuler: typeof DocxEditorVerticalRuler;
  readonly DocumentOutline: typeof DocxEditorDocumentOutline;
  readonly Navigation: typeof Navigation;
  readonly PageSetupDialog: typeof DocxEditorPageSetupDialog;
  readonly PageNumber: typeof DocxEditorPageNumber;
  readonly FontNotice: typeof DocxEditorFontNotice;
  readonly HeaderFooterChrome: typeof DocxEditorHeaderFooterChrome;
  readonly NotesChrome: typeof DocxEditorNotesChrome;
  readonly HyperLink: typeof DocxEditorHyperLink;
  readonly ContextMenu: typeof ContextMenu;
  readonly ContentControl: typeof DocxEditorContentControl;
}

const docxEditorFrameProps = {
  document: {
    type: [Object, Uint8Array, ArrayBuffer] as PropType<DocxEditorProps['document']>,
    default: undefined,
  },
  fonts: { type: Object as PropType<DocxEditorProps['fonts']>, default: undefined },
  class: { type: String, default: undefined },
  t: { type: Function as PropType<DocxEditorProps['t']>, default: undefined },
  colorMode: { type: String as PropType<'light' | 'dark' | 'system'>, default: 'light' },
  chrome: { type: Boolean, default: undefined },
  title: { type: String, default: undefined },
  menu: { type: [Boolean, Object] as PropType<boolean | DocxEditorMenuProps>, default: undefined },
  hyperlinkPopup: { type: Boolean, default: undefined },
  contextMenu: {
    type: [Boolean, Object] as PropType<boolean | DocxEditorContextMenuProps>,
    default: undefined,
  },
  navigation: { type: Boolean, default: undefined },
  rulers: { type: Boolean, default: undefined },
  mode: { type: String as PropType<DocxEditorProps['mode']>, default: undefined },
  zoom: { type: Number, default: undefined },
  zoomMode: { type: [Object, String] as PropType<DocxEditorProps['zoomMode']>, default: undefined },
  locale: { type: String, default: undefined },
  author: { type: String, default: undefined },
  modules: { type: Array as PropType<readonly EditorModule[]>, default: undefined },
  onSave: { type: Function as PropType<() => void>, default: undefined },
  onOpen: { type: Function as PropType<() => void>, default: undefined },
  /** Prefer over {@link onSave} when passing from TSX — `onSave` binds as a listener. */
  saveHandler: { type: Function as PropType<() => void>, default: undefined },
  /** Prefer over {@link onOpen} when passing from TSX — `onOpen` binds as a listener. */
  openHandler: { type: Function as PropType<() => void>, default: undefined },
  onTitleChange: { type: Function as PropType<(title: string) => void>, default: undefined },
} as const;

const docxEditorSugarProps = {
  ...docxEditorFrameProps,
  i18n: { type: Object as PropType<DocxEditorProps['i18n']>, default: undefined },
  onSave: { type: Function as PropType<() => void>, default: undefined },
  onOpen: { type: Function as PropType<() => void>, default: undefined },
  saveHandler: { type: Function as PropType<() => void>, default: undefined },
  openHandler: { type: Function as PropType<() => void>, default: undefined },
  onTitleChange: { type: Function as PropType<(title: string) => void>, default: undefined },
} as const;

const DocxEditorFrame = defineComponent({
  name: 'DocxEditorFrame',
  inheritAttrs: false,
  props: docxEditorFrameProps,
  emits: ['ready', 'change', 'fontError', 'save', 'open', 'titleChange'] as const,
  setup(props, { attrs, emit, slots, expose }) {
    const hostSave = computed(
      () =>
        props.saveHandler ??
        props.onSave ??
        (attrs.saveHandler as (() => void) | undefined) ??
        (attrs.onSave as (() => void) | undefined)
    );
    const hostOpen = computed(
      () =>
        props.openHandler ??
        props.onOpen ??
        (attrs.openHandler as (() => void) | undefined) ??
        (attrs.onOpen as (() => void) | undefined)
    );
    const hostTitleChange = computed(
      () => props.onTitleChange ?? (attrs.onTitleChange as ((title: string) => void) | undefined)
    );
    const chrome = computed(() => props.chrome ?? true);
    const menu = computed(() => props.menu ?? true);
    const navigation = computed(() => props.navigation ?? true);
    const rulers = computed(() => props.rulers ?? true);
    const contextMenu = computed(() => props.contextMenu ?? true);
    const hyperlinkPopup = computed(() => props.hyperlinkPopup ?? true);

    const systemDark = ref(prefersColorSchemeDark());
    let unsubscribeDark: (() => void) | undefined;
    onMounted(() => {
      if (props.colorMode === 'system') {
        unsubscribeDark = subscribeSystemDark((dark) => {
          systemDark.value = dark;
        });
      }
    });
    onUnmounted(() => unsubscribeDark?.());

    watch(
      () => props.colorMode,
      (mode, _, onCleanup) => {
        unsubscribeDark?.();
        unsubscribeDark = undefined;
        if (mode === 'system') {
          unsubscribeDark = subscribeSystemDark((dark) => {
            systemDark.value = dark;
          });
          onCleanup(() => unsubscribeDark?.());
        }
      }
    );

    const isDark = computed(() => resolveIsDark(props.colorMode, systemDark.value));
    const { t: catalogT } = useTranslation();
    const translate = (key: string, params?: Record<string, string | number>) =>
      props.t ? props.t(key, params) : catalogT(key as TranslationKey, params);

    const tableInteractionLabel = (key: 'table.insertRowBelow' | 'table.insertColumnRight') =>
      translate(key);

    provide(PageNumberTranslationContext, translate);

    const handleRef = shallowRef<DocxEditorRef | null>(null);
    expose({
      load: (document) => handleRef.value?.load(document),
      save: () => handleRef.value?.save() ?? Promise.resolve(null),
      getDocumentHandle: () => handleRef.value?.getDocumentHandle() ?? null,
      getEditor: () => handleRef.value?.getEditor() ?? null,
      focus: () => handleRef.value?.focus(),
      exec: (command, options) =>
        handleRef.value?.exec(command, options) ?? {
          ok: false,
          code: 'notFound',
          reason: 'no editor is mounted',
        },
      snapshot: (options) =>
        handleRef.value?.snapshot(options) ?? createDocxEditorRefApi(() => null).snapshot(options),
    } satisfies DocxEditorRef);

    const RefBridge = defineComponent({
      name: 'DocxEditorRefBridge',
      setup() {
        const editor = useDocxEditor();
        handleRef.value = createDocxEditorRefApi(() => editor.value);
        return () => null;
      },
    });

    return () => {
      const viewportClass =
        chrome.value && isDark.value ? 'dark' : chrome.value ? undefined : props.class;
      const viewport = h(
        DocxEditorViewport,
        {
          class: viewportClass,
          style: chrome.value ? SCROLL_AREA_STYLE : undefined,
          ...(!chrome.value && props.class ? {} : {}),
        },
        {
          default: () => [
            chrome.value ? h(DocxEditorHeaderFooterChrome) : null,
            chrome.value ? h(DocxEditorNotesChrome) : null,
            h(DocxEditorContent),
            h(DocxEditorHyperLink, { hidden: hyperlinkPopup.value === false }),
            contextMenu.value === false
              ? null
              : h(DocxEditorContextMenu, {
                  t: translate,
                  ...(typeof contextMenu.value === 'object' ? contextMenu.value : {}),
                }),
            h(DocxEditorContentControl),
            rulers.value && chrome.value
              ? h('div', { style: VERTICAL_RULER_STYLE, 'aria-hidden': 'true' }, [
                  h(DocxEditorVerticalRuler),
                ])
              : null,
            slots.default?.(),
          ],
        }
      );

      const menuProps = typeof menu.value === 'object' ? menu.value : ({} as DocxEditorMenuProps);

      const tree = chrome.value
        ? h(
            'div',
            {
              class: `docx-editor${isDark.value ? ' dark' : ''}${props.class ? ` ${props.class}` : ''}`,
              style: CONTAINER_STYLE,
            },
            [
              h('div', { style: CHROME_BAND_STYLE }, [
                h('div', { style: TITLE_BAR_STYLE }, [
                  slots.titleBarLeft?.(),
                  h('div', { style: TITLE_BLOCK_STYLE }, [
                    hostTitleChange.value !== undefined
                      ? h('input', {
                          'aria-label': translate('titleBar.documentNameAriaLabel'),
                          value: props.title ?? '',
                          placeholder: translate('titleBar.untitled'),
                          style: TITLE_INPUT_STYLE,
                          onInput: (event: Event) => {
                            const value = (event.target as HTMLInputElement).value;
                            hostTitleChange.value?.(value);
                            emit('titleChange', value);
                          },
                        })
                      : h(
                          'span',
                          { style: { minWidth: 0, padding: '2px 6px' } },
                          props.title ?? translate('titleBar.untitled')
                        ),
                    menu.value !== false
                      ? h(DocxEditorMenu, {
                          t: translate,
                          ...(props.title !== undefined ? { fileName: props.title } : {}),
                          ...(hostOpen.value !== undefined ? { openHandler: hostOpen.value } : {}),
                          ...(hostSave.value !== undefined ? { saveHandler: hostSave.value } : {}),
                          ...menuProps,
                        })
                      : null,
                  ]),
                  slots.titleBarRight?.(),
                ]),
                h('div', { style: TOOLBAR_ROW_STYLE }, [h(DocxEditorToolbar, { t: translate })]),
              ]),
              rulers.value
                ? h('div', { style: RULER_ROW_STYLE }, [h(DocxEditorHorizontalRuler)])
                : null,
              h(DocxEditorFontNotice, { t: translate }),
              h('div', { style: WORKSPACE_STYLE }, [
                navigation.value ? h(DocxEditorNavigation, { t: translate }) : null,
                viewport,
                h(DocxEditorPageNumber),
                h(DocxEditorLoading, { overlay: true }),
              ]),
            ]
          )
        : viewport;

      return h(
        DocxEditorRoot,
        {
          ...(props.document !== undefined ? { document: props.document } : {}),
          ...(props.fonts ? { fonts: props.fonts } : {}),
          ...(props.author !== undefined ? { author: props.author } : {}),
          ...(props.locale !== undefined ? { locale: props.locale } : {}),
          translate,
          ...(props.mode !== undefined ? { mode: props.mode } : { mode: 'edit' }),
          ...(props.modules !== undefined ? { modules: props.modules } : {}),
          ...(props.zoom !== undefined ? { zoom: props.zoom } : {}),
          ...(props.zoomMode !== undefined ? { zoomMode: props.zoomMode } : {}),
          tableInteractionLabel,
          onReady: (editor: unknown) => emit('ready', editor),
          onChange: (change: unknown) => emit('change', change),
          onFontError: (error: unknown) => emit('fontError', error),
        },
        {
          default: () => [
            h(RefBridge),
            h(ScopedChrome, { scoped: chrome.value }, { default: () => tree }),
          ],
        }
      );
    };
  },
});

const DocxEditorImpl = defineComponent({
  name: 'DocxEditor',
  inheritAttrs: false,
  props: docxEditorSugarProps,
  emits: ['ready', 'change', 'fontError', 'save', 'open', 'titleChange'] as const,
  setup(props, { attrs, emit, slots, expose }) {
    const hostSaveProp = () =>
      props.saveHandler ??
      props.onSave ??
      (attrs.saveHandler as (() => void) | undefined) ??
      (attrs.onSave as (() => void) | undefined);
    const hostOpenProp = () =>
      props.openHandler ??
      props.onOpen ??
      (attrs.openHandler as (() => void) | undefined) ??
      (attrs.onOpen as (() => void) | undefined);
    const hostTitleChangeProp = () =>
      props.onTitleChange ?? (attrs.onTitleChange as ((title: string) => void) | undefined);
    const api = shallowRef<DocxEditorRef | null>(null);
    expose({
      load: (document) => api.value?.load(document),
      save: () => api.value?.save() ?? Promise.resolve(null),
      getDocumentHandle: () => api.value?.getDocumentHandle() ?? null,
      getEditor: () => api.value?.getEditor() ?? null,
      focus: () => api.value?.focus(),
      exec: (command, options) =>
        api.value?.exec(command, options) ?? {
          ok: false,
          code: 'notFound',
          reason: 'no editor is mounted',
        },
      snapshot: (options) =>
        api.value?.snapshot(options) ?? createDocxEditorRefApi(() => null).snapshot(options),
    } satisfies DocxEditorRef);

    const { i18n, ...frameProps } = props;
    return () =>
      h(LocaleProvider, i18n !== undefined ? { i18n } : {}, {
        default: () =>
          h(
            DocxEditorFrame,
            {
              ...frameProps,
              ref: (ref: unknown) => {
                api.value =
                  ref && typeof ref === 'object' && 'load' in ref
                    ? (ref as unknown as DocxEditorRef)
                    : null;
              },
              onReady: (editor: unknown) => emit('ready', editor),
              onChange: (change: unknown) => emit('change', change),
              onFontError: (error: unknown) => emit('fontError', error),
              saveHandler:
                hostSaveProp() !== undefined
                  ? () => {
                      hostSaveProp()!();
                      emit('save');
                    }
                  : undefined,
              openHandler:
                hostOpenProp() !== undefined
                  ? () => {
                      hostOpenProp()!();
                      emit('open');
                    }
                  : undefined,
              onTitleChange:
                hostTitleChangeProp() !== undefined
                  ? (title: string) => {
                      hostTitleChangeProp()!(title);
                      emit('titleChange', title);
                    }
                  : undefined,
            } as Record<string, unknown>,
            {
              default: slots.default,
              titleBarLeft: slots.titleBarLeft,
              titleBarRight: slots.titleBarRight,
            }
          ),
      });
  },
});

/** @public */
export const DocxEditor = Object.assign(DocxEditorImpl, {
  Root: DocxEditorRoot,
  Viewport: DocxEditorViewport,
  Content: DocxEditorContent,
  Toolbar: DocxEditorToolbar,
  Menu: DocxEditorMenu,
  Loading: DocxEditorLoading,
  HorizontalRuler: DocxEditorHorizontalRuler,
  VerticalRuler: DocxEditorVerticalRuler,
  DocumentOutline: DocxEditorDocumentOutline,
  Navigation: DocxEditorNavigation,
  PageSetupDialog: DocxEditorPageSetupDialog,
  PageNumber: DocxEditorPageNumber,
  FontNotice: DocxEditorFontNotice,
  HeaderFooterChrome: DocxEditorHeaderFooterChrome,
  NotesChrome: DocxEditorNotesChrome,
  HyperLink: DocxEditorHyperLink,
  ContextMenu: DocxEditorContextMenu,
  ContentControl: DocxEditorContentControl,
}) as unknown as DocxEditorNamespace;

export default DocxEditor;
