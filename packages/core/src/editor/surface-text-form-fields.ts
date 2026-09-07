import { supportsTextFormField } from '../store/store/text-form-field-options.ts';
import { textFormFieldDialog } from './text-form-field-dialog.ts';
import { createT, en } from '@docx-editor.dev/i18n';
import {
  findNode,
  paragraphTextOf,
  validateTreeOp,
  textFormFieldsOf,
  type OoxmlPart,
  type TreeDocOp,
  type TextFormFieldRange,
} from '@docx-editor.dev/core/store';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';

interface Host {
  readonly pagesLayer: HTMLElement;
  readonly container: HTMLElement;
  part(): OoxmlPart;
  protected(paragraphId?: string): boolean;
  selection(): SemanticSelection;
  select(selection: SemanticSelection): void;
  apply(op: TreeDocOp): boolean;
  editable(): boolean;
}

/** Shared field interaction for all editor hosts. */
export function createTextFormFieldInteraction(host: Host): {
  keydown(event: KeyboardEvent): boolean;
  doubleClick(event: MouseEvent): boolean;
  annotate(ops: readonly TreeDocOp[]): readonly TreeDocOp[];
  canEdit(): boolean;
  edit(): boolean;
  update(): void;
  beforeSelect(next: SemanticSelection): SemanticSelection | null;
  destroy(): void;
} {
  const t = createT(en);
  const document = host.container.ownerDocument;
  let contextual: { paragraphId: string; fieldNodeId: string } | null | undefined;
  let committing = false;
  const dirtyBaseline = new Map<string, string>();
  let incoming: { paragraphId: string; fieldNodeId: string } | null | undefined;
  const rawValue = (paragraphId: string, field: TextFormFieldRange) =>
    (paragraphTextOf(host.part(), paragraphId) ?? '').slice(field.start, field.end);
  let dialog: HTMLDialogElement | null = null;
  let active: { paragraphId: string; fieldNodeId: string } | null = null;
  const close = (): void => {
    dialog?.remove();
    dialog = null;
    host.pagesLayer.focus({ preventScroll: true });
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
    dialog = textFormFieldDialog(
      host.container,
      field,
      (text, options) => {
        if (
          !host.editable() ||
          host.protected(paragraphId) ||
          !host.apply({
            op: 'setTextFormFieldDefault',
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
      close
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
  const rememberField = (event: PointerEvent): void => {
    contextual = undefined;
    if (event.button !== 0) return;
    const hit = fieldAtTarget(event);
    incoming = hit ? { paragraphId: hit.paragraphId, fieldNodeId: hit.field.fieldNodeId } : null;
  };
  host.pagesLayer.addEventListener('pointerdown', rememberField, { capture: true });
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
    canEdit,
    edit() {
      if (!canEdit()) return false;
      const hit = targetField()!;
      select(hit.paragraphId, hit.field);
      open(hit.paragraphId, hit.field);
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
      if (committing) return null;
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
      const baseline = dirtyBaseline.get(field.fieldNodeId);
      if (baseline === undefined || baseline === rawValue(paragraphId, field)) return accept(next);
      committing = true;
      const applied = host.apply({
        op: 'commitTextFormField',
        paragraphId,
        fieldNodeId: field.fieldNodeId,
      });
      committing = false;
      if (!applied) {
        incoming = undefined;
        status.setAttribute('role', 'alert');
        status.dataset.fieldError = 'true';
        status.textContent = t('textFormField.invalidValue');
        return null;
      }
      dirtyBaseline.delete(field.fieldNodeId);
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
      if (status.dataset.fieldError) return;
      if (hit) status.setAttribute('role', 'status');
      else status.removeAttribute('role');
      status.textContent = hit ? t(whole ? 'textFormField.selected' : 'textFormField.editing') : '';
    },
    annotate(ops) {
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
          dirtyBaseline.set(field.fieldNodeId, rawValue(op.paragraphId, field));
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
      host.pagesLayer.removeEventListener('contextmenu', onContext);
      status.remove();
      host.pagesLayer.removeEventListener('dblclick', doubleClick);
      host.pagesLayer.removeEventListener('pointerdown', rememberField, { capture: true });
      dialog?.remove();
      dialog = null;
    },
  };
}
