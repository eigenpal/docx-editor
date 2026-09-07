import { TEXT_FORM_FORMATS } from '../store/store/text-form-field-options.ts';
import { createT, en } from '@docx-editor.dev/i18n';
import {
  type TextFormFieldOptions,
  type TextFormFieldType,
  type TextFormFieldRange,
} from '@docx-editor.dev/core/store';

/** The same accessible options dialog is mounted by every adapter. */
export function textFormFieldDialog(
  container: HTMLElement,
  field: TextFormFieldRange,
  save: (text: string, options: TextFormFieldOptions) => boolean,
  close: () => void
): HTMLDialogElement {
  const t = createT(en);
  const document = container.ownerDocument;
  const panel = document.createElement('dialog');
  panel.className = 'docx-text-form-dialog';
  panel.setAttribute('aria-label', t('textFormField.title'));
  const heading = document.createElement('h2');
  heading.textContent = t('textFormField.title');
  panel.append(heading);
  const label = (key: Parameters<typeof t>[0], control: HTMLElement): void => {
    const element = document.createElement('label');
    element.textContent = t(key);
    element.append(control);
    panel.append(element);
  };
  const input = document.createElement('input');
  input.type = 'text';
  input.value = field.defaultText;
  label('textFormField.defaultText', input);
  const type = document.createElement('select');
  const types = ['regular', 'number', 'date'] as const;
  for (const value of types) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = t(`textFormField.${value}`);
    type.append(option);
  }
  if (!types.includes(field.type as TextFormFieldType)) {
    const option = document.createElement('option');
    option.value = field.type;
    option.textContent = t('textFormField.preservedType');
    option.disabled = true;
    type.append(option);
  }
  type.value = field.type;
  label('textFormField.type', type);
  const max = document.createElement('input');
  max.type = 'number';
  max.min = '0';
  max.max = '32767';
  max.step = '1';
  max.value = String(field.maxLength);
  label('textFormField.maxLength', max);
  const format = document.createElement('select');
  const populateFormats = (selected: string): void => {
    format.replaceChildren();
    const values: readonly string[] = TEXT_FORM_FORMATS[type.value as TextFormFieldType] ?? [];
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      const regularLabels = {
        Uppercase: 'textFormField.uppercase',
        Lowercase: 'textFormField.lowercase',
        'First capital': 'textFormField.firstCapital',
        'Title case': 'textFormField.titleCase',
      } as const;
      const key = regularLabels[value as keyof typeof regularLabels];
      option.textContent = key ? t(key) : value || t('textFormField.noFormat');
      format.append(option);
    }
    if (!values.includes(selected)) {
      const option = document.createElement('option');
      option.value = selected;
      option.textContent = selected || t('textFormField.noFormat');
      option.disabled = true;
      format.append(option);
    }
    format.value = selected;
  };
  populateFormats(field.format);
  type.addEventListener('change', () => populateFormats(''));
  label('textFormField.format', format);
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = field.enabled;
  label('textFormField.enabled', enabled);
  const error = document.createElement('p');
  error.setAttribute('role', 'alert');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = t('textFormField.cancel');
  cancel.addEventListener('click', close);
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.textContent = t('textFormField.apply');
  const submit = (): void => {
    if (
      !max.value ||
      !max.checkValidity() ||
      !save(input.value, {
        type: type.value as TextFormFieldType,
        maxLength: Number(max.value),
        format: format.value,
        enabled: enabled.checked,
      })
    ) {
      error.textContent = t('textFormField.invalidOptions');
      return;
    }
    close();
  };
  apply.addEventListener('click', submit);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      submit();
    }
  });
  panel.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  panel.append(error, cancel, apply);
  container.append(panel);
  panel.showModal();
  input.focus();
  input.select();
  return panel;
}
