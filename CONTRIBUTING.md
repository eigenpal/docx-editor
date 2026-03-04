# Contributing to @eigenpal/docx-js-editor

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- [Node.js](https://nodejs.org/) (v18+)

## Development Setup

```bash
# Clone the repo
git clone https://github.com/eigenpal/docx-js-editor.git
cd docx-js-editor

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

## Making Changes

1. **Fork** the repository and create a branch from `main`
2. **Read the code** before modifying it — understand the dual rendering system (see [Architecture](docs/ARCHITECTURE.md))
3. **Make your changes** — keep them focused and minimal
4. **Add/update tests** for your changes (see `e2e/` for E2E tests)
5. **Verify** everything works:
   ```bash
   bun run typecheck && bun test && bun run build
   ```
6. **Submit a PR** against `main`

## Architecture Overview

The editor has two rendering systems:

- **Hidden ProseMirror** — the real editing state (selection, undo/redo, keyboard input)
- **Visible Pages** (layout-painter) — what the user sees, rebuilt from PM state on every change

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture, and [docs/EXTENSIONS.md](docs/EXTENSIONS.md) for the extension system.

## Reporting Bugs

Open an issue at [github.com/eigenpal/docx-js-editor/issues](https://github.com/eigenpal/docx-js-editor/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- Attach a `.docx` file if relevant (remove sensitive content first)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
