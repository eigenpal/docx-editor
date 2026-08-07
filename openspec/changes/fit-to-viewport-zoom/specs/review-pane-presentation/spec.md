## ADDED Requirements

### Requirement: The review pane docks only in a container wide enough to hold it

The pane SHALL have two presentations — a docked rail beside the document, and an overlay drawer over it — chosen from the width of the editor's own scroll container.

The threshold SHALL be container geometry, never a viewport media query. This editor is embedded, so a 700px column inside a 2560px window is a narrow editor and a media query would call it wide and dock a rail into room that cannot hold one.

An unmeasured container SHALL answer `rail`. That is the shape a wide container gets, and a first frame that guessed `drawer` would paint the document full width and then reserve the gutter.

#### Scenario: A wide container keeps the rail

- **WHEN** the scroll container is at least the dock threshold wide
- **THEN** the presentation is `rail`, the gutter is reserved, and cards are anchored beside their text

#### Scenario: A narrow container moves to a drawer

- **WHEN** the scroll container is below the dock threshold
- **THEN** the presentation is `drawer`, and the gutter is reserved in neither the open nor the closed state

#### Scenario: The presentation follows the container, not the window

- **WHEN** the container is widened past the threshold without the window changing
- **THEN** the presentation returns to `rail`

### Requirement: A drawer gives the document its width back

In `drawer` presentation the scroll container SHALL reserve no room for the pane in either state, so the document keeps the full width and — under a fit mode — is re-fitted to it.

The marker strip a closed rail shows SHALL NOT be rendered in a drawer: the markers would sit over the text they annotate, and the existing comments toolbar control is already the way in.

#### Scenario: Opening comments on a phone does not shrink the document

- **WHEN** the pane is opened in a drawer-width container
- **THEN** no gutter is reserved and the document's fitted scale is unchanged

#### Scenario: A closed drawer shows no markers

- **WHEN** the pane is closed in a drawer-width container
- **THEN** no anchor markers are rendered

### Requirement: A drawer stacks its cards instead of anchoring them

Cards in a drawer SHALL render in document order in normal flow, with no per-card anchor offset. An anchored card in a drawer points at text the drawer is covering, which is worse than not pointing at all.

The drawer SHALL scroll itself. The anchored rail rides the document's scroll; a drawer has no document scroll to ride, and a list longer than the screen has to be able to reach its end.

#### Scenario: Cards carry no anchor offset

- **WHEN** the drawer renders its cards
- **THEN** no card carries a positioned offset, and the cards follow one another in document order

### Requirement: A drawer behaves as a dismissible dialog and keeps its state when dismissed

An open drawer SHALL identify as a dialog, SHALL be dismissible by Escape, by its own close control, and by tapping the scrim behind it, and SHALL take focus on open and return it to the control that opened it on close.

A closed drawer SHALL be hidden and inert rather than unmounted, so a half-typed reply survives being dismissed and reopened. The scrim SHALL exist only while the drawer is open, so it can never swallow a tap meant for the page.

#### Scenario: Escape closes it

- **WHEN** Escape is pressed with the drawer open
- **THEN** the pane closes

#### Scenario: A dismissed drawer keeps what was typed in it

- **WHEN** the drawer is closed and reopened
- **THEN** an unsent reply typed before the close is still there

#### Scenario: A closed drawer is out of the tab order

- **WHEN** the drawer is closed
- **THEN** it is hidden and inert, and no scrim is rendered
