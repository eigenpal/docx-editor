import type { DocxEditorContentControlWidgetProps } from './DocxEditorContentControlWidget';
import type { DocxEditorInvalidTextFormFieldDialogProps } from './DocxEditorInvalidTextFormFieldDialog';
import type { DocxEditorImagePropertiesDialogProps } from './images/ImageProperties';
import type { DocxEditorImageAltTextPopupProps } from './images/ImageAltText';
import type { DocxEditorNotePropertiesDialogProps } from './DocxEditorNotes';
import type {
  DocxEditorNotePreviewProps,
  DocxEditorNotesContextMenuProps,
} from './note-popup-parts';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';
import { createContext, useContext } from 'react';
import { renderPopup, type DocxEditorPopup } from './popup-renderer';
import type { DocxEditorPageSetupDialogProps } from './DocxEditorPageSetup';
import type { DocxEditorParagraphDialogProps } from './DocxEditorParagraphDialog';
import type { DocxEditorTextFormFieldDialogProps } from './DocxEditorTextFormFieldDialog';
import { DocxEditorHyperLink, type HyperLinkProps } from './DocxEditorHyperLink';
import { DocxEditorContentControl, type ContentControlProps } from './DocxEditorContentControl';
import { DocxEditorEquation } from './DocxEditorEquation';
import { DocxEditorContextMenu, type DocxEditorContextMenuProps } from './contextmenu';

/** Render overrides for automatically mounted editor popups. `false` disables automatic rendering. @public */
export interface DocxEditorPopups {
  contentControlWidget?: DocxEditorPopup<DocxEditorContentControlWidgetProps>;
  invalidTextFormField?: DocxEditorPopup<DocxEditorInvalidTextFormFieldDialogProps>;
  imageProperties?: DocxEditorPopup<DocxEditorImagePropertiesDialogProps>;
  imageAltText?: DocxEditorPopup<DocxEditorImageAltTextPopupProps>;
  noteProperties?: DocxEditorPopup<DocxEditorNotePropertiesDialogProps>;
  notePreview?: DocxEditorPopup<DocxEditorNotePreviewProps>;
  notesContextMenu?: DocxEditorPopup<DocxEditorNotesContextMenuProps>;
  pageSetup?: DocxEditorPopup<DocxEditorPageSetupDialogProps>;
  paragraph?: DocxEditorPopup<DocxEditorParagraphDialogProps>;
  textFormField?: DocxEditorPopup<DocxEditorTextFormFieldDialogProps>;
  hyperlink?: DocxEditorPopup<HyperLinkProps>;
  contentControl?: DocxEditorPopup<ContentControlProps>;
  equation?: DocxEditorPopup<Record<string, never>>;
  contextMenu?: DocxEditorPopup<DocxEditorContextMenuProps>;
}

const Context = createContext<DocxEditorPopups | undefined>(undefined);
export const PopupConfigProvider = Context.Provider;
export const usePopupConfig = () => useContext(Context);

/** Mounts only configured nonmodal surfaces; composed editors retain explicit ownership otherwise. */
export function ConfiguredPopups() {
  const popups = usePopupConfig();
  const { t } = useTranslation();
  return (
    <>
      {popups?.hyperlink && renderPopup(popups.hyperlink, {})}
      {popups?.contentControl && renderPopup(popups.contentControl, {})}
      {popups?.equation && renderPopup(popups.equation, {})}
      {popups?.contextMenu &&
        renderPopup(popups.contextMenu, { t: (key) => t(key as TranslationKey) })}
    </>
  );
}

/** The packaged editor fills defaults; an explicit popup entry wins over legacy shortcuts. */
export function createPackagedPopups(
  popups: DocxEditorPopups | undefined,
  hyperlinkPopup: boolean | undefined,
  contextMenu: boolean | DocxEditorContextMenuProps | undefined,
  t: DocxEditorContextMenuProps['t']
): DocxEditorPopups {
  return {
    ...popups,
    hyperlink:
      popups?.hyperlink ??
      (hyperlinkPopup === false ? false : (props) => <DocxEditorHyperLink {...props} />),
    contentControl: popups?.contentControl ?? ((props) => <DocxEditorContentControl {...props} />),
    equation: popups?.equation ?? (() => <DocxEditorEquation />),
    contextMenu:
      popups?.contextMenu !== undefined
        ? popups.contextMenu === false
          ? false
          : (props) =>
              popups.contextMenu && renderPopup(popups.contextMenu, { ...props, t: t ?? props.t })
        : contextMenu === false
          ? false
          : (props) => (
              <DocxEditorContextMenu
                {...props}
                t={t ?? props.t}
                {...(typeof contextMenu === 'object' ? contextMenu : {})}
              />
            ),
  };
}
