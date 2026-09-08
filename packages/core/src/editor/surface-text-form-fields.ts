import {
  supportsTextFormField,
  formatTextFormValue,
} from '../store/store/text-form-field-options.ts';
import { textFormFieldInvalidDialog } from './text-form-field-invalid-dialog.ts';
import { textFormFieldDialog } from './text-form-field-dialog.ts';
import { refreshTextFormLabels, textFormTranslate } from './text-form-field-translations.ts';
import type { EditorTranslate } from './docx-editor-host-config.ts';
import {
  findNode,
  deepParagraphOrderOfPart,
  paragraphTextOf,
  validateTreeOp,
  textFormFieldsOf,
  type OoxmlPart,
  type TreeDocOp,
  type TextFormFieldRange,
} from '@docx-editor.dev/core/store';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';

/** Input provenance belongs to the open document, including during a font remount. */
export type PendingTextFormInput = readonly {
  readonly partName: string;
  readonly fieldIndex: number;
  readonly text: string;
  readonly locale: string;
}[];
const inputSnapshots = new WeakMap<HTMLElement, () => PendingTextFormInput>();

function fieldsInPart(part: OoxmlPart): TextFormFieldRange[] {
  return [...deepParagraphOrderOfPart(part).keys()].flatMap((id) => {
    const paragraph = findNode(part, id);
    return paragraph?.kind === 'paragraph' ? textFormFieldsOf(paragraph) : [];
  });
}

/** Capture pending input before the current surface is destroyed. */
export function snapshotTextFormInput(container: HTMLElement): PendingTextFormInput | undefined {
  return inputSnapshots.get(container)?.();
}

interface Host {
  translate?: EditorTranslate;
  locale?(): string;
  readonly pagesLayer: HTMLElement;
  readonly container: HTMLElement;
  part(): OoxmlPart;
  parts?(): readonly OoxmlPart[];
  protected(paragraphId?: string): boolean;
  selection(): SemanticSelection;
  select(selection: SemanticSelection): void;
  apply(op: TreeDocOp): boolean;
  editable(): boolean;
}

