import {
  DocxEditor,
  DocxEditorPageSetupDialog,
  DocxEditorParagraphDialog,
  DocxEditorTextFormFieldDialog,
  DocxEditorHyperLink,
} from '@docx-editor.dev/react';
import type { DocxEditorPopups } from '@docx-editor.dev/react';
import '../../shared/dialog-customization.css';

const popups: DocxEditorPopups = {
  hyperlink: (props) => (
    <DocxEditorHyperLink {...props}>
      <DocxEditorHyperLink.Edit asChild>
        <button className="brand-dialog-button">Edit link</button>
      </DocxEditorHyperLink.Edit>
      <DocxEditorHyperLink.Apply asChild>
        <button className="brand-dialog-button">Save link</button>
      </DocxEditorHyperLink.Apply>
      <DocxEditorHyperLink.Copy hidden />
    </DocxEditorHyperLink>
  ),
  pageSetup: (props) => (
    <DocxEditorPageSetupDialog {...props}>
      <DocxEditorPageSetupDialog.Apply asChild>
        <button className="brand-dialog-button">Save settings</button>
      </DocxEditorPageSetupDialog.Apply>
    </DocxEditorPageSetupDialog>
  ),
  paragraph: (props) => (
    <DocxEditorParagraphDialog {...props}>
      <DocxEditorParagraphDialog.Apply asChild>
        <button className="brand-dialog-button">Save settings</button>
      </DocxEditorParagraphDialog.Apply>
    </DocxEditorParagraphDialog>
  ),
  textFormField: (props) => (
    <DocxEditorTextFormFieldDialog {...props}>
      <DocxEditorTextFormFieldDialog.Apply asChild>
        <button className="brand-dialog-button">Save settings</button>
      </DocxEditorTextFormFieldDialog.Apply>
    </DocxEditorTextFormFieldDialog>
  ),
};
/** Two independently themed editors using the same custom button. */
export function DialogCustomizationDemo() {
  return (
    <main className="dialog-demo">
      <h1>Customize popups</h1>
      <p>Open File → Page setup or Format → Paragraph. Insert a link to try custom link actions.</p>
      <div className="dialog-demo-editors">
        <DocxEditor document="blank" className="brand-indigo" popups={popups} />
        <DocxEditor document="blank" className="brand-green" popups={popups} />
      </div>
    </main>
  );
}
