/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
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
      // Focus lands here when no control can take it, such as during a compare on the main
      // thread, so it never falls back to the page.
      dialog.tabIndex = -1;
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
      // The open document's tracked changes count as accepted: said before the user compares.
      const tracked = el('p', t('trackedChangesAccepted'));
      tracked.id = `docx-compare-documents-tracked-${id}`;
      tracked.className = 'docx-compare-documents-tracked';
      if (host.originalHasTrackedChanges)
        dialog.setAttribute('aria-describedby', `${description.id} ${tracked.id}`);

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
      // Shown while a compare runs: indeterminate until the compare reports its first step.
      const progress = el('progress');
      progress.className = 'docx-compare-documents-progress';
      progress.max = 1;
      progress.hidden = true;
      progress.setAttribute('aria-label', t('comparing'));
      // The step in words, next to the bar. It holds focus while nothing else can.
      const phase = el('span');
      phase.className = 'docx-compare-documents-phase';
      phase.tabIndex = -1;
      phase.hidden = true;
      const showPhase = (text: string) => {
        phase.textContent = text;
        progress.setAttribute('aria-valuetext', text);
      };
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
        phase.hidden = !next;
        if (next) showPhase(t('comparing'));
        else {
          progress.removeAttribute('value');
          progress.removeAttribute('aria-valuetext');
          phase.textContent = '';
        }
        compare.disabled = next || !file.files?.length || !host.canApply();
        compare.textContent = t(next ? 'comparing' : 'compare');
        // The bar is the busy region; the dialog gets a styling hook only, because aria-busy
        // on the whole modal would hold back its live regions.
        progress.setAttribute('aria-busy', String(next));
        dialog?.toggleAttribute('data-docx-busy', next);
        // Compare disabled itself: keep focus in the dialog, on a control that still works.
        if (next) (cancel.disabled ? phase : cancel).focus({ preventScroll: true });
      };
      /** After a compare that left the dialog open: the next useful control takes focus. */
      const focusAfter = (refused: boolean) => {
        const target = !refused && !compare.disabled ? compare : file;
        (target.disabled ? (dialog ?? file) : target).focus({ preventScroll: true });
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
            focusAfter(true);
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
          {
            onProgress: (step) => {
              progress.value = step.fraction;
              showPhase(t(`phases.${step.phase}`));
            },
          }
        );
        if (host.signal.aborted) return;
        // With no differences the dialog stays open and says so; nothing changed.
        if (outcome.ok) {
          notice.textContent = t('noDifferences');
          // Nothing remains to cancel.
          cancel.textContent = translate('common.close');
        } else error.textContent = translate(compareDocumentsErrorKey(outcome));
        setBusy(false);
        focusAfter(!outcome.ok);
      });

      dialog.append(title, description);
      if (host.originalHasTrackedChanges) dialog.append(tracked);
      dialog.append(body, progress, phase, error, notice, footer);
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
