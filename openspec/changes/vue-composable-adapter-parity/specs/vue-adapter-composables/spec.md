## ADDED Requirements

### Requirement: Every React hook SHALL have a Vue composable of the same exported name

The Vue entry SHALL export a composable for each of `useDocxEditor`, `useEditorState`,
`useEditorEvent`, `useEditorCommand`, `useEditorValueCommand`, `useEditorCaret`, `useZoom`,
`useFonts`, `useDocxSource`, `usePageSetup`, `useParagraphIndent`, `useFontFamily`,
`useParagraphStyle`, `useDocumentOutline`, `useDocumentSearch`, `useNavigationPane`,
`useNavigationShift`, `useHyperlinkPopup`, `useHyperlinkPopupInstance`, `useContentControl`,
`useContentControlInstance`, `useHeaderFooterState`, `useNoteScopeState`,
`useNotePropertiesState`, `useContextMenuTarget`, `useTableBorderTargetLabel`, `useTranslation`
and `useChromeTranslate`, together with the result type of each under React's name.

`check:export-parity` compares NAMES. The values are ref-shaped, which is the framework
difference the two packages are allowed; the name is not.

#### Scenario: Name parity holds for the composable surface

- **WHEN** the two entries' named exports are diffed
- **THEN** no `use*` name and no `Use*Result` / `Use*Return` name appears on one side only

#### Scenario: Return types are declared, not inferred

- **WHEN** the Vue API Extractor snapshot is generated
- **THEN** each composable's return type is a named interface declared in this package, and no
  engine-internal type is inlined into the snapshot

### Requirement: The composable surface SHALL be gated member by member, not name by name

A gate SHALL compare the two adapters' API Extractor snapshots and fail when, for any `use*`
export, any interface one returns, or any other interface both snapshots export, the member
NAMES differ, the member TYPES differ, the parameter names, count or optionality differ, the
OVERLOAD COUNT differs, or the return type name differs — in either direction, after the
normalizations below and no others. `DocxEditorProps` and `DocxEditorRef` SHALL be excluded,
because `check:parity-contract` owns them, so there is one gate per interface and no overlap.
A symbol carrying `@deprecated` in the snapshot SHALL be skipped — a fact read from the report,
not an allowlist entry.
A member reconciled by one of the three documented form categories — an emit for a callback, a
slot for `children` or a render prop, attribute fallthrough for `className` — SHALL be
reconciled the same way here.

Every existing gate compares names. `check:export-parity` diffs export sets;
`check:public-docs-surface` asserts a name appears in prose; `check:parity-contract` covers
exactly `DocxEditorProps` and `DocxEditorRef`. So a `useZoom` returning nine of thirteen
members, a `useEditorCommand` returning `{ run, active, enabled, reason }`, a
`useEditorValueCommand` with one overload instead of two, and a `useDocxSource` that dropped its
`options` parameter all ship green. Adding a member to a React result type is a routine edit, so
drift AFTER this change lands is the likelier direction, and nothing today would ask about Vue.

#### Scenario: A missing member fails

- **WHEN** a Vue composable omits a member React's result type declares
- **THEN** the gate names the composable, the member, and the adapter that is missing it

#### Scenario: A renamed member fails

- **WHEN** a Vue composable spells `execute` as `run`
- **THEN** the gate fails, even though the interface NAME still matches

#### Scenario: A React-only addition fails

- **WHEN** a member is added to a React result type and not to Vue's
- **THEN** the gate fails on the next run, in the direction that names React as ahead

#### Scenario: A dropped parameter or overload fails

- **WHEN** a Vue composable declares fewer parameters, changes their optionality, or declares
  fewer overloads than React's
- **THEN** the gate fails

#### Scenario: A wrong member type fails

- **WHEN** a member React types as `number` is typed as `string` in Vue
- **THEN** the gate fails, because unwrapping a ref wrapper does not change the inner type

#### Scenario: A part's props drift fails the same way

- **WHEN** `ToolbarButtonProps`, `FontFamilyProps` or any other interface both adapters export
  gains a member on one side only
- **THEN** the gate fails — a part's props drift exactly the way a composable's result does, and
  it is the same check

#### Scenario: No interface is checked twice

- **WHEN** the gate runs beside `check:parity-contract`
- **THEN** `DocxEditorProps` and `DocxEditorRef` are checked by the contract alone, and every
  other shared interface by the new gate alone

### Requirement: Exactly two normalizations SHALL reconcile the framework difference

