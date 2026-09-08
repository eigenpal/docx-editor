import { renderPopup, type DocxEditorPopup } from './popup-renderer';
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
  contentControlWidget?: DocxEditorPopup<DocxEditorContentControlWidgetProps>;
  invalidTextFormField?: DocxEditorPopup<DocxEditorInvalidTextFormFieldDialogProps>;
  imageProperties?: DocxEditorPopup<DocxEditorImagePropertiesDialogProps>;
  imageAltText?: DocxEditorPopup<DocxEditorImageAltTextPopupProps>;
  noteProperties?: DocxEditorPopup<DocxEditorNotePropertiesDialogProps>;
  notesContextMenu?: DocxEditorPopup<DocxEditorNotesContextMenuProps>;
  notePreview?: DocxEditorPopup<DocxEditorNotePreviewProps>;
  pageSetup?: DocxEditorPopup<DocxEditorPageSetupDialogProps>;
  paragraph?: DocxEditorPopup<DocxEditorParagraphDialogProps>;
  textFormField?: DocxEditorPopup<DocxEditorTextFormFieldDialogProps>;
  hyperlink?: DocxEditorPopup<HyperLinkProps>;
  contentControl?: DocxEditorPopup<ContentControlProps>;
  equation?: DocxEditorPopup<Record<string, never>>;
  contextMenu?: DocxEditorPopup<DocxEditorContextMenuProps>;
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
        popups?.hyperlink ? renderPopup(popups.hyperlink, {}) : null,
        popups?.contentControl ? renderPopup(popups.contentControl, {}) : null,
        popups?.equation ? renderPopup(popups.equation, {}) : null,
        popups?.contextMenu
          ? renderPopup(popups.contextMenu, {
              t: (key: string) => t(key as Parameters<typeof t>[0]),
            })
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
          : (props) => renderPopup(explicitContextMenu, { ...props, t })
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
