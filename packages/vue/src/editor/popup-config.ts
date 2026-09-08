import type { DocxEditorContentControlWidgetProps } from './DocxEditorContentControlWidget';
import type { DocxEditorInvalidTextFormFieldDialogProps } from './DocxEditorInvalidTextFormFieldDialog';
import type { DocxEditorImagePropertiesDialogProps } from './images/ImageProperties';
import type { DocxEditorImageAltTextPopupProps } from './images/ImageAltText';
import type {
  DocxEditorNotePropertiesDialogProps,
  DocxEditorNotesContextMenuProps,
  DocxEditorNotePreviewProps,
} from './DocxEditorNotes';
import {
  computed,
  defineComponent,
  h,
  inject,
  provide,
  type ComputedRef,
  type InjectionKey,
  type PropType,
} from 'vue';
import type { DocxEditorChildren } from '../docx-editor-children';
import type { DocxEditorPageSetupDialogProps } from './DocxEditorPageSetup';
import type { DocxEditorParagraphDialogProps } from './DocxEditorParagraphDialog';
import type { DocxEditorTextFormFieldDialogProps } from './DocxEditorTextFormFieldDialog';
import { DocxEditorHyperLink, type HyperLinkProps } from './DocxEditorHyperLink';
import { DocxEditorContentControl, type ContentControlProps } from './DocxEditorContentControl';
import { DocxEditorEquation } from './DocxEditorEquation';
import { DocxEditorContextMenu, type DocxEditorContextMenuProps } from './contextmenu';
import { useTranslation } from '../i18n';

/** Render overrides for automatically hosted editor popups. False disables a popup. @public */
export interface DocxEditorPopups {
  contentControlWidget?:
    | false
    | ((props: DocxEditorContentControlWidgetProps) => DocxEditorChildren | null);
  invalidTextFormField?:
    | false
    | ((props: DocxEditorInvalidTextFormFieldDialogProps) => DocxEditorChildren | null);
  imageProperties?:
    | false
    | ((props: DocxEditorImagePropertiesDialogProps) => DocxEditorChildren | null);
  imageAltText?: false | ((props: DocxEditorImageAltTextPopupProps) => DocxEditorChildren | null);
  noteProperties?:
    | false
    | ((props: DocxEditorNotePropertiesDialogProps) => DocxEditorChildren | null);
  notesContextMenu?:
    | false
    | ((props: DocxEditorNotesContextMenuProps) => DocxEditorChildren | null);
  notePreview?: false | ((props: DocxEditorNotePreviewProps) => DocxEditorChildren | null);
  pageSetup?: false | ((props: DocxEditorPageSetupDialogProps) => DocxEditorChildren | null);
  paragraph?: false | ((props: DocxEditorParagraphDialogProps) => DocxEditorChildren | null);
  textFormField?:
    | false
    | ((props: DocxEditorTextFormFieldDialogProps) => DocxEditorChildren | null);
  hyperlink?: false | ((props: HyperLinkProps) => DocxEditorChildren | null);
  contentControl?: false | ((props: ContentControlProps) => DocxEditorChildren | null);
  equation?: false | ((props: Record<string, never>) => DocxEditorChildren | null);
  contextMenu?: false | ((props: DocxEditorContextMenuProps) => DocxEditorChildren | null);
}
const key: InjectionKey<ComputedRef<DocxEditorPopups | undefined>> = Symbol('docx.popups');
export function usePopupConfig(): ComputedRef<DocxEditorPopups | undefined> {
  return inject(
    key,
    computed(() => undefined)
  );
}
export const PopupConfigProvider = defineComponent({
  name: 'DocxPopupConfigProvider',
  props: { popups: Object as PropType<DocxEditorPopups> },
  setup(props, { slots }) {
    provide(
      key,
      computed(() => props.popups)
    );
    return () => slots.default?.();
  },
});
export const ConfiguredPopups = defineComponent({
  name: 'DocxConfiguredPopups',
  setup() {
    const config = inject(
      key,
      computed(() => undefined)
    );
    const { t } = useTranslation();
    return () => {
      const popups = config.value;
      return [
        popups?.hyperlink ? popups.hyperlink({}) : null,
        popups?.contentControl ? popups.contentControl({}) : null,
        popups?.equation ? popups.equation({}) : null,
        popups?.contextMenu
          ? popups.contextMenu({ t: (key: string) => t(key as Parameters<typeof t>[0]) })
          : null,
      ];
    };
  },
});
/** Keep legacy sugar options working while explicit popup entries take precedence. */
export function createPackagedPopups(
  popups: DocxEditorPopups | undefined,
  hyperlinkPopup: boolean | undefined,
  contextMenu: boolean | DocxEditorContextMenuProps | undefined,
  t: NonNullable<DocxEditorContextMenuProps['t']>
): DocxEditorPopups {
  const explicitContextMenu = popups?.contextMenu;
  return {
    ...popups,
    hyperlink:
      popups?.hyperlink !== undefined
        ? popups.hyperlink
        : hyperlinkPopup === false
          ? false
          : (props) => h(DocxEditorHyperLink, props),
    contentControl:
      popups?.contentControl !== undefined
        ? popups.contentControl
        : (props) => h(DocxEditorContentControl, props),
    equation: popups?.equation !== undefined ? popups.equation : () => h(DocxEditorEquation),
    contextMenu:
      explicitContextMenu !== undefined
        ? explicitContextMenu === false
          ? false
          : (props) => explicitContextMenu({ ...props, t })
        : contextMenu === false
          ? false
          : (props) =>
              h(DocxEditorContextMenu, {
                ...props,
                t,
                ...(typeof contextMenu === 'object' ? contextMenu : {}),
              }),
  };
}
