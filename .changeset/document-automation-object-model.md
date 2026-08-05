---
'@docx-editor.dev/editor-api': major
---

Replace `@docx-editor.dev/agents` with `@docx-editor.dev/editor-api`. This hard package rename requires consumers to update their dependencies and imports. The renamed package is now one thing: a document automation object model for DOCX. Everything else the old package used to ship — `DocxReviewer`, the editor bridge, the 14-tool catalog, the MCP server, the AI SDK adapter, and the React and Vue chat components — is removed. See MIGRATION.md for the mapping, including the calls that have no equivalent.

The package has two entry points. `DocxEditor.createServer(bytes)` opens DOCX bytes anywhere JavaScript runs, with no DOM and no Node builtins, and saves them back. `DocxEditor.createBrowser(editor)`, from the `./browser` subpath, drives an editor a reader already has open and leaves its lifetime, undo history and caret to the editor. The same script does the same thing on either one; the differences are declared on `runtime.capabilities` rather than discovered.

Work is described against objects and nothing touches the document until `await context.sync()`, which sends one ordered batch and applies all of it or none of it. A property that was not loaded is an error to read, not a silent `undefined`. Every refusal carries a stable code, and a write decided from a document that has since moved is refused rather than applied at the wrong place.

The model reaches the body, paragraphs, ranges and search results of every story — main document, headers, footers, footnotes and endnotes — plus character and paragraph formatting, paragraph styles by their gallery name, lists and list levels, bookmarks, hyperlinks, sections and their page setup, content controls with their locks and data bindings, comment threads, and tracked changes with accept and reject. Hyperlink targets are sanitized before a relationship is written. Tables, images and shapes are not in this release; the omissions are listed in the docs rather than shipped as members that would answer values they never read.
