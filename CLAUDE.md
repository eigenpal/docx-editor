# docx-editor.dev

WYSIWYG editor and rendering engine for DOCX. Output must look identical to MS
Word: preserve fonts, theme colors, styles, tables, headers/footers, section
layout.

## Repo topology

This repo is **contracts + adapters**, not the engine implementation.

- `packages/core` is `@docx-editor.dev/core-contract`: declarations only,
  `"private": true`, never published. Six entries (`.`, `./editor`,
  `./geometry`, `./plugin`, `./mcp`, `./types`). See
  `openspec/changes/document-engine/`. Its nested `spike/` directory temporarily
  holds disposable POC evidence and is excluded from exports and the core
  TypeScript project; production modules must not import it.
- The **real engine is to be implemented.** It ships as `@docx-editor.dev/core`
  and is **consumed from npm** by the adapters; its source is not in this tree.
  There is no `painter-model`, `flow-model`, `pagination-model`, or `prosemirror`
  directory here. The architecture below is the target being built, not code that
  exists in this repo yet.
- Adapters: `packages/react`, `packages/vue`, `packages/nuxt`. Plus
  `packages/agents` (headless/agent bridge) and `packages/i18n` (strings).
- Published packages: `@docx-editor.dev/{react,vue,nuxt,agents,i18n}` and the
  npm `core`. The in-repo `core-contract` is private.

The next-generation engine is being designed greenfield. **The evidence source
is the completed disposable POC in `openspec/changes/engine-core-spike/`; the
production design and conformance source of truth is
`openspec/changes/document-engine/`, including
`spike-architecture-decision.md`, not this file.** This file is the operational
contract for working in the repo.

`openspec/changes/engine-spine-tier2/` remains a current-stack delivery change.
Its `DocxEditorEngine` orchestration name is not the greenfield public object
model and is non-authoritative for the target. Do not absorb or delete that
change during greenfield consolidation. Future `EditorHost` contracts MUST NOT
expose ProseMirror types or view access; all such mapping belongs to
`EditorBinding`.

## Engine architecture (target)

Defined by the production authority above and informed by the completed spike
evidence; do not restate their detail here. The five-milestone
`engine-core-spike` KISS browser POC is complete and its accepted decisions are
consolidated in the production ADR. Production work proceeds only through
`document-engine` task sequencing and MUST reimplement accepted contracts
without importing spike modules. Package, store, binding, layout, output,
security, and performance acceptance remain gated by `document-engine`
conformance. `document-engine` owns the lossless package model,
semantic store, editor binding, layout/output, `DocxEditor.*` object model,
extension/runtime ports, addressable sync, server/language bindings, durable
annotations, and performance/conformance contracts.

The pipeline, one line: `bounded OPC/XML parse -> capability parse ->
DocumentStore(model) -> { ProseMirror projection · layout: measure -> paginate ->
resolve -> emit -> DisplayItem[] -> RenderBackend }`.

Load-bearing rules the changes commit to:

- **Model-canonical, one source of truth.** `store.model` is always current and
  canonical authored OPC/OOXML package state; `store.apply(op)` is the only
  mutation path. Resolved caches retain revision provenance and reuse only by
  unchanged dependency/input fingerprints and operation environment. ProseMirror
  and the display list are projections; CRDT details stay behind the
  `ReplicatedStoreBackend`.
- **ProseMirror is the editing engine but never canonical.** It processes
  keystrokes and produces transactions; `EditorBinding` maps each transaction to
  `DocOp`s applied to the store, and maps an inbound `ModelChange` back into the
  `EditorState`. Layout reads `store.model`, never the `EditorView` or DOM. A
  server agent mutates the same store with no view at all.
- **Four distinct contracts.** `DocOp` is the semantic mutation vocabulary,
  `ModelChange` is the committed notification, replication updates are opaque
  backend bytes, and snapshots are full encoded state.
- **`DocxEditor.*` is the only public object-model namespace.** It exposes
  familiar Office JavaScript-style `run`/`RequestContext`/`load`/`sync` semantics
  as a lazy facade over the authored model in browser, worker, and server
  runtimes.
- **One positioned IR, many backends.** DOM, PDF, print, and hit-test all consume
  `DisplayItem[]`; no backend re-derives geometry or interprets CSS.

