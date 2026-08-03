---
'@docx-editor.dev/react': minor
---

The editor now ships a menu bar — File, Format, Insert, Help — under the document title, alongside the toolbar. Open, Save and Page setup work with no configuration; `onOpen` and `onSave` replace them, and `menu={false}` removes the bar. Insert reaches page breaks and next-page section breaks, and Format carries the text and alignment commands with a live checked state.

Every row is a chrome slot, so it shares its label, icon, command and enabled state with the toolbar control for the same capability. Rows the engine cannot honour yet — image, table, table of contents, continuous section break — are shown and disabled rather than hidden, with the reason on the row.

Compose a different bar with `DocxEditor.Menu` and its parts (`.File`, `.Insert`, `.Item`, `.Row`, `.Submenu`, `.TableGrid`, …), which replace a menu or a row in place. `menu` also accepts the menu's props directly, so a single row can be redirected without giving up the bar: `menu={{ reportIssue: false }}` drops Help's report-an-issue row, `menu={{ onReportIssue }}` points it at your own support channel, and `menu={{ onPageSetup }}` swaps the dialog.

Ctrl/Cmd+S and Ctrl/Cmd+O are bound, scoped to the editor the user is in — an editor embedded in a larger page leaves the host's own shortcuts alone. The bar is one tab stop with full arrow-key navigation, focus returns to the trigger on close, and refused rows stay focusable so their reason is announced rather than hidden in a tooltip.

Chrome is composable down to a single row. A row child replaces the row it names and leaves the rest of the packaged menu tracking the registry; `preset={false}` states the order yourself. `DocxEditor.Menu.Menu` takes any id, so a product can add a menu of its own beside File/Format/Insert/Help. `DocxEditor.Toolbar.Action` is the toolbar's twin of `Menu.Row` — a host-owned action with the packaged styling and caret handling, and no chrome slot to fake.

The download name is hardened against a hostile document title: bidi overrides (the `Invoice<RLO>fdp.exe` spoof), zero-width and control characters, Windows reserved device names, dot-only and leading-dot names, and truncation that counts UTF-8 bytes without splitting a character. Help's report-an-issue link no longer sends the page's query string or fragment, only the origin and path — the editor runs inside other people's products, and that URL goes to a public tracker.
