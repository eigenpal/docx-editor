import { createT, en } from '@docx-editor.dev/i18n';

/** Shared invalid-fill acknowledgement. The caller owns removal and selection restoration. */
export function textFormFieldInvalidDialog(
  container: HTMLElement,
  type: 'number' | 'date',
  acknowledge: () => void,
  translate?: ReturnType<typeof createT>
): HTMLDialogElement {
  const t = translate ?? createT(en);
  const document = container.ownerDocument;
  const panel = document.createElement('dialog');
  panel.className = 'docx-text-form-dialog';
  panel.setAttribute('role', 'alertdialog');
  panel.setAttribute('aria-label', t('textFormField.invalidTitle'));
  panel.setAttribute(
    'aria-description',
    t(`textFormField.invalid${type === 'number' ? 'Number' : 'Date'}`)
  );
  const heading = document.createElement('h2');
  heading.className = 'docx-text-form-dialog__header';
  heading.textContent = t('textFormField.invalidTitle');
  const body = document.createElement('div');
  body.className = 'docx-text-form-dialog__body';
  body.textContent = t(`textFormField.invalid${type === 'number' ? 'Number' : 'Date'}`);
  const footer = document.createElement('div');
  footer.className = 'docx-text-form-dialog__footer';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'docx-text-form-dialog__button docx-text-form-dialog__button--primary';
  ok.textContent = t('textFormField.apply');
  let acknowledged = false;
  const accept = (): void => {
    if (acknowledged) return;
    acknowledged = true;
    acknowledge();
  };
  ok.addEventListener('click', accept);
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    accept();
  });
  panel.addEventListener('cancel', (event) => {
    event.preventDefault();
    accept();
  });
  footer.append(ok);
  panel.append(heading, body, footer);
  container.append(panel);
  panel.showModal();
  ok.focus();
  return panel;
}
