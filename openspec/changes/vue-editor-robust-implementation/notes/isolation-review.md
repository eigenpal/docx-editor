# Framework-Isolation Audit (OpenSpec §10.3)

Branch: `1.0.0-release` @ `f83549a`. Lint baseline: `bun run lint` reports
**0 errors, 146 warnings** — zero current isolation violations.

## What the lint enforces today

`eslint.config.js` defines four rule blocks composed from two helpers,
`restrictStatic` (`no-restricted-imports` glob patterns against `REACT_GROUP` /
`VUE_GROUP`) and `restrictDynamic` (`no-restricted-syntax` matching
`ImportExpression[source.value=...]` literal specifiers — needed because
`no-restricted-imports` skips dynamic imports). These are wired to globs:
`restrictReact` on `packages/vue/src/**` and `packages/agent-use/src/vue/**`
plus `vue.ts` + `ai-sdk/vue.ts`; `restrictVue` symmetrically on the React side;
`restrictBoth` on `packages/core/src/**` and the framework-agnostic agent-use
top-level glob (`src/*.{ts,tsx}` + `src/{tools,ai-sdk}/**`) with an explicit
`ignores` list for the React-hook entry shims (`useAgentChat.ts`,
`useDocxAgentTools.ts`) and the typed `react.ts` / `vue.ts` / `ai-sdk/{react,vue}.ts`
adapter entries (which get `restrictReact` or `restrictVue` instead).

## Findings

- `packages/agent-use/src/useAgentChat.ts:15` — imports `react` —
  **medium**. File is in the `ignores` block of `restrictBoth` and is **not**
  picked up by any `restrictVue` glob, so a future Vue import here would lint
  clean. Tighten lint: add this file (and `useDocxAgentTools.ts`) to the
  `restrictVue` block alongside `react.ts`. The eslint config already TODOs
  migrating these into `src/react/`, which would solve it structurally; until
  then, the explicit listing closes the gap.
- `packages/agent-use/src/useDocxAgentTools.ts:37` — imports `react` —
  **medium**. Same root cause and fix as above.
- `packages/agent-use/src/i18n/format-message.ts` — **low / informational**.
  Folder is genuinely framework-agnostic (no imports at all), but the
  framework-agnostic glob `src/*.{ts,tsx}` + `src/{tools,ai-sdk}/**` does
  **not** match `src/i18n/**`. Tighten lint: extend the agnostic glob to
  `src/{tools,ai-sdk,i18n}/**` so future additions stay covered.
- `packages/agent-use/src/__tests__/**` — **low / informational**. Tests are
  uncovered by any framework block. Currently clean (grep finds no `react` /
  `vue` imports), but a test that imports `react` to render a hook would lint
  clean. Acceptable if intentional (tests legitimately need both frameworks);
  document the carve-out or add a `restrictBoth` exemption block for
  `__tests__/**`.
- `packages/core/src/utils/formatToStyle.ts:15` and
  `packages/core/src/utils/selectionHighlight.ts:14` — comments mention
  `React.CSSProperties` for documentation context — **low**. No imports, lint
  correctly skips. One-off, intentional cross-reference comment. No action.
- `packages/agent-use/src/vue.ts:22`, `packages/agent-use/src/ai-sdk/vue.ts:12`,
  `packages/agent-use/src/vue/composables/useAgentBridge.ts:8` — `import { ref } from 'vue'`
  inside JSDoc `@example` blocks — **low**. These are example strings, not real
  imports; the AST never sees them. Lint correctly skips. No action.
- `packages/agent-use/src/react/components/AgentPanel.tsx:16`,
  `AgentChat.tsx:15` — `import type { ReactNode, CSSProperties, FormEvent } from 'react'` —
  **none**. Type-only imports inside the React-only subtree, expected and
  permitted. No finding.

## Negative confirmations

- **packages/core/src/** — no React or Vue imports (static, dynamic, or
  type-only). `import type` from `react` / `vue` / `@vue/*`: zero hits. Comments
  reference `React.CSSProperties` for type-shape documentation only.
- **packages/react/src/** — no Vue imports of any kind. No `defineComponent`,
  `ref(`, `reactive(`, `computed(`, `onMounted` references in `.ts`/`.tsx`
  files.
- **packages/vue/src/** — no React imports. No `useState`/`useEffect`/`useRef`/
  `forwardRef`/`ReactNode`/`JSX.` identifiers in `.ts`/`.tsx`/`.vue` files.
  `package.json` has only `vue` peer dep + `@eigenpal/docx-editor-core` runtime
  dep; no `react` leakage.
- **packages/agent-use/src/bridge.ts, server.ts, batch.ts, changes.ts,
  comments.ts, content.ts, discovery.ts, DocxReviewer.ts, errors.ts,
  index.ts, reviewerBridge.ts, textSearch.ts, types.ts, utils.ts,
  wordCompat.ts, agent-types.ts** — clean, no framework imports.
- **packages/agent-use/src/tools/**, **ai-sdk/{server,shared}.ts**, **mcp/** —
  clean, no framework imports.
- **package.json `dependencies`** — no framework runtime dep in the wrong
  package. `vue` and `react` are peer-only across all four packages; the only
  runtime deps in `agent-use` are `docxtemplater`, `jszip`, `pizzip`, `xml-js`.
- **No string-named runtime detection** (`typeof window.React`,
  `globalThis.Vue`, etc.) anywhere in the workspace.

## Verdict

**Lint config has gaps.** Two:

1. `useAgentChat.ts` / `useDocxAgentTools.ts` are explicit React hook entries
   but only protected against React (via the `restrictBoth` ignores carve-out
   that pulls them out of agnostic) — they have no `restrictVue` rule. Add them
   to the `restrictVue` files block, or migrate them into `src/react/` per the
   existing TODO and drop the ignores list.
2. `packages/agent-use/src/i18n/**` and `packages/agent-use/src/__tests__/**`
   are not matched by any framework-isolation block. Currently clean, but
   future drift would lint silently. Extend the agnostic glob to include
   `i18n/`, and decide explicitly whether `__tests__/` should be agnostic or
   carved out.

No active bypasses. The audit found zero real cross-framework imports in
production code; all findings are coverage-gap risks, not violations.
