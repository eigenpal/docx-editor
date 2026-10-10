import {
  computed,
  defineComponent,
  inject,
  onMounted,
  onUnmounted,
  provide,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type InjectionKey,
} from 'vue';
import type { DocumentEditingMode, EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  DEFAULT_TABLE_CHROME_DRAFT,
  runTableChromeCommand,
  tableChromeToolbarState,
  type TableChromeDraft,
  type TableChromeSlotId,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorEvent } from '../useEditorEvent';
import { useEditorState } from '../useEditorState';

const TABLE_CHROME_SLOT_IDS = [
  'table.borderTarget',
  'table.borderColor',
  'table.borderStyle',
  'table.borderWidth',
  'table.cellFill',
] as const satisfies readonly TableChromeSlotId[];

interface TableChromeCommandSlice {
  readonly enabled: boolean;
  readonly disabledReason: string | null;
}

type TableChromeSlotStates = Record<TableChromeSlotId, TableChromeCommandSlice>;

interface TableChromeContextValue {
  readonly visible: ComputedRef<boolean>;
  readonly draft: ComputedRef<TableChromeDraft>;
  readonly setDraft: (draft: TableChromeDraft) => void;
  readonly slotState: (slot: TableChromeSlotId) => TableChromeCommandSlice;
  readonly apply: (slot: TableChromeSlotId, value: unknown) => void;
}

const TableChromeContextKey: InjectionKey<TableChromeContextValue> = Symbol('TableChromeContext');

let tableChromeProviderMounts = 0;
let tableChromeProviderSubscriptions = 0;
let tableChromeStateDerivations = 0;

/** @internal */
export function tableChromeProviderMountCount(): number {
  return tableChromeProviderMounts;
}

/** @internal */
export function tableChromeProviderSubscriptionCount(): number {
  return tableChromeProviderSubscriptions;
}

/** @internal */
export function tableChromeStateDerivationCount(): number {
  return tableChromeStateDerivations;
}

/** @internal */
export function resetTableChromeStateDerivationCount(): void {
  tableChromeStateDerivations = 0;
}

/** @internal */
export function useTableChromeProviderVisible(): ComputedRef<boolean> {
  const ctx = inject(TableChromeContextKey, null);
  if (!ctx) {
    throw new Error('table chrome group must render inside TableChromeProvider');
  }
  return ctx.visible;
}

interface TableAdmissionSlice {
  readonly tableKey: string;
  readonly selectionKey: string;
  readonly cellSelectionKey: string;
  readonly editable: boolean;
  readonly editingMode: DocumentEditingMode;
}

function buildTableAdmissionSlice(
  editor: DocxEditorInstance | null,
  snapshot: EditorSnapshot
): TableAdmissionSlice {
  const tableCtx = snapshot.table;
  const selectedTable = editor?.getSelectedTable() ?? null;
  const tableId = selectedTable?.blockId ?? '';
  const tableKey = tableCtx
    ? `${tableId}|${tableCtx.rows}|${tableCtx.columns}|${tableCtx.rowIndex}|${tableCtx.columnIndex}`
    : '';
  const selection = snapshot.selection;
  const selectionKey = selection
    ? `${selection.from && 'paraId' in selection.from ? selection.from.paraId : ''}|${selection.to && 'paraId' in selection.to ? selection.to.paraId : ''}|${snapshot.selectionCollapsed}`
    : '';
  const cellSel = editor?.getTableCellSelection() ?? null;
  const cellSelectionKey = cellSel
    ? `${cellSel.tableId}|${cellSel.rows.from}-${cellSel.rows.to}|${cellSel.columns.from}-${cellSel.columns.to}|${cellSel.cellIds.join(',')}`
    : '';
  return {
    tableKey,
    selectionKey,
    cellSelectionKey,
    editable: snapshot.editable,
    editingMode: snapshot.editingMode ?? 'editing',
  };
}

interface SnapshotAdmissionGate {
  readonly table: EditorSnapshot['table'];
  readonly editable: boolean;
  readonly editingMode: DocumentEditingMode;
  readonly headParagraphId: string;
}

function snapshotAdmissionGateEqual(a: SnapshotAdmissionGate, b: SnapshotAdmissionGate): boolean {
  return (
    a.table === b.table &&
    a.editable === b.editable &&
    a.editingMode === b.editingMode &&
    a.headParagraphId === b.headParagraphId
  );
}

function tableAdmissionEqual(a: TableAdmissionSlice, b: TableAdmissionSlice): boolean {
  return (
    a.tableKey === b.tableKey &&
    a.selectionKey === b.selectionKey &&
    a.cellSelectionKey === b.cellSelectionKey &&
    a.editable === b.editable &&
    a.editingMode === b.editingMode
  );
}

