import type { ContentControlWidgetSession, InvalidTextFormFieldSession } from './popup-sessions.ts';
import type { TextFormFieldDialogSession } from './text-form-field-session.ts';
import type { PopupChromeRegistrationOptions } from './popup-sessions.ts';

/** Manual renderers take priority over automatic adapter fallbacks in either mount order. */
export function createSessionChrome<Session extends { signal: AbortSignal; cancel(): void }>() {
  type Handlers = { readonly onRequest?: (session: Session) => void };
  const registrations: { handlers: Handlers; fallback: boolean; sessions: Set<Session> }[] = [];
  return {
    request(session: Session): boolean {
      const registration =
        [...registrations].reverse().find((entry) => !entry.fallback) ?? registrations.at(-1);
      if (!registration?.handlers.onRequest) return false;
      const { sessions, handlers } = registration;
      sessions.add(session);
      session.signal.addEventListener('abort', () => sessions.delete(session), { once: true });
      handlers.onRequest!(session);
      return true;
    },
    register(handlers: Handlers, options?: PopupChromeRegistrationOptions): () => void {
      const entry = {
        handlers,
        fallback: options?.fallback === true,
        sessions: new Set<Session>(),
      };
      registrations.push(entry);
      return () => {
        const index = registrations.indexOf(entry);
        if (index < 0) return;
        registrations.splice(index, 1);
        for (const session of entry.sessions) session.cancel();
      };
    },
  };
}
/** Own Field Options sessions independently of surface replacement. */
export const createTextFormFieldChrome = () => createSessionChrome<TextFormFieldDialogSession>();

/** Facade wiring shared by the three core-owned popup session families. */
export function createEditorPopupChrome() {
  const text = createTextFormFieldChrome();
  const widget = createSessionChrome<ContentControlWidgetSession>();
  const invalid = createSessionChrome<InvalidTextFormFieldSession>();
  return {
    surfaceOptions: {
      onRequestTextFormField: text.request,
      onRequestContentControlWidget: widget.request,
      onRequestInvalidTextFormField: invalid.request,
    },
    setters: {
      setTextFormFieldChrome: text.register,
      setContentControlWidgetChrome: widget.register,
      setInvalidTextFormFieldChrome: invalid.register,
    },
  };
}
