import { renderPopup } from './popup-renderer';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DocxEditorPopups } from './popup-config';
import { useEditorMountGeneration } from './dialog-parts';
import type { ReactNode } from 'react';
import type { TextFormFieldDialogSession } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { DocxEditorPageSetupDialog } from './DocxEditorPageSetup';
import { DocxEditorParagraphDialog } from './DocxEditorParagraphDialog';
import { DocxEditorTextFormFieldDialog } from './DocxEditorTextFormFieldDialog';

interface DialogHost {
  readonly ownsPageSetup: boolean;
  open(kind: 'pageSetup' | 'paragraph', returnFocusTo?: HTMLElement | null): void;
  setContainer(container: HTMLElement | null): void;
}
const Context = createContext<DialogHost | null>(null);
export const useDialogHost = () => useContext(Context);
export function DialogProvider({
  popups,
  children,
}: {
  popups?: DocxEditorPopups;
  children?: ReactNode;
}) {
  const editor = useDocxEditor();
  const generation = useEditorMountGeneration();
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState<'pageSetup' | 'paragraph' | null>(null);
  const [session, setSession] = useState<TextFormFieldDialogSession | null>(null);
  const popupsRef = useRef(popups);
  popupsRef.current = popups;
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
    return editor.setTextFormFieldChrome(
      {
        onRequest(request) {
          if (popupsRef.current?.textFormField === false) {
            request.cancel();
            return;
          }
          setActive(null);
          setSession(request);
          request.signal.addEventListener(
            'abort',
            () => setSession((previous) => (previous === request ? null : previous)),
            { once: true }
          );
        },
      },
      { fallback: true }
    );
  }, [editor]);
  useEffect(() => {
    setActive(null);
    setSession(null);
  }, [editor, generation]);
  useEffect(() => {
    if (popups?.textFormField === false) sessionRef.current?.cancel();
    if (active && popups?.[active] === false) setActive(null);
  }, [popups, active]);
  const host = useMemo<DialogHost>(
    () => ({
      setContainer,
      ownsPageSetup: popups?.pageSetup !== undefined,
      open(kind, returnFocusTo) {
        sessionRef.current?.cancel();
        if (popupsRef.current?.[kind] === false) return;
        opener.current =
          returnFocusTo ?? (container?.ownerDocument.activeElement as HTMLElement | null);
        setActive(kind);
      },
    }),
    [container, popups?.pageSetup]
  );
  const props = { open: true, onClose: close };
  const content =
    active === 'pageSetup' && popups?.pageSetup !== false ? (
      popups?.pageSetup ? (
        renderPopup(popups.pageSetup, props)
      ) : (
        <DocxEditorPageSetupDialog {...props} />
      )
    ) : active === 'paragraph' && popups?.paragraph !== false ? (
      popups?.paragraph ? (
        renderPopup(popups.paragraph, props)
      ) : (
        <DocxEditorParagraphDialog {...props} />
      )
    ) : session && popups?.textFormField !== false ? (
      popups?.textFormField ? (
        renderPopup(popups.textFormField, { session }, session)
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
