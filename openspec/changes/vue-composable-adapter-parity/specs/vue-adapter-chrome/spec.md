## ADDED Requirements

### Requirement: A compound SHALL render the packaged arrangement and take in-place overrides

`DocxEditorToolbar`, `DocxEditorMenu` and `DocxEditorContextMenu` SHALL render the complete
packaged arrangement with no children; SHALL replace a member in place when a default-slot child
NAMES it; SHALL remove that member when such a child carries `hidden`; SHALL append any child
that names nothing, after the default set; and SHALL render children verbatim when `preset` is
`false`.

This is the contract `packages/react/src/editor/merge-arrangement.tsx` already implements for
three surfaces. Dropping a child that names nothing would swallow a row silently, and two
children naming one member collapse to the last, which is what makes `hidden` remove the
packaged member rather than render a second invisible copy beside it.

#### Scenario: No children is the whole toolbar

- **WHEN** the toolbar is rendered with no children
- **THEN** every group and control of `CHROME_GROUPS` renders, in registry order, with a
  separator between groups

#### Scenario: One customized control, still the whole toolbar

- **WHEN** a host renders the toolbar with a single Bold part carrying a class
- **THEN** the bar is unchanged except that Bold carries the class, in its registry position

#### Scenario: `hidden` removes

- **WHEN** a host renders a part with `hidden`
- **THEN** that member does not render, and no gap or empty element is left where it stood

#### Scenario: A host's own action appends

- **WHEN** a host renders a child that names no member
- **THEN** it renders after the default set, in the order given

#### Scenario: `preset` false opts out

- **WHEN** `preset` is `false`
- **THEN** only the children render, in the order given

### Requirement: A child SHALL be identified by a static marker on its component type

A compound SHALL identify an overriding child by reading a `docxSlot` static from the child
vnode's component TYPE, SHALL flatten Fragment vnodes before reading it, and SHALL NOT identify a
child by component name, `displayName` or a named slot.

Component names minify away. Fragment vnodes are what `v-for` and `<template>` produce, and a
host mapping over its overrides hits that immediately — React's twin has the same rule for the
same reason. Named slots are rejected outright: `#text.bold` parses `bold` as a directive
MODIFIER, and transforming the slot names would create a second vocabulary beside
`ChromeSlotId`.

#### Scenario: A `v-for` over overrides works

- **WHEN** a host renders its overrides through `v-for`, producing a Fragment vnode
- **THEN** each override replaces its member, rather than appending a second copy beside it

#### Scenario: A wrapped part loses its placement

- **WHEN** a host wraps a marked part in another component
- **THEN** the wrapper names nothing and appends, because the marker lives on the component type

#### Scenario: Minified output still merges

- **WHEN** the package is built with minification
- **THEN** the merge behaves identically, because no identification reads a name

#### Scenario: A `v-if` false branch is not mistaken for host content

- **WHEN** a host wraps an override in `v-if` and the condition is false
- **THEN** the Comment vnode Vue leaves behind is skipped, and the packaged member renders in its
  place — Text vnodes from template whitespace are skipped for the same reason

#### Scenario: Overrides stay live

- **WHEN** a host's override changes after the first render
- **THEN** the compound re-merges, because `slots.default()` is read during RENDER and not
  captured in `setup`

### Requirement: The chrome SHALL add no headless-UI dependency

The Vue package SHALL implement `Slot` in-tree with `mergeProps` and `cloneVNode`, and SHALL
build its pickers, dropdowns and steppers on it. It SHALL NOT add `reka-ui`, `radix-vue`, or any
other component library.

React's `Slot` is about forty lines in-tree, deliberately not `@radix-ui/react-slot`, and every
v2 picker — `FontFamily`, `ParagraphStyle`, the colour splits, the steppers — is built on it.
The one Radix import in the React tree is `components/ui/Select.tsx`, which nothing imports.
`bunfig.toml` also sets `minimumReleaseAge` to seven days, so a new dependency is a schedule
cost for no capability.

#### Scenario: No component library in the manifest

- **WHEN** `packages/vue/package.json` is read
- **THEN** it declares no headless-UI or component library

#### Scenario: `asChild` behaves the same on both adapters

- **WHEN** a host replaces a toolbar part's element through the slot pattern
- **THEN** class names concatenate, styles merge with the child winning per property, handlers
  compose child-first and the slot's handler is skipped once the child called
  `preventDefault()`, and every other attribute forwards with the child's value taking
  precedence

