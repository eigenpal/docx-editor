## ADDED Requirements

### Requirement: DocxEditor.HyperLink is a styleable compound over a headless hook

The React adapter SHALL expose `DocxEditor.HyperLink`, a popover compound built on a context-backed `useHyperlinkPopup()` hook returning `{ state, open, close, copy, beginEdit, commitEdit, unlink }`. Its parts — `HyperLink.Root`, `HyperLink.Url`, `HyperLink.Copy`, `HyperLink.Edit`, `HyperLink.Unlink` — SHALL follow the toolbar customization ladder: `className`/`data-*` styling, `icon` prop, `asChild`, in-place part override (a part child replaces its slot, `hidden` removes it, `preset={false}` opts out of defaults), and raw hooks underneath. The `DocxEditor` sugar renders the preset popover by default; `hyperlinkPopup={false}` removes it; a `<DocxEditor.HyperLink>` child replaces it in place.

#### Scenario: Default popover renders the Google-Docs arrangement

- **WHEN** the popover opens on an external link with the editor editable
- **THEN** it shows the URL readout and copy, edit, and unlink actions, carrying `data-testid="hyperlink-popup"` with parts `hyperlink-popup-copy`, `hyperlink-popup-edit`, `hyperlink-popup-unlink`

#### Scenario: Consumer restyles without forking

- **WHEN** a consumer renders `<DocxEditor.HyperLink className="my-popover">` with a custom icon on `HyperLink.Copy` and `HyperLink.Unlink` hidden
- **THEN** the popover renders with the consumer's class and icon, no unlink action, and unchanged wiring

#### Scenario: Read-only mode trims actions

- **WHEN** the popover opens while the editor is read-only
- **THEN** only the URL readout and copy render; edit and unlink are absent

### Requirement: Popover behavior is anchored, dismissible, and caret-safe

The popover SHALL mount inside the viewport so it follows the page while scrolling, positioned under the clicked link fragment and clamped to the viewport horizontally. It SHALL dismiss on Escape, outside mousedown, or selection movement. Popover chrome mousedown SHALL `preventDefault()` (except in its text inputs) so opening or using it never moves the caret. Edit mode SHALL present display-text and URL inputs whose focus and typing land in the inputs.

#### Scenario: Escape and outside click dismiss

- **WHEN** the popover is open and the user presses Escape, or mousedowns on the page outside it
- **THEN** the popover closes and the caret is where the original link click placed it

#### Scenario: Edit inputs are typeable

- **WHEN** the user enters edit mode and clicks the URL input
- **THEN** the input receives focus and keystrokes land in it, not in the document

### Requirement: Popover strings and colors are tokenized; copy is localized

Every popover string SHALL come from i18n keys, every color from `--doc-*` tokens (no hardcoded hex/rgba), and copy-to-clipboard SHALL confirm through a localized message.

#### Scenario: No hardcoded chrome

- **WHEN** the popover renders in a non-English locale with the dark token set
- **THEN** its labels come from the locale file and its surfaces from token values

### Requirement: text.link wires into the chrome command table

`text.link` SHALL join `SLOT_COMMANDS` so the toolbar button and Ctrl/Cmd+K enable through `toolbarCommandState`: with a selection or caret in plain text it opens insert/edit for a new link; with the caret inside a link it opens the popover's edit mode seeded by `hyperlinkAt`.

#### Scenario: Toolbar button enables

- **WHEN** the editor has focus and a collapsed selection in editable text
- **THEN** the `text.link` control is enabled and no longer reports "not wired to an editor command"

#### Scenario: Cmd+K on an existing link seeds edit

- **WHEN** the caret sits inside `Example.com` and the user presses Ctrl/Cmd+K
- **THEN** edit mode opens pre-filled with the display text and `https://example.com`

### Requirement: Vue stays deferred without a fork

The Vue adapter SHALL NOT grow a one-off hyperlink popover in this change. Its `text.link` slot SHALL keep rendering disabled with the engine's reason until the Vue provider/hooks twin lands.

#### Scenario: Vue toolbar slot stays honest

- **WHEN** the Vue demo renders its toolbar after this change
- **THEN** the link control is disabled with the not-wired reason, and no Vue popover code exists in the package
