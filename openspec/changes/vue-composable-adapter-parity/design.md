# Design

## What the survey settled

**The React adapter holds no editing state, so the port is mechanical everywhere the
frameworks agree.** Every hook in `packages/react/src/editor/` is a read of
`Editor`/`DocxEditorInstance` plus a call back into it. `useZoom` keeps no zoom, `usePageSetup`
keeps no page setup, `useEditorCommand` keeps no enabled flag — all three ask the engine at the
version the snapshot describes. That is why this change can be large in surface and small in
risk: there is one place per composable where a framework decision is actually made, and it is
"how do I turn an event into a re-render".

**There are exactly four places the frameworks genuinely disagree**, and the rest of this
document is those four:

1. how a subscription becomes a re-render (`useSyncExternalStore` has no Vue twin);
2. how a provider's value reaches a descendant (`createContext` vs `provide`/`inject`);
3. how a compound component takes an in-place override (`Children.toArray` + element type vs
   slots);
4. what "before the editor exists" means, because Vue adds a server render and `<KeepAlive>`
   where React adds StrictMode's double-invoked effect.

Section 0b lists the six calls those disagreements make it easy to get wrong, each with a
symptom that does not point back at its cause. Read it before writing any of this.

**The engine already owns everything else.** `toolbarCommandState` / `runToolbarCommand` /
`commandForSlotValue` are the shared can-before-exec table. `CHROME_GROUPS` and `CHROME_MENUS`
are the arrangement. `ruler-indent.ts` holds the four-handle drag geometry, `ruler-ticks.ts`
the ticks, `zoom-fit.ts` the fit, `navigationShift` the displacement rule,
`composeFontConfiguration` the font merge, and the whole stylesheet lives in
`@docx-editor.dev/core/styles/editor.css` (enforced by `check:adapter-css-thin`, which the Vue
package already passes). Any Vue file that recomputes one of those is a bug, not a port.

## 0. Greenfield

`packages/vue/src` and `packages/vue/test` go in the first commit. Nothing is ported. The
adapter holds no editing state, so there is no logic to preserve — what is being built is
wiring, and each file's specification is the React file at the mirrored path.

The target is 100% of React's NON-DEPRECATED surface: every such export has a Vue export of the
same name, and the divergence file ends at zero entries and is deleted.

### The mirror rule

A paired export SHALL live at the same relative path in both adapters. Concretely:

| React | Vue |
| --- | --- |
| `src/index.ts` | `src/index.ts` |
| `src/types.ts` | `src/types.ts` |
| `src/editor/context.ts` | `src/editor/context.ts` |
| `src/editor/DocxEditorRoot.tsx` | `src/editor/DocxEditorRoot.ts` |
| `src/editor/DocxEditorViewport.tsx` | `src/editor/DocxEditorViewport.ts` |
| `src/editor/DocxEditorContent.tsx` | `src/editor/DocxEditorContent.ts` |
| `src/editor/useEditorState.ts` | `src/editor/useEditorState.ts` |
| `src/editor/use*.ts` (the composables) | same path, same name |
| `src/editor/toolbar/**` | `src/editor/toolbar/**` |
| `src/editor/menu/**` | `src/editor/menu/**` |
| `src/editor/navigation/**` | `src/editor/navigation/**` |
| `src/editor/contextmenu/**` | `src/editor/contextmenu/**` |
| `src/editor/images/**` | `src/editor/images/**` |
| `src/editor/merge-arrangement.tsx` | `src/editor/merge-arrangement.ts` |
| `src/editor/scope-context.ts` | `src/editor/scope-context.ts` |
| `src/editor/loading-snapshot.ts` | neither — `LOADING_SNAPSHOT` lifts into core, see below |
| `src/i18n/**` | `src/i18n/**` |
| `src/rulerTicks.ts`, `src/useEditorSnapshot.ts` | same paths |
| `src/components/DocxEditor.tsx` (the sugar) | `src/components/DocxEditor.ts` |
| `src/components/PaginatedDocxEditor.tsx` | `src/components/PaginatedDocxEditor.ts` |
| `src/components/DocumentOutline.tsx` | `src/components/DocumentOutline.ts` |
| `src/components/ui/HorizontalRuler.tsx`, `VerticalRuler.tsx` | mirrored — the v2 ruler parts wrap them |
| `src/lib/**` | mirrored only as far as a paired export needs |
| `src/styles/editor.css` | `src/styles/editor.css` (already thin, unchanged) |
| the pre-v2 shell chrome | NO Vue twin — deprecated, see below |
| `src/managers/**`, `src/hooks/**` | NO Vue twin — they serve only the deprecated chrome |

