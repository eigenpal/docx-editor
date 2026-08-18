## ADDED Requirements

### Requirement: An engine value SHALL never be wrapped in a reactive proxy

A ref SHALL be a `shallowRef` when it holds an editor instance, a snapshot, a selected slice, or
any object that came out of the engine. `reactive()` SHALL NOT be applied to any of them, and
`readonly()` SHALL NOT be applied to a value a consumer or the engine compares by identity — the
read-only guarantee is carried by the TYPE, not by a runtime proxy.

`ref()`, `reactive()` and `readonly()` all return proxies. The engine's layout caches are keyed
by object identity, `snapshot()` is version-cached on reference equality, and `useEditorState`'s
bail-out is an identity comparison. A proxy of an engine object misses every identity-keyed
cache — the same failure two engine copies produce, and just as quiet.

#### Scenario: The published instance is the engine's own object

- **WHEN** a consumer reads the injected editor and compares it with the instance the Root
  created
- **THEN** they are the same object, not a proxy of it

#### Scenario: A selected slice is the engine's own object

- **WHEN** a selector returns a snapshot sub-object such as `formatting`
- **THEN** the value a consumer reads is identical to the one `snapshot()` returned, so the
  engine's reference-stability guarantee still holds across unrelated events

#### Scenario: Nothing deep-wraps a snapshot

- **WHEN** the Vue source is searched
- **THEN** no `reactive(`, no `readonly(` and no deep `ref(` is applied to an editor, a snapshot
  or a slice

### Requirement: A Vue Root SHALL own the facade's lifetime and publish it as a ref

`DocxEditorRoot` SHALL render no DOM of its own, SHALL create the editor with
`createDocxEditor` WITHOUT a container, and SHALL publish it through `provide` as a
`ShallowRef<DocxEditorInstance | null>`. `provideDocxEditor(options)` SHALL do the same from a
host's own `setup`.

The published value is a ref and not the instance, because `destroy()` is terminal — an instance
never remounts — so a `document` or `fonts` identity change must build a NEW instance, and
`provide` is not reactive unless what it provides is.

#### Scenario: The subtree sees the instance when it lands

- **WHEN** a Root mounts with a document
- **THEN** `useDocxEditor()` in any descendant reads `null` on the first render and the instance
  after the mount, without the descendant resubscribing to anything

#### Scenario: A document identity change rebuilds

- **WHEN** the `document` prop is given different bytes
- **THEN** the previous instance is destroyed, a new one is created, and the published ref moves
  to it

#### Scenario: A zoom change does not rebuild

- **WHEN** the `zoom` prop moves
- **THEN** the same instance receives `setZoom`, and the caret, the edits and the undo history
  survive

#### Scenario: Level and mode are applied in one pass, mode last

- **WHEN** a host declares both `zoom` and a fit `zoomMode`
- **THEN** the level is applied first and the mode after it, so the declared fit survives
  `setZoom` leaving fit mode — and an unrelated re-render that hands over an equal-by-value
  `zoomMode` object re-applies nothing

### Requirement: `useDocxEditor` SHALL answer with a ref and SHALL NOT throw

`useDocxEditor()` SHALL return a `ShallowRef<DocxEditorInstance | null>` whose value is `null`
outside any Root, before the Root's mount has run, and during a server render.

Pre-mount is a normal frame every consumer renders through. A throwing variant would force every
part to guard, which is what the composition layer exists to avoid.

#### Scenario: Outside a Root

- **WHEN** `useDocxEditor()` is called in a component with no Root above it
- **THEN** it returns a ref whose value is `null` and never becomes non-null, and nothing throws

#### Scenario: On the server

- **WHEN** a Root is server-rendered
- **THEN** no editor is created, the provided ref is `null`, and no DOM API is touched

### Requirement: The Viewport SHALL carry the load-bearing scroller classes

`DocxEditorViewport` SHALL render a single element carrying `docx-editor-one-surface`,
`docx-editor-one-surface__viewport` and `docx-editor__scroll-container`, SHALL apply the scope
class when no ancestor has claimed it, and SHALL publish the navigation shift as the
`--docx-nav-shift` custom property rather than as reactive state.

