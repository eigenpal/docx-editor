# custom-node-payloads

## ADDED Requirements

### Requirement: A custom node SHALL carry a payload larger than its tag

The system SHALL store a custom node's payload in a customXml data part and bind the node's control to it, so a payload is not bounded by the 64-character `w:tag` cap.

#### Scenario: Authoring a node with a payload

- **WHEN** a host inserts a custom node with a payload
- **THEN** the document SHALL carry a customXml data part holding that payload
- **AND** the inserted `w:sdt` SHALL carry a `w:dataBinding` whose `w:storeItemID` matches the part's `ds:itemID`
- **AND** the store, the node and the control SHALL be written in one transaction, or none of them

#### Scenario: A payload that does not match its schema

- **WHEN** a host inserts a node whose payload does not satisfy the definition's schema
- **THEN** the insert SHALL be refused with a reason naming the failing field
- **AND** the document SHALL be unchanged

### Requirement: A payload SHALL round-trip through Word

The system SHALL author bindings Word preserves.

#### Scenario: Reopening a document Word saved

- **WHEN** a document with a bound custom node is opened, edited and saved by Word
- **THEN** the `w:dataBinding` SHALL still resolve to the node it named
- **AND** the payload SHALL be unchanged
- **AND** the node SHALL be recognized with its payload on reopen

### Requirement: A payload SHALL NOT outlive the control that bound it

The system SHALL remove a payload whose control is gone, including when the control was deleted by Word.

#### Scenario: Deleting a chip in the editor

- **WHEN** a custom node is deleted
- **THEN** its payload SHALL be removed in the same transaction

#### Scenario: A control deleted in Word

- **WHEN** a document is opened whose store holds a node no control binds
- **THEN** that node SHALL be removed
- **AND** nodes still bound SHALL be untouched

### Requirement: A host SHALL control whether a node leaves the system

The system SHALL apply a definition's `preserveOnExport` when a document is exported.

#### Scenario: Exporting a node that must not travel

- **WHEN** a document is exported and a node's definition declares `preserveOnExport: 'text'`
- **THEN** the reader SHALL still see the node's text
- **AND** the `w:sdt`, its `w:tag`, its `w:dataBinding` and its payload SHALL be absent
- **AND** no `customXml` part, relationship or content-type Override SHALL remain once the last node for the namespace is gone

#### Scenario: An export that cannot be completed

- **WHEN** stripping a store is refused
- **THEN** the export SHALL fail with a reason
- **AND** SHALL NOT produce a document a caller could mistake for a stripped one
