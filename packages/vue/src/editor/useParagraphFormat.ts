// Paragraph formatting as a composable — the Vue twin of the React hook. Read off the
// snapshot, write through the engine's `setParagraphFormat` command, which is ONE undo step
// for a dialog's worth of fields.

import { computed, type ComputedRef } from 'vue';
import type { EditorSnapshot, RunFormatting } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

import type { ParagraphFormatRead, ParagraphFormatUpdate } from '@docx-editor.dev/core/editor';
export type {
  ParagraphFlagState,
  ParagraphTabStop,
  ParagraphFormatRead,
  ParagraphFormatUpdate,
} from '@docx-editor.dev/core/editor';

/** What `useParagraphFormat` returns. @public */
export interface UseParagraphFormatReturn {
  readonly format: ComputedRef<ParagraphFormatRead | null>;
  readonly isEnabled: ComputedRef<boolean>;
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
    indentUnknown: !indent,
    disagrees: {
      // Defaulted rather than spread: `disagrees` is optional on the snapshot, and an
      // undefined member reads as false by accident rather than by decision.
      alignment: formatting.disagrees?.alignment ?? false,
      spaceBeforePt: formatting.disagrees?.spaceBeforePt ?? false,
      spaceAfterPt: formatting.disagrees?.spaceAfterPt ?? false,
      lineSpacing: formatting.disagrees?.lineSpacing ?? false,
      tabStops: formatting.disagrees?.tabStops ?? false,
      // The indents carry their own per-field mixed flags, which is a real disagreement
      // signal rather than a null standing in for two things.
      indentLeft: indent?.mixed.left ?? false,
      indentRight: indent?.mixed.right ?? false,
      indentFirstLine: indent?.mixed.firstLine ?? false,
    },
  };
};

/**
 * Field-by-field, and exhaustive by construction: the key list is typed against
 * `ParagraphFormatRead['disagrees']`, so a member added there fails to compile until it is
 * compared here. A comment asking the next author to remember is not a guarantee.
 */
const DISAGREEMENT_KEYS: readonly (keyof ParagraphFormatRead['disagrees'])[] = [
  'alignment',
  'spaceBeforePt',
  'spaceAfterPt',
  'lineSpacing',
  'tabStops',
  'indentLeft',
  'indentRight',
  'indentFirstLine',
];

const sameDisagreements = (a: ParagraphFormatRead, b: ParagraphFormatRead): boolean =>
  DISAGREEMENT_KEYS.every((key) => a.disagrees[key] === b.disagrees[key]);

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
    // The disagreements too, or this comparator hands back a stale slice. Every member is
    // `null`-shaped on the value side, so two different selections routinely produce equal
    // VALUES and different disagreements — and a control then renders a mixed selection as
    // settled, which is precisely the uncorrectable state the engine reports to prevent.
    sameDisagreements(a, b) &&
    a.indentUnknown === b.indentUnknown &&
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
 * @public
 */
export function useParagraphFormat(): UseParagraphFormatReturn {
  const editorRef = useDocxEditor();
  const format = useEditorState(selectFormat, sameFormat);
  const editable = useEditorState(selectEditable);

  const isEnabled = computed(
    () =>
      editable.value &&
      editorRef.value !== null &&
      editorRef.value.can({ type: 'setParagraphFormat', alignment: 'left' }).ok
  );

  const apply = (update: ParagraphFormatUpdate): boolean => {
    if (!editorRef.value) return false;
    const command = { type: 'setParagraphFormat' as const, ...update };
    if (!editorRef.value.can(command).ok) return false;
    return editorRef.value.exec(command).ok;
  };

  return { format: computed(() => format.value), isEnabled, apply };
}
