# core-comment-ops Specification

## Purpose

TBD - created by archiving change unify-orchestration-tier1. Update Purpose after archive.

## Requirements

### Requirement: Comment and proposeChange transaction builders in core

`@eigenpal/docx-editor-core` SHALL expose pure transaction builders for comment creation, reply, and tracked-change proposal (`createCommentTr`, `replyTr`, `proposeChangeTr`), covering mark application, range resolution, and overlapping-change rejection. Adapter-specific state mutation, event emission, and subscriber notification SHALL remain in each adapter.

#### Scenario: Add a comment over a located range

- **WHEN** `createCommentTr` is invoked for a resolvable paraId/search range
- **THEN** it produces a transaction adding the comment mark over the range and a comment id, matching prior behavior

#### Scenario: Propose a tracked change

- **WHEN** `proposeChangeTr` is invoked for an insertion, deletion, or replace
- **THEN** it applies the deletion/insertion marks correctly and rejects when the range overlaps an existing tracked change

### Requirement: Canonical, instance-scoped comment/revision ID allocation

The lifted ID allocation SHALL use React's monotonic-no-reuse semantics as canonical, replacing Vue's `Math.max(...)+1` strategy. It SHALL be exposed as an instance-scoped `createCommentIdAllocator()` factory returning `{ next(), seedAbove(maxId) }` rather than module-global mutable state, so two editor instances on one page do not share a counter. Each adapter SHALL instantiate one allocator per editor and seed it on document load.

#### Scenario: Monotonic ids survive deletions

- **WHEN** a comment or tracked change is added, then deleted, then another is added in the Vue editor
- **THEN** the new id does not collide with a previously used id (the allocator does not reuse the freed value)

#### Scenario: Comment and revision id spaces consistent

- **WHEN** comments and tracked changes are created in either adapter
- **THEN** id allocation follows the single canonical scheme from core, not separate per-adapter strategies

#### Scenario: Allocators are per-instance

- **WHEN** two editor instances each create their own allocator
- **THEN** ids drawn from one allocator are independent of the other (no shared module-global counter)

#### Scenario: Seed on load avoids collisions with existing ids

- **WHEN** a document with existing comment/revision ids is loaded and `seedAbove(maxId)` is called
- **THEN** subsequent `next()` ids are strictly greater than the highest pre-existing id