/** Shared field interaction for all editor hosts. */
export function createTextFormFieldInteraction(
  host: Host,
  initialInput?: PendingTextFormInput
): {
  fieldId(): string | null;
  keydown(event: KeyboardEvent): boolean;
  doubleClick(event: MouseEvent): boolean;
  pointerUp(event: PointerEvent): void;
  selectForDeletion(direction: 'backward' | 'forward'): boolean;
  annotate(ops: readonly TreeDocOp[]): readonly TreeDocOp[];
  afterApply(committed: boolean): void;
  restoreAfterHistory(): void;
  canEdit(): boolean;
  edit(): boolean;
  update(): void;
  beforeSelect(next: SemanticSelection): SemanticSelection | null;
  destroy(): void;
} {
  const t = textFormTranslate(host.translate);
  const document = host.container.ownerDocument;
  let contextual: { paragraphId: string; fieldNodeId: string } | null | undefined;
  let committing = false;
  type DirtyFields = Map<string, { text: string; locale: string }>;
  let dirtyBaseline: DirtyFields = new Map();
  const parts = () => host.parts?.() ?? [host.part()];
  if (initialInput?.length) {
    for (const part of parts()) {
      const saved = initialInput.filter((input) => input.partName === part.name);
      if (!saved.length) continue;
      const fields = fieldsInPart(part);
      for (const input of saved) {
        const field = fields[input.fieldIndex];
        if (field) dirtyBaseline.set(field.fieldNodeId, { text: input.text, locale: input.locale });
      }
    }
  }
  // Store history restores immutable part identities. Keep input provenance with those
  // snapshots so undo restores a clean date and redo restores the original input locale.
  const inputHistory = new WeakMap<OoxmlPart, DirtyFields>();
  const rememberInput = (): void => {
    inputHistory.set(host.part(), new Map(dirtyBaseline));
  };
  const restoreInput = (): void => {
    dirtyBaseline = new Map(inputHistory.get(host.part()));
  };
  const forgetField = (id: string): void => {
    dirtyBaseline.delete(id);
    rememberInput();
  };
  rememberInput();
  const snapshotInput = (): PendingTextFormInput => {
    if (!dirtyBaseline.size) return [];
    // Node IDs encode parse paths and can change when an earlier field gains a result run.
    // Field order within the same saved story remains stable across serialization.
    return parts().flatMap((part) =>
      fieldsInPart(part).flatMap((field, fieldIndex) => {
        const input = dirtyBaseline.get(field.fieldNodeId);
        return input ? [{ partName: part.name, fieldIndex, ...input }] : [];
      })
    );
  };
  inputSnapshots.set(host.container, snapshotInput);
  let incoming: { paragraphId: string; fieldNodeId: string } | null | undefined;
  const rawValue = (paragraphId: string, field: TextFormFieldRange) =>
    (paragraphTextOf(host.part(), paragraphId) ?? '').slice(field.start, field.end);
  let dialog: HTMLDialogElement | null = null;
  let active: { paragraphId: string; fieldNodeId: string } | null = null;
  const close = (): void => {
    const selected = host.selection();
    dialog?.remove();
    dialog = null;
    host.pagesLayer.focus({ preventScroll: true });
    // Native focus can collapse the DOM range at the start of the editable surface.
    host.select(selected);
  };
  function select(paragraphId: string, field: TextFormFieldRange): void {
    incoming = { paragraphId, fieldNodeId: field.fieldNodeId };
    host.select({
      anchor: { paragraphId, offset: field.start },
      head: { paragraphId, offset: field.end },
    });
    if (
      host.selection().head.paragraphId === paragraphId &&
      host.selection().head.offset >= field.start &&
      host.selection().head.offset <= field.end
    )
      active = incoming ?? active;
    incoming = undefined;
  }
  function open(paragraphId: string, field: TextFormFieldRange): void {
    close();
    const inputLocale = host.locale?.() ?? 'en-US';
    dialog = textFormFieldDialog(
      host.container,
      field,
      (text, options) => {
        if (
          !host.editable() ||
          host.protected(paragraphId) ||
          !host.apply({
            op: 'setTextFormFieldDefault',
            locale: inputLocale,
            paragraphId,
            fieldNodeId: field.fieldNodeId,
            text,
            options,
          })
        )
          return false;
        const p = findNode(host.part(), paragraphId);
        const current =
          p?.kind === 'paragraph'
            ? textFormFieldsOf(p).find((f) => f.fieldNodeId === field.fieldNodeId)
            : null;
        if (current) select(paragraphId, current);
        return true;
      },
      close,
      t
    );
  }
  const fieldAtTarget = (
    event: MouseEvent
  ): { paragraphId: string; field: TextFormFieldRange } | null => {
    const target = event.target as Element | null;
    const span = target?.closest<HTMLElement>('[data-field-atom="form"][data-start]');
    const paragraphId = span?.closest<HTMLElement>('[data-paragraph-id]')?.dataset.paragraphId;
    if (!span || !paragraphId || !host.editable()) return null;
    const paragraph = findNode(host.part(), paragraphId);
    if (paragraph?.kind !== 'paragraph') return null;
    const offset = Number(span.dataset.start);
    const field = textFormFieldsOf(paragraph).find((f) => f.start <= offset && offset < f.end);
    if (!field) return null;
    return { paragraphId, field };
  };
  let press: {
    x: number;
    y: number;
    paragraphId: string;
    fieldNodeId: string;
    moved: boolean;
  } | null = null;
  const modified = (event: MouseEvent): boolean =>
    event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
  const rememberField = (event: PointerEvent): void => {
    contextual = undefined;
    press = null;
    if (event.button !== 0) return;
    const hit = fieldAtTarget(event);
    if (hit && !modified(event) && !host.protected(hit.paragraphId))
      press = {
        x: event.clientX,
        y: event.clientY,
        paragraphId: hit.paragraphId,
        fieldNodeId: hit.field.fieldNodeId,
        moved: false,
      };
    incoming = hit ? { paragraphId: hit.paragraphId, fieldNodeId: hit.field.fieldNodeId } : null;
  };
  host.pagesLayer.addEventListener('pointerdown', rememberField, { capture: true });
  const move = (event: PointerEvent): void => {
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4)
      press.moved = true;
  };
  const cancelPress = (): void => {
    press = null;
  };
  const singleClick = (event: MouseEvent, settled = false): void => {
    const started = press;
    press = null;
    if (
      !started ||
      started.moved ||
      dialog ||
      event.button !== 0 ||
      event.detail > 1 ||
      Math.hypot(event.clientX - started.x, event.clientY - started.y) > 4 ||
      !host.editable() ||
      modified(event)
    )
      return;
    if (host.protected(started.paragraphId)) return;
    const paragraph = findNode(host.part(), started.paragraphId);
    const field =
      paragraph?.kind === 'paragraph'
        ? textFormFieldsOf(paragraph).find(
            (candidate) => candidate.fieldNodeId === started.fieldNodeId
          )
        : null;
    if (!field) return;
    const selection = host.selection();
    if (
      settled &&
      (selection.anchor.paragraphId !== selection.head.paragraphId ||
        selection.anchor.offset !== selection.head.offset) &&
      !(
        selection.anchor.paragraphId === started.paragraphId &&
        selection.head.paragraphId === started.paragraphId &&
        Math.min(selection.anchor.offset, selection.head.offset) === field.start &&
        Math.max(selection.anchor.offset, selection.head.offset) === field.end
      )
    )
      return;
    // Pointer capture and repaint can retarget click to the pages layer. Resolve the
    // recorded identity against the current tree instead of requiring the old span.
    select(started.paragraphId, field);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointercancel', cancelPress);
  host.pagesLayer.addEventListener('click', singleClick);

  const doubleClick = (event: MouseEvent): boolean => {
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
    const hit = fieldAtTarget(event);
    if (!hit) return false;
    const { paragraphId, field } = hit;
    event.preventDefault();
    select(paragraphId, field);
    if (!host.protected(paragraphId)) open(paragraphId, field);
    return true;
  };
  host.pagesLayer.addEventListener('dblclick', doubleClick);
  function selectionField(): { paragraphId: string; field: TextFormFieldRange } | null {
    const selected = host.selection();
    if (selected.anchor.paragraphId !== selected.head.paragraphId) return null;
    const paragraphId = selected.head.paragraphId;
    const p = findNode(host.part(), paragraphId);
    if (p?.kind !== 'paragraph') return null;
    const start = Math.min(selected.anchor.offset, selected.head.offset);
    const end = Math.max(selected.anchor.offset, selected.head.offset);
    const fields = textFormFieldsOf(p).filter((f) => f.start <= start && f.end >= end);
    const field =
      fields.find(
        (f) => active?.paragraphId === paragraphId && f.fieldNodeId === active.fieldNodeId
      ) ??
      fields.find((f) => f.start === start && f.end === end) ??
      fields[0];
    return field ? { paragraphId, field } : null;
  }
  function targetField() {
    if (contextual === undefined) return selectionField();
    if (!contextual) return null;
    const p = findNode(host.part(), contextual.paragraphId);
    const field =
      p?.kind === 'paragraph'
        ? textFormFieldsOf(p).find((f) => f.fieldNodeId === contextual!.fieldNodeId)
        : null;
    return field ? { paragraphId: contextual.paragraphId, field } : null;
  }
  const onContext = (event: MouseEvent): void => {
    const hit =
      event.button === -1 || (event.clientX === 0 && event.clientY === 0)
        ? selectionField()
        : fieldAtTarget(event);
    contextual = hit ? { paragraphId: hit.paragraphId, fieldNodeId: hit.field.fieldNodeId } : null;
  };
  host.pagesLayer.addEventListener('contextmenu', onContext);
  const canEdit = (): boolean => {
    const hit = targetField();
    return (
      !!hit &&
      host.editable() &&
      !host.protected(hit.paragraphId) &&
      !validateTreeOp(host.part(), {
        op: 'setTextFormFieldDefault',
        paragraphId: hit.paragraphId,
        fieldNodeId: hit.field.fieldNodeId,
        text: '',
        options: { type: 'regular', maxLength: 0, format: '', enabled: true },
      })
    );
  };
  const status = document.createElement('span');
  status.className = 'docx-text-form-status';
  host.container.append(status);

  return {
    doubleClick,
    pointerUp: (event) => singleClick(event, true),
    canEdit,
    edit() {
      if (!canEdit()) return false;
      const hit = targetField()!;
      select(hit.paragraphId, hit.field);
      open(hit.paragraphId, hit.field);
      return true;
    },
    selectForDeletion(direction) {
      const selected = host.selection();
      const { paragraphId, offset } = selected.head;
      if (
        !host.editable() ||
        host.protected(paragraphId) ||
        selected.anchor.paragraphId !== paragraphId ||
        selected.anchor.offset !== offset
      )
        return false;
      const paragraph = findNode(host.part(), paragraphId);
      if (paragraph?.kind !== 'paragraph') return false;
      const field = textFormFieldsOf(paragraph).find(
        (candidate) =>
          candidate.start < candidate.end &&
          (direction === 'backward' ? candidate.end === offset : candidate.start === offset)
      );
      if (!field) return false;
      // Word selects a field before deleting from its boundary. Interior edits remain text edits.
      select(paragraphId, field);
      return true;
    },
    beforeSelect(next) {
      const accept = (value: SemanticSelection): SemanticSelection => {
        if (incoming !== undefined) active = incoming;
        else if (
          next.anchor.paragraphId !== next.head.paragraphId ||
          active?.paragraphId !== next.head.paragraphId
        )
          active = null;
        else {
          const p = findNode(host.part(), next.head.paragraphId);
          const field =
            p?.kind === 'paragraph'
              ? textFormFieldsOf(p).find((f) => f.fieldNodeId === active?.fieldNodeId)
              : null;
          if (
            !field ||
            Math.min(next.anchor.offset, next.head.offset) < field.start ||
            Math.max(next.anchor.offset, next.head.offset) > field.end
          )
            active = null;
        }
        incoming = undefined;
        delete status.dataset.fieldError;
        return value;
      };
      if (committing || dialog?.getAttribute('role') === 'alertdialog') return null;
      if (!host.editable()) return next;
      const hit = selectionField();
      if (
        !hit ||
        !host.protected(hit.paragraphId) ||
        !hit.field.enabled ||
        !supportsTextFormField(hit.field)
      )
        return accept(next);
      const { field, paragraphId } = hit;
      if (
        (!incoming || incoming.fieldNodeId === field.fieldNodeId) &&
        next.anchor.paragraphId === paragraphId &&
        next.head.paragraphId === paragraphId &&
        Math.min(next.anchor.offset, next.head.offset) >= field.start &&
        Math.max(next.anchor.offset, next.head.offset) <= field.end
      )
        return accept(next);
      const dirty = dirtyBaseline.get(field.fieldNodeId);
      const baseline = dirty?.text;
      const inputLocale = dirty?.locale ?? host.locale?.() ?? 'en-US';
      const current = rawValue(paragraphId, field);
      // Authored and previously committed dates already use the field's output picture.
      // Only interpret new input; visiting a field must never swap its month and day.
      if (field.type === 'date' && baseline === undefined) {
        forgetField(field.fieldNodeId);
        return accept(next);
      }
      const formatted = formatTextFormValue(current, field, 'fill', inputLocale);
      if (
        formatted === current ||
        (formatted === null && (baseline === undefined || baseline === current))
      ) {
        forgetField(field.fieldNodeId);
        return accept(next);
      }
      committing = true;
      const applied = host.apply({
        op: 'commitTextFormField',
        locale: inputLocale,
        paragraphId,
        fieldNodeId: field.fieldNodeId,
      });
      committing = false;
      if (!applied) {
        incoming = undefined;
        status.setAttribute('role', 'alert');
        status.dataset.fieldError = 'true';
        status.textContent = t('textFormField.invalidValue');
        if (formatted === null && (field.type === 'number' || field.type === 'date')) {
          dialog = textFormFieldInvalidDialog(
            host.container,
            field.type,
            () => {
              dialog?.remove();
              dialog = null;
              const selected = host.selection();
              const restoreFocus = (): void => {
                host.pagesLayer.focus({ preventScroll: true });
                host.select(selected);
              };
              const paragraph = findNode(host.part(), paragraphId);
              const latest =
                paragraph?.kind === 'paragraph'
                  ? textFormFieldsOf(paragraph).find(
                      (value) => value.fieldNodeId === field.fieldNodeId
                    )
                  : null;
              // Do not discard a concurrent replacement, or bypass a new protection state.
              if (
                !latest ||
                !host.editable() ||
                !host.protected(paragraphId) ||
                rawValue(paragraphId, latest) !== current ||
                !latest.enabled ||
                !supportsTextFormField(latest) ||
                latest.type !== field.type ||
                latest.format !== field.format ||
                formatTextFormValue(current, latest, 'fill', inputLocale) !== null
              ) {
                restoreFocus();
                return;
              }
              committing = true;
              try {
                if (
                  host.apply({
                    op: 'deleteText',
                    paragraphId,
                    start: latest.start,
                    end: latest.end,
                    textFormFieldId: latest.fieldNodeId,
                  })
                ) {
                  forgetField(latest.fieldNodeId);
                  delete status.dataset.fieldError;
                  host.pagesLayer.focus({ preventScroll: true });
                  const point = { paragraphId, offset: latest.start };
                  // Bypass exit validation only for restoring the same, now empty, field.
                  committing = false;
                  host.select({ anchor: point, head: point });
                  active = { paragraphId, fieldNodeId: latest.fieldNodeId };
                } else {
                  committing = false;
                  restoreFocus();
                }
              } finally {
                committing = false;
              }
            },
            t
          );
        }
        return null;
      }
      forgetField(field.fieldNodeId);
      const p = findNode(host.part(), paragraphId);
      const updated =
        p?.kind === 'paragraph'
          ? textFormFieldsOf(p).find((f) => f.fieldNodeId === field.fieldNodeId)
          : null;
      const delta = updated ? updated.end - field.end : 0;
      const move = (point: SemanticSelection['head']) =>
        point.paragraphId === paragraphId && point.offset >= field.end
          ? { ...point, offset: point.offset + delta }
          : point;
      return accept({ anchor: move(next.anchor), head: move(next.head) });
    },
    update() {
      if (dialog) refreshTextFormLabels(dialog, t);
      const hit = selectionField();
      const selected = host.selection();
      const whole =
        !!hit &&
        selected.anchor.offset !== selected.head.offset &&
        Math.min(selected.anchor.offset, selected.head.offset) === hit.field.start &&
        Math.max(selected.anchor.offset, selected.head.offset) === hit.field.end;
      for (const span of host.pagesLayer.querySelectorAll<HTMLElement>(
        '[data-field-atom="form"][data-start]'
      )) {
        const id = span.closest<HTMLElement>('[data-paragraph-id]')?.dataset.paragraphId;
        const offset = Number(span.dataset.start);
        const within =
          !!hit && id === hit.paragraphId && offset >= hit.field.start && offset < hit.field.end;
        if (within) span.dataset.textFormSelection = whole ? 'whole' : 'caret';
        else delete span.dataset.textFormSelection;
      }
      if (status.dataset.fieldError) {
        status.textContent = t('textFormField.invalidValue');
        return;
      }
      if (hit) status.setAttribute('role', 'status');
      else status.removeAttribute('role');
      status.textContent = hit ? t(whole ? 'textFormField.selected' : 'textFormField.editing') : '';
    },
    fieldId: () => selectionField()?.field.fieldNodeId ?? null,
    afterApply(committed) {
      if (committed) rememberInput();
      else restoreInput();
    },
    restoreAfterHistory: restoreInput,
    annotate(ops) {
      rememberInput();
      if (ops.some((op) => op.op === 'insertText' || op.op === 'deleteText'))
        delete status.dataset.fieldError;
      const hit = selectionField();
      active = hit ? { paragraphId: hit.paragraphId, fieldNodeId: hit.field.fieldNodeId } : null;
      return ops.map((op) => {
        if (
          !active ||
          (op.op !== 'insertText' && op.op !== 'deleteText') ||
          op.revision ||
          op.paragraphId !== active.paragraphId ||
          !host.protected(op.paragraphId)
        )
          return op;
        const p = findNode(host.part(), op.paragraphId);
        const field =
          p?.kind === 'paragraph'
            ? textFormFieldsOf(p).find((f) => f.fieldNodeId === active!.fieldNodeId)
            : null;
        const start = op.op === 'insertText' ? op.offset : op.start;
        const end = op.op === 'insertText' ? op.offset : op.end;
        if (!field || start < field.start || end > field.end) return op;
        if (!dirtyBaseline.has(field.fieldNodeId))
          dirtyBaseline.set(field.fieldNodeId, {
            text: rawValue(op.paragraphId, field),
            locale: host.locale?.() ?? 'en-US',
          });
        return { ...op, textFormFieldId: field.fieldNodeId };
      });
    },
    keydown(event) {
      if (
        event.key === 'F10' &&
        event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        contextual = undefined;
        event.preventDefault();
        host.pagesLayer.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: -1 })
        );
        return true;
      }
      if (
        event.key !== 'Tab' ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !host.editable() ||
        !host.protected(host.selection().head.paragraphId)
      )
        return false;
      const entries: { paragraphId: string; field: TextFormFieldRange }[] = [];
      const stack = [host.part().root];
      while (stack.length) {
        const node = stack.pop()!;
        if (node.kind === 'paragraph') {
          for (const field of textFormFieldsOf(node))
            if (
              host.protected(node.id) &&
              field.enabled &&
              supportsTextFormField(field) &&
              !validateTreeOp(host.part(), {
                op: 'insertText',
                paragraphId: node.id,
                offset: field.start,
                text: 'x',
              })
            )
              entries.push({ paragraphId: node.id, field });
        } else {
          for (let i = node.children.length - 1; i >= 0; i--) {
            const child = node.children[i]!;
            if (child.kind !== 'textValue') stack.push(child);
          }
        }
      }
      if (!entries.length) return false;
      const selected = host.selection();
      const current = selected.head;
      const activeIndex = active
        ? entries.findIndex(
            (e) =>
              e.paragraphId === active!.paragraphId &&
              e.field.fieldNodeId === active!.fieldNodeId &&
              e.field.start <= Math.min(selected.anchor.offset, current.offset) &&
              e.field.end >= Math.max(selected.anchor.offset, current.offset)
          )
        : -1;
      const index =
        activeIndex >= 0
          ? activeIndex
          : entries.findIndex(
              (e) =>
                e.paragraphId === current.paragraphId &&
                e.field.start <= Math.min(selected.anchor.offset, current.offset) &&
                e.field.end >= Math.max(selected.anchor.offset, current.offset)
            );
      const nextIndex =
        index < 0
          ? event.shiftKey
            ? entries.length - 1
            : 0
          : (index + (event.shiftKey ? -1 : 1) + entries.length) % entries.length;
      const next = entries[nextIndex]!;
      event.preventDefault();
      select(next.paragraphId, next.field);
      return true;
    },
    destroy() {
      if (inputSnapshots.get(host.container) === snapshotInput)
        inputSnapshots.delete(host.container);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointercancel', cancelPress);
      host.pagesLayer.removeEventListener('click', singleClick);
      host.pagesLayer.removeEventListener('contextmenu', onContext);
      status.remove();
      host.pagesLayer.removeEventListener('dblclick', doubleClick);
      host.pagesLayer.removeEventListener('pointerdown', rememberField, { capture: true });
      dialog?.remove();
      dialog = null;
    },
  };
}
