/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { createRevisionColorPicker } from './revision-markup-colors';
import { createT, en, type TranslationKey } from '@docx-editor.dev/i18n';
import {
  DEFAULT_REVISION_MARKUP,
  REVISION_MARKUP_COLORS,
  resolveRevisionMarkup,
  type RevisionMarkupDialogHost,
  type RevisionMarkupDialog,
  type RevisionMarkupOptions,
  type ResolvedRevisionMarkup,
} from '@docx-editor.dev/core/editor';

const marks = [
  'none',
  'colorOnly',
  'bold',
  'italic',
  'underline',
  'doubleUnderline',
  'strikethrough',
  'doubleStrikethrough',
];
const deletionMarks = [...marks, 'hidden', 'caret', 'pound'];
let nextId = 0;

/** One dialog implementation serves all adapters and custom hosts. */
export function createRevisionMarkupDialog(host: RevisionMarkupDialogHost): RevisionMarkupDialog {
  const doc = host.container.ownerDocument;
  let dialog: HTMLDialogElement | null = null;
  let draft: ResolvedRevisionMarkup = host.get();
  let opener: HTMLElement | null = null;
  const controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const colors = new Map<string, ReturnType<typeof createRevisionColorPicker>>();
  let preview: HTMLElement | null = null;
  const fallback = createT(en);
  const t = (key: string) =>
    host.translate?.(`revisionMarkup.${key}`) ??
    fallback(`revisionMarkup.${key}` as TranslationKey);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const close = () => {
    dialog?.close();
    dialog?.remove();
    dialog = null;
    controls.clear();
    colors.clear();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  };
  const refresh = () => {
    for (const [path, control] of controls) {
      const [key, field] = path.split('.');
      const value = draft[key as keyof ResolvedRevisionMarkup];
      if (control.tagName === 'INPUT') (control as HTMLInputElement).checked = value as boolean;
      else control.value = (value as unknown as Record<string, string>)[field!];
      control.disabled = (key === 'movedFrom' || key === 'movedTo') && !draft.trackMoves;
    }
    for (const [path, picker] of colors) {
      const [key, field] = path.split('.');
      const value = draft[key as keyof ResolvedRevisionMarkup] as unknown as Record<string, string>;
      picker.update(
        value[field!]!,
        (key === 'movedFrom' || key === 'movedTo') && !draft.trackMoves
      );
    }
    if (preview) {
      preview.dataset.position = draft.changedLines.mark;
      const color = draft.changedLines.color;
      preview.style.setProperty(
        '--doc-revision-preview-color',
        color === 'auto'
          ? 'currentColor'
          : color === 'byAuthor'
            ? 'var(--doc-review-author-0)'
            : `var(--doc-revision-color-${color})`
      );
      preview.setAttribute(
        'aria-label',
        `${t('preview')}: ${t(`values.${draft.changedLines.mark}`)}`
      );
    }
  };
  const update = (patch: RevisionMarkupOptions) => {
    draft = resolveRevisionMarkup(patch, draft);
    refresh();
  };
  const unsubscribe = host.subscribe(() => {
    draft = host.get();
    refresh();
  });
  const select = (
    section: HTMLElement,
    key: string,
    field: string,
    values: readonly string[],
    value: string
  ) => {
    if (field === 'color' || key === 'cells') {
      const label = t(key === 'cells' ? `${field}Cells` : `${key}Color`);
      const picker = createRevisionColorPicker(doc, {
        id: `docx-revision-color-${nextId++}`,
        label,
        colors: values,
        translate: (color) => t(`values.${color}`),
        change: (color) => update({ [key]: { [field]: color } }),
      });
      colors.set(`${key}.${field}`, picker);
      section.append(picker.element);
      return picker.element;
    }
    const label = el('label');
    const fieldLabel = el('span', t(key));
    fieldLabel.className = 'docx-revision-markup-field-label';
    label.append(fieldLabel);
    const control = el('select');
    for (const id of values) {
      const option = el('option', t(`values.${id}`));
      option.value = id;
      control.append(option);
    }
    control.value = value;
    control.addEventListener('change', () => update({ [key]: { [field]: control.value } }));
    label.append(control);
    section.append(label);
    controls.set(`${key}.${field}`, control);
    return label;
  };
  const style = (
    section: HTMLElement,
    key: 'insertions' | 'deletions' | 'changedLines' | 'movedFrom' | 'movedTo' | 'formatting',
    values: readonly string[]
  ) => {
    const row = el('div');
    row.className = 'docx-revision-markup-row';
    const rowTitle = el('span', t(key));
    rowTitle.className = 'docx-revision-markup-row-title';
    rowTitle.setAttribute('aria-hidden', 'true');
    row.append(rowTitle);
    select(row, key, 'mark', values, draft[key].mark);
    select(row, key, 'color', ['byAuthor', 'auto', ...REVISION_MARKUP_COLORS], draft[key].color);
    section.append(row);
  };
  const checkbox = (section: HTMLElement, key: 'trackMoves' | 'trackFormatting') => {
    const label = el('label');
    const control = el('input');
    control.type = 'checkbox';
    control.checked = draft[key];
    control.addEventListener('change', () => update({ [key]: control.checked }));
    const note = el('p', t(`${key}Note`));
    note.id = `docx-revision-markup-note-${nextId++}`;
    control.setAttribute('aria-describedby', note.id);
    label.append(control, doc.createTextNode(t(key)));
    section.append(label, note);
    controls.set(key, control);
  };
  return {
    open() {
      if (dialog) {
        dialog.focus();
        return;
      }
      draft = host.get();
      opener = doc.activeElement as HTMLElement | null;
      dialog = el('dialog');
      dialog.className = 'docx-revision-markup-dialog';
      dialog.contentEditable = 'false';
      dialog.setAttribute('data-docx-marker', '');
      // Modal controls must not dispatch page editing shortcuts.
      for (const type of ['keydown', 'mousedown', 'beforeinput'])
        dialog.addEventListener(type, (event) => event.stopPropagation());
      const title = el('h2', t('title'));
      title.id = `docx-revision-markup-title-${nextId++}`;
      dialog.setAttribute('aria-labelledby', title.id);
      dialog.append(title);
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        close();
      });
      const body = el('div');
      body.className = 'docx-revision-markup-body';
      dialog.append(body);
      const section = (name: string) => {
        const fieldset = el('fieldset');
        fieldset.className = `docx-revision-markup-${name}`;
        fieldset.append(el('legend', t(name)));
        body.append(fieldset);
        return fieldset;
      };
      const markup = section('markup');
      style(markup, 'insertions', marks);
      style(markup, 'deletions', deletionMarks);
      style(markup, 'changedLines', ['none', 'leftBorder', 'rightBorder', 'outsideBorder']);
      preview = el('div');
      preview.className = 'docx-revision-markup-preview';
      preview.setAttribute('role', 'img');
      for (let page = 0; page < 2; page++) {
        const sheet = el('span');
        for (let line = 0; line < 3; line++) sheet.append(el('i'));
        preview.append(sheet);
      }
      markup.append(preview);
      const moves = section('moves');
      checkbox(moves, 'trackMoves');
      style(moves, 'movedFrom', deletionMarks);
      style(moves, 'movedTo', marks);
      const cells = section('tableCells');
      for (const key of ['inserted', 'deleted', 'merged', 'split'] as const) {
        select(cells, 'cells', key, ['none', ...REVISION_MARKUP_COLORS], draft.cells[key]);
      }
      const formatting = section('formatting');
      checkbox(formatting, 'trackFormatting');
      style(formatting, 'formatting', marks);
      const footer = el('div');
      footer.className = 'docx-revision-markup-actions';
      const button = (key: string, action: () => void) => {
        const node = el('button', t(key));
        node.type = 'button';
        node.addEventListener('click', action);
        footer.append(node);
      };
      button('reset', () => {
        draft = DEFAULT_REVISION_MARKUP;
        refresh();
      });
      button('cancel', close);
      button('ok', () => {
        host.set(draft);
        close();
      });
      dialog.append(footer);
      host.container.append(dialog);
      refresh();
      dialog.showModal();
      dialog.querySelector<HTMLSelectElement>('select')?.focus({ preventScroll: true });
    },
    destroy() {
      unsubscribe();
      close();
    },
  };
}