## Verify

```bash
bun run typecheck
bun test                  # Package and unit tests
bun run test:spike
bun run typecheck:spike
bun run check:parity      # export + editor-contract + docs-surface + parity-contract + adapter-css
bun run api:check         # API Extractor snapshot drift
bun run i18n:validate
```

- Browser E2E returns only after the public `EditorDriver` boundary exists.
- `bun run format` before pushing.

## React/Vue parity

Layout, measurement, and paint behavior MUST land in both adapters in the same
PR. The Vue counterpart of the React host is
`packages/vue/src/composables/useDocxEditor.ts`. Platform-agnostic logic belongs
in `core`, called by both adapters, not duplicated. Adapter-only glue
(React hook ergonomics, Vue composition API, demo apps) may diverge.

`scripts/parity/parity.contract.json` enumerates paired
`DocxEditorProps`/`DocxEditorRef` members; CI runs `bun run
check:parity-contract`. Adding an adapter prop/ref method: edit the adapter, `bun
run api:extract`, add it to the right contract bucket (`paired`,
`deferredInVue`, `pairedViaInheritance`, `vueExclusive`), rerun the check.

**UI styling is single-source-of-truth.** All editor chrome CSS + color tokens
live in the core stylesheet; both adapters only `@import` it (enforced by `bun
run check:adapter-css-thin`). Never hardcode hex/rgba in components — use the
`--doc-*` tokens or shadcn token utilities. The document canvas (rendered output)
is intentionally NOT themed — it stays Word-faithful.

## Public API surface

API Extractor snapshots live in `docs/api/<pkg-slug>/<entry>.api.md`; CI runs
`bun run api:check`. On drift: `bun run api:extract`, commit the snapshot.
Changing a `@public` symbol: tag it in TSDoc, rebuild, re-extract, commit.
`bun run docs:json` generates downstream-consumer JSON (gitignored; CI smoke).

Vue composables must declare a named `Use<Name>Return` interface and annotate the
return type, or core's internal types leak into the API Extractor snapshot.

## Security — untrusted DOCX/HTML input

**Treat every value from a DOCX, pasted HTML, or embedded part as
attacker-controlled.** A `.docx` is a zip of XML an attacker fully controls: font
names, hyperlink targets, shape attrs, image rels, run text. Sanitize at the
**bounded parse/trust boundary** (the parser-neutral XML read plus registered
capability parsing, and PM `parseDOM` where applicable), not at render time, so
every downstream runtime sink receives a sanitized projection. The authoritative
contract is `document-engine/specs/lossless-package-model/`.

When you add/touch anything that **parses or renders unknown files** (parsers,
capability parse/serialize, IR emit / painter, PM `toDOM`/`parseDOM`, clipboard,
print), audit these before merging:

- **No HTML-from-strings.** Never build DOM from file-derived values via
  `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`. Build with
  `document.createElement(NS)` + `setAttribute`/`textContent`.
- **URLs go through `sanitizeHref`** — allowlist `http(s)/mailto/tel/ftp`, drop
  `javascript:`/`data:`/`vbscript:`/`file:`, strip embedded tab/LF/CR. Apply to
  every `href`, image `hlinkHref`, and `window.open(...)` arg.
- **Escape strings interpolated into CSS** — `@font-face` family names and any
  inline `style` built from file data.
- **XML safety** — the selected parser must not resolve DTDs/external entities
  (XXE) or expand nested entities (billion-laughs); parser choice is an
  implementation detail behind the bounded trust boundary.
- **Zip safety** — decompression-ratio/size cap (zip bomb); reject part/rel/media
  paths with `..` or a leading `/` (path traversal).
- **No zero-click external fetch** — never auto-load a remote target from a file
  (external-mode image/font/link rels `TargetMode="External"`, remote `src`, CSS
  `url()`/`@import`). Fetch only same-origin/embedded parts; gate remote loads
  behind explicit user action.
- **Resource limits** — cap recursion depth (nested tables/shapes/SDT/groups) and
  element counts; never feed a file-supplied number into allocation/`.repeat()`/a
  loop bound. Avoid catastrophic-backtracking regex on file-derived strings.
