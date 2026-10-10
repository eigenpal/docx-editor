## ADDED Requirements

### Requirement: VML watermarks are typed and preserved

The canonical tree SHALL type `w:pict` and the VML shape vocabulary required for watermark detection. Unknown VML content SHALL remain lossless generic nodes. Serialization SHALL write the canonical tree unchanged on an unedited round trip.

#### Scenario: VML pict round-trips

- **WHEN** a header containing `w:pict` watermark markup is loaded and saved without edit
- **THEN** the VML subtree matches its input by canonical tree fingerprint

### Requirement: VML watermarks are detected in header and footer stories

The engine SHALL detect VML text and image watermarks using explicit rules for behind-text placement, opacity, and typical watermark geometry. Undetected `w:pict` content SHALL NOT be reported as a watermark.

#### Scenario: Confidential text watermark detected

- **WHEN** `watermark-confidential.docx` (or equivalent fixture) is loaded
- **THEN** `Editor.getWatermark()` reports the VML text watermark

#### Scenario: Non-watermark pict is not claimed

- **WHEN** a header contains an ordinary VML shape that does not match watermark rules
- **THEN** `getWatermark()` returns empty and the shape is preserved

### Requirement: VML image watermarks paint behind text

Detected VML image watermarks SHALL paint behind body text on every page where the hosting header or footer resolves, without enlarging the header/footer flow-height box.

#### Scenario: Behind-text paint order

- **WHEN** a VML image watermark is detected in a header
- **THEN** body text on each page remains legible over the watermark

#### Scenario: Header box unchanged

- **WHEN** a VML watermark extends visually below the header story's flow height
- **THEN** the header box size is still determined by story flow height only

### Requirement: DrawingML image watermarks remain out of scope

DrawingML image watermarks (`w:drawing` with `a:lum`/`a:grayscl` and `@behindDoc`) SHALL be owned by `typed-drawings-and-images`, not this capability.

#### Scenario: DrawingML watermark not double-owned

- **WHEN** a DrawingML behind-text image watermark is present
- **THEN** this change does not define its detection or paint rules
