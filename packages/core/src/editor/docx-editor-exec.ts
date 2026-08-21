// Command dispatch for `createDocxEditor` (editor seam).
//
// One switch, one vocabulary: every `EditorCommand` the gate admitted lands here and is
// expressed as surface calls. Pure over the mounted surface — no editor state, no
// snapshot, no events — so the composition root keeps the lifecycle and this keeps the
// verbs. `classifyCommand` has already refused anything not listed, which is why the
// default branch is unreachable rather than defensive.

import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { writeClipboardText } from './clipboard-write.ts';
import { MARKS, isSurfaceSelection, resolveMarkAttr } from './docx-editor-support.ts';
import { isDocAnchor, isDocAnchorRange, resolveAnchorSelection } from './anchor-resolution.ts';
import {
  execEditHeaderFooter,
  execInsertPageField,
  execLinkHeaderFooter,
  execRemoveHeaderFooter,
  execSetHeaderFooterOptions,
  execUnlinkHeaderFooter,
} from './docx-editor-hf.ts';
import {
  execConvertAllNotes,
  execConvertNote,
  execDeleteNote,
  execInsertNote,
  execSetNoteProperties,
} from './docx-editor-notes.ts';
import { isTableEditorCommand, planTableCommand } from './table-command-plan.ts';
import { execImageCommand, isImageCommand } from './docx-editor-images.ts';
import { lineSpacingAttributes, spacingSideAttributes } from './paragraph-format-write.ts';

/**
 * Run one admitted command against the surface.
 *
 * Returns an `ExecResult` when the command answers for itself (a refusal, or a read-only
 * verb that changed nothing), and `null` when it completed normally — the caller then
 * derives `changed` from the model revision rather than trusting the verb.
 */
