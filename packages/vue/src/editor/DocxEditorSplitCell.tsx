// The Split cells dialog as a context-fed part (`DocxEditor.SplitCellDialog`). The Vue twin
// of the React dialog: the limits come from the `splitCellConfig` query, and every change
// asks the engine whether that split would be honoured, so both adapters answer alike.

import type { DocxEditorChildren } from '../docx-editor-children';
import {
  initialSplitCellCounts,
  isHTMLElementNode,
  readSplitCellCounts,
  SPLIT_CELL_FALLBACK_MAX,
  type SplitCellLimits,
} from '@docx-editor.dev/core/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import {
  Fragment,
  computed,
  defineComponent,
  h,
  ref,
  useId,
  type CSSProperties,
  type PropType,
} from 'vue';
import {
  createDialogComposition,
  NativeDialog,
  useDialogGeneration,
  type DialogCustomizationProps,
  type UseDialogReturn,
} from './dialog-parts';
import { useTranslation } from '../i18n';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/** The Split cells dialog's draft, as typed. @public */
export interface SplitCellDialogFields {
  /** The number of columns, as typed. */
  columns: string;
  /** The number of rows, as typed. */
  rows: string;
}

/** Split cells dialog draft and actions. `apply` is Split. @public */
export interface UseSplitCellDialogReturn extends UseDialogReturn<SplitCellDialogFields> {
  /** The most columns and rows the cell splits into, or null outside a cell that splits. */
  readonly limits: SplitCellLimits | null;
}

/** Props for `DocxEditor.SplitCellDialog`. @public */
export interface DocxEditorSplitCellDialogProps extends DialogCustomizationProps {
  /** Whether the dialog is shown. The host owns this state. */
  open: boolean;
  /** Called on Cancel, Escape, overlay click, and after a successful Split. */
  onClose: () => void;
}

const composition = createDialogComposition<SplitCellDialogFields, 'columns' | 'rows'>(
  'SplitCellDialog'
);

/** Read the enclosing Split cells dialog draft. @public */
export function useSplitCellDialog(): UseSplitCellDialogReturn {
  return composition.useContext() as UseSplitCellDialogReturn;
}

const FALLBACK_MAX = SPLIT_CELL_FALLBACK_MAX;

const dialogProps = {
  children: Object as PropType<DocxEditorChildren>,
  open: { type: Boolean, required: true },
  onClose: { type: Function as PropType<() => void>, required: true },
  className: { type: String, default: undefined },
  style: Object as PropType<CSSProperties>,
  preset: { type: Boolean, default: true },
} as const;

