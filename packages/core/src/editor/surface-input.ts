// DOM input wiring for the paginated surface (paginated-surface seam).
//
// This module owns how browser input becomes surface calls: the keymap, the `beforeinput`
// dispatch, clipboard handlers, and the composition readback that diffs what an IME wrote
// into the painted DOM. Everything is a factory over the `PaginatedSurface` interface plus
// the little state it cannot own — so React, Vue and a plain page get identical behaviour
// instead of three hand-written keymaps that drift.

import type { TreeDocxSession } from '@docx-editor.dev/core/binding';
import type { NavigationCommand, SemanticSelection } from '@docx-editor.dev/core/layout';
import type { StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { plainTextFromTransfer } from './clipboard-plain-text.ts';

type SelectionMark = { paragraphId: string; start: number; end: number };
type TreeApplyResult = ReturnType<TreeDocxSession['applyTreeOps']>;

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
    // FAIL SOFT on a chord someone else already claimed.
    //
    // This keymap is wired to the painted pages, which sit inside the host's own chrome, and
    // hosts bind accelerators of their own — React's live zoom takes Ctrl/Cmd+`=`/`-`/`0` in
    // the CAPTURE phase, and Word's subscript/superscript is bound to the same `=` chord
    // below. Both firing made one keystroke zoom AND rewrite the selection's run properties.
    // A prevented event has an owner, so there is nothing left here to do.
    if (event.defaultPrevented) return;
    if (event.key === 'Escape' && surface.activeScope().kind === 'headerFooter') {
      surface.exitHeaderFooter();
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && surface.activeScope().kind === 'note') {
      surface.exitNote();
      event.preventDefault();
      return;
    }
    // Word: Ctrl/Cmd+Alt+F footnote, Ctrl/Cmd+Alt+D endnote.
    if ((event.ctrlKey || event.metaKey) && event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      if (key === 'f') {
        event.preventDefault();
        surface.insertNote('footnote');
        return;
      }
      if (key === 'd') {
        event.preventDefault();
        surface.insertNote('endnote');
        return;
      }
    }
    const accel = event.metaKey || event.ctrlKey;
    // Engine-driven navigation owns caret motion in body AND open furniture. Furniture
    // stops come from story-scoped layout geometry (tab advances, projected fields), so
    // the browser never walks a painted `\t` width as if it were model offsets.
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
      } else if (event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        // Cmd+Arrow is the LINE gesture on macOS, where most keyboards carry no Home/End
        // key — binding line motion to those alone left it unreachable, and this branch
        // fell through to character motion that then preventDefault'd the native one.
        // Keyed on Cmd specifically, not on `accel`: Ctrl+Arrow is word motion above.
        scoped = event.key === 'ArrowLeft' ? 'lineStart' : 'lineEnd';
      } else if (accel && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        scoped = event.key === 'ArrowUp' ? 'documentStart' : 'documentEnd';
      }
      surface.navigate(scoped, event.shiftKey);
      event.preventDefault();
      return;
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      // A page is a real unit here — every caret stop knows its sheet — so this moves ONE
      // page. Ctrl/Cmd is Word's jump to the document edge. Open furniture stays within the
      // story stops (single-sheet furniture → document edge of that story).
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
      // Form-fill mode: Tab / Shift+Tab move between editable content controls (tabIndex,
      // then document order), skipping locked / bound ones. Explicit mode only — ordinary
      // Tab keeps list indent / tab-character behaviour, including inside table cells.
      if (surface.contentControls.formFill()) {
        if (surface.contentControls.navigate(event.shiftKey ? 'previous' : 'next')) {
          event.preventDefault();
          return;
        }
      }
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
    // Word's Ctrl+= / Ctrl+Shift+=, kept for hosts that leave the chord to this keymap.
    //
    // The two controls' tooltips no longer advertise it: React's live zoom claims the same
    // chord in the capture phase (the `defaultPrevented` return at the top of this handler),
    // so the chrome registry names subscript and superscript plainly rather than promising a
    // keystroke that zooms there. The binding stays because it is still the only way to reach
    // these toggles from the keyboard in a host with no zoom handler.
    //
    // WHICH of the two is decided by Shift alone, never by the character: `event.key` is
    // the PRODUCED character, so shifting `=` reports `+` on a US layout, and reading the
    // character to choose sent Ctrl+`+` to superscript on the layouts where `+` is
    // unshifted (German) — the opposite of what was pressed. `event.code` is matched as
    // well so the US pair keeps working whatever the key happens to produce.
    if (accel && (event.key === '=' || event.key === '+' || event.code === 'Equal')) {
      surface.toggleRunProperty('vertAlign', {
        val: event.shiftKey ? 'superscript' : 'subscript',
      });
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
      // Cmd+R is the browser's reload and the browser RESERVES it — preventDefault does
      // not cancel the reload, so claiming the chord would right-align and then lose the
      // page anyway. Right alignment stays on Ctrl+R, which pages may claim and which is
      // an unused chord on macOS.
      if (event.metaKey && event.key.toLowerCase() === 'r') return;
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
 *
 * A payload carrying ONLY `text/html` is still pasted, for its text — see
 * clipboard-plain-text.ts. That is a fallback for applications that omit the plain
 * flavour, not a rich lane: no structure, no markup, no DOM built from the payload.
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
    const text = plainTextFromTransfer(event.clipboardData);
    event.preventDefault();
    if (!text) return;
    insertPlainText(text);
  };

  return { onCopy, onCut, onPaste };
}

