// DOM input wiring for the paginated surface (paginated-surface seam).
//
// This module owns how browser input becomes surface calls: the keymap, the `beforeinput`
// dispatch, clipboard handlers, and the composition readback that diffs what an IME wrote
// into the painted DOM. Everything is a factory over the `PaginatedSurface` interface plus
// the little state it cannot own — so React, Vue and a plain page get identical behaviour
// instead of three hand-written keymaps that drift.

import type { TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import type { NavigationCommand } from '@docx-editor.dev/core-contract/layout';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

const NAVIGATION: Record<string, NavigationCommand> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'lineStart',
  End: 'lineEnd',
};

/** Paragraph alignment shortcuts (`w:jc`), matching Word. */
const ALIGNMENT: Record<string, string> = {
  l: 'left',
  e: 'center',
  r: 'right',
  j: 'both',
};

/**
 * Line-spacing shortcuts, in 240ths of a line — Word's Ctrl+1 / Ctrl+5 / Ctrl+2.
 *
 * `w:lineRule="auto"` is what makes these MULTIPLES rather than fixed heights.
 */
const LINE_SPACING: Record<string, string> = {
  '1': '240',
  '5': '360',
  '2': '480',
};

/** Run-property shortcuts, matching Word and every browser editor. */
const FORMATTING: Record<string, { localName: string; attributes?: Record<string, string> }> = {
  b: { localName: 'b' },
  i: { localName: 'i' },
  u: { localName: 'u', attributes: { val: 'single' } },
};

export function createKeyDownHandler(
  surface: PaginatedSurface,
  hooks: {
    /**
     * Ctrl/Cmd+K — Word's Insert Hyperlink. The keymap does not know what a link dialog
     * looks like, so it reports the request and the host's chrome answers it; a host with
     * no hyperlink UI simply does not pass this, and the key falls through to the browser
     * rather than doing something surprising.
     */
    readonly onRequestHyperlink?: () => void;
  } = {}
): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent): void => {
    const accel = event.metaKey || event.ctrlKey;
    const command = NAVIGATION[event.key];
    if (command) {
      let scoped: NavigationCommand = command;
      if (event.key === 'Home' || event.key === 'End') {
        // Ctrl/Cmd+Home and End address the document rather than the line.
        if (accel) scoped = event.key === 'Home' ? 'documentStart' : 'documentEnd';
      } else if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        // Word-wise motion: Alt on macOS, Ctrl elsewhere. Both are accepted rather than
        // sniffing the platform, so a mac keyboard on Linux still behaves.
        (event.altKey || event.ctrlKey)
      ) {
        scoped = event.key === 'ArrowLeft' ? 'wordLeft' : 'wordRight';
      } else if (accel && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        scoped = event.key === 'ArrowUp' ? 'documentStart' : 'documentEnd';
      }
      surface.navigate(scoped, event.shiftKey);
      event.preventDefault();
      return;
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      // A page is a real unit here — every caret stop knows its sheet — so this moves ONE
      // page. Ctrl/Cmd is Word's jump to the document edge.
      surface.navigate(
        accel
          ? event.key === 'PageUp'
            ? 'documentStart'
            : 'documentEnd'
          : event.key === 'PageUp'
            ? 'pageUp'
            : 'pageDown',
        event.shiftKey
      );
      event.preventDefault();
      return;
    }
    if (event.key === 'Backspace') {
      // Ctrl/Alt+Backspace deletes the word before the caret — Word, and every native
      // text field on both platforms.
      if (accel || event.altKey) surface.deleteWordBackward();
      else surface.deleteBackward();
      event.preventDefault();
      return;
    }
    if (event.key === 'Delete') {
      if (accel || event.altKey) surface.deleteWordForward();
      else surface.deleteForward();
      event.preventDefault();
      return;
    }
    if (event.key === 'Tab') {
      // In a LIST, Tab demotes and Shift+Tab promotes — the list level, so the marker
      // changes with it. Outside one, Tab is a tab character and Shift+Tab outdents,
      // which is what Word does.
      if (surface.isListParagraph()) {
        surface.adjustIndent(event.shiftKey ? 'decrease' : 'increase');
      } else if (event.shiftKey) {
        surface.adjustIndent('decrease');
      } else {
        surface.insertTab();
      }
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      // Three different breaks on one key, exactly as Word maps them:
      //   Enter        end the paragraph and start a new one
      //   Shift+Enter  a line break INSIDE the paragraph (`w:br`)
      //   Ctrl+Enter   a hard page break (`w:br w:type="page"`)
      if (accel) surface.insertPageBreak();
      else if (event.shiftKey) surface.insertLineBreak();
      // Enter on an empty list item ends the list rather than making another empty one.
      else if (!surface.exitListOnEmptyItem()) surface.splitParagraph();
      event.preventDefault();
      return;
    }
    if (accel && event.key.toLowerCase() === 'a') {
      surface.selectAll();
      event.preventDefault();
      return;
    }
    if (accel && !event.shiftKey && event.key.toLowerCase() === 'k' && hooks.onRequestHyperlink) {
      // Word's Insert Hyperlink. On an existing link this opens EDIT mode seeded from it,
      // which is the host's job — the keymap only says the user asked.
      hooks.onRequestHyperlink();
      event.preventDefault();
      return;
    }
    if (accel && !event.shiftKey && FORMATTING[event.key.toLowerCase()]) {
      const property = FORMATTING[event.key.toLowerCase()]!;
      surface.toggleRunProperty(property.localName, property.attributes);
      event.preventDefault();
      return;
    }
    if (accel && event.shiftKey && event.key.toLowerCase() === 'm') {
      surface.adjustIndent('decrease');
      event.preventDefault();
      return;
    }
    if (accel && !event.shiftKey && event.key.toLowerCase() === 'm') {
      surface.adjustIndent('increase');
      event.preventDefault();
      return;
    }
    if (accel && !event.shiftKey && ALIGNMENT[event.key.toLowerCase()]) {
      surface.setParagraphProperty('jc', { val: ALIGNMENT[event.key.toLowerCase()]! });
      event.preventDefault();
      return;
    }
    if (accel && !event.shiftKey && LINE_SPACING[event.key]) {
      surface.setParagraphProperty('spacing', {
        line: LINE_SPACING[event.key]!,
        lineRule: 'auto',
      });
      event.preventDefault();
      return;
    }
    // Ctrl+Y is Windows' redo; Ctrl/Cmd+Shift+Z is the mac one. Word accepts both.
    if (accel && event.key.toLowerCase() === 'y') {
      surface.redo();
      event.preventDefault();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      // Undo and redo publish a model change like any other commit, so the scheduler
      // repaints. What the scheduler cannot supply is WHERE the caret belongs: offsets in
      // the reverted tree do not correspond to offsets in the one that replaced it, so the
      // entry's own selection is restored.
      if (event.shiftKey) surface.redo();
      else surface.undo();
      event.preventDefault();
    }
  };
}