### The old React chrome is deprecated, not twinned

`Toolbar`, `ToolbarButton`, `ToolbarGroup`, `ToolbarProps`, `TitleBar`, `MenuBar`,
`DocumentName`, `Logo`, `TitleBarRight`, `DocxEditorShell`, `PaginatedDocxEditorShell` and
`PaginatedDocxEditorShellProps` are pre-v2. The composition layer replaces every one of them:
`DocxEditor.Toolbar` for the toolbar, `DocxEditor.Menu` for the menu bar, the packaged
`<DocxEditor>` for the shell. Nothing in `examples/` imports one.

Writing Vue twins of them would be building chrome that already has a removal date. So they are
tagged `@deprecated` with the replacement named, and they leave in the next major. Parity is
measured over what is left.

This costs no new mechanism. API Extractor writes the tag into the report — `// @public
@deprecated` above the item — so `check:export-parity` and `check:composable-parity` read it out
of the snapshot. That is a fact about the code, not an allowlist, which is the distinction that
matters: the divergence file this change deletes was an allowlist, and it grew to 228 entries.

`HorizontalRuler`, `VerticalRuler`, `DocumentOutline` and `PageIndicator` are NOT in that set.
They are the props-driven primitives the v2 context-fed parts wrap — `DocxEditor.HorizontalRuler`
is a thin reactive shell over `HorizontalRuler` — so Vue needs them and they stay paired.
`PaginatedDocxEditor` stays too; it is the surface component, not the shell around it.

`check:feature-parity` already walks both `src` trees and reports drift per file. It has been
noise because the two trees share no paths; the mirror rule is what makes its output mean
something, and reading that report is a task in this change rather than an afterthought.

### The one core change

`LOADING_SNAPSHOT` — the frozen `EditorSnapshot` every path returns when there is no editor yet —
lives in `packages/react/src/editor/loading-snapshot.ts`. Vue cannot import it: React is not a
dependency of the Vue package, and the framework-isolation lint forbids the direction anyway. So
it moves to `@docx-editor.dev/core/editor` and both adapters re-export it.

Copying it is the alternative, and the repository already shows what that costs. Vue's
`DocxEditor.ts` carries a hand-rolled `PRE_MOUNT_SNAPSHOT` for the same purpose, and the two have
ALREADY drifted: React's carries `canUndo: false` and `canRedo: false`, Vue's does not. A
pre-mount snapshot that under-reports the contract is exactly the "invented state" both files'
comments say they exist to prevent.

The value is an `EditorSnapshot` constant with no framework in it, so core is where it belongs.
This is the only `packages/core` change in this change, and it is additive.

## 0a. What keeps the two APIs consistent — and what does not

Every existing gate compares NAMES. `check:export-parity` diffs the two `index.ts` export sets.
`check:public-docs-surface` asserts a name appears in the docs. `check:parity-contract` is the
only member-level check in the repository, and it covers exactly two interfaces:
`DocxEditorProps` and `DocxEditorRef`.

So today, and under every version of this plan before this section, all of the following ship
green:

- `useZoom()` returning nine of React's thirteen members. `levels`, `canZoomIn`, `canZoomOut`
  and `reset` simply absent, and every gate passes because the NAME `UseZoomResult` is exported.
