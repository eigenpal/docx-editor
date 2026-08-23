// The Paragraph dialog — the Vue twin of the React part. Alignment, indentation with its
// Special/By pair, spacing with its line-spacing rule and value, and the flags. The whole
// form is written back as ONE `setParagraphFormat` on OK, so the dialog is a single undo
// step. The host owns visibility (`open`/`onClose`); the engine owns everything else.

import {
  defineComponent,
  getCurrentInstance,
  nextTick,
  ref,
  watch,
  type CSSProperties,
  type PropType,
} from 'vue';
import { Teleport } from 'vue';
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
  borderRadius: '8px',
  boxShadow: '0 4px 20px var(--doc-shadow)',
  minWidth: '620px',
  maxWidth: '720px',
  width: '100%',
  margin: '20px',
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
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--doc-text)',
};

const bodyStyle: CSSProperties = {
  padding: '16px 20px',
  // The one part that scrolls, so the header and the buttons stay put.
  overflowY: 'auto',
  minHeight: 0,
};

// Two columns, the way Word lays this dialog out: General and Indentation and the tab
// stops on the left, Spacing and Pagination on the right. It halves the height, so the
// whole form fits an ordinary viewport without scrolling.
const columnsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '28px',
};
const columnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  minWidth: 0,
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
  width: '92px',
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
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '8px',
  flexShrink: 0,
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

