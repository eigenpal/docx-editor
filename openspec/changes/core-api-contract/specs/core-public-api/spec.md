## ADDED Requirements

### Requirement: Declared entry map

`@docx-editor.dev/core` SHALL expose exactly six entry points, and every public symbol SHALL be reachable through one of them: `core` (document layer), `core/editor` (browser facade), `core/geometry` (adapter internals), `core/plugin` (extension authoring), `core/mcp` (MCP tool registry), and `core/types` (type-only barrel).

#### Scenario: Consumer imports a declared entry

- **WHEN** a consumer imports from any of the six declared entries
- **THEN** the import resolves against the package `exports` map without a bundler alias or `tsconfig` path mapping

#### Scenario: Consumer imports an undeclared subpath

- **WHEN** a consumer imports a subpath that is not in the `exports` map
- **THEN** module resolution SHALL fail at build time rather than resolving through a workspace path mapping

### Requirement: No implicit source-path resolution

No consumer package SHALL depend on resolving core through a `tsconfig` `paths` wildcard, a bundler alias into core's source tree, or a relative path into its source.

#### Scenario: Build without workspace path mappings

- **WHEN** the repository is built with core resolved from the registry and no core entries in `tsconfig` `paths`
- **THEN** no consumer module SHALL fail to resolve a core import

### Requirement: Per-entry stability guarantees

Each entry SHALL declare a stability level. `core`, `core/editor`, `core/plugin`, `core/mcp`, and `core/types` are stable and follow semver. `core/geometry` is `@experimental` and semver-exempt: it MAY change or be removed in a minor release.

#### Scenario: Breaking change to a stable entry

- **WHEN** a symbol on a stable entry is removed or its signature changes incompatibly
- **THEN** the release SHALL be a major version

#### Scenario: Breaking change to the experimental entry

- **WHEN** a symbol on `core/geometry` is removed or changed incompatibly
- **THEN** the release MAY be a minor version, and the change SHALL be noted in the changelog

### Requirement: Contract package is never published

The contract package in this repository SHALL be marked `"private": true` and SHALL NOT be published to any registry.

#### Scenario: Release runs with the contract package present

- **WHEN** the release workflow runs
- **THEN** the contract package SHALL be excluded from publication, so it cannot shadow the real package on npm

### Requirement: Deprecation window for externally consumed entries

Entries with consumers outside the first-party adapters SHALL remain resolvable for at least one major version after their replacement ships.

#### Scenario: External consumer upgrades one major

- **WHEN** an external consumer upgrades across the major that introduces the new entry map
- **THEN** their existing imports SHALL continue to resolve, emitting a deprecation notice rather than failing
