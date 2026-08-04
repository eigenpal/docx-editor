// Toolbar-scoped context: the translate function the root publishes to its parts.
//
// The adapter ships NO hardcoded user-facing English (repo i18n rule): every label is
// an i18n key from the chrome registry, resolved through the host's `t` when one is
// provided and falling back to the KEY STRING — never to an English literal — when not.

import { createContext, useContext } from 'react';

/** Resolves an i18n key to display text. @public */
export type ToolbarTranslate = (key: string) => string;

export interface ToolbarContextValue {
  readonly t: ToolbarTranslate | undefined;
  /** Host save handler for the `file.save` part; absent renders the part disabled. */
  readonly onSave: (() => void) | undefined;
}

export const ToolbarContext = createContext<ToolbarContextValue>({
  t: undefined,
  onSave: undefined,
});

/** The toolbar root's published value. Internal: parts read it, hosts pass props. */
export function useToolbarContext(): ToolbarContextValue {
  return useContext(ToolbarContext);
}

/** The label for an i18n key: the host's translation, or the key itself. */
export function useToolbarLabel(): (key: string) => string {
  const { t } = useContext(ToolbarContext);
  return (key: string) => t?.(key) ?? key;
}
