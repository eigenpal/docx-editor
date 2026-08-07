## ADDED Requirements

### Requirement: The display scale can track the viewport instead of holding a number

The editor SHALL carry a zoom MODE alongside its zoom. A `fixed` mode holds the scale until something sets it; a `fit` mode recomputes it whenever the room beside the page changes, bounded by an optional `minZoom` and `maxZoom`.

Both SHALL be readable: `Editor.getZoom()` answers the resolved scale and `Editor.getZoomMode()` answers where it came from, and `EditorSnapshot` SHALL carry both. Neither implies the other — a control renders its selected state from the mode and its label from the scale, and a control that derived the mode from the scale would mark a level as chosen while the editor was about to move off it.

`Editor.setZoomMode` SHALL accept `'auto'` as shorthand for the capped page-width fit, and SHALL refuse (`invalidArgs`) a value that is not a mode rather than substituting one.

#### Scenario: The mode and the scale are separately readable

- **WHEN** an editor is fitting the page width and has resolved to 79%
- **THEN** `getZoom()` answers `0.79`, `getZoomMode()` answers the fit, and `snapshot()` carries both

#### Scenario: An unknown mode is refused

- **WHEN** a caller passes a value that is not a zoom mode
- **THEN** the call answers `{ ok: false, code: 'invalidArgs' }` and the mode in force is unchanged

### Requirement: A new editor fits the page width without magnifying it, and without shrinking it past legibility

The default mode SHALL be `'auto'`: fit the page width, bounded below at a legible floor and above at 100%. A container with room for the page SHALL therefore render at 100%, unchanged from a fixed default, and a container too narrow for it SHALL shrink the document rather than overflow it horizontally.

Past the floor the document SHALL keep its size and the container SHALL scroll horizontally. Fitting exists to avoid a scrollbar; below the floor it would be trading a scrollbar nobody minds for a document nobody can read, which is the worse of the two. This is what a narrow container with the comments rail open gets: the rail keeps its gutter, the page keeps a legible size, and the overflow scrolls.

An editor constructed with a `zoom` and no `zoomMode` SHALL open FIXED at that scale. An embedder that pinned a number asked for that number.

#### Scenario: A wide container is unchanged

- **WHEN** a document opens in a container wide enough for the page and its gutters
- **THEN** the scale is 1

#### Scenario: A narrow container shrinks the page

- **WHEN** a document opens in a container narrower than the page
- **THEN** the scale is below 1, and it is resolved during the mount rather than a frame later, so the page is painted once at the fitted scale

#### Scenario: A container past the floor overflows instead of shrinking further

- **WHEN** the room left for the page is less than the floor would need — a narrow container with the comments rail reserving its gutter
- **THEN** the scale stops at the floor and the container scrolls horizontally

#### Scenario: A configured zoom is not overridden by the default

- **WHEN** an editor is constructed with `zoom: 1.5` and no `zoomMode`
- **THEN** the mode is `fixed` and the scale is 1.5 at every container width

### Requirement: A fit measures the room the page actually has

The fit SHALL be computed from the scroll container's CONTENT box — its client width less both inline paddings — and not from its width. Anything that reserves room beside the page does so with padding on that element, so the fit SHALL shrink the document by exactly what was reserved, with no further wiring between the reserving chrome and the zoom.

The fit SHALL leave a gutter on each side rather than painting the page flush to the container's edges.

The computed scale SHALL be quantized DOWN to whole percent, and SHALL be clamped into the contract's range and then into the mode's own bounds rather than refused. A measurement that cannot be taken — a container not yet laid out, a document not yet paginated — SHALL leave the scale as it is rather than resolve to a guess.

#### Scenario: Opening the comments rail shrinks the document

- **WHEN** the review pane opens and reserves its gutter on the scroll container
- **THEN** the fitted scale drops by what the gutter took, with no call from the pane to the zoom

#### Scenario: Rounding never overflows the box

- **WHEN** the exact ratio falls between two whole percents
- **THEN** the lower is chosen, and the painted page is no wider than the room it was fitted to

#### Scenario: A sub-percent change moves nothing

- **WHEN** the available width changes by less than one percent of a page
- **THEN** the scale does not change and the document is not re-laid out

#### Scenario: An unmeasurable container leaves the scale alone

- **WHEN** the scroll container reports a zero width, or no page has been laid out
- **THEN** the scale in force is unchanged

