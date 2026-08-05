# Pro package: review module + custom nodes

## Why

The editor needs a commercial tier to fund development. Comments/tracked changes and integrator-defined custom nodes are the two features with real willingness-to-pay, and nothing is published to npm yet, so the free/pro line can be drawn now without a breaking migration. The Apache-2.0 license on existing packages means paid code cannot be flag-gated inside them — it must live in a separately licensed package.

## What Changes

- New `packages/pro` → `@docx-editor.dev/pro`, published on public npm under a commercial license (`SEE LICENSE IN LICENSE.md`), versioned in the fixed changeset group.
- Core (`@docx-editor.dev/core-contract`, Apache-2.0) gains a narrow, purpose-built `EditorModule` seam on `createDocxEditor({ modules })` — not a general plugin system. Core also gains a cheap `hasReviewContent` derived read (the free-tier upsell hook).
- **Review module (pro)**: revision display modes beyond final-state (markup/original), review model derivation (lifted `review-model.ts` + `comment-anchors.ts`), accept/reject/reply/add-comment/toggle-track-changes commands, and the React review pane (`DocxEditorReview.tsx`, `useReview.ts`).
- **Custom nodes (pro)**: `defineCustomNode` — integrator-defined inline nodes anchored on run-level SDTs with `w:tag` identity (`sdtLocked` by default), tag-prefix `fromDocx` recognition and `toDocx` serialization, framework-neutral `render` (DOM element + measurable extent for `TextMeasurer`) with React portal sugar, atomic UTF-16 offset semantics, hover/interaction hooks.
- **Free tier behavior**: lossless round-trip of revisions/comments/SDTs is unchanged; rendering is locked to final-state projection; review chrome slots render disabled with a `pro` reason; unrecognized or unlicensed SDTs render their literal content.
- License-key validation at module construction; missing/invalid key degrades to a console warning plus an "unlicensed" banner in pro chrome (no crippling, no network call).
- Review code physically moves out of Apache-licensed packages (core layout/editor exec, React adapter) into `packages/pro`.

## Capabilities

### New Capabilities

- `editor-module-seam`: the `EditorModule` registration contract on `createDocxEditor` — module shape, display-mode gating, command/chrome contribution points, `hasReviewContent`, and free-tier fallback behavior when no module is registered.
- `pro-review-module`: review functionality delivered as a pro module — markup/original display modes, review item derivation, revision/comment commands, React review pane.
- `pro-custom-nodes`: `defineCustomNode` contract — SDT anchoring, tag identity and attrs, parse/serialize hooks, render + measurement contract, atomicity/selection semantics, interaction hooks, Word interop guarantees.
- `pro-licensing`: package licensing and key validation — commercial license file, key format/verification, unlicensed degradation, no telemetry/network requirement.

### Modified Capabilities

- `core-comment-ops`: comment and tracked-change write operations are no longer a free-core export; they are contributed by the pro review module through the `EditorModule` seam. Core retains lossless parse/serialize of comments and revisions and the ID-allocation contract.

## Impact

- `packages/core`: new `modules` option on `createDocxEditor`, `hasReviewContent` in snapshot, `review-model.ts` and `comment-anchors.ts` move out of `src/layout`; revision projection/display-mode plumbing stays (inseparable from layout) but becomes unreachable through the public API without a module.
- `packages/react`: `DocxEditorReview.tsx`, `useReview.ts`, and review slot wiring move to `packages/pro`; slot IDs stay in core chrome registry (public API).
- `packages/pro`: new package (module implementations, React chrome, license validation).
- Parity contract: review members move to a pro bucket; Vue has no review chrome, so bookkeeping only.
- API Extractor: new snapshot directory for pro; core/react snapshots re-extracted after the lift.
- i18n: review strings move to a pro-owned namespace within the existing `en.json` pipeline.
- Changesets/release: pro joins the fixed version group; commercial `LICENSE.md` added to the package.
