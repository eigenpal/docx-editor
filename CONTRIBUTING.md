# Contributing to docx-editor.dev

This guide covers setup, tests, and pull requests for the monorepo.

## Prerequisites

- [Bun](https://bun.sh/) 1.3.11, the release workflow version.
- [Node.js](https://nodejs.org/) 24, the CI and release workflow version.

These versions apply to repository development. Published packages declare their supported Node.js versions in their `engines` fields.

## Development setup

Clone the repository, install dependencies, and start the development server:

```bash
# Clone the repo
git clone https://github.com/eigenpal/docx-editor.git
cd docx-editor

# Install dependencies
bun install

# Start the dev server
bun run dev
# Open http://localhost:5173
```

If you work on parsing, serialization, or layout, run `bun run reference:fetch` to download the ECMA-376 reference files. The download includes about 58 MB of PDFs and ZIP archives. Git ignores these files. The repository includes reference summaries and XML schemas under `reference/`.

## Demo deployment builds

`bun run build:preview` bundles all four demos directly from workspace source, assembles `examples/parity/dist`, and checks its assets and routing. It needs no package build first: deployments skip the publishable JavaScript bundles and TypeScript declarations. CI's browser lane runs this same command on a clean checkout; the build and typecheck lanes verify package artifacts and types separately.

Vercel runs `bun run build:preview` for both production and preview deployments. `bun run build` retains the full package-backed demo build for local verification. Vercel runs `bun install --frozen-lockfile` with Git hooks disabled, preserving restored dependencies between deployments.

## Run tests

Run one test file during development:

```bash
bun test path/to/test.ts
```

Before submission, run the checks in [Make changes](#make-changes).

## Code style

The project uses ESLint and Prettier. Pre-commit hooks run both checks.

```bash
# Manual lint/format
bun run lint:fix
bun run format
```

The pre-commit hook formats and lints staged files, then runs the full typecheck, parity, license, API, formatting, and lint checks. It prints the duration of each step. Local commits use TypeScript's incremental build information and content-based ESLint and Prettier caches; CI runs the uncached package commands. The first commit after creating or clearing these caches takes longer.

ESLint and Prettier caches live under the root `node_modules/.cache/precommit/`. TypeScript writes build information under each workspace's `node_modules/.cache/precommit/`, outside the source and license scans. To diagnose a suspected stale cache, run `bun run typecheck`, `bun run lint`, or `bun run format:check` without the hook's cache flags.

## Contributor license agreement

You must sign the [Contributor License Agreement](CLA.md). The CLA assistant adds signing instructions to your first pull request.

## Make changes

1. Fork the repository and create a branch from `main`.
2. Read the [engine architecture](docs/architecture/production-engine-packages.md).
3. Keep each change focused.
4. Add or update package tests.
5. Verify the change:
   ```bash
   bun run typecheck
   bun run lint
   bun run format:check
   bun run test
   bun run check:parity
   bun run api:check
   bun run i18n:validate
   ```
6. Add a changeset for code changes with `bun changeset`. Documentation, test, and CI-only changes do not need one.
7. Submit a pull request against `main`.

## Architecture overview

The canonical OOXML tree is the only editing state. Layout reads that tree and produces painted pages.

The painted pages are the editable surface. Browser mutations become tree operations instead of document markup.

ProseMirror is a projection inside `packages/core/src/binding/`. It never reconstructs the canonical tree.

See the [engine architecture](docs/architecture/production-engine-packages.md) and [public architecture guide](docs/site/content/core/architecture.mdx).

## Write documentation

Follow the [Google developer documentation style guide](https://developers.google.com/style/highlights) for READMEs, guides, developer docs, feature descriptions, and release notes. Lead with the task or behavior. Use active voice, sentence-case headings, and short paragraphs. Keep identifiers exact and format them as code. Use descriptive link text that names the destination. Name the operation that fails and explain how to recover. Keep prerequisites, defaults, units, and limits close to their examples. Link to detailed guides instead of repeating them in overviews. Keep implementation history in design and review records.

Before submitting, check examples against the public API, review links, and remove repeated explanations. For MDX, follow [Site documentation source](docs/site/README.md) and run the documentation checks:

```bash
bun run check:docs-mdx
bun run check:docs-chrome-slots
bun run check:docs-vue-refs
bun run check:public-docs-surface
bun run check:example-readmes
```

## Public API surface

Every published package's `@public` exports are locked in `docs/api/<pkg-slug>/<entry>.api.md` snapshots generated by API Extractor. CI runs `bun run api:check` and fails on undocumented drift.

If you change a `@public` symbol — or add a new one — regenerate and commit the snapshot:

```bash
bun run --filter '@docx-editor.dev/<pkg>' build
bun run api:extract
git add docs/api/<pkg-slug>/
```

The CI error names the source file for each changed entry. For more information, see [Public API](CLAUDE.md#public-api).

If you add a `DocxEditorProps` field or `DocxEditorRef` method, update `scripts/parity/parity.contract.json`. The contract records shared, Vue-deferred, and Vue-exclusive members. Run `bun run check:parity-contract` to check the change.

If you add a Vue composable, declare a `Use<Name>Return` interface and annotate its return type. This prevents internal engine types from expanding into the public snapshot.

If you add a published package, register it in `scripts/lib/packages.mjs`. Include its name, root, slug, TypeScript configuration, and build hint. Add `api:extract` and `api:check` scripts to the package. Delegate them to `../../scripts/api-extractor.mjs --package <name>`, with `--local` for extraction. Run `bun run api:extract` and `bun run docs:json` to generate the outputs.

### Generate JSON documentation

Run `bun run docs:json` to generate JSON from the public API. It writes one `docs/json/<pkg-slug>/<subpath>.json` file per published subpath and a root index.

Git ignores these files. Documentation sites clone the repository and run the generator during their builds. CI runs the same command to detect generation failures.

## Adapter parity

The editor ships React and Vue adapters. Both use `@docx-editor.dev/core` for document state, input, layout, paint, and serialization.

Put platform-neutral logic in core. Keep adapters limited to framework components, hooks, composables, and lifecycle integration.

Use `bun run check:parity` for adapter contract and surface parity. These checks do not establish browser behavior parity.

## Report bugs

Open a [GitHub issue](https://github.com/eigenpal/docx-editor/issues) with:

- Steps to reproduce.
- Expected and actual behavior.
- A sanitized `.docx` file, when relevant.

Every issue needs a `Bug`, `Feature`, or `Task` type. Maintainers also assign one `area:*` label and one `priority:*` label.

## License

By contributing, you agree that your contributions are licensed under [Apache 2.0](LICENSE), except contributions to `packages/editor-api/` and `packages/pro/`, which are licensed under the EigenPal Pro License.

## Collaboration compatibility

After 2.18, changes to shared document behavior need an explicit compatibility assessment. Run `bun run collaboration:change`, then follow the [collaboration compatibility policy](docs/architecture/collaboration-compatibility.md). The policy covers version decisions, published-release tests, migration rehearsal, and release checks. Public document APIs must retain the Office.js contract.
