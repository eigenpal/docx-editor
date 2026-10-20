# Effective document editing through Office.js-shaped APIs

## Why

Agents need text, formatting, review, lists, tables, templates, images, and page furniture through one host-neutral API.
The proposed inventory contains 81 editing members. The earlier audit found 44 present, not 44 behaviorally verified.
A declaration count cannot measure successful document editing.

## What Changes

- Implement and verify the 81 members in `tasks.md`, including writable properties.
- Add the read, targeting, collection, and pending-object dependencies needed to use those members.
- Use canonical store transactions for both browser and headless hosts.
- Add workflow tests, save/reopen checks, runtime notes, and local Word evidence where behavior is uncertain.
- Keep signature coverage, member availability, and tested workflow results separate. Coverage reporting remains informational.
- Deliver implementation, compatibility documentation, evidence, and this checklist in one PR from an isolated worktree.

## Capabilities

### New Capabilities

- `agent-document-editing`: the bounded ordinary-document editing profile and its verification requirements.

### Modified Capabilities

None. Existing canonical store and Office.js compatibility requirements remain authoritative.

## Impact

Core automation planners, protocol operations, canonical operations where missing, editor-api proxies, compatibility fixtures, public snapshots, tests, examples, and a changeset.
No independent browser-only implementation counts as headless support.

## Scope

Ordinary letters, reports, proposals, contracts, and templates. Required capabilities include rectangular tables, nested bullet/decimal lists, inline PNG/JPEG, plain/rich controls, tracked text, primary headers/footers, and PAGE/NUMPAGES fields.
Preserve advanced existing structures. Refuse unsupported mutations explicitly, without partial changes.
TrackAll, tracked formatting/structural edits, merged/nested table authoring, bound/repeating controls, floating pictures, and arbitrary field evaluation remain outside this profile.
