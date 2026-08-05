import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import vueParser from 'vue-eslint-parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

// Framework-isolation: keep core/react/vue/editor-api packages from cross-importing
// each other's UI framework. Spec:
//   openspec/changes/vue-editor-robust-implementation/specs/framework-isolation-lint/spec.md

const SPEC =
  'See openspec/changes/vue-editor-robust-implementation/specs/framework-isolation-lint/spec.md';

// `*` and `/*` are required as separate entries — globs match path-with-suffix,
// the bare specifier matches no-suffix. ESLint patterns use minimatch.
const REACT_GROUP = [
  'react',
  'react-dom',
  'react-dom/*',
  '@vitejs/plugin-react',
  '@docx-editor.dev/react',
  '@docx-editor.dev/react/*',
];

const VUE_GROUP = [
  'vue',
  '@vue/*',
  '@vitejs/plugin-vue',
  '@docx-editor.dev/vue',
  '@docx-editor.dev/vue/*',
];

// Dynamic-import specifiers — listed explicitly because AST `ImportExpression`
// selectors compare against literal source values, not glob patterns. The
// static rule still covers `react-dom/*` etc. via minimatch; dynamic catches
// the bare-specifier hot path.
const REACT_DYNAMIC = ['react', 'react-dom', 'react-dom/client', '@docx-editor.dev/react'];
const VUE_DYNAMIC = ['vue', '@docx-editor.dev/vue'];

const NO_REACT_MSG = `Vue/core files cannot import React. Use @docx-editor.dev/core for shared logic. ${SPEC}`;
const NO_VUE_MSG = `React/core files cannot import Vue. Use @docx-editor.dev/core for shared logic. ${SPEC}`;
const NO_BOTH_MSG = `Core stays UI-framework-agnostic. ${SPEC}`;

// Helpers compose into a `rules` object. Keys are disjoint by design —
// restrictStatic owns `no-restricted-imports`, restrictDynamic owns
// `no-restricted-syntax` — so spreading them merges cleanly.
const restrictStatic = (banned, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: banned, message }] }],
});

// ESLint's `no-restricted-imports` skips `await import(...)` (it's an
// `ImportExpression` AST node, not `ImportDeclaration`). Use
// `no-restricted-syntax` to match dynamic imports by literal source value.
const restrictDynamic = (specifiers, message) => ({
  'no-restricted-syntax': [
    'error',
    ...specifiers.map((s) => ({
      selector: `ImportExpression[source.value=${JSON.stringify(s)}]`,
      message,
    })),
  ],
});

const restrictReact = {
  ...restrictStatic(REACT_GROUP, NO_REACT_MSG),
  ...restrictDynamic(REACT_DYNAMIC, NO_REACT_MSG),
};

const restrictVue = {
  ...restrictStatic(VUE_GROUP, NO_VUE_MSG),
  ...restrictDynamic(VUE_DYNAMIC, NO_VUE_MSG),
};

const restrictBoth = {
  ...restrictStatic([...REACT_GROUP, ...VUE_GROUP], NO_BOTH_MSG),
  ...restrictDynamic([...REACT_DYNAMIC, ...VUE_DYNAMIC], NO_BOTH_MSG),
};

