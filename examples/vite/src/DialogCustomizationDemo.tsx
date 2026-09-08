import {
  DocxEditor,
  DocxEditorPageSetupDialog,
  DocxEditorParagraphDialog,
  DocxEditorTextFormFieldDialog,
} from '@docx-editor.dev/react';
import type { DocxEditorDialogs } from '@docx-editor.dev/react';
import '../../shared/dialog-customization.css';

const dialogs: DocxEditorDialogs = {
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
      <h1>Customize dialogs</h1>
      <p>Open File → Page setup or Format → Paragraph in either editor.</p>
      <div className="dialog-demo-editors">
        <DocxEditor document="blank" className="brand-indigo" dialogs={dialogs} />
        <DocxEditor document="blank" className="brand-green" dialogs={dialogs} />
      </div>
    </main>
  );
}
