## ADDED Requirements

### Requirement: Separate BSL-1.1 licensed package

The package SHALL be published as `@eigenpal/docx-editor-agents` on public npm under BSL-1.1. SHALL declare `@eigenpal/docx-core` as a peer dependency. SHALL include a `LICENSE` file with BSL-1.1 terms (licensor: EigenPal, change date: 4 years, change license: MIT, additional use grant: non-production permitted).

#### Scenario: Install and import

- **WHEN** `npm install @eigenpal/docx-editor-agents` is run and the package is imported in Node.js
- **THEN** `DocxReviewer` is available and functional without DOM or React

### Requirement: Package in monorepo

The package SHALL live at `packages/agent-use/` with its own `package.json`, `tsconfig.json`, `tsup.config.ts`. Build SHALL produce ESM + CJS + type declarations in `dist/`.

#### Scenario: Build

- **WHEN** `bun run build` is run in `packages/agent-use/`
- **THEN** `dist/` contains `.js`, `.cjs`, and `.d.ts` files

### Requirement: Public API exports

The main entry point SHALL export: `DocxReviewer` class, all types (`ReviewChange`, `ReviewComment`, `ContentBlock`, `BatchResult`, etc.), and all error classes (`TextNotFoundError`, `ChangeNotFoundError`, `CommentNotFoundError`).

#### Scenario: Type imports

- **WHEN** `import { ReviewChange, ContentBlock } from '@eigenpal/docx-editor-agents'` is used
- **THEN** types are available for type-checking

### Requirement: Optional bridge export for client-side

The package SHALL provide `@eigenpal/docx-editor-agents/bridge` as a separate entry point for React editor integration. The main entry point SHALL NOT import React or DOM code.

#### Scenario: Bridge import

- **WHEN** `import { createReviewBridge } from '@eigenpal/docx-editor-agents/bridge'` is used in a React app
- **THEN** bridge functions are available to connect to a `DocxEditorHandle` ref
