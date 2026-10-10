## ADDED Requirements

### Requirement: A HYPERLINK field is a live link

A `HYPERLINK` field (§17.16.5.25) SHALL render its cached result as a clickable link, complex and `w:fldSimple` alike. An admitted external target SHALL win over the `\l` anchor, mirroring the `r:id`-over-`w:anchor` rule of typed links; an anchor-only field SHALL be an internal link to that bookmark; the `\o` tooltip SHALL be carried as the hover text. The hyperlink popover SHALL show a field link read-only, because the field's code — not a `w:hyperlink` element — is its source of truth and the link editor cannot write one.

Opening the target SHALL require the same explicit gesture as a typed link. Nothing SHALL be fetched or resolved on document open.

#### Scenario: A field link opens like a typed one

- **WHEN** a complex field carries `HYPERLINK "https://example.com" \o "Site"` around a cached result
- **THEN** the result paints as a link with that tooltip and the same gesture that opens a typed link opens it

#### Scenario: An anchor-only field jumps internally

- **WHEN** a field carries `HYPERLINK \l "Section2"` and the document holds that bookmark
- **THEN** activating the link moves to the bookmark, like a typed internal link

#### Scenario: The popover is read-only for a field link

- **WHEN** the link popover opens on a HYPERLINK field's result
- **THEN** it shows the sanitized target without offering to edit it

### Requirement: Every field-derived target crosses the one href trust boundary

A field-derived link target SHALL pass through exactly the same sanitization as a typed `w:hyperlink` target: `sanitizeHref` plus the absolute-URI gate a relationship target must clear, applied at the surface trust boundary. Layout SHALL parse the instruction into raw strings and SHALL NEVER build an href — no DOM sink receives an attribute built from raw instruction text. A relative target SHALL be refused, because it would resolve against the host page's origin.

A refused target SHALL fall back to the `\l` anchor when the field names one, and otherwise SHALL project no link at all: the cached result paints as plain text. Instruction, target, and switch values SHALL each be length-capped, and tokenization SHALL be one bounded pass. The per-surface link registry SHALL fail closed at its cap: past it, a NEW target projects no link while known targets keep resolving.

#### Scenario: A hostile scheme paints plain

- **WHEN** a field carries `HYPERLINK "javascript:alert(1)"`
- **THEN** the target is refused, no href reaches the DOM, and the cached result paints as plain text

#### Scenario: A refused target falls back to its anchor

- **WHEN** a field carries a refused external target and a `\l` anchor
- **THEN** the field projects an internal link to that anchor

#### Scenario: The registry cap fails closed

- **WHEN** a document projects more distinct field targets than the registry admits
- **THEN** each target past the cap paints plain text and every admitted target keeps resolving

### Requirement: Note stories project their links

Footnote and endnote stories SHALL project links the same way the body does — typed `w:hyperlink` elements and `HYPERLINK` fields both — through the same trust boundary and click routing.

#### Scenario: A link in a footnote is clickable

- **WHEN** a footnote's text holds a typed link and a HYPERLINK field with admitted targets
- **THEN** both paint as links on the note's page area and both resolve on the opening gesture