The engine finds its scroller by looking for the nearest `.docx-editor__scroll-container`
ancestor; without it the engine falls back to document scrolling and virtualization degrades.
The shift is recomputed on every resize, so reactive state there would re-render the editor
subtree at resize frequency.

#### Scenario: The engine finds its scroller

- **WHEN** a document is mounted inside a Viewport
- **THEN** the surface's scroll rematerialization and page-visibility work run against that
  element

#### Scenario: A resize does not re-render the subtree

- **WHEN** the viewport is resized with a navigation pane open
- **THEN** `--docx-nav-shift` updates and no component in the subtree renders on account of it

#### Scenario: The zoom chord is claimed on capture

- **WHEN** Ctrl/Cmd with `=`, `-` or `0` is pressed over the painted pages
- **THEN** the viewport handles it before the engine's keymap sees it, so one keystroke zooms
  and does not also apply subscript or superscript
- **AND** the chord is ignored when the event target is an input, textarea, select or dialog

### Requirement: The Content part SHALL attach by WATCHING the instance, not on mount

`DocxEditorContent` SHALL render the `docx-paginated-surface` element and SHALL call
`editor.attach(element)` from a watcher on the injected instance ref, with `immediate` and a
post flush, when both the instance and its own element exist. It SHALL NOT attach from
`onMounted`. It SHALL call `editor.detach()` on unmount and on deactivation.

Vue runs a CHILD's `onMounted` before its parent's. The Root creates the instance in
`onMounted` — it cannot create in `setup`, which also runs on the server — so by the time the
Root has an instance, the Content's `onMounted` has already run and seen `null`. Attaching there
gives an editor that never paints, with no error anywhere. Watching also covers the instance
being replaced when the document changes. Detach stashes the live document bytes, so a remount
restores the content.

#### Scenario: The pages paint on first mount

- **WHEN** a Root and a Content mount together
- **THEN** the surface is attached and the document paints, even though the Content's `onMounted`
  ran before the instance existed

#### Scenario: Attach happens with the element connected

- **WHEN** the watcher fires
- **THEN** the element is already inside the Viewport, so the engine's scroller discovery
  succeeds on the first paint

#### Scenario: A document change re-attaches to the new instance

- **WHEN** the `document` prop changes and the Root builds a new instance
- **THEN** the Content detaches from the old one and attaches the new one, with no host action

#### Scenario: KeepAlive round trip preserves the document

- **WHEN** the editor is wrapped in `<KeepAlive>` and deactivated, then activated again
- **THEN** Content detaches on deactivate and re-attaches on activate, the Root does NOT destroy
  the instance, and the edits, the caret and the undo history survive

#### Scenario: Unmount detaches before destroy

- **WHEN** the Root unmounts
- **THEN** the Content detaches first and the Root destroys after — Vue runs `unmounted`
  child-first, so the destroy belongs in the Root's `onUnmounted`, not its `onBeforeUnmount`
- **AND** no listener remains attached to the destroyed facade

#### Scenario: Detach after destroy is a no-op

- **WHEN** a document-identity change interleaves the teardown so `detach()` reaches an
  already-destroyed instance
- **THEN** nothing throws

### Requirement: The composition layer SHALL hold no editing-engine state

No file under `packages/vue/src` SHALL keep a copy of the zoom level, the enabled state of a
control, the selection, the page count, the arrangement of the toolbar, the ruler geometry, the
navigation displacement, the search debounce, or any user-facing English string.

Every one of those has exactly one home in `@docx-editor.dev/core` or `packages/i18n/en.json`,
and a second copy is a source of drift that no gate can see.

#### Scenario: Framework isolation holds

- **WHEN** `bun run lint` runs
- **THEN** no file in `packages/vue/src` imports React, and no file in `packages/react/src`
  imports Vue

#### Scenario: The two adapters answer the same question the same way

- **WHEN** the same document and selection are given to both adapters
- **THEN** every chrome slot reports the same enabled state, the same active state and the same
  disabled reason, because both read `toolbarCommandState`