const OpenSplitCellDialog = defineComponent({
  name: 'DocxEditorOpenSplitCellDialog',
  props: dialogProps,
  setup(props, { slots }) {
    const { t } = useTranslation();
    const editor = useDocxEditor();
    const currentGeneration = useDialogGeneration(() => props.open, props.onClose);
    // Read once per opening: the dialog is modal, so the cell under the caret stays put.
    const limits = editor.value?.query({ type: 'splitCellConfig' }) ?? null;
    // The first split the engine honours: two columns, else two rows, else the merged rows.
    const initial = initialSplitCellCounts(limits, (command) =>
      editor.value ? editor.value.can(command) : { ok: false, code: 'unsupported', reason: '' }
    );
    const columns = ref(initial.columns);
    const rows = ref(initial.rows);
    const refusal = ref<string | null>(null);
    const columnsId = useId();
    const rowsId = useId();
    const messageId = useId();
    // Asked again on every editor change, so a peer's edit that makes the split impossible
    // greys Split out instead of leaving a press that is refused.
    const snapshot = useEditorState((value) => value);

    const read = computed(() => readSplitCellCounts(columns.value, rows.value, limits));
    const counts = computed(() => read.value.counts);
    const verdict = computed(() => {
      void snapshot.value;
      const value = editor.value;
      const chosen = counts.value;
      return value && chosen ? value.can({ type: 'splitCell', ...chosen }) : null;
    });
    const canSplit = computed(() => verdict.value?.ok === true);
    const invalidField = computed(() =>
      read.value.problem?.kind === 'range' ? read.value.problem.field : null
    );
    const message = computed(() => {
      if (refusal.value) return refusal.value;
      const problem = read.value.problem;
      if (problem?.kind === 'range') return t('dialogs.splitCell.range', { max: problem.max });
      if (problem?.kind === 'oneCell') return t('dialogs.splitCell.oneCell');
      const current = verdict.value;
      return current && !current.ok ? localizeDisabledReason(current.reason ?? null, t) : null;
    });

    const handleSplit = () => {
      const chosen = counts.value;
      const value = editor.value;
      if (!canSplit.value || !chosen || !value) return;
      if (!currentGeneration()) {
        props.onClose();
        return;
      }
      const result = value.exec({ type: 'splitCell', rows: chosen.rows, cols: chosen.cols });
      if (result.ok) props.onClose();
      else refusal.value = localizeDisabledReason(result.reason ?? null, t);
    };

    const setValue: UseSplitCellDialogReturn['setValue'] = (field, value) => {
      if (field === 'columns') columns.value = value;
      else rows.value = value;
      refusal.value = null;
    };
    const context: UseSplitCellDialogReturn = {
      values: computed(() => ({ columns: columns.value, rows: rows.value })),
      errors: computed(() => (message.value ? { form: message.value } : {})),
      isEnabled: canSplit,
      setValue,
      apply: handleSplit,
      cancel: () => props.onClose(),
      limits,
    };
    const renderParts = composition.provideContext(context);

    const field = (
      name: keyof SplitCellDialogFields,
      id: string,
      labelKey: 'dialogs.splitCell.columns' | 'dialogs.splitCell.rows',
      value: string,
      max: number
    ) => (
      <div data-docx-part="field" data-docx-field={name} class="docx-dialog__row">
        <label class="docx-dialog__label" for={id}>
          {t(labelKey)}
        </label>
        <input
          id={id}
          type="number"
          inputmode="numeric"
          class="docx-dialog__input"
          min={1}
          max={max}
          step={1}
          value={value}
          aria-invalid={invalidField.value === name ? true : undefined}
          aria-describedby={messageId}
          onInput={(event: Event) => setValue(name, (event.target as HTMLInputElement).value)}
        />
      </div>
    );

    return () => {
      if (!props.open) return null;
      const defaults = (
        <Fragment>
          <div data-docx-part="header" class="docx-dialog__header">
            <span data-docx-part="title" class="docx-dialog__title">
              {t('table.splitCell')}
            </span>
          </div>
          <div data-docx-part="body" class="docx-dialog__body">
            {field(
              'columns',
              columnsId,
              'dialogs.splitCell.columns',
              columns.value,
              limits?.maxCols ?? FALLBACK_MAX
            )}
            {field(
              'rows',
              rowsId,
              'dialogs.splitCell.rows',
              rows.value,
              limits?.maxRows ?? FALLBACK_MAX
            )}
            <div class="docx-dialog__row">
              <span id={messageId} data-docx-part="error" role="status" class="docx-dialog__error">
                {message.value}
              </span>
            </div>
          </div>
          <div data-docx-part="footer" class="docx-dialog__footer">
            <button
              data-docx-part="apply"
              class="docx-dialog__button docx-dialog__apply"
              type="button"
              disabled={!canSplit.value}
              onClick={handleSplit}
            >
              {t('dialogs.splitCell.submit')}
            </button>
            <button
              data-docx-part="cancel"
              class="docx-dialog__button docx-dialog__cancel"
              type="button"
              onClick={props.onClose}
            >
              {t('common.cancel')}
            </button>
          </div>
        </Fragment>
      );
      return (
        <NativeDialog
          kind="splitCell"
          label={t('table.splitCell')}
          onClose={props.onClose}
          class={props.className}
          style={props.style}
          onKeydown={(event: KeyboardEvent) => {
            if (
              event.key === 'Enter' &&
              !event.isComposing &&
              // Safari ends a composition with a keydown that reads 229, not Enter's code.
              event.keyCode !== 229 &&
              isHTMLElementNode(event.target) &&
              event.target.localName === 'input'
            ) {
              event.preventDefault();
              handleSplit();
            }
          }}
          content={() =>
            renderParts(
              defaults,
              slots.default?.() ?? (props.children ? [props.children] : []),
              props.preset
            )
          }
        />
      );
    };
  },
});

/** The dialog is mounted only while it is open, so each opening starts a fresh draft. */
const SplitCellDialogImpl = defineComponent({
  name: 'DocxEditorSplitCellDialog',
  props: dialogProps,
  setup(props, { slots }) {
    return () => (props.open ? h(OpenSplitCellDialog, { ...props }, slots) : null);
  },
});

/** The Split cells dialog with replaceable controls and layout. @public */
export const DocxEditorSplitCellDialog = Object.assign(SplitCellDialogImpl, {
  ...composition.parts,
});
