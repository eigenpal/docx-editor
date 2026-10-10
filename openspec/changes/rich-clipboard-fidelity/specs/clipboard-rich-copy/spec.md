## ADDED Requirements

### Requirement: Copy and cut write plain text, interop HTML, and the embedded fragment

Copy and cut SHALL write a `text/plain` flavour with the current selected
text, and a `text/html` flavour containing the interop markup with the
fragment package embedded base64-encoded on a single wrapper element. Both
the DOM `copy`/`cut` event lane and the command lane SHALL write the same
flavour set; the command-lane writer SHALL keep the never-throws
fire-and-forget contract and SHALL fall back to a plain-text write where rich
writes are unavailable. When the payload exceeds its size budget, the writer
SHALL degrade in tiers: first drop media from the fragment, then drop the
fragment attribute; the interop HTML and plain text SHALL always be written.
A rectangular cell selection SHALL copy as grid plain text and flattened
interop HTML without a fragment attribute. Cut SHALL still delete the
selection when the clipboard write fails.

#### Scenario: Keyboard copy writes both flavours

- **WHEN** the user copies a range selection with the keyboard
- **THEN** the clipboard event receives `text/plain` and `text/html`, and the
  HTML carries the fragment attribute

#### Scenario: Over-budget selection degrades but still copies

- **WHEN** the selection's fragment package exceeds the size budget even
  without media
- **THEN** the `text/html` flavour is written without the fragment attribute
  and the `text/plain` flavour is unchanged

#### Scenario: Cell-rectangle copy stays on the text lanes

- **WHEN** the user copies while a rectangular cell selection is active
- **THEN** `text/plain` carries the grid text with tabs between columns and
  newlines between rows, and the `text/html` flavour carries the flattened
  cell content without a fragment attribute

#### Scenario: Cut deletes even when the clipboard write fails

- **WHEN** the command-lane clipboard write rejects during a cut
- **THEN** the selection is still deleted and the command reports the
  deletion
