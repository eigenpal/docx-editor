## ADDED Requirements

### Requirement: An open navigation pane does not move a document that has room for it

The pane SHALL float over the gutter to the left of the centred page rather than docking beside it. It SHALL publish a document displacement ONLY when that gutter is narrower than the pane needs, and SHALL never publish more than is needed to clear the pane.

The page stack centres itself in the scroll container, so a left padding of P moves the page by P/2 while the padded box is still at least a page wide, and pins the page at P once it is not. The displacement rule SHALL solve both regimes so the page's left edge lands exactly on the pane's reservation, and SHALL be a pure function of viewport width, rendered page width, and reservation — separately testable, and exported.

A degenerate measurement (a viewport not yet laid out, a document with no page setup) SHALL yield no displacement rather than a guess: shifting on a zero measurement makes the pane jump on the first frame and settle on the second.

#### Scenario: A wide window does not move at all

- **WHEN** the pane opens in a 1728px viewport showing an 816px page, leaving 456px of gutter against a 312px reservation
- **THEN** the published displacement is 0 and the page's left edge is unchanged

#### Scenario: The break-even gutter still does not move

- **WHEN** the gutter is exactly the reservation
- **THEN** the published displacement is 0

#### Scenario: A narrow window moves by exactly the deficit

- **WHEN** the pane opens in a 1200px viewport showing an 816px page, leaving a 192px gutter against a 312px reservation
- **THEN** the published displacement is 240px — twice the 120px deficit, because a centred page moves by half the padding — and the page's left edge lands on 312px

#### Scenario: Too narrow to centre pins the page at the reservation

- **WHEN** the padded box would be narrower than one page
- **THEN** the displacement equals the reservation exactly, the page pins to it, and the overflow scrolls horizontally

#### Scenario: The ruler follows the page it measures

- **WHEN** an open pane displaces the page
- **THEN** the horizontal ruler is displaced by the same amount, so its ticks stay over the page

### Requirement: DocxEditor.Navigation is a compound over three headless hooks

The React adapter SHALL expose `DocxEditor.Navigation` — a Headings/Find pane — with its parts as statics (`.Header`, `.Close`, `.Title`, `.Tabs`, `.Tab`, `.Headings`, `.Find`, `.Toggle`) and three hooks underneath: `useNavigationPane` (open state, active tab, displacement), `useDocumentOutline` (headings, nesting depth, jump), and `useDocumentSearch` (query, matches, active index, navigation, options).

`<DocxEditor.Navigation />` with no children SHALL render the complete pane. Children SHALL replace the default composition part by part. Open state and active tab SHALL each work controlled or uncontrolled. `<DocxEditor>` SHALL mount the pane by default and `navigation={false}` SHALL remove it. The existing `DocxEditor.DocumentOutline` part SHALL be unchanged.

A part rendered outside its compound root SHALL throw rather than render nothing — unlike the editor context, whose null is a real frame, a misplaced part is a composition mistake with no sensible fallback.

#### Scenario: The default composition is the whole pane

- **WHEN** `<DocxEditor.Navigation defaultOpen />` renders with no children
- **THEN** it shows the header with a close control, a Headings tab and a Find tab with Headings selected, and both tab panels

#### Scenario: Collapsed shows a toggle in the panel's place

- **WHEN** the pane is closed
- **THEN** a toggle control renders where the panel's close control will appear, and the panel's own close control is absent

#### Scenario: A controlled pane reports rather than moves

- **WHEN** the pane is given `open={false}` with an `onOpenChange` handler and the toggle is pressed
- **THEN** the handler is called with `true` and the pane stays closed until the host says otherwise

#### Scenario: A misplaced part fails loudly

- **WHEN** a pane part renders outside `DocxEditor.Navigation`
- **THEN** it throws, naming the required root

### Requirement: The pane keeps its state across a close and reopen

The pane SHALL stay mounted when closed, animating to zero width, and SHALL be removed from the tab order and from hit testing while closed. A typed query, its results, and a scrolled list SHALL survive a close and reopen.

#### Scenario: Closed but present

- **WHEN** the pane is closed
- **THEN** its panel element is still in the document, marked inert, and neither focusable nor hit-testable

### Requirement: The find panel reads honestly

Typing SHALL be debounced before a document-wide scan runs; results SHALL then be re-derived on every editor tick so an edit updates the list under the same query. The result readout SHALL state a TOTAL until a match has actually been navigated to, and a POSITION afterwards — saying "Result 1 of N" before the caret has moved claims a selection that does not exist. An empty query SHALL read as nothing, not as "no results". A truncated scan SHALL be marked as such.

#### Scenario: Before navigating, the readout is a total

- **WHEN** a query matches seven times and nothing has been selected yet
- **THEN** the readout gives the count of results, not a position

#### Scenario: After navigating, the readout is a position

- **WHEN** the second result is selected
- **THEN** the readout reads as result 2 of 7, that row is marked current, and the document has scrolled to it

#### Scenario: Next and previous wrap

- **WHEN** the last result is active and next is pressed
- **THEN** the first result becomes active

#### Scenario: An empty box says nothing

- **WHEN** the query is empty
- **THEN** the readout is blank rather than "no results"
