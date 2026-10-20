# Site documentation source

The website renders the MDX files in `content/` as the [2.x documentation](https://www.docx-editor.dev/docs/2.x). The website repository syncs this directory at build time.

The same process consumes `docs/json/` for generated API reference pages. Update these docs in the pull request that changes a user-facing feature.

## Layout

- `content/<slug>.mdx` → `https://www.docx-editor.dev/docs/2.x/<slug>`
- `content/<dir>/index.mdx` → `/docs/2.x/<dir>`
- `content/**/meta.json` — Fumadocs sidebar order and groups (`pages` array; `---Label---` entries are group separators)

There is no version prefix in this directory. The site mounts this tree at `2.x/`.

## Required frontmatter

```yaml
---
title: 'Installation' # Up to 60 characters; the site appends the brand.
description: 'Install the DOCX editor in React or Vue.' # Summarize the page for search results.
category: 'Getting started' # Badge text and llms.txt group.
---
```

`order` controls legacy `llms.txt` group ordering. You can omit it when creating a page. Set sidebar order in `meta.json`.

`seoTitle` (optional) is the long search-oriented title used for the HTML `<title>`/OG tags; keep `title` short and developer-focused (it is the H1 and the sidebar label).

## Available MDX components

The site provides these components without imports. The sync validates component names against this allowlist:

`FrameworkTabs`, `Framework`, `DemoPlayground`, `ReadOnlyDemo`, `ModeToggleDemo`, `ToolbarCustomDemo`, `DocumentRefreshDemo`, `DocumentNavigationDemo`, `AuthorDemo`, `UIControlsDemo`, `AgentChatDemo`, `ToolbarLayoutDiagram`, `DualRenderingDiagram`, `DataFlowDiagram`, `PluginHostDiagram`, `PluginLifecycleDiagram`, `PackageStats`, `FeatureMatrix`, `FeatureSummary`, `FeatureBadge`, plus the Fumadocs defaults (`Callout`, `Cards`/`Card`, `Tabs`, `Steps`, …).

### Framework switch

A page that shows the same example in both adapters wraps the two versions in `FrameworkTabs`, React first:

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

Blank lines around the fences are required, or MDX treats the block as JSX. A `Framework` panel can hold prose and tables too, not only code.

The switch shares a row with the code block's copy button. If a panel starts with prose or a table, pass `variant="block"` to give the switch a separate row:

```mdx
<FrameworkTabs variant="block">
```

Introduce code samples before `FrameworkTabs`. If each framework needs a separate introduction, keep it inside its panel and use `variant="block"`.

The site stores the framework choice in `localStorage` and shares it across switches and pages. Both panels render, but the inactive panel stays hidden. Crawlers and `llms.md` receive both versions.

Use the switch only when both versions exist. Write both versions, or omit the switch and identify the adapter that the page covers.

`FeatureMatrix`/`FeatureSummary`/`FeatureBadge` render `data/word-features.ts` (also synced by the site). Update that data file when feature status changes; never hand-write support claims in prose.

## Conventions

Follow the [Google developer documentation style guide](https://developers.google.com/style/highlights). Lead with the task or behavior. Use active voice, address the reader as "you," and use sentence case for headings. Keep paragraphs short and remove repeated explanations. Format identifiers as code and UI labels in bold.

Check feature claims and examples against the public API. State prerequisites, defaults, and limits where readers need them. Link to detailed references instead of repeating them in overview pages.

- Links between docs pages are root-relative with the version prefix: `[React props](/docs/2.x/react/props)`.
- End each page with a short "Next steps" or "See also" section.
- Register each page in the root `content/meta.json` and its folder's `meta.json`. Use full paths in the root file.
- Introduce each code sample. Use comments to mark omitted code, and keep examples consistent with the public API.
- Use Mermaid for diagrams. Add alt text to images and descriptive text to links.
- Keep keywords ("DOCX editor", "tracked changes", "OOXML", "AI redlining") in titles/descriptions where they're honest.

## Validate changes

Run the documentation checks from the repository root:

```bash
bun run check:docs-mdx
bun run check:docs-vue-refs
bun run check:docs-chrome-slots
bun run check:public-docs-surface
```

Check internal links and both navigation files when adding or moving a page. Format edited MDX files with the repository's Prettier configuration.

The website application lives in a separate repository. These checks validate source conventions and documented API names; they do not build or render the website.
