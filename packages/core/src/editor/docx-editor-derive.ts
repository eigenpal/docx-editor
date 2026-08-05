// Snapshot derivations for `createDocxEditor` (editor seam).
//
// The reads that turn a mounted surface into contract values: run formatting, page setup,
// page counts. Pure over the surface — the composition root owns when they run and what
// caches them, these own only what the answer IS, so `snapshot().formatting` and
// `getSelectionFormatting()` cannot drift into two derivations of the same thing.

import type {
  DocRange,
  EditorCommand,
  EditorScope,
  CanResult,
  ExecResult,
  HyperlinkInfo,
  PageSetup,
  RunFormatting,
  TableContext,
} from '../contracts/editor.ts';
import type { ContainerRef, ParagraphSummary } from '../index.ts';
import { classifyCommand } from './docx-editor-support.ts';
import { gateImageCommand } from './docx-editor-images.ts';

/** Whether a command may run, and the engine's own refusal when it may not. */
export type CommandGate =
  | { ok: true; tablePlan?: import('./table-command-plan.ts').TableCommandPlan }
  | { ok: false; refusal: Exclude<ExecResult, { ok: true }> };
import { tableContextAt } from '@docx-editor.dev/core-contract/layout';
import {
  isTableEditorCommand,
  planTableCommand,
  type TableCommandPlan,
  type TableCommandPlannerInput,
} from './table-command-plan.ts';
import { paragraphTextOf } from '@docx-editor.dev/core-contract/store';
import { allParagraphs } from '../binding/tree-binding.ts';
import { paragraphStyleId } from '../binding/document-outline.ts';
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
    ...(formatting.lineSpacing ? { lineSpacing: formatting.lineSpacing } : {}),
    ...(formatting.spaceBeforePt !== null ? { spaceBeforePt: formatting.spaceBeforePt } : {}),
    ...(formatting.spaceAfterPt !== null ? { spaceAfterPt: formatting.spaceAfterPt } : {}),
    ...(formatting.indent !== null ? { indent: formatting.indent } : {}),
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

/**
 * THE selection derivation — the surface's (node id, offset) selection expressed in the
 * contract's vocabulary. `snapshot().selection` and the `selection` query both read this.
 *
 * Paragraph-granular by design: endpoints are bare `DocAnchor`s (`{ paraId }`), so a
 * caret and any selection inside one paragraph both read as
 * `{from: {paraId: X}, to: {paraId: X}}`. Offsets are deliberately not representable —
 * `DocAnchor` carries none (an agent cannot compute an offset it has not seen), and
 * emitting offsetful positional endpoints would reintroduce the addressing the contract
 * forbids. `from`/`to` are document-ordered regardless of drag direction. The result
 * round-trips: feeding it back to `setSelection` selects the same paragraphs.
 */
export function selectionRangeOf(surface: PaginatedSurface | null): DocRange | null {
  if (!surface) return null;
  const { anchor, head } = surface.state().selection;
  const anchors = surface.session.paragraphAnchors();
  const anchorParaId = anchors.paraIdByNode.get(anchor.paragraphId);
  const headParaId = anchors.paraIdByNode.get(head.paragraphId);
  // Normalization maps every editable paragraph at open, so this misses only when
  // identity could not be established at all (the fail-open path on a pathological
  // file) or a pre-layout placeholder id appears — null is the honest answer for both,
  // never a fabricated range.
  if (anchorParaId === undefined || headParaId === undefined) return null;
  const anchorOrdinal = anchors.ordinalByNode.get(anchor.paragraphId) ?? 0;
  const headOrdinal = anchors.ordinalByNode.get(head.paragraphId) ?? 0;
  const reversed =
    headOrdinal < anchorOrdinal || (headOrdinal === anchorOrdinal && head.offset < anchor.offset);
  return reversed
    ? { from: { paraId: headParaId }, to: { paraId: anchorParaId } }
    : { from: { paraId: anchorParaId }, to: { paraId: headParaId } };
}

/**
 * The `hyperlinkAt` query: the link the caret sits in, or null.
 *
 * `href` is the SANITIZED projection, so a caller that puts it straight into a DOM
 * attribute or a `window.open` cannot be handed a scheme the engine refuses. An inert link
 * — a refused scheme, a dangling relationship — answers with an empty `href`: there IS a
 * link at that position (an editor should offer to fix or remove it) and there is nothing
 * to follow.
 */
export function hyperlinkAtOf(surface: PaginatedSurface | null): HyperlinkInfo | null {
  if (!surface) return null;
  const link = surface.hyperlinks.linkAtCaret();
  if (!link) return null;
  const paraId = surface.session.paragraphAnchors().paraIdByNode.get(link.paragraphId);
  // A `DocRange` addresses paragraphs by `w14:paraId`; without one there is no honest
  // range to report, and a fabricated one is worse than none.
  if (paraId === undefined) return null;
  return {
    href: link.href ?? '',
    range: { from: { paraId }, to: { paraId } },
    ...(link.tooltip !== undefined ? { tooltip: link.tooltip } : {}),
  };
}

