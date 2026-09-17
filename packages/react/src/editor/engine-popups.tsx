import { renderPopup } from './popup-renderer';
import { useEffect, useRef, useState } from 'react';
import type {
  ContentControlWidgetSession,
  InvalidTextFormFieldSession,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { usePopupConfig, type DocxEditorPopups } from './popup-config';

/** Which `popups` entry renders a widget session: checkbox presses have their own. */
function widgetEntry(
  kind: ContentControlWidgetSession['kind']
): keyof Pick<DocxEditorPopups, 'contentControlWidget' | 'contentControlCheckbox'> {
  return kind === 'checkbox' ? 'contentControlCheckbox' : 'contentControlWidget';
}

/** Registers configured engine popups below manual handlers, independent of effect order. */
export function EnginePopups() {
  const editor = useDocxEditor();
  const popups = usePopupConfig();
  const current = useRef(popups);
  current.current = popups;
  const [widget, setWidget] = useState<ContentControlWidgetSession | null>(null);
  const [invalid, setInvalid] = useState<InvalidTextFormFieldSession | null>(null);
  const widgetConfigured = popups?.contentControlWidget !== undefined;
  const checkboxConfigured = popups?.contentControlCheckbox !== undefined;
  const invalidConfigured = popups?.invalidTextFormField !== undefined;
  useEffect(() => {
    if (!editor || (!widgetConfigured && !checkboxConfigured)) return;
    let mounted = true;
    // The registration names only the kinds a configured entry can render, so an omitted
    // `contentControlCheckbox` leaves checkbox presses to the engine's own toggle.
    const kinds: ContentControlWidgetSession['kind'][] = [
      ...(widgetConfigured ? (['dropdown', 'comboBox', 'date'] as const) : []),
      ...(checkboxConfigured ? (['checkbox'] as const) : []),
    ];
    const dispose = editor.setContentControlWidgetChrome(
      {
        kinds,
        onRequest(session) {
          if (current.current?.[widgetEntry(session.kind)] === false) return session.cancel();
          setWidget(session);
          session.signal.addEventListener(
            'abort',
            () => {
              if (mounted) setWidget((previous) => (previous === session ? null : previous));
            },
            { once: true }
          );
        },
      },
      { fallback: true }
    );
    return () => {
      mounted = false;
      dispose();
      setWidget(null);
    };
  }, [editor, widgetConfigured, checkboxConfigured]);
  useEffect(() => {
    if (!editor || !invalidConfigured) return;
    let mounted = true;
    const dispose = editor.setInvalidTextFormFieldChrome(
      {
        onRequest(session) {
          if (current.current?.invalidTextFormField === false) return session.cancel();
          setInvalid(session);
          session.signal.addEventListener(
            'abort',
            () => {
              if (mounted) setInvalid((previous) => (previous === session ? null : previous));
            },
            { once: true }
          );
        },
      },
      { fallback: true }
    );
    return () => {
      mounted = false;
      dispose();
      setInvalid(null);
    };
  }, [editor, invalidConfigured]);
  useEffect(() => {
    if (widget && popups?.[widgetEntry(widget.kind)] === false) widget.cancel();
    if (popups?.invalidTextFormField === false) invalid?.cancel();
  }, [popups, widget, invalid]);
  const widgetRenderer = widget ? popups?.[widgetEntry(widget.kind)] : undefined;
  return (
    <>
      {widget && widgetRenderer && renderPopup(widgetRenderer, { session: widget }, widget)}
      {invalid &&
        popups?.invalidTextFormField &&
        renderPopup(popups.invalidTextFormField, { session: invalid }, invalid)}
    </>
  );
}
