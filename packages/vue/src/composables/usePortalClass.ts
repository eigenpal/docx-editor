import {
  computed,
  inject,
  provide,
  unref,
  type ComputedRef,
  type InjectionKey,
  type MaybeRef,
} from 'vue';

/**
 * Teleported editor chrome (context menus, tooltips) renders into `<body>`,
 * OUTSIDE the editor's `.ep-root` element where the `--doc-*` color tokens —
 * and their `.ep-root.dark` overrides — are defined. A teleported element that
 * carries no token-bearing class resolves every `var(--doc-*)` to empty, so its
 * background, border and shadow vanish and it renders unstyled (#— Vue context
 * menu regression after the color-token migration).
 *
 * The editor provides its root classes here; each teleported root re-applies
 * them so it inherits the tokens (and the current light/dark theme). `.ep-root`
 * only defines custom properties — no layout — so applying it to a floating
 * menu is side-effect-free. Teleporting stays targeted at `<body>` so a fixed
 * menu escapes any transformed/overflow ancestor a host app may have.
 */
const PORTAL_CLASS_KEY: InjectionKey<ComputedRef<Record<string, boolean>>> =
  Symbol('docx-portal-class');

export function provideDocxPortalClass(isDark: MaybeRef<boolean>): void {
  provide(
    PORTAL_CLASS_KEY,
    computed(() => ({ 'ep-root': true, dark: !!unref(isDark) }))
  );
}

/**
 * Class binding to apply to a teleported root so it inherits the editor's
 * `--doc-*` tokens and theme. Falls back to a light `.ep-root` when used
 * outside a provider (e.g. an isolated component test).
 */
export function useDocxPortalClass(): ComputedRef<Record<string, boolean>> {
  return inject(
    PORTAL_CLASS_KEY,
    computed(() => ({ 'ep-root': true }))
  );
}