/** Plain text from an input event's data transfer, if it carries any. */
function dataTransferText(event: InputEvent): string | null {
  // TEXT ONLY, never structure. A drag carries markup from anywhere on the machine, so
  // the HTML flavour is read for the text inside it and nothing else — see
  // clipboard-plain-text.ts. Dropping a payload that omits `text/plain` outright is what
  // made a drop from those applications look like a dead gesture.
  const text = plainTextFromTransfer(event.dataTransfer);
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

/**
 * The text the browser currently shows for a paragraph, IN THE MODEL'S OWN OFFSET SPACE.
 *
 * Not simply the concatenated `textContent`. A span's painted text is not always as long as
 * the range it stands for: a field occupies ONE model offset and paints its whole cached
 * result, so "Scope of the discussions" is 24 glyphs over a range of 1. Joining the painted
 * text made this readback see 23 characters that the model does not have, and the diff below
 * then explained the difference the only way it could — by deleting the field and inserting
 * its own rendering as literal text. One IME composition anywhere in the paragraph destroyed
 * the field permanently and silently.
 *
 * So a PROJECTED span — one layout owns the glyphs of, marked `data-docx-field` and painted
 * `contenteditable="false"` — contributes the MODEL's characters for its range instead. The
 * browser cannot write inside one, so whatever the model has there is still correct, and the
 * diff is left to describe only what actually changed.
 *
 * Keyed on that marker rather than on the lengths disagreeing, which is the tempting shortcut
 * and the wrong one: a browser edit is ALSO a length disagreement, so inferring it that way
 * would swallow the very keystrokes this exists to recover.
 *
 * `modelText` is the paragraph's current model text, which the caller already holds.
 */
export function paintedTextOf(
  pagesLayer: HTMLElement,
  paragraphId: string,
  modelText: string
): string | null {
  const spans = pagesLayer.querySelectorAll('[data-paragraph-id][data-start]');
  const pieces: { start: number; text: string }[] = [];
  /** Model ranges already contributed by a projected span, keyed by start. */
  const projectedRanges = new Set<number>();
  for (const span of spans) {
    const element = span as HTMLElement;
    if (element.dataset.paragraphId !== paragraphId) continue;
    const start = Number(element.dataset.start);
    if (!Number.isInteger(start)) continue;
    if (element.dataset.docxField !== undefined) {
      // ONCE per range, not once per span. Line breaking splits a field's result at its
      // spaces and every resulting span republishes the SAME model range, so emitting the
      // slice per span repeated the field's model characters — a four-word result read back
      // as four `￼` where the model has one, and the diff then inserted the extras as
      // literal object-replacement characters.
      if (projectedRanges.has(start)) continue;
      projectedRanges.add(start);
      const rawEnd = element.dataset.end;
      const end =
        rawEnd !== undefined && /^\d{1,9}$/.test(rawEnd) && Number(rawEnd) >= start
          ? Number(rawEnd)
          : start;
      pieces.push({ start, text: modelText.slice(start, end) });
      continue;
    }
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

/**
 * Plain-text insert used by clipboard paste and beforeinput insertText: one
 * commit that inserts joined lines then splits at every newline boundary.
 */
export function createInsertPlainText(deps: {
  orderedStart: () => { paragraphId: string; offset: number };
  deleteSelectionOps: () => readonly TreeDocOp[];
  selectionMark: () => SelectionMark | null;
  storyScope: () => StoryScope;
  session: TreeDocxSession;
  commit: (
    run: () => TreeApplyResult | boolean,
    selectionAfter?: () => SemanticSelection | null
  ) => void;
  applyOps: (ops: readonly TreeDocOp[], mark: SelectionMark | null) => TreeApplyResult;
  collapsedAt: (pos: { paragraphId: string; offset: number }) => SemanticSelection;
}): (text: string) => void {
  return (text: string): void => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const start = deps.orderedStart();
    const joined = lines.join('');
    const ops: TreeDocOp[] = [...deps.deleteSelectionOps()];
    if (joined.length > 0) {
      ops.push({
        op: 'insertText',
        paragraphId: start.paragraphId,
        offset: start.offset,
        text: joined,
      });
    }
    const boundaries: number[] = [];
    let consumed = 0;
    for (let index = 0; index < lines.length - 1; index += 1) {
      consumed += lines[index]!.length;
      boundaries.push(start.offset + consumed);
    }
    if (boundaries.length > 0) {
      ops.push({ op: 'splitParagraphMany', paragraphId: start.paragraphId, offsets: boundaries });
    }
    if (ops.length === 0) return;

    const before = new Set(deps.session.paragraphIdsIn(deps.storyScope()));
    const lastLine = lines[lines.length - 1]!;
    deps.commit(
      () => deps.applyOps(ops, deps.selectionMark()),
      () => {
        if (boundaries.length === 0) {
          return deps.collapsedAt({
            paragraphId: start.paragraphId,
            offset: start.offset + lastLine.length,
          });
        }
        const minted = deps.session
          .paragraphIdsIn(deps.storyScope())
          .filter((id) => !before.has(id));
        const landing = minted[minted.length - 1];
        return landing ? deps.collapsedAt({ paragraphId: landing, offset: lastLine.length }) : null;
      }
    );
  };
}
