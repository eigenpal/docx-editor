## ADDED Requirements

### Requirement: Paste selects the highest-fidelity flavour

Paste SHALL route flavours in fidelity order: an embedded internal fragment
first, then external `text/html`, then `text/plain`. A fragment payload SHALL
be decoded and read through the bounded OPC/XML reader under a dedicated
decoded-size cap. A payload that fails decoding or reading, and a fragment
that is refused at apply, SHALL degrade to the next flavour instead of
failing the paste. Every paste SHALL commit as one transaction over the
current selection. A paste-without-formatting action, bound to Cmd+Shift+V,
SHALL force the `text/plain` lane. In suggesting mode, and when the caret is
outside the body story, the router SHALL degrade rich payloads to the plain
lane. The plain lane's existing behavior, including the drop lane, SHALL be
preserved unchanged.

#### Scenario: Internal fragment beats external HTML

- **WHEN** the pasted payload carries both a valid fragment attribute and
  visible HTML
- **THEN** the fragment lane inserts the full-fidelity blocks and the HTML
  projection is not used

#### Scenario: A refused fragment degrades instead of no-op

- **WHEN** the fragment decodes and reads but is refused at apply with a
  typed rejection
- **THEN** the paste proceeds through the external HTML projection, and
  through the plain lane if that also fails

#### Scenario: Paste without formatting forces plain text

- **WHEN** the user pastes with Cmd+Shift+V over a payload that carries HTML
  and a fragment
- **THEN** only the plain-text content is inserted, as if typed

#### Scenario: Suggesting mode degrades to the tracked plain lane

- **WHEN** a rich payload is pasted while the editor is in suggesting mode
- **THEN** the plain lane inserts the text wrapped as a tracked insertion and
  no fragment blocks are applied

#### Scenario: Non-body stories receive plain text

- **WHEN** a rich payload is pasted while the caret is in a header, footer,
  footnote, or text-box story
- **THEN** the router degrades to the plain lane and no fragment blocks are
  applied

### Requirement: The command lane carries rich payloads and a plain twin

The `paste` editor command SHALL accept an optional HTML payload alongside
the plain text and SHALL route it through the same flavour precedence as the
event lane. A `pasteWithoutFormatting` command SHALL insert the plain text as
if typed. The editor contract documentation and the public API snapshots
SHALL be updated for both, and the adapters' clipboard reads SHALL fall back
to plain text where rich reads are unavailable or stripped.

#### Scenario: Command paste with HTML uses the rich lane

- **WHEN** a host executes the paste command with plain text and an HTML
  payload carrying a fragment attribute
- **THEN** the fragment lane inserts the full-fidelity blocks

#### Scenario: pasteWithoutFormatting stays plain

- **WHEN** a host executes the pasteWithoutFormatting command while the
  clipboard HTML carries a fragment
- **THEN** only the plain text is inserted, as if typed
