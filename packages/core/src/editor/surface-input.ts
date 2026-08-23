// DOM input wiring for the paginated surface (paginated-surface seam).
//
// This module owns how browser input becomes surface calls: the keymap, the `beforeinput`
// dispatch, clipboard handlers, and the composition readback that diffs what an IME wrote
// into the painted DOM. Everything is a factory over the `PaginatedSurface` interface plus
// the little state it cannot own — so React, Vue and a plain page get identical behaviour
// instead of three hand-written keymaps that drift.

import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { NavigationCommand, SemanticSelection } from '@docx-editor.dev/core/layout';
import type { StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { plainTextFromTransfer } from './clipboard-plain-text.ts';
import { paragraphElements, spanSearchRoots } from './dom-selection.ts';

type SelectionMark = { paragraphId: string; start: number; end: number };
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
      // Merged, like the toolbar's `setLineSpacing`: `w:spacing` carries the line rule AND
      // the space before and after, so a replacing write made Ctrl+2 delete the paragraph's
      // paragraph spacing on its way to double-spacing it.
      surface.setParagraphProperty(
        'spacing',
        { line: LINE_SPACING[event.key]!, lineRule: 'auto' },
        { mergeAttributes: true }
      );
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
      // Queued, not committed: a keystroke burst aggregates into one transaction
      // and one layout flush instead of paying a full flush per character. Every
      // other input type below still commits synchronously, and each of those
      // paths flushes the queue first.
      surface.enqueueType(event.data);
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

/** One contribution to the readback, addressed by the model offset it starts at. */
interface PaintedPiece {
  readonly start: number;
  readonly text: string;
}

/** State threaded through the walk below, so a stray text node knows where it landed. */
interface ReadbackWalk {
  readonly paragraphId: string;
  readonly modelText: string;
  readonly pieces: PaintedPiece[];
  /** Model ranges already contributed by a projected span, keyed by start. */
  readonly projectedRanges: Set<number>;
  /** The model offset just past the last span walked, which is where a stray text sits. */
  end: number;
}

/**
 * Furniture painted INSIDE a paragraph, which is never model text.
 *
 * A list marker's bullet, a tab leader's dots, the revision pilcrow, the inline-drawing and
 * float-wrap advance spacers, and a zero-width `w:ptab`'s painted `\t` all carry glyphs the
 * model does not have. Every one of them is a `data-docx-marker`, a `data-docx-tab-leader`
 * or `aria-hidden` — the same exclusion class the selection reader uses — so the walk skips
 * the subtree rather than naming each shape.
 */
const PAINTED_FURNITURE = '[data-docx-marker],[data-docx-tab-leader],[aria-hidden="true"]';

/** A `data-end` is only believed when it is a plausible model end for its own start. */
function modelEndOf(element: HTMLElement, start: number, fallback: number): number {
  const rawEnd = element.dataset.end;
  if (rawEnd === undefined || !/^\d{1,9}$/.test(rawEnd)) return fallback;
  const end = Number(rawEnd);
  return end >= start ? end : fallback;
}

/**
 * Walk one painted container in DOM order, collecting what the browser now shows.
 *
 * DOM order is what places text the IME wrote OUTSIDE any span. An empty paragraph paints a
 * line holding nothing but a `<br>`, and a paragraph whose only content is a field paints
 * spans the caret is refused inside — so in both cases the browser is handed the LINE as the
 * selection node and composes a bare text node into it. Reading only `[data-start]` spans
 * saw nothing there, the diff had nothing to explain, and the composed text was dropped:
 * Chinese could not be typed at the start of an empty paragraph at all (#190). A stray text
 * node contributes at the model offset the walk has reached, so it lands before or after the
 * spans exactly as the browser placed it.
 */
function collectPaintedPieces(container: Element, walk: ReadbackWalk): void {
  for (const node of container.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.length > 0) walk.pieces.push({ start: walk.end, text });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as HTMLElement;
    if (element.matches?.(PAINTED_FURNITURE)) continue;
    const rawStart = element.dataset?.start;
    if (rawStart === undefined) {
      // A line, a hyperlink anchor, a decoration wrapper: not a span, so descend.
      collectPaintedPieces(element, walk);
      continue;
    }
    // A span published for ANOTHER paragraph. A resolved-display join line paints two
    // paragraphs side by side, so this is not a malformed page — it is simply not ours,
    // and its subtree is not ours to read either.
    if (element.dataset.paragraphId !== walk.paragraphId) continue;
    const start = Number(rawStart);
    if (!Number.isInteger(start)) continue;
    if (element.dataset.docxField !== undefined) {
      // ONCE per range, not once per span. Line breaking splits a field's result at its
      // spaces and every resulting span republishes the SAME model range, so emitting the
      // slice per span repeated the field's model characters — a four-word result read back
      // as four `￼` where the model has one, and the diff then inserted the extras as
      // literal object-replacement characters.
      const end = modelEndOf(element, start, start);
      walk.end = Math.max(walk.end, end);
      if (walk.projectedRanges.has(start)) continue;
      walk.projectedRanges.add(start);
      walk.pieces.push({ start, text: walk.modelText.slice(start, end) });
      continue;
    }
    const text = element.textContent ?? '';
    // The published range, not the painted length: the IME has just rewritten the text, so
    // its length says where the CARET is, not where the next model offset begins.
    walk.end = Math.max(walk.end, modelEndOf(element, start, start + text.length));
    walk.pieces.push({ start, text });
  }
}

