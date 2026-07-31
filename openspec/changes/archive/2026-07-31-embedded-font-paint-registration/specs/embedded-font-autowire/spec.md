# Embedded Font Auto-Wiring — paint registration

## ADDED Requirements

### Requirement: Admitted embedded faces register for paint

The editor SHALL register every admitted embedded face's bytes with the
environment's `FontFaceSet` (`document.fonts`) under the embedded family name,
with weight and style descriptors matching the face's canonical request, so
painted glyphs render with the same font the layout measured. The editor SHALL
remove the faces it registered when the document is replaced by a new load and
when the editor is destroyed. Registration SHALL be best-effort: a face that
fails to register still measures shaped, registration failure SHALL NOT block or
fail a load, and the editor SHALL NOT register faces the validator refused.
Family names SHALL be escaped before interpolation into any CSS-parsed context,
and the editor SHALL no-op when the environment provides no `FontFaceSet`.

#### Scenario: Embedded-only font paints with its own glyphs

- **WHEN** a document embeds a valid face for family F, F is not installed on
  the viewer's system, and the shaped remount completes
- **THEN** `document.fonts` contains a face for family F with the embedded
  bytes, registered before the shaped surface mounts

#### Scenario: Replaced document does not leak faces

- **WHEN** a document with embedded family F is loaded and then a second
  document without F is loaded into the same editor
- **THEN** the F face the editor registered is removed from `document.fonts`

#### Scenario: Destroy removes registered faces

- **WHEN** an editor that registered embedded faces is destroyed
- **THEN** every face it registered is removed from `document.fonts`

#### Scenario: Rejected faces never reach the FontFaceSet

- **WHEN** a document embeds one valid face and one face the validator rejects
- **THEN** only the valid face is registered

#### Scenario: No DOM environment degrades silently

- **WHEN** the editor runs where `document` or `document.fonts` is undefined
- **THEN** loads complete normally, measurement still engages shaped, and no
  error is reported for the missing registration environment