### Requirement: The arrangement SHALL be derived from the core registry

The toolbar's groups and controls SHALL come from `CHROME_GROUPS`, and the menu bar's menus and
rows from `CHROME_MENUS`. Neither SHALL be hand-listed in this package.

A registry change must flow to both adapters at once: a new control renders as a live button —
disabled with the engine's own reason until it is wired — without either adapter being edited.
A row and its toolbar twin cannot describe the same capability differently if both read the same
entry.

#### Scenario: A new registry entry appears without an adapter edit

- **WHEN** a control is added to `CHROME_GROUPS`
- **THEN** both adapters render it, in registry order, with the registry's label and icon

#### Scenario: One capability, one enabled state

- **WHEN** a capability appears both in the toolbar and as a menu row
- **THEN** both report the same enabled state and the same disabled reason, because both call
  `toolbarCommandState`

#### Scenario: Chrome mousedown does not steal the caret

- **WHEN** a chrome control receives `mousedown`
- **THEN** the default is prevented, except on `INPUT`, `SELECT` and `TEXTAREA`, so the caret
  stays where the user left it

### Requirement: The Vue chrome SHALL resolve every user-facing string through the catalogue

`LocaleProvider` SHALL publish a catalogue merged onto the INHERITED one, `useTranslation` SHALL
read it, `useChromeTranslate` SHALL resolve a chrome key with a host override map taking
precedence, and no component SHALL hold a hardcoded user-facing English string.

A provider with no catalogue is a no-op rather than a silent revert to English, so a host that
wraps its app in one still reaches this chrome and a nested provider composes with it.

#### Scenario: A nested provider composes

- **WHEN** a host wraps the app in a locale provider and the editor is given a second one that
  overrides three keys
- **THEN** those three resolve from the inner catalogue and the rest from the outer

#### Scenario: A locale change re-languages the chrome, and rebuilds the editor

- **WHEN** the published catalogue changes
- **THEN** every mounted chrome label re-resolves, because components render them
- **AND** the editor instance is rebuilt, because `createDocxEditor` SAMPLES `translate` and it
  is what paints drawing refusal labels — React's Root lists the resolver in its creation
  effect's dependencies for exactly this reason, and parity means mirroring it, edit loss
  included

#### Scenario: No literal English in a component

- **WHEN** `packages/vue/src` is searched for user-facing text
- **THEN** every such string is a catalogue key resolved through `t`, and `bun run
i18n:validate` passes

### Requirement: Vue SHALL ship the seams a capability package composes with

The Vue entry SHALL export `ReviewRailContext` as an injection key with the same registry shape
React's context carries, `Slot` as the single-child prop-merging component, and `LocaleProvider`
/ `useTranslation` / `useChromeTranslate`.

The review pane lives in `@docx-editor.dev/pro/vue`. The adapter supplies its composition seams,
and the gutter reservation is keyed on a rail actually being mounted — not on a pane's open
state, which pushed the page off
centre beside an empty column for every consumer that mounted no rail.

#### Scenario: No rail, no gutter

- **WHEN** the editor renders with no review rail registered
- **THEN** the viewport reserves no gutter and the page stays centred

#### Scenario: A rail registers and unregisters

- **WHEN** a rail mounts and later unmounts
- **THEN** the registry count rises and falls, and the reservation follows what is on screen

#### Scenario: `Slot` merges onto one child

- **WHEN** `Slot` is given props and a single child element
- **THEN** the props are merged onto that child, and a slot rendering zero or several roots
  renders nothing rather than guessing

### Requirement: Pro custom-node chrome SHALL support Vue

`@docx-editor.dev/pro/vue` SHALL export `CustomNodeChrome`,
`CustomNodeContextMenu`, `useCustomNodeDefinitions`,
`resolveCustomNodeActivation`, and `activatedCustomNodeOf` with the same
capabilities as the React Pro entry.

The chrome SHALL resolve definitions from the `nodes` prop or the editor module,
apply host-authored colors without interpolating file data into CSS, dispatch
click and hover activation, and add edit and remove rows to the context menu.

#### Scenario: A registered definition colors and activates a chip

- **WHEN** `CustomNodeChrome` mounts with a registered definition
- **THEN** the painted chip uses the definition color
- **AND** a primary press and release on the same node calls its click hook

#### Scenario: A custom node contributes context menu rows

- **WHEN** the context menu opens on a recognized custom node
- **THEN** its review-card text and available edit and remove actions render
  before the packaged rows

