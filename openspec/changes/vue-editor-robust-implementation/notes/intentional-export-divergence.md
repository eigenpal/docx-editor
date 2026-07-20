# Intentional export divergences

`scripts/check-export-parity.mjs` reads this file. Any subpath listed here in a backtick-prefixed bullet is allowed to differ between the React and Vue adapters.

Use this for **deliberate** asymmetry. Don't use it to silence drift you should fix — fix the lagging adapter instead.

## Allowed while adapters expose framework-native helper subpaths

- `./composables` (vue-only): Vue-native composition API helpers. React's equivalent is `./hooks`.
- `./hooks` (react-only): React-native hooks. Vue's equivalent is `./composables`.

## Allowed named exports after un-stub

- `LocaleProvider` (react-only): React context provider component. Vue uses `provideLocale` and `i18nPlugin`.
- `LocaleProviderProps` (react-only): Prop type for the React provider component.
- `provideLocale` (vue-only): Vue composition API provider helper. React uses `LocaleProvider`.
- `i18nPlugin` (vue-only): Vue app plugin install hook. React has no equivalent plugin system.
- `defaultLocale` (vue-only): Vue-native locale export for app-level plugin setup.
- `VueRenderAsyncOptions` (vue-only): Framework-specific alias retained for consumers who want explicit Vue naming; `RenderAsyncOptions` is also exported for cross-adapter docs.

## Named-export gate mode

Subpath drift (this file's domain) is always strict. Named-export drift is strict after the un-stub readiness pass; the remaining framework-native names above are deliberate.

## Format

The script picks up backticked specifiers from list items. Anything else (paragraphs, headings) is documentation. Keep entries one-per-line so removing them later is a clean diff.