The gate SHALL reduce `Ref<T>`, `ShallowRef<T>`, `ComputedRef<T>` and `Readonly<…>` around any of
them to `T`, and SHALL reduce `MaybeRefOrGetter<T>` in a PARAMETER position to `T`. It SHALL
apply no other transform, SHALL ship with an empty allowlist, and SHALL have no opt-out file.

These two are the framework difference written down as a transform rather than as an exemption.
A getter parameter is already the established Vue shape — `useEditorSnapshot(editor: () =>
Editor | null)` against React's `useEditorSnapshot(editor: Editor | null)` — because a getter
stays live where a captured value does not. An allowlist is what the divergence file this change
deletes became after being born with entries in it.

#### Scenario: A ref-wrapped member compares equal

- **WHEN** Vue declares `readonly zoom: Readonly<ShallowRef<number>>` and React declares
  `readonly zoom: number`
- **THEN** the gate passes for that member

#### Scenario: A getter parameter compares equal

- **WHEN** Vue declares a parameter as `MaybeRefOrGetter<Editor | null>` and React declares it as
  `Editor | null`
- **THEN** the gate passes for that parameter

#### Scenario: No third escape exists

- **WHEN** the gate's source is read
- **THEN** it loads no divergence file, reads no allowlist, and has no per-name exemption

#### Scenario: A deprecated symbol is skipped by its tag

- **WHEN** a React export carries `@deprecated` in the snapshot and has no Vue counterpart
- **THEN** the gate skips it, and the skip is derived from the report rather than from a list the
  gate carries

### Requirement: A differential SHALL prove the two adapters BEHAVE the same

One table of composable, action and assertion SHALL be executed against BOTH adapters from a
single source, over the same document, and SHALL require identical observable results.

Member-for-member agreement still permits `zoomIn()` stepping differently, `useDocumentSearch`
reporting a total where React reports the engine's cap, or `usePageSetup().apply` landing as two
undo steps in one adapter and one in the other. A per-adapter unit test proves that adapter calls
a helper; only a differential proves the two agree.

#### Scenario: The same step lands on the same rung

- **WHEN** both adapters are put at an off-ladder fit scale and `zoomIn()` runs
- **THEN** both report the same resolved scale and the same `canZoomIn`

#### Scenario: The same query reports the same count

- **WHEN** a query exceeding the engine's match cap runs in both
- **THEN** both report the cap and both say the count is a lower bound

#### Scenario: The same write is one undo step in both

- **WHEN** `usePageSetup().apply` runs in both and undo follows
- **THEN** one undo restores the previous page setup in both

#### Scenario: The table is one source

- **WHEN** a row is added to the table
- **THEN** it runs against both adapters without being written twice

### Requirement: A composable SHALL return an object of refs and functions

A composable SHALL return a plain object whose state members are refs and whose action members
are functions with an identity stable for the composable's life. It SHALL NOT return a bare
value and SHALL NOT return a `reactive()` object.

A bare value cannot update. `reactive()` loses reactivity on destructure, and destructuring is
how these are used. An object of refs survives destructuring, and Vue templates auto-unwrap refs
one level deep.

#### Scenario: Destructuring keeps reactivity

- **WHEN** a host writes `const { isEnabled, execute } = useEditorCommand('text.bold')` and the
  selection moves into a place where bold is refused
- **THEN** `isEnabled.value` becomes `false` without the host re-calling the composable

#### Scenario: An action captured once stays correct across a rebuild

- **WHEN** `execute` is bound to a click handler, and then the `document` prop changes and the
  Root builds a new instance
- **THEN** the same `execute` runs the command against the NEW instance

#### Scenario: Effects die with the scope

- **WHEN** a component using any composable unmounts, or an `effectScope` containing one is
  stopped
- **THEN** every watcher and every facade listener it created is released

### Requirement: `useEditorState` SHALL re-render only when its own slice moves

`useEditorState(selector, isEqual?)` SHALL return a read-only ref whose value changes only when
`isEqual` (default `Object.is`) says the selected slice differs from the previous one. Before the
editor exists — outside a Root, before mount, and on the server — the selector SHALL receive a
frozen loading snapshot with `isLoading: true` and `page: { current: 0, total: 0 }`, never
`null`.

#### Scenario: An unrelated change does not move the slice

- **WHEN** a consumer selects `snapshot.page` and the user toggles bold
- **THEN** the returned ref does not change and nothing depending on it re-evaluates

