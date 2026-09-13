import {
  defineComponent,
  onBeforeUnmount,
  ref,
  watch,
  type CSSProperties,
  type PropType,
} from 'vue';
import type { ContentControlWidgetSession } from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useEditorState } from './useEditorState';
import { useFormControlTranslate } from './form-control-translate';
import { absolutePointInScroller } from './scroller-geometry';
/** Value-widget session and optional replacement controls. @public */
export interface DocxEditorContentControlWidgetProps {
  session: ContentControlWidgetSession;
  className?: string;
  style?: CSSProperties;
  children?: DocxEditorChildren;
}
/** Compact value editor for a configured content-control popup. @public */
export const DocxEditorContentControlWidget = defineComponent({
  name: 'DocxEditorContentControlWidget',
  props: {
    session: { type: Object as PropType<ContentControlWidgetSession>, required: true },
    className: String,
    style: Object as PropType<CSSProperties>,
    children: Object as PropType<DocxEditorChildren>,
  },
  setup(props, { slots }) {
    const t = useFormControlTranslate();
    const value = ref(props.session.value);
    const closed = ref(props.session.signal.aborted);
    const refused = ref(false);
    const panel = ref<HTMLDivElement | null>(null);
    const position = ref<CSSProperties>({});
    let opener: HTMLElement | null = null;
    let focusPanel: HTMLDivElement | null = null;
    const restoreFocus = () => {
      const previous = opener;
      const element = focusPanel;
      opener = null;
      focusPanel = null;
      if (!previous?.isConnected || !element) return;
      const active = element.ownerDocument.activeElement;
      if (active === element.ownerDocument.body || (active && element.contains(active)))
        previous.focus({ preventScroll: true });
    };
    onBeforeUnmount(restoreFocus);
    const enabled = useEditorState(() => props.session.canApply(), Object.is, {
      extraDeps: () => props.session,
    });
    watch(
      () => props.session,
      (session, _old, onCleanup) => {
        value.value =
          session.kind === 'date' && /^\d{4}-\d{2}-\d{2}/.test(session.value)
            ? session.value.slice(0, 10)
            : session.value;
        closed.value = session.signal.aborted;
        refused.value = false;
        const abort = () => {
          closed.value = true;
        };
        session.signal.addEventListener('abort', abort, { once: true });
        onCleanup(() => session.signal.removeEventListener('abort', abort));
      },
      { immediate: true }
    );
    watch(
      [panel, () => props.session],
      ([element, session]) => {
        if (!element) {
          restoreFocus();
          return;
        }
        restoreFocus();
        const active = element.ownerDocument.activeElement;
        opener = active instanceof HTMLElement ? active : null;
        focusPanel = element;
        const scroller = element.closest<HTMLElement>('.docx-editor__scroll-container');
        if (session.anchor && scroller) {
          const rect = session.anchor.getBoundingClientRect();
          position.value = absolutePointInScroller(scroller, rect.left, rect.bottom);
        }
        element.querySelector<HTMLElement>('input,select,button')?.focus({ preventScroll: true });
      },
      { flush: 'post' }
    );
    watch(
      [panel, closed],
      ([element, isClosed], _old, onCleanup) => {
        if (!element || isClosed) return;
        const dismiss = (event: Event) => {
          if (!element.contains(event.target as Node)) props.session.cancel();
        };
        element.ownerDocument.addEventListener('pointerdown', dismiss, true);
        onCleanup(() => element.ownerDocument.removeEventListener('pointerdown', dismiss, true));
      },
      { flush: 'post' }
    );
    const apply = () => {
      refused.value = !props.session.apply(value.value);
    };
    return () => {
      if (closed.value) return null;
      const session = props.session;
      const label = t(`contentControl.types.${session.kind}`);
      return (
        <div
          ref={panel}
          role="dialog"
          aria-label={label}
          class={['docx-content-control-widget-popup', props.className]}
          style={{ ...position.value, ...props.style }}
          data-docx-popup="contentControlWidget"
          onPointerdown={(event) => event.stopPropagation()}
          onKeydown={(event) => {
            if (event.isComposing) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              session.cancel();
            }
            if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
              event.preventDefault();
              apply();
            }
          }}
        >
          {slots.default?.() ?? props.children ?? (
            <>
              {session.kind === 'dropdown' ? (
                <select
                  aria-label={label}
                  value={value.value}
                  onChange={(event) => {
                    value.value = (event.target as HTMLSelectElement).value;
                  }}
                >
                  {!session.items.some((item) => item.value === value.value) ? (
                    <option value={value.value} disabled>
                      {value.value}
                    </option>
                  ) : null}
                  {session.items.map((item) => (
                    <option value={item.value}>{item.displayText}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={session.kind === 'date' ? 'date' : 'text'}
                  aria-label={label}
                  value={value.value}
                  onInput={(event) => {
                    value.value = (event.target as HTMLInputElement).value;
                  }}
                />
              )}
              {session.kind === 'comboBox'
                ? session.items.map((item) => (
                    <button
                      type="button"
                      disabled={!enabled.value}
                      onClick={() => {
                        refused.value = !session.apply(item.value);
                      }}
                    >
                      {item.displayText}
                    </button>
                  ))
                : null}
              {refused.value ? <div role="alert">{t('disabledReason.invalidValue')}</div> : null}
              <div class="docx-dialog__footer">
                <button class="docx-dialog__button" type="button" onClick={() => session.cancel()}>
                  {t('common.cancel')}
                </button>
                <button
                  class="docx-dialog__button docx-dialog__button--primary"
                  type="button"
                  disabled={!enabled.value}
                  onClick={apply}
                >
                  {t('common.apply')}
                </button>
              </div>
            </>
          )}
        </div>
      );
    };
  },
});
