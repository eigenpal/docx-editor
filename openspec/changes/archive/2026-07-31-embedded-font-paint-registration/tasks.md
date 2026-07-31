# Tasks — Embedded Font Paint Registration

## 1. Implementation

- [x] 1.1 Internal `registerEmbeddedFontFaces(sources)` module: reads
      `document.fonts`/`FontFace` at call time, CSS-escapes family names,
      sets weight/style descriptors, per-face best-effort load+add, returns a
      disposable that deletes exactly the faces it added
- [x] 1.2 Wire into `resolveDocumentFonts`: register admitted embedded faces
      after validation and before the shaped remount; dispose the previous
      registration on `loadBytes` and `destroy()`; stale-sequence guard
      disposes instead of leaking
- [x] 1.3 Tests: injected-fake unit tests (registration, escaping, dispose,
      failure tolerance, no-env no-op) plus an end-to-end test through
      `createDocxEditor` with stubbed `document.fonts`/`FontFace` asserting
      the five spec scenarios

## 2. Docs and validation

- [x] 2.1 Fonts guide: embedded faces now paint as well as measure; note the
      explicit-sources boundary
- [x] 2.2 `bun run typecheck`, targeted font suites, `bun run api:check`
      (expect no drift), security sink audit on the diff