- `useEditorCommand` returning `{ run, active, enabled, reason }` instead of
  `{ execute, isActive, isEnabled, disabledReason }`. Same interface name, different vocabulary,
  no gate.
- `useEditorValueCommand` with one overload where React has two (`'image.wrap'` and
  `'image.altText'`).
- `useDocxSource(source)` quietly dropping the `options` parameter, so `fonts` and
  `fetchOptions` have nowhere to go.

Each of those is this change failing silently on the day it lands. Drift AFTER it lands is the
likelier direction still: adding a member to `UseZoomResult` in React is a routine edit, and
nothing today would ask about Vue.

### The gate this change has to build

API Extractor already emits exactly what a checker needs, in a normalized, alphabetically
sorted form, for both adapters:

```
export interface EditorCommandState {
    readonly disabledReason: string | null;
    readonly execute: () => boolean;
    readonly isActive: boolean;
    readonly isEnabled: boolean;
}
export function useEditorState<T>(selector: (snapshot: EditorSnapshot) => T, isEqual?: (a: T, b: T) => boolean, options?: UseEditorStateOptions): T;
```

`scripts/check-parity-contract.mjs` already parses that file and already has
`extractInterfaceFields`. The new gate — `scripts/check-composable-parity.mjs` — generalizes it
to THREE assertions over every `use*` export, every interface one of them returns, and every
other interface BOTH snapshots export (`ToolbarButtonProps`, `FontFamilyProps`,
`NavigationPartProps`, `MenuItemProps`, …). A part's props drift exactly the way a composable's
result does, and the check is the same check. The two interfaces `check:parity-contract` already
owns — `DocxEditorProps` and `DocxEditorRef` — are excluded, so there is one gate per interface
and no overlap.

Interfaces carrying a React node prop or a render prop are reconciled by the SAME three form
categories the parity contract already names for `DocxEditorProps`: an emit for a callback, a
slot for `children` or a render prop, attribute fallthrough for `className`. No fourth category,
here or there.

1. **Members.** Names must match exactly, in both directions. No missing member, no extra one.
2. **Member types.** Must match exactly, after normalization.
3. **Signatures.** Parameter names, count, optionality, and OVERLOAD COUNT must match, after the
   same normalization. The return type name must match after normalization.

### Exactly two normalizations, and no third

These are the framework difference, written down as a transform rather than as an exemption:

- **A ref wrapper unwraps.** `Ref<T>`, `ShallowRef<T>`, `ComputedRef<T>` and `Readonly<…>` around
  any of them all reduce to `T`. So Vue's `readonly zoom: Readonly<ShallowRef<number>>` compares
  equal to React's `readonly zoom: number`, and `zoom: string` does not.
- **A parameter may be a getter.** Vue's `MaybeRefOrGetter<T>` in a PARAMETER position reduces to
  `T`. This is not invented for the gate: `useEditorSnapshot(editor: () => Editor | null)` is
  already the Vue shape against React's `useEditorSnapshot(editor: Editor | null)`, and a getter
  is the right call — it stays live where a captured value does not.

Anything the two normalizations do not reconcile is drift, and the gate fails. It ships with an
EMPTY allowlist and no opt-out file. The divergence file this change deletes is what an
allowlist becomes when it is born with entries in it.

### Build the gate before the composables

The gate is written in phase 2b, against an empty Vue package, where it reports twenty-eight
missing composables. Each one turns it greener. Written afterwards it would be an audit of
decisions already made, and every mismatch it found would be a rewrite rather than a spec.

### Shape is not behaviour

Member-for-member agreement still permits `zoomIn()` stepping differently, or
`useDocumentSearch` reporting a total where React reports the cap. So the gate is paired with a
DIFFERENTIAL: one table of (composable, action, assertion), executed against both adapters from
a single source, mounted on the same document. A per-adapter unit test proves that adapter calls
a helper; only the differential proves the two agree.

## 0b. The six traps

