## ADDED Requirements

### Requirement: A resolved view merges the paragraphs its decisions merge

Layout in `proposed` SHALL render a paragraph whose mark carries `w:del` or `w:moveFrom` as one paragraph with the block that follows it in the same container, and layout in `original` SHALL do the same for a mark carrying `w:ins` or `w:moveTo`. Layout in `all-markup` SHALL merge nothing. Consecutive removals SHALL form one group. A paragraph with no following paragraph in its container SHALL NOT merge, and SHALL keep its content and its box.

The merged paragraph SHALL take the paragraph properties of the last member of the group, which is the paragraph whose mark survives, so that its indent, alignment, spacing, borders, shading and numbering are the ones `resolveRevisions` leaves behind.

#### Scenario: A deleted mark runs the paragraph into the next one

- **WHEN** a document holds `Hello ` in a paragraph whose mark carries `w:del`, followed by a paragraph holding `world`
- **THEN** `proposed` lays out one paragraph reading `Hello world`
- **AND** `all-markup` lays out two paragraphs and draws the struck pilcrow between them

#### Scenario: An inserted mark is a split that Original never made

- **WHEN** the same document instead carries `w:ins` on the first paragraph's mark
- **THEN** `original` lays out one paragraph reading `Hello world`
- **AND** `proposed` lays out two paragraphs

#### Scenario: The survivor's formatting governs

- **WHEN** a left-aligned paragraph whose mark is deleted precedes a right-aligned paragraph
- **THEN** the merged paragraph is right-aligned, and it draws the following paragraph's list marker if it has one

#### Scenario: A trailing paragraph has nothing to merge into

- **WHEN** the last paragraph of a table cell has a deleted mark
- **THEN** its content still renders, in its own box, and no content is dropped

### Requirement: A merged paragraph still addresses the live tree

Every span, line range and inline drawing a merge group publishes SHALL carry the paragraph id and the UTF-16 offsets of the member that contributed it, never those of the group. A line carrying content from more than one member SHALL be reachable from each of those paragraphs, and the caret stops of a paragraph SHALL be built from that paragraph's own spans alone. Document order SHALL keep every merged-away paragraph in its authored position.

#### Scenario: Clicking either half lands in the paragraph that owns it

- **WHEN** a reader clicks the word `world` on a merged line in `proposed`
- **THEN** the resolved position names the second paragraph at the offset of `world` within it, not the first paragraph at a compound offset

#### Scenario: Typing at the join edits the paragraph it belongs to

- **WHEN** the caret sits at the end of the first member's text and a character is typed
- **THEN** the character lands at the end of the FIRST paragraph in the tree, and the merged line re-renders with it

#### Scenario: The two views agree with the two decisions

- **WHEN** any document containing tracked paragraph marks is laid out in `proposed`
- **THEN** the laid-out text per line equals the text of a layout of the same document after `acceptAllRevisions`
- **AND** laying it out in `original` equals the text after `rejectAllRevisions`
