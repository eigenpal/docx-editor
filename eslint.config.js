import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import vueParser from 'vue-eslint-parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

// Framework-isolation: keep core/react/vue/agents packages from cross-importing
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
  '@eigenpal/docx-editor-react',
  '@eigenpal/docx-editor-react/*',
];

const VUE_GROUP = [
  'vue',
  '@vue/*',
  '@vitejs/plugin-vue',
  '@eigenpal/docx-editor-vue',
  '@eigenpal/docx-editor-vue/*',
];

// Dynamic-import specifiers — listed explicitly because AST `ImportExpression`
// selectors compare against literal source values, not glob patterns. The
// static rule still covers `react-dom/*` etc. via minimatch; dynamic catches
// the bare-specifier hot path.
const REACT_DYNAMIC = ['react', 'react-dom', 'react-dom/client', '@eigenpal/docx-editor-react'];
const VUE_DYNAMIC = ['vue', '@eigenpal/docx-editor-vue'];

const NO_REACT_MSG = `Vue/core files cannot import React. Use @eigenpal/docx-editor-core for shared logic. ${SPEC}`;
const NO_VUE_MSG = `React/core files cannot import Vue. Use @eigenpal/docx-editor-core for shared logic. ${SPEC}`;
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
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.js', '*.config.ts'],
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

  // Vue adapter: no React imports.
  { files: ['packages/vue/src/**/*.{ts,tsx,vue}'], rules: restrictReact },

  // React adapter: no Vue imports.
  { files: ['packages/react/src/**/*.{ts,tsx}'], rules: restrictVue },

  // Core: framework-agnostic; no React, no Vue.
  { files: ['packages/core/src/**/*.{ts,tsx}'], rules: restrictBoth },

  // Agent-use UI subpaths mirror the editor adapters.
  { files: ['packages/agents/src/vue/**/*.{ts,tsx,vue}'], rules: restrictReact },
  { files: ['packages/agents/src/react/**/*.{ts,tsx}'], rules: restrictVue },

  // Top-level adapter entries: vue.ts can import Vue but not React; symmetric
  // for react.ts. Mirrors how packages/{vue,react}/src/index.ts work.
  // The two top-level React hooks (useAgentChat, useDocxAgentTools) are
  // React-only — they import React legitimately, and `restrictVue` bans
  // them from also importing Vue. Without this rule a future Vue
  // import in either file would lint clean (gap caught by §10.3 audit).
  {
    files: ['packages/agents/src/vue.ts', 'packages/agents/src/ai-sdk/vue.ts'],
    rules: restrictReact,
  },
  {
    files: [
      'packages/agents/src/react.ts',
      'packages/agents/src/ai-sdk/react.ts',
      'packages/agents/src/useAgentChat.ts',
      'packages/agents/src/useDocxAgentTools.ts',
    ],
    rules: restrictVue,
  },

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

  // editor-page.ts is the e2e Page Object Model — a single class covering
  // every editor interaction. It's intentionally one file; the cap still
  // enforces a ceiling (modest headroom over its current size) so it can't
  // grow unbounded.
  {
    files: ['e2e/helpers/editor-page.ts'],
    rules: {
      'max-lines': ['error', { max: 1650, skipBlankLines: false, skipComments: false }],
    },
  },

  // layout-engine/types.ts is the canonical schema definition for the
  // layout model — single file by design (cross-referencing types). Bumped
  // modestly above the default to accommodate new revision-tracking and
  // table-pagination fields without forcing a split that would obscure the
  // schema.
  {
    files: ['packages/core/src/layout-engine/types.ts'],
    rules: {
      'max-lines': ['error', { max: 1080, skipBlankLines: false, skipComments: false }],
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
  // composable wiring inline (reusable part is useControllableBoolean). Modest
  // headroom while a real split is planned.
  {
    files: ['packages/vue/src/components/DocxEditor.vue'],
    rules: {
      'max-lines': ['error', { max: 1170, skipBlankLines: false, skipComments: false }],
    },
  },

  // Toolbar.vue is the formatting-bar SFC — a single template/script/style
  // block covering every toolbar control. Localizing the tooltips and adding
  // aria-labels pushed it just over the default 1000, since each labelled
  // button wraps to multiple lines under printWidth. Modest headroom while a
  // real split is planned; the cap still enforces a ceiling.
  {
    files: ['packages/vue/src/components/Toolbar.vue'],
    rules: {
      'max-lines': ['error', { max: 1100, skipBlankLines: false, skipComments: false }],
    },
  },

  // Agent-use framework-agnostic surface — top-level utilities + tools/,
  // ai-sdk/ (excluding the per-framework entry files), i18n/, __tests__/.
  // TODO: drop the `ignores` list once task §9 migrates the React hooks
  // into src/react/.
  {
    files: [
      'packages/agents/src/*.{ts,tsx}',
      'packages/agents/src/{tools,ai-sdk,i18n,__tests__}/**/*.{ts,tsx}',
    ],
    ignores: [
      'packages/agents/src/react.ts',
      'packages/agents/src/vue.ts',
      'packages/agents/src/useAgentChat.ts',
      'packages/agents/src/useDocxAgentTools.ts',
      'packages/agents/src/ai-sdk/react.ts',
      'packages/agents/src/ai-sdk/vue.ts',
    ],
    rules: restrictBoth,
  },
];