#### Scenario: A custom equality is honoured

- **WHEN** a selector derives a fresh object on every call and a field-wise `isEqual` is supplied
- **THEN** the ref changes only when a field changes

#### Scenario: The loading snapshot is the pre-mount answer

- **WHEN** the composable is called outside any Root
- **THEN** the selector receives the loading snapshot and the ref holds that slice

### Requirement: One subscription per Root SHALL serve every consumer

The Root SHALL hold exactly one `change`, one `selectionChange` and one `error` listener on the
facade, and every `useEditorState` consumer SHALL derive from that single tick.

React subscribes per consumer because `useSyncExternalStore` gives it no cheaper option. The Vue
Root already owns the instance, so twenty toolbar controls cost three listeners rather than
sixty.

#### Scenario: Listener count is independent of consumer count

- **WHEN** a Root mounts with one consumer, and then with forty
- **THEN** the facade reports the same three listeners in both cases

#### Scenario: Consumer count is observable in a test

- **WHEN** the internal consumer counter is read after mounting and unmounting consumers
- **THEN** it returns to its starting value, proving no consumer leaked a watcher

### Requirement: Notification SHALL be coalesced and deferred

A facade event SHALL NOT update the tick synchronously. The update SHALL be scheduled on a
microtask, or on a task when `navigator.scheduling.isInputPending({ includeContinuous: true })`
reports hardware input waiting, and several events in one commit SHALL collapse into one update.

Two independent reasons, both surviving from React. CORRECTNESS: the facade emits `change`
mid-commit, before the layout scheduler's synchronous publish inside the same `exec`, and
`snapshot()` is version-cached — a synchronous read would derive formatting from the
not-yet-published layout and cache that wrong answer for the whole version. EFFICIENCY: one
commit can emit `change` and `selectionChange`, and key repeat must be able to yield.

#### Scenario: Formatting read after a commit is the committed formatting

- **WHEN** a character is typed inside a bold run
- **THEN** the first slice a consumer observes for the new version reports bold, not the previous
  version's formatting

#### Scenario: A burst collapses

- **WHEN** one commit emits both `change` and `selectionChange`
- **THEN** consumers evaluate their selectors once

### Requirement: `useEditorCommand` SHALL take a slot or a raw command and key on value

`useEditorCommand(target)` SHALL accept a `ChromeSlotId` or an `EditorCommand`, SHALL derive
`isActive`, `isEnabled` and `disabledReason` through `toolbarCommandState` for a slot and through
`Editor.can` / `Editor.isActive` for a command, and SHALL re-derive when the command's VALUE
changes — not only when its `type` does.

Two commands can share a type and mean different things (`{ mark: 'bold' }` against
`{ mark: 'italic' }`, `value: 'cyan'` against `'none'`), and both `can` and `isActive` answer
differently for them. Keyed on type alone, a caller that switched payloads keeps the old answer
while `execute` runs the new command — the control renders one state and does another.

#### Scenario: Switching the payload switches the answer

- **WHEN** a control is bound to `{ type: 'toggleMark', mark: 'bold' }` and then rebound to
  `{ type: 'toggleMark', mark: 'italic' }` inside bold text
- **THEN** `isActive` becomes `false`

#### Scenario: A fresh object literal every render does not resubscribe

- **WHEN** a host writes the command inline so a new object arrives on every render
- **THEN** no additional watcher or listener is created

#### Scenario: The disabled reason is the engine's

- **WHEN** a command is refused
- **THEN** `disabledReason` is the engine's own reason, never a string this package invented

#### Scenario: Refusal before mount is honest

- **WHEN** `execute` is called before the editor exists
- **THEN** it returns `false` and nothing throws

### Requirement: `useEditorValueCommand` SHALL bind a value-typed slot

`useEditorValueCommand(slotId)` SHALL report the slot's current value, its options where the
engine supplies them, and a setter that runs the command through the same can-before-exec path,
for the value-typed slots the registry declares.

#### Scenario: The reported value is the engine's

- **WHEN** an image is selected with a wrap type applied
- **THEN** the composable reports that wrap type, read from the engine, not from a local copy

### Requirement: `useEditorCaret` SHALL answer with a paragraph and an offset

`useEditorCaret()` SHALL return a ref holding `{ paragraphId, offset }` or `null` when nothing is
placed, compared by value so it moves only when the caret moves, and SHALL update on both
`selectionChange` and `change`.

