## ADDED Requirements

### Requirement: Composable is the primary consumer API

The Vue adapter SHALL document `useDocxEditor()` as the primary consumer-facing API in the README quick-start, with the `<DocxEditor>` component's `ref` (typed as `EditorRefLike`) as a secondary path for agent integration and explicit imperative access. The README's first code example SHALL use the composable.

#### Scenario: Composable quick-start in docs

- **WHEN** a Vue developer reads `packages/vue/README.md`
- **THEN** the first code example uses `const { editor, save, addComment } = useDocxEditor({ documentBuffer })` with a `<DocxEditor :state="editor" />` mount
- **AND** the imperative-ref pattern appears later, scoped to "for agent integration or imperative use cases"

### Requirement: Client-only mount with friendly SSR error

The Vue adapter is client-only. SSR is out of scope for v1. The `<DocxEditor>` component and `useDocxEditor` composable SHALL detect server-side execution and produce a friendly, descriptive error rather than a generic `window is not defined` ReferenceError. The package SHALL document Nuxt usage with `<ClientOnly>` or `defineAsyncComponent` in the Vue README.

#### Scenario: Mount on server fails with clear guidance

- **WHEN** a Nuxt SSR pass tries to render `<DocxEditor>` server-side
- **THEN** the component throws a single clear error: "@eigenpal/docx-editor-vue is client-only. Wrap with <ClientOnly> in Nuxt, or use defineAsyncComponent. See packages/vue/README.md#nuxt"
- **AND** the error does NOT cascade through Vue's rendering pipeline as a generic window-undefined crash

#### Scenario: Nuxt usage documented in Vue README

- **WHEN** a developer searches the Vue README for "Nuxt"
- **THEN** they find a copy-pasteable snippet showing `<ClientOnly><DocxEditor :document-buffer="buffer" /></ClientOnly>` with a one-line explanation
- **AND** the snippet is in the Quick Start section, not buried deep

### Requirement: Vue 3 component entry point

The package SHALL export a `<DocxEditor>` Single-File Component as the primary mounting surface for Vue applications. The component SHALL accept `documentBuffer` (ArrayBuffer or null) and `document` (Document model) as input props, support `v-model:document`, and expose imperative methods through a Vue `ref` (save, addComment, scrollToParaId, etc.) matching the surface of `DocxEditorRef` in the React adapter.

#### Scenario: Mount editor from a DOCX buffer

- **WHEN** a Vue app renders `<DocxEditor :document-buffer="buffer" />` with a valid DOCX `ArrayBuffer`
- **THEN** the editor parses the buffer, lays out the document, and renders the first page within the component's root element
- **AND** the component emits no errors to the console

#### Scenario: Save back to DOCX through the imperative ref

- **WHEN** consumer holds a `ref()` on the component and calls `editorRef.value.save()`
- **THEN** the call resolves with an `ArrayBuffer` of valid DOCX bytes
- **AND** opening the resulting bytes in a new `<DocxEditor>` instance reproduces the same on-screen layout

#### Scenario: Two-way bind via v-model:document

- **WHEN** consumer binds `<DocxEditor v-model:document="doc" />` and the user edits the visible content
- **THEN** the parent's `doc` ref updates with the new Document model on commit
- **AND** programmatically replacing `doc` with a different Document re-renders the editor with the new content

### Requirement: useDocxEditor composable

The package SHALL export a `useDocxEditor(options)` composable that returns a reactive interface — an `editorState` ref (typed as `shallowRef<EditorState | null>`), the imperative API, lifecycle handles, and a `mount(el)` function — for consumers building custom UI on top of the engine.

#### Scenario: Mount imperatively into a DOM node

- **WHEN** a consumer calls `const { mount, editorState } = useDocxEditor({ documentBuffer })` inside `setup()` and calls `mount(elRef.value)` in `onMounted`
- **THEN** the editor mounts into the element and `editorState.value` becomes a non-null `EditorState`
- **AND** subsequent edits update `editorState.value` via `triggerRef`

#### Scenario: Composable cleans up on unmount

- **WHEN** the component owning a `useDocxEditor` call is unmounted
- **THEN** the underlying ProseMirror view is destroyed
- **AND** no detached DOM nodes or pending RAF callbacks leak

### Requirement: ProseMirror reactivity wrapping

EditorState SHALL be wrapped in a Vue `shallowRef`, not `reactive` or `ref`. After every transaction that updates the underlying ProseMirror view, the adapter SHALL call `triggerRef` to notify Vue's reactivity system without triggering a deep proxy walk.

#### Scenario: Large document edits stay performant

- **WHEN** a 200-paragraph document is loaded and the user types continuously for 2 seconds
- **THEN** sustained input latency stays within 10% of the React adapter's measurement on the same fixture
- **AND** Vue's deep reactivity proxies are NOT installed on the EditorState tree

#### Scenario: Toolbar updates react to selection change

- **WHEN** the cursor moves from a non-bold to a bold run
- **THEN** the toolbar's bold button reflects the new state within the same animation frame as React would
- **AND** no `console.warn` fires about reactivity bypass

### Requirement: i18n composable

The package SHALL export a `useTranslation()` composable returning `{ t }` where `t(key, vars?)` performs the same dot-path lookup and `{variable}` interpolation as the React adapter's `useTranslation`. The locale source SHALL be the consumer-provided `i18n` prop on `<DocxEditor>` deep-merged with the package's English defaults.

#### Scenario: Lookup with interpolation

- **WHEN** a Vue component calls `t('dialogs.findReplace.matchCount', { current: 3, total: 15 })`
- **THEN** the returned string equals the React adapter's output for the same key + vars
- **AND** missing keys fall back to English

### Requirement: Plugin host parity (built-in plugins only)

