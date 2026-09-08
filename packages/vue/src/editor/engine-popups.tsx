import { renderPopup } from './popup-renderer';
import { defineComponent, shallowRef, watch } from 'vue';
import type {
  ContentControlWidgetSession,
  InvalidTextFormFieldSession,
} from '@docx-editor.dev/core/editor';
import { usePopupConfig } from './popup-config';
import { useDocxEditor } from './context';
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
        () =>
          config.value?.contentControlWidget === undefined
            ? undefined
            : config.value.contentControlWidget !== false,
      ],
      ([instance, renderer], _old, onCleanup) => {
        if (!instance || renderer === undefined) return;
        const dispose = instance.setContentControlWidgetChrome(
          {
            onRequest: (session) => {
              if (config.value?.contentControlWidget === false) {
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
      widget.value && config.value?.contentControlWidget
        ? renderPopup(config.value.contentControlWidget, { session: widget.value }, widget.value)
        : null,
      invalid.value && config.value?.invalidTextFormField
        ? renderPopup(config.value.invalidTextFormField, { session: invalid.value }, invalid.value)
        : null,
    ];
  },
});
