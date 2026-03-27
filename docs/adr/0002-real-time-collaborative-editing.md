# ADR 0002: Real-Time Collaborative Editing via Yjs + Hocuspocus

## Status

Accepted

## Context

Lawyers need to co-edit documents simultaneously (like Google Docs / SharePoint).
The current system supports async collaboration via track changes and comments,
but not real-time concurrent editing with live cursors.

## Decision

Use **Yjs (CRDT) + y-prosemirror + Hocuspocus** for real-time collaboration:

- **Yjs** — client-side CRDT library, handles conflict-free merging
- **y-prosemirror** — binds ProseMirror state to a shared Yjs document
- **Hocuspocus** — Node.js WebSocket server that syncs Yjs documents between
  clients and persists snapshots to Postgres (Supabase)

## Alternatives Considered

| Option                      | Rejected Because                                                       |
| --------------------------- | ---------------------------------------------------------------------- |
| Supabase Realtime Broadcast | 100 events/sec limit, no CRDT, designed for presence not document sync |
| Liveblocks                  | Vendor lock-in, no self-hosted, proprietary sync engine                |
| prosemirror-collab (OT)     | Must build server from scratch, edit starvation on slow connections    |
| PartyKit                    | Cloudflare lock-in, no Postgres persistence built-in                   |
| Y-Sweet                     | Managed service cost, less control                                     |

## Architecture

```
Browser A ←→ Hocuspocus Server ←→ Browser B
                    ↕
            Supabase Postgres
            (Y.Doc snapshots)
```

## Consequences

### Positive

- Real-time co-editing with live cursors
- Offline support (Yjs works offline, syncs on reconnect)
- No data loss (CRDT guarantees convergence)
- Runs in existing k3d/EKS infrastructure
- Zero licensing cost (all MIT)

### Negative

- One more service to deploy and maintain (Hocuspocus server)
- Initial Y.Doc sync can be slow for large documents (100-500ms)
- Yjs tombstone garbage collection adds memory overhead

## References

- https://docs.yjs.dev
- https://github.com/yjs/y-prosemirror
- https://tiptap.dev/docs/hocuspocus/getting-started/overview
- https://emergence-engineering.com/blog/hocuspocus-with-supabase
