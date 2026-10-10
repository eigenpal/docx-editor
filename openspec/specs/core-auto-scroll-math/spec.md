# core-auto-scroll-math Specification

## Purpose

Defines framework-neutral contracts for behavior shared by supported adapters.

## Requirements

### Requirement: Shared auto-scroll delta math, wired into Vue

`@docx-editor.dev/core` SHALL expose the drag auto-scroll delta computation (proximity-based speed curve with shared `EDGE_ZONE` / `MAX_SPEED` constants). Both adapters' auto-scroll hooks SHALL use it. The Vue adapter SHALL wire its `useDragAutoScroll` into the pointer handler so drag-near-edge auto-scrolls, closing the current gap where the hook is exported but never called.

#### Scenario: Delta computed near an edge

- **WHEN** the pointer is within the edge zone of the scroll container during a drag
- **THEN** the computed scroll delta follows a monotonic non-linear speed curve, remains zero outside the edge zone, and is bounded by `MAX_SPEED`

#### Scenario: Vue auto-scrolls during drag-select

- **WHEN** a user drags a selection toward the top/bottom edge of the Vue editor's scroll container
- **THEN** the container auto-scrolls and the selection extends, matching React behavior

#### Scenario: No scroll outside the edge zone

- **WHEN** the pointer is away from any edge
- **THEN** the computed delta is zero and no scrolling occurs
