// The Paragraph dialog as a context-fed part (`DocxEditor.ParagraphDialog`).
//
// Word's dialog, field for field: alignment, indentation with its Special/By pair, spacing
// with its line-spacing rule and value, and the flags. Every field reads from
// `useParagraphFormat()` and the whole form is written back as ONE `setParagraphFormat`
// command on OK, so the dialog is a single undo step. The host owns visibility
// (`open`/`onClose`); the engine owns everything else.
//
// This is the escape hatch the line-spacing menu never had. That menu's rows are Word's
// shortcuts — a fixed 10pt Add, a 0pt Remove — and on a document whose style already
// supplies space-after they move a paragraph by the DIFFERENCE, which reads as a control
// that does nothing (issue #360). A field you type a number into does not have that
// problem.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { useTranslation } from '../i18n';
import { useParagraphFormat, type ParagraphFormatUpdate } from './useParagraphFormat';

/** Props for `DocxEditor.ParagraphDialog`. @public */
export interface DocxEditorParagraphDialogProps {
  /** Whether the dialog is shown. The host owns this state. */
  open: boolean;
  /** Called on Cancel, Escape, overlay click, and after a successful OK. */
  onClose: () => void;
  className?: string;
}

const TWIPS_PER_INCH = 1440;
const twipsToInches = (twips: number): number => Math.round((twips / TWIPS_PER_INCH) * 100) / 100;
const inchesToTwips = (inches: number): number => Math.round(inches * TWIPS_PER_INCH);

/** Word's "Special" pair: the signed first-line offset, split into a kind and a magnitude. */
type SpecialIndent = 'none' | 'firstLine' | 'hanging';

const specialOf = (signedTwips: number | null): SpecialIndent => {
  if (signedTwips === null || signedTwips === 0) return 'none';
  return signedTwips < 0 ? 'hanging' : 'firstLine';
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
  overflowY: 'auto',
};

const headerStyle: CSSProperties = {
  padding: '16px 20px 12px',
  borderBottom: '1px solid var(--doc-border)',
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--doc-text)',
};