const EMPTY_ADMISSION: TableAdmissionSlice = {
  tableKey: '',
  selectionKey: '',
  cellSelectionKey: '',
  editable: false,
  editingMode: 'editing',
};

/** @internal */
export function tableAdmissionSliceForTest(
  editor: DocxEditorInstance | null,
  snapshot: EditorSnapshot
): TableAdmissionSlice {
  return buildTableAdmissionSlice(editor, snapshot);
}

function deriveTableChromeSlotStates(
  editor: DocxEditorInstance,
  draft: TableChromeDraft
): TableChromeSlotStates {
  tableChromeStateDerivations++;
  const states = {} as TableChromeSlotStates;
  for (const slot of TABLE_CHROME_SLOT_IDS) {
    const state = tableChromeToolbarState(editor, slot, draft);
    states[slot] = { enabled: state.enabled, disabledReason: state.disabledReason };
  }
  return states;
}

/** @internal */
export const TableChromeProvider = defineComponent({
  name: 'TableChromeProvider',
  setup(_, { slots }) {
    const editorRef = useDocxEditor();
    const draft = ref<TableChromeDraft>(DEFAULT_TABLE_CHROME_DRAFT);
    const admission = shallowRef<TableAdmissionSlice>(EMPTY_ADMISSION);

    onMounted(() => {
      tableChromeProviderMounts++;
    });
    onUnmounted(() => {
      tableChromeProviderMounts--;
    });

    const snapshotGate = useEditorState(
      (snapshot: EditorSnapshot): SnapshotAdmissionGate => ({
        table: snapshot.table,
        editable: snapshot.editable,
        editingMode: snapshot.editingMode ?? 'editing',
        headParagraphId:
          snapshot.selection?.to && 'paraId' in snapshot.selection.to
            ? snapshot.selection.to.paraId
            : snapshot.selection?.from && 'paraId' in snapshot.selection.from
              ? snapshot.selection.from.paraId
              : '',
      }),
      snapshotAdmissionGateEqual,
      {
        onSubscribe: () => {
          tableChromeProviderSubscriptions++;
        },
        onUnsubscribe: () => {
          tableChromeProviderSubscriptions--;
        },
      }
    );

    const syncAdmission = () => {
      const editor = editorRef.value;
      if (!editor) {
        admission.value = EMPTY_ADMISSION;
        return;
      }
      const next = buildTableAdmissionSlice(editor, editor.snapshot());
      if (!tableAdmissionEqual(admission.value, next)) admission.value = next;
    };

    watch([editorRef, snapshotGate], syncAdmission, { immediate: true, flush: 'post' });

    useEditorEvent('selectionChange', syncAdmission);

    const visible = computed(() => admission.value.tableKey !== '');

    const states = computed(() => {
      const editor = editorRef.value;
      if (!editor) return {} as TableChromeSlotStates;
      return deriveTableChromeSlotStates(editor, draft.value);
    });

    const apply = (slot: TableChromeSlotId, value: unknown) => {
      const editor = editorRef.value;
      if (!editor) return;
      const { result, nextDraft } = runTableChromeCommand(editor, slot, value, draft.value);
      if (result.ok && nextDraft) draft.value = nextDraft;
    };

    const context: TableChromeContextValue = {
      visible,
      draft: computed(() => draft.value),
      setDraft: (next) => {
        draft.value = next;
      },
      slotState: (slot) =>
        states.value[slot] ?? { enabled: false, disabledReason: 'editor is not ready' },
      apply,
    };

    provide(TableChromeContextKey, context);

    return () => slots.default?.();
  },
});

/** @internal @deprecated Use {@link TableChromeProvider}. */
export const TableChromeDraftProvider = TableChromeProvider;

function useTableChromeContext(): TableChromeContextValue {
  const value = inject(TableChromeContextKey, null);
  if (!value) {
    throw new Error('table chrome parts must render inside TableChromeProvider');
  }
  return value;
}

/** @internal */
export function useTableChromeSlot(slot: TableChromeSlotId): {
  readonly visible: ComputedRef<boolean>;
  readonly enabled: ComputedRef<boolean>;
  readonly disabledReason: ComputedRef<string | null>;
  readonly draft: ComputedRef<TableChromeDraft>;
  readonly apply: (value: unknown) => void;
} {
  const ctx = useTableChromeContext();
  const slice = computed(() => ctx.slotState(slot));
  return {
    visible: ctx.visible,
    enabled: computed(() => slice.value.enabled),
    disabledReason: computed(() => slice.value.disabledReason),
    draft: ctx.draft,
    apply: (value: unknown) => ctx.apply(slot, value),
  };
}

export type { TableChromeDraft, TableChromeSlotId };
