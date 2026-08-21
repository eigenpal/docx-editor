// Paragraph formatting as a hook: the read side off the snapshot, the write side through
// the engine's `setParagraphFormat` command.
//
// One derivation feeds the Paragraph dialog and any consumer chrome that wants the whole
// shape at once, so they can never disagree about the paragraph — the same arrangement
// `usePageSetup` has for the section.

import { useCallback, useMemo } from 'react';
import type { EditorSnapshot, RunFormatting } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/** One tri-state paragraph flag: on, off, or "the selection disagrees". */
export type ParagraphFlagState = boolean | null;

/** One custom tab stop, as a control reads and writes it. @public */
export interface ParagraphTabStop {
  readonly positionTwips: number;
  readonly alignment: 'left' | 'center' | 'right' | 'decimal' | 'bar';
  readonly leader?: 'none' | 'dot' | 'hyphen' | 'underscore' | 'heavy' | 'middleDot';
}

/**
 * What the Paragraph dialog reads: every field, as the selection currently stands.
 *
 * A `null` means the selection's paragraphs DISAGREE about that field, which a control
 * shows as an indeterminate checkbox or an empty box rather than as a value. `indent` is
 * the exception the engine already documents — it reports the first touched paragraph and
 * flags disagreement per field, because a ruler has to draw its handles somewhere.
 *
 * @public
 */
export interface ParagraphFormatRead {
  /**
   * `justify`, not OOXML's `both`. The engine speaks `w:jc` values; an adapter speaks the
   * word its consumers write. Read and write use the SAME spelling here, so a value that
   * comes out of `format` can go straight back into `apply`.
   */
  readonly alignment: 'left' | 'center' | 'right' | 'justify' | null;
  readonly spaceBeforePt: number | null;
  readonly spaceAfterPt: number | null;
  readonly lineSpacing: {
    readonly rule: 'multiple' | 'exact' | 'atLeast';
    readonly value: number;
  } | null;
  readonly indentLeftTwips: number | null;
  readonly indentRightTwips: number | null;
  /** ONE signed first-line offset: negative is a hanging indent. */
  readonly indentFirstLineTwips: number | null;
  readonly contextualSpacing: ParagraphFlagState;
  readonly keepNext: ParagraphFlagState;
  readonly keepLines: ParagraphFlagState;
  readonly widowControl: ParagraphFlagState;
  readonly pageBreakBefore: ParagraphFlagState;
  /** Custom tab stops, cascade included. Null when the selection disagrees. */
  readonly tabStops: readonly ParagraphTabStop[] | null;
}

/**
 * The fields `apply` accepts. Omitted fields are left as authored; `null` where allowed
 * REMOVES the setting so the style supplies it again, which is not the same as a zero.
 *
 * @public
 */
export interface ParagraphFormatUpdate {
  readonly alignment?: 'left' | 'center' | 'right' | 'justify';
  readonly spaceBeforePt?: number | null;
  readonly spaceAfterPt?: number | null;
  readonly lineSpacing?: {
    readonly rule: 'multiple' | 'exact' | 'atLeast';
    readonly value: number;
  } | null;
  readonly indentLeftTwips?: number | null;
  readonly indentRightTwips?: number | null;
  readonly indentFirstLineTwips?: number | null;
  readonly contextualSpacing?: boolean;
  readonly keepNext?: boolean;
  readonly keepLines?: boolean;
  readonly widowControl?: boolean;
  readonly pageBreakBefore?: boolean;
  /** Replace the custom tab stops. An EMPTY list clears them; omit to leave them alone. */
  readonly tabStops?: readonly ParagraphTabStop[];
}

/** What `useParagraphFormat` returns. @public */
export interface UseParagraphFormatReturn {
  /** The selection's paragraph formatting, or null while nothing is loaded. */
  readonly format: ParagraphFormatRead | null;
  /** Whether the engine can write paragraph formatting right now (mounted, editable). */
  readonly isEnabled: boolean;
  /** Write the given fields as ONE undoable step. Returns whether the engine accepted. */
  readonly apply: (update: ParagraphFormatUpdate) => boolean;
}