/**
 * Clipboard.
 *
 * PLAIN TEXT only, deliberately: writing HTML would invite reading it back, and pasted
 * HTML is attacker-controlled markup that has no business reaching a sink here. Rich
 * paste belongs behind the same bounded parse the file path uses.
 */
export function createClipboardHandlers(
  surface: PaginatedSurface,
  insertPlainText: (text: string) => void
): {
  onCopy: (event: ClipboardEvent) => void;
  onCut: (event: ClipboardEvent) => void;
  onPaste: (event: ClipboardEvent) => void;
} {
  const onCopy = (event: ClipboardEvent): void => {
    const text = surface.selectedText();
    if (!text) return;
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
  };

  const onCut = (event: ClipboardEvent): void => {
    const text = surface.selectedText();
    if (!text) return;
    event.clipboardData?.setData('text/plain', text);
    surface.deleteSelection();
    event.preventDefault();
  };

  const onPaste = (event: ClipboardEvent): void => {
    const text = event.clipboardData?.getData('text/plain');
    event.preventDefault();
    if (!text) return;
    insertPlainText(text);
  };

  return { onCopy, onCut, onPaste };
}

/** Plain text from an input event's data transfer, if it carries any. */
function dataTransferText(event: InputEvent): string | null {
  const data = event.dataTransfer;
  if (!data) return null;
  // `text/plain` ONLY. `text/html` from a drag is markup from anywhere on the machine.
  const text = data.getData('text/plain');
  return text.length > 0 ? text : null;
}

