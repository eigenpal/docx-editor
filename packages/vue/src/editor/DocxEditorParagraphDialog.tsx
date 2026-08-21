// Word's Paragraph dialog — the Vue twin of the React part. Alignment, indentation with its
// Special/By pair, spacing with its line-spacing rule and value, and the flags. The whole
// form is written back as ONE `setParagraphFormat` on OK, so the dialog is a single undo
// step. The host owns visibility (`open`/`onClose`); the engine owns everything else.

import { defineComponent, ref, watch, type CSSProperties, type PropType } from 'vue';
import { useTranslation } from '../i18n';
import { useParagraphFormat, type ParagraphFormatUpdate } from './useParagraphFormat';

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
  borderRadius: '8px',
  boxShadow: '0 4px 20px var(--doc-shadow)',
  minWidth: '460px',
  maxWidth: '560px',
  width: '100%',
  margin: '20px',
  maxHeight: '90vh',
  overflowY: 'auto',
};

const headerStyle: CSSProperties = {
  padding: '16px 20px 12px',
  borderBottom: '1px solid var(--doc-border)',
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--doc-text)',
};

const bodyStyle: CSSProperties = {
  padding: '16px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
};

const sectionLabelStyle: CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--doc-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '12px' };
const labelStyle: CSSProperties = {
  width: '110px',
  fontSize: '13px',
  color: 'var(--doc-text-muted)',
};
const inputStyle: CSSProperties = {
  flex: 1,
  padding: '6px 8px',
  border: '1px solid var(--doc-border)',
  borderRadius: '4px',
  fontSize: '13px',
  backgroundColor: 'var(--doc-surface)',
  color: 'var(--doc-text)',
};
const unitStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--doc-text-muted)',
  width: '20px',
};
const checkRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '13px',
  color: 'var(--doc-text)',
};
const footerStyle: CSSProperties = {
  padding: '12px 20px 16px',
  borderTop: '1px solid var(--doc-border)',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
};
const btnStyle: CSSProperties = {
  padding: '6px 16px',
  fontSize: '13px',
  border: '1px solid var(--doc-border)',
  borderRadius: '4px',
  cursor: 'pointer',
  backgroundColor: 'var(--doc-surface)',
  color: 'var(--doc-text)',
};

/** Props for `DocxEditorParagraphDialog`. @public */
export interface DocxEditorParagraphDialogProps {
  open: boolean;
  onClose: () => void;
  className?: string;
}

