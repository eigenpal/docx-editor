// Snapshot derivations for `createDocxEditor` (editor seam).
//
// The reads that turn a mounted surface into contract values: run formatting, page setup,
// page counts. Pure over the surface — the composition root owns when they run and what
// caches them, these own only what the answer IS, so `snapshot().formatting` and
// `getSelectionFormatting()` cannot drift into two derivations of the same thing.

import type {
  EditorCommand,
  EditorScope,
  ExecResult,
  PageSetup,
  RunFormatting,
} from '../contracts/editor.ts';
import { classifyCommand } from './docx-editor-support.ts';

/** Whether a command may run, and the engine's own refusal when it may not. */
export type CommandGate = { ok: true } | { ok: false; refusal: Exclude<ExecResult, { ok: true }> };
import { caretAt } from '@docx-editor.dev/core-contract/layout';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/**
 * THE unified formatting derivation — the one place surface formatting becomes the
 * contract's `RunFormatting`. `snapshot().formatting`, `getSelectionFormatting()`,
 * `isActive` and the `selectionFormatting` query all read this shape (via the cached
 * snapshot), so they can never disagree about what the selection carries.
 */
export function runFormattingOf(surface: PaginatedSurface | null): RunFormatting | null {
  if (!surface) return null;
  const formatting = surface.formatting();
  return {
    bold: formatting.bold,
    italic: formatting.italic,
    underline: formatting.underline,
    strike: formatting.strikethrough,
    superscript: formatting.superscript,
    subscript: formatting.subscript,
    ...(formatting.color ? { color: { kind: 'hex' as const, value: formatting.color } } : {}),
    ...(formatting.highlight ? { highlight: formatting.highlight } : {}),
    ...(formatting.fontFamily ? { fontFamily: formatting.fontFamily } : {}),
    ...(formatting.fontSizeHalfPoints !== null
      ? { fontSizePt: formatting.fontSizeHalfPoints / 2 }
      : {}),
    ...(formatting.alignment ? { alignment: formatting.alignment } : {}),
    ...(formatting.styleId ? { styleId: formatting.styleId } : {}),
  };
}

/**
 * THE page-setup derivation — `getPageSetup()` and `snapshot().pageSetup` both read
 * this shape, so the dialog and the rulers can never disagree about the section. In a
 * multi-section document it is the CARET's section, which is what a ruler reflects
 * when the caret crosses a section boundary — Word's behaviour.
 */
export function pageSetupOf(surface: PaginatedSurface | null): PageSetup | null {
  if (!surface) return null;
  const section = surface.sectionPropertiesAt(surface.state().selection.head.paragraphId);
  return {
    pageWidthTwips: section.pageSize.widthTwips,
    pageHeightTwips: section.pageSize.heightTwips,
    orientation: section.landscape ? ('landscape' as const) : ('portrait' as const),
    marginsTwips: {
      top: section.margins.topTwips,
      right: section.margins.rightTwips,
      bottom: section.margins.bottomTwips,
      left: section.margins.leftTwips,
    },
    gutterTwips: section.margins.gutterTwips,
  };
}

export function totalPages(surface: PaginatedSurface | null): number {
  return surface ? surface.state().pageCount : 0;
}

export function currentPage(surface: PaginatedSurface | null): number {
  // Caret page from the layout records. There is no viewport tracking on this facade yet,
  // so `'viewport'` honestly answers with the caret's page as the nearest derivable value.
  if (!surface) return 1;
  const caret = caretAt(surface.layout(), surface.state().selection.head);
  return caret ? caret.pageIndex + 1 : 1;
}

export function gateCommand(
  command: EditorCommand,
  surface: PaginatedSurface | null,
  mode: 'edit' | 'view',
  options?: { scope?: EditorScope }
): CommandGate {
  if (options?.scope && options.scope.kind !== 'body') {
    return {
      ok: false,
      refusal: { ok: false, code: 'unsupported', reason: 'only the body scope is supported' },
    };
  }
  const support = classifyCommand(command);
  if (!support.supported) {
    return {
      ok: false,
      refusal: { ok: false, code: support.code ?? 'unsupported', reason: support.reason },
    };
  }
  if (!surface) {
    return {
      ok: false,
      refusal: { ok: false, code: 'notFound', reason: 'no document is loaded' },
    };
  }
  if (support.mutating && (mode === 'view' || !surface.session.editable)) {
    return {
      ok: false,
      refusal: { ok: false, code: 'locked', reason: 'the document is read-only' },
    };
  }
  // History commands are gated on the HISTORY, not just the mode: `can` drives the
  // toolbar's enabled state, and an undo button that stays live over an empty stack
  // silently no-ops — Word greys it out.
  // Indent is gated the same way, and for the same reason: a list item at level 0 cannot
  // outdent, and one whose definition declares no deeper level cannot indent without
  // losing its marker entirely.
  if (command.type === 'adjustIndent' && !surface.canAdjustIndent(command.direction)) {
    return {
      ok: false,
      refusal: {
        ok: false,
        code: 'unsupported',
        reason:
          command.direction === 'decrease'
            ? 'the selection is already at the outermost level'
            : 'the selection cannot indent any further',
      },
    };
  }
  // Run formatting is written over a RANGE INSIDE ONE PARAGRAPH (surface-format.ts's
  // `toggleRunProperty`/`setRunProperty` both return early otherwise). Without this the
  // press was the worst kind of failure: `can` said yes, `exec` reported
  // `{ ok: true, changed: false }`, and the document did not move — Bold over a
  // three-paragraph selection, or a font pick with the caret between two letters, looked
  // live and did nothing at all. The engine now says why, and the button greys out.
  if (command.type === 'toggleMark' || command.type === 'setMarkAttr') {
    const { anchor, head } = surface.state().selection;
    if (anchor.paragraphId !== head.paragraphId) {
      return {
        ok: false,
        refusal: {
          ok: false,
          code: 'unsupported',
          reason: 'run formatting applies within one paragraph; this selection spans several',
        },
      };
    }
    if (anchor.offset === head.offset) {
      return {
        ok: false,
        refusal: {
          ok: false,
          code: 'unsupported',
          reason: 'select the text to format; a caret carries no formatting yet',
        },
      };
    }
  }
  if (command.type === 'undo' && !surface.session.canUndo()) {
    return {
      ok: false,
      refusal: { ok: false, code: 'unsupported', reason: 'nothing to undo' },
    };
  }
  if (command.type === 'redo' && !surface.session.canRedo()) {
    return {
      ok: false,
      refusal: { ok: false, code: 'unsupported', reason: 'nothing to redo' },
    };
  }
  return { ok: true };
}