export function createBeforeInputHandler(
  surface: PaginatedSurface,
  hooks: {
    readonly isComposing: () => boolean;
    readonly insertPlainText: (text: string) => void;
  }
): (event: InputEvent) => void {
  return (event: InputEvent): void => {
    // PREVENTED FIRST, dispatched second.
    //
    // The pages are editable, so anything this handler does not recognise is a mutation the
    // browser performs on the painted DOM: Format-menu bold, emacs kill-line, transpose,
    // yank, insert-list, drop. The model never sees it, and worse, every span after it keeps
    // a `data-start` that no longer matches its text — so the NEXT keystroke commits at the
    // wrong offset. An unknown input type must be dropped, never passed through.
    event.preventDefault();

    if (hooks.isComposing()) {
      // The IME owns the DOM until it finishes; reconciliation happens at composition end.
      return;
    }

    if (event.inputType === 'insertText' && event.data != null) {
      surface.type(event.data);
      return;
    }
    if (event.inputType === 'insertFromPaste') {
      // The paste handler already ran and did the work.
      return;
    }
    if (event.inputType === 'insertReplacementText') {
      // Autocorrect, dictation and smart substitutions arrive this way — NOT from a paste.
      // The replacement text is on the event; applying it is how a correction survives
      // instead of being silently dropped.
      const replacement = event.data ?? dataTransferText(event);
      if (replacement) surface.type(replacement);
      return;
    }
    if (event.inputType === 'deleteContentBackward') {
      surface.deleteBackward();
      return;
    }
    if (event.inputType === 'deleteWordBackward') {
      surface.deleteWordBackward();
      return;
    }
    if (event.inputType === 'deleteContentForward') {
      surface.deleteForward();
      return;
    }
    if (event.inputType === 'deleteWordForward') {
      surface.deleteWordForward();
      return;
    }
    if (event.inputType === 'insertLineBreak') {
      surface.insertLineBreak();
      return;
    }
    if (event.inputType === 'insertFromDrop' || event.inputType === 'insertFromPasteAsQuotation') {
      // Plain text only, like paste: dropped content carries `text/html` from anywhere on the
      // machine, and parsing it here would be exactly the HTML-from-a-string sink the file
      // path is bounded to avoid.
      const dropped = dataTransferText(event);
      if (dropped) hooks.insertPlainText(dropped);
      return;
    }
    if (event.inputType === 'insertParagraph') {
      surface.splitParagraph();
    }
  };
}

/** The text the browser currently shows for a paragraph, across all its painted lines. */
export function paintedTextOf(pagesLayer: HTMLElement, paragraphId: string): string | null {
  const spans = pagesLayer.querySelectorAll('[data-paragraph-id][data-start]');
  const pieces: { start: number; text: string }[] = [];
  for (const span of spans) {
    const element = span as HTMLElement;
    if (element.dataset.paragraphId !== paragraphId) continue;
    const start = Number(element.dataset.start);
    if (!Number.isInteger(start)) continue;
    pieces.push({ start, text: element.textContent ?? '' });
  }
  if (pieces.length === 0) return null;
  pieces.sort((a, b) => a.start - b.start);
  return pieces.map((piece) => piece.text).join('');
}

/**
 * The ops that bring a paragraph's model text to what the browser shows, or null when
 * nothing differs.
 *
 * Deliberately narrow: one paragraph, expressed as a single replace of the differing
 * middle. Anything wider would be guessing at what changed. `caret` is where the caret
 * belongs after the replace — at the end of the inserted text.
 */
export function paragraphReplacePlan(
  paragraphId: string,
  modelText: string,
  painted: string
): { ops: Parameters<TreeDocxSession['applyTreeOps']>[0][number][]; caret: number } | null {
  if (painted === modelText) return null;

  let prefix = 0;
  while (
    prefix < painted.length &&
    prefix < modelText.length &&
    painted[prefix] === modelText[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < painted.length - prefix &&
    suffix < modelText.length - prefix &&
    painted[painted.length - 1 - suffix] === modelText[modelText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const inserted = painted.slice(prefix, painted.length - suffix);
  const ops: Parameters<TreeDocxSession['applyTreeOps']>[0][number][] = [];
  if (modelText.length - suffix > prefix) {
    ops.push({ op: 'deleteText', paragraphId, start: prefix, end: modelText.length - suffix });
  }
  if (inserted.length > 0) {
    ops.push({ op: 'insertText', paragraphId, offset: prefix, text: inserted });
  }
  if (ops.length === 0) return null;
  return { ops, caret: prefix + inserted.length };
}
