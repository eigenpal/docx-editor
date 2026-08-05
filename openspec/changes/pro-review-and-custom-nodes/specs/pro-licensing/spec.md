# pro-licensing Specification (delta)

## ADDED Requirements

### Requirement: Commercial packaging of the pro package

`@docx-editor.dev/pro` SHALL carry a named commercial license identity (`LicenseRef-EigenPal-Pro-Evaluation-1.0`) and the license file (EigenPal Pro Evaluation License 1.0); it SHALL NOT be Apache-2.0. It SHALL join the fixed changeset version group and peer-depend on the core contract package (React chrome entry peer-depends on react). It MAY be published to any registry (public npm by default).

#### Scenario: Package artifact is commercially licensed

- **WHEN** the pro package directory or tarball is inspected
- **THEN** it contains the commercial `LICENSE.md` and its `package.json` license field references it

### Requirement: Optional honor-system license key

Pro entry points (`reviewModule`, `customNodesModule`) SHALL accept an optional `licenseKey` string so future validation is non-breaking. In v1 the key SHALL NOT be validated or enforced: a missing or arbitrary key changes no behavior, emits no warning or banner, and no network request SHALL ever be made for licensing.

#### Scenario: Missing key is fully functional and silent

- **WHEN** `reviewModule({})` is constructed without a key
- **THEN** all review features work with no console output and no UI banner

#### Scenario: No licensing network traffic

- **WHEN** a pro module initializes with or without a key
- **THEN** no network request is issued for licensing
