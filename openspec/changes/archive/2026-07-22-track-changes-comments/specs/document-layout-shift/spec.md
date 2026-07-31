## ADDED Requirements

### Requirement: Document shifts left when sidebar is active

The system SHALL shift the document pages to the left when the comments/changes sidebar is open, creating a balanced visual layout with the document on the left and the sidebar on the right.

#### Scenario: Sidebar opens and document shifts

- **WHEN** the comments sidebar opens (either from loading a document with comments or from user action)
- **THEN** the document pages SHALL smoothly animate to a left-shifted position, and the sidebar SHALL appear on the right side

#### Scenario: Sidebar closes and document centers

- **WHEN** the comments sidebar is closed
- **THEN** the document pages SHALL smoothly animate back to the centered position

#### Scenario: Smooth transition

- **WHEN** the sidebar opens or closes
- **THEN** the layout shift SHALL use a CSS transition (approximately 200ms ease) for smooth animation without content re-layout

### Requirement: Document rendering preserved during shift

The system SHALL NOT re-layout or re-render page content when the document shifts. The shift SHALL be purely positional.

#### Scenario: Page content unchanged during shift

- **WHEN** the document shifts left due to sidebar opening
- **THEN** all page content, text flow, and pagination SHALL remain identical to the unshifted state

#### Scenario: WYSIWYG fidelity maintained

- **WHEN** the sidebar is open and the document is shifted
- **THEN** the document pages SHALL maintain their exact dimensions and rendering, matching what would print

### Requirement: Sidebar dimensions and positioning

The sidebar SHALL be a fixed-width panel positioned on the right side of the editor container.

#### Scenario: Sidebar width

- **WHEN** the sidebar is visible
- **THEN** the sidebar SHALL be 320px wide

#### Scenario: Sidebar height

- **WHEN** the sidebar is visible
- **THEN** the sidebar SHALL span the full height of the editor container (below the toolbar), and SHALL be independently scrollable

#### Scenario: Sidebar z-index

- **WHEN** the sidebar overlaps with other UI elements
- **THEN** the sidebar SHALL appear above the document pages but below modal dialogs

### Requirement: Scroll synchronization

The sidebar SHALL scroll in coordination with the document to keep visible comments aligned with their anchored text.

#### Scenario: Document scroll updates sidebar

- **WHEN** the user scrolls the document vertically
- **THEN** comment cards in the sidebar SHALL reposition to stay vertically aligned with their anchored text ranges (as closely as possible given space constraints)

#### Scenario: Comment cards avoid overlap

- **WHEN** multiple comments are anchored to nearby text ranges
- **THEN** the sidebar SHALL space comment cards to avoid visual overlap, pushing lower cards down as needed

### Requirement: Responsive to editor container size

The layout shift SHALL adapt to the available container width.

#### Scenario: Sufficient width for sidebar

- **WHEN** the editor container is wide enough to display both the shifted document and the sidebar
- **THEN** the document SHALL shift left and the sidebar SHALL appear to its right

#### Scenario: Narrow container

- **WHEN** the editor container is too narrow to comfortably display both document and sidebar (less than 1200px)
- **THEN** the sidebar SHALL overlay the right portion of the document (rather than shifting the document off-screen), with a semi-transparent backdrop on the overlapped area
