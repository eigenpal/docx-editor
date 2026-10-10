# Design — Vue drawing authoring parity

Date: 2026-08-04. Change: `vue-drawing-authoring-parity`. Parent: `typed-drawings-and-images`.

## Context

The parent change delivers typed DrawingML pictures, semantic layout, paint, store/package transactions, shared chrome slots, `SelectedImageState`, and React authoring. Vue receives the same disabled and value state but no authoring UI.

This change is UI-only. It MUST NOT write OOXML, package state, or painted DOM, and MUST NOT invent a parallel command table.

## Decisions

### V1: Engine state is the only authority

Vue composables read `SelectedImageState`, `toolbarCommandState`, and `useEditorCommand('image.wrap')` (and sibling slots) from the engine. Wrap choice, lock refusal, and scope refusal come from typed engine reasons — never from adapter-side XML inspection.

### V2: One final commit per gesture

Pointer moves update a local preview; pointer release submits one engine command, producing one transaction and one history entry. This matches the parent change's D9 drag rule and React behaviour.

### V3: Customization ladder applies

Image chrome follows the same ladder as other Vue adapter parts: `className`/`data-active` CSS, optional icons, slot override, and raw composables underneath. No hardcoded hex/rgba; use `--doc-*` tokens.

### V4: No paired-support claim until this lands

Documentation, parity contract, and feature matrix MUST NOT describe drawings as adapter-supported until this change merges.

## Acceptance boundary

In scope: Vue insert dialog, properties panel, wrap menu, alt-text editor, resize handles, anchored drag, keyboard resize, i18n, and parity-contract entries.

Out of scope: canonical typing, media validation, layout geometry, paint, store ops, chrome slot definitions, VML watermarks (`typed-vml-watermarks`), tracked drawing deletion (`typed-revisions-and-comments`).

## Owner

Vue adapter maintainers. Blocked on `typed-drawings-and-images` shared engine state and React proof.
