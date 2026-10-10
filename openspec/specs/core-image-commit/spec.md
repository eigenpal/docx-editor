# core-image-commit Specification

## Purpose

Defines framework-neutral contracts for behavior shared by supported adapters.

## Requirements

### Requirement: Image resize/drag commit functions in core

`@docx-editor.dev/core` SHALL expose `commitImageResize(view, pmPos, width, height)` and `commitImageDragMove(view, opts)` covering the float-vs-inline fork. Float drag updates the node's `position` attribute via `setNodeMarkup`; inline drag deletes at the old position and inserts at a resolved drop position. Hit-testing and gesture tracking SHALL remain in the adapters, which pass a resolved drop position / EMU offset into the commit.

#### Scenario: Resize commit

- **WHEN** `commitImageResize(view, pmPos, w, h)` is called
- **THEN** the image node's width/height attrs update in a single transaction

#### Scenario: Float drag commit

- **WHEN** the image is float/anchored (`displayMode === 'float'` or wrapType square/tight/through) and `commitImageDragMove` is called with an EMU offset
- **THEN** the node's `position` attribute updates to the new margin-relative position, according to the requested position and unit contract

#### Scenario: Inline drag commit

- **WHEN** the image is inline and `commitImageDragMove` is called with a resolved drop position
- **THEN** the node is removed from its old position and inserted at the drop position, with selection re-asserted, according to the documented operation contract
