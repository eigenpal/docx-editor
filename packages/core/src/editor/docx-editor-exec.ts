// Command dispatch for `createDocxEditor` (editor seam).
//
// One switch, one vocabulary: every `EditorCommand` the gate admitted lands here and is
// expressed as surface calls. Pure over the mounted surface — no editor state, no
// snapshot, no events — so the composition root keeps the lifecycle and this keeps the
// verbs. `classifyCommand` has already refused anything not listed, which is why the
// default branch is unreachable rather than defensive.

import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { MARKS, isSurfaceSelection, resolveMarkAttr } from './docx-editor-support.ts';
import { isDocAnchor, isDocAnchorRange, resolveAnchorSelection } from './anchor-resolution.ts';

/**
 * Run one admitted command against the surface.
 *
 * Returns an `ExecResult` when the command answers for itself (a refusal, or a read-only
 * verb that changed nothing), and `null` when it completed normally — the caller then
 * derives `changed` from the model revision rather than trusting the verb.
 */
export function execEditorCommand(
  mounted: PaginatedSurface,
  command: EditorCommand
): ExecResult | null {
  switch (command.type) {
    case 'toggleMark': {
      const mark = MARKS[command.mark]!;
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
    case 'setAlignment':
      // The contract says `justify`; `w:jc` spells it `both`.
      mounted.setParagraphProperty('jc', {
        val: command.align === 'justify' ? 'both' : command.align,
      });
      break;
    case 'setIndent': {
      const attributes: Record<string, string> = {};
      if (command.left !== undefined) attributes.left = String(command.left);
      if (command.right !== undefined) attributes.right = String(command.right);
      if (command.firstLine !== undefined) attributes.firstLine = String(command.firstLine);
      if (command.hanging !== undefined) attributes.hanging = String(command.hanging);
      mounted.setParagraphProperty('ind', attributes);
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
    case 'setSelection': {
      if ('range' in command && isSurfaceSelection(command.range)) {
        mounted.setSelection(command.range);
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
      return { ok: true, changed: false };
    }
    default:
      // Unreachable: `classifyCommand` refused everything else. Typed for the compiler.
      return { ok: false, code: 'unsupported', reason: 'unsupported command' };
  }
  return null;
}
