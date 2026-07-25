# M6D.1 — default comprehensive fixture (React)

The bare React demo URL `/` now loads the canonical
`e2e/fixtures/comprehensive-word-element-test.docx` through the production
`packages/react/src/DocxEditor.tsx` surface. `?fixture=` still overrides it.

## What it replaced, and why that mattered

The default was `editable-sample.docx` — a **953-byte** stub of three plain paragraphs.
Every visual and interaction claim in this change up to now was therefore measured
against a document containing none of the structures the product exists to handle: no
tables, no SDTs, no images, no fields, no sections, no styles worth the name.

The comprehensive fixture is **34,523 bytes** and paginates to **9 pages**.

## One byte source, not a second copy

`examples/vite/vite.config.ts` gains a small plugin that maps
`/comprehensive-word-element-test.docx` onto `e2e/fixtures/` at request time in dev, and
emits the same file into the build output. Copying the DOCX into
`examples/vite/public/` would have created a second artifact that silently drifts from
the fixture the e2e suite asserts against — the task explicitly calls for an asset
mapping or an automated byte-identical copy instead.

The gate asserts byte identity rather than trusting it: `servedBytes.equals(canonical)`.
A same-length divergent copy is exactly the failure a checked-in duplicate produces, so
comparing sizes would not be enough.

## Verification

`bun run test:e2e:react-default-fixture` — **3 passed**:

| Assertion | Result |
| --- | --- |
| Served bytes are byte-identical to `e2e/fixtures/…` | pass (34,523 bytes) |
| Bare `/`, no query parameters, renders **9** pages | pass |
| Rendered text contains `COMPREHENSIVE WORD ELEMENT TEST DOCUMENT` | pass |
| `?fixture=editable-sample.docx` still overrides to 1 page | pass |

The override assertion is what proves the new value is a default rather than a hardcode.

Measured in Chromium at 1440x900 via the production adapter: 9 pages, document title
text present, `getDocumentHandle().revision === 0` on load.

## Scope boundary — editability is NOT part of this task

The comprehensive fixture opens **read-only**, reported as
`Read-only (contains tables/SDTs)`. That is correct behavior for the code as it stands
and is deliberately NOT fixed here: `openDocxSession` derives one document-wide
`editable` flag from `diagnoseBodyPatchability`, so a single table anywhere makes the
whole body immutable.

Per-block partial editability — safe preserved paragraphs editable beside immutable
tables, SDTs, unsafe paragraphs, and images — is task **M6P.1**, which follows this one
and has its own design and spec under `openspec/changes/partial-body-editability/`.
M6D.1 claims fixture wiring only: the right document loads, from one byte source, at the
default route.

## Not claimed

No editing capability, no visual parity (that is M6V.1), and no widening of the
`interactive-paginated` claim, which remains task 8.10.
