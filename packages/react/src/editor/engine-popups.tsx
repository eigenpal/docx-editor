import { useEffect, useRef, useState } from 'react';
import type {
  ContentControlWidgetSession,
  InvalidTextFormFieldSession,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { usePopupConfig } from './popup-config';

/** Registers configured engine popups below manual handlers, independent of effect order. */
export function EnginePopups() {
  const editor = useDocxEditor();
  const popups = usePopupConfig();
  const current = useRef(popups);
  current.current = popups;
  const [widget, setWidget] = useState<ContentControlWidgetSession | null>(null);
  const [invalid, setInvalid] = useState<InvalidTextFormFieldSession | null>(null);
  const widgetConfigured = popups?.contentControlWidget !== undefined;
  const invalidConfigured = popups?.invalidTextFormField !== undefined;
  useEffect(() => {
    if (!editor || !widgetConfigured) return;
    let mounted = true;
    const dispose = editor.setContentControlWidgetChrome(
      {
        onRequest(session) {
          if (current.current?.contentControlWidget === false) return session.cancel();
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
  }, [editor, widgetConfigured]);
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
    if (popups?.contentControlWidget === false) widget?.cancel();
    if (popups?.invalidTextFormField === false) invalid?.cancel();
  }, [popups, widget, invalid]);
  return (
    <>
      {widget && popups?.contentControlWidget && popups.contentControlWidget({ session: widget })}
      {invalid && popups?.invalidTextFormField && popups.invalidTextFormField({ session: invalid })}
    </>
  );
}
