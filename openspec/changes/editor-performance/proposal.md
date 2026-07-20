# Editor Performance for Large Documents

## Problem

Two performance bottlenecks affect usability with large or complex documents:

1. **Slow loading for 200+ page documents** — documents exceeding 200 pages take over 60 seconds to load. During loading, the browser tab may become unresponsive or show a white screen when switching tabs (tab throttling kills the long-running layout task).

2. **Unresponsive with many tracked changes** — documents with extensive tracked changes (100+ revisions) make the editor sluggish. Scrolling, editing, and commenting become very slow. The tracked change markers and associated comment rendering create significant DOM overhead.

## Scope

- Profile and optimize document loading for large documents (200+ pages)
- Profile and optimize rendering with many tracked changes
- Prevent browser tab throttling during long layout operations

## Out of scope

- Virtual scrolling (major architectural change)
- Server-side rendering/pre-processing
- Document size limits or warnings