Each of these is a call an implementer makes early, silently, and wrongly, and each has a
symptom that does not point back at the cause. They are requirements, not advice.

**1. Deep reactivity must never touch an engine value.** `ref(instance)`, `reactive(snapshot)`
and `readonly(slice)` all return PROXIES. The engine's layout caches are keyed by object
IDENTITY, `snapshot()` is version-cached on reference equality, and `useEditorState`'s whole
bail-out is an identity comparison. Hand the engine a proxy of one of its own objects and every
identity-keyed cache misses — the same failure mode two engine copies produce, from a different
direction, and just as quiet.

So: every ref holding an editor, a snapshot, a slice or any object that came out of the engine
is a `shallowRef`. `readonly()` is banned outright — the read-only guarantee is carried by the
TYPE (`Readonly<ShallowRef<T>>`), never by a runtime proxy. `markRaw` the instance if anything
would otherwise reach for it.

**2. A child's `onMounted` runs BEFORE its parent's.** This is the opposite of React, where the
Root's `useState` publishes the instance in the render that the Content's layout effect then
reads. In Vue: the Root must create in `onMounted` (never in `setup`, which also runs on the
server), so by the time the Root's `onMounted` fires, `DocxEditorContent`'s has already run and
found `null`.

`DocxEditorContent` therefore does NOT attach in `onMounted`. It watches the injected ref with
`{ immediate: true, flush: 'post' }` and attaches when the ref is non-null AND its own element
exists — which also covers the instance being replaced on a document change. Attaching in
`onMounted` gives an editor that never paints, with no error anywhere.

**3. Teardown runs the other way.** Vue calls `beforeUnmount` parent-first and `unmounted`
child-first. Destroy in the Root's `onUnmounted` and detach in Content's `onUnmounted`, so the
surface is released before the facade dies. `detach()` must still be safe after `destroy()`,
because a document-identity change can interleave the two — React's Content carries the same
note.

**4. An absent Boolean prop becomes `false`.** Vue casts it; React leaves it `undefined` and the
component's default applies. `chrome`, `menu`, `navigation`, `rulers` and `contextMenu` all
default to TRUE in React, so a naive `{ type: Boolean }` declaration turns the packaged editor
into a bare surface with no chrome and no error. Every Boolean-valued prop declares
`default: undefined` and resolves its default in the component body.

**5. A locale change REBUILDS the editor, and must keep doing so.** React's Root lists
`defaultTranslate` in its creation effect's dependencies, and `defaultTranslate` changes when the
catalogue does — so a locale switch destroys and recreates the instance. That is not an
oversight to improve on: `translate` is sampled by `createDocxEditor` and is what paints drawing
refusal labels, so a live catalogue swap without a rebuild would leave those painted strings in
the old language. Chrome LABELS re-resolve without a rebuild because components render them;
the engine's copy does not. Parity is 100%, so Vue mirrors this, including the edit loss it
implies.

**6. No new UI dependency.** React's `Slot` is ~40 lines in-tree, deliberately not
`@radix-ui/react-slot`, and the v2 pickers (`FontFamily`, `ParagraphStyle`, the colour splits,
the steppers) use it rather than a headless-UI library. The one Radix import in the React tree
is `components/ui/Select.tsx`, which nothing imports. Vue adds no `reka-ui`, no `radix-vue`, and
no dropdown library: `mergeProps` + `cloneVNode` is the whole of `Slot`, and the pickers are
built on it. `minimumReleaseAge` is 7 days in `bunfig.toml`, so a new dependency is also a
schedule risk for no gain.

### Two smaller ones

**Composable arguments may be getters or refs.** `useEditorSnapshot(editor: () => Editor | null)`
is already the Vue shape against React's `useEditorSnapshot(editor: Editor | null)`, and it is
the right one: a getter stays live where a captured value does not. Apply it consistently —
`MaybeRefOrGetter` for anything a caller could want to change after the first call.

