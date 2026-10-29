// The chrome color mode a `DocxEditorRoot` declares, for the parts that scope themselves.
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
  onMounted,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue';
import { resolveIsDark, subscribeSystemDark, type ColorMode } from '../lib/colorMode';
import { ChromeDarkContext, ScopedByAncestorContext } from './scope-context';

export { ChromeDarkContext };

/**
 * Whether a color mode is dark right now. `'system'` follows the OS setting and updates
 * when it changes; `undefined` is light. Call it in `setup`.
 *
 * The OS setting is read only once mounted: a server render and the first client render are
 * both light for `'system'`, so hydration matches, and the mounted component corrects itself.
 */
export function useResolvedDark(colorMode: () => ColorMode | undefined): ComputedRef<boolean> {
  const systemDark = ref(false);
  let unsubscribe: (() => void) | undefined;
  const follow = (mode: ColorMode | undefined) => {
    unsubscribe?.();
    unsubscribe = undefined;
    if (mode === 'system') {
      // Reports the current value at once, then every change.
      unsubscribe = subscribeSystemDark((dark) => {
        systemDark.value = dark;
      });
    }
  };
  let mounted = false;
  watch(colorMode, (mode) => {
    if (mounted) follow(mode);
  });
  onMounted(() => {
    mounted = true;
    follow(colorMode());
  });
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
 * Call it in `setup` and the returned function while rendering, so a color-mode change
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

/**
 * The theme the enclosing editor resolved from `colorMode`, never `'system'`, as {@link useEditorColorMode} reports it.
 *
 * @public
 */
export type ResolvedColorMode = 'light' | 'dark';

/**
 * What {@link useEditorColorMode} returns.
 *
 * @public
 */
export interface UseEditorColorModeReturn {
  /** The resolved theme: `'dark'` or `'light'`. Updates when `colorMode` or the OS setting changes. */
  readonly colorMode: ComputedRef<ResolvedColorMode>;
}

/**
 * The theme the enclosing `DocxEditorRoot` resolved from its `colorMode`, so parts you build
 * yourself can match the editor chrome. `'system'` resolves to the operating system's current
 * setting and updates when it changes. Outside a `DocxEditorRoot`, or without `colorMode`, the
 * answer is `'light'`. Call it in `setup`.
 *
 * @example
 * ```ts
 * const { colorMode } = useEditorColorMode();
 * const panelClass = computed(() => (colorMode.value === 'dark' ? 'panel panel--dark' : 'panel'));
 * ```
 *
 * @public
 */
export function useEditorColorMode(): UseEditorColorModeReturn {
  const dark = useChromeDark();
  return { colorMode: computed(() => (dark.value ? 'dark' : 'light')) };
}
