# Customizing the editor

Start with component props, then CSS tokens. Use custom composition when you need a different layout.

Run `bun run dev:igloo` to explore all three approaches in the [Igloo example](../examples/igloo).

---

## 1. Props on the parts

Packaged compounds expose named parts. Render a compound without children to use its default arrangement. A named child replaces the corresponding part in place. Use `hidden` to remove a part and `preset={false}` to supply your own arrangement. The available parts depend on the component.

```tsx
<DocxEditor.Toolbar>
  {/* replaces the packaged Bold button, keeps everything else */}
  <DocxEditor.Toolbar.Bold icon={<MyBoldIcon />} />
  {/* your own action — no chrome slot, no engine wiring */}
  <DocxEditor.Toolbar.Action label="Send for review" icon={<Send />} onSelect={send} />
</DocxEditor.Toolbar>
```

The same shape applies to `DocxEditor.Menu`, `DocxEditor.ContextMenu` and `DocxEditor.Navigation`.

Page Setup, Paragraph Options, and legacy text Field Options also expose named parts. Use the editor's `popups` configuration for automatically opened instances. See [Customize popups](site/content/guides/customize-dialogs.mdx) for React and Vue examples.

### Add classes to parts

Use the documented part statics and their `className` props to attach your own classes. For example:

```tsx
<DocxEditor.Navigation className="my-nav" toggle={{ className: 'my-nav__toggle' }}>
  <DocxEditor.Navigation.Header className="my-nav__header">
    <DocxEditor.Navigation.Close className="my-nav__close" />
    <DocxEditor.Navigation.Title className="my-nav__title" />
  </DocxEditor.Navigation.Header>
  <DocxEditor.Navigation.Tabs className="my-nav__tabs" />
  <DocxEditor.Navigation.Headings className="my-nav__headings" />
  <DocxEditor.Navigation.Find className="my-nav__find" />
</DocxEditor.Navigation>
```

Parts retain their behavior when you supply classes. For example, `Headings` still reads the document outline. Prefer these public props to selectors that depend on internal markup.

Where a sub-element is rendered outside `children` and so cannot be composed — the navigation toggle, which has to stay clickable while the panel is `inert` — the prop takes props: `toggle={{ className }}`. `menu`, `contextMenu` and `navigation` on `<DocxEditor>` accept `boolean | Props` the same way.

**What you can pass**

| Prop                                              | Where                                                                    | Notes                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `icon`                                            | toolbar parts, menu rows, menu triggers, color splits, context-menu rows | Any `ReactNode`. ~18px inline SVG matches the packaged controls   |
| `t`                                               | any compound                                                             | Your i18n resolver. Without it the raw keys render, never English |
| `preset={false}`                                  | any compound                                                             | Renders your children verbatim, in your order                     |
| `hidden`                                          | any packaged part                                                        | Removes it from the default arrangement                           |
| `className`                                       | every part                                                               | Appended after the load-bearing classes                           |
| `label`, `onSelect`, `disabled`, `disabledReason` | `Toolbar.Action`, `ContextMenu.Item`, `Menu.Row`                         | Host-owned actions                                                |

**Host actions still ask the engine.** A control the registry does not describe has no enabled state of its own — but you can borrow the engine's:

```tsx
const { isEnabled, disabledReason } = useEditorCommand({
  type: 'setMarkAttr',
  mark: 'highlight',
  attr: 'val',
  value: 'cyan',
});
```

`useEditorCommand` takes a `ChromeSlotId` **or** a raw `EditorCommand`, so your own action grays out for the engine's reason rather than a guess of yours. Never invent a disabled reason; if the engine did not give you one, do not show one.

---

## 2. Tokens

Editor controls use CSS custom properties for colors. Set these tokens on a wrapper to theme its toolbar, menus, panels, pickers, rulers, and navigation pane.

```css
.my-editor {
  --doc-surface: #f1fbff;
  --doc-text: #0d3149;
  --doc-primary: #1b7fa8;
}
```

Custom properties inherit. To theme one region, set the tokens on that region's wrapper.

### The palette

