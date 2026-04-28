---
'@eigenpal/docx-js-editor': patch
---

Add Brazilian Portuguese (pt-BR) locale support with 100% translation coverage.

This PR introduces:

- New `packages/react/i18n/pt-BR.json` file
- 619 translated UI strings (100% coverage)
- Proper locale structure following existing patterns
- All keys in sync with en.json source

The translation covers core UI elements including:

- Common actions (cancel, save, edit, etc.)
- Toolbar and formatting controls
- Color picker and dialog interfaces
- Table operations and context menus
- Error messages and status indicators
