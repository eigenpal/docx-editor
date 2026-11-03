/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { createT, en, type TranslationKey } from '@docx-editor.dev/i18n';
import {
  COMPARE_DOCUMENTS_ACCEPT,
  compareDocumentsErrorKey,
  type CompareDocumentsDialog,
  type CompareDocumentsDialogHost,
} from '@docx-editor.dev/core/editor';

let nextId = 0;

/** The Compare documents dialog: one implementation for every adapter and custom host. */
export function createCompareDocumentsDialog(
  host: CompareDocumentsDialogHost
): CompareDocumentsDialog {
  const doc = host.container.ownerDocument;
  let dialog: HTMLDialogElement | null = null;
  let opener: HTMLElement | null = null;
  const fallback = createT(en);
  const translate = (full: string) => host.translate?.(full) ?? fallback(full as TranslationKey);
  const t = (key: string, values?: Record<string, string>) => {
    const text = translate(`compareDocuments.${key}`);
    return values
      ? text.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match)
      : text;
  };
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const close = () => {
    dialog?.close();
    dialog?.remove();
    dialog = null;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  };
  return {
    open() {
      if (host.signal.aborted) return;
      if (dialog) {
        dialog.focus();
        return;
      }
      opener = doc.activeElement as HTMLElement | null;
      const id = nextId++;
      let busy = false;
      dialog = el('dialog');
      dialog.className = 'docx-compare-documents-dialog';
      dialog.contentEditable = 'false';
      dialog.setAttribute('data-docx-marker', '');
      // Modal controls must not dispatch page editing shortcuts.
      for (const type of ['keydown', 'mousedown', 'beforeinput'])
        dialog.addEventListener(type, (event) => event.stopPropagation());
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        if (!busy || host.cancelable) host.cancel();
      });
      const title = el('h2', t('title'));
      title.id = `docx-compare-documents-title-${id}`;
      dialog.setAttribute('aria-labelledby', title.id);
      const description = el('p', t('description'));
      description.id = `docx-compare-documents-description-${id}`;
      dialog.setAttribute('aria-describedby', description.id);

      const body = el('div');
      body.className = 'docx-compare-documents-body';
      const fileLabel = el('label');
      const file = el('input');
      file.type = 'file';
      file.accept = COMPARE_DOCUMENTS_ACCEPT;
      fileLabel.append(el('span', t('revisedFile')), file);
      const authorLabel = el('label');
      const author = el('input');
      author.type = 'text';
      author.value = host.defaultAuthor;
      author.autocomplete = 'off';
      authorLabel.append(el('span', t('author')), author);
      const formattingLabel = el('label');
      formattingLabel.className = 'docx-compare-documents-check';
      const formatting = el('input');
      formatting.type = 'checkbox';
      formatting.checked = true;
      formattingLabel.append(formatting, doc.createTextNode(t('detectFormatting')));
      body.append(fileLabel, authorLabel, formattingLabel);

      const error = el('p');
      error.className = 'docx-compare-documents-error';
      error.setAttribute('role', 'alert');
      const notice = el('p');
      notice.className = 'docx-compare-documents-notice';
      notice.setAttribute('role', 'status');
      const clearMessages = () => {
        error.textContent = '';
        notice.textContent = '';
        cancel.textContent = t('cancel');
      };
      // Shown while a compare runs: with a value when the compare reports its steps.
      const progress = el('progress');
      progress.className = 'docx-compare-documents-progress';
      progress.max = 1;
      progress.hidden = true;
      progress.setAttribute('aria-label', t('comparing'));
      const footer = el('div');
      footer.className = 'docx-compare-documents-actions';
      const cancel = el('button', t('cancel'));
      cancel.type = 'button';
      cancel.addEventListener('click', () => host.cancel());
      const compare = el('button', t('compare'));
      compare.type = 'button';
      footer.append(cancel, compare);

      const setBusy = (next: boolean) => {
        busy = next;
        for (const control of [file, author, formatting]) control.disabled = next;
        // A background compare can stop; a compare on the main thread cannot.
        cancel.disabled = next && !host.cancelable;
        progress.hidden = !next;
        if (!next) progress.removeAttribute('value');
        compare.disabled = next || !file.files?.length || !host.canApply();
        compare.textContent = t(next ? 'comparing' : 'compare');
        dialog?.setAttribute('aria-busy', String(next));
      };
      file.addEventListener('change', () => {
        clearMessages();
        setBusy(false);
      });
      compare.addEventListener('click', async () => {
        const chosen = file.files?.[0];
        if (!chosen) {
          error.textContent = t('fileRequired');
          return;
        }
        clearMessages();
        setBusy(true);
        let revised: Uint8Array;
        try {
          revised = new Uint8Array(await chosen.arrayBuffer());
        } catch {
          if (!host.signal.aborted) {
            error.textContent = t('readFailed');
            setBusy(false);
          }
          return;
        }
        if (host.signal.aborted) return;
        const outcome = await host.apply(
          {
            revised,
            authorName: author.value,
            detectFormatChanges: formatting.checked,
          },
          { onProgress: (step) => (progress.value = step.fraction) }
        );
        if (host.signal.aborted) return;
        // With no differences the dialog stays open and says so; nothing changed.
        if (outcome.ok) {
          notice.textContent = t('noDifferences');
          // Nothing remains to cancel.
          cancel.textContent = translate('common.close');
        } else error.textContent = translate(compareDocumentsErrorKey(outcome));
        setBusy(false);
      });

      dialog.append(title, description, body, progress, error, notice, footer);
      host.container.append(dialog);
      setBusy(false);
      dialog.showModal();
      file.focus({ preventScroll: true });
    },
    destroy() {
      close();
    },
  };
}