const bodyStyle: CSSProperties = {
  padding: '16px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
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
  justifyContent: 'flex-end',
  gap: 8,
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
 * Word's Paragraph dialog. Reads the selection through `useParagraphFormat()` and applies
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
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Seed from the selection when the dialog OPENS — not on every tick, or a concurrent
  // edit would fight the user's typing. The same rule `DocxEditorPageSetupDialog` follows.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current || format === null) return;
    setAlignment(format.alignment === 'both' ? 'justify' : (format.alignment ?? 'left'));
    setIndentLeft(format.indentLeftTwips ?? 0);
    setIndentRight(format.indentRightTwips ?? 0);
    const kind = specialOf(format.indentFirstLineTwips);
    setSpecial(kind);
    setSpecialBy(Math.abs(format.indentFirstLineTwips ?? 0));
    setSpaceBefore(format.spaceBeforePt ?? 0);
    setSpaceAfter(format.spaceAfterPt ?? 0);
    setLineRule(format.lineSpacing?.rule ?? 'multiple');
    setLineValue(format.lineSpacing?.value ?? 1.08);
    // A `null` flag means the selection disagrees. The box opens UNCHECKED and, because
    // only changed fields are sent, an untouched mixed flag is left mixed rather than
    // being flattened to off across the whole selection.
    setContextualSpacing(format.contextualSpacing === true);
    setKeepNext(format.keepNext === true);
    setKeepLines(format.keepLines === true);
    setWidowControl(format.widowControl !== false);
    setPageBreakBefore(format.pageBreakBefore === true);
    seeded.current = true;
  }, [open, format]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const handleApply = useCallback(() => {
    const signedFirstLine =
      special === 'none' ? 0 : special === 'hanging' ? -Math.abs(specialBy) : Math.abs(specialBy);
    const update: ParagraphFormatUpdate = {
      alignment,
      indentLeftTwips: indentLeft,
      indentRightTwips: indentRight,
      indentFirstLineTwips: signedFirstLine,
      spaceBeforePt: spaceBefore,
      spaceAfterPt: spaceAfter,
      lineSpacing: { rule: lineRule, value: lineValue },
      contextualSpacing,
      keepNext,
      keepLines,
      widowControl,
      pageBreakBefore,
    };
    // A refused write keeps the dialog OPEN: `apply` is honest about op-layer rejections,
    // so closing here would claim a success that did not happen.
    if (apply(update)) onClose();
  }, [
    apply,
    onClose,
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
  ]);

  if (!open) return null;

  const inchRow = (
    labelKey: 'beforeText' | 'afterText',
    value: number,
    set: (twips: number) => void
  ) => (
    <div style={rowStyle}>
      <label style={labelStyle}>{t(`dialogs.paragraph.${labelKey}`)}</label>
      <input
        type="number"
        style={inputStyle}
        step={0.1}
        value={twipsToInches(value)}
        onChange={(event) => set(inchesToTwips(Number(event.target.value) || 0))}
        aria-label={t(`dialogs.paragraph.${labelKey}`)}
      />
      <span style={unitStyle}>{t('dialogs.paragraph.unitInches')}</span>
    </div>
  );

  const pointRow = (
    labelKey: 'spaceBefore' | 'spaceAfter',
    value: number,
    set: (points: number) => void
  ) => (
    <div style={rowStyle}>
      <label style={labelStyle}>{t(`dialogs.paragraph.${labelKey}`)}</label>
      <input
        type="number"
        style={inputStyle}
        min={0}
        step={1}
        value={value}
        onChange={(event) => set(Math.max(0, Number(event.target.value) || 0))}
        aria-label={t(`dialogs.paragraph.${labelKey}`)}
      />
      <span style={unitStyle}>{t('dialogs.paragraph.unitPoints')}</span>
    </div>
  );

  const checkbox = (
    labelKey: 'contextualSpacing' | 'keepNext' | 'keepLines' | 'widowControl' | 'pageBreakBefore',
    checked: boolean,
    set: (next: boolean) => void
  ) => (
    <label style={checkRowStyle}>
      <input type="checkbox" checked={checked} onChange={(event) => set(event.target.checked)} />
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
        if (event.key === 'Enter') handleApply();
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
      >
        <div style={headerStyle}>{t('dialogs.paragraph.title')}</div>
        <div style={bodyStyle}>
          <div style={sectionLabelStyle}>{t('dialogs.paragraph.general')}</div>
          <div style={rowStyle}>
            <label style={labelStyle}>{t('dialogs.paragraph.alignment')}</label>
            <select
              style={inputStyle}
              value={alignment}
              onChange={(event) =>
                setAlignment(event.target.value as 'left' | 'center' | 'right' | 'justify')
              }
              aria-label={t('dialogs.paragraph.alignment')}
            >
              <option value="left">{t('dialogs.paragraph.alignLeft')}</option>
              <option value="center">{t('dialogs.paragraph.alignCenter')}</option>
              <option value="right">{t('dialogs.paragraph.alignRight')}</option>
              <option value="justify">{t('dialogs.paragraph.alignJustify')}</option>
            </select>
          </div>

          <div style={sectionLabelStyle}>{t('dialogs.paragraph.indentation')}</div>
          {inchRow('beforeText', indentLeft, setIndentLeft)}
          {inchRow('afterText', indentRight, setIndentRight)}
          <div style={rowStyle}>
            <label style={labelStyle}>{t('dialogs.paragraph.special')}</label>
            <select
              style={inputStyle}
              value={special}
              onChange={(event) => setSpecial(event.target.value as SpecialIndent)}
              aria-label={t('dialogs.paragraph.special')}
            >
              <option value="none">{t('dialogs.paragraph.specialNone')}</option>
              <option value="firstLine">{t('dialogs.paragraph.specialFirstLine')}</option>
              <option value="hanging">{t('dialogs.paragraph.specialHanging')}</option>
            </select>
          </div>
          {special !== 'none' ? (
            <div style={rowStyle}>
              <label style={labelStyle}>{t('dialogs.paragraph.by')}</label>
              <input
                type="number"
                style={inputStyle}
                min={0}
                step={0.1}
                value={twipsToInches(specialBy)}
                onChange={(event) =>
                  setSpecialBy(Math.max(0, inchesToTwips(Number(event.target.value) || 0)))
                }
                aria-label={t('dialogs.paragraph.by')}
              />
              <span style={unitStyle}>{t('dialogs.paragraph.unitInches')}</span>
            </div>
          ) : null}

          <div style={sectionLabelStyle}>{t('dialogs.paragraph.spacing')}</div>
          {pointRow('spaceBefore', spaceBefore, setSpaceBefore)}
          {pointRow('spaceAfter', spaceAfter, setSpaceAfter)}
          <div style={rowStyle}>
            <label style={labelStyle}>{t('dialogs.paragraph.lineSpacing')}</label>
            <select
              style={inputStyle}
              value={lineRule}
              onChange={(event) => {
                const next = event.target.value as 'multiple' | 'exact' | 'atLeast';
                setLineRule(next);
                // The value means different things per rule — LINES for multiple, POINTS
                // otherwise — so carrying 1.08 into "Exactly" would ask for a 1pt line.
                setLineValue(next === 'multiple' ? 1.08 : 12);
              }}
              aria-label={t('dialogs.paragraph.lineSpacing')}
            >
              <option value="multiple">{t('dialogs.paragraph.ruleMultiple')}</option>
              <option value="atLeast">{t('dialogs.paragraph.ruleAtLeast')}</option>
              <option value="exact">{t('dialogs.paragraph.ruleExactly')}</option>
            </select>
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>{t('dialogs.paragraph.at')}</label>
            <input
              type="number"
              style={inputStyle}
              min={0.01}
              step={lineRule === 'multiple' ? 0.01 : 1}
              value={lineValue}
              onChange={(event) => setLineValue(Number(event.target.value) || 0)}
              aria-label={t('dialogs.paragraph.at')}
            />
            <span style={unitStyle}>
              {lineRule === 'multiple' ? '' : t('dialogs.paragraph.unitPoints')}
            </span>
          </div>
          {checkbox('contextualSpacing', contextualSpacing, setContextualSpacing)}

          <div style={sectionLabelStyle}>{t('dialogs.paragraph.pagination')}</div>
          {checkbox('keepNext', keepNext, setKeepNext)}
          {checkbox('widowControl', widowControl, setWidowControl)}
          {checkbox('keepLines', keepLines, setKeepLines)}
          {checkbox('pageBreakBefore', pageBreakBefore, setPageBreakBefore)}
        </div>
        <div style={footerStyle}>
          <button type="button" style={btnStyle} onClick={onClose}>
            {t('dialogs.paragraph.cancel')}
          </button>
          <button
            type="button"
            style={{
              ...btnStyle,
              backgroundColor: 'var(--doc-accent)',
              color: 'var(--doc-accent-contrast)',
              borderColor: 'var(--doc-accent)',
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
