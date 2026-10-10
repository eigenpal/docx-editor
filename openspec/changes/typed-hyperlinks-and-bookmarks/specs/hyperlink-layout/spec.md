## ADDED Requirements

### Requirement: Hyperlink runs are measured and painted like sibling runs

Layout SHALL feed a typed hyperlink's runs into measurement and line breaking exactly as if they were direct paragraph children: no dropped text, correct offsets in the paragraph's text sequence, and participation in tabs, wrapping, and justification. The `Hyperlink` character style SHALL resolve through the run-style cascade (themed `hlink` color, underline) unless direct formatting overrides it.

#### Scenario: Section 9.1 paints its full sentence

- **WHEN** paragraph 9.1 of the comprehensive fixture is laid out
- **THEN** the painted text is "Visit Example.com or Anthropic's website." — not "Visit  or ."
- **AND** the link runs paint colored and underlined per the resolved `Hyperlink` style

#### Scenario: Section 9.2 paints its cross-references

- **WHEN** paragraph 9.2 is laid out
- **THEN** the painted text is "Jump to: Section 1 | Section 6 – Nested Tables | Section 12 – Form Elements", en dashes intact

#### Scenario: Link text participates in line breaking

- **WHEN** a hyperlink's runs reach the line end
- **THEN** they wrap by the same break rules as plain runs and each line fragment paints its own portion

### Requirement: Paint wraps hyperlink runs in an anchor element as furniture

Paint SHALL wrap each line's hyperlink run spans in `a.docx-hyperlink`: external links carry `href` = the sanitized projection and `title` = `w:tooltip` when authored; internal links carry `href="#<anchor>"`. Run spans inside the anchor SHALL keep the `data-paragraph-id`/`data-start`/`data-end` selection contract, and the anchor element SHALL never be authoritative for selection mapping. An inert link (refused scheme) paints the same element without `href`. Native anchor navigation SHALL be prevented by the surface.

#### Scenario: External anchor attributes

- **WHEN** the `Example.com` link paints
- **THEN** its runs sit inside `a.docx-hyperlink[href="https://example.com"]` and still carry their `data-paragraph-id`/`data-start`/`data-end`

#### Scenario: Internal anchor attributes

- **WHEN** the `Section 12 – Form Elements` link paints
- **THEN** its runs sit inside `a.docx-hyperlink[href="#section12"]`

#### Scenario: Selection across a link keeps the span contract

- **WHEN** a selection is dragged across "Visit Example.com or"
- **THEN** selection geometry resolves through the run spans' data attributes exactly as it does for plain text

### Requirement: Bookmarks occupy no space

Bookmark anchors SHALL contribute no measured width or height and paint no visible artifact.

#### Scenario: Heading with a bookmark measures like one without

- **WHEN** the `6. Nested Tables` heading (carrying `w:bookmarkStart w:name="section6"`) is laid out
- **THEN** its line metrics equal those of an identical heading without the bookmark