- **XML injection on save** — escape every attacker-derived string written back
  into XML on serialize (`escapeXml`); never template a raw value into markup.
- **Prototype pollution** — guard `JSON.parse`-of-file-data merges and any
  XML-attribute-name -> object-key assignment against
  `__proto__`/`constructor`/`prototype`.
- **Field codes / OLE / embedded objects** — never execute or auto-resolve field
  instructions (DDE, `INCLUDE*`) or embedded OLE/macro content; render inert.

Quick audit grep for a file-handling diff:

```bash
grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|document\.write|window\.open\(|\.href\s*=|font-family:.*\$\{" packages --include="*.ts" --include="*.tsx" --include="*.vue" | grep -viE "test|\.spec\."
```

When you touch one sink, check sibling sinks so the same class isn't left open
elsewhere. `openPrintWindow` (core print util, `PrintPreview`) still builds its
popup via `document.write` with an unescaped `title`/`content` — a known sink to
harden, not a safe reference.

## i18n

`packages/i18n/en.json` is source of truth. Other locales mirror its shape with
`null` = fall back to English. Missing key = CI fails.

```ts
import { useTranslation } from '../i18n';
const { t } = useTranslation();
t('toolbar.bold');
t('dialogs.findReplace.matchCount', { current: 3, total: 15 });
```

New string: add to `en.json`, use `t('key')`, `bun run i18n:fix`. New language:
`bun run i18n:new <code>`, fill nulls, `bun run i18n:status`. Validate: `bun run
i18n:validate`. Never hardcode user-facing English in components.

## Docs site

Website docs (docx-editor.dev/docs) are authored here in `docs/site/content/`
(MDX) and synced by the site repo at build time. Feature-support claims live in
`docs/site/data/word-features.ts` (typed matrix), never hand-written in prose. A
feature PR that changes user-visible behavior updates both in the same PR.

**Nav gotcha — two meta.json files must agree.** The sidebar/overview is driven
by the `"root": true` `docs/site/content/meta.json` (full paths, e.g.
`guides/dark-mode`); each subfolder also has its own `meta.json`. A new page must
be registered in BOTH, or it is reachable by URL but missing from the sidebar.

OOXML reference: `reference/quick-ref/wordprocessingml.md`, `themes-colors.md`;
schemas in `reference/ecma-376/part1/schemas/`. PDFs are gitignored — run `bun
run reference:fetch` once when needed.

## Releasing (changesets)

Every code PR: `bun changeset` (or a correct hand-written `.changeset/*.md`),
commit it. Skip only for test/docs/CI-only PRs.

- Frontmatter package name MUST exactly match a published package and the bump
  MUST be `patch`/`minor`/`major`; a wrong name crashes the Release workflow.
  Copy the exact name from an existing `.changeset/*.md`.
- All published packages are a fixed group — declare one bump, others follow.
- Default `patch`; `minor` for additive public API; `major` for breaks.
- Summary lands verbatim in CHANGELOG: concise, consumer-facing (what changed,
  not how), `Fixes #N` at the end if relevant. No emojis, no marketing.

Don't: push the `chore: release` commit by hand; delete `.changeset/*.md` outside
`changeset version`; edit `CHANGELOG.md` or `package.json#version` by hand.

## PR style

Short factual title (conventional-commit prefix). Body is the minimum the diff
doesn't show, often one sentence. Don't `@`-mention contributors, reference
unrelated PR/issue numbers, list changed files, add tooling footers, or use
emojis.

## Bugs / dev

Issue tracker: `gh issue view <N> --repo eigenpal/docx-editor`. Dev server: `bun
run dev` -> `http://localhost:5173/`. Live demo: `http://docx-editor.dev/editor`.
Commit format: `fix: ... (fixes #N)`. Screenshots -> `screenshots/`.

## Pitfalls

- **No `require()`** — ESM only.
- **Tailwind scope** — library scoped to `.ep-root`; rendered output isn't always
  protected, so use inline styles on painted/IR-emitted elements.
- **Focus stealing** — any mousedown that bubbles to PM moves the caret;
  dropdown/dialog mousedown needs `stopPropagation()`.
- **Icons** — inline SVG (Material Symbol paths), not a font. A missing name
  renders raw text.