**`slots.default()` is called in RENDER, not in `setup`,** or the compound stops reacting to a
host's overrides changing. Skip Comment and Text vnodes when identifying children: `v-if` leaves
a Comment behind, and whitespace leaves Text. `getCurrentScope()` returns `null` outside any
scope, so `onScopeDispose` is guarded rather than called blind.

## 1. Subscription → re-render

React uses `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` with a memoized
selector that returns the PREVIOUS slice reference when `isEqual` says nothing moved, so the
store bails out and the component does not render. Vue has no such primitive and does not need
one: a `shallowRef` that only ever changes when the slice changes IS the bail-out, because Vue's
`triggerRef`/set path compares with `hasChanged` and a dependent effect that is never triggered
never runs.

The shape:

```
provideDocxEditor()  ──> creates ONE tick source per Root
   tick: shallowRef(0)
   on('change' | 'selectionChange' | 'error')  ──> deferredNotify() ──> tick.value++

useEditorState(selector, isEqual = Object.is)
   const out = shallowRef(read())
   watchEffect / watch(tick, () => { const next = selector(snapshot()); if (!isEqual(out.value, next)) out.value = next })
   return readonly-ish ShallowRef<T>
```

Three details are load-bearing and must not be simplified away.

**One subscription per ROOT, not per consumer.** React subscribes per consumer because
`useSyncExternalStore` gives it no cheaper option; the facade's `on()` is a set insert, so
twenty toolbar buttons are twenty listeners. Vue can do better and should: the Root already
exists, owns the instance, and can hold the tick. `editorStateActiveSubscriptionCount()` —
React's `@internal` test seam — gets a Vue twin that counts CONSUMERS, and one that asserts the
facade sees exactly three listeners per Root no matter how many composables are mounted.

**The notification stays coalesced and DEFERRED.** Copy the reasoning from
`packages/react/src/editor/useEditorState.ts` verbatim, because both halves survive the port:

- Correctness. The facade's `change` fires mid-commit, BEFORE the layout scheduler's
  synchronous publish inside the same `exec`. A synchronous read would derive formatting from
  the not-yet-published layout, and `snapshot()` is version-cached, so that wrong answer would
  be cached for the whole version. A microtask runs after the commit's synchronous work.
- Efficiency. One commit can emit `change` AND `selectionChange`. When
  `navigator.scheduling.isInputPending({ includeContinuous: true })` reports hardware input
  waiting, a `setTimeout(…, 0)` replaces the microtask so key repeat yields.

Vue's own scheduler batches renders, which handles the second reason and NOT the first. Dropping
the defer would reintroduce the stale-formatting bug with no test to catch it, because the
symptom is a toolbar that shows the previous character's formatting for one frame.

