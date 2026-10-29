// The chrome colour mode a `DocxEditor.Root` declares, for the parts that scope themselves.
//
// The dark palette is scoped to `.docx-editor.dark`. `Root` renders no element, so in the
// composition path each part puts `.docx-editor` on its own root element (see
// `scope-context.ts`). Those same parts add `dark` beside it when `Root` resolved a dark
// mode, so a composed toolbar, menu bar, or viewport themes like the packaged editor.
// The resolution rules live in `lib/colorMode.ts`, shared with `<DocxEditor>`.

import { createContext, useContext, useEffect, useState } from 'react';
import {
  prefersColorSchemeDark,
  resolveIsDark,
  subscribeSystemDark,
  type ColorMode,
} from '../lib/colorMode';
import { ScopedByAncestorContext } from './scope-context';

/** True when the enclosing `Root` resolved a dark chrome. */
export const ChromeDarkContext = createContext(false);

/**
 * Whether a colour mode is dark right now. `'system'` follows the OS setting and updates
 * when it changes; `undefined` is light.
 */
export function useResolvedDark(colorMode: ColorMode | undefined): boolean {
  const [systemDark, setSystemDark] = useState(prefersColorSchemeDark);
  useEffect(() => {
    if (colorMode !== 'system') return undefined;
    return subscribeSystemDark(setSystemDark);
  }, [colorMode]);
  return resolveIsDark(colorMode ?? 'light', systemDark);
}

/** True when the enclosing `Root` resolved a dark chrome. */
export function useChromeDark(): boolean {
  return useContext(ChromeDarkContext);
}

/**
 * The scope classes a self-scoping chrome part adds to its root element: `docx-editor`, and
 * `dark` with it under a dark `Root`, or nothing when an ancestor already carries the scope.
 * Ends with a space so it concatenates cleanly.
 */
export function useChromeScopeClassName(): '' | 'docx-editor ' | 'docx-editor dark ' {
  const scoped = useContext(ScopedByAncestorContext);
  const dark = useContext(ChromeDarkContext);
  if (scoped) return '';
  return dark ? 'docx-editor dark ' : 'docx-editor ';
}