/**
 * The `paragraphs` query: every editable paragraph in reading order, addressed the way
 * the contract addresses paragraphs. Scope is the MAIN part — a `container` naming any
 * other story answers `[]` (queries carry no error channel; the paraId map does not
 * reach those stories yet).
 */
export function paragraphSummaries(
  surface: PaginatedSurface | null,
  container?: ContainerRef
): readonly ParagraphSummary[] {
  if (!surface) return [];
  if (container !== undefined && container.part !== 'body') return [];
  const part = surface.session.part();
  const anchors = surface.session.paragraphAnchors();
  return allParagraphs(part).map((paragraph) => {
    const paraId = anchors.paraIdByNode.get(paragraph.id);
    const styleId = paragraph.kind === 'textValue' ? undefined : paragraphStyleId(paragraph);
    return {
      ...(paraId !== undefined ? { paraId } : {}),
      text: paragraphTextOf(part, paragraph.id) ?? '',
      ...(styleId !== undefined ? { styleId } : {}),
    };
  });
}

export function totalPages(surface: PaginatedSurface | null): number {
  return surface ? surface.state().pageCount : 0;
}

export function currentPage(
  surface: PaginatedSurface | null,
  mode: 'viewport' | 'caret' = 'caret'
): number {
  return surface ? surface.currentPage(mode) : 1;
}

export function gateTableCommand(command: EditorCommand, surface: PaginatedSurface): CommandGate {
  if (!isTableEditorCommand(command)) {
    return {
      ok: false,
      refusal: { ok: false, code: 'unsupported', reason: 'not a table command' },
    };
  }
  const state = tableCommandState(command, surface);
  if (!state.can.ok) {
    return {
      ok: false,
      refusal: { ok: false, code: state.can.code, reason: state.can.reason },
    };
  }
  return { ok: true, tablePlan: state.plan };
}

export function buildTableCommandPlannerInput(
  command: EditorCommand,
  surface: PaginatedSurface
): TableCommandPlannerInput {
  return {
    command,
    part: surface.session.part(),
    layout: surface.layout(),
    storeRevision: surface.session.revision(),
    selection: surface.state().selection,
    cellSelection: surface.state().cellSelection,
    themeColors: surface.session.documentThemeColors(),
    editable: surface.session.editable,
    viewing: surface.editingMode() === 'view',
  };
}

/** Planner-backed can/plan pair — production gate for table commands. Task 9 maps chrome slots. */
export function tableCommandState(
  command: EditorCommand,
  surface: PaginatedSurface
): { readonly can: CanResult; readonly plan: TableCommandPlan } {
  const plan = planTableCommand(buildTableCommandPlannerInput(command, surface));
  return plan.ok
    ? { can: { ok: true }, plan }
    : { can: { ok: false, code: plan.code, reason: plan.reason }, plan };
}

