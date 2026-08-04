# Customizing the editor

There are three ways to change how the editor looks and behaves, and they are meant to be
tried in this order. Reaching for the next one is a signal that the previous one has a gap —
if you find yourself at the bottom of this page, open an issue rather than living with it.

`examples/igloo/` is a working demonstration of all three. `bun run dev:igloo`.

---

## 1. Props on the parts

Every packaged control is a compound with the same contract: render it with no children and
you get the default arrangement; a child that names one of its members **replaces that member
in place**; `hidden` removes it; `preset={false}` starts from nothing; and there is a part for
adding something the library does not model.

```tsx
<DocxEditor.Toolbar>
  {/* replaces the packaged Bold button, keeps everything else */}
  <DocxEditor.Toolbar.Bold icon={<MyBoldIcon />} />
  {/* your own action — no chrome slot, no engine wiring */}
  <DocxEditor.Toolbar.Action label="Send for review" icon={<Send />} onSelect={send} />
</DocxEditor.Toolbar>
```

The same shape applies to `DocxEditor.Menu`, `DocxEditor.ContextMenu` and
`DocxEditor.Navigation`.

**What you can pass**

| Prop | Where | Notes |
| --- | --- | --- |
| `icon` | toolbar parts, menu rows, menu triggers, colour splits, context-menu rows | Any `ReactNode`. ~18px inline SVG matches the packaged controls |
| `t` | any compound | Your i18n resolver. Without it the raw keys render, never English |
| `preset={false}` | any compound | Renders your children verbatim, in your order |
| `hidden` | any packaged part | Removes it from the default arrangement |
| `className` | every part | Appended after the load-bearing classes |
| `label`, `onSelect`, `disabled`, `disabledReason` | `Toolbar.Action`, `ContextMenu.Item`, `Menu.Row` | Host-owned actions |

**Host actions still ask the engine.** A control the registry does not describe has no
enabled state of its own — but you can borrow the engine's:

```tsx
const { isEnabled, disabledReason } = useEditorCommand({ type: 'setMarkAttr', mark: 'highlight', attr: 'val', value: 'cyan' });
```

`useEditorCommand` takes a `ChromeSlotId` **or** a raw `EditorCommand`, so your own action
greys out for the engine's reason rather than a guess of yours. Never invent a disabled
reason; if the engine did not give you one, do not show one.

---

## 2. Tokens

All chrome colour lives on CSS custom properties. Restating them under any scope re-themes
everything inside it — toolbar, menu bar, panels, pickers, rulers, the navigation pane —
without touching a single component.

```css
.my-editor {
  --doc-surface: #f1fbff;
  --doc-text: #0d3149;
  --doc-primary: #1b7fa8;
}
```

Custom properties inherit, so **the scope is the override**. Narrow it to re-theme one
region: Igloo makes its navigation pane transparent white-on-water with a token block on the
pane alone, and nothing else in the app changes.

### The palette

| Token | Paints |
| --- | --- |
| `--doc-surface` | Panels, menus, dropdowns, cards |
| `--doc-card` | Comment and suggestion cards |
| `--doc-bg` | The workspace behind the page |
| `--doc-bg-subtle`, `--doc-bg-input` | Section backgrounds, input fields |
| `--doc-bg-hover` | Hover states — **and** the navigation toggle's resting plate |
| `--doc-primary`, `--doc-primary-hover`, `--doc-primary-light` | Accent, selected states |
| `--doc-accent`, `--doc-accent-bg` | Secondary accent |
| `--doc-on-primary` | Text on an accent fill |
| `--doc-text`, `--doc-text-muted`, `--doc-text-subtle`, `--doc-text-placeholder` | Text ramp. The rulers draw their ticks in the last two |
| `--doc-border`, `--doc-border-light`, `--doc-border-dark`, `--doc-border-input` | Rules and outlines |
| `--doc-link` | Hyperlinks in chrome |
| `--doc-error`, `--doc-success`, `--doc-warning` (+ `-bg`) | Status |
| `--doc-focus-ring`, `--doc-selection` | Focus and selection |
| `--doc-shadow`, `--doc-shadow-strong`, `--doc-shadow-subtle`, `--doc-shadow-lg` | Elevation |
| `--doc-overlay` | Modal backdrops |

Dark mode is the same list re-declared under `.ep-root.dark`.

### Two requirements

- **`ep-root` must be an ancestor** of any chrome you mount. `DocxEditor.Viewport` applies it
  to itself; a toolbar or menu bar you place outside the viewport needs it on a wrapper, or
  the whole Tailwind layer and every token silently resolve to nothing.
- **Import the stylesheet**: `@import '@docx-editor.dev/react/styles.css'`.

### What is deliberately not themeable

**The document canvas.** Painter output stays Word-faithful — a page that matched your brand
would be a lie about what the file contains. Theme the space *around* the page instead; Igloo
puts the page on an iceberg rather than tinting it.

---

## 3. Your own React

Anything composes under `DocxEditor.Root`. The primitives are `Root` (owns the editor's
lifetime), `Viewport` (the scroll container the engine discovers by class), and `Content` (the
element it paints into). Everything else — your header, your panels, your art — is just
children.

```tsx
<DocxEditor.Root document={bytes} fonts={fonts}>
  <MyHeader />
  <DocxEditor.Viewport>
    <MyBackdrop />
    <DocxEditor.Content className="my-page" />
  </DocxEditor.Viewport>
</DocxEditor.Root>
```

`Content`'s centring margin is defined behind `:where()`, so it carries no specificity: place
the page yourself with a plain class, never `!important`.

To read editor state, use `useEditorState(selector)`; to open a document,
[`useDocxSource`](#opening-a-document).

---

## Two layout traps

Both cost real debugging time in Igloo, and both are ordinary CSS a host would write.

**`backdrop-filter` captures `position: fixed` children.** An element with
`backdrop-filter` (or `filter`, or `transform`) becomes the containing block for every fixed
descendant. A frosted header containing the menu bar makes the Page Setup dialog's
`inset: 0` overlay resolve against the *header*, so the dialog centres inside a 120px strip.
Put the effect on a `::before` pseudo-element instead.

**`z-index` traps popovers.** A `z-index` on the wrapper around `Viewport` opens a stacking
context that the context menu cannot escape, however high its own `z-index` goes. Use
`position: relative` with an auto `z-index` where you can.

---

## Opening a document

```tsx
import { useDocxSource } from '@docx-editor.dev/react';
import { defaultFonts } from '@docx-editor.dev/fonts';

const { document, fonts, error, isLoading } = useDocxSource(url, { fonts: defaultFonts });
```

It fetches the bytes, resolves the fonts, composes them, and cancels both on unmount. It
holds `document` back until fonts settle, because layout **measures** with them — releasing
bytes first paginates the document on the fixed fallback and then re-paginates, which reads
as the text jumping.

Fonts are passed in rather than imported, so a host bringing its own faces does not ship the
default font bytes. A font failure never fails the document: that family degrades to
fixed-width measurement and `error` stays null.

---

## When none of this is enough

The `docx-*` class names are **implementation details**, not API. Styling them works until it
does not, and nothing tells you when a release moves one.

If you need something the three layers above cannot express, that is a gap worth reporting —
this page exists because building `examples/igloo/` found several, and each one became a prop
or a token rather than a workaround.
