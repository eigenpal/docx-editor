// The Paragraph dialog as a context-fed part (`DocxEditor.ParagraphDialog`).
//
// Alignment, indentation with its Special/By pair, spacing with its line-spacing rule and
// value, and the paragraph flags. Every field reads from
// `useParagraphFormat()` and the whole form is written back as ONE `setParagraphFormat`
// command on OK, so the dialog is a single undo step. The host owns visibility
// (`open`/`onClose`); the engine owns everything else.
//
// This is the escape hatch the line-spacing menu never had. That menu's rows are Word's
// shortcuts — a fixed 10pt Add, a 0pt Remove — and on a document whose style already
// supplies space-after they move a paragraph by the DIFFERENCE, which reads as a control
// that does nothing (issue #360). A field you type a number into does not have that
// problem.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { useTranslation } from '../i18n';
import { useParagraphFormat, type ParagraphTabStop } from './useParagraphFormat';
import {
  changedFields,
  formatInches,
  inchesToTwips,
  mixedFieldsOf,
  NO_MIXED_FIELDS,
  seedFields,
  trapTabWithin,
  TAB_ALIGNMENT_LABELS,
  twipsToInches,
  withTabStop,
  type ParagraphDialogFields,
  type ParagraphDialogMixed,
  type ParagraphFlagKey,
  type SpecialIndent,
  type TabAlignment,
  type TabLeaderName,
} from './paragraph-dialog-fields';

/** Props for `DocxEditor.ParagraphDialog`. @public */
export interface DocxEditorParagraphDialogProps {
  /** Whether the dialog is shown. The host owns this state. */
  open: boolean;
  /** Called on Cancel, Escape, overlay click, and after a successful OK. */
  onClose: () => void;
  className?: string;
}

const refusedStyle: CSSProperties = {
  marginRight: 'auto',
  fontSize: '12px',
  color: 'var(--doc-danger)',
};

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'var(--doc-overlay)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const dialogStyle: CSSProperties = {
  backgroundColor: 'var(--doc-surface)',
  borderRadius: 8,
  boxShadow: '0 4px 20px var(--doc-shadow)',
  minWidth: 460,
  maxWidth: 560,
  width: '100%',
  margin: 20,
  maxHeight: '90vh',
  // The panel is a column with a scrolling middle, NOT one scrolling box. Scrolling the
  // whole panel put OK and Cancel below the fold on an ordinary laptop viewport: the form
  // simply ended mid-control with no button and no scrollbar cue that more existed.
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const headerStyle: CSSProperties = {
  padding: '16px 20px 12px',
  borderBottom: '1px solid var(--doc-border)',
  flexShrink: 0,
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--doc-text)',
};

const bodyStyle: CSSProperties = {
  padding: '16px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  // The one part that scrolls, so the header and the buttons stay put.
  overflowY: 'auto',
  minHeight: 0,
};

const sectionLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--doc-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 };
const labelStyle: CSSProperties = { width: 110, fontSize: 13, color: 'var(--doc-text-muted)' };
const inputStyle: CSSProperties = {
  flex: 1,
  padding: '6px 8px',
  border: '1px solid var(--doc-border)',
  borderRadius: 4,
  fontSize: 13,
  backgroundColor: 'var(--doc-surface)',
  color: 'var(--doc-text)',
};
const unitStyle: CSSProperties = { fontSize: 11, color: 'var(--doc-text-muted)', width: 20 };
const checkRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: 'var(--doc-text)',
};
const footerStyle: CSSProperties = {
  padding: '12px 20px 16px',
  borderTop: '1px solid var(--doc-border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  flexShrink: 0,
};
const btnStyle: CSSProperties = {
  padding: '6px 16px',
  fontSize: 13,
  border: '1px solid var(--doc-border)',
  borderRadius: 4,
  cursor: 'pointer',
  backgroundColor: 'var(--doc-surface)',
  color: 'var(--doc-text)',
};

/**
 * The Paragraph dialog. Reads the selection through `useParagraphFormat()` and applies
 * the whole form as one undoable command.
 *
 * @public
 */
