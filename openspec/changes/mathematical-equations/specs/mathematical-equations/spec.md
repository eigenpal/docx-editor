## ADDED Requirements

### Requirement: Bounded OMML projection

The engine SHALL project inline `m:oMath` content with bounded work. It SHALL preserve unsupported OMML in the canonical tree.

#### Scenario: Supported sample equations

- **WHEN** the engine opens `sample.docx`
- **THEN** it projects the quadratic formula, Einstein equation, and summation equation

#### Scenario: Unsupported OMML element

- **WHEN** an equation contains an unsupported OMML structure
- **THEN** the engine displays its bounded descendant text without changing the source tree

#### Scenario: Hostile equation depth

- **WHEN** an equation exceeds the configured nesting or node budget
- **THEN** the projector stops boundedly and returns a safe fallback

### Requirement: Equation layout and paint

The engine SHALL publish equation geometry from DOM-free layout. Paint SHALL use that geometry without parsing source OMML.

#### Scenario: Fraction and radical display

- **WHEN** an equation contains `m:f` and `m:rad`
- **THEN** paint displays a fraction bar and radical around the projected operands

#### Scenario: Script and n-ary display

- **WHEN** an equation contains `m:sSup` or `m:nary`
- **THEN** paint places scripts and limits around the projected base or operator

#### Scenario: Safe paint

- **WHEN** OMML text contains markup-like attacker-controlled characters
- **THEN** paint writes them through text nodes and creates no HTML from the string

### Requirement: Atomic equation interaction

The editor SHALL treat each inline equation as one selectable model atom.

#### Scenario: Click equation

- **WHEN** a user clicks a painted equation
- **THEN** the editor selects its atom and requests the equation editor at its viewport rectangle

#### Scenario: Caret navigation

- **WHEN** a caret moves across an equation
- **THEN** it moves between the equation atom boundaries without entering internal OMML nodes

### Requirement: Linear equation editing

The editor SHALL let a user replace a selected equation through a bounded linear-math syntax.

#### Scenario: Apply supported syntax

- **WHEN** a user applies text containing supported fractions, radicals, scripts, or summations
- **THEN** the editor replaces the equation in one undoable transaction

#### Scenario: Refuse invalid syntax

- **WHEN** a user applies malformed or over-budget linear math
- **THEN** the editor keeps the prior equation and reports the refusal

#### Scenario: Delete equation

- **WHEN** a user selects Delete in the equation editor
- **THEN** the editor removes the equation in one undoable transaction

### Requirement: Save fidelity

The editor SHALL preserve unedited OMML and serialize edited equations as valid namespaced OMML.

#### Scenario: Unedited equation round trip

- **WHEN** a document with equations is saved without equation edits
- **THEN** its canonical OOXML fingerprint remains unchanged

#### Scenario: Edited equation round trip

- **WHEN** an edited equation is saved and reopened
- **THEN** the reopened equation projects to the applied expression

### Requirement: Adapter parity

React and Vue SHALL provide equivalent default equation popovers over the same engine operations.

#### Scenario: Default popover

- **WHEN** a user clicks an equation in either packaged editor
- **THEN** a popover shows the linear input, Apply action, Delete action, and syntax help