/** The outermost painted containers for a paragraph, in page order. */
function paragraphContainers(root: Element, paragraphId: string): readonly Element[] {
  const containers: Element[] = [];
  // Through the selection reader's own lookup, which carries the guard against an id that
  // cannot be interpolated into a CSS selector: the id comes from the model but crosses a
  // parser here, and only one copy of that rule should exist.
  for (const candidate of paragraphElements(root, paragraphId, '')) {
    const element = candidate as HTMLElement;
    if (element.dataset.paragraphId !== paragraphId) continue;
    // A span is content, not a container, and a line lives inside the fragment that already
    // covers it — walking both would read every character twice.
    if (element.dataset.start !== undefined) continue;
    if (containers.some((outer) => outer.contains(element))) continue;
    containers.push(element);
  }
  return containers;
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
 * ONE PAINTED COPY, never every copy on the sheet. A shared header or footer repaints the
 * same paragraph ids on every page it appears on, so a document-wide scan read a three-page
 * header back as three concatenated copies of itself — and the diff then wrote the extra two
 * into the part. The active header/footer container is the copy the caret entered, which is
 * the same preference the selection reader applies.
 *
 * `modelText` is the paragraph's current model text, which the caller already holds.
 */
export function paintedTextOf(
  pagesLayer: HTMLElement,
  paragraphId: string,
  modelText: string
): string | null {
  for (const root of spanSearchRoots(pagesLayer)) {
    const painted = paintedTextIn(root, paragraphId, modelText);
    if (painted !== null) return painted;
  }
  return null;
}

function paintedTextIn(root: Element, paragraphId: string, modelText: string): string | null {
  const containers = paragraphContainers(root, paragraphId);
  if (containers.length === 0) return null;
  const walk: ReadbackWalk = {
    paragraphId,
    modelText,
    pieces: [],
    projectedRanges: new Set<number>(),
    end: 0,
  };
  for (const container of containers) collectPaintedPieces(container, walk);
  if (walk.pieces.length === 0) return null;
  // Stable, so a stray text node keeps the side of a span the browser put it on — both
  // address the same model offset, and only DOM order says which came first.
  const pieces = [...walk.pieces].sort((a, b) => a.start - b.start);
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
): { ops: Parameters<TreeDocxSessionView['applyTreeOps']>[0][number][]; caret: number } | null {
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
  const ops: Parameters<TreeDocxSessionView['applyTreeOps']>[0][number][] = [];
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
  session: TreeDocxSessionView;
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