export function gateCommand(
  command: EditorCommand,
  surface: PaginatedSurface | null,
  mode: 'edit' | 'view',
  options?: { scope?: EditorScope }
): CommandGate {
  // Scope option: body and the currently open furniture story are writable; `all` and
  // unrelated scopes stay refused. When omitted, the surface's active scope is used.
  if (options?.scope) {
    if (options.scope.kind === 'all') {
      return {
        ok: false,
        refusal: { ok: false, code: 'unsupported', reason: 'the all scope is read-only' },
      };
    }
    if (options.scope.kind === 'note' || options.scope.kind === 'frame') {
      return {
        ok: false,
        refusal: {
          ok: false,
          code: 'unsupported',
          reason: `scope kind '${options.scope.kind}' is not supported`,
        },
      };
    }
    if (options.scope.kind === 'headerFooter') {
      const active = surface?.activeScope?.() ?? { kind: 'body' as const };
      if (active.kind !== 'headerFooter' || active.rId !== options.scope.rId) {
        // Explicit HF scope only when that story is the active editing surface.
        return {
          ok: false,
          refusal: {
            ok: false,
            code: 'unsupported',
            reason: 'open that header or footer before dispatching against its scope',
          },
        };
      }
    }
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
  // Cut, Copy and Delete are gated on the SELECTION, for the reason directly above: a row
  // that stays live over a collapsed caret does nothing when pressed and looks broken. All
  // THREE, because they are siblings in one menu — `deleteText` is `deleteSelection()`,
  // which returns false at a caret, so leaving it out left one of three clipboard-adjacent
  // rows disagreeing with the other two about the same condition.
  //
  // The check is the collapsed comparison, NOT `selectedText() === ''`. Reading the text
  // builds the entire selected string to answer one bit, and `can` is asked from host
  // selectors that re-run on every tick — the exact cost `EditorSnapshot.selectionCollapsed`
  // exists to avoid, which it would be absurd to reintroduce here.
  if (command.type === 'copy' || command.type === 'cut' || command.type === 'deleteText') {
    const { anchor, head } = surface.state().selection;
    if (anchor.paragraphId === head.paragraphId && anchor.offset === head.offset) {
      return {
        ok: false,
        refusal: { ok: false, code: 'unsupported', reason: 'nothing is selected' },
      };
    }
  }
  // The style picker's probe promises "a well-formed pick would be honoured": on a
  // document that defines no paragraph styles, no pick can be — every styleId is refused
  // at exec — so the control must grey out rather than open an empty, dead listbox.
  if (
    command.type === 'setParagraphStyle' &&
    !surface.session.documentStyles().some((style) => style.type === 'paragraph')
  ) {
    return {
      ok: false,
      refusal: {
        ok: false,
        code: 'unsupported',
        reason: 'this document defines no paragraph styles',
      },
    };
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
  if (command.type === 'insertToc' && !surface.canInsertToc()) {
    return {
      ok: false,
      refusal: {
        ok: false,
        code: 'unsupported',
        reason: 'a table of contents can only be inserted in the editable document body',
      },
    };
  }
  if (command.type === 'refreshToc' && !surface.canRefreshToc(command.tocId)) {
    return {
      ok: false,
      refusal: {
        ok: false,
        code: 'notFound',
        reason: 'there is no refreshable table of contents at the selection',
      },
    };
  }
  if (command.type === 'insertPageField') {
    const active = surface.activeScope?.() ?? { kind: 'body' as const };
    if (active.kind !== 'headerFooter') {
      return {
        ok: false,
        refusal: {
          ok: false,
          code: 'unsupported',
          reason: 'insertPageField requires an open header or footer scope',
        },
      };
    }
  }
  if (command.type === 'insertNote') {
    const active = surface.activeScope?.() ?? { kind: 'body' as const };
    if (active.kind !== 'body') {
      return {
        ok: false,
        refusal: {
          ok: false,
          code: 'unsupported',
          reason: 'insertNote requires body scope',
        },
      };
    }
  }
  if (command.type === 'linkHeaderFooterToPrevious') {
    const state = surface.headerFooterState?.();
    const sectionIndex = command.sectionIndex ?? state?.sectionIndex ?? 0;
    if (sectionIndex === 0) {
      return {
        ok: false,
        refusal: {
          ok: false,
          code: 'invalidArgs',
          reason: 'the first section cannot link to a previous header or footer',
        },
      };
    }
  }
  if (isTableEditorCommand(command)) {
    const tableGate = gateTableCommand(command, surface);
    if (!tableGate.ok) return tableGate;
    return { ok: true, tablePlan: tableGate.tablePlan };
  }
  const imageGate = gateImageCommand(command, surface);
  if (imageGate && !imageGate.ok) {
    return { ok: false, refusal: imageGate };
  }
  return { ok: true };
}

export function selectedTableOf(surface: PaginatedSurface | null): {
  readonly blockId: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly cell: { readonly row: number; readonly column: number } | null;
} | null {
  if (!surface) return null;
  const state = surface.state();
  const cells = state.cellSelection;
  const context = tableContextAt(surface.layout(), state.selection.head.paragraphId);
  if (!context) return null;
  return {
    blockId: context.tableId,
    rowCount: context.rows,
    columnCount: context.columns,
    cell: {
      row: cells ? cells.rows.from : context.rowIndex,
      column: cells ? cells.columns.from : context.columnIndex,
    },
  };
}

/**
 * Where the caret is in a table, if it is in one.
 *
 * Answered for a plain caret, not only for a rectangular cell selection: "am I in a table" is
 * a question about the caret, and reporting it only during a drag would leave a toolbar
 * showing its table controls disabled the whole time the user was typing in a cell.
 */
export function tableContextOf(surface: PaginatedSurface | null): TableContext | null {
  if (!surface) return null;
  const state = surface.state();
  const cells = state.cellSelection;
  // `selection` is a rectangle's own text range when one is live, so its head is inside the
  // table either way and one lookup serves both.
  const context = tableContextAt(surface.layout(), state.selection.head.paragraphId);
  if (!context) return null;
  return {
    rows: context.rows,
    columns: context.columns,
    // A rectangle reports its top-left, which is where its commands are anchored.
    rowIndex: cells ? cells.rows.from : context.rowIndex,
    columnIndex: cells ? cells.columns.from : context.columnIndex,
  };
}

/** Half-point reshape of `snapshot().formatting` for `getSelectionFormatting`. */
export function selectionFormattingHalfPoints(formatting: RunFormatting | null): {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontFamily?: string;
  fontSizeHalfPoints?: number;
  styleId?: string;
  alignment?: string;
} | null {
  if (!formatting) return null;
  return {
    ...(formatting.bold !== undefined ? { bold: formatting.bold } : {}),
    ...(formatting.italic !== undefined ? { italic: formatting.italic } : {}),
    ...(formatting.underline !== undefined ? { underline: formatting.underline } : {}),
    ...(formatting.fontFamily ? { fontFamily: formatting.fontFamily } : {}),
    ...(formatting.fontSizePt !== undefined
      ? { fontSizeHalfPoints: Math.round(formatting.fontSizePt * 2) }
      : {}),
    ...(formatting.styleId ? { styleId: formatting.styleId } : {}),
    ...(formatting.alignment ? { alignment: formatting.alignment } : {}),
  };
}