### Requirement: A fit refits when its inputs move, and stops when the editor does

A fit SHALL be recomputed when the scroll container's content box changes size, when a document is mounted, when the mode is set to a fit, and when a command changes the page's own size. Recomputation SHALL be coalesced so that a container being dragged re-lays out the document once per frame at most.

Observation SHALL stop when the editor is detached or destroyed.

#### Scenario: Switching to a fit takes effect on the call

- **WHEN** `setZoomMode` moves a fixed editor to a fit
- **THEN** the scale is fitted before the call returns, rather than at the next resize

#### Scenario: Changing the paper size refits

- **WHEN** a `setPageSetup` command changes the page's width or orientation
- **THEN** the fit is recomputed against the new page

#### Scenario: A detached editor stops tracking

- **WHEN** the editor is detached and the container is then resized
- **THEN** the scale is unchanged

### Requirement: A refit is published, not merely readable

An automatic refit SHALL move the state tick and emit on the same channel a scale set by a caller does. A host that subscribes rather than polls SHALL see an automatic refit exactly as it sees a toolbar click.

#### Scenario: A resize reaches a subscriber

- **WHEN** a resize changes the fitted scale
- **THEN** subscribers to `selectionChange` receive a snapshot carrying the new scale

### Requirement: Choosing a scale ends the fit

`Editor.setZoom` SHALL leave any fit mode. It SHALL do so even when the requested scale equals the one the fit had resolved to, and SHALL publish that change, because the mode moved even though nothing on screen did.

`setZoom` SHALL keep refusing a scale outside the contract's range rather than clamping it: unlike a fit, it has a caller to tell.

#### Scenario: A picked level survives a resize

- **WHEN** a reader picks 150% and then narrows the container
- **THEN** the scale stays at 150%

#### Scenario: Picking the level the fit had landed on still ends the fit

- **WHEN** an auto-fitted editor reads 100% and the reader picks 100%
- **THEN** the mode becomes fixed, the change is published, and a later resize does not move the page

### Requirement: A pane whose width the page follows docks rather than floats

Chrome that displaces the document by padding the scroll container SHALL, while a fit mode is active, reserve its full width or none of it, and SHALL NOT take an intermediate displacement.

Under a fixed scale a centred page of unchanging width moves by half the padding, so a partial displacement is exact. Under a fit the page is re-scaled to the padded box, so a partial displacement narrows the page, which widens the gutter, which asks for a smaller displacement, which widens the page again — the chrome and the document chase each other every frame and never settle. Docked or not is a fixed point; anything between them is not.

#### Scenario: A pane that fits the gutter still moves nothing

- **WHEN** the gutter beside the page is already wider than the pane needs
- **THEN** the displacement is 0, fit or fixed

#### Scenario: A pane that does not fit docks fully

- **WHEN** the gutter is narrower than the pane needs and the editor is fitting
- **THEN** the displacement is the pane's full reservation, and it does not change as the fit resolves

### Requirement: A host can read and drive the whole zoom lifecycle

The React adapter SHALL expose the zoom as one hook giving the resolved scale, the mode, whether the mode is a fit, and the actions that move either: a fixed scale, a mode, the two named fits, a reset, and steps along the preset ladder with their availability.

The hook SHALL hold no zoom state of its own — every read comes from the engine's snapshot and every action calls the engine — so a control built on it cannot disagree with the painted pages.

Outside an editor it SHALL report a plain, untracked 100% and every action SHALL be a no-op, so a control renders unconditionally rather than guarding.

The preset ladder SHALL carry a rung below the default fit's floor. A ladder that stopped where the fit stops would disable every zoom-out affordance in exactly the case the floor exists for.

#### Scenario: A control renders before there is an editor

- **WHEN** the hook is called outside a provider
- **THEN** it reports 100%, not a fit, neither step available, and calling any action does nothing

#### Scenario: A zoom control shows the mode, not the percentage

- **WHEN** the editor is in a fit that has resolved to exactly 100%
- **THEN** a menu built on the hook marks the FIT as chosen and does not mark the 100% level

#### Scenario: A mode the control cannot offer is not misrepresented

- **WHEN** the editor is in a fit whose bounds the control has no entry for
- **THEN** no entry is marked chosen, rather than one whose selection would silently replace those bounds

#### Scenario: The floor is not the end of the road

- **WHEN** a fit has come to rest on its floor
- **THEN** the zoom-out step is still available and moves to the rung below it
