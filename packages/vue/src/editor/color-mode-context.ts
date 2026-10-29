// The chrome colour mode a `DocxEditorRoot` declares, for the parts that scope themselves.
//
// The dark palette is scoped to `.docx-editor.dark`. `Root` renders no element, so in the
// composition path each part puts `.docx-editor` on its own root element (see
// `scope-context.ts`). Those same parts add `dark` beside it when `Root` resolved a dark
// mode, so a composed toolbar, menu bar, or viewport themes like the packaged editor.
// The resolution rules live in `lib/colorMode.ts`, shared with `<DocxEditor>`.

import {
  computed,
  inject,
  onBeforeUnmount,
  ref,
  watch,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from 'vue';
import {
  prefersColorSchemeDark,
  resolveIsDark,
  subscribeSystemDark,
  type ColorMode,
} from '../lib/colorMode';
import { ScopedByAncestorContext } from './scope-context';

/** True when the enclosing `Root` resolved a dark chrome. */
export const ChromeDarkContext: InjectionKey<Readonly<Ref<boolean>>> = Symbol('ChromeDarkContext');

/**
 * Whether a colour mode is dark right now. `'system'` follows the OS setting and updates
 * when it changes; `undefined` is light. Call it in `setup`.
 */
export function useResolvedDark(colorMode: () => ColorMode | undefined): ComputedRef<boolean> {
  const systemDark = ref(prefersColorSchemeDark());
  let unsubscribe: (() => void) | undefined;
  watch(
    colorMode,
    (mode) => {
      unsubscribe?.();
      unsubscribe = undefined;
      if (mode === 'system') {
        unsubscribe = subscribeSystemDark((dark) => {
          systemDark.value = dark;
        });
      }
    },
    { immediate: true }
  );
  onBeforeUnmount(() => unsubscribe?.());
  return computed(() => resolveIsDark(colorMode() ?? 'light', systemDark.value));
}

/** True when the enclosing `Root` resolved a dark chrome. Read `.value` while rendering. */
export function useChromeDark(): Readonly<Ref<boolean>> {
  return inject(ChromeDarkContext, ref(false));
}

/**
 * The scope classes a self-scoping chrome part adds to its root element: `docx-editor`, and
 * `dark` with it under a dark `Root`, or nothing when an ancestor already carries the scope.
 * Call it in `setup` and the returned function while rendering, so a colour-mode change
 * re-renders the part. Ends with a space so it concatenates cleanly.
 */
export function useChromeScopeClassName(): () => '' | 'docx-editor ' | 'docx-editor dark ' {
  const scoped = inject(ScopedByAncestorContext, false);
  const dark = useChromeDark();
  return () => {
    if (scoped) return '';
    return dark.value ? 'docx-editor dark ' : 'docx-editor ';
  };
}