const commonRules = {
  '@typescript-eslint/no-unused-vars': [
    'warn',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/no-explicit-any': 'warn',
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'prefer-const': 'error',
  'max-lines': ['error', { max: 1000, skipBlankLines: false, skipComments: false }],
  // Loop labels are minified to single characters, and Vite's SSR
  // module-runner transform (vite-node — Nuxt's dev server) rewrites imported
  // bindings to `__vite_ssr_import_N__.<name>` *in label position too*. A
  // minified label that collides with an imported binding of the same name
  // emits `__vite_ssr_import_6__.e: for (...)` — a syntax error that 500s SSR.
  // We ship these bundles to consumers, so keep the emitted JS label-free.
  'no-labels': 'error',
};

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '*.config.js',
      '*.config.ts',
      'packages/editor-api/compat/generated/**',
    ],
  },

  // Vue SFC files: parse with vue-eslint-parser, delegate <script lang="ts"> to tsparser.
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsparser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: commonRules,
  },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      ...commonRules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
    settings: { react: { version: 'detect' } },
  },

  // Vue adapter: no React imports, and none of React's hook rules.
  //
  // `react-hooks/rules-of-hooks` keys off the `use` PREFIX, so it reads a Vue composable
  // called inside `setup()` as a React hook called outside a component and errors. The
  // convention it is enforcing does not exist here — Vue has no rules-of-hooks ordering
  // contract — so the rule can only ever produce false positives in this package.
  {
    files: ['packages/vue/src/**/*.{ts,tsx,vue}'],
    rules: {
      ...restrictReact,
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  // React adapter: no Vue imports.
  { files: ['packages/react/src/**/*.{ts,tsx}'], rules: restrictVue },

  // The DocxEditor entry components (React and Vue twins) have a relaxed
  // 2000-line cap while the extraction effort (tracked in MEMORY.md)
  // continues. The cap still enforces a ceiling so the files can't grow
  // unbounded; the rest of the repo stays at 1000.
  {
    files: [
      'packages/react/src/components/DocxEditor.tsx',
      'packages/vue/src/components/DocxEditor.vue',
    ],
    rules: {
      'max-lines': ['error', { max: 2000, skipBlankLines: false, skipComments: false }],
    },
  },

  // DocxEditor.vue is the host component — same role as React's
  // DocxEditor.tsx (which has a 2000-line cap). The React-parity callback
  // props (#720) add per-prop wiring that must live inline in the SFC (the
  // handlers are passed into useDocxEditor and can't be hoisted); the reusable
  // pieces were extracted to useHostCallbacks. The Insert > Break submenu adds
  // its own inline handler wiring (page + section breaks), as does the
  // File > Open override (onOpen + showFileOpen). The controlled
  // commentsSidebarOpen / onCommentsSidebarOpenChange pair adds its own emit +
  // composable wiring inline (reusable part is useControllableBoolean), plus an
  // explicit `undefined` withDefaults entry so Vue doesn't cast the absent
  // Boolean prop to `false`. Bumped to 1210 for headroom (it kept landing 1-3
  // lines over on each small prop addition) while a real split is planned.
  {
    files: ['packages/vue/src/components/DocxEditor.vue'],
    rules: {
      'max-lines': ['error', { max: 1210, skipBlankLines: false, skipComments: false }],
    },
  },

  // useDocxEditor.ts is the Vue composable counterpart to React's PagedEditor —
  // a single orchestrator wiring the dual-rendering pipeline (hidden PM views,
  // painter, selection, layout triggers, HF + footnote surfaces). Editable
  // footnotes (React parity, same change that bumped DocxEditor.vue to 1250)
  // added the footnote PM/overlay wiring here too, pushing it just over the
  // default 1000. Modest headroom while a real split (lift shared orchestration
  // into core, per MEMORY.md) is planned; the cap still enforces a ceiling.
  {
    files: ['packages/vue/src/composables/useDocxEditor.ts'],
    rules: {
      'max-lines': ['error', { max: 1060, skipBlankLines: false, skipComments: false }],
    },
  },

  // Toolbar.vue is the formatting-bar SFC — a single template/script/style
  // block covering every toolbar control. Localizing the tooltips and adding
  // aria-labels pushed it just over the default 1000, since each labelled
  // button wraps to multiple lines under printWidth. The "Document fonts"
  // picker group added another modest chunk. Headroom while a real split is
  // planned; the cap still enforces a ceiling.
  {
    files: ['packages/vue/src/components/Toolbar.vue'],
    rules: {
      'max-lines': ['error', { max: 1200, skipBlankLines: false, skipComments: false }],
    },
  },

  // semantic-layout.ts is the story loop: section flow, paragraph fragmentation
  // and table-row pagination advance ONE cursor, and a paragraph that spans a
  // page boundary is decided by all three at once. Splitting them into modules
  // would mean passing that cursor across a boundary and re-deriving the same
  // state on the other side. semantic-table-layout.ts is the same argument for
  // row-split pagination, which has to stay with cell flow and finalize because
  // a row's real height is only known after its cells have laid out. Both were
  // carrying a blanket `eslint-disable max-lines`, which removes the ceiling
  // instead of raising it; these keep the ceiling, with headroom.
  {
    files: [
      'packages/core/src/layout/semantic-layout.ts',
      'packages/core/src/layout/semantic-table-layout.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 1500, skipBlankLines: false, skipComments: false }],
    },
  },

  // table-borders.ts resolves the collapsed border model: cell-over-table
  // inheritance, the conflict rule (width, then style, then colour darkness,
  // then reading order), and the per-column ownership grid that decides which
  // of two adjacent cells draws a shared edge. Those cannot be separated —
  // ownership is decided BY the conflict outcome — and the file sat at 997 of
  // the default 1000 after the Word-matching conflict fix, which is one edit
  // from a build break. Bumped for headroom while the ceiling still holds.
  {
    files: ['packages/core/src/layout/table-borders.ts'],
    rules: {
      'max-lines': ['error', { max: 1100, skipBlankLines: false, skipComments: false }],
    },
  },

  // The document automation package is framework-neutral end to end. There is no per-framework
  // entry to carve out any more: the two published entries differ by whether they reach a live
  // editor, not by which UI library the host chose.
  {
    files: ['packages/editor-api/src/**/*.ts'],
    rules: restrictBoth,
  },
];