export function DocxEditorParagraphDialog({
  open,
  onClose,
  className,
}: DocxEditorParagraphDialogProps): ReactElement | null {
  const { t } = useTranslation();
  const { format, isEnabled, apply } = useParagraphFormat();

  const [alignment, setAlignment] = useState<'left' | 'center' | 'right' | 'justify'>('left');
  const [indentLeft, setIndentLeft] = useState(0);
  const [indentRight, setIndentRight] = useState(0);
  const [special, setSpecial] = useState<SpecialIndent>('none');
  const [specialBy, setSpecialBy] = useState(0);
  const [spaceBefore, setSpaceBefore] = useState(0);
  const [spaceAfter, setSpaceAfter] = useState(0);
  const [lineRule, setLineRule] = useState<'multiple' | 'exact' | 'atLeast'>('multiple');
  const [lineValue, setLineValue] = useState(1.08);
  const [contextualSpacing, setContextualSpacing] = useState(false);
  const [keepNext, setKeepNext] = useState(false);
  const [keepLines, setKeepLines] = useState(false);
  const [widowControl, setWidowControl] = useState(true);
  const [pageBreakBefore, setPageBreakBefore] = useState(false);
  const [tabStops, setTabStops] = useState<readonly ParagraphTabStop[]>([]);
  const [clearedAllTabStops, setClearedAll] = useState(false);
  const [newTabPosition, setNewTabPosition] = useState(0);
  const [newTabAlignment, setNewTabAlignment] = useState<TabAlignment>('left');
  const [newTabLeader, setNewTabLeader] = useState<TabLeaderName>('none');
  const [mixed, setMixed] = useState<ParagraphDialogMixed>(NO_MIXED_FIELDS);
  const [indentUnknown, setIndentUnknown] = useState(false);
  // An indent the engine cannot place — a paragraph in a table cell — reads blank like a
  // disagreement but is not one, so it says so rather than claiming the selection is mixed.
  const blankLabel = (key: keyof ParagraphDialogMixed): string =>
    indentUnknown && (key === 'indentLeft' || key === 'indentRight' || key === 'special')
      ? t('dialogs.paragraph.notShown')
      : t('dialogs.paragraph.mixed');
  /** What the selection disagreed about ON OPEN, against which `mixed` says what was resolved. */
  const seedMixedRef = useRef<ParagraphDialogMixed>(NO_MIXED_FIELDS);
  // One prefix per mounted dialog, so a `<label for>` points at THIS dialog's input even
  // when a host renders two. Clicking a visible label is how a pointer user hits a small
  // checkbox, and `aria-label` alone does not give them that.
  const fieldId = useId();
  const [refused, setRefused] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Seed from the selection when the dialog OPENS — not on every tick, or a concurrent
  // edit would fight the user's typing. The same rule `DocxEditorPageSetupDialog` follows.
  const seeded = useRef(false);
  /** What the fields held on open, so `handleApply` can send only what MOVED. */
  const seedRef = useRef<ParagraphDialogFields | null>(null);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current || format === null) return;
    const seed = seedFields(format);
    setAlignment(seed.alignment);
    setIndentLeft(seed.indentLeft);
    setIndentRight(seed.indentRight);
    setSpecial(seed.special);
    setSpecialBy(seed.specialBy);
    setSpaceBefore(seed.spaceBefore);
    setSpaceAfter(seed.spaceAfter);
    setLineRule(seed.lineRule);
    setLineValue(seed.lineValue);
    setContextualSpacing(seed.contextualSpacing);
    setKeepNext(seed.keepNext);
    setKeepLines(seed.keepLines);
    setWidowControl(seed.widowControl);
    setPageBreakBefore(seed.pageBreakBefore);
    setTabStops(seed.tabStops);
    setClearedAll(false);
    const openedMixed = mixedFieldsOf(format);
    setMixed(openedMixed);
    setIndentUnknown(format.indentUnknown);
    // The entry row is a scratch pad, not a setting: leaving "Decimal" or a leader on it
    // preloaded the next paragraph — and the next document — with a choice made elsewhere.
    setNewTabPosition(0);
    setNewTabAlignment('left');
    setNewTabLeader('none');
    seedMixedRef.current = openedMixed;
    setRefused(false);
    seedRef.current = seed;
    seeded.current = true;
  }, [open, format]);

  // Focus the panel on open, so Escape reaches the overlay's key handler.
  //
  // Closing deliberately does NOT hand focus back to the document. Three mechanisms were
  // tried and each was worse than doing nothing:
  //
  //   - Restoring the engine's `snapshot().selection` turns a caret into a whole-paragraph
  //     selection — that vocabulary carries no offset by design — so the next keystroke
  //     replaces the paragraph.
  //   - Restoring the DOM range instead is offset-correct, but focusing the surface makes
  //     it scroll its own caret into view on a LATER frame. After a write that repaginated,
  //     that scrolls the user away from the paragraph they just edited and virtualizes it
  //     out of the DOM.
  //   - Putting the scroll position back afterwards does not help: the surface's scroll
  //     lands after the restore, not before it.
  //
  // So the dialog leaves the document alone. The user's place and their text are both
  // intact; the cost is one click before typing resumes. That is the smallest of the four
  // behaviours and the only one that cannot lose work. `e2e/paragraph-dialog.interaction.spec.ts`
  // holds the two invariants that matter: closing moves neither the scroll nor the text.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const handleApply = useCallback(() => {
    const seed = seedRef.current;
    const update =
      seed === null
        ? null
        : changedFields(
            seed,
            {
              alignment,
              indentLeft,
              indentRight,
              special,
              specialBy,
              spaceBefore,
              spaceAfter,
              lineRule,
              lineValue,
              contextualSpacing,
              keepNext,
              keepLines,
              widowControl,
              pageBreakBefore,
              tabStops,
              clearedAllTabStops,
            },
            seedMixedRef.current,
            mixed
          );
    // Nothing moved, so there is nothing to write. Closing is the whole job.
    if (update === null) {
      onClose();
      return;
    }
    // A refused write keeps the dialog OPEN: `apply` is honest about op-layer rejections,
    // so closing here would claim a success that did not happen. It has to SAY so — a
    // dialog that swallows the OK and sits there looks broken rather than refused.
    if (apply(update)) {
      setRefused(false);
      onClose();
      return;
    }
    setRefused(true);
  }, [
    apply,
    onClose,
    // `mixed` decides which settings count as RESOLVED, so a stale copy would drop exactly
    // the write that makes a disagreeing selection agree. `clearedAllTabStops` is named
    // beside it rather than left to ride on `mixed` changing in the same handler.
    mixed,
    clearedAllTabStops,
    alignment,
    indentLeft,
    indentRight,
    special,
    specialBy,
    spaceBefore,
    spaceAfter,
    lineRule,
    lineValue,
    contextualSpacing,
    keepNext,
    keepLines,
    widowControl,
    pageBreakBefore,
    tabStops,
  ]);

  /**
   * Add or replace the stop at this position — "Set" replaces one already there.
   *
   * A position of zero is not a stop: the field opens at 0, so pressing Set without typing
   * anything used to add a real `0 in` row that OK then wrote to the document.
   */
  const setTabStop = useCallback((): boolean => {
    const positionTwips = Math.round(newTabPosition);
    if (positionTwips <= 0) return false;
    setMixed((previous) => ({ ...previous, tabStops: false }));
    setTabStops(
      withTabStop(tabStops, {
        positionTwips,
        alignment: newTabAlignment,
        ...(newTabLeader !== 'none' ? { leader: newTabLeader } : {}),
      })
    );
    setNewTabPosition(0);
    setNewTabAlignment('left');
    setNewTabLeader('none');
    return true;
  }, [tabStops, newTabPosition, newTabAlignment, newTabLeader]);

  if (!open) return null;

  /**
   * Clear the mixed mark for one field, so what the control now shows is a decision.
   *
   * A number or select has no indeterminate state, so a disagreement renders as an empty
   * box. The moment the user picks something, the control means what it says — and
   * `changedFields` has to be told, or setting a mixed selection to the value it was
   * already displaying writes nothing and the paragraphs stay disagreeing.
   */
  const resolve = (key: keyof ParagraphDialogMixed): void =>
    setMixed((previous) => ({ ...previous, [key]: false }));

  const inchRow = (
    labelKey: 'beforeText' | 'afterText',
    value: number,
    set: (twips: number) => void,
    mixedKey: keyof ParagraphDialogMixed
  ) => (
    <div style={rowStyle}>
      <label style={labelStyle} htmlFor={`${fieldId}-${labelKey}`}>
        {t(`dialogs.paragraph.${labelKey}`)}
      </label>
      <input
        id={`${fieldId}-${labelKey}`}
        type="number"
        style={inputStyle}
        min={0}
        step={0.1}
        // Empty, not a fabricated number, when the selection disagrees.
        value={mixed[mixedKey] ? '' : twipsToInches(value)}
        placeholder={mixed[mixedKey] ? blankLabel(mixedKey) : undefined}
        onChange={(event) => {
          resolve(mixedKey);
          set(inchesToTwips(Number(event.target.value) || 0));
        }}
        aria-label={t(`dialogs.paragraph.${labelKey}`)}
      />
      <span style={unitStyle}>{t('dialogs.paragraph.unitInches')}</span>
    </div>
  );

  const pointRow = (
    labelKey: 'spaceBefore' | 'spaceAfter',
    value: number,
    set: (points: number) => void,
    mixedKey: keyof ParagraphDialogMixed
  ) => (
    <div style={rowStyle}>
      <label style={labelStyle} htmlFor={`${fieldId}-${labelKey}`}>
        {t(`dialogs.paragraph.${labelKey}`)}
      </label>
      <input
        id={`${fieldId}-${labelKey}`}
        type="number"
        style={inputStyle}
        min={0}
        step={1}
        value={mixed[mixedKey] ? '' : value}
        placeholder={mixed[mixedKey] ? blankLabel(mixedKey) : undefined}
        onChange={(event) => {
          resolve(mixedKey);
          set(Math.max(0, Number(event.target.value) || 0));
        }}
        aria-label={t(`dialogs.paragraph.${labelKey}`)}
      />
      <span style={unitStyle}>{t('dialogs.paragraph.unitPoints')}</span>
    </div>
  );

  const checkbox = (labelKey: ParagraphFlagKey, checked: boolean, set: (next: boolean) => void) => (
    <label style={checkRowStyle}>
      <input
        type="checkbox"
        checked={checked}
        // `indeterminate` is a DOM PROPERTY with no attribute, so React cannot set it from
        // JSX — it has to be written on the node. Without it a setting the selection
        // disagrees about renders as plain unchecked, which claims agreement that is not
        // there.
        ref={(node) => {
          if (node) node.indeterminate = mixed[labelKey];
        }}
        onChange={(event) => {
          // Touching the box RESOLVES the disagreement: from here it means what it shows.
          setMixed((previous) => ({ ...previous, [labelKey]: false }));
          set(event.target.checked);
        }}
      />
      {t(`dialogs.paragraph.${labelKey}`)}
    </label>
  );

  return (
    <div
      className={className}
      style={overlayStyle}
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
        if (panelRef.current && trapTabWithin(panelRef.current, event.nativeEvent)) {
          event.preventDefault();
        }
        // Enter is the form's default submit, EXCEPT on a control that owns the key.
        //
        // A button acts on the Enter that focused it, and keydown here runs first, so
        // Cancel pressed from the keyboard would otherwise apply the form before closing
        // it. A `<select>` owns it too: Enter is how you commit the option you have
        // arrowed to, and submitting the whole dialog out from under that gesture closes
        // the form before the user has finished choosing.
        const ownsEnter =
          event.target instanceof HTMLButtonElement || event.target instanceof HTMLSelectElement;
        if (event.key === 'Enter' && !ownsEnter) {
          // Enter inside the tab-stop entry row means "Set", the way it does in Word.
          // Submitting the whole form there threw the pending row away without a word:
          // it is not part of `tabStops` yet, so OK closed and wrote nothing.
          const target = event.target;
          const inTabEntry =
            target instanceof HTMLElement && target.dataset.docxTabEntry !== undefined;
          if (inTabEntry) {
            setTabStop();
            return;
          }
          if (isEnabled) handleApply();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('dialogs.paragraph.title')}
        tabIndex={-1}
        style={dialogStyle}
        onClick={(event) => event.stopPropagation()}
        // Painted pages ARE the editable surface, so any mousedown that reaches them moves
        // the caret — and the dialog formats whatever the caret is on. Without this,
        // clicking a field inside it moves the selection out from under the edit.
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={headerStyle}>{t('dialogs.paragraph.title')}</div>
        <div style={bodyStyle}>
          <div style={sectionLabelStyle}>{t('dialogs.paragraph.general')}</div>
          <div style={rowStyle}>
            <label style={labelStyle} htmlFor={`${fieldId}-alignment`}>
              {t('dialogs.paragraph.alignment')}
            </label>
            <select
              id={`${fieldId}-alignment`}
              style={inputStyle}
              // Empty when the selection disagrees, so picking the value on screen is a
              // real change rather than a no-op the user cannot tell from a broken button.
              value={mixed.alignment ? '' : alignment}
              onChange={(event) => {
                resolve('alignment');
                setAlignment(event.target.value as 'left' | 'center' | 'right' | 'justify');
              }}
              aria-label={t('dialogs.paragraph.alignment')}
            >
              {mixed.alignment ? <option value="">{t('dialogs.paragraph.mixed')}</option> : null}
              <option value="left">{t('dialogs.paragraph.alignLeft')}</option>
              <option value="center">{t('dialogs.paragraph.alignCenter')}</option>
              <option value="right">{t('dialogs.paragraph.alignRight')}</option>
              <option value="justify">{t('dialogs.paragraph.alignJustify')}</option>
            </select>
          </div>

          <div style={sectionLabelStyle}>{t('dialogs.paragraph.indentation')}</div>
          {inchRow('beforeText', indentLeft, setIndentLeft, 'indentLeft')}
          {inchRow('afterText', indentRight, setIndentRight, 'indentRight')}
          <div style={rowStyle}>
            <label style={labelStyle} htmlFor={`${fieldId}-special`}>
              {t('dialogs.paragraph.special')}
            </label>
            <select
              id={`${fieldId}-special`}
              style={inputStyle}
              value={mixed.special ? '' : special}
              onChange={(event) => {
                resolve('special');
                setSpecial(event.target.value as SpecialIndent);
              }}
              aria-label={t('dialogs.paragraph.special')}
            >
              {mixed.special ? <option value="">{blankLabel('special')}</option> : null}
              <option value="none">{t('dialogs.paragraph.specialNone')}</option>
              <option value="firstLine">{t('dialogs.paragraph.specialFirstLine')}</option>
              <option value="hanging">{t('dialogs.paragraph.specialHanging')}</option>
            </select>
          </div>
          {special !== 'none' ? (
            <div style={rowStyle}>
              <label style={labelStyle} htmlFor={`${fieldId}-by`}>
                {t('dialogs.paragraph.by')}
              </label>
              <input
                id={`${fieldId}-by`}
                type="number"
                style={inputStyle}
                min={0}
                step={0.1}
                value={mixed.special ? '' : twipsToInches(specialBy)}
                placeholder={mixed.special ? blankLabel('special') : undefined}
                onChange={(event) => {
                  resolve('special');
                  setSpecialBy(Math.max(0, inchesToTwips(Number(event.target.value) || 0)));
                }}
                aria-label={t('dialogs.paragraph.by')}
              />
              <span style={unitStyle}>{t('dialogs.paragraph.unitInches')}</span>
            </div>
          ) : null}

          <div style={sectionLabelStyle}>{t('dialogs.paragraph.spacing')}</div>
          {pointRow('spaceBefore', spaceBefore, setSpaceBefore, 'spaceBefore')}
          {pointRow('spaceAfter', spaceAfter, setSpaceAfter, 'spaceAfter')}
          <div style={rowStyle}>
            <label style={labelStyle} htmlFor={`${fieldId}-lineSpacing`}>
              {t('dialogs.paragraph.lineSpacing')}
            </label>
            <select
              id={`${fieldId}-lineSpacing`}
              style={inputStyle}
              value={mixed.lineSpacing ? '' : lineRule}
              onChange={(event) => {
                const next = event.target.value as 'multiple' | 'exact' | 'atLeast';
                resolve('lineSpacing');
                setLineRule(next);
                // The value means different things per rule — LINES for multiple, POINTS
                // otherwise — so carrying 1.08 into "Exactly" would ask for a 1pt line.
                // Back to the rule it opened on means back to the value it opened on, or
                // a user who picked "Exactly" and changed their mind would silently write
                // 1.08 over the 1.15 their style supplies.
                setLineValue(
                  next === seedRef.current?.lineRule
                    ? seedRef.current.lineValue
                    : next === 'multiple'
                      ? 1.08
                      : 12
                );
              }}
              aria-label={t('dialogs.paragraph.lineSpacing')}
            >
              {mixed.lineSpacing ? <option value="">{t('dialogs.paragraph.mixed')}</option> : null}
              <option value="multiple">{t('dialogs.paragraph.ruleMultiple')}</option>
              <option value="atLeast">{t('dialogs.paragraph.ruleAtLeast')}</option>
              <option value="exact">{t('dialogs.paragraph.ruleExactly')}</option>
            </select>
          </div>
          <div style={rowStyle}>
            <label style={labelStyle} htmlFor={`${fieldId}-at`}>
              {t('dialogs.paragraph.at')}
            </label>
            <input
              id={`${fieldId}-at`}
              type="number"
              style={inputStyle}
              min={0.01}
              step={lineRule === 'multiple' ? 0.01 : 1}
              value={mixed.lineSpacing ? '' : lineValue}
              // An empty box is not a zero. Select-all-then-retype is how a number field is
              // edited, and coercing the intermediate empty state to 0 made the whole dialog
              // refuse with a message that named no field.
              // No `resolve` here: a number cannot say whether it means lines or points. The
              // rule select owns that, so until a rule is picked this box is disabled —
              // typing 16 into it over a mixed selection used to write sixteen line-heights.
              disabled={mixed.lineSpacing}
              onChange={(event) => {
                const next = event.target.value.trim();
                setLineValue(
                  next === '' ? (lineRule === 'multiple' ? 1.08 : 12) : Number(next) || 0
                );
              }}
              aria-label={t('dialogs.paragraph.at')}
            />
            <span style={unitStyle}>
              {lineRule === 'multiple' ? '' : t('dialogs.paragraph.unitPoints')}
            </span>
          </div>
          {checkbox('contextualSpacing', contextualSpacing, setContextualSpacing)}

          <div style={sectionLabelStyle}>{t('dialogs.paragraph.tabStops')}</div>
          {tabStops.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--doc-text-muted)' }}>
              {/* An empty list over a MIXED selection would read as "none of these
                  paragraphs has a tab stop", which is the opposite of what is true. */}
              {t(mixed.tabStops ? 'dialogs.paragraph.tabMixed' : 'dialogs.paragraph.tabEmpty')}
            </div>
          ) : (
            tabStops.map((stop) => (
              <div key={stop.positionTwips} style={rowStyle}>
                <span style={{ ...labelStyle, color: 'var(--doc-text)' }}>
                  {t('dialogs.paragraph.tabPositionLabel', {
                    position: formatInches(stop.positionTwips),
                  })}
                </span>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--doc-text-muted)' }}>
                  {t(TAB_ALIGNMENT_LABELS[stop.alignment])}
                </span>
                <button
                  type="button"
                  style={btnStyle}
                  onClick={() => setTabStops(tabStops.filter((entry) => entry !== stop))}
                  aria-label={t('dialogs.paragraph.tabRemoveAt', {
                    position: formatInches(stop.positionTwips),
                  })}
                >
                  {t('dialogs.paragraph.tabRemove')}
                </button>
              </div>
            ))
          )}
          <div style={rowStyle}>
            <label style={labelStyle} htmlFor={`${fieldId}-tabPosition`}>
              {t('dialogs.paragraph.tabPosition')}
            </label>
            <input
              id={`${fieldId}-tabPosition`}
              type="number"
              style={inputStyle}
              min={0}
              step={0.1}
              value={twipsToInches(newTabPosition)}
              onChange={(event) =>
                setNewTabPosition(Math.max(0, inchesToTwips(Number(event.target.value) || 0)))
              }
              aria-label={t('dialogs.paragraph.tabPosition')}
              data-docx-tab-entry=""
            />
            <span style={unitStyle}>{t('dialogs.paragraph.unitInches')}</span>
          </div>
          <div style={rowStyle}>
            <label style={labelStyle} htmlFor={`${fieldId}-tabAlignment`}>
              {t('dialogs.paragraph.tabAlignment')}
            </label>
            <select
              id={`${fieldId}-tabAlignment`}
              style={inputStyle}
              value={newTabAlignment}
              onChange={(event) => setNewTabAlignment(event.target.value as TabAlignment)}
              aria-label={t('dialogs.paragraph.tabAlignment')}
              data-docx-tab-entry=""
            >
              <option value="left">{t('dialogs.paragraph.tabAlignLeft')}</option>
              <option value="center">{t('dialogs.paragraph.tabAlignCenter')}</option>
              <option value="right">{t('dialogs.paragraph.tabAlignRight')}</option>
              {/* No `bar`: it draws a vertical rule rather than stopping the caret, so the
                  engine neither paints it nor reports it back. Offering it here would add a
                  row that vanishes on OK. An existing one is preserved on save. */}
              <option value="decimal">{t('dialogs.paragraph.tabAlignDecimal')}</option>
            </select>
          </div>
          <div style={rowStyle}>
            <label style={labelStyle} htmlFor={`${fieldId}-tabLeader`}>
              {t('dialogs.paragraph.tabLeader')}
            </label>
            <select
              id={`${fieldId}-tabLeader`}
              style={inputStyle}
              value={newTabLeader}
              onChange={(event) => setNewTabLeader(event.target.value as TabLeaderName)}
              aria-label={t('dialogs.paragraph.tabLeader')}
              data-docx-tab-entry=""
            >
              <option value="none">{t('dialogs.paragraph.tabNone')}</option>
              <option value="dot">{t('dialogs.paragraph.tabLeaderDot')}</option>
              <option value="hyphen">{t('dialogs.paragraph.tabLeaderHyphen')}</option>
              <option value="underscore">{t('dialogs.paragraph.tabLeaderUnderscore')}</option>
            </select>
          </div>
          <div style={{ ...rowStyle, justifyContent: 'flex-end' }}>
            <button type="button" style={btnStyle} onClick={setTabStop}>
              {t('dialogs.paragraph.tabAdd')}
            </button>
            <button
              type="button"
              style={btnStyle}
              onClick={() => {
                // Over a MIXED list this is still a decision, even though the list already
                // shows empty — `changedFields` needs the disagreement marked resolved.
                setMixed((previous) => ({ ...previous, tabStops: false }));
                setClearedAll(true);
                setTabStops([]);
              }}
            >
              {t('dialogs.paragraph.tabClearAll')}
            </button>
          </div>

          <div style={sectionLabelStyle}>{t('dialogs.paragraph.pagination')}</div>
          {checkbox('keepNext', keepNext, setKeepNext)}
          {checkbox('widowControl', widowControl, setWidowControl)}
          {checkbox('keepLines', keepLines, setKeepLines)}
          {checkbox('pageBreakBefore', pageBreakBefore, setPageBreakBefore)}
        </div>
        <div style={footerStyle}>
          {/* `role="alert"` so the refusal is announced, not just drawn. */}
          {refused ? (
            <span role="alert" style={refusedStyle}>
              {t('dialogs.paragraph.refused')}
            </span>
          ) : null}
          <button type="button" style={btnStyle} onClick={onClose}>
            {t('dialogs.paragraph.cancel')}
          </button>
          <button
            type="button"
            style={{
              ...btnStyle,
              backgroundColor: 'var(--doc-primary)',
              color: 'var(--doc-on-primary)',
              borderColor: 'var(--doc-primary)',
              // The same dimming `DocxEditorPageSetupDialog` uses. These two dialogs sit
              // beside each other in the same product; they cannot disagree about what a
              // primary button looks like.
              opacity: isEnabled ? 1 : 0.5,
            }}
            disabled={!isEnabled}
            onClick={handleApply}
          >
            {t('dialogs.paragraph.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
