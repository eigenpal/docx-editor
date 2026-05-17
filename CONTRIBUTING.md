# Contributing to @eigenpal/docx-editor-react

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- [Node.js](https://nodejs.org/) (v18+)

## Development Setup

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

## Running Tests

```bash
# Type checking (fast, run often)
bun run typecheck

# Unit tests
bun test

# E2E tests (requires Playwright browsers)
npx playwright install --with-deps chromium
npx playwright test --timeout=30000 --workers=4

# Single test file
npx playwright test tests/formatting.spec.ts --timeout=30000
```

## Code Style

The project uses ESLint and Prettier with pre-commit hooks (Husky + lint-staged), so formatting is handled automatically on commit.

```bash
# Manual lint/format
bun run lint:fix
bun run format
```

## Contributor License Agreement

Contributors are required to sign our [Contributor License Agreement](CLA.md). The CLA assistant will leave a comment on your first pull request with signing instructions — one short comment, about 30 seconds. That signature covers all of your future contributions.

## Making Changes

1. **Fork** the repository and create a branch from `main`
2. **Read the code** before modifying it — understand the dual rendering system (see [Architecture](docs/ARCHITECTURE.md))
3. **Make your changes** — keep them focused and minimal
4. **Add/update tests** for your changes (see `e2e/` for E2E tests)
5. **Verify** everything works:
   ```bash
   bun run typecheck && bun test && bun run build:packages
   ```
6. **Submit a PR** against `main` — the CLA bot will prompt you on your first one

## Architecture Overview

The editor has two rendering systems:

- **Hidden ProseMirror** — the real editing state (selection, undo/redo, keyboard input)
- **Visible Pages** (layout-painter) — what the user sees, rebuilt from PM state on every change

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture, and [docs/EXTENSIONS.md](docs/EXTENSIONS.md) for the extension system.

## Adapter Parity

The editor ships first-party adapters for React (`packages/react`) and Vue (`packages/vue`). Both share `@eigenpal/docx-editor-core`, which owns the parser, ProseMirror schema, layout engine, layout bridge (page mapping, footnote convergence, header/footer measurement), and serializer. Adapters only own their framework-specific shell, components, and lifecycle wiring.

**When you touch layout, parsing, or rendering logic, put it in core, not in an adapter.** If you copy a 30-line helper from React to Vue, you've created a divergence trap. The footnote convergence loop (`stabilizeFootnoteLayout` in `packages/core/src/layout-bridge/footnoteLayout.ts`) is the canonical example: one helper, both adapters call it.

Parity smoke tests live under `e2e/tests/parity/smoke/` and run each spec against both demos. Add one when you fix a bug that could plausibly affect rendering on either side.

## Reporting Bugs

Open an issue at [github.com/eigenpal/docx-editor/issues](https://github.com/eigenpal/docx-editor/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- Attach a `.docx` file if relevant (remove sensitive content first)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
