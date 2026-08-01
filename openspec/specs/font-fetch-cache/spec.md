# font-fetch-cache Specification

## Purpose
TBD - created by archiving change font-resolution-overhaul. Update Purpose after archive.
## Requirements
### Requirement: loadFonts fetches only caller-specified URLs

Core SHALL export `loadFonts(request)` which fetches exactly the font URLs the caller
enumerates — never a default host, discovery endpoint, or engine-chosen CDN — and
returns admitted `FontSource`s alongside typed per-source failures. The engine SHALL
NOT invoke `loadFonts` implicitly; it runs only when application code calls it.

#### Scenario: Only listed URLs are requested
- **WHEN** `loadFonts` is called with two source URLs
- **THEN** exactly those two URLs are fetched and no other network request is made
  by the helper

#### Scenario: Opening a document triggers no fetch
- **WHEN** an editor loads a document and the app never called `loadFonts`
- **THEN** the helper performs no network activity

### Requirement: Content hashes gate admission

For each fetched source the helper SHALL compute the `sha256:` content hash. When the
caller supplied an expected hash, a mismatch SHALL fail that source with a typed
`hashMismatch` failure and the bytes SHALL NOT be admitted. When no expected hash was
supplied, the computed hash SHALL be attached to the returned source.

#### Scenario: Tampered response is rejected
- **WHEN** a fetched font's bytes do not match the caller's expected hash
- **THEN** that source appears in `failures` with the expected and actual hashes and
  is absent from `sources`

### Requirement: Caching is a hash-verified optimization

The helper SHALL cache fetched bytes keyed by URL (Cache API bucket, default name
`docx-editor-fonts`) and SHALL revalidate cached bytes by content hash before reuse.
Where the Cache API is unavailable, the helper SHALL degrade to direct fetch without
error. Cache misses, evictions, or revalidation failures SHALL result in a refetch,
never a hard failure by themselves.

#### Scenario: Second call serves from cache
- **WHEN** `loadFonts` is called twice for the same URL in a Cache-API-capable
  environment
- **THEN** the second call admits the source without a network refetch

#### Scenario: Poisoned cache entry is discarded
- **WHEN** a cached entry's bytes no longer match the expected hash
- **THEN** the entry is discarded, the URL is refetched, and admission proceeds on
  the fresh bytes' verification

### Requirement: Partial failure degrades, never blocks

`loadFonts` SHALL NOT reject its promise on per-source failures (network error,
HTTP error, hash mismatch, over-limit bytes). The helper SHALL resolve with every
successfully admitted source plus a typed failure list, so the application can mount
with partial coverage — unresolved families measuring via the fixed-measurer
fallback — and report errors.

#### Scenario: One of three fonts fails
- **WHEN** three sources are requested and one URL returns 404
- **THEN** the promise resolves with two admitted sources and one typed failure, and
  an editor mounted with the resulting configuration shapes the two admitted
  families

