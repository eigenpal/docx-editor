# Customize the editor

Start with component props, then CSS tokens. Use custom composition when you need a different layout.

Run `bun run dev:igloo` to explore all three approaches in the [Igloo example](../examples/igloo).

---

## Customize component parts

Packaged compounds expose named parts. Render a compound without children to use its default arrangement. A named child replaces the corresponding part in place. Use `hidden` to remove a part and `preset={false}` to supply your own arrangement. The available parts depend on the component. In these snippets, `t` is the resolver returned by `useChromeTranslate()` inside your component.

```tsx
<DocxEditor.Toolbar t={t}>
  {/* replaces the packaged Bold button, keeps everything else */}
  <DocxEditor.Toolbar.Bold icon={<MyBoldIcon />} />
  {/* your own action — no chrome slot, no engine wiring */}
  <DocxEditor.Toolbar.Action label="Send for review" icon={<Send />} onSelect={send} />
</DocxEditor.Toolbar>
```

The same shape applies to `DocxEditor.Menu`, `DocxEditor.ContextMenu`, and `DocxEditor.Navigation`.

Page Setup, Paragraph Options, and legacy text Field Options also expose named parts. Use the editor's `popups` configuration for automatically opened instances. See [Customize popups](site/content/guides/customize-dialogs.mdx) for React and Vue examples.

### Add classes to parts

Use the documented part statics and their `className` props to attach your own classes. For example:

```tsx
<DocxEditor.Navigation t={t} className="my-nav" toggle={{ className: 'my-nav__toggle' }}>
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

Some elements render outside `children`. For example, the navigation toggle stays available while the panel is `inert`. Customize it with `toggle={{ className }}`. The root `menu`, `contextMenu`, and `navigation` props also accept either a boolean or a props object.

Use these props to customize parts:

| Prop | Where | Notes |
| --- | --- | --- |
| `icon` | toolbar parts, menu rows, menu triggers, color splits, context-menu rows | Any `ReactNode`. ~18px inline SVG matches the packaged controls |
| `t` | any compound | Your i18n resolver. Without it the raw keys render, never English |
| `preset={false}` | any compound | Renders your children verbatim, in your order |
| `hidden` | any packaged part | Removes it from the default arrangement |
| `className` | every part | Appended after the load-bearing classes |
| `label`, `onSelect`, `disabled`, `disabledReason` | `Toolbar.Action`, `ContextMenu.Item`, `Menu.Row` | Host-owned actions |

For custom actions, use `useEditorCommand` to read whether the engine permits the command:

```tsx
const { isEnabled, disabledReason } = useEditorCommand({
  type: 'setMarkAttr',
  mark: 'highlight',
  attr: 'val',
  value: 'cyan',
});
```

`useEditorCommand` accepts a `ChromeSlotId` or an `EditorCommand`. Use the returned `isEnabled` and `disabledReason` values to explain command availability.

---

## Set color tokens

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

| Token | Paints |
| --- | --- |
| `--doc-surface` | Panels, menus, dropdowns, cards |
| `--doc-card` | Comment and suggestion cards |
| `--doc-bg` | The workspace behind the page |
| `--doc-bg-subtle`, `--doc-bg-input` | Section backgrounds, input fields |
| `--doc-bg-hover` | Hover states and the navigation toggle background |
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

Dark mode is the same list re-declared under `.docx-editor.dark`.

### Two requirements

- Place custom controls inside a `docx-editor` wrapper to apply scoped styles and theme tokens. Packaged components such as `DocxEditor.Toolbar` and `DocxEditor.Viewport` apply their own scope.
- Import the stylesheet with `@import '@docx-editor.dev/core/styles/editor.css'`.

### What is deliberately not themeable

The document canvas uses the file's formatting. Theme the surrounding editor UI without changing how document pages appear.

---

## Compose a React layout

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

`backdrop-filter` changes the containing block for `position: fixed` children. An element with `backdrop-filter` (or `filter`, or `transform`) becomes the containing block for every fixed descendant. A frosted header containing the menu bar makes the Page Setup dialog's `inset: 0` overlay resolve against the header, so the dialog centers inside a 120px strip. Put the effect on a `::before` pseudo-element instead.

A stacking context can constrain popovers. A `z-index` on the wrapper around `Viewport` opens a stacking context that the context menu cannot escape, however high its own `z-index` goes. Use `position: relative` with an auto `z-index` where you can.

---

## Open a document

Call `useDocxSource` inside your component to fetch document bytes and resolve fonts:

```tsx
import { useDocxSource } from '@docx-editor.dev/react';
import { defaultFonts } from '@docx-editor.dev/fonts';

const { document, fonts, error, isLoading } = useDocxSource(url, { fonts: defaultFonts });
```

With an eager font loader such as `defaultFonts`, the hook waits for fonts before exposing the document bytes. This avoids an initial layout with fallback measurements. On-demand resolvers such as `packagedFonts()` expose bytes immediately so the engine can discover the required fonts. The engine paginates again when those fonts load.

Fonts are passed in rather than imported, so a host bringing its own faces does not ship the default font bytes. A font failure never fails the document: that family degrades to fixed-width measurement and `error` stays null.

---

## Request a customization API

Internal `docx-*` classes can change between releases. Prefer documented props, parts, and tokens.

If the public API cannot express your layout, [open an issue](https://github.com/eigenpal/docx-editor/issues).
