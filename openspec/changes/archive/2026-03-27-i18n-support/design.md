## Context

The docx-editor is a client-side WYSIWYG editor for DOCX files built with React + ProseMirror. All ~200+ user-facing strings (dialog titles, button labels, tooltips, placeholders, aria-labels, error messages, menu items) are hardcoded in English across ~25+ component files.

The editor is consumed as an npm package (`@eigenpal/docx-js-editor`) via the `<DocxEditor>` component. Consumers need to localize the UI for their end users without forking.

The codebase already uses React Context in several places (e.g., editor state). There are no existing i18n patterns or dependencies.

## Goals / Non-Goals

**Goals:**

- Extract all hardcoded strings into a single structured English locale file (`i18n/en.json`)
- Provide a `locale` prop on `<DocxEditor>` for partial overrides with deep merge against defaults
- Ship a `useTranslation()` hook that all components use for string lookup
- Make it trivial for the community to contribute translations via `i18n/{lang}.json` files
- Export TypeScript types so locale objects get autocomplete and type-checking
- Zero new runtime dependencies
- Keep bundle impact under 10KB for the default locale

**Non-Goals:**

- Pluralization rules or ICU message format (overkill for UI labels)
- RTL layout support (separate effort, different concern)
- Runtime locale switching without re-render (not needed — prop change triggers re-render naturally)
- Server-side rendering optimizations
- Date/number formatting (not currently needed)
- Integration with external i18n frameworks (consumers can bridge themselves)

## Decisions

### 1. Plain JSON files over TypeScript locale files

**Decision:** Store translations as `i18n/en.json`, `i18n/pl.json`, etc.

**Rationale:** JSON files are the universal standard for translation tools (Crowdin, Weblate, POEditor). Community translators don't need to know TypeScript. JSON is tree-shakeable when imported — bundlers only include what's used.

**Alternatives considered:**

- TypeScript files (`locales/en.ts`): Better type safety at authoring time, but creates a barrier for non-developer translators and doesn't work with translation management tools.
- YAML: More readable for large files but requires a parser dependency.

### 2. Multi-level nested key structure

**Decision:** Organize strings hierarchically — nest as deep as makes semantic sense. For example:

```json
{
  "toolbar": { "bold": "Bold", "italic": "Italic" },
  "dialogs": {
    "findReplace": {
      "title": "Find and Replace",
      "buttons": { "replace": "Replace", "replaceAll": "Replace All" },
      "options": { "matchCase": "Match case", "wholeWords": "Whole words" }
    },
    "hyperlink": {
      "title": "Insert Hyperlink",
      "tabs": { "webAddress": "Web Address", "bookmark": "Bookmark" }
    }
  }
}
```

**Rationale:** Natural grouping by feature → sub-feature → element. Keys like `t('dialogs.findReplace.buttons.replace')` are self-documenting and easy to grep. Types are auto-inferred from the JSON so depth adds zero maintenance cost.

**Alternatives considered:**

- Completely flat (`"toolbar_bold": "Bold"`): Harder to organize, no logical grouping, poor autocomplete.
- Two-level max: Artificially constrains organization — forces awkward flattening of dialogs that have distinct sections (buttons, labels, options).

### 3. React Context + `useTranslation()` hook

**Decision:** A `LocaleContext` provides the merged locale object. A `useTranslation()` hook returns a `t(key)` function. The context provider wraps the editor inside `<DocxEditor>`.

**Rationale:** React Context is zero-dependency, already used in the codebase, and the natural React pattern. The `t()` function is the universal i18n convention — developers immediately understand it.

**Implementation:**

```typescript
// src/i18n/LocaleContext.tsx
const LocaleContext = createContext<LocaleStrings>(defaultLocale);

export function LocaleProvider({ locale, children }) {
  const merged = useMemo(() => deepMerge(defaultLocale, locale), [locale]);
  return <LocaleContext.Provider value={merged}>{children}</LocaleContext.Provider>;
}

export function useTranslation() {
  const strings = useContext(LocaleContext);
  const t = useCallback((key: string) => {
    // "toolbar.bold" → strings.toolbar.bold
    return getNestedValue(strings, key) ?? key;
  }, [strings]);
  return { t };
}
```

