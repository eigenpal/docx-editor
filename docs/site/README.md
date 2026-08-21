# docs/site — source of truth for docx-editor.dev docs

The MDX in `content/` is the **1.x prose documentation** rendered at
https://www.docx-editor.dev/docs/1.x (alias `/docs/latest`). The website repo
(`docx-editor-page`) syncs this tree at build time via its
`scripts/sync-1x-api-docs.mjs`, the same pipeline that consumes `docs/json/`
for the auto-generated API reference. Docs ship when the site bumps its
upstream pin — i.e. docs are release-coupled, edit them in the same PR as the
feature they describe.

## Layout

- `content/<slug>.mdx` → `https://www.docx-editor.dev/docs/1.x/<slug>`
- `content/<dir>/index.mdx` → `/docs/1.x/<dir>`
- `content/**/meta.json` — Fumadocs sidebar ordering/grouping
  (`pages` array; `---Label---` entries are group separators)

There is **no version prefix** here; the site mounts this tree at `1.x/`.

## Frontmatter (required)

```yaml
---
title: 'Installation' # ≤60 chars, no brand suffix (site appends "| DOCX Editor")
description: 'Install the 1.x…' # 140–160 chars, written for the SERP snippet
category: 'Getting Started' # shown as a badge + used to group llms.txt
---
```

`order` is a legacy field still honored for llms.txt grouping order; new pages
can omit it (sidebar order comes from meta.json).

`seoTitle` (optional) is the long search-oriented title used for the HTML
`<title>`/OG tags; keep `title` short and developer-focused (it is the H1 and
the sidebar label).

## Available MDX components

The site injects these — use them without imports, and don't invent new ones
(the sync validates against this whitelist):

`FrameworkTabs`, `Framework`, `DemoPlayground`, `ReadOnlyDemo`, `ModeToggleDemo`,
`ToolbarCustomDemo`, `AuthorDemo`, `UIControlsDemo`, `AgentChatDemo`,
`ToolbarLayoutDiagram`, `DualRenderingDiagram`, `DataFlowDiagram`,
`PluginHostDiagram`, `PluginLifecycleDiagram`, `PackageStats`, `FeatureMatrix`,
`FeatureSummary`, `FeatureBadge`,
plus the Fumadocs defaults (`Callout`, `Cards`/`Card`, `Tabs`, `Steps`, …).

### Framework switch

A page that shows the same example in both adapters wraps the two versions in
`FrameworkTabs`, React first:

````mdx
<FrameworkTabs>
<Framework value="react">

```tsx
<DocxEditor document={bytes} />
```

</Framework>
<Framework value="vue">

```vue
<DocxEditor :document="bytes" />
```

</Framework>
</FrameworkTabs>
````

Blank lines around the fences are required, or MDX treats the block as JSX. A
`Framework` panel can hold prose and tables too, not only code.

The switch sits in the code block's top-right corner, beside the copy button.
When a panel opens with something other than a code block — a table, or a
paragraph — pass `variant="block"` to give the switch its own right-aligned row
instead, so it does not sit on top of the content:

```mdx
<FrameworkTabs variant="block">
```

Prefer moving a lead-in sentence below its snippet over reaching for
`variant="block"`: a panel that opens with its code block keeps the switch
anchored where readers expect it.

One choice serves the whole site: the reader's pick is shared by every switch on
the page and stored in `localStorage`, so it survives navigation and matches the
switch on the marketing pages. Both panels render, and the inactive one is
hidden, so crawlers and `llms.md` still get both versions.

Use the switch only when both versions exist. Never leave a reader on an empty
tab: write the second version, or drop the switch and say which adapter the page
covers.

`FeatureMatrix`/`FeatureSummary`/`FeatureBadge` render `data/word-features.ts`
(also synced by the site). Update that data file when feature status changes;
never hand-write support claims in prose.

## Conventions

Write instructions, not essays. Lead with what the reader does; state facts
flat (sentence or table); no conceptual framing headings ("The trust
model"), no enumerated abstractions ("Two corollaries"), no aphorisms.
Shorter is better.

- Links between docs pages are root-relative with the version prefix:
  `[props](/docs/1.x/react/props)`.
- Every page ends with a short "Next steps" / "See also" section.
- Keep keywords ("DOCX editor", "tracked changes", "OOXML", "AI redlining")
  in titles/descriptions where they're honest.
