import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useEditorMountGeneration } from './dialog-parts';
import type { ReactNode } from 'react';
import type { TextFormFieldDialogSession } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import {
  DocxEditorPageSetupDialog,
  type DocxEditorPageSetupDialogProps,
} from './DocxEditorPageSetup';
import {
  DocxEditorParagraphDialog,
  type DocxEditorParagraphDialogProps,
} from './DocxEditorParagraphDialog';
import {
  DocxEditorTextFormFieldDialog,
  type DocxEditorTextFormFieldDialogProps,
} from './DocxEditorTextFormFieldDialog';

/** Renderers for dialogs opened through packaged controls and engine gestures. @public */
export interface DocxEditorDialogs {
  pageSetup?: (props: DocxEditorPageSetupDialogProps) => DocxEditorChildren | null;
  paragraph?: (props: DocxEditorParagraphDialogProps) => DocxEditorChildren | null;
  textFormField?: (props: DocxEditorTextFormFieldDialogProps) => DocxEditorChildren | null;
}
interface DialogHost {
  open(kind: 'pageSetup' | 'paragraph', returnFocusTo?: HTMLElement | null): void;
  setContainer(container: HTMLElement | null): void;
}
const Context = createContext<DialogHost | null>(null);
export const useDialogHost = () => useContext(Context);
export function DialogProvider({
  dialogs,
  children,
}: {
  dialogs?: DocxEditorDialogs;
  children?: ReactNode;
}) {
  const editor = useDocxEditor();
  const generation = useEditorMountGeneration();
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState<'pageSetup' | 'paragraph' | null>(null);
  const [session, setSession] = useState<TextFormFieldDialogSession | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const close = () => setActive(null);
  useEffect(() => {
    if (active !== null) return;
    const target = opener.current;
    opener.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [active]);
  useEffect(() => {
    if (!editor) return;
    return editor.setTextFormFieldChrome({
      onRequest(request) {
        setActive(null);
        setSession(request);
        request.signal.addEventListener(
          'abort',
          () => setSession((previous) => (previous === request ? null : previous)),
          { once: true }
        );
      },
    });
  }, [editor]);
  useEffect(() => {
    setActive(null);
    setSession(null);
  }, [editor, generation]);
  const host = useMemo<DialogHost>(
    () => ({
      setContainer,
      open(kind, returnFocusTo) {
        sessionRef.current?.cancel();
        opener.current =
          returnFocusTo ?? (container?.ownerDocument.activeElement as HTMLElement | null);
        setActive(kind);
      },
    }),
    [container]
  );
  const props = { open: true, onClose: close };
  const content =
    active === 'pageSetup' ? (
      dialogs?.pageSetup ? (
        dialogs.pageSetup(props)
      ) : (
        <DocxEditorPageSetupDialog {...props} />
      )
    ) : active === 'paragraph' ? (
      dialogs?.paragraph ? (
        dialogs.paragraph(props)
      ) : (
        <DocxEditorParagraphDialog {...props} />
      )
    ) : session ? (
      dialogs?.textFormField ? (
        dialogs.textFormField({ session })
      ) : (
        <DocxEditorTextFormFieldDialog session={session} />
      )
    ) : null;
  return (
    <Context.Provider value={host}>
      {children}
      {container ? createPortal(content, container) : null}
    </Context.Provider>
  );
}
/** The stable mount belongs to Content, outside the engine-owned DOM. */
export function DialogMount() {
  const host = useDialogHost();
  return <div className="docx-dialog-mount" ref={host?.setContainer} />;
}
