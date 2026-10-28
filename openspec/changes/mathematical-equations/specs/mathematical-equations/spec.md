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

#### Scenario: N-ary limit location

- **WHEN** an inline equation (`m:oMath` beside other visible content of its paragraph) contains an `m:nary` with limits
- **THEN** the operator draws at its run size, and the limits sit to its right with the subscript and superscript offsets of an `m:sSubSup`, whatever `m:limLoc` says
- **AND** in a display equation (`m:oMathPara`) the limits follow `m:limLoc`, and without it sit beside an integral and below and above other operators
- **AND** an `m:oMath` that is the only visible content of its paragraph is a display equation, so its operator draws enlarged with display limits and its fractions take the display placement
- **AND** an `m:limLoc` of `subSup` projects as math, keeps its source on save, and refuses compact replacement

#### Scenario: N-ary operator without a character

- **WHEN** an `m:nary` has no `m:chr`
- **THEN** it draws an integral and places its limits as an integral does
- **AND** copied plain text, MathML, Markdown export, PDF text, and accessible labels carry the integral, and save keeps the source without `m:chr`
- **AND** it offers no compact linear text, because compact syntax spells only the sum, so compact replacement is refused with a reason that the equation popover shows; a sum written from compact text names `m:chr`
- **AND** an `m:nary` outside the supported subset, such as one with `m:subHide` or `m:grow`, paints and copies its operator in the text fallback

#### Scenario: Script size and placement

- **WHEN** an equation contains `m:sSup`, `m:sSub`, or `m:sSubSup`
- **THEN** each script draws at 73 percent of its run size, rounded down to a whole half point
- **AND** a script inside a script, fraction part, or limit draws at 60 percent of its run size, at every deeper level too
- **AND** the superscript baseline rises at least 750/2048 em of the structure size, and at least to 460/2048 em below the top of the lowercase text of its base, including text inside a structured base
- **AND** the subscript baseline sits 0.2 em below the base baseline, and lower when the top of the subscript ink would rise more than 760/2048 em above it
- **AND** the em of these offsets is the `w:sz` of the structure `m:ctrlPr`, or the size of the text around the equation when the structure has none
- **AND** the two scripts of one base keep a 300/2048 em gap between their glyphs

#### Scenario: Operator spacing

- **WHEN** an argument at its base size contains relations, binary operators, or punctuation
- **THEN** a relation takes 5/18 em on each side that has a neighbour, and a binary operator takes 4/18 em
- **AND** punctuation takes 3/18 em after it, except a comma or period between digits
- **AND** a fraction or an ellipsis takes 3/18 em beside an ordinary neighbour, and an n-ary structure takes 3/18 em beside its neighbours
- **AND** a binary operator at the start of an argument or after an operator, an opening bracket, or punctuation is a sign and takes no space
- **AND** a binary operator before a relation, a closing bracket, or punctuation takes no space, and the relation takes no space on that side
- **AND** each space takes the size of the neighbour that is not the spaced operator
- **AND** scripts, limits, fraction parts, and normal text take no operator spacing

#### Scenario: Fraction placement

- **WHEN** an inline equation (`m:oMath`) contains an `m:f` bar fraction
- **THEN** the rule strokes 133/2048 em of the fraction size and centres on the math axis, 585/2048 em above the baseline
- **AND** the numerator baseline rises at least 1200/2048 em, and further to keep a 133/2048 em gap between its ink and the rule
- **AND** the denominator baseline drops at least 1030/2048 em, and further to keep a 133/2048 em gap between the rule and its ink
- **AND** the fraction is as wide as its wider part, and its text parts reach the typographic ascender and descender of the math face

#### Scenario: Display fraction placement

- **WHEN** a display equation (`m:oMathPara`) contains an `m:f` bar fraction
- **THEN** its parts draw at the inline part size, with their full font boxes
- **AND** the rule strokes 0.055 em of the fraction size, inset 0.04 em on each side, with a 0.08 em gap above and below it
- **AND** the fraction is as wide as its wider part plus 0.08 em on each side

#### Scenario: Line extent of runs in different sizes

- **WHEN** a later text atom of an equation has a larger font box than the first atom
- **THEN** the first atom claims its full font box on the line
- **AND** a later text atom claims its glyph ink, with 300/2048 em of the first atom size above the ink, and never more than its own font box
- **AND** a later text atom that draws no ink, such as a run of spaces, claims no height
- **AND** a first structure takes the leading from its `m:ctrlPr` size, or from the size of the text around the equation
- **AND** later structures and text without measured ink keep their boxes, so an equation whose runs share one size and face keeps its extent

#### Scenario: Run language

- **WHEN** an equation run carries a bounded `w:lang` beside supported run properties
- **THEN** the run lays out as math with its own size and style
- **AND** save keeps the `w:lang` source, and compact replacement stays refused for the run

#### Scenario: Bar placement

- **WHEN** an equation contains `m:bar` with an upper or lower position
- **THEN** the bar strokes 133/2048 em of the structure size, which is the `w:sz` of its `m:ctrlPr` or the size of the text around the equation
- **AND** the bar keeps a 345/2048 em gap from the ink of its body, with one more stroke of space on its outer side

#### Scenario: Safe paint

- **WHEN** OMML text contains markup-like attacker-controlled characters
- **THEN** paint writes them through text nodes and creates no HTML from the string

#### Scenario: Authored text fonts in equation runs

- **WHEN** an equation run specifies a text font and contains ASCII digits
- **THEN** the digits use that font in italic, with run bold, unless `m:sty` selects plain or a bold math style
- **AND** mathematical letters and symbols retain the math face

#### Scenario: Bold math style digits in authored text fonts

- **WHEN** an equation run with `m:sty` `b` or `bi` specifies a text font and contains ASCII digits
- **THEN** the digits use mathematical bold digits from the math face
- **AND** letters in the same run stay in the same math-face text node

#### Scenario: Run font slots that name different faces

- **WHEN** an equation run's `w:rFonts` names different faces in its `w:ascii`, `w:hAnsi`, `w:eastAsia`, and `w:cs` slots
- **THEN** the run takes the face of the slots that its characters use, and keeps its size and math style
- **AND** a run whose characters use two different faces keeps the text fallback
- **AND** compact replacement refuses the equation, and save keeps the source properties

#### Scenario: Normal text without a run font

- **WHEN** an equation run specifies `m:nor` without `w:rFonts`
- **THEN** layout and paint use the paragraph font for that run
- **AND** the equation remains one atom with unchanged source OMML

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
