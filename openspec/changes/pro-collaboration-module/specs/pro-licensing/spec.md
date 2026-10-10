# pro-licensing Specification (delta)

## ADDED Requirements

### Requirement: Merged collaboration code carries the Pro license

Moved collaboration source SHALL carry the EigenPal Pro copyright header.
Files added under `packages/pro/src/collaboration/`,
`packages/pro/src/react/useCollaborationStatus.ts`, and
`packages/pro/src/vue/useCollaborationStatus.ts` SHALL be checked by
`license-check-and-add` through `packages/pro/license-check.json`. The published
collaboration implementation SHALL be `LicenseRef-EigenPal-Pro-Evaluation-1.0`
as described in `packages/pro/LICENSE.md`. `collaborationModule` SHALL accept
an optional `licenseKey`, SHALL NOT validate it, SHALL NOT warn, and SHALL NOT
touch the network.

#### Scenario: Header check covers moved source

- **WHEN** `bun run license:check` runs in `packages/pro`
- **THEN** every `.ts` and `.tsx` file under `src/collaboration/` and the two
  moved adapter hooks carries the Pro header

#### Scenario: No licensing network traffic

- **WHEN** `collaborationModule({ session })` initializes with or without a key
- **THEN** no network request is issued for licensing

### Requirement: Pro dependency test is narrowed, not deleted

`packages/pro/src/__tests__/package-dependencies.test.ts` SHALL continue to
assert that `@docx-editor.dev/core` is a `~same.minor` peer and is never a
regular dependency. The same peer rule SHALL hold for
`@docx-editor.dev/react` and `@docx-editor.dev/vue`. The test SHALL allow
exactly one runtime dependency, `y-protocols`, and SHALL require `yjs` and
`y-webrtc` as optional peers that never appear in `dependencies`. The test
SHALL NOT be deleted. The file SHALL record that two engine copies load the
HarfBuzz shaper twice and miss every identity-keyed cache, so a future change
does not widen the allowance to include core.

#### Scenario: Core stays a peer after the merge

- **WHEN** `packages/pro/package.json` is inspected
- **THEN** `peerDependencies['@docx-editor.dev/core']` is a tilde range on the
  current minor, and `dependencies['@docx-editor.dev/core']` is absent

#### Scenario: Only y-protocols is a runtime dependency

- **WHEN** `Object.keys(dependencies)` is listed
- **THEN** the array equals `['y-protocols']`

#### Scenario: Yjs and y-webrtc are optional peers

- **WHEN** `peerDependencies` and `peerDependenciesMeta` are inspected
- **THEN** `yjs` and `y-webrtc` are present, both are optional, and neither
  appears in `dependencies`

#### Scenario: Review-only install does not require Yjs

- **WHEN** a consumer depends on `@docx-editor.dev/pro` and registers only
  `reviewModule()`
- **THEN** installing that consumer does not require `yjs` or `y-webrtc` to be
  present