The Vue adapter SHALL accept the same plugin API as React for built-in plugins shipped with `@eigenpal/docx-editor-core`. Third-party plugin authoring is explicitly out of scope for v1; the spec MAY be amended in a follow-up to add Vue-specific composable equivalents of React plugin hooks.

#### Scenario: Built-in template plugin works in Vue

- **WHEN** a Vue consumer mounts `<DocxEditor :plugins="[templatePlugin]" />`
- **THEN** the template-variable highlighting renders identically to the React adapter
- **AND** clicking a template chip dispatches the same core command in both adapters

#### Scenario: Third-party plugin written for React fails fast in Vue

- **WHEN** a consumer tries to mount a React-only plugin (using React-specific hooks) into the Vue adapter
- **THEN** the adapter throws a descriptive error at mount time pointing at "this plugin requires the React adapter"
- **AND** the error does NOT crash the host application

### Requirement: Vue editor ref conforms to `EditorRefLike`

The Vue `<DocxEditor>` component's exposed ref SHALL satisfy the `EditorRefLike` interface from `@eigenpal/docx-editor-agents/bridge` strictly. The Vue adapter SHALL export `DocxEditorRef` typed as `EditorRefLike` (or an extension of it) so a typecheck failure surfaces any method drift between adapter and integration contract. Any method not on `EditorRefLike` that consumers rely on SHALL be added to the agent bridge interface, not bolted onto the Vue ref alone.

#### Scenario: Type-level conformance

- **WHEN** the package builds with `tsc --noEmit`
- **THEN** the Vue `<DocxEditor>` ref type is assignable to `EditorRefLike` without casts
- **AND** removing any method from the Vue ref produces a typecheck error in the adapter package

#### Scenario: Bridge attaches successfully at runtime

- **WHEN** a Vue consumer creates `const editorRef = ref<DocxEditorRef | null>(null)`, mounts `<DocxEditor :ref="editorRef" />`, and calls `createEditorBridge({ editorRef })` from `@eigenpal/docx-editor-agents`
- **THEN** the bridge initialises without throwing and exposes its full method surface
- **AND** subsequent `bridge.proposeChange(...)` calls land as edits in the Vue-mounted editor

### Requirement: Agent SDK Vue subpath

The `@eigenpal/docx-editor-agents` package SHALL gain a `/vue` subpath export at parity with the existing `/react` subpath. The Vue subpath SHALL provide SFC components (`<AgentPanel>`, `<AgentChatLog>`, `<AgentComposer>`, `<AgentSuggestionChip>`, `<AgentTimeline>`) and composables (`useAgentBridge`, `useAgentEvents`) that wrap the framework-agnostic bridge from `@eigenpal/docx-editor-agents`. Same agent, same UX semantics, two UI flavours.

#### Scenario: Mount agent panel alongside Vue editor

- **WHEN** a Vue host app renders `<DocxEditor>` from `@eigenpal/docx-editor-vue` and `<AgentPanel>` from `@eigenpal/docx-editor-agents/vue` connected by ref
- **THEN** the agent panel mounts, accepts user prompts, and dispatches tool calls against the editor
- **AND** the same DOCX edits the agent makes through the React adapter are reproducible through the Vue adapter

#### Scenario: Composable for custom agent UIs

- **WHEN** a consumer calls `useAgentBridge(editorRef)` inside `setup()`
- **THEN** the returned reactive interface mirrors the React `useAgentBridge` hook contract — same methods, same return types
- **AND** unmounting the component unsubscribes all listeners

#### Scenario: AI context menu parity

- **WHEN** the user right-clicks selected text in the Vue adapter
- **THEN** the AI actions menu surfaces with the same options (Ask AI, Rewrite, Expand, Summarize, Translate, etc.) as the React adapter
- **AND** selecting an action triggers the same agent bridge call

#### Scenario: Response preview matches across adapters

- **WHEN** an agent produces a response that opens an `<AIResponsePreview>` (e.g., a tracked-change suggestion)
- **THEN** the Vue and React adapters render the same diff, the same accept/reject controls, and the same close-on-Esc behaviour

#### Scenario: Tool call produces byte-equal DOCX

- **WHEN** the agent bridge dispatches the same `proposeChange` / `addComment` / `replyTo` / `resolveComment` sequence against a Vue-mounted editor and a React-mounted editor with the same input fixture
- **THEN** the bytes returned from each adapter's `save()` are byte-equal

#### Scenario: Streaming chat updates render smoothly in Vue

- **WHEN** `@ai-sdk/vue`'s `useChat` streams tokens to a Vue `<AgentChatLog>` at typical model rates (30-60 tokens/sec)
- **THEN** the chat log renders each token within one Vue tick without dropped frames
- **AND** the underlying messages state uses regular `ref` or `reactive`, NOT `shallowRef` (which would require manual triggers per token)

#### Scenario: Tool error surfaces same UI

- **WHEN** an agent tool call fails (e.g., `paraId` not found, `search` ambiguous)
- **THEN** Vue surfaces the same error treatment as React: same copy, same close affordance, same retry behaviour
- **AND** the error does NOT crash the host application or detach the chat history

### Requirement: Package boundary (no React imports)

`packages/vue/src/**` SHALL contain zero imports of `react`, `react-dom`, `@types/react`, or any subpath of `@eigenpal/docx-editor-react`. Vue-only UI components live in `packages/vue/src/components/`. Shared logic that doesn't depend on Vue lives in `@eigenpal/docx-editor-core` and is consumed via `import` from there.

#### Scenario: Lint flags a forbidden React import

- **WHEN** a contributor adds `import { useState } from 'react'` to any file under `packages/vue/src/`
- **THEN** `bun run lint` exits non-zero with a `no-restricted-imports` violation
- **AND** the CI pipeline fails the build before merge