**Alternatives considered:**

- Prop drilling: Doesn't scale across 25+ components.
- External library (react-intl, i18next): Adds 20-40KB dependency, overkill for static string lookup.

### 4. Deep merge with English fallback

**Decision:** `locale` prop accepts `Partial<LocaleStrings>` (recursively partial). Deep merge at the provider level ensures any missing key falls back to English. The `t()` function returns the key itself as ultimate fallback.

**Rationale:** Consumers should only need to override the strings they care about. A translator working on a new language can start with just a few strings and incrementally complete the file.

### 5. Community locale files as optional imports

**Decision:** Locale files live at `i18n/{lang}.json` in the package. Consumers import them explicitly:

```typescript
import pl from '@eigenpal/docx-js-editor/i18n/pl.json';
<DocxEditor locale={pl} />
```

**Rationale:** Explicit imports mean only the chosen locale gets bundled. No dynamic `import()` or fetch needed. The `i18n/` directory is an obvious contribution point — contributors just add a new JSON file.

### 6. Auto-derived types from en.json (no manual interface)

**Decision:** `LocaleStrings` is automatically inferred from the default English JSON import — no manually maintained interface. The JSON file is the single source of truth for both strings and types.

**Implementation:**

```typescript
// src/i18n/types.ts
import en from '../../i18n/en.json';

// Auto-derived from the JSON structure — never manually maintained
export type LocaleStrings = typeof en;

// Recursive partial for the locale prop
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
export type PartialLocaleStrings = DeepPartial<LocaleStrings>;

// Auto-derived dot-path keys for type-safe t() function
type DotPath<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? DotPath<T[K], `${Prefix}${K}.`>
    : `${Prefix}${K}`;
}[keyof T & string];

export type TranslationKey = DotPath<LocaleStrings>;
```

**Rationale:** Adding a new string to `en.json` automatically updates the type — zero drift risk, zero manual sync. The `DotPath` utility type generates a union of all valid dot-notation keys (`"toolbar.bold" | "dialogs.findReplace.title" | ...`) so `t()` gets full autocomplete and compile-time checking for free. Multi-level nesting works naturally since `DotPath` recurses through the full JSON structure.

**Alternatives considered:**

- Manually maintained interface: Drift risk, duplicate effort on every string change. Every new string requires editing two files.
- Code generation script: Extra build step, CI complexity. `typeof import` is simpler and always correct.

## Risks / Trade-offs

**[Risk] String key typos at call sites cause silent fallback to key name**
→ Mitigation: TypeScript overload on `t()` that accepts only valid dot-path keys (using template literal types). Invalid keys produce a compile error.

**[Risk] ~~en.json and LocaleStrings type drift~~ — ELIMINATED**
→ Types are auto-derived from `en.json` via `typeof import`. No manual sync needed.

**[Risk] Community-contributed locales become stale as new strings are added**
→ Mitigation: Ship a `i18n/missing-keys.ts` utility or CI script that diffs a locale file against en.json and reports missing keys. Include instructions in CONTRIBUTING.md.

**[Risk] Performance — re-creating merged locale on every render**
→ Mitigation: `useMemo` on the deep merge keyed on the `locale` prop reference. Since locale is typically static, this memoizes effectively.

**[Trade-off] No pluralization support**
→ Acceptable for now. The editor UI uses very few count-dependent strings. Can be added later with a simple `t(key, { count })` extension without breaking changes.

**[Trade-off] No interpolation support initially**
→ Support simple `{variable}` interpolation in `t()` for dynamic strings like "X of Y matches". This is lightweight to implement and avoids string concatenation anti-patterns.
