import type { ContentControlWidgetSession, InvalidTextFormFieldSession } from './popup-sessions.ts';
import type { TextFormFieldDialogSession } from './text-form-field-session.ts';
import type { PopupChromeRegistrationOptions } from './popup-sessions.ts';

/**
 * Manual renderers take priority over automatic adapter fallbacks in either mount order.
 *
 * A session family whose sessions carry a `kind` can scope each registration with
 * `handlers.kinds`; `defaultKinds` is what a registration that names none takes. A session no
 * registration takes is refused, and the engine keeps its own behavior for it.
 */
export function createSessionChrome<Session extends { signal: AbortSignal; cancel(): void }>(
  defaultKinds?: readonly string[]
) {
  type Handlers = {
    readonly onRequest?: (session: Session) => void;
    readonly kinds?: readonly string[];
  };
  const registrations: { handlers: Handlers; fallback: boolean; sessions: Set<Session> }[] = [];
  const takes = (entry: { handlers: Handlers }, session: Session): boolean => {
    const kind = (session as { kind?: unknown }).kind;
    const kinds = entry.handlers.kinds ?? defaultKinds;
    return typeof kind !== 'string' || !kinds || kinds.includes(kind);
  };
  return {
    request(session: Session): boolean {
      const candidates = registrations.filter((entry) => takes(entry, session));
      const registration =
        [...candidates].reverse().find((entry) => !entry.fallback) ?? candidates.at(-1);
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
  // Checkbox and picture presses reach only renderers that ask for them: a pop-up renderer
  // written before those sessions existed keeps working, and the engine toggles the box or
  // opens its own file picker itself. A gallery session is list-shaped, so it joins the list.
  const widget = createSessionChrome<ContentControlWidgetSession>([
    'dropdown',
    'comboBox',
    'date',
    'buildingBlockGallery',
  ]);
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