export function execEditorCommand(
  mounted: PaginatedSurface,
  command: EditorCommand,
  options?: {
    readonly admittedTablePlan?: import('./table-command-plan.ts').TableCommandPlan;
    readonly editor?: Pick<
      import('./docx-editor-types.ts').DocxEditorInstance,
      'surface' | 'mountGeneration'
    >;
  }
): ExecResult | null {
  switch (command.type) {
    case 'toggleMark': {
      const mark = MARKS.get(command.mark)!;
      mounted.toggleRunProperty(mark.localName, mark.attributes);
      break;
    }
    case 'setMarkAttr': {
      // The gate already ran `resolveMarkAttr` through `classifyCommand`; resolving
      // again here keeps exec's write derived from the command, not from trust.
      const resolved = resolveMarkAttr(command);
      if (!resolved.ok) return { ok: false, code: resolved.code, reason: resolved.reason };
      mounted.setRunProperty(resolved.localName, resolved.attributes);
      break;
    }
    case 'clearFormatting':
      mounted.clearFormatting();
      break;
    case 'setLineSpacing':
      // `w:line` is 240ths of a line under `auto` and twentieths of a point otherwise —
      // one attribute, two units, which is exactly why the command takes the rule's own.
      mounted.setParagraphProperty(
        'spacing',
        lineSpacingAttributes({ rule: command.rule, value: command.value }),
        { mergeAttributes: true }
      );
      break;
    case 'setParagraphSpacing':
      mounted.setParagraphProperty(
        'spacing',
        {
          // `null` REMOVES the attribute, which is not the same as writing a zero: a removed
          // value inherits from the style again, while a zero blocks the cascade. Word's
          // "Remove space before paragraph" is the ZERO — the toolbar sends 0, not null.
          //
          // The autospacing flag on the same side goes with the measurement, because it
          // REPLACES it: `w:beforeAutospacing="1"` is worth 14pt whatever `w:before` says, so
          // a paragraph inheriting the flag — which is what Word writes for HTML-shaped
          // content, as `w:before="100" w:beforeAutospacing="1"` — swallowed this write
          // whole and the page did not move. Word clears the flag the same way when a value
          // is typed. An explicit `0` is written rather than the attribute dropped: dropping
          // it would let the inherited flag come back and win again.
          ...spacingSideAttributes('before', command.beforePt),
          ...spacingSideAttributes('after', command.afterPt),
        },
        { mergeAttributes: true }
      );
      break;
    case 'setAlignment':
      // The contract says `justify`; `w:jc` spells it `both`.
      mounted.setParagraphProperty('jc', {
        val: command.align === 'justify' ? 'both' : command.align,
      });
      break;
    case 'setParagraphStyle': {
      // The styleId must name a paragraph style the DOCUMENT defines: writing a dangling
      // `w:pStyle` would render as Normal here and as a missing style everywhere else.
      // Checked at exec rather than `can` because `can` also answers the toolbar's probe,
      // which must mean "would a well-formed pick be honoured" on any document.
      const known = mounted.session
        .documentStyles()
        .some((style) => style.type === 'paragraph' && style.styleId === command.styleId);
      if (!known) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: `style '${command.styleId}' is not a paragraph style of this document`,
        };
      }
      mounted.setParagraphProperty('pStyle', { val: command.styleId });
      break;
    }
    case 'setIndent': {
      // Not `setParagraphProperty`: the write needs the paragraph's AUTHORED attributes to
      // pick between the `w:left`/`w:start` spellings and to keep the first-line pair
      // consistent, so it lives beside `adjustIndent` on the surface.
      mounted.setIndent({
        ...(command.left !== undefined ? { left: command.left } : {}),
        ...(command.right !== undefined ? { right: command.right } : {}),
        ...(command.firstLine !== undefined ? { firstLine: command.firstLine } : {}),
      });
      break;
    }
    case 'setParagraphFormat': {
      // The contract says `justify`; `w:jc` spells it `both` — the same translation
      // `setAlignment` makes.
      const written = mounted.setParagraphFormat({
        ...(command.alignment !== undefined
          ? { alignment: command.alignment === 'justify' ? ('both' as const) : command.alignment }
          : {}),
        ...(command.spaceBeforePt !== undefined ? { spaceBeforePt: command.spaceBeforePt } : {}),
        ...(command.spaceAfterPt !== undefined ? { spaceAfterPt: command.spaceAfterPt } : {}),
        ...(command.lineSpacing !== undefined ? { lineSpacing: command.lineSpacing } : {}),
        ...(command.indentLeftTwips !== undefined
          ? { indentLeftTwips: command.indentLeftTwips }
          : {}),
        ...(command.indentRightTwips !== undefined
          ? { indentRightTwips: command.indentRightTwips }
          : {}),
        ...(command.indentFirstLineTwips !== undefined
          ? { indentFirstLineTwips: command.indentFirstLineTwips }
          : {}),
        ...(command.contextualSpacing !== undefined
          ? { contextualSpacing: command.contextualSpacing }
          : {}),
        ...(command.keepNext !== undefined ? { keepNext: command.keepNext } : {}),
        ...(command.keepLines !== undefined ? { keepLines: command.keepLines } : {}),
        ...(command.widowControl !== undefined ? { widowControl: command.widowControl } : {}),
        ...(command.pageBreakBefore !== undefined
          ? { pageBreakBefore: command.pageBreakBefore }
          : {}),
      });
      if (!written) {
        return {
          ok: false,
          code: 'unsupported',
          reason: mounted.state().lastRejection ?? 'the paragraph format could not be written here',
        };
      }
      break;
    }
    case 'setPageSetup': {
      const anchor =
        command.scope === 'section' ? mounted.state().selection.head.paragraphId : undefined;
      // When orientation arrives WITH explicit dimensions, the dimensions are
      // oriented here — Word stores landscape as swapped dimensions plus the
      // attribute. Orientation ALONE stays alone: the op swaps each written
      // section's own dimensions, so distinct paper sizes survive the flip.
      let width = command.pageWidth;
      let height = command.pageHeight;
      if (command.orientation !== undefined && (width !== undefined || height !== undefined)) {
        const section = anchor ? mounted.sectionPropertiesAt(anchor) : mounted.sectionProperties();
        const w = width ?? section.pageSize.widthTwips;
        const h = height ?? section.pageSize.heightTwips;
        width = command.orientation === 'landscape' ? Math.max(w, h) : Math.min(w, h);
        height = command.orientation === 'landscape' ? Math.min(w, h) : Math.max(w, h);
      }
      const committed = mounted.setSectionProperties({
        ...(width !== undefined ? { pageWidthTwips: width } : {}),
        ...(height !== undefined ? { pageHeightTwips: height } : {}),
        ...(command.orientation !== undefined ? { orientation: command.orientation } : {}),
        ...(command.marginTop !== undefined ? { marginTopTwips: command.marginTop } : {}),
        ...(command.marginRight !== undefined ? { marginRightTwips: command.marginRight } : {}),
        ...(command.marginBottom !== undefined ? { marginBottomTwips: command.marginBottom } : {}),
        ...(command.marginLeft !== undefined ? { marginLeftTwips: command.marginLeft } : {}),
        ...(anchor !== undefined ? { anchorParagraphId: anchor } : {}),
      });
      // The op layer can refuse what per-field bounds cannot see — margins that
      // together swallow a page. A refusal must surface as one, not close a dialog
      // claiming success.
      if (!committed) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: mounted.state().lastRejection ?? 'the page setup change was refused',
        };
      }
      break;
    }
    case 'toggleList':
      if (!mounted.toggleList(command.kind)) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: mounted.state().lastRejection ?? 'the list change was refused',
        };
      }
      break;
    case 'adjustIndent':
      if (!mounted.adjustIndent(command.direction)) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: mounted.state().lastRejection ?? 'the selection is already at that indent level',
        };
      }
      break;
    case 'insertBreak':
      if (command.kind === 'section') {
        if (!mounted.insertSectionBreak()) {
          return {
            ok: false,
            code: 'invalidArgs',
            reason: mounted.state().lastRejection ?? 'the section break was refused',
          };
        }
        break;
      }
      // `page` has its own tree op and its own `w:br w:type="page"`. Falling through
      // to a line break here made Ctrl+Enter silently insert the wrong element.
      if (command.kind === 'page') {
        mounted.insertPageBreak();
        break;
      }
      mounted.insertLineBreak();
      break;
    case 'insertHyperlink': {
      // `#name` is a bookmark in this document; anything else is an external target and
      // goes through the package's URL allowlist on the way to a relationship. A refusal
      // there surfaces as one rather than committing a link with nowhere to go.
      const internal = command.href.startsWith('#');
      const applied = mounted.hyperlinks.applyHyperlink({
        ...(internal ? { anchor: command.href.slice(1) } : { url: command.href }),
        ...(command.text !== undefined ? { text: command.text } : {}),
      });
      if (!applied) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason:
            mounted.state().lastRejection ??
            'the link was refused: the target is not an allowed scheme, or there is no text to link',
        };
      }
      break;
    }
    case 'removeHyperlink':
      if (!mounted.hyperlinks.removeHyperlink()) {
        return {
          ok: false,
          code: 'notFound',
          reason: 'there is no hyperlink at the selection',
        };
      }
      break;
    case 'insertText':
      mounted.type(command.text);
      break;
    case 'deleteText':
      mounted.deleteSelection();
      break;
    case 'undo':
      mounted.undo();
      break;
    case 'redo':
      mounted.redo();
      break;
    case 'insertTable':
      if (!mounted.insertTable(command.rows, command.cols)) {
        return {
          ok: false,
          code: 'unsupported',
          reason: mounted.state().lastRejection ?? 'the table could not be inserted here',
        };
      }
      break;
    case 'insertToc':
      if (!mounted.insertToc()) {
        return {
          ok: false,
          code: 'unsupported',
          reason: mounted.state().lastRejection ?? 'the table of contents could not be inserted',
        };
      }
      break;
    case 'refreshToc':
      if (!mounted.refreshToc(command.tocId, command.mode)) {
        return {
          ok: false,
          code: 'unsupported',
          reason: mounted.state().lastRejection ?? 'the table of contents could not be refreshed',
        };
      }
      break;
    case 'editHeaderFooter':
      return execEditHeaderFooter(mounted, command);
    case 'exitHeaderFooter': {
      if (typeof mounted.exitHeaderFooter === 'function') mounted.exitHeaderFooter();
      return { ok: true, changed: false };
    }
    case 'removeHeaderFooter':
      return execRemoveHeaderFooter(mounted, command);
    case 'linkHeaderFooterToPrevious':
      return execLinkHeaderFooter(mounted, command);
    case 'unlinkHeaderFooterFromPrevious':
      return execUnlinkHeaderFooter(mounted, command);
    case 'setHeaderFooterOptions':
      return execSetHeaderFooterOptions(mounted, command);
    case 'insertPageField':
      return execInsertPageField(mounted, command);
    case 'insertNote':
      return execInsertNote(mounted, command);
    case 'deleteNote':
      return execDeleteNote(mounted, command);
    case 'convertNote':
      return execConvertNote(mounted, command);
    case 'convertAllNotes':
      return execConvertAllNotes(mounted, command);
    case 'setNoteProperties':
      return execSetNoteProperties(mounted, command);
    case 'insertRow':
    case 'deleteRow':
    case 'insertColumn':
    case 'deleteColumn':
    case 'deleteTable':
    case 'setCellFill':
    case 'setTableCellVerticalAlignment':
    case 'setTableBorders':
    case 'commitTableColumnDividerResize':
    case 'commitTableRightEdgeResize':
    case 'mergeCells':
    case 'splitCell':
    case 'toggleHeaderRow':
    case 'selectTableRegion':
    case 'setTableProperties': {
      if (!isTableEditorCommand(command)) {
        return { ok: false, code: 'unsupported', reason: 'unsupported command' };
      }
      const plan =
        options?.admittedTablePlan ??
        planTableCommand({
          command,
          part: mounted.session.part(),
          layout: mounted.layout(),
          storeRevision: mounted.session.packageRevision(),
          selection: mounted.state().selection,
          cellSelection: mounted.state().cellSelection,
          themeColors: mounted.session.documentThemeColors(),
          editable: mounted.session.editable,
          viewing: mounted.editingMode() === 'view',
        });
      return mounted.applyTableCommandPlan(plan);
    }
    case 'selectAll':
      mounted.selectAll();
      // Selection is not document state: nothing to save changed.
      return { ok: true, changed: false };
    case 'copy':
      // The gate already refused a collapsed selection, so this read is non-empty.
      writeClipboardText(mounted.selectedText());
      return { ok: true, changed: false };
    case 'cut':
      // Read BEFORE the delete: `selectedText` answers from the selection, and the delete
      // is what removes it.
      writeClipboardText(mounted.selectedText());
      mounted.deleteSelection();
      break;
    case 'paste':
      mounted.insertPlainText(command.text);
      break;
    case 'setSelection': {
      // Every successful branch REVEALS its head. This command is host/automation-facing
      // — "select this paragraph" means "show it to me" — and the caret-follow scroll
      // inside `setSelection` cannot serve it: it sits out for range selections and for
      // callers whose focus is outside the pages layer, which is the normal state for a
      // host driving the editor from its own chrome. `'centerIfNeeded'` keeps an
      // already-visible target still and centres one it has to travel to, rather than
      // stopping the moment it clears the bottom edge.
      if ('range' in command && isSurfaceSelection(command.range)) {
        mounted.setSelection(command.range);
        mounted.revealPosition(command.range.head, { block: 'centerIfNeeded' });
        // Selection is not document state: nothing to save changed.
        return { ok: true, changed: false };
      }
      // DocAnchor forms resolve through the session's paraId index. The gate admitted
      // only anchor-shaped payloads past the surface form, so a fall-through here is a
      // range with anchor endpoints or an `{ anchor }` position.
      const payload =
        'anchor' in command && isDocAnchor(command.anchor)
          ? { anchor: command.anchor }
          : 'range' in command && isDocAnchorRange(command.range)
            ? { range: command.range }
            : null;
      if (payload === null) {
        return { ok: false, code: 'unsupported', reason: 'unsupported selection form' };
      }
      const resolved = resolveAnchorSelection(
        mounted.session.part(),
        mounted.session.paragraphAnchors(),
        payload
      );
      if (!resolved.ok) return resolved;
      mounted.setSelection(resolved.selection);
      mounted.revealPosition(resolved.selection.head, { block: 'centerIfNeeded' });
      return { ok: true, changed: false };
    }
    default:
      if (isImageCommand(command)) {
        return execImageCommand(mounted, command, options?.editor);
      }
      // Unreachable: `classifyCommand` refused everything else. Typed for the compiler.
      return { ok: false, code: 'unsupported', reason: 'unsupported command' };
  }
  return null;
}
