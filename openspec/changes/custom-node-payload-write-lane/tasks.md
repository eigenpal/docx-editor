# Tasks

## 1. The operation

- [ ] 1.1 `insertCustomNode` in `core/automation/operations.ts`: span or position, tag, text, and an optional payload (`namespaceUri`, `rootLocalName`, `nodeId`, `label`, `data`). Add to the mutation list, not the query list.
- [ ] 1.2 Plan it in `core/automation/plan.ts` as ONE transaction: `withCustomXmlDataPart` → `withCustomXmlNode` → the `w:sdt` with `w:dataBinding`. Partial application is the failure this must not have — a control bound to a store that was never written is a document Word repairs.
- [ ] 1.3 `w:dataBinding` goes after `w:lock` and before `w:label` in the `CT_SdtPr` sequence. Out of order, Word refuses the document rather than ignoring the element. Assert the order in a test, not only in a comment.
- [ ] 1.4 Refuse, with a typed reason, when: the id is not addressable by an XPath, the payload fails its schema, the payload exceeds the cap, or the store cannot be authored. `{ ok: false, reason }`, never a silent no-op.
- [ ] 1.5 Re-assert `xml:space="preserve"` on a label with leading or trailing space. Word drops it when the text has neither, so it cannot be relied on to survive.

## 2. Pro

- [ ] 2.1 `insertCustomNode(editor, def, attrs, text, { data })` calls the operation. `data` is validated through `def.schema` first, and a failure is returned rather than written.
- [ ] 2.2 `updateCustomNode` writes the payload in the same transaction as the label, so an update cannot leave the two disagreeing.
- [ ] 2.3 `customNodeXml` gains a payload result: the `w:sdt` markup AND the store parts a caller must add, since a template engine can splice markup but cannot author a package.
- [ ] 2.4 Recognition resolves the bound node and hands typed `data` to `fromDocx` and `reviewCard`. An unresolvable binding recognizes as a chip with no payload rather than not at all.
- [ ] 2.5 A payload that fails its schema is reported through the module's diagnostics and the node still renders. A chip that vanishes because one field was wrong is worse than a chip with no data.

## 3. Lifecycle

- [ ] 3.1 Deleting a control removes its bound node in the same transaction.
- [ ] 3.2 The orphan sweep runs on open, over the ids the story binds. NOT on save: a chip cut to the clipboard and not yet pasted would lose its payload between the two.
- [ ] 3.3 `preserveOnExport` on save: `'text'` unwraps the control and drops the tag, binding and node; `false` removes the node with its content; `true` is untouched.
- [ ] 3.4 Export leaves no `customXml/` folder, no relationship and no Override when the last node for a namespace goes.

## 4. Demos

- [ ] 4.1 Vite: `DEMO_CITATION` gains a zod schema (`sourceId`, `locator`, `authors`, `year`, optional `url`); the dialog gains the fields; only `sourceId` stays in the tag.
- [ ] 4.2 Igloo: `depth` moves out of the tag into the payload.
- [ ] 4.3 One demo shows `preserveOnExport`, since the difference is only visible in a downloaded file.
- [ ] 4.4 The URL renders as a badge thumbnail that does NOT auto-load: host placeholder, explicit user action, remembered per document, and every URL through `sanitizeHref` first.

## 5. Gaps inherited from PR #178

- [x] 5.1 The item id no longer collides across two documents made from one template: the seed reads `docProps/core.xml` and `word/settings.xml` alongside the body, which diverge as soon as either document is edited. Two byte-identical packages still seed identically, which is correct — they are the same document.
- [ ] 5.2 Three guard tests in `custom-xml-part.test.ts` pass on fixture data and would survive their guards being deleted. They need crafted packages.
- [ ] 5.3 `withoutPart` and `withRelationshipsPartFor` have no direct tests.
