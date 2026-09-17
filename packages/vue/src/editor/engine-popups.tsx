import { renderPopup } from './popup-renderer';
import { defineComponent, shallowRef, watch } from 'vue';
import type {
  ContentControlWidgetSession,
  InvalidTextFormFieldSession,
} from '@docx-editor.dev/core/editor';
import { usePopupConfig, type DocxEditorPopups } from './popup-config';
import { useDocxEditor } from './context';

/** Which `popups` entry renders a widget session: checkbox presses have their own. */
function widgetEntry(
  kind: ContentControlWidgetSession['kind']
): keyof Pick<DocxEditorPopups, 'contentControlWidget' | 'contentControlCheckbox'> {
  return kind === 'checkbox' ? 'contentControlCheckbox' : 'contentControlWidget';
}

export const ConfiguredEnginePopups = defineComponent({
  name: 'DocxConfiguredEnginePopups',
  setup() {
    const config = usePopupConfig();
    const editor = useDocxEditor();
    const widget = shallowRef<ContentControlWidgetSession | null>(null);
    const invalid = shallowRef<InvalidTextFormFieldSession | null>(null);
    watch(
      [
        editor,
        () => config.value?.contentControlWidget !== undefined,
        () => config.value?.contentControlCheckbox !== undefined,
      ],
      ([instance, widgetConfigured, checkboxConfigured], _old, onCleanup) => {
        if (!instance || (!widgetConfigured && !checkboxConfigured)) return;
        // The registration names only the kinds a configured entry can render, so an omitted
        // `contentControlCheckbox` leaves checkbox presses to the engine's own toggle.
        const kinds: ContentControlWidgetSession['kind'][] = [
          ...(widgetConfigured ? (['dropdown', 'comboBox', 'date'] as const) : []),
          ...(checkboxConfigured ? (['checkbox'] as const) : []),
        ];
        const dispose = instance.setContentControlWidgetChrome(
          {
            kinds,
            onRequest: (session) => {
              if (config.value?.[widgetEntry(session.kind)] === false) {
                session.cancel();
                return;
              }
              widget.value = session;
              session.signal.addEventListener(
                'abort',
                () => {
                  if (widget.value === session) widget.value = null;
                },
                { once: true }
              );
            },
          },
          { fallback: true }
        );
        onCleanup(() => {
          dispose();
          widget.value = null;
        });
      },
      { immediate: true }
    );
    watch(
      [
        editor,
        () =>
          config.value?.invalidTextFormField === undefined
            ? undefined
            : config.value.invalidTextFormField !== false,
      ],
      ([instance, renderer], _old, onCleanup) => {
        if (!instance || renderer === undefined) return;
        const dispose = instance.setInvalidTextFormFieldChrome(
          {
            onRequest: (session) => {
              if (config.value?.invalidTextFormField === false) {
                session.cancel();
                return;
              }
              invalid.value = session;
              session.signal.addEventListener(
                'abort',
                () => {
                  if (invalid.value === session) invalid.value = null;
                },
                { once: true }
              );
            },
          },
          { fallback: true }
        );
        onCleanup(() => {
          dispose();
          invalid.value = null;
        });
      },
      { immediate: true }
    );
    return () => [
      widget.value && config.value?.[widgetEntry(widget.value.kind)]
        ? renderPopup(
            config.value[widgetEntry(widget.value.kind)]!,
            { session: widget.value },
            widget.value
          )
        : null,
      invalid.value && config.value?.invalidTextFormField
        ? renderPopup(config.value.invalidTextFormField, { session: invalid.value }, invalid.value)
        : null,
    ];
  },
});
