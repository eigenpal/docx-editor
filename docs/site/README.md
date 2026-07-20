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

`DemoPlayground`, `ReadOnlyDemo`, `ModeToggleDemo`, `ToolbarCustomDemo`,
`AuthorDemo`, `UIControlsDemo`, `AgentChatDemo`, `ToolbarLayoutDiagram`,
`DualRenderingDiagram`, `DataFlowDiagram`, `PluginHostDiagram`,
`PluginLifecycleDiagram`, `PackageStats`, `FeatureMatrix`, `FeatureSummary`,
`FeatureBadge`,
plus the Fumadocs defaults (`Callout`, `Cards`/`Card`, `Tabs`, `Steps`, …).

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