#### Scenario: Plain text contributes no custom-node section

- **WHEN** the context menu opens outside a recognized custom node
- **THEN** `CustomNodeContextMenu` renders nothing

### Requirement: Painted-surface chrome SHALL sanitize every document-supplied value

No Vue component SHALL pass a document-derived value to `v-html`, and every `href` and every
window target derived from a document SHALL pass through `sanitizeHref`.

`v-html` is Vue's `innerHTML` and is not covered by the repository's existing sink grep. A `.docx`
is a zip of XML the sender fully controls, so a hyperlink target is attacker-controlled input.

#### Scenario: A `javascript:` target is refused

- **WHEN** the hyperlink popover shows a link whose target is `javascript:alert(1)`
- **THEN** the rendered target is inert and activating it navigates nowhere

#### Scenario: The sink grep covers Vue

- **WHEN** the repository's sink grep runs
- **THEN** it includes `v-html`, and reports no occurrence in `packages/vue/src`

### Requirement: The packaged Vue host SHALL be sugar over the primitives

`DocxEditor` SHALL compose `DocxEditorRoot`, `DocxEditorViewport` and `DocxEditorContent` plus
the packaged chrome, SHALL expose the same seven-member handle React's ref carries, and SHALL
render the painted surface alone when chrome is switched off.

It is sugar, not a parallel implementation: a host that outgrows the packaged chrome drops to the
primitives with no behavior change.

#### Scenario: One line is a complete editor

- **WHEN** a host renders the component with a document and nothing else
- **THEN** the chrome, the labels and an editable painted document appear with no further
  configuration

#### Scenario: Chrome off leaves the surface

- **WHEN** chrome is switched off
- **THEN** only the viewport and the painted pages render, and the parts inside scope themselves

#### Scenario: The handle matches React's

- **WHEN** the exposed handle is compared with `DocxEditorRef`
- **THEN** it carries `load`, `save`, `getDocumentHandle`, `getEditor`, `focus`, `exec` and
  `snapshot`, each safe to call before mount

#### Scenario: Callback props that are emits are declared as emits

- **WHEN** the parity contract is applied to the two adapters' props
- **THEN** `change`, `ready`, `fontError`, `save`, `open` and `titleChange` are classified as the
  emit form of React's callback props, and every other prop pairs by name

### Requirement: A Boolean prop SHALL NOT be cast to false when it is absent

Every Boolean-valued prop SHALL declare `default: undefined` and resolve its default in the
component body, matching the React default exactly.

Vue casts an absent `Boolean` prop to `false`; React leaves it `undefined` so the component's
own default applies. `chrome`, `menu`, `navigation`, `rulers` and `contextMenu` all default to
TRUE in React, so a plain `{ type: Boolean }` declaration turns the packaged editor into a bare
surface with no chrome — and reports no error.

#### Scenario: Omitting every optional prop gives the packaged editor

- **WHEN** the component is rendered with a document and nothing else
- **THEN** the title bar, the menu bar, the toolbar, the rulers, the navigation pane and the
  right-click menu are all present, exactly as React's defaults give

#### Scenario: An explicit false still removes

- **WHEN** a host passes `:chrome="false"`
- **THEN** only the painted surface renders

### Requirement: The parity contract SHALL classify three form differences and no more

`scripts/parity/parity.contract.json` SHALL pair every `DocxEditorProps` member by name except
where Vue expresses it in one of three documented forms: an EMIT for a React callback prop, a
SLOT for a React `children` or render prop, and native ATTRIBUTE FALLTHROUGH for `className`.
No other category SHALL exist, and `deferredInVue` SHALL be empty.

`renderTitleBarLeft` and `renderTitleBarRight` are render props, and `children` is a node prop;
all three are slots in Vue. Classifying them as deferred would say the capability is missing
when only its spelling differs.

#### Scenario: Every prop is classified

- **WHEN** `bun run check:parity-contract` runs
- **THEN** every member of both adapters' `DocxEditorProps` is `paired` or named in one of the
  three form categories, and `deferredInVue` is empty

#### Scenario: The title bar slots exist

- **WHEN** a host fills the leading and trailing title-bar slots
- **THEN** the content renders where React's `renderTitleBarLeft` and `renderTitleBarRight` put
  it

#### Scenario: A resolver stays a prop

- **WHEN** `translate` and `tableInteractionLabel` are classified
- **THEN** both are `paired` props on both adapters, because the engine CALLS them and uses the
  return value, which an emit cannot give
