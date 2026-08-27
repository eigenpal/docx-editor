// Light and dark for the whole app, editor included.
//
// The library's palette is one `dark` class on the element that carries `docx-editor`, so a
// host switches themes by toggling that class and nothing else. Both the editor's chrome and
// this demo's own frame read from it — the frame's tokens sit under the same selector — so
// one switch moves everything and nothing goes half-dark.
//
// It starts from the reader's own setting and follows it until they choose, which is the
// behaviour someone expects from a devtool that opens in a dark IDE.

import { useCallback, useEffect, useState } from 'react';

export type ColorMode = 'light' | 'dark';

const STORAGE_KEY = 'docx-collab-color-mode';

function systemMode(): ColorMode {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function storedMode(): ColorMode | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    // A private window can refuse storage outright. The switch still works; it just does not
    // survive a reload, which is better than the app failing to start.
    return null;
  }
}

/** The current mode, and a toggle. Applies the class to the `docx-editor` host itself. */
export function useColorMode(): { readonly mode: ColorMode; readonly toggle: () => void } {
  const [mode, setMode] = useState<ColorMode>(() => storedMode() ?? systemMode());
  // Null until the reader picks one, and only then does the system stop being followed.
  const [chosen, setChosen] = useState(() => storedMode() !== null);

  useEffect(() => {
    const host = document.querySelector('.docx-editor');
    host?.classList.toggle('dark', mode === 'dark');
  }, [mode]);

  useEffect(() => {
    if (chosen) return undefined;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => setMode(query.matches ? 'dark' : 'light');
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [chosen]);

  const toggle = useCallback(() => {
    setMode((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      setChosen(true);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // See `storedMode`: refusing to remember is not a reason to refuse to switch.
      }
      return next;
    });
  }, []);

  return { mode, toggle };
}
