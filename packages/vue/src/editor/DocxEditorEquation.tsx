import { computed, defineComponent, h, ref, watch, type CSSProperties } from 'vue';
import type { EquationActivation } from '@docx-editor.dev/core/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';
import { formatPx } from '../lib/units';
import { useStableDocxId } from '../lib/stable-id';
import { useDocxEditor } from './context';
import { absolutePointInScroller } from './scroller-geometry.ts';
import { useEditorState } from './useEditorState.ts';

interface EquationPopupState {
  readonly activation: EquationActivation;
  readonly mountGeneration: number;
  readonly draft: string;
  readonly error: boolean;
}

/** Keeps button chrome from moving the document caret. Inputs retain normal focus behavior. */
function guardMousedown(event: MouseEvent): void {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
}

/** Default equation editor mounted by the packaged Vue host. */
export const DocxEditorEquation = defineComponent({
  name: 'DocxEditorEquation',
  setup() {
    const editorRef = useDocxEditor();
    const { t } = useTranslation();
    const state = ref<EquationPopupState | null>(null);
    const placement = ref<CSSProperties | null>(null);
    const inputId = useStableDocxId('equation-input');
    const errorId = useStableDocxId('equation-error');
    const disabledReasonId = useStableDocxId('equation-disabled-reason');
    let panelElement: HTMLElement | null = null;
    let inputElement: HTMLInputElement | null = null;
    let releasePin: (() => void) | null = null;
    const editorSnapshot = useEditorState((snapshot) => snapshot);
    const mutationAvailability = computed(() => {
      void editorSnapshot.value;
      const editor = editorRef.value;
      const activation = state.value?.activation;
      if (!editor?.surface || !activation) {
        return { replaceEnabled: false, removeEnabled: false, reason: null };
      }
      const replace = editor.surface.equations.can(activation.equation.id, 'replace');
      const remove = editor.surface.equations.can(activation.equation.id, 'remove');
      const refusal = !replace.ok ? replace.reason : !remove.ok ? remove.reason : null;
      return {
        replaceEnabled: replace.ok,
        removeEnabled: remove.ok,
        reason: refusal ? localizeDisabledReason(refusal, t) : null,
      };
    });
    const close = (restoreFocus = false) => {
      const focusEditor = editorRef.value;
      releasePin?.();
      releasePin = null;
      state.value = null;
      if (restoreFocus && focusEditor) queueMicrotask(() => focusEditor.focus());
    };

    watch(
      editorRef,
      (editor, _, onCleanup) => {
        if (!editor) return;
        const off = editor.setEquationChrome({
          onPopover: (activation) => {
            releasePin?.();
            const surface = editor.surface;
            if (surface && typeof surface.retainSelection === 'function') {
              const pin = surface.retainSelection();
              releasePin = () => surface.releaseSelection(pin);
            } else {
              releasePin = null;
            }
            state.value = {
              activation,
              mountGeneration: editor.mountGeneration,
              draft: activation.equation.linear,
              error: false,
            };
          },
        });
        onCleanup(() => {
          off();
          close();
        });
      },
      { immediate: true, flush: 'post' }
    );

    watch(
      [editorRef, editorSnapshot, () => state.value?.activation.equation.id],
      () => {
        const current = state.value;
        const editor = editorRef.value;
        if (!current || !editor?.surface) return;
        const stale =
          editor.mountGeneration !== current.mountGeneration ||
          !editor.surface.equations.equationById(current.activation.equation.id);
        if (stale) close();
      },
      { flush: 'post' }
    );

    watch(
      state,
      (current, _, onCleanup) => {
        if (!current) return;
        let disposed = false;
        let ownerDocument: Document | null = null;
        let onKeyDown: ((event: KeyboardEvent) => void) | null = null;
        let onPointerDown: ((event: PointerEvent) => void) | null = null;
        queueMicrotask(() => {
          if (disposed) return;
          const panel = panelElement;
          ownerDocument = panel?.ownerDocument ?? null;
          const view = ownerDocument?.defaultView;
          if (!panel || !ownerDocument || !view) return;
          onKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            close(true);
          };
          onPointerDown = (event: PointerEvent): void => {
            if (event.target instanceof view.Node && panel.contains(event.target)) return;
            close();
          };
          ownerDocument.addEventListener('keydown', onKeyDown);
          ownerDocument.addEventListener('pointerdown', onPointerDown, true);
        });
        onCleanup(() => {
          disposed = true;
          if (ownerDocument && onKeyDown) ownerDocument.removeEventListener('keydown', onKeyDown);
          if (ownerDocument && onPointerDown) {
            ownerDocument.removeEventListener('pointerdown', onPointerDown, true);
          }
        });
      },
      { flush: 'post' }
    );

    watch(
      () => state.value?.activation,
      (activation) => {
        if (!activation) {
          placement.value = null;
          return;
        }
        const panel = panelElement;
        if (!panel) return;
        const container = panel.offsetParent as HTMLElement | null;
        if (container) {
          const point = absolutePointInScroller(
            container,
            activation.rect.left,
            activation.rect.bottom
          );
          const maxLeft = Math.max(0, container.scrollWidth - panel.offsetWidth);
          placement.value = {
            left: formatPx(Math.max(0, Math.min(point.left, maxLeft))),
            top: formatPx(point.top),
          };
        } else {
          placement.value = null;
        }
        inputElement?.focus({ preventScroll: true });
        inputElement?.select();
      },
      { flush: 'post' }
    );

    const apply = (linear?: string): boolean => {
      const current = state.value;
      const equations = editorRef.value?.surface?.equations;
      if (!current || !equations || !mutationAvailability.value.replaceEnabled) return false;
      const applied = equations.applyEquation(
        current.activation.equation.id,
        linear ?? current.draft
      );
      if (applied) close(true);
      else state.value = { ...current, error: true };
      return applied;
    };

    const remove = (): boolean => {
      const current = state.value;
      const equations = editorRef.value?.surface?.equations;
      if (!current || !equations || !mutationAvailability.value.removeEnabled) return false;
      const removed = equations.removeEquation(current.activation.equation.id);
      if (removed) close(true);
      else state.value = { ...current, error: true };
      return removed;
    };

    return () => {
      const current = state.value;
      if (!current) return null;
      const field = h('input', {
        id: inputId,
        onVnodeMounted: (vnode) => {
          inputElement = vnode.el as HTMLInputElement;
        },
        onVnodeUnmounted: () => {
          inputElement = null;
        },
        class: 'docx-equation-popup__input',
        'data-testid': 'equation-popup-input',
        value: current.draft,
        placeholder: t('equationPopup.placeholder'),
        spellcheck: false,
        'aria-describedby':
          [
            current.error ? errorId : null,
            mutationAvailability.value.reason ? disabledReasonId : null,
          ]
            .filter(Boolean)
            .join(' ') || undefined,
        onInput: (event: InputEvent) => {
          const active = state.value;
          if (!active) return;
          state.value = {
            ...active,
            draft: (event.target as HTMLInputElement).value,
            error: false,
          };
        },
        onKeydown: (event: KeyboardEvent) => {
          if (event.key !== 'Enter' || event.isComposing) return;
          event.preventDefault();
          apply((event.currentTarget as HTMLInputElement).value);
        },
      });
      return h(
        'div',
        {
          onVnodeMounted: (vnode) => {
            panelElement = vnode.el as HTMLElement;
          },
          onVnodeUnmounted: () => {
            panelElement = null;
          },
          class: 'docx-equation-popup',
          'data-testid': 'equation-popup',
          role: 'dialog',
          'aria-modal': false,
          'aria-label': t('equationPopup.title'),
          style: placement.value ?? undefined,
          onMousedown: guardMousedown,
        },
        [
          <label class="docx-editor-sr-only" for={inputId}>
            {t('equationPopup.inputLabel')}
          </label>,
          field,
          current.error ? (
            <div
              id={errorId}
              class="docx-equation-popup__error"
              data-testid="equation-popup-error"
              role="alert"
            >
              {t('equationPopup.refused')}
            </div>
          ) : null,
          mutationAvailability.value.reason ? (
            <div
              id={disabledReasonId}
              class="docx-equation-popup__error"
              data-testid="equation-popup-disabled-reason"
              role="status"
            >
              {mutationAvailability.value.reason}
            </div>
          ) : null,
          <div class="docx-equation-popup__actions">
            <button
              type="button"
              class="docx-equation-popup__apply"
              data-testid="equation-popup-apply"
              disabled={!mutationAvailability.value.replaceEnabled}
              title={mutationAvailability.value.reason ?? undefined}
              onMousedown={guardMousedown}
              onClick={() => apply(inputElement?.value)}
            >
              {t('equationPopup.apply')}
            </button>
            <button
              type="button"
              class="docx-equation-popup__delete"
              data-testid="equation-popup-delete"
              disabled={!mutationAvailability.value.removeEnabled}
              title={mutationAvailability.value.reason ?? undefined}
              onMousedown={guardMousedown}
              onClick={remove}
            >
              {t('equationPopup.delete')}
            </button>
          </div>,
        ]
      );
    };
  },
});