| Token                                                                           | Paints                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `--doc-surface`                                                                 | Panels, menus, dropdowns, cards                              |
| `--doc-card`                                                                    | Comment and suggestion cards                                 |
| `--doc-bg`                                                                      | The workspace behind the page                                |
| `--doc-bg-subtle`, `--doc-bg-input`                                             | Section backgrounds, input fields                            |
| `--doc-bg-hover`                                                                | Hover states — **and** the navigation toggle's resting plate |
| `--doc-primary`, `--doc-primary-hover`, `--doc-primary-light`                   | Accent, selected states                                      |
| `--doc-accent`, `--doc-accent-bg`                                               | Secondary accent                                             |
| `--doc-on-primary`                                                              | Text on an accent fill                                       |
| `--doc-text`, `--doc-text-muted`, `--doc-text-subtle`, `--doc-text-placeholder` | Text ramp. The rulers draw their ticks in the last two       |
| `--doc-border`, `--doc-border-light`, `--doc-border-dark`, `--doc-border-input` | Rules and outlines                                           |
| `--doc-link`                                                                    | Hyperlinks in chrome                                         |
| `--doc-error`, `--doc-success`, `--doc-warning` (+ `-bg`)                       | Status                                                       |
| `--doc-focus-ring`, `--doc-selection`                                           | Focus and selection                                          |
| `--doc-shadow`, `--doc-shadow-strong`, `--doc-shadow-subtle`, `--doc-shadow-lg` | Elevation                                                    |
| `--doc-overlay`                                                                 | Modal backdrops                                              |

Dark mode is the same list re-declared under `.docx-editor.dark`.

### Two requirements

- **`docx-editor` must be an ancestor** of any chrome you mount. `DocxEditor.Viewport` applies it to itself; a toolbar or menu bar you place outside the viewport needs it on a wrapper, or the whole Tailwind layer and every token silently resolve to nothing.
- **Import the stylesheet**: `@import '@docx-editor.dev/core/styles/editor.css'`.

### What is deliberately not themeable

The document canvas uses the file's formatting. Theme the surrounding editor UI without changing how document pages appear.

---

## 3. Your own React

Compose your layout under `DocxEditor.Root`, which manages the editor's lifetime. `Viewport` provides the scroll container, and `Content` provides the document surface. Add your header and panels as children.

```tsx
<DocxEditor.Root document={bytes} fonts={fonts}>
  <MyHeader />
  <DocxEditor.Viewport>
    <MyBackdrop />
    <DocxEditor.Content className="my-page" />
  </DocxEditor.Viewport>
</DocxEditor.Root>
```

`Content`'s centering margin is defined behind `:where()`, so it carries no specificity: place the page yourself with a plain class, never `!important`.

To read editor state, use `useEditorState(selector)`; to open a document, [`useDocxSource`](#open-a-document).

---

## Avoid layout conflicts

**`backdrop-filter` captures `position: fixed` children.** An element with `backdrop-filter` (or `filter`, or `transform`) becomes the containing block for every fixed descendant. A frosted header containing the menu bar makes the Page Setup dialog's `inset: 0` overlay resolve against the _header_, so the dialog centers inside a 120px strip. Put the effect on a `::before` pseudo-element instead.

**`z-index` traps popovers.** A `z-index` on the wrapper around `Viewport` opens a stacking context that the context menu cannot escape, however high its own `z-index` goes. Use `position: relative` with an auto `z-index` where you can.

---

## Open a document

```tsx
import { useDocxSource } from '@docx-editor.dev/react';
import { defaultFonts } from '@docx-editor.dev/fonts';

const { document, fonts, error, isLoading } = useDocxSource(url, { fonts: defaultFonts });
```

It fetches the bytes, resolves the fonts, composes them, and cancels both on unmount. It holds `document` back until fonts settle, because layout **measures** with them — releasing bytes first paginates the document on the fixed fallback and then re-paginates, which reads as the text jumping.

Fonts are passed in rather than imported, so a host bringing its own faces does not ship the default font bytes. A font failure never fails the document: that family degrades to fixed-width measurement and `error` stays null.

---

## Request a customization API

Internal `docx-*` classes can change between releases. Prefer documented props, parts, and tokens.

If the public API cannot express your layout, [open an issue](https://github.com/eigenpal/docx-editor/issues).
