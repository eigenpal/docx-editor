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
  // Pro Vue review rail: Vue composables in defineComponent setup(), same as packages/vue.
  {
    files: ['packages/pro/src/vue/**/*.{ts,tsx}'],
    rules: {
      ...restrictReact,
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    files: ['packages/pro/src/__tests__/**/*vue*.{ts,tsx}'],
    rules: {
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
      'packages/vue/src/components/DocxEditor.tsx',
    ],
    rules: {
      'max-lines': ['error', { max: 2000, skipBlankLines: false, skipComments: false }],
    },
  },

  // word-features.ts is the feature-support matrix — a flat data table with one
  // entry per Word feature and no logic. It grows by a dozen lines every time a
  // feature ships, which is the file working as intended, not a file that wants
  // splitting: the whole point is that every claim lives in one list. Raised so
  // the next feature does not have to negotiate with the linter, and so the cap
  // is never met by trimming an honest note.
  {
    files: ['docs/site/data/word-features.ts'],
    rules: {
      'max-lines': ['error', { max: 1400, skipBlankLines: false, skipComments: false }],
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

  // TODO: split these files and delete this block.
  //
  // 40 files sit over the 1000-line cap. Left as plain errors they make a red
  // lint the normal state of the repo, which is how a real error goes unread.
  // Each cap below is the file's current length plus a little headroom, so
  // nothing here can grow while the splits are pending, and a file that does
  // get split drops back under the global cap and comes off this list.

  {
    files: [
      'packages/core/src/editor/chrome-controls.ts',
      'packages/core/src/editor/paginated-surface-contract.ts',
      'packages/core/src/layout/semantic-table.ts',
      'packages/core/src/store/__tests__/table-resize-ops.test.ts',
      'packages/core/src/store/store/review-reads.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 1100, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: [
      'packages/core/src/editor/surface-pointer.ts',
      'packages/core/src/store/package/ooxml-drawing-rules.ts',
      'packages/core/src/store/store/tree-op-tracked.ts',
      'packages/react/src/editor/menu/parts.tsx',
    ],
    rules: {
      'max-lines': ['error', { max: 1200, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: [
      'packages/core/src/editor/__tests__/docx-editor.test.ts',
      'packages/core/src/editor/__tests__/table-command-plan.test.ts',
      'packages/core/src/editor/docx-editor-images.ts',
      'packages/core/src/store/__tests__/table-row-ops.test.ts',
      'packages/core/src/store/store/tree-package-store.ts',
      'packages/core/src/store/store/tree-op-types.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 1300, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: [
      'packages/core/src/layout/drawing-layout.ts',
      'packages/core/src/layout/semantic-hit-test.ts',
      'packages/core/src/store/__tests__/image-resources.test.ts',
      'packages/core/src/store/package/image-resources.ts',
      'packages/react/test/toolbar-composition.test.tsx',
    ],
    rules: {
      'max-lines': ['error', { max: 1500, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: ['packages/core/src/store/__tests__/table-column-ops.test.ts'],
    rules: {
      'max-lines': ['error', { max: 1500, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: [
      'packages/core/src/editor/__tests__/surface-table-interaction.test.ts',
      'packages/core/src/store/__tests__/content-control-ops.test.ts',
      'packages/core/src/store/__tests__/drawing-package-edit.test.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 1600, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: [
      'packages/core/src/binding/tree-session.ts',
      'packages/core/src/contracts/editor.ts',
      'packages/core/src/layout/paragraph-flow.ts',
      'packages/core/src/store/store/tree-op-drawings.ts',
      'packages/core/src/store/store/tree-op-table-cell-properties.ts',
      'packages/pro/src/__tests__/review-facade.test.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 1700, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: ['packages/core/src/store/__tests__/table-cell-properties.test.ts'],
    rules: {
      'max-lines': ['error', { max: 1800, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: [
      'packages/core/src/layout/semantic-table-layout.ts',
      'packages/core/src/store/store/tree-op-content-controls.ts',
      'packages/core/src/store/store/tree-op-tables.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 1900, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: ['packages/core/src/store/package/drawing-projection.ts'],
    rules: {
      'max-lines': ['error', { max: 2000, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: [
      'packages/core/src/store/package/ooxml-tree.ts',
      'packages/pro/src/react/DocxEditorReview.tsx',
    ],
    rules: {
      'max-lines': ['error', { max: 2100, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: ['packages/core/src/editor/docx-editor.ts'],
    rules: {
      'max-lines': ['error', { max: 2650, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: ['packages/core/src/store/__tests__/ooxml-tree.test.ts'],
    rules: {
      'max-lines': ['error', { max: 2400, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: ['packages/core/src/automation/plan.ts'],
    rules: {
      'max-lines': ['error', { max: 2950, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: ['packages/core/src/layout/semantic-layout.ts'],
    rules: {
      'max-lines': ['error', { max: 3500, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: ['packages/fonts/src/google-catalog.generated.ts'],
    rules: {
      'max-lines': ['error', { max: 3500, skipBlankLines: false, skipComments: false }],
    },
  },
];
