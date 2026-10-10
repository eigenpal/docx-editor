// Light and dark for the whole app, editor included.
//
// The library's palette is one `dark` class on the element that carries `docx-editor`, so a
// host switches themes by toggling that class and nothing else. Both the editor's chrome and
// this demo's own frame read from it — the frame's tokens sit under the same selector — so one
// switch moves everything and nothing goes half-dark.
//
// It opens LIGHT rather than following `prefers-color-scheme`. A demo is a thing people
// screenshot and show to someone else, and it should look the same when they do; a reader on a
// dark laptop and a reader on a light one otherwise describe different products. The switch is
// right there, and a choice is remembered.

import { useCallback, useEffect, useState } from 'react';

export type ColorMode = 'light' | 'dark';

const STORAGE_KEY = 'docx-collab-color-mode';

/**
 * The mode this load starts in: a remembered choice, or light.
 *
 * Exported because `main.tsx` applies it BEFORE the first render. Left to the hook alone it
 * would land one paint late — and, worse, only on the screens that happen to mount the switch.
 */
export function initialColorMode(): ColorMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'dark' ? 'dark' : 'light';
  } catch {
    // A private window can refuse storage outright. The switch still works; it just does not
    // survive a reload, which is better than the app failing to start.
    return 'light';
  }
}

/** Put the mode on the `docx-editor` host, which is what every editor style is scoped to. */
export function applyColorMode(mode: ColorMode): void {
  document.querySelector('.docx-editor')?.classList.toggle('dark', mode === 'dark');
}

/** The current mode, and a toggle. Call it once, above every screen. */
export function useColorMode(): { readonly mode: ColorMode; readonly toggle: () => void } {
  const [mode, setMode] = useState<ColorMode>(initialColorMode);

  useEffect(() => {
    applyColorMode(mode);
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // See `initialColorMode`: refusing to remember is not a reason to refuse to switch.
      }
      return next;
    });
  }, []);

  return { mode, toggle };
}