/** Word's Paragraph dialog, applied as one undoable command. @public */
export const DocxEditorParagraphDialog = defineComponent({
  name: 'DocxEditorParagraphDialog',
  props: {
    open: { type: Boolean, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
    className: { type: String, default: undefined },
  },
  setup(props) {
    const { t } = useTranslation();
    const paragraph = useParagraphFormat();

    const alignment = ref<'left' | 'center' | 'right' | 'justify'>('left');
    const indentLeft = ref(0);
    const indentRight = ref(0);
    const special = ref<SpecialIndent>('none');
    const specialBy = ref(0);
    const spaceBefore = ref(0);
    const spaceAfter = ref(0);
    const lineRule = ref<'multiple' | 'exact' | 'atLeast'>('multiple');
    const lineValue = ref(1.08);
    const contextualSpacing = ref(false);
    const keepNext = ref(false);
    const keepLines = ref(false);
    const widowControl = ref(true);
    const pageBreakBefore = ref(false);
    const seeded = ref(false);

    // Seed from the selection when the dialog OPENS — not on every tick, or a concurrent
    // edit would fight the user's typing.
    watch(
      () => [props.open, paragraph.format.value] as const,
      ([open, format]) => {
        if (!open) {
          seeded.value = false;
          return;
        }
        if (seeded.value || format === null) return;
        alignment.value = format.alignment === 'both' ? 'justify' : (format.alignment ?? 'left');
        indentLeft.value = format.indentLeftTwips ?? 0;
        indentRight.value = format.indentRightTwips ?? 0;
        special.value = specialOf(format.indentFirstLineTwips);
        specialBy.value = Math.abs(format.indentFirstLineTwips ?? 0);
        spaceBefore.value = format.spaceBeforePt ?? 0;
        spaceAfter.value = format.spaceAfterPt ?? 0;
        lineRule.value = format.lineSpacing?.rule ?? 'multiple';
        lineValue.value = format.lineSpacing?.value ?? 1.08;
        // A `null` flag means the selection disagrees; the box opens unchecked.
        contextualSpacing.value = format.contextualSpacing === true;
        keepNext.value = format.keepNext === true;
        keepLines.value = format.keepLines === true;
        widowControl.value = format.widowControl !== false;
        pageBreakBefore.value = format.pageBreakBefore === true;
        seeded.value = true;
      },
      { immediate: true }
    );

    const handleApply = (): void => {
      const signedFirstLine =
        special.value === 'none'
          ? 0
          : special.value === 'hanging'
            ? -Math.abs(specialBy.value)
            : Math.abs(specialBy.value);
      const update: ParagraphFormatUpdate = {
        alignment: alignment.value,
        indentLeftTwips: indentLeft.value,
        indentRightTwips: indentRight.value,
        indentFirstLineTwips: signedFirstLine,
        spaceBeforePt: spaceBefore.value,
        spaceAfterPt: spaceAfter.value,
        lineSpacing: { rule: lineRule.value, value: lineValue.value },
        contextualSpacing: contextualSpacing.value,
        keepNext: keepNext.value,
        keepLines: keepLines.value,
        widowControl: widowControl.value,
        pageBreakBefore: pageBreakBefore.value,
      };
      // A refused write keeps the dialog OPEN rather than claiming a success that did not
      // happen.
      if (paragraph.apply(update)) props.onClose();
    };

    return () => {
      if (!props.open) return null;

      const inchRow = (
        labelKey: 'beforeText' | 'afterText' | 'by',
        value: number,
        set: (twips: number) => void
      ) => (
        <div style={rowStyle}>
          <label style={labelStyle}>{t(`dialogs.paragraph.${labelKey}`)}</label>
          <input
            type="number"
            style={inputStyle}
            step="0.1"
            value={twipsToInches(value)}
            onInput={(event) =>
              set(inchesToTwips(Number((event.target as HTMLInputElement).value) || 0))
            }
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
            min="0"
            step="1"
            value={value}
            onInput={(event) =>
              set(Math.max(0, Number((event.target as HTMLInputElement).value) || 0))
            }
            aria-label={t(`dialogs.paragraph.${labelKey}`)}
          />
          <span style={unitStyle}>{t('dialogs.paragraph.unitPoints')}</span>
        </div>
      );

      const checkbox = (
        labelKey:
          | 'contextualSpacing'
          | 'keepNext'
          | 'keepLines'
          | 'widowControl'
          | 'pageBreakBefore',
        checked: boolean,
        set: (next: boolean) => void
      ) => (
        <label style={checkRowStyle}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => set((event.target as HTMLInputElement).checked)}
          />
          {t(`dialogs.paragraph.${labelKey}`)}
        </label>
      );

      return (
        <div
          class={props.className}
          style={overlayStyle}
          onClick={props.onClose}
          onKeydown={(event: KeyboardEvent) => {
            if (event.key === 'Escape') props.onClose();
            if (event.key === 'Enter') handleApply();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('dialogs.paragraph.title')}
            tabindex={-1}
            style={dialogStyle}
            onClick={(event: MouseEvent) => event.stopPropagation()}
          >
            <div style={headerStyle}>{t('dialogs.paragraph.title')}</div>
            <div style={bodyStyle}>
              <div style={sectionLabelStyle}>{t('dialogs.paragraph.general')}</div>
              <div style={rowStyle}>
                <label style={labelStyle}>{t('dialogs.paragraph.alignment')}</label>
                <select
                  style={inputStyle}
                  value={alignment.value}
                  onChange={(event) => {
                    alignment.value = (event.target as HTMLSelectElement)
                      .value as typeof alignment.value;
                  }}
                  aria-label={t('dialogs.paragraph.alignment')}
                >
                  <option value="left">{t('dialogs.paragraph.alignLeft')}</option>
                  <option value="center">{t('dialogs.paragraph.alignCenter')}</option>
                  <option value="right">{t('dialogs.paragraph.alignRight')}</option>
                  <option value="justify">{t('dialogs.paragraph.alignJustify')}</option>
                </select>
              </div>

              <div style={sectionLabelStyle}>{t('dialogs.paragraph.indentation')}</div>
              {inchRow('beforeText', indentLeft.value, (twips) => {
                indentLeft.value = twips;
              })}
              {inchRow('afterText', indentRight.value, (twips) => {
                indentRight.value = twips;
              })}
              <div style={rowStyle}>
                <label style={labelStyle}>{t('dialogs.paragraph.special')}</label>
                <select
                  style={inputStyle}
                  value={special.value}
                  onChange={(event) => {
                    special.value = (event.target as HTMLSelectElement).value as SpecialIndent;
                  }}
                  aria-label={t('dialogs.paragraph.special')}
                >
                  <option value="none">{t('dialogs.paragraph.specialNone')}</option>
                  <option value="firstLine">{t('dialogs.paragraph.specialFirstLine')}</option>
                  <option value="hanging">{t('dialogs.paragraph.specialHanging')}</option>
                </select>
              </div>
              {special.value !== 'none'
                ? inchRow('by', specialBy.value, (twips) => {
                    specialBy.value = Math.max(0, twips);
                  })
                : null}

              <div style={sectionLabelStyle}>{t('dialogs.paragraph.spacing')}</div>
              {pointRow('spaceBefore', spaceBefore.value, (points) => {
                spaceBefore.value = points;
              })}
              {pointRow('spaceAfter', spaceAfter.value, (points) => {
                spaceAfter.value = points;
              })}
              <div style={rowStyle}>
                <label style={labelStyle}>{t('dialogs.paragraph.lineSpacing')}</label>
                <select
                  style={inputStyle}
                  value={lineRule.value}
                  onChange={(event) => {
                    const next = (event.target as HTMLSelectElement).value as typeof lineRule.value;
                    lineRule.value = next;
                    // The value means LINES under Multiple and POINTS otherwise, so carrying
                    // 1.08 into "Exactly" would ask for a 1pt line box.
                    lineValue.value = next === 'multiple' ? 1.08 : 12;
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
                  min="0.01"
                  step={lineRule.value === 'multiple' ? '0.01' : '1'}
                  value={lineValue.value}
                  onInput={(event) => {
                    lineValue.value = Number((event.target as HTMLInputElement).value) || 0;
                  }}
                  aria-label={t('dialogs.paragraph.at')}
                />
                <span style={unitStyle}>
                  {lineRule.value === 'multiple' ? '' : t('dialogs.paragraph.unitPoints')}
                </span>
              </div>
              {checkbox('contextualSpacing', contextualSpacing.value, (next) => {
                contextualSpacing.value = next;
              })}

              <div style={sectionLabelStyle}>{t('dialogs.paragraph.pagination')}</div>
              {checkbox('keepNext', keepNext.value, (next) => {
                keepNext.value = next;
              })}
              {checkbox('widowControl', widowControl.value, (next) => {
                widowControl.value = next;
              })}
              {checkbox('keepLines', keepLines.value, (next) => {
                keepLines.value = next;
              })}
              {checkbox('pageBreakBefore', pageBreakBefore.value, (next) => {
                pageBreakBefore.value = next;
              })}
            </div>
            <div style={footerStyle}>
              <button type="button" style={btnStyle} onClick={props.onClose}>
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
                disabled={!paragraph.isEnabled.value}
                onClick={handleApply}
              >
                {t('dialogs.paragraph.ok')}
              </button>
            </div>
          </div>
        </div>
      );
    };
  },
});