**A composable's watcher must die with its scope.** `watch`/`watchEffect` created inside
`setup` are collected by the component's `effectScope` automatically. A composable called
OUTSIDE a component (the `…Instance` forms, a host's own `effectScope`) is the caller's to
scope; the composables use `getCurrentScope()` + `onScopeDispose` so both cases clean up, and
neither leaks a listener onto a destroyed facade.

### Why not `computed`

`computed(() => selector(snapshot()))` reads correctly and is tempting. It is rejected for two
reasons. It cannot take a custom `isEqual` — Vue compares with `hasChanged`, so a selector
returning a fresh object (`{ zoom, mode }`, `{ active, enabled, disabledReason }`) invalidates
every dependent on every tick, which is precisely the re-render `useEditorState` exists to
prevent. And a `computed` is lazy: nothing recomputes until something reads it, so the
memoized-pair contract ("the slice reference is stable across an unrelated event") has no
moment at which to hold. An explicit `shallowRef` + `watch(tick, …)` is eager, comparable, and
observable in a test.

## 2. Provider → descendant

`createContext(null)` + `useContext` becomes an `InjectionKey<ShallowRef<DocxEditorInstance |
null>>` + `inject(key, null)`.

The published value is a **ref**, not the instance. React re-renders the subtree when the
context value changes identity; Vue's `provide` is not reactive unless the provided value is,
and the instance genuinely does change identity — on a `document`/`fonts` identity change the
Root destroys and rebuilds, because `destroy()` is terminal and an instance never remounts.
Providing the raw instance would freeze every consumer on the first one.

`useDocxEditor()` returns that ref and returns a permanently-`null` ref when there is no Root.
It does NOT throw, matching React and for the same stated reason.

Four more injections mirror React's four context providers, each an `InjectionKey`:

| React | Vue |
| --- | --- |
| `DocxEditorContext` | `docxEditorKey` (exported as `useDocxEditor`'s source) |
| `ReviewRailContext` | `ReviewRailContext` — same NAME, an `InjectionKey<ReviewRailRegistry>` |
| `HyperlinkPopupContext` | published by the Root, read by `useHyperlinkPopup` |
| `ContentControlContext` | published by the Root, read by `useContentControl` |
| `NavigationLayoutContext` | a plain store, NOT a ref — see below |
| `ScopedByAncestorContext` | `useScopeClassName()` over an injected boolean |
| `LocaleContext` / `LangContext` | `LocaleProvider` + `useTranslation` |

`ReviewRailContext` keeps its React NAME even though it is an `InjectionKey` and not a
`Context`, because `check:export-parity` compares names and a rename would need an exemption
for a symbol that means the same thing. The TSDoc says what it is.

**The navigation layout store stays a store.** React deliberately does not use state for it:
the shift is recomputed on every viewport resize, and state would re-render the whole editor
subtree at resize frequency. The Vue twin is the same object with `subscribe`/`get`/`set`, read
through `useNavigationShift()` — which IS a ref, because one consumer wants the value. The
viewport writes a CSS custom property (`--docx-nav-shift`) rather than a reactive style, exactly
as React does, so a resize repaints without a render.

## 3. In-place overrides on a compound

React's contract, implemented once in `merge-arrangement.tsx` and shared by the toolbar, the
menu bar and the context menu:

- no children → the packaged arrangement;
- a child that NAMES a member (a `docxSlot` static on the component, or `ToolbarButton`'s
  marker plus its `slot` prop) replaces that member in place;
- `hidden` on such a child removes the member;
- anything else appends after the default set;
- `preset={false}` renders children verbatim;
- a single-child Fragment is unwrapped, because `Children.toArray` does not flatten Fragment
  ELEMENTS and a host mapping over its overrides hits that on day one.

Three candidate ports were considered.

**(a) Named slots keyed by `ChromeSlotId`.** The idiomatic Vue answer, and it does not work.
`<template #text.bold>` parses `text` as the slot name and `bold` as a directive MODIFIER — dots
are modifier syntax on every directive, `v-slot` included. Working around it needs either a
dynamic argument (`#[SLOTS.bold]`, which forces every consumer to import a constant to write a
template) or a second slot-name vocabulary with the dots transformed away, which would be a
second registry beside `ChromeSlotId` and is what CLAUDE.md forbids.

**(b) A `parts` / `overrides` prop: `ChromeSlotId → component | render fn`.** Typed, no template
traps, and used by real Vue libraries. Rejected because it is a DIFFERENT contract, not a
port: the docs would fork, `hidden` and `preset` would need prop equivalents, and a host reading
`react/composition.mdx` would find nothing that transfers.

**(c) Default-slot vnode inspection.** Taken. `slots.default?.()` returns vnodes;
`vnode.type` is the component's options object, so `(vnode.type as { docxSlot?: string })
.docxSlot` is the same marker React reads off the component function. Fragment vnodes
(`vnode.type === Fragment`, which is what `v-for` and `<template>` produce) are flattened
recursively — the direct analogue of `unwrapFragment`, and the same bug is waiting if it is
skipped.

So `mergeArrangement` is ported to `packages/vue/src/editor/merge-arrangement.ts` with the
identical signature over vnodes, and a shared test asserts the six bullets above on BOTH
adapters from one table. The marker must live on the component TYPE (the options object), never
on `displayName` or a name string — minification eats those, which React's comment already
records.

### `Slot`

React's `Slot` merges its props onto its single child, which is how `asChild` works. Vue's twin
`cloneVNode(child, mergeProps(attrs, child.props))` over the single default-slot vnode, refusing
(returning `null`) when the slot renders zero or several roots. Same name, same job.

## 4. "Before the editor exists"

React's pre-mount frame is one thing. Vue's is three, and each needs a rule.

**Server render.** `createDocxEditor` needs DOM. On the server the Root creates nothing and
provides a permanently-`null` ref; `useEditorState` returns the frozen `LOADING_SNAPSHOT`
(`isLoading: true`, `page: { current: 0, total: 0 }`), which is React's `getServerSnapshot`
answer and already lives in `loading-snapshot.ts` — it is framework-free and moves to a shared
import rather than being copied. Every composable's documented pre-mount answer is therefore
also its server answer, which is what makes the whole surface safe to render in Nuxt without a
`<ClientOnly>` around each part.

**`<KeepAlive>`.** A deactivated component is not unmounted; its DOM is moved to a detached
container. `DocxEditorContent` must `detach()` on `onDeactivated` and `attach()` on
`onActivated`, or the engine keeps painting into an element that is not in the document and the
scroller discovery (`.docx-editor__scroll-container` ancestor) finds nothing. The Root must NOT
destroy on deactivate: `destroy()` is terminal, and a KeepAlive round trip is supposed to
preserve edits and undo history. This has no React equivalent and is the one lifecycle rule the
port invents.

**HMR.** A module replacement re-runs `setup`. The Root creates a fresh instance per run and
destroys the previous one in `onBeforeUnmount` / the `watch` cleanup, which is the same "create
anew, never resurrect" rule StrictMode forces on React. Stating it here means the Vue code gets
it for free rather than discovering it as a "editor is destroyed" error in dev.

**Zoom is a parameter, not a remount.** React's Root applies `zoom` then `zoomMode` in ONE
effect, mode after level, because `setZoom` leaves a fit by design and two effects would let
ordering decide the outcome. The Vue twin is one `watch([zoom, zoomMode], …, { flush: 'post'
})` with the same body and the same `sameZoomProp` by-value comparison, because `zoomMode` is an
object and a host writing `:zoom-mode="{ type: 'fit', fit: 'pageWidth' }"` hands over a new one
every render.

## Composable return shape

Every composable returns a **plain object whose members are refs (state) and plain functions
(actions)**. Never `reactive()`, never a bare value.

- A bare value cannot update. `const zoom = useZoom().zoom` would be a number captured once.
- `reactive()` loses reactivity on destructure, and destructuring is how these are used
  (`const { execute, isEnabled } = useEditorCommand('text.bold')`). An object of refs survives
  it, and Vue templates auto-unwrap refs one level deep, so `{{ isEnabled }}` still reads.

Actions are stable function identities for the composable's life and read the latest instance
from the injected ref at CALL time, not at creation time — the direct twin of React's
`latest.current` refs. This is what lets `execute` be handed to a `@click` once and stay correct
across an instance rebuild.

Repo rule from CLAUDE.md: each composable declares a named `Use<Name>Return`/`Result` interface
and ANNOTATES its return type, or core's internal types leak into the API Extractor snapshot.
The names are React's, verbatim, because `check:export-parity` compares names:
`UseZoomResult`, `UsePageSetupReturn`, `UseParagraphIndentReturn`, `UseFontFamilyResult`,
`UseDocumentSearchResult`, `UseNavigationPaneResult`, `UseHyperlinkPopupResult`,
`UseContentControlResult`, `UseDocxSourceResult`, `EditorCommandState`,
`EditorValueCommandState`, `EditorCaret`.

## Props, emits, and the imperative handle

The parity contract's existing rule holds and widens: a React CALLBACK PROP whose Vue twin is an
EMIT is a form difference, not a missing capability. `onChange`/`onReady` are already recorded
that way; `onFontError`, `onSave`, `onOpen`, `onTitleChange` join them. Everything else in
`DocxEditorProps` pairs by name.

Two things are NOT emits:

- `DocxEditorRootProps.translate` and `tableInteractionLabel` are resolvers the engine CALLS
  and whose return value it uses. An emit has no return value, so these stay props on both
  adapters.
- `useDocxSource`'s and `useFonts`' arguments are composable arguments, not component props,
  and take the same shapes.

`DocxEditorRef` is already declared identically on both sides (seven members, nothing
inherited) and does not widen. Vue keeps `expose(api)`; the contract's `ref.paired` list is
unchanged.

## What must NOT be reimplemented

A file in `packages/vue/src` that contains any of the following is wrong by construction, and
each has a core home:

| Temptation | Where it lives |
| --- | --- |
| enabled/active/disabledReason for a slot | `toolbarCommandState` |
| a slot's command | `commandForSlot` / `commandForSlotValue` |
| toolbar/menu arrangement | `CHROME_GROUPS` / `CHROME_MENUS` |
| ruler ticks, page box | `ruler-ticks.ts` (re-exported by both adapters) |
| the four indent handles' drag geometry | `ruler-indent.ts` |
| the zoom ladder and the fit | `zoom-levels.ts` + `zoom-fit.ts` |
| the navigation pane displacement | `navigationShift` / `navigationPaneReservation` |
| search debounce and the match cap | `SEARCH_DEBOUNCE_MS` / `SEARCH_MATCH_LIMIT` |
| font composition | `composeFontConfiguration` |
| any colour, spacing, or chrome rule | `@docx-editor.dev/core/styles/editor.css` |
| any user-facing English | `packages/i18n/en.json` |

`check:feature-parity` already walks both `src` trees and reports drift; it becomes useful again
once the Vue tree has something to compare.

## Security

Nothing in this change parses a DOCX, so the trust boundary does not move. Two adapter-level
rules still apply and are the ones a port loses quietly:

- **No `v-html`, anywhere, on any value that could come from a file.** It is Vue's
  `innerHTML`, it is not covered by the repo's existing grep (which looks for `innerHTML` and
  friends), and a document-derived hyperlink target or font family reaching it is the same XSS
  React's rules forbid. The grep in CLAUDE.md gains `v-html` as part of this change.
- **Every `href` through `sanitizeHref`.** The hyperlink popover renders a target the document
  supplied. React's popover already routes it; the Vue twin must, and a test with a
  `javascript:` target pins it.

## Risk and sequencing

The removal lands FIRST, in its own commit: `packages/vue/src` and `packages/vue/test` go, the
entry is emptied, the pre-v2 React chrome is tagged `@deprecated`, and the divergence file is
grown to cover the remaining React surface. This is the only commit where that file gets LARGER,
and saying so stops a reviewer reading it as backsliding. From then on it only shrinks, to zero,
and is deleted.

The same commit removes the `vue root chrome surface` bucket from
`check-public-docs-surface.mjs`. It names pre-v2 chrome that is being replaced, so leaving it
would keep the gate red for the length of the change for no information.

The build change lands SECOND, before any new surface, because everything after it must be
written against ONE engine. Its evidence is recorded in the baseline (task 0.3) while a
buildable tree still exists, and re-checked on the rebuilt tree:
`check:package-artifacts`, `check:consumer-install`, and a byte check that `dist/index.js`
imports the engine rather than inlining it.

The composition layer lands third, the composables fourth, chrome fifth, the props-driven
primitives the v2 parts wrap last — they need no composables and block nothing. Each phase is
independently
shippable: the package is unpublished until the gates flip, so a partial Vue surface breaks
nothing, and `check:export-parity` stays green by shrinking the divergence file as names land
rather than by exempting new ones.