const EMPTY_FLAGS = {
  contextualSpacing: null,
  keepNext: null,
  keepLines: null,
  widowControl: null,
  pageBreakBefore: null,
} as const;

const selectFormat = (snapshot: EditorSnapshot): ParagraphFormatRead | null => {
  const formatting: RunFormatting | null = snapshot.formatting ?? null;
  if (!formatting) return null;
  const indent = formatting.indent;
  const flags = formatting.paragraphFlags ?? EMPTY_FLAGS;
  return {
    alignment: formatting.alignment === 'both' ? 'justify' : (formatting.alignment ?? null),
    spaceBeforePt: formatting.spaceBeforePt ?? null,
    spaceAfterPt: formatting.spaceAfterPt ?? null,
    lineSpacing: formatting.lineSpacing ?? null,
    // `mixed` on a side means the selection disagrees. The packaged dialog has no blank
    // state for a number field, so it opens on a default and writes nothing unless you
    // touch it — a control that CAN render "mixed" should, and this null is how.
    indentLeftTwips: indent && !indent.mixed.left ? indent.left : null,
    indentRightTwips: indent && !indent.mixed.right ? indent.right : null,
    indentFirstLineTwips: indent && !indent.mixed.firstLine ? indent.firstLine : null,
    contextualSpacing: flags.contextualSpacing,
    keepNext: flags.keepNext,
    keepLines: flags.keepLines,
    widowControl: flags.widowControl,
    pageBreakBefore: flags.pageBreakBefore,
    tabStops: formatting.tabStops ?? null,
  };
};

const sameFormat = (a: ParagraphFormatRead | null, b: ParagraphFormatRead | null): boolean => {
  if (a === null || b === null) return a === b;
  return (
    a.alignment === b.alignment &&
    a.spaceBeforePt === b.spaceBeforePt &&
    a.spaceAfterPt === b.spaceAfterPt &&
    a.lineSpacing?.rule === b.lineSpacing?.rule &&
    a.lineSpacing?.value === b.lineSpacing?.value &&
    a.indentLeftTwips === b.indentLeftTwips &&
    a.indentRightTwips === b.indentRightTwips &&
    a.indentFirstLineTwips === b.indentFirstLineTwips &&
    a.contextualSpacing === b.contextualSpacing &&
    a.keepNext === b.keepNext &&
    a.keepLines === b.keepLines &&
    a.widowControl === b.widowControl &&
    a.pageBreakBefore === b.pageBreakBefore &&
    a.tabStops?.length === b.tabStops?.length &&
    (a.tabStops ?? []).every(
      (stop, index) =>
        stop.positionTwips === b.tabStops?.[index]?.positionTwips &&
        stop.alignment === b.tabStops?.[index]?.alignment &&
        (stop.leader ?? 'none') === (b.tabStops?.[index]?.leader ?? 'none')
    )
  );
};

const selectEditable = (snapshot: EditorSnapshot): boolean => snapshot.editable;

/**
 * The selection's paragraph formatting, plus the command to change it.
 *
 * `apply` sends ONE `setParagraphFormat`, so a dialog's worth of changes is one undo step
 * and the page repaints once.
 *
 * @public
 */
export function useParagraphFormat(): UseParagraphFormatReturn {
  const editor = useDocxEditor();
  const format = useEditorState(selectFormat, sameFormat);
  const editable = useEditorState(selectEditable);

  // `can` needs a representative payload; an alignment is always classifiable, so the
  // answer reflects only the mount/mode gates.
  const isEnabled = useMemo(
    () =>
      editable &&
      editor !== null &&
      editor.can({ type: 'setParagraphFormat', alignment: 'left' }).ok,
    [editor, editable]
  );

  const apply = useCallback(
    (update: ParagraphFormatUpdate): boolean => {
      if (!editor) return false;
      const command = { type: 'setParagraphFormat' as const, ...update };
      if (!editor.can(command).ok) return false;
      return editor.exec(command).ok;
    },
    [editor]
  );

  return { format, isEnabled, apply };
}
