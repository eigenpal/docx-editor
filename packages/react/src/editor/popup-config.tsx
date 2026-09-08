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
import type { DocxEditorChildren } from '../docx-editor-children';
import type { DocxEditorPageSetupDialogProps } from './DocxEditorPageSetup';
import type { DocxEditorParagraphDialogProps } from './DocxEditorParagraphDialog';
import type { DocxEditorTextFormFieldDialogProps } from './DocxEditorTextFormFieldDialog';
import { DocxEditorHyperLink, type HyperLinkProps } from './DocxEditorHyperLink';
import { DocxEditorContentControl, type ContentControlProps } from './DocxEditorContentControl';
import { DocxEditorEquation } from './DocxEditorEquation';
import { DocxEditorContextMenu, type DocxEditorContextMenuProps } from './contextmenu';

/** Render overrides for automatically mounted editor popups. `false` disables automatic rendering. @public */
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
  notePreview?: false | ((props: DocxEditorNotePreviewProps) => DocxEditorChildren | null);
  notesContextMenu?:
    | false
    | ((props: DocxEditorNotesContextMenuProps) => DocxEditorChildren | null);
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

const Context = createContext<DocxEditorPopups | undefined>(undefined);
export const PopupConfigProvider = Context.Provider;
export const usePopupConfig = () => useContext(Context);

/** Mounts only configured nonmodal surfaces; composed editors retain explicit ownership otherwise. */
export function ConfiguredPopups() {
  const popups = usePopupConfig();
  const { t } = useTranslation();
  return (
    <>
      {popups?.hyperlink && popups.hyperlink({})}
      {popups?.contentControl && popups.contentControl({})}
      {popups?.equation && popups.equation({})}
      {popups?.contextMenu && popups.contextMenu({ t: (key) => t(key as TranslationKey) })}
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
          : (props) => popups.contextMenu && popups.contextMenu({ ...props, t: t ?? props.t })
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