/** The Paragraph dialog, applied as one undoable command. @public */
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
    const tabStops = ref<readonly ParagraphTabStop[]>([]);
    const clearedAllTabStops = ref(false);
    const newTabPosition = ref(0);
    const newTabAlignment = ref<TabAlignment>('left');
    const newTabLeader = ref<TabLeaderName>('none');
    const seeded = ref(false);
    const seedRef = ref<ParagraphDialogFields | null>(null);
    const mixed = ref<ParagraphDialogMixed>(NO_MIXED_FIELDS);
    const indentUnknown = ref(false);
    /** What the selection disagreed about ON OPEN, against which `mixed` says what was resolved. */
    const seedMixed = ref<ParagraphDialogMixed>(NO_MIXED_FIELDS);
    // Reached through the instance rather than a template ref: this component's vnodes are
    // hoistable, and Vue refuses a `ref` on a hoisted vnode ("Missing ref owner context"),
    // which left the dialog opening unfocused and Escape doing nothing.
    const instance = getCurrentInstance();
    // Queried from the document, not the component's own element: the dialog teleports to
    // the body, so `instance.vnode.el` is only the teleport's anchor comment. One dialog is
    // open per host at a time, and the `Paragraph` label disambiguates it.
    const panelOf = (): HTMLElement | null =>
      document.querySelector('[role="dialog"][aria-label="' + t('dialogs.paragraph.title') + '"]');
    const refused = ref(false);
    // One prefix per mounted dialog, so a `<label for>` points at THIS dialog's input even
    // when a host renders two. Clicking a visible label is how a pointer user hits a small
    // control, and `aria-label` alone does not give them that. React uses `useId`; Vue has
    // no equivalent, and the instance uid is already unique per component.
    const fieldId = `docx-paragraph-${instance?.uid ?? 0}`;
    // Seed from the selection when the dialog OPENS — not on every tick, or a concurrent
    // edit would fight the user's typing.
    watch(
      () => [props.open, paragraph.format.value] as const,
      ([open, format]) => {
        if (!open) {
          seeded.value = false;
          // Closing deliberately does NOT hand focus back to the document; see the note on
          // the React twin's focus effect for the three mechanisms that were tried and why
          // each was worse than leaving the document alone.
          return;
        }
        if (seeded.value || format === null) return;
        const seed = seedFields(format);
        alignment.value = seed.alignment;
        indentLeft.value = seed.indentLeft;
        indentRight.value = seed.indentRight;
        special.value = seed.special;
        specialBy.value = seed.specialBy;
        spaceBefore.value = seed.spaceBefore;
        spaceAfter.value = seed.spaceAfter;
        lineRule.value = seed.lineRule;
        lineValue.value = seed.lineValue;
        // A `null` flag means the selection DISAGREES. The box opens unchecked and shows
        // indeterminate; `seedRef` remembers it so an untouched flag is not written.
        contextualSpacing.value = seed.contextualSpacing;
        keepNext.value = seed.keepNext;
        keepLines.value = seed.keepLines;
        widowControl.value = seed.widowControl;
        pageBreakBefore.value = seed.pageBreakBefore;
        tabStops.value = seed.tabStops;
        clearedAllTabStops.value = false;
        mixed.value = mixedFieldsOf(format);
        indentUnknown.value = format.indentUnknown;
        // The entry row is a scratch pad, not a setting: leaving "Decimal" or a leader on
        // it preloaded the next paragraph — and the next document — with a choice made
        // elsewhere.
        newTabPosition.value = 0;
        newTabAlignment.value = 'left';
        newTabLeader.value = 'none';
        seedMixed.value = mixed.value;
        refused.value = false;
        seedRef.value = seed;
        seeded.value = true;
        // Focus the panel so Escape reaches the overlay's key handler. Without it the
        // dialog cannot be dismissed from the keyboard until the user tabs into it.
        void nextTick(() => panelOf()?.focus());
      },
      { immediate: true }
    );

    /** Add or replace the stop at this position — "Set" replaces one already there. */
    /**
     * Add or replace the stop at this position — "Set" replaces one already there.
     *
     * A position of zero is not a stop: the field opens at 0, so pressing Set without
     * typing anything used to add a real `0 in` row that OK then wrote to the document.
     */
    const setTabStop = (): boolean => {
      const positionTwips = Math.round(newTabPosition.value);
      if (positionTwips <= 0) return false;
      mixed.value = { ...mixed.value, tabStops: false };
      tabStops.value = withTabStop(tabStops.value, {
        positionTwips,
        alignment: newTabAlignment.value,
        ...(newTabLeader.value !== 'none' ? { leader: newTabLeader.value } : {}),
      });
      newTabPosition.value = 0;
      newTabAlignment.value = 'left';
      newTabLeader.value = 'none';
      return true;
    };

    const handleApply = (): void => {
      const seed = seedRef.value;
      const update =
        seed === null
          ? null
          : changedFields(
              seed,
              {
                alignment: alignment.value,
                indentLeft: indentLeft.value,
                indentRight: indentRight.value,
                special: special.value,
                specialBy: specialBy.value,
                spaceBefore: spaceBefore.value,
                spaceAfter: spaceAfter.value,
                lineRule: lineRule.value,
                lineValue: lineValue.value,
                contextualSpacing: contextualSpacing.value,
                keepNext: keepNext.value,
                keepLines: keepLines.value,
                widowControl: widowControl.value,
                pageBreakBefore: pageBreakBefore.value,
                tabStops: tabStops.value,
                clearedAllTabStops: clearedAllTabStops.value,
              },
              seedMixed.value,
              mixed.value
            );
      // Nothing moved, so there is nothing to write. Closing is the whole job.
      if (update === null) {
        props.onClose();
        return;
      }
      // A refused write keeps the dialog OPEN rather than claiming a success that did not
      // happen. It has to SAY so — a dialog that swallows the OK and sits there looks
      // broken rather than refused.
      if (paragraph.apply(update)) {
        refused.value = false;
        props.onClose();
        return;
      }
      refused.value = true;
    };

    return () => {
      if (!props.open) return null;

      /**
       * Clear the mixed mark for one field, so what the control now shows is a decision.
       *
       * A number or select has no indeterminate state, so a disagreement renders as an
       * empty box. The moment the user picks something, the control means what it says —
       * and `changedFields` has to be told, or setting a mixed selection to the value it
       * was already displaying writes nothing and the paragraphs stay disagreeing.
       */
      // An indent the engine cannot place — a paragraph in a table cell — reads blank like
      // a disagreement but is not one, so it says so rather than claiming the selection is
      // mixed. The React twin carries the same helper; no gate compares the two dialogs.
      const blankLabel = (key: keyof ParagraphDialogMixed): string =>
        indentUnknown.value && (key === 'indentLeft' || key === 'indentRight' || key === 'special')
          ? t('dialogs.paragraph.notShown')
          : t('dialogs.paragraph.mixed');

      const resolve = (key: keyof ParagraphDialogMixed): void => {
        mixed.value = { ...mixed.value, [key]: false };
      };

      const inchRow = (
        labelKey: 'beforeText' | 'afterText' | 'by' | 'tabPosition',
        value: number,
        set: (twips: number) => void,
        mixedKey?: keyof ParagraphDialogMixed
      ) => (
        <div style={rowStyle}>
          <label style={labelStyle} for={`${fieldId}-${labelKey}`}>
            {t(`dialogs.paragraph.${labelKey}`)}
          </label>
          <input
            id={`${fieldId}-${labelKey}`}
            type="number"
            style={inputStyle}
            min="0"
            step="0.1"
            {...(labelKey === 'tabPosition' ? { 'data-docx-tab-entry': '' } : {})}
            value={mixedKey && mixed.value[mixedKey] ? '' : twipsToInches(value)}
            placeholder={mixedKey && mixed.value[mixedKey] ? blankLabel(mixedKey) : undefined}
            onInput={(event) => {
              if (mixedKey) resolve(mixedKey);
              set(inchesToTwips(Number((event.target as HTMLInputElement).value) || 0));
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
          <label style={labelStyle} for={`${fieldId}-${labelKey}`}>
            {t(`dialogs.paragraph.${labelKey}`)}
          </label>
          <input
            id={`${fieldId}-${labelKey}`}
            type="number"
            style={inputStyle}
            min="0"
            step="1"
            value={mixed.value[mixedKey] ? '' : value}
            placeholder={mixed.value[mixedKey] ? blankLabel(mixedKey) : undefined}
            onInput={(event) => {
              resolve(mixedKey);
              set(Math.max(0, Number((event.target as HTMLInputElement).value) || 0));
            }}
            aria-label={t(`dialogs.paragraph.${labelKey}`)}
          />
          <span style={unitStyle}>{t('dialogs.paragraph.unitPoints')}</span>
        </div>
      );

      const checkbox = (
        labelKey: ParagraphFlagKey,
        checked: boolean,
        set: (next: boolean) => void
      ) => (
        <label style={checkRowStyle}>
          <input
            type="checkbox"
            checked={checked}
            // A setting the selection disagrees about is INDETERMINATE, not unchecked —
            // unchecked would claim the paragraphs agree it is off. `indeterminate` is a
            // DOM property with no attribute, so it is bound with Vue's `.` prefix, which
            // patches it as a property rather than as markup.
            {...{ '.indeterminate': mixed.value[labelKey] }}
            onChange={(event) => {
              // Touching the box RESOLVES the disagreement: from here it means what it shows.
              mixed.value = { ...mixed.value, [labelKey]: false };
              set((event.target as HTMLInputElement).checked);
            }}
          />
          {t(`dialogs.paragraph.${labelKey}`)}
        </label>
      );

      // The overlay carries `.docx-editor` and the editor's dark state, because this dialog
      // teleports to the body and `--doc-*` tokens are scoped under that class — outside it
      // every token resolves to nothing, leaving a transparent panel over an undimmed page.
      // The dark state is copied from the live editor element rather than threaded through.
      const scoped =
        typeof document !== 'undefined' ? document.querySelector('.docx-editor') : null;
      const scopeClass = `docx-editor${scoped?.classList.contains('dark') ? ' dark' : ''}`;

      return (
        <Teleport to="body">
          <div
            class={`${scopeClass}${props.className ? ` ${props.className}` : ''}`}
            style={overlayStyle}
            onClick={props.onClose}
            onKeydown={(event: KeyboardEvent) => {
              if (event.key === 'Escape') props.onClose();
              const panel = panelOf();
              if (panel && trapTabWithin(panel, event)) event.preventDefault();
              // Enter is the form's default submit, EXCEPT on a control that owns the key: a
              // button acts on the Enter that focused it, and keydown here runs first, so
              // Cancel pressed from the keyboard would otherwise apply the form first.
              // Enter is the form's default submit, EXCEPT on a control that owns the key: a
              // button acts on the Enter that focused it, and a `<select>` uses it to commit
              // the option the user has arrowed to.
              const ownsEnter =
                event.target instanceof HTMLButtonElement ||
                event.target instanceof HTMLSelectElement;
              if (event.key === 'Enter' && !ownsEnter) {
                // Enter inside the tab-stop entry row means "Set", the way it does in Word.
                // Submitting the whole form there threw the pending row away without a word:
                // it is not part of `tabStops` yet, so OK closed and wrote nothing.
                const target = event.target;
                if (target instanceof HTMLElement && target.dataset.docxTabEntry !== undefined) {
                  setTabStop();
                  return;
                }
                if (paragraph.isEnabled.value) handleApply();
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t('dialogs.paragraph.title')}
              tabindex={-1}
              style={dialogStyle}
              onClick={(event: MouseEvent) => event.stopPropagation()}
              // Painted pages ARE the editable surface, so any mousedown that reaches them
              // moves the caret — and the dialog formats whatever the caret is on.
              onMousedown={(event: MouseEvent) => event.stopPropagation()}
            >
              <div style={headerStyle}>{t('dialogs.paragraph.title')}</div>
              <div style={bodyStyle}>
                <div style={columnsStyle}>
                  <div style={columnStyle}>
                    <div style={sectionLabelStyle}>{t('dialogs.paragraph.general')}</div>
                    <div style={rowStyle}>
                      <label style={labelStyle} for={`${fieldId}-alignment`}>
                        {t('dialogs.paragraph.alignment')}
                      </label>
                      <select
                        id={`${fieldId}-alignment`}
                        style={inputStyle}
                        value={mixed.value.alignment ? '' : alignment.value}
                        onChange={(event) => {
                          resolve('alignment');
                          alignment.value = (event.target as HTMLSelectElement)
                            .value as typeof alignment.value;
                        }}
                        aria-label={t('dialogs.paragraph.alignment')}
                      >
                        {mixed.value.alignment ? (
                          <option value="">{t('dialogs.paragraph.mixed')}</option>
                        ) : null}
                        <option value="left">{t('dialogs.paragraph.alignLeft')}</option>
                        <option value="center">{t('dialogs.paragraph.alignCenter')}</option>
                        <option value="right">{t('dialogs.paragraph.alignRight')}</option>
                        <option value="justify">{t('dialogs.paragraph.alignJustify')}</option>
                      </select>
                    </div>

                    <div style={sectionLabelStyle}>{t('dialogs.paragraph.indentation')}</div>
                    {inchRow(
                      'beforeText',
                      indentLeft.value,
                      (twips) => {
                        indentLeft.value = twips;
                      },
                      'indentLeft'
                    )}
                    {inchRow(
                      'afterText',
                      indentRight.value,
                      (twips) => {
                        indentRight.value = twips;
                      },
                      'indentRight'
                    )}
                    <div style={rowStyle}>
                      <label style={labelStyle} for={`${fieldId}-special`}>
                        {t('dialogs.paragraph.special')}
                      </label>
                      <select
                        id={`${fieldId}-special`}
                        style={inputStyle}
                        value={mixed.value.special ? '' : special.value}
                        onChange={(event) => {
                          resolve('special');
                          special.value = (event.target as HTMLSelectElement)
                            .value as SpecialIndent;
                        }}
                        aria-label={t('dialogs.paragraph.special')}
                      >
                        {mixed.value.special ? (
                          <option value="">{blankLabel('special')}</option>
                        ) : null}
                        <option value="none">{t('dialogs.paragraph.specialNone')}</option>
                        <option value="firstLine">{t('dialogs.paragraph.specialFirstLine')}</option>
                        <option value="hanging">{t('dialogs.paragraph.specialHanging')}</option>
                      </select>
                    </div>
                    {special.value !== 'none'
                      ? inchRow(
                          'by',
                          specialBy.value,
                          (twips) => {
                            specialBy.value = Math.max(0, twips);
                          },
                          'special'
                        )
                      : null}

                    <div style={sectionLabelStyle}>{t('dialogs.paragraph.tabStops')}</div>
                    {tabStops.value.length === 0 ? (
                      <div style={{ fontSize: '12px', color: 'var(--doc-text-muted)' }}>
                        {/* An empty list over a MIXED selection would read as "none of these
                          paragraphs has a tab stop", which is the opposite of what is true. */}
                        {t(
                          mixed.value.tabStops
                            ? 'dialogs.paragraph.tabMixed'
                            : 'dialogs.paragraph.tabEmpty'
                        )}
                      </div>
                    ) : (
                      tabStops.value.map((stop) => (
                        <div key={stop.positionTwips} style={rowStyle}>
                          <span style={{ ...labelStyle, color: 'var(--doc-text)' }}>
                            {t('dialogs.paragraph.tabPositionLabel', {
                              position: formatInches(stop.positionTwips),
                            })}
                          </span>
                          <span
                            style={{ flex: 1, fontSize: '13px', color: 'var(--doc-text-muted)' }}
                          >
                            {t(TAB_ALIGNMENT_LABELS[stop.alignment])}
                          </span>
                          <button
                            type="button"
                            style={btnStyle}
                            onClick={() => {
                              tabStops.value = tabStops.value.filter((entry) => entry !== stop);
                            }}
                            aria-label={t('dialogs.paragraph.tabRemoveAt', {
                              position: formatInches(stop.positionTwips),
                            })}
                          >
                            {t('dialogs.paragraph.tabRemove')}
                          </button>
                        </div>
                      ))
                    )}
                    {inchRow('tabPosition', newTabPosition.value, (twips) => {
                      newTabPosition.value = Math.max(0, twips);
                    })}
                    <div style={rowStyle}>
                      <label style={labelStyle} for={`${fieldId}-tabAlignment`}>
                        {t('dialogs.paragraph.tabAlignment')}
                      </label>
                      <select
                        id={`${fieldId}-tabAlignment`}
                        style={inputStyle}
                        value={newTabAlignment.value}
                        onChange={(event) => {
                          newTabAlignment.value = (event.target as HTMLSelectElement)
                            .value as TabAlignment;
                        }}
                        aria-label={t('dialogs.paragraph.tabAlignment')}
                        data-docx-tab-entry=""
                      >
                        <option value="left">{t('dialogs.paragraph.tabAlignLeft')}</option>
                        <option value="center">{t('dialogs.paragraph.tabAlignCenter')}</option>
                        <option value="right">{t('dialogs.paragraph.tabAlignRight')}</option>
                        {/* No `bar`: it draws a vertical rule rather than stopping the caret, so the
                              engine neither paints it nor reports it back. Offering it here
                              would add a row that vanishes on OK. */}
                        <option value="decimal">{t('dialogs.paragraph.tabAlignDecimal')}</option>
                      </select>
                    </div>
                    <div style={rowStyle}>
                      <label style={labelStyle} for={`${fieldId}-tabLeader`}>
                        {t('dialogs.paragraph.tabLeader')}
                      </label>
                      <select
                        id={`${fieldId}-tabLeader`}
                        style={inputStyle}
                        value={newTabLeader.value}
                        onChange={(event) => {
                          newTabLeader.value = (event.target as HTMLSelectElement)
                            .value as TabLeaderName;
                        }}
                        aria-label={t('dialogs.paragraph.tabLeader')}
                        data-docx-tab-entry=""
                      >
                        <option value="none">{t('dialogs.paragraph.tabNone')}</option>
                        <option value="dot">{t('dialogs.paragraph.tabLeaderDot')}</option>
                        <option value="hyphen">{t('dialogs.paragraph.tabLeaderHyphen')}</option>
                        <option value="underscore">
                          {t('dialogs.paragraph.tabLeaderUnderscore')}
                        </option>
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
                          mixed.value = { ...mixed.value, tabStops: false };
                          tabStops.value = [];
                        }}
                      >
                        {t('dialogs.paragraph.tabClearAll')}
                      </button>
                    </div>
                  </div>
                  <div style={columnStyle}>
                    <div style={sectionLabelStyle}>{t('dialogs.paragraph.spacing')}</div>
                    {pointRow(
                      'spaceBefore',
                      spaceBefore.value,
                      (points) => {
                        spaceBefore.value = points;
                      },
                      'spaceBefore'
                    )}
                    {pointRow(
                      'spaceAfter',
                      spaceAfter.value,
                      (points) => {
                        spaceAfter.value = points;
                      },
                      'spaceAfter'
                    )}
                    <div style={rowStyle}>
                      <label style={labelStyle} for={`${fieldId}-lineSpacing`}>
                        {t('dialogs.paragraph.lineSpacing')}
                      </label>
                      <select
                        id={`${fieldId}-lineSpacing`}
                        style={inputStyle}
                        value={mixed.value.lineSpacing ? '' : lineRule.value}
                        onChange={(event) => {
                          const next = (event.target as HTMLSelectElement)
                            .value as typeof lineRule.value;
                          // Picking a rule RESOLVES the disagreement — without this the select
                          // snapped back to blank and the value box stayed disabled forever, so a
                          // mixed line spacing could not be corrected at all.
                          resolve('lineSpacing');
                          lineRule.value = next;
                          // The value means LINES under Multiple and POINTS otherwise, so carrying
                          // 1.08 into "Exactly" would ask for a 1pt line box.
                          // Back to the rule it opened on means back to the value it opened
                          // on, or a user who picked "Exactly" and changed their mind would
                          // silently write 1.08 over the 1.15 their style supplies.
                          lineValue.value =
                            next === seedRef.value?.lineRule
                              ? seedRef.value.lineValue
                              : next === 'multiple'
                                ? 1.08
                                : 12;
                        }}
                        aria-label={t('dialogs.paragraph.lineSpacing')}
                      >
                        {mixed.value.lineSpacing ? (
                          <option value="">{t('dialogs.paragraph.mixed')}</option>
                        ) : null}
                        <option value="multiple">{t('dialogs.paragraph.ruleMultiple')}</option>
                        <option value="atLeast">{t('dialogs.paragraph.ruleAtLeast')}</option>
                        <option value="exact">{t('dialogs.paragraph.ruleExactly')}</option>
                      </select>
                    </div>
                    <div style={rowStyle}>
                      <label style={labelStyle} for={`${fieldId}-at`}>
                        {t('dialogs.paragraph.at')}
                      </label>
                      <input
                        id={`${fieldId}-at`}
                        type="number"
                        style={inputStyle}
                        // No `resolve` on this box: a number cannot say whether it means lines or
                        // points. The rule select owns that, so until a rule is picked this is
                        // disabled — typing 16 here over a mixed selection used to write sixteen
                        // line-heights.
                        disabled={mixed.value.lineSpacing}
                        min="0.01"
                        step={lineRule.value === 'multiple' ? '0.01' : '1'}
                        value={mixed.value.lineSpacing ? '' : lineValue.value}
                        onInput={(event) => {
                          const next = (event.target as HTMLInputElement).value.trim();
                          lineValue.value =
                            next === ''
                              ? lineRule.value === 'multiple'
                                ? 1.08
                                : 12
                              : Number(next) || 0;
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
                </div>
              </div>
              <div style={footerStyle}>
                {/* `role="alert"` so the refusal is announced, not just drawn. */}
                {refused.value ? (
                  <span role="alert" style={refusedStyle}>
                    {t('dialogs.paragraph.refused')}
                  </span>
                ) : null}
                <button type="button" style={btnStyle} onClick={props.onClose}>
                  {t('dialogs.paragraph.cancel')}
                </button>
                <button
                  type="button"
                  style={{
                    ...btnStyle,
                    backgroundColor: 'var(--doc-primary)',
                    color: 'var(--doc-on-primary)',
                    borderColor: 'var(--doc-primary)',
                    // The same dimming `DocxEditorPageSetup` uses. These two dialogs sit
                    // beside each other in the same product; they cannot disagree about what
                    // a primary button looks like.
                    opacity: paragraph.isEnabled.value ? 1 : 0.5,
                  }}
                  disabled={!paragraph.isEnabled.value}
                  onClick={handleApply}
                >
                  {t('dialogs.paragraph.ok')}
                </button>
              </div>
            </div>
          </div>
        </Teleport>
      );
    };
  },
});
