import { createChromeHandlerStack } from './chrome-handler-stack.ts';
import type {
  TextFormFieldChromeHandlers,
  TextFormFieldDialogSession,
} from './text-form-field-session.ts';

/** Own each registration's sessions independently of surface replacement. */
export function createTextFormFieldChrome() {
  const stack = createChromeHandlerStack<TextFormFieldChromeHandlers>({});
  const registrations = new Map<TextFormFieldChromeHandlers, Set<TextFormFieldDialogSession>>();
  return {
    request(session: TextFormFieldDialogSession): boolean {
      const handlers = stack.current();
      if (!handlers.onRequest) return false;
      const sessions = registrations.get(handlers)!;
      sessions.add(session);
      session.signal.addEventListener('abort', () => sessions.delete(session), { once: true });
      handlers.onRequest(session);
      return true;
    },
    register(handlers: TextFormFieldChromeHandlers): () => void {
      // A caller may reuse the same handlers for separate registrations.
      const registration = { ...handlers };
      const sessions = new Set<TextFormFieldDialogSession>();
      registrations.set(registration, sessions);
      const dispose = stack.push(registration);
      return () => {
        dispose();
        for (const session of sessions) session.cancel();
        registrations.delete(registration);
      };
    },
  };
}