`snapshot.selection` cannot answer this: `DocRange` addresses paragraphs by id and carries no
offsets, so a caret and a range inside one paragraph are the same value there. Anything a host
inserts AT A PLACE needs this, and without it hosts reach for the instance-only `surface` escape
hatch.

#### Scenario: A commit that moves the caret without a selection event

- **WHEN** a character is typed
- **THEN** the caret ref moves, because the composable listens to `change` as well as
  `selectionChange`

#### Scenario: A re-render that does not move the caret

- **WHEN** an unrelated part of the snapshot changes
- **THEN** the caret ref keeps its value and identity

#### Scenario: Server render

- **WHEN** the composable runs on the server
- **THEN** it reports `null`, because there is no surface to measure

### Requirement: `useEditorEvent` SHALL subscribe for the scope's lifetime without resubscribing

`useEditorEvent(event, handler)` SHALL forward to the latest handler, SHALL resubscribe only when
the instance or the event name changes, and SHALL release the subscription when its scope is
disposed.

A fresh inline closure on every render must not churn the subscription.

#### Scenario: A new closure every render

- **WHEN** the handler is written inline and the component re-renders ten times
- **THEN** exactly one listener exists on the facade, and it calls the most recent closure

### Requirement: `useFonts` SHALL give one stable resolver, and `useDocxSource` SHALL open a document

`useFonts(source, ...fragments)` SHALL return a `FontResolver` whose identity never changes for
the scope's life and which reads its arguments at resolve time. `useDocxSource(source, options)`
SHALL fetch or accept bytes, resolve fonts, hold the document back until fonts have SETTLED —
resolved or failed — and cancel both on scope disposal or a source change.

The Root rebuilds its instance when `fonts` changes identity, which is right for a value and a
trap for a function: an inline resolver would destroy and rebuild the editor on every render,
forever. Fonts never fail the document: a face that will not load degrades that family to
fixed-width measurement, so a font failure leaves `error` null; a document failure has nothing
to show and lands on `error`. Holding the document until fonts settle is what keeps the first
layout the only layout.

#### Scenario: An inline resolver does not remount

- **WHEN** a host passes `useFonts(googleFonts())` to the Root and the component re-renders
- **THEN** the editor is not rebuilt

#### Scenario: Fonts fail, the document still opens

- **WHEN** the font loader rejects
- **THEN** `error` stays `null`, `document` is released, and the editor paginates on the fixed
  fallback

#### Scenario: A source change cancels the previous fetch

- **WHEN** the source changes while a fetch is in flight
- **THEN** the previous request is aborted and its late response sets no state

### Requirement: The read-and-write composables SHALL read from the engine and write through it

Each composable SHALL derive every reported value from the engine at the version the snapshot
describes, and SHALL apply every write through an `Editor` command or a core helper. This
covers `useZoom`, `usePageSetup`, `useParagraphIndent`, `useFontFamily`, `useParagraphStyle`,
`useDocumentOutline`, `useDocumentSearch`, `useNavigationPane`, `useNavigationShift`,
`useHyperlinkPopup`, `useContentControl`, `useHeaderFooterState`, `useNoteScopeState` and
`useNotePropertiesState`.

None of them may keep a shadow copy. The engine owns the scale because the painted pages, the
ruler and hit testing all divide by it; it owns the indent because the ruler's four handles are
built from `ruler-indent.ts`; it owns the search because the debounce, the cap and the match
derivation are `SEARCH_DEBOUNCE_MS`, `SEARCH_MATCH_LIMIT` and `Editor.findMatches`.

#### Scenario: Zoom reports both the number and where it came from

- **WHEN** the editor is tracking the viewport
- **THEN** `zoom` is the resolved scale, `mode` is the fit, and `isFit` is `true`, so a control
  can show the fit as selected instead of ticking the nearest percentage

#### Scenario: A step from an off-ladder scale lands on the next rung

- **WHEN** a fit has resolved the scale to a value between two ladder rungs and the user steps up
- **THEN** the scale lands on the next rung, and `canZoomIn` agrees with what the step did

#### Scenario: Search honours the engine's cap

- **WHEN** a query matches more occurrences than the engine's cap
- **THEN** the composable reports the cap and says the count is a lower bound, rather than
  inventing a total

#### Scenario: The navigation pane floats until it cannot

- **WHEN** the viewport is wide enough to hold the pane beside the centred page
- **THEN** the page does not move, and the shift the composable reports is zero — the rule comes
  from `navigationShift`, not from a second implementation
